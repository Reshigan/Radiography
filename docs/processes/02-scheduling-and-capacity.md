# 02 — Scheduling and Capacity (M05 Scheduling & Capacity)

## 1. Purpose

Place every validated Order (M04) into the earliest safe, funded, feasible slot across the
national network, and keep every room, modality and person as productively and humanely busy as
possible. Scheduling is where patient experience, clinical safety and revenue meet: a wrong slot
wastes a radiologist's contrast cover, an unsafe slot exposes a patient, an empty slot is revenue
lost forever, and a phone-only booking process loses the patient to a competitor.

"Better than the market" means: any patient can book in under 60 seconds on WhatsApp or the
Patient Space; a referrer sees live slots across every Site; cancellations are backfilled from a
waitlist within minutes; no-shows are predicted and managed rather than suffered; and the
**Booking Hand** completes routine bookings end-to-end, including the conversation.

## 2. Trigger

* An Order reaches `Validated` (or `Protocolling` complete) in M04 and needs a slot.
* PAT, REF or BKG asks to book, reschedule or cancel by WhatsApp, Patient Space, Referrer Space,
  phone, email or kiosk.
* A cancellation, no-show, modality downtime (M18), staff absence (M17), licence lapse (M02-R-006)
  or load-shedding schedule change frees or removes capacity.
* A hospital ADT event (admission, transfer, discharge) or an inpatient order arrives at a
  hospital Site.
* A STAT or walk-in patient presents.
* A serial or screening Order comes due (M04 §6.8, §6.9).
* A mobile X-ray route is planned for a day.

## 3. Actors

| Persona | Role |
|---|---|
| PAT | Chooses, confirms, reschedules, cancels; answers pre-booking safety screen |
| REF | Books on behalf of the patient; requests urgent slots; sees attendance |
| BKG | Runs the omnichannel booking inbox; handles exceptions from the Booking Hand; manages waitlists |
| FDK | Books walk-ins and same-day changes; manages the day's queue |
| RAD | Owns room readiness, protocol durations, insertion of STAT cases |
| RGT | Provides presence for contrast and procedures; approves overbooking on procedure lists |
| NUR | Sedation and contrast preparation windows |
| PRM | Sets templates, capacity policy, overbooking and load-shedding rules for the Site |
| BIO | Declares modality downtime and maintenance windows |
| CMP | Approves overrides of safety-related constraints; audits |
| Booking Hand | The M20 Hand that converts a conversation into a booked, confirmed appointment |

## 4. Preconditions

* Sites, rooms and modalities exist with licence status (M02) and operating hours.
* Modality templates (§7.1), procedure durations by protocol (from the M04 catalogue) and staff
  rosters (M17) are loaded.
* Reminder channels are configured with opt-in status per patient (POPIA, WhatsApp Business
  policy).
* Site power schedules (load-shedding stage tables, generator and UPS capacity per room) are loaded
  (§7.10).
* Hospital Sites have an ADT feed mapped (M21, packages/hl7-fhir).

## 5. Happy path (PAT books over WhatsApp after an e-referral)

1. M04 emits `order.validated`. M05 computes the **slot candidates**: feasible slots across all
   Sites within the patient's preferred radius (from their address or live location if shared),
   filtered by every constraint in §7.2, ranked by earliest time, distance, funding acceptance at
   the Site (M06: the Site is in the scheme's DSP network), and site load balance.
2. The Booking Hand sends PAT a WhatsApp message in their preferred language: "Dr Naidoo has
   referred you for an MRI of your right knee. Earliest: Thursday 09:40 at Umhlanga (12 km). Reply
   1 to book, 2 for other times, 3 to talk to someone."
3. PAT replies 1. The Hand places a **slot hold** (M21 coordination, 10 minutes) and runs the
   pre-booking screen relevant to the procedure: for MRI, "Do you have a pacemaker, implant, metal
   in your body, or are you pregnant?" (full screening happens in M07, but a "yes" here changes
   the slot: MRI safety review lead time, §7.2).
4. The Hand confirms the funding indicator from M06 (benefit confirmed, pre-authorisation in
   progress, or cash quote) and states the expected patient portion: "Your scheme has confirmed
   the benefit. You will pay R0 on the day." Money is never hidden.
5. The Hand books the slot, releases the hold, creates the Appointment, and sends the confirmation
   with preparation instructions, what to bring (ID, scheme card, referral if paper), the Site
   address with a map link, and a link to the Patient Space for pre-check-in (M07).
