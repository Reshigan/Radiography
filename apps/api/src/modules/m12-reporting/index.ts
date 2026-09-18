import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound, invalid, conflict, forbidden, defineHand, minutesBetween } from '@bonakala/domain';
import { getDemoModel, PRIORITY_RANK, type BciPriority } from '@bonakala/domain/bci';
import type { ReportCandidate, ReportSections, StructuredFinding, FollowupItem } from '@bonakala/db/schema';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on, registerHand, runHand } from '../../kernel/index.js';
import { ensureDraft, consistencyFor, readingFee, slaMinutes, candidatesForStudy, hubSiblingPracticeIds, REPORTABLE_CATEGORIES, CRITICAL_CATEGORIES, EMPTY_SECTIONS } from './service.js';

const r = router();
const READERS = ['RGT', 'PRM', 'SUP'] as const;
const VIEW = ['RGT', 'RAD', 'PRM', 'CMP', 'EXE', 'SUP', 'AIO'] as const;
const LOCK_MINUTES = 30;

/**
 * Drafting Hand (Class 2). It assembles a draft from the template, the accepted candidates, the
 * dictation transcript and the measurements. It has no sign, distribute or notify tool: the runtime
 * refuses any call outside this list, so no code path here can publish report text (M12-R-105).
 */
const draftingHand = defineHand({
  id: 'drafting', name: 'Drafting Hand', module: 'M12', level: 'A1',
  mandate: 'Assemble a structured draft for the radiologist from the template, the dictation transcript, the structured findings, the accepted findings candidates and the priors record; propose an impression, follow-up items and a critical flag suggestion. The draft is never published; only the radiologist signs.',
  defaultLeash: { mayIncludeUnacceptedCandidates: false, mayChangeMeasurements: false, mayLowerSeverity: false },
  approvalPersona: 'RGT', approvalPolicy: 'The radiologist reviews the whole draft; signing with any unreviewed annotated section is blocked',
  tools: { read_template: 'R0', read_transcript: 'R0', read_structured_findings: 'R0', read_accepted_candidates: 'R0', read_measurements: 'R0', read_priors_record: 'R0', read_followup_schedules: 'R0', propose_draft: 'R1', propose_followup_items: 'R1', suggest_critical_flag: 'R1', 'llm.draft_report': 'R1' },
});

async function loadReport(c: any, id: string) {
  const [row] = await c.get('services').db.select().from(schema.reports).where(eq(schema.reports.id, id)).limit(1);
  if (!row) throw notFound('Report');
  return row as typeof schema.reports.$inferSelect;
}
function assertRadiologist(c: any) {
  const user = c.get('user')!;
  if (user.persona !== 'RGT') throw forbidden('Only a registered radiologist may edit or sign a report');
  if (!user.hpcsaNo) throw forbidden('A current HPCSA registration number is required to sign reports');
  return user;
}

/* ---------- Worklist ---------- */
r.get('/worklist', allow(...VIEW), async (c) => {
  const practiceId = requirePractice(c);
  const user = c.get('user')!;
  const q = query(c, z.object({ scope: z.enum(['pool', 'mine', 'all', 'hub']).default('pool'), subspecialty: z.string().optional(), modality: z.string().optional(), siteId: z.string().optional(), limit: z.coerce.number().min(1).max(200).default(60) }));
  const services = c.get('services');
  const now = services.clock.now().toISOString();
  // Hub scope pools unclaimed work across every practice with a reading_services agreement to the
  // same hub (docs/19 R3 "Reading Hub") — a radiologist covers overflow at a sibling practice. "mine"
  // also spans the hub siblings, so a report claimed from hub work still shows once it's claimed.
  const hubIds = (q.scope === 'hub' || q.scope === 'mine') ? await hubSiblingPracticeIds(services.db, practiceId) : null;
  const practiceFilter = hubIds ? inArray(schema.reports.practiceId, hubIds) : eq(schema.reports.practiceId, practiceId);
  const rows = await services.db.select().from(schema.reports).where(and(practiceFilter, inArray(schema.reports.status, ['draft', 'prelim']), q.subspecialty ? eq(schema.reports.subspecialty, q.subspecialty) : undefined, q.siteId ? eq(schema.reports.siteId, q.siteId) : undefined, q.scope === 'mine' ? eq(schema.reports.claimedBy, user.id) : (q.scope === 'pool' || q.scope === 'hub') ? or(isNull(schema.reports.claimedBy), lt(schema.reports.lockExpiresAt, now)) : undefined)).limit(400);
  const practiceNames = hubIds && hubIds.length > 1
    ? new Map((await services.db.select({ id: schema.legalEntities.id, name: schema.legalEntities.tradingName }).from(schema.legalEntities).where(inArray(schema.legalEntities.id, hubIds))).map((x) => [x.id, x.name]))
    : null;
  const studyIds = rows.map((x) => x.studyId);
  const studies = studyIds.length ? await services.db.select().from(schema.studies).where(inArray(schema.studies.id, studyIds)) : [];
  const smap = new Map(studies.map((s) => [s.id, s]));
  const infer = studyIds.length ? await services.db.select().from(schema.inferenceResults).where(and(inArray(schema.inferenceResults.studyId, studyIds), eq(schema.inferenceResults.mode, 'activated'))) : [];
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const pats = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const pmap = new Map(pats.map((p) => [p.id, p]));
  const items = rows
    .filter((x) => !q.modality || smap.get(x.studyId)?.modality === q.modality)
    .map((rep) => {
      const study = smap.get(rep.studyId);
      const results = infer.filter((i) => i.studyId === rep.studyId);
      const prios = results.map((i) => i.priority).filter(Boolean) as BciPriority[];
      const aiPriority = prios.sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0] ?? null;
      const reasons = results.flatMap((i) => ((i.result as any)?.triage?.reason ?? []) as string[]).filter((x) => x !== 'no_critical_candidate' && x !== 'no_candidate_found' && x !== 'complete');
      const ageMin = study ? minutesBetween(study.completedAt ?? study.receivedAt, now) : 0;
      const sla = slaMinutes(rep.priority);
      return {
        ...rep, study: study ?? null, patient: pmap.get(rep.patientId) ?? null, aiPriority, aiReasons: [...new Set(reasons)],
        practiceName: practiceNames?.get(rep.practiceId) ?? null, fromHub: rep.practiceId !== practiceId,
        aiProvenance: results.filter((i) => i.priority).map((i) => ({ modelId: i.modelId, modelVersion: i.modelVersion, priority: i.priority, confidence: Math.max(0, ...((i.result as any)?.findings ?? []).filter((f: any) => f.flag).map((f: any) => f.score as number)) })),
        ageMinutes: ageMin, slaMinutes: sla, slaPct: Math.round((ageMin / sla) * 100), priorsReady: (study?.priorIds ?? []).length > 0,
        effectiveRank: Math.min(rep.priority === 'stat' ? 0 : rep.priority === 'urgent' ? 1 : 2, aiPriority === 'P1' ? 0 : aiPriority === 'P2' ? 1 : 2),
        raisedByAi: (rep.priority === 'routine' && (aiPriority === 'P1' || aiPriority === 'P2')) || (rep.priority === 'urgent' && aiPriority === 'P1'),
        locked: !!rep.claimedBy && (rep.lockExpiresAt ?? '') > now, lockedByMe: rep.claimedBy === user.id,
      };
    })
    .sort((a, b) => {
      // Ordered priority sets the band; AI triage may only raise a study (M12-R-102), never lower it.
      if (a.effectiveRank !== b.effectiveRank) return a.effectiveRank - b.effectiveRank;
      const ai = (x: typeof a) => (x.aiPriority ? PRIORITY_RANK[x.aiPriority] : 5);
      if (ai(a) !== ai(b)) return ai(a) - ai(b);
      return b.ageMinutes - a.ageMinutes;
    })
    .slice(0, q.limit);
  return c.json({ items, counts: { stat: items.filter((x) => x.priority === 'stat').length, p1: items.filter((x) => x.aiPriority === 'P1').length, raisedByAi: items.filter((x) => x.raisedByAi).length, breached: items.filter((x) => x.slaPct >= 100).length, total: rows.length } });
});

