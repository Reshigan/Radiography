# Journey: BKG — Central Booking and Contact Centre

This journey follows the Central booking persona (BKG) through a shift in the Group's contact
centre, which books for every Practice on the Platform under the MSO's management agreements. Each
scene is written as: Situation, What they see, What they do, What the Platform does, Edge cases,
Success measure. Amounts and targets are illustrative and stored as configurable reference data.

## Persona snapshot (from 04-personas)

| Item | Detail |
|---|---|
| Who | Central booking and contact-centre agents employed by the MSO, booking across all Practices and Sites |
| Goals | Convert every referral into a booked, funded appointment at the best site |
| Better than market | Omnichannel inbox (call, WhatsApp, email, fax-to-digital, portal); AI slot recommendation across all sites; the Booking Hand handles routine requests end-to-end |
| Metrics | Conversion rate, average handling time, fill rate |

Design lens: **Business** (Bone surface, Dense L3, Standard W2, Marrow accent). The Booking console
is a `Queue` of conversations and tasks with the `Inspector` showing the patient, the order, the
funding position and the slot search. Agents are MSO users acting as operator for each Practice
under POPIA, and the console shows which Practice's tenant they are working in at all times.

## Scene 1 - 08:00: the omnichannel inbox

**Situation.** Thuli starts her shift. Overnight, the Booking Hand (M20, automation A3) handled
routine WhatsApp bookings on its own. What remains is the exception queue.

**What they see.** The inbox develops most-critical-first: two urgent requests (a referrer asking for
a same-day CT, a patient whose MRI was cancelled by a scanner fault), then the Hand's escalations
with its notes ("Could not match patient: two candidates", "Scheme portal down, quote not
guaranteed", "Patient asked for a site outside the province"), then new items by channel: 14 phone
callbacks, 22 WhatsApp threads, 9 emails with attachments, 3 fax-to-digital referrals, 6 Referrer
Space requests. A `StatTile` strip shows: last night the Hand booked 63 appointments unaided,
escalated 11, and 4 patients asked for a person.

**What they do.** Takes the two urgent items first, then works the exception queue by SLA timer.

**What the Platform does.**
* M21 Platform Core: every channel lands in one conversation object with the patient, referral and
  order attached where matched; fax and email attachments go through the Referral Hand for extraction
  (M04).
* M20: the Booking Hand's mandate covers: match patient (single high-confidence candidate only),
  create order from referral, run benefit check and quote (via the Authorisation Hand), offer up to three
  slots at sites within a configurable radius, confirm and send preparation; its leash forbids
  booking studies needing pre-authorisation that has not been granted, booking outside licence or
  roster constraints, and any conversation where the patient asks for a person or expresses
  distress; those escalate with a full transcript.
* M16 Analytics & Insight: the tiles are live projections of `appointment.booked.v1`,
  `conversation.escalated.v1` and handling-time events.

**Edge cases.**
* The Hand and an agent work the same thread: the conversation has claim semantics; the agent's
  claim pauses the Hand, which resumes only when released.
* A message arrives in a language without a catalogue: the Hand replies in English with an offer of
  a call-back in the patient's language, and escalates.

**Success measure.** Routine bookings handled without an agent at a rising share; exception items
answered inside SLA.

## Scene 2 - 08:10: a referrer's rooms phone for a same-day CT

**Situation.** A receptionist from a pulmonologist's rooms calls: a patient with suspected
pulmonary embolism needs a CT pulmonary angiogram today; the patient is in the rooms now.

**What they see.** The caller's number matches the referrer's practice; the `Inspector` opens with
their recent referrals. Thuli captures the patient by ID number; the order form is pre-filled with
the referrer and the study; the Authorisation Hand runs the benefit check while she talks; the slot search
shows CT capacity across the three nearest sites with the contrast nurse (NUR) resource, the
radiologist coverage, and an "urgent" priority that can pull a slot forward within the Practice's
urgent policy. The quote shows the scheme portion and the PMB position for a suspected pulmonary
embolism (suggested by the Coding Hand from the indication, marked as a suggestion).

**What they do.** Books 10:40 at the site nearest the rooms, reads the preparation to the receptionist
(eGFR result if available, nothing to eat for two hours, bring the scheme card), and sends the
patient a WhatsApp confirmation with the safety questions.

**What the Platform does.**
* M05 Scheduling & Capacity: the urgent priority class allows pulling a routine slot forward and the
  Booking Hand offers the displaced routine patient a same-day alternative with a courtesy message,
  within its mandate; if the patient declines, the item escalates to Thuli.
* M06: authorisation is requested immediately; the scheme's emergency and PMB rules are applied by
  the Authorisation Hand; where the scheme requires authorisation within a window after an emergency, the
  Hand schedules the follow-up.
* M07 and M13: the contrast safety questions and the eGFR requirement go to the patient in the
  confirmation; the NUR console shows the pending eGFR.

**Edge cases.**
* No CT capacity within the clinical window: the slot search widens to the next Practice in the
  Group; the patient's referrer is told which site; the transfer of the order between tenants is
  recorded with consent.
* The scanner at the chosen site fails at 10:00 (M18 Assets & Engineering raises a downtime): the
  Booking Hand moves the patient and messages both the patient and the referrer before they arrive.

**Success measure.** Urgent referral to confirmed slot in one call under five minutes; the displaced
patient rebooked the same day.

## Scene 3 - 09:30: a photo of a referral on WhatsApp with a mismatch

**Situation.** The Booking Hand escalated a WhatsApp thread: the photo of a referral names a patient
whose ID number belongs to a different person in the Patient Master Index.

**What they see.** The thread with the Hand's messages so far, the extracted fields in annotated
style, and the two candidate records. The `Provenance` chip on the ID field shows a low confidence
band: the handwriting is ambiguous between a 1 and a 7.

**What they do.** Sends a short WhatsApp message asking the patient to type their ID number and date
of birth; the answer resolves it; Thuli accepts the corrected field and hands the thread back to the
Hand, which completes the booking and the quote.

**What the Platform does.**
* M03 Patient Master Index: candidate matching with a score; an agent decision is required whenever
  two candidates exceed the threshold.
* M20: the hand-back to the Hand is explicit; the Hand continues from the corrected state and
  reports completion.

**Edge cases.**
* The patient is a minor: the Hand asks for the guardian and only continues under a guardian record
  (M03 relationship types).
* The referral is for someone else (a relative booking on their behalf): the Hand records the helper
  and asks for the patient's consent to messaging before sending anything clinical.

**Success measure.** No booking created against a wrong identity; agent time spent only on the
ambiguous digit.

## Scene 4 - 11:00: finding MRI capacity across the network

**Situation.** A patient with a knee MRI referral on a scheme that requires authorisation wants the
earliest slot anywhere in Gauteng, after 16:00, because he cannot take leave.

**What they see.** The slot search across all sites in the province: a `Calendar` in modality view
with the slot recommendation ranked by the patient's constraints (after 16:00, taxi route from his
suburb where known, scanner suitability for the study, radiologist coverage for knee MRI). The
recommended slot is at a site 12 km away tomorrow at 17:20; the nearest site has nothing after 16:00
for nine days. The authorisation status shows "requested, expected within 24 hours" from the Funding
Hand.

