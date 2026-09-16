import { z } from 'zod';
import { and, desc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound } from '@bonakala/domain';
import { doseUnit, runDoseOutlier, findProcedure } from '@bonakala/domain/bci';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on, emitDirect } from '../../kernel/index.js';

const r = router();
const VIEW = ['RAD', 'RGT', 'NUR', 'PRM', 'CMP', 'BIO', 'EXE', 'SUP', 'AIO'] as const;

/** DRL reference data ('drl' kind), effective-dated, CMP-edited only. */
export async function drlFor(services: { db: typeof schema extends never ? never : any }, practiceId: string, protocolCode: string, sizeClass: string) {
  const rows = await services.db.select().from(schema.referenceData).where(and(eq(schema.referenceData.kind, 'drl'), eq(schema.referenceData.key, protocolCode), or(isNull(schema.referenceData.practiceId), eq(schema.referenceData.practiceId, practiceId)))).orderBy(desc(schema.referenceData.version));
  const practice = rows.find((x: any) => x.practiceId === practiceId);
  const national = rows.find((x: any) => x.practiceId === null);
  const row = practice ?? national;
  if (!row) return null;
  const v = row.value as { quantity: string; value: number; paediatric?: number; large?: number; source?: string };
  const value = sizeClass === 'paediatric' && v.paediatric ? v.paediatric : sizeClass === 'large' && v.large ? v.large : v.value;
  return { quantity: v.quantity, value, source: (practice ? 'practice' : v.source ?? 'national') as string };
}

/* ---------- Dose records ---------- */
r.get('/', allow(...VIEW), async (c) => {
  const practiceId = requirePractice(c);
  const q = query(c, z.object({ siteId: z.string().optional(), roomId: z.string().optional(), modality: z.string().optional(), from: z.string().optional(), to: z.string().optional(), outliers: z.string().optional(), patientId: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(200) }));
  const db = c.get('services').db;
  const rows = await db.select().from(schema.doseRecords).where(and(eq(schema.doseRecords.practiceId, practiceId), q.siteId ? eq(schema.doseRecords.siteId, q.siteId) : undefined, q.roomId ? eq(schema.doseRecords.roomId, q.roomId) : undefined, q.modality ? eq(schema.doseRecords.modality, q.modality) : undefined, q.patientId ? eq(schema.doseRecords.patientId, q.patientId) : undefined, q.from ? gte(schema.doseRecords.createdAt, q.from) : undefined, q.to ? lt(schema.doseRecords.createdAt, q.to) : undefined, q.outliers === 'true' ? eq(schema.doseRecords.outlier, true) : undefined)).orderBy(desc(schema.doseRecords.createdAt)).limit(q.limit);
  const byProtocol: Record<string, { n: number; sum: number; above: number; quantity: string; drl: number | null }> = {};
  for (const x of rows) {
    const k = x.protocolCode;
    byProtocol[k] ??= { n: 0, sum: 0, above: 0, quantity: x.quantity, drl: x.drlValueX1000 ? x.drlValueX1000 / 1000 : null };
    byProtocol[k].n++;
    byProtocol[k].sum += x.valueX1000 / 1000;
    if (x.outlier) byProtocol[k].above++;
  }
  return c.json({
    records: rows.map(present),
    summary: Object.entries(byProtocol).map(([code, v]) => ({ protocolCode: code, n: v.n, mean: Math.round((v.sum / v.n) * 100) / 100, above: v.above, abovePct: Math.round((v.above / v.n) * 1000) / 10, quantity: v.quantity, unit: doseUnit(v.quantity as any), drl: v.drl })).sort((a, b) => b.n - a.n),
    outliers: rows.filter((x) => x.outlier).length,
  });
});

function present(x: typeof schema.doseRecords.$inferSelect) {
  return { ...x, value: x.valueX1000 / 1000, ctdiVol: x.ctdiVolX1000 ? x.ctdiVolX1000 / 1000 : null, effectiveMsv: x.effectiveMsvX1000 ? x.effectiveMsvX1000 / 1000 : null, drlValue: x.drlValueX1000 ? x.drlValueX1000 / 1000 : null, unit: doseUnit(x.quantity as any) };
}

