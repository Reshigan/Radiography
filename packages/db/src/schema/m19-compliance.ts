import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, practiceIdNullable, json, bool } from './_helpers.js';

/* ---------- M19 Quality, Risk & Compliance ---------- */

/** Statutory register (docs/24 §2): effective-dated reference data with owner, trigger, control, output, evidence. */
export const obligations = sqliteTable(
  'obligations',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id'),
    domain: text('domain').notNull(), // clinical | radiation | devices_ai | information | funders | corporate | employment
    instrument: text('instrument').notNull(),
    section: text('section'),
    obligation: text('obligation').notNull(),
    responsibleEntity: text('responsible_entity').notNull(), // Group | MSO | Practice | Site | Practitioner
    ownerPersona: text('owner_persona').notNull(), // CMP | PRM | EXE | RGT | RAD | BIL | AIO | BIO
    trigger: text('trigger'),
    control: text('control'),
    output: text('output'),
    evidence: text('evidence'),
    automation: text('automation').notNull().default('A2'),
    status: text('status').notNull().default('confirmed'), // confirmed | confirm
    frequency: text('frequency').notNull().default('annual'), // once | annual | monthly | quarterly | per_event | continuous
    dueDate: text('due_date'),
    lastDoneAt: text('last_done_at'),
    evidenceRefs: json<string[]>('evidence_refs'),
    submissionRef: text('submission_ref'),
    version: integer('version').notNull().default(1),
    effectiveFrom: text('effective_from').notNull().default('2026-01-01'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('obligations_due').on(t.practiceId, t.dueDate)],
);

/** Calendar items generated from obligations with 90/60/30/7-day leads. */
export const obligationEvents = sqliteTable(
  'obligation_events',
  {
    id: id(),
    practiceId: practiceId(),
    obligationId: text('obligation_id').notNull(),
    dueDate: text('due_date').notNull(),
    leadDays: integer('lead_days').notNull(), // 90 | 60 | 30 | 7 | 0
    fireDate: text('fire_date').notNull(),
    title: text('title').notNull(),
    assignee: text('assignee'),
    status: text('status').notNull().default('pending'), // pending | notified | done | overdue
    createdAt: createdAt(),
  },
  (t) => [index('obligation_events_fire').on(t.practiceId, t.fireDate)],
);

