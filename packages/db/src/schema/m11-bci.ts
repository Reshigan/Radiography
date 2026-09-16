import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceIdNullable, practiceId, json, bool } from './_helpers.js';

/** Model registry: one row per model id and version; status per site is a JSON map (docs/22 §10). */
export const modelRegistry = sqliteTable(
  'model_registry',
  {
    id: id(), // '<modelId>@<version>'
    modelId: text('model_id').notNull(),
    practiceId: practiceIdNullable(), // null = Group registry entry
    name: text('name').notNull(),
    version: text('version').notNull(),
    task: text('task').notNull(),
    outputClass: integer('output_class').notNull(),
    modalities: json<string[]>('modalities').notNull(),
    bodyParts: json<string[]>('body_parts'),
    vendor: text('vendor').notNull(),
    samdStatus: text('samd_status').notNull(),
    compute: text('compute').notNull(),
    overlaysDefault: text('overlays_default').notNull().default('on'),
    lifecycle: text('lifecycle').notNull().default('shadow'), // proposed | validated | shadow | activated | paused | deprecated | retired
    /** Status per site: activated | shadow | paused | off. Missing site = lifecycle default. */
    siteStatus: json<Record<string, 'activated' | 'shadow' | 'paused' | 'off'>>('site_status').notNull(),
    validationSummary: json<Record<string, unknown>>('validation_summary').notNull(),
    limitations: json<string[]>('limitations'),
    description: text('description'),
    demo: bool('demo').notNull().default(true),
    bundleDigest: text('bundle_digest'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('models_model').on(t.modelId)],
);

/** Immutable inference results (bci.result.v1 JSON) per study and model. */
export const inferenceResults = sqliteTable(
  'inference_results',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id').notNull(),
    studyId: text('study_id').notNull(),
    accession: text('accession').notNull(),
    modelId: text('model_id').notNull(),
    modelVersion: text('model_version').notNull(),
    task: text('task').notNull(), // triage | findings | qc | consistency | dose | not_analysed
    mode: text('mode').notNull().default('activated'), // activated | shadow
    result: json<Record<string, unknown>>('result').notNull(),
    priority: text('priority'), // P1..P4
    flagged: bool('flagged').notNull().default(false),
    positiveCount: integer('positive_count').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    compute: text('compute').notNull(),
    inputHash: text('input_hash'),
    createdAt: createdAt(),
  },
  (t) => [index('inf_study').on(t.studyId), index('inf_model_site').on(t.modelId, t.siteId, t.createdAt)],
);

/** Activation, pause, kill switch, drift alarms, change records, incidents and shadow reports. */
export const modelEvents = sqliteTable(
  'model_events',
  {
    id: id(),
    practiceId: practiceIdNullable(),
    siteId: text('site_id'),
    modelId: text('model_id').notNull(),
    modelVersion: text('model_version'),
    type: text('type').notNull(), // activation | pause | resume | kill_switch | drift_alarm | change_record | incident | shadow_report | revalidation
    severity: text('severity').notNull().default('info'), // info | warn | crit
    title: text('title').notNull(),
    detail: json<Record<string, unknown>>('detail').notNull(),
    status: text('status').notNull().default('open'), // open | acknowledged | closed | approved | rejected
    actorUserId: text('actor_user_id'),
    resolvedBy: text('resolved_by'),
    resolvedAt: text('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [index('model_events_model').on(t.modelId, t.createdAt), index('model_events_type').on(t.type, t.status)],
);