r.get('/study/:studyId', allow(...VIEW), async (c) => {
  const db = c.get('services').db;
  const studyId = param(c, 'studyId');
  const rows = await db.select().from(schema.doseRecords).where(eq(schema.doseRecords.studyId, studyId)).orderBy(desc(schema.doseRecords.version));
  const current = rows[0];
  if (!current) return c.json({ dose: null, versions: [], patientCumulative: null });
  const all = await db.select().from(schema.doseRecords).where(eq(schema.doseRecords.patientId, current.patientId));
  const twelveMonths = new Date(Date.now() - 365 * 86400_000).toISOString();
  const recent = all.filter((x) => x.createdAt >= twelveMonths);
  return c.json({ dose: present(current), versions: rows.map(present), patientCumulative: { studies12m: recent.length, effectiveMsv12m: Math.round(recent.reduce((a, x) => a + (x.effectiveMsvX1000 ?? 0), 0)) / 1000, studiesTotal: all.length } });
});

/** Cumulative dose history per patient in plain language (M10-R-103). */
r.get('/patients/:patientId/cumulative', allow(...VIEW, 'PAT'), async (c) => {
  const user = c.get('user')!;
  const patientId = param(c, 'patientId');
  if (user.persona === 'PAT' && user.patientId !== patientId) return c.json({ error: 'forbidden' }, 403);
  const rows = await c.get('services').db.select().from(schema.doseRecords).where(eq(schema.doseRecords.patientId, patientId)).orderBy(desc(schema.doseRecords.createdAt));
  const total = rows.reduce((a, x) => a + (x.effectiveMsvX1000 ?? 0), 0) / 1000;
  return c.json({ studies: rows.length, effectiveMsvEstimate: Math.round(total * 100) / 100, records: rows.map(present), note: 'Effective dose is an estimate from the recorded quantities and configurable conversion coefficients. Each study was justified by the referring doctor and the radiologist.' });
});

/** Manual dose capture for units with no electronic dose output (flagged `manual`). */
r.post('/records', allow('RAD', 'CMP', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ studyId: z.string(), quantity: z.enum(['DLP', 'DAP', 'AGD']), value: z.number().positive(), ctdiVol: z.number().optional(), sizeClass: z.enum(['paediatric', 'small', 'standard', 'large']).default('standard'), justification: z.string().optional() }));
  const services = c.get('services');
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, data.studyId)).limit(1);
  if (!study) throw notFound('Study');
  const id = await writeDoseRecord(services, { study, quantity: data.quantity, value: data.value, ctdiVol: data.ctdiVol ?? null, effectiveMsv: null, sizeClass: data.sizeClass, source: 'manual', justification: data.justification ?? null, repeats: 0, pregnancyDeclared: null, technologistUserId: c.get('user')!.id, practiceId });
  await audit(c, 'dose.recorded', { type: 'dose_record', id }, { studyId: data.studyId, source: 'manual' });
  return c.json({ id }, 201);
});

/** Corrections create a new immutable version (M10-R-107). */
r.post('/records/:id/correct', allow('CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { value, reason } = await body(c, z.object({ value: z.number().positive(), reason: z.string().min(5) }));
  const services = c.get('services');
  const [old] = await services.db.select().from(schema.doseRecords).where(eq(schema.doseRecords.id, id)).limit(1);
  if (!old) throw notFound('Dose record');
  const newRecId = newId('dose');
  const ratio = old.drlValueX1000 ? Math.round((value * 1000 * 100) / old.drlValueX1000) : null;
  await services.db.insert(schema.doseRecords).values({ ...old, id: newRecId, valueX1000: Math.round(value * 1000), ratioPct: ratio, outlier: ratio !== null && ratio > 100, version: old.version + 1, supersedesId: old.id, justification: reason, createdAt: services.clock.now().toISOString() });
  await audit(c, 'dose.corrected', { type: 'dose_record', id: newRecId }, { supersedes: id, reason, from: old.valueX1000 / 1000, to: value });
  return c.json({ id: newRecId, version: old.version + 1 }, 201);
});

