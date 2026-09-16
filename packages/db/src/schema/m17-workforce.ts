import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, json, bool } from './_helpers.js';

/* ---------- M17 Workforce ---------- */

export const staff = sqliteTable(
  'staff',
  {
    id: id(),
    practiceId: practiceId(),
    userId: text('user_id'), // link to users.id when the worker signs in
    name: text('name').notNull(),
    role: text('role').notNull(), // RAD | NUR | FDK | RGT | BKG | BIL | DEB | PRM | BIO
    employmentType: text('employment_type').notNull().default('permanent'), // permanent | part_time | locum | agency | contractor
    homeSiteId: text('home_site_id'),
    siteIds: json<string[]>('site_ids'),
    /** e.g. ['DX','CT','mammography','mri_safety_officer','sonography:obstetric'] */
    competencies: json<string[]>('competencies').notNull(),
    hpcsaNo: text('hpcsa_no'),
    hpcsaExpiry: text('hpcsa_expiry'),
    radiationWorker: bool('radiation_worker').notNull().default(false),
    dosimetryBadge: text('dosimetry_badge'),
    contractHoursPerWeek: real('contract_hours_per_week').notNull().default(45),
    ftePct: integer('fte_pct').notNull().default(100),
    hourlyCostCents: integer('hourly_cost_cents'),
    status: text('status').notNull().default('active'), // active | on_leave | inactive
    startDate: text('start_date'),
    endDate: text('end_date'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('staff_practice').on(t.practiceId), index('staff_role').on(t.role)],
);

/** Roster shifts: one row per required slot; open gaps have no staff. */
export const shifts = sqliteTable(
  'shifts',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id'),
    date: text('date').notNull(), // YYYY-MM-DD
    startTime: text('start_time').notNull(), // HH:MM SAST
    endTime: text('end_time').notNull(),
    hours: real('hours').notNull(),
    role: text('role').notNull(),
    requiredCompetency: text('required_competency'),
    staffId: text('staff_id'),
    status: text('status').notNull().default('planned'), // planned | confirmed | open_gap | agency | swapped | cancelled
    filledBy: text('filled_by'), // roster_hand | prm | staff
    agencyName: text('agency_name'),
    agencyCents: integer('agency_cents'),
    overtime: bool('overtime').notNull().default(false),
    gapReason: text('gap_reason'),
    note: text('note'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('shifts_site_date').on(t.siteId, t.date), index('shifts_staff').on(t.staffId), index('shifts_status').on(t.status)],
);

export const leave = sqliteTable('leave', {
  id: id(),
  practiceId: practiceId(),
  staffId: text('staff_id').notNull(),
  type: text('type').notNull(), // annual | sick | family | maternity | parental | study | unpaid
  fromDate: text('from_date').notNull(),
  toDate: text('to_date').notNull(),
  days: real('days').notNull(),
  status: text('status').notNull().default('requested'), // requested | approved | declined | cancelled
  reason: text('reason'),
  certificateRef: text('certificate_ref'),
  decidedBy: text('decided_by'),
  decidedAt: text('decided_at'),
  createdAt: createdAt(),
});

export const credentials = sqliteTable(
  'credentials',
  {
    id: id(),
    practiceId: practiceId(),
    staffId: text('staff_id').notNull(),
    type: text('type').notNull(), // hpcsa | sanc | cpd_cycle | radiation_worker | mammography | mri_safety | bls | drivers
    number: text('number'),
    issuer: text('issuer'),
    issuedAt: text('issued_at'),
    expiry: text('expiry'),
    verified: bool('verified').notNull().default(false),
    verifiedAt: text('verified_at'),
    verifiedBy: text('verified_by'),
    evidenceRef: text('evidence_ref'),
    createdAt: createdAt(),
  },
  (t) => [index('credentials_staff').on(t.staffId), index('credentials_expiry').on(t.expiry)],
);

export const cpdPoints = sqliteTable('cpd_points', {
  id: id(),
  practiceId: practiceId(),
  staffId: text('staff_id').notNull(),
  cycleYear: integer('cycle_year').notNull(),
  activity: text('activity').notNull(),
  points: real('points').notNull(),
  ethicsPoints: real('ethics_points').notNull().default(0),
  certificateRef: text('certificate_ref'),
  at: text('at').notNull(),
  createdAt: createdAt(),
});

export const timeAttendance = sqliteTable(
  'time_attendance',
  {
    id: id(),
    practiceId: practiceId(),
    staffId: text('staff_id').notNull(),
    shiftId: text('shift_id'),
    siteId: text('site_id').notNull(),
    clockIn: text('clock_in').notNull(),
    clockOut: text('clock_out'),
    method: text('method').notNull().default('app'), // app | kiosk | biometric | manual
    hoursWorked: real('hours_worked'),
    overtimeHours: real('overtime_hours').notNull().default(0),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('time_attendance_staff').on(t.staffId, t.clockIn)],
);
