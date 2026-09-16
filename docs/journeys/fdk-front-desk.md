# Journey: FDK — Front Desk / Reception

This journey follows the Front desk persona (FDK) through a working day at a Bonakala site. Each
scene is written as: Situation, What they see, What they do, What the Platform does, Edge cases,
Success measure. Amounts and codes are illustrative and stored as configurable reference data.

## Persona snapshot (from 04-personas)

| Item | Detail |
|---|---|
| Who | Reception, patient services and front-of-house staff at a Site; kiosk supervisors |
| Goals | Move patients through with zero re-keying, know exactly what to collect, avoid queues |
| Frustrations today | Scheme phone calls, manual benefit checks, paper consent, walk-ins, ID capture |
| Better than market | Everything pre-done on the Patient Space; ID scan; the Collect card says exactly what to collect and why; one screen for the day; a Hand does the scheme calls |
| Surfaces | Front Desk console (tablet or desktop), kiosk supervisor mode |
| Metrics | Check-in time, front-desk collection rate, queue wait |

Design lens: **Business** (Bone surface, Dense L3, Standard W2, Marrow accent). The console uses
the standard `AppFrame`: left rail, top bar with site and date context and the `WindowLevelControl`,
the day `Queue` as the main content, and the `Inspector` for the selected patient. Front desk staff
sign in with SSO and MFA (M01) and are scoped to their Site.

## Scene 1 - 07:20: opening the day

**Situation.** Busisiwe opens the Randburg site. First patients are due at 07:30. Load-shedding is
scheduled for 08:00 to 10:30 in this area today.

**What they see.** The day screen develops most-critical-first (Latent Image): a Beam banner "Grid
loss expected 08:00 to 10:30. Edge Gateway on UPS: imaging continues. Kiosk on UPS." Then the STAT
and priority list (one inpatient CT from the neighbouring hospital), then the `Queue` for the day:
each row shows the patient (masked ID), study, room, time, status (Pre-checked-in, Booked, Arrived,
In room, Done), the funding position as a `Status` chip (Authorised, Quote accepted, Cash paid,
Cash due, Needs auth), and a small `CollectCard` indicator showing the amount expected at the desk.
A `StatTile` strip across the top shows: 38 booked, 29 pre-checked-in, 4 needing attention, expected
desk collections R6 840.

**What they do.** Reads the four attention items in the `Inspector`: one patient whose scheme
authorisation is pending, one duplicate-record suspicion, one patient with an outstanding balance
from a previous visit, one walk-in referral received on WhatsApp overnight without an ID number.
She assigns herself the first two and leaves the rest to her colleague.

**What the Platform does.**
* M21 Platform Core: the site's Edge Gateway telemetry (link, UPS, modality connectivity) feeds the
  banner; the municipal load-shedding schedule, where published, is ingested as reference data and
  matched to the site's area (illustrative capability, configurable per site).
* M05 Scheduling & Capacity: the day queue is a projection of appointments joined with M06 funding
  status, M07 pre-check-in status and M14 balances.
* M06 Funding & Authorisation: overnight, the Authorisation Hand (M20, automation A3) ran benefit checks
  and authorisation requests for every appointment in the next 48 hours; anything it could not
  resolve inside its mandate (scheme portal down, clinical motivation required, member not found)
  is an attention item with the Hand's notes attached.
* M20: attention items are agent tasks with a persona owner (FDK), a state and an SLA timer.

**Edge cases.**
* Internet down at opening: the console loads today's queue from the Edge Gateway mirror; check-in
  and consent work offline and sync later; benefit checks queue.
* A room's licence expiry or overdue QA blocks its bookings (M02-R-006): the banner names the room
  and the patients affected; the Booking Hand has already proposed moves for her to confirm.

**Success measure.** The day is understood in under two minutes; every attention item has an owner
before the first patient arrives.

## Scene 2 - 07:34: a pre-checked-in scheme member arrives

**Situation.** Nomvula (PAT journey, Scene 1) arrives for lumbar spine X-rays. She did everything
on WhatsApp last night.

