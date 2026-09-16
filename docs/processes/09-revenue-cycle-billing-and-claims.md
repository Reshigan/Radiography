# 09 — Revenue Cycle: Billing and Claims (M14)

## 1. Purpose and scope

M14 Revenue Cycle (Billing) turns every completed imaging service into cash, correctly and quickly,
with as little human touch as is safe. It is the "automated billing" heart of the Platform: it makes
a Practice's money visible from the moment a study is completed to the moment the last rand is
banked, and it lets the MSO run billing as a bureau across many Practices under one set of rules.

In scope: charge capture from order, MPPS and signed report; pricing per funder; claim assembly and
scrubbing; submission and response handling; remittance and cash application; patient billing and
point-of-service collection; debtors and collections; the M14 side of month-end close; controls,
fraud detection and funder audits.

Out of scope: benefit checks, pre-authorisation and quotes (M06); GL posting, intercompany and
distributions (M15); AI output classes and verification tiers (`12-ai-safety-no-slip-charter.md`);
Hand runtime mechanics (M20).

Every tariff code, price, percentage, deadline or threshold in this document is illustrative unless
stated as statutory (VAT 15 %). The Platform stores all of them as configurable, effective-dated
reference data in `billing-rules`.

## 2. South African context the module is built around

| Topic | Meaning for billing | Platform treatment |
|---|---|---|
| Practice number (BHF PCNS) | Every claim carries the billing Practice's number and the treating provider's number; a discipline code identifies diagnostic radiology (illustrative code 034). | On `legal_entity` (M02) and provider records; format validation and PCNS lookup adapter where available. |
| Referring provider | Radiology is a referred discipline; schemes require the referrer's practice number. | Captured at referral (M04); scrubber blocks a claim without it unless the rule pack allows self-referral. |
| Tariff codes | Private practice bills against tariff codes descended from the historical reference price list; each scheme publishes its own tariff file and rates. | `tariff_code` master with funder rate files, effective-dated by service date. |
| NAPPI codes | Contrast media, consumables and medicines are billed as separate lines under NAPPI codes. | `tariff_code.kind = nappi`; stock decrement (M18) drives the line. |
| ICD-10 | Mandatory on every medical scheme claim; drives PMB adjudication. | Coding Hand proposes; human confirms below threshold. |
| PMBs | Prescribed Minimum Benefit conditions must be funded in full by the scheme as regulated. | `pmb_candidate` flag from ICD-10 to PMB mapping; drives scrubbing and appeals. |
| DSP contracts | Negotiated rates and network status change what is billable and whether balance billing is allowed. | `funder_contract` with rate basis and balance-billing policy. |
| Claims window | Medical Schemes Act regulations (illustrative reading of Regulation 6): submit within 4 months of service; scheme pays or returns within 30 days; corrections within 60 days of the return. | Deadline timers on every claim with escalation. |
| VAT | Private medical services are standard-rated at 15 % when the Practice is VAT registered; any exempt or zero-rated category is configurable. | `vat_treatment` per tariff code and contract. |
| RAF | Road Accident Fund pays accident-related medical expenses under its own tariff and process, often via the claimant's attorney, over years. | Funder type `raf`; long-lived lifecycle; document packs. |
| COIDA | Injury on duty: employer's accident report, Fund claim number, medical reports, invoices lodged with the Compensation Fund (or a licensed mutual assurer for mining and construction) under the gazetted tariff. | Funder type `coida`; claim number mandatory; report attachments. |
| ODMWA | Occupational chest imaging for mine workers under the occupational-disease framework. | Funder type `odmwa`; occupational retention flags (M09). |
| NHI Act 2024 | NHI Fund contracting is planned, not operational; state contracts exist today. | Funder type `state_contract`; NHI-ready placeholder. |
| POPIA | Billing data is special personal information; the MSO bills as operator for each Practice. | Lawful basis recorded (M02-R-004); collections respect consent and purpose limitation. |
| NCA, CPA, Prescription Act, Debt Collectors Act | Constrain interest, fees, notices, contact practices and prescription (illustrative: three years) for patient debt; only registered collectors or attorneys may collect on handover. | Collections Hand leash; dunning policy engine; prescription timers. |

## 3. Actors

| Code | Role in M14 |
|---|---|
| BIL | Coding exceptions, scrubber exceptions, rejections queue, resubmissions, appeals. |
| DEB | Patient and corporate debtors, matching exceptions, disputes, payment plans, write-off proposals, handover. |
| FDK | Collects the patient portion with the Collect card; receipts. |
| PRM | Approves write-offs within site limit; owns the unbilled register at month-end. |
| RGT | Signs reports (charge trigger); answers coding queries; receives reading-fee statements. |
| RAD / NUR | Complete the study (MPPS), scan contrast and consumables, record repeats (never billed). |
| PAY | Receives claims, returns responses and remittances, requests audit packs. |
| PAT | Pays, receives statements and links, raises disputes. |
| EXE (CFO) | Pricing policy, write-offs above limit, KPIs. |
| CMP | Anomaly alerts, audit pack release, POPIA in collections, rule activation. |
| AIO | Governs the Coding Hand and the rejection prediction model. |
| Hands | Coding Hand, Claims Hand, Remittance Hand, Collections Hand (M14 Hands on M20). |

## 4. End-to-end overview

```
 Order (M04)   Study complete (M08)   Report signed (M12)   Auth (M06)
      └──────────────┴──────────┬───────────┴────────────────┘
                                ▼
   [1] Charge capture ─► [2] Pricing ─► [3] Assembly & scrub ─► [4] Submission
                                                 ▲                    │
                                        rework / appeal ◄─────────────┤ responses
                                                                      ▼
   Bank feeds ──────────────────────────► [5] Remittance & cash application
                                                 │                    │
                                     [6] Patient billing     [7] Debtors & collections
                                                 └──────────┬─────────┘
                                                            ▼
                                             [8] Month-end close ─► M15
```

Target state: for a scheme patient with a valid authorisation and a routine study, no human touches
the account between the radiologist's signature and the bank deposit. Humans work exceptions.

Process card (conventions §5): **Trigger** `study.completed.v1`, `report.signed.v1`, remittance and
payment webhooks, scheduler. **Preconditions** patient identity verified (M03), funder context
captured (M06), order exists (M04), provider numbers and fee schedules configured. **Automation**
A3 for clean scheme claims and remittance posting; A2 for coding audit and rejections; A1 for RAF,
COIDA and corporate assembly; A0 for write-offs above limit and refunds. **Data, KPIs, controls**:
§16, §14, §13.

## 5. Stage 1: Charge capture

### 5.1 Purpose and triggers

Charge capture creates the billable record (`charge` and `charge_line`s) for a service that was
actually delivered, with the tariff codes, quantities, modifiers and clinical codes needed to claim
it. It is built from evidence the clinical modules already produce; nobody transcribes.

