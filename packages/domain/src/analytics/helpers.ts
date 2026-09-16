import { METRICS, type MetricDefinition } from './metrics.js';

/* ---------- Statistics used by the semantic layer (medians and percentiles, never means, for durations) ---------- */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}
export function pct(numerator: number, denominator: number, digits = 1): number | null {
  if (!denominator) return null;
  return round((numerator / denominator) * 100, digits);
}
export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/* ---------- Benchmarking (docs/13 §6) ---------- */
export const SMALL_CELL_THRESHOLD = 10;

export interface BenchmarkRow {
  practiceId: string;
  label: string;
  value: number | null;
  /** Number of underlying rows; suppressed below the small-cell threshold. */
  n: number;
  /** Case-mix adjusted value = observed ÷ expected × peer mean (indirect standardisation). */
  adjusted?: number | null;
  suppressed?: boolean;
  anonymised?: string;
}

/**
 * Peer comparison with small-cell suppression (plus complementary suppression when exactly one cell would be
 * recoverable by subtraction) and anonymised labels (P1…Pn) unless the caller may see identities.
 */
export function benchmark(rows: BenchmarkRow[], opts: { identify: boolean; threshold?: number } = { identify: false }): { rows: BenchmarkRow[]; peerMedian: number | null; suppressed: number } {
  const threshold = opts.threshold ?? SMALL_CELL_THRESHOLD;
  let out = rows.map((r, i) => ({ ...r, suppressed: r.n < threshold, anonymised: `P${i + 1}` }));
  const suppressedCount = out.filter((r) => r.suppressed).length;
  // Complementary suppression: if exactly one cell is suppressed it could be recovered from a total, so suppress the next smallest.
  if (suppressedCount === 1 && out.length > 2) {
    const candidates = out.filter((r) => !r.suppressed).sort((a, b) => a.n - b.n);
    if (candidates[0]) candidates[0].suppressed = true;
  }
  out = out.map((r) => ({ ...r, value: r.suppressed ? null : r.value, adjusted: r.suppressed ? null : r.adjusted, label: opts.identify ? r.label : r.anonymised! }));
  const vals = out.map((r) => r.value).filter((v): v is number => v !== null);
  return { rows: out, peerMedian: median(vals), suppressed: out.filter((r) => r.suppressed).length };
}

/** Indirect standardisation: observed ÷ expected × peer mean. */
export function caseMixAdjust(observed: number, expected: number, peerMean: number): number | null {
  if (!expected) return null;
  return round((observed / expected) * peerMean, 2);
}

/* ---------- Insight Hand: question → metric matching (semantic layer only, never ad hoc SQL) ---------- */
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'for', 'to', 'is', 'are', 'was', 'were', 'what', 'which', 'how', 'many', 'much', 'show', 'me', 'my', 'our', 'this', 'that', 'last', 'week', 'month', 'today', 'by', 'and', 'or', 'with', 'over', 'per', 'rate', 'on', 'we', 'do', 'did', 'have', 'has', 'than', 'more', 'less', 'sites', 'site', 'practice', 'practices']);

export interface MetricMatch { metric: MetricDefinition; score: number; matched: string[] }

