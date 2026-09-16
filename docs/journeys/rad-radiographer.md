# Journey: RAD — Radiographer / Sonographer / Technologist

This journey follows the Radiographer persona (RAD) across six kinds of acquisition. Each scene is
written as: Situation, What they see, What they do, What the Platform does, Edge cases, Success
measure. Dose values, protocol names and reference levels are illustrative and stored as
configurable reference data.

## Persona snapshot (from 04-personas)

| Item | Detail |
|---|---|
| Who | Diagnostic radiographers, mammographers, sonographers, MRI and CT technologists, registered with the HPCSA |
| Goals | Right patient, right study, right protocol, first time; low dose; no re-keying; safety |
| Frustrations today | Worklist mismatches, manual protocol lookup, repeat exposures, chasing priors, contrast stock, MRI safety paperwork, dose logging |
| Better than market | Auto-populated worklist; protocol card with AI-suggested protocol and dose reference level; positioning and exposure QC in seconds; repeat and reject captured automatically; contrast tracking by barcode; safety checklists on the tablet; time-per-study analytics that are fair (case-mix adjusted) |
| Surfaces | Technologist console (touch-first), modality integration, mobile app for portable X-ray |
| Metrics | Repeat rate, dose versus diagnostic reference level (DRL), studies per shift (case-mix adjusted) |

Design lens: **Clinical** (Carbon surface, Dense L3, High W3, Signal accent). The Technologist
console is a touch-first `Queue` per room with the `Inspector` showing the selected patient's order,
safety answers, priors and the protocol card. It runs as a PWA against the site's Edge Gateway, so it
works when the internet, and the grid, do not. Every AI-suggested element is in the annotated
style with a `Provenance` chip.

## Scene 1 - General X-ray: lumbar spine, first time right

**Situation.** Lindiwe runs Room 1 (a DR unit) at Randburg. Nomvula (PAT journey, Scene 1) is next.

**What they see.** The room `Queue` shows Nomvula as arrived, 2 minutes waiting. The `Inspector`
shows: order (lumbar spine AP and lateral, indication "low back pain 6 weeks, no red flags"),
safety answers (pregnancy: no; last X-ray of the spine: none known), the `PriorStrip` (empty for this
region; a chest X-ray from two years ago at another Practice is listed but not loaded), and the
protocol card: "Lumbar spine, adult, standard; suggested exposure factors by patient size band;
DRL for this projection (illustrative) shown as a `DoseGauge`." The AI suggestion for size band comes
from the recorded height and weight and is annotated. The protocol itself was set before arrival by
the Protocol Hand (A2) from the Practice's signed allow-list for this examination and indication,
with the protocolling radiologist reviewing a daily sample. A wristband scan field waits at the top.

**What they do.** Scans Nomvula's wristband or queue ticket QR, confirms name and date of birth
aloud, confirms the pregnancy answer verbally (recorded as re-confirmed in the room), accepts the
protocol, positions, exposes. Within seconds of each image the on-device QC shows a positioning and
exposure check: "Lateral: collimation adequate, exposure index within range." She sends the study.

**What the Platform does.**
* M08 Acquisition & Worklist: the Modality Worklist (MWL) entry was created at arrival; the wristband
  scan binds the patient to the room session; MPPS "in progress" and "completed" messages from the
  modality update the queue and the patient's WhatsApp status ("In Room 1").
* M08 QC: the Edge Gateway runs the positioning and exposure QC model locally; results are
  `bci.result.v1` events with provenance. The QC Hand (A2) turns flags into repeat prompts and
  reject reasons and holds study completion on a laterality or body-part mismatch (override needs a
  typed reason and PRM notification); it never deletes an image or marks a repeat done, and the
  decision to repeat is the radiographer's.
* M10 Dose & Radiation Safety: the Dose Structured Report (or exposure index and DAP from the
  modality) is captured per exposure against the patient, room and radiographer; the `DoseGauge`
  compares to the DRL; exceedances are flagged for the RPO's periodic review, not as blame.