6. Reminders go out at T-48 h (with a reschedule option) and T-3 h (with "on my way" and travel
   time). A T-24 h reminder asks the patient to complete pre-check-in if not done.
7. On the day, the Appointment feeds the M07 queue and the M08 Modality Worklist. Attendance and
   completion are written back to the Order, and REF sees them.

Target: from `order.validated` to confirmed booking, median under 5 minutes of elapsed time with
under 60 seconds of patient effort.

## 6. Variants and exceptions

### 6.1 Phone booking

BKG answers; the transcript is streamed to the Booking Hand, which searches slots and drafts the
booking while the agent talks. The agent confirms with the patient and accepts the draft (A1 for
the field values, A3 for the search). If the caller is REF's receptionist booking for a patient,
the Hand captures the patient's mobile number and completes the confirmation with PAT directly.

### 6.2 Referrer books in Referrer Space

REF sees the same slot candidates for their patient and books directly; PAT receives confirmation
and can accept or change. A referrer-booked slot the patient has not confirmed within 24 h is
flagged and the Booking Hand follows up with PAT.

### 6.3 Reschedule and cancel (self-service)

PAT taps "Change" in a reminder or in Patient Space, sees alternatives, and moves the appointment.
Rules: free rescheduling up to the tenant's cut-off (default 4 working hours before the slot for
X-ray and ultrasound, 24 h for CT/MRI, 48 h for sedation and procedures); after the cut-off, a
late-change reason is captured and, for cash patients, any deposit policy from M06 applies.
Cancellation triggers backfill (§7.4) immediately. Rescheduling a slot that had a pre-authorisation
re-validates the authorisation window (M06).

### 6.4 Walk-in

FDK or the kiosk creates or finds the Order (M04 §6.7) and asks the slot engine for the next
feasible slot today at this Site, considering the live queue. Walk-ins with a valid referral for a
short procedure are inserted into "walk-in reserve" capacity defined on the template; when the
reserve is used up, the engine offers the next available slot or another nearby Site with live
travel time.

### 6.5 STAT and emergency insertion

