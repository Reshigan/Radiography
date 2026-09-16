# Journey: BIL — Billing, Coding and Claims Clerk

## Persona snapshot

| Item | Detail |
|---|---|
| Code | BIL |
| Who | Billing, coding and claims clerk. In Bonakala the role sits in the MSO billing bureau (Bonakala Platform (Pty) Ltd), which acts as POPIA *operator* for each Practice under the management services agreement. A clerk typically services three to six Practices and switches tenant in the TopBar. |
| Goals | Every study billed correctly the same day, first-pass acceptance by the medical scheme, no leakage. |
| Frustrations today | Manual coding from reports, scheme rule differences, rejections with cryptic reason codes, resubmission deadlines (stale-claim rules, typically four months from date of service, stored as configurable reference data), modifiers, multiple-procedure rules. |
| Better than market | The Coding Hand codes from order plus signed report with confidence; the scrubber applies scheme-specific rule packs; real-time claims where a switch and scheme support them; a rejection reason taxonomy with auto-fix paths; an exception-only work queue. |
| Surfaces | Business lens (Bone surface, Dense L3, Standard W2, Marrow accent). Revenue Cycle console (M14), Command palette, Inspector. |
| Metrics | First-pass acceptance, days-to-bill, unbilled backlog (count and ZAR). |
| Modules touched | M14 Revenue Cycle (owner), M12 Reporting, M06 Funding & Authorisation, M03 Patient Master Index, M04 Referral & Orders, M15 Finance & Consolidation, M20 Agent Runtime, M21 Platform Core. |

The journey follows Thandi, a senior billing clerk in the Durban bureau, who services Practice B (the Umhlanga JV), Practice A (Sandton and Randburg) and two management-only affiliates.

---

## Scene 1: A normal morning with the Coding Hand

**Situation.** 07:45 SAST. Overnight, the Coding Hand and Claims Hand have processed everything signed since Thandi logged off. Thandi's job is no longer to bill; it is to handle what the Hands could not, and to keep the Hands honest.

**What they see.** The Revenue Cycle console opens on the Business lens. The Latent Image order develops the page most-critical-first: a `Banner` for any stale-claim deadline falling in the next 5 working days, then a row of `StatTile`s (Signed yesterday: 412 studies · Coded by Hand: 391 · Claims submitted: 377 · Awaiting me: 21 · First-pass acceptance, 7 days: 96.4 %), then the `Queue` of exceptions. Each row in the `DataTable` shows the study, the Practice, the scheme, the age of the item as a thin SLA bar (Beam at 24 h, Flare at 48 h), and a one-line reason in plain English. Every coded line carries a `Provenance` chip in the annotated style: dashed hairline, mono label `coding-hand · rules v2026.09.2 · 0.97`. The `Inspector` on the right shows the selected study's order, signed report, tariff lines, ICD-10 codes and the claim's `ClaimStatus`.

**What they do.** Thandi reads the tiles, sorts the queue by SLA, and starts on the oldest. She does not touch the 391 studies the Hand coded with confidence above the Practice's threshold; those went straight to the scrubber and the switch under A3. She samples: the console asks her to review a 2 % random sample of auto-coded claims each day. She opens one, checks the tariff lines against the report, and clicks Accept. That sample result is a monitoring input for the Hand's leash.

**What the Platform does.**

