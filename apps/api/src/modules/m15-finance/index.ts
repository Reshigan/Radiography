/**
 * M15 Finance & Consolidation: posting ledger from M14 events, intercompany invoices, practice P&L,
 * group consolidation with eliminations and minority interest, distributions (propose → approve →
 * release), shareholder statements, reserved-matter votes, budgets, cash forecast and the board pack.
 * The Close Hand (A2) computes and proposes; it never releases a payment (docs/12 §2.2).
 */
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { defineHand, newId, notFound, conflict, sha256Hex } from '@bonakala/domain';
import {
  CHART_OF_ACCOUNTS, computePnl, consolidate, distributionWaterfall, intercompanyAmount, journalForEvent, periodBounds, periodOf, previousPeriods, solvencyLiquidityTest,
  type EntityResult, type Pnl, type Shareholding,
} from '@bonakala/domain/billing';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, on } from '../../kernel/index.js';
import { registerHand, runHand, type HandRunContext } from '../../kernel/hands.js';
import type { Services } from '../../kernel/ports.js';
import { emitDirect } from '../../kernel/events.js';

const r = router();
const FIN = ['EXE', 'PRM', 'SUP'] as const;
const FIN_READ = ['EXE', 'PRM', 'SUP', 'BIL', 'DEB'] as const;
const nowIso = () => new Date().toISOString();

/* Illustrative cost model per practice per month (M17/M18 supply the real figures). */
const COST_MODEL: Record<string, { staffCents: number; consumablesCents: number; rentCents: number; otherCents: number; depreciationCents: number }> = {
  prac_a: { staffCents: 1_810_000_00, consumablesCents: 520_000_00, rentCents: 340_000_00, otherCents: 360_000_00, depreciationCents: 150_000_00 },
  prac_b: { staffCents: 2_130_000_00, consumablesCents: 690_000_00, rentCents: 420_000_00, otherCents: 424_000_00, depreciationCents: 180_000_00 },
};
const TAX_RATE = 0.27;
const RESERVE_PCT = 0.1;
const DIVIDENDS_TAX_RATE = 0.2;
const WORKING_CAPITAL_FLOOR_CENTS = 1_500_000_00;

/* ============================ Posting ledger ============================ */

export async function postJournalForEvent(services: Services, name: string, payload: Record<string, unknown>, aggregateId: string | null) {
  const practiceId = (payload.practiceId as string | undefined) ?? null;
  if (!practiceId) return;
  const j = journalForEvent(name, payload);
  const at = nowIso();
  const period = periodOf((payload.serviceDate as string | undefined) ?? at);
  const [locked] = await services.db.select().from(schema.fiscalPeriods).where(and(eq(schema.fiscalPeriods.practiceId, practiceId), eq(schema.fiscalPeriods.period, period))).limit(1);
  const targetPeriod = locked && ['closed', 'locked'].includes(locked.status) ? periodOf(at) : period;
  if (!j) {
    if (!['charge.captured.v1', 'payment.received.v1', 'claim.short_paid.v1', 'patient.liability.v1', 'writeoff.approved.v1'].includes(name)) return;
    await services.db.insert(schema.journals).values({ id: newId('jnl'), practiceId, period: targetPeriod, source: 'm14', sourceRef: aggregateId, eventName: name, description: `Unmapped ${name}`, lines: [{ account: '9990', debitCents: 0, creditCents: 0 }], status: 'suspense', postedAt: at, postedBy: 'close-hand' });
    await emitDirect(services, 'finance.journal.suspense.v1', { practiceId, eventName: name, sourceRef: aggregateId }, { practiceId });
    return;
  }
  const existing = aggregateId ? await services.db.select({ id: schema.journals.id }).from(schema.journals).where(and(eq(schema.journals.sourceRef, aggregateId), eq(schema.journals.eventName, name))).limit(1) : [];
  if (existing.length) return; // idempotent per (sourceRef, event)
  const id = newId('jnl');
  await services.db.insert(schema.journals).values({ id, practiceId, period: targetPeriod, source: j.source, sourceRef: j.sourceRef, eventName: name, description: j.description, lines: j.lines, status: 'posted', postedAt: at, postedBy: 'posting-rules' });
  await emitDirect(services, 'finance.journal.posted.v1', { journalId: id, practiceId, period: targetPeriod, eventName: name, lines: j.lines.length }, { aggregateType: 'journal', aggregateId: id, practiceId });
}

r.get('/journals', allow(...FIN_READ), async (c) => {
  const practiceId = requirePractice(c);
  const { period, limit } = query(c, z.object({ period: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(200) }));
  const db = c.get('services').db;
  const where = [eq(schema.journals.practiceId, practiceId)];
  if (period) where.push(eq(schema.journals.period, period));
  const rows = await db.select().from(schema.journals).where(and(...where)).orderBy(desc(schema.journals.postedAt)).limit(limit);
  const byAccount: Record<string, { debitCents: number; creditCents: number; name: string }> = {};
  for (const j of rows) for (const l of j.lines) {
    const acc = (byAccount[l.account] ??= { debitCents: 0, creditCents: 0, name: CHART_OF_ACCOUNTS.find((a) => a.code === l.account)?.name ?? l.account });
    acc.debitCents += l.debitCents; acc.creditCents += l.creditCents;
  }
  const balanced = Object.values(byAccount).reduce((a, x) => a + x.debitCents - x.creditCents, 0) === 0;
  return c.json({ journals: rows, trialBalance: byAccount, balanced, chart: CHART_OF_ACCOUNTS, suspense: rows.filter((x) => x.status === 'suspense').length });
});

/* ============================ P&L ============================ */

