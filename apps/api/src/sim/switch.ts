/**
 * Claims switch simulator (demo only). Deterministic adjudication by rules; batch acknowledgements and
 * a "rule change wave" endpoint that makes the switch reject a code family for a funder.
 */
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId } from '@bonakala/domain';
import { Hono } from 'hono';
import type { AppEnv } from '../kernel/context.js';
import { allow, body, param } from '../kernel/index.js';
import { applyClaimResponse, matchRemittance, transferPatientLiability, type ClaimRow, type SwitchResponse } from '../modules/m14-billing/service.js';
import { runHand } from '../kernel/hands.js';

export interface SwitchRule { id: string; funderId: string; codes: string[]; reasonCode: string; funderCode: string; message: string; requiresAuth?: boolean; symptomPrimary?: string[]; active: boolean; since: string }

const CT_CODES = ['34100', '34101', '34200', '34300', '34320', '34322', '34400'];
const REALTIME = new Set(['scheme-a', 'scheme-b']);

export const switchState: { rules: SwitchRule[]; pending: Array<{ claimId: string; response: SwitchResponse }>; submitted: number; outage: boolean } = {
  rules: [
    { id: 'SB-CT-OOH-2026-09', funderId: 'scheme-b', codes: CT_CODES, reasonCode: 'AUTH_REQ', funderCode: '4231', message: 'Pre-authorisation number required for out-of-hospital CT (circular 14/2026)', requiresAuth: true, active: true, since: '2026-09-01' },
    { id: 'SB-ICD-2026-09', funderId: 'scheme-b', codes: CT_CODES, reasonCode: 'ICD_INVALID', funderCode: '4232', message: 'Invalid diagnosis for procedure: symptom code not accepted as primary', symptomPrimary: ['R51', 'R10.4', 'R52'], active: true, since: '2026-09-01' },
  ],
  pending: [], submitted: 0, outage: false,
};

