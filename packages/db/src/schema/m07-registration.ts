import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, json, bool, cents } from './_helpers.js';

export interface CollectSnapshot {
  totalCents: number;
  schemePortionCents: number;
  patientPortionCents: number;
  previousBalanceCents: number;
  depositsPaidCents: number;
  collectNowCents: number;
  reasonCodes: string[];
  quoteVersion?: number;
}

/** A visit (encounter): pre-check-in through arrival, queue and completion (docs/processes/04 §7.2). */
export const encounters = sqliteTable(
  'encounters',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    appointmentId: text('appointment_id'),
    orderId: text('order_id').notNull(),
    patientId: text('patient_id').notNull(),
    status: text('status').notNull().default('pre_checked_in'), // pre_checked_in | arrived | waiting | called | in_room | done | left | cancelled
    channel: text('channel').notNull().default('patient_space'), // patient_space | whatsapp | kiosk | desk | adt
    arrivedAt: text('arrived_at'),
    identityLevel: integer('identity_level').notNull().default(0), // 0 asserted | 1 documented | 2 verified | 3 biometric
    identityVerifiedAt: text('identity_verified_at'),
    identityEvidence: text('identity_evidence'),
    schemeCardCaptured: bool('scheme_card_captured').notNull().default(false),
    language: text('language'),
    interpreter: text('interpreter'),
    chaperone: bool('chaperone').notNull().default(false),
    accessibility: text('accessibility'),
    infectionControl: text('infection_control'),
    queueTicket: text('queue_ticket'),
    queueRoom: text('queue_room'),
    calledAt: text('called_at'),
    inRoomAt: text('in_room_at'),
    doneAt: text('done_at'),
    waitMinutes: integer('wait_minutes'),
    collect: json<CollectSnapshot>('collect'),
    collectedCents: cents('collected_cents').notNull().default(0),
    stillNeeded: json<string[]>('still_needed'),
    gateOverride: json<{ by: string; persona: string; reason: string; at: string; items: string[] }>('gate_override'),
    wristbandId: text('wristband_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('encounters_site_status').on(t.siteId, t.status), index('encounters_appointment').on(t.appointmentId), index('encounters_patient').on(t.patientId)],
);

/** Per-encounter safety questionnaire set with computed clearance. */
export const safetyQuestionnaires = sqliteTable(
  'safety_questionnaires',
  {
    id: id(),
    practiceId: practiceId(),
    encounterId: text('encounter_id').notNull(),
    patientId: text('patient_id').notNull(),
    set: text('set').notNull(), // ionising | mri | contrast | sedation
    version: text('version').notNull().default('2026.1'),
    answers: json<Record<string, string | number | boolean | null>>('answers').notNull(),
    completeness: integer('completeness').notNull().default(0), // 0..100
    status: text('status').notNull().default('not_started'), // not_started | answered | needs_review | cleared | cleared_with_conditions | blocked | overridden
    blockingItems: json<string[]>('blocking_items').notNull(),
    conditions: json<string[]>('conditions'),
    answeredBy: text('answered_by'), // patient | guardian | clinician
    answeredVia: text('answered_via'), // patient_space | kiosk | desk | whatsapp
    clearedBy: text('cleared_by'),
    clearedAt: text('cleared_at'),
    clearanceNote: text('clearance_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('safety_encounter').on(t.encounterId)],
);

export const consents = sqliteTable(
  'consents',
  {
    id: id(),
    practiceId: practiceId(),
    encounterId: text('encounter_id').notNull(),
    patientId: text('patient_id').notNull(),
    type: text('type').notNull(), // imaging | contrast | sedation | popia | whatsapp | sharing | research
    version: text('version').notNull().default('2026.1'),
    language: text('language').notNull().default('en'),
    granted: bool('granted').notNull().default(true),
    signedVia: text('signed_via').notNull(), // patient_space | kiosk | desk | whatsapp
    signerRelationship: text('signer_relationship').notNull().default('self'),
    evidence: text('evidence'), // 'signature' | 'otp:…' | 'tap'
    signedAt: text('signed_at').notNull(),
    withdrawnAt: text('withdrawn_at'),
    createdAt: createdAt(),
  },
  (t) => [index('consents_encounter').on(t.encounterId)],
);

/** Public queue tickets (no names on the display). */
export const queueTickets = sqliteTable(
  'queue_tickets',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    encounterId: text('encounter_id').notNull(),
    ticket: text('ticket').notNull(), // e.g. A-014
    roomType: text('room_type').notNull(),
    room: text('room'),
    status: text('status').notNull().default('waiting'), // waiting | called | in_room | done
    issuedAt: text('issued_at').notNull(),
    calledAt: text('called_at'),
    estimatedWaitMinutes: integer('estimated_wait_minutes'),
    createdAt: createdAt(),
  },
  (t) => [index('queue_site_status').on(t.siteId, t.status)],
);
