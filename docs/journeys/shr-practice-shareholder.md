# Journey: SHR — Practice Shareholder / JV Partner

## Persona snapshot

| Item | Detail |
|---|---|
| Code | SHR |
| Who | A radiologist-partner holding an interest in a Practice that is a Joint Venture with Bonakala Professional Holdings. Not an executive; often also a working radiologist (RGT) at the Practice, but this journey is the non-executive, shareholder view. |
| Goals | Transparent P&L, distributions on time, a say in reserved matters. |
| Frustrations today | Management accounts that arrive late and change; distributions that depend on a phone call; no visibility of what the management fee buys; reserved matters decided in corridors; selling an interest as a year-long negotiation with no data. |
| Better than market | A shareholder portal that shows the same locked numbers the practice manager and the Group see; distributions computed from the cap table with a full audit trail; reserved matters as recorded votes; a sale of interest handled as a dated transaction with pro-rata splits. |
| Surfaces | Business lens (Bone, Dense L3, Standard W2, Marrow). Shareholder portal (read-only P&L, KPIs, distributions, documents, votes), `StatementView`, `Timeline`, `TrendChart`, `Benchmark`, `Confirm`. |
| Metrics | Distributable profit, distribution timeliness, KPI versus plan. |
| Modules touched | M02 Organisation & Shareholding (owner), M15 Finance & Consolidation, M16 Analytics & Insight, M01 Identity & Access, M21 Platform Core. |

The journey follows Dr Pillay, who holds 24.5 % of Practice B Inc. (the Umhlanga JV: Bonakala Professional Holdings 51 %, Dr Pillay 24.5 %, Dr Khumalo 24.5 %, all A ordinary shares).

---

## Scene 1: The monthly statement

**Situation.** The 6th of the month, 18:30 SAST. Practice B's period closed on the 5th. Dr Pillay gets a WhatsApp: "Practice B's August statement is ready. Distributable profit R1 412 000. Your proposed distribution R346 000. Open the portal to review." (Illustrative amounts.)

**What they see.** The Shareholder portal opens on the statement. In Latent Image order: anything needing his action first (one reserved-matter vote open, see Scene 3), then the money. The `StatementView` for the period shows: gross revenue, less short-payments and write-offs by reason, collections, unbilled at month-end (from the BIL register), costs by category, the management fee to the MSO with its basis (8 % of collections, illustrative) and what it covers (Platform, billing bureau, HR, procurement, marketing) with the service-level results for the month (first-pass acceptance, DSO, Hand exception rates), reading fees to the Hub by radiologist, intercompany rent, depreciation, EBITDA, tax provision, retained per the shareholders' agreement's reserve policy, distributable profit, and the waterfall to each shareholder by economic percentage. A `TrendChart` shows twelve months. A `Benchmark` tile compares Practice B's utilisation, TAT and collection rate with de-identified Group peers.

