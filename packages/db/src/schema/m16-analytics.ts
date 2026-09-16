import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, practiceIdNullable, json } from './_helpers.js';

/* ---------- M16 Analytics & Insight ---------- */

/** Daily computed metric values per practice (and optionally site) for trends and benchmarks. */
export const metricSnapshots = sqliteTable(
  'metric_snapshots',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id'),
    metricId: text('metric_id').notNull(), // e.g. OPS.TAT.SLA
    date: text('date').notNull(), // YYYY-MM-DD (SAST)
    value: real('value'), // null = source not available on that day
    numerator: real('numerator'),
    denominator: real('denominator'),
    source: text('source').notNull().default('computed'), // computed | seeded | imported
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('metric_snapshots_key').on(t.practiceId, t.metricId, t.date), index('metric_snapshots_date').on(t.date)],
);

/** Insight Hand questions and their answers (semantic-layer only; logged for AIO review). */
export const savedQuestions = sqliteTable('saved_questions', {
  id: id(),
  practiceId: practiceIdNullable(), // null = Group scope
  userId: text('user_id'),
  persona: text('persona'),
  question: text('question').notNull(),
  metricIds: json<string[]>('metric_ids').notNull(),
  answer: json<Record<string, unknown>>('answer'),
  taskId: text('task_id'),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

/** What-if scenarios: inputs, assumptions and outputs; never written back to ledgers. */
export const scenarios = sqliteTable('scenarios', {
  id: id(),
  practiceId: practiceId(),
  siteId: text('site_id'),
  kind: text('kind').notNull(), // second_modality | new_site | contract_change | roster
  name: text('name').notNull(),
  inputs: json<Record<string, unknown>>('inputs').notNull(),
  outputs: json<Record<string, unknown>>('outputs').notNull(),
  provenance: json<Record<string, unknown>>('provenance'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
});

/** Group acquisition pipeline with the Onboarding Hand day 1–5 checklist. */
export const acquisitions = sqliteTable('acquisitions', {
  id: id(),
  practiceId: practiceIdNullable(), // set once the acquired practice exists as a tenant
  name: text('name').notNull(),
  region: text('region'),
  sites: json<string[]>('sites').notNull(),
  modalities: json<string[]>('modalities'),
  stage: text('stage').notNull().default('target'), // target | due_diligence | onboarding | live
  owner: text('owner'), // persona or name
  indicativeEbitdaCents: integer('indicative_ebitda_cents'),
  jvSplit: text('jv_split'), // e.g. 60/40
  effectiveDate: text('effective_date'),
  mergerThreshold: json<{ assessed: boolean; category?: string; notifiable?: boolean; note?: string }>('merger_threshold'),
  checklist: json<Array<{ day: number; item: string; done: boolean; at?: string; by?: string }>>('checklist').notNull(),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Generated board packs (JSON content, immutable once approved). */
export const boardPacks = sqliteTable('board_packs', {
  id: id(),
  practiceId: practiceIdNullable(),
  period: text('period').notNull(), // YYYY-MM
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'), // draft | approved
  content: json<Record<string, unknown>>('content').notNull(),
  generatedBy: text('generated_by'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  createdAt: createdAt(),
});
