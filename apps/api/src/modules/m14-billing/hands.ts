/**
 * M14 Hands: Coding, Claims, Remittance and Collections.
 * Every Hand's mandate, leash and tool allow-list is enforced by the M20 runtime, not by prompts
 * (docs/12 §2.2: Class 2 actions need rule-pack pass + leash + sampling + reversibility).
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { defineHand, newId } from '@bonakala/domain';
import {
  chooseChannel, collectionsExclusions, daysBetween, dunningStepFor, handoverChecklist, isWithinContactWindow, nextContactSlot, rulePackInForce, DEFAULT_DUNNING_POLICY,
  type Channel, type ShortPaymentClass,
} from '@bonakala/domain/billing';
import { registerHand, type HandRunContext } from '../../kernel/hands.js';
import { emitDirect } from '../../kernel/events.js';
import type { Services } from '../../kernel/ports.js';
import {
  assembleClaim, captureCharge, chargeContext, claimHitsWave, markSubmitted, matchRemittance, openWaves, proposeCoding, repriceCharge, scoreAccount, scrubCharge, shortPaymentReasonText,
  transferPatientLiability, createPaymentLink, nowIso, today, CODING_MODEL, type ChargeRow, type ClaimRow, type ReportSignedPayload,
} from './service.js';

/* ---------- Coding Hand (A3, Class 2 gate) ---------- */
export const codingHand = defineHand({
  id: 'coding', name: 'Coding Hand', module: 'M14',
  mandate: 'Propose tariff codes, modifiers and ICD-10 for a charge with confidence and provenance; auto-accept only when confidence meets the threshold and the scrubber passes with no exclusion. Never submits a claim; never changes a signed report.',
  level: 'A3',
  defaultLeash: { confidenceThreshold: 0.95, maxChargeCents: 2500000, samplePct: 5 },
  approvalPersona: 'BIL', approvalPolicy: 'BIL accepts, edits or rejects anything below threshold, failing the scrubber, or in an exclusion class (RAF, COIDA, corporate, manual amendment, open dispute, above leash).',
  tools: { 'db.read': 'R0', 'llm.coding_rationale': 'R0', 'charge.propose_codes': 'R1', 'charge.accept_codes': 'R1', 'claim.assemble': 'R1', 'charge.queue_exception': 'R1' },
});

export interface CodingInput extends Record<string, unknown> { chargeId: string; trigger?: string; /** ICD-10 exactly as the signed report carried it (empty means the Hand had to suggest one). */ reportIcd10?: string[] }

