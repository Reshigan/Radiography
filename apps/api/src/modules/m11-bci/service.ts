import { and, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId } from '@bonakala/domain';
import { DEMO_MODELS, getDemoModel, routeModels, runDemoModel, highestPriority, type BciResult, type BciPriority, type DemoModelInput } from '@bonakala/domain/bci';
import type { Services } from '../../kernel/ports.js';
import { emitDirect } from '../../kernel/events.js';
import { ageYears } from '../m09-imaging/service.js';

export type SiteMode = 'activated' | 'shadow' | 'paused' | 'off';

/** Ensure every demo model has a Group registry row (idempotent). */
export async function ensureRegistry(services: Services) {
  const rows = await services.db.select({ id: schema.modelRegistry.id }).from(schema.modelRegistry);
  const have = new Set(rows.map((r) => r.id));
  for (const m of DEMO_MODELS) {
    const id = `${m.id}@${m.version}`;
    if (have.has(id)) continue;
    await services.db.insert(schema.modelRegistry).values({ id, modelId: m.id, practiceId: null, name: m.name, version: m.version, task: m.task, outputClass: m.outputClass, modalities: m.modalities, bodyParts: m.bodyParts ?? null, vendor: m.vendor, samdStatus: m.samdStatus, compute: m.compute, overlaysDefault: m.overlaysDefault, lifecycle: m.id === 'msk-fracture' ? 'shadow' : 'activated', siteStatus: {}, validationSummary: m.validation, limitations: m.limitations, description: m.description, demo: true, bundleDigest: `sha256:${m.id}-${m.version}-demo` });
  }
}

/** Effective mode of a model at a site: practice override → site map → lifecycle. */
export async function modelMode(services: Services, modelId: string, siteId: string, practiceId: string): Promise<{ mode: SiteMode; row: typeof schema.modelRegistry.$inferSelect | null }> {
  const rows = await services.db.select().from(schema.modelRegistry).where(and(eq(schema.modelRegistry.modelId, modelId), or(isNull(schema.modelRegistry.practiceId), eq(schema.modelRegistry.practiceId, practiceId))));
  const row = rows.find((r) => r.practiceId === practiceId) ?? rows.find((r) => r.practiceId === null) ?? null;
  if (!row) return { mode: 'off', row: null };
  const site = row.siteStatus[siteId];
  if (site) return { mode: site, row };
  const lc = row.lifecycle;
  return { mode: lc === 'activated' ? 'activated' : lc === 'shadow' ? 'shadow' : lc === 'paused' ? 'paused' : 'off', row };
}

export async function storeResult(services: Services, study: { id: string; practiceId: string; siteId: string; accession: string }, result: BciResult, mode: SiteMode, at?: string) {
  const id = newId('inf');
  const flagged = result.findings.some((f) => f.flag);
  await services.db.insert(schema.inferenceResults).values({
    id, practiceId: study.practiceId, siteId: study.siteId, studyId: study.id, accession: study.accession, modelId: result.model.id, modelVersion: result.model.version, task: result.task, mode,
    result: result as unknown as Record<string, unknown>, priority: result.triage?.priority ?? null, flagged, positiveCount: result.findings.filter((f) => f.flag).length, latencyMs: result.latency_ms, compute: result.compute, inputHash: result.input_hash, createdAt: at ?? result.created_at,
  });
  return id;
}

export async function demoInput(services: Services, study: typeof schema.studies.$inferSelect): Promise<DemoModelInput> {
  const [pat] = await services.db.select({ dateOfBirth: schema.patients.dateOfBirth, sex: schema.patients.sex }).from(schema.patients).where(eq(schema.patients.id, study.patientId)).limit(1);
  const ser = await services.db.select({ seriesUid: schema.series.seriesUid }).from(schema.series).where(eq(schema.series.studyId, study.id));
  return { studyUid: study.studyUid, accession: study.accession, modality: study.modality, bodyPart: study.bodyPart, procedureCode: study.procedureCode, laterality: study.laterality, ageYears: ageYears(pat?.dateOfBirth, study.receivedAt), sex: pat?.sex ?? null, seriesUids: ser.map((s) => s.seriesUid), instanceCount: study.instanceCount, orderPriority: study.priority, createdAt: services.clock.now().toISOString() };
}