r.post('/reports/:id/claim', allow(...READERS), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  const services = c.get('services');
  const user = c.get('user')!;
  const practiceId = c.get('practiceId');
  if (practiceId && rep.practiceId !== practiceId) {
    const hubIds = await hubSiblingPracticeIds(services.db, practiceId);
    if (!hubIds.includes(rep.practiceId)) throw forbidden('This study is at a practice with no reading-services agreement with yours');
  }
  const now = services.clock.now();
  if (rep.claimedBy && rep.claimedBy !== user.id && (rep.lockExpiresAt ?? '') > now.toISOString()) throw conflict('Study is locked by another radiologist');
  const lockExpiresAt = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  await services.db.update(schema.reports).set({ claimedBy: user.id, claimedAt: now.toISOString(), lockExpiresAt, radiologistUserId: user.id }).where(eq(schema.reports.id, rep.id));
  await audit(c, 'report.claimed', { type: 'report', id: rep.id }, { studyId: rep.studyId });
  return c.json({ ok: true, lockExpiresAt });
});
r.post('/reports/:id/release', allow(...READERS), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  await c.get('services').db.update(schema.reports).set({ claimedBy: null, claimedAt: null, lockExpiresAt: null }).where(eq(schema.reports.id, rep.id));
  await audit(c, 'report.released', { type: 'report', id: rep.id });
  return c.json({ ok: true });
});

/* ---------- Study read view ---------- */
r.get('/reports/:id', allow(...VIEW), async (c) => {
  const services = c.get('services');
  const rep = await loadReport(c, param(c, 'id'));
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, rep.studyId)).limit(1);
  const [patient] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, rep.patientId)).limit(1);
  const [referrer] = rep.referrerId ? await services.db.select().from(schema.referrers).where(eq(schema.referrers.id, rep.referrerId)).limit(1) : [];
  const instances = study ? await services.db.select().from(schema.instances).where(and(eq(schema.instances.studyId, study.id), eq(schema.instances.rejected, false))).orderBy(schema.instances.number) : [];
  const ser = study ? await services.db.select().from(schema.series).where(eq(schema.series.studyId, study.id)).orderBy(schema.series.number) : [];
  const results = study ? await services.db.select().from(schema.inferenceResults).where(and(eq(schema.inferenceResults.studyId, study.id), eq(schema.inferenceResults.mode, 'activated'))) : [];
  const [template] = rep.templateId ? await services.db.select().from(schema.reportTemplates).where(eq(schema.reportTemplates.id, rep.templateId)).limit(1) : [];
  const priors = study?.priorIds?.length ? await services.db.select({ id: schema.studies.id, accession: schema.studies.accession, modality: schema.studies.modality, procedureDescription: schema.studies.procedureDescription, receivedAt: schema.studies.receivedAt, status: schema.studies.status, practiceId: schema.studies.practiceId }).from(schema.studies).where(inArray(schema.studies.id, study.priorIds)) : [];
  const dose = study ? await services.db.select().from(schema.doseRecords).where(eq(schema.doseRecords.studyId, study.id)).limit(1) : [];
  const priorReports = priors.length ? await services.db.select({ id: schema.reports.id, studyId: schema.reports.studyId, sections: schema.reports.sections, signedAt: schema.reports.signedAt }).from(schema.reports).where(and(inArray(schema.reports.studyId, priors.map((p) => p.id)), inArray(schema.reports.status, ['signed', 'amended']))) : [];
  const addenda = await services.db.select().from(schema.addenda).where(eq(schema.addenda.reportId, rep.id)).orderBy(schema.addenda.createdAt);
  const critical = await services.db.select().from(schema.criticalResults).where(eq(schema.criticalResults.reportId, rep.id));
  const overlayPolicy: Record<string, string> = {};
  for (const x of results) { const def = getDemoModel(x.modelId); if (def) overlayPolicy[x.modelId] = def.overlaysDefault; }
  await audit(c, 'report.opened', { type: 'report', id: rep.id }, { studyId: rep.studyId });
  return c.json({
    report: rep, study: study ?? null, series: ser, instances, results, template: template ?? null, priors, priorReports, addenda, critical,
    patient: patient ? { ...patient, idNumber: undefined, idNumberMasked: patient.idNumber ? `····${patient.idNumber.slice(-4)}` : null } : null,
    referrer: referrer ?? null, dose: dose[0] ? { ...dose[0], value: dose[0].valueX1000 / 1000, drlValue: dose[0].drlValueX1000 ? dose[0].drlValueX1000 / 1000 : null } : null,
    overlayPolicy, reportableCategories: REPORTABLE_CATEGORIES, criticalCategories: CRITICAL_CATEGORIES,
  });
});