async function runCoding(input: CodingInput, ctx: HandRunContext) {
  const services = ctx.services;
  const db = services.db;
  const [charge] = await ctx.step('db.read', { chargeId: input.chargeId }, async () => db.select().from(schema.charges).where(eq(schema.charges.id, input.chargeId)).limit(1));
  if (!charge) throw new Error('charge not found');
  const cctx = await ctx.step('db.read', { patientId: charge.patientId }, async () => chargeContext(db, charge));
  if (!cctx) throw new Error('patient not found');

  const reportIcd10 = Array.isArray(input.reportIcd10) ? input.reportIcd10 : charge.icd10;
  const proposal = await ctx.step('charge.propose_codes', { chargeId: charge.id }, async () => proposeCoding({ procedureCodes: charge.procedureCodes, icd10: reportIcd10 }));
  // Optional LLM rationale; always works when llm.available is false (deterministic fallback).
  let rationale = proposal.evidence.join('; ');
  if (services.llm.available) {
    rationale = await ctx.step('llm.coding_rationale', { codes: proposal.procedureCodes }, async () =>
      services.llm.complete({ system: 'You summarise radiology coding evidence for a billing clerk in one sentence. Never state a clinical finding. No patient identifiers.', user: `Tariff codes ${proposal.procedureCodes.join(', ')}; ICD-10 ${proposal.icd10.join(', ')}; evidence: ${proposal.evidence.join('; ')}` }).catch(() => rationale));
  }

  const { scrub, pack, fields } = await ctx.step('db.read', { scrub: charge.id }, async () => scrubCharge(db, charge, cctx));
  const exclusion = exclusionFor(charge, pack.funderType);
  const threshold = Number(ctx.leash.confidenceThreshold ?? 0.95);
  const confidenceOk = proposal.confidence >= threshold;
  ctx.leashCheck([{ rule: 'maxChargeCents', actual: charge.totalCents }]);

  const provenance = {
    ...CODING_MODEL, confidence: proposal.confidence, outputClass: 2 as const, rulePackVersion: scrub.rulePackVersion, evidence: [...proposal.evidence, rationale].filter(Boolean),
    proposedCodes: proposal.procedureCodes, proposedIcd10: proposal.icd10, status: 'proposed' as const, demo: true, llmUsed: services.llm.available,
    gate: { confidenceOk, scrubOk: scrub.pass, exclusion },
  };

  // The gate is domain code, not the prompt (M14-R-104).
  if (confidenceOk && scrub.pass && !exclusion) {
    await ctx.step('charge.accept_codes', { chargeId: charge.id, confidence: proposal.confidence }, async () =>
      db.update(schema.charges).set({ status: 'ready', coding: { ...provenance, status: 'auto_accepted', acceptedBy: 'coding-hand', acceptedAt: nowIso() }, exception: null, blockingReason: null, owner: null, updatedAt: nowIso() }).where(eq(schema.charges.id, charge.id)));
    const [updated] = await db.select().from(schema.charges).where(eq(schema.charges.id, charge.id)).limit(1);
    const claim = await ctx.step('claim.assemble', { chargeId: charge.id }, async () => assembleClaim(services, updated!, cctx, scrub, fields, 'coding-hand'));
    await emitDirect(services, 'coding.accepted.v1', { chargeId: charge.id, practiceId: charge.practiceId, claimId: claim.id, confidence: proposal.confidence, auto: true, modelId: CODING_MODEL.modelId, modelVersion: CODING_MODEL.modelVersion }, { aggregateType: 'charge', aggregateId: charge.id, practiceId: charge.practiceId });
    return { outcome: 'auto_accepted', chargeId: charge.id, claimId: claim.id, claimRef: claim.claimRef, confidence: proposal.confidence, sampled: Math.random() * 100 < Number(ctx.leash.samplePct ?? 5) };
  }

  const finding = scrub.findings.find((f) => f.severity === 'error');
  const family = exclusion ? 'Funder class' : finding ? mapFamily(finding.code) : 'Coding confidence';
  const reason = exclusion ? exclusionText(exclusion) : finding?.message ?? `Coding confidence ${proposal.confidence.toFixed(2)} below threshold ${threshold}`;
  await ctx.step('charge.queue_exception', { chargeId: charge.id, family }, async () =>
    db.update(schema.charges).set({
      status: 'coded', coding: provenance, blockingReason: exclusion ?? (finding ? finding.code.toLowerCase() : 'coding_confidence'), owner: 'BIL',
      exception: { family, reason, code: finding?.code ?? 'CONFIDENCE', suggestion: suggestFix(proposal, finding?.code), openedAt: nowIso() }, updatedAt: nowIso(),
    }).where(eq(schema.charges.id, charge.id)));
  await emitDirect(services, 'coding.proposed.v1', { chargeId: charge.id, practiceId: charge.practiceId, confidence: proposal.confidence, family, reason, modelId: CODING_MODEL.modelId, modelVersion: CODING_MODEL.modelVersion }, { aggregateType: 'charge', aggregateId: charge.id, practiceId: charge.practiceId });
  return { outcome: 'exception', chargeId: charge.id, family, reason, confidence: proposal.confidence, errors: scrub.errors };
}

