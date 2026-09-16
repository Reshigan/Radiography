# Journey: NUR — Nurse / Contrast / Patient Care

This journey follows the Nurse persona (NUR) through a contrast day at a CT and MRI site. Each
scene is written as: Situation, What they see, What they do, What the Platform does, Edge cases,
Success measure. Thresholds, doses and drug names are illustrative examples of the Practice's own
clinical policy, which the Platform stores as configurable reference data; nothing here replaces
that policy.

## Persona snapshot (from 04-personas)

| Item | Detail |
|---|---|
| Who | Registered and enrolled nurses and patient care assistants responsible for contrast administration, IV access, patient observation and reaction management at a Site |
| Goals | Safe contrast administration, IV access, patient observation, reactions handled |
| Better than market | eGFR, allergy and metformin checks surfaced automatically; contrast dose per weight; reaction protocol on screen; stock decrement by scan |
| Metrics | Contrast reactions, extravasations, eGFR check compliance |

Design lens: **Clinical** (Carbon surface, Dense L3, High W3, Signal accent). The Nurse view of the
Technologist console is a `Queue` of today's contrast patients with the `SafetyChecklist`,
`ContrastCalculator` and the reaction protocol card in the `Inspector`. It runs against the Edge
Gateway and works offline.

## Scene 1 - 07:45: the contrast list for the day

**Situation.** Sister Mahlangu opens the contrast queue at Sandton: 14 CT contrast studies and 6 MRI
gadolinium studies.

**What they see.** The queue develops most-critical-first: two patients with Flare items (one eGFR
below the Practice's threshold, one previous contrast reaction), four with Beam items (eGFR not on
file; metformin yes), the rest green from their Prepare answers. Each row shows the patient (masked
ID), the study, the time, the weight on record, the cannula status and the checklist state. A
`StatTile` strip shows contrast stock on hand by product and the vials expiring within 30 days.

**What they do.** Works the Flare and Beam items first, before the patients arrive.

**What the Platform does.**
* M07 Registration & Safety: contrast safety answers from the Patient Space, the referrer's order and
  lab results (where the referrer's system sends them, or where the patient uploaded a photo of the
  result which the Referral Hand extracted with provenance) are combined into the `SafetyChecklist`.
* M06 Funding & Authorisation and M14 Revenue Cycle: the contrast material tariff codes are already on
  the order so that nothing is billed by memory later.
* M18 Assets & Engineering: contrast stock levels, batches and expiries are live; the Maintenance Hand
  (M20, automation A3) raises a purchase request when the forecast for the week falls below the
  minimum, within its budget leash.

**Edge cases.**
* A patient's weight is missing: the console asks for it at cannulation and the calculator waits.
* The lab result photo is unreadable: the Beam item says so and the point-of-care test path is
  offered.

**Success measure.** Every contrast patient's checklist resolved before the cannula, not on the
scanner table.

## Scene 2 - 08:30: eGFR not on file, point-of-care test

**Situation.** Mrs Dlamini, 68, diabetic on metformin, arrives for CT abdomen with contrast. No eGFR
on file.

**What they see.** The checklist item "Kidney function: not on file" in Beam, and the Practice's
policy rendered as steps: point-of-care creatinine test allowed at this site; result to be entered
with the device reading; eGFR computed by the Platform from creatinine, age and sex using the
Practice's chosen equation (reference data); metformin guidance per the Practice's policy for the
resulting eGFR band.

**What they do.** Takes a fingerprick sample, enters the creatinine, sees the eGFR of 54 (illustrative)
and the policy band ("contrast may proceed; metformin advice per policy; radiologist informed"),
explains the metformin instruction to Mrs Dlamini in isiZulu, and confirms the item.

**What the Platform does.**
* M07: the eGFR computation is a deterministic function, not an AI output; the equation and version
  are recorded with the result. The policy bands are the Practice's, configured by CMP and the
  clinical lead; the console never invents a threshold.
* M13 Results & Communication: the metformin instruction is sent to the patient's WhatsApp in her
  language from the approved catalogue, for example "Yima ukuthatha i-metformin izinsuku ezi-2
  ngemva kwe-scan. Buza udokotela wakho ngaphambi kokuqala futhi." (English gloss: "Stop taking
  metformin for 2 days after the scan. Ask your doctor before starting again."), with the exact
  wording chosen by the Practice's policy.
