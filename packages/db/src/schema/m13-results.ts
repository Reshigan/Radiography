import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, practiceId, json } from './_helpers.js';

/** One row per report, recipient and channel with receipts (sent → delivered → opened → acknowledged). */
export const resultDeliveries = sqliteTable(
  'result_deliveries',
  {
    id: id(),
    practiceId: practiceId(),
    reportId: text('report_id').notNull(),
    studyId: text('study_id').notNull(),
    referrerId: text('referrer_id'),
    patientId: text('patient_id'),
    recipientType: text('recipient_type').notNull(), // referrer | patient | ward
    channel: text('channel').notNull(), // referrer_portal | whatsapp | hl7 | pdf | patient_space | email
    recipientMasked: text('recipient_masked'),
    status: text('status').notNull().default('sent'), // sent | delivered | opened | acknowledged | failed | withheld
    sentAt: text('sent_at').notNull(),
    deliveredAt: text('delivered_at'),
    openedAt: text('opened_at'),
    acknowledgedAt: text('acknowledged_at'),
    acknowledgedBy: text('acknowledged_by'),
    amendment: integer('amendment').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('deliv_report').on(t.reportId), index('deliv_referrer').on(t.referrerId, t.status)],
);

/** Critical result communication loop (process 08 §7.2). */
export const criticalResults = sqliteTable(
  'critical_results',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    reportId: text('report_id').notNull(),
    studyId: text('study_id').notNull(),
    accession: text('accession').notNull(),
    patientId: text('patient_id').notNull(),
    referrerId: text('referrer_id'),
    radiologistUserId: text('radiologist_user_id').notNull(),
    category: text('category').notNull(), // critical | urgent | unexpected_significant | reportable:<code>
    windowMinutes: integer('window_minutes').notNull().default(30),
    contactChain: json<Array<{ step: number; role: string; name: string; phoneMasked?: string; channel: string[] }>>('contact_chain').notNull(),
    attempts: json<Array<{ at: string; step: number; channel: string; to: string; outcome: string; by: string; callId?: string }>>('attempts').notNull(),
    escalationLevel: integer('escalation_level').notNull().default(0),
    status: text('status').notNull().default('open'), // open | escalated | acknowledged | closed
    openedAt: text('opened_at').notNull(),
    acknowledgedBy: text('acknowledged_by'),
    acknowledgedAt: text('acknowledged_at'),
    acknowledgementChannel: text('acknowledgement_channel'),
    closedAt: text('closed_at'),
    handTaskId: text('hand_task_id'),
    takenOverBy: text('taken_over_by'),
    createdAt: createdAt(),
  },
  (t) => [index('crit_status').on(t.practiceId, t.status), index('crit_report').on(t.reportId)],
);

/** Follow-up recommendations tracked to closure (process 08 §11). */
export const followups = sqliteTable(
  'followups',
  {
    id: id(),
    practiceId: practiceId(),
    reportId: text('report_id').notNull(),
    studyId: text('study_id').notNull(),
    patientId: text('patient_id').notNull(),
    referrerId: text('referrer_id'),
    what: text('what').notNull(),
    whenText: text('when_text').notNull(),
    why: text('why').notNull(),
    who: text('who').notNull().default('referrer'),
    scheduleSource: text('schedule_source'),
    dueAt: text('due_at').notNull(),
    status: text('status').notNull().default('open'), // open | reminded | overdue | closed | lost
    reminders: json<Array<{ at: string; channel: string; to: string; kind: string }>>('reminders').notNull(),
    closedReason: text('closed_reason'), // performed | not_indicated | managed_elsewhere | patient_declined | deceased | transferred
    closedEvidence: text('closed_evidence'),
    closedBy: text('closed_by'),
    closedAt: text('closed_at'),
    escalatedTo: text('escalated_to'),
    createdAt: createdAt(),
  },
  (t) => [index('fu_status').on(t.practiceId, t.status, t.dueAt), index('fu_referrer').on(t.referrerId)],
);

/** Notification log: never clinical content; recipient masked. */
export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    practiceId: practiceId(),
    channel: text('channel').notNull(), // whatsapp | sms | email | portal | call
    recipientType: text('recipient_type').notNull(), // referrer | patient | prm | rgt
    recipientMasked: text('recipient_masked').notNull(),
    template: text('template').notNull(),
    body: text('body').notNull(),
    relatedType: text('related_type'),
    relatedId: text('related_id'),
    status: text('status').notNull().default('sent'), // sent | delivered | read | failed
    sentAt: text('sent_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('notif_related').on(t.relatedType, t.relatedId)],
);