**What they do.** Offers the recommendation and a second option; the patient takes the first; Thuli
sets the appointment to "confirmed subject to authorisation" and the Hand will confirm or rebook
when the scheme responds.

**What the Platform does.**
* M05: the slot engine ranks by hard constraints (licence, roster, modality capability, room type,
  slot type) then soft constraints (distance, transport, patient preference, predicted no-show risk,
  site utilisation targets); the ranking reasons are visible to the agent.
* M06: the appointment carries a funding condition; the Authorisation Hand resolves it and emits
  `authorisation.granted.v1` or `authorisation.declined.v1`; the Booking Hand acts on either within
  its mandate (confirm, or offer cash quote and alternatives).
* M13: the patient receives the conditional status honestly ("Your slot is held. We are waiting for
  your scheme. We will confirm by tomorrow 17:00.").

**Edge cases.**
* The scheme requires the patient to use a designated service provider network the Practice is not
  in: the quote shows the co-payment and the Hand offers the nearest in-network Bonakala Practice if
  there is one.
* The patient asks for a price for "just the scan" at a competitor: the agent's script gives
  Bonakala's price only; competitor names are never recorded.

**Success measure.** Fill rate on evening MRI slots; time-to-appointment for MRI measured across the
network, not per site.

## Scene 5 - 13:20: a cancellation and the waitlist

**Situation.** A patient cancels tomorrow's 08:00 ultrasound by WhatsApp.

**What they see.** Nothing, unless it fails. The Booking Hand cancels the appointment, releases the
slot, and offers it to the first three compatible patients on the waitlist in order (same study,
same site or within radius, preference for earlier). The first accepts within four minutes. Thuli
sees a completed item in the activity feed: "Slot 08:00 US Room 3 backfilled from waitlist; 2
patients declined, 1 accepted; quote re-issued."

**What the Platform does.**
* M05: waitlist entries carry constraints and expire; offers are time-boxed; the slot is held per
  offer with a lock so it can never be double-booked.
* M06: each offer includes the patient's own quote, because the benefit position differs per patient.
* M16: fill rate and backfill lead time are tracked per site and modality.

**Edge cases.**
* Nobody on the waitlist accepts: the slot returns to open inventory and the site's PRM sees the gap
  on the control tower; if the no-show prediction for the day is high, the Hand may offer the slot as
  an overbook candidate within the Practice's overbooking policy.
* The cancelling patient has a pre-authorisation with a validity window: the Hand rebooks within the
  window or requests an extension.

**Success measure.** Cancelled slots refilled without agent effort; overbooking used only where the
policy allows and never for MRI or contrast studies.

## Scene 6 - 15:00: no-show risk and the day-before pass

**Situation.** The Booking Hand (A4 for routine reminders) has sent tomorrow's reminders. Some
patients have not confirmed.

**What they see.** A list of tomorrow's unconfirmed appointments ranked by predicted no-show risk
(annotated style, with the model version and the top reasons: unconfirmed, first visit, cash unpaid,
distance, past no-show). Thuli's task is the top of the list: phone calls in the patient's preferred
language, with a script that offers to reschedule rather than pressure.

**What they do.** Makes eleven calls, reschedules three, confirms six, marks two as unreachable
(the Hand will try once more by SMS).

**What the Platform does.**
* M05 no-show prediction: a score per appointment with reasons; the score changes slot backfill and
  overbooking decisions, never the patient's treatment or price.
* M13: every contact attempt is logged with channel and outcome; reminder content comes from the
  approved catalogue in the patient's language, for example the Afrikaans reminder "Onthou: u
  afspraak is môre 09:15 by Bonakala Bloemfontein. Antwoord JA om te bevestig." (English gloss:
  "Reminder: your appointment is tomorrow 09:15 at Bonakala Bloemfontein. Reply YES to confirm.")

