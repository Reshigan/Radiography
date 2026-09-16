// m15-finance: Finance & Consolidation tables (docs/processes/10 §16). practice_id = the entity the row belongs to.
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, practiceIdNullable, json, cents } from './_helpers.js';

export const glAccounts = sqliteTable('gl_accounts', {
  id: id(),
  practiceId: practiceIdNullable(), // null = Group standard chart
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  ifrsGroup: text('ifrs_group').notNull(),
  createdAt: createdAt(),
});

export const journals = sqliteTable(
  'journals',
  {
    id: id(),
    practiceId: practiceId(), // posting entity
    period: text('period').notNull(),
    source: text('source').notNull(), // m14 | intercompany | manual | consolidation | provision
    sourceRef: text('source_ref'),
    eventName: text('event_name'),
    description: text('description').notNull(),
    lines: json<Array<{ account: string; debitCents: number; creditCents: number; dimensions?: Record<string, string> }>>('lines').notNull(),
    status: text('status').notNull().default('posted'), // posted | reversed | suspense
    reversalOf: text('reversal_of'),
    postedAt: text('posted_at').notNull(),
    postedBy: text('posted_by'),
    createdAt: createdAt(),
  },
  (t) => [index('journals_practice_period').on(t.practiceId, t.period), index('journals_source_ref').on(t.sourceRef)],
);

