import { and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, conflict, invalid } from '@bonakala/domain';
import { emit, emitDirect, type AppContext, type Services } from '../../kernel/index.js';
import { loadCatalogue, type ProcedureDef } from '../m04-referrals/catalogue.js';
import { fundingForOrder } from '../m06-funding/service.js';
import { availability, addDays, sastDate, sastTime, roomTypeFor, ACTIVE_APPT, type Slot } from './slots.js';
import { coordsFromAddress, haversineKm, travelMinutes } from './geo.js';
import { sendWhatsApp } from '../../sim/whatsapp.js';

export const HOLD_MINUTES = 10;
export const NO_SHOW_MODEL = { modelId: 'noshow-heuristic', modelVersion: '1.0' };

export interface Offer extends Slot { distanceKm: number | null; travelMin: number | null; patientPortionCents: number | null; priceCertainty: 'guaranteed' | 'subject_to_auth' | 'unchecked'; reason: string }

async function orderAndProcedure(services: Services, orderId: string) {
  const [order] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!order) throw notFound('Order');
  const cat = await loadCatalogue(services);
  const proc = cat.find((p) => p.code === order.procedures[0]!.code);
  if (!proc) throw invalid('Order procedure is not in the catalogue');
  return { order, proc };
}

/** "Earliest near me": feasible slots across sites ranked earliest first, then distance (docs/processes/02 §7.3). */
export async function earliestNearMe(services: Services, input: { orderId: string; fromDate?: string; days?: number; limit?: number; siteIds?: string[]; afterTime?: string }): Promise<{ offers: Offer[]; searched: { sites: number; days: number }; patientCoords: [number, number] | null }> {
  const { order, proc } = await orderAndProcedure(services, input.orderId);
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, order.patientId)).limit(1);
  const coords = coordsFromAddress(patient?.address);
  const sites = await services.db.select().from(schema.sites).where(input.siteIds?.length ? inArray(schema.sites.id, input.siteIds) : eq(schema.sites.status, 'active'));
  const from = input.fromDate ?? sastDate(services.clock.now());
  const days = input.days ?? 14;
  const funding = await fundingForOrder(services, order.id);
  const priceCertainty: Offer['priceCertainty'] = !funding ? 'unchecked' : funding.fundingCase.authRequired && funding.fundingCase.authStatus !== 'approved' ? 'subject_to_auth' : 'guaranteed';
  const all: Offer[] = [];
  const duration = order.procedures[0]!.durationMin ?? proc.durationMin;
  for (let d = 0; d < days && all.length < 400; d++) {
    const date = addDays(from, d);
    const { slots } = await availability(services, { siteIds: sites.map((s) => s.id), modalityType: proc.modality, date, durationMin: duration });
    for (const s of slots) {
      if (input.afterTime && sastTime(s.startsAt) < input.afterTime) continue;
      const site = sites.find((x) => x.id === s.siteId)!;
      const km = coords && site.lat != null && site.lng != null ? Math.round(haversineKm(coords[0], coords[1], site.lat / 1e6, site.lng / 1e6) * 10) / 10 : null;
      all.push({ ...s, distanceKm: km, travelMin: km == null ? null : travelMinutes(km), patientPortionCents: funding?.fundingCase.patientPortionCents ?? null, priceCertainty, reason: '' });
    }
  }
  all.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  const offers: Offer[] = [];
  const limit = input.limit ?? 3;
  const earliest = all[0];
  if (earliest) offers.push({ ...earliest, reason: 'earliest available' });
  const nearest = [...all].sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999) || a.startsAt.localeCompare(b.startsAt))[0];
  if (nearest && !offers.some((o) => o.siteId === nearest.siteId && o.startsAt === nearest.startsAt) && nearest.siteId !== earliest?.siteId) offers.push({ ...nearest, reason: 'nearest site' });
  for (const s of all) {
    if (offers.length >= limit) break;
    if (offers.some((o) => o.startsAt === s.startsAt && o.roomId === s.roomId)) continue;
    if (offers.some((o) => o.siteId === s.siteId && sastDate(o.startsAt) === sastDate(s.startsAt))) continue;
    offers.push({ ...s, reason: 'next alternative' });
  }
  for (const s of all) {
    if (offers.length >= limit) break;
    if (!offers.some((o) => o.startsAt === s.startsAt && o.roomId === s.roomId)) offers.push({ ...s, reason: 'next alternative' });
  }
  return { offers: offers.slice(0, limit), searched: { sites: sites.length, days }, patientCoords: coords };
}

