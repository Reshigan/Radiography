# DEB — Debtors and Collections Controller: Persona Journey

## Persona snapshot

| Item | Detail |
|---|---|
| Code | DEB |
| Who | Debtors / collections controller in the MSO billing bureau, responsible for patient and funder receivables across a portfolio of Practices. Works alongside BIL; where BIL owns the claim until adjudication, DEB owns every balance after that. |
| Goals | Collect what is owed quickly and kindly; minimise write-offs and bad-debt handover; keep the Practice's cash position visible. |
| Frustrations today | Statements that do not explain why a patient owes money; scheme-paid-to-member balances chased months late; phone-based dunning; disputes with no trail; RAF and COIDA balances sitting for years with no status. |
| Better than market | Propensity-to-pay scoring; automated, respectful multi-channel dunning with payment links (PayShap, card, EFT, SnapScan/Zapper-style QR); payment plans; a dispute workflow; the scheme-versus-patient liability split explained on every statement. |
| Surfaces | Business lens (Bone, Dense L3, Standard W2, Marrow). Debtors console in M14, `StatementView`, `PayLink`, `Timeline`, `Inspector`. |
| Metrics | DSO, collection rate at 30/60/90 days, write-off %. |
| Modules touched | M14 Revenue Cycle (owner of debtors), M06 Funding & Authorisation, M03 Patient Master Index, M13 Results & Communication (patient channels), M15 Finance & Consolidation, M19 Quality, Risk & Compliance (complaints, POPIA), M20 Agent Runtime. |

The journey follows Sipho, debtors controller for Practice A (Sandton and Randburg) and Practice C (the hospital-based JV).

---

## Scene 1 — The Collections Hand's morning run

**Situation.** 08:00 SAST, Monday. The Collections Hand ran at 06:00, as it does every working day, against every open patient balance older than the Practice's grace period (illustrative: 7 days after the statement date; configurable per Practice).

**What they see.** The Debtors console develops in Latent Image order: any complaint or dispute opened over the weekend first (Flare), then money. `StatTile`s: Open patient balances R1.84 M · 30-day collection rate 71 % · DSO 34 days · Promised today R62 300 · Hand actions overnight 1 216 · Needs me 17. A `TrendChart` shows collections by channel for the last 30 days; a `Distribution` shows balances by age band and by liability reason (co-payment, benefit exhausted, not covered, paid to member, cash, RAF, COIDA).

