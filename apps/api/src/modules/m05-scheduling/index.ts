import { z } from 'zod';
import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, forbidden, invalid } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on } from '../../kernel/index.js';
import { registerWhatsAppSim, handleInbound, whatsappOutbox } from '../../sim/whatsapp.js';
import { availability, addDays, sastDate, sastTime, loadSheddingFor, roomTypeFor } from './slots.js';
import { loadCatalogue } from '../m04-referrals/catalogue.js';
import { appointmentsWithContext, backfillFromWaitlist, cancelAppointment, confirmHold, earliestNearMe, expireHolds, holdSlot, releaseHold, rescheduleAppointment, sendDueReminders, statInsert } from './service.js';
import { registerBookingHand, registerBookingInbound } from './hand.js';

const r = router();
const STAFF = ['FDK', 'BKG', 'PRM', 'RAD', 'RGT', 'NUR', 'BIL', 'DEB', 'EXE', 'SUP', 'CMP'] as const;

/* ---------- Availability and search ---------- */
r.get('/availability', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const { siteId, roomId, modality, date, durationMin } = query(c, z.object({ siteId: z.string().optional(), roomId: z.string().optional(), modality: z.string(), date: z.string().optional(), durationMin: z.coerce.number().min(5).max(180).default(20) }));
  const services = c.get('services');
  const day = date ?? sastDate(services.clock.now());
  const res = await availability(services, { siteIds: siteId ? [siteId] : undefined, roomId, modalityType: modality, date: day, durationMin });
  const ls = siteId ? await loadSheddingFor(services, siteId) : null;
  return c.json({ date: day, ...res, loadShedding: ls });
});

r.get('/earliest', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const { orderId, limit, days, afterTime, siteIds } = query(c, z.object({ orderId: z.string(), limit: z.coerce.number().min(1).max(10).default(3), days: z.coerce.number().min(1).max(60).default(14), afterTime: z.string().optional(), siteIds: z.string().optional() }));
  const services = c.get('services');
  const [o] = await services.db.select({ patientId: schema.orders.patientId, referrerId: schema.orders.referrerId }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw notFound('Order');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && o.patientId !== user.patientId) throw forbidden();
  const res = await earliestNearMe(services, { orderId, limit, days, afterTime, siteIds: siteIds?.split(',') });
  return c.json(res);
});

/* ---------- Holds and booking ---------- */
r.post('/holds', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const { orderId, roomId, startsAt, source } = await body(c, z.object({ orderId: z.string(), roomId: z.string(), startsAt: z.string(), source: z.enum(['whatsapp', 'patient_space', 'desk', 'booking', 'referrer', 'walk_in']).optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [o] = await services.db.select({ patientId: schema.orders.patientId }).from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) throw notFound('Order');
  if (user.persona === 'PAT' && o.patientId !== user.patientId) throw forbidden();
  const appt = await holdSlot(services, { orderId, roomId, startsAt, source: source ?? (user.persona === 'PAT' ? 'patient_space' : user.persona === 'REF' ? 'referrer' : user.persona === 'BKG' ? 'booking' : 'desk'), bookedBy: user.id });
  await audit(c, 'slot.held', { type: 'appointment', id: appt.id }, { roomId, startsAt });
  return c.json({ appointment: appt, holdExpiresAt: appt.holdExpiresAt }, 201);
});

r.delete('/holds/:id', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  await releaseHold(c.get('services'), param(c, 'id'));
  await audit(c, 'slot.hold_released', { type: 'appointment', id: param(c, 'id') });
  return c.json({ ok: true });
});

r.post('/holds/:id/confirm', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const [a] = await services.db.select({ patientId: schema.appointments.patientId }).from(schema.appointments).where(eq(schema.appointments.id, id)).limit(1);
  if (!a) throw notFound('Appointment');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && a.patientId !== user.patientId) throw forbidden();
  const appt = await confirmHold(services, id, { c, bookedBy: user.id });
  await audit(c, 'appointment.booked', { type: 'appointment', id }, { startsAt: appt.startsAt, siteId: appt.siteId, source: appt.source });
  return c.json({ appointment: appt });
});