/** No-show risk (Class 4 score, M11-style provenance; never shown to the patient, never refuses a booking). */
export async function noShowScore(services: Services, patientId: string, startsAt: string, source: string, patientPortionCents: number): Promise<number> {
  const history = await services.db.select({ status: schema.appointments.status }).from(schema.appointments).where(and(eq(schema.appointments.patientId, patientId), inArray(schema.appointments.status, ['done', 'no_show', 'cancelled'])));
  const total = history.length;
  const noShows = history.filter((h) => h.status === 'no_show').length;
  let p = 0.08 + (total ? (noShows / total) * 0.5 : 0.04);
  const leadDays = (new Date(startsAt).getTime() - Date.now()) / 86400_000;
  if (leadDays > 14) p += 0.08; else if (leadDays < 1) p -= 0.03;
  if (['whatsapp', 'patient_space'].includes(source)) p -= 0.04;
  const hour = Number(sastTime(startsAt).slice(0, 2));
  if (hour < 8) p += 0.04;
  if (hour >= 16) p += 0.02;
  if (patientPortionCents > 0) p += 0.06;
  if (patientPortionCents > 200000) p += 0.06;
  return Math.round(Math.max(0.02, Math.min(0.95, p)) * 100);
}

async function assertSlotFree(services: Services, roomId: string, startsAt: string, endsAt: string, ignoreId?: string) {
  const now = services.clock.now().toISOString();
  const clash = await services.db.select({ id: schema.appointments.id, status: schema.appointments.status, holdExpiresAt: schema.appointments.holdExpiresAt }).from(schema.appointments)
    .where(and(eq(schema.appointments.roomId, roomId), lt(schema.appointments.startsAt, endsAt), sql`${schema.appointments.endsAt} > ${startsAt}`, inArray(schema.appointments.status, ACTIVE_APPT), ignoreId ? ne(schema.appointments.id, ignoreId) : undefined));
  const live = clash.filter((x) => !(x.status === 'held' && x.holdExpiresAt && x.holdExpiresAt < now));
  if (live.length) throw conflict('That slot is no longer available');
}

export async function activeHoldsForPatient(services: Services, patientId: string): Promise<number> {
  const now = services.clock.now().toISOString();
  const rows = await services.db.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.patientId, patientId), eq(schema.appointments.status, 'held'), gte(schema.appointments.holdExpiresAt, now)));
  return rows.length;
}