export const incidents = sqliteTable(
  'incidents',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id'),
    ref: text('ref').notNull(), // INC-2609-031
    category: text('category').notNull(), // radiation_wrong_patient | radiation_wrong_site | radiation_overexposure | contrast_reaction | data_breach | mri_safety | fall | needle_stick | equipment | critical_result_failure | ai_performance | near_miss
    severity: integer('severity').notNull().default(3), // 1 highest … 4 lowest
    title: text('title').notNull(),
    description: text('description'),
    occurredAt: text('occurred_at').notNull(),
    reportedAt: text('reported_at').notNull(),
    reportedBy: text('reported_by'),
    patientMasked: text('patient_masked'),
    patientId: text('patient_id'),
    modalityId: text('modality_id'),
    roomId: text('room_id'),
    status: text('status').notNull().default('open'), // open | investigating | awaiting_cmp | closed
    timeline: json<Array<{ at: string; text: string; kind?: 'ok' | 'crit' | 'ai' | 'neutral'; source?: string }>>('timeline').notNull(),
    immediateActions: json<Array<{ item: string; done: boolean; at?: string }>>('immediate_actions'),
    rca: json<{ method: string; factors: Array<{ factor: string; finding: string }>; conclusion?: string; investigator?: string } | null>('rca'),
    correctiveActions: json<Array<{ action: string; owner: string; due: string; status: 'open' | 'done'; effectivenessCheck?: string }>>('corrective_actions'),
    disclosure: json<{ patient?: string; referrer?: string; scheme?: string; regulator?: string }>('disclosure'),
    regulator: text('regulator'), // SAHPRA | Information Regulator | DoEL | HPCSA | none
    reportDraft: json<{ status: 'none' | 'draft' | 'awaiting_cmp' | 'submitted'; text?: string; provenance?: Record<string, unknown>; draftedAt?: string; submittedBy?: string; submittedAt?: string; reference?: string; editedBy?: string }>('report_draft'),
    learningSummary: text('learning_summary'),
    linkedRefs: json<string[]>('linked_refs'),
    closedAt: text('closed_at'),
    closedBy: text('closed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('incidents_status').on(t.practiceId, t.status), index('incidents_ref').on(t.ref)],
);

export const complaints = sqliteTable('complaints', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id'),
  ref: text('ref').notNull(),
  channel: text('channel').notNull(), // patient_space | whatsapp | front_desk | referrer | scheme | hpcsa | cms | ombud | social
  route: text('route').notNull().default('internal'), // internal | CPA | HPCSA | CMS
  category: text('category').notNull(), // clinical | service | billing | privacy | facility | conduct
  complainantMasked: text('complainant_masked'),
  subject: text('subject').notNull(),
  detail: text('detail'),
  severity: text('severity').notNull().default('minor'), // minor | moderate | major
  receivedAt: text('received_at').notNull(),
  acknowledgeBy: text('acknowledge_by').notNull(),
  acknowledgedAt: text('acknowledged_at'),
  respondBy: text('respond_by').notNull(),
  respondedAt: text('responded_at'),
  status: text('status').notNull().default('received'), // received | acknowledged | investigating | responded | closed
  externalRef: text('external_ref'),
  linkedRef: text('linked_ref'),
  legalHold: bool('legal_hold').notNull().default(false),
  responseDraft: json<{ text: string; provenance: Record<string, unknown>; accepted?: boolean }>('response_draft'),
  incidentId: text('incident_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** POPIA / PAIA data-subject requests with statutory (30 d illustrative) and policy clocks. */
export const dataSubjectRequests = sqliteTable('data_subject_requests', {
  id: id(),
  practiceId: practiceId(),
  ref: text('ref').notNull(),
  type: text('type').notNull(), // access | correction | deletion | objection | paia
  requesterMasked: text('requester_masked').notNull(),
  patientId: text('patient_id'),
  channel: text('channel').notNull().default('patient_space'),
  identityVerified: bool('identity_verified').notNull().default(false),
  receivedAt: text('received_at').notNull(),
  statutoryDays: integer('statutory_days').notNull().default(30),
  statutoryDueAt: text('statutory_due_at').notNull(),
  policyDays: integer('policy_days').notNull().default(14),
  policyDueAt: text('policy_due_at').notNull(),
  status: text('status').notNull().default('received'), // received | verifying | collecting | awaiting_approval | fulfilled | refused | extended
  checklist: json<Array<{ item: string; done: boolean; at?: string }>>('checklist').notNull(),
  redactions: json<Array<{ item: string; ground: string }>>('redactions'),
  releasedBy: text('released_by'),
  fulfilledAt: text('fulfilled_at'),
  extensionReason: text('extension_reason'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const audits = sqliteTable('audits', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id'),
  ref: text('ref').notNull(),
  type: text('type').notNull(), // internal | funder | regulator | accreditation | popia | ai
  scope: text('scope').notNull(),
  auditor: text('auditor'),
  scheduledAt: text('scheduled_at'),
  completedAt: text('completed_at'),
  status: text('status').notNull().default('planned'), // planned | in_progress | reported | closed
  checklist: json<Array<{ item: string; result: 'pass' | 'fail' | 'na' | 'pending'; evidence?: string }>>('checklist'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditFindings = sqliteTable('audit_findings', {
  id: id(),
  practiceId: practiceId(),
  auditId: text('audit_id').notNull(),
  grade: text('grade').notNull(), // major | minor | observation
  description: text('description').notNull(),
  owner: text('owner'),
  dueDate: text('due_date'),
  status: text('status').notNull().default('open'), // open | closed
  capa: text('capa'),
  closedAt: text('closed_at'),
  createdAt: createdAt(),
});

export const policies = sqliteTable('policies', {
  id: id(),
  practiceId: practiceIdNullable(), // null = Group-wide
  title: text('title').notNull(),
  category: text('category').notNull(), // clinical | information | people | commercial
  version: integer('version').notNull().default(1),
  effectiveDate: text('effective_date').notNull(),
  reviewDue: text('review_due'),
  owner: text('owner'),
  appliesTo: json<string[]>('applies_to'), // roles
  mandatory: bool('mandatory').notNull().default(true),
  status: text('status').notNull().default('approved'), // draft | approved | obsolete
  summary: text('summary'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const policyAcknowledgements = sqliteTable(
  'policy_acknowledgements',
  {
    id: id(),
    practiceId: practiceId(),
    policyId: text('policy_id').notNull(),
    staffId: text('staff_id').notNull(),
    version: integer('version').notNull(),
    acknowledgedAt: text('acknowledged_at').notNull(),
    method: text('method').notNull().default('in_app'),
    createdAt: createdAt(),
  },
  (t) => [index('policy_ack_policy').on(t.policyId)],
);

/** Reportable imaging results (docs/24 §3): flag raised at sign-off, tracked to acknowledgement and closure. */
export const reportableResults = sqliteTable(
  'reportable_results',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id'),
    ref: text('ref').notNull(), // RR-2609-014
    category: text('category').notNull(), // tb_suggestive | nai_child | elder_abuse | occupational_lung | radiation_incident | malignancy_followup | nmc_other
    categoryLabel: text('category_label').notNull(),
    patientMasked: text('patient_masked'),
    patientId: text('patient_id'),
    reportId: text('report_id'),
    studyId: text('study_id'),
    accession: text('accession'),
    referrerId: text('referrer_id'),
    referrerName: text('referrer_name'),
    ackWindowHours: integer('ack_window_hours').notNull().default(24),
    ackDueAt: text('ack_due_at').notNull(),
    ackAt: text('ack_at'),
    ackBy: text('ack_by'),
    packName: text('pack_name'),
    packSentAt: text('pack_sent_at'),
    packChannel: text('pack_channel'),
    status: text('status').notNull().default('open'), // open | acknowledged | closed
    patientReleaseWithheld: bool('patient_release_withheld').notNull().default(false),
    escalations: integer('escalations').notNull().default(0),
    lastEscalatedAt: text('last_escalated_at'),
    linkedIncidentId: text('linked_incident_id'),
    notes: text('notes'),
    closedAt: text('closed_at'),
    closedBy: text('closed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reportable_results_status').on(t.practiceId, t.status)],
);

export const evidencePacks = sqliteTable('evidence_packs', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id'),
  kind: text('kind').notNull(), // sahpra | hpcsa | popia | ohsc | cms | accreditation | internal
  title: text('title').notNull(),
  status: text('status').notNull().default('ready'), // draft | ready
  manifest: json<{ generatedAt: string; definitionsVersion: string; auditRange: { from: string; to: string }; items: Array<{ section: string; source: string; count: number; hash: string; note?: string }> }>('manifest').notNull(),
  html: text('html'),
  generatedBy: text('generated_by'),
  handTaskId: text('hand_task_id'),
  createdAt: createdAt(),
});