export function matchMetrics(question: string, limit = 3): MetricMatch[] {
  const q = question.toLowerCase().replace(/[^a-z0-9%\s-]/g, ' ');
  const tokens = q.split(/\s+/).filter((t) => t && !STOP.has(t));
  const out: MetricMatch[] = [];
  for (const metric of METRICS) {
    let score = 0;
    const matched: string[] = [];
    for (const kw of metric.keywords) {
      if (q.includes(kw)) { score += kw.split(' ').length * 3; matched.push(kw); }
    }
    for (const t of tokens) {
      if (t.length < 3) continue;
      const stem = t.replace(/s$/, '');
      if (metric.name.toLowerCase().includes(stem)) { score += 2; matched.push(t); }
      else if (metric.description.toLowerCase().includes(stem)) { score += 0.5; }
      if (metric.id.toLowerCase().includes(stem)) { score += 4; matched.push(t); }
    }
    if (score > 0) out.push({ metric, score, matched: [...new Set(matched)] });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Extracts simple filters the Insight Hand understands: site names, modality words, threshold numbers, periods. */
export function parseQuestionFilters(question: string): { modality?: string; threshold?: number; comparator?: 'over' | 'under'; period?: string; siteHint?: string } {
  const q = question.toLowerCase();
  const modality = ['ct', 'mri', 'mr', 'x-ray', 'xr', 'ultrasound', 'us', 'mammo', 'mammography', 'dxa'].find((m) => new RegExp(`\\b${m}\\b`).test(q));
  const thr = /(over|above|more than|under|below|less than)\s+(\d+(?:\.\d+)?)\s*%?/.exec(q);
  const period = /(last|this|past)\s+(\d+\s+)?(day|week|month|quarter|year)s?/.exec(q)?.[0];
  const siteHint = ['sandton', 'randburg', 'umhlanga', 'ballito'].find((s) => q.includes(s));
  return {
    modality: modality ? ({ ct: 'CT', mri: 'MR', mr: 'MR', 'x-ray': 'DX', xr: 'DX', ultrasound: 'US', us: 'US', mammo: 'MG', mammography: 'MG', dxa: 'DXA' } as Record<string, string>)[modality] : undefined,
    threshold: thr ? Number(thr[2]) : undefined,
    comparator: thr ? (/over|above|more/.test(thr[1]!) ? 'over' : 'under') : undefined,
    period,
    siteHint,
  };
}

/* ---------- What-if: second modality payback model (docs/13 §8) ---------- */
export interface WhatIfInput {
  modality: string; // CT | MR | ...
  capexCents: number; // unit plus room build
  annualServiceCents: number;
  staffingCentsPerYear: number;
  studiesPerDayYear1: number;
  rampMonths: number; // months to reach studiesPerDayYear1
  revenuePerStudyCents: number;
  variableCostPerStudyCents: number; // contrast, consumables, reading fee
  operatingDaysPerYear: number;
  utilisationCapPct: number; // e.g. 85
  capacityStudiesPerDay: number;
  loadSheddingLossPct: number; // e.g. 3
  discountRatePct: number; // for NPV over 5 years
}
export interface WhatIfOutput {
  paybackMonths: number | null;
  utilisationYear1Pct: number;
  irrPct: number | null;
  ebitdaYear1Cents: number;
  ebitdaYear2Cents: cents;
  npv5yCents: number;
  monthlyCashflow: number[]; // 60 months, cents
  assumptions: string[];
}
type cents = number;

export const DEFAULT_WHATIF: WhatIfInput = {
  modality: 'MR', capexCents: 2_840_000_000, annualServiceCents: 180_000_000, staffingCentsPerYear: 240_000_000, studiesPerDayYear1: 22, rampMonths: 6,
  revenuePerStudyCents: 420_000, variableCostPerStudyCents: 95_000, operatingDaysPerYear: 300, utilisationCapPct: 85, capacityStudiesPerDay: 32, loadSheddingLossPct: 3, discountRatePct: 12,
};

export function whatIfSecondModality(input: Partial<WhatIfInput> = {}): WhatIfOutput {
  const i = { ...DEFAULT_WHATIF, ...input };
  const months = 60;
  const cash: number[] = [];
  let cumulative = -i.capexCents;
  let payback: number | null = null;
  const monthlyFixed = (i.annualServiceCents + i.staffingCentsPerYear) / 12;
  const daysPerMonth = i.operatingDaysPerYear / 12;
  const yearly = [0, 0, 0, 0, 0];
  for (let mth = 0; mth < months; mth++) {
    const ramp = Math.min(1, (mth + 1) / Math.max(1, i.rampMonths));
    const growth = 1 + Math.min(0.25, Math.floor(mth / 12) * 0.08); // 8 % a year, capped
    const capacity = i.capacityStudiesPerDay * (i.utilisationCapPct / 100);
    const perDay = Math.min(capacity, i.studiesPerDayYear1 * ramp * growth) * (1 - i.loadSheddingLossPct / 100);
    const studies = perDay * daysPerMonth;
    const contribution = studies * (i.revenuePerStudyCents - i.variableCostPerStudyCents) - monthlyFixed;
    cash.push(Math.round(contribution));
    yearly[Math.floor(mth / 12)]! += contribution;
    cumulative += contribution;
    if (payback === null && cumulative >= 0) payback = mth + 1;
  }
  const utilisationYear1 = round((Math.min(i.capacityStudiesPerDay * (i.utilisationCapPct / 100), i.studiesPerDayYear1) / i.capacityStudiesPerDay) * 100, 0);
  const r = i.discountRatePct / 100;
  const npv = -i.capexCents + yearly.reduce((acc, y, k) => acc + y / (1 + r) ** (k + 1), 0);
  return {
    paybackMonths: payback,
    utilisationYear1Pct: utilisationYear1,
    irrPct: irr([-i.capexCents, ...yearly]),
    ebitdaYear1Cents: Math.round(yearly[0]!),
    ebitdaYear2Cents: Math.round(yearly[1]!),
    npv5yCents: Math.round(npv),
    monthlyCashflow: cash,
    assumptions: [
      `${i.modality} unit, capex R ${(i.capexCents / 100 / 1e6).toFixed(1)} m including room build`,
      `${i.studiesPerDayYear1} studies/day at maturity, ${i.rampMonths}-month ramp, 8 % annual growth capped at 25 %`,
      `Revenue R ${(i.revenuePerStudyCents / 100).toFixed(0)} and variable cost R ${(i.variableCostPerStudyCents / 100).toFixed(0)} per study (current funder mix)`,
      `Capacity ${i.capacityStudiesPerDay}/day capped at ${i.utilisationCapPct} % utilisation; ${i.operatingDaysPerYear} operating days`,
      `Load-shedding loss ${i.loadSheddingLossPct} % of volume (trailing history applied)`,
      `Service R ${(i.annualServiceCents / 100 / 1e6).toFixed(2)} m and staffing R ${(i.staffingCentsPerYear / 100 / 1e6).toFixed(2)} m per year`,
      `Discount rate ${i.discountRatePct} % for the 5-year NPV; JV partners' share applies to EBITDA effect`,
      'Licence and QA obligations for the new room are added to the compliance calendar on approval',
      'A scenario is a saved object; nothing is written to the ledgers',
    ],
  };
}

/** Internal rate of return by bisection on yearly cashflows (percent), null when it does not converge. */
export function irr(flows: number[]): number | null {
  const npvAt = (r: number) => flows.reduce((acc, f, k) => acc + f / (1 + r) ** k, 0);
  let lo = -0.99;
  let hi = 10;
  if (npvAt(lo) * npvAt(hi) > 0) return null;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (npvAt(mid) > 0) lo = mid; else hi = mid;
  }
  return round(((lo + hi) / 2) * 100, 1);
}

/** Case-mix note shown next to every productivity or throughput figure (docs/13 §1.4). */
export const CASE_MIX_NOTE = 'Raw and case-mix adjusted values are shown side by side. Adjustment: observed ÷ expected × peer mean, where expected is derived from procedure RVU weight, age band, contrast and modality (indirect standardisation). Cells below 10 rows are suppressed.';