/** RAD or RPO records the justification for an alert; the RPO closes it (A0). */
r.post('/records/:id/justify', allow('RAD', 'RGT', 'CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { justification, close } = await body(c, z.object({ justification: z.string().min(3), close: z.boolean().default(false) }));
  const services = c.get('services');
  const user = c.get('user')!;
  if (close && !['CMP', 'PRM', 'SUP'].includes(user.persona)) return c.json({ error: 'forbidden', message: 'Only the radiation protection officer closes a dose alert' }, 403);
  await services.db.update(schema.doseRecords).set({ justification, justifiedBy: user.id, ...(close ? { reviewedBy: user.id, reviewedAt: services.clock.now().toISOString() } : {}) }).where(eq(schema.doseRecords.id, id));
  await audit(c, close ? 'dose.alert_closed' : 'dose.justified', { type: 'dose_record', id }, { justification });
  return c.json({ ok: true });
});

/* ---------- DRLs ---------- */
r.get('/drl', allow(...VIEW), async (c) => {
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.referenceData).where(and(eq(schema.referenceData.kind, 'drl'), or(isNull(schema.referenceData.practiceId), practiceId ? eq(schema.referenceData.practiceId, practiceId) : undefined))).orderBy(schema.referenceData.key);
  return c.json({ drls: rows.map((x) => ({ id: x.id, protocolCode: x.key, practiceId: x.practiceId, ...(x.value as Record<string, unknown>), effectiveFrom: x.effectiveFrom, version: x.version })), note: 'Diagnostic reference levels are not dose limits: a single exposure above the DRL may be justified. The comparison is a review trigger.' });
});
r.post('/drl', allow('CMP', 'SUP'), async (c) => {
  const practiceId = c.get('practiceId');
  const data = await body(c, z.object({ protocolCode: z.string(), quantity: z.enum(['DLP', 'DAP', 'AGD']), value: z.number().positive(), paediatric: z.number().optional(), large: z.number().optional(), source: z.string().default('practice'), reason: z.string().min(3) }));
  const services = c.get('services');
  const existing = await services.db.select().from(schema.referenceData).where(and(eq(schema.referenceData.kind, 'drl'), eq(schema.referenceData.key, data.protocolCode), practiceId ? eq(schema.referenceData.practiceId, practiceId) : isNull(schema.referenceData.practiceId))).orderBy(desc(schema.referenceData.version)).limit(1);
  const id = newId('ref');
  await services.db.insert(schema.referenceData).values({ id, kind: 'drl', key: data.protocolCode, practiceId: practiceId ?? null, value: { quantity: data.quantity, value: data.value, paediatric: data.paediatric, large: data.large, source: data.source }, effectiveFrom: services.clock.now().toISOString().slice(0, 10), version: (existing[0]?.version ?? 0) + 1 });
  await audit(c, 'drl.updated', { type: 'reference_data', id }, { protocolCode: data.protocolCode, value: data.value, reason: data.reason });
  return c.json({ id }, 201);
});

