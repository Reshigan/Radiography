# 10 - Finance, Consolidation and Distributions (M15)

## 1. Purpose and scope

M15 Finance & Consolidation turns the operational and billing data the Platform already holds into
the numbers that run the business: a monthly P&L per Practice and per Site built from Platform
events, intercompany invoices generated from posted rules, consolidated Group accounts with
eliminations and minority interests, JV distributions computed from effective-dated cap tables,
budgets and forecasts, capex approvals, banking, and an automated month-end close run by the Close
Hand. Its promise to shareholders (SHR) is the brand promise applied to money: the Practice's numbers
are visible before month-end, not weeks after.

In scope: chart of accounts and GL mapping; P&L construction; intercompany rules with VAT; export to
accounting systems; consolidation and eliminations; distributions (waterfall, approvals, payment
files, statements, tax certificates); budgets and forecasts; capex and reserved matters; banking;
month-end close; audit support. Out of scope: the debtor sub-ledgers and revenue journal generation
(M14), statutory accounting and tax filing (done in the accounting system by the Group's accountants
using M15 exports), shareholding and agreement records themselves (M02).

Rates, thresholds and accounting policies in this document are illustrative and configurable unless
stated as statutory (VAT 15 %).

## 2. Process card (conventions §5)

| Item | Value |
|---|---|
| Purpose | Produce trusted management accounts, intercompany invoices, consolidated results and shareholder distributions from Platform data with minimal manual work. |
| Trigger | Monthly period end (scheduler); `billing.period.checklist.completed.v1` (M14); `readingfee.statement.issued.v1`; bank feed events; shareholding change (M02); capex request. |
| Actors | EXE (CFO, group finance), PRM, SHR, RGT (reading fees), CMP (audit), external accountants and auditors, the Close Hand. |
| Preconditions | Chart of accounts and GL mapping configured; intercompany rules posted (M02); cap tables current; bank feeds connected; M14 period checklist complete. |
| Automation | A3 for P&L construction, intercompany invoicing, consolidation, distribution computation and close checklist; A0 for distribution approval, payment release and reserved matters. |
| Data produced | Journals, management accounts, intercompany invoices, consolidation packs, distribution runs, shareholder statements, tax certificates, budgets, forecasts, capex cases. |
| KPIs | §14. |
| Controls | §13. |

## 3. Chart of accounts and GL mapping

The Platform keeps a **posting ledger** (journals by period, entity, account and dimensions) that is
the source for management accounts and for export. It is not the statutory general ledger; the
accounting system remains the book of record for statutory purposes, and the two are reconciled.

| Object | Description |
|---|---|
| `chart_of_accounts` | Group standard chart with account codes, types (revenue, contractual adjustment, bad debt, cost of sales, staff, facilities, equipment, intercompany, VAT, debtors, cash, equity), IFRS grouping. Practices may add local sub-accounts mapped to the standard. |
| `dimension` | Entity, site, modality, funder type, cost centre, project (capex), shareholder class. Every journal line carries the dimensions its account requires. |
| `gl_mapping` | Rule from a Platform event or M14 journal type (revenue by funder type, contractual adjustment by reason, write-off by reason, contrast cost, reading fee, management fee) to debit and credit accounts plus dimensions, effective-dated. |
| `accounting_connector` | Per entity: target system (category: cloud SME accounting, mid-market ERP), authentication, account map, export cadence, last export state. |
| `journal` | Period, entity, source (M14, M17, M18, intercompany, manual, consolidation), lines, status (draft, posted, exported, reconciled), reversal link. |

Happy path (mapping): M14 emits `gl.journal.exported.v1` with typed journal lines; M15 applies
`gl_mapping` to produce postings; unmapped types raise a task to group finance and post to a
suspense account so the period still balances. Manual journals require a reason, an attachment and a
second approver above a threshold (illustrative: R50 000).

* M15-R-100 Every posting MUST reference the Platform event or document that caused it, and every
  Platform financial event MUST map to a posting or an explicit suspense entry.
* M15-R-101 The posting ledger MUST balance per entity per period at all times; unmapped events MUST
  post to suspense, never be dropped.
* M15-R-102 Exports to accounting systems MUST be idempotent per journal and MUST record the target
  system's document reference for reconciliation.

## 4. Practice P&L construction from Platform data