1. `study.signed.v1` (M12) triggers the Coding Hand (M20, A3). It reads the order (M04), the signed structured report (M12), the modality and protocol (M08), the funder rules on the encounter (M06) and produces suggested tariff codes, units, modifiers and ICD-10 codes, each with a confidence score and provenance.
2. The tariff engine (`packages/billing-rules`) prices each line against the Practice's fee schedule for that funder (scheme rate, DSP contracted rate, RAF tariff, COIDA tariff, cash price), applies multiple-procedure and bilateral rules from the scheme rule pack, and computes VAT at 15 %.
3. The scrubber runs the scheme-specific rule pack: mandatory ICD-10, valid referring practitioner practice number (BHF PCNS), authorisation number where required, member validation result from the benefit check, duplicate detection, tariff-to-ICD compatibility.
4. If confidence is above threshold and the scrubber is clean, the Claims Hand submits the claim via the switch adapter (A3 for cleanly coded, authorised, non-disputed claims; A4 is permitted by policy but Practice B has it set to A3 with a 2 % human sample). Events: `claim.coded.v1`, `claim.scrubbed.v1`, `claim.submitted.v1`.
5. Where the switch and scheme support real-time adjudication, the response arrives in seconds and `claim.adjudicated.v1` updates `ClaimStatus` to Accepted, Partially accepted or Rejected. Batch schemes return responses overnight.
6. Anything below threshold, anything failing the scrubber, and anything outside the Hand's leash (for example a claim above a configurable ZAR value, or a funder class such as RAF that is A1 by policy) lands in Thandi's queue with the reason.

**Edge cases.**
- The report is signed but the order carried no ICD-10 from the referrer. The Coding Hand suggests an ICD-10 from the clinical indication in the report, flags it "suggested code", and routes it to Thandi because ICD-10 selection from free text is capped at A1 for the first 90 days of a new rules version.
- Two studies on the same patient the same day (CT brain and CT cervical spine) trigger the scheme's multiple-procedure rule; the engine applies the reduction and shows the arithmetic in the `Money explained` pattern.

**Success measure.** Studies signed yesterday are claimed before 09:00 today; Thandi's queue holds fewer than 5 % of yesterday's volume; sample review agreement with the Hand above 98 %.

---

## Scene 2: Working the exception queue

**Situation.** 21 items. Thandi has until 10:30 to clear them before the 11:00 switch batch cut-off that Practice B uses for its largest batch scheme.

**What they see.** The `Queue` groups exceptions by reason taxonomy, a controlled vocabulary shared by M14 and M06:

| Reason family | Example | Typical fix path |
|---|---|---|
| Identity | Member number on file does not match scheme response | Confirm with patient via WhatsApp; `IdScan` on next visit |
| Coding confidence | Report describes an additional contrast phase not on the order | Accept the Hand's suggested extra line or reject |
| Funder rule | Authorisation number required for this tariff code with this scheme | Authorisation Hand requests auth retrospectively; hold |
| Referrer | Referring practitioner practice number invalid or missing | Look up in the referrer directory; ask the Referrer Space contact |
| Funder class | RAF, COIDA, corporate, foreign patient | Human-led per the funder playbook |
| Data quality | Patient date of birth mismatch across two records | M03 merge candidate; route to FDK |

Each row's `Inspector` shows the arithmetic and the exact rule that fired, with a link to the rule text in plain language.

**What they do.** Thandi opens a "Coding confidence" item. The signed report for a CT abdomen describes a delayed phase that was not on the order. The Hand suggests adding the additional-phase tariff line at 0.71 confidence. She checks the report, accepts, and the line loses its annotated style and records `accepted_by`, `accepted_at`, `model_version`. She opens a "Referrer" item: a GP's practice number is missing because the referral came in as a WhatsApp photo. She types the GP's name into the referrer directory, picks the match, and the Platform offers to back-fill the referrer record so the next referral from that GP is clean. She opens a COIDA item: an injury-on-duty X-ray. The employer's incident details and the Compensation Fund claim number are missing. She uses the Command palette to "ask a Hand" to send the employer a request through the corporate contact on file; the Claims Hand drafts the message and Thandi approves it.

**What the Platform does.** Each accept, edit or reject is recorded as a labelled example for the monthly Coding Hand evaluation (M11 monitoring, M20 audit). Fixed items re-enter the scrubber and, if clean, are submitted in the next batch. Items that need a third party (patient, referrer, employer) move to a "Waiting" lane with a follow-up timer; the responsible Hand nudges the third party on a schedule Thandi can see. Events: `claim.exception.opened.v1`, `claim.exception.resolved.v1`.

