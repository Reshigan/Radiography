import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, practiceIdNullable, json, bool, cents } from './_helpers.js';

/* ---------- M18 Assets & Engineering ---------- */

/** Equipment register; a modality asset uses the same id as core.modalities. */
export const assets = sqliteTable(
  'assets',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    roomId: text('room_id'),
    modalityId: text('modality_id'),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('modality'), // modality | injector | ups | generator | workstation | probe | apron
    type: text('type'), // CT | MR | DX | US | MG | DXA | UPS | GEN
    vendor: text('vendor'),
    model: text('model'),
    serial: text('serial'),
    assetTag: text('asset_tag'),
    status: text('status').notNull().default('in_service'), // commissioning | in_service | restricted | down | maintenance | decommissioned
    serviceContract: json<{ vendor: string; coverage: string[]; responseHours: number; uptimeSlaPct: number; expires: string; annualCents: number; ref?: string }>('service_contract'),
    vendorContact: json<{ name: string; phone?: string; email?: string; portal?: string }>('vendor_contact'),
    pmSchedule: json<{ intervalDays: number; lastPm: string | null; nextPm: string | null; tolerance?: number }>('pm_schedule'),
    predictiveSignal: json<{ signal: string; riskPct: number; confidence: number; modelId: string; modelVersion: string; at: string; level: 'none' | 'watch' | 'warn' | 'crit' }>('predictive_signal'),
    uptime30dPct: real('uptime_30d_pct'),
    licenceRef: text('licence_ref'),
    downtimeStartedAt: text('downtime_started_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assets_site').on(t.siteId), index('assets_practice').on(t.practiceId)],
);

export const workOrders = sqliteTable(
  'work_orders',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    assetId: text('asset_id'),
    ref: text('ref').notNull(), // WO-2609-041
    type: text('type').notNull(), // breakdown | pm | qa | upgrade | decommission
    priority: text('priority').notNull().default('normal'), // low | normal | high | critical
    title: text('title').notNull(),
    symptoms: text('symptoms'),
    status: text('status').notNull().default('open'), // open | scheduled | in_progress | awaiting_parts | done | cancelled
    vendorTicket: text('vendor_ticket'),
    slaHours: real('sla_hours'),
    slaStartedAt: text('sla_started_at'),
    slaDueAt: text('sla_due_at'),
    poId: text('po_id'),
    poCents: cents('po_cents'),
    downtimeStartedAt: text('downtime_started_at'),
    downtimeEndedAt: text('downtime_ended_at'),
    rootCause: text('root_cause'),
    reportedBy: text('reported_by'),
    assignedTo: text('assigned_to'),
    handTaskId: text('hand_task_id'),
    timeline: json<Array<{ at: string; text: string; by?: string; kind?: string }>>('timeline').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('work_orders_status').on(t.status, t.practiceId), index('work_orders_asset').on(t.assetId)],
);

export const telemetry = sqliteTable(
  'telemetry',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    assetId: text('asset_id').notNull(),
    metric: text('metric').notNull(), // heartbeat | tube_arc_count | helium_pct | error_code | chiller_temp | exposure_count
    value: real('value'),
    textValue: text('text_value'),
    unit: text('unit'),
    source: text('source').notNull().default('edge'), // edge | vendor_log | manual | sim
    at: text('at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('telemetry_asset_metric').on(t.assetId, t.metric, t.at)],
);

/** Consumable stock lots (contrast media first). */
export const consumables = sqliteTable(
  'consumables',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    category: text('category').notNull().default('contrast'), // contrast | cannula | syringe | ppe | film
    product: text('product').notNull(),
    lot: text('lot').notNull(),
    expiry: text('expiry').notNull(),
    qtyOnHand: integer('qty_on_hand').notNull(),
    unit: text('unit').notNull().default('vial'),
    reorderPoint: integer('reorder_point').notNull().default(20),
    dailyUsage: real('daily_usage').notNull().default(0), // trailing 28-day
    supplier: text('supplier'),
    unitCents: cents('unit_cents').notNull().default(0),
    status: text('status').notNull().default('active'), // active | expired | recalled | depleted
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('consumables_site').on(t.siteId, t.category)],
);

