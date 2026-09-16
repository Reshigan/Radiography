import { Hono } from 'hono';
import type { AppEnv } from '../kernel/context.js';
import { registerSim } from './index.js';

/**
 * Funder (medical scheme administrator) simulator. Deterministic by member number so demos and tests
 * are reproducible: last digit 9 = membership invalid, 7-8 = benefit exhausted, 5-6 = co-payment, else covered.
 * Authorisation: last digit 8 declines; no ICD-10 asks for motivation; otherwise approved for 30 days.
 */
export interface BenefitCheckRequest { funderCode: string; option?: string | null; memberNo?: string | null; dependantCode?: string | null; modality: string; procedureCode: string; siteId?: string | null; authRequired: boolean; networkCoPayPct?: number; outOfNetwork?: boolean }
export interface BenefitCheckResponse { result: 'covered' | 'needs_auth' | 'exhausted' | 'co_pay' | 'invalid'; coPayPct?: number; reasonCodes: string[]; message: string; reference: string; latencyMs: number; funderCode: string }

export function simulateBenefitCheck(req: BenefitCheckRequest): BenefitCheckResponse {
  const ref = `BEN-${(req.memberNo ?? '0').slice(-5)}-${req.procedureCode.replace(/[^A-Z0-9]/gi, '').slice(0, 6)}`;
  if (!req.memberNo || !/^\d{6,12}$/.test(req.memberNo)) return { result: 'invalid', reasonCodes: ['MEMBER_NOT_FOUND'], message: 'Membership number not recognised by the funder.', reference: ref, latencyMs: 420, funderCode: req.funderCode };
  const d = Number(req.memberNo.slice(-1));
  if (d === 9) return { result: 'invalid', reasonCodes: ['MEMBERSHIP_LAPSED'], message: 'Membership lapsed; contributions outstanding.', reference: ref, latencyMs: 380, funderCode: req.funderCode };
  if (d === 7 || d === 8) return { result: 'exhausted', reasonCodes: ['BENEFIT_EXHAUSTED'], message: 'Day-to-day radiology benefit exhausted for this year; the patient is liable.', reference: ref, latencyMs: 510, funderCode: req.funderCode };
  const reasonCodes: string[] = [];
  let coPayPct = 0;
  if (d === 5 || d === 6) { coPayPct = 20; reasonCodes.push('CO_PAYMENT'); }
  if (req.outOfNetwork && req.networkCoPayPct) { coPayPct = Math.max(coPayPct, req.networkCoPayPct); reasonCodes.push('NETWORK_CO_PAYMENT'); }
  if (req.authRequired) return { result: 'needs_auth', coPayPct: coPayPct || undefined, reasonCodes: [...reasonCodes, 'AUTH_REQUIRED'], message: `Pre-authorisation required for ${req.modality} on this option.`, reference: ref, latencyMs: 450, funderCode: req.funderCode };
  if (coPayPct) return { result: 'co_pay', coPayPct, reasonCodes, message: `Covered with a ${coPayPct} % co-payment.`, reference: ref, latencyMs: 400, funderCode: req.funderCode };
  return { result: 'covered', reasonCodes: ['COVERED'], message: 'Benefit available; funds confirmed at scheme rate.', reference: ref, latencyMs: 390, funderCode: req.funderCode };
}

export interface AuthRequest { funderCode: string; memberNo?: string | null; option?: string | null; procedureCode: string; modality: string; icd10: string[]; estimatedCents: number; clinicalMotivation?: string | null; resubmission?: boolean }
export interface AuthResponse { status: 'approved' | 'declined' | 'more_info'; authNumber?: string; validFrom?: string; validTo?: string; approvedCents?: number; reason?: string; reference: string; latencyMs: number }

function hash6(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

export function simulateAuth(req: AuthRequest, now = new Date()): AuthResponse {
  const reference = `REQ-${hash6(`${req.memberNo}${req.procedureCode}${now.toISOString().slice(0, 10)}`)}`;
  const d = Number((req.memberNo ?? '0').slice(-1));
  if (!req.memberNo || d === 9) return { status: 'declined', reason: 'Membership not active on the date of service.', reference, latencyMs: 700 };
  if (d === 8) return { status: 'declined', reason: 'Benefit exhausted; no further radiology benefit this year.', reference, latencyMs: 720 };
  if (!req.icd10.length && !req.clinicalMotivation) return { status: 'more_info', reason: 'Clinical motivation and ICD-10 code required.', reference, latencyMs: 650 };
  if (req.modality === 'MR' && !req.icd10.length) return { status: 'more_info', reason: 'MRI requires an ICD-10 code and a clinical motivation.', reference, latencyMs: 650 };
  const validTo = new Date(now.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  return { status: 'approved', authNumber: `AUTH-${hash6(`${req.memberNo}:${req.procedureCode}`)}`, validFrom: now.toISOString().slice(0, 10), validTo, approvedCents: req.estimatedCents, reference, latencyMs: 900 };
}

const routes = new Hono<AppEnv>();
routes.post('/benefit-check', async (c) => c.json(simulateBenefitCheck((await c.req.json()) as BenefitCheckRequest)));
routes.post('/auth', async (c) => c.json(simulateAuth((await c.req.json()) as AuthRequest)));
routes.get('/auth/:ref', (c) => c.json({ reference: c.req.param('ref'), status: 'approved', note: 'Simulator: statuses are decided at submission time.' }));

export function registerFunderSim() {
  registerSim('funder', routes);
}