1. `order.accepted.v1` (M04) creates a *provisional* charge so the quote (M06) and the Collect card
   (M07) have a basis.
2. `study.completed.v1` (M08, MPPS N-SET COMPLETED or technologist completion) upgrades it to
   *performed*: procedures actually done, contrast and consumables scanned, repeats flagged, mobile or
   after-hours context from timestamps.
3. `report.signed.v1` (M12) upgrades it to *reportable*: the signed report is the source for the final
   procedure set, the reporting radiologist's provider number and ICD-10 from the findings.
4. Procedures configured `bill_on = completed` (for example batch-read screening mammography) do
   not wait for a signature.

Preconditions: study linked to order, patient, episode and funder context; site, room and modality
known; treating and referring provider numbers present or flagged; tariff mapping exists for the
service date.

### 5.2 Happy path

1. On `study.completed.v1` the builder reads the performed procedures (MPPS and completion form),
   contrast and consumable scans (NAPPI, batch, quantity), acquisition timestamps, room and modality.
2. It maps each procedure to tariff codes using `procedure_tariff_map` for the funder's file and the
   service date.
3. It applies session and multiple-procedure rules (§5.3.3), bilateral rules, contrast-enhanced code
   substitution, and modifiers for mobile, after-hours, public holiday and emergency context using
   site operating hours and the SA public-holiday calendar.
4. Contrast and consumables become separate lines with NAPPI code, quantity and batch. Wastage is
   billed per the funder's rule (full vial, administered dose, or not billed; configurable).
5. The Coding Hand runs (§5.4) and attaches suggested ICD-10 and, where required, PMB codes with
   confidence and provenance.
6. On `report.signed.v1` the builder re-runs; if the report names a different or additional procedure
   (for example a post-contrast phase), the charge is amended with reason `report_reconciliation`.
7. The charge becomes `ready_to_price` and emits `charge.captured.v1`. Target: under one minute from
   signature.

### 5.3 Coding structure (illustrative, all configurable)

#### 5.3.1 Tariff code master

`code`; `kind` (procedure, modifier, nappi, package, admin); funder description and a plain-language
patient description; `modality`, `body_region`, `contrast_flag`, `laterality_rule`; `component`
(global, professional, technical); `units_rule` (per study, per region, per view set, per minute);
`vat_treatment` (standard, zero, exempt); effective dates.

Demo data uses codes such as 30110 "chest, two views", 34100 / 34101 "CT brain without / with
contrast", 35110 "MRI lumbar spine", 33020 "ultrasound abdomen", 39120 "mammography bilateral
screening" and a NAPPI line for 100 ml iodinated contrast. All are labelled DEMO and never presented
as real.

#### 5.3.2 Modifiers

Each modifier is a `tariff_code.kind = modifier` with a rule: which codes it applies to, its price
effect (percentage or fixed), whether it stacks, and the evidence required.

| Modifier (illustrative) | Meaning | Evidence attached automatically |
|---|---|---|
| After-hours, public holiday | Outside the site's configured hours | Acquisition timestamp versus `site.operating_hours`; emergency flag |
| Mobile / portable | Performed in ward, ICU, theatre or off-site | Modality type PX, MPPS station, ward on order |
| Multiple procedure | Second and subsequent procedures in a session | Session grouping rule |
| Bilateral | Both sides | Laterality from order and report |
| Professional-only / technical-only | Component split for hospital-based work | Site configuration and agreement (M02) |
| Sedation present | Interventional or paediatric MRI | Order and nursing record (M07) |

#### 5.3.3 Session and multiple-procedure rules

A session is all studies for one patient, one site, one calendar day (configurable window). The
funder's rule pack decides the primary code (highest value), the reduction on subsequent codes,
whether different modalities reduce each other, and maximum counts. Rules are data in
`billing-rules`, versioned, effective-dated, and unit-tested by replaying historical claims.

#### 5.3.4 Professional versus technical components

Most SA private radiology bills a global fee. The Platform also supports: hospital-based JVs where
the hospital bills the technical component under its own practice number and the Practice bills
professional only; Hub reading for a Practice (Practice bills globally; Hub invoices a reading fee
through M15, no funder-facing split); second-opinion reads of external images (professional-only,
`no_acquisition` flag).

#### 5.3.5 Never billed

Repeat exposures in the repeat/reject register (M08); studies cancelled before acquisition or marked
`not_performed`; QA phantoms. Staff-benefit studies are billed at the policy rate (possibly zero)
but always recorded.

### 5.4 ICD-10 capture and the Coding Hand

**Sources**: the referral (M04, an ICD-10 or free-text indication); the order and safety
questionnaire (M07); the signed report's findings and impression (M12, the richest source); the
authorisation (M06), with which the claim should be consistent.

**Mandate**: propose tariff codes, modifiers, ICD-10 and PMB codes for a charge with a confidence
per code and provenance; never submit anything. The Hand reads the order, MPPS data, the structured
report (never images) and the funder rule pack, uses a retrieval index of the SA-applicable ICD-10
edition and the funder's PMB mapping, and an LLM through the LLM Gateway. Every output is a
`coding_suggestion` with `model_id`, `model_version`, `confidence`, `evidence_spans` and
`rule_pack_version`.

**Verification gate (Class 2)**. A code on a funder claim reaches a funder and a ledger, so it is a
Class 2 output. The gate is enforced by the M14 domain, not by the prompt:

| Condition | Outcome |
|---|---|
| `confidence >= threshold` (default 0.95, configurable per funder and code family) **and** the rule-pack scrub passes with zero errors **and** the claim is not in an exclusion class (RAF, COIDA, corporate, interventional, manually amended charge, patient with open dispute, value above leash) | A3 auto-accept: `accepted_by = coding_hand`; claim proceeds. A stratified sample (default 5 %, higher for new model versions) goes to a BIL audit queue after submission. |
| Anything else | A1: shown in the BIL coding queue in annotated style with Accept / Edit / Reject; nothing proceeds until a human acts. |

Thresholds, samples and exclusions are governed by AIO with CMP sign-off. Audit outcomes (agree,
minor, major) feed M11 monitoring; if a code family's major-change rate exceeds tolerance
(illustrative: 2 % over a rolling 500 claims) auto-accept for that family suspends itself and AIO is
alerted.

**Coding queue (A1)**: sorted by deadline, value, age; shows report text with evidence spans, code
descriptions, the funder's known edits and the price effect of each choice; BIL can send RGT an
in-line coding query answered from the Reading Room.

### 5.5 Variants and exceptions