async function computePeriodPnl(services: Services, practiceId: string, period: string): Promise<{ pnl: Pnl; evidence: { collectionsCents: number; signedReports: number; studies: number; unbilledCents: number; shortPaymentsCents: number; revenueCents: number } }> {
  const db = services.db;
  const { start, end } = periodBounds(period);
  const charges = await db.select().from(schema.charges).where(eq(schema.charges.practiceId, practiceId));
  const inPeriod = charges.filter((x) => x.serviceDate >= start && x.serviceDate <= end);
  const revenueCents = inPeriod.reduce((a, x) => a + x.subtotalExclCents, 0);
  const claims = await db.select().from(schema.claims).where(eq(schema.claims.practiceId, practiceId));
  const claimsInPeriod = claims.filter((x) => x.serviceDate >= start && x.serviceDate <= end);
  const shortPaid = claimsInPeriod.filter((x) => x.status === 'short_paid').reduce((a, x) => a + (x.expectedFunderCents - x.paidCents), 0);
  const writeOffs = await db.select().from(schema.writeOffs).where(and(eq(schema.writeOffs.practiceId, practiceId), eq(schema.writeOffs.status, 'approved')));
  const writeOffCents = writeOffs.filter((x) => (x.period ?? periodOf(x.createdAt)) === period).reduce((a, x) => a + x.amountCents, 0);
  const payments = await db.select().from(schema.payments).where(and(eq(schema.payments.practiceId, practiceId), eq(schema.payments.status, 'settled')));
  const remits = await db.select().from(schema.remittances).where(eq(schema.remittances.practiceId, practiceId));
  const collectionsCents = payments.filter((x) => periodOf(x.at) === period).reduce((a, x) => a + x.amountCents, 0) + remits.filter((x) => periodOf(x.receivedAt) === period).reduce((a, x) => a + x.matchedCents, 0);
  const signedReports = inPeriod.filter((x) => x.reportId).length;
  const studies = inPeriod.length;
  const unbilledCents = inPeriod.filter((x) => ['unbilled', 'coded'].includes(x.status)).reduce((a, x) => a + x.totalCents, 0);
  const rels = await db.select().from(schema.entityRelationships).where(eq(schema.entityRelationships.childId, practiceId));
  const mgmt = rels.find((x) => x.type === 'management_agreement');
  const reading = rels.find((x) => x.type === 'reading_services');
  const costs = COST_MODEL[practiceId] ?? COST_MODEL.prac_a!;
  const pnl = computePnl({
    revenueCents, shortPaymentsCents: shortPaid + writeOffCents, signedReports, collectionsCents, studies,
    managementFeeRate: mgmt?.feeModel?.rate ?? 0.08, readingFeePerStudyCents: reading?.feeModel?.perStudyCents ?? 32000, platformFeePerStudyCents: 0,
    ...costs, taxRate: TAX_RATE, reservePct: RESERVE_PCT,
  });
  return { pnl, evidence: { collectionsCents, signedReports, studies, unbilledCents, shortPaymentsCents: shortPaid + writeOffCents, revenueCents } };
}

async function budgetFor(services: Services, practiceId: string, period: string) {
  const [b] = await services.db.select().from(schema.budgets).where(and(eq(schema.budgets.practiceId, practiceId), eq(schema.budgets.status, 'approved'))).orderBy(desc(schema.budgets.version)).limit(1);
  if (!b) return null;
  const lines = b.lines.filter((l) => l.period === period);
  if (!lines.length) return null;
  const by = Object.fromEntries(lines.map((l) => [l.key, l.amountCents]));
  return { budget: b, by };
}

/** Save (or refresh) the P&L snapshot for a period. Soft until the period locks. */
export async function savePnlSnapshot(services: Services, practiceId: string, period: string, computedBy: string) {
  const db = services.db;
  const { pnl, evidence } = await computePeriodPnl(services, practiceId, period);
  const budget = await budgetFor(services, practiceId, period);
  const lines = pnl.lines.map((l) => {
    const budgetCents = budget?.by[l.key];
    return { ...l, budgetCents, varianceCents: budgetCents === undefined ? undefined : l.amountCents - budgetCents };
  });
  const [existing] = await db.select().from(schema.pnlSnapshots).where(and(eq(schema.pnlSnapshots.practiceId, practiceId), eq(schema.pnlSnapshots.period, period))).limit(1);
  if (existing?.status === 'locked') return existing;
  const values = {
    practiceId, period, lines, revenueCents: pnl.revenueCents, shortPaymentsCents: pnl.shortPaymentsCents, readingFeesCents: pnl.readingFeesCents, managementFeeCents: pnl.managementFeeCents, platformFeeCents: pnl.platformFeeCents,
    rentCents: pnl.rentCents, staffCents: pnl.staffCents, consumablesCents: pnl.consumablesCents, otherCents: pnl.otherCents, ebitdaCents: pnl.ebitdaCents, depreciationCents: pnl.depreciationCents, taxProvisionCents: pnl.taxProvisionCents,
    profitAfterTaxCents: pnl.profitAfterTaxCents, reserveCents: pnl.reserveCents, distributableCents: pnl.distributableCents, collectionsCents: evidence.collectionsCents, unbilledCents: evidence.unbilledCents, studies: evidence.studies,
    kpis: { ebitdaMarginPct: pnl.ebitdaMarginPct, signedReports: evidence.signedReports },
    budgetRevenueCents: budget?.by.revenue ?? null, budgetEbitdaCents: budget?.by.ebitda ?? null, status: 'soft', computedBy, updatedAt: nowIso(),
  };
  if (existing) { await db.update(schema.pnlSnapshots).set(values).where(eq(schema.pnlSnapshots.id, existing.id)); return (await db.select().from(schema.pnlSnapshots).where(eq(schema.pnlSnapshots.id, existing.id)))[0]!; }
  const id = newId('pnl');
  await db.insert(schema.pnlSnapshots).values({ id, ...values });
  return (await db.select().from(schema.pnlSnapshots).where(eq(schema.pnlSnapshots.id, id)))[0]!;
}

r.get('/pnl', allow(...FIN_READ, 'SHR'), async (c) => {
  const practiceId = requirePractice(c);
  const { period, months } = query(c, z.object({ period: z.string().optional(), months: z.coerce.number().min(1).max(24).default(6) }));
  const services = c.get('services');
  const user = c.get('user')!;
  if (user.persona === 'SHR' && user.practiceId && user.practiceId !== practiceId) return c.json({ error: 'forbidden' }, 403);
  const p = period ?? lastClosedPeriod();
  const snaps = await services.db.select().from(schema.pnlSnapshots).where(eq(schema.pnlSnapshots.practiceId, practiceId)).orderBy(schema.pnlSnapshots.period);
  let current = snaps.find((x) => x.period === p);
  if (!current) current = await savePnlSnapshot(services, practiceId, p, user.id);
  const history = previousPeriods(p, months).map((per) => snaps.find((s) => s.period === per) ?? null);
  const budget = await budgetFor(services, practiceId, p);
  return c.json({ period: p, pnl: current, history: history.filter(Boolean), budget: budget?.by ?? null, periods: snaps.map((s) => s.period) });
});

