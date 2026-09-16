import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, json, bool } from './_helpers.js';

/** A requested procedure on an Order (catalogue-mapped). */
export interface OrderProcedure {
  code: string;
  description: string;
  modality: string; // XR | CT | MR | US | MG | DXA
  bodyPart: string;
  laterality?: 'left' | 'right' | 'bilateral' | 'na';
  contrast?: boolean;
  tariffCode?: string;
  durationMin?: number;
  ionising?: boolean;
}

/** Field-level extraction result from the Referral Hand (docs/processes/01 §7.10). */
export interface ParsedReferral {
  modality?: string;
  bodyPart?: string;
  procedureCode?: string;
  procedureDescription?: string;
  laterality?: 'left' | 'right' | 'bilateral' | 'na';
  contrast?: boolean;
  urgency?: 'routine' | 'priority' | 'urgent' | 'stat';
  referrerName?: string;
  referrerHpcsa?: string;
  referrerPracticeNo?: string;
  referrerId?: string;
  patientName?: string;
  patientIdNumber?: string;
  patientMobile?: string;
  clinicalInfo?: string;
  icd10: string[];
  fields: Record<string, { value: unknown; confidence: number; source: 'rules' | 'llm' | 'human' }>;
  confidence: number;
  missing: string[];
  modelId: string;
  modelVersion: string;
}

/** Inbound referral artefacts from every channel; the Order is created from a referral once matched. */
export const referrals = sqliteTable(
  'referrals',
  {
    id: id(),
    practiceId: practiceId(),
    channel: text('channel').notNull(), // portal | whatsapp | paper_photo | fax | email | phone | fhir | walk_in
    sourceName: text('source_name'),
    sourceContact: text('source_contact'), // mobile / email of the sender
    rawText: text('raw_text'),
    photoText: text('photo_text'), // OCR text of a photographed referral (demo: typed)
    artefactHash: text('artefact_hash'),
    patientId: text('patient_id'),
    referrerId: text('referrer_id'),
    parsed: json<ParsedReferral>('parsed'),
    confidence: integer('confidence'), // 0..100
    status: text('status').notNull().default('received'), // received | matched | needs_info | converted | rejected
    needsInfo: json<string[]>('needs_info'),
    orderId: text('order_id'),
    taskId: text('task_id'),
    rejectReason: text('reject_reason'),
    receivedAt: text('received_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('referrals_practice_status').on(t.practiceId, t.status), index('referrals_patient').on(t.patientId)],
);

export interface AppropriatenessResult {
  band: 'usually_appropriate' | 'may_be_appropriate' | 'usually_not_appropriate';
  ruleId: string;
  guidance: string;
  alternative?: string;
  guidelinePack: string;
  overrideReason?: string;
  overriddenBy?: string;
}

export interface RecentStudyAlert {
  found: boolean;
  matches: Array<{ source: string; id: string; modality: string; bodyPart?: string; at: string }>;
  windowDays: number;
  resolvedBy?: string;
  resolution?: string;
}

export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    practiceId: practiceId(),
    orderNo: text('order_no').notNull(),
    siteId: text('site_id'), // preferred / booked site
    patientId: text('patient_id').notNull(),
    referrerId: text('referrer_id'),
    referralId: text('referral_id'),
    channel: text('channel').notNull().default('portal'),
    procedures: json<OrderProcedure[]>('procedures').notNull(),
    priority: text('priority').notNull().default('routine'), // routine | priority | urgent | stat
    icd10: json<string[]>('icd10').notNull(),
    clinicalInfo: text('clinical_info'),
    justification: text('justification').notNull().default('justified'), // justified | justified_pending_confirmation | not_justified
    justificationNote: text('justification_note'),
    appropriateness: json<AppropriatenessResult>('appropriateness'),
    recentStudy: json<RecentStudyAlert>('recent_study'),
    protocollingRequired: bool('protocolling_required').notNull().default(false),
    status: text('status').notNull().default('draft'), // draft | ordered | scheduled | arrived | in_progress | completed | cancelled
    appointmentId: text('appointment_id'),
    fundingCaseId: text('funding_case_id'),
    funderType: text('funder_type'), // scheme | cash | raf | coida | corporate
    cancelReason: text('cancel_reason'),
    createdBy: text('created_by'), // user id or 'hand:referral'
    validUntil: text('valid_until'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('orders_practice_status').on(t.practiceId, t.status), index('orders_patient').on(t.patientId), index('orders_referrer').on(t.referrerId)],
);