function exclusionFor(charge: ChargeRow, funderType: string): string | null {
  if (['raf', 'coida', 'corporate'].includes(funderType)) return `${funderType}_a1_by_policy`;
  if (charge.version > 1) return 'manually_amended_charge';
  return null;
}
function exclusionText(e: string) {
  return ({ raf_a1_by_policy: 'RAF claims are assembled by a human per the RAF playbook', coida_a1_by_policy: 'COIDA needs the employer report reference and Fund claim number', corporate_a1_by_policy: 'Corporate invoices are assembled on the monthly run', manually_amended_charge: 'Charge was amended by hand; a human confirms the codes' } as Record<string, string>)[e] ?? e;
}
function mapFamily(code: string) {
  if (code === 'REFERRER_MISSING') return 'Referrer';
  if (code === 'MEMBER_NOT_FOUND' || code === 'DEPENDANT_MISMATCH') return 'Identity';
  if (code === 'AGE_SEX_EDIT' || code === 'DUPLICATE') return 'Data quality';
  if (code === 'ICD_MISSING' || code === 'CONTRAST_NO_NAPPI') return 'Coding confidence';
  return 'Funder rule';
}
function suggestFix(proposal: { procedureCodes: string[]; icd10: string[]; confidence: number }, code?: string) {
  switch (code) {
    case 'AUTH_REQ': return 'Request a retrospective authorisation (M06) and attach the number, then resubmit';
    case 'ICD_MISSING': return `Accept the proposed primary ICD-10 ${proposal.icd10[0]} or pick the code the report supports`;
    case 'ICD_INVALID': return 'Replace the symptom code with the diagnosis the signed report supports';
    case 'REFERRER_MISSING': return 'Look up the referrer in the directory and back-fill the practice number';
    case 'MEMBER_NOT_FOUND': return 'Confirm the member number with the patient, then resubmit';
    default: return `Confirm tariff codes ${proposal.procedureCodes.join(', ')} and ICD-10 ${proposal.icd10.join(', ')} against the signed report`;
  }
}

/* ---------- Claims Hand (A3) ---------- */
export const claimsHand = defineHand({
  id: 'claims', name: 'Claims Hand', module: 'M14',
  mandate: 'Submit scrubbed claims through the switch within leash, record acknowledgements, retry transport failures and resubmit deterministic fixes. Never changes tariff, modifier or ICD-10 content; never resubmits a rejected claim more than twice without a human.',
  level: 'A3',
  defaultLeash: { maxClaimCents: 2500000, maxDailyCents: 50000000, maxBatchClaims: 200, maxResubmits: 2 },
  approvalPersona: 'BIL', approvalPolicy: 'BIL confirms claims above the per-claim leash, RAF/COIDA/corporate classes, and claims held by an open rejection wave.',
  tools: { 'db.read': 'R0', 'switch.submit': 'R2', 'claim.hold': 'R1', 'claim.record_ack': 'R1' },
});

export interface ClaimsInput extends Record<string, unknown> { claimIds?: string[]; practiceId?: string | null; channel?: 'batch' | 'realtime'; reason?: string }