/* ---------- QA schedule ---------- */
r.get('/qa', allow(...VIEW), async (c) => {
  const practiceId = requirePractice(c);
  const { siteId, roomId, status } = query(c, z.object({ siteId: z.string().optional(), roomId: z.string().optional(), status: z.string().optional() }));
  const services = c.get('services');
  const now = services.clock.now().toISOString();
  const rows = await services.db.select().from(schema.qaTests).where(and(eq(schema.qaTests.practiceId, practiceId), siteId ? eq(schema.qaTests.siteId, siteId) : undefined, roomId ? eq(schema.qaTests.roomId, roomId) : undefined)).orderBy(schema.qaTests.dueAt).limit(400);
  const withState = rows.map((x) => ({ ...x, state: x.doneAt ? (x.result === 'fail' ? 'failed' : 'done') : x.dueAt < now ? 'overdue' : 'due' }));
  // What needs action comes first: failures, overdue (blocking first), then due, then the completed history.
  const rank: Record<string, number> = { failed: 0, overdue: 1, due: 2, done: 3 };
  withState.sort((a, b) => (rank[a.state]! - rank[b.state]!) || (Number(b.blocking) - Number(a.blocking)) || a.dueAt.localeCompare(b.dueAt) * (a.state === 'done' ? -1 : 1));
  const filtered = status ? withState.filter((x) => x.state === status) : withState;
  const rooms = await services.db.select({ id: schema.rooms.id, name: schema.rooms.name, siteId: schema.rooms.siteId, roomType: schema.rooms.roomType, licenceNo: schema.rooms.licenceNo, licenceExpiry: schema.rooms.licenceExpiry }).from(schema.rooms).where(eq(schema.rooms.practiceId, practiceId));
  const sites = await services.db.select({ id: schema.sites.id, code: schema.sites.code, name: schema.sites.name }).from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  return c.json({ tests: filtered, rooms: rooms.map((r) => ({ ...r, siteCode: sites.find((sx) => sx.id === r.siteId)?.code ?? null })), sites, overdue: withState.filter((x) => x.state === 'overdue').length, blocking: withState.filter((x) => x.state === 'overdue' && x.blocking).length });
});

/** Room QA status used by M05 scheduling and M08 start (M02-R-006). */
r.get('/rooms/:id/qa-status', allow(...VIEW, 'FDK', 'BKG'), async (c) => {
  const roomId = param(c, 'id');
  const services = c.get('services');
  const now = services.clock.now().toISOString();
  const [room] = await services.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).limit(1);
  if (!room) throw notFound('Room');
  const overdue = await services.db.select().from(schema.qaTests).where(and(eq(schema.qaTests.roomId, roomId), isNull(schema.qaTests.doneAt), lt(schema.qaTests.dueAt, now)));
  const licenceExpired = !!room.licenceExpiry && room.licenceExpiry < now.slice(0, 10);
  const blockingOverdue = overdue.filter((x) => x.blocking);
  return c.json({ roomId, blocked: blockingOverdue.length > 0 || licenceExpired, reasons: [...blockingOverdue.map((x) => `overdue blocking QA: ${x.testType} (due ${x.dueAt.slice(0, 10)})`), ...(licenceExpired ? [`radiation licence ${room.licenceNo} expired ${room.licenceExpiry}`] : [])], overdue: overdue.length, licence: { no: room.licenceNo, expiry: room.licenceExpiry, expired: licenceExpired } });
});

r.post('/qa/:id/record', allow('RAD', 'BIO', 'CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { result, values, notes } = await body(c, z.object({ result: z.enum(['pass', 'fail']), values: z.record(z.union([z.string(), z.number()])).default({}), notes: z.string().optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [test] = await services.db.select().from(schema.qaTests).where(eq(schema.qaTests.id, id)).limit(1);
  if (!test) throw notFound('QA test');
  const at = services.clock.now().toISOString();
  await services.db.update(schema.qaTests).set({ doneAt: at, result, values, notes: notes ?? null, performedBy: user.id }).where(eq(schema.qaTests.id, id));
  // schedule the next occurrence
  const next = { daily: 1, weekly: 7, monthly: 30, annual: 365, event: 0 }[test.frequency] ?? 0;
  if (next) await services.db.insert(schema.qaTests).values({ id: newId('qa'), practiceId: test.practiceId, siteId: test.siteId, roomId: test.roomId, modalityType: test.modalityType, testType: test.testType, frequency: test.frequency, blocking: test.blocking, dueAt: new Date(new Date(at).getTime() + next * 86400_000).toISOString() });
  await audit(c, 'qa.recorded', { type: 'qa_test', id }, { result, testType: test.testType });
  if (result === 'fail') await emit(c, 'qa.failed.v1', { qaTestId: id, roomId: test.roomId, siteId: test.siteId, testType: test.testType, blocking: test.blocking }, { aggregateType: 'qa_test', aggregateId: id });
  return c.json({ ok: true });
});
r.post('/qa/:id/sign-off', allow('CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const user = c.get('user')!;
  await services.db.update(schema.qaTests).set({ rpoSignedBy: user.id, rpoSignedAt: services.clock.now().toISOString() }).where(eq(schema.qaTests.id, id));
  await audit(c, 'qa.signed_off', { type: 'qa_test', id });
  return c.json({ ok: true });
});

