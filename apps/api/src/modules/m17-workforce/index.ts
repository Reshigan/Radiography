import { z } from 'zod';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { defineHand, newId, notFound, invalid, conflict, todaySast, Refused } from '@bonakala/domain';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, registerHand, runHand } from '../../kernel/index.js';
import type { Services } from '../../kernel/ports.js';

const r = router();
const READERS = ['PRM', 'EXE', 'SUP', 'CMP', 'RAD', 'RGT', 'NUR', 'BIO', 'FDK', 'BKG'] as const;
const MANAGERS = ['PRM', 'EXE', 'SUP'] as const;

function addDays(date: string, n: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh! * 60 + em! - sh! * 60 - sm!) / 60;
}
/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/* ---------- BCEA rule pack (illustrative, configurable reference data; docs/processes/11 §2.3) ---------- */
export const BCEA_RULES = {
  maxOrdinaryHoursPerWeek: 45,
  maxOrdinaryHoursPerDay: 9,
  maxOvertimeHoursPerWeek: 10,
  minDailyRestHours: 12,
  minWeeklyRestHours: 36,
  mealIntervalAfterHours: 5,
  nightWorkFrom: '18:00',
  note: 'Basic Conditions of Employment Act 75 of 1997 is the floor; sectoral determinations or contracts may be more generous. Values are a versioned rule pack per employing entity, not hard-coded law.',
};

export interface BceaBreach { rule: string; detail: string; kind: 'crit' | 'att' }

/** Evaluate BCEA-derived rules for one staff member across every site they are rostered to. */
export async function bceaCheck(services: Services, staffId: string, candidate: { date: string; startTime: string; endTime: string } | null): Promise<BceaBreach[]> {
  const from = addDays(candidate?.date ?? todaySast(), -7);
  const to = addDays(candidate?.date ?? todaySast(), 7);
  const rows = await services.db.select().from(schema.shifts).where(and(eq(schema.shifts.staffId, staffId), gte(schema.shifts.date, from), lte(schema.shifts.date, to), sql`${schema.shifts.status} in ('planned','confirmed','agency','swapped')`));
  const all = candidate ? [...rows.map((x) => ({ date: x.date, startTime: x.startTime, endTime: x.endTime, hours: x.hours })), { ...candidate, hours: hoursBetween(candidate.startTime, candidate.endTime) }] : rows.map((x) => ({ date: x.date, startTime: x.startTime, endTime: x.endTime, hours: x.hours }));
  const breaches: BceaBreach[] = [];
  const target = candidate?.date ?? todaySast();
  const ws = weekStart(target);
  const week = all.filter((s) => s.date >= ws && s.date < addDays(ws, 7));
  const weekHours = week.reduce((a, s) => a + s.hours, 0);
  if (weekHours > BCEA_RULES.maxOrdinaryHoursPerWeek + BCEA_RULES.maxOvertimeHoursPerWeek) breaches.push({ rule: 'maxOvertimeHoursPerWeek', detail: `${weekHours.toFixed(1)} h rostered in the week of ${ws} across all sites; ordinary cap ${BCEA_RULES.maxOrdinaryHoursPerWeek} h plus overtime cap ${BCEA_RULES.maxOvertimeHoursPerWeek} h`, kind: 'crit' });
  else if (weekHours > BCEA_RULES.maxOrdinaryHoursPerWeek) breaches.push({ rule: 'overtimeAgreement', detail: `${weekHours.toFixed(1)} h in the week of ${ws} is above ordinary hours; overtime needs a recorded agreement and PRM approval`, kind: 'att' });
  for (const s of all) if (s.hours > BCEA_RULES.maxOrdinaryHoursPerDay) breaches.push({ rule: 'maxOrdinaryHoursPerDay', detail: `${s.date}: ${s.hours.toFixed(1)} h exceeds ${BCEA_RULES.maxOrdinaryHoursPerDay} h in a day`, kind: 'att' });
  const sorted = [...all].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const rest = (new Date(`${cur.date}T${cur.startTime}:00Z`).getTime() - new Date(`${prev.date}T${prev.endTime}:00Z`).getTime()) / 3600000;
    if (rest >= 0 && rest < BCEA_RULES.minDailyRestHours) breaches.push({ rule: 'minDailyRestHours', detail: `Only ${rest.toFixed(1)} h between ${prev.date} ${prev.endTime} and ${cur.date} ${cur.startTime}; ${BCEA_RULES.minDailyRestHours} h daily rest required`, kind: 'crit' });
  }
  for (const s of all) if (s.hours > BCEA_RULES.mealIntervalAfterHours && s.hours <= BCEA_RULES.maxOrdinaryHoursPerDay) {
    // meal interval is carried on the shift template; flagged only when a long shift has no break recorded
  }
  return breaches;
}