r.post('/stat', allow('BKG', 'FDK', 'PRM', 'RGT', 'RAD', 'SUP'), async (c) => {
  const { orderId, siteId } = await body(c, z.object({ orderId: z.string(), siteId: z.string() }));
  const res = await statInsert(c.get('services'), { orderId, siteId, actor: c.get('user')!.id, c });
  await audit(c, 'appointment.stat_inserted', { type: 'appointment', id: res.appointment.id }, { displaced: res.displaced, siteId });
  return c.json(res, 201);
});

/* ---------- Appointments ---------- */
r.get('/appointments', allow(...STAFF, 'REF'), async (c) => {
  const practiceId = requirePractice(c);
  const { date, from, to, siteId, status, patientId, limit } = query(c, z.object({ date: z.string().optional(), from: z.string().optional(), to: z.string().optional(), siteId: z.string().optional(), status: z.string().optional(), patientId: z.string().optional(), limit: z.coerce.number().min(1).max(1000).default(400) }));
  const services = c.get('services');
  const fromIso = date ? new Date(`${date}T00:00:00+02:00`).toISOString() : from ? new Date(from).toISOString() : undefined;
  const toIso = date ? new Date(`${addDays(date, 1)}T00:00:00+02:00`).toISOString() : to ? new Date(to).toISOString() : undefined;
  const rows = await services.db.select().from(schema.appointments).where(and(eq(schema.appointments.practiceId, practiceId), fromIso ? gte(schema.appointments.startsAt, fromIso) : undefined, toIso ? lt(schema.appointments.startsAt, toIso) : undefined, siteId ? eq(schema.appointments.siteId, siteId) : undefined, patientId ? eq(schema.appointments.patientId, patientId) : undefined, status ? inArray(schema.appointments.status, status.split(',')) : ne(schema.appointments.status, 'cancelled'))).orderBy(schema.appointments.startsAt).limit(limit);
  return c.json({ appointments: await appointmentsWithContext(services, rows) });
});

r.get('/appointments/:id', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const services = c.get('services');
  const [a] = await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, param(c, 'id'))).limit(1);
  if (!a) throw notFound('Appointment');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && a.patientId !== user.patientId) throw forbidden();
  const [full] = await appointmentsWithContext(services, [a]);
  const reminders = await services.db.select().from(schema.reminders).where(eq(schema.reminders.appointmentId, a.id)).orderBy(schema.reminders.dueAt);
  return c.json({ appointment: user.persona === 'PAT' ? { ...full, noShowScore: undefined } : full, reminders });
});

r.post('/appointments/:id/reschedule', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const id = param(c, 'id');
  const { roomId, startsAt } = await body(c, z.object({ roomId: z.string(), startsAt: z.string() }));
  const services = c.get('services');
  const [a] = await services.db.select({ patientId: schema.appointments.patientId }).from(schema.appointments).where(eq(schema.appointments.id, id)).limit(1);
  if (!a) throw notFound('Appointment');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && a.patientId !== user.patientId) throw forbidden();
  const appt = await rescheduleAppointment(services, id, { roomId, startsAt, actor: user.id, c, source: user.persona === 'PAT' ? 'patient_space' : undefined });
  await audit(c, 'appointment.rescheduled', { type: 'appointment', id }, { to: appt.id, startsAt: appt.startsAt });
  return c.json({ appointment: appt });
});

r.post('/appointments/:id/cancel', allow(...STAFF, 'REF', 'PAT'), async (c) => {
  const id = param(c, 'id');
  const { reason, noShow } = await body(c, z.object({ reason: z.string().min(2), noShow: z.boolean().default(false) }));
  const services = c.get('services');
  const [a] = await services.db.select({ patientId: schema.appointments.patientId }).from(schema.appointments).where(eq(schema.appointments.id, id)).limit(1);
  if (!a) throw notFound('Appointment');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && a.patientId !== user.patientId) throw forbidden();
  if (noShow && !['FDK', 'BKG', 'PRM', 'RAD', 'SUP'].includes(user.persona)) throw forbidden('Only staff may mark a no-show');
  const res = await cancelAppointment(services, id, { c, reason, actor: user.id, noShow });
  await audit(c, noShow ? 'appointment.no_show' : 'appointment.cancelled', { type: 'appointment', id }, { reason, backfill: res.backfill });
  return c.json(res);
});