async function runClaims(input: ClaimsInput, ctx: HandRunContext) {
  const services = ctx.services;
  const db = services.db;
  const practiceId = (input.practiceId as string | null) ?? ctx.practiceId;
  const { submitToSwitch } = await import('../../sim/switch.js');
  const candidates = await ctx.step('db.read', { claimIds: input.claimIds?.length ?? 'all-ready' }, async () =>
    input.claimIds?.length
      ? db.select().from(schema.claims).where(inArray(schema.claims.id, input.claimIds))
      : db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId!), eq(schema.claims.status, 'scrubbed'))));

  const waves = practiceId ? await ctx.step('db.read', { waves: practiceId }, async () => openWaves(db, practiceId)) : [];
  const since = today();
  const submittedToday = await ctx.step('db.read', { dailyTotal: since }, async () => db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId!), gte(schema.claims.submittedAt, since))));
  let dailyCents = submittedToday.reduce((a, c) => a + c.totalCents, 0);

  const submitted: Array<{ id: string; claimRef: string; outcome: string }> = [];
  const held: Array<{ id: string; claimRef: string; reason: string }> = [];
  const batchId = newId('bat');

  for (const claim of candidates.slice(0, Number(ctx.leash.maxBatchClaims ?? 200))) {
    if (!['scrubbed', 'rejected', 'held'].includes(claim.status)) continue;
    if (claim.resubmitCount > Number(ctx.leash.maxResubmits ?? 2) && !ctx.approved) {
      held.push({ id: claim.id, claimRef: claim.claimRef, reason: 'resubmission limit reached; BIL confirms' });
      await holdClaim(db, claim, 'Resubmission limit reached', 'Funder rule', 'ABOVE_LEASH');
      continue;
    }
    // A live rejection wave pauses the rule for that funder and code family.
    const wave = claimHitsWave(claim, waves);
    if (wave && !ctx.approved) {
      held.push({ id: claim.id, claimRef: claim.claimRef, reason: `rejection wave ${wave.funderId}/${wave.reasonCode}` });
      await ctx.step('claim.hold', { claimId: claim.id, wave: wave.reasonCode }, async () => holdClaim(db, claim, `Held: open rejection wave (${wave.reasonCode}) for ${wave.funderId}`, 'Funder rule', wave.reasonCode));
      continue;
    }
    if (claim.totalCents > Number(ctx.leash.maxClaimCents ?? Infinity) && !ctx.approved) {
      held.push({ id: claim.id, claimRef: claim.claimRef, reason: 'above per-claim leash' });
      await ctx.step('claim.hold', { claimId: claim.id }, async () => holdClaim(db, claim, 'Above the auto-submission leash; human confirmation required', 'Funder rule', 'ABOVE_LEASH'));
      continue;
    }
    if (['raf', 'coida', 'corporate'].includes(claim.funderType) && !ctx.approved) {
      held.push({ id: claim.id, claimRef: claim.claimRef, reason: `${claim.funderType} is A1 by policy` });
      await ctx.step('claim.hold', { claimId: claim.id }, async () => holdClaim(db, claim, `${claim.funderType.toUpperCase()} claims are assembled and submitted by a human`, 'Funder class', 'ABOVE_LEASH'));
      continue;
    }
    ctx.leashCheck([{ rule: 'maxDailyCents', actual: dailyCents + claim.totalCents }]);
    try {
      const { ack, adjudication } = await ctx.step('switch.submit', { claimId: claim.id, claimRef: claim.claimRef, cents: claim.totalCents }, async () => submitToSwitch(claim));
      await ctx.step('claim.record_ack', { claimId: claim.id, switchRef: ack.switchRef }, async () => markSubmitted(services, claim, ack, `hand:claims`, batchId));
      dailyCents += claim.totalCents;
      if (adjudication) {
        const { applyClaimResponse } = await import('./service.js');
        const after = await applyClaimResponse(services, claim.id, adjudication);
        submitted.push({ id: claim.id, claimRef: claim.claimRef, outcome: after.status });
      } else submitted.push({ id: claim.id, claimRef: claim.claimRef, outcome: 'submitted' });
    } catch (e) {
      held.push({ id: claim.id, claimRef: claim.claimRef, reason: (e as Error).message });
      await holdClaim(db, claim, `Switch transport failure: ${(e as Error).message}; the Hand retries on the next batch`, 'Technical', 'TECHNICAL');
    }
  }
  return { batchId, submitted: submitted.length, held: held.length, claims: submitted, heldClaims: held, dailyCents };
}
async function holdClaim(db: Services['db'], claim: ClaimRow, reason: string, family: string, code: string) {
  await db.update(schema.claims).set({ status: 'held', exception: { family, reason, code, suggestion: 'Review and submit from the claims console', path: 'manual', level: 'A1', openedAt: nowIso() }, updatedAt: nowIso() }).where(eq(schema.claims.id, claim.id));
}