/** Place a 10-minute hold on a slot (persisted state; slots themselves are computed). */
export async function holdSlot(services: Services, input: { orderId: string; roomId: string; startsAt: string; source: string; bookedBy: string; maxHoldsPerPatient?: number }) {
  const { order, proc } = await orderAndProcedure(services, input.orderId);
  const [room] = await services.db.select().from(schema.rooms).where(eq(schema.rooms.id, input.roomId)).limit(1);
  if (!room) throw notFound('Room');
  if (room.roomType !== roomTypeFor(proc.modality)) throw invalid(`Room ${room.name} is a ${room.roomType} room; the order needs ${proc.modality}`);
  const date = sastDate(input.startsAt);
  const duration = order.procedures[0]!.durationMin ?? proc.durationMin;
  const { slots, rooms } = await availability(services, { roomId: input.roomId, modalityType: proc.modality, date, durationMin: duration });
  const constraint = rooms[0];
  if (constraint?.blocked.length) throw conflict(`Room unavailable: ${constraint.blocked.join('; ')}`);
  const slot = slots.find((s) => s.startsAt === new Date(input.startsAt).toISOString());
  if (!slot) throw conflict('That time is not an open slot for this room');
  const holds = await activeHoldsForPatient(services, order.patientId);
  if (holds >= (input.maxHoldsPerPatient ?? 3)) throw conflict('Too many held slots for this patient; release one first');
  await assertSlotFree(services, input.roomId, slot.startsAt, slot.endsAt);
  const id = newId('apt');
  const holdExpiresAt = new Date(services.clock.now().getTime() + HOLD_MINUTES * 60_000).toISOString();
  await services.db.insert(schema.appointments).values({ id, practiceId: room.practiceId, orderId: order.id, patientId: order.patientId, siteId: room.siteId, roomId: room.id, modalityType: room.roomType, procedureCode: proc.code, procedureDescription: proc.description, startsAt: slot.startsAt, endsAt: slot.endsAt, status: 'held', source: input.source, bookedBy: input.bookedBy, holdExpiresAt, constraintsEvaluated: ['licence', 'modality_status', 'qa', 'load_shedding', 'template', 'overlap'], remindersSent: [] });
  const [row] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, id)).limit(1);
  return row!;
}

export async function releaseHold(services: Services, appointmentId: string) {
  await services.db.update(schema.appointments).set({ status: 'cancelled', cancelReason: 'hold released', updatedAt: new Date().toISOString() }).where(and(eq(schema.appointments.id, appointmentId), eq(schema.appointments.status, 'held')));
}

/** Confirm a hold: booked, order scheduled (by event), reminders scheduled, no-show score recorded, confirmation sent. */
export async function confirmHold(services: Services, appointmentId: string, opts: { c?: AppContext; bookedBy?: string; sendConfirmation?: boolean } = {}) {
  const [a] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).limit(1);
  if (!a) throw notFound('Appointment');
  if (a.status !== 'held') throw conflict(`Appointment is ${a.status}, not held`);
  const now = services.clock.now().toISOString();
  if (a.holdExpiresAt && a.holdExpiresAt < now) throw conflict('Hold expired; choose the slot again');
  await assertSlotFree(services, a.roomId, a.startsAt, a.endsAt, a.id);
  const funding = await fundingForOrder(services, a.orderId);
  const score = await noShowScore(services, a.patientId, a.startsAt, a.source, funding?.fundingCase.patientPortionCents ?? 0);
  await services.db.update(schema.appointments).set({ status: 'booked', holdExpiresAt: null, noShowScore: score, noShowModel: `${NO_SHOW_MODEL.modelId}@${NO_SHOW_MODEL.modelVersion}`, bookedBy: opts.bookedBy ?? a.bookedBy, updatedAt: now }).where(eq(schema.appointments.id, a.id));
  // release other holds for the same order
  await services.db.update(schema.appointments).set({ status: 'cancelled', cancelReason: 'other slot confirmed', updatedAt: now }).where(and(eq(schema.appointments.orderId, a.orderId), eq(schema.appointments.status, 'held'), ne(schema.appointments.id, a.id)));
  await services.db.update(schema.orders).set({ appointmentId: a.id, siteId: a.siteId, updatedAt: now }).where(eq(schema.orders.id, a.orderId));
  await services.db.update(schema.waitlist).set({ status: 'booked', updatedAt: now }).where(and(eq(schema.waitlist.orderId, a.orderId), inArray(schema.waitlist.status, ['open', 'offered'])));
  await scheduleReminders(services, { ...a, status: 'booked' });
  const payload = { appointmentId: a.id, orderId: a.orderId, patientId: a.patientId, practiceId: a.practiceId, siteId: a.siteId, roomId: a.roomId, modalityType: a.modalityType, procedureCode: a.procedureCode, startsAt: a.startsAt, source: a.source, noShowScore: score };
  if (opts.c) await emit(opts.c, 'appointment.booked.v1', payload, { aggregateType: 'appointment', aggregateId: a.id, practiceId: a.practiceId });
  else await emitDirect(services, 'appointment.booked.v1', payload, { aggregateType: 'appointment', aggregateId: a.id, practiceId: a.practiceId });
  if (opts.sendConfirmation !== false) await sendConfirmation(services, a.id).catch(() => undefined);
  const [row] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, a.id)).limit(1);
  return row!;
}