The Hand's overnight actions are listed in a `Timeline`, each with the message sent, the channel, the language the patient chose in the Patient Space, and the `PayLink` status. The 17 items needing Sipho are grouped: replies that the Hand's mandate does not let it handle (a patient says "I never had this scan", a patient asks for a discount, a message bounced on every channel, a balance above the Hand's leash).

**What they do.** Sipho reads the "Needs me" queue and does nothing with the 1 216 the Hand handled; the console shows him the sample he must review (1 %), and he confirms the tone and accuracy of a dozen messages. He notices the WhatsApp channel converted best this week, and that isiZulu statements had a higher pay-link click rate than English ones for the same balance band; the console had already surfaced that in the `Benchmark` tile.

**What the Platform does.**

1. When a claim is adjudicated (`claim.adjudicated.v1`, `claim.paid.v1`, `claim.short_paid.v1`), M14 splits the balance into scheme liability and patient liability per line, with the reason from the funder response mapped to the Bonakala taxonomy.
2. A statement is generated (`StatementView`) using the "Money explained" pattern: tariff × units − scheme paid − adjustments = patient owes, with each tariff described in plain language and in the patient's chosen language.
3. The propensity-to-pay model (M16, monitored by AIO as a Class 4 output) scores each balance from payment history, balance size, channel reachability and liability reason. It never uses race, and it never uses scheme membership as a proxy for ability to pay; CMP reviews the feature list quarterly.
4. The Collections Hand (M20, A3) chooses the sequence from the Practice's dunning policy: statement, reminder at day 7, reminder at day 21 with a `PayLink`, call-back offer at day 35, final notice at day 60, handover recommendation at day 90. Channel order follows the patient's consent preferences (M03) and POPIA: WhatsApp first if opted in, then SMS, then email, then post for patients with no digital channel. Messages are three lines or fewer, no exclamation marks, and always say who to contact if the balance is wrong.
5. The Hand's leash: balances up to a configurable ZAR limit; at most one message per patient per 7 days; no messages between 20:00 and 08:00 SAST or on Sundays; no contact with a patient who has an open dispute or complaint; no contact with a deceased patient's record (M03 flag); no discounting; no threats of legal action (only the handover step, approved by a human, may mention it).
6. Every payment through a `PayLink` posts to the debtors ledger in real time via the PSP webhook; `payment.received.v1` closes or reduces the balance and stops the sequence.

**Edge cases.**
- A patient replies "wrong number". The Hand stops the sequence, flags the contact number as disputed, and routes to Sipho and FDK to verify identity before any further contact, because sending a balance to the wrong person is a POPIA incident.
- A minor's balance is addressed to the guardian on the record, never to the child.
- A patient paid at the front desk on Friday but the receipt was posted to a duplicate record. The Hand's Monday message would be wrong; the duplicate-detection projection in M03 blocks the message and opens a merge candidate first.

**Success measure.** 30-day collection rate rising month on month; fewer than 2 % of Hand messages result in a complaint; zero messages to a patient with an open dispute.

---

## Scene 2 — A dispute

**Situation.** A patient, Mrs Naidoo, replies on WhatsApp: "My scheme said this was covered in full. Why must I pay R1 460?" The Hand recognises a dispute intent and stops the sequence.

**What they see.** A dispute object opens in Sipho's queue with the patient's message, the statement, the claim, the scheme's remittance line, and the benefit check done at booking, side by side in the `Inspector`. The `Timeline` shows: quote given at booking (scheme portion R3 900, patient portion R0, based on the scheme's response that day), study done, claim submitted, scheme paid R2 440, reason "tariff paid at scheme rate, provider charges above scheme rate". The Practice is not in that scheme's DSP network for MRI, so the difference is a legitimate patient liability, but the quote at booking did not reflect it.

**What they do.** Sipho reads the arithmetic. The quote was wrong because the Practice's out-of-network flag for that scheme's option was not set when the booking was made. He decides, within his own mandate, to honour the quote: the balance is written off under the code "quote honoured, Practice error". He replies through the console in plain English: "You are right. We quoted R0 at booking and we will honour that. Your balance is now R0. You will get a corrected statement now." He raises a quality item to PRM and BIL so the option's network status is corrected.

**What the Platform does.**
- Dispute intents are classified by the Hand (Class 4 output, A2 with human handling): the Hand may open the dispute and pause collections, but may not resolve or discount.
- The dispute object (M14) is linked to the claim, the quote (M06) and, if the patient raises it as a complaint, to the M19 complaint register.
- Write-offs above Sipho's personal mandate (configurable) route to PRM for approval with a typed `Confirm`. The reason code feeds the "quote accuracy" KPI that PAT and PRM see, so the cost of a bad quote is visible where it was caused.
- The corrected statement is generated and sent on the same channel. Events: `dispute.opened.v1`, `dispute.resolved.v1`, `balance.written_off.v1`.

**Edge cases.**
- The patient's claim is that the scan was never done. The Platform shows the acquisition record (MPPS, radiographer, time, dose) and the consent signature from M07; Sipho can send the patient a link to the images in the Patient Space as evidence, which usually ends the dispute.
- The dispute is really about the scheme's decision (a Prescribed Minimum Benefit the scheme should have paid in full). The Platform provides the patient a plain-language explanation and a template to lodge with the scheme, and holds the balance in "scheme dispute" status so the patient is not dunned while the scheme reconsiders. If the scheme still refuses, the Council for Medical Schemes complaint route is described, not decided, by the Platform.

**Success measure.** Dispute acknowledged within one working day; resolved within five; quote-error write-offs trend down as network flags are fixed.

---

## Scene 3 — A payment plan

**Situation.** A cash patient owes R7 800 for a CT with contrast performed as an urgent outpatient study. He replies to the day-21 message: "I can pay but not all at once."

**What they see.** The Hand has already offered the Practice's standard plan options in the Patient Space Pay section: three, six or nine monthly instalments, no interest, first instalment now, debit order or monthly `PayLink`. The patient picked six. The plan appears in Sipho's queue for approval because R7 800 is above the Hand's plan leash.