/* ---------- Remittance Hand (A3) ---------- */
export const remittanceHand = defineHand({
  id: 'remittance', name: 'Remittance Hand', module: 'M14',
  mandate: 'Parse ERAs, match lines to claims within tolerance, post allocations and transfer patient liability with the funder reason. Never writes off, never refunds, never changes a claim line.',
  level: 'A3',
  defaultLeash: { toleranceCents: 100, maxLiabilityCents: 1000000, maxLinesPerRun: 500 },
  approvalPersona: 'DEB', approvalPolicy: 'DEB reviews unmatched lines and any patient liability above the leash.',
  tools: { 'db.read': 'R0', 'remittance.match': 'R1', 'claim.post_allocation': 'R1', 'account.transfer_liability': 'R2' },
});
export interface RemittanceInput extends Record<string, unknown> { remittanceId: string }

async function runRemittance(input: RemittanceInput, ctx: HandRunContext) {
  const services = ctx.services;
  const db = services.db;
  const [rem] = await ctx.step('db.read', { remittanceId: input.remittanceId }, async () => db.select().from(schema.remittances).where(eq(schema.remittances.id, input.remittanceId)).limit(1));
  if (!rem) throw new Error('remittance not found');
  ctx.leashCheck([{ rule: 'maxLinesPerRun', actual: rem.lines.length }]);
  const tolerance = Number(ctx.leash.toleranceCents ?? 100);
  const outcome = await ctx.step('remittance.match', { remittanceId: rem.id, lines: rem.lines.length }, async () =>
    matchRemittance(services, rem.id, {
      toleranceCents: tolerance,
      post: async (claimId, patch) => { await db.update(schema.claims).set({ ...patch, updatedAt: nowIso() } as Record<string, unknown>).where(eq(schema.claims.id, claimId)); },
      transfer: async (claim: ClaimRow, cents: number, reason: string, cls: ShortPaymentClass) => {
        if (cents <= 0) return;
        ctx.leashCheck([{ rule: 'maxLiabilityCents', actual: cents }]);
        await ctx.step('account.transfer_liability', { claimId: claim.id, cents, cls }, async () => transferPatientLiability(services, claim, cents, reason || shortPaymentReasonText(cls), cls));
      },
    }));
  await db.update(schema.remittances).set({ handTaskId: 'remittance-hand' }).where(eq(schema.remittances.id, rem.id));
  if (outcome.unmatched) ctx.log(`${outcome.unmatched} lines unmatched; queued for DEB with ranked candidates`);
  return { remittanceId: rem.id, reference: rem.reference, ...outcome } as Record<string, unknown>;
}

/* ---------- Collections Hand (A3) ---------- */
export const collectionsHand = defineHand({
  id: 'collections', name: 'Collections Hand', module: 'M14',
  mandate: 'Respectful, lawful, multi-channel dunning for patient balances within the Practice policy; offer plans within policy; escalate to DEB; propose handover. Never threatens, never discounts, never writes off, never contacts outside the permitted hours or an excluded account, never includes clinical content.',
  level: 'A3',
  defaultLeash: { maxWriteOffCents: 0, maxPlanCents: 500000, maxContactsPerWeek: 2, maxActionsPerRun: 400, maxAmountCents: 1500000 },
  approvalPersona: 'DEB', approvalPolicy: 'DEB approves plans above the plan leash and any handover proposal; PRM confirms the handover file. The Hand may never write off.',
  tools: { 'db.read': 'R0', 'account.score': 'R0', 'dunning.schedule_action': 'R1', 'payment.create_link': 'R2', 'plan.propose': 'R1', 'handover.propose': 'R1' },
});
export interface CollectionsInput extends Record<string, unknown> { practiceId?: string | null; asOf?: string; dryRun?: boolean }