let refSeq = 0x7f21;
export function switchRef() {
  refSeq += 7;
  return `${refSeq.toString(16).toUpperCase()}-${Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Deterministic adjudication of one claim. */
export function adjudicate(claim: Pick<ClaimRow, 'funderId' | 'funderType' | 'lines' | 'icd10' | 'fields' | 'totalCents' | 'expectedFunderCents' | 'expectedPatientCents' | 'memberNo' | 'pmb'>): SwitchResponse {
  const channel: SwitchResponse['channel'] = REALTIME.has(claim.funderId) ? 'realtime' : 'batch';
  const ref = switchRef();
  const codes = (claim.lines as Array<{ code: string }>).map((l) => l.code);
  if (claim.funderType === 'scheme' && claim.memberNo && /99$/.test(claim.memberNo)) return { outcome: 'rejected', code: '4101', message: 'Member not found', rule: 'MEMBER', switchRef: ref, channel };
  for (const r of switchState.rules) {
    if (!r.active || r.funderId !== claim.funderId) continue;
    if (!r.codes.some((c) => codes.includes(c))) continue;
    if (r.requiresAuth && !claim.fields.authRef) return { outcome: 'rejected', code: r.funderCode, message: r.message, rule: r.id, switchRef: ref, channel };
    if (r.symptomPrimary && claim.icd10[0] && r.symptomPrimary.some((s) => claim.icd10[0]!.toUpperCase().startsWith(s))) return { outcome: 'rejected', code: r.funderCode, message: r.message, rule: r.id, switchRef: ref, channel };
    if (!r.requiresAuth && !r.symptomPrimary) return { outcome: 'rejected', code: r.funderCode, message: r.message, rule: r.id, switchRef: ref, channel };
  }
  if (claim.funderType === 'scheme' && claim.totalCents > 2_000_000 && !claim.pmb) return { outcome: 'pended', code: 'PEND', message: 'Pended for clinical review (high value)', switchRef: ref, channel };
  if (claim.funderType !== 'scheme' && claim.funderType !== 'cash') return { outcome: 'acknowledged', switchRef: ref, channel: 'batch' };
  return { outcome: 'accepted', switchRef: ref, channel, adjudicatedFunderCents: claim.expectedFunderCents, patientLiabilityCents: claim.expectedPatientCents, message: claim.expectedPatientCents > 0 ? 'Accepted; patient liability per option co-payment' : 'Accepted' };
}

/** Submit through the switch: real-time funders answer now; batch funders acknowledge and answer on the next batch run. */
export function submitToSwitch(claim: ClaimRow): { ack: SwitchResponse; adjudication: SwitchResponse | null } {
  if (switchState.outage) throw new Error('switch_unavailable');
  switchState.submitted++;
  const res = adjudicate(claim);
  if (res.channel === 'realtime') return { ack: { outcome: 'acknowledged', switchRef: res.switchRef, channel: 'realtime' }, adjudication: res };
  if (res.outcome !== 'acknowledged') switchState.pending.push({ claimId: claim.id, response: res });
  else switchState.pending.push({ claimId: claim.id, response: { ...res, outcome: 'accepted', adjudicatedFunderCents: claim.expectedFunderCents, patientLiabilityCents: 0 } });
  return { ack: { outcome: 'acknowledged', switchRef: res.switchRef, channel: 'batch' }, adjudication: null };
}

export const switchRoutes = new Hono<AppEnv>();

switchRoutes.get('/status', (c) => c.json({ rules: switchState.rules, pending: switchState.pending.length, submitted: switchState.submitted, outage: switchState.outage }));

/** Rule-change wave: make the switch reject a code family for a funder (or deactivate a rule). */
switchRoutes.post('/rule-change', allow('BIL', 'SUP', 'EXE', 'PRM', 'AIO'), async (c) => {
  const data = await body(c, z.object({ id: z.string().optional(), funderId: z.string(), codes: z.array(z.string()).default(CT_CODES), reasonCode: z.string().default('AUTH_REQ'), funderCode: z.string().optional(), message: z.string().optional(), requiresAuth: z.boolean().optional(), active: z.boolean().default(true) }));
  const id = data.id ?? `${data.funderId.toUpperCase()}-${data.reasonCode}-${new Date().toISOString().slice(0, 10)}`;
  const existing = switchState.rules.find((r) => r.id === id);
  const funderCode = data.funderCode ?? ({ AUTH_REQ: '4231', ICD_INVALID: '4232', MEMBER_NOT_FOUND: '4101', BENEFIT_EXHAUSTED: '4301', NOT_COVERED: '4302', DUPLICATE: '4401', REFERRER_MISSING: '4501', TECHNICAL: '4900' } as Record<string, string>)[data.reasonCode] ?? '4900';
  const rule: SwitchRule = { id, funderId: data.funderId, codes: data.codes, reasonCode: data.reasonCode, funderCode, message: data.message ?? `Rule change ${id}`, requiresAuth: data.requiresAuth ?? data.reasonCode === 'AUTH_REQ', active: data.active, since: new Date().toISOString().slice(0, 10) };
  if (existing) Object.assign(existing, rule); else switchState.rules.push(rule);
  return c.json({ rule });
});

switchRoutes.post('/outage', allow('SUP', 'BIO', 'EXE'), async (c) => {
  const { outage } = await body(c, z.object({ outage: z.boolean() }));
  switchState.outage = outage;
  return c.json({ outage });
});

/** Release batch adjudications: applies pending responses to their claims. */
switchRoutes.post('/run-batch', allow('BIL', 'SUP', 'EXE', 'PRM'), async (c) => {
  const services = c.get('services');
  const items = switchState.pending.splice(0);
  const out = [];
  for (const it of items) out.push(await applyClaimResponse(services, it.claimId, it.response));
  return c.json({ applied: out.length, claims: out.map((x) => ({ id: x.id, claimRef: x.claimRef, status: x.status })) });
});

/** Generate an ERA (remittance advice) for a funder's accepted claims and run the Remittance Hand on it. */
switchRoutes.post('/remit', allow('BIL', 'DEB', 'SUP', 'EXE', 'PRM'), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  if (!practiceId) return c.json({ error: 'practice_required' }, 400);
  const { funderId, shortPayEvery, limit } = await body(c, z.object({ funderId: z.string(), shortPayEvery: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) }));
  const accepted = await services.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), eq(schema.claims.funderId, funderId), inArray(schema.claims.status, ['accepted']))).limit(limit);
  if (!accepted.length) return c.json({ error: 'nothing_to_remit', message: 'No accepted claims for this funder' }, 409);
  const lines = accepted.map((cl, i) => {
    const short = shortPayEvery && (i + 1) % shortPayEvery === 0;
    const paid = short ? Math.round(cl.expectedFunderCents * 0.72) : cl.expectedFunderCents;
    return { claimRef: cl.claimRef, claimId: cl.id, expectedCents: cl.expectedFunderCents, paidCents: paid, reasonCode: short ? '4303' : null, status: 'unmatched' as const };
  });
  const id = newId('rem');
  const reference = `ERA-${funderId.toUpperCase().replace('SCHEME-', 'S')}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 900) + 100)}`;
  await services.db.insert(schema.remittances).values({ id, practiceId, funderId, reference, receivedAt: new Date().toISOString(), totalCents: lines.reduce((a, l) => a + l.paidCents, 0), lines, status: 'received' });
  const task = await runHand(services, 'remittance', { remittanceId: id }, { practiceId, trigger: 'sim.switch.remit', title: `Remittance ${reference}`, aggregateType: 'remittance', aggregateId: id });
  return c.json({ remittanceId: id, reference, lines: lines.length, task: { id: task.id, status: task.status, output: task.output } });
});

/** Claw-back: a funder reverses a payment on a claim (opens a funder dispute item rather than netting off). */
switchRoutes.post('/clawback/:claimId', allow('BIL', 'SUP'), async (c) => {
  const services = c.get('services');
  const claimId = param(c, 'claimId');
  const [claim] = await services.db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).limit(1);
  if (!claim) return c.json({ error: 'not_found' }, 404);
  await transferPatientLiability(services, claim, claim.paidCents, 'Scheme clawed back the payment after audit', 'not_covered');
  await services.db.update(schema.claims).set({ status: 'short_paid', paidCents: 0 }).where(eq(schema.claims.id, claimId));
  return c.json({ ok: true });
});

export { matchRemittance as _matchRemittance };
