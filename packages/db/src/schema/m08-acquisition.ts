import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, practiceIdNullable, json, bool } from './_helpers.js';

/** Modality Worklist entries (one Scheduled Procedure Step per order item). Other clusters' ids are plain text. */
export const worklistItems = sqliteTable(
  'worklist_items',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id').notNull(),
    modalityType: text('modality_type').notNull(), // DX | CT | MR | US | MG | DXA
    orderId: text('order_id'),
    appointmentId: text('appointment_id'),
    patientId: text('patient_id').notNull(),
    patientName: text('patient_name'), // MWL snapshot; the DICOM Patient ID is the MPI id, never the SA ID
    referrerId: text('referrer_id'),
    procedureCode: text('procedure_code').notNull(),
    procedureDescription: text('procedure_description'),
    bodyPart: text('body_part'),
    laterality: text('laterality'),
    contrast: bool('contrast').notNull().default(false),
    priority: text('priority').notNull().default('routine'), // routine | urgent | stat
    indication: text('indication'),
    scheduledAt: text('scheduled_at').notNull(),
    status: text('status').notNull().default('scheduled'), // scheduled | arrived | in_room | in_progress | completed | cancelled | not_performed
    protocolId: text('protocol_id'),
    protocolSource: text('protocol_source'), // hand | rgt | rad | standing_rule
    protocolProvenance: json<{ modelId: string; modelVersion: string; confidence: number; reasons: string[]; acceptedBy?: string; acceptedAt?: string }>('protocol_provenance'),
    safetyGate: json<{ allowed: boolean; reason: string; source: string; checkedAt: string; answers?: Record<string, string>; pregnancy?: string; egfr?: number | null; allergies?: string; metformin?: string; reconfirmedAt?: string; reconfirmedBy?: string }>('safety_gate'),
    identityCheck: json<{ identifiers: string[]; wristbandScanned: boolean; checkedBy: string; checkedAt: string; witness?: string }>('identity_check'),
    technologistUserId: text('technologist_user_id'),
    studyId: text('study_id'),
    accession: text('accession'),
    arrivedAt: text('arrived_at'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    cancelReason: text('cancel_reason'),
    technologistNote: text('technologist_note'),
    emergency: bool('emergency').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('wl_room_day').on(t.roomId, t.scheduledAt), index('wl_site').on(t.siteId, t.status), index('wl_appt').on(t.appointmentId)],
);

/** Protocol library per modality and body part (paediatric and contrast variants are separate entries). */
export const protocols = sqliteTable(
  'protocols',
  {
    id: id(),
    practiceId: practiceIdNullable(), // null = Group library
    code: text('code').notNull(),
    name: text('name').notNull(),
    modalityType: text('modality_type').notNull(),
    bodyPart: text('body_part').notNull(),
    procedureCodes: json<string[]>('procedure_codes').notNull(),
    ageBand: text('age_band').notNull().default('adult'), // adult | paediatric
    contrast: bool('contrast').notNull().default(false),
    parameters: json<Record<string, string | number>>('parameters').notNull(),
    expectedSeries: json<string[]>('expected_series').notNull(),
    drlQuantity: text('drl_quantity'), // DLP | DAP | AGD
    drlValue: integer('drl_value'), // stored ×1000 to keep integers (mGy·cm ×1000, Gy·cm² ×1000, mGy ×1000)
    contrastRule: json<{ agent: string; concentration: string; mlPerKg: number; maxMl: number; rateMlS: number; egfrMin: number }>('contrast_rule'),
    requiresRgt: bool('requires_rgt').notNull().default(false), // A1 modalities: radiologist protocolling
    standingRule: text('standing_rule'), // radiologist-approved standing rule id, if any
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('protocols_modality').on(t.modalityType, t.bodyPart)],
);

/** Repeat and reject events with mandatory reason codes; images are never deleted. */
export const repeatRejects = sqliteTable(
  'repeat_rejects',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id').notNull(),
    modalityType: text('modality_type').notNull(),
    worklistItemId: text('worklist_item_id'),
    studyId: text('study_id'),
    seriesId: text('series_id'),
    kind: text('kind').notNull().default('repeat'), // repeat | reject
    reasonCode: text('reason_code').notNull(), // positioning | exposure | motion | artefact | anatomy_cutoff | equipment | patient_movement | wrong_protocol | other
    reasonText: text('reason_text'),
    technologistUserId: text('technologist_user_id'),
    qcSuggested: bool('qc_suggested').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('rr_room').on(t.roomId, t.createdAt)],
);

/** Contrast administration record (M08-R-104): batch scan or documented manual reason. */
export const contrastAdministrations = sqliteTable(
  'contrast_administrations',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    worklistItemId: text('worklist_item_id').notNull(),
    studyId: text('study_id'),
    patientId: text('patient_id').notNull(),
    agent: text('agent').notNull(),
    concentration: text('concentration'),
    weightKg: integer('weight_kg'),
    egfr: integer('egfr'),
    volumePlannedMl: integer('volume_planned_ml'),
    volumeDeliveredMl: integer('volume_delivered_ml'),
    rateMlS: integer('rate_ml_s_x10'), // ×10
    batchNo: text('batch_no'),
    expiry: text('expiry'),
    manualReason: text('manual_reason'),
    status: text('status').notNull().default('planned'), // planned | administered | aborted
    administeredBy: text('administered_by'),
    administeredAt: text('administered_at'),
    reaction: json<{ severity: 'mild' | 'moderate' | 'severe'; symptoms: string; treatment: string; radiologistCalled: boolean; incidentId?: string; recordedBy: string; recordedAt: string }>('reaction'),
    createdAt: createdAt(),
  },
  (t) => [index('contrast_item').on(t.worklistItemId)],
);