/* ---------- Dosimetry register ---------- */
r.get('/dosimetry', allow('CMP', 'PRM', 'BIO', 'SUP', 'RAD', 'EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const { cycle, siteId } = query(c, z.object({ cycle: z.string().optional(), siteId: z.string().optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const rows = await services.db.select().from(schema.dosimetry).where(and(eq(schema.dosimetry.practiceId, practiceId), cycle ? eq(schema.dosimetry.cycle, cycle) : undefined, siteId ? eq(schema.dosimetry.siteId, siteId) : undefined)).orderBy(desc(schema.dosimetry.cycle), schema.dosimetry.staffName);
  // Results are special personal information: radiographers see only their own.
  const scoped = user.persona === 'RAD' ? rows.filter((x) => x.userId === user.id) : rows;
  await audit(c, 'dosimetry.viewed', undefined, { rows: scoped.length });
  const late = scoped.filter((x) => !x.returnedAt && x.dueBackAt < services.clock.now().toISOString());
  return c.json({ register: scoped, late: late.length, investigations: scoped.filter((x) => (x.resultUsv ?? 0) > x.investigationLevelUsv).length, compliancePct: scoped.length ? Math.round(((scoped.length - late.length) / scoped.length) * 1000) / 10 : 100 });
});
r.post('/dosimetry/:id/result', allow('CMP', 'PRM', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { resultUsv, returnedAt } = await body(c, z.object({ resultUsv: z.number().min(0), returnedAt: z.string().optional() }));
  const services = c.get('services');
  const user = c.get('user')!;
  const [row] = await services.db.select().from(schema.dosimetry).where(eq(schema.dosimetry.id, id)).limit(1);
  if (!row) throw notFound('Dosimetry record');
  const investigation = resultUsv > row.investigationLevelUsv;
  await services.db.update(schema.dosimetry).set({ resultUsv, returnedAt: returnedAt ?? services.clock.now().toISOString(), status: investigation ? 'investigation' : 'resulted', rpoSignedBy: user.id, rpoSignedAt: services.clock.now().toISOString() }).where(eq(schema.dosimetry.id, id));
  await audit(c, 'dosimetry.result', { type: 'dosimetry', id }, { investigation });
  if (investigation) await emit(c, 'dose.alert.v1', { kind: 'dosimetry_investigation', dosimetryId: id, siteId: row.siteId, staffName: row.staffName, resultUsv }, { aggregateType: 'dosimetry', aggregateId: id });
  return c.json({ ok: true, investigation });
});

r.get('/status', (c) => c.json({ module: 'M10', status: 'ok' }));