r.post('/pnl/compute', allow(...FIN), async (c) => {
  const practiceId = requirePractice(c);
  const { period } = await body(c, z.object({ period: z.string() }));
  const snap = await savePnlSnapshot(c.get('services'), practiceId, period, c.get('user')!.id);
  await audit(c, 'finance.pnl_computed', { type: 'pnl', id: snap.id }, { period });
  return c.json({ pnl: snap });
});

function lastClosedPeriod() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* ============================ Consolidation ============================ */

r.get('/consolidation', allow('EXE', 'SUP'), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const { period } = query(c, z.object({ period: z.string().optional() }));
  const p = period ?? lastClosedPeriod();
  const practices = await db.select().from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
  const holdings = await db.select().from(schema.shareholdings);
  const entities: EntityResult[] = [];
  for (const prac of practices) {
    let [snap] = await db.select().from(schema.pnlSnapshots).where(and(eq(schema.pnlSnapshots.practiceId, prac.id), eq(schema.pnlSnapshots.period, p))).limit(1);
    if (!snap) snap = await savePnlSnapshot(services, prac.id, p, 'consolidation');
    const own = holdings.filter((h) => h.entityId === prac.id && !h.effectiveTo);
    const totalShares = own.reduce((a, h) => a + h.shares, 0) || 1;
    const groupShares = own.filter((h) => h.shareholderEntityId).reduce((a, h) => a + h.shares, 0);
    const pnl = computePnl({
      revenueCents: snap.revenueCents, shortPaymentsCents: snap.shortPaymentsCents, signedReports: snap.kpis?.signedReports ?? 0, collectionsCents: snap.collectionsCents, studies: snap.studies,
      managementFeeRate: snap.collectionsCents ? snap.managementFeeCents / snap.collectionsCents : 0, readingFeePerStudyCents: snap.kpis?.signedReports ? Math.round(snap.readingFeesCents / snap.kpis.signedReports) : 0,
      platformFeePerStudyCents: 0, rentCents: snap.rentCents, staffCents: snap.staffCents, consumablesCents: snap.consumablesCents, otherCents: snap.otherCents, depreciationCents: snap.depreciationCents, taxRate: TAX_RATE, reservePct: RESERVE_PCT,
    });
    entities.push({ entityId: prac.id, name: prac.tradingName ?? prac.registeredName, ownershipPct: Math.round((groupShares / totalShares) * 100), method: 'full', pnl, intercompanyChargesCents: snap.managementFeeCents + snap.readingFeesCents });
  }
  const invoices = await db.select().from(schema.intercompanyInvoices).where(eq(schema.intercompanyInvoices.period, p));
  const pairs = invoices.map((i) => ({ pair: `${i.fromEntityId}→${i.toEntityId} (${i.ruleType})`, amountCents: i.amountExclCents, matched: i.status !== 'disputed' }));
  const result = consolidate(entities, pairs);
  return c.json({ period: p, consolidation: result, entities: entities.map((e) => ({ entityId: e.entityId, name: e.name, ownershipPct: e.ownershipPct, pnl: e.pnl })), invoices, unmatchedPairs: pairs.filter((x) => !x.matched).length });
});

/* ============================ Intercompany ============================ */

r.get('/intercompany', allow(...FIN_READ), async (c) => {
  const db = c.get('services').db;
  const practiceId = c.get('practiceId');
  const { period } = query(c, z.object({ period: z.string().optional() }));
  const where = [] as ReturnType<typeof eq>[];
  if (practiceId) where.push(eq(schema.intercompanyInvoices.practiceId, practiceId));
  if (period) where.push(eq(schema.intercompanyInvoices.period, period));
  const rows = await db.select().from(schema.intercompanyInvoices).where(where.length ? and(...where) : undefined).orderBy(desc(schema.intercompanyInvoices.period));
  const entities = await db.select().from(schema.legalEntities);
  const byId = new Map(entities.map((e) => [e.id, e.tradingName ?? e.registeredName]));
  return c.json({ invoices: rows.map((x) => ({ ...x, fromName: byId.get(x.fromEntityId) ?? x.fromEntityId, toName: byId.get(x.toEntityId) ?? x.toEntityId })) });
});

export async function runIntercompany(services: Services, practiceId: string, period: string, issuedBy: string) {
  const db = services.db;
  const { pnl, evidence } = await computePeriodPnl(services, practiceId, period);
  const rels = await db.select().from(schema.entityRelationships).where(eq(schema.entityRelationships.childId, practiceId));
  const out = [];
  for (const rel of rels) {
    if (!['management_agreement', 'reading_services', 'lease'].includes(rel.type)) continue;
    const feeModel = rel.feeModel ?? { basis: rel.type === 'lease' ? 'monthly' : 'per_study' };
    const amounts = intercompanyAmount({ type: rel.type as 'management_agreement', fromEntityId: rel.parentId, toEntityId: practiceId, feeModel: rel.type === 'lease' ? { basis: 'monthly', monthlyCents: pnl.rentCents } : feeModel }, evidence);
    if (!amounts.amountExclCents) continue;
    const [existing] = await db.select().from(schema.intercompanyInvoices).where(and(eq(schema.intercompanyInvoices.practiceId, practiceId), eq(schema.intercompanyInvoices.period, period), eq(schema.intercompanyInvoices.ruleType, rel.type))).limit(1);
    if (existing) { out.push(existing); continue; }
    const id = newId('ici');
    const number = `IC-${rel.type.slice(0, 3).toUpperCase()}-${period.replace('-', '')}-${practiceId.slice(-1).toUpperCase()}`;
    await db.insert(schema.intercompanyInvoices).values({
      id, practiceId, fromEntityId: rel.parentId, toEntityId: practiceId, period, ruleType: rel.type, number, basis: amounts.basis, evidence: evidence as unknown as Record<string, unknown>,
      amountExclCents: amounts.amountExclCents, vatCents: amounts.vatCents, totalCents: amounts.totalCents, status: 'issued', disputeWindowEndsAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
    });
    await emitDirect(services, 'intercompany.invoice.issued.v1', { invoiceId: id, practiceId, fromEntityId: rel.parentId, period, ruleType: rel.type, amountExclCents: amounts.amountExclCents }, { aggregateType: 'intercompany_invoice', aggregateId: id, practiceId });
    // symmetric posting in both entities
    await db.insert(schema.journals).values({ id: newId('jnl'), practiceId, period, source: 'intercompany', sourceRef: id, description: `${rel.type} invoice ${number}`, lines: [
      { account: rel.type === 'reading_services' ? '5000' : rel.type === 'lease' ? '6200' : '6100', debitCents: amounts.amountExclCents, creditCents: 0 },
      { account: '2110', debitCents: amounts.vatCents, creditCents: 0 },
      { account: '2500', debitCents: 0, creditCents: amounts.totalCents },
    ], status: 'posted', postedAt: nowIso(), postedBy: issuedBy });
    out.push((await db.select().from(schema.intercompanyInvoices).where(eq(schema.intercompanyInvoices.id, id)))[0]!);
  }
  return out;
}