/** Open (or create) the draft for a study. */
r.post('/studies/:studyId/report', allow(...READERS), async (c) => {
  const services = c.get('services');
  const rep = await ensureDraft(services, param(c, 'studyId'));
  if (!rep) throw notFound('Study');
  await audit(c, 'report.draft_opened', { type: 'report', id: rep.id }, { studyId: rep.studyId });
  return c.json({ report: rep });
});

/* ---------- Editing (draft only) ---------- */
r.patch('/reports/:id', allow(...READERS), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  assertRadiologist(c);
  if (rep.status === 'signed' || rep.status === 'amended') throw conflict('A signed report cannot be edited; use an addendum or a correction');
  const data = await body(c, z.object({ sections: z.record(z.string()).optional(), structuredFindings: z.array(z.any()).optional(), followups: z.array(z.any()).optional(), reportableCategories: z.array(z.string()).optional(), critical: z.boolean().optional(), criticalCategory: z.enum(['critical', 'urgent', 'unexpected_significant']).nullable().optional(), readingTimeSec: z.number().optional() }));
  const services = c.get('services');
  for (const cat of data.reportableCategories ?? []) if (!REPORTABLE_CATEGORIES.some((x) => x.code === cat)) throw invalid(`Unknown reportable-result category ${cat}`);
  const sections: ReportSections = { ...EMPTY_SECTIONS, ...rep.sections, ...(data.sections ?? {}) } as ReportSections;
  await services.db.update(schema.reports).set({
    sections, structuredFindings: (data.structuredFindings as StructuredFinding[]) ?? rep.structuredFindings, followups: (data.followups as FollowupItem[]) ?? rep.followups,
    reportableCategories: data.reportableCategories ?? rep.reportableCategories, critical: data.critical ?? rep.critical, criticalCategory: data.criticalCategory !== undefined ? data.criticalCategory : rep.criticalCategory,
    readingTimeSec: data.readingTimeSec ?? rep.readingTimeSec, warningsAcknowledged: false, updatedAt: services.clock.now().toISOString(),
  }).where(eq(schema.reports.id, rep.id));
  return c.json({ ok: true });
});

/** Accept, edit or reject a findings candidate; the decision is recorded with provenance (M12-R-107). */
r.post('/reports/:id/candidates/:candidateId', allow(...READERS), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  const user = assertRadiologist(c);
  if (rep.status === 'signed' || rep.status === 'amended') throw conflict('A signed report cannot be edited');
  const candidateId = param(c, 'candidateId');
  const { decision, editedText, reason } = await body(c, z.object({ decision: z.enum(['accepted', 'edited', 'rejected']), editedText: z.string().optional(), reason: z.string().optional() }));
  if (decision === 'edited' && !editedText) throw invalid('An edited candidate needs the edited text');
  if (decision === 'rejected' && !reason) throw invalid('A rejected candidate needs a reason (this feeds AI monitoring)');
  const services = c.get('services');
  const at = services.clock.now().toISOString();
  const candidates: ReportCandidate[] = (rep.candidates ?? []).map((x) => (x.id === candidateId ? { ...x, decision, editedText, reason, decidedBy: user.id, decidedAt: at } : x));
  const cand = candidates.find((x) => x.id === candidateId);
  if (!cand) throw notFound('Candidate');
  // Accepted candidates become structured findings with provenance; rejected ones never appear in the report.
  let structured: StructuredFinding[] = (rep.structuredFindings ?? []).filter((f) => f.code !== cand.code);
  if (decision !== 'rejected') {
    structured = [...structured, { code: cand.code, display: cand.display, laterality: cand.laterality, text: decision === 'edited' ? editedText! : cand.candidateText ?? `${cand.display} candidate.`, source: 'candidate', provenance: { modelId: cand.modelId, modelVersion: cand.modelVersion, confidence: cand.score, acceptedBy: user.id, acceptedAt: at } }];
  }
  await services.db.update(schema.reports).set({ candidates, structuredFindings: structured, warningsAcknowledged: false, updatedAt: at }).where(eq(schema.reports.id, rep.id));
  await audit(c, `report.candidate_${decision}`, { type: 'report', id: rep.id }, { candidateId, modelId: cand.modelId, modelVersion: cand.modelVersion, score: cand.score, reason });
  await emit(c, 'bci.candidate_decision.v1', { reportId: rep.id, studyId: rep.studyId, candidateId, decision, modelId: cand.modelId, modelVersion: cand.modelVersion, score: cand.score }, { aggregateType: 'report', aggregateId: rep.id });
  return c.json({ candidates, structuredFindings: structured });
});