* M09 Image Management: images are stored on the Edge Gateway and forwarded to the central archive;
  the study appears on the RGT worklist with the correct priority.
* Events: `study.started.v1`, `study.acquired.v1`, `dose.recorded.v1`.

**Edge cases.**
* The MWL entry is missing (order created after the modality queried): the console has *Refresh
  worklist* and, failing that, an emergency entry that binds the study by accession number
  afterwards; unmatched studies go to a reconciliation queue and cannot be reported until matched.
* The patient says "actually I might be pregnant": the console records the change, the study is
  paused, and the Practice's pregnancy protocol (referrer contact, radiologist decision) runs; the
  original answer and the change are both retained.
* A repeat is needed: the console asks for a reason from the standard list (positioning, exposure,
  motion, artefact, equipment) before the second exposure is accepted; repeats and rejects are
  captured automatically from the modality where supported.
* Load-shedding hits mid-study: the DR unit is on UPS; the console is on the Edge Gateway; nothing
  changes for the radiographer.

**Success measure.** Repeat rate within the Practice's target; exposure within DRL; no study left
unmatched at the end of the day.

## Scene 2 - CT with contrast: eGFR, protocol and dose

**Situation.** Sizwe runs the CT at Sandton. Mr Khumalo (FDK journey, Scene 4) is booked for a CT
abdomen with contrast. The nurse (NUR) has placed the cannula.

