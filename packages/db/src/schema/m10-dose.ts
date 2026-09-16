import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, practiceId, json, bool } from './_helpers.js';

/**
 * Dose record per study (immutable; corrections create a new version). Quantities are stored ×1000
 * as integers: DLP mGy·cm ×1000, DAP Gy·cm² ×1000, AGD mGy ×1000, CTDIvol mGy ×1000, effective mSv ×1000.
 */
export const doseRecords = sqliteTable(
  'dose_records',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id'),
    studyId: text('study_id').notNull(),
    accession: text('accession').notNull(),
    patientId: text('patient_id').notNull(),
    modality: text('modality').notNull(),
    protocolId: text('protocol_id'),
    protocolCode: text('protocol_code').notNull(),
    quantity: text('quantity').notNull(), // DLP | DAP | AGD
    valueX1000: integer('value_x1000').notNull(),
    ctdiVolX1000: integer('ctdivol_x1000'),
    effectiveMsvX1000: integer('effective_msv_x1000'),
    sizeClass: text('size_class').notNull().default('standard'), // paediatric | small | standard | large
    drlValueX1000: integer('drl_value_x1000'),
    drlSource: text('drl_source'), // national | practice | site
    ratioPct: integer('ratio_pct'), // value / DRL ×100
    outlier: bool('outlier').notNull().default(false),
    alertLevel: text('alert_level').notNull().default('none'), // none | above_drl | above_threshold
    likelyCause: text('likely_cause'),
    pregnancyDeclared: text('pregnancy_declared'), // no | yes | not_sure | n/a
    justification: text('justification'),
    justifiedBy: text('justified_by'),
    reviewedBy: text('reviewed_by'), // RPO closure
    reviewedAt: text('reviewed_at'),
    source: text('source').notNull().default('rdsr'), // rdsr | header | manual | sim
    technologistUserId: text('technologist_user_id'),
    repeats: integer('repeats').notNull().default(0),
    version: integer('version').notNull().default(1),
    supersedesId: text('supersedes_id'),
    createdAt: createdAt(),
  },
  (t) => [index('dose_study').on(t.studyId), index('dose_site').on(t.siteId, t.createdAt), index('dose_patient').on(t.patientId)],
);

/** Personal dosimetry register: badge cycles per worker (special personal information, role-limited). */
export const dosimetry = sqliteTable(
  'dosimetry',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    userId: text('user_id'),
    staffName: text('staff_name').notNull(),
    role: text('role').notNull(),
    badgeType: text('badge_type').notNull().default('OSL'), // TLD | OSL
    badgePlacement: text('badge_placement').notNull().default('body'), // body | extremity
    cycle: text('cycle').notNull(), // YYYY-MM (monthly) or YYYY-Qn
    issuedAt: text('issued_at').notNull(),
    dueBackAt: text('due_back_at').notNull(),
    returnedAt: text('returned_at'),
    resultUsv: integer('result_usv'), // µSv
    investigationLevelUsv: integer('investigation_level_usv').notNull().default(500),
    status: text('status').notNull().default('issued'), // issued | returned | resulted | late | investigation
    rpoSignedBy: text('rpo_signed_by'),
    rpoSignedAt: text('rpo_signed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('dosimetry_site_cycle').on(t.siteId, t.cycle)],
);

/** QA schedule per room: tests, evidence, RPO sign-off; overdue blocking tests block the room (M02-R-006). */
export const qaTests = sqliteTable(
  'qa_tests',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id').notNull(),
    modalityType: text('modality_type').notNull(),
    testType: text('test_type').notNull(), // daily_phantom | weekly_phantom | detector_calibration | mg_phantom | ct_water | mr_snr | display_gsdf | annual_compliance | acceptance | shielding_survey | mri_safety_audit
    frequency: text('frequency').notNull(), // daily | weekly | monthly | annual | event
    blocking: bool('blocking').notNull().default(false),
    dueAt: text('due_at').notNull(),
    doneAt: text('done_at'),
    result: text('result'), // pass | fail
    values: json<Record<string, number | string>>('values'),
    performedBy: text('performed_by'),
    rpoSignedBy: text('rpo_signed_by'),
    rpoSignedAt: text('rpo_signed_at'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('qa_room_due').on(t.roomId, t.dueAt), index('qa_site').on(t.siteId, t.dueAt)],
);