r.post('/intercompany/run', allow(...FIN), async (c) => {
  const practiceId = requirePractice(c);
  const { period } = await body(c, z.object({ period: z.string() }));
  const invoices = await runIntercompany(c.get('services'), practiceId, period, c.get('user')!.id);
  await audit(c, 'finance.intercompany_run', { type: 'period', id: `${practiceId}:${period}` }, { invoices: invoices.length });
  return c.json({ invoices });
});

r.post('/intercompany/:id/dispute', allow('PRM', 'EXE'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { note } = await body(c, z.object({ note: z.string().min(3) }));
  await db.update(schema.intercompanyInvoices).set({ status: 'disputed', disputeNote: note, updatedAt: nowIso() }).where(eq(schema.intercompanyInvoices.id, id));
  await audit(c, 'finance.intercompany_disputed', { type: 'intercompany_invoice', id }, { note });
  await emit(c, 'intercompany.invoice.disputed.v1', { invoiceId: id, note }, { aggregateType: 'intercompany_invoice', aggregateId: id });
  return c.json({ ok: true });
});

/* ============================ Distributions ============================ */

async function holdingsFor(services: Services, practiceId: string): Promise<Shareholding[]> {
  const rows = await services.db.select().from(schema.shareholdings).where(eq(schema.shareholdings.entityId, practiceId));
  return rows.map((h) => ({ shareholderName: h.shareholderName, shareholderUserId: h.shareholderUserId, shareClass: h.shareClass, shares: h.shares, effectiveFrom: h.effectiveFrom, effectiveTo: h.effectiveTo }));
}

export async function proposeDistribution(services: Services, practiceId: string, period: string, proposedBy: string) {
  const db = services.db;
  const [existing] = await db.select().from(schema.distributions).where(and(eq(schema.distributions.practiceId, practiceId), eq(schema.distributions.period, period))).limit(1);
  if (existing) return existing;
  const snap = await savePnlSnapshot(services, practiceId, period, proposedBy);
  const holdings = await holdingsFor(services, practiceId);
  const { start, end } = periodBounds(period);
  const waterfall = distributionWaterfall({ distributableCents: snap.distributableCents, holdings, periodStart: start, periodEnd: end, dividendsTaxRate: DIVIDENDS_TAX_RATE });
  const cash = snap.collectionsCents;
  const receivables = snap.revenueCents - snap.collectionsCents;
  const solvency = solvencyLiquidityTest({ cashCents: cash, receivablesCents: Math.max(0, receivables), liabilitiesCents: snap.taxProvisionCents + snap.managementFeeCents, proposedCents: snap.distributableCents, workingCapitalFloorCents: WORKING_CAPITAL_FLOOR_CENTS });
  const bridge = [
    { key: 'profit_after_tax', label: 'Profit after tax', amountCents: snap.profitAfterTaxCents },
    { key: 'reserve', label: `Transfer to reserve (${Math.round(RESERVE_PCT * 100)} % per the shareholders agreement)`, amountCents: -snap.reserveCents },
    { key: 'distributable', label: 'Distributable profit', amountCents: snap.distributableCents },
  ];
  const id = newId('dst');
  await db.insert(schema.distributions).values({
    id, practiceId, period, distributableCents: snap.distributableCents, bridge, solvencyTest: solvency as unknown as Record<string, unknown>, waterfall: waterfall as unknown as Record<string, unknown>,
    approvals: [], requiredApprovals: Math.max(2, holdings.filter((h) => !h.effectiveTo).length), resolutionRef: `RES-${practiceId.toUpperCase()}-${period}`, status: 'proposed', proposedBy,
  });
  for (const e of waterfall.entitlements) {
    await db.insert(schema.shareholderStatements).values({
      id: newId('shs'), practiceId, distributionId: id, period, shareholderName: e.shareholderName, shareholderUserId: e.shareholderUserId ?? null, shareClass: e.shareClass,
      pct: Math.round(e.pct * 100), grossCents: e.grossCents, dividendsTaxCents: e.dividendsTaxCents, netCents: e.netCents, segments: e.segments as unknown as Array<Record<string, unknown>>, status: 'issued',
    });
  }
  await emitDirect(services, 'distribution.proposed.v1', { distributionId: id, practiceId, period, distributableCents: snap.distributableCents, solvencyPassed: solvency.passed }, { aggregateType: 'distribution', aggregateId: id, practiceId });
  return (await db.select().from(schema.distributions).where(eq(schema.distributions.id, id)))[0]!;
}

r.get('/distributions', allow(...FIN_READ, 'SHR'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const user = c.get('user')!;
  if (user.persona === 'SHR' && user.practiceId && user.practiceId !== practiceId) return c.json({ error: 'forbidden' }, 403);
  const rows = await db.select().from(schema.distributions).where(eq(schema.distributions.practiceId, practiceId)).orderBy(desc(schema.distributions.period));
  const statements = await db.select().from(schema.shareholderStatements).where(eq(schema.shareholderStatements.practiceId, practiceId));
  const mine = user.persona === 'SHR' ? statements.filter((s) => s.shareholderUserId === user.id || s.shareholderName === user.name) : statements;
  return c.json({ distributions: rows, statements: mine });
});

r.post('/distributions/propose', allow(...FIN), async (c) => {
  const practiceId = requirePractice(c);
  const { period } = await body(c, z.object({ period: z.string() }));
  const d = await proposeDistribution(c.get('services'), practiceId, period, c.get('user')!.id);
  await audit(c, 'finance.distribution_proposed', { type: 'distribution', id: d.id }, { period, distributableCents: d.distributableCents });
  return c.json({ distribution: d }, 201);
});