| Variant | Handling |
|---|---|
| Performed, never reported | `awaiting_report` on the unbilled register; escalation to RGT worklist and PRM at a configurable point before the claim deadline. |
| Addendum changes procedure or diagnosis | New `charge_version`; if claimed, correcting claim or reversal (§8.6). |
| Cancelled after acquisition started | Charge for what was performed; reason recorded. |
| Walk-in, no referral | Charge captured; scheme claim blocked until referrer captured or self-referral rule allows; cash pricing offered. |
| No MPPS from modality | Technologist completion is the trigger; QA report lists manual-completion sites. |
| Contrast on nursing record but not scanned | Nursing record wins; stock discrepancy to M18. |
| Time-based codes | MPPS start and end timestamps. |

### 5.6 Requirements

* M14-R-100 The Platform MUST create charges automatically from order, MPPS/completion and signed
  report events without re-keying procedures, provider numbers or service dates.
* M14-R-101 Tariff, modifier, NAPPI and package codes MUST be effective-dated by service date.
* M14-R-102 The Platform MUST never bill a repeat exposure recorded in the repeat/reject register.
* M14-R-103 Every coding suggestion MUST carry model id, version, confidence, evidence spans and rule
  pack version, and MUST render in annotated style until accepted.
* M14-R-104 Auto-acceptance MUST be blocked by the domain layer unless confidence meets threshold, the
  scrub passes and no exclusion applies; the sampled audit MUST be enforced by the scheduler.
* M14-R-105 Auto-acceptance for a code family MUST suspend itself when its audited major-change rate
  exceeds tolerance.
* M14-R-106 The Platform MUST support global, professional-only and technical-only billing per site
  and funder contract.

## 6. Stage 2: Pricing

### 6.1 Purpose and model

Pricing attaches a price to each line for the funder context, computes VAT and splits expected
funder and patient portions. The same engine prices quotes in M06, so the quote is the bill.