| Line | Source | Basis |
|---|---|---|
| Gross revenue by funder type and modality | M14 charges at expected transaction price | Service date; IFRS 15 as configured |
| Contractual adjustments, short-payment variance | M14 remittance routing | True-up on remittance |
| Bad-debt expense and provision movement | M14 write-offs and ECL matrix | Monthly |
| Reading fees | M14 reading-fee statements | Per signed report |
| Contrast and consumables | M18 stock movements at cost | Per study |
| Staff costs | M17 rosters, time and attendance, payroll export | Actual or accrued |
| Equipment: depreciation, leases, maintenance | M18 asset register and contracts; Properties leases | Policy schedules |
| Facilities: rent, utilities, generators and diesel, connectivity and data | Intercompany rent rule; supplier invoices via the connector | Monthly |
| Platform, management and bureau fees | Intercompany rules (§5) | Computed |
| Allocated shared costs (marketing, contact centre, group IT) | MSO cost pools with drivers | Allocation run |
| Other income (corporate contracts, report copies, training) | M14 invoices | Accrual |

Happy path:

1. On `billing.period.checklist.completed.v1` the Close Hand pulls M14 journals for the period and
   the cost sources (M18 consumables, M17 staff, asset and lease schedules).
2. It runs the intercompany engine (§5) and the allocation run (pools to Practices and Sites by
   configured drivers: studies, revenue, headcount, square metres, direct attribution).
3. It posts to the posting ledger and produces the management P&L per Practice and Site: revenue,
   net revenue, gross margin, EBITDA before and after management fees, depreciation, interest, profit
   before and after tax, and the distributable-profit bridge (§8).
4. It compares to budget and prior period, drafts variance commentary (A1: CFO edits) and publishes
   the pack to EXE and PRM, and after CFO release to SHR through the shareholder portal.

Variants: a Site opened mid-period (allocations pro-rated by days open); a management-only affiliate
(P&L for the affiliate, MSO fee invoiced, no consolidation); a mid-period acquisition (opening
balances imported with an effective date; consolidated from the acquisition date).

* M15-R-110 The Platform MUST compute per period per Practice and Site the P&L above with drill-down
  from every line to the underlying Platform records (M02-R-005).
* M15-R-111 Allocation drivers MUST be configurable, effective-dated and shown on the pack with the
  driver values used.

## 5. Intercompany rules

Intercompany flows are defined once in `intercompany_rule` (M02) and executed by M15 monthly. Each
rule has from and to entity, basis, VAT treatment, posting accounts, invoice template, approval
policy and the agreement clause it derives from.

| Flow | Typical basis (configurable) | VAT | Notes |
|---|---|---|---|
| Management fee (MSO to Practice) | Percentage of collections or net revenue; or fixed plus percentage | Standard-rated 15 %; MSO issues a tax invoice | HPCSA rules require a fee for genuine services at fair value, not a share of professional fees; the rule cites the agreement clause. |
| Platform fee (MSO to Practice or affiliate) | Per study, per site, per user, or bundled | Standard-rated | Affiliates without shareholding are invoiced like customers. |
| Rent and equipment lease (Properties to Practice) | Lease schedule with escalation, or per-study equipment charge | Standard-rated | Lease schedules also feed the lessee's depreciation and interest split. |
| Reading fees (Hub to Practice; Practice to radiologists) | Per study, RVU-equivalent, or percentage of collected professional fee | Per the payee's VAT status | From M14 reading-fee statements; disputes to PRM then EXE. |
| Shared staff and secondment | M17 hours at cost plus configured mark-up, or payroll recharge | Standard-rated | Time and attendance is the evidence. |
| Hospital revenue share (Practice to hospital partner) | Percentage of technical or total revenue per JV agreement | Standard-rated | Hospital is an `external_partner`; invoice or self-billing. |
| Cost allocations (MSO pools to Practices) | Drivers | Standard-rated where invoiced | The rule states whether the allocation is invoiced or notional (management accounts only). |

Happy path: the engine computes each rule's amount from the period's evidence; drafts a tax invoice
with the SARS-required content; posts sale and purchase in both entities; publishes the invoice to
the counterparty's PRM with a dispute window (illustrative: 5 working days); on acceptance or expiry
the invoice is final and exported. Disputes go to EXE with the computation visible.

