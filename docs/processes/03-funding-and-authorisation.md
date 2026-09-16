# 03 — Funding and Authorisation (M06 Funding & Authorisation)

## 1. Purpose

Establish, before the patient arrives, who will pay for each Order, how much, and under what
conditions, and secure every authorisation the payer requires so that the study can be performed
and billed without surprise to the patient, the referrer or the Practice. M06 owns the **funding
status** of an Order from `Validated` until the study is handed to M14 Revenue Cycle for claiming.

"Better than the market" means: a binding quote with the scheme's benefit position before the
appointment; pre-authorisations obtained by the **Authorisation Hand** without a human on hold;
the Collect card at the front desk showing exactly what to collect and why; and no patient
receiving a bill months later for a shortfall nobody mentioned.

## 2. Trigger

* An Order reaches `Validated` in M04 (funding check starts in parallel with scheduling).
* A protocol change by RGT alters the billable procedures (M04 §7.4).
* An appointment is booked, rescheduled beyond an authorisation window, or moved to a Site in a
  different network position (M05).
* A patient's scheme, plan or membership status changes (M03).
* A funder responds (authorisation granted, declined, more information required).
* A cash patient asks for a quote in Patient Space or WhatsApp.
* A corporate, RAF, COIDA or state contract order is created.
* A funder contract (fee schedule, network terms) is updated or an annual escalation falls due.

## 3. Actors

| Persona | Role |
|---|---|
| PAT | Provides scheme details, accepts quotes, pays deposits, chooses payment plans |
| REF | Supplies clinical motivation when a funder requests it |
| BKG | Handles funding exceptions before the appointment |
| FDK | Acts on the Collect card at check-in; captures scheme cards and documents |
| BIL | Owns coding of the quote where scheme rules demand it; resolves complex benefit cases |
| DEB | Follows up shortfalls and deposits (M14 dunning) |
| PRM | Sets Site-level cash policy within Group guardrails |
| EXE | Approves funder contracts, discount policy, rate uplifts, escalations |
| PAY | Medical schemes and administrators, RAF, Compensation Fund, corporates, state, insurers |
| CMP | POPIA basis for sharing clinical motivation with funders; audit of overrides |
| Authorisation Hand | The M20 Hand that checks eligibility, requests and chases authorisations and records outcomes |

## 4. Preconditions

* Funder master loaded: schemes, plans, administrators, claims switch routing, contact channels,
  authorisation rules per procedure, DSP network membership per Site, tariff and fee schedules
  with effective dates (§7.9).
* M14 tariff engine and scheme rule packs available for pricing (packages/billing-rules).
* Claims switch connection with membership validation and, where the funder supports it,
  real-time benefit or claim response.
* The Order carries the procedure list with suggested tariff codes and ICD-10 (M04).
* Patient scheme membership captured (M03) or funder type set to cash, RAF, COIDA, corporate,
  state or foreign.
* Practice-level cash pricing, discount and deposit policy configured within Group guardrails.

## 5. Happy path (scheme member, MRI requiring pre-authorisation)

1. `order.validated` arrives with a scheme membership on file. The Platform identifies the scheme,
   plan and administrator, the Practice's network status with that scheme at candidate Sites, and
   the authorisation rule for the procedure ("MRI: pre-authorisation required; valid 30 days;
   motivation required for repeat within 6 months", illustrative and configured per scheme).
2. **Eligibility**: the Authorisation Hand sends a membership validation through the claims switch
   (or the funder API). Response: member active, dependant code, plan, benefit option, any waiting
   periods or exclusions the funder discloses. Where the funder offers a benefit enquiry, available
   radiology benefit and savings balance are retrieved.
3. **Quote engine** prices the Order: tariff codes from the catalogue mapping, units, modifiers,
   contrast and consumables, at the funder's contracted rate for this Practice (rate uplift
   applied), VAT at 15 %, expected scheme portion, expected patient portion (co-payment,
   non-network penalty, benefit exhaustion, savings-account usage) and the quote validity date.
