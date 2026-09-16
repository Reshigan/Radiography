# Journey: REF — Referring Clinician

This journey follows the Referring clinician persona (REF) through five kinds of referral. Each scene
is written as: Situation, What they see, What they do, What the Platform does, Edge cases, Success
measure. Tariff codes, prices and turnaround times quoted are illustrative and stored as
configurable reference data.

## Persona snapshot (from 04-personas)

| Item | Detail |
|---|---|
| Who | GPs, specialists (orthopaedics, oncology, neurology, pulmonology, gynaecology), dentists, chiropractors, physiotherapists, occupational health practitioners, casualty and emergency doctors, hospital wards |
| Goals | Right test, quick appointment for their patient, fast reliable report, direct line to a radiologist for urgent cases, images viewable without a CD |
| Frustrations today | Fax and paper forms, phoning for reports, unstructured PDFs, no critical-result callback guarantee, no visibility of whether the patient attended |
| Better than market | e-Referral in one click from any system (or a photo of their form), instant slot offer for their patient, appropriateness guidance (right modality, right protocol), structured reports with key images and measurable trends, critical findings phoned and acknowledged digitally, referral analytics |
| Surfaces | Referrer Space (web), FHIR and HL7 integrations to practice-management systems, WhatsApp Business notifications, phone |
| Metrics | Report turnaround time, critical-result acknowledgement time, patient attendance rate |

Design lens: **Referrer** (Bone surface, Comfortable L2, Standard W2, Marrow accent). The Referrer
Space has six sections: Refer, Patients, Results, Urgent, Analytics, Settings. A referrer is
identified by HPCSA registration number and BHF practice number, verified through M01 at
onboarding, and may delegate a receptionist role with a narrower scope.

## Scene 1 - GP with a paper pad: a photo becomes a booked patient

**Situation.** Dr Naidoo runs a solo general practice in Chatsworth. She has no practice-management
integration and writes referrals on a printed pad. She sees a patient with three weeks of right
upper quadrant pain and wants an abdominal ultrasound. She wants to spend zero minutes on admin.

**What they see.** Her pad, reprinted at no cost by Bonakala, has a QR code and a WhatsApp number at
the bottom. She has two choices. She can hand the slip to the patient, who photographs it (the PAT
journey, Scene 1). Or she can photograph it herself from the Referrer Space on her phone, which is
faster when she wants to know the patient is booked before they leave the consulting room. She opens
Refer, taps *Photo of form*, and within seconds sees the extracted order in the annotated style: the
patient's name and ID, "Ultrasound abdomen", the indication, her own practice number, each field with
a `Provenance` chip and a confidence band. Below it, an appropriateness note from the Practice's
guideline set: "Ultrasound is the recommended first test for RUQ pain. No preparation issue." Then
three slots at the two sites nearest the patient's home postcode, and the patient's expected cost.

**What they do.** Corrects one misread digit in the ID number (the field was flagged in Beam because
the check digit failed), taps *Accept and offer slots to patient*, and tells the patient to expect
a WhatsApp message. She is done in 40 seconds.

**What the Platform does.**
* M04 Referral & Orders: the Referral Hand (M20, automation A2) extracts fields from the photo; the
  ID check-digit validation runs before display; any field below threshold or failing validation
  requires explicit correction. The original photo is retained as the source document. Event:
  `referral.received.v1`, then `order.created.v1` on acceptance.
* M04 appropriateness: a rules-based guideline lookup (the Practice's adopted referral guidelines,
  stored as reference data) provides guidance text; it never blocks a referral, it informs.
* M03 Patient Master Index: matches or creates the patient, sending the patient a WhatsApp opt-in
  message (POPIA: the patient consents to messaging before anything else is sent).
* M06 Funding & Authorisation and M05 Scheduling & Capacity: the Authorisation Hand (A3) runs the benefit
  check; the Booking Hand (A3) offers slots to the patient directly and confirms back to Dr Naidoo.
* M13 Results & Communication: Dr Naidoo's Patients section shows the referral status as it moves:
  Referred, Booked, Arrived, Scanned, Reported, Result viewed by patient. Her WhatsApp Business
  notification preferences decide which of these she hears about (default: Booked, Reported,
  No-show).