export const stockMovements = sqliteTable('stock_movements', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id').notNull(),
  lotId: text('lot_id').notNull(),
  type: text('type').notNull(), // receive | issue | wastage | return | adjust
  qty: integer('qty').notNull(),
  studyId: text('study_id'),
  userId: text('user_id'),
  note: text('note'),
  at: text('at').notNull(),
  createdAt: createdAt(),
});

export const purchaseOrders = sqliteTable('purchase_orders', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id').notNull(),
  ref: text('ref').notNull(),
  supplier: text('supplier').notNull(),
  category: text('category').notNull(), // consumable | parts | service
  lines: json<Array<{ product: string; qty: number; unitCents: number }>>('lines').notNull(),
  totalCents: cents('total_cents').notNull(),
  status: text('status').notNull().default('draft'), // draft | awaiting_approval | approved | sent | received | cancelled
  raisedBy: text('raised_by'), // maintenance_hand | user id
  handTaskId: text('hand_task_id'),
  workOrderId: text('work_order_id'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const edgeGateways = sqliteTable('edge_gateways', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('online'), // online | offline | on_ups
  lastHeartbeatAt: text('last_heartbeat_at'),
  tunnelMs: integer('tunnel_ms'),
  backlogStudies: integer('backlog_studies').notNull().default(0),
  diskPct: integer('disk_pct').notNull().default(20),
  upsPct: integer('ups_pct').notNull().default(100),
  upsMinutesLeft: integer('ups_minutes_left'),
  stateSince: text('state_since'),
  version: text('version'),
  localWorklistMirror: bool('local_worklist_mirror').notNull().default(true),
  note: text('note'),
  updatedAt: updatedAt(),
});

export const vendorAccessSessions = sqliteTable('vendor_access_sessions', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id').notNull(),
  assetId: text('asset_id'),
  ref: text('ref').notNull(), // RA-2609-022
  vendor: text('vendor').notNull(),
  engineer: text('engineer'),
  purpose: text('purpose').notNull(),
  scope: text('scope').notNull(), // service console port only | workstation | ...
  requestedStart: text('requested_start').notNull(),
  requestedEnd: text('requested_end').notNull(),
  approvedStart: text('approved_start'),
  approvedEnd: text('approved_end'),
  status: text('status').notNull().default('requested'), // requested | approved | active | closed | declined | expired
  requestedBy: text('requested_by'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  recordingRef: text('recording_ref'),
  workOrderId: text('work_order_id'),
  conditions: json<string[]>('conditions'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const integrationFeeds = sqliteTable('integration_feeds', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id'),
  type: text('type').notNull(), // DICOM | HL7 | FHIR | switch
  name: text('name').notNull(),
  partner: text('partner'),
  transport: text('transport'),
  direction: text('direction').notNull().default('in'), // in | out | both
  lastMessageAt: text('last_message_at'),
  messages24h: integer('messages_24h').notNull().default(0),
  errors24h: integer('errors_24h').notNull().default(0),
  status: text('status').notNull().default('healthy'), // healthy | degraded | down | mapping_review | backlog
  lastError: text('last_error'),
  updatedAt: updatedAt(),
});

/** Published load-shedding (grid outage) windows per site; feeds M05, M17 and BKG. */
export const loadSheddingWindows = sqliteTable('load_shedding_windows', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id').notNull(),
  stage: integer('stage').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  generatorCovers: json<string[]>('generator_covers'), // room types covered
  source: text('source').notNull().default('schedule'), // schedule | manual | sim
  createdAt: createdAt(),
});

/** Platform support (MSO) tickets: tenant incidents, outages, onboarding issues. */
export const supportTickets = sqliteTable('support_tickets', {
  id: id(),
  practiceId: practiceIdNullable(),
  siteId: text('site_id'),
  ref: text('ref').notNull(),
  category: text('category').notNull(), // outage | integration | access | data | onboarding | question
  severity: text('severity').notNull().default('p3'), // p1 | p2 | p3 | p4
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('open'), // open | in_progress | waiting | resolved | closed
  linkedRef: text('linked_ref'),
  runbook: json<Array<{ step: string; done: boolean }>>('runbook'),
  openedBy: text('opened_by'),
  assignedTo: text('assigned_to'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
