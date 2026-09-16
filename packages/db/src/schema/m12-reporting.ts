import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, practiceIdNullable, json, bool } from './_helpers.js';

export interface ReportSections { clinicalInfo: string; technique: string; comparison: string; findings: string; impression: string; recommendation: string }
export interface ReportCandidate {
  id: string; // '<inferenceResultId>:<code>'
  inferenceResultId: string;
  modelId: string;
  modelVersion: string;
  code: string;
  display: string;
  laterality?: string;
  score: number;
  flag: boolean;
  candidateText?: string;
  localisation?: { type: string; bbox?: [number, number, number, number]; ref?: string | number };
  decision: 'pending' | 'accepted' | 'edited' | 'rejected';
  editedText?: string;
  reason?: string;
  decidedBy?: string;
  decidedAt?: string;
}
export interface StructuredFinding { code: string; display: string; laterality?: string; text: string; source: 'candidate' | 'dictation' | 'template'; provenance?: { modelId: string; modelVersion: string; confidence: number; acceptedBy: string; acceptedAt: string }; incidental?: boolean }
export interface FollowupItem { what: string; when: string; why: string; who: string; dueAt: string; source?: string }

/** Reports: draft → prelim → signed → amended. Only `sign` publishes text (Class 1 gate). */
export const reports = sqliteTable(
  'reports',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    studyId: text('study_id').notNull(),
    accession: text('accession').notNull(),
    patientId: text('patient_id').notNull(),
    referrerId: text('referrer_id'),
    radiologistUserId: text('radiologist_user_id'),
    status: text('status').notNull().default('draft'), // draft | prelim | signed | amended | superseded
    templateId: text('template_id'),
    sections: json<ReportSections>('sections').notNull(),
    structuredFindings: json<StructuredFinding[]>('structured_findings').notNull(),
    candidates: json<ReportCandidate[]>('candidates').notNull(),
    followups: json<FollowupItem[]>('followups').notNull(),
    draftProvenance: json<{ modelId: string; modelVersion: string; outputClass: number; createdAt: string; llmUsed: boolean; inputsHash: string; reviewed: boolean }>('draft_provenance'),
    critical: bool('critical').notNull().default(false),
    criticalCategory: text('critical_category'), // critical | urgent | unexpected_significant
    reportableCategories: json<string[]>('reportable_categories').notNull(),
    consistencyWarnings: json<Array<{ check: string; status: string; detail: string }>>('consistency_warnings'),
    warningsAcknowledged: bool('warnings_acknowledged').notNull().default(false),
    warningsAckReason: text('warnings_ack_reason'),
    priority: text('priority').notNull().default('routine'), // stat | urgent | routine
    subspecialty: text('subspecialty'),
    claimedBy: text('claimed_by'),
    claimedAt: text('claimed_at'),
    lockExpiresAt: text('lock_expires_at'),
    signedAt: text('signed_at'),
    signedHpcsaNo: text('signed_hpcsa_no'),
    readingTimeSec: integer('reading_time_sec'),
    readingRvuX100: integer('reading_rvu_x100'),
    readingFeeCents: integer('reading_fee_cents'),
    version: integer('version').notNull().default(1),
    supersedesId: text('supersedes_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reports_study').on(t.studyId), index('reports_status').on(t.practiceId, t.status), index('reports_referrer').on(t.referrerId, t.signedAt), index('reports_patient').on(t.patientId, t.signedAt)],
);

export const reportTemplates = sqliteTable(
  'report_templates',
  {
    id: id(),
    practiceId: practiceIdNullable(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    modality: text('modality').notNull(),
    bodyPart: text('body_part').notNull(),
    sections: json<Partial<ReportSections>>('sections').notNull(),
    mandatoryFields: json<string[]>('mandatory_fields').notNull(),
    pickLists: json<Record<string, string[]>>('pick_lists'),
    icd10Prompts: json<string[]>('icd10_prompts'),
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [index('templates_modality').on(t.modality, t.bodyPart)],
);

/** Peer review: randomised stratified sample, blinded score (1, 2a, 2b, 3a, 3b), discrepancy category. */
export const peerReviews = sqliteTable(
  'peer_reviews',
  {
    id: id(),
    practiceId: practiceId(),
    reportId: text('report_id').notNull(),
    studyId: text('study_id').notNull(),
    originalRadiologistUserId: text('original_radiologist_user_id').notNull(),
    reviewerUserId: text('reviewer_user_id').notNull(),
    status: text('status').notNull().default('pending'), // pending | scored | routed
    score: text('score'), // 1 | 2a | 2b | 3a | 3b
    category: text('category'), // perception | interpretation | communication | technical | followup
    notes: text('notes'),
    blindedImpression: text('blinded_impression'),
    sampledAt: createdAt(),
    scoredAt: text('scored_at'),
  },
  (t) => [index('peer_reviewer').on(t.reviewerUserId, t.status)],
);

export const addenda = sqliteTable(
  'addenda',
  {
    id: id(),
    practiceId: practiceId(),
    reportId: text('report_id').notNull(),
    authorUserId: text('author_user_id').notNull(),
    kind: text('kind').notNull().default('addendum'), // addendum | correction
    text: text('text').notNull(),
    reason: text('reason').notNull(),
    signedAt: text('signed_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('addenda_report').on(t.reportId)],
);