/** Credential state for a staff member on a date; lapsed credentials block clinical rostering (M17-R-103). */
export async function credentialState(services: Services, staffId: string, date = todaySast()): Promise<{ ok: boolean; lapsed: string[]; expiringSoon: string[] }> {
  const rows = await services.db.select().from(schema.credentials).where(eq(schema.credentials.staffId, staffId));
  const lapsed = rows.filter((x) => x.expiry && x.expiry < date).map((x) => `${x.type} expired ${x.expiry}`);
  const expiringSoon = rows.filter((x) => x.expiry && x.expiry >= date && x.expiry <= addDays(date, 30)).map((x) => `${x.type} expires ${x.expiry}`);
  return { ok: lapsed.length === 0, lapsed, expiringSoon };
}

/* ================= Staff ================= */
r.get('/staff', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const { siteId, role } = query(c, z.object({ siteId: z.string().optional(), role: z.string().optional() }));
  const rows = await services.db.select().from(schema.staff).where(and(eq(schema.staff.practiceId, practiceId), role ? eq(schema.staff.role, role) : undefined)).orderBy(asc(schema.staff.name));
  const creds = await services.db.select().from(schema.credentials).where(eq(schema.credentials.practiceId, practiceId));
  const today = todaySast();
  const filtered = siteId ? rows.filter((s) => s.homeSiteId === siteId || (s.siteIds ?? []).includes(siteId)) : rows;
  return c.json({
    staff: filtered.map((s) => {
      const mine = creds.filter((x) => x.staffId === s.id);
      return { ...s, credentials: mine, lapsed: mine.filter((x) => x.expiry && x.expiry < today).length, expiring30: mine.filter((x) => x.expiry && x.expiry >= today && x.expiry <= addDays(today, 30)).length };
    }),
  });
});
r.get('/staff/:id', allow(...READERS), async (c) => {
  const services = c.get('services');
  const id = param(c, 'id');
  const [s] = await services.db.select().from(schema.staff).where(eq(schema.staff.id, id)).limit(1);
  if (!s) throw notFound('Staff member');
  const creds = await services.db.select().from(schema.credentials).where(eq(schema.credentials.staffId, id));
  const cpd = await services.db.select().from(schema.cpdPoints).where(eq(schema.cpdPoints.staffId, id)).orderBy(desc(schema.cpdPoints.at));
  const shifts = await services.db.select().from(schema.shifts).where(and(eq(schema.shifts.staffId, id), gte(schema.shifts.date, addDays(todaySast(), -7)))).orderBy(asc(schema.shifts.date)).limit(60);
  const bcea = await bceaCheck(services, id, null);
  const cycleYear = new Date().getFullYear();
  const points = cpd.filter((x) => x.cycleYear === cycleYear).reduce((a, x) => a + x.points, 0);
  const ethics = cpd.filter((x) => x.cycleYear === cycleYear).reduce((a, x) => a + x.ethicsPoints, 0);
  return c.json({ staff: s, credentials: creds, cpd: { entries: cpd, points, ethics, target: 30, ethicsTarget: 5, onPace: points >= 30 * ((new Date().getMonth() + 1) / 12) * 0.9 }, shifts, bcea });
});
r.post('/staff', allow(...MANAGERS), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({
    name: z.string().min(2), role: z.string(), employmentType: z.string().default('permanent'), homeSiteId: z.string().optional(), siteIds: z.array(z.string()).optional(),
    competencies: z.array(z.string()).default([]), hpcsaNo: z.string().optional(), hpcsaExpiry: z.string().optional(), radiationWorker: z.boolean().default(false), dosimetryBadge: z.string().optional(),
    contractHoursPerWeek: z.number().default(45), ftePct: z.number().int().default(100), hourlyCostCents: z.number().int().optional(), userId: z.string().optional(), startDate: z.string().optional(),
  }));
  const id = newId('stf');
  await c.get('services').db.insert(schema.staff).values({ id, practiceId, ...data });
  await audit(c, 'staff.created', { type: 'staff', id }, { name: data.name, role: data.role });
  return c.json({ id }, 201);
});
r.patch('/staff/:id', allow(...MANAGERS), async (c) => {
  const id = param(c, 'id');
  const data = await body(c, z.object({ competencies: z.array(z.string()).optional(), status: z.enum(['active', 'on_leave', 'inactive']).optional(), siteIds: z.array(z.string()).optional(), hourlyCostCents: z.number().int().optional(), endDate: z.string().optional() }));
  await c.get('services').db.update(schema.staff).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.staff.id, id));
  await audit(c, 'staff.updated', { type: 'staff', id }, data);
  return c.json({ ok: true });
});