/** Write an immutable dose record and raise alerts (docs/processes/05 §10.3). */
export async function writeDoseRecord(services: any, input: { study: typeof schema.studies.$inferSelect; quantity: string; value: number; ctdiVol: number | null; effectiveMsv: number | null; sizeClass: string; source: string; justification: string | null; repeats: number; pregnancyDeclared: string | null; technologistUserId: string | null; practiceId: string; protocolId?: string | null; at?: string }) {
  const { study } = input;
  const drl = await drlFor(services, input.practiceId, study.procedureCode, input.sizeClass);
  const proc = findProcedure(study.procedureCode);
  const drlValue = drl?.value ?? proc?.drl ?? null;
  const ratioPct = drlValue ? Math.round((input.value / drlValue) * 100) : null;
  const outlierRun = runDoseOutlier({ accession: study.accession, studyUid: study.studyUid, modality: study.modality, protocolCode: study.procedureCode, value: input.value, drl: drlValue ?? 0, sizeClass: input.sizeClass, repeats: input.repeats });
  const alertLevel = ratioPct === null ? 'none' : ratioPct > 200 ? 'above_threshold' : ratioPct > 100 ? 'above_drl' : 'none';
  const id = newId('dose');
  const at = input.at ?? services.clock.now().toISOString();
  await services.db.insert(schema.doseRecords).values({
    id, practiceId: input.practiceId, siteId: study.siteId, roomId: study.roomId, studyId: study.id, accession: study.accession, patientId: study.patientId, modality: study.modality,
    protocolId: input.protocolId ?? null, protocolCode: study.procedureCode, quantity: input.quantity, valueX1000: Math.round(input.value * 1000), ctdiVolX1000: input.ctdiVol ? Math.round(input.ctdiVol * 1000) : null,
    effectiveMsvX1000: input.effectiveMsv ? Math.round(input.effectiveMsv * 1000) : null, sizeClass: input.sizeClass, drlValueX1000: drlValue ? Math.round(drlValue * 1000) : null, drlSource: drl?.source ?? (proc?.drl ? 'national' : null),
    ratioPct, outlier: outlierRun.outlier, alertLevel, likelyCause: outlierRun.outlier ? outlierRun.cause : null, pregnancyDeclared: input.pregnancyDeclared, justification: input.justification, source: input.source,
    technologistUserId: input.technologistUserId, repeats: input.repeats, createdAt: at,
  });
  if (alertLevel !== 'none') {
    await emitDirect(services, 'dose.alert.v1', { doseRecordId: id, studyId: study.id, accession: study.accession, practiceId: input.practiceId, siteId: study.siteId, roomId: study.roomId, level: alertLevel, ratioPct, protocolCode: study.procedureCode, likelyCause: outlierRun.cause }, { aggregateType: 'dose_record', aggregateId: id, practiceId: input.practiceId });
  }
  return id;
}

export default defineModule({
  code: 'M10', name: 'Dose & Radiation Safety', basePath: 'dose', routes: r,
  boot(services) {
    // Dose capture on completion (A4): RDSR-equivalent values arrive with study.completed.v1.
    on('study.completed.v1', async (evt) => {
      const p = evt.payload as { studyId: string; practiceId: string; protocolId?: string | null; technologistUserId?: string | null; completedAt?: string; doseRecord?: { quantity: string; value: number; ctdiVol: number | null; effectiveMsv: number | null; sizeClass: string; repeats: number; pregnancyDeclared: string | null } | null };
      if (!p.doseRecord) return;
      const existing = await services.db.select({ id: schema.doseRecords.id }).from(schema.doseRecords).where(eq(schema.doseRecords.studyId, p.studyId)).limit(1);
      if (existing.length) return;
      const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, p.studyId)).limit(1);
      if (!study) return;
      await writeDoseRecord(services, { study, quantity: p.doseRecord.quantity, value: p.doseRecord.value, ctdiVol: p.doseRecord.ctdiVol, effectiveMsv: p.doseRecord.effectiveMsv, sizeClass: p.doseRecord.sizeClass, source: 'rdsr', justification: null, repeats: p.doseRecord.repeats, pregnancyDeclared: p.doseRecord.pregnancyDeclared, technologistUserId: p.technologistUserId ?? null, practiceId: p.practiceId, protocolId: p.protocolId ?? null, at: p.completedAt });
    });
  },
  async tick(services) {
    // Mark badge cycles late and QA overdue (reminders are the QC Hand's job in a full build).
    const now = services.clock.now().toISOString();
    const late = await services.db.update(schema.dosimetry).set({ status: 'late' }).where(and(eq(schema.dosimetry.status, 'issued'), lt(schema.dosimetry.dueBackAt, now))).returning({ id: schema.dosimetry.id }).catch(() => [] as Array<{ id: string }>);
    return { dosimetryLate: late.length };
  },
});