**What they see.** Nomvula scans the QR code from her confirmation at the kiosk, or Busisiwe types
three letters of her surname in the `Search`. The patient row expands: pre-check-in complete,
consent signed 19:42 yesterday, safety questions answered (pregnancy: no), ID verified on a previous
visit, scheme membership active, quote R612 scheme / R0 patient, authorisation not required. The
`CollectCard` says: "Collect: R0. Reason: scheme pays in full. Previous balance: none." A single
primary action: *Arrive*. The `IdScan` component prompts to scan the green ID book or smart card once
per year for records, showing when it was last verified.

**What they do.** Taps *Arrive*, scans the ID card because the annual verification is due (two
seconds), hands Nomvula a printed or WhatsApp queue status: "You are 2nd in line for Room 1."

**What the Platform does.**
* M07 Registration & Safety: `patient.arrived.v1` is emitted; the arrival time starts the wait-time
  clock; the wristband or queue ticket is printed with the study and room.
* M03 Patient Master Index: the ID scan reads the barcode on the smart card or the number on the
  green book, verifies the check digit, compares to the record, stores the verification date; the
  image of the document is stored under POPIA minimisation rules (number and photo only, encrypted).
* M08 Acquisition & Worklist: the Modality Worklist entry for Room 1 becomes "arrived" so the
  radiographer's console shows her next.
* M13 Results & Communication: the queue status message goes to her WhatsApp; the waiting-room screen
  (no names, ticket numbers only) updates.

**Edge cases.**
* The ID scan does not match the recorded number by one digit: the console shows both, asks which is
  correct, and records the correction with reason; a mismatch on name and date of birth blocks
  arrival pending PRM review (possible identity fraud or duplicate record).
* She forgot her scheme card: not needed; the benefit check was done with her membership number and
  ID.
* She brings a second referral for a different study: the desk adds an order from the photo (Intake
  Hand, same as booking) and the Authorisation Hand runs a quote in seconds; she is told the cost before
  the study is added.

**Success measure.** Check-in under 60 seconds; zero questions the patient already answered.

## Scene 3 - 08:05: cash patient at the desk during load-shedding

**Situation.** Sipho (PAT journey, Scene 2) arrives for his chest X-ray. The power has just gone
off; the UPS beeps once and the lights on the desk stay on.

**What they see.** The `CollectCard` reads: "Collect: R390 including VAT. Reason: cash patient.
Methods: card, PayShap, QR, cash. Previous balance: none." The card terminal is on UPS and connected
via the site's LTE failover. Busisiwe shows the QR on the console; Sipho pays from his banking app;
the card turns Signal: "Paid R390 08:06. Receipt sent by SMS."

**What they do.** Presents the payment options in order of cost to the patient (PayShap and QR have
no card fee for him), confirms payment, arrives him.

**What the Platform does.**
* M14 Revenue Cycle: the PSP webhook confirms the payment; the receipt (VAT invoice with the
  Practice's VAT number) is generated and sent; the charge is settled; `payment.received.v1`.
* M21: during grid loss the console runs against the Edge Gateway; the payment confirmation arrives
  over the LTE failover; if both links fail, the desk records "cash received" or "card offline slip"
  with a typed `Confirm` and the reconciliation queue for DEB picks it up on reconnect.
* M15 Finance & Consolidation: cash and card takings per till per user are posted for the end-of-day
  cash-up.

**Edge cases.**
* He can pay only R200 today: the desk offers the pre-configured payment plan (remaining R190 by
  PayShap request-to-pay in 14 days); the Collections Hand (A3) sends the reminder; no study is
  refused for a cash shortfall inside the Practice's policy threshold (configurable; above the
  threshold PRM approves).
* He asks for a discount: only rule-based discounts with reason codes; the console shows which apply.

**Success measure.** Front-desk collection rate for cash patients at or near 100 %; every payment has
a receipt within seconds, power or no power.

## Scene 4 - 08:40: an authorisation that is not there yet

**Situation.** Mr Khumalo arrives for a CT abdomen with contrast. His scheme requires
pre-authorisation. The Authorisation Hand requested it two days ago; the scheme has not responded, and this
morning the scheme's portal is returning errors.

**What they see.** The row shows the `Status` chip "Needs auth" in Beam and the attention item with
the Authorisation Hand's timeline: request submitted, reference number, two follow-up attempts, portal
error at 06:10. The `CollectCard` shows two scenarios side by side: "If authorised: scheme R4 180,
you R0" and "If not authorised: cash R3 900" (illustrative), with a third option: proceed under a
signed acknowledgement that the patient accepts liability if the scheme declines, which the
Practice's policy allows for this scheme and study class.