4. **Pre-authorisation request**: the Hand assembles the funder's required data set (member and
   dependant, referring practitioner practice number and HPCSA number, ICD-10, tariff codes,
   Site practice number, clinical motivation extracted from the referral, planned date) and submits
   through the funder's preferred channel: API where available, portal automation, structured
   email, or a phone task for BKG when the funder only takes calls.
5. The funder responds with an authorisation number, approved codes, validity dates and any
   conditions (for example "approved without contrast" or "approved at DSP only"). The Hand
   records it, reconciles approved codes against the quote, updates the patient portion and moves
   funding status to `Authorised`.
6. PAT receives the quote in plain language: "Your scheme has approved this MRI (auth 12345678).
   Scheme pays R X. You pay R Y on the day because your plan has a R Y co-payment for MRI. Valid
   until 14 October." The quote is in Patient Space and on the appointment confirmation (M05).
7. At check-in (M07) the Collect card shows the patient portion and its reason; FDK collects, or
   PAT paid in advance through a payment link. After acquisition, M14 claims with the
   authorisation number attached.

Target: eligibility and quote within 60 seconds of `order.validated`; authorisation median under
4 working hours where the funder supports API or portal, under 1 working day otherwise.

## 6. Variants and exceptions

### 6.1 Funder types

| Funder type | How it works in South Africa | Platform behaviour |
|---|---|---|
| Medical scheme (via administrator) | Schemes registered with the Council for Medical Schemes; many administered by a third-party administrator; claims via a claims switch; ICD-10 mandatory; DSP networks; PMBs | Full flow in §5; scheme rule pack per administrator; DSP status per Site |
| Scheme "assist" or member app flows | Some schemes let members or providers request authorisation in the scheme's app or portal | The Hand uses the portal automation adapter; where the member must initiate, the Platform sends PAT a guided message and tracks completion |
| Gap cover (short-term insurer) | Covers tariff shortfalls and some co-payments after the scheme has paid; claimed by the member | Quote shows the expected shortfall and flags "may be claimable from gap cover"; M14 produces the gap-cover claim pack for the patient |
| Cash / private paying | No funder; the patient pays | Cash tariff, quote, deposit and discount policy (§6.4) |
| RAF | Road Accident Fund liable for medical expenses of road accident victims; claims typically handled by attorneys; undertakings for future medical expenses | §6.5 |
| COIDA / Compensation Fund and licensed mutual associations | Injury on duty; employer reports the accident; the Fund or a licensed mutual (mining, construction) pays at its own tariff | §6.6 |
| Corporate / occupational health contract | Employer or occupational health provider pays under a contract with bulk rates | §6.7 |
| State / NHI contract | Provincial departments outsource imaging under service level agreements; NHI Act contracting is planned but not operational | §6.8 |
| Foreign patient / travel insurance | Non-resident; travel insurer or assistance company issues a guarantee of payment; otherwise cash | §6.9 |
| Medico-legal instructing party | Attorney or examiner pays per instruction | Invoice to the instructing party; no scheme claim |

### 6.2 Pre-authorisation rules

* Rules are configurable per scheme, plan and procedure family. A typical (illustrative) default
  pack: MRI, CT, PET-CT, nuclear medicine and interventional procedures require pre-authorisation;
  general radiography, ultrasound and mammography usually do not; some plans require
  authorisation for any radiology above a rand threshold or for out-of-network Sites.
* Each rule specifies: required data, channel, expected turnaround, validity window, whether
  contrast must be authorised separately, whether a repeat needs motivation, and what to do when
  the funder is unreachable (proceed at risk with patient acknowledgement, or hold).
* Emergency studies proceed without pre-authorisation; the Hand requests retrospective
  authorisation within the funder's window (often 24 to 72 hours, configurable).

### 6.3 PMB conditions, benefit exhaustion and savings