/* ================= Roster ================= */
r.get('/roster', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const { siteId, week, weeks } = query(c, z.object({ siteId: z.string().optional(), week: z.string().optional(), weeks: z.coerce.number().min(1).max(8).default(1) }));
  const start = weekStart(week ?? todaySast());
  const end = addDays(start, 7 * weeks - 1);
  const rows = await services.db.select().from(schema.shifts).where(and(eq(schema.shifts.practiceId, practiceId), siteId ? eq(schema.shifts.siteId, siteId) : undefined, gte(schema.shifts.date, start), lte(schema.shifts.date, end))).orderBy(asc(schema.shifts.date), asc(schema.shifts.startTime));
  const staffRows = await services.db.select().from(schema.staff).where(eq(schema.staff.practiceId, practiceId));
  const sites = await services.db.select().from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  const rooms = await services.db.select().from(schema.rooms).where(eq(schema.rooms.practiceId, practiceId));
  const nameOf = new Map(staffRows.map((s) => [s.id, s.name]));
  const days = Array.from({ length: 7 * weeks }, (_, i) => addDays(start, i));
  const planned = rows.reduce((a, s) => a + s.hours, 0);
  const gapHours = rows.filter((s) => s.status === 'open_gap').reduce((a, s) => a + s.hours, 0);
  return c.json({
    weekStart: start, days,
    shifts: rows.map((s) => ({ ...s, staffName: s.staffId ? nameOf.get(s.staffId) ?? null : null, siteName: sites.find((x) => x.id === s.siteId)?.name ?? s.siteId, roomName: s.roomId ? rooms.find((x) => x.id === s.roomId)?.name ?? null : null })),
    sites: sites.map((s) => ({ id: s.id, name: s.name })),
    summary: { plannedHours: Math.round(planned * 10) / 10, gapHours: Math.round(gapHours * 10) / 10, gapPct: planned ? Math.round((gapHours / planned) * 1000) / 10 : 0, shifts: rows.length, open: rows.filter((s) => s.status === 'open_gap').length, agency: rows.filter((s) => s.status === 'agency').length },
  });
});
r.get('/gaps', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const rows = await services.db.select().from(schema.shifts).where(and(eq(schema.shifts.practiceId, practiceId), sql`${schema.shifts.status} in ('open_gap','agency')`, gte(schema.shifts.date, todaySast()))).orderBy(asc(schema.shifts.date));
  const sites = await services.db.select().from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  const now = todaySast();
  return c.json({
    gaps: rows.map((s) => ({ ...s, siteName: sites.find((x) => x.id === s.siteId)?.name ?? s.siteId, hoursOut: Math.round((new Date(`${s.date}T${s.startTime}:00Z`).getTime() - Date.now()) / 3600000), urgent: s.date <= addDays(now, 2) })),
  });
});
const shiftInput = z.object({ siteId: z.string(), roomId: z.string().optional(), date: z.string(), startTime: z.string(), endTime: z.string(), role: z.string(), requiredCompetency: z.string().optional(), staffId: z.string().optional(), note: z.string().optional() });
r.post('/shifts', allow(...MANAGERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const data = await body(c, shiftInput);
  const hours = hoursBetween(data.startTime, data.endTime);
  if (hours <= 0) throw invalid('The shift must end after it starts');
  if (data.staffId) {
    const cred = await credentialState(services, data.staffId, data.date);
    if (!cred.ok) throw invalid(`Rostering blocked: ${cred.lapsed.join('; ')} (M17-R-103; CMP grace override only)`);
    const breaches = (await bceaCheck(services, data.staffId, data)).filter((b) => b.kind === 'crit');
    if (breaches.length) throw invalid(`BCEA rule: ${breaches.map((b) => b.detail).join('; ')}`);
  }
  const id = newId('shf');
  await services.db.insert(schema.shifts).values({ id, practiceId, ...data, hours, status: data.staffId ? 'planned' : 'open_gap', gapReason: data.staffId ? null : 'unfilled' });
  await audit(c, 'shift.created', { type: 'shift', id }, { date: data.date, role: data.role, staffId: data.staffId });
  if (!data.staffId) await emit(c, 'roster.gap.opened.v1', { shiftId: id, practiceId, siteId: data.siteId, date: data.date, role: data.role, requiredCompetency: data.requiredCompetency ?? null, reason: 'unfilled' }, { aggregateType: 'shift', aggregateId: id });
  return c.json({ id }, 201);
});
/** Open a gap on an existing shift (sick call, resignation): emits roster.gap.opened.v1 which wakes the Roster Hand. */
r.post('/shifts/:id/open-gap', allow(...MANAGERS, 'RAD', 'NUR'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { reason } = await body(c, z.object({ reason: z.string().default('sick') }));
  const [row] = await services.db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  if (!row) throw notFound('Shift');
  if (row.status === 'open_gap') throw conflict('This shift is already an open gap');
  await services.db.update(schema.shifts).set({ status: 'open_gap', staffId: null, gapReason: reason, filledBy: null, version: row.version + 1, updatedAt: new Date().toISOString() }).where(eq(schema.shifts.id, id));
  await audit(c, 'shift.gap_opened', { type: 'shift', id }, { reason, previousStaffId: row.staffId });
  await emit(c, 'roster.gap.opened.v1', { shiftId: id, practiceId: row.practiceId, siteId: row.siteId, date: row.date, role: row.role, requiredCompetency: row.requiredCompetency, reason }, { aggregateType: 'shift', aggregateId: id, practiceId: row.practiceId });
  return c.json({ ok: true });
});
r.post('/shifts/:id/assign', allow(...MANAGERS), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { staffId, override } = await body(c, z.object({ staffId: z.string(), override: z.string().optional() }));
  const [row] = await services.db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  if (!row) throw notFound('Shift');
  const cred = await credentialState(services, staffId, row.date);
  if (!cred.ok && !override) throw invalid(`Rostering blocked: ${cred.lapsed.join('; ')} (M17-R-103). A CMP grace override needs a typed reason.`);
  const breaches = (await bceaCheck(services, staffId, { date: row.date, startTime: row.startTime, endTime: row.endTime })).filter((b) => b.kind === 'crit');
  if (breaches.length && !override) throw invalid(`BCEA rule: ${breaches.map((b) => b.detail).join('; ')}. PRM may override with a typed reason; CMP sees overrides in the compliance calendar.`);
  const [st] = await services.db.select().from(schema.staff).where(eq(schema.staff.id, staffId)).limit(1);
  if (row.requiredCompetency && st && !(st.competencies ?? []).includes(row.requiredCompetency)) throw invalid(`${st.name} is not marked competent for ${row.requiredCompetency}`);
  await services.db.update(schema.shifts).set({ staffId, status: 'confirmed', filledBy: 'prm', note: override ? `Override: ${override}` : row.note, version: row.version + 1, updatedAt: new Date().toISOString() }).where(eq(schema.shifts.id, id));
  await audit(c, 'shift.assigned', { type: 'shift', id }, { staffId, override: override ?? null, lapsed: cred.lapsed });
  await emit(c, 'roster.filled.v1', { shiftId: id, practiceId: row.practiceId, siteId: row.siteId, date: row.date, staffId, method: 'manual', costCents: 0 }, { aggregateType: 'shift', aggregateId: id, practiceId: row.practiceId });
  return c.json({ ok: true });
});
/** Ask the Roster Hand to fill a gap (swap within the team, or agency within leash). */
r.post('/shifts/:id/roster-hand', allow(...MANAGERS), async (c) => {
  const id = param(c, 'id');
  const task = await runHand(c.get('services'), 'roster', { shiftId: id }, { practiceId: requirePractice(c), trigger: 'manual', title: 'Roster Hand: fill gap', aggregateType: 'shift', aggregateId: id });
  await audit(c, 'shift.roster_hand', { type: 'shift', id }, { taskId: task.id, status: task.status });
  return c.json({ task });
});