export function describeSlot(startsAt: string, siteName: string): string {
  const d = new Date(startsAt);
  const day = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `${day} ${sastTime(startsAt)} ${siteName}`;
}

export async function scheduleReminders(services: Services, a: typeof schema.appointments.$inferSelect) {
  const start = new Date(a.startsAt).getTime();
  const now = Date.now();
  const kinds: Array<[string, number]> = [['t48', 48], ['t24', 24], ['t3', 3]];
  const rows = kinds.filter(([, h]) => start - h * 3600_000 > now).map(([kind, h]) => ({ id: newId('rem'), practiceId: a.practiceId, appointmentId: a.id, patientId: a.patientId, kind, channel: 'whatsapp', dueAt: new Date(start - h * 3600_000).toISOString(), status: 'scheduled' as const }));
  rows.push({ id: newId('rem'), practiceId: a.practiceId, appointmentId: a.id, patientId: a.patientId, kind: 'post_visit', channel: 'whatsapp', dueAt: new Date(start + 3 * 3600_000).toISOString(), status: 'scheduled' as const });
  if (rows.length) await services.db.insert(schema.reminders).values(rows);
}

export async function sendConfirmation(services: Services, appointmentId: string) {
  const [a] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).limit(1);
  if (!a) return;
  const [p] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, a.patientId)).limit(1);
  const [site] = await services.db.select().from(schema.sites).where(eq(schema.sites.id, a.siteId)).limit(1);
  if (!p?.mobile || !site) return;
  const cat = await loadCatalogue(services);
  const proc = cat.find((x) => x.code === a.procedureCode);
  const funding = await fundingForOrder(services, a.orderId);
  const price = funding ? (funding.fundingCase.patientPortionCents === 0 ? 'You pay R0 on the day.' : `You pay R${Math.round(funding.fundingCase.patientPortionCents / 100)} on the day, nothing more later.`) : '';
  const text = `Booked: ${proc?.description ?? a.procedureCode}, ${describeSlot(a.startsAt, site.name)} (${site.address ?? ''}). Bring ID, scheme card and the referral. ${proc?.prep ?? ''} ${price}`.replace(/\s+/g, ' ').trim();
  const msg = await sendWhatsApp(services, { practiceId: a.practiceId, to: p.mobile, text, buttons: ['Add to calendar', 'Reschedule', 'Directions'], by: 'system:scheduling', patientId: p.id });
  await services.db.insert(schema.reminders).values({ id: newId('rem'), practiceId: a.practiceId, appointmentId: a.id, patientId: a.patientId, kind: 'confirmation', channel: 'whatsapp', dueAt: msg.at, sentAt: msg.at, status: 'sent', text });
  await services.db.update(schema.appointments).set({ remindersSent: [...(a.remindersSent ?? []), { kind: 'confirmation', at: msg.at, channel: 'whatsapp' }] }).where(eq(schema.appointments.id, a.id));
}