* M15-R-120 Intercompany invoices MUST be generated only from posted rules with computation and
  evidence attached, and MUST post symmetrically in both entities in the same period.
* M15-R-121 VAT treatment MUST be configurable per rule and entity registration status, and invoices
  MUST carry the content SARS requires for a tax invoice.
* M15-R-122 A management-fee rule MUST reference the agreement clause it implements and its basis
  MUST be reviewable by CMP for HPCSA fee-sharing compliance.

## 6. Export to accounting systems (connector pattern)

The Platform does not replace the accounting system. A connector per entity implements the
`ports/Accounting` interface: push journals, push sales and purchase invoices (intercompany,
corporate, patient summaries), push customer receipts summary, pull supplier invoices and bank
balances, pull trial balance for reconciliation. Categories: cloud SME accounting packages, mid-market
ERPs. Each connector maps the Group chart to the target's chart, is idempotent by journal id, keeps a
per-document export log, and surfaces failures to group finance. A monthly reconciliation compares the
posting ledger trial balance to the accounting system's trial balance per entity and lists
differences with a root cause (timing, mapping, manual entry in the accounting system).

* M15-R-130 The Platform MUST reconcile its posting ledger to each entity's accounting system trial
  balance monthly and MUST report every difference with an owner.

## 7. Consolidation, eliminations and minority interests

### 7.1 Happy path

1. Build the consolidation scope from M02: every entity, its parent, ownership percentage on the
   period end date (derived from shares issued, M02-R-002), consolidation method (full for control,
   equity method for significant influence without control, none for affiliates).
2. Aggregate entity ledgers on the Group chart.
3. Eliminate intercompany revenue and costs, receivables and payables, and unrealised intra-group
   margins (for example a Properties mark-up on equipment leased to a Practice) using the intercompany
   invoices as the elimination list; a mismatch between the two sides of any pair is an exception.
4. Compute minority (non-controlling) interests per JV: the minority's economic share of profit after
   tax and of net assets, using effective-dated shareholdings and pro-rata by days where shareholdings
   changed in the period (§8.3).
5. Produce the consolidated P&L, balance sheet summary and cash flow summary at Group, at
   Professional Holdings, and at MSO, with IFRS-based management-pack layouts (statutory packs remain
   in the accounting system).
6. Produce the JV reconciliation: each JV's standalone profit, its minority share, and the
   distributable-profit bridge for §8.

* M15-R-140 Consolidation MUST derive scope and percentages from M02 on the period end date and
  MUST recompute exactly for any historical period.
* M15-R-141 Every elimination MUST reference the intercompany invoice pair it eliminates; unmatched
  pairs MUST be exceptions, not plugs.

## 8. Distributions

### 8.1 Distributable profit

Per Practice per period the Platform computes the bridge: profit after tax, less transfers to
reserves required by the shareholders' agreement (working-capital reserve, capex reserve, loan
covenants), less approved retained amounts, plus released reserves, equals distributable profit. It
then applies the Companies Act solvency and liquidity test (section 46, as configured with the
Group's policy inputs: projected cash, liabilities, contingencies) and records the test result and
the board resolution reference; no distribution proceeds without a passed test and a resolution.

### 8.2 Distribution waterfall

Waterfall steps are configured per Practice from the shareholders' agreement and the share classes
(M02 `share_class.rights`). Typical steps, all optional and ordered:

| Step | Description | Configuration |
|---|---|---|
| Preference return | A share class receives a fixed or indexed return on its subscription first (illustrative: 10 % per annum cumulative) | Rate, cumulative or not, compounding, base amount, arrears tracking |
| Return of capital | Subscription or loan account repayment priority | Per class, capped at outstanding balance |
| Catch-up | After the preference is met, another class receives all or a percentage until a target ratio is restored | Target ratio, percentage |
| Pro-rata | Remainder shared by economic percentage | Economic % from cap table, per class |
| Hurdles and ratchets | Different splits above performance hurdles (illustrative: EBITDA above plan) | Hurdle metric, thresholds, splits |
| Loan account offsets | Shareholder loan balances offset or repaid per agreement before cash distributions | Priority, interest |

The engine runs the steps, records each step's inputs and outputs, and produces per-shareholder
entitlements. Where the agreement is silent, pro-rata by economic percentage applies.

### 8.3 Effective-dated shareholdings and mid-period changes

Entitlements use the cap table as it stood on each day of the period. A transfer of shares effective
mid-period splits the period into segments; each segment's distributable profit is the period's
profit pro-rated by days (or by actual daily results where the agreement requires and the data allows);
each segment applies the cap table in force. Preference arrears and catch-up balances carry across
segments and transfers per the agreement (configurable: arrears follow the shares or stay with the
seller). Every recomputation is deterministic and reproducible from M02 history (M02-R-001, M02-R-007).

### 8.4 Approval workflow and payment files (A0 approvals)

1. The Close Hand proposes a distribution run when the period closes: bridge, solvency and liquidity
   test, waterfall, per-shareholder amounts, dividends tax withholding, net payments.
2. PRM and the Practice's principals review; CFO approves; the board resolution is captured (signed
   document or e-signature) and attached.
