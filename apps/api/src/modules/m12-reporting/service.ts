import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId } from '@bonakala/domain';
import { findProcedure, getDemoModel, runConsistencyCheck, type BciResult } from '@bonakala/domain/bci';
import type { Services } from '../../kernel/ports.js';
import type { ReportCandidate, ReportSections } from '@bonakala/db/schema';

export const EMPTY_SECTIONS: ReportSections = { clinicalInfo: '', technique: '', comparison: '', findings: '', impression: '', recommendation: '' };

/** Reportable-result categories (docs/24 §3) with their legally reviewed standard statements. */
export const REPORTABLE_CATEGORIES: Array<{ code: string; label: string; statement: string; window: string; releaseWithheld: boolean }> = [
  { code: 'tb_suggestive', label: 'TB-suggestive pattern: consider notifiable medical condition', statement: 'The appearances include features that may be associated with pulmonary tuberculosis. Clinical and microbiological correlation is required. Tuberculosis is a notifiable medical condition; notification is the duty of the practitioner who makes the clinical or laboratory diagnosis.', window: '24 hours', releaseWithheld: false },
  { code: 'occupational_lung', label: 'Possible occupational lung disease', statement: 'The appearances may be consistent with an occupational lung disease. Correlation with the occupational history is required. Occupational disease reporting duties under COIDA and, for mineworkers, ODMWA rest with the employer and the treating practitioner.', window: '72 hours', releaseWithheld: false },
  { code: 'nai_child', label: 'Suspected non-accidental injury (child)', statement: 'The pattern of injury raises the possibility of non-accidental injury. This is a radiological observation and not a determination of cause. Reporting duties under section 110 of the Children’s Act rest with the professionals listed in that section. A skeletal survey may be considered.', window: 'immediate', releaseWithheld: true },
  { code: 'elder_abuse', label: 'Injuries suggestive of abuse or neglect (older person)', statement: 'The appearances raise the possibility of injury from abuse or neglect. Section 26 of the Older Persons Act places a duty on any person who suspects abuse to report it.', window: 'immediate', releaseWithheld: true },
  { code: 'malignancy_suspected', label: 'Suspicious for malignancy', statement: 'The appearances are suspicious for malignancy. Histological correlation is required. The referring clinician is asked to acknowledge receipt and arrange the next step.', window: '24 hours', releaseWithheld: true },
  { code: 'radiation_incident', label: 'Radiation or device incident', statement: 'A radiation or device event has been identified in relation to this study and has been referred to the radiation protection officer for investigation.', window: '24 hours', releaseWithheld: false },
];

export const CRITICAL_CATEGORIES = [
  { code: 'critical', label: 'Critical', windowMinutes: 30, requiresVoice: true, examples: 'tension pneumothorax, intracranial haemorrhage, aortic dissection, ectopic pregnancy, free intraperitoneal air' },
  { code: 'urgent', label: 'Urgent', windowMinutes: 240, requiresVoice: false, examples: 'new malignancy with complications, abscess, bowel obstruction, unexpected fracture, DVT' },
  { code: 'unexpected_significant', label: 'Unexpected significant', windowMinutes: 1440, requiresVoice: false, examples: 'incidental mass, unexpected lymphadenopathy, aneurysm below intervention size' },
] as const;

/** Study priority class (process 07 §7.1) with the SLA target in minutes. */
export function slaMinutes(priority: string): number {
  return priority === 'stat' ? 30 : priority === 'urgent' ? 120 : 1440;
}
export function subspecialtyFor(bodyPart: string, modality: string): string {
  if (bodyPart === 'breast') return 'breast';
  if (bodyPart === 'head' || bodyPart === 'neck') return 'neuro';
  if (['limb', 'knee', 'hand', 'spine', 'pelvis'].includes(bodyPart)) return 'msk';
  if (bodyPart === 'chest') return 'chest';
  if (bodyPart === 'obstetric') return 'obstetric';
  if (modality === 'US') return 'body';
  return 'body';
}