/** Drafting Hand: builds a Class 2 draft. It cannot sign or distribute. */
r.post('/reports/:id/draft', allow(...READERS), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  assertRadiologist(c);
  if (rep.status === 'signed' || rep.status === 'amended') throw conflict('A signed report cannot be re-drafted');
  const { transcript } = await body(c, z.object({ transcript: z.string().default('') }));
  const task = await runHand(c.get('services'), 'drafting', { reportId: rep.id, transcript }, { practiceId: rep.practiceId, trigger: 'manual', title: `Draft ${rep.accession}`, aggregateType: 'report', aggregateId: rep.id });
  await audit(c, 'report.drafted', { type: 'report', id: rep.id }, { taskId: task.id, status: task.status });
  const [row] = await c.get('services').db.select().from(schema.reports).where(eq(schema.reports.id, rep.id)).limit(1);
  return c.json({ task, report: row });
});

/** Pre-sign consistency check (Class 4 warnings to the signing radiologist only). */
r.post('/reports/:id/consistency', allow(...READERS), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  const services = c.get('services');
  const res = await consistencyFor(services, rep);
  await services.db.update(schema.reports).set({ consistencyWarnings: res.consistency ?? [] }).where(eq(schema.reports.id, rep.id));
  return c.json({ checks: res.consistency ?? [], provenance: { modelId: res.model.id, modelVersion: res.model.version, outputClass: res.output_class, latencyMs: res.latency_ms, demo: res.demo } });
});
r.post('/reports/:id/acknowledge-warnings', allow(...READERS), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  assertRadiologist(c);
  const { reason } = await body(c, z.object({ reason: z.string().min(3) }));
  await c.get('services').db.update(schema.reports).set({ warningsAcknowledged: true, warningsAckReason: reason }).where(eq(schema.reports.id, rep.id));
  await audit(c, 'report.warnings_acknowledged', { type: 'report', id: rep.id }, { reason, warnings: rep.consistencyWarnings });
  return c.json({ ok: true });
});

/**
 * SIGN — the only route in the Platform that publishes report text (Class 1 hard gate, M12-R-106).
 * Requirements: an authenticated RGT with an HPCSA number; mandatory template fields complete;
 * consistency warnings resolved or acknowledged with a reason; a critical flag needs a communication
 * loop to be initiated (M12-R-110, handled downstream by M13 on report.critical_flag.confirmed.v1).
 * No automatic signing exists under any condition, and no Hand holds a sign tool.
 */
r.post('/reports/:id/sign', allow('RGT', 'SUP'), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  const user = c.get('user')!;
  if (user.persona !== 'RGT') throw forbidden('Only a registered radiologist may sign a report');
  if (!user.hpcsaNo) throw forbidden('Signing requires a current HPCSA registration number');
  if (rep.status === 'signed' || rep.status === 'amended') throw conflict('Report is already signed');
  const { mfaConfirmed, criticalCategory } = await body(c, z.object({ mfaConfirmed: z.boolean().default(false), criticalCategory: z.enum(['critical', 'urgent', 'unexpected_significant']).optional() }));
  const services = c.get('services');
  const at = services.clock.now().toISOString();

  // Mandatory fields from the template
  const [template] = rep.templateId ? await services.db.select().from(schema.reportTemplates).where(eq(schema.reportTemplates.id, rep.templateId)).limit(1) : [];
  const sections = rep.sections as unknown as Record<string, string>;
  const missing = (template?.mandatoryFields ?? ['findings', 'impression']).filter((f) => !(sections[f] ?? '').trim());
  if (missing.length) return c.json({ error: 'mandatory_fields', message: `These sections must be completed before signing: ${missing.join(', ')}`, missing }, 409);

  // Undecided candidates and consistency warnings
  const undecided = (rep.candidates ?? []).filter((x) => x.flag && x.decision === 'pending');
  if (undecided.length) return c.json({ error: 'candidates_undecided', message: `Accept, edit or reject every findings candidate before signing: ${undecided.map((x) => x.display).join(', ')}`, candidates: undecided }, 409);
  const check = await consistencyFor(services, rep);
  const warnings = (check.consistency ?? []).filter((x) => x.status !== 'pass');
  await services.db.update(schema.reports).set({ consistencyWarnings: check.consistency ?? [] }).where(eq(schema.reports.id, rep.id));
  if (warnings.length && !rep.warningsAcknowledged) return c.json({ error: 'consistency_warnings', message: 'Resolve the consistency warnings or acknowledge them with a reason before signing', warnings }, 409);

  const critical = rep.critical || !!criticalCategory;
  const category = criticalCategory ?? rep.criticalCategory ?? null;
  if (critical && !category) return c.json({ error: 'critical_category', message: 'A critical flag needs a category' }, 409);
  // Critical-flagged reports always require MFA re-authentication (M12-R-106).
  if (critical && !mfaConfirmed) return c.json({ error: 'mfa_required', message: 'Re-authenticate to sign a critical-flagged report' }, 401);

  const fee = readingFee(rep.readingRvuX100 ?? 100, { priority: rep.priority, signedAt: at });
  await services.db.update(schema.reports).set({ status: 'signed', signedAt: at, radiologistUserId: user.id, signedHpcsaNo: user.hpcsaNo, critical, criticalCategory: category, claimedBy: user.id, lockExpiresAt: null, readingRvuX100: fee.rvuX100, readingFeeCents: fee.cents, updatedAt: at }).where(eq(schema.reports.id, rep.id));
  await services.db.update(schema.studies).set({ status: 'reported', reportedAt: at }).where(eq(schema.studies.id, rep.studyId));

  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, rep.studyId)).limit(1);
  // ICD-10 prompts from the template are proposals for coding; the radiologist's report is the source of truth.
  const [tpl] = rep.templateId ? await services.db.select({ icd10Prompts: schema.reportTemplates.icd10Prompts }).from(schema.reportTemplates).where(eq(schema.reportTemplates.id, rep.templateId)).limit(1) : [];
  const icd10Codes = (tpl?.icd10Prompts ?? []).slice(0, 1);
  await audit(c, 'report.signed', { type: 'report', id: rep.id }, { accession: rep.accession, hpcsaNo: user.hpcsaNo, critical, category, reportableCategories: rep.reportableCategories, feeCents: fee.cents });
  await emit(c, 'report.signed.v1', {
    reportId: rep.id, studyId: rep.studyId, accession: rep.accession, patientId: rep.patientId, practiceId: rep.practiceId, siteId: rep.siteId, referrerId: rep.referrerId,
    radiologistUserId: user.id, hpcsaNo: user.hpcsaNo, procedureCodes: study ? [study.procedureCode] : [], icd10: icd10Codes, modality: study?.modality ?? null,
    procedures: study ? [{ code: study.procedureCode, description: study.procedureDescription, modality: study.modality, bodyPart: study.bodyPart, laterality: study.laterality, contrast: !!(await services.db.select({ id: schema.contrastAdministrations.id }).from(schema.contrastAdministrations).where(eq(schema.contrastAdministrations.studyId, study.id)).limit(1)).length }] : [],
    serviceDate: (study?.completedAt ?? study?.receivedAt ?? at).slice(0, 10),
    critical, criticalCategory: category, reportableCategories: rep.reportableCategories, followups: rep.followups, signedAt: at, readingFeeCents: fee.cents,
  }, { aggregateType: 'report', aggregateId: rep.id });
  if (critical && category) {
    await emit(c, 'report.critical_flag.confirmed.v1', { reportId: rep.id, studyId: rep.studyId, accession: rep.accession, patientId: rep.patientId, practiceId: rep.practiceId, siteId: rep.siteId, referrerId: rep.referrerId, category, radiologistUserId: user.id }, { aggregateType: 'report', aggregateId: rep.id });
  }
  return c.json({ ok: true, signedAt: at, fee });
});