* M12 Reporting: the eGFR and the decision are visible to the radiologist on the study.
* Events: `safety.item.resolved.v1`, `contrast.decision.recorded.v1`.

**Edge cases.**
* eGFR below the threshold: the item turns Flare; the console requires a radiologist decision (proceed
  with a reduced dose or a different protocol, hydrate and rebook, or non-contrast); the decision is
  recorded with the radiologist's name and the patient is told the reason in plain words.
* The point-of-care device is out of strips: M18 stock; the study is rebooked or the patient sent
  for a lab test with a Practice-issued request.
* Dialysis patient: the Practice's policy path appears; the referrer is contacted.

**Success measure.** eGFR check compliance at 100 % for contrast studies; no metformin advice given
from memory.

## Scene 3 - 09:10: cannulation and dose per weight

**Situation.** Mr Khumalo (FDK journey, Scene 4; RAD journey, Scene 2) is cleared. Sister Mahlangu
places the cannula.

**What they see.** The `ContrastCalculator`: weight 92 kg, protocol "CT abdomen and pelvis, portal
venous", the Practice's dosing rule for this protocol and concentration, the computed volume and
flow rate as a suggestion in the annotated style until she confirms, the cannula gauge required for
that flow rate, the vial barcode field, and the injector programme to hand to the radiographer. A
warmer status shows the vial is at the recommended temperature.

**What they do.** Places an appropriately sized cannula in the antecubital fossa, records site and
gauge with two taps, tests patency and records it, scans the vial, confirms the dose, and hands over
to the radiographer with the console showing "Ready for contrast".

**What the Platform does.**
* M07 and M08 Acquisition & Worklist: the cannula record (site, gauge, time, nurse) and the contrast
  plan are attached to the study; the radiographer's console shows them.
* M18: the vial batch and expiry are bound to the patient; the stock decrement is posted when the
  radiographer records the administered volume from the injector.
* M14: the administered volume, not the planned volume, is what the Coding Hand bills.
* M17 Workforce: the nurse's IV competency credential is current; an expiry would have been flagged
  on the roster.

**Edge cases.**
* Difficult access: the console records attempts and offers the escalation path (ultrasound-guided
  access, radiologist); a second nurse can be called from the site roster.
* Pre-existing line (port, PICC): the policy for power injection through the device is shown with the
  device's pressure rating if known.
* The planned dose exceeds the Practice's maximum for the eGFR band: the calculator refuses and
  routes to the radiologist.

**Success measure.** Cannulation recorded for every contrast study; administered dose matches the
plan or carries a reason.

## Scene 4 - 09:40: a contrast reaction

**Situation.** Three minutes after injection, a young patient in CT develops urticaria and reports
throat tightness.