* **PMB**: where the ICD-10 and clinical picture match a Prescribed Minimum Benefit condition
  (including emergency medical conditions), the scheme is obliged to fund the diagnosis and
  treatment in full at a DSP. The Platform flags PMB candidates from the ICD-10 and procedure, shows
  the DSP position, and records the PMB claim indicator for M14. It never asserts PMB status to
  the patient as certain; it says "likely covered as a PMB if your scheme agrees" until the
  funder confirms.
* **Benefit exhaustion**: when the radiology benefit or day-to-day limit is exhausted, the quote
  moves the amount to the patient portion (or the savings account where the plan allows), the
  reason is stated on the Collect card, and the patient is offered a payment plan.
* **Medical savings account**: usage is shown as "paid from your savings account" so the patient
  understands why their savings balance drops.
* **Co-payments and network penalties**: plan co-payments (fixed or percentage) for specific
  procedures and penalties for non-DSP Sites are applied from the rule pack and explained; the
  multi-site search in M05 shows the co-payment difference between Sites.

### 6.4 Cash and private paying patients

* Quote from the Practice's cash tariff with itemised codes and VAT. Validity (default 30 days).
* **Deposit policy** (PRM within Group guardrails): for example full payment upfront for
  self-referred ultrasound; 50 % deposit for MRI; none for X-ray. Deposits are taken by payment
  link (card, PayShap, EFT reference, QR) and reconciled in M14.
* **Discount policy**: rule-based (pensioner, student, hardship, prompt payment, bundled
  procedures) with approval thresholds; any discount outside the rules needs PRM approval and is
  audited. The Hand may apply rule-based discounts; it may not negotiate.
* Refunds for cancellations follow the policy attached to the quote and are visible to the patient
  before they pay.

### 6.5 RAF orders

* The Order records accident date, RAF claim reference (if lodged), the attorney or claims
  handler, and whether a section 17(4)(a) undertaking exists (treated as illustrative; the
  document type is configurable).
* Funding paths: (a) undertaking on file: services rendered on account of the Fund per the
  undertaking terms; (b) attorney's letter of guarantee: invoice to the attorney's trust account
  on settlement; (c) no guarantee: the patient is cash pending, with the Practice's RAF policy
  deciding whether to proceed at risk. The path is shown to the patient before the appointment.
* RAF tariffs and documentary requirements are configurable reference data. Prescription and
  lodgement deadlines are tracked on the Order for DEB.

### 6.6 COIDA and Compensation Fund orders

* Required: employer details, date and description of injury, the employer's accident report and
  the first medical report references (form names such as W.Cl.2 and W.Cl.4 are illustrative
  document types), and the claim number once issued. Where the employer is insured with a
  licensed mutual association (common in mining and construction), the Platform routes to that
  insurer's rules instead of the Fund's.
* Until the employer confirms the injury on duty, funding status is `IOD unconfirmed`; the
  Practice policy decides whether to treat the patient as cash pending or proceed at risk. The
  Authorisation Hand chases the employer for confirmation and documents.
* Claims are submitted at the Fund's tariff through its online system or the switch where
  supported; the Order carries the claim number for M14.

### 6.7 Corporate and occupational contracts

* Contract objects: employer or provider, covered examinations, bulk rates, invoicing cadence,
  purchase-order requirements, cost-centre capture, authorised requesters, and reporting outputs
  (for example ODMWA batch reports, M04 §6.10).
* Each Order under a contract is priced from the contract, needs no scheme authorisation, and
  accumulates into a periodic invoice with a per-worker schedule. Over-usage or out-of-scope
  procedures route to BKG and the contract owner.

### 6.8 State and NHI contracts

* Provincial or facility-level service level agreements (outsourced CT or MRI capacity, mobile
  X-ray at clinics) are modelled like corporate contracts with the state's referral, approval and
  reporting formats attached.
