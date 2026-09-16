import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, json, bool } from './_helpers.js';

/** Weekly operating template per room (docs/processes/02 §7.1). Times are SAST 'HH:MM'. */
export const slotTemplates = sqliteTable(
  'slot_templates',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id').notNull(),
    modalityType: text('modality_type').notNull(), // XR | CT | MR | US | MG | DXA
    weekday: integer('weekday').notNull(), // 0 Sunday … 6 Saturday
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    slotMinutes: integer('slot_minutes').notNull(),
    durationByProcedure: json<Record<string, number>>('duration_by_procedure'),
    blockType: text('block_type').notNull().default('open'), // open | walkin | screening | inpatient
    walkInReservePct: integer('walk_in_reserve_pct').notNull().default(0),
    effectiveFrom: text('effective_from').notNull().default('2026-01-01'),
    effectiveTo: text('effective_to'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index('slot_templates_room_day').on(t.roomId, t.weekday)],
);

export const appointments = sqliteTable(
  'appointments',
  {
    id: id(),
    practiceId: practiceId(),
    orderId: text('order_id').notNull(),
    patientId: text('patient_id').notNull(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id').notNull(),
    modalityType: text('modality_type').notNull(),
    procedureCode: text('procedure_code').notNull(),
    procedureDescription: text('procedure_description'),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    status: text('status').notNull().default('held'), // held | booked | confirmed | arrived | in_room | done | no_show | cancelled | rescheduled
    source: text('source').notNull().default('desk'), // whatsapp | patient_space | desk | booking | referrer | hand | stat | walk_in
    bookedBy: text('booked_by'),
    holdExpiresAt: text('hold_expires_at'),
    remindersSent: json<Array<{ kind: string; at: string; channel: string }>>('reminders_sent'),
    noShowScore: integer('no_show_score'), // 0..100, Class 4 score, never shown to the patient
    noShowModel: text('no_show_model'),
    distanceKm: integer('distance_km'),
    constraintsEvaluated: json<string[]>('constraints_evaluated'),
    softOverrides: json<Array<{ rule: string; reason: string; by: string }>>('soft_overrides'),
    rescheduledFromId: text('rescheduled_from_id'),
    cancelReason: text('cancel_reason'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('appointments_room_time').on(t.roomId, t.startsAt), index('appointments_site_time').on(t.siteId, t.startsAt), index('appointments_patient').on(t.patientId), index('appointments_order').on(t.orderId)],
);

export const waitlist = sqliteTable(
  'waitlist',
  {
    id: id(),
    practiceId: practiceId(),
    orderId: text('order_id').notNull(),
    patientId: text('patient_id').notNull(),
    procedureCode: text('procedure_code').notNull(),
    modalityType: text('modality_type').notNull(),
    siteId: text('site_id'),
    radiusKm: integer('radius_km').notNull().default(30),
    priority: text('priority').notNull().default('routine'),
    earliestFrom: text('earliest_from'),
    flexibility: text('flexibility').notNull().default('any'), // any | mornings | afternoons | evenings
    status: text('status').notNull().default('open'), // open | offered | booked | withdrawn
    offeredAppointmentId: text('offered_appointment_id'),
    offerExpiresAt: text('offer_expires_at'),
    offersMade: integer('offers_made').notNull().default(0),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('waitlist_practice_status').on(t.practiceId, t.status)],
);

/** Reminder schedule records (T-48 h, T-24 h, T-3 h, post-visit). */
export const reminders = sqliteTable(
  'reminders',
  {
    id: id(),
    practiceId: practiceId(),
    appointmentId: text('appointment_id').notNull(),
    patientId: text('patient_id').notNull(),
    kind: text('kind').notNull(), // confirmation | t48 | t24 | t3 | post_visit | waitlist_offer
    channel: text('channel').notNull().default('whatsapp'),
    dueAt: text('due_at').notNull(),
    sentAt: text('sent_at'),
    status: text('status').notNull().default('scheduled'), // scheduled | sent | skipped
    text: text('text'),
    createdAt: createdAt(),
  },
  (t) => [index('reminders_due').on(t.status, t.dueAt)],
);

export interface ConversationMessage {
  dir: 'in' | 'out';
  text: string;
  at: string;
  buttons?: string[];
  by?: string; // 'patient' | 'hand:booking' | user id
}

/** Omnichannel conversations handled by the Booking Hand (WhatsApp simulator in demo). */
export const conversations = sqliteTable(
  'conversations',
  {
    id: id(),
    practiceId: practiceId(),
    channel: text('channel').notNull().default('whatsapp'),
    mobile: text('mobile').notNull(),
    patientId: text('patient_id'),
    referralId: text('referral_id'),
    orderId: text('order_id'),
    appointmentId: text('appointment_id'),
    state: text('state').notNull().default('new'), // new | awaiting_identity | awaiting_referral | awaiting_prescreen | awaiting_slot_choice | booked | handed_over | closed
    offers: json<Array<{ appointmentId: string; label: string; startsAt: string; siteId: string; roomId: string }>>('offers'),
    messages: json<ConversationMessage[]>('messages').notNull(),
    handedOverReason: text('handed_over_reason'),
    claimedBy: text('claimed_by'),
    lastTaskId: text('last_task_id'),
    misunderstandings: integer('misunderstandings').notNull().default(0),
    optIn: bool('opt_in').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('conversations_mobile').on(t.mobile), index('conversations_practice_state').on(t.practiceId, t.state)],
);