**What they do.** Sipho checks the propensity score, the patient's history (first visit, paid the deposit at the front desk), and approves. He does not add interest or fees: the Practice's policy is no interest on patient plans, which keeps the arrangement outside the National Credit Act's credit-agreement definitions (the Platform stores this policy as configurable reference data and CMP reviews it).

**What the Platform does.**
- M14 creates the plan: schedule, amounts, channel, and a `PayLink` per instalment or a debit-order mandate through the PSP adapter.
- The Collections Hand switches to plan mode: a reminder three days before each instalment, a thank-you after payment, and an "arrangement broken" escalation to Sipho if an instalment is 7 days late, never a full restart of dunning.
- The debtors ledger shows the balance with the plan status; the age analysis treats a plan on schedule as current for DSO reporting, with a separate line for plans in arrears so the Practice is not misled.
- Events: `payment_plan.created.v1`, `payment_plan.instalment.paid.v1`, `payment_plan.broken.v1`.

**Edge cases.**
- The patient's debit order bounces during a month with a public-sector salary delay. The Hand offers to move the date once without penalty; the second failure goes to Sipho.
- The patient asks to settle early. The plan closes on the day the last payment clears.

**Success measure.** Plans completed as scheduled above 80 %; plan-in-arrears balance below 10 % of plan book.

---

## Scene 4 — Handover approval

**Situation.** Quarter-end. The Hand has recommended 46 balances, totalling R318 000, for handover to the Practice's external collection attorney. Each has completed the full sequence with no reply, no payment and no dispute.

**What they see.** A `KanbanBoard` lane "Handover recommended" with a `DataTable` of the 46. Each row shows: balance, age, liability reason, channels tried, last contact, propensity score, and a checklist status: statement delivered, final notice delivered on a verified channel, no open dispute or complaint, patient not flagged vulnerable (M03 flag set by FDK or NUR, for example an oncology patient in active treatment), not a Practice-error balance, not RAF or COIDA (those never hand over as patient debt). Balances that fail any check are shown with the failing item in Beam.

