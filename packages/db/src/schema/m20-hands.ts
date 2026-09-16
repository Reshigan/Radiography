import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceIdNullable, json, bool } from './_helpers.js';

/** Registry of Hands per practice: mandate, automation level, leash values, status. */
export const hands = sqliteTable('hands', {
  id: id(), // e.g. 'referral' (global row) or 'referral:prac_a' (practice override)
  handId: text('hand_id').notNull(),
  practiceId: practiceIdNullable(),
  name: text('name').notNull(),
  module: text('module').notNull(),
  mandate: text('mandate').notNull(),
  level: text('level').notNull(), // A1 | A2 | A3
  leash: json<Record<string, number | string | boolean>>('leash').notNull(),
  approvalPolicy: text('approval_policy'),
  status: text('status').notNull().default('active'), // active | shadow | paused
  version: integer('version').notNull().default(1),
  updatedAt: updatedAt(),
});

/** Every Hand run is a task with recorded steps, leash checks and (if needed) an approval. */
export const agentTasks = sqliteTable(
  'agent_tasks',
  {
    id: id(),
    practiceId: practiceIdNullable(),
    handId: text('hand_id').notNull(),
    trigger: text('trigger').notNull(), // event name or 'manual' or 'schedule'
    status: text('status').notNull().default('running'), // running | done | needs_approval | approved | rejected | failed | refused
    title: text('title').notNull(),
    input: json<Record<string, unknown>>('input').notNull(),
    output: json<Record<string, unknown>>('output'),
    steps: json<Array<{ at: string; tool: string; risk: string; args?: unknown; result?: unknown; note?: string }>>('steps').notNull(),
    leashChecks: json<Array<{ rule: string; limit: unknown; actual: unknown; ok: boolean }>>('leash_checks').notNull(),
    approvalPersona: text('approval_persona'),
    approvalReason: text('approval_reason'),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    error: text('error'),
    llmUsed: bool('llm_used').notNull().default(false),
    aggregateType: text('aggregate_type'),
    aggregateId: text('aggregate_id'),
    startedAt: createdAt(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('agent_tasks_status').on(t.status, t.practiceId), index('agent_tasks_hand').on(t.handId)],
);