| Object | Description |
|---|---|
| `fee_schedule` | Per Practice, named, effective-dated. Kinds: `scheme_rate` (percentage of a funder's published rate, for example 100 %, 150 %, 200 %), `negotiated` (DSP fixed prices), `cash`, `raf`, `coida`, `corporate`, `state`, `staff`. |
| `fee_schedule_line` | Tariff code, price excl. VAT, unit, component, dates; absent lines fall back to the schedule's `default_basis`. |
| `funder_rate_file` | The funder's published tariff file, imported per version; base for `scheme_rate` schedules and the expected-payment reference for matching. |
| `funder_contract` | Funder (and plan) to fee schedule, DSP status, balance-billing policy, channel, rule pack, claim format, deadlines. |
| `package` | Bundle price for a code set (for example a mammography screening bundle: bilateral mammography plus tomosynthesis plus ultrasound if indicated) with partial-performance rules. |
| `price_override` | Per-charge manual override with reason, approver and audit. |

### 6.2 Happy path

1. Determine funder context from the episode's coverage (M06) in priority order: COIDA or RAF when
   flagged injury on duty or motor-vehicle accident; scheme; corporate; cash.
2. Select the `funder_contract` in force on the service date and its fee schedule.
3. Price each line (schedule line, else default basis against the rate file, else Practice default);
   record `price_source`.
4. Apply package pricing where all mandatory components are present; keep components as child records
   for formats that require itemisation.
5. Apply modifier effects and multiple-procedure reductions in money terms.
6. Compute VAT per line from `vat_treatment` and the Practice's registration status.
7. Compute the expected split: funder rate (or real-time adjudication result, §8.3) as expected funder
   payment; balance to patient where balance billing is permitted; zero patient portion for
   PMB-flagged claims at a DSP; full amount for cash.
8. Emit `charge.priced.v1` with amounts and price provenance.

### 6.3 Versioning, contracts and exceptions

* Prices follow the service date. A schedule change never re-prices history unless an explicit
  `reprice` command with reason creates a new `charge_version` (and a correcting claim if claimed).
  Every version stores inputs, rule versions and outputs so statements and audits regenerate exactly.
* Employer and occupational contracts (pre-employment chest X-rays, ODMWA surveillance) use
  `corporate` schedules with per-employee or batch pricing, purchase-order references, volume tiers,
  CPI-linked escalation (configurable) and monthly consolidated invoices.
* Exceptions: scheme option missing from the rate file (fall back, warn, rate-file task); service
  spanning midnight (service date is acquisition start); scheme change between quote and service
  (re-price, Collect card and patient updated); non-VAT-registered Practice (treatment
  `not_registered`); override requests (A0, reason mandatory, reported monthly).

### 6.4 Requirements

* M14-R-110 Quotes (M06) and charges MUST use the same pricing code path and rule versions.
* M14-R-111 Every priced line MUST record its price source and rule versions.
* M14-R-112 VAT MUST be computed per line and shown on invoices in the form SARS requires for a tax
  invoice.
* M14-R-113 Fee schedule changes MUST be routed as reserved matters where the shareholders' agreement
  requires (M02 §5).

## 7. Stage 3: Claim assembly and scrubbing

### 7.1 Claim types and lifecycles

| Type | Payer and channel | Lifecycle |
|---|---|---|
| Medical scheme claim | Scheme or administrator via switch (EDI batch or real-time) or direct portal / API | Submit, acknowledge, adjudicate (paid, short-paid, rejected, pended), remit; resubmission window per regulation |
| Patient invoice | PAT; tax invoice, statement, payment link | Issued at service (POS) or after remittance (balance) |
| RAF supplier claim | Road Accident Fund, usually via claimant's attorney; prescribed forms, itemised account, report copy | Lodged, acknowledged, assessed, offer, paid; years; prescription tracked; often paid net of attorney deduction |
| COIDA claim | Compensation Fund or licensed mutual assurer; claim number, employer report reference, first and progress medical reports, electronic invoice | Registered, report accepted, invoice adjudicated, paid; rejections for missing claim number or unaccepted liability |
| ODMWA | Occupational programme | Per programme contract |
| Corporate invoice | Employer or occupational-health provider; monthly consolidated tax invoice | Trade debtor |
| State / NHI contract | Provincial department or (future) NHI Fund; monthly schedule against an SLA | Trade debtor with contract evidence |

### 7.2 Required fields (scheme claim)

Billing practice number; treating provider number (and HPCSA registration where required);
referring provider number; scheme, plan and option; member number; dependant code; patient date of
birth and initials as per scheme records; service date; place of service (site code, in-hospital
indicator, hospital practice number for in-patients); authorisation number where required; ICD-10
primary and secondary; tariff codes, modifiers, quantities, amounts; NAPPI lines; claim reference;
original claim reference on resubmission.

### 7.3 Happy path

1. On `charge.priced.v1` the assembler selects the claim type and channel from the contract and builds
   `claim` and `claim_line`s.
2. **Duplicate check**: same patient, code, service date and Practice with any prior status other than
   reversed is blocked; near-duplicates (same day, same modality, different code) warn.
3. **Rule-pack scrub**: the funder's `scheme_rule_pack` runs. Rules carry severity `error` (block),
   `warn` (flag) or `fix` (deterministic correction with audit, for example padding a dependant code or
   mapping a deprecated code). Families: required fields; code validity on service date; code to ICD-10
   compatibility; gender and age edits; laterality; frequency limits (one screening mammogram per
   period); authorisation required for modality; contrast plausibility; in-hospital consistency with
   ADT; PMB consistency; member validity per last benefit check.
4. **Rejection prediction**: a Class 3 model (routes work only) scores rejection probability and the
   likely reason from the Group's response history; above threshold the claim goes to the BIL
   pre-submission queue with a suggested fix.
5. **Split**: the claim carries the expected funder amount; `patient_liability` is created after
   adjudication, except known co-payments and non-covered items already collected at the desk (§10).
6. **Batching**: per channel cut-off (illustrative: every 30 minutes for EDI, immediate for real-time)
   after a grace period (illustrative: 2 hours) to absorb late addenda.
7. Emit `claim.assembled.v1` and `claim.scrubbed.v1`.

### 7.4 Scheme rule packs and the learning loop

One versioned, effective-dated rule pack per funder (or administrator), declarative (condition,
action, message, severity, source reference) so BIL can read it and a Hand can propose changes.
Every rejection is matched to the rule that should have caught it; if none exists the Claims Hand
drafts a candidate rule (A1: BIL accepts or edits; CMP activates rules that block). New rules replay
against the last 90 days of claims before going live. Packs are shared across the Group's Practices
with per-Practice overrides.

### 7.5 RAF, COIDA and corporate assembly (A1)

* **RAF**: pack with itemised account, signed report copy, accident context, patient consent to
  release and the prescribed supplier claim fields; tracks RAF claim number, attorney of record,
  correspondence, offers and prescription date; allocations handle `third_party_deduction`.
* **COIDA**: episode must carry the employer's accident report reference and the Fund claim number;
  if absent the study proceeds (care is never blocked) and the claim waits in
  `awaiting_claim_number` with a Collections Hand task to obtain it from the employer; the first
  medical report is generated from the signed report; invoices go through the Fund's electronic
  connector.
* **Corporate**: monthly invoice run consolidating employer-attributed charges with PO references and
  employee identifiers; employer portal for statements.

### 7.6 Variants and exceptions

| Variant | Handling |
|---|---|
| Authorisation missing for a modality that requires it | Scrub error; Claims Hand requests retro-authorisation via M06 (A3 only for study types where retro-auth is commonly granted); otherwise BIL. |
| Member invalid at service date | Re-run benefit check; if still invalid, cash conversion with consent path (§10.6). |
| Referrer not on the funder's file | Warn; proceed; on rejection, correct number or provider registration task. |
| In-patient study without hospital case number | Scrub error; ADT lookup; BIL task. |
| PMB candidate without authorisation | Submit with PMB indicator; on short-payment, automatic PMB appeal (§8.6). |
| Claim above auto-submission leash (illustrative: R25 000) | Human confirmation regardless of confidence. |

### 7.7 Requirements

* M14-R-120 The scrubber MUST run the funder's rule pack on every claim and MUST block on `error`.
* M14-R-121 Exact duplicates MUST be blocked; near-duplicates MUST be flagged.
* M14-R-122 Rule packs MUST be declarative, versioned, effective-dated and replayable before
  activation.
* M14-R-123 The rejection prediction model MUST only route work and MUST never alter claim content.
* M14-R-124 RAF, COIDA, corporate and state claims MUST be assembled at A1 with document packs and
  their own lifecycle states and deadlines.

## 8. Stage 4: Submission and response handling

### 8.1 Channels

| Channel | Description | Adapter |
|---|---|---|
| Switch, EDI batch | The dominant SA channel: batched claims, technical acknowledgement, asynchronous adjudication responses | `ports/Switch`, one adapter per switch; simulator in demo |
| Switch, real-time | Single claim adjudicated in seconds where the administrator supports it, returning funder payment and patient liability | Same port, `submitRealtime` capability per funder |
| Direct funder portal or API | Some administrators, the Compensation Fund, corporate clients | Per-funder adapters; robotic portal submission only under CMP approval with human fallback |
| Paper / email | RAF packs, some corporates | Generated PDF pack, tracked correspondence |

### 8.2 Happy path (EDI batch)

1. The Claims Hand (mandate: submit scrubbed claims within leash, track acknowledgements, retry
   transport failures, resubmit deterministic fixes; never change clinical content) collects
   `ready_to_submit` claims at the cut-off.
2. It builds, signs and transmits the batch and records `claim_submission` with the raw payload
   (immutable) and the switch reference.
3. It records the technical acknowledgement per claim; claims move to `submitted` with the
   submission date as deadline evidence.
4. Responses arrive by webhook or polled file, are stored raw, parsed into `claim_response` and
   mapped to lines: `accepted`, `paid`, `short_paid`, `rejected` (reason code), `pended`.
5. Emit `claim.submitted.v1`, `claim.response.received.v1` and `claim.rejected.v1` as applicable.

### 8.3 Real-time claims

For real-time funders the claim is submitted the moment it is priced and coded, usually before the
patient leaves; the response updates the Collect card with the true patient liability. On timeout or
switch outage the claim falls back to batch and the desk collects the expected portion with a "final
balance may differ" note on the receipt.

### 8.4 Timelines

Per `funder_contract`: submission deadline (illustrative default 4 months from service) with alerts
at illustrative 60, 30 and 7 days; expected adjudication time (illustrative 30 days) driving an
overdue-response queue where the Claims Hand issues status enquiries; resubmission deadline after a
return (illustrative 60 days).

### 8.5 Rejection taxonomy and auto-fix paths

| Class | Examples | Path |
|---|---|---|
| Member / eligibility | Member not found, dependant mismatch, lapsed | Re-verify (M06); resubmit (A3 if formatting only); else patient liability (A1) |
| Authorisation | Missing or mismatched auth | Retro-auth request; resubmit with number (A3 for known-retro funders) |
| Coding | Invalid or inconsistent code, ICD-10 missing | Coding Hand re-proposal; BIL confirms; resubmit (A1) |
| Benefit | Exhausted, limit reached, not covered | PMB check; appeal if PMB (A2); else patient liability with explanation (A3) |
| Duplicate | Funder sees a duplicate | Verify; reverse if genuine; else resubmit with annotation (A1) |
| Referrer / provider | Invalid number, not on network | Correct; registration task; resubmit (A1) |
| Technical | Format, batch, switch errors | Claims Hand fixes and resubmits (A4) |
| Late submission | Beyond deadline | Appeal where regulation allows; else write-off proposal with root cause (A0) |

Deterministic classes are fixed by the Claims Hand within leash (daily count and value per funder).
The rest land in the BIL rejections queue sorted by deadline and value, with the funder's message,
the class, the suggested fix and one-click resubmission. Unmapped funder codes create a mapping task
and default to the queue.

### 8.6 Appeals, reversals, correcting claims and credit notes

**Appeal**: structured dispute with the evidence pack (referral, authorisation, signed report, PMB
argument), tracked with funder reference and deadline; PMB appeals are generated automatically (A2,
sample reviewed by BIL). **Reversal**: the claim is withdrawn through the switch or a reversal claim
submitted; the charge returns to `ready_to_price` or is voided. **Correcting claim**: reversal plus
resubmission with the original reference. **Credit note**: SARS-compliant tax credit note against a
patient or corporate invoice with reason and approver by limit.

### 8.7 Requirements

* M14-R-130 Every submission and response payload MUST be stored raw, immutable and replayable.
* M14-R-131 A claim MUST NOT silently expire; expiry requires an explicit write-off with root cause.
* M14-R-132 Real-time results MUST update the Collect card before the patient leaves when returned
  within a configurable wait (illustrative: 20 seconds).
* M14-R-133 The Claims Hand's leash (daily count, value, funder scope, fix classes) MUST be enforced
  by M20, and the Hand MUST NOT modify tariff, modifier or ICD-10 content.
* M14-R-134 Every funder reason code MUST map to the rejection taxonomy.

## 9. Stage 5: Remittance and cash application

### 9.1 Happy path

1. ERA files arrive from the switch or portal per payment run. The Remittance Hand (mandate: parse,
   match, post within tolerance, raise exceptions; never write off) stores them raw and parses
   `remittance` and `remittance_line`s.
2. **Auto-match** by claim and line reference; fallback by practice number, member number, service
   date, tariff code and amount within tolerance (illustrative: R1.00 or 0.5 %, whichever is lower);
   match confidence recorded.
3. Paid equals expected: `paid`, allocation created.
4. Paid below expected: `short_paid`; the funder reason maps to the short-payment taxonomy
   (`co_payment`, `benefit_exhausted`, `not_covered`, `rate_difference`, `pmb_dispute`,
   `tariff_adjustment`, `duplicate`, `auth_penalty`, `levy`, `unknown`). Policy routes the remainder:
   to patient liability for co-payments, exhaustion and rate difference where balance billing is
   permitted; to appeal for PMB and authorisation disputes; to contractual adjustment for DSP
   contracts that forbid balance billing.
5. Paid above expected: `over_paid`; a funder refund case opens (§9.4); never auto-refunded.
6. The ERA total is matched to the bank credit (EFT reference, amount, date window); the remittance
   becomes `banked`.
7. `remittance.matched.v1` and `payment.received.v1` post allocations to the debtor sub-ledger and
   generate journals for M15 (cash, debtors, contractual adjustments, VAT where applicable).
8. Unmatched lines and credits land in the DEB matching queue with ranked candidates.

### 9.2 Patient liability transfer

A short-payment that creates patient liability produces (or updates) a `patient_invoice` showing
the arithmetic (tariff × units, less scheme paid, less adjustments, equals owed) and the scheme's
reason; notifies the patient (WhatsApp or SMS, then email) with a payment link within consent and
hours, offering a plan above a configurable amount; starts ageing at the notification date, never the
service date; and, where a gap-cover policy is recorded, includes what the gap insurer needs and offers
to submit the gap pack on the patient's behalf (A1).

### 9.3 Unallocated cash and bank reconciliation

Bank feeds (API where the bank supports it, else scheduled statement import) are matched against
ERA totals, PSP settlements, referenced patient EFTs, corporate, RAF and COIDA payments. Unmatched
credits become `unallocated_cash` with suggested matches; after a configurable time they are treated
as suspense for M15 review. A daily reconciliation per bank account (opening, matched, unmatched,
closing) alerts PRM and the Close Hand (M15) on discrepancies.

### 9.4 Refunds

Refunds to patients (over-collection, scheme later paying in full) and to funders (over-payment) are
proposed automatically with evidence, approved by humans (two above a threshold), and paid only to a
verified payee (bank account-verification service where available, or the original card via the
PSP). Refund activity appears on the monthly controls report.

### 9.5 Requirements

* M14-R-140 Remittance lines MUST be matched with recorded confidence; unmatched items MUST be
  queued, never silently absorbed.
* M14-R-141 Short-payments MUST carry a taxonomy class and be routed by configurable policy.
* M14-R-142 Patient liability from a short-payment MUST be explained with the funder's reason and the
  arithmetic, and ageing MUST start at notification.
* M14-R-143 Refunds MUST require human approval and verified payee details; never auto-executed.
* M14-R-144 Every bank credit MUST reconcile to a remittance, settlement, invoice or suspense entry,
  with the daily reconciliation produced automatically.

## 10. Stage 6: Patient billing and point-of-service collection

### 10.1 The Collect card and POS happy path

The Collect card (BDL component on the M07 surface, M14 logic) shows FDK the scheme portion, patient
portion, reason (co-payment, benefit exhausted, not covered, cash, prior balance), payment methods
and any prior balance. It is fed by the quote (M06), the priced charge, the real-time adjudication
result where available and the debtor balance.

1. At check-in the card shows the expected patient portion from the quote.
2. After the study (or before, by policy for cash patients) the priced charge refreshes it.
3. FDK takes payment: card (PSP terminal or softPOS), PayShap (proxy-based instant payment), EFT with
   a unique reference, QR wallet, or cash (float and daily cash-up).
4. The Platform issues a receipt and, for full patient liability, a tax invoice, to the patient's
   channel (WhatsApp, SMS link, email, print).
5. If the patient cannot pay now: a payment link is sent and, above a configurable amount, a plan is
   offered on the spot; the study proceeds regardless.
6. `payment.received.v1`; allocation posted; the card shows "Paid".

Payment handling: card-not-present through the PSP's hosted page (PCI scope stays with the PSP;
tokenisation for plans only with consent); PayShap and EFT matched by reference on the bank feed;
QR wallets settled through the PSP; cash variances reported; debit orders for plans with an
authenticated mandate where required. Payment links are single-use and expiring.