**Edge cases.**
- The scheme's real-time response says "benefit exhausted" for a member whose benefit check at booking said funds were available. The Platform shows both timestamps and the difference, converts the shortfall into a patient liability with the explanation the DEB persona will use, and does not let a second submission go out without a human decision.
- A dental referral (a dentist is a valid referrer for a panoramic X-ray) uses a different practice number format; the referrer directory knows this and does not raise a false exception.

**Success measure.** Queue cleared before the batch cut-off; each exception resolved in under 4 minutes median; repeat exceptions of the same referrer or reason drop week on week.

---

## Scene 3: Remittances and the afternoon reconciliation

**Situation.** 14:00. Overnight remittance advices from four schemes and two bank statement feeds have arrived.

**What they see.** The `RemittanceMatch` component shows each remittance line against the claim it pays: matched exactly, matched with a short-payment, or unmatched. A `StatTile` shows "Unmatched today: R18 420 across 11 lines". Short-payments are grouped by reason from the scheme's remittance codes, mapped to the Bonakala taxonomy.

**What they do.** Thandi reviews the 11 unmatched lines. Seven are scheme-side reference formats that the matcher has already proposed matches for at 0.9 confidence; she accepts them in bulk. Three are a scheme paying the patient directly (a common SA behaviour for out-of-network claims); she marks them "paid to member" and the balance becomes patient liability, with a statement explanation prepared for DEB. One is a genuine short-payment under a DSP contract rate dispute; she opens a funder query, which the Claims Hand drafts with the contract clause reference attached from M02's agreement register.

**What the Platform does.** The Remittance Hand (A3) auto-matches on claim reference, member number, amount and date window; posts receipts to the debtors ledger; splits liability between scheme and patient per line; posts to the GL mapping in M15; and raises `claim.paid.v1`, `claim.short_paid.v1` and `remittance.unmatched.v1`. Bank statement lines are matched to remittances; differences (bank charges, batched payments across two Practices) are itemised for the Practice's finance close.

**Edge cases.** A scheme reverses a previous payment (claw-back after audit). The Platform records a negative remittance line against the original claim, shows the audit reference, and opens a funder-dispute item routed to Thandi and DEB rather than silently netting it off.

**Success measure.** 95 % of remittance lines auto-matched; unmatched cleared within 2 working days; no manual journals for routine receipts.

---

## Scene 4: A rejection wave after a scheme rule change

**Situation.** Tuesday, 3rd of the month. A large open scheme changed a rule on the 1st: a specific group of out-of-hospital CT tariff codes now requires a pre-authorisation number on the claim, and a set of ICD-10 codes is no longer accepted as primary for those tariffs. The scheme communicated this in a circular to practices two weeks earlier; the circular was received by the Practice's info@ mailbox and not actioned. Real-time responses on Monday came back with rejection reason "authorisation required" and "invalid diagnosis for procedure" across 63 claims for the Practice, and similar patterns at three other Practices.

**What they see.** The Latent Image ordering puts a Flare `Banner` at the top of the console: "Rejection spike: 63 claims, 1 scheme, 2 reason codes, started 02 Sep 09:10. Probable cause: scheme rule change. R214 300 at risk." Below it, a `Distribution` chart shows rejections by reason over the last 14 days with the step change visible, and a `Cohort` view lists the affected claims. The Claims Hand has already opened an investigation task and attached the circular, which it found by searching the Practice's inbound document store (M21 files) for the scheme name and the effective date.

**What they do.**