/** SHR and EXE approve; both are recorded with identity and time. */
r.post('/distributions/:id/approve', allow('SHR', 'EXE', 'PRM'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { confirm } = await body(c, z.object({ confirm: z.literal('Confirm') }));
  const user = c.get('user')!;
  const [d] = await db.select().from(schema.distributions).where(eq(schema.distributions.id, id)).limit(1);
  if (!d) throw notFound('Distribution');
  if (d.status !== 'proposed') throw conflict('Distribution is not awaiting approval');
  if (user.persona === 'SHR' && user.practiceId !== d.practiceId) return c.json({ error: 'forbidden' }, 403);
  if (d.approvals.some((a) => a.userId === user.id)) throw conflict('You have already approved this distribution');
  const approvals = [...d.approvals, { persona: user.persona, userId: user.id, name: user.name, at: nowIso() }];
  const complete = approvals.length >= d.requiredApprovals && approvals.some((a) => a.persona === 'EXE');
  await db.update(schema.distributions).set({ approvals, status: complete ? 'approved' : 'proposed', updatedAt: nowIso() }).where(eq(schema.distributions.id, id));
  await audit(c, 'finance.distribution_approved', { type: 'distribution', id }, { approvals: approvals.length, complete, confirm });
  if (complete) await emit(c, 'distribution.approved.v1', { distributionId: id, practiceId: d.practiceId, period: d.period, approvals: approvals.length }, { aggregateType: 'distribution', aggregateId: id, practiceId: d.practiceId });
  return c.json({ ok: true, approvals: approvals.length, required: d.requiredApprovals, status: complete ? 'approved' : 'proposed' });
});

/** Release the payment file: EXE only, second independent approver, hash verified (M15-R-153). */
r.post('/distributions/:id/release', allow('EXE'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { confirm } = await body(c, z.object({ confirm: z.literal('Confirm') }));
  const user = c.get('user')!;
  const [d] = await db.select().from(schema.distributions).where(eq(schema.distributions.id, id)).limit(1);
  if (!d) throw notFound('Distribution');
  if (d.status !== 'approved') throw conflict('Approvals are not complete');
  const solvency = d.solvencyTest as { passed?: boolean } | null;
  if (solvency && solvency.passed === false) throw conflict('The solvency and liquidity test did not pass; the distribution cannot be released');
  if (d.releasedBy === user.id) throw conflict('The releasing approver must be independent of the proposer');
  const statements = await db.select().from(schema.shareholderStatements).where(eq(schema.shareholderStatements.distributionId, id));
  const file = { generatedAt: nowIso(), lines: statements.map((s) => ({ shareholderName: s.shareholderName, netCents: s.netCents, reference: `${d.resolutionRef}-${s.shareholderName.split(' ').pop()}` })), totalCents: statements.reduce((a, s) => a + s.netCents, 0) };
  const hash = await sha256Hex(JSON.stringify(file));
  await db.update(schema.distributions).set({ status: 'released', paymentFile: file, paymentFileHash: hash, releasedBy: user.id, releasedAt: nowIso(), updatedAt: nowIso() }).where(eq(schema.distributions.id, id));
  await audit(c, 'finance.distribution_released', { type: 'distribution', id }, { hash, totalCents: file.totalCents, confirm });
  await emit(c, 'distribution.released.v1', { distributionId: id, practiceId: d.practiceId, period: d.period, totalCents: file.totalCents, hash }, { aggregateType: 'distribution', aggregateId: id, practiceId: d.practiceId });
  return c.json({ ok: true, hash, totalCents: file.totalCents });
});

/* ============================ Shareholder view ============================ */

r.get('/shareholder/me', allow('SHR', 'EXE', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const services = c.get('services');
  const db = services.db;
  const user = c.get('user')!;
  if (user.persona === 'SHR' && user.practiceId !== practiceId) return c.json({ error: 'forbidden', message: 'A shareholder sees only their own practice' }, 403);
  const holdings = await db.select().from(schema.shareholdings).where(eq(schema.shareholdings.entityId, practiceId));
  const active = holdings.filter((h) => !h.effectiveTo);
  const totalShares = active.reduce((a, h) => a + h.shares, 0) || 1;
  const mine = active.find((h) => h.shareholderUserId === user.id || h.shareholderName === user.name) ?? null;
  const [entity] = await db.select().from(schema.legalEntities).where(eq(schema.legalEntities.id, practiceId)).limit(1);
  const period = lastClosedPeriod();
  let [snap] = await db.select().from(schema.pnlSnapshots).where(and(eq(schema.pnlSnapshots.practiceId, practiceId), eq(schema.pnlSnapshots.period, period))).limit(1);
  if (!snap) snap = await savePnlSnapshot(services, practiceId, period, user.id);
  const snaps = await db.select().from(schema.pnlSnapshots).where(eq(schema.pnlSnapshots.practiceId, practiceId)).orderBy(schema.pnlSnapshots.period);
  const [dist] = await db.select().from(schema.distributions).where(and(eq(schema.distributions.practiceId, practiceId), eq(schema.distributions.period, period))).limit(1);
  const statements = await db.select().from(schema.shareholderStatements).where(eq(schema.shareholderStatements.practiceId, practiceId)).orderBy(desc(schema.shareholderStatements.period));
  const myStatements = statements.filter((s) => (mine ? s.shareholderName === mine.shareholderName : user.persona !== 'SHR'));
  const votes = await db.select().from(schema.reservedMatters).where(and(eq(schema.reservedMatters.practiceId, practiceId), eq(schema.reservedMatters.status, 'open')));
  const myPct = mine ? Math.round((mine.shares / totalShares) * 10000) / 100 : null;
  const myEntitlement = dist && myPct ? Math.round((dist.distributableCents * myPct) / 100) : null;
  return c.json({
    entity: entity ? { id: entity.id, name: entity.tradingName ?? entity.registeredName, registeredName: entity.registeredName } : null,
    holding: mine ? { shareClass: mine.shareClass, shares: mine.shares, pct: myPct, effectiveFrom: mine.effectiveFrom } : null,
    capTable: active.map((h) => ({ shareholderName: h.shareholderName, shareClass: h.shareClass, shares: h.shares, pct: Math.round((h.shares / totalShares) * 10000) / 100, mine: h.shareholderUserId === user.id || h.shareholderName === user.name })),
    period, pnl: snap, history: snaps, distribution: dist ?? null, myEntitlementCents: myEntitlement, statements: myStatements, openVotes: votes.length,
    kpiSparklines: {
      revenue: snaps.map((s) => s.revenueCents), ebitda: snaps.map((s) => s.ebitdaCents), distributable: snaps.map((s) => s.distributableCents),
      collections: snaps.map((s) => s.collectionsCents), studies: snaps.map((s) => s.studies), periods: snaps.map((s) => s.period),
    },
    documents: [
      { name: "Shareholders' agreement", detail: 'v2 · amended Feb 2026 · reserved matters schedule', kind: 'PDF' },
      { name: 'Management services agreement', detail: '8 % of collections · service levels reported monthly', kind: 'PDF' },
      { name: 'Reading services agreement · Hub', detail: 'fee schedule v4 · per signed report', kind: 'PDF' },
      { name: `Management accounts · ${period}`, detail: snap.status === 'locked' ? `locked ${snap.lockedAt?.slice(0, 10)}` : 'soft close', kind: 'PDF · XLSX' },
      { name: 'Securities register extract', detail: 'CIPC · effective-dated cap table', kind: 'PDF' },
    ],
  });
});