### 10.2 Statements, plans and disputes

* **Statements** follow BDL §5.6: one line per service in plain language, the arithmetic, the
  funder's reason for any shortfall, payments received, balance, what happens next and how to
  dispute; available in the Patient Space and sent on a configurable cycle while a balance exists.
* **Payment plans** are offered by amount band and propensity score with configurable terms
  (illustrative: up to 6 instalments, no interest, first now). Where interest or fees apply to
  overdue accounts the policy respects the National Credit Act's incidental credit agreement rules
  (illustrative: interest only after the statutory unpaid period and at the permitted rate); CMP
  approves the policy. Missed instalments trigger a reminder and a re-plan offer before normal
  dunning resumes.
* **Disputes** can be raised from any statement line, the Patient Space or WhatsApp. A dispute pauses
  dunning on the disputed lines, opens a DEB case with claim, remittance and clinical evidence in one
  view, and carries an SLA (illustrative: 5 working days). Outcomes: upheld (credit note), partly
  upheld, not upheld (explanation sent), referred to funder (appeal).
* **Converting a scheme patient to cash** when the funder will not pay is only automatic where the
  quote and consent recorded the "if your scheme does not pay, you are responsible" acknowledgement;
  otherwise, for non-emergency studies, PRM makes a goodwill decision before any invoice is issued.