**What they do.** Sipho reviews the list, removes four (two are patients whose records show a bereavement note, two are balances under the Practice's minimum handover amount once the write-off cost is considered), and submits 42 for approval. PRM approves with a typed `Confirm` because handover is a reserved action in the Practice's debtors policy. Sipho then releases the handover file to the attorney through the secure share in M21 (no email attachments of patient data), with only the fields the attorney needs: name, ID number (masked in the console, unmasked in the file under the data-sharing agreement), contact details, balance, statement and proof of delivery.

**What the Platform does.**
- The handover checklist is enforced, not advisory: a balance that fails a check cannot be added to the file.
- The Prescription Act's three-year period for a debt (stored as reference data; Sipho does not need to remember it) is tracked from the date the debt became due, and the console shows time remaining for each handed-over balance.
- Attorney results (payments, untraceable, settled) return through the same secure channel; payments post to the ledger net of commission, with the commission posted as a cost line in M15.
- Events: `handover.recommended.v1`, `handover.approved.v1`, `handover.released.v1`, `balance.written_off.v1` for the balances Sipho removed.

**Edge cases.**
- After handover, a patient pays the Practice directly. The Platform notifies the attorney to stop, and the commission rule for "paid to practice after handover" applies as agreed.
- The attorney's system returns a status for a patient who disputes; the Platform reopens a dispute object and pulls the balance back into the Practice's control.

**Success measure.** Handover file 100 % checklist-clean; write-off % of gross revenue within the Practice's budget; complaints from handed-over patients near zero.

---

## Scene 5 — An RAF settlement three years later

**Situation.** Three years and two months after a motor-vehicle accident patient had a CT of the cervical spine and a series of X-rays at Randburg, the Practice's bank statement shows a receipt of R11 240 from the Road Accident Fund with a reference that matches nothing recent.

**What they see.** The `RemittanceMatch` component proposes a match at 0.88 confidence to a long-cycle receivable in the RAF book: the patient's name, the original claim, the attorney on record, the RAF claim number captured when the attorney's undertaking letter arrived two years ago. The balance sits in the RAF age band "36 months+" with its expected recovery factor. The `Timeline` on the balance shows every event since the study: claim classified RAF at registration (M06), attorney details received, RAF claim number captured, annual status request sent by the Collections Hand to the attorney, two replies, then silence, then this payment.

**What they do.** Sipho confirms the match. The receipt is R2 100 less than the original tariff value because the RAF settled at its published tariff for that year (illustrative; the Platform stores the RAF tariff versions as reference data). He posts the difference as a "RAF tariff shortfall" adjustment, not a bad debt, because the Practice's policy does not pursue the patient for RAF shortfalls. He checks whether the same attorney has other open RAF balances for the Practice and asks the Collections Hand to send a status request on those, citing this settlement as context.

**What the Platform does.**
- RAF and COIDA balances are modelled as long-cycle receivables with their own status vocabulary (awaiting attorney, claim lodged, undertaking received, settled, prescribed) rather than being dunned as patient debt.
- The expected-recovery factor by age band is computed from the Practice's own history (M16) and used by M15 for the accrual, so a settlement three years later is a reconciliation event, not a windfall that distorts the month.
- The match survived three years because the RAF claim number, attorney reference and patient identity were captured at the time and stored on the balance; the matcher searches the full history, not the last 12 months.
- Events: `remittance.matched.v1`, `balance.settled.v1`, `balance.adjusted.v1`.

**Edge cases.**
- The payment arrives with no usable reference. The matcher searches on amount and RAF tariff arithmetic against all open RAF balances; if still ambiguous, it opens a task for Sipho with the candidates and drafts a query to the RAF's payments office.
- The patient's claim prescribed because the attorney never lodged it. The balance is written off under "RAF prescribed" and the attorney's performance is visible in the Practice's attorney scorecard.
- The settlement is for a patient who had studies at two Practices in the Group. The payment is split by study and each Practice's ledger is credited; the intercompany rules in M15 handle a payment received into the wrong Practice's bank account.

**Success measure.** RAF book recovery rate at or above the accrual factor; no RAF balance prescribes without a recorded reason; every RAF receipt matched within two working days.

---

## Moments that beat the market

- Every statement explains the arithmetic and the reason a patient owes money, in their language, so most disputes never start.
- Collections run overnight at A3 with a leash that enforces respect: hours, frequency, channel consent, no contact during disputes, no discounting, no threats.
- A dispute pauses everything automatically and puts the quote, the claim and the remittance side by side so the controller can decide in minutes and, where the Practice was wrong, say so.
- Payment plans are self-service in the Patient Space, interest-free by policy, and managed by the Hand as a relationship, not a restart of dunning.
- Handover is checklist-enforced and human-approved; vulnerable patients, Practice-error balances and RAF/COIDA balances can never reach an attorney.
- RAF and COIDA receivables have their own lifecycle, their own accrual factors and their own status chasing, and a settlement three years later still matches.
- Channel and language performance is measured, so the Practice learns that an isiZulu WhatsApp statement collects better than an English SMS and acts on it.
- The cost of a bad quote lands on the "quote accuracy" KPI where it was caused, not on the patient.

## Failure modes designed out

- **Dunning the wrong person.** A "wrong number" reply, a duplicate record or a deceased flag stops all contact until identity is confirmed; a misdirected statement is treated as a POPIA incident.
- **Chasing patients for the Practice's or the funder's mistakes.** Quote-honoured and funder-rule write-off codes keep those balances off patient statements.
- **Dunning during a dispute or complaint.** The Hand's mandate technically excludes any balance with an open dispute; the runtime enforces it, not the prompt.
- **Uncontrolled discounting.** Hands cannot discount; humans discount within mandates with typed confirmation and reason codes that shareholders can see.
- **Handover of balances that should not be handed over.** The checklist is a gate, and PRM approves every file.
- **Long-cycle receivables treated as bad debt or as face value.** RAF and COIDA have their own book, status vocabulary and recovery factors.
- **Lost matches years later.** RAF claim numbers, attorney references and identities are stored on the balance at the time and searched across the full history.
- **DSO flattered by payment plans.** Plans on schedule are current; plans in arrears are a separate line.