**Edge cases.**
* Handwriting unreadable: the extracted field shows as empty with a Beam flag; she types it; the
  Referral Hand learns nothing from her correction unless AIO approves the sample for training.
* The patient has no WhatsApp: she can enter a number for SMS, or print a confirmation for the
  patient from the Referrer Space.
* She refers a study the guideline marks as low-value for the indication (for example, lumbar spine
  X-rays for uncomplicated acute low back pain): the guidance shows why and offers the alternative;
  she may proceed; the Practice's radiologist may still protocol it differently after a call.
* A patient who never books: after seven days the Patients section shows "Not booked" and the
  Booking Hand has already tried twice; she can ask the Hand to try once more or close the
  referral with a reason.

**Success measure.** Referral to booked appointment in under five minutes for most paper referrals;
Dr Naidoo learns of a no-show without phoning anyone.

## Scene 2 - Specialist with an integrated practice system: orders and results without leaving her software

**Situation.** Dr Mahlangu is an orthopaedic surgeon in Pretoria. Her rooms use a practice-management
system that supports FHIR R4. She orders imaging dozens of times a week and wants the order and the
result to live inside her own patient file.

**What they see.** In her own software, an *Order imaging (Bonakala)* button opens an embedded Refer
widget (the Referrer Space as an embedded component with her integration key). The patient's
demographics and scheme details are already filled from her system. She picks "MRI knee, right" from
a structured catalogue; the widget shows the Practice's protocol suggestion ("Knee, internal
derangement protocol; no contrast"), the pre-authorisation requirement for MRI on this scheme, and an
estimated authorisation time. When the report is signed, it appears in her system as a FHIR
`DiagnosticReport` with a link to an `ImagingStudy` that opens the images in the browser in one click,
no CD, no login prompt because the session is federated.

**What they do.** Orders, adds the clinical question ("? medial meniscal tear, locking"), and moves
on. Days later, she opens the result in her file, views the key images embedded in the report, and
opens the full study to plan surgery.

**What the Platform does.**
* M21 Platform Core and packages/hl7-fhir: inbound FHIR `ServiceRequest` becomes an M04 order, mapped
  to the Practice's procedure catalogue; the referrer identity is verified by integration key bound
  to her HPCSA and practice numbers.
* M06: the Authorisation Hand (A3) submits the pre-authorisation request to the scheme with the ICD-10 code
  from the order (illustrative: M23.2 for a meniscal derangement), tracks the response, and posts
  the authorisation number to the order; if the scheme requires a clinical motivation the Hand
  drafts it from the order for Dr Mahlangu to approve in one click (the draft is annotated and never
  sent without her acceptance).
* M12 Reporting: the knee MRI structured template produces a report with a findings table; the
  outbound `DiagnosticReport` carries the structured content, a PDF rendering and key image
  references.
* M09 Image Management: images are served by DICOMweb to the embedded viewer with federated
  single sign-on; a DICOM push to her own PACS is available as a Settings option.
* M13: status events flow to her system as FHIR subscription notifications if supported, otherwise as
  Referrer Space notifications.

**Edge cases.**
* The scheme declines the authorisation: the order shows "Authorisation declined, reason: benefit
  exhausted"; the patient is quoted the cash price and offered a payment plan; Dr Mahlangu is
  informed and may add a motivation for appeal.
* Her system supports only HL7 v2: an ORM order in and ORU result out over MLLP through the
  integration bus; the Referrer Space remains available for images and status.
* Her receptionist orders on her behalf: the delegated role may create orders under her name; the
  order records who entered it and she is asked to countersign orders for studies with ionising
  radiation (HPCSA and Radiation Control expectations; configurable policy).

**Success measure.** Zero re-keying between her system and the Platform; report and images inside
her own file within minutes of sign-off.

## Scene 3 - Casualty doctor at 02:00: STAT CT head

**Situation.** Dr Botha is the casualty doctor at a private hospital where Bonakala Practice C runs
imaging under a JV. At 02:00 an unidentified patient arrives with a head injury and a falling GCS. He
needs a CT head now and a radiologist's opinion within minutes.