* The NHI Act 2024 provides for future contracting units and benefit definitions; the Platform
  models an `nhi` funder type as a placeholder with no rules active, so that contracting can be
  configured when regulations and tariffs are published, without a schema change.

### 6.9 Foreign patients and travel insurance

* Passport identity (M03), residence status, and either a guarantee of payment from the insurer
  or assistance company (verified by call-back or email domain rules) or cash upfront. Quotes are
  in ZAR with an optional indicative foreign-currency figure marked "indicative". Invoices carry
  the details insurers require (diagnosis, procedure, itemised charges, VAT).

### 6.10 Funder unreachable or slow

The Hand escalates after the funder's expected turnaround: a reminder through the same channel,
then an alternative channel, then a BKG phone task. If the appointment is within 24 hours and the
authorisation is outstanding, the patient is told the options (proceed at own risk with a signed
acknowledgement of possible liability, move the appointment, or wait) and the decision is
recorded. Proceeding at risk requires the patient's explicit acknowledgement, never a default.

### 6.11 Authorisation declined or partially approved

The Hand records the reason, checks whether the funder's motivation route is open, requests
additional motivation from REF (one-tap in Referrer Space) and resubmits once; a second decline
goes to BIL and REF with the alternatives (different procedure, cash quote, appeal). Partial
approvals (for example without contrast) go to RGT for a protocol decision before the appointment.

### 6.12 Quote changes after protocolling or on the day

If RGT changes the protocol (adds contrast, changes modality) or RAD performs additional views on
the radiologist's instruction, the quote is re-run. Increases above a configurable tolerance
(default 10 % or R200, whichever is greater) require the patient's fresh acceptance before
acquisition where practical, or before billing where not; the Platform never bills an amount the
patient has not seen without an explained reason.

### 6.13 Membership changes and dependant rules

A membership that lapses between quote and appointment invalidates the authorisation; the Platform
re-validates eligibility at T-24 h and again at check-in, and the Collect card reflects the
current position. Dependant, child and student-dependant rules come from the rule pack.

## 7. Detailed design

### 7.1 Funding status lifecycle (attached to the Order)

| Status | Meaning |
|---|---|
| `Unknown` | No funder information yet |
| `Checking` | Eligibility and rules being evaluated |
| `Quoted` | Quote issued; no authorisation needed or not yet requested |
| `Auth requested` | Pre-authorisation submitted; SLA timer running |
| `Auth more info` | Funder needs motivation or documents |
| `Authorised` | Authorisation received; validity window recorded |
| `Auth declined` | Declined; alternatives in progress |
| `Proceed at risk` | Patient acknowledged liability pending funder decision |
| `Deposit due` | Cash or partial-cash path; deposit outstanding |
| `Ready to bill` | Funding position final at acquisition; handed to M14 |
| `IOD unconfirmed` / `RAF pending` / `GOP pending` | Third-party confirmations outstanding |
| `Expired` | Authorisation or quote validity lapsed; re-run required |
| `Contract` | Priced under a corporate, state or medico-legal contract; no patient portion |

Each transition emits `funding.<status>.v1` with actor, funder response identifiers and amounts.

### 7.2 Quote engine

* Inputs: procedures with suggested tariff codes and modifiers, funder and plan, Site (network
  position), contract or cash tariff, authorisation outcome, benefit and savings position where
  known, patient category flags.