1. Thandi opens the investigation. The Claims Hand's draft root cause reads: "Scheme rule pack version 2026.08 does not include circular 14/2026. Claims for tariff codes [illustrative list] submitted without authorisation number since 01 Sep are rejected. Proposed fix: rule pack update; retrospective authorisation requests via the Authorisation Hand; resubmission batch." Thandi checks the circular herself.
2. She raises a rule-pack change request. Rule packs are versioned data in `packages/billing-rules`; a change requires a second person (the bureau rules lead) to approve, and takes effect for a chosen Practice set. The Platform shows a dry-run: how many claims in the last 30 days would have been flagged under the new pack.
3. She authorises the Authorisation Hand (M06, A3 within leash: retrospective authorisation requests for CT only, this scheme only, up to 100 requests, this week) to request retrospective authorisations through the scheme's portal or API where offered, and to phone the scheme's authorisation line where not. The Hand logs each call outcome and reference number.
4. As authorisations arrive, the Claims Hand attaches the number and resubmits. Claims with an ICD-10 issue are routed back through the Coding Hand, which proposes a compliant primary code where the report supports it, and to Thandi where it does not (the radiologist may be asked, through the Reading Room, to confirm a clinical indication; the radiologist never changes a code to suit a funder, and the Platform records that the request was clinical clarification only).
5. Thandi posts a bureau-wide notice through the console so the other three Practices' clerks see the pattern and the fix, and PRM at each site is told which patients may be contacted about a delay in scheme payment.

**What the Platform does.**
- M14 rejection clustering runs continuously on `claim.rejected.v1` events: same scheme, same reason, same tariff family, started within a window, volume above a control limit. It emits `claims.rejection_spike.v1`, which creates a task for BIL and a notification for PRM and EXE (CFO view).
- The Claims Hand's mandate allows it to investigate and draft; it may not change rule packs (that is a two-person human change) and may not resubmit a rejected claim more than twice without human approval.
- Stale-claim deadlines for each affected claim are shown on the `Cohort` view; the earliest date of service drives the priority. The Platform will not let a claim in this cohort silently expire: at 30, 14 and 7 days before the deadline it escalates to Thandi, then the bureau lead, then PRM.
- A funder-relations note is created for the PAY relationship owner in the MSO so the scheme can be asked why the circular was not machine-readable.
- Events: `rules.pack.changed.v1`, `claim.resubmitted.v1`, `auth.requested.v1`, `auth.granted.v1`.

**Edge cases.**
- The scheme refuses retrospective authorisation for a subset. The claim converts to a patient liability only if the Practice's policy and the patient's signed financial consent (M07) allow it; otherwise it is written off under a "funder rule change, practice absorbs" code so that DEB never dunns a patient for a bureau miss. Write-offs above a threshold need PRM approval, and the Practice's shareholders see the reason in their monthly statement.
- The circular is discovered to have been received on WhatsApp by a site manager rather than the info@ mailbox. The Platform's inbound document capture (M04 fax-to-digital and WhatsApp intake) is configured to classify any funder circular and route it to the rules lead; Thandi confirms the classifier now catches it.
- The rules change also affects quotes given to patients for next week (M06). The Platform re-runs the benefit and authorisation check on upcoming bookings and the Authorisation Hand obtains authorisations before the patients arrive.

**Success measure.** Time from first rejection to rule-pack fix under one working day; 90 % of the affected claims paid within 30 days; zero claims in the cohort lapse the stale-claim deadline; the same scheme's next circular is captured and actioned before its effective date.

---

## Scene 5: Month-end: the unbilled register

**Situation.** Last working day of the month, 16:00. The Practice B finance close (M15) needs a signed-off unbilled register: every study performed in the month that is not yet claimed, with a reason and an expected value, so the accrual is right and the JV partners' distributable profit is not overstated or understated.

**What they see.** The Unbilled Register view in M14 is a `DataTable` with a summary `StatTile` row: Performed this month: 6 812 studies · Claimed: 6 690 · Unbilled: 122 · Estimated value R386 400 · Oldest: 27 days. A `Funnel` shows where the 122 sit: awaiting report sign-off (18), awaiting ICD-10 from referrer (9), awaiting authorisation (31), RAF awaiting attorney details (22), COIDA awaiting employer documents (14), patient identity unresolved (6), cash not collected and no scheme (12), on hold by BIL (10). Each row carries the responsible persona and a next action.