/** Candidates for a study from activated Class 1/findings results; rejected ones never enter report text. */
export async function candidatesForStudy(services: Services, studyId: string): Promise<ReportCandidate[]> {
  const rows = await services.db.select().from(schema.inferenceResults).where(and(eq(schema.inferenceResults.studyId, studyId), eq(schema.inferenceResults.mode, 'activated'), inArray(schema.inferenceResults.task, ['findings', 'triage'])));
  const out: ReportCandidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const res = row.result as unknown as BciResult;
    const def = getDemoModel(row.modelId);
    if (def && def.outputClass !== 1) continue; // triage-only models order the worklist; they are not report content
    for (const f of res.findings ?? []) {
      if (!f.flag) continue;
      const key = `${f.code}|${f.laterality ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `${row.id}:${f.code}`, inferenceResultId: row.id, modelId: row.modelId, modelVersion: row.modelVersion, code: f.code, display: f.display, laterality: f.laterality, score: f.score, flag: f.flag, candidateText: f.candidate_text, localisation: f.localisation as ReportCandidate['localisation'], decision: 'pending' });
    }
  }
  return out;
}

export async function pickTemplate(services: Services, practiceId: string, modality: string, bodyPart: string) {
  const rows = await services.db.select().from(schema.reportTemplates).where(and(eq(schema.reportTemplates.status, 'active'), eq(schema.reportTemplates.modality, modality)));
  return rows.find((t) => t.bodyPart === bodyPart && t.practiceId === practiceId) ?? rows.find((t) => t.bodyPart === bodyPart) ?? rows.find((t) => t.practiceId === practiceId) ?? rows[0] ?? null;
}

/** Create (or return) the draft report shell for a completed study. Never contains published text. */
export async function ensureDraft(services: Services, studyId: string, opts: { at?: string } = {}) {
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, studyId)).limit(1);
  if (!study) return null;
  const existing = await services.db.select().from(schema.reports).where(and(eq(schema.reports.studyId, studyId), inArray(schema.reports.status, ['draft', 'prelim', 'signed', 'amended']))).limit(1);
  if (existing.length) return existing[0]!;
  const template = await pickTemplate(services, study.practiceId, study.modality, study.bodyPart);
  const candidates = await candidatesForStudy(services, studyId);
  const proc = findProcedure(study.procedureCode);
  const id = newId('rep');
  const at = opts.at ?? services.clock.now().toISOString();
  const sections: ReportSections = { ...EMPTY_SECTIONS, clinicalInfo: study.indication ?? '', technique: (template?.sections.technique ?? proc?.description ?? '') as string };
  await services.db.insert(schema.reports).values({
    id, practiceId: study.practiceId, siteId: study.siteId, studyId, accession: study.accession, patientId: study.patientId, referrerId: study.referrerId, status: 'draft',
    templateId: template?.id ?? null, sections, structuredFindings: [], candidates, followups: [], reportableCategories: [],
    priority: study.priority, subspecialty: subspecialtyFor(study.bodyPart, study.modality), readingRvuX100: Math.round((proc?.rvu ?? 1) * 100), createdAt: at, updatedAt: at,
  });
  const [row] = await services.db.select().from(schema.reports).where(eq(schema.reports.id, id)).limit(1);
  return row!;
}

/** Reading fee: RVU weight × contract rate, with STAT and after-hours multipliers (process 07 §11). */
export function readingFee(rvuX100: number, opts: { priority: string; signedAt: string; addendum?: boolean }): { rvuX100: number; multiplier: number; cents: number; reasons: string[] } {
  const base = 32000; // cents per 1.0 RVU-equivalent: the Hub reading services agreement rate (M02)
  const reasons: string[] = [];
  let multiplier = 1;
  if (opts.priority === 'stat') { multiplier *= 1.5; reasons.push('STAT ×1.5'); }
  const hour = Number(new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(new Date(opts.signedAt)));
  if (hour >= 18 || hour < 7) { multiplier *= 1.25; reasons.push('after hours ×1.25'); }
  if (opts.addendum) { multiplier *= 0.25; reasons.push('addendum ×0.25'); }
  const effective = Math.round(rvuX100 * multiplier);
  return { rvuX100: effective, multiplier, cents: Math.round((effective / 100) * base), reasons };
}

export async function consistencyFor(services: Services, report: typeof schema.reports.$inferSelect) {
  const [study] = await services.db.select().from(schema.studies).where(eq(schema.studies.id, report.studyId)).limit(1);
  const [pat] = await services.db.select({ sex: schema.patients.sex, dateOfBirth: schema.patients.dateOfBirth }).from(schema.patients).where(eq(schema.patients.id, report.patientId)).limit(1);
  const res = runConsistencyCheck({
    accession: report.accession, studyUid: study?.studyUid ?? report.accession, modality: study?.modality ?? 'DX', bodyPart: study?.bodyPart ?? 'chest', laterality: study?.laterality ?? null, sex: pat?.sex ?? null,
    priorsCount: (study?.priorIds ?? []).length, sections: report.sections as unknown as Record<string, string>,
    candidates: (report.candidates ?? []).map((x) => ({ code: x.code, display: x.display, laterality: x.laterality, decision: x.decision, flag: x.flag })),
  });
  return res;
}

export async function latestSignedForStudy(services: Services, studyId: string) {
  const rows = await services.db.select().from(schema.reports).where(and(eq(schema.reports.studyId, studyId), inArray(schema.reports.status, ['signed', 'amended']))).orderBy(desc(schema.reports.version)).limit(1);
  return rows[0] ?? null;
}