/** Send due reminders (tick). Respects the patient's reminder consent. */
export async function sendDueReminders(services: Services): Promise<number> {
  const now = services.clock.now().toISOString();
  const due = await services.db.select().from(schema.reminders).where(and(eq(schema.reminders.status, 'scheduled'), lt(schema.reminders.dueAt, now))).limit(50);
  let n = 0;
  for (const rem of due) {
    const [a] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, rem.appointmentId)).limit(1);
    const [p] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, rem.patientId)).limit(1);
    const [site] = a ? await services.db.select().from(schema.sites).where(eq(schema.sites.id, a.siteId)).limit(1) : [];
    const optOut = p?.consents?.['reminders']?.granted === false;
    if (!a || !p?.mobile || !['booked', 'confirmed'].includes(a.status) || optOut || (rem.kind === 'post_visit' && a.status !== 'done')) {
      await services.db.update(schema.reminders).set({ status: 'skipped' }).where(eq(schema.reminders.id, rem.id));
      continue;
    }
    const when = describeSlot(a.startsAt, site?.name ?? '');
    const texts: Record<string, [string, string[]]> = {
      t48: [`Reminder: ${a.procedureDescription ?? a.procedureCode} on ${when}. Reply CONFIRM, or choose Reschedule.`, ['Confirm', 'Reschedule', 'Cancel']],
      t24: [`Save time tomorrow: confirm your details and answer the safety questions in Patient Space (about 3 minutes).`, ['Pre-check-in', 'Directions']],
      t3: [`See you at ${sastTime(a.startsAt)} today at ${site?.name ?? 'the practice'}. Travel time about ${a.distanceKm ? travelMinutes(a.distanceKm) : 25} min. Reply HERE when you arrive.`, ['On my way', 'Running late', 'Directions']],
      post_visit: [`Thank you for visiting ${site?.name ?? 'us'} today. Your signed report goes to your doctor and to Patient Space; we will message you when it is ready.`, ['Open Patient Space']],
    };
    const [text, buttons] = texts[rem.kind] ?? texts['t48']!;
    try {
      const msg = await sendWhatsApp(services, { practiceId: a.practiceId, to: p.mobile, text, buttons, by: 'system:reminders', patientId: p.id });
      await services.db.update(schema.reminders).set({ status: 'sent', sentAt: msg.at, text }).where(eq(schema.reminders.id, rem.id));
      await services.db.update(schema.appointments).set({ remindersSent: [...(a.remindersSent ?? []), { kind: rem.kind, at: msg.at, channel: 'whatsapp' }] }).where(eq(schema.appointments.id, a.id));
      n++;
    } catch {
      await services.db.update(schema.reminders).set({ status: 'skipped' }).where(eq(schema.reminders.id, rem.id));
    }
  }
  return n;
}

export async function expireHolds(services: Services): Promise<number> {
  const now = services.clock.now().toISOString();
  const rows = await services.db.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.status, 'held'), lt(schema.appointments.holdExpiresAt, now)));
  if (rows.length) await services.db.update(schema.appointments).set({ status: 'cancelled', cancelReason: 'hold expired', updatedAt: now }).where(inArray(schema.appointments.id, rows.map((r) => r.id)));
  return rows.length;
}