**What they do.** Thandi works the register from the top of the funnel. She asks RGT (via the reading-room task list) to prioritise the 18 unsigned reports, most of which are routine mammography waiting for prior comparison. She confirms that the RAF and COIDA items are correctly classified as long-cycle receivables so the finance close accrues them at the Practice's expected-recovery rate rather than face value. She reviews the 10 items she put on hold, releases four, and writes a one-line reason for the six that stay. She signs the register with a typed `Confirm`, which locks the month's unbilled snapshot.

**What the Platform does.**
- M14 computes the register continuously; the month-end snapshot is an immutable read model published to M15 with `revenue.unbilled_snapshot.v1`.
- Expected value per unbilled study is the tariff engine's price at the funder's rate, with a recovery factor by funder class from the Practice's history (M16), labelled as an estimate.
- M15 posts the accrual journal to the Practice's GL and to the consolidation, with the JV split computed by M02 entitlements. The shareholders' monthly statement (SHR) shows "Unbilled at month-end" as a line so nothing is hidden.
- The Unbilled Register reconciles to the modality worklist (M08): every completed MPPS must have a study, every study must have a billing state. Studies with no billing state at all are a defect, not an exception, and raise `billing.orphan_study.v1` to SUP.

**Edge cases.**
- A study was performed but the report will never be signed because the patient left before completion and the radiographer marked it "abandoned". It is billed as a partial per the Practice's policy or written off, and the reason is on the register either way.
- A hospital-based JV site (Practice C) has 40 studies where the hospital's ADT feed and the Practice's registration disagree on the funder. The Platform lists them as identity exceptions with the ADT message and the registration side by side.
- VAT: the register shows VAT-inclusive and VAT-exclusive values because the Practice's VAT201 return (SARS) is prepared from invoiced, not performed, values; the accrual is for management accounts only.

**Success measure.** Unbilled register signed before 17:00 on the last working day; unbilled value below 5 % of the month's gross; no study without a billing state; the following month's opening unbilled cleared by the 10th.

---

## Moments that beat the market

- The clerk starts the day with 21 exceptions, not 412 studies. Cleanly coded, authorised claims go out at A3/A4 while she sleeps, with provenance on every line.
- A rejection wave is detected as a pattern within an hour, with the probable root cause and the scheme circular attached, rather than being discovered one rejection at a time weeks later.
- Retrospective authorisations are requested by a Hand that phones and logs the reference numbers; the clerk approves the mandate, not each call.
- Stale-claim deadlines are impossible to miss: every claim shows its countdown and the Platform escalates before, not after, the date.
- Remittances match themselves; paid-to-member and claw-backs are recognised as what they are and handed to DEB with an explanation the patient can understand.
- The unbilled register is a live view all month and a signed snapshot at month-end that flows directly into the JV's distributable profit.
- Every accept, edit and reject the clerk makes trains the next evaluation of the Coding Hand; the Hand gets more accurate on this Practice's case mix.

## Failure modes designed out

- **Silent claim expiry.** Stale-claim countdowns and staged escalation make a lapsed claim a visible failure with an owner, not a quiet write-off.
- **AI code slipping onto a claim unverified.** Coding below the confidence threshold, new rule-pack versions and non-standard funder classes are A1; every auto-coded line carries provenance and is sampled daily.
- **Coding to please the funder.** Radiologists are asked only for clinical clarification; the Platform records the request type and never lets a Hand change a signed report.
- **Rule changes learned from rejections.** Funder circulars are captured from every inbound channel, classified and routed to the rules lead before their effective date.
- **Patients dunned for the Practice's mistakes.** Liability created by a bureau miss is written off under a specific code and never reaches a patient statement.
- **Orphan studies.** Every completed acquisition must have a billing state; a study with none is a defect raised to SUP the same day.
- **Cross-tenant leakage in the bureau.** The clerk switches Practice in the TopBar; row-level security means a claim from Practice A cannot appear in Practice B's queue, and every cross-tenant view is under the recorded operator agreement.
- **Month-end surprises for shareholders.** Unbilled, short-paid and written-off values are lines on the shareholder statement, computed from the same events the clerk worked all month.