r.patch('/appointments/:id/status', allow('FDK', 'BKG', 'RAD', 'NUR', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { status } = await body(c, z.object({ status: z.enum(['confirmed', 'arrived', 'in_room', 'done']) }));
  const services = c.get('services');
  await services.db.update(schema.appointments).set({ status, updatedAt: new Date().toISOString() }).where(eq(schema.appointments.id, id));
  await audit(c, 'appointment.status', { type: 'appointment', id }, { status });
  await emit(c, `appointment.${status}.v1`, { appointmentId: id, status }, { aggregateType: 'appointment', aggregateId: id });
  return c.json({ ok: true });
});

/* ---------- PAT-facing ---------- */
r.get('/mine', allow('PAT'), async (c) => {
  const user = c.get('user')!;
  if (!user.patientId) return c.json({ appointments: [] });
  const services = c.get('services');
  const rows = await services.db.select().from(schema.appointments).where(and(eq(schema.appointments.patientId, user.patientId), ne(schema.appointments.status, 'cancelled'))).orderBy(desc(schema.appointments.startsAt)).limit(20);
  const full = await appointmentsWithContext(services, rows);
  return c.json({ appointments: full.map((a) => ({ ...a, noShowScore: undefined, patient: undefined })) });
});

/* ---------- Waitlist ---------- */
r.get('/waitlist', allow(...STAFF), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const rows = await services.db.select().from(schema.waitlist).where(and(eq(schema.waitlist.practiceId, practiceId), inArray(schema.waitlist.status, (c.req.query('status') ?? 'open,offered').split(',')))).orderBy(schema.waitlist.createdAt).limit(300);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const patients = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, mobile: schema.patients.mobile }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const cat = await loadCatalogue(services);
  const rank: Record<string, number> = { stat: 0, urgent: 1, priority: 2, routine: 3 };
  const out = rows.map((w) => ({ ...w, patient: patients.find((p) => p.id === w.patientId) ?? null, procedure: cat.find((p) => p.code === w.procedureCode)?.description ?? w.procedureCode, waitingDays: Math.floor((Date.now() - new Date(w.createdAt).getTime()) / 86400_000) }));
  out.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || b.waitingDays - a.waitingDays);
  return c.json({ waitlist: out });
});

r.post('/waitlist', allow(...STAFF, 'PAT', 'REF'), async (c) => {
  const data = await body(c, z.object({ orderId: z.string(), siteId: z.string().optional(), radiusKm: z.number().default(30), earliestFrom: z.string().optional(), flexibility: z.enum(['any', 'mornings', 'afternoons', 'evenings']).default('any'), notes: z.string().optional() }));
  const services = c.get('services');
  const [o] = await services.db.select().from(schema.orders).where(eq(schema.orders.id, data.orderId)).limit(1);
  if (!o) throw notFound('Order');
  const user = c.get('user')!;
  if (user.persona === 'PAT' && o.patientId !== user.patientId) throw forbidden();
  const id = newId('wlt');
  const { orderId: _ignored, ...rest } = data;
  await services.db.insert(schema.waitlist).values({ id, practiceId: o.practiceId, orderId: o.id, patientId: o.patientId, procedureCode: o.procedures[0]!.code, modalityType: o.procedures[0]!.modality, priority: o.priority, ...rest });
  await audit(c, 'waitlist.added', { type: 'waitlist', id }, { orderId: o.id });
  return c.json({ id }, 201);
});

r.post('/waitlist/:id/offer', allow('BKG', 'FDK', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { roomId, startsAt } = await body(c, z.object({ roomId: z.string(), startsAt: z.string() }));
  const services = c.get('services');
  const [w] = await services.db.select().from(schema.waitlist).where(eq(schema.waitlist.id, id)).limit(1);
  if (!w) throw notFound('Waitlist entry');
  const hold = await holdSlot(services, { orderId: w.orderId, roomId, startsAt, source: 'booking', bookedBy: c.get('user')!.id });
  await services.db.update(schema.waitlist).set({ status: 'offered', offeredAppointmentId: hold.id, offerExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), offersMade: w.offersMade + 1, updatedAt: new Date().toISOString() }).where(eq(schema.waitlist.id, id));
  await audit(c, 'waitlist.offered', { type: 'waitlist', id }, { appointmentId: hold.id });
  return c.json({ appointment: hold });
});