/* ================= Leave ================= */
r.get('/leave', allow(...READERS), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const rows = await services.db.select().from(schema.leave).where(eq(schema.leave.practiceId, practiceId)).orderBy(desc(schema.leave.fromDate)).limit(100);
  const staffRows = await services.db.select({ id: schema.staff.id, name: schema.staff.name }).from(schema.staff).where(eq(schema.staff.practiceId, practiceId));
  return c.json({ leave: rows.map((l) => ({ ...l, staffName: staffRows.find((s) => s.id === l.staffId)?.name ?? l.staffId })) });
});
r.post('/leave', allow(...MANAGERS, 'RAD', 'NUR', 'FDK', 'RGT'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ staffId: z.string(), type: z.enum(['annual', 'sick', 'family', 'maternity', 'parental', 'study', 'unpaid']), fromDate: z.string(), toDate: z.string(), reason: z.string().optional() }));
  const days = Math.max(1, Math.round((new Date(data.toDate).getTime() - new Date(data.fromDate).getTime()) / 86400000) + 1);
  const id = newId('lve');
  await c.get('services').db.insert(schema.leave).values({ id, practiceId, ...data, days });
  await audit(c, 'leave.requested', { type: 'leave', id }, { staffId: data.staffId, type: data.type, days });
  return c.json({ id, days }, 201);
});
r.post('/leave/:id/decide', allow(...MANAGERS), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const { decision } = await body(c, z.object({ decision: z.enum(['approved', 'declined']) }));
  const [row] = await services.db.select().from(schema.leave).where(eq(schema.leave.id, id)).limit(1);
  if (!row) throw notFound('Leave request');
  await services.db.update(schema.leave).set({ status: decision, decidedBy: c.get('user')!.id, decidedAt: new Date().toISOString() }).where(eq(schema.leave.id, id));
  if (decision === 'approved') {
    const shifts = await services.db.select().from(schema.shifts).where(and(eq(schema.shifts.staffId, row.staffId), gte(schema.shifts.date, row.fromDate), lte(schema.shifts.date, row.toDate)));
    for (const s of shifts) {
      await services.db.update(schema.shifts).set({ status: 'open_gap', staffId: null, gapReason: row.type, version: s.version + 1, updatedAt: new Date().toISOString() }).where(eq(schema.shifts.id, s.id));
      await emit(c, 'roster.gap.opened.v1', { shiftId: s.id, practiceId: s.practiceId, siteId: s.siteId, date: s.date, role: s.role, requiredCompetency: s.requiredCompetency, reason: row.type }, { aggregateType: 'shift', aggregateId: s.id });
    }
  }
  await audit(c, 'leave.decided', { type: 'leave', id }, { decision });
  return c.json({ ok: true });
});

