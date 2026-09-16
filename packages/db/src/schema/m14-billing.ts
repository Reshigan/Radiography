// m14-billing: Revenue Cycle tables (docs/processes/09 §16). Every table carries practice_id; money is integer cents.
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { id, createdAt, updatedAt, practiceId, json, bool, cents } from './_helpers.js';

export const feeSchedules = sqliteTable(
  'fee_schedules',
  {
    id: id(),
    practiceId: practiceId(),
    funderId: text('funder_id').notNull(), // scheme-a | scheme-b | scheme-c | cash | raf | coida | corporate
    funderType: text('funder_type').notNull(), // scheme | cash | raf | coida | corporate
    name: text('name').notNull(),
    kind: text('kind').notNull(), // scheme_rate | negotiated | cash | raf | coida | corporate
    version: integer('version').notNull().default(1),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    upliftPct: integer('uplift_pct').notNull().default(0),
    status: text('status').notNull().default('active'), // draft | active | superseded
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('fee_schedules_practice_funder').on(t.practiceId, t.funderId)],
);

export const feeScheduleLines = sqliteTable(
  'fee_schedule_lines',
  {
    id: id(),
    practiceId: practiceId(),
    scheduleId: text('schedule_id').notNull(),
    code: text('code').notNull(),
    description: text('description'),
    priceExclCents: cents('price_excl_cents').notNull(),
    unit: text('unit').notNull().default('per_unit'),
    createdAt: createdAt(),
  },
  (t) => [index('fee_schedule_lines_schedule').on(t.scheduleId)],
);

export interface CodingProvenance {
  modelId: string;
  modelVersion: string;
  confidence: number;
  outputClass: 2;
  rulePackVersion: string;
  evidence: string[];
  proposedCodes: string[];
  proposedIcd10: string[];
  status: 'proposed' | 'auto_accepted' | 'accepted' | 'edited' | 'rejected';
  acceptedBy?: string | null;
  acceptedAt?: string | null;
  demo: boolean;
  llmUsed: boolean;
  gate?: { confidenceOk: boolean; scrubOk: boolean; exclusion: string | null };
}