/** Edge QC (docs/22 §8): runs at the gateway within seconds of image arrival; advisory, never blocks. */
export async function runEdgeQc(services: Services, study: typeof schema.studies.$inferSelect) {
  const qcModel = study.modality === 'US' ? 'us-qc' : ['DX', 'CR', 'MG'].includes(study.modality) ? 'cxr-qc' : null;
  if (!qcModel) return null;
  const { mode } = await modelMode(services, qcModel, study.siteId, study.practiceId);
  if (mode === 'paused' || mode === 'off') return null;
  const input = await demoInput(services, study);
  const result = runDemoModel(qcModel, input);
  const id = await storeResult(services, study, result, mode);
  return { id, result };
}

/**
 * Inference orchestration on study.completed.v1: route models by modality and body part, honour the
 * per-site status (activated | shadow | paused | off), store every result immutably and emit
 * bci.result.available.v1 with the study's priority (activated models only; shadow never affects the worklist).
 */
export async function inferStudy(services: Services, studyId: string, opts: { at?: string; emit?: boolean } = {}) {
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, studyId)).limit(1);
  if (!study) return null;
  if (study.unmatched) {
    // M11-R-301: no result may attach before reconciliation
    await services.db.insert(schema.inferenceResults).values({ id: newId('inf'), practiceId: study.practiceId, siteId: study.siteId, studyId: study.id, accession: study.accession, modelId: 'orchestrator', modelVersion: '1', task: 'not_analysed', mode: 'activated', result: { reason: 'unmatched_study_pending_reconciliation' }, compute: 'orchestrator', latencyMs: 0 });
    return { studyId, results: [], priority: null };
  }
  const input = await demoInput(services, study);
  const models = routeModels(study.modality, study.bodyPart).filter((m) => m !== 'cxr-qc' && m !== 'us-qc');
  const stored: Array<{ id: string; modelId: string; version: string; mode: SiteMode; result: BciResult }> = [];
  const prios: Array<BciPriority | undefined> = [];
  const findings: Array<{ code: string; score: number; laterality?: string; modelId: string }> = [];
  for (const modelId of models) {
    const { mode, row } = await modelMode(services, modelId, study.siteId, study.practiceId);
    const def = getDemoModel(modelId)!;
    if (mode === 'paused' || mode === 'off') {
      await services.db.insert(schema.inferenceResults).values({ id: newId('inf'), practiceId: study.practiceId, siteId: study.siteId, studyId: study.id, accession: study.accession, modelId, modelVersion: row?.version ?? def.version, task: 'not_analysed', mode: 'activated', result: { reason: `model ${mode} at site ${study.siteId}` }, compute: 'orchestrator', latencyMs: 0, createdAt: opts.at ?? undefined });
      continue;
    }
    const result = runDemoModel(modelId, { ...input, createdAt: opts.at ?? input.createdAt });
    const id = await storeResult(services, study, result, mode, opts.at);
    stored.push({ id, modelId, version: result.model.version, mode, result });
    if (mode === 'activated') {
      prios.push(result.triage?.priority);
      for (const f of result.findings) if (f.flag) findings.push({ code: f.code, score: f.score, laterality: f.laterality, modelId });
    }
  }
  // Quality-limited studies (P4 from edge QC) only lower to P4 when nothing else is flagged
  const qc = await services.db.select({ priority: schema.inferenceResults.priority }).from(schema.inferenceResults).where(and(eq(schema.inferenceResults.studyId, study.id), eq(schema.inferenceResults.task, 'qc')));
  if (qc.some((q) => q.priority === 'P4')) prios.push('P4');
  let priority = highestPriority(prios) ?? (models.length ? 'P3' : null);
  if (study.priority === 'stat') priority = 'P1';
  if (opts.emit !== false) {
    await emitDirect(services, 'bci.result.available.v1', { studyId: study.id, accession: study.accession, practiceId: study.practiceId, siteId: study.siteId, modelId: stored.map((s) => s.modelId).join(','), modelVersion: stored.map((s) => s.version).join(','), priority, findings, resultIds: stored.map((s) => s.id) }, { aggregateType: 'study', aggregateId: study.id, practiceId: study.practiceId });
  }
  return { studyId, results: stored, priority };
}