**What they see.** The `Inspector` shows the contrast `SafetyChecklist` state: eGFR result on file
(from the referrer's lab, 78 mL/min/1.73 m², illustrative), allergy history (none), metformin (no),
previous contrast reaction (no), weight 92 kg, the NUR sign-off on the cannula, and the contrast
dose calculated by the `ContrastCalculator` with the batch and expiry of the vial scanned by
barcode. The protocol card offers "CT abdomen and pelvis, portal venous phase, adult" as the
radiologist-approved protocol for the indication, with an AI suggestion (annotated) to add a delayed
phase because the indication mentions haematuria. The Protocol Hand assembled the protocolling packet (order,
indication, safety answers, eGFR, priors, the suggestion) and, because contrast studies are never
auto-protocolled, routed it to the protocolling radiologist; the card shows her decision: accepted. The `DoseGauge` shows
the CT dose index and dose-length product reference for this protocol.

**What they do.** Scans the wristband, confirms the checklist items with Mr Khumalo verbally, scans
the contrast vial, injects with the power injector in the room, acquires, reviews the series, sends.
He records the contrast volume actually given (the injector reports it).

**What the Platform does.**
* M07 Registration & Safety: contrast safety is Class 1 safety data; a missing or out-of-range eGFR
  blocks the contrast step until a radiologist decision is recorded (the NUR journey covers the
  clinical path).
* M11 Clinical Intelligence: protocol suggestions are drafts; the protocolling radiologist accepts,
  edits or rejects (A1); the accepted protocol is what the console shows.
* M18 Assets & Engineering: contrast stock decrements by barcode scan per study; batch and expiry are
  recorded against the patient for traceability; low stock raises a Maintenance Hand task.
* M10: the Dose SR from the scanner is parsed; the effective dose estimate is stored; cumulative dose
  for the patient is visible on the `DoseGauge`.
* M14 Revenue Cycle: the contrast volume and the tariff codes for the study and the contrast material
  flow to the Coding Hand; the authorisation on the order is compared to the protocol actually
  performed and any mismatch raises a task before the claim.
* Events: `contrast.administered.v1`, `study.acquired.v1`, `dose.recorded.v1`, `stock.issued.v1`.

**Edge cases.**
* Contrast extravasation: the console has a one-tap incident path that records the site, volume and
  actions, notifies the NUR and radiologist and opens an M19 incident with the patient advice sheet
  sent to the patient's WhatsApp.
* The injector fails: the manual injection path records volume by hand with a reason.
* The scanner's tube arc count or a calibration warning appears in modality logs: M18 has already
  opened a predictive maintenance task; if the scanner is taken down, the Booking Hand moves the
  day's patients.

**Success measure.** eGFR check compliance at 100 % before contrast; dose-length product within DRL;
contrast stock reconciles to the vial.

## Scene 3 - MRI safety: Zone IV and an implant that is "not sure"

**Situation.** Priya is the MRI radiographer at Umhlanga. Kevin (PAT journey, Scene 8) is booked
with an extended slot for anxiety, and the next patient, Mrs Naicker, answered "not sure" to the
question about a metal implant from surgery in 2009.

**What they see.** For Kevin, the `Inspector` shows the anxiety note and the companion booking before
he arrives, the MRI `SafetyChecklist` fully green from his home answers, and the protocol card with
the shortest adequate knee protocol. For Mrs Naicker, the checklist has a Flare item: "Implant: not
sure. Study blocked until cleared." The console offers the clearance workflow: photograph the
implant card or the discharge summary, search the implant register by manufacturer and model
(reference data), record MR-conditional status and conditions (field strength, specific absorption
rate limits, positioning), and a radiologist sign-off if the conditions are non-standard.

**What they do.** For Kevin: greets him with his name and his companion, confirms the checklist
verbally, walks him through the ferromagnetic detector at the Zone III boundary, shows him the head-
out position, sets the headphones, scans. For Mrs Naicker: obtains the operation report from her
surgeon's rooms (a Referrer Space request sent from the console), clears the implant as
MR-conditional at 1.5 T with the recorded conditions, and rebooks her for the 1.5 T site because the
Umhlanga scanner is 3 T.

**What the Platform does.**
* M07: the MRI safety questionnaire is Class 1; an unresolved item is a hard block on MWL creation for
  MR; clearance requires a named radiographer, the evidence document and, where conditional, the
  conditions as structured data; the block and the clearance are audited.
* M07: the ferromagnetic detector result at the zone boundary, where the site has one, is recorded
  against the patient's arrival.
* M05 and M02: the rebooking checks scanner field strength as a hard constraint from the modality
  record.
* M13: Kevin's anxiety note and the extended slot came from his Prepare answers; after the study the
  console asks him a single question ("How was that?") that feeds the Practice's patient experience
  metric.
* M17 Workforce: Priya's MRI safety training and credentials are current (a credential expiry would
  have raised a roster warning in advance).

**Edge cases.**
* A companion has a pacemaker: the companion also completes a short screening before Zone IV;
  the console asks.
* A patient with a cochlear implant or a programmable shunt: the clearance path requires the device
  conditions and a radiologist decision; the Practice's MRI safety policy is linked from the
  checklist.
* Quench or emergency: the console's emergency card shows the site's procedure and the RPO and
  service contacts; it is available offline.

**Success measure.** Zero MR safety events; every "not sure" resolved with evidence before Zone IV;
incomplete-for-anxiety rate down.

## Scene 4 - Mammography: screening and a diagnostic conversion

**Situation.** Fatima is a mammographer at Sandton. Precious (PAT journey, Scene 9) is here for
screening. The next patient was booked as screening but mentions a lump at the desk.

**What they see.** The `Inspector` for Precious: screening order, last period date, prior images
from another provider fetched and displayed in the `PriorStrip`, implants: no. The protocol card:
standard CC and MLO bilateral with the site's compression and positioning guidance. After exposure,
the positioning QC check (annotated) reports the image quality features the Practice tracks
(pectoral muscle visible to nipple level on MLO, nipple in profile, symmetry), so that the decision
to repeat is made now, not at the reading. For the second patient, the console shows the desk's note
"symptomatic: lump left breast" in Beam and offers *Convert to diagnostic*, which changes the order,
the tariff, the template and adds an ultrasound slot with the sonographer.