**What they see.** In the hospital's clinical system he places a STAT order; alternatively he opens
the Referrer Space *Urgent* section on his phone, taps *STAT CT head*, scans the patient's temporary
wristband, and adds one line. The Urgent screen shows a live timeline: "Order received 02:04 ·
On the scanner 02:11 · Images at archive 02:19 · AI triage priority: high (flagged for the
radiologist to look at first) · Radiologist reading: Dr Sithole (Hub) 02:21 · Report signed 02:33".
At 02:34 his phone rings: it is the Critical Results Hand, which says who is calling, names the
patient by wristband ID, states the critical finding as signed by Dr Sithole, and asks him to
acknowledge by saying his name and pressing 1, or by tapping the link that arrives at the same time.
He can also ask to be connected to Dr Sithole directly.

**What they do.** Places the STAT order, watches the timeline while stabilising the patient, takes
the call, acknowledges, and calls the neurosurgeon. The report is already in the hospital system.

**What the Platform does.**
* M04: the STAT priority sets a hard turnaround target (illustrative: 30 minutes from image arrival
  to signed report, stored per Practice and per priority) that the RGT worklist renders as an SLA
  timer.
* M08 Acquisition & Worklist: the Modality Worklist entry is created from the temporary ADT record
  within seconds; the radiographer scans the wristband, not the name.
* M11 Clinical Intelligence: the intracranial haemorrhage model (registered in the Model Registry with
  its SAHPRA status and version) produces a triage priority with provenance; the priority reorders the
  Hub worklist but is never shown to Dr Botha as a result, only as "flagged for the radiologist to
  look at first".
* M12: Dr Sithole reads from home on the Hub (see the RGT journey) and signs; the report marks the
  finding as critical with a coded category.
* M13: the Critical Results Hand (A3, mandate: contact the responsible referrer for a signed critical
  finding by phone, WhatsApp and the hospital system; record acknowledgement; escalate to the
  on-call clinical lead if no acknowledgement within a configurable window) makes the call, reads
  only the radiologist's signed wording, records the acknowledgement path, and posts it to the
  report. Event: `critical.finding.raised.v1`, `critical.finding.acknowledged.v1`.
* M06 and M14: the study is funded as an emergency pending identity; PMB status is suggested later
  by the Coding Hand and confirmed by BIL.

**Edge cases.**
* Dr Botha does not answer: the Hand retries at intervals, tries the casualty unit's landline and
  the hospital's on-call switchboard, and escalates to the radiologist and the Practice's clinical
  lead; the Flare banner on the Reading Room and on Dr Botha's Referrer Space stays until
  acknowledgement.
* The hospital link is down (load-shedding, fibre cut): the Edge Gateway holds the study locally; the
  on-site radiographer calls the on-call radiologist by phone; the Platform records the manual path
  and reconciles when the link returns.
* Dr Botha wants to speak to the radiologist before the report: the Urgent section has *Call a
  radiologist now* with a call-back target; the call is logged against the study.

**Success measure.** STAT CT head signed within the target; critical finding acknowledged by the
responsible doctor within minutes with a recorded path; no critical finding ever relies on a
voicemail.

## Scene 4 - Occupational health doctor: 40 miners for chest X-rays

**Situation.** Dr Mokoena is the occupational medical practitioner for a platinum mine in the North
West. Under ODMWA and the mine's medical surveillance programme, she needs annual chest X-rays for
40 underground workers, with reports that include the ILO classification for pneumoconiosis where
required, and a summary that fits the mine's records.

**What they see.** In the Referrer Space she opens *Refer, Batch* and uploads a spreadsheet exported
from the mine's occupational health system (employee number, name, ID, date of birth, job category,
last X-ray date). The Platform validates every row, matches existing patient records, shows which
workers already had a chest X-ray within the interval (so that dose is not wasted), and proposes
two options: a mobile-unit visit to the mine clinic on a date with capacity, or slots at the nearest
Bonakala site over two weeks. She picks the mobile unit. A single corporate quote appears, under the
mine's contract. After the visit, the Results section shows a batch view: 40 rows, each with the
report status, the ILO category where read, and a flag column; she can download a single PDF pack
or a CSV for the mine's system, and the reports are also sent to the Medical Bureau for Occupational
Diseases pathway where the Practice's process requires it.