export const fiscalPeriods = sqliteTable(
  'fiscal_periods',
  {
    id: id(),
    practiceId: practiceId(),
    period: text('period').notNull(),
    status: text('status').notNull().default('open'), // open | soft_closed | closed | locked
    closedBy: text('closed_by'),
    closedAt: text('closed_at'),
    lockedAt: text('locked_at'),
    lockRef: text('lock_ref'),
    closeSteps: json<Array<{ id: string; day: number; label: string; level: string; status: string; owner: string; at?: string | null }>>('close_steps'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('fiscal_periods_practice').on(t.practiceId, t.period)],
);

export const intercompanyInvoices = sqliteTable(
  'intercompany_invoices',
  {
    id: id(),
    practiceId: practiceId(), // the practice side of the pair
    fromEntityId: text('from_entity_id').notNull(),
    toEntityId: text('to_entity_id').notNull(),
    period: text('period').notNull(),
    ruleType: text('rule_type').notNull(), // management_agreement | reading_services | lease | platform_fee
    number: text('number').notNull(),
    basis: text('basis').notNull(),
    evidence: json<Record<string, unknown>>('evidence'),
    amountExclCents: cents('amount_excl_cents').notNull(),
    vatCents: cents('vat_cents').notNull(),
    totalCents: cents('total_cents').notNull(),
    status: text('status').notNull().default('issued'), // draft | issued | disputed | final | exported
    disputeNote: text('dispute_note'),
    disputeWindowEndsAt: text('dispute_window_ends_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('intercompany_practice_period').on(t.practiceId, t.period)],
);

export const pnlSnapshots = sqliteTable(
  'pnl_snapshots',
  {
    id: id(),
    practiceId: practiceId(),
    period: text('period').notNull(),
    lines: json<Array<{ key: string; label: string; amountCents: number; basis?: string; budgetCents?: number; varianceCents?: number; why?: string }>>('lines').notNull(),
    revenueCents: cents('revenue_cents').notNull(),
    shortPaymentsCents: cents('short_payments_cents').notNull(),
    readingFeesCents: cents('reading_fees_cents').notNull(),
    managementFeeCents: cents('management_fee_cents').notNull(),
    platformFeeCents: cents('platform_fee_cents').notNull().default(0),
    rentCents: cents('rent_cents').notNull(),
    staffCents: cents('staff_cents').notNull(),
    consumablesCents: cents('consumables_cents').notNull(),
    otherCents: cents('other_cents').notNull(),
    ebitdaCents: cents('ebitda_cents').notNull(),
    depreciationCents: cents('depreciation_cents').notNull(),
    taxProvisionCents: cents('tax_provision_cents').notNull(),
    profitAfterTaxCents: cents('profit_after_tax_cents').notNull(),
    reserveCents: cents('reserve_cents').notNull(),
    distributableCents: cents('distributable_cents').notNull(),
    collectionsCents: cents('collections_cents').notNull().default(0),
    unbilledCents: cents('unbilled_cents').notNull().default(0),
    studies: integer('studies').notNull().default(0),
    kpis: json<Record<string, number>>('kpis'),
    budgetRevenueCents: cents('budget_revenue_cents'),
    budgetEbitdaCents: cents('budget_ebitda_cents'),
    status: text('status').notNull().default('soft'), // soft | locked
    lockedAt: text('locked_at'),
    computedBy: text('computed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pnl_practice_period').on(t.practiceId, t.period)],
);

export const distributions = sqliteTable(
  'distributions',
  {
    id: id(),
    practiceId: practiceId(),
    period: text('period').notNull(),
    distributableCents: cents('distributable_cents').notNull(),
    bridge: json<Array<{ key: string; label: string; amountCents: number }>>('bridge').notNull(),
    solvencyTest: json<Record<string, unknown>>('solvency_test'),
    waterfall: json<Record<string, unknown>>('waterfall').notNull(),
    approvals: json<Array<{ persona: string; userId: string; name: string; at: string }>>('approvals').notNull(),
    requiredApprovals: integer('required_approvals').notNull().default(3),
    resolutionRef: text('resolution_ref'),
    status: text('status').notNull().default('proposed'), // proposed | approved | released | paid | cancelled
    paymentFile: json<Record<string, unknown>>('payment_file'),
    paymentFileHash: text('payment_file_hash'),
    proposedBy: text('proposed_by'),
    releasedBy: text('released_by'),
    releasedAt: text('released_at'),
    paidAt: text('paid_at'),
    bankRef: text('bank_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('distributions_practice').on(t.practiceId, t.period)],
);

export const shareholderStatements = sqliteTable(
  'shareholder_statements',
  {
    id: id(),
    practiceId: practiceId(),
    distributionId: text('distribution_id').notNull(),
    period: text('period').notNull(),
    shareholderName: text('shareholder_name').notNull(),
    shareholderUserId: text('shareholder_user_id'),
    shareClass: text('share_class'),
    pct: integer('pct').notNull(), // basis points × 1 (e.g. 4900 = 49.00 %)
    grossCents: cents('gross_cents').notNull(),
    dividendsTaxCents: cents('dividends_tax_cents').notNull(),
    netCents: cents('net_cents').notNull(),
    segments: json<Array<Record<string, unknown>>>('segments'),
    bankRef: text('bank_ref'),
    status: text('status').notNull().default('issued'), // issued | paid
    createdAt: createdAt(),
  },
  (t) => [index('shareholder_statements_practice').on(t.practiceId, t.period)],
);

export const reservedMatters = sqliteTable(
  'reserved_matters',
  {
    id: id(),
    practiceId: practiceId(),
    ref: text('ref').notNull(),
    kind: text('kind').notNull(), // capex | fee_schedule | borrowing | principal_appointment
    title: text('title').notNull(),
    description: text('description').notNull(),
    amountCents: cents('amount_cents'),
    rule: json<{ majorityPct: number; quorumBothClasses: boolean; requireLocalPartner: boolean; abstentionCountsAs: string }>('rule').notNull(),
    votes: json<Array<{ shareholderName: string; userId?: string | null; pct: number; vote: 'approve' | 'decline' | 'abstain'; condition?: string | null; at: string }>>('votes').notNull(),
    attachments: json<Array<{ name: string; kind: string }>>('attachments'),
    thread: json<Array<{ from: string; at: string; text: string }>>('thread'),
    opensAt: text('opens_at').notNull(),
    closesAt: text('closes_at').notNull(),
    status: text('status').notNull().default('open'), // open | approved | declined | expired
    outcomeAt: text('outcome_at'),
    createdAt: createdAt(),
  },
  (t) => [index('reserved_matters_practice').on(t.practiceId, t.status)],
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: id(),
    practiceId: practiceId(),
    financialYear: text('financial_year').notNull(), // e.g. FY2027 (Mar 2026 – Feb 2027)
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('approved'), // draft | approved
    assumptions: json<Record<string, unknown>>('assumptions'),
    lines: json<Array<{ period: string; key: string; amountCents: number }>>('lines').notNull(),
    approvedBy: text('approved_by'),
    createdAt: createdAt(),
  },
  (t) => [index('budgets_practice').on(t.practiceId, t.financialYear)],
);