### 10.3 Requirements

* M14-R-150 The Collect card MUST show scheme portion, patient portion, reason, prior balance and
  payment methods, and MUST update from real-time adjudication where available.
* M14-R-151 Every invoice and statement MUST show the arithmetic per line and the funder's reason in
  plain, translatable language.
* M14-R-152 Payment links MUST be single-use, expiring and tied to the invoice; the Platform MUST
  never store card numbers.
* M14-R-153 A dispute MUST pause dunning on the disputed lines until resolved.
* M14-R-154 Urgent or emergency care MUST never be blocked by an outstanding balance.

## 11. Stage 7: Debtors and collections

### 11.1 Ageing and propensity

Debtor sub-ledgers by funder type (scheme, patient, RAF, COIDA, corporate, state) with buckets
current, 30, 60, 90, 120+ days from the ageing start per type (scheme: submission; patient:
notification; corporate: invoice; RAF: lodgement). A Class 3 propensity-to-pay model scores each
balance for payment within 30, 60 and 90 days and the best next action from amount, funder type,
payment history, channel responsiveness, dispute history and plan status. It never uses race,
language or location as a proxy; its feature list is published to CMP; it decides cadence and
channel, never whether care is provided.

### 11.2 The Collections Hand

**Mandate**: respectful, lawful, multi-channel dunning for patient and corporate balances within a
per-Practice policy; obtain missing information for RAF and COIDA claims; offer plans within policy;
escalate to DEB; propose handover. Never threaten, never misstate consequences, never contact outside
permitted hours, never discuss clinical content.

**Leash (illustrative defaults)**: at most 2 contacts per account per week; 08:00 to 20:00 SAST
weekdays and 09:00 to 13:00 Saturdays, none on Sundays or public holidays; channels in consent
order (WhatsApp, SMS, email, scripted voice call via the contact centre); maximum plan length and
minimum instalment; early-settlement discount cap (illustrative 10 % above R2 000); no contact where
there is an open dispute, deceased flag, minor without guardian rules, or withdrawn consent.

| Day from notification | Action | Channel |
|---|---|---|
| 0 | Statement with explanation and payment link | WhatsApp or SMS, email |
| 7 | Reminder, plan offered | WhatsApp or SMS |
| 21 | Reminder with call-back option | WhatsApp or SMS, then voice |
| 45 | Formal overdue notice in plain language; consequences stated only as policy permits | Email or letter, plus WhatsApp |
| 60 to 90 | DEB review: settlement offer, plan or handover proposal | DEB console |
| 90+ | Handover to a registered debt collector or attorney with PRM approval after the required notice; adverse credit listing only where lawful and after the required notice | External connector |

Every message states who is contacting, why, the amount, reference, how to pay, how to dispute and
how to opt out of a channel. POPIA: minimum information, no clinical detail, no third-party contact
except a recorded guarantor or guardian.

### 11.3 Handover, write-off, provisioning and credit control

* **Handover** is a last resort: proposal by the Hand or DEB, PRM approval, transfer through the
  connector under a recorded data-sharing agreement, tracking of collector remittances and
  commissions; balances below a configurable amount are never handed over.
* **Write-off policy**: reasons taxonomy (uncollectable, deceased without estate, prescribed,
  late-submission loss, goodwill, small balance, funder contractual); approval limits by role
  (illustrative: DEB to R500, PRM to R5 000, CFO above, board above a group threshold); small-balance
  batch with monthly report; every write-off links to a root cause (a late-submission loss is a process
  failure, not a debtor failure).
* **Bad-debt provisioning**: expected-credit-loss matrix by funder type and ageing bucket, calibrated
  from each Practice's recoveries, applied monthly and posted to M15; auditable.
* **Credit control on repeat patients**: a balance above threshold is flagged at booking; the Platform
  asks for settlement or a plan before a routine elective study and never blocks urgent or emergency
  care or any study a clinician marks as urgent; FDK override is one action with reason.

### 11.4 Requirements

* M14-R-160 Dunning MUST be governed by a per-Practice policy (hours, channels, frequency, templates,
  escalation) enforced by the M20 leash, not by prompts.
* M14-R-161 The Collections Hand MUST NOT contact an account with an open dispute, deceased flag or
  withdrawn consent, and MUST NOT include clinical content in any message.
* M14-R-162 Handover MUST require PRM approval, a registered collector, a recorded data-sharing basis
  and the policy's notice period.
* M14-R-163 Write-offs MUST carry a reason, an approver within limit and a root-cause link, reported
  monthly to EXE and CMP.
* M14-R-164 Credit-control flags MUST NOT block urgent or emergency care.
* M14-R-165 The Platform MUST track prescription dates and stop dunning prescribed debt unless policy
  and law allow otherwise.

## 12. Month-end close (M14 side)

M15 owns the close; the Close Hand (M15) calls M14's checklist, which produces:

1. **Unbilled register**: completed but not charged, charged but not priced, priced but not claimed,
   with age, value, blocking reason (awaiting report, coding, auth, claim number) and owner. Target:
   zero items older than 7 days; every item older than 30 days has an owner.
2. **Claims-in-flight**: submitted, not adjudicated, by funder and age, with expected value for
   accrual.
3. **Revenue recognition**: revenue on the service date at the expected transaction price (expected
   funder plus expected patient payment, net of expected contractual adjustments), consistent with
   IFRS 15 as configured by Group policy; variable consideration estimated from short-payment history
   per funder and trued up on remittance. M14 produces the journals; M15 posts them.
4. **Accruals**: unbilled services at expected price; contrast and consumable cost from M18.
5. **Reading-fee statements**: per RGT and per Hub from signed reports in the period, priced by the
   reading-fee schedule (per study, RVU-equivalent, or percentage of collected professional fee, per
   the M02 agreement), adjusted for addenda and peer-review corrections; approved by PRM; exported to
   payroll or intercompany (M15).
6. **Management-fee inputs**: collections and net revenue per Practice for M15's intercompany rules.
7. **Period lock**: after M15 closes, M14 transactions dated in the period are locked; corrections
   post to the open period with a back-reference.

* M14-R-170 The unbilled register MUST be a live view with blocking reason and owner per item.
* M14-R-171 Revenue journals MUST be reproducible from charge, claim, remittance and allocation data
  and MUST reconcile to the debtor sub-ledgers.
* M14-R-172 Reading-fee statements MUST be computed from signed-report events and the effective-dated
  schedule, showing every study line to the radiologist.

## 13. Controls and fraud