r.delete('/waitlist/:id', allow(...STAFF, 'PAT'), async (c) => {
  await c.get('services').db.update(schema.waitlist).set({ status: 'withdrawn', updatedAt: new Date().toISOString() }).where(eq(schema.waitlist.id, param(c, 'id')));
  return c.json({ ok: true });
});

/* ---------- Templates ---------- */
r.get('/templates', allow(...STAFF), async (c) => {
  const practiceId = requirePractice(c);
  const rows = await c.get('services').db.select().from(schema.slotTemplates).where(eq(schema.slotTemplates.practiceId, practiceId)).orderBy(schema.slotTemplates.roomId, schema.slotTemplates.weekday);
  return c.json({ templates: rows });
});
r.post('/templates', allow('PRM', 'SUP', 'EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ siteId: z.string(), roomId: z.string(), modalityType: z.string(), weekday: z.number().min(0).max(6), startTime: z.string(), endTime: z.string(), slotMinutes: z.number().min(5).max(120), blockType: z.enum(['open', 'walkin', 'screening', 'inpatient']).default('open'), walkInReservePct: z.number().default(0), effectiveFrom: z.string().optional() }));
  const id = newId('tpl');
  await c.get('services').db.insert(schema.slotTemplates).values({ id, practiceId, ...data });
  await audit(c, 'slot_template.created', { type: 'slot_template', id }, data);
  return c.json({ id }, 201);
});

/* ---------- Load-shedding config ---------- */
r.get('/loadshedding/:siteId', allow(...STAFF, 'PAT', 'REF'), async (c) => c.json({ siteId: param(c, 'siteId'), config: await loadSheddingFor(c.get('services'), param(c, 'siteId')) }));
r.put('/loadshedding/:siteId', allow('PRM', 'BIO', 'SUP', 'EXE'), async (c) => {
  const siteId = param(c, 'siteId');
  const cfg = await body(c, z.object({ stage: z.number().min(0).max(8), schedule: z.array(z.object({ weekday: z.number(), start: z.string(), end: z.string() })).default([]), generatorModalities: z.array(z.string()).default([]), roomsOnGenerator: z.array(z.string()).optional(), note: z.string().optional() }));
  const services = c.get('services');
  const [existing] = await services.db.select().from(schema.referenceData).where(and(eq(schema.referenceData.kind, 'loadshedding'), eq(schema.referenceData.key, siteId))).limit(1);
  if (existing) await services.db.update(schema.referenceData).set({ value: cfg, version: existing.version + 1 }).where(eq(schema.referenceData.id, existing.id));
  else await services.db.insert(schema.referenceData).values({ id: newId('ref'), kind: 'loadshedding', key: siteId, practiceId: c.get('practiceId'), value: cfg });
  await audit(c, 'loadshedding.updated', { type: 'site', id: siteId }, { stage: cfg.stage });
  await emit(c, 'capacity.reduced.v1', { siteId, cause: 'load_shedding', stage: cfg.stage }, { aggregateType: 'site', aggregateId: siteId });
  return c.json({ ok: true });
});

/* ---------- Conversations (Booking Hand inbox) ---------- */
r.get('/conversations', allow('BKG', 'FDK', 'PRM', 'SUP', 'EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const rows = await services.db.select().from(schema.conversations).where(eq(schema.conversations.practiceId, practiceId)).orderBy(desc(schema.conversations.updatedAt)).limit(100);
  const pids = [...new Set(rows.map((x) => x.patientId).filter(Boolean))] as string[];
  const patients = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex, language: schema.patients.language }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  return c.json({ conversations: rows.map((x) => ({ ...x, patient: patients.find((p) => p.id === x.patientId) ?? null, lastMessage: x.messages[x.messages.length - 1] ?? null })) });
});

r.get('/conversations/:id', allow('BKG', 'FDK', 'PRM', 'SUP', 'EXE'), async (c) => {
  const services = c.get('services');
  const [conv] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, param(c, 'id'))).limit(1);
  if (!conv) throw notFound('Conversation');
  const task = conv.lastTaskId ? (await services.db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, conv.lastTaskId)).limit(1))[0] ?? null : null;
  const patient = conv.patientId ? (await services.db.select().from(schema.patients).where(eq(schema.patients.id, conv.patientId)).limit(1))[0] : null;
  const order = conv.orderId ? (await services.db.select().from(schema.orders).where(eq(schema.orders.id, conv.orderId)).limit(1))[0] : null;
  const funding = conv.orderId ? (await services.db.select().from(schema.fundingCases).where(eq(schema.fundingCases.orderId, conv.orderId)).limit(1))[0] ?? null : null;
  return c.json({ conversation: conv, task, patient: patient ? { ...patient, idNumber: undefined, idMasked: patient.idNumber ? `····${patient.idNumber.slice(-4)}` : '' } : null, order: order ?? null, funding });
});

