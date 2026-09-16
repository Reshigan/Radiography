import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, json, bool } from './_helpers.js';

/** Study index (DICOM objects live in the ObjectStore under storagePrefix; only metadata is here). */
export const studies = sqliteTable(
  'studies',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id'),
    patientId: text('patient_id').notNull(),
    accession: text('accession').notNull(),
    studyUid: text('study_uid').notNull(),
    orderId: text('order_id'),
    appointmentId: text('appointment_id'),
    worklistItemId: text('worklist_item_id'),
    referrerId: text('referrer_id'),
    modality: text('modality').notNull(),
    procedureCode: text('procedure_code').notNull(),
    procedureDescription: text('procedure_description'),
    bodyPart: text('body_part').notNull(),
    laterality: text('laterality'),
    indication: text('indication'),
    priority: text('priority').notNull().default('routine'), // routine | urgent | stat
    status: text('status').notNull().default('received'), // received | complete | reported | cancelled
    seriesCount: integer('series_count').notNull().default(0),
    instanceCount: integer('instance_count').notNull().default(0),
    storagePrefix: text('storage_prefix').notNull(),
    priorIds: json<string[]>('prior_ids'),
    keyImageIds: json<string[]>('key_image_ids'),
    technologistNote: text('technologist_note'),
    technologistUserId: text('technologist_user_id'),
    retentionClass: text('retention_class').notNull().default('standard'), // standard | paediatric | occupational | legal_hold
    external: bool('external').notNull().default(false),
    unmatched: bool('unmatched').notNull().default(false),
    receivedAt: text('received_at').notNull(),
    completedAt: text('completed_at'),
    reportedAt: text('reported_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('studies_accession').on(t.accession), index('studies_patient').on(t.patientId, t.receivedAt), index('studies_practice_status').on(t.practiceId, t.status), index('studies_site_day').on(t.siteId, t.receivedAt)],
);

export const series = sqliteTable(
  'series',
  {
    id: id(),
    practiceId: practiceId(),
    studyId: text('study_id').notNull(),
    seriesUid: text('series_uid').notNull(),
    number: integer('number').notNull(),
    description: text('description').notNull(),
    modality: text('modality').notNull(),
    view: text('view'),
    instanceCount: integer('instance_count').notNull().default(0),
    rejected: bool('rejected').notNull().default(false), // rejected series are retained, excluded from reading and distribution
    createdAt: createdAt(),
  },
  (t) => [index('series_study').on(t.studyId)],
);

/** Instance metadata; pixel data is a synthetic rendering stored (or lazily generated) at storageKey. */
export const instances = sqliteTable(
  'instances',
  {
    id: id(),
    practiceId: practiceId(),
    studyId: text('study_id').notNull(),
    seriesId: text('series_id').notNull(),
    sopUid: text('sop_uid').notNull(),
    number: integer('number').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull().default('image/svg+xml'),
    rows: integer('rows').notNull().default(512),
    cols: integer('cols').notNull().default(512),
    view: text('view'),
    laterality: text('laterality'),
    rejected: bool('rejected').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('instances_study').on(t.studyId), index('instances_series').on(t.seriesId)],
);

/** Time-bound, audited sharing links (process 06 §11.4). */
export const shareLinks = sqliteTable(
  'share_links',
  {
    id: id(),
    practiceId: practiceId(),
    studyId: text('study_id').notNull(),
    reportId: text('report_id'),
    token: text('token').notNull(),
    scope: text('scope').notNull().default('study'), // study | key_images | report
    createdBy: text('created_by').notNull(),
    createdByPersona: text('created_by_persona'),
    recipientName: text('recipient_name').notNull(),
    recipientMobileMasked: text('recipient_mobile_masked'),
    consentBasis: text('consent_basis').notNull(), // patient_initiated | referrer_under_referral | third_party_with_consent
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    opens: json<Array<{ at: string; otpVerified: boolean }>>('opens').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('share_token').on(t.token), index('share_study').on(t.studyId)],
);