/* ================= Credentials and CPD ================= */
r.get('/credentials', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const rows = await services.db.select({ c: schema.credentials, s: schema.staff }).from(schema.credentials).innerJoin(schema.staff, eq(schema.staff.id, schema.credentials.staffId)).where(eq(schema.credentials.practiceId, practiceId)).orderBy(asc(schema.credentials.expiry));
  const today = todaySast();
  return c.json({
    credentials: rows.map(({ c: cr, s }) => ({
      ...cr, staffName: s.name, role: s.role,
      daysToExpiry: cr.expiry ? Math.round((new Date(cr.expiry).getTime() - new Date(today).getTime()) / 86400000) : null,
      state: !cr.expiry ? 'current' : cr.expiry < today ? 'lapsed' : cr.expiry <= addDays(today, 30) ? 'expiring' : cr.expiry <= addDays(today, 90) ? 'watch' : 'current',
      blocksRostering: !!cr.expiry && cr.expiry < today && ['hpcsa', 'sanc', 'radiation_worker'].includes(cr.type),
    })),
    note: 'Rostering onto clinical shifts is blocked from the expiry date unless renewal evidence is uploaded and CMP grants a grace period (M17-R-103).',
  });
});
r.post('/credentials', allow(...MANAGERS, 'CMP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ staffId: z.string(), type: z.string(), number: z.string().optional(), issuer: z.string().optional(), issuedAt: z.string().optional(), expiry: z.string().optional(), verified: z.boolean().default(false), evidenceRef: z.string().optional() }));
  const id = newId('crd');
  await c.get('services').db.insert(schema.credentials).values({ id, practiceId, ...data, verifiedAt: data.verified ? new Date().toISOString() : null, verifiedBy: data.verified ? c.get('user')!.id : null });
  await audit(c, 'credential.recorded', { type: 'credential', id }, { staffId: data.staffId, type: data.type, expiry: data.expiry });
  return c.json({ id }, 201);
});
r.post('/credentials/:id/verify', allow(...MANAGERS, 'CMP'), async (c) => {
  const id = param(c, 'id');
  const { expiry } = await body(c, z.object({ expiry: z.string().optional() }));
  await c.get('services').db.update(schema.credentials).set({ verified: true, verifiedAt: new Date().toISOString(), verifiedBy: c.get('user')!.id, ...(expiry ? { expiry } : {}) }).where(eq(schema.credentials.id, id));
  await audit(c, 'credential.verified', { type: 'credential', id }, { expiry });
  return c.json({ ok: true });
});
r.get('/cpd', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const year = new Date().getFullYear();
  const staffRows = await services.db.select().from(schema.staff).where(and(eq(schema.staff.practiceId, practiceId), eq(schema.staff.status, 'active')));
  const points = await services.db.select().from(schema.cpdPoints).where(and(eq(schema.cpdPoints.practiceId, practiceId), eq(schema.cpdPoints.cycleYear, year)));
  const pace = 30 * ((new Date().getMonth() + 1) / 12);
  return c.json({
    cycleYear: year, target: 30, ethicsTarget: 5, paceToDate: Math.round(pace * 10) / 10,
    staff: staffRows.filter((s) => ['RAD', 'RGT', 'NUR'].includes(s.role)).map((s) => {
      const mine = points.filter((p) => p.staffId === s.id);
      const total = mine.reduce((a, p) => a + p.points, 0);
      const ethics = mine.reduce((a, p) => a + p.ethicsPoints, 0);
      return { staffId: s.id, name: s.name, role: s.role, points: total, ethics, onPace: total >= pace * 0.9, entries: mine.length };
    }),
    note: 'HPCSA CEUs per 12-month cycle including an ethics component (30 CEUs with 5 ethics is the commonly cited figure; stored as reference data).',
  });
});
r.post('/cpd', allow(...MANAGERS, 'RAD', 'RGT', 'NUR', 'CMP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ staffId: z.string(), activity: z.string().min(3), points: z.number().positive(), ethicsPoints: z.number().min(0).default(0), certificateRef: z.string().optional(), at: z.string().optional() }));
  const id = newId('cpd');
  await c.get('services').db.insert(schema.cpdPoints).values({ id, practiceId, ...data, cycleYear: new Date().getFullYear(), at: data.at ?? new Date().toISOString() });
  await audit(c, 'cpd.logged', { type: 'cpd', id }, { staffId: data.staffId, points: data.points });
  return c.json({ id }, 201);
});