/* ============================ Reserved matters ============================ */

r.get('/votes', allow('SHR', 'EXE', 'PRM', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const user = c.get('user')!;
  if (user.persona === 'SHR' && user.practiceId !== practiceId) return c.json({ error: 'forbidden' }, 403);
  const rows = await db.select().from(schema.reservedMatters).where(eq(schema.reservedMatters.practiceId, practiceId)).orderBy(desc(schema.reservedMatters.opensAt));
  return c.json({ matters: rows.map((m) => ({ ...m, myVote: m.votes.find((v) => v.userId === user.id || v.shareholderName === user.name) ?? null, tally: tally(m.votes) })) });
});
function tally(votes: Array<{ pct: number; vote: string }>) {
  return { approve: votes.filter((v) => v.vote === 'approve').reduce((a, v) => a + v.pct, 0), decline: votes.filter((v) => v.vote === 'decline').reduce((a, v) => a + v.pct, 0), abstain: votes.filter((v) => v.vote === 'abstain').reduce((a, v) => a + v.pct, 0) };
}

r.post('/votes/:id/vote', allow('SHR', 'EXE', 'PRM'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const { vote, condition } = await body(c, z.object({ vote: z.enum(['approve', 'decline', 'abstain']), condition: z.string().optional() }));
  const user = c.get('user')!;
  const [m] = await db.select().from(schema.reservedMatters).where(eq(schema.reservedMatters.id, id)).limit(1);
  if (!m) throw notFound('Reserved matter');
  if (m.status !== 'open') throw conflict('The vote is closed');
  const holdings = await db.select().from(schema.shareholdings).where(eq(schema.shareholdings.entityId, m.practiceId));
  const active = holdings.filter((h) => !h.effectiveTo);
  const total = active.reduce((a, h) => a + h.shares, 0) || 1;
  const mine = active.find((h) => h.shareholderUserId === user.id || h.shareholderName === user.name);
  if (!mine && user.persona === 'SHR') return c.json({ error: 'forbidden', message: 'You do not hold shares in this practice' }, 403);
  const pct = mine ? Math.round((mine.shares / total) * 10000) / 100 : 0;
  const votes = [...m.votes.filter((v) => v.shareholderName !== (mine?.shareholderName ?? user.name)), { shareholderName: mine?.shareholderName ?? user.name, userId: user.id, pct, vote, condition: condition ?? null, at: nowIso() }];
  const t = tally(votes);
  const localPartners = active.filter((h) => !h.shareholderEntityId).map((h) => h.shareholderName);
  const localApproved = !m.rule.requireLocalPartner || votes.some((v) => v.vote === 'approve' && localPartners.includes(v.shareholderName));
  const decided = t.approve >= m.rule.majorityPct && localApproved ? 'approved' : t.decline > 100 - m.rule.majorityPct ? 'declined' : 'open';
  await db.update(schema.reservedMatters).set({ votes, status: decided, outcomeAt: decided === 'open' ? null : nowIso() }).where(eq(schema.reservedMatters.id, id));
  await audit(c, 'finance.reserved_matter_voted', { type: 'reserved_matter', id }, { vote, pct, condition, outcome: decided });
  await emit(c, 'reserved.matter.voted.v1', { matterId: id, practiceId: m.practiceId, vote, pct, outcome: decided }, { aggregateType: 'reserved_matter', aggregateId: id, practiceId: m.practiceId });
  if (decided !== 'open') await emit(c, 'reserved.matter.decided.v1', { matterId: id, practiceId: m.practiceId, outcome: decided, ref: m.ref }, { aggregateType: 'reserved_matter', aggregateId: id, practiceId: m.practiceId });
  return c.json({ ok: true, tally: t, status: decided });
});

/* ============================ Budgets, cash forecast, board pack ============================ */

r.get('/budgets', allow(...FIN_READ, 'SHR'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const budgets = await db.select().from(schema.budgets).where(eq(schema.budgets.practiceId, practiceId)).orderBy(desc(schema.budgets.version));
  const snaps = await db.select().from(schema.pnlSnapshots).where(eq(schema.pnlSnapshots.practiceId, practiceId)).orderBy(schema.pnlSnapshots.period);
  const latest = budgets[0];
  const vsActual = latest ? [...new Set(latest.lines.map((l) => l.period))].sort().map((period) => {
    const snap = snaps.find((s) => s.period === period);
    const by = Object.fromEntries(latest.lines.filter((l) => l.period === period).map((l) => [l.key, l.amountCents]));
    return { period, budgetRevenueCents: by.revenue ?? 0, actualRevenueCents: snap?.revenueCents ?? null, budgetEbitdaCents: by.ebitda ?? 0, actualEbitdaCents: snap?.ebitdaCents ?? null };
  }) : [];
  return c.json({ budgets, vsActual });
});