**What they do.** Asks the Authorisation Hand to phone the scheme now (the Hand places the call, navigates
the scheme's line, and reports back in the attention item), explains the options to Mr Khumalo in
the meantime in plain words, and when the Hand returns an authorisation number six minutes later,
arrives him with the scheme scenario locked in.

**What the Platform does.**
* M06: the Authorisation Hand's mandate includes phoning scheme authorisation lines with a script, quoting
  the practice number, member number, tariff codes and ICD-10, and capturing the authorisation
  number and any conditions (for example, "authorised for CT abdomen, contrast included, valid 30
  days"); the call is recorded and transcribed; the authorisation is stored on the order. Anything
  outside the mandate, such as a scheme asking for a clinical motivation, becomes a REF task.
* M14: the quote is re-issued on authorisation; the earlier quote and the new one are both kept.
* M19 Quality, Risk & Compliance: the patient-liability acknowledgement, when used, is a versioned
  consent document with the scheme, amount and reason.

**Edge cases.**
* The scheme declines: the console shows the reason code in plain language; the desk offers the cash
  price, a payment plan, or rebooking after an appeal; nothing is scanned on an assumption.
* The authorisation covers a different tariff code than the radiologist's protocol: the RAD console
  flags the mismatch before the scan; the Authorisation Hand requests an amendment.
* The patient insists on proceeding without any funding position: PRM approval is required and
  recorded.

**Success measure.** No patient scanned without a known funding position or a recorded, informed
choice; scheme phone time moved from the desk to the Hand.

## Scene 5 - 09:15: walk-in without a booking

**Situation.** A woman walks in with a referral for a wrist X-ray from an orthopaedic clinic across
the road; no booking, no message, a taxi to catch in an hour.

**What they see.** *New walk-in* opens a three-step flow: photograph the referral (Referral Hand
extraction, annotated fields), find or create the patient (search by ID, mobile, name and date of
birth; the `Id` component validates the number), and the funding position and next slot. The slot
engine shows "Room 2, next available 09:32" with the radiographer's current load.

**What they do.** Completes the three steps in about 90 seconds, hands over the tablet for consent
and safety questions (the same Prepare questions as the Patient Space, on the kiosk in the language
the patient chooses), collects R0 because the scheme covers it, and tells her she will be done by
10:00.

**What the Platform does.**
* M04, M03, M06, M05 run the same commands as a remote booking; walk-ins are not a separate path,
  only a shorter one.
* M05: the Booking Hand proposes the slot considering the room queue and the STAT list; walk-ins
  never displace priority work without PRM confirmation.
* M07: consent and questionnaire captured on the kiosk under the patient's language preference;
  signature by touch.

**Edge cases.**
* The patient has no ID document with her: the record is created with the number she gives and a
  verification flag; the claim will not be submitted until verified (the scheme will reject it
  otherwise); a reminder to bring the ID goes to her phone.
* Her scheme is a closed scheme with a designated service provider network that excludes this
  Practice: the quote shows the network co-payment clearly before she decides.

**Success measure.** Walk-in to arrived in under three minutes; no paper form created.

## Scene 6 - 10:10: a duplicate record and a merge

**Situation.** The overnight attention item: a patient booked via WhatsApp matched two existing
records, one under a maiden name at another Practice in the Group and one at this site with a
transposed ID digit.

**What they see.** The merge screen shows both records side by side with differences highlighted
(name, ID, scheme, address), the studies attached to each, and the Platform's similarity score in
the annotated style. A typed `Confirm` ("type MERGE") is required, and the survivor record must be
chosen explicitly.

**What they do.** Confirms with the patient at the desk which details are correct, chooses the
survivor, types MERGE.

**What the Platform does.**
* M03: the merge reassigns studies, orders, consents, dose records and accounts to the survivor;
  the merged record remains as a tombstone with a redirect; every downstream module reacts to
  `patient.merged.v1`. Cross-tenant merges require the data-sharing lawful basis recorded in M02.
* M14: open accounts are consolidated; statements reflect one patient.
* M19: merges are auditable and reversible within a window by PRM.

**Edge cases.**
* The two records are in fact two people (twins, father and son with similar names): the desk marks
  them "not duplicates" so the Hand stops proposing the merge.

**Success measure.** Zero unmerged duplicates persisting more than a day; zero incorrect merges.

## Scene 7 - 12:30: a patient with an outstanding balance

**Situation.** Mrs Adams arrives for an ultrasound. She has R760 outstanding from a CT last year that
her scheme paid short. She was never told clearly why.

**What they see.** The `CollectCard` shows today's amount (R0) and, separately, the previous balance
with the arithmetic from pattern 5.6: tariff × units − scheme paid − adjustments = owed, with a
plain-language reason ("Your scheme paid 80 % of the scheme rate for CT; the remaining 20 % is the
co-payment on your option"). It shows the statements sent and whether they were opened. It offers:
pay now, payment plan, or dispute.

**What they do.** Explains it once, kindly; Mrs Adams pays R300 and takes a plan for the rest.

**What the Platform does.**
* M14: the balance, the split between scheme and patient liability and the reason codes are the
  same data the DEB persona sees; the desk's actions are recorded against the account.
* M14 Collections Hand: pauses dunning while a plan is active; resumes respectfully if an instalment
  fails.

**Edge cases.**
* She disputes the balance: the desk logs a dispute with her words; the account is frozen from
  dunning until DEB resolves it.
* The balance is with a different Practice in the Group: it is shown for information only; the desk
  cannot collect on another legal entity's behalf unless a bureau agreement allows it.

**Success measure.** Previous balances explained in one sentence, never argued; collection at the
desk without conflict.

## Scene 8 - 14:00: kiosk supervisor mode and an anxious first-time kiosk user

**Situation.** An older patient is stuck on the kiosk's language screen.

**What they see.** Supervisor mode on the console shows the kiosk's current step and lets Busisiwe
finish the flow on her tablet, or switch the kiosk to large-touch mode with the patient's language.

**What the Platform does.**
* M07: the kiosk (1080 × 1920, 64 px targets, three-step maximum) and the console share the same
  check-in state; the supervisor takeover is logged.

**Success measure.** No patient abandoned at a kiosk; assisted check-ins are counted for training.

## Scene 9 - 16:45: closing the day

**Situation.** End of day cash-up and hand-over.

**What they see.** The day's summary: arrivals, no-shows (with the Booking Hand's contact
attempts), collections by method by user, unpaid cash due, the float, and any open attention items
handed to tomorrow. A Beam item lists three patients whose ID verification is still outstanding, which
will block their claims.

**What they do.** Counts the cash float against the console, reconciles card slips, hands over.

**What the Platform does.**
* M14 and M15: the cash-up is a posted document; variances above a threshold create an incident for
  PRM (M19).
* M05: no-shows feed the no-show prediction model with reason codes.

**Success measure.** Cash-up variance zero; all blocking items visible to tomorrow's desk.

## Moments that beat the market

* One screen for the whole day, developing most-critical-first, with every attention item owned.
* The `CollectCard` says what to collect, why, and how, including previous balances with the
  arithmetic shown, so money conversations are explanations rather than arguments.
* The Authorisation Hand makes the scheme calls and reports back; the desk never waits on hold.
* ID scan with check-digit validation and annual re-verification; merges require a typed
  confirmation and are reversible.
* Walk-ins take the same three-step path as remote bookings and never create paper.
* Payments by QR, PayShap or card work on UPS and LTE failover during load-shedding, with receipts by
  SMS within seconds.
* Kiosk supervisor takeover from the tablet, in the patient's language.
* Consent and safety answers captured once, at home or on the kiosk, never re-asked.

## Failure modes designed out

* Re-keying from paper: the Referral Hand extracts, the desk corrects only flagged fields.
* Scanning before the funding position is known: the row cannot be arrived without a quote,
  authorisation, cash payment or recorded informed choice.
* Wrong-patient arrival: ID scan plus name and date of birth; mismatches block.
* Silent duplicates: the Hand proposes, the desk decides, the merge is audited.
* Cash lost during power failures: offline receipts with typed confirmation and a reconciliation
  queue.
* Unexplained balances: every rand has a reason code and a plain-language sentence.
* Discounts at the desk's discretion: only rule-based discounts with reason codes; PRM approves the
  rest.
* Blocked claims discovered months later: unverified IDs and missing authorisations are surfaced on
  the day.