### 13.1 Segregation of duties

| Duty | May not be combined with |
|---|---|
| Coding acceptance | Write-off approval, refund approval |
| Human claim submission | Cash allocation |
| Cash allocation | Refund approval, payee bank detail maintenance |
| Refund approval | Refund creation, payee detail change |
| Fee schedule maintenance | Claim submission |
| Write-off approval | Collections ownership of the same account |

Enforced by M01 RBAC conflict rules; small sites may hold a CMP-approved exception with a
compensating monthly review.

### 13.2 Audit trail and unusual-pattern detection

Every charge, claim, response, allocation, write-off, refund, override and rule change is
append-only with actor (human or Hand run id), timestamp, before and after, and reason; any report
can be regenerated for any date.

A daily Class 3 monitor (alerts only) scores Practices, sites, providers and coders and raises cases
to CMP for: **up-coding** (code-mix shift versus history or peers, for example more contrast-enhanced
codes without matching NAPPI lines or nursing records); **unbundling** (components billed where a
package or combined code applies); **phantom billing** (charges without DICOM images, MPPS or a
signed report; acquisition times outside modality uptime; expired-licence modalities); duplicates
across sites; modifier over-use (after-hours on in-hours MPPS times); referrer concentration
anomalies; write-off and credit-note concentration by user. Because the Platform holds images, dose
reports, MPPS and signed reports, the phantom-billing check is a join, not an investigation.

### 13.3 Funder audit packs and payee controls

On a funder audit request the Platform assembles per claim: referral, authorisation, registration and
consent, MPPS timestamps, DICOM study summary (series and image counts; images only where consent
and lawful basis cover them), dose report, signed report with signature time, contrast record, claim
and remittance history. CMP reviews and releases through the funder portal with a lawful-basis record
and a log of what was shared. Refunds and collector commissions go only to verified payees; payee
detail changes need a second approver and a cooling-off period (illustrative 24 hours); payment files
are hashed and verified at release.

### 13.4 Requirements

* M14-R-180 Segregation-of-duties conflicts MUST be enforced by M01 and reported monthly.
* M14-R-181 The unusual-pattern monitor MUST run at least daily, alert CMP and never change a claim.
* M14-R-182 Funder audit packs MUST be assembled from Platform evidence with a release log and
  lawful-basis record.
* M14-R-183 Payee detail changes MUST require dual approval and a cooling-off period before use in a
  payment file.

## 14. KPIs

| KPI | Definition | Illustrative target | Owner |
|---|---|---|---|
| First-pass acceptance rate | Lines accepted without rejection or short-payment on first submission ÷ lines submitted | ≥ 97 % scheme lines | BIL |
| Days-to-bill | Service date to submission, median and P90 | Median ≤ 1 day; P90 ≤ 3 days | BIL |
| Unbilled backlog | Value and count not yet claimed, by age | Zero items > 7 days | BIL / PRM |
| Rejection rate by reason | Rejected lines ÷ submitted, by class | ≤ 3 % total; coding ≤ 0.5 % | BIL / AIO |
| Auto-code rate | Lines coded at A3 without human touch | ≥ 80 % scheme lines | AIO |
| Coding audit major-change rate | Sampled A3 lines with major change ÷ sampled | ≤ 1 % | AIO |
| Net collection rate | Cash collected ÷ (expected price − contractual adjustments), trailing 12 months | ≥ 97 % | DEB |
| DSO | Debtors ÷ average daily revenue, by funder type | Scheme ≤ 35 days; patient ≤ 45 days | DEB |
| Patient collection at point of service | Collected at desk ÷ patient portion known at desk | ≥ 85 % | FDK |
| Cost-to-collect | Billing and collections cost ÷ cash collected | ≤ 3 % | EXE |
| Write-off rate | Write-offs ÷ billed, by reason | ≤ 1 %; late-submission loss 0 | DEB / PRM |
| Remittance auto-match rate | Lines matched without human touch | ≥ 95 % | DEB |
| Dispute resolution time | Open to close | ≤ 5 working days | DEB |
| Complaints per 1 000 collections contacts | From M19, linked to dunning | Ceiling set by CMP | CMP |

KPIs are defined once in the `analytics` semantic layer and benchmarked across Practices in M16.

## 15. Automation map

| Step | Level | What the Hand or engine does | Exception path |
|---|---|---|---|
| Provisional charge from order | A4 | Deterministic mapping | Corrected at completion |
| Charge from MPPS / completion | A4 | Mapping with modifiers from timestamps | No MPPS: technologist completion (A1) |
| Contrast and consumable lines | A4 | From barcode scans and nursing record | Discrepancy: RAD or NUR confirms |
| Report reconciliation | A3 | Coding Hand compares report to charge, amends within rules | Delta above limit: BIL |
| ICD-10 and tariff coding | A3 clean / A1 rest | Coding Hand proposes; domain gate auto-accepts; sampled audit | Below threshold, exclusions, suspension: BIL queue |
| Pricing, VAT, packages | A4 | Rule engine | Missing line: BIL task; override: A0 |
| Duplicate check and scrub | A4 | Rule engine with `fix` actions | Near-duplicate, `error`: BIL |
| Rejection prediction routing | A3 | Model routes high-risk claims | High risk: BIL review |
| Scheme submission | A3 | Claims Hand batches, submits, acknowledges, retries | Above leash, RAF/COIDA/corporate: A1 |
| Real-time claim | A3 | Immediate submission; Collect card update | Timeout: batch fallback |
| Overdue-response enquiry | A3 | Claims Hand queries funder | No answer after N enquiries: BIL |
| Rejection auto-fix | A3 | Deterministic classes corrected and resubmitted | Coding, benefit, duplicate, late: BIL |
| PMB appeal | A2 | Evidence pack sent; sample reviewed | Complex clinical argument: RGT |
| Reversal and correcting claim | A2 | From charge version change | Above leash: BIL |
| Rule-pack learning | A1 | Claims Hand drafts rules from rejection patterns | BIL accepts; CMP activates |
| ERA ingestion and matching | A3 | Remittance Hand parses, matches, posts | Unmatched: DEB |
| Short-payment routing | A3 | Policy engine | `unknown`: DEB |
| Patient liability notification | A3 | Statement, link and plan within consent and hours | Goodwill cases: PRM |
| Bank reconciliation | A3 | Feed match and daily report | Unmatched credits: DEB |
| POS collection | A1 | Collect card computes; FDK takes payment | Cannot pay: link and plan |
| Payment plan offer | A3 | Policy engine within terms | Outside terms: DEB |
| Dunning | A3 | Collections Hand within leash | Disputes, vulnerable flags, 60+ days: DEB |
| Dispute handling | A1 | Case assembled with evidence; DEB decides | Clinical dispute: RGT |
| Handover to collector | A0 | Proposal generated; PRM approves | None |
| Write-off | A0 approval; A3 small-balance batch | Batch proposal within limit | Above limit: approval chain |
| Refund | A0 | Proposal with evidence; dual approval | None |
| Provisioning | A3 | ECL matrix monthly | Calibration change: CFO |
| Unbilled register and accruals | A4 | Live view, month-end snapshot | Items > 30 days: owner assigned |
| Reading-fee statements | A3 | From signed reports | RGT dispute: PRM |
| Unusual-pattern monitoring | A3 alerts | Daily scoring | All alerts: CMP |
| Funder audit pack | A1 | Assembled automatically; CMP releases | None |