export const charges = sqliteTable(
  'charges',
  {
    id: id(),
    practiceId: practiceId(),
    siteId: text('site_id'),
    patientId: text('patient_id').notNull(),
    studyId: text('study_id'),
    reportId: text('report_id'),
    orderId: text('order_id'),
    accession: text('accession'),
    serviceDate: text('service_date').notNull(),
    modality: text('modality'),
    procedureCodes: json<string[]>('procedure_codes').notNull(),
    icd10: json<string[]>('icd10').notNull(),
    funderId: text('funder_id').notNull(),
    funderType: text('funder_type').notNull(),
    memberNo: text('member_no'),
    dependantCode: text('dependant_code'),
    referrerId: text('referrer_id'),
    radiologistUserId: text('radiologist_user_id'),
    lines: json<Array<Record<string, unknown>>>('lines').notNull(),
    subtotalExclCents: cents('subtotal_excl_cents').notNull().default(0),
    vatCents: cents('vat_cents').notNull().default(0),
    totalCents: cents('total_cents').notNull().default(0),
    expectedFunderCents: cents('expected_funder_cents').notNull().default(0),
    expectedPatientCents: cents('expected_patient_cents').notNull().default(0),
    patientPortionReason: text('patient_portion_reason'),
    scheduleId: text('schedule_id'),
    status: text('status').notNull().default('unbilled'), // unbilled | coded | ready | claimed | paid | partially_paid | rejected | written_off | voided
    coding: json<CodingProvenance>('coding'),
    exception: json<{ family: string; reason: string; code: string; suggestion: string; openedAt: string; escalatedTo?: string | null }>('exception'),
    authRef: text('auth_ref'),
    claimId: text('claim_id'),
    version: integer('version').notNull().default(1),
    blockingReason: text('blocking_reason'),
    owner: text('owner'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('charges_practice_status').on(t.practiceId, t.status), index('charges_patient').on(t.patientId), index('charges_service_date').on(t.serviceDate)],
);

export const claims = sqliteTable(
  'claims',
  {
    id: id(),
    practiceId: practiceId(),
    claimRef: text('claim_ref').notNull(), // human reference e.g. B-018342
    chargeId: text('charge_id').notNull(),
    patientId: text('patient_id').notNull(),
    siteId: text('site_id'),
    funderId: text('funder_id').notNull(),
    funderType: text('funder_type').notNull(),
    memberNo: text('member_no'),
    dependantCode: text('dependant_code'),
    icd10: json<string[]>('icd10').notNull(),
    lines: json<Array<Record<string, unknown>>>('lines').notNull(),
    fields: json<Record<string, string | null | undefined>>('fields').notNull(),
    totalCents: cents('total_cents').notNull(),
    expectedFunderCents: cents('expected_funder_cents').notNull(),
    expectedPatientCents: cents('expected_patient_cents').notNull().default(0),
    paidCents: cents('paid_cents').notNull().default(0),
    status: text('status').notNull().default('draft'), // draft | scrubbed | held | submitted | accepted | rejected | pended | remitted | paid | short_paid | reversed | written_off
    channel: text('channel').notNull().default('batch'), // batch | realtime | portal | paper
    batchId: text('batch_id'),
    switchRef: text('switch_ref'),
    responseCodes: json<string[]>('response_codes'),
    submittedAt: text('submitted_at'),
    respondedAt: text('responded_at'),
    serviceDate: text('service_date').notNull(),
    staleDate: text('stale_date'),
    scrub: json<Record<string, unknown>>('scrub'),
    rulePackVersion: text('rule_pack_version'),
    rejectionCode: text('rejection_code'),
    rejectionClass: text('rejection_class'),
    rejectionReason: text('rejection_reason'),
    exception: json<{ family: string; reason: string; code: string; suggestion: string; path: string; level: string; openedAt: string; provenance?: Record<string, unknown>; escalatedTo?: string | null }>('exception'),
    originalClaimId: text('original_claim_id'),
    resubmitCount: integer('resubmit_count').notNull().default(0),
    pmb: bool('pmb').notNull().default(false),
    submittedBy: text('submitted_by'), // user id or hand task id
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('claims_practice_status').on(t.practiceId, t.status), index('claims_ref').on(t.claimRef), index('claims_funder').on(t.funderId), index('claims_patient').on(t.patientId)],
);

export const claimResponses = sqliteTable(
  'claim_responses',
  {
    id: id(),
    practiceId: practiceId(),
    claimId: text('claim_id').notNull(),
    channel: text('channel').notNull(),
    receivedAt: text('received_at').notNull(),
    outcome: text('outcome').notNull(), // acknowledged | accepted | rejected | pended | paid | short_paid
    code: text('code'),
    message: text('message'),
    rule: text('rule'),
    switchRef: text('switch_ref'),
    paidCents: cents('paid_cents'),
    payload: json<Record<string, unknown>>('payload'),
    createdAt: createdAt(),
  },
  (t) => [index('claim_responses_claim').on(t.claimId)],
);

export const rejectionWaves = sqliteTable('rejection_waves', {
  id: id(),
  practiceId: practiceId(),
  funderId: text('funder_id').notNull(),
  reasonCode: text('reason_code').notNull(),
  codes: json<string[]>('codes').notNull(),
  startedAt: text('started_at').notNull(),
  claimCount: integer('claim_count').notNull().default(0),
  atRiskCents: cents('at_risk_cents').notNull().default(0),
  status: text('status').notNull().default('open'), // open | resolved
  pausedRule: text('paused_rule'),
  probableCause: text('probable_cause'),
  rulePackVersion: text('rule_pack_version'),
  resolvedAt: text('resolved_at'),
  createdAt: createdAt(),
});

export interface RemittanceLine {
  claimRef: string;
  claimId?: string | null;
  tariffCode?: string;
  expectedCents: number;
  paidCents: number;
  reasonCode?: string | null;
  shortPaymentClass?: string | null;
  route?: string | null;
  matchConfidence?: number;
  status: 'matched' | 'short_paid' | 'over_paid' | 'unmatched' | 'paid_to_member';
}
export const remittances = sqliteTable(
  'remittances',
  {
    id: id(),
    practiceId: practiceId(),
    funderId: text('funder_id').notNull(),
    reference: text('reference').notNull(),
    receivedAt: text('received_at').notNull(),
    totalCents: cents('total_cents').notNull(),
    lines: json<RemittanceLine[]>('lines').notNull(),
    matchedCents: cents('matched_cents').notNull().default(0),
    unmatchedCents: cents('unmatched_cents').notNull().default(0),
    shortCents: cents('short_cents').notNull().default(0),
    status: text('status').notNull().default('received'), // received | matched | partially_matched | banked
    bankRef: text('bank_ref'),
    bankedAt: text('banked_at'),
    handTaskId: text('hand_task_id'),
    createdAt: createdAt(),
  },
  (t) => [index('remittances_practice').on(t.practiceId, t.status)],
);

export const patientAccounts = sqliteTable(
  'patient_accounts',
  {
    id: id(),
    practiceId: practiceId(),
    patientId: text('patient_id').notNull(),
    accountNo: text('account_no').notNull(),
    debtorClass: text('debtor_class').notNull().default('patient'), // patient | scheme | raf | coida | corporate
    debtorName: text('debtor_name'),
    balanceCents: cents('balance_cents').notNull().default(0),
    ageingStartAt: text('ageing_start_at'),
    dueDate: text('due_date'),
    liabilityReason: text('liability_reason'), // co_payment | benefit_exhausted | not_covered | paid_to_member | cash | rate_difference | practice_error | other
    propensity: json<Record<string, unknown>>('propensity'),
    flags: json<string[]>('flags').notNull(),
    consentChannels: json<string[]>('consent_channels'),
    language: text('language').notNull().default('en'),
    dunningStage: text('dunning_stage'),
    lastContactAt: text('last_contact_at'),
    contactsLast7d: integer('contacts_last_7d').notNull().default(0),
    delivered: json<string[]>('delivered').notNull(),
    planId: text('plan_id'),
    status: text('status').notNull().default('open'), // open | settled | handed_over | written_off
    externalRef: text('external_ref'), // RAF claim no, COIDA claim no, PO ref
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('patient_accounts_practice').on(t.practiceId, t.status), index('patient_accounts_patient').on(t.patientId)],
);

export const accountTransactions = sqliteTable(
  'account_transactions',
  {
    id: id(),
    practiceId: practiceId(),
    accountId: text('account_id').notNull(),
    patientId: text('patient_id'),
    type: text('type').notNull(), // invoice | payment | adjustment | transfer | write_off | refund
    amountCents: cents('amount_cents').notNull(), // positive increases the balance owed
    refType: text('ref_type'),
    refId: text('ref_id'),
    description: text('description').notNull(),
    reason: text('reason'),
    arithmetic: json<Record<string, unknown>>('arithmetic'),
    at: text('at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('account_transactions_account').on(t.accountId, t.at)],
);

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    practiceId: practiceId(),
    accountId: text('account_id'),
    patientId: text('patient_id'),
    siteId: text('site_id'),
    method: text('method').notNull(), // card | payshap | eft | qr | cash | link
    amountCents: cents('amount_cents').notNull(),
    status: text('status').notNull().default('pending'), // pending | settled | failed | reversed | expired
    reference: text('reference'),
    receiptNo: text('receipt_no'),
    linkToken: text('link_token'),
    linkExpiresAt: text('link_expires_at'),
    takenBy: text('taken_by'),
    pspRef: text('psp_ref'),
    settledAt: text('settled_at'),
    at: text('at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('payments_practice').on(t.practiceId, t.status), index('payments_link').on(t.linkToken)],
);

export const paymentPlans = sqliteTable(
  'payment_plans',
  {
    id: id(),
    practiceId: practiceId(),
    accountId: text('account_id').notNull(),
    patientId: text('patient_id').notNull(),
    totalCents: cents('total_cents').notNull(),
    instalmentCount: integer('instalment_count').notNull(),
    instalmentCents: cents('instalment_cents').notNull(),
    interestPct: integer('interest_pct').notNull().default(0),
    schedule: json<Array<{ n: number; dueDate: string; amountCents: number; status: string; paidAt?: string | null }>>('schedule').notNull(),
    method: text('method').notNull().default('paylink'), // paylink | debit_order
    status: text('status').notNull().default('proposed'), // proposed | active | completed | broken | cancelled
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('payment_plans_practice').on(t.practiceId, t.status)],
);

export const disputes = sqliteTable(
  'disputes',
  {
    id: id(),
    practiceId: practiceId(),
    accountId: text('account_id').notNull(),
    patientId: text('patient_id').notNull(),
    claimId: text('claim_id'),
    chargeId: text('charge_id'),
    raisedVia: text('raised_via').notNull().default('whatsapp'),
    reason: text('reason').notNull(),
    message: text('message'),
    amountCents: cents('amount_cents').notNull().default(0),
    status: text('status').notNull().default('open'), // open | upheld | partly_upheld | not_upheld | referred_to_funder
    outcome: text('outcome'),
    evidence: json<Record<string, unknown>>('evidence'),
    slaDueAt: text('sla_due_at').notNull(),
    resolvedAt: text('resolved_at'),
    resolvedBy: text('resolved_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('disputes_practice').on(t.practiceId, t.status)],
);

export const dunningRuns = sqliteTable('dunning_runs', {
  id: id(),
  practiceId: practiceId(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  handTaskId: text('hand_task_id'),
  policyVersion: text('policy_version'),
  actions: integer('actions').notNull().default(0),
  byChannel: json<Record<string, number>>('by_channel').notNull(),
  byStep: json<Record<string, number>>('by_step').notNull(),
  byBand: json<Record<string, number>>('by_band').notNull(),
  exclusions: json<Record<string, number>>('exclusions').notNull(),
  insideWindow: integer('inside_window').notNull().default(0),
  needsHuman: integer('needs_human').notNull().default(0),
  sampleReviewedBy: text('sample_reviewed_by'),
  sampleReviewedAt: text('sample_reviewed_at'),
  status: text('status').notNull().default('done'),
  createdAt: createdAt(),
});

export const dunningActions = sqliteTable(
  'dunning_actions',
  {
    id: id(),
    practiceId: practiceId(),
    runId: text('run_id').notNull(),
    accountId: text('account_id').notNull(),
    patientId: text('patient_id'),
    step: text('step').notNull(),
    channel: text('channel').notNull(),
    template: text('template').notNull(),
    language: text('language').notNull().default('en'),
    amountCents: cents('amount_cents').notNull(),
    scheduledFor: text('scheduled_for').notNull(),
    sentAt: text('sent_at'),
    status: text('status').notNull().default('scheduled'), // scheduled | sent | delivered | read | paid | skipped
    paylinkToken: text('paylink_token'),
    createdAt: createdAt(),
  },
  (t) => [index('dunning_actions_run').on(t.runId), index('dunning_actions_account').on(t.accountId)],
);

export const writeOffs = sqliteTable(
  'write_offs',
  {
    id: id(),
    practiceId: practiceId(),
    accountId: text('account_id').notNull(),
    patientId: text('patient_id'),
    claimId: text('claim_id'),
    amountCents: cents('amount_cents').notNull(),
    reason: text('reason').notNull(),
    rootCause: text('root_cause'),
    proposedBy: text('proposed_by').notNull(),
    approverPersona: text('approver_persona').notNull(),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    status: text('status').notNull().default('proposed'), // proposed | approved | rejected
    period: text('period'),
    createdAt: createdAt(),
  },
  (t) => [index('write_offs_practice').on(t.practiceId, t.status)],
);

export const handovers = sqliteTable(
  'handovers',
  {
    id: id(),
    practiceId: practiceId(),
    accountId: text('account_id').notNull(),
    patientId: text('patient_id').notNull(),
    amountCents: cents('amount_cents').notNull(),
    checklist: json<Record<string, boolean>>('checklist').notNull(),
    clean: bool('clean').notNull().default(false),
    failing: json<string[]>('failing').notNull(),
    collector: text('collector').notNull().default('Registered collector (demo)'),
    prescriptionDate: text('prescription_date'),
    status: text('status').notNull().default('proposed'), // proposed | approved | released | rejected | recalled
    proposedBy: text('proposed_by').notNull(),
    handTaskId: text('hand_task_id'),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    releasedAt: text('released_at'),
    createdAt: createdAt(),
  },
  (t) => [index('handovers_practice').on(t.practiceId, t.status)],
);

export const billingPeriods = sqliteTable(
  'billing_periods',
  {
    id: id(),
    practiceId: practiceId(),
    period: text('period').notNull(), // YYYY-MM
    unbilled: json<Record<string, unknown>>('unbilled'),
    inFlight: json<Record<string, unknown>>('in_flight'),
    provision: json<Record<string, unknown>>('provision'),
    checklist: json<Array<{ id: string; label: string; done: boolean; owner: string; note?: string }>>('checklist').notNull(),
    status: text('status').notNull().default('open'), // open | signed | locked
    signedBy: text('signed_by'),
    signedAt: text('signed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('billing_periods_practice').on(t.practiceId, t.period)],
);