**What they see.** One tap on *Reaction* opens the reaction protocol card full-screen: the Practice's
graded protocol (mild, moderate, severe), the emergency trolley checklist for this room with the
drug locations, weight-based drug doses computed from the recorded weight (illustrative and per the
Practice's protocol; the card shows the source policy and version), the emergency number for the
site and the hospital, and a running timer. Every action she taps is timestamped. The radiologist's
console and the site's PRM receive an immediate alert.

**What they do.** Calls the radiologist, follows the protocol, administers as prescribed by the
radiologist on site, observes, and documents through the card as she goes rather than from memory
afterwards.

**What the Platform does.**
* M19 Quality, Risk & Compliance: an incident is opened automatically with the timeline, the contrast
  product, batch and dose; the SAHPRA adverse event reporting pathway for the product is a task
  with the form pre-filled for CMP review (the Platform prepares the report; a person submits it).
* M03 Patient Master Index: the reaction is recorded as a structured allergy on the patient's record
  so that every future checklist shows it in Flare across all sites nationally.
* M13: the referrer is notified of the event with the radiologist's note; the patient receives a
  plain-language explanation and a card for future imaging.
* M18: the emergency trolley stock used is decremented and a restock task is created; the trolley
  check schedule is a compliance calendar item.
* Events: `incident.opened.v1`, `allergy.recorded.v1`.

**Edge cases.**
* Severe reaction requiring transfer: the hospital transfer path is on the card with the site's
  agreement details; the study images and the event summary can be shared with the receiving
  hospital by share link.
* Delayed reaction reported the next day by WhatsApp: the message is routed to the site's nurse
  queue, the incident is linked, and advice follows the policy.

**Success measure.** Time from first symptom to first protocol action under the Practice's target;
every reaction recorded once, completely, and visible nationally.

## Scene 5 - 11:15: extravasation

**Situation.** During an injection the injector's pressure alarm triggers and the patient reports
pain at the cannula site; a volume of contrast has extravasated.

**What they see.** The *Extravasation* card: estimated volume from the injector log, the Practice's
management steps, elevation and observation instructions, the photograph capture of the site
(`PhotoCapture`, stored in the incident, not in the imaging study), the radiologist review requirement
above a volume threshold, and the patient advice sheet that will be sent.

**What they do.** Stops the injection, removes the cannula per policy, elevates, photographs, records,
calls the radiologist for review, and arranges the follow-up call for the next day.

**What the Platform does.**
* M19: incident with the injector data attached; extravasation rate is tracked per site and per
  cannula site and gauge for learning, not for blame.
* M13: the Platform schedules a templated next-day check-in message and a nurse-queue task to phone
  the patient; any report of worsening symptoms routes to the nurse queue and the radiologist.
* M14: the study is marked incomplete or repeated per the radiologist; the account follows the
  Practice's policy for repeated contrast after an extravasation.

**Success measure.** Every extravasation documented with volume and follow-up; the rate trending down.

## Scene 6 - 12:00: MRI gadolinium and a pregnancy question

**Situation.** A patient for MRI with gadolinium contrast answered "not sure" to the pregnancy
question at home.

**What they see.** The checklist item in Beam with the Practice's policy: confirm with the patient;
offer a pregnancy test per policy; radiologist decision on gadolinium in pregnancy or breastfeeding;
consent wording for the chosen path.

**What they do.** Speaks with the patient privately, offers the test, records the result, and
records the radiologist's decision and the patient's consent.

**What the Platform does.**
* M07: the answer change and the test result are recorded with time and person; the MR safety
  checklist and the contrast checklist are separate items and both must be green.
* M12: the decision appears on the report header for the radiologist.

**Success measure.** No gadolinium given with an unresolved pregnancy question.

## Scene 7 - 16:30: stock, observations and hand-over

**Situation.** End of the contrast day.

**What they see.** The day's summary: contrast administered by product and volume, vials opened,
wastage with reasons, stock on hand versus the physical count she enters, patients still under
post-contrast observation with their timers, and incidents open. The Maintenance Hand's proposed order for
next week is shown with its reasoning for her to approve or adjust.

**What the Platform does.**
* M18: physical count against the system count; variances above a threshold open an incident.
* M20: the Maintenance Hand's order sits within a budget leash; approval by NUR or PRM is required above
  it.
* M16 Analytics & Insight: reactions, extravasations and eGFR check compliance per site, per month,
  benchmarked across the Group with case-mix noted.

**Success measure.** Stock reconciles to the vial; observations complete before discharge; hand-over
with no unresolved incident.

## Moments that beat the market

* The contrast checklist is assembled before the patient arrives, from home answers, referrer data
  and lab results, and the nurse works exceptions rather than paper.
* eGFR computed from a point-of-care result with the equation and version recorded; the Practice's
  policy bands rendered as steps, never a number from memory.
* Dose per weight, cannula gauge for flow rate and vial batch by barcode, all bound to the patient.
* A reaction protocol that runs as a timed checklist with weight-based doses from the Practice's
  policy and alerts the radiologist and the manager instantly.
* A reaction recorded once becomes a Flare item at every Bonakala site in the country.
* Extravasation and reaction follow-up check-ins scheduled automatically as nurse tasks with
  templated patient messages.
* Stock that decrements per scan and reorders itself within a budget leash.
* Patient instructions after contrast delivered in the patient's language from an approved
  catalogue.

## Failure modes designed out

* Contrast given without kidney function or allergy checks: Class 1 gate with a radiologist decision
  path.
* Metformin advice from memory or in the wrong language: catalogue wording per policy, sent to the
  patient's phone.
* Dose calculated by hand: the calculator, with the Practice's rule and the eGFR band ceiling.
* Wrong vial or expired vial: barcode scan against batch and expiry.
* Reaction poorly documented after the fact: timestamped actions during the event.
* Reaction unknown at the next site: structured allergy on the national patient record.
* Stock-outs on a Monday: forecast-based reordering with a leash.
* Gadolinium with an unresolved pregnancy or MR safety question: two separate hard gates.