## 16. Data model (M14)

All tables carry `practice_id`, `created_at`, `created_by` (user or Hand run id); financial tables are
append-only or versioned.

| Table | Key fields |
|---|---|
| `funder` | id, type (scheme, administrator, raf, coida, mutual_assurer, odmwa, corporate, state, cash), name, channels, ERA formats |
| `funder_plan` | funder, plan / option code, effective dates, PMB rules reference |
| `funder_contract` | practice, funder, plan, fee_schedule, dsp_status, balance_billing_policy, channel, claim_format, rule_pack, deadline days (submission, adjudication, resubmission), effective dates, agreement (M02) |
| `funder_rate_file` | funder, version, effective dates, source; lines: tariff code, rate, unit |
| `tariff_code` | code, kind, descriptions, modality, body_region, contrast_flag, laterality_rule, component, units_rule, vat_treatment, effective dates |
| `procedure_tariff_map` | procedure (M04 catalogue), funder or default, tariff codes and quantities, modifier rule, effective dates |
| `modifier_rule` | code, applies_to, price_effect, stacking, evidence_required |
| `session_rule_pack` / `scheme_rule_pack` | funder, version, effective dates, declarative rules (condition, action, severity, message, source), activation approver |
| `fee_schedule` / `fee_schedule_line` | practice, kind, default_basis, approval; tariff code, price_excl_vat, unit, component, dates |
| `package` | practice, mandatory and optional codes, price, partial rules |
| `charge` | episode, order, study, patient, site, room, modality, service_date, session_id, funder_context, status (provisional, performed, awaiting_report, ready_to_price, priced, claimed, voided), version, bill_on |
| `charge_line` | charge, tariff code, kind, quantity, modifiers, component, price_excl_vat, vat, price_source, expected_funder, expected_patient, evidence refs (MPPS, nursing record, stock movement) |
| `charge_version` | charge, version, reason, diff, actor |
| `coding_suggestion` | charge, code_type, code, confidence, evidence_spans, model_id, model_version, rule_pack_version, status, accepted_by, accepted_at, audit_outcome |
| `claim` | charge, type, funder_contract, status, claim_reference, original_reference, deadlines, pmb_candidate, rejection_prediction, amounts, external refs (RAF no., COIDA no., PO no.) |
| `claim_line` | claim, charge_line, tariff code, icd10 codes, quantity, amount, status (submitted, accepted, paid, short_paid, rejected, pended, reversed), funder reason codes, taxonomy class |
| `claim_scrub_result` | claim, rule id, severity, message, fixed, rule_pack_version |
| `claim_submission` / `claim_response` | channel, adapter, timestamps, raw payload refs, switch reference, technical ack; parsed outcome |
| `claim_appeal` | claim, type, evidence pack, funder reference, outcome, deadline |
| `remittance` / `remittance_line` | funder, received_at, raw ref, total, payment reference, bank match; claim_line, amount_paid, reason codes, taxonomy class, match_confidence, routing |
| `patient_invoice` / `statement` | patient, episode, charges, SARS-compliant number, amounts, VAT, status, ageing_start; period, lines, balance, delivered_via |
| `payment` / `allocation` / `payment_link` / `payment_plan` | payer type, method, amount, references, status (pending, settled, reversed, charged_back); target and amount; token and expiry; instalments and mandate |
| `dispute` | invoice lines, raised_by, channel, reason, status, outcome, SLA timestamps |
| `collections_case` / `dunning_action` | account, propensity score, stage, next action, handover details; channel, template version, sent_at, delivery, response |
| `write_off` / `credit_note` / `refund` | target, reason, amount, root_cause, approvers, period; number and invoice; verified payee, evidence, payment file ref |
| `provision` | period, portfolio, bucket, rate, amount |
| `reading_fee_statement` | radiologist or hub, period, lines, status |
| `gl_journal_export` | period, journal lines (account, debit, credit, dimensions), source refs, status (M15 interface) |

Views: `unbilled_register`, `claims_in_flight`, `debtors_ageing`, `daily_bank_reconciliation`.

## 17. Events emitted (versioned, M21 outbox)

| Event family | Events |
|---|---|
| Charge | `charge.captured.v1`, `charge.priced.v1`, `charge.amended.v1`, `charge.voided.v1` |
| Coding | `coding.proposed.v1`, `coding.accepted.v1`, `coding.rejected.v1`, `coding.autoaccept.suspended.v1` |
| Claim | `claim.assembled.v1`, `claim.scrubbed.v1`, `claim.submitted.v1`, `claim.acknowledged.v1`, `claim.response.received.v1`, `claim.rejected.v1`, `claim.short_paid.v1`, `claim.pended.v1`, `claim.paid.v1`, `claim.resubmitted.v1`, `claim.reversed.v1`, `claim.appealed.v1`, `claim.appeal.resolved.v1`, `claim.deadline.approaching.v1`, `claim.expired.v1` |
| Remittance | `remittance.received.v1`, `remittance.matched.v1`, `remittance.unmatched.v1`, `remittance.banked.v1` |
| Patient billing | `patient.liability.created.v1`, `invoice.issued.v1`, `statement.issued.v1`, `payment.link.created.v1`, `payment.received.v1`, `payment.reversed.v1`, `payment.chargeback.v1`, `payment.plan.created.v1`, `payment.plan.missed.v1`, `dispute.opened.v1`, `dispute.resolved.v1` |
| Collections | `collections.action.sent.v1`, `collections.escalated.v1`, `collections.handover.proposed.v1`, `collections.handover.approved.v1` |
| Adjustments | `writeoff.proposed.v1`, `writeoff.approved.v1`, `creditnote.issued.v1`, `refund.proposed.v1`, `refund.approved.v1`, `refund.paid.v1` |
| Banking and close | `bank.credit.unmatched.v1`, `bank.reconciliation.completed.v1`, `billing.period.checklist.completed.v1`, `readingfee.statement.issued.v1`, `gl.journal.exported.v1` |
| Controls | `billing.anomaly.detected.v1`, `funder.audit.requested.v1`, `funder.audit.pack.released.v1` |

Consumers: M15 (journals, fees), M16 (KPIs), M13 (patient notifications), M06 (retro-auth), M19
(complaints, anomalies), M20 (Hand tasks), M11 (model monitoring).
