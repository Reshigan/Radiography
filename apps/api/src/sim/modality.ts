import { z } from 'zod';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { notFound, invalid, todaySast } from '@bonakala/domain';
import { findProcedure, proceduresForRoomType, hashString } from '@bonakala/domain/bci';
import { Hono } from 'hono';
import type { AppEnv } from '../kernel/context.js';
import { body, requireUser } from '../kernel/index.js';
import { emitDirect } from '../kernel/events.js';
import type { Services } from '../kernel/ports.js';
import { registerSim } from './index.js';
import { createStudy } from '../modules/m09-imaging/service.js';
import { runEdgeQc } from '../modules/m11-bci/service.js';
import { completeAcquisition } from '../modules/m08-acquisition/service.js';

/**
 * Modality simulator: stands in for a DICOM modality sending C-STORE to the Edge Gateway.
 * POST /api/sim/modality/send   creates a study (series, instances, synthetic images), runs Edge QC,
 *                               emits study.received.v1 and, unless autoComplete=false, completes MPPS
 *                               (study.completed.v1 → dose, BCI inference, reading worklist).
 * POST /api/sim/modality/run-day generates studies for today's booked worklist items at a site.
 */
export async function simulateSend(services: Services, input: { siteId: string; roomId?: string; roomKey?: string; procedureCode: string; patientId: string; worklistItemId?: string | null; priority?: string; laterality?: string | null; indication?: string | null; referrerId?: string | null; orderId?: string | null; appointmentId?: string | null; technologistUserId?: string | null; autoComplete?: boolean; unmatched?: boolean; receivedAt?: string }) {
  const db = services.db;
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, input.siteId)).limit(1);
  if (!site) throw notFound('Site');
  const proc = findProcedure(input.procedureCode);
  if (!proc) throw invalid(`Unknown procedure code ${input.procedureCode}`);
  let roomId = input.roomId ?? null;
  if (!roomId && input.roomKey) {
    const [rm] = await db.select().from(schema.rooms).where(and(eq(schema.rooms.siteId, site.id), eq(schema.rooms.name, input.roomKey.split('-').pop()!))).limit(1);
    roomId = rm?.id ?? null;
  }
  if (!roomId) {
    const [rm] = await db.select().from(schema.rooms).where(and(eq(schema.rooms.siteId, site.id), eq(schema.rooms.roomType, proc.roomType))).limit(1);
    roomId = rm?.id ?? null;
  }
  if (!roomId) throw invalid(`Site ${site.code} has no ${proc.roomType} room`);
  const [mod] = await db.select().from(schema.modalities).where(eq(schema.modalities.roomId, roomId)).limit(1);
  if (mod && mod.status === 'down') throw invalid(`Modality ${mod.aeTitle} is down; re-route the study`);
  const item = input.worklistItemId ? (await db.select().from(schema.worklistItems).where(eq(schema.worklistItems.id, input.worklistItemId)).limit(1))[0] : undefined;
  const receivedAt = input.receivedAt ?? services.clock.now().toISOString();
  const { study, series, instances } = await createStudy(services, {
    practiceId: site.practiceId, siteId: site.id, roomId, patientId: input.patientId, procedureCode: proc.code, laterality: input.laterality ?? item?.laterality ?? (proc.laterality ? (hashString(input.patientId) % 2 ? 'L' : 'R') : null),
    indication: input.indication ?? item?.indication ?? null, priority: input.priority ?? item?.priority ?? 'routine', orderId: input.orderId ?? item?.orderId ?? null, appointmentId: input.appointmentId ?? item?.appointmentId ?? null, worklistItemId: item?.id ?? null,
    referrerId: input.referrerId ?? item?.referrerId ?? null, technologistUserId: input.technologistUserId ?? item?.technologistUserId ?? null, receivedAt, unmatched: input.unmatched ?? false,
  });
  if (item) await db.update(schema.worklistItems).set({ studyId: study.id, accession: study.accession, status: item.status === 'completed' ? 'completed' : 'in_progress', startedAt: item.startedAt ?? receivedAt, updatedAt: receivedAt }).where(eq(schema.worklistItems.id, item.id));
  await emitDirect(services, 'study.received.v1', { studyId: study.id, accession: study.accession, patientId: study.patientId, practiceId: study.practiceId, siteId: study.siteId, roomId, modality: study.modality, procedureCode: study.procedureCode, orderId: study.orderId, appointmentId: study.appointmentId, seriesCount: series.length, instanceCount: study.instanceCount, unmatched: study.unmatched }, { aggregateType: 'study', aggregateId: study.id, practiceId: study.practiceId });
  const qc = await runEdgeQc(services, study);
  let completion: Awaited<ReturnType<typeof completeAcquisition>> | null = null;
  if (input.autoComplete !== false && !input.unmatched) completion = await completeAcquisition(services, { studyId: study.id, worklistItemId: item?.id ?? null, technologistUserId: input.technologistUserId ?? item?.technologistUserId ?? null, at: receivedAt, overrideIncomplete: 'simulator' });
  return { study, series, instances, qc: qc?.result ?? null, completion };
}

export function registerModalitySim() {
  const sim = new Hono<AppEnv>();
  sim.post('/send', async (c) => {
    requireUser(c);
    const data = await body(c, z.object({ siteId: z.string(), roomId: z.string().optional(), roomKey: z.string().optional(), procedureCode: z.string(), patientId: z.string(), worklistItemId: z.string().optional(), priority: z.enum(['routine', 'urgent', 'stat']).optional(), laterality: z.enum(['L', 'R', 'B']).optional(), indication: z.string().optional(), autoComplete: z.boolean().optional(), unmatched: z.boolean().optional() }));
    const user = c.get('user')!;
    const res = await simulateSend(c.get('services'), { ...data, technologistUserId: user.persona === 'RAD' ? user.id : null });
    return c.json({ studyId: res.study.id, accession: res.study.accession, seriesCount: res.series.length, instanceCount: res.instances.length, qc: res.qc, completed: !!res.completion?.ok, dose: res.completion?.ok ? res.completion.dose : null }, 201);
  });
  /** Generate today's studies for booked worklist items (status scheduled/arrived) at a site. */
  sim.post('/run-day', async (c) => {
    requireUser(c);
    const { siteId, date, limit } = await body(c, z.object({ siteId: z.string(), date: z.string().optional(), limit: z.number().min(1).max(100).default(50) }));
    const services = c.get('services');
    const day = date ?? todaySast();
    const start = new Date(`${day}T00:00:00+02:00`).toISOString();
    const end = new Date(`${day}T23:59:59.999+02:00`).toISOString();
    const items = await services.db.select().from(schema.worklistItems).where(and(eq(schema.worklistItems.siteId, siteId), gte(schema.worklistItems.scheduledAt, start), lt(schema.worklistItems.scheduledAt, end), inArray(schema.worklistItems.status, ['scheduled', 'arrived', 'in_room', 'in_progress']))).orderBy(schema.worklistItems.scheduledAt).limit(limit);
    const out: Array<{ worklistItemId: string; studyId: string; accession: string }> = [];
    for (const it of items) {
      if (it.studyId) continue;
      const res = await simulateSend(services, { siteId, roomId: it.roomId, procedureCode: it.procedureCode, patientId: it.patientId, worklistItemId: it.id, autoComplete: true });
      out.push({ worklistItemId: it.id, studyId: res.study.id, accession: res.study.accession });
    }
    return c.json({ date: day, generated: out.length, studies: out });
  });
  sim.get('/procedures', (c) => c.json({ procedures: proceduresForRoomType(c.req.query('roomType') ?? 'XR') }));
  registerSim('modality', sim);
}