/* ---------- Addenda and corrections ---------- */
r.post('/reports/:id/addendum', allow('RGT', 'SUP'), async (c) => {
  const rep = await loadReport(c, param(c, 'id'));
  const user = c.get('user')!;
  if (user.persona !== 'RGT' || !user.hpcsaNo) throw forbidden('Only a registered radiologist may sign an addendum');
  if (rep.status !== 'signed' && rep.status !== 'amended') throw conflict('Only a signed report can carry an addendum');
  const { text, reason, kind } = await body(c, z.object({ text: z.string().min(5), reason: z.string().min(3), kind: z.enum(['addendum', 'correction']).default('addendum') }));
  const services = c.get('services');
  const at = services.clock.now().toISOString();
  const id = newId('add');
  await services.db.insert(schema.addenda).values({ id, practiceId: rep.practiceId, reportId: rep.id, authorUserId: user.id, kind, text, reason, signedAt: at });
  await services.db.update(schema.reports).set({ status: 'amended', version: rep.version + 1, updatedAt: at }).where(eq(schema.reports.id, rep.id));
  await audit(c, `report.${kind}`, { type: 'report', id: rep.id }, { addendumId: id, reason });
  await emit(c, kind === 'correction' ? 'report.corrected.v1' : 'report.addended.v1', { reportId: rep.id, studyId: rep.studyId, accession: rep.accession, patientId: rep.patientId, practiceId: rep.practiceId, referrerId: rep.referrerId, addendumId: id, kind, reason, signedAt: at }, { aggregateType: 'report', aggregateId: rep.id });
  return c.json({ id }, 201);
});

/* ---------- Templates ---------- */
r.get('/templates', allow(...VIEW), async (c) => {
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.reportTemplates).where(or(isNull(schema.reportTemplates.practiceId), practiceId ? eq(schema.reportTemplates.practiceId, practiceId) : undefined)).orderBy(schema.reportTemplates.modality, schema.reportTemplates.bodyPart);
  return c.json({ templates: rows });
});