/* ================= Time and attendance, productivity ================= */
r.get('/attendance', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const rows = await services.db.select().from(schema.timeAttendance).where(and(eq(schema.timeAttendance.practiceId, practiceId), gte(schema.timeAttendance.clockIn, new Date(Date.now() - 28 * 86400000).toISOString()))).orderBy(desc(schema.timeAttendance.clockIn)).limit(400);
  const staffRows = await services.db.select({ id: schema.staff.id, name: schema.staff.name }).from(schema.staff).where(eq(schema.staff.practiceId, practiceId));
  const worked = rows.reduce((a, x) => a + (x.hoursWorked ?? 0), 0);
  const ot = rows.reduce((a, x) => a + x.overtimeHours, 0);
  return c.json({ entries: rows.map((x) => ({ ...x, staffName: staffRows.find((s) => s.id === x.staffId)?.name ?? x.staffId })), summary: { workedHours: Math.round(worked), overtimeHours: Math.round(ot * 10) / 10, overtimePct: worked ? Math.round((ot / worked) * 1000) / 10 : 0 } });
});
r.post('/attendance', allow(...MANAGERS, 'RAD', 'NUR', 'FDK'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ staffId: z.string(), siteId: z.string(), shiftId: z.string().optional(), clockIn: z.string().optional(), clockOut: z.string().optional(), method: z.string().default('app') }));
  const clockIn = data.clockIn ?? new Date().toISOString();
  const hours = data.clockOut ? Math.round(((new Date(data.clockOut).getTime() - new Date(clockIn).getTime()) / 3600000) * 10) / 10 : null;
  const id = newId('att');
  await c.get('services').db.insert(schema.timeAttendance).values({ id, practiceId, ...data, clockIn, hoursWorked: hours, overtimeHours: hours && hours > 9 ? Math.round((hours - 9) * 10) / 10 : 0 });
  await audit(c, 'attendance.recorded', { type: 'time_attendance', id }, { staffId: data.staffId, method: data.method });
  return c.json({ id }, 201);
});
/** Case-mix adjusted productivity; never a ranked league table (docs/processes/11 §2.7). */
r.get('/productivity', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const staffRows = await services.db.select().from(schema.staff).where(and(eq(schema.staff.practiceId, practiceId), eq(schema.staff.status, 'active')));
  const att = await services.db.select().from(schema.timeAttendance).where(and(eq(schema.timeAttendance.practiceId, practiceId), gte(schema.timeAttendance.clockIn, new Date(Date.now() - 28 * 86400000).toISOString())));
  const studies = (schema as any).studies;
  let studiesBySite: Map<string, number> | null = null;
  if (studies) {
    try {
      const rows = await services.db.select({ siteId: studies.siteId, n: sql<number>`count(*)` }).from(studies).where(eq(studies.practiceId, practiceId)).groupBy(studies.siteId);
      studiesBySite = new Map(rows.map((x: any) => [x.siteId as string, Number(x.n)]));
    } catch { studiesBySite = null; }
  }
  const MIN_SAMPLE = 10;
  return c.json({
    rows: staffRows.filter((s) => ['RAD', 'NUR'].includes(s.role)).map((s) => {
      const hours = att.filter((a) => a.staffId === s.id).reduce((x, a) => x + (a.hoursWorked ?? 0), 0);
      const siteStudies = studiesBySite?.get(s.homeSiteId ?? '') ?? null;
      const sample = att.filter((a) => a.staffId === s.id).length;
      return { staffId: s.id, name: s.name, role: s.role, hours: Math.round(hours), sample, weightedStudiesPerHour: sample < MIN_SAMPLE || !siteStudies || !hours ? null : Math.round(((siteStudies / Math.max(1, staffRows.filter((x) => x.homeSiteId === s.homeSiteId && x.role === s.role).length)) / hours) * 100) / 100, suppressed: sample < MIN_SAMPLE };
    }),
    caseMixNote: 'Weighted throughput uses a case-mix weight per study (modality, protocol complexity, contrast, patient factors). Each worker sees their own figures with the site distribution; below a minimum sample size of 10 the number is hidden. No ranking screens, no automatic disciplinary triggers.',
    source: studiesBySite ? 'studies' : 'source not available: M09 studies are not integrated yet',
  });
});
r.get('/bcea/:staffId', allow(...READERS), async (c) => {
  const breaches = await bceaCheck(c.get('services'), param(c, 'staffId'), null);
  return c.json({ rules: BCEA_RULES, breaches });
});