**What they do.** Uploads the list, confirms the date, receives per-worker results and the batch
summary, and books the three workers with flagged findings for follow-up from the same screen.

**What the Platform does.**
* M04: creates 40 orders in one batch with a common contract, indication ("annual surveillance,
  ODMWA") and report template option ("Chest, occupational, ILO classification"); orders for
  workers imaged within the interval are held for her confirmation with the dose note.
* M06: the corporate funder contract (fee schedule, VAT, invoicing terms, purchase order number) is
  applied; no benefit check against personal schemes.
* M05 and M18 Assets & Engineering: the mobile unit is scheduled as a modality with a location;
  its licence and QA status are checked before the date is offered.
* M12: the occupational template requires a radiologist with recorded ILO reader credentials (M17)
  for the classification section; the worklist routes accordingly.
* M13: results are delivered to Dr Mokoena in full, to each worker's Patient Space, and to the
  employer only as the summary status she authorises; retention follows the occupational record
  class. Findings candidates for tuberculosis from the BCI chest model raise the RGT triage priority
  and, after signing, the urgent results pathway to Dr Mokoena.
* M14: one corporate invoice, itemised, with the purchase order reference; the Collections Hand
  follows corporate terms, not consumer dunning.

**Edge cases.**
* A worker refuses the X-ray: the order is closed with the reason; Dr Mokoena sees it in the batch.
* A worker's ID number fails validation: the row is flagged for correction before any order exists.
* The mine wants the images too: DICOM export to the mine's system or a bulk share link with consent
  under the employment health lawful basis, recorded in M19.
* Rain and a closed mine road on the day: the visit is rescheduled by the Booking Hand with one
  message to Dr Mokoena and one to each worker.

**Success measure.** 40 orders from one upload; all reports with ILO classification returned within
the contracted turnaround; flagged workers booked for follow-up from the batch view.

## Scene 5 - Oncologist with a serial-imaging protocol

**Situation.** Dr Pillay is a medical oncologist in Durban. Her patient Mrs Govender has metastatic
colorectal cancer and needs CT chest, abdomen and pelvis every 12 weeks on treatment, reported with
measurable target lesions so that response can be tracked over time. Today the market gives her a
new PDF every quarter with measurements buried in prose.

**What they see.** In the Referrer Space she creates a *Standing protocol* for Mrs Govender: study,
interval, contrast, indication, the response-assessment convention the Practice supports (a
RECIST-style measurement schema, used descriptively), and the treatment start date as baseline. From
then on, every 12 weeks the Booking Hand offers Mrs Govender slots without Dr Pillay lifting a finger,
and the scheme authorisation is requested in advance. When each report is signed, the Results section
shows a *Trend* view: the target lesions in a table with measurements per timepoint, a sparkline per
lesion, the sum of diameters over time, and the radiologist's response category, each value linked to
the key image where it was measured. The comparison text in the report was drafted automatically from
the prior measurements and confirmed by the radiologist.

**What they do.** Sets up the standing protocol once; before each clinic visit opens the trend, shows
Mrs Govender the graph, and decides on treatment. When she changes the regimen she resets the
baseline from the Trend view, which records a new baseline date.

**What the Platform does.**
* M04: a standing order generates child orders on schedule with the correct indication and the
  ICD-10 codes carried forward; each child order is a normal order for authorisation and billing.
* M05: the Booking Hand (A3) prefers the same site and scanner for comparability and books the
  contrast slot with the NUR resource attached; M07 sends Mrs Govender the contrast safety questions
  and the eGFR requirement.
* M06: the Authorisation Hand requests authorisation in advance under the oncology benefit, including the
  scheme's oncology programme reference where the scheme runs one.
* M12: the structured oncology template carries lesion measurements as data (lesion id, site, series,
  image number, long axis, short axis for nodes); the `PriorStrip` loads previous timepoints; the
  comparison auto-text is drafted from data and rendered in the annotated style until the
  radiologist accepts it; the same radiologist or a small reader group is preferred by the worklist
  for continuity (configurable).
* M13: the Trend view is a projection of signed measurement data; a change in response category is a
  coded event that Dr Pillay is notified about immediately, not only when she opens the report.
* M09: prior timepoints are pre-fetched to the reading cache before the appointment.

**Edge cases.**
* Mrs Govender is scanned elsewhere once (while travelling): Dr Pillay can request the outside study
  be imported with consent; its measurements are entered by the radiologist as an external
  timepoint and marked as such.
* eGFR too low for contrast on the day: the NUR journey handles it; Dr Pillay is notified with the
  options (non-contrast protocol, rebook after review).
* A new lesion appears: the report codes it as a new lesion; the Trend view flags progression; the
  notification is urgent, not critical, per the Practice's category definitions.
* The scheme's oncology programme declines a scan as outside protocol: the order is held, Dr Pillay
  sees the reason and may submit a motivation drafted by the Authorisation Hand for her approval.

**Success measure.** Standing protocol runs for a year without a single manual booking; every
quarterly report has a measurement table and a trend that Dr Pillay can show her patient.

## Scene 6 - Every referrer: results, analytics and preferences

**Situation.** Once a month, Dr Naidoo (Scene 1) looks at how her referrals are doing.

**What they see.** The Analytics section shows her volumes by modality, her patients' attendance rate,
the median report turnaround for her referrals against the Practice's target, and how often her
referrals carried a pre-authorisation delay. Settings lets her choose delivery: WhatsApp Business for
STAT and critical, email PDF daily digest for routine, and the plain-language patient layer on or
off per patient. She can also add locum doctors under her practice number for a fixed period.

**What the Platform does.**
* M16 Analytics & Insight: referrer-level KPIs from the semantic layer; she sees only her own
  patients (M01 scoping); the Practice sees referrer analytics in aggregate for relationship work,
  never for inducements (HPCSA rules on perverse incentives; the Platform records no referrer
  rewards of any kind).
* M13: delivery preferences per priority class; the Platform records every delivery attempt and
  outcome, which is the referrer's proof that a result reached her.

**Success measure.** Referrers can answer "did my patient attend and what did it show" without a
phone call, every time.

## Moments that beat the market

* A photograph of a handwritten form becomes a structured order with slots offered to the patient
  before the consultation ends.
* Referral status is visible end-to-end: Referred, Booked, Arrived, Scanned, Reported, Viewed. A
  no-show is a notification, not a mystery.
* Critical findings are phoned by the Critical Results Hand within minutes of sign-off, read only in
  the radiologist's words, and the acknowledgement is recorded against the report.
* Results arrive inside the referrer's own system as FHIR or HL7 with key images, and the full study
  opens in the browser with no CD and no second login.
* Pre-authorisation and motivations are handled by the Authorisation Hand, with the referrer approving a
  drafted motivation in one click.
* Serial oncology imaging is a standing protocol with measurement tables and trends, not a quarterly
  PDF.
* Batch occupational orders from a spreadsheet, a mobile unit visit and ILO-classified reports back
  in a single batch view.
* Appropriateness guidance at the point of ordering, informative and never obstructive.

## Failure modes designed out

* Referral lost between the consulting room and the imaging site: the referral is an object with a
  status and an owner from the moment the photo lands.
* Result phoned to the wrong doctor: the responsible referrer is a verified identity on the order;
  the Critical Results Hand calls recorded numbers and records who acknowledged.
* Critical finding left on voicemail: no acknowledgement, no closure; escalation is automatic.
* Report content lost in prose: structured templates carry measurements and recommendations as data.
* Authorisation obtained after the scan, or never: the Authorisation Hand tracks it from the order and the
  slot is not confirmed without a funding position the patient has seen.
* Ionising radiation ordered by an unverified or delegated user without oversight: verified
  identities and countersignature policy.
* Referrer analytics used as an inducement: no reward features exist; analytics are for care
  quality and turnaround only.
* Priors in another system: standing protocols pre-fetch priors and prefer the same scanner.
