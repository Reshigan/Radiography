import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, practiceIdNullable, json, bool, cents } from './_helpers.js';

export interface FunderRules {
  /** Modalities that need pre-authorisation for this funder (all options unless overridden per option). */
  authRequiredModalities: string[];
  /** Per-option overrides, e.g. { Executive: [] } */
  authByOption?: Record<string, string[]>;
  /** Co-payment percentage applied when the site is outside the option's network. */
  networkCoPayPct?: number;
  /** Options that are network (DSP) restricted. */
  networkOptions?: string[];
  /** Sites in the funder's network (ids). Empty = all. */
  networkSiteIds?: string[];
  /** Percentage of scheme rate the funder pays (100 = full). */
  ratePct?: number;
  turnaroundHours?: number;
  cashDiscountPct?: number;
}

/** Funder master: schemes with options, RAF, COIDA, corporate contracts and the cash tariff. */
export const funders = sqliteTable(
  'funders',
  {
    id: id(),
    practiceId: practiceIdNullable(), // null = shared across the Group
    type: text('type').notNull(), // scheme | raf | coida | corporate | cash | state
    code: text('code').notNull(),
    name: text('name').notNull(),
    administrator: text('administrator'),
    options: json<string[]>('options').notNull(),
    dsp: bool('dsp').notNull().default(false),
    rules: json<FunderRules>('rules').notNull(),
    contact: json<{ auth?: string; queries?: string; claims?: string }>('contact'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('funders_code').on(t.code)],
);

export interface BenefitCheckResult {
  result: 'covered' | 'needs_auth' | 'exhausted' | 'co_pay' | 'invalid' | 'cash' | 'contract';
  checkedAt: string;
  source: string; // 'sim:funder' | 'switch' | 'manual'
  reasonCodes: string[];
  coPayPct?: number;
  message: string;
  raw?: Record<string, unknown>;
}

/** Funding position of an Order (docs/processes/03 §7.1). */
export const fundingCases = sqliteTable(
  'funding_cases',
  {
    id: id(),
    practiceId: practiceId(),
    orderId: text('order_id').notNull(),
    patientId: text('patient_id').notNull(),
    siteId: text('site_id'),
    funderType: text('funder_type').notNull(), // scheme | cash | raf | coida | corporate
    funderId: text('funder_id'),
    schemeName: text('scheme_name'),
    schemeOption: text('scheme_option'),
    memberNo: text('member_no'),
    dependantCode: text('dependant_code'),
    status: text('status').notNull().default('unknown'), // unknown | checking | quoted | auth_requested | auth_more_info | authorised | auth_declined | proceed_at_risk | deposit_due | ready_to_bill | expired | contract
    benefitCheck: json<BenefitCheckResult>('benefit_check'),
    totalCents: cents('total_cents').notNull().default(0),
    schemePortionCents: cents('scheme_portion_cents').notNull().default(0),
    patientPortionCents: cents('patient_portion_cents').notNull().default(0),
    reasonCodes: json<string[]>('reason_codes').notNull(),
    authRequired: bool('auth_required').notNull().default(false),
    authStatus: text('auth_status'), // not_required | pending | requested | more_info | approved | declined | expired
    authNumber: text('auth_number'),
    authValidTo: text('auth_valid_to'),
    quoteId: text('quote_id'),
    thirdPartyRef: text('third_party_ref'), // RAF claim / COIDA IOD / corporate PO
    proceedAtRiskAt: text('proceed_at_risk_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('funding_cases_order').on(t.orderId), index('funding_cases_practice_status').on(t.practiceId, t.status)],
);

export interface QuoteLine {
  tariffCode: string;
  description: string;
  units: number;
  unitCents: number;
  totalCents: number;
  kind: 'procedure' | 'contrast' | 'consumable' | 'modifier';
}

/** Itemised, versioned, binding quote with VAT at 15 % shown separately. */
export const quotes = sqliteTable(
  'quotes',
  {
    id: id(),
    practiceId: practiceId(),
    fundingCaseId: text('funding_case_id').notNull(),
    orderId: text('order_id').notNull(),
    patientId: text('patient_id').notNull(),
    version: integer('version').notNull().default(1),
    lines: json<QuoteLine[]>('lines').notNull(),
    subtotalCents: cents('subtotal_cents').notNull(),
    vatCents: cents('vat_cents').notNull(),
    totalCents: cents('total_cents').notNull(),
    schemePortionCents: cents('scheme_portion_cents').notNull(),
    patientPortionCents: cents('patient_portion_cents').notNull(),
    reasonCodes: json<string[]>('reason_codes').notNull(),
    assumptions: json<string[]>('assumptions').notNull(),
    validUntil: text('valid_until').notNull(),
    binding: bool('binding').notNull().default(true),
    feeScheduleVersion: text('fee_schedule_version').notNull().default('demo-2026.1'),
    rulePackVersion: text('rule_pack_version').notNull().default('demo-2026.1'),
    acceptedAt: text('accepted_at'),
    acceptedVia: text('accepted_via'),
    createdAt: createdAt(),
  },
  (t) => [index('quotes_case').on(t.fundingCaseId)],
);

export const authorisations = sqliteTable(
  'authorisations',
  {
    id: id(),
    practiceId: practiceId(),
    fundingCaseId: text('funding_case_id').notNull(),
    orderId: text('order_id').notNull(),
    funderId: text('funder_id'),
    status: text('status').notNull().default('requested'), // requested | more_info | approved | declined | expired
    requestPayload: json<Record<string, unknown>>('request_payload').notNull(),
    responsePayload: json<Record<string, unknown>>('response_payload'),
    funderReference: text('funder_reference'),
    authNumber: text('auth_number'),
    validFrom: text('valid_from'),
    validTo: text('valid_to'),
    approvedCents: cents('approved_cents'),
    reason: text('reason'),
    attempts: integer('attempts').notNull().default(1),
    submittedBy: text('submitted_by'), // 'hand:authorisation' | user id
    taskId: text('task_id'),
    submittedAt: text('submitted_at').notNull(),
    respondedAt: text('responded_at'),
    createdAt: createdAt(),
  },
  (t) => [index('authorisations_case').on(t.fundingCaseId)],
);