r.post('/conversations/:id/claim', allow('BKG', 'FDK', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  await c.get('services').db.update(schema.conversations).set({ claimedBy: c.get('user')!.id, state: 'handed_over', updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, id));
  await audit(c, 'conversation.claimed', { type: 'conversation', id });
  return c.json({ ok: true });
});

r.post('/conversations/:id/reply', allow('BKG', 'FDK', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { text } = await body(c, z.object({ text: z.string().min(1).max(600) }));
  const services = c.get('services');
  const [conv] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1);
  if (!conv) throw notFound('Conversation');
  const { sendWhatsApp } = await import('../../sim/whatsapp.js');
  await sendWhatsApp(services, { practiceId: conv.practiceId, to: conv.mobile, text, by: c.get('user')!.id, patientId: conv.patientId });
  await audit(c, 'conversation.replied', { type: 'conversation', id });
  return c.json({ ok: true });
});

/** Demo: drive an inbound WhatsApp message through the Booking Hand from the console. */
r.post('/conversations/inbound', allow('BKG', 'FDK', 'PRM', 'SUP', 'EXE'), async (c) => {
  const { from, text } = await body(c, z.object({ from: z.string().min(9), text: z.string().min(1) }));
  const res = await handleInbound(c.get('services'), { practiceId: requirePractice(c), from, text });
  return c.json(res);
});

r.get('/outbox', allow('BKG', 'FDK', 'PRM', 'SUP', 'EXE'), (c) => c.json({ messages: whatsappOutbox().slice(-50).reverse() }));

/* ---------- Analytics ---------- */
r.get('/analytics', allow('BKG', 'PRM', 'EXE', 'SUP', 'FDK'), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = await services.db.select({ status: schema.appointments.status, source: schema.appointments.source, startsAt: schema.appointments.startsAt, modalityType: schema.appointments.modalityType, noShowScore: schema.appointments.noShowScore }).from(schema.appointments).where(and(eq(schema.appointments.practiceId, practiceId), gte(schema.appointments.startsAt, since)));
  const bySource: Record<string, number> = {};
  const byModality: Record<string, number> = {};
  for (const a of rows) { bySource[a.source] = (bySource[a.source] ?? 0) + 1; byModality[a.modalityType] = (byModality[a.modalityType] ?? 0) + 1; }
  const done = rows.filter((a) => a.status === 'done').length;
  const noShow = rows.filter((a) => a.status === 'no_show').length;
  const cancelled = rows.filter((a) => a.status === 'cancelled').length;
  const convs = await services.db.select({ state: schema.conversations.state }).from(schema.conversations).where(eq(schema.conversations.practiceId, practiceId));
  const booked = convs.filter((x) => x.state === 'booked').length;
  const wl = await services.db.select({ status: schema.waitlist.status, n: sql<number>`count(*)` }).from(schema.waitlist).where(eq(schema.waitlist.practiceId, practiceId)).groupBy(schema.waitlist.status);
  const days = [...Array(14)].map((_, i) => addDays(sastDate(services.clock.now()), i - 13));
  const trend = days.map((d) => ({ label: d.slice(5), value: rows.filter((a) => sastDate(a.startsAt) === d).length }));
  return c.json({
    totals: { appointments: rows.length, done, noShow, cancelled, noShowPct: rows.length ? Math.round((noShow / Math.max(1, done + noShow)) * 100) : 0, handConversionPct: convs.length ? Math.round((booked / convs.length) * 100) : 0, waitlist: wl.find((x) => x.status === 'open')?.n ?? 0 },
    bySource: Object.entries(bySource).map(([label, value]) => ({ label, value })), byModality: Object.entries(byModality).map(([label, value]) => ({ label, value })), trend,
  });
});