**What they do.** For Precious: explains the compression, positions, exposes four views, reviews the
QC, sends. For the second patient: converts the order after a call to the referrer or under the
Practice's standing protocol for symptomatic conversion, adds additional views as the radiologist
directs, and walks her to ultrasound.

**What the Platform does.**
* M04 Referral & Orders: the conversion is a recorded order change with reason; the referrer is
  notified; M06 re-runs the benefit position (diagnostic mammography is funded differently from
  screening on most schemes; reference data).
* M08 and M11: the positioning QC model is registered in the Model Registry with mammography as its
  intended use; its outputs are QC information only; findings-candidate overlays for mammography are
  off by default and never shown on the acquisition console.
* M10: mean glandular dose per view is captured from the Dose SR and compared to the mammography
  DRL; compression force and thickness are recorded for QC trends.
* M12 Reporting: screening studies route to the double-read worklist; diagnostic studies route to the
  single read with the sonographer's images attached.
* M19 Quality, Risk & Compliance: the mammography QA programme (phantom tests, weekly and monthly
  checks) is a compliance calendar item; an overdue test blocks the room per M02-R-006.

**Edge cases.**
* Priors cannot be fetched from the other provider in time: the study proceeds; the reader is told
  priors are pending; the Platform retries and attaches them when they arrive, and the report can be
  addended if the radiologist wishes.
* A patient with breast implants booked as standard: the console prompts the implant-displacement
  views and the longer slot.
* Male patient referred for mammography: the flow supports it; the template and copy adapt.

**Success measure.** Repeat rate for positioning within target; mean glandular dose within DRL;
symptomatic conversions completed on the same visit.

## Scene 5 - Mobile X-ray in a hospital ward

**Situation.** Themba works at Practice C's hospital-based site. A ward calls for a portable chest
X-ray on a ventilated patient in the ICU.