export async function cancelAppointment(services: Services, appointmentId: string, opts: { c?: AppContext; reason: string; actor: string; backfill?: boolean; noShow?: boolean }) {
  const [a] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).limit(1);
  if (!a) throw notFound('Appointment');
  if (!['held', 'booked', 'confirmed', 'arrived'].includes(a.status)) throw conflict(`Cannot cancel an appointment that is ${a.status}`);
  const now = new Date().toISOString();
  const status = opts.noShow ? 'no_show' : 'cancelled';
  await services.db.update(schema.appointments).set({ status, cancelReason: opts.reason, updatedAt: now }).where(eq(schema.appointments.id, a.id));
  await services.db.update(schema.reminders).set({ status: 'skipped' }).where(and(eq(schema.reminders.appointmentId, a.id), eq(schema.reminders.status, 'scheduled')));
  const [o] = await services.db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, a.orderId)).limit(1);
  if (o && o.status === 'scheduled') await services.db.update(schema.orders).set({ status: 'ordered', appointmentId: null, updatedAt: now }).where(eq(schema.orders.id, a.orderId));
  const payload = { appointmentId: a.id, orderId: a.orderId, patientId: a.patientId, practiceId: a.practiceId, siteId: a.siteId, roomId: a.roomId, startsAt: a.startsAt, reason: opts.reason, actor: opts.actor };
  const evt = opts.noShow ? 'appointment.no_show.v1' : 'appointment.cancelled.v1';
  if (opts.c) await emit(opts.c, evt, payload, { aggregateType: 'appointment', aggregateId: a.id, practiceId: a.practiceId });
  else await emitDirect(services, evt, payload, { aggregateType: 'appointment', aggregateId: a.id, practiceId: a.practiceId });
  await emitDirect(services, 'slot.freed.v1', payload, { aggregateType: 'appointment', aggregateId: a.id, practiceId: a.practiceId });
  let backfill: { waitlistId: string; appointmentId: string } | null = null;
  if (opts.backfill !== false && a.startsAt > now) backfill = await backfillFromWaitlist(services, a).catch(() => null);
  return { appointment: { ...a, status }, backfill };
}

/** Offer a freed slot to the top waitlist candidate (hold + time-boxed WhatsApp offer), docs/processes/02 §7.4. */
export async function backfillFromWaitlist(services: Services, freed: typeof schema.appointments.$inferSelect): Promise<{ waitlistId: string; appointmentId: string } | null> {
  const rank: Record<string, number> = { stat: 0, urgent: 1, priority: 2, routine: 3 };
  const cands = await services.db.select().from(schema.waitlist).where(and(eq(schema.waitlist.status, 'open'), eq(schema.waitlist.modalityType, freed.modalityType), lt(schema.waitlist.offersMade, 3)));
  const eligible = cands.filter((w) => (!w.siteId || w.siteId === freed.siteId) && (!w.earliestFrom || w.earliestFrom <= freed.startsAt)).sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || a.createdAt.localeCompare(b.createdAt));
  for (const w of eligible.slice(0, 3)) {
    try {
      const hold = await holdSlot(services, { orderId: w.orderId, roomId: freed.roomId, startsAt: freed.startsAt, source: 'hand', bookedBy: 'hand:booking' });
      const expires = new Date(Date.now() + 15 * 60_000).toISOString();
      await services.db.update(schema.waitlist).set({ status: 'offered', offeredAppointmentId: hold.id, offerExpiresAt: expires, offersMade: w.offersMade + 1, updatedAt: new Date().toISOString() }).where(eq(schema.waitlist.id, w.id));
      const [p] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, w.patientId)).limit(1);
      const [site] = await services.db.select().from(schema.sites).where(eq(schema.sites.id, freed.siteId)).limit(1);
      if (p?.mobile) await sendWhatsApp(services, { practiceId: freed.practiceId, to: p.mobile, text: `A slot opened: ${describeSlot(freed.startsAt, site?.name ?? '')} for your ${freed.procedureDescription ?? 'scan'}. Reply YES within 15 minutes to take it.`, buttons: ['YES', 'No thanks'], by: 'hand:booking', patientId: p.id });
      await emitDirect(services, 'slot.backfilled.v1', { waitlistId: w.id, appointmentId: hold.id, practiceId: freed.practiceId }, { aggregateType: 'waitlist', aggregateId: w.id, practiceId: freed.practiceId });
      return { waitlistId: w.id, appointmentId: hold.id };
    } catch {
      continue;
    }
  }
  return null;
}