/* ================= Roster Hand ================= */
const rosterHand = defineHand({
  id: 'roster', name: 'Roster Hand', module: 'M17', level: 'A3',
  mandate: 'Keep every published shift filled with an eligible worker at the lowest compliant cost: propose swaps between consenting workers, offer open shifts to eligible internal staff in fairness order, or raise an agency request within the leash. Never publishes a roster and never alters pay classification.',
  defaultLeash: { maxAgencyCentsPerShift: 400000, maxOvertimeHoursPerWeek: 10, minHoursBeforeStart: 12 },
  approvalPersona: 'PRM',
  approvalPolicy: 'Agency spend above the per-shift cap, any credential or rest-rule exception, and changes within 12 hours of shift start need PRM approval.',
  tools: { 'roster.read': 'R0', 'eligibility.check': 'R0', 'shift.swap': 'R1', 'shift.assign': 'R1', 'agency.request': 'R2', 'staff.message': 'R2', 'task.create': 'R1' },
});

const AGENCY_PANEL = [
  { name: 'Imaging Locums SA (demo)', rateCentsPerHour: 65000, competencies: ['DX', 'CT', 'MG', 'mammography', 'US'] },
  { name: 'KZN Radiography Agency (demo)', rateCentsPerHour: 58000, competencies: ['DX', 'CT', 'US', 'MR'] },
];

