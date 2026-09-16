import { eq } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import type { Services } from '../../kernel/index.js';

/** Procedure catalogue entry (reference_data kind 'procedure'; seeded, configurable). */
export interface ProcedureDef {
  code: string;
  description: string;
  modality: 'XR' | 'CT' | 'MR' | 'US' | 'MG' | 'DXA';
  bodyPart: string;
  tariffCode: string;
  tariffCents: number; // scheme rate, excl VAT
  cashCents: number; // cash tariff, excl VAT
  durationMin: number;
  prep: string;
  contrast: 'none' | 'optional' | 'required';
  authFlag: boolean;
  ionising: boolean;
  lateralityRequired: boolean;
  keywords: string[];
  safetySets: string[]; // ionising | mri | contrast | sedation
}

export const CONTRAST_LINE = { tariffCode: 'T-CONTRAST', description: 'Contrast material (IV)', cents: 85000 };

let cache: { at: number; list: ProcedureDef[] } | null = null;

export async function loadCatalogue(services: Services): Promise<ProcedureDef[]> {
  if (cache && Date.now() - cache.at < 60_000 && cache.list.length) return cache.list;
  const rows = await services.db.select().from(schema.referenceData).where(eq(schema.referenceData.kind, 'procedure'));
  const list = rows.map((r) => ({ ...(r.value as unknown as ProcedureDef), code: r.key }));
  list.sort((a, b) => a.modality.localeCompare(b.modality) || a.description.localeCompare(b.description));
  cache = { at: Date.now(), list };
  return list;
}

export function invalidateCatalogue() {
  cache = null;
}

export async function findProcedure(services: Services, code: string): Promise<ProcedureDef | undefined> {
  const list = await loadCatalogue(services);
  return list.find((p) => p.code === code);
}

const word = (k: string) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i');

/** Score every procedure against free text; returns the best match and its score (0..1). */
export function matchProcedure(list: ProcedureDef[], text: string, opts: { modality?: string; contrast?: boolean }): { procedure: ProcedureDef; score: number } | null {
  const candidates = opts.modality ? list.filter((p) => p.modality === opts.modality) : list;
  let best: { procedure: ProcedureDef; score: number } | null = null;
  for (const p of candidates) {
    const terms = [...p.keywords, ...p.bodyPart.split(/\s+and\s+|\s+/).filter((w) => w.length > 3)];
    let hits = 0;
    for (const k of new Set(terms)) if (word(k).test(text)) hits++;
    if (!hits) continue;
    let score = Math.min(1, hits / Math.max(2, Math.min(3, terms.length)));
    // Prefer the contrast variant that matches what the referrer asked for.
    if (opts.contrast !== undefined) {
      const wants = opts.contrast;
      const has = p.contrast === 'required';
      score += wants === has ? 0.15 : -0.15;
    } else if (p.contrast === 'required') score -= 0.05;
    if (!best || score > best.score) best = { procedure: p, score };
  }
  if (best) best.score = Math.max(0.3, Math.min(0.99, best.score));
  return best;
}