export async function rescheduleAppointment(services: Services, appointmentId: string, input: { roomId: string; startsAt: string; actor: string; source?: string; c?: AppContext }) {
  const [a] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).limit(1);
  if (!a) throw notFound('Appointment');
  if (!['booked', 'confirmed'].includes(a.status)) throw conflict(`Cannot reschedule an appointment that is ${a.status}`);
  const hold = await holdSlot(services, { orderId: a.orderId, roomId: input.roomId, startsAt: input.startsAt, source: input.source ?? a.source, bookedBy: input.actor, maxHoldsPerPatient: 99 });
  const now = new Date().toISOString();
  await services.db.update(schema.appointments).set({ status: 'rescheduled', updatedAt: now, cancelReason: `rescheduled to ${hold.startsAt}` }).where(eq(schema.appointments.id, a.id));
  await services.db.update(schema.reminders).set({ status: 'skipped' }).where(and(eq(schema.reminders.appointmentId, a.id), eq(schema.reminders.status, 'scheduled')));
  await services.db.update(schema.appointments).set({ rescheduledFromId: a.id }).where(eq(schema.appointments.id, hold.id));
  // Authorisation validity must cover the new date (M06-R-116).
  const funding = await fundingForOrder(services, a.orderId);
  if (funding?.fundingCase.authValidTo && funding.fundingCase.authValidTo < sastDate(hold.startsAt)) await services.db.update(schema.fundingCases).set({ status: 'expired', authStatus: 'expired', notes: 'Authorisation validity ended before the rescheduled date; re-run required', updatedAt: now }).where(eq(schema.fundingCases.id, funding.fundingCase.id));
  const confirmed = await confirmHold(services, hold.id, { c: input.c, bookedBy: input.actor });
  await emitDirect(services, 'appointment.rescheduled.v1', { fromAppointmentId: a.id, appointmentId: confirmed.id, orderId: a.orderId, patientId: a.patientId, practiceId: a.practiceId, startsAt: confirmed.startsAt }, { aggregateType: 'appointment', aggregateId: confirmed.id, practiceId: a.practiceId });
  await emitDirect(services, 'slot.freed.v1', { appointmentId: a.id, roomId: a.roomId, startsAt: a.startsAt, practiceId: a.practiceId }, { practiceId: a.practiceId });
  await backfillFromWaitlist(services, a).catch(() => null);
  return confirmed;
}

/** STAT insertion: bypasses slot search, least-disruptive room at the site, next 15 minutes, displacement recorded (M05-R-110). */
export async function statInsert(services: Services, input: { orderId: string; siteId: string; actor: string; c?: AppContext }) {
  const { order, proc } = await orderAndProcedure(services, input.orderId);
  const rooms = await services.db.select().from(schema.rooms).where(and(eq(schema.rooms.siteId, input.siteId), eq(schema.rooms.roomType, roomTypeFor(proc.modality)), eq(schema.rooms.status, 'active')));
  if (!rooms.length) throw invalid(`No ${proc.modality} room at this site`);
  const mods = await services.db.select().from(schema.modalities).where(inArray(schema.modalities.roomId, rooms.map((r) => r.id)));
  const today = sastDate(services.clock.now());
  const usable = rooms.filter((r) => !(r.licenceExpiry && r.licenceExpiry < today) && mods.filter((m) => m.roomId === r.id).some((m) => m.status === 'active'));
  if (!usable.length) throw conflict('No licensed, working room for this modality at the site');
  const start = new Date(Math.ceil((services.clock.now().getTime() + 15 * 60_000) / (5 * 60_000)) * 5 * 60_000);
  const duration = proc.durationMin;
  const end = new Date(start.getTime() + duration * 60_000);
  let best: { room: typeof rooms[number]; displaced: number } | null = null;
  for (const room of usable) {
    const overlap = await services.db.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.roomId, room.id), lt(schema.appointments.startsAt, end.toISOString()), sql`${schema.appointments.endsAt} > ${start.toISOString()}`, inArray(schema.appointments.status, ['booked', 'confirmed', 'arrived'])));
    if (!best || overlap.length < best.displaced) best = { room, displaced: overlap.length };
  }
  const room = best!.room;
  const id = newId('apt');
  await services.db.insert(schema.appointments).values({ id, practiceId: room.practiceId, orderId: order.id, patientId: order.patientId, siteId: room.siteId, roomId: room.id, modalityType: room.roomType, procedureCode: proc.code, procedureDescription: proc.description, startsAt: start.toISOString(), endsAt: end.toISOString(), status: 'booked', source: 'stat', bookedBy: input.actor, constraintsEvaluated: ['licence', 'modality_status'], softOverrides: [{ rule: 'displacement', reason: `STAT insertion displaced ${best!.displaced} booking(s)`, by: input.actor }], remindersSent: [], noShowScore: 2, noShowModel: `${NO_SHOW_MODEL.modelId}@${NO_SHOW_MODEL.modelVersion}` });
  await services.db.update(schema.orders).set({ appointmentId: id, siteId: room.siteId, priority: 'stat', updatedAt: new Date().toISOString() }).where(eq(schema.orders.id, order.id));
  const payload = { appointmentId: id, orderId: order.id, patientId: order.patientId, practiceId: room.practiceId, siteId: room.siteId, roomId: room.id, modalityType: room.roomType, procedureCode: proc.code, startsAt: start.toISOString(), source: 'stat', displaced: best!.displaced };
  if (input.c) await emit(input.c, 'appointment.booked.v1', payload, { aggregateType: 'appointment', aggregateId: id, practiceId: room.practiceId });
  else await emitDirect(services, 'appointment.booked.v1', payload, { aggregateType: 'appointment', aggregateId: id, practiceId: room.practiceId });
  await emitDirect(services, 'appointment.stat_inserted.v1', payload, { aggregateType: 'appointment', aggregateId: id, practiceId: room.practiceId });
  const [row] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, id)).limit(1);
  return { appointment: row!, displaced: best!.displaced };
}