/* ---------- Calendar (room x day grid) ---------- */
r.get('/calendar', allow(...STAFF), async (c) => {
  const practiceId = requirePractice(c);
  const { siteId, date } = query(c, z.object({ siteId: z.string().optional(), date: z.string().optional() }));
  const services = c.get('services');
  const day = date ?? sastDate(services.clock.now());
  const rooms = await services.db.select().from(schema.rooms).where(and(eq(schema.rooms.practiceId, practiceId), siteId ? eq(schema.rooms.siteId, siteId) : undefined)).orderBy(schema.rooms.name);
  const fromIso = new Date(`${day}T00:00:00+02:00`).toISOString();
  const toIso = new Date(`${addDays(day, 1)}T00:00:00+02:00`).toISOString();
  const appts = await services.db.select().from(schema.appointments).where(and(eq(schema.appointments.practiceId, practiceId), gte(schema.appointments.startsAt, fromIso), lt(schema.appointments.startsAt, toIso), ne(schema.appointments.status, 'cancelled'), siteId ? eq(schema.appointments.siteId, siteId) : undefined)).orderBy(schema.appointments.startsAt);
  const full = await appointmentsWithContext(services, appts);
  const blocked: Record<string, string[]> = {};
  for (const room of rooms) {
    const { rooms: rc } = await availability(services, { roomId: room.id, modalityType: room.roomType, date: day, durationMin: 15 });
    if (rc[0]?.blocked.length) blocked[room.id] = rc[0].blocked;
    if (rc[0]?.loadShedding.length) blocked[room.id] = [...(blocked[room.id] ?? []), `load-shedding ${rc[0].loadShedding.map((w) => `${sastTime(w.start)}-${sastTime(w.end)}`).join(', ')}`];
  }
  return c.json({ date: day, rooms: rooms.map((x) => ({ id: x.id, name: x.name, roomType: x.roomType, siteId: x.siteId, blocked: blocked[x.id] ?? [] })), appointments: full.map((a) => ({ ...a, patientLabel: a.patient ? `${a.patient.lastName}, ${a.patient.firstName[0]}` : '', time: sastTime(a.startsAt) })) });
});

r.get('/status', (c) => c.json({ module: 'M05', status: 'ok' }));

export default defineModule({
  code: 'M05', name: 'Scheduling & Capacity', basePath: 'scheduling', routes: r,
  boot: async () => {
    registerBookingHand();
    registerBookingInbound();
    registerWhatsAppSim();
    on('modality.down.v1', async (evt, services) => {
      // Capacity drops: appointments in the affected room today and tomorrow need re-slotting by BKG.
      const modalityId = evt.payload['modalityId'] as string;
      const [m] = await services.db.select().from(schema.modalities).where(eq(schema.modalities.id, modalityId)).limit(1);
      if (!m) return;
      const now = new Date().toISOString();
      const affected = await services.db.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.roomId, m.roomId), gte(schema.appointments.startsAt, now), lte(schema.appointments.startsAt, addDays(sastDate(now), 2)), inArray(schema.appointments.status, ['held', 'booked', 'confirmed'])));
      if (affected.length) await services.db.update(schema.appointments).set({ notes: `Room modality down: ${evt.payload['reason'] ?? 'unplanned'}; needs re-slotting`, updatedAt: now }).where(inArray(schema.appointments.id, affected.map((a) => a.id)));
    });
  },
  tick: async (services) => {
    const expired = await expireHolds(services);
    const reminders = await sendDueReminders(services);
    // release timed-out waitlist offers
    const now = new Date().toISOString();
    const stale = await services.db.select().from(schema.waitlist).where(and(eq(schema.waitlist.status, 'offered'), lt(schema.waitlist.offerExpiresAt, now)));
    for (const w of stale) {
      if (w.offeredAppointmentId) await releaseHold(services, w.offeredAppointmentId);
      await services.db.update(schema.waitlist).set({ status: 'open', offeredAppointmentId: null, offerExpiresAt: null, updatedAt: now }).where(eq(schema.waitlist.id, w.id));
      const [a] = w.offeredAppointmentId ? await services.db.select().from(schema.appointments).where(eq(schema.appointments.id, w.offeredAppointmentId)).limit(1) : [];
      if (a) await backfillFromWaitlist(services, a).catch(() => null);
    }
    return { holdsExpired: expired, remindersSent: reminders, offersReleased: stale.length };
  },
});