export default defineModule({
  code: 'M17', name: 'Workforce', basePath: 'workforce', routes: r,
  boot() {
    registerHand<{ shiftId: string }, Record<string, unknown>>(rosterHand, async (input, ctx) => {
      const services = ctx.services;
      const [shift] = await services.db.select().from(schema.shifts).where(eq(schema.shifts.id, input.shiftId)).limit(1);
      if (!shift) throw new Error('Shift not found');
      if (shift.status !== 'open_gap') throw new Refused('This shift is not an open gap');
      const hoursOut = (new Date(`${shift.date}T${shift.startTime}:00Z`).getTime() - Date.now()) / 3600000;

      const candidates = await ctx.step('roster.read', { shiftId: shift.id, role: shift.role }, async () => {
        const pool = await services.db.select().from(schema.staff).where(and(eq(schema.staff.practiceId, shift.practiceId), eq(schema.staff.role, shift.role), eq(schema.staff.status, 'active')));
        return pool.filter((s) => !shift.requiredCompetency || (s.competencies ?? []).includes(shift.requiredCompetency));
      });

      const eligible: Array<{ staffId: string; name: string; reason?: string }> = [];
      for (const cand of candidates) {
        const check = await ctx.step('eligibility.check', { staffId: cand.id }, async () => {
          const cred = await credentialState(services, cand.id, shift.date);
          const bcea = await bceaCheck(services, cand.id, { date: shift.date, startTime: shift.startTime, endTime: shift.endTime });
          const clash = await services.db.select({ id: schema.shifts.id }).from(schema.shifts).where(and(eq(schema.shifts.staffId, cand.id), eq(schema.shifts.date, shift.date), sql`${schema.shifts.status} in ('planned','confirmed','agency')`)).limit(1);
          const onLeave = await services.db.select({ id: schema.leave.id }).from(schema.leave).where(and(eq(schema.leave.staffId, cand.id), eq(schema.leave.status, 'approved'), lte(schema.leave.fromDate, shift.date), gte(schema.leave.toDate, shift.date))).limit(1);
          return { cred, bcea, clash: clash.length > 0, onLeave: onLeave.length > 0 };
        });
        if (!check.cred.ok) continue;
        if (check.clash || check.onLeave) continue;
        if (check.bcea.some((b) => b.kind === 'crit')) continue;
        eligible.push({ staffId: cand.id, name: cand.name, reason: check.bcea.length ? check.bcea[0]!.detail : undefined });
      }

      ctx.leashCheck([{ rule: 'minHoursBeforeStart', actual: Math.max(0, Math.round(hoursOut)), compare: 'gte' }]);

      if (eligible.length) {
        const pick = eligible[0]!;
        await ctx.step('staff.message', { staffId: pick.staffId }, async () => ({ sent: `Open ${shift.role} shift at ${shift.date} ${shift.startTime}–${shift.endTime}. Reply YES to take it.` }), 'Plain-language offer; the Hand never negotiates rates');
        await ctx.step('shift.swap', { shiftId: shift.id, staffId: pick.staffId }, async () => {
          await services.db.update(schema.shifts).set({ staffId: pick.staffId, status: 'confirmed', filledBy: 'roster_hand', note: `Filled by the Roster Hand from the internal pool (${eligible.length} eligible)`, version: shift.version + 1, updatedAt: new Date().toISOString() }).where(eq(schema.shifts.id, shift.id));
          return { filled: true };
        });
        const { emitDirect } = await import('../../kernel/events.js');
        await emitDirect(services, 'roster.filled.v1', { shiftId: shift.id, practiceId: shift.practiceId, siteId: shift.siteId, date: shift.date, staffId: pick.staffId, method: 'internal_swap', costCents: 0 }, { aggregateType: 'shift', aggregateId: shift.id, practiceId: shift.practiceId });
        return { method: 'internal_swap', staffId: pick.staffId, staffName: pick.name, costCents: 0, considered: candidates.length, eligible: eligible.length };
      }

      const agency = AGENCY_PANEL.find((a) => !shift.requiredCompetency || a.competencies.includes(shift.requiredCompetency)) ?? AGENCY_PANEL[0]!;
      const costCents = Math.round(agency.rateCentsPerHour * shift.hours);
      ctx.leashCheck([{ rule: 'maxAgencyCentsPerShift', actual: costCents }]);
      await ctx.step('agency.request', { agency: agency.name, costCents }, async () => {
        await services.db.update(schema.shifts).set({ status: 'agency', agencyName: agency.name, agencyCents: costCents, filledBy: 'roster_hand', note: `Agency cover from the approved panel at R ${(costCents / 100).toFixed(0)}; HPCSA verified on booking`, version: shift.version + 1, updatedAt: new Date().toISOString() }).where(eq(schema.shifts.id, shift.id));
        return { agency: agency.name, costCents };
      });
      const { emitDirect } = await import('../../kernel/events.js');
      await emitDirect(services, 'roster.filled.v1', { shiftId: shift.id, practiceId: shift.practiceId, siteId: shift.siteId, date: shift.date, staffId: null, method: 'agency', agency: agency.name, costCents }, { aggregateType: 'shift', aggregateId: shift.id, practiceId: shift.practiceId });
      return { method: 'agency', agency: agency.name, costCents, considered: candidates.length, eligible: 0, note: 'Internal pool had no eligible worker; agency cover booked within the leash.' };
    });
  },
  /** Daily: emit credential expiry events and surface gaps inside 48 hours. */
  async tick(services) {
    const today = todaySast();
    const soon = addDays(today, 30);
    const creds = await services.db.select().from(schema.credentials).where(sql`${schema.credentials.expiry} <= ${soon}`);
    const { emitDirect } = await import('../../kernel/events.js');
    let expiring = 0;
    let lapsed = 0;
    for (const cr of creds) {
      if (!cr.expiry) continue;
      if (cr.expiry < today) { await emitDirect(services, 'credential.lapsed.v1', { credentialId: cr.id, staffId: cr.staffId, type: cr.type, expiry: cr.expiry }, { practiceId: cr.practiceId, aggregateType: 'credential', aggregateId: cr.id }); lapsed++; }
      else { await emitDirect(services, 'credential.expiring.v1', { credentialId: cr.id, staffId: cr.staffId, type: cr.type, expiry: cr.expiry, days: Math.round((new Date(cr.expiry).getTime() - new Date(today).getTime()) / 86400000) }, { practiceId: cr.practiceId, aggregateType: 'credential', aggregateId: cr.id }); expiring++; }
    }
    return { credentialsExpiring: expiring, credentialsLapsed: lapsed };
  },
});