* Output: an itemised, versioned **Quote**: lines (tariff code, plain-language description, units,
  unit price, line total), consumables and contrast, VAT at 15 % shown separately, total, expected
  funder portion, expected patient portion with reason codes (co-payment, non-network,
  exhausted, not covered, cash), validity date, assumptions ("assumes your scheme authorises
  contrast"), and the quote's binding scope.
* **Binding**: within its validity and assumptions, the Practice honours the patient portion on
  the quote even if the funder later pays less than expected, unless the patient's own information
  was wrong (membership lapsed, wrong plan) or the procedure changed with fresh acceptance
  (§6.12). This is the "no surprise" guarantee; the resulting variance is tracked (§10) and funds
  the accuracy work.
* Every amount follows the Money-explained pattern (06 §5.6): tariff × units − scheme pays = you
  pay.
* Quotes are stored with the rule-pack version and fee-schedule version used, so they can be
  reproduced exactly during a dispute.

### 7.3 Eligibility and benefit checks

* Channels: claims switch membership validation (most schemes), funder API where the administrator
  offers one, portal automation, or phone task. The response is normalised to a
  `FundingEligibility` record with source, timestamp and raw payload (M21 immutable store).
* Real-time claim response: where the funder adjudicates in real time, M06 may submit a
  pre-adjudication enquiry to obtain the exact scheme portion before the appointment; M14 does
  the actual claim after the study.
* Re-validation points: at quote, T-24 h, check-in (M07), and before claim (M14).

### 7.4 The Authorisation Hand (M20)

| Element | Definition |
|---|---|
| Mandate | Check eligibility; evaluate authorisation rules; assemble and submit authorisation requests; chase funders; request motivation from REF; record outcomes; keep the quote current; chase employers (COIDA), attorneys (RAF) and insurers (GOP) for confirmations; explain the funding position to PAT in plain language. |
| Tools | `funder.validate_membership`, `funder.benefit_enquiry`, `funder.auth_submit` (API, portal automation, structured email), `funder.auth_status`, `quote.compute`, `order.read`, `referral.read_motivation`, `message.send` (PAT, REF, employer, attorney), `phone.task_create` (BKG), `document.request` |
| Leash | Submits only data the funder requires under a recorded POPIA basis (patient consent to share clinical motivation with their funder, or the scheme rules' processing basis); never alters ICD-10 or tariff codes to obtain approval; may resubmit once with additional motivation; may not accept "proceed at risk" on the patient's behalf; may apply only rule-based discounts; cannot promise funder outcomes; maximum three contact attempts per party per day; budget per Order. |
| Automation level | A3 for schemes with API or portal and for eligibility checks; A2 for declines and partial approvals (BIL reviews the queue); A1 for phone-only funders (BKG makes the call with the Hand's prepared script and records the outcome). |
| Provenance | Every submission stores the payload, channel, timestamp, funder reference and response; every quote change records the trigger. Portal automation sessions are recorded as screenshots or DOM snapshots for audit. |
| Escalation | SLA breach, second decline, funder data mismatch, suspected membership fraud, and any request for information the Hand may not share go to BIL or CMP. |

### 7.5 Exception queues

| Queue | Owner | Content |
|---|---|---|
| Funding exceptions (pre-appointment) | BKG | Membership invalid, funder unreachable, more-info requests unanswered, patient not responding to quote |
| Authorisation review | BIL | Declines, partial approvals, code mismatches between authorisation and quote |
| Cash and deposits | FDK / DEB | Deposits outstanding within 24 h of appointment, discount requests outside rules |
| Third-party confirmations | BKG | IOD unconfirmed, RAF guarantees, GOP pending, corporate PO missing |
| Contract governance | EXE / PRM | Fee schedule updates due, escalation dates, DSP terms expiring |

Every queue has SLA timers rendered per 06 §5.2, and every item shows the next action the Hand
already attempted.

### 7.6 The Collect card handoff

M06 publishes the current funding position to the Collect card (06 §5.3) for M07: scheme
portion, patient portion, reason codes, deposits already paid, outstanding balances from previous
visits (from M14), accepted payment methods and the quote version. FDK does not compute anything.

### 7.7 Data produced

FundingEligibility records, Quote versions, AuthorisationRequest and AuthorisationResponse
records with raw payloads, funding status transitions, patient acknowledgements (proceed at risk,
quote acceptance) with signature or OTP evidence, deposit and payment records (with M14),
third-party confirmations, contract usage records, Hand audit stream, and the events in §7.1.

### 7.8 Funder master and rule packs

Per funder: legal entity, administrator, switch routing, contact channels per purpose
(authorisation, queries, claims, escalation), authorisation rules, network definitions, PMB
handling notes, claim formatting requirements, turnaround expectations, portal credentials (in the
secrets store, M21, never in prompts), and a change log. Rule packs are data (packages/billing-rules),
versioned and effective-dated, editable by BIL leads with EXE approval for anything that changes
pricing.

### 7.9 Funder contract management

* **Contract**: funder, Practice(s) and Sites covered, fee schedule (base tariff reference, rate
  uplift % or negotiated rates per code family), DSP or network terms (exclusivity, volume
  commitments, patient co-payment rules), effective dates, annual escalation (date, index or
  negotiated %), notice periods, and documents.
* **Escalations per year**: the Platform diarises escalation dates, computes the new schedule when
  the % is known, and routes the updated fee schedule for EXE approval before it becomes effective
  in the quote engine and M14.
* **Impact analysis**: before accepting a contract change, EXE sees modelled revenue impact from
  M16 using the last 12 months of volumes.
* **Compliance**: DSP terms that require specific patient communication (for example "no
  co-payment at DSP for PMB") are encoded as quote rules so they are honoured automatically.

## 8. Automation level summary

| Step | Level |
|---|---|
| Eligibility validation | A3 (switch or API); A1 phone |
| Rule evaluation and quote computation | A4 (deterministic engine) |
| Authorisation submission and chasing | A3 API/portal; A1 phone |
| Decline and partial approval handling | A2 |
| Patient quote communication and acceptance | A3 |
| Proceed-at-risk decisions | A0 (patient decision, recorded) |
| Rule-based discounts and deposits | A3; out-of-rule discounts A0 with PRM approval |
| Third-party confirmations (RAF, COIDA, GOP) | A3 chasing, A2 outcomes |
| Contract escalations and fee schedule updates | A1 (EXE approves) |

## 9. Requirements

* M06-R-100 The Platform MUST model the funder types in §6.1 and MUST allow new funder types to
  be added as configuration without a schema change.
* M06-R-101 Pre-authorisation rules MUST be configurable per scheme, plan and procedure family,
  versioned and effective-dated, with the defaults treated as illustrative.
* M06-R-102 Eligibility MUST be validated at quote, at T-24 h, at check-in and before claim, with
  the raw funder response stored immutably.
* M06-R-103 The Quote engine MUST produce an itemised, versioned quote with VAT at 15 % shown
  separately, patient-portion reason codes, validity and assumptions, and MUST store the rule-pack
  and fee-schedule versions used.
* M06-R-104 A quote MUST be binding on the patient portion within its validity and assumptions,
  and any increase beyond the configured tolerance MUST require fresh patient acceptance.
* M06-R-105 The Platform MUST NOT bill a patient an amount that has not been shown to them with
  an explained reason.
* M06-R-106 The Authorisation Hand MUST operate under the leash in §7.4, MUST NOT alter clinical
  codes to obtain approval, and MUST store every submission and response with channel and
  timestamp.
* M06-R-107 Clinical motivation MUST only be shared with a funder under a recorded lawful basis
  (POPIA) and limited to what the funder's rule requires.
* M06-R-108 "Proceed at risk" MUST require the patient's explicit acknowledgement with evidence
  (signature or OTP) and MUST never be a default.
* M06-R-109 PMB candidates MUST be flagged from ICD-10 and procedure, MUST be presented as
  "likely" until confirmed, and MUST carry the PMB indicator to M14.
* M06-R-110 Benefit exhaustion, savings-account usage, co-payments and network penalties MUST be
  applied from the rule pack and explained on the quote and Collect card.
* M06-R-111 Cash deposit and discount policies MUST be rule-based with approval thresholds; any
  discount outside the rules MUST be approved by PRM and audited.
* M06-R-112 RAF, COIDA and foreign-patient Orders MUST capture the third-party references and
  guarantees in §6.5, §6.6 and §6.9, MUST show the patient the funding path before the
  appointment, and MUST track deadlines for DEB.
* M06-R-113 Corporate, state and NHI contracts MUST be modelled with fee schedules, scope,
  authorised requesters, invoicing cadence and reporting outputs; the `nhi` type MUST exist as a
  placeholder.
* M06-R-114 Funder contracts MUST carry escalation dates and MUST route new fee schedules for
  EXE approval with modelled impact before they take effect.
* M06-R-115 Exception queues in §7.5 MUST exist with SLA timers and MUST show the Hand's attempted
  actions.
* M06-R-116 Authorisation validity MUST be re-checked when an appointment is rescheduled, and
  expired authorisations MUST be re-requested automatically.
* M06-R-117 Emergency studies MUST proceed without pre-authorisation and MUST trigger a
  retrospective request within the funder's window.
* M06-R-118 Funder portal credentials MUST be held in the secrets store and MUST never appear in
  a Hand's prompt or logs.
* M06-R-119 The Platform SHOULD produce a gap-cover claim pack for patients whose plan leaves a
  shortfall.
* M06-R-120 The Platform MAY submit pre-adjudication enquiries where a funder adjudicates in real
  time to obtain an exact scheme portion before the appointment.

## 10. KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Authorisation turnaround | `Auth requested` to `Authorised` or `Auth declined`, working hours, by funder | Median ≤ 4 h API/portal; ≤ 1 day phone |
| Authorisation before appointment | Appointments needing auth that are `Authorised` ≥ 24 h before start | ≥ 95 % |
| Quote accuracy | Quotes where the final patient portion equals the quoted portion within R50 | ≥ 95 % |
| Quote variance cost | Rand written off under the binding-quote guarantee per month | Tracked; trending to zero |
| Denial avoidance | Claims rejected for missing or invalid authorisation / claims needing authorisation | ≤ 1 % |
| First-time authorisation | Requests approved without a more-info cycle | ≥ 85 % |
| Eligibility check coverage | Orders with a validated eligibility record before the appointment | ≥ 99 % of scheme Orders |
| Front-desk collection rate | Patient portion collected at or before visit / patient portion due | ≥ 90 % |
| Hand completion rate | Authorisations obtained without human action | ≥ 70 % where API/portal exists |
| Proceed-at-risk rate | Studies performed pending authorisation | ≤ 3 %, reviewed monthly |
| Contract escalation timeliness | Fee schedules updated on the effective date | 100 % |
| Patient understanding | Post-visit survey: "I knew what I would pay before I arrived" | ≥ 90 % agree |

## 11. Controls

| ID | Control | Type |
|---|---|---|
| C-01 | Quote engine deterministic, versioned with rule-pack and fee-schedule references; reproducible on demand | Preventive |
| C-02 | Binding quote tolerance gate: increases need fresh patient acceptance | Preventive |
| C-03 | Authorisation Hand leash: no code alteration, single resubmission, no at-risk acceptance on the patient's behalf, contact caps | Preventive |
| C-04 | POPIA basis recorded for every clinical motivation shared with a funder; data minimised to the funder's rule | Preventive |
| C-05 | Immutable storage of funder payloads and responses; portal sessions evidenced | Detective |
| C-06 | Discount approval thresholds and audit; monthly review by PRM and EXE | Detective |
| C-07 | Eligibility re-validation at T-24 h and check-in | Preventive |
| C-08 | Segregation: M06 quotes and authorises; M14 claims; no Hand can both authorise and post a claim adjustment | Preventive |
| C-09 | Secrets store for portal credentials; no credentials in prompts or logs | Preventive |
| C-10 | Proceed-at-risk evidence (signature or OTP) mandatory; rate monitored | Preventive |
| C-11 | Contract change approval by EXE with modelled impact | Preventive |
| C-12 | Suspected membership fraud (mismatched identity, shared cards) escalated to CMP, never resolved by the Hand | Detective |
