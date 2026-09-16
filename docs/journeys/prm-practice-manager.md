# PRM — Practice / Site Manager: Persona Journey

## Persona snapshot

| Item | Detail |
|---|---|
| Code | PRM |
| Who | Practice manager or site manager. Runs one Site (or a small cluster) for a Practice: capacity, staff, equipment, patient experience, cash. Reports to the Practice's principals and, through the management agreement, to the MSO's operations lead. |
| Goals | Run the site: capacity, staff, equipment, patient experience, cash. |
| Frustrations today | Finding out about problems from the waiting room; phone calls to the vendor, the scheme and the agency; rosters in spreadsheets; no single view of the day; month-end numbers that arrive too late to act. |
| Better than market | One daily control tower; alerts before problems (downtime, no-shows, staff gaps, stock); actions delegated to Hands. |
| Surfaces | Business lens (Bone, Dense L3, Standard W2, Marrow). Control Tower (M16 read models over M05, M08, M17, M18, M19, M14), `Heatmap`, `Calendar`, `KanbanBoard`, `Inspector`, Command palette. |
| Metrics | Modality utilisation, patient wait, revenue versus budget. |
| Modules touched | M05 Scheduling & Capacity, M07 Registration & Safety, M08 Acquisition & Worklist, M14 Revenue Cycle, M15 Finance & Consolidation, M16 Analytics & Insight, M17 Workforce, M18 Assets & Engineering, M19 Quality, Risk & Compliance, M20 Agent Runtime, M21 Platform Core. |

The journey follows Lerato, site manager at Bonakala Imaging Umhlanga (Practice B, the 51/49 JV), a site with two CT scanners, one MRI, mammography, two general X-ray rooms, ultrasound and a DXA unit.

---

## Scene 1 — The daily control tower

**Situation.** 07:20 SAST. The site opens at 07:30. Lerato is at the front desk with a tablet.

**What they see.** The Control Tower develops most-critical-first. Today the first thing on the page is a Beam `Banner`: "CT 2 acceptance QA due in 3 days; scheduling on CT 2 blocks after that unless BIO records the test." Then the day: a `Heatmap` of booked slots by room and hour; `StatTile`s for Booked 186 · Predicted no-show 14 · Walk-in capacity 22 · Staff on shift 19 of 19 · Contrast stock 6 days · Open complaints 1 · Yesterday's revenue versus budget +3 %. Below, a `KanbanBoard` of Hand actions overnight: the Booking Hand filled 9 slots from the waitlist after 4 cancellations; the Benefit Hand obtained 31 authorisations for today's CT and MRI patients and could not obtain 2; the Roster Hand confirmed the agency sonographer for Thursday. Each card carries provenance and a link to the audit stream.

**What they do.** Lerato reads the two failed authorisations. One patient's scheme option does not cover MRI out of hospital; the Platform has already sent the patient a plain-language quote (R0 scheme, R4 850 patient, illustrative) with a payment plan option, and the patient confirmed on WhatsApp. The other patient has not replied. Lerato asks the front desk to call. She opens the CT 2 banner, sees that BIO's maintenance Hand has already scheduled the QA test for tomorrow, and closes it. She looks at the `Heatmap`: 11:00 to 13:00 on MRI is over-booked against the historical average scan time for the protocols booked. The Platform suggests moving two routine lumbar spine studies to 14:30; the Booking Hand has already offered the patients the change and one accepted. She approves the second offer.

**What the Platform does.**
- M16 assembles the Control Tower from read models refreshed on events, not batch: `appointment.booked.v1`, `auth.granted.v1`, `roster.confirmed.v1`, `stock.level.v1`, `modality.status.v1`, `complaint.opened.v1`.
- The no-show prediction (M05, Class 4 output monitored by AIO) drives overbooking within limits Lerato sets; the Booking Hand (A3) fills cancellations from the waitlist and offers moves, but never moves a patient without their acceptance.
- Contrast stock days are computed from the barcode decrements of the last 14 days (M18) and today's contrast-protocol bookings.
- Licence and QA states from M10 and M18 gate the slot engine (M02-R-006): the banner shows the countdown to a block, with CMP override available and audited.

**Edge cases.**
- A referrer's practice is closed for a week; the referral forecast for that referrer drops and the `Heatmap` shows expected soft spots so Lerato can open walk-in capacity.
- School holidays shift paediatric demand; the forecast uses the SA school calendar as reference data.

**Success measure.** Lerato has seen every risk for the day by 07:30; no patient waits more than 20 minutes past their slot on a day with no equipment failure; walk-in capacity is used, not wasted.