export async function appointmentsWithContext(services: Services, rows: Array<typeof schema.appointments.$inferSelect>) {
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const patients = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex, language: schema.patients.language, schemeName: schema.patients.schemeName, flags: schema.patients.flags, idNumber: schema.patients.idNumber }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const rooms = await services.db.select({ id: schema.rooms.id, name: schema.rooms.name, siteId: schema.rooms.siteId }).from(schema.rooms);
  const sites = await services.db.select({ id: schema.sites.id, name: schema.sites.name }).from(schema.sites);
  const oids = [...new Set(rows.map((x) => x.orderId))];
  const orders = oids.length ? await services.db.select({ id: schema.orders.id, orderNo: schema.orders.orderNo, priority: schema.orders.priority, status: schema.orders.status, referrerId: schema.orders.referrerId, procedures: schema.orders.procedures }).from(schema.orders).where(inArray(schema.orders.id, oids)) : [];
  const fcs = oids.length ? await services.db.select({ orderId: schema.fundingCases.orderId, status: schema.fundingCases.status, patientPortionCents: schema.fundingCases.patientPortionCents, authStatus: schema.fundingCases.authStatus }).from(schema.fundingCases).where(inArray(schema.fundingCases.orderId, oids)) : [];
  const referrers = await services.db.select({ id: schema.referrers.id, name: schema.referrers.name }).from(schema.referrers);
  return rows.map((a) => {
    const p = patients.find((x) => x.id === a.patientId);
    const o = orders.find((x) => x.id === a.orderId);
    return { ...a, patient: p ? { ...p, idNumber: undefined, idMasked: p.idNumber ? `····${p.idNumber.slice(-4)}` : '' } : null, room: rooms.find((x) => x.id === a.roomId)?.name ?? null, site: sites.find((x) => x.id === a.siteId)?.name ?? null, order: o ?? null, referrer: referrers.find((x) => x.id === o?.referrerId)?.name ?? null, funding: fcs.find((x) => x.orderId === a.orderId) ?? null };
  });
}

export type { ProcedureDef };
export { desc };