/* ---------- Peer review ---------- */
r.get('/peer-reviews', allow(...VIEW), async (c) => {
  const practiceId = requirePractice(c);
  const user = c.get('user')!;
  const rows = await c.get('services').db.select().from(schema.peerReviews).where(and(eq(schema.peerReviews.practiceId, practiceId), user.persona === 'RGT' ? or(eq(schema.peerReviews.reviewerUserId, user.id), eq(schema.peerReviews.originalRadiologistUserId, user.id)) : undefined)).orderBy(desc(schema.peerReviews.sampledAt)).limit(200);
  const repIds = [...new Set(rows.map((x) => x.reportId))];
  const reps = repIds.length ? await c.get('services').db.select({ id: schema.reports.id, accession: schema.reports.accession, sections: schema.reports.sections, signedAt: schema.reports.signedAt, radiologistUserId: schema.reports.radiologistUserId }).from(schema.reports).where(inArray(schema.reports.id, repIds)) : [];
  const rmap = new Map(reps.map((x) => [x.id, x]));
  const dist: Record<string, number> = {};
  for (const x of rows) if (x.score) dist[x.score] = (dist[x.score] ?? 0) + 1;
  // Blinding: the reviewer cannot see the original report until they have submitted their impression.
  return c.json({ reviews: rows.map((x) => ({ ...x, report: x.status === 'pending' && x.reviewerUserId === user.id ? { id: x.reportId, accession: rmap.get(x.reportId)?.accession ?? null } : rmap.get(x.reportId) ?? null })), distribution: dist });
});
r.post('/peer-reviews/sample', allow('CMP', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const { ratePct } = await body(c, z.object({ ratePct: z.number().min(1).max(20).default(3) }));
  const services = c.get('services');
  const since = new Date(services.clock.now().getTime() - 30 * 86400_000).toISOString();
  const signed = await services.db.select().from(schema.reports).where(and(eq(schema.reports.practiceId, practiceId), inArray(schema.reports.status, ['signed', 'amended']), gte(schema.reports.signedAt, since)));
  const already = new Set((await services.db.select({ reportId: schema.peerReviews.reportId }).from(schema.peerReviews).where(eq(schema.peerReviews.practiceId, practiceId))).map((x) => x.reportId));
  const readers = await services.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.persona, 'RGT'), eq(schema.users.status, 'active')));
  const pool = signed.filter((x) => !already.has(x.id) && x.radiologistUserId);
  const target = Math.max(1, Math.round((pool.length * ratePct) / 100));
  // Stratify by radiologist so no one is over- or under-sampled.
  const byRad = new Map<string, typeof pool>();
  for (const x of pool) byRad.set(x.radiologistUserId!, [...(byRad.get(x.radiologistUserId!) ?? []), x]);
  const picked: typeof pool = [];
  let i = 0;
  while (picked.length < target && i < 50) {
    for (const [, list] of byRad) { const item = list[i]; if (item && picked.length < target) picked.push(item); }
    i++;
  }
  const created: string[] = [];
  for (const rep of picked) {
    const reviewer = readers.find((u) => u.id !== rep.radiologistUserId);
    if (!reviewer) continue;
    const id = newId('pr');
    await services.db.insert(schema.peerReviews).values({ id, practiceId, reportId: rep.id, studyId: rep.studyId, originalRadiologistUserId: rep.radiologistUserId!, reviewerUserId: reviewer.id, status: 'pending' });
    created.push(id);
  }
  await audit(c, 'peer_review.sampled', undefined, { created: created.length, ratePct });
  return c.json({ created: created.length, ids: created }, 201);
});
r.post('/peer-reviews/:id/score', allow('RGT', 'CMP', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const { score, category, notes, blindedImpression } = await body(c, z.object({ score: z.enum(['1', '2a', '2b', '3a', '3b']), category: z.enum(['perception', 'interpretation', 'communication', 'technical', 'followup']).optional(), notes: z.string().optional(), blindedImpression: z.string().optional() }));
  const services = c.get('services');
  const [row] = await services.db.select().from(schema.peerReviews).where(eq(schema.peerReviews.id, id)).limit(1);
  if (!row) throw notFound('Peer review');
  if (score !== '1' && !category) throw invalid('A discrepancy needs a category');
  const at = services.clock.now().toISOString();
  const routed = score === '2b' || score.startsWith('3');
  await services.db.update(schema.peerReviews).set({ score, category: category ?? null, notes: notes ?? null, blindedImpression: blindedImpression ?? row.blindedImpression, status: routed ? 'routed' : 'scored', scoredAt: at }).where(eq(schema.peerReviews.id, id));
  await audit(c, 'peer_review.scored', { type: 'peer_review', id }, { score, category, routed });
  if (score === '3b') await emit(c, 'incident.opened.v1', { incidentId: newId('inc'), practiceId: row.practiceId, category: 'major_discrepancy', severity: 'high', source: 'M12', relatedType: 'report', relatedId: row.reportId, description: `Peer review score 3b: ${notes ?? category ?? 'major discrepancy, likely clinical significance'}` }, { aggregateType: 'peer_review', aggregateId: id });
  return c.json({ ok: true, routed });
});

/* ---------- Analytics and reading fees ---------- */
r.get('/analytics', allow(...VIEW), async (c) => {
  const practiceId = requirePractice(c);
  const { days } = query(c, z.object({ days: z.coerce.number().min(1).max(180).default(30) }));
  const services = c.get('services');
  const since = new Date(services.clock.now().getTime() - days * 86400_000).toISOString();
  const rows = await services.db.select().from(schema.reports).where(and(eq(schema.reports.practiceId, practiceId), inArray(schema.reports.status, ['signed', 'amended']), gte(schema.reports.signedAt, since)));
  const studyIds = rows.map((x) => x.studyId);
  const studies = studyIds.length ? await services.db.select({ id: schema.studies.id, completedAt: schema.studies.completedAt, receivedAt: schema.studies.receivedAt, modality: schema.studies.modality }).from(schema.studies).where(inArray(schema.studies.id, studyIds)) : [];
  const smap = new Map(studies.map((s) => [s.id, s]));
  const tats: Record<string, number[]> = {};
  const byModality: Record<string, number> = {};
  for (const rep of rows) {
    const s = smap.get(rep.studyId);
    if (!s || !rep.signedAt) continue;
    const mins = minutesBetween(s.completedAt ?? s.receivedAt, rep.signedAt);
    (tats[rep.priority] ??= []).push(mins);
    byModality[s.modality] = (byModality[s.modality] ?? 0) + 1;
  }
  const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
  const breaches = rows.filter((rep) => { const s = smap.get(rep.studyId); return s && rep.signedAt && minutesBetween(s.completedAt ?? s.receivedAt, rep.signedAt) > slaMinutes(rep.priority); }).length;
  const candidateStats = rows.reduce((a, rep) => { for (const cand of rep.candidates ?? []) { if (cand.decision === 'accepted' || cand.decision === 'edited') a.accepted++; else if (cand.decision === 'rejected') a.rejected++; } return a; }, { accepted: 0, rejected: 0 });
  const peer = await services.db.select({ score: schema.peerReviews.score }).from(schema.peerReviews).where(eq(schema.peerReviews.practiceId, practiceId));
  return c.json({
    days, signed: rows.length, tatMedianMinutes: { stat: median(tats.stat ?? []), urgent: median(tats.urgent ?? []), routine: median(tats.routine ?? []) },
    slaBreaches: breaches, byModality, critical: rows.filter((x) => x.critical).length,
    aiAgreementPct: candidateStats.accepted + candidateStats.rejected ? Math.round((candidateStats.accepted / (candidateStats.accepted + candidateStats.rejected)) * 1000) / 10 : null,
    peerReviews: { total: peer.length, discrepancies: peer.filter((x) => x.score && x.score !== '1').length },
  });
});