**What they see.** The mobile app (the Technologist console's phone layout) shows the ward request
as a worklist item created from the hospital's HL7 order, with the bed number from ADT. At the
bedside he scans the patient's hospital wristband; the app confirms the match with the order and
shows the last chest X-ray from yesterday in the `PriorStrip` at thumbnail quality (data-light).
The protocol card: "Chest, AP supine, mobile; exposure by patient size; standard distance." A
radiation safety reminder lists who must step back and the controlled area. After exposure, the
detector transmits to the mobile unit and the image goes to the ward's monitor and the archive.

**What they do.** Scans, positions, calls the warning, exposes, checks the image on the app's QC
panel, marks the study complete, and moves to the next ward request.

**What the Platform does.**
* M02-R-008 and M21: the hospital is an external partner; ADT and ORM feeds attach to this site; the
  order carries the hospital visit number.
* M08: MWL served to the mobile unit over the hospital Wi-Fi from the Edge Gateway; if Wi-Fi drops,
  the app holds the worklist and the images until it reconnects; the wristband scan is the binding
  step.
* M10: dose per mobile exposure is recorded against the room "Mobile 1" and the radiographer; the
  mobile unit is a licensed modality with its own licence record.
* M12 and M13: ICU chest X-rays are prioritised on the RGT worklist per the Practice's inpatient
  policy; a line or tube malposition finding candidate from the BCI chest model raises triage
  priority; the signed report goes back to the hospital system as ORU and to the ward.

**Edge cases.**
* The wristband scan fails (damaged): the app allows a manual match with two identifiers and a
  ward nurse's confirmation recorded by name.
* Two portable requests for the same patient within an hour: the app warns of a possible duplicate
  order and asks the ward to confirm.
* The mobile detector battery is low or a calibration is due: M18 telemetry warns before the round.

**Success measure.** Ward request to image on the ward monitor within the target; zero
wrong-patient portables.

## Scene 6 - Load-shedding: two hours without grid or internet

**Situation.** Stage 6. The Randburg site loses grid power at 10:00 and, twenty minutes later, the
fibre link too, because the provider's cabinet has no battery. Generator start is delayed.

**What they see.** The Technologist console shows a Beam banner: "Offline mode. Worklist from the
Edge Gateway as of 10:19. Images stored locally. Reporting will resume when the link returns." The
room queue, patient demographics for today, safety answers and protocol cards are all present. The
DR and CT are on UPS with the generator due; the MRI is on its own protected supply and continues.
QC still works locally. The `PriorStrip` shows priors already cached for today's patients; priors not
yet cached are marked "unavailable offline".

**What they do.** Carry on. Lindiwe images her queue; Sizwe completes the CT already in progress and
holds new contrast studies until the generator is confirmed stable (the Practice's policy for power
stability before contrast injection, configurable). The front desk arrives patients on the Gateway
mirror. When the link returns at 12:05, the console shows the transfer backlog draining and the RGT
worklist filling.

**What the Platform does.**
* M21 Edge Gateway: MWL, MPPS, local storage for 30 days, resumable forwarding, and the worklist
  mirror keep acquisition at 100 % without grid or internet; the PWA keeps forms in IndexedDB.
  Event: `site.power.window.v1` when the outage starts and ends.
* M11: triage inference queues for when the link returns; the QC model runs on the Gateway.
* M18: UPS state, generator state and link status are telemetry; BIO sees the site on the
  observability dashboard; the runtime on UPS is shown so the site knows how long it has.
* M05 and M13: the Booking Hand knows the site is imaging and does not cancel; if the outage exceeds
  the configured threshold or a modality goes down, it moves patients and messages them with the
  reason.
* M12: the on-site radiologist can read from the Gateway's local viewer for urgent cases; the Hub
  reads when the link is back; STAT items are phoned in the meantime, recorded manually and
  reconciled.

**Edge cases.**
* The generator fails to start: the site follows its business continuity plan; the Platform marks the
  modalities as down from telemetry and the Booking Hand reschedules; the message to patients is
  honest and offers the nearest site with capacity.
* A study acquired offline is for a patient whose booking was cancelled centrally during the outage:
  the reconciliation queue catches the conflict; nothing is lost.
* The Gateway disk fills: telemetry warns BIO days before; the 30-day window is configurable.

**Success measure.** Imaging continuity at 100 % during outages; transfer backlog cleared within an
hour of link return; no offline study unmatched.

## Moments that beat the market

* A worklist that is always right: the wristband binds patient, order and room, and unmatched
  studies cannot be reported.
* The protocol card carries the radiologist-approved protocol, the AI suggestion clearly annotated,
  and the DRL as a gauge, so dose is visible before the exposure.
* Positioning and exposure QC in seconds on the Edge Gateway, so the repeat decision happens with
  the patient still in the room.
* Repeat and reject reasons captured at the moment, with fair, case-mix adjusted analytics.
* Contrast safety as data: eGFR, allergy, metformin, weight, vial batch by barcode, stock decrement
  per scan.
* MRI safety as a hard gate with an evidence-based clearance workflow, including companions.
* A mobile app for ward portables that binds by wristband and holds work when the Wi-Fi drops.
* Load-shedding is a banner, not a stoppage.

## Failure modes designed out

* Wrong patient on the table: wristband scan and verbal confirmation recorded per study.
* Imaging a possibly pregnant patient: the answer is re-confirmed in the room and any change pauses
  the study.
* Contrast without kidney function or allergy checks: Class 1 gate with a radiologist decision path.
* Ferromagnetic object into Zone IV: unresolved implant answers block MWL creation for MR.
* Repeats hidden from QA: automatic capture from the modality and mandatory reason codes.
* Lost images during outages: local storage with resumable forwarding.
* Dose unrecorded: Dose SR or exposure indices parsed for every exposure, including mobiles.
* Room used with an expired licence or overdue QA: scheduling block with CMP override and audit.