async function runCollections(input: CollectionsInput, ctx: HandRunContext) {
  const services = ctx.services;
  const db = services.db;
  const practiceId = (input.practiceId as string | null) ?? ctx.practiceId;
  if (!practiceId) throw new Error('practiceId required');
  const asOf = (input.asOf as string) ?? today();
  const runAt = nowIso();
  const policy = DEFAULT_DUNNING_POLICY;

  const accounts = await ctx.step('db.read', { practiceId }, async () => db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, practiceId), eq(schema.patientAccounts.status, 'open'))));
  const runId = newId('run');
  const byChannel: Record<string, number> = {};
  const byStep: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  const exclusions: Record<string, number> = {};
  const needsHuman: Array<{ accountId: string; reason: string }> = [];
  let actions = 0;
  let insideWindow = 0;

  for (const a of accounts) {
    const ex = collectionsExclusions({ balanceCents: a.balanceCents, ageingStartAt: a.ageingStartAt ?? a.createdAt, flags: a.flags, debtorClass: a.debtorClass as 'patient', lastContactAt: a.lastContactAt, contactsLast7d: a.contactsLast7d, planStatus: a.planId ? 'active' : 'none', dueDate: a.dueDate ?? undefined }, asOf, policy);
    if (ex.length) {
      for (const e of ex) exclusions[e] = (exclusions[e] ?? 0) + 1;
      continue;
    }
    const score = await ctx.step('account.score', { accountId: a.id }, async () => scoreAccount(db, a, asOf));
    byBand[score.band] = (byBand[score.band] ?? 0) + 1;
    const days = daysBetween(a.ageingStartAt ?? a.createdAt, asOf);
    const step = dunningStepFor(days, policy);
    if (!step) continue;

    if (step.action === 'handover_proposal') {
      const check = handoverChecklist({ balanceCents: a.balanceCents, ageingStartAt: a.ageingStartAt ?? a.createdAt, flags: a.flags, debtorClass: a.debtorClass as 'patient', delivered: a.delivered, daysSinceNotification: days }, asOf, policy);
      const existing = await db.select().from(schema.handovers).where(and(eq(schema.handovers.accountId, a.id), inArray(schema.handovers.status, ['proposed', 'approved', 'released']))).limit(1);
      if (!existing.length) {
        await ctx.step('handover.propose', { accountId: a.id, clean: check.clean }, async () =>
          db.insert(schema.handovers).values({ id: newId('hov'), practiceId, accountId: a.id, patientId: a.patientId, amountCents: a.balanceCents, checklist: check.checklist as unknown as Record<string, boolean>, clean: check.clean, failing: check.failing, prescriptionDate: a.dueDate, status: 'proposed', proposedBy: 'collections-hand', handTaskId: runId }));
        needsHuman.push({ accountId: a.id, reason: 'handover proposal needs DEB review and PRM approval' });
        await emitDirect(services, 'collections.handover.proposed.v1', { accountId: a.id, practiceId, amountCents: a.balanceCents, clean: check.clean }, { aggregateType: 'account', aggregateId: a.id, practiceId });
      }
      byStep[step.id] = (byStep[step.id] ?? 0) + 1;
      continue;
    }
    if (step.action === 'deb_review') {
      needsHuman.push({ accountId: a.id, reason: 'day-60 review: settlement offer, plan or handover' });
      byStep[step.id] = (byStep[step.id] ?? 0) + 1;
      continue;
    }
    if (a.balanceCents > Number(ctx.leash.maxAmountCents ?? Infinity)) {
      needsHuman.push({ accountId: a.id, reason: 'balance above the Hand leash' });
      continue;
    }

    const channel: Channel = chooseChannel((a.consentChannels ?? []) as Channel[], step, policy);
    const scheduledFor = nextContactSlot(runAt, policy);
    if (isWithinContactWindow(scheduledFor, policy)) insideWindow++;
    let paylinkToken: string | null = null;
    if (step.action === 'reminder_paylink' || (step.offersPlan && score.band === 'high')) {
      const link = await ctx.step('payment.create_link', { accountId: a.id, cents: a.balanceCents }, async () => createPaymentLink(services, { practiceId, accountId: a.id, amountCents: a.balanceCents, channel, createdBy: 'collections-hand' }));
      paylinkToken = link.token;
    }
    if (step.offersPlan && a.balanceCents > 200000 && a.balanceCents <= Number(ctx.leash.maxPlanCents ?? 500000)) ctx.log(`Plan offered on ${a.accountNo} within the plan leash`);
    if (step.offersPlan && a.balanceCents > Number(ctx.leash.maxPlanCents ?? 500000)) needsHuman.push({ accountId: a.id, reason: 'plan above the plan leash needs DEB approval' });

    await ctx.step('dunning.schedule_action', { accountId: a.id, step: step.id, channel }, async () =>
      db.insert(schema.dunningActions).values({ id: newId('dna'), practiceId, runId, accountId: a.id, patientId: a.patientId, step: step.id, channel, template: `${step.action}.v${policy.version}`, language: a.language, amountCents: a.balanceCents, scheduledFor, sentAt: input.dryRun ? null : scheduledFor, status: input.dryRun ? 'scheduled' : 'sent', paylinkToken }));
    if (!input.dryRun) {
      await db.update(schema.patientAccounts).set({ dunningStage: step.id, lastContactAt: scheduledFor, contactsLast7d: a.contactsLast7d + 1, delivered: [...new Set([...a.delivered, step.action])], propensity: score as unknown as Record<string, unknown>, updatedAt: runAt }).where(eq(schema.patientAccounts.id, a.id));
    }
    actions++;
    byChannel[channel] = (byChannel[channel] ?? 0) + 1;
    byStep[step.id] = (byStep[step.id] ?? 0) + 1;
    if (actions >= Number(ctx.leash.maxActionsPerRun ?? 400)) break;
  }

  await db.insert(schema.dunningRuns).values({
    id: runId, practiceId, startedAt: runAt, finishedAt: nowIso(), handTaskId: 'collections-hand', policyVersion: policy.version, actions, byChannel, byStep, byBand, exclusions, insideWindow, needsHuman: needsHuman.length, status: 'done',
  });
  await emitDirect(services, 'collections.run.completed.v1', { runId, practiceId, actions, needsHuman: needsHuman.length, exclusions: Object.values(exclusions).reduce((a, b) => a + b, 0) }, { aggregateType: 'dunning_run', aggregateId: runId, practiceId });
  return { runId, actions, byChannel, byStep, byBand, exclusions, needsHuman: needsHuman.length, insideWindow, allInsideWindow: insideWindow === actions };
}

/* ---------- Registration ---------- */
export function registerBillingHands() {
  registerHand<CodingInput, Record<string, unknown>>(codingHand, runCoding as never);
  registerHand<ClaimsInput, Record<string, unknown>>(claimsHand, runClaims as never);
  registerHand<RemittanceInput, Record<string, unknown>>(remittanceHand, runRemittance as never);
  registerHand<CollectionsInput, Record<string, unknown>>(collectionsHand, runCollections as never);
}

/** Charge capture on report.signed.v1, then the Coding Hand. */
export async function onReportSigned(services: Services, payload: ReportSignedPayload) {
  const result = await captureCharge(services, payload);
  if (!result || !result.created) return result;
  const { runHand } = await import('../../kernel/hands.js');
  await runHand(services, 'coding', { chargeId: result.charge.id, trigger: 'report.signed.v1', reportIcd10: payload.icd10 ?? [] }, { practiceId: payload.practiceId, trigger: 'report.signed.v1', title: `Code charge for ${payload.accession ?? result.charge.id}`, aggregateType: 'charge', aggregateId: result.charge.id });
  return result;
}

export { repriceCharge, rulePackInForce };