A STAT Order (from casualty, a ward, or a referrer's urgent flag) bypasses slot search. The engine
selects the modality with the shortest disruption cost (current study end time, next patient's
flexibility, protocol duration), notifies RAD and, where contrast or a procedure is involved, RGT.
Displaced routine patients are re-slotted automatically and messaged with an apology and the new
time, and the displacement is logged for capacity analytics. STAT insertion is A2: it happens
automatically, RAD acknowledges on the console.

### 6.6 Hospital inpatient and ER flows (ADT-driven)

* ADT `A01/A02/A03/A08` messages create, move and close inpatient encounters at the hospital Site;
  the ward, bed and attending doctor are attached to any Order for that encounter.
* Inpatient Orders are scheduled into **inpatient blocks** on the template (for example 07:00 to
  08:00 and 13:00 to 14:00 for portable and departmental studies), with porter lead time as a
  constraint. The ward sees the planned time in the hospital system via `SIU` outbound messages
  or FHIR `Appointment`.
* Transfer or discharge cancels or re-routes pending appointments and informs the ward.
* ER studies are treated as STAT by default with the ER's own priority tiers mapped to the
  Platform's urgency values.

### 6.7 Mobile X-ray routes

For Practices that operate mobile units (nursing homes, mines, hospital wards, rural clinics), the
engine plans a daily **route**: a sequence of stops with expected studies per stop, travel time
(from a routing service or configured distances), setup time, radiation safety constraints at the
stop (controlled area set-up), and battery or generator capacity. The RAD mobile app shows the
route, the worklist per stop, and captures completed studies offline for sync (Edge Gateway
pattern, 07 §5). Route changes propagate to affected patients and facilities.

### 6.8 Sedation and paediatrics

Paediatric CT/MRI and any sedation case require: an anaesthetist or sedation practitioner in the
roster (M17), a NUR recovery slot, a longer protocol duration, a fasting instruction sent with the
confirmation, and a morning-block preference (configurable). Sedation slots are not
overbookable and not backfilled from the general waitlist.

### 6.9 Contrast and procedures

Contrast studies require a radiologist (or the tenant's defined covering practitioner) present or
reachable per the Practice's contrast reaction policy; the engine therefore schedules contrast
studies only in periods with RGT presence from the roster. Interventional and image-guided
procedures (biopsies, injections) use procedure lists owned by a named RGT, with pre-procedure
checks (anticoagulation, INR) as constraints from M07.

### 6.10 MRI safety lead time

A "yes" on any MRI screening item at booking or pre-check-in (implant, device, foreign body,
pregnancy) requires an MRI safety review by the MRI radiographer or radiologist before the slot.
The engine automatically holds a review window ahead of the appointment and, if the device cannot
be cleared in time, moves the appointment rather than let the patient arrive uncleared (M07 gate).

### 6.11 Waitlist

PAT or REF can join a waitlist for an earlier slot at any Site within a radius. Waitlist entries
carry the patient's availability windows and notice preference. When capacity opens, the backfill
process (§7.4) runs.

### 6.12 Load-shedding and downtime

When a Site's power schedule or an unplanned outage (Edge Gateway telemetry, M18) removes capacity,
the engine identifies affected appointments, applies the Site's rules (§7.10) and either keeps,
moves within the Site (to a room on generator), moves to another Site, or reschedules, messaging
patients with the reason in plain language. A modality fault from M18 does the same.

### 6.13 Patient cannot be reached

The Booking Hand tries the configured sequence (WhatsApp, SMS, then a call task to BKG) within its
leash (§7.11). After the last attempt the Order goes `On hold` and REF is informed that the
patient could not be reached.

## 7. Detailed design

### 7.1 Slot engine and modality templates

* A **template** describes a modality's week: operating windows per day, slot grid (for example 10
  minutes for radiography, 20 to 60 minutes for CT and MRI by protocol), blocks reserved for
  inpatients, walk-ins, procedures, screening, paediatrics, sedation, teaching, QA (M10) and
  maintenance (M18), and the staff and radiologist coverage the block assumes.
* Templates are versioned and effective-dated; PRM edits with a preview of the capacity impact.
  Public holidays (SA calendar) and Site-specific closures apply automatically.
* **Procedure duration by protocol** comes from the M04 catalogue, refined by measured actuals
  (MPPS start and end times, M08) per Site, modality model and protocol, so the engine learns
  that a particular MRI knee protocol on a particular scanner takes 24 minutes, not the 30 in
  the catalogue. Learned durations are presented as suggestions to PRM (A1) before they change
  the template.
* Slots are computed, not stored: the engine evaluates template plus constraints plus existing
  bookings on demand; holds and bookings are the only persisted state (Durable Objects or advisory
  locks for concurrency, 07 §3).

### 7.2 Constraints

| Constraint family | Examples | Source |
|---|---|---|
| Licence and QA | Room licence current; acceptance and QA not overdue | M02-R-006, M10 |
| Equipment | Modality up; maintenance window; contrast injector available; coil for MRI protocol; DXA or mammography unit specific | M18 |
| Staff | Radiographer with modality competence on shift; mammographer for MG; sonographer with sub-specialty (obstetric, vascular, MSK, paediatric); MRI-trained radiographer | M17 credentials and roster |
| Radiologist presence | Contrast cover; procedure list owner; paediatric sedation cover | M17 roster |
| Nursing | NUR for IV, contrast preparation, recovery | M17 |
| Patient | Language and interpreter availability; mobility and hoist; chaperone; fasting; bowel prep timing; renal function results pending (M07); metformin holding window | M03, M07 |
| Safety | MRI safety review lead time; pregnancy; sedation fasting | M07 |
| Funding | Site in DSP network; authorisation validity window; cash deposit received where required | M06 |
| Sequencing | Same-day multi-procedure ordering (non-contrast before contrast; barium after CT); minimum gap between contrast studies (eGFR recheck) | Catalogue rules |
| Power | Room on generator; stage-dependent capacity | §7.10 |
| Capacity policy | Walk-in reserve; overbooking ceiling; block purposes | PRM |

Each constraint is either **hard** (never violated; safety, licence, funding gates) or **soft**
(violable with a recorded reason and role; for example a shorter gap between two bookings). Soft
overrides by CMP-defined roles are audited.

### 7.3 National multi-site search ("earliest anywhere near me")

* Search across all Sites of all Practices a patient may attend (their scheme's DSP network,
  their consent to be seen by another Practice in the Group, distance radius). Results show time,
  Site, distance and travel estimate, patient portion, and whether the referring practitioner's
  delivery preferences are supported.
* Ranking weights are configurable by the Group (default: earliest first, then distance, then
  Site load balance) and never rank a Site above a closer, earlier one for commercial reasons
  without disclosure ("We suggested Sandton because it has the earliest slot").
* Cross-Practice visibility of a patient's Order is a POPIA matter: the search shows slots without
  transferring the Order; the Order moves to the chosen Practice only when the patient confirms.

### 7.4 Waitlist and cancellation backfill

1. A slot frees (cancellation, reschedule, template change, no-show release).
2. The engine matches waitlist entries by procedure, Site or radius, availability window and
   safety readiness, ranked by urgency, then waitlist age, then no-show risk (lower risk first
   for short-notice slots).
3. The Booking Hand offers the slot to the top candidate ("A slot opened at 14:20 today at
   Randburg. Reply YES within 15 minutes to take it."), holds it for the offer window, and moves
   down the list on decline or timeout. Offers per freed slot are capped by the leash.
4. Accepted offers re-validate funding and safety prerequisites for the new time.
5. Unfilled slots older than the offer cycle are released to open booking and, for same-day slots,
   shown to walk-ins.

Target: cancellations more than 24 h out backfilled ≥ 70 %; same-day cancellations ≥ 40 %
(illustrative, reported per Site).

### 7.5 No-show prediction and overbooking policy

* A no-show risk score is computed per appointment from: lead time, channel, prior attendance,
  reminder responses, distance and travel mode, funding status (unresolved co-payment is a strong
  signal), weather and load-shedding stage on the day, time of day, procedure preparation burden.
  It is an M11-registered model with monitoring by AIO; the score is a *score*, never shown to
  the patient, and never used to refuse a booking.
* Uses: reminder intensity (an extra confirmation request for high-risk appointments), waitlist
  ranking, and **overbooking**: PRM sets a ceiling per template block (for example up to one
  extra 10-minute radiography slot per hour when the expected no-show rate exceeds 15 %). The
  engine overbooks only when the sum of no-show probabilities in the block supports it and never
  on sedation, procedure, paediatric or MRI blocks.
* Fairness: the model is checked for disparate impact by language, Site and funder type (AIO
  quarterly review); features that proxy for protected characteristics are excluded.

### 7.6 Reminders and confirmations

* Channels: WhatsApp (opt-in through the patient's first inbound message or explicit consent),
  SMS fallback, email, voice call task for patients without a mobile phone.
* Cadence (configurable): confirmation at booking; T-48 h with reschedule option; T-24 h
  pre-check-in nudge; T-3 h with travel time and "I'm running late" option; post-visit message
  with results expectation (M13).
* Content rules: ≤ 3 lines, ≤ 3 buttons, plain language, patient's language, no clinical detail
  beyond the procedure name (POPIA data minimisation); a "do not message me on WhatsApp"
  preference is honoured immediately.
* Two-way: replies are understood by the conversation engine (confirm, change, cancel, question)
  and questions go to the Booking Hand, then to BKG if outside its mandate.

### 7.7 Queue and day management

The day view per Site shows arrivals, waiting, in room, done, and running late, with predicted
delay per room from actual versus planned durations. FDK and RAD see the same board; PAT sees a
live "you are next after 2 people, about 15 minutes" in Patient Space (M07 §queue).

### 7.8 Capacity analytics (M16 feeds)

Utilisation by modality, room, hour and day; template fill rate; lead time to third-next-available
slot; no-show and late-cancel rates by Site and channel; backfill rate; STAT displacement count;
walk-in reserve usage; load-shedding lost slots; sonographer sub-specialty demand versus supply;
forecast demand by referrer cohort. Outputs feed the PRM control tower and EXE what-if modelling
("a second CT at Site X").

### 7.9 Appointment data

Appointment: id, order_id, patient_id, site, room, modality, protocol, planned start and end,
duration source (catalogue or learned), block type, status (`Held`, `Booked`, `Confirmed`,
`Reminded`, `Arrived`, `In room`, `Completed`, `No-show`, `Cancelled`, `Rescheduled`), channel,
booked_by (person or Hand with provenance), constraints evaluated and any soft overrides, no-show
score with model version, reminder log, travel estimate, waitlist links, displacement links.
Events: `appointment.booked`, `appointment.rescheduled`, `appointment.cancelled`,
`appointment.no_show`, `slot.freed`, `slot.backfilled`, `capacity.reduced` (with cause).

### 7.10 Load-shedding-aware scheduling

* Each Site stores: its municipal or utility load-shedding block, the stage schedule table
  (imported from the utility's published schedule where available, or maintained by PRM), which
  rooms are on generator or UPS, generator capacity in kVA versus modality draw (an MRI often
  cannot run on a Site generator; radiography and ultrasound usually can), fuel autonomy, and
  Edge Gateway UPS runtime.
* When the current stage is known, the engine derives per-room "power-safe" windows. Slots for
  modalities that cannot run in a scheduled outage are not offered in those windows unless the
  room is on adequate generator capacity. Existing appointments in newly affected windows go
  through §6.12.
* Stage changes announced at short notice are handled as capacity events; the Booking Hand
  messages affected patients with the reason and options.
* The technologist console and Edge Gateway continue acquisition for rooms that have power; the
  worklist is served locally (07 §5), so the schedule remains valid offline.

### 7.11 The Booking Hand (M20)

| Element | Definition |
|---|---|
| Mandate | Book, confirm, reschedule and cancel appointments end-to-end over WhatsApp, SMS, email and phone transcripts; run pre-booking screens; offer waitlist slots; send reminders and answer routine questions (preparation, address, parking, what to bring, cost as stated by M06). |
| Tools | `slot.search`, `slot.hold/release`, `appointment.book/reschedule/cancel`, `waitlist.add/offer`, `message.send` (templated and free-form within style rules), `funding.status_read` (M06), `safety.prescreen` (M07), `task.create` (BKG), `patient.contact_read` (M03) |
| Leash | Books only into open capacity and walk-in reserve; never overrides hard constraints; never books sedation, paediatric anaesthesia or interventional lists (those are BKG/RGT with the Hand assisting at A1); at most 5 outbound messages per patient per day and 3 slot offers per freed slot; cannot state a price other than the M06 quote; cannot promise a report time other than the published SLA; stops and hands to BKG when the patient expresses distress, asks a clinical question, or after two misunderstandings. |
| Automation level | A3 for routine bookings, reschedules, cancellations, reminders and waitlist offers; A1 on phone (agent accepts); A2 for STAT displacement re-slotting (RAD acknowledges). |
| Data | Demographics and contact details, Order procedure and preparation, funding status summary, no-show score band. Never images, reports or the clinical question beyond what the patient must be told. |
| Provenance and audit | Every booking made by the Hand records the conversation excerpt that constituted consent, the slot candidates considered, and the model version. BKG reviews a daily sample; conversation quality scores go to AIO. |

## 8. Automation level summary

| Step | Level |
|---|---|
| Slot candidate computation, constraint evaluation | A4 (deterministic engine) |
| Booking conversation (WhatsApp, web) | A3 (Booking Hand) |
| Phone booking | A1 field acceptance, A3 search |
| Reminders and confirmations | A3 |
| Waitlist backfill | A3 |
| No-show scoring and overbooking | A2 (PRM sets ceilings; engine applies; exceptions reviewed) |
| STAT insertion and displacement | A2 |
| Load-shedding capacity events | A2 |
| Template changes, learned durations | A1 (PRM accepts) |
| Sedation, paediatric anaesthesia, interventional lists | A1 |

## 9. Requirements

* M05-R-100 The Platform MUST compute slots from versioned, effective-dated modality templates and
  the constraint families in §7.2, and MUST persist only holds and bookings, not slot inventories.
* M05-R-101 Hard constraints (licence and QA currency, equipment availability, required staff
  competence, radiologist presence for contrast and procedures, MRI safety review lead time,
  sedation requirements, funding gates, power feasibility) MUST NOT be overridable by any user or
  Hand; soft constraints MAY be overridden by CMP-defined roles with a recorded reason.
* M05-R-102 The Platform MUST offer a national multi-site search ranked by configurable weights
  and MUST disclose to the patient why a Site is recommended.
* M05-R-103 The Platform MUST support slot holds with expiry to prevent double booking under
  concurrent channels.
* M05-R-104 Procedure durations MUST be derived from the catalogue and refined from MPPS actuals;
  refinements MUST be presented to PRM for acceptance before changing templates.
* M05-R-105 The Platform MUST provide self-service reschedule and cancel for PAT and REF with
  configurable cut-offs and MUST trigger backfill on every freed slot.
* M05-R-106 Waitlist offers MUST be time-boxed, ranked by urgency then age, and capped per freed
  slot.
* M05-R-107 No-show risk MUST be an M11-registered model with provenance, MUST NOT be shown to the
  patient or used to refuse a booking, and MUST be reviewed for disparate impact quarterly.
* M05-R-108 Overbooking MUST be limited by PRM-set ceilings per block and MUST be disabled on
  sedation, paediatric, procedure and MRI blocks.
* M05-R-109 Reminders MUST respect channel opt-in and opt-out, MUST follow the WhatsApp content
  rules in 06 §3, and MUST minimise clinical detail.
* M05-R-110 STAT Orders MUST bypass slot search, MUST select the least-disruptive modality, MUST
  notify RAD (and RGT where relevant), and MUST re-slot displaced patients automatically with
  notification.
* M05-R-111 Hospital Sites MUST consume ADT events to create, move and close encounters and MUST
  publish planned times back to the hospital via SIU or FHIR `Appointment`.
* M05-R-112 The Platform MUST support mobile X-ray routes with stops, travel and setup time, and
  offline worklists via the RAD mobile app.
* M05-R-113 Each Site MUST store its load-shedding schedule, generator and UPS capacity per room,
  and the engine MUST derive power-safe windows and handle stage changes as capacity events.
* M05-R-114 Modality downtime, licence lapse and roster gaps MUST reduce capacity automatically
  and trigger re-slotting with patient notification.
* M05-R-115 The Booking Hand MUST operate under the leash in §7.11, enforced by the M20 runtime,
  and MUST record the conversation excerpt that constituted the patient's consent to book.
* M05-R-116 Every appointment MUST record who or what booked it, the constraints evaluated, and
  any soft overrides.
* M05-R-117 Capacity analytics in §7.8 MUST be available per Site, Practice and Group, and
  third-next-available lead time MUST be computed daily per modality.
* M05-R-118 Public holidays and Site closures MUST be applied automatically to templates.
* M05-R-119 The Platform SHOULD learn preferred appointment times per patient cohort to improve
  first-offer acceptance.
* M05-R-120 The Platform MAY offer patients a live travel-time-based "leave now" prompt where
  they have shared location.

## 10. SLA targets and KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Time-to-appointment (routine) | Median days from `order.validated` to planned start, by modality | X-ray same day; US ≤ 3 days; CT ≤ 3 days; MRI ≤ 7 days |
| Time-to-appointment (urgent) | Urgent Orders scheduled within 24 h | ≥ 95 % |
| STAT start | STAT Order to acquisition start | ≤ 30 min median (departmental), ≤ 15 min ER |
| Booking effort | Patient messages to complete a booking | ≤ 3 |
| Booking Hand completion rate | Bookings finished by the Hand without BKG | ≥ 75 % |
| First-offer acceptance | Bookings taking the first slot offered | ≥ 60 % |
| Fill rate | Booked and attended minutes / template minutes | ≥ 85 % CT/MRI; ≥ 75 % X-ray |
| No-show rate | No-shows / booked | ≤ 6 % (from a market baseline that is typically well above this) |
| Backfill rate | Freed slots re-filled | ≥ 70 % (> 24 h notice), ≥ 40 % (same day) |
| Third-next-available | Days to the third open slot per modality | Tracked; alert when above target |
| Reminder delivery | Reminders delivered on the primary channel | ≥ 98 % |
| Load-shedding lost slots | Slots lost to power per week | Tracked per Site; trending down after generator investment decisions |
| Displacement | Routine patients displaced by STAT per 100 STAT | Tracked |
| Inpatient TAT | Inpatient order to completed study | ≤ 4 h median, ≤ 24 h P95 |

## 11. Controls

| ID | Control | Type |
|---|---|---|
| C-01 | Hard-constraint enforcement in the engine; soft overrides role-limited and audited | Preventive |
| C-02 | Slot holds with expiry; single-writer coordination per slot | Preventive |
| C-03 | Booking Hand leash (message caps, offer caps, no price or clinical statements, hand-off triggers) enforced by M20 | Preventive |
| C-04 | Consent excerpt stored for every Hand booking | Detective |
| C-05 | Opt-in registry checked before every outbound message; immediate opt-out honouring | Preventive |
| C-06 | No-show model fairness review and monitoring by AIO; score never patient-visible | Detective |
| C-07 | Overbooking ceilings per block; disabled on safety-sensitive blocks | Preventive |
| C-08 | Licence, QA and downtime feeds remove capacity automatically | Preventive |
| C-09 | MRI safety lead-time hold; appointment moves rather than proceeds uncleared | Preventive |
| C-10 | Displacement log for STAT insertions reviewed monthly by PRM | Detective |
| C-11 | Cross-Practice search shows slots without transferring the Order until the patient confirms | Preventive (POPIA) |
| C-12 | Template changes versioned with capacity impact preview and PRM approval | Preventive |