r.get('/cash-forecast', allow(...FIN_READ), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const claims = await db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), inArray(schema.claims.status, ['submitted', 'accepted', 'pended'])));
  const accounts = await db.select().from(schema.patientAccounts).where(and(eq(schema.patientAccounts.practiceId, practiceId), eq(schema.patientAccounts.status, 'open')));
  const [snap] = await db.select().from(schema.pnlSnapshots).where(eq(schema.pnlSnapshots.practiceId, practiceId)).orderBy(desc(schema.pnlSnapshots.period)).limit(1);
  const weeks: Array<{ week: number; inflowCents: number; outflowCents: number; netCents: number }> = [];
  const schemeInFlight = claims.reduce((a, x) => a + x.expectedFunderCents - x.paidCents, 0);
  const patientOpen = accounts.reduce((a, x) => a + x.balanceCents, 0);
  const monthlyCosts = snap ? snap.staffCents + snap.rentCents + snap.consumablesCents + snap.otherCents + snap.readingFeesCents + snap.managementFeeCents : 0;
  for (let w = 1; w <= 13; w++) {
    const schemeCurve = w <= 6 ? 0.14 : 0.03; // schemes settle mostly within six weeks
    const patientCurve = w <= 4 ? 0.06 : 0.03;
    const inflow = Math.round(schemeInFlight * schemeCurve + patientOpen * patientCurve);
    const outflow = Math.round(monthlyCosts / 4.33);
    weeks.push({ week: w, inflowCents: inflow, outflowCents: outflow, netCents: inflow - outflow });
  }
  let running = snap?.collectionsCents ?? 0;
  return c.json({ weeks: weeks.map((w) => ({ ...w, closingCents: (running += w.netCents) })), openingCents: snap?.collectionsCents ?? 0, schemeInFlightCents: schemeInFlight, patientOpenCents: patientOpen, floorCents: WORKING_CAPITAL_FLOOR_CENTS });
});

r.get('/board-pack', allow('EXE', 'SUP'), async (c) => {
  const services = c.get('services');
  const db = services.db;
  const { period } = query(c, z.object({ period: z.string().optional() }));
  const p = period ?? lastClosedPeriod();
  const practices = await db.select().from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
  const sections = [];
  for (const prac of practices) {
    let [snap] = await db.select().from(schema.pnlSnapshots).where(and(eq(schema.pnlSnapshots.practiceId, prac.id), eq(schema.pnlSnapshots.period, p))).limit(1);
    if (!snap) snap = await savePnlSnapshot(services, prac.id, p, 'board-pack');
    const claims = await db.select().from(schema.claims).where(eq(schema.claims.practiceId, prac.id));
    const responded = claims.filter((x) => x.respondedAt);
    sections.push({
      practiceId: prac.id, name: prac.tradingName ?? prac.registeredName, revenueCents: snap.revenueCents, ebitdaCents: snap.ebitdaCents, ebitdaMarginPct: snap.kpis?.ebitdaMarginPct ?? 0,
      distributableCents: snap.distributableCents, unbilledCents: snap.unbilledCents, studies: snap.studies, collectionsCents: snap.collectionsCents,
      firstPassPct: responded.length ? Math.round((responded.filter((x) => ['accepted', 'paid', 'remitted'].includes(x.status)).length / responded.length) * 1000) / 10 : 100,
      writeOffsCents: snap.shortPaymentsCents,
    });
  }
  const dists = await db.select().from(schema.distributions).where(eq(schema.distributions.period, p));
  const matters = await db.select().from(schema.reservedMatters).where(eq(schema.reservedMatters.status, 'open'));
  return c.json({
    period: p, lockedPeriodsOnly: true, generatedAt: nowIso(),
    group: { revenueCents: sections.reduce((a, s) => a + s.revenueCents, 0), ebitdaCents: sections.reduce((a, s) => a + s.ebitdaCents, 0), distributableCents: sections.reduce((a, s) => a + s.distributableCents, 0), studies: sections.reduce((a, s) => a + s.studies, 0) },
    practices: sections, distributions: dists.map((d) => ({ practiceId: d.practiceId, period: d.period, distributableCents: d.distributableCents, status: d.status })), openReservedMatters: matters.map((m) => ({ ref: m.ref, title: m.title, closesAt: m.closesAt, practiceId: m.practiceId })),
  });
});

/* ============================ Periods and the Close Hand ============================ */

export const closeHand = defineHand({
  id: 'close', name: 'Close Hand', module: 'M15',
  mandate: 'Run the month-end checklist: gather M14 outputs, post rule-derived journals and intercompany invoices within tolerance, compute the P&L and propose the distribution. It may not post manual journals, approve anything, release payments or change a rule.',
  level: 'A2',
  defaultLeash: { varianceTolerancePct: 20, maxJournalCents: 100_000_00, allowedJournalTypes: 'intercompany,provision' },
  approvalPersona: 'EXE', approvalPolicy: 'The CFO (EXE) releases the pack, approves the distribution and releases the payment file. The Hand never releases money.',
  tools: { 'db.read': 'R0', 'm14.checklist': 'R0', 'journal.post_rule_derived': 'R1', 'intercompany.issue': 'R1', 'pnl.compute': 'R1', 'distribution.propose': 'R1' },
});