---

## Scene 2 — A CT goes down

**Situation.** 09:52. CT 1 (the newer, 128-slice unit) reports a tube arc fault and shuts down mid-list with 23 CT patients still booked for the day, six of them with contrast, two of them trauma referrals from the nearby casualty.

**What they see.** A Flare `Banner` replaces everything: "CT 1 down (tube fault) 09:52. 23 patients affected. Vendor ticket opened. Options ready." The `Inspector` shows the modality's status from M18 (error code from the modality log via the Edge Gateway, tube arc count trend over the last 30 days with the last week's rise annotated, warranty and service-contract terms, vendor SLA: 4 h response, 24 h resolution, illustrative). The Platform has already:
- Opened a vendor ticket through the M18 integration with the device serial, error log and site contact (A3 within the Maintenance Hand's mandate).
- Recalculated the day: CT 2 can absorb 14 of the 23 with extended hours to 18:00 if the roster allows; the two trauma studies are moved to CT 2 immediately; 7 patients are offered Bonakala Imaging Gateway (the nearest Group site, 14 km away) or tomorrow.
- Drafted, but not sent, WhatsApp messages to the 7 in their chosen languages.

**What they do.** Lerato reads the options. She approves the CT 2 plan and asks the Roster Hand to confirm the two radiographers who can extend to 18:00; the Hand offers the overtime per the Practice's policy and both accept within minutes. She approves the 7 messages after editing one: a patient who is 84 and comes by taxi should be offered tomorrow at Umhlanga, not another site. She calls the casualty registrar to say the trauma studies are done on CT 2. She asks the Platform to tell BIL that today's CT 1 studies are reduced (so the unbilled forecast is right) and to tell the Practice's principals through the shareholder feed that CT 1 is down and the estimated revenue effect is R38 000 if not fixed today (illustrative, computed from the booked protocols and their funder rates).

**What the Platform does.**
- `modality.down.v1` from M18 triggers the Capacity Hand (M05, A3): reassign, re-offer, notify, and compute the financial exposure. It may move studies between rooms at the same site without approval; moving a patient to another site or another day always needs the patient's acceptance and, above a count threshold, PRM approval.
- Dose and protocol equivalence is checked: a protocol built for CT 1 is mapped to CT 2's protocol library (M08), and the DRL comparison (M10) confirms the alternative is within the site's diagnostic reference levels.
- The Maintenance Hand (M18) tracks the vendor SLA clock; if the vendor does not respond in 4 hours, it escalates to BIO and to the vendor's account manager, and records the breach against the service contract in M02's agreement register for the next negotiation.
- The event is written to the uptime register (M18) and the incident register (M19) as an equipment incident, without a patient-harm flag.
- Events: `modality.down.v1`, `capacity.replanned.v1`, `appointment.moved.v1`, `vendor.ticket.opened.v1`, `roster.overtime.offered.v1`.

**Edge cases.**
- A contrast patient has already had IV access placed when the fault occurs. NUR's console shows the patient as "prepared, not scanned"; the Capacity Hand puts that patient first on CT 2 and the consent record stays valid for the same protocol.
- The vendor engineer needs remote access to the scanner console. Remote access is a BIO-approved, time-boxed session recorded in M18 and M19 (see the BIO journey); Lerato does not grant it.
- Load-shedding starts during the fault (see Scene 6): CT 2 is on the generator circuit; the Platform's site power map confirms it before the plan is offered.

**Success measure.** Trauma patients scanned within 30 minutes of the fault; no patient learns of the fault in the waiting room; the vendor ticket is open within 2 minutes; revenue lost is known and reported the same morning.

---

## Scene 3 — A radiographer calls in sick

**Situation.** 06:10 the next day. The mammography radiographer, who is the only staff member on site with the mammography credential, sends a WhatsApp: sick, doctor's note to follow.

**What they see.** By the time Lerato wakes, the Roster Hand (M17, A3) has posted a card: "Mammography: no credentialed radiographer today. 17 patients booked. Options: (a) agency mammographer from the approved panel, available 08:30, cost R3 900 (illustrative) (b) relief from Gateway site, available 10:00, no agency cost, Gateway loses 30 % mammography capacity (c) reschedule 17 patients." The Hand recommends (a) and has provisionally held the agency booking pending approval. The `Calendar` shows the mammography room in Beam for the first hour.

**What they do.** Lerato approves (a). She asks the Hand to move the first three patients to 09:00 onwards and offer them the change; two accept, one asks to come tomorrow. She notes the sick leave in M17 (the doctor's note arrives by WhatsApp and is filed to the employee record with the appropriate access restriction).

**What the Platform does.**
- M17 holds credentials (HPCSA registration category, mammography training, MRI safety, contrast competency) per person; the roster engine treats a credential as a hard constraint, which is why the Hand did not propose a general radiographer.
- The agency panel is a set of `external_partner` entities in M02 with rate cards and the agency worker's HPCSA verification (M01) done at onboarding, so a booking takes minutes.
- Cost of the choice is posted to the site's cost centre in M15 immediately, so the month's staffing variance is visible the same day.
- Time and attendance closes the loop: the agency mammographer clocks in at the kiosk and the invoice from the agency is matched to the shift.
- Events: `roster.gap.detected.v1`, `roster.option.proposed.v1`, `roster.filled.v1`, `leave.recorded.v1`.

**Edge cases.**
- The agency worker's HPCSA registration verification shows an annual renewal lapsed. The booking cannot be confirmed; the Hand offers option (b).
- The sick radiographer was also the site's second Radiation Protection Officer delegate. The Platform checks that the primary RPO is on site; if not, it notifies CMP.

**Success measure.** Gap filled before the first patient arrives; mammography day runs with at most a 30-minute shift; sick leave recorded with the note within the day.

---

## Scene 4 — A complaint

**Situation.** A patient's daughter posts a complaint through the Patient Space Help section: her mother waited two hours for an ultrasound, was not told why, and was "spoken to rudely" at the desk. She also copied the complaint to a consumer review site.

**What they see.** The complaint object in M19 opens in Lerato's queue with Flare priority because it contains a conduct allegation. The `Inspector` shows the visit's `Timeline` from M07 and M08: arrived 10:05, appointment 10:20, called at 12:02; the sonographer's list that morning had two emergency add-ons from casualty; the front-desk queue display showed "delay, about 40 minutes" at 10:30 and then nothing further. The Complaint Hand (M19, A2) has drafted an acknowledgement (sent automatically within 15 minutes, as policy) and a factual summary of the timeline, and has flagged the gap: no second delay update after 10:30.

**What they do.** Lerato listens to the front-desk interaction (the kiosk area has no audio; she speaks to the staff member instead) and reviews the queue-status log. She calls the daughter, apologises for the wait and the missing updates, explains without excuses, and offers a follow-up conversation with the front-desk lead. She records the call in the complaint object, chooses the root causes from the taxonomy (queue communication; emergency add-on policy), and assigns two corrective actions: the queue display must update every 20 minutes during a delay (a Platform configuration change to M07's queue board, done by SUP), and the emergency add-on policy needs a rule that add-ons above two per list trigger a Booking Hand re-offer to waiting patients.

**What the Platform does.**
- Complaints from any channel (Patient Space, WhatsApp, email, phone note, letter scanned) create one object with the same lifecycle: acknowledged, investigated, responded, closed, learning recorded.
- The Platform never posts to review sites and never asks patients to remove reviews; it does prepare Lerato a short, non-identifying public reply for the site's marketing owner to consider, which a human posts or not.
- Conduct allegations against staff route to HR in M17 with access restrictions; the complaint object shows only that an HR process exists.
- Response SLAs (acknowledge within one working day, respond within 10 working days, illustrative) are rendered as SLA bars; CMP sees all open complaints across the Practice.
- Events: `complaint.opened.v1`, `complaint.acknowledged.v1`, `complaint.action.assigned.v1`, `complaint.closed.v1`.

**Edge cases.**
- The complaint includes a clinical concern ("the report missed something"). The clinical part splits into a peer-review request in M12 (see the CMP journey) and the service part stays with Lerato.
- The complainant asks for a copy of the mother's records. That becomes a POPIA access request handled by CMP, with the daughter's authority to act for her mother verified first.

**Success measure.** Acknowledged within 15 minutes, responded within 5 working days; both corrective actions closed within 30 days; repeat complaints for queue communication drop to zero the next quarter.

---

## Scene 5 — A SAHPRA inspection

**Situation.** Wednesday, 09:15. Two inspectors from SAHPRA Radiation Control arrive unannounced to inspect the site's X-ray, CT and mammography rooms under the licence conditions.

**What they see.** Lerato opens the Compliance view of the Control Tower (a Governance-lens surface shared with CMP). One click, "Inspection pack, this site", produces: every room with its SAHPRA licence number and expiry, the licensed equipment per room with serials matching the register, the Radiation Protection Officer and delegates, shielding survey dates and reports, acceptance and routine QA test records with results (M10, M18), the dose monitoring register for staff (dosimetry badge results by wear period), staff HPCSA registrations and radiation-safety training records (M17), the site's radiation safety procedures and the incident register extract for radiation incidents (M19), and the DRL comparison for the site's common protocols (M10). Each item shows its evidence document and the date it was last verified.

**What they do.** Lerato walks the inspectors through the rooms with the tablet, opens each room's licence and QA record as they stand in it, and answers questions. The inspectors ask for the last three months of dose reports for CT abdomen protocols against the site's DRLs; Lerato shows the `DoseGauge` distribution and exports the data. They ask about a general X-ray unit that was replaced last year: the register shows the old unit's decommissioning and licence amendment with the SAHPRA correspondence attached. They note one observation: a warning sign at the mammography room door is faded. Lerato raises the non-conformance in M19 on the spot, assigns it to facilities, and sets a 7-day due date.

**What the Platform does.**
- The inspection pack is a saved query over M02, M10, M17, M18 and M19, rendered from live data, so there is nothing to prepare.
- Every licence has a renewal countdown that CMP and PRM both see; the Compliance Hand (M19, A3) prepares renewal applications 90 days before expiry (see the CMP journey).
- The inspection itself is recorded in M19 as an external audit with the inspectors' observations, the site's responses and the close-out evidence.
- Events: `audit.external.opened.v1`, `nonconformance.raised.v1`, `nonconformance.closed.v1`.

**Edge cases.**
- An inspector asks for a document the site holds only on paper (an old shielding report from before the Platform). The document store shows the scanned copy, which SUP uploaded during onboarding as part of the evidence backfill.
- The inspectors want to confirm that a modality is not being used while a QA test is overdue. The slot-engine block log shows every block, override and the CMP approval for each override.

**Success measure.** Inspection completed with no request for follow-up documents; observations closed within their due dates; no licence at any Bonakala site ever reaches expiry without a renewal filed.

---

## Scene 6 — A load-shedding week

**Situation.** Stage 4 load-shedding is announced for the week: two to three outages a day, two to four hours each, on the site's municipal block. The site has a generator (sized for CT 2, X-ray rooms, ultrasound, the Edge Gateway and the front desk, but not for MRI or CT 1 at full duty) and a UPS for the Edge Gateway and network.

**What they see.** The Control Tower shows the week's outage schedule (imported from the municipality's or utility's published schedule as reference data, editable because the schedules change) overlaid on the `Heatmap` of bookings. Rooms are coloured by their power plan: generator-backed rooms unaffected; MRI in Beam during outages (the MRI stays cold on its own backup but is not scanned during outages by site policy); CT 1 in Beam. The Capacity Hand has proposed a week plan: MRI and CT 1 lists moved out of outage windows, the extra load placed on early mornings and evenings, and 14 patients offered a change. Diesel stock: 3.5 days at the forecast run-time; the Stock Hand (M18) has drafted a diesel order.

**What they do.** Lerato approves the week plan and the diesel order, and asks the Roster Hand to align shifts to the new lists, including a 06:30 start for the MRI radiographer on two days. She checks the Edge Gateway's UPS runtime and the transfer backlog tile: 0 studies pending upload. She sets the front desk's message of the week: patients booked during an outage window on generator-backed modalities are told their appointment is unaffected; the WhatsApp channel says so proactively because patients cancel when they assume the site is closed.

**What the Platform does.**
- The site power map (M18) records which circuits each modality, room and network element sits on, and the generator's capacity; the Capacity Hand plans against it.
- The Edge Gateway (M21) keeps imaging running through outages: MWL, MPPS, local storage and the technologist console work offline, and uploads resume when the link returns. The gateway's telemetry (UPS state, link, backlog) is on the Control Tower.
- Patient-facing surfaces degrade gracefully: if the site's link is down, the Patient Space and WhatsApp still work from the central Platform, and check-in falls back to the gateway's local mirror of today's list.
- Generator run hours and fuel are logged against the site's cost centre; the CFO view (EXE) sees load-shedding cost per site.
- Events: `power.outage.scheduled.v1`, `capacity.replanned.v1`, `gateway.on_ups.v1`, `gateway.backlog.v1`, `stock.order.drafted.v1`.

**Edge cases.**
- An unscheduled outage hits outside the published windows. The Edge Gateway reports `gateway.on_ups.v1` within seconds; the Control Tower shows the MRI in Beam and the Capacity Hand re-offers the next two MRI slots.
- The generator fails to start. The Maintenance Hand opens a ticket with the generator contractor and the plan reverts to "no imaging except portable X-ray on battery"; the site's status is broadcast to referrers through the Referrer Space so they can send urgent patients elsewhere.

**Success measure.** No study lost during an outage; fewer than 5 % of the week's patients rescheduled; diesel never below one day; no data waiting on the gateway for more than 12 hours.

---

## Scene 7 — Monthly review with the shareholders

**Situation.** The 8th working day of the month. Practice B's management accounts closed on the 5th. Lerato presents the month to the Practice's two local radiologist partners (SHR) and the Group's professional-holding representative.

**What they see.** The Monthly Review page in M16 (Business lens) is the same page the shareholders see in their portal, so nobody argues about numbers. It opens with revenue versus budget (R7.9 M actual versus R8.2 M budget, illustrative), then the bridge: CT 1 downtime (−R118 000), MRI outage windows (−R64 000), mammography agency cost (−R3 900), no-show rate improved (+R41 000), collections at 30 days up two points. Then operations: utilisation by modality against the Group benchmark (`Benchmark` tile, de-identified peers), patient wait median, report TAT by priority, first-pass acceptance, complaints and their closure, the SAHPRA inspection with its one observation closed, load-shedding cost. Then the JV lines from M15: management fee, reading fees to the Hub, intercompany rent, distributable profit and the proposed distribution per shareholder.

**What they do.** Lerato talks to the bridge rather than reading the numbers. The partners ask two questions: whether CT 1's tube should be replaced before the next failure (the `Inspector` on the CT 1 asset shows the predictive-maintenance view from M18 and the vendor quote), and whether the MRI should run through outages on its own generator (a capex item; the Platform's what-if in M16 shows the payback from recovered slots at the current mix). The second becomes a reserved-matter proposal in M02 for the shareholders to vote on.

**What the Platform does.**
- M15 closes the Practice's month from posted events, with the unbilled snapshot from BIL, the accrual factors for RAF and COIDA from DEB, the roster costs from M17 and the asset costs from M18.
- The revenue bridge is computed, not narrated: every variance line links to the events that caused it.
- The what-if uses the site's own demand, protocol mix and funder rates; assumptions are labelled and editable.
- Events: `period.closed.v1`, `distribution.proposed.v1`, `reserved_matter.proposed.v1`.

**Edge cases.**
- A partner disputes the management fee allocation driver. The intercompany rule and its driver data (studies, headcount, square metres) are shown on the page; disputes route to EXE as M15 specifies.
- A partner wants the numbers in a spreadsheet. Export is a click; the export carries the same period lock reference so a later "different version" is impossible.

**Success measure.** Month closed by the 5th, reviewed by the 8th; every variance explained by an event; capex questions answered with a what-if in the meeting, not a week later.

---

## Moments that beat the market

- One page at 07:20 shows every risk for the day, and the Hands have already handled the routine ones overnight with provenance the manager can inspect.
- A CT failure produces a replan, a vendor ticket, patient messages ready to send and a revenue-exposure number within minutes, before the waiting room notices.
- Credentials are hard roster constraints, so the only options offered for a sick mammographer are lawful ones, priced and pre-held.
- A complaint arrives with the visit's timeline attached, is acknowledged automatically and turns into two specific corrective actions with owners and dates.
- A SAHPRA inspection is walked on a tablet from live data; the only preparation is opening the page.
- Load-shedding is planned a week ahead against the site's real power map, and imaging continues through outages on the Edge Gateway.
- The monthly review is the shareholders' own page, with a computed bridge and a capex what-if answered in the room.
- Every Hand action the manager sees is reversible or approvable; nothing moves a patient, spends money above the leash or contacts a regulator without a human.

## Failure modes designed out

- **Learning about problems from the waiting room.** Modality faults, roster gaps, stock, licence and QA states and queue delays all raise events before they become visible to patients.
- **Scheduling on unlicensed or QA-overdue equipment.** The slot engine blocks by policy; overrides are CMP-approved and audited.
- **Uncredentialed staff on specialist modalities.** Credentials are hard constraints in the roster engine and for agency workers.
- **Patients moved without consent.** Hands offer; patients accept; PRM approves above thresholds.
- **Unequal protocols across rooms.** Protocol mapping and DRL checks precede any re-room.
- **Complaints without learning.** Every closed complaint carries root causes from a taxonomy and corrective actions with owners; conduct matters go to HR with restricted access.
- **Outage data loss.** The Edge Gateway stores and forwards; the transfer backlog is a tile on the Control Tower, not a surprise.
- **Two versions of the month.** Shareholders and the manager see the same locked period; exports carry the lock reference.