r.get('/fees', allow('RGT', 'PRM', 'EXE', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const user = c.get('user')!;
  const { from, to, radiologistUserId } = query(c, z.object({ from: z.string().optional(), to: z.string().optional(), radiologistUserId: z.string().optional() }));
  const services = c.get('services');
  const start = from ?? new Date(services.clock.now().getTime() - 30 * 86400_000).toISOString();
  const end = to ?? services.clock.now().toISOString();
  const who = user.persona === 'RGT' ? user.id : radiologistUserId;
  const rows = await services.db.select().from(schema.reports).where(and(eq(schema.reports.practiceId, practiceId), inArray(schema.reports.status, ['signed', 'amended']), gte(schema.reports.signedAt, start), lt(schema.reports.signedAt, end), who ? eq(schema.reports.radiologistUserId, who) : undefined)).orderBy(desc(schema.reports.signedAt));
  const lines = rows.map((x) => ({ reportId: x.id, accession: x.accession, signedAt: x.signedAt, priority: x.priority, subspecialty: x.subspecialty, rvu: (x.readingRvuX100 ?? 0) / 100, feeCents: x.readingFeeCents ?? 0 }));
  return c.json({ from: start, to: end, radiologistUserId: who ?? null, count: lines.length, totalRvu: Math.round(lines.reduce((a, x) => a + x.rvu, 0) * 100) / 100, totalCents: lines.reduce((a, x) => a + x.feeCents, 0), lines });
});

/** Patients a radiologist has reported on (rail item /read/patients). */
r.get('/patients', allow(...VIEW), async (c) => {
  const practiceId = requirePractice(c);
  const { q } = query(c, z.object({ q: z.string().optional() }));
  const services = c.get('services');
  const rows = await services.db.select().from(schema.reports).where(and(eq(schema.reports.practiceId, practiceId), inArray(schema.reports.status, ['signed', 'amended']))).orderBy(desc(schema.reports.signedAt)).limit(300);
  const pids = [...new Set(rows.map((x) => x.patientId))];
  const pats = pids.length ? await services.db.select({ id: schema.patients.id, firstName: schema.patients.firstName, lastName: schema.patients.lastName, sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth, epid: schema.patients.epid }).from(schema.patients).where(inArray(schema.patients.id, pids)) : [];
  const filtered = q ? pats.filter((p) => `${p.firstName} ${p.lastName} ${p.epid}`.toLowerCase().includes(q.toLowerCase())) : pats;
  return c.json({ patients: filtered.map((p) => ({ ...p, reports: rows.filter((x) => x.patientId === p.id).map((x) => ({ id: x.id, accession: x.accession, signedAt: x.signedAt, critical: x.critical })) })) });
});

r.get('/status', (c) => c.json({ module: 'M12', status: 'ok' }));

export default defineModule({
  code: 'M12', name: 'Reporting', basePath: 'reporting', routes: r,
  boot(services) {
    registerHand<{ reportId: string; transcript: string }, { sections: unknown; followups: unknown; criticalSuggestion: unknown }>(draftingHand, async (input, ctx) => {
      const [rep] = await services.db.select().from(schema.reports).where(eq(schema.reports.id, input.reportId)).limit(1);
      if (!rep) throw new Error('Report not found');
      const template = await ctx.step('read_template', { templateId: rep.templateId }, async () => (rep.templateId ? (await services.db.select().from(schema.reportTemplates).where(eq(schema.reportTemplates.id, rep.templateId)).limit(1))[0] ?? null : null));
      const transcript = await ctx.step('read_transcript', {}, async () => input.transcript ?? '');
      const accepted = await ctx.step('read_accepted_candidates', {}, async () => (rep.candidates ?? []).filter((x) => x.decision === 'accepted' || x.decision === 'edited'));
      const structured = await ctx.step('read_structured_findings', {}, async () => rep.structuredFindings ?? []);
      const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, rep.studyId)).limit(1);
      const priorText = await ctx.step('read_priors_record', { studyId: rep.studyId }, async () => {
        const ids = study?.priorIds ?? [];
        if (!ids.length) return 'No previous imaging available for comparison.';
        const priors = await services.db.select({ modality: schema.studies.modality, procedureDescription: schema.studies.procedureDescription, receivedAt: schema.studies.receivedAt, practiceId: schema.studies.practiceId }).from(schema.studies).where(inArray(schema.studies.id, ids)).orderBy(desc(schema.studies.receivedAt)).limit(1);
        const p = priors[0];
        return p ? `Comparison: ${p.procedureDescription ?? p.modality} of ${new Date(p.receivedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}${p.practiceId !== rep.practiceId ? ', external provider' : ', same Practice'}.` : 'No previous imaging available for comparison.';
      });
      // The Hand may only use the transcript, the structured findings and the accepted candidates (leash).
      ctx.leashCheck([{ rule: 'mayIncludeUnacceptedCandidates', actual: false, compare: 'eq' }, { rule: 'mayChangeMeasurements', actual: false, compare: 'eq' }]);
      const findingLines = [...structured.filter((f) => f.code !== 'density').map((f) => f.text), ...(transcript.trim() ? [transcript.trim()] : [])];
      const templateFindings = (template?.sections as Record<string, string> | undefined)?.findings ?? '';
      let draftSections: ReportSections;
      if (services.llm.available) {
        const text = await ctx.step('llm.draft_report', { accession: rep.accession }, async () => services.llm.complete({
          system: 'You draft radiology report sections from structured inputs only. Never introduce a finding that is not supplied. Never omit a supplied finding. Never change a measurement. Return JSON with keys findings, impression, recommendation.',
          user: JSON.stringify({ template: template?.sections ?? {}, accepted: accepted.map((a) => a.candidateText ?? a.editedText), structured: structured.map((f) => f.text), transcript, comparison: priorText }), json: true, maxTokens: 900,
        }));
        let parsed: Record<string, string> = {};
        try { parsed = JSON.parse(text); } catch { parsed = {}; }
        draftSections = { ...EMPTY_SECTIONS, ...rep.sections, comparison: priorText, findings: parsed.findings || findingLines.join(' ') || templateFindings, impression: parsed.impression || impressionFrom(structured), recommendation: parsed.recommendation || recommendationFrom(structured) } as ReportSections;
      } else {
        // Deterministic fallback: the draft is assembled from the template and the accepted inputs.
        draftSections = { ...EMPTY_SECTIONS, ...rep.sections, comparison: priorText, findings: [findingLines.join(' '), templateFindings].filter(Boolean).join(' ').trim(), impression: impressionFrom(structured), recommendation: recommendationFrom(structured) } as ReportSections;
      }
      const followups = await ctx.step('propose_followup_items', {}, async () => followupsFrom(structured, services.clock.now()));
      const criticalSuggestion = await ctx.step('suggest_critical_flag', {}, async () => suggestCritical(structured));
      await ctx.step('propose_draft', { reportId: rep.id }, async () => services.db.update(schema.reports).set({
        sections: draftSections, followups: followups as FollowupItem[],
        draftProvenance: { modelId: 'draft-report', modelVersion: '2.7.1', outputClass: 2, createdAt: services.clock.now().toISOString(), llmUsed: services.llm.available, inputsHash: `${(rep.candidates ?? []).length}:${structured.length}:${transcript.length}`, reviewed: false },
        warningsAcknowledged: false, updatedAt: services.clock.now().toISOString(),
      }).where(eq(schema.reports.id, rep.id)));
      ctx.log('Draft is a Class 2 output: it stays a draft until the radiologist signs. This Hand holds no sign, distribute or notify tool.');
      return { sections: draftSections, followups, criticalSuggestion };
    });

    /** A completed study creates its draft shell and enters the reading worklist. */
    on('study.completed.v1', async (evt) => {
      const p = evt.payload as { studyId: string };
      await ensureDraft(services, p.studyId);
    });
    /** Candidates arrive after inference; refresh the draft's candidate list while it is still a draft. */
    on('bci.result.available.v1', async (evt) => {
      const p = evt.payload as { studyId: string };
      const [rep] = await services.db.select().from(schema.reports).where(and(eq(schema.reports.studyId, p.studyId), eq(schema.reports.status, 'draft'))).limit(1);
      if (!rep) return;
      const fresh = await candidatesForStudy(services, p.studyId);
      const decided = new Map((rep.candidates ?? []).filter((x) => x.decision !== 'pending').map((x) => [x.id, x]));
      const merged = fresh.map((x) => decided.get(x.id) ?? x);
      await services.db.update(schema.reports).set({ candidates: merged }).where(eq(schema.reports.id, rep.id));
    });
  },
  async tick(services) {
    // Expire stale locks so studies return to the pool.
    const now = services.clock.now().toISOString();
    const stale = await services.db.select({ id: schema.reports.id }).from(schema.reports).where(and(inArray(schema.reports.status, ['draft', 'prelim']), ne(schema.reports.claimedBy, ''), lt(schema.reports.lockExpiresAt, now)));
    for (const s of stale) await services.db.update(schema.reports).set({ claimedBy: null, claimedAt: null, lockExpiresAt: null }).where(eq(schema.reports.id, s.id));
    return { locksExpired: stale.length };
  },
});