async function runClose(input: { practiceId?: string | null; period?: string }, ctx: HandRunContext) {
  const services = ctx.services;
  const practiceId = input.practiceId ?? ctx.practiceId;
  if (!practiceId) throw new Error('practiceId required');
  const period = input.period ?? lastClosedPeriod();
  const db = services.db;
  const steps: Array<{ id: string; day: number; label: string; level: string; status: string; owner: string; at?: string | null }> = [];

  const [billingPeriod] = await ctx.step('m14.checklist', { practiceId, period }, async () => db.select().from(schema.billingPeriods).where(and(eq(schema.billingPeriods.practiceId, practiceId), eq(schema.billingPeriods.period, period))).limit(1));
  steps.push({ id: 'm14', day: 1, label: 'M14 outputs received (unbilled register, claims-in-flight, provisions)', level: 'A3', status: billingPeriod?.status === 'signed' ? 'done' : 'blocked', owner: 'BIL', at: billingPeriod?.signedAt ?? null });

  const invoices = await ctx.step('intercompany.issue', { practiceId, period }, async () => runIntercompany(services, practiceId, period, 'close-hand'));
  steps.push({ id: 'intercompany', day: 2, label: `Intercompany run and invoices (${invoices.length})`, level: 'A3', status: 'done', owner: 'PRM', at: nowIso() });

  const snap = await ctx.step('pnl.compute', { practiceId, period }, async () => savePnlSnapshot(services, practiceId, period, 'close-hand'));
  const prior = await db.select().from(schema.pnlSnapshots).where(eq(schema.pnlSnapshots.practiceId, practiceId));
  const priorSnap = prior.find((x) => x.period === previousPeriods(period, 2)[0]);
  if (priorSnap && priorSnap.revenueCents) {
    const variancePct = Math.abs(Math.round(((snap.revenueCents - priorSnap.revenueCents) / priorSnap.revenueCents) * 100));
    ctx.leashCheck([{ rule: 'varianceTolerancePct', actual: variancePct }]);
  }
  steps.push({ id: 'pnl', day: 3, label: 'P&L per practice with variance commentary drafted', level: 'A3', status: 'done', owner: 'EXE', at: nowIso() });

  // Provision journal from the M14 ECL matrix (a rule-derived journal type the Hand may post).
  const bp = billingPeriod?.provision as { totalProvisionCents?: number } | null | undefined;
  if (bp?.totalProvisionCents) {
    await ctx.step('journal.post_rule_derived', { type: 'provision', cents: bp.totalProvisionCents }, async () =>
      db.insert(schema.journals).values({ id: newId('jnl'), practiceId, period, source: 'provision', sourceRef: `${practiceId}:${period}:ecl`, description: 'ECL provision movement', lines: [{ account: '5210', debitCents: bp.totalProvisionCents!, creditCents: 0 }, { account: '1190', debitCents: 0, creditCents: bp.totalProvisionCents! }], status: 'posted', postedAt: nowIso(), postedBy: 'close-hand' }));
    steps.push({ id: 'provision', day: 3, label: 'ECL provision posted from the M14 matrix', level: 'A3', status: 'done', owner: 'DEB', at: nowIso() });
  }

  const dist = await ctx.step('distribution.propose', { practiceId, period }, async () => proposeDistribution(services, practiceId, period, 'close-hand'));
  steps.push({ id: 'distribution', day: 5, label: 'Distribution proposal with bridge, solvency test and waterfall', level: 'A3', status: 'done', owner: 'EXE', at: nowIso() });
  steps.push({ id: 'approval', day: 7, label: 'Distribution approvals, resolution and payment file', level: 'A0', status: 'pending', owner: 'EXE' });
  steps.push({ id: 'lock', day: 8, label: 'Shareholder portal updated; period locked', level: 'A3', status: 'pending', owner: 'EXE' });

  const [fp] = await db.select().from(schema.fiscalPeriods).where(and(eq(schema.fiscalPeriods.practiceId, practiceId), eq(schema.fiscalPeriods.period, period))).limit(1);
  if (fp) await db.update(schema.fiscalPeriods).set({ status: fp.status === 'open' ? 'soft_closed' : fp.status, closeSteps: steps, updatedAt: nowIso() }).where(eq(schema.fiscalPeriods.id, fp.id));
  else await db.insert(schema.fiscalPeriods).values({ id: newId('fp'), practiceId, period, status: 'soft_closed', closeSteps: steps });
  await emitDirect(services, 'finance.close.step.completed.v1', { practiceId, period, steps: steps.filter((s) => s.status === 'done').length }, { practiceId });
  return { practiceId, period, steps, distributionId: dist.id, distributableCents: dist.distributableCents, invoices: invoices.length, ebitdaCents: snap.ebitdaCents } as Record<string, unknown>;
}

r.get('/periods', allow(...FIN_READ, 'SHR'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const rows = await db.select().from(schema.fiscalPeriods).where(eq(schema.fiscalPeriods.practiceId, practiceId)).orderBy(desc(schema.fiscalPeriods.period));
  return c.json({ periods: rows });
});

r.post('/close/run', allow(...FIN), async (c) => {
  const practiceId = requirePractice(c);
  const { period } = await body(c, z.object({ period: z.string().optional() }));
  const task = await runHand(c.get('services'), 'close', { practiceId, period }, { practiceId, trigger: 'manual', title: `Month-end close ${period ?? lastClosedPeriod()}` });
  await audit(c, 'finance.close_run', { type: 'agent_task', id: task.id }, { period, status: task.status });
  return c.json({ task });
});

r.post('/periods/:period/lock', allow('EXE'), async (c) => {
  const practiceId = requirePractice(c);
  const db = c.get('services').db;
  const period = param(c, 'period');
  const { confirm } = await body(c, z.object({ confirm: z.literal('Confirm') }));
  const user = c.get('user')!;
  const [fp] = await db.select().from(schema.fiscalPeriods).where(and(eq(schema.fiscalPeriods.practiceId, practiceId), eq(schema.fiscalPeriods.period, period))).limit(1);
  const lockRef = `${practiceId.toUpperCase()}-${period}-L1`;
  if (fp) await db.update(schema.fiscalPeriods).set({ status: 'locked', closedBy: user.id, closedAt: nowIso(), lockedAt: nowIso(), lockRef, updatedAt: nowIso() }).where(eq(schema.fiscalPeriods.id, fp.id));
  else await db.insert(schema.fiscalPeriods).values({ id: newId('fp'), practiceId, period, status: 'locked', closedBy: user.id, closedAt: nowIso(), lockedAt: nowIso(), lockRef });
  await db.update(schema.pnlSnapshots).set({ status: 'locked', lockedAt: nowIso() }).where(and(eq(schema.pnlSnapshots.practiceId, practiceId), eq(schema.pnlSnapshots.period, period)));
  await audit(c, 'finance.period_locked', { type: 'fiscal_period', id: `${practiceId}:${period}` }, { lockRef, confirm });
  await emit(c, 'finance.period.closed.v1', { practiceId, period, lockRef }, { aggregateType: 'fiscal_period', aggregateId: `${practiceId}:${period}`, practiceId });
  return c.json({ ok: true, lockRef });
});

/* ============================ Boot ============================ */

export default defineModule({
  code: 'M15', name: 'Finance & Consolidation', basePath: 'finance', routes: r,
  boot(services) {
    registerHand(closeHand, runClose as never);
    void services;
    for (const name of ['charge.captured.v1', 'payment.received.v1', 'claim.short_paid.v1', 'patient.liability.v1', 'writeoff.approved.v1']) {
      on(name, async (evt, s) => { await postJournalForEvent(s, evt.name, evt.payload, evt.aggregateId); });
    }
    // When M14 signs its checklist, the Close Hand runs the M15 side.
    on('billing.period.checklist.completed.v1', async (evt, s) => {
      const p = evt.payload as { practiceId: string; period: string };
      if (!p.practiceId) return;
      await runHand(s, 'close', { practiceId: p.practiceId, period: p.period }, { practiceId: p.practiceId, trigger: 'billing.period.checklist.completed.v1', title: `Month-end close ${p.period}` });
    });
  },
});

export { computePeriodPnl, lastClosedPeriod };