**Edge cases.**
* A patient says the taxi fare is the problem: the agent may offer a site closer to home if one has
  capacity; the reason code "transport" is recorded so that the Group's site planning sees it.
* A patient asks to cancel because of cost: the agent re-explains the quote and offers a payment
  plan; if the patient still cancels, the referrer is notified of a cost-related non-attendance.

**Success measure.** No-show rate falling against baseline; every no-show has a reason where one
could be learned.

## Scene 7 - 16:30: quality, handling time and the Hand's leash

**Situation.** End of shift review with the team lead.

**What they see.** Per-agent and per-Hand metrics side by side: conversion rate (referrals to booked),
average handling time, first-contact resolution, patient feedback from the one-question WhatsApp
survey, and the Booking Hand's escalation reasons ranked. The team lead can propose a leash change
(for example, allow the Hand to book contrast CT when the eGFR is on file) as a change request to
AIO and PRM; nothing changes the Hand's mandate from the console.

**What the Platform does.**
* M20 Agent Runtime: every Hand action is auditable with inputs, outputs and the mandate check;
  leash changes are versioned approvals.
* M16: the semantic layer defines conversion and handling time identically for agents and Hands so
  that the comparison is fair.

**Success measure.** Escalation reasons shrinking over time through approved leash changes, not
through the Hand guessing.

## Moments that beat the market

* One inbox for every channel, every Practice and every site, with the patient, referral and funding
  position attached before the agent reads the first line.
* The Booking Hand completes routine bookings end-to-end overnight, and escalates with a transcript
  and a reason, never silently.
* Slot recommendation across the whole network ranked by the patient's real constraints, including
  transport and time of day, with the reasons shown.
* Quotes per patient inside every slot offer and every waitlist offer.
* Cancellations backfilled from the waitlist in minutes with time-boxed offers and locks that make
  double-booking impossible.
* Conditional bookings that tell the patient the truth about pending authorisation and a time by
  which they will hear.
* No-show risk used to help the patient (reschedule, closer site), never to penalise.
* Fair, identical metrics for agents and Hands.

## Failure modes designed out

* Booking against the wrong patient: two candidates above threshold always require a human.
* Double-booking under load: per-slot locks and time-boxed offers.
* Booking a study that cannot be funded: the Hand's leash forbids confirming without a funding
  position the patient has seen.
* Booking into a room with an expired licence or overdue QA: hard constraint from M02.
* Machine-translated reminders: catalogue only, per language, human-approved.
* Agent and Hand talking over each other: claim semantics on conversations.
* Referrals stuck in an email inbox or a fax tray: every attachment becomes an extracted order with
  an SLA timer.
* Leash changes by convenience: mandates change only through versioned approvals by AIO and PRM.