function impressionFrom(structured: StructuredFinding[]): string {
  const flagged = structured.filter((f) => f.code !== 'density');
  if (!flagged.length) return 'No acute abnormality identified on this study. Clinical correlation is advised.';
  return flagged.map((f, i) => `${i + 1}. ${f.text.replace(/ candidate/gi, '').replace(/^The model /, '')}`).join('\n');
}
function recommendationFrom(structured: StructuredFinding[]): string {
  const recs: string[] = [];
  for (const f of structured) {
    if (f.code === 'pneumothorax') recs.push('Clinical correlation; repeat radiograph in 4 to 6 hours or sooner if symptoms progress.');
    if (f.code === 'nodule') recs.push('CT chest for characterisation, with follow-up interval per the practice nodule schedule.');
    if (f.code === 'tb_pattern') recs.push('Sputum for microbiological confirmation; correlate clinically.');
    if (f.code === 'mass') recs.push('Targeted ultrasound and tissue sampling as clinically indicated.');
    if (f.code === 'fracture') recs.push('Orthopaedic review; further views or CT if clinically indicated.');
  }
  return [...new Set(recs)].join(' ');
}
function followupsFrom(structured: StructuredFinding[], now: Date): FollowupItem[] {
  const out: FollowupItem[] = [];
  for (const f of structured) {
    if (f.code === 'nodule') out.push({ what: 'CT chest (thin section)', when: 'in 3 months', why: 'pulmonary nodule candidate accepted at reporting', who: 'referrer', dueAt: new Date(now.getTime() + 90 * 86400_000).toISOString(), source: 'practice nodule follow-up schedule v2' });
    if (f.code === 'mass') out.push({ what: 'Targeted ultrasound of the breast', when: 'within 2 weeks', why: 'mass candidate accepted at reporting', who: 'referrer', dueAt: new Date(now.getTime() + 14 * 86400_000).toISOString(), source: 'practice breast work-up schedule v1' });
    if (f.code === 'tb_pattern') out.push({ what: 'Sputum microbiology and clinical review', when: 'within 1 week', why: 'TB-suggestive pattern', who: 'referrer', dueAt: new Date(now.getTime() + 7 * 86400_000).toISOString(), source: 'practice TB pathway v1' });
  }
  return out;
}
function suggestCritical(structured: StructuredFinding[]): { suggested: boolean; category: string | null; reason: string } {
  const crit = structured.find((f) => ['pneumothorax', 'intracranial_haemorrhage'].includes(f.code));
  if (crit) return { suggested: true, category: 'critical', reason: `${crit.display} accepted as a finding: matches the practice critical results policy` };
  const urgent = structured.find((f) => ['mass', 'fracture', 'pleural_effusion'].includes(f.code));
  if (urgent) return { suggested: true, category: 'urgent', reason: `${urgent.display} accepted as a finding: matches the urgent category` };
  return { suggested: false, category: null, reason: 'No accepted finding matches the critical or urgent categories' };
}