3. The Platform generates the bank payment file (EFT batch in the bank's format) to verified
   shareholder accounts (account verification service where available; changes to shareholder bank
   details require dual approval and a cooling-off period, as in M14 §13.3).
4. A second, independent approver releases the file in the banking connector; the file hash is
   verified at release; the bank's acknowledgement and settlement are matched on the bank feed.
5. Shareholder statements and tax certificates are issued (§8.5); the distribution posts to the
   ledgers and exports.

Variants: a shareholder that is a company (dividends tax exemption on declaration with the required
declaration form on file, configurable); a shareholder loan repayment instead of a dividend (no
dividends tax; interest per agreement); a deferred or partial distribution (reserves increased with
a reason); a distribution reversal (only before release; after release, a recovery case).

### 8.5 Shareholder statements and tax certificates

Each shareholder receives, per run: the Practice's summarised P&L and distributable-profit bridge, the
waterfall steps that applied to them, their shareholding over the period (with any segments), gross
distribution, dividends tax withheld (illustrative statutory rate 20 %, stored as configurable
reference data with effective dates and exemption handling), net paid, bank reference, cumulative
year-to-date, and loan account movements. Annual tax certificates for dividends and, where applicable,
interest on loan accounts are generated per shareholder for the tax year, and the withholding
summary is exported for the Group's SARS submissions through the accounting connector. Statements
are available in the shareholder portal (SHR) and by secure link.

### 8.6 Requirements

* M15-R-150 Distributable profit, the solvency and liquidity test result and the board resolution
  reference MUST be recorded before any payment file is generated.
* M15-R-151 The waterfall MUST be configured per Practice from the shareholders' agreement and every
  step's inputs and outputs MUST be stored per run.
* M15-R-152 Entitlements MUST be computed from effective-dated shareholdings with pro-rata segmentation
  for mid-period changes and MUST be reproducible for any past period.
* M15-R-153 Distribution payment files MUST require two independent approvers, verified payee
  accounts and hash verification at release.
* M15-R-154 Dividends tax MUST be computed at the configured statutory rate with exemption handling and
  certificates issued per shareholder per tax year.

## 9. Budgets and forecasts

Budgets per Practice and Site by month are built bottom-up: volumes by modality (M16 demand
forecast, M05 and M18 capacity), revenue per study by funder mix (M14 history), staff plan (M17),
consumables, equipment, facilities and capex, with versioned Group assumptions (tariff and scheme
rate changes, CPI, load-shedding and data costs). Approval is by the CFO, and a reserved matter for
JVs where the agreement says so. A rolling forecast re-forecasts the remaining year monthly from
actuals and M16 models; the Close Hand drafts the changes with commentary (A1: CFO edits). Variance
analysis on the pack drills to drivers (volume, price, mix, cost rate). What-if scenarios (a new CT
at Site X, a DSP contract at a different rate, a new JV) run the same P&L engine and show the effect on
distributable profit and on each shareholder.

* M15-R-160 Budgets and forecasts MUST be versioned, approved, and comparable to actuals on the same
  chart and dimensions.

## 10. Capex approvals and reserved matters

A capex case (new modality, replacement, fit-out, IT) carries the business case (volumes, revenue,
costs, payback and IRR computed by the P&L engine), quotes and supplier due diligence (M18),
financing option (cash, lease, loan), SAHPRA licence implications (M10) and the approval route derived
from the shareholders' agreement and the delegation of authority. Amounts above a threshold
(illustrative: R2 million for a JV) are reserved matters decided by the shareholders named in the
agreement through a recorded vote in the shareholder portal with quorum, majority rules and deadlines
from the agreement. Other reserved matters in M02 §5 (new borrowings, fee-schedule changes,
appointment of principals) use the same vote workflow. Approved capex creates the asset in M18 on
commissioning, links depreciation to the ledger and tracks actual against approved spend.

* M15-R-170 Reserved-matter approvals MUST be executed as recorded votes by the shareholders named in
  the agreement with quorum and majority rules configured from it.

## 11. Banking

* **Multi-bank feeds**: each entity's accounts connected by bank API where available or scheduled
  statement import; balances and transactions per entity and consolidated.
* **Sweep accounts**: each Practice collects into its own accounts; configurable sweeps move surplus
  above a working-capital floor to the Practice's investment account or, where an agreement provides,
  to a Group treasury facility as an intercompany loan with interest posted automatically. Money never
  leaves a Practice without a posted rule and an agreement reference.
* **Payment runs**: supplier payments, intercompany settlements, distributions, refunds and collector
  commissions (M14) all pass through one payment-file pipeline with dual approval, payee verification
  and hash checks.
* **Cash forecast**: 13-week view per entity from claims-in-flight and debtor propensity (M14),
  scheduled payments, payroll and distributions.

* M15-R-180 Every outgoing payment file MUST pass the same dual-approval, payee-verification and hash
  pipeline regardless of its source module.
* M15-R-181 Sweeps MUST execute only under a posted rule referencing an agreement and MUST post
  intercompany loan and interest journals automatically.

## 12. Month-end close and the Close Hand

### 12.1 Mandate and leash

The Close Hand is an M15 Hand (run on M20 as a durable workflow) whose mandate is to run the close
checklist end-to-end: gather, compute, reconcile, draft commentary, chase owners, and propose; it may
post rule-derived journals and intercompany invoices within tolerance, but it may not post manual
journals, approve anything, release payments, or change a rule. Its leash: journal value tolerance
for auto-posting versus prior period (illustrative: 20 % variance beyond which it asks), a fixed list
of allowed journal types, and no access to identified patient data (it works on M14 aggregates).

### 12.2 Checklist (illustrative timeline, working days after period end)

| Day | Step | Level | Exception owner |
|---|---|---|---|
| 0 | Period end; M14 checklist requested; bank feeds pulled | A4 | |
| 1 | M14 outputs received (unbilled register, claims-in-flight, revenue journals, provisions, reading-fee statements); bank reconciliations confirmed; suspense reviewed | A3 | BIL, DEB, PRM |
| 2 | Consumables (M18), staff cost (M17), asset schedules; intercompany run and invoices; dispute window opens | A3 | PRM, BIO |
| 3 | Allocation run; P&L per Practice and Site; variance commentary drafted | A3 / A1 | CFO |
| 4 | Accounting exports; trial balance reconciliation | A3 | Group finance |
| 5 | Consolidation, eliminations, minority interests; distribution proposal with bridge, solvency and liquidity test and waterfall | A3 | Group finance, CFO |
| 6 | Management pack released to EXE and PRM | A1 | CFO |
| 7 | Distribution approvals and resolution; payment file; shareholder statements | A0 | CFO, board |
| 8 | Shareholder portal updated; period locked; `finance.period.closed.v1` | A3 | CFO |

Each step carries evidence, status and a timer; the close dashboard shows the critical path and who
is blocking. Target: hard close by working day 8 (illustrative), with soft numbers visible daily
because revenue and cost journals are generated continuously, not at month-end.

### 12.3 Variants and exceptions

| Variant | Handling |
|---|---|
| M14 checklist incomplete (unbilled items above tolerance) | Close proceeds with accrual at expected price; items listed in the pack; PRM owns follow-up. |
| Intercompany dispute open at day 5 | Consolidation uses the computed amount; dispute flagged in the pack; resolution posts in the next period with back-reference. |
| Bank reconciliation difference | Close proceeds with a suspense entry and an owner; distribution proposal reduced by the unexplained amount until resolved (configurable). |
| Post-close correction | Posts to the open period with reference to the closed period; re-run of distributions only by CFO decision with a documented reason. |
| New model version of the variance commentary drafter | Commentary is Class 4 (internal draft) and always edited by the CFO; the model version is shown on the draft. |

### 12.4 Requirements

* M15-R-190 The close checklist MUST be a durable workflow with evidence, status, owner and timer per
  step, visible on a close dashboard.
* M15-R-191 The Close Hand MUST NOT post manual journals, approve distributions, release payments or
  change rules; these MUST require the roles defined in §13.
* M15-R-192 Revenue and cost journals MUST be generated continuously so that a soft P&L is available
  on any day of the month.

## 13. Controls and audit support

| Control | Mechanism |
|---|---|
| Segregation of duties | Rule maintenance, journal posting, distribution approval, payment release and bank detail maintenance are distinct M01 roles with conflict rules; exceptions need CMP approval and compensating review. |
| Immutable trail | Every journal, rule version, run, approval and payment file is append-only with actor (human or Hand run id), timestamp and reason. |
| Reproducibility | Any period's P&L, consolidation and distribution recomputes from versioned rules and effective-dated data; the diff is a standard report. |
| Payments | Dual approval, verified accounts, cooling-off on bank detail changes, file hashing, bank acknowledgement matching. |
| Reserved matters | Recorded votes with quorum and majority per agreement; no override outside the agreement. |
| Audit support | Auditor role (read-only, time-boxed) over the trail, journals, reconciliations, rule versions, resolutions and close evidence; sample selection; audit schedule exports; a query tracker with owners and due dates. |
| Regulatory | Dividends tax and certificates; VAT on intercompany invoices; CMP review of management-fee rules for HPCSA fee-sharing; POPIA: finance users see aggregates, not identified patient data, unless a recorded lawful basis applies. |

* M15-R-200 An auditor role MUST exist with read-only, time-boxed access to all close evidence and the
  ability to recompute any period.

## 14. KPIs

| KPI | Definition | Illustrative target | Owner |
|---|---|---|---|
| Days to close | Period end to `finance.period.closed.v1` (working days) | ≤ 8, trending to 5 | CFO |
| Soft-close accuracy | Absolute variance between day-0 soft P&L and hard-close P&L | ≤ 2 % of revenue | CFO |
| Auto-posted journal share | Journal value posted from rules without manual entry ÷ total | ≥ 95 % | Group finance |
| Intercompany dispute rate | Disputed intercompany invoices ÷ issued | ≤ 5 % | PRM / EXE |
| Elimination exceptions | Unmatched intercompany pairs at consolidation | 0 | Group finance |
| Ledger-to-accounting reconciliation differences | Count and value per entity | 0 unexplained | Group finance |
| Distribution timeliness | Period end to shareholder payment (working days) | ≤ 10 | CFO |
| Distribution recomputation diffs | Recomputed versus paid for closed periods | 0 | CFO |
| Budget accuracy | Actual versus budget at Practice level (revenue, EBITDA) | Within 5 % | PRM / CFO |
| Forecast accuracy | Actual versus 3-month-ahead forecast | Within 5 % | CFO |
| Capex approval cycle time | Case submitted to decision | ≤ 15 working days | EXE |
| Audit query closure | Auditor queries closed within SLA | ≥ 95 % | Group finance |

## 15. Automation map

| Step | Level | What the Hand or engine does | Exception path |
|---|---|---|---|
| Journal generation from M14 and cost sources | A4 | Mapping rules post continuously | Unmapped type: suspense and task |
| Allocation run and intercompany invoicing | A3 | Drivers applied; invoices computed and posted both sides | Variance beyond leash or dispute: PRM, EXE |
| Accounting export and TB reconciliation | A3 | Connector push; compare | Differences: group finance |
| P&L pack and variance commentary | A3 / A1 | Pack built; commentary drafted | CFO edits and releases |
| Consolidation, eliminations, minority interests | A3 | Scope from M02; eliminations from invoice pairs | Unmatched pair or cap-table gap: group finance, M02 |
| Distributable profit, solvency test, waterfall | A3 | Computed per segment | Failed test or agreement ambiguity: CFO, board, legal |
| Distribution approval, resolution, payment release | A0 | Proposal and file prepared, hashed | None |
| Shareholder statements and tax certificates | A3 | Generated and published | Missing exemption evidence: group finance |
| Budget build and rolling forecast | A1 | Drafts pre-filled from M16 and M14 history | PRM and CFO edit |
| Capex case computation | A3 | Payback and IRR from the P&L engine | Reserved-matter vote (A0) |
| Bank feeds, sweeps, 13-week cash forecast | A3 | Under posted rules | Feed failure, missing rule, shortfall: group finance, CFO |
| Close orchestration and period lock | A3 | Close Hand chases, computes, proposes, locks | Step blocked past timer or reopen: CFO |

## 16. Data model (M15)

All tables carry `entity_id`, `period_id`, `created_at`, `created_by` (user or Hand run id), and
are append-only or versioned.

| Table | Key fields |
|---|---|
| `fiscal_period` | entity, financial year, period, start, end, status (open, soft_closed, closed, locked), closed_by |
| `account` / `dimension` | code, name, type, IFRS group, local parent; dimension name, values, effective dates |
| `gl_mapping` | source type, debit and credit accounts, dimensions rule, effective dates, version |
| `journal` / `journal_line` | entity, period, source, status, reversal link, attachments; account, debit, credit, dimensions, source ref |
| `allocation_rule` / `allocation_run` | pool, driver, targets, dates; period, driver values, amounts |
| `intercompany_invoice` | rule (M02), from, to, period, basis inputs, amount, VAT, number, status (draft, issued, disputed, final, exported) |
| `accounting_connector` / `export_log` | entity, system category, account map; document, target reference, status, error |
| `tb_reconciliation` | entity, period, ledger and accounting TBs, differences (account, amount, root cause, owner) |
| `consolidation_run` / `elimination` | period, scope, minority interests, outputs; invoice pair refs, amount, matched flag |
| `distributable_profit` | entity, period, bridge lines, solvency and liquidity test (inputs, result), resolution ref |
| `waterfall_config` / `waterfall_step` | entity, agreement ref, version; order, type, parameters |
| `distribution_run` / `shareholder_entitlement` | entity, period, segments (dates, cap-table version), step results, status, approvers; shareholder, segment, gross, dividends tax, exemption ref, net, loan movement, payment ref |
| `shareholder_statement` / `tax_certificate` | shareholder, run or tax year, document ref, delivered_via |
| `payment_file` | source, lines, hash, approvers, released_at, bank acknowledgement, settlement match |
| `budget` / `forecast` | entity, version, status, assumptions, lines (account, dimension, month, amount) |
| `capex_case` / `reserved_matter_vote` | business case, quotes, financing, licence implications, route, status, asset ref (M18); agreement ref, matter, voters, quorum, majority rule, votes, outcome |
| `bank_account` / `bank_transaction` / `sweep_rule` | entity, bank, masked account, feed type; references and match status; floor, target, agreement ref, interest basis |
| `close_run` / `close_step` | period, status, critical path; step, evidence refs, owner, timer, status |

## 17. Events emitted (versioned, M21 outbox)

| Family | Events |
|---|---|
| Ledger | `finance.journal.posted.v1`, `finance.journal.suspense.v1`, `finance.export.completed.v1`, `finance.export.failed.v1`, `finance.tb.reconciled.v1` |
| Intercompany | `intercompany.invoice.issued.v1`, `intercompany.invoice.disputed.v1`, `intercompany.invoice.final.v1` |
| Close | `finance.close.started.v1`, `finance.close.step.completed.v1`, `finance.close.step.blocked.v1`, `finance.pack.released.v1`, `finance.period.closed.v1`, `finance.period.reopened.v1` |
| Consolidation | `consolidation.completed.v1`, `consolidation.exception.v1` |
| Distributions | `distribution.proposed.v1`, `distribution.approved.v1`, `distribution.released.v1`, `distribution.paid.v1`, `shareholder.statement.issued.v1`, `tax.certificate.issued.v1` |
| Planning and capex | `budget.approved.v1`, `forecast.updated.v1`, `capex.case.submitted.v1`, `capex.case.decided.v1`, `reserved.matter.decided.v1` |
| Banking | `bank.feed.received.v1`, `sweep.executed.v1`, `payment.file.released.v1`, `payment.file.settled.v1`, `cash.forecast.shortfall.v1` |

Consumers: M16 (KPIs and benchmarking), M02 (agreement and cap-table links), M18 (capex to assets),
M14 (period lock, refund and commission payment files), M20 (Close Hand tasks), the shareholder
portal (SHR) and the accounting connectors.