**What they do.** Dr Pillay reads the statement. He drills into the write-off line: R64 000, of which R38 000 is "funder rule change, practice absorbs" from the rejection wave in the BIL journey. The `Inspector` explains it and shows that the bureau has fixed the rule pack. He drills into the management fee's service levels and sees the bureau's first-pass acceptance for Practice B is 96.4 %. He reads the CT 1 downtime bridge line and the vendor SLA breach recorded against the service contract. He approves the distribution proposal with a typed `Confirm` (one of three approvals required: both partners and the Group's representative).

**What the Platform does.**
- M15 closes the period from posted events; the statement is a locked read model. If the period is reopened, the statement shows a restatement note and the reason.
- M02 computes entitlements from shares issued (M02-R-002), effective-dated, so the waterfall is exact even if the cap table changed mid-period.
- Distribution workflow (M02 and M15): distributable profit computed, proposal generated, approvals collected, bank EFT batch file produced for the Practice's bank, shareholder statements issued, dividends tax handled per the Practice's tax adviser's configuration (the Platform records the withholding treatment as reference data and does not give tax advice).
- Events: `period.closed.v1`, `distribution.proposed.v1`, `distribution.approved.v1`, `distribution.paid.v1`, `shareholder.statement.issued.v1`.

**Edge cases.**
- Dr Pillay wants to dispute the allocation of a shared marketing cost. He opens a query on the line; it routes to the MSO's finance lead and to EXE as M15 specifies, and the statement shows "1 open query" until resolved.
- A partner is also a working radiologist whose reading fees appear as a Practice cost. The portal shows both sides for that person: reading fee statement (RGT) and shareholder statement (SHR), kept separate but reconcilable.

**Success measure.** Statement available by the 6th every month; distributions paid by the 10th; zero restatements in a year; every write-off line explained.

---

## Scene 2: The distribution

**Situation.** All three approvals are in by the 8th. The Practice's bank account holds the cash.

**What they see.** The distribution's `Timeline`: proposed on the 6th, approvals on the 6th, 7th and 8th, EFT batch prepared on the 8th, released by the Practice's authorised signatories on the 9th (bank-side dual authorisation, outside the Platform), paid on the 9th. Dr Pillay's statement shows the amount, the bank reference, the withholding applied and the net paid, and a downloadable PDF for his accountant.

**What they do.** Dr Pillay checks the bank reference against his bank app. He downloads the annual-to-date distribution summary for his provisional tax.

**What the Platform does.**
- The EFT batch file is generated from the approved distribution and the shareholders' banking details held in M02 with change control (a change of banking details requires a signed instruction, a second approver and a cooling-off period before the next payment, because payment-instruction fraud is a common attack).
- Bank statement matching (M14 and M15) confirms the debit and closes the distribution.
- Events: `distribution.batch.generated.v1`, `distribution.paid.v1`.

**Edge cases.**
- Cash is short because a large scheme's remittance is late. The proposal shows a cash-cover check; the Group's representative may propose a partial distribution and the remainder on receipt; both are recorded.
- A shareholder is a trust or a company rather than a natural person. M02 models the shareholder as a `legal_entity` with its own particulars and the correct tax treatment configured.

**Success measure.** Paid within four working days of the last approval; bank reference on the statement; no manual reconciliation.

---

## Scene 3: A reserved-matter vote

**Situation.** Two proposals are open for Practice B's shareholders under the reserved-matters clause of their shareholders' agreement: the second MRI (capex above threshold, from the EXE journey) and the fee-schedule change for the scheme DSP contract renegotiation.

**What they see.** The Votes section lists both with: the proposal summary, the documents (vendor quotes, the what-if model with its assumptions, the draft contract terms and the attorneys' note), the voting rule from the agreement (for capex: 75 % of voting shares; for fee schedules: a simple majority including at least one local partner, illustrative rules stored per agreement), the deadline, and who has voted. Each proposal has a discussion thread where the partners and the Group's representative ask and answer questions, recorded.

**What they do.** Dr Pillay opens the MRI proposal and runs the what-if himself with a more conservative demand assumption; the portal lets a shareholder save a scenario and attach it to the thread. He asks two questions: what happens to the helium and power costs under Stage 6 load-shedding, and whether the room build has municipal approval. The COO's office answers with the site's power plan and the approval status from M18. He votes for the MRI and, with a note, for the fee-schedule change on condition that the rural carve-out is kept; the note is recorded as a condition for the Group to respond to before the vote closes.

**What the Platform does.**
- Reserved matters are configured per `agreement` in M02: matter types, thresholds, voting rules, quorum, deadlines, who counts as which class.
- Votes are recorded with identity (M01 MFA step-up before a vote), time and any conditions; the outcome is computed from the rules, and the resolution document is generated for signature.
- The result flows into M18 (a capex project) or M14 and M06 (fee-schedule versions) with the resolution attached as the source document (M02-R-003).
- Events: `reserved_matter.proposed.v1`, `reserved_matter.voted.v1`, `reserved_matter.resolved.v1`.

**Edge cases.**
- A partner does not vote by the deadline. The agreement's rule (abstention or deemed consent) is applied exactly as configured and shown; the Platform never assumes.
- The two partners vote against the fee change and the Group votes for. The rule requires at least one local partner; the matter fails, and the Group must renegotiate; the portal shows the outcome and the next step.

**Success measure.** Every reserved matter has a recorded vote, documents and thread; no decision above threshold is taken outside the workflow.

---

## Scene 4: Selling part of the interest

**Situation.** Dr Pillay is reducing his clinical hours and wants to sell 12.25 % (half his holding) to Dr Mthembu, a radiologist who joined the Practice two years ago. The shareholders' agreement gives the other shareholders a pre-emptive right; the Group and Dr Khumalo have waived it. The price is agreed between the parties with reference to the Practice's trailing EBITDA. Effective date: the 15th of next month.

**What they see.** The Transactions section shows a `Stepper`: notice of intention to sell, pre-emptive-right period with waivers, buyer's eligibility (Dr Mthembu's HPCSA registration verified in M01, because only a registered practitioner may hold shares in the Practice under HPCSA rules), the sale agreement and share transfer documents, CIPC filings by the company secretary, the effective date, and the resulting cap table. The step for the effective date shows the pro-rata treatment: the period containing the 15th will be split by day, with distributable profit for days 1 to 14 attributed to the old holdings and days 15 to 31 to the new.

**What they do.** Dr Pillay uploads the signed sale agreement and share transfer form; the company secretary attaches the CoR forms and the updated securities register extract. He sees his entitlement drop to 12.25 % from the effective date and a preview of next month's split statement.

**What the Platform does.**
- M02-R-007: the transaction reassigns entitlements from the effective date with pro-rata period splitting; historical distributions remain computed on historical holdings (M02-R-001).
- The buyer is provisioned a shareholder-portal login scoped to the Practice, with history visible only from the effective date unless the agreement says otherwise.
- The B-BBEE ownership record is updated only with the buyer's consent to demographic classification.
- If the transaction changes control or crosses a threshold in the Group's policy, it is itself a reserved matter and routes for approval first.
- Events: `shareholding.transaction.recorded.v1`, `shareholding.changed.v1`, `user.provisioned.v1`.

**Edge cases.**
- The sale is financed by the Practice buying back shares rather than a sale between shareholders. The Platform models a buy-back as a share cancellation with the Companies Act solvency-and-liquidity test recorded as a document from the directors, not computed by the Platform.
- The effective date is delayed by CIPC processing. The transaction is held in "pending registration" with the agreed effective date; if the parties agree to move the date, both sign the change in the portal.

**Success measure.** The transaction is recorded with every document attached; the first split statement is correct without a manual journal; the buyer has portal access on the effective date.

---

## Moments that beat the market

- The shareholder sees the same locked period as the practice manager and the Group; there is no separate version of the truth.
- Every write-off, short-payment and management-fee line is explained down to the events that caused it.
- Distributions are computed from the cap table, approved in the portal and paid to bank details under change control, with the bank reference on the statement.
- Reserved matters are proposed with documents and models, discussed in a recorded thread, voted under the agreement's exact rules and turned into resolutions automatically.
- A partner can run the Group's own what-if with different assumptions and attach it to the vote.
- Selling part of an interest is a dated transaction with HPCSA eligibility checks, pro-rata splits and a preview of the next statement.
- Service levels for the management fee are shown next to the fee, every month.

## Failure modes designed out

- **Restated numbers.** Locked periods; restatements are labelled with reasons.
- **Distributions that depend on a phone call.** A workflow with approvals, cash-cover checks and a bank batch file.
- **Payment-instruction fraud.** Banking-detail changes require a signed instruction, a second approver and a cooling-off period.
- **Ineligible shareholders.** HPCSA registration is verified before a transfer can be recorded.
- **Corridor decisions.** Reserved matters above threshold cannot take effect in M14, M06 or M18 without a recorded resolution.
- **Wrong pro-rata splits after a sale.** Effective-dated holdings and day-based period splitting are the only way the Platform computes entitlements.
- **Race data stored without consent.** B-BBEE classification is captured only with consent and purpose limitation.
