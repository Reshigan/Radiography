import { z } from 'zod';

/**
 * bci.result.v1 — the adapter contract every imaging model returns (docs/22 §4.3).
 * Keys are snake_case on purpose: the JSON is stored immutably and exchanged with vendor adapters.
 */
export const bciLocalisationSchema = z.object({
  type: z.enum(['bbox', 'mask', 'point', 'none']),
  /** Normalised [x, y, w, h] in 0..1 of the referenced instance. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  frame_of_reference: z.string().optional(),
  /** Index of the instance within the study (0-based) or a storage reference. */
  ref: z.union([z.string(), z.number()]).optional(),
});

export const bciFindingSchema = z.object({
  code: z.string(),
  display: z.string(),
  laterality: z.enum(['L', 'R', 'B']).optional(),
  score: z.number().min(0).max(1),
  calibrated_probability: z.number().min(0).max(1).optional(),
  threshold: z.number().min(0).max(1),
  flag: z.boolean(),
  localisation: bciLocalisationSchema.optional(),
  severity_hint: z.enum(['small', 'moderate', 'large']).nullable().optional(),
  measurements: z.array(z.object({ name: z.string(), value: z.number(), unit: z.string().optional() })).optional(),
  /** Sentence a radiologist may accept into the findings section (Class 1 until accepted). */
  candidate_text: z.string().optional(),
});

export const bciResultSchema = z.object({
  schema: z.literal('bci.result.v1'),
  study_uid: z.string(),
  series_uids: z.array(z.string()),
  input_hash: z.string(),
  model: z.object({ id: z.string(), version: z.string(), vendor: z.string(), samd_status: z.string() }),
  output_class: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  task: z.enum(['triage', 'findings', 'qc', 'measurement', 'segmentation', 'consistency', 'dose']),
  findings: z.array(bciFindingSchema),
  triage: z.object({ priority: z.enum(['P1', 'P2', 'P3', 'P4']), reason: z.array(z.string()) }).optional(),
  quality: z.object({ usable: z.boolean(), issues: z.array(z.string()) }).optional(),
  consistency: z.array(z.object({ check: z.string(), status: z.enum(['pass', 'warn', 'fail']), detail: z.string() })).optional(),
  limitations: z.array(z.string()),
  latency_ms: z.number(),
  compute: z.string(),
  created_at: z.string(),
  /** Always true for the demo models shipped in this repository. */
  demo: z.boolean(),
});

export type BciResult = z.infer<typeof bciResultSchema>;
export type BciFinding = z.infer<typeof bciFindingSchema>;
export type BciPriority = 'P1' | 'P2' | 'P3' | 'P4';

export const PRIORITY_RANK: Record<BciPriority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

/** The highest (most urgent) of several priorities. */
export function highestPriority(list: Array<BciPriority | undefined>): BciPriority | undefined {
  let best: BciPriority | undefined;
  for (const p of list) if (p && (!best || PRIORITY_RANK[p] < PRIORITY_RANK[best])) best = p;
  return best;
}
