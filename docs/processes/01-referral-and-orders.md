# 01 — Referral and Orders (M04 Referral & Orders)

## 1. Purpose

Turn every inbound request for imaging, whatever its channel and format, into one structured,
validated, clinically justified **Order** that downstream modules (M05 Scheduling & Capacity,
M06 Funding & Authorisation, M07 Registration & Safety, M08 Acquisition & Worklist, M14 Revenue
Cycle) can act on without re-keying. The Order is the single object that carries the patient, the
referrer, the requested procedures, the clinical question, the ICD-10 codes, the funding context
and the status through to a signed report.

"Better than the market" for this process means: a referrer never has to phone; a patient never
has to carry the same paper twice; a booking agent never types a referral out by hand; and no study
is performed without a lawful, recorded justification. The target is that at least 80 % of orders
reach a validated state without a human touching them, with the **Referral Hand** doing the work
under a leash and routing exceptions to BKG.

## 2. Trigger

Any of the following creates a candidate order:

| Channel | Trigger event |
|---|---|
| Paper referral brought by the patient | PAT photographs it in WhatsApp or Patient Space, or FDK scans it at the desk |
| Fax-to-digital | Fax gateway delivers a PDF/TIFF to the integration bus (M21) |
| Email | Referral or letter arrives at a monitored practice mailbox |
| Phone | REF, practice staff or PAT calls central booking (BKG) |
| WhatsApp | REF or PAT sends a photo, PDF or free text to the practice's WhatsApp Business number |
| Referrer Space e-referral | REF submits a structured order in Referrer Space or the embedded widget |
| FHIR `ServiceRequest` / HL7 v2 `ORM^O01` | Hospital or practice-management system pushes an order (hospital Sites, M02-R-008) |
| Walk-in | PAT presents at a Site with or without a referral |
| Repeat / serial imaging | An existing Order or protocol schedules the next study (oncology, follow-up, screening recall) |
| Batch | Occupational health provider or employer uploads a list (ODMWA, pre-employment, COIDA) |
| Funder / legal | RAF, Compensation Fund, attorney or medico-legal instruction |

## 3. Actors

| Persona | Role in this process |
|---|---|
| REF | Originates the request; signs the justification; receives the report |
| PAT | Supplies the referral artefact, demographics, scheme details; confirms intent |
| BKG | Owns the exception queue; validates uncertain extractions; converts to bookings |
| FDK | Captures walk-in and paper referrals at the desk; verifies identity (M07) |
| RGT | Protocols CT/MRI/interventional orders; justifies self-referred or ambiguous requests; decides on appropriateness escalations |
| RAD | Flags orders that are technically infeasible or unsafe (M07, M08) |
| BIL | Reviews tariff-code and ICD-10 suggestions where the funding rules demand pre-coding |
| CMP | Sets justification policy, referrer verification policy, retention; audits overrides |
| PAY | Consumes order data for authorisation (M06) |
| Referral Hand | The M20 Hand that reads, extracts, validates, enriches and routes every inbound artefact |

## 4. Preconditions

* The Practice (tenant) has configured its **justification policy** (§7.7), its accepted referrer
  categories, and its procedure catalogue with tariff-code mappings (M14 reference data).
* Channels are enrolled: WhatsApp Business number, fax-to-digital gateway, monitored mailboxes,
  Referrer Space accounts, hospital HL7/FHIR endpoints (M21).
* The **Referrer Master** (§7.2) is loaded and verification sources are configured.
* The Referral Hand is enabled with a leash for this tenant (M20).
* Reference data loaded: procedure catalogue, protocol library, ICD-10 (current SA release as
  published for claims), tariff codes, laterality and contrast rules, referral guideline pack.

## 5. Happy path (Referrer Space e-referral, the target channel)

1. REF opens Referrer Space (or the widget inside their practice system) and selects the patient
   from their own list or enters ID number and mobile number. The Platform searches the Patient
   Master Index (M03) under the Practice's lawful basis and returns a match or creates a stub.
2. REF types or dictates the clinical question ("Right knee pain after fall, ?meniscal tear") and
   picks a body region. The Platform suggests procedures with appropriateness guidance (§7.5):
   "MRI knee without contrast is the guideline-preferred study when X-ray is normal."
3. REF confirms procedures, laterality, contrast preference (or "radiologist to decide"), urgency,
   pregnancy status if known and relevant history (renal impairment, allergy, implants). ICD-10
   suggestions are shown as *suggested codes* with provenance; REF accepts or edits.
4. REF chooses a preferred Site or "earliest anywhere near the patient" and a report delivery
   preference. Referrer identity, HPCSA number and practice number are already verified from the
   Referrer Master; the referral is electronically signed by the logged-in REF (M01 SSO, MFA).
5. The Platform creates the Order in status `Validated` (no extraction step was needed), runs
   duplicate/recent-study detection (§7.6), and hands off to M06 for a funding check and to M05 for
   a slot offer. If a CT or MRI is involved, a **protocolling task** is created for RGT.
6. Within seconds REF sees: order number, funding indicator ("Scheme benefit confirmed, no
   pre-authorisation required" or "Pre-authorisation being requested by the Authorisation Hand"),
   and the three earliest slots at nearby Sites. REF can book one on the patient's behalf or let the
   Booking Hand contact the patient (M05).
7. PAT receives a WhatsApp/SMS message: "Dr Naidoo has referred you for an MRI of your right knee.
   Reply 1 to book the earliest slot (Umhlanga, Thursday 09:40) or 2 to choose another time."
8. Order status moves to `Scheduled`, then follows the lifecycle in §7.8. REF sees attendance,
   completion and the signed report in Referrer Space (M13).

Target duration from step 1 to step 6: under 90 seconds of REF time.

## 6. Variants and exceptions by channel

### 6.1 Paper referral photographed by PAT (WhatsApp or Patient Space)

1. PAT sends a photo. The WhatsApp conversation engine (apps/whatsapp) acknowledges within 5 seconds
   and asks for the patient's ID number if the sender is not yet linked to an identity.
2. The Referral Hand runs document capture: de-skew, OCR, handwriting recognition, layout
   understanding. It extracts referrer name, practice number (often a stamp), HPCSA number, date,
   patient name, ID number, requested examination(s), clinical notes, ICD-10 if written, and any
   ticked boxes on pre-printed forms. Each field carries a confidence score.
3. The Hand matches the referrer to the Referrer Master (stamp and practice number first, then
   name and location). Unknown referrers trigger §6.12.
4. Procedures are mapped to the catalogue ("XR L spine AP/lat" to the lumbar spine two-view
   procedure). Laterality and contrast are inferred only when unambiguous; otherwise flagged.
5. If every mandatory field is above the confidence threshold (default 0.90, configurable) the
   Order is `Validated` and the patient is offered slots. If not, the Order enters `Needs review`
   and BKG sees the image side by side with the extracted fields, confirms or corrects in one screen.
   The correction is logged as training signal for the extraction model (M11 governance).
6. The original photo is stored as an immutable document attached to the Order (M21 files) and is
   shown to FDK at check-in so the paper does not need to be handed over again.

Poor images: the Hand replies with a specific instruction ("The bottom of the form is cut off.
Please send one more photo showing the doctor's stamp.") at most twice, then routes to BKG.

### 6.2 Fax-to-digital and email

Both follow 6.1 from step 2. The fax cover page or sending email address is a strong
referrer-match hint. Multi-page faxes are split per patient; one artefact may yield several
Orders. Emails from an address in the Referrer Master are "referrer-identified"; others are
"unverified" and cannot leave `Needs review` until BKG confirms the referrer by call-back. After
the third fax in a month the sender is offered Referrer Space enrolment (M13).

### 6.4 Phone

BKG takes the call in the omnichannel inbox. Consented call recording is transcribed in near-real
time; the Referral Hand fills the order form while the agent talks, showing the same annotated
style as any AI suggestion. Nothing is saved until BKG accepts. A phoned referral from REF creates
a `Verbal` referral that MUST be followed by a written or electronic confirmation before
acquisition on ionising modalities unless the tenant policy allows verbal justification for
urgent cases with a named practitioner and a call-back verification (§7.7). The Platform sends the
referrer a one-tap confirmation link by WhatsApp or email.

### 6.5 WhatsApp free text from a referrer

Referrers registered on WhatsApp Business with a verified mobile number may send text such as
"Pls do CT brain no contrast for Mrs P Dlamini ID 6803… headache 3/52, worse in mornings". The
Hand treats this as a signed e-referral only if the number belongs to a verified REF with an
active HPCSA registration; otherwise it is `Verbal` pending confirmation.

### 6.6 FHIR ServiceRequest and HL7 ORM

* HL7 v2 `ORM^O01` (new order, cancel, update) over MLLP from hospital systems attached to a Site,
  and FHIR R4 `ServiceRequest` with `Patient`, `Practitioner`, `Coverage` and `Encounter` resources
  over REST (packages/hl7-fhir).
* Mapping: `OBR-4` universal service identifier or `ServiceRequest.code` to the procedure catalogue
  through a per-sender code map; `ORC-1` control codes drive create/cancel/replace; `PV1` visit
  data links the Order to an inpatient encounter and bed; `DG1` or `reasonCode` to ICD-10.
* Unmapped codes route to a BIL/BKG mapping task once and are then remembered per sender.
* Priority `S` (STAT) creates an immediate worklist entry (M08) and bypasses slot search; the
  Order still records justification and the ordering practitioner.
* Acknowledgements (`ACK`) are returned only after the Order is durably stored; rejections carry a
  human-readable reason.

### 6.7 Walk-in without a referral

What may be done without a referring practitioner is governed by the tenant's **justification
policy**, which the Platform stores as configurable rules with a default that is deliberately
conservative:

| Request type | Default rule (configurable per Practice; CMP owns) |
|---|---|
| Any X-ray, CT, fluoroscopy, diagnostic mammography, DXA, nuclear medicine | A request from an authorised referrer is REQUIRED before exposure. A radiographer MUST NOT accept a self-referral for an ionising exposure; justification rests with the referrer and radiologist under SAHPRA Radiation Control requirements and HPCSA ethical rules. Walk-ins are recorded as `Enquiry` and helped to obtain a referral (or an on-site radiologist justification where the Practice allows it). |
| Screening mammography (asymptomatic, in the screening age band) | MAY be accepted on self-presentation under a screening programme with a named responsible radiologist; a screening questionnaire replaces clinical notes; symptomatic women are redirected to a diagnostic referral. |
| Ultrasound (non-ionising) | MAY be accepted without a referrer where the responsible radiologist accepts clinical responsibility for the specific study type. Scheme claims generally need a referring practice number, so a self-referred ultrasound defaults to cash pricing. |
| MRI | Requires a referrer by default; funders require one for authorisation. |
| Occupational health (pre-employment, periodic, ODMWA) | The occupational health practitioner's standing order or batch instruction is the referral. |
| Repeat within the recent-study window | See §6.8. |

Control C-04 stops the M08 worklist receiving an ionising study without a justification record.
Who counts as an authorised referrer (medical practitioners, dentists, and for defined
examinations chiropractors, physiotherapists and others) is configuration, because the legal
position differs by profession and examination and changes over time.

### 6.8 Repeat and serial imaging

* **Follow-up requested on the original referral** ("repeat chest X-ray in 6 weeks"): the Order
  carries a `series_plan` with due dates; the Platform creates the child Order automatically at
  the due date and the Booking Hand contacts the patient. The original justification is reused if
  the referrer's instruction covers it and the policy window has not lapsed.
* **Oncology protocols**: an oncologist enrols a patient in a protocol (for example a restaging
  CT every 3 cycles, or a surveillance schedule). The protocol template defines procedures,
  intervals, contrast, and a standing ICD-10 set. Each occurrence becomes an Order with a link to
  the protocol; changes to the protocol re-plan future occurrences and notify REF. Funding for
  oncology is usually managed under a scheme oncology programme; M06 records the programme
  reference on each Order.
* **Interval limits**: the Platform warns when a repeat of an ionising study is requested within
  the "recent-study" window (§7.6) and requires the referrer or radiologist to confirm the reason.

### 6.9 Screening programmes (mammography)

A programme object defines eligibility (age band, interval, risk category), recall rules, the
responsible radiologist, and the consent text. Enrolment can come from a referrer, from PAT in
Patient Space (where self-presentation is allowed) or from a corporate wellness contract. The
programme generates recall Orders, tracks attendance, and feeds screening outcome data (recall
rate, cancer detection rate) to M16 in de-identified form. A symptomatic answer on the screening
questionnaire converts the Order to diagnostic and requires a referrer or radiologist
justification.

### 6.10 Occupational health batches (ODMWA chest X-rays)

* An occupational health provider or mine uploads a roster (CSV, spreadsheet or API) of workers
  for initial, periodic or exit examinations. The batch becomes one `Batch` object and one Order
  per worker, with the employer, cost centre and contract (M06) attached.
* Chest radiographs under ODMWA (Occupational Diseases in Mines and Works Act) are acquired to the
  technical standard required for **ILO classification** of pneumoconioses. The Order carries the
  flag `ilo_classification_required`; M08 applies the ILO-quality protocol; M12 uses the ILO
  classification reporting template (profusion, shape and size of opacities, pleural findings,
  image quality grade) completed by a reader who holds the required training, recorded in M17.
* Batch outputs for the employer or the Medical Bureau for Occupational Diseases (structured
  export plus PDF per worker) use configurable templates; worker consent and the employer's lawful
  basis are recorded. The Order's record class applies the longer occupational retention (07 §10).

### 6.11 RAF, COIDA and medico-legal orders

* **RAF (Road Accident Fund)**: the referral usually comes from a treating practitioner but the
  payer is the Fund, most often via an attorney's undertaking or after the claim is settled. The
  Order records `funding_context = RAF`, the attorney or claims handler, the RAF claim reference
  if known, the accident date, and whether an undertaking exists. M06 handles the financial path.
* **COIDA / Compensation Fund (injury on duty)**: the Order records employer, date of injury, the
  employer's report and the treating practitioner's first medical report references (the W.Cl
  form numbers are illustrative and stored as configurable document types), and the claim number
  when issued. Without an employer confirmation the Order is flagged `IOD unconfirmed` and M06
  decides whether to treat the patient as cash pending confirmation.
* **Medico-legal**: instructed by an attorney or independent medical examiner. The Order captures
  the instructing party, purpose and chain-of-custody requirement (image hashes at ingest, M09).
  Results go to the instructing party and are withheld from Patient Space until released
  (configurable, subject to the patient's POPIA access rights).

### 6.12 Unknown or unverifiable referrer

If the referrer is not in the Referrer Master, the Hand searches the configured verification
sources (§7.2), creates a `provisional` referrer with the evidence it found, and asks BKG to
confirm by call-back to a number obtained independently (not from the referral itself). Orders
from provisional referrers can be scheduled but cannot proceed to acquisition on an ionising
modality until verification passes, unless CMP has enabled a grace policy for known hospital
departments.

### 6.13 Cancellation, replacement and unidentified patients

Cancellations arrive by any channel or by `ORC-1 = CA`; downstream appointments and
authorisations are cancelled, the patient informed and the reason recorded. A replacement creates
a new Order version linked to the original. Trauma orders may reference a temporary identity (M07)
and are reconciled when identity is established, with the reconciliation logged.

## 7. Detailed design

### 7.1 Referral data standard

Every Order, whatever the channel, is normalised to this structure (Zod schema in packages/domain):

| Field group | Fields | Mandatory before `Validated` |
|---|---|---|
| Identity | `order_id`, `practice_id`, `channel`, `source_artefact_ids[]`, `received_at`, `version` | Yes |
| Patient | `patient_id` (M03) or stub with name, DOB, sex, ID/passport number, mobile, language preference | Name + DOB or ID + mobile |
| Referrer | `referrer_id` (Referrer Master), HPCSA number, practice number, referring facility/department, copy-to clinicians[] | referrer_id verified or provisional with evidence |
| Clinical | free-text clinical question, structured history flags (pregnancy, renal, allergy, implants, diabetes/metformin, anticoagulation), ICD-10 codes[] with provenance, urgency, relevant prior imaging | Clinical question; urgency |
| Requested procedures | items[] each with catalogue procedure, body region, laterality (L/R/bilateral/n.a.), contrast (yes/no/radiologist to decide), protocol suggestion, tariff-code suggestions[], modifiers | At least one item; laterality where the procedure requires it |
| Justification | justification type (referrer request, radiologist justification, screening programme, standing order), justifying practitioner, date, notes | Yes for ionising procedures |
| Funding context | funder type (scheme/cash/RAF/COIDA/corporate/state/foreign), membership reference, employer/attorney, programme reference | Type only; details completed by M06 |
| Logistics | preferred Site, mobility needs, interpreter/language, chaperone, appointment constraints | No |
| Series | `series_plan`, `protocol_id`, `occurrence_n` | Only for serial orders |
| Legal | medico-legal flag, instructing party, chain-of-custody requirement | Only when applicable |
| Provenance | per-field: source (human, OCR, LLM extraction, HL7), model id/version, confidence, accepted_by/at | Yes for every AI-filled field |

### 7.2 Referrer Master

A shared (Group-level, de-identified of patient data) directory of referring practitioners and
facilities, replicated into each tenant with tenant-specific preferences.

* Attributes: person, profession and register (HPCSA, or the Allied Health Professions Council
  for chiropractors), registration number and status, BHF practice number(s), practices and
  addresses, verified contact channels, delivery preferences (M13), specialty, Referrer Space
  account, integration keys, WhatsApp opt-in.
* **Verification**: HPCSA registration is verified against the HPCSA register (online lookup as
  available, or periodic file) and re-checked on a schedule (default 90 days, configurable) and on
  every referral from a referrer whose last check is stale. Practice numbers are validated for
  format and, where a PCNS lookup is contracted, for existence and status. Verification results
  are stored with timestamps and evidence.
* A referrer whose registration lapses is set to `inactive`; new referrals from them enter
  `Needs review` with the reason shown, and CMP is notified.
* Duplicate referrer records are merged with history preserved; referral analytics (M16) follow
  the surviving record.

### 7.3 Order composition

* **Procedure catalogue**: one canonical procedure per modality and body-region variant ("CT
  abdomen and pelvis with IV contrast"), each with default protocol(s), duration by protocol (feeds
  M05), radiation flag, contrast options, laterality rule, multilingual preparation instructions,
  safety questionnaire set (M07), and **tariff-code mapping suggestions** with multi-procedure and
  modifier relationships (illustrative: a CT with contrast maps to the CT code plus a contrast
  material code and a consumable line). Codes are configurable reference data in M14 and differ
  by scheme rule pack; the Order stores *suggested* codes and M14 finalises after the report.
* **Laterality** is mandatory for paired structures and is carried into the DICOM Modality
  Worklist (M08) so the technologist and the modality agree.
* **Contrast**: yes / no / radiologist to decide; a "yes" pulls the contrast safety set into M07 and
  a contrast line into the quote (M06).
* **ICD-10**: mandatory on claims in South Africa; captured at order time as suggested codes
  (from the referrer's text, the referral form, or HL7 `DG1`) with provenance, confirmed or
  corrected by BIL at coding (M14). The Platform validates code format, validity in the current
  release, sex and age plausibility, and "primary code cannot be a symptom code where a diagnosis
  is stated" style rules from the scheme rule packs.
* **Urgency**: routine, priority (within 7 days), urgent (24 h), STAT (now). STAT bypasses slot
  search and creates an immediate worklist item, subject to safety checks.

### 7.4 Radiologist protocolling

For CT, MRI, nuclear medicine and interventional procedures, and for any order the appropriateness
engine flags, a protocolling task goes to the RGT queue (or the Hub when the Practice contracts
protocolling out). The task shows the clinical question, priors, safety flags and the AI-suggested
protocol with provenance. The radiologist accepts, edits or replaces the protocol, decides contrast,
and may change the procedure (with REF notified) or decline the request with a reason and a
recommended alternative. Protocolling is A1 by policy: the suggestion never becomes the protocol
without a radiologist's acceptance. Protocol decisions flow to the technologist's protocol card
(M08) and to the quote (M06) when they change the billable procedure.

### 7.5 Clinical appropriateness guidance

* A rules-plus-model decision support layer scores each requested procedure against the referral
  guideline pack the Practice adopts (a national or international referral guideline set used
  descriptively; the pack is configurable reference data with a version and effective date).
* Output: appropriateness band (usually appropriate / may be appropriate / usually not
  appropriate), the guideline citation, and alternatives. Shown to REF at order entry in the
  annotated style; REF may proceed regardless, but the band is recorded and, for "usually not
  appropriate" ionising studies, the Order requires radiologist protocolling before scheduling.
* Never blocks an urgent or STAT order; the guidance is advisory to the referrer and a routing
  signal to the radiologist.
* Guidance quality is monitored by AIO: override rate by referrer and by guideline entry.

### 7.6 Duplicate and recent-study detection

* On every new Order the Platform searches M09 and M03 for studies of the same patient, same
  modality and body region within a configurable window (default: 30 days for radiography, 90 days
  for CT/MRI, 12 months for screening mammography, per-programme for oncology).
* Matches produce a **recent-study alert** on the Order with a link to the prior report (where
  the patient has consented to cross-Practice sharing) and a required action: REF or RGT confirms
  the repeat is justified, or the Order is converted to a "release of prior images" request (M13),
  which needs no exposure.
* Exact duplicates (same referrer, same procedure, same clinical text within 7 days) are merged
  automatically at A2 with a notice to REF.

### 7.7 Justification policy engine

A per-tenant rule set (CMP owns; versioned) that answers, for each Order: is there a lawful,
recorded justification for each exposure? Inputs: procedure radiation flag, referrer category and
verification status, justification type, urgency, patient age and pregnancy status, programme
membership. Outputs: `justified`, `justified_pending_confirmation` (for example verbal referral
awaiting written confirmation), or `not_justified` with the missing element. The engine's decision
is stored on the Order and enforced by control C-04.

### 7.8 Order status lifecycle

| Status | Meaning | Entered by | Exits to |
|---|---|---|---|
| `Received` | Artefact stored, Order shell created | Any channel | `Extracting`, `Cancelled` |
| `Extracting` | Referral Hand parsing and enriching | Hand | `Needs review`, `Validated` |
| `Needs review` | Human confirmation required (low confidence, unknown referrer, policy flag) | Hand | `Validated`, `Rejected`, `Cancelled` |
| `Validated` | Structure complete, referrer verified or provisional, justification evaluated | Hand or BKG | `Protocolling`, `Funding`, `Scheduling` |
| `Protocolling` | Awaiting RGT protocol decision | Platform | `Funding`, `Scheduling`, `Declined` |
| `Funding` | M06 benefit check / auth / quote in progress (parallel with scheduling) | M06 | `Scheduling`, `On hold` |
| `Scheduling` | Slot search or waitlist (M05) | M05 | `Scheduled`, `Waitlisted` |
| `Scheduled` | Appointment booked | M05 | `Ready`, `Rescheduled`, `No-show`, `Cancelled` |
| `Ready` | Funding and safety prerequisites complete for the appointment | M06/M07 | `Arrived` |
| `Arrived` | Patient checked in (M07) | M07 | `In progress` |
| `In progress` | On the worklist / being acquired (M08) | M08 | `Completed`, `Abandoned` |
| `Completed` | Acquisition done, study in PACS (M09) | M08 | `Reported` |
| `Reported` | Report signed (M12) and delivered (M13) | M12 | `Closed` |
| `Closed` | Billed and communicated | M14 | Terminal |
| `On hold` | Waiting for funder, patient decision, or referrer confirmation | Any | Previous status |
| `Waitlisted` | No acceptable slot; on waitlist | M05 | `Scheduled` |
| `Declined` | Radiologist declined; alternative suggested | RGT | Terminal (linked new Order) |
| `Rejected` | Not a valid referral (spam, wrong practice, unverifiable) | BKG | Terminal |
| `Cancelled` | Cancelled by any party | Any | Terminal |
| `Expired` | No booking within the validity window (default 90 days) | Scheduler | Terminal (re-openable) |

Every transition emits `order.<status>.v1` on the event bus (M21) with the actor and reason.

### 7.9 Referrer communication

* Order acknowledgement to REF within one minute of `Validated` on their preferred channel, with
  the order number and what happens next.
* Status changes REF cares about: scheduled (with date), patient did not attend, completed, report
  signed, critical finding (M13 with its own acknowledgement path), order declined or changed by the
  radiologist.
* Requests to REF (confirm a verbal order, clarify, confirm a repeat, supply information a funder
  demands) are one-tap actions with an SLA timer; unanswered requests escalate to BKG for a call.
* All communication is logged on the Order timeline and shown to PAT in plain language where it
  concerns them.

### 7.10 The Referral Hand (M20)

| Element | Definition |
|---|---|
| Mandate | Convert any inbound artefact into a structured, validated Order; enrich with referrer verification, catalogue mapping, ICD-10 and tariff suggestions, duplicate detection, justification evaluation; communicate with PAT and REF to complete missing items; route exceptions. |
| Tools (allow-listed) | `document.extract`, `patient.search` (M03), `referrer.search/verify`, `catalogue.map`, `icd10.suggest`, `guideline.evaluate`, `study.search_recent` (M09, metadata only), `order.create/update`, `message.send` (templated, PAT/REF), `task.create` (BKG/RGT/BIL queues) |
| Leash | May create and validate Orders; may send at most 3 clarification messages per Order; may not change a referrer's verification status; may not create Orders on ionising modalities without a justification evaluation; may not mark a referrer verified; may not delete artefacts; budget per Order and per hour; stops and escalates after any tool error twice. |
| Automation level | A3 for routine channels (paper, fax, email, WhatsApp, HL7 with mapped codes). A2 for unknown referrers and policy flags (human reviews the exception queue). A1 for phone (agent accepts every field). |
| Confidence handling | Field-level confidence; Order-level rule: all mandatory fields ≥ threshold and no policy flag → `Validated`; otherwise `Needs review` with the lowest-confidence fields highlighted first (Latent Image order). |
| Data minimisation | Sees the referral artefact and demographics (required by the task); never sees images or free-text reports; prior studies are queried as metadata only. |
| Provenance | Every field it fills carries model id, version, confidence, and the artefact region it came from (bounding box), so BKG can verify by looking. |
| Audit | Full tool-call log per Order (M20); sampled QA by BKG lead weekly; extraction accuracy reported to AIO. |

### 7.11 Data produced

Order (versioned), source artefacts (immutable), referrer verification records, justification
evaluation, appropriateness result, recent-study alerts and resolutions, protocol decisions,
communication log, Hand audit stream, series plans, programme enrolments and batch objects, plus
the events listed in §7.8.

## 8. Automation level summary

| Step | Target level |
|---|---|
| Artefact capture, extraction, catalogue and tariff mapping, referrer communication | A3 (Referral Hand) |
| Referrer matching | A3 known / A2 provisional; verification status change is human |
| ICD-10 suggestion, appropriateness guidance, protocolling | A1 (suggested; humans confirm; ICD-10 finalised in M14) |
| Duplicate and recent-study handling | A2 |
| Justification evaluation | A4 deterministic rule engine, human-only overrides |

## 9. Requirements

* M04-R-100 The Platform MUST accept referrals through every channel in §2 and MUST normalise
  them to the referral data standard in §7.1.
* M04-R-101 Every inbound artefact MUST be stored immutably with a content hash and linked to the
  Order(s) it produced.
* M04-R-102 Every AI-extracted field MUST carry provenance (model id, version, confidence, source
  region) and MUST be presented in the annotated style until accepted.
* M04-R-103 The Platform MUST NOT allow an Order on an ionising modality to reach the M08 worklist
  without a `justified` or `justified_pending_confirmation` evaluation from the justification
  policy engine, and `justified_pending_confirmation` MUST expire into `On hold` after a
  configurable period.
* M04-R-104 A radiographer role MUST NOT be able to record a self-referral justification for an
  ionising exposure; justification entries MUST be by an authorised referrer or a radiologist.
* M04-R-105 The Platform MUST verify referrer HPCSA registration at first sight and at least
  every 90 days (configurable), store the evidence, and validate BHF practice numbers for format
  and, where a lookup is contracted, status.
* M04-R-107 Verbal (phone or unverified WhatsApp) referrals MUST be flagged and MUST require
  written or electronic confirmation from the referrer before acquisition on ionising modalities,
  unless a CMP-approved urgent-care exception applies and is recorded.
* M04-R-108 The Platform MUST run recent-study detection on every Order and MUST require an
  explicit confirmation of the repeat's justification when a match is found within the window.
* M04-R-109 Laterality MUST be captured for paired-structure procedures and MUST propagate to the
  Modality Worklist.
* M04-R-110 ICD-10 codes on an Order MUST be validated for format and currency and MUST be marked
  as suggested until confirmed in M14.
* M04-R-111 CT, MRI, nuclear medicine and interventional Orders MUST pass through radiologist
  protocolling (A1) before acquisition unless a CMP-approved standing protocol applies.
* M04-R-112 Appropriateness guidance MUST be advisory, MUST be recorded with the referrer's
  decision, and MUST NOT block urgent or STAT Orders.
* M04-R-113 HL7 and FHIR inbound messages MUST be idempotent by `(source, message_id)` and MUST
  be acknowledged only after durable storage.
* M04-R-114 The Platform MUST support serial and protocol-driven Orders that auto-create child
  Orders at due dates and re-plan when the protocol changes.
* M04-R-115 Screening programmes MUST be modelled with eligibility, interval, recall and a named
  responsible radiologist, and self-presentation MUST be a per-programme policy switch.
* M04-R-116 Occupational health batches MUST create one Order per worker with employer, contract
  and record class, and MUST flag ILO-classification requirements to M08 and M12.
* M04-R-117 RAF, COIDA and medico-legal Orders MUST capture the responsible party, claim
  references and, for medico-legal, chain-of-custody requirements, and MUST route results to the
  instructing party by default.
* M04-R-118 The Referral Hand MUST operate under a runtime-enforced leash (M20) as defined in
  §7.10.
* M04-R-119 Every status transition MUST emit a versioned domain event with actor and reason, and
  REF MUST see the status of every Order they originated in Referrer Space.
* M04-R-120 Orders MUST expire after a configurable validity window with prior notice to REF and
  PAT.
* M04-R-121 The Platform MAY accept ultrasound and screening mammography self-presentation where
  tenant policy enables it and a responsible radiologist is named.

## 10. KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Straight-through rate | Orders reaching `Validated` with no human edit / all Orders | ≥ 80 % within 12 months of go-live |
| Extraction accuracy | Fields accepted unchanged by BKG in sampled review | ≥ 97 % on mandatory fields |
| Time to validated | Median `received_at` to `Validated` | < 2 min paper/WhatsApp; < 10 s e-referral/HL7 |
| Referrer verification currency | Active referrers with a check ≤ 90 days | 100 % |
| Unjustified exposure attempts blocked | Count of C-04 blocks (should trend to zero as referrers adopt e-referral) | Reported monthly to CMP |
| Duplicate exposures avoided | Recent-study alerts resolved as "use prior" | Reported |
| e-Referral share | Orders via Referrer Space, FHIR or HL7 | ≥ 50 % by month 18 |
| Referrer clarification SLA | Clarification requests answered within 4 working hours | ≥ 90 % |
| Order-to-booking conversion | `Validated` Orders that reach `Scheduled` | ≥ 92 % |
| Protocolling TAT | `Protocolling` entered to exit, working hours | Median < 2 h; urgent < 30 min |

## 11. Controls

| ID | Control | Type |
|---|---|---|
| C-01 | Immutable artefact storage with hash; deletion only under retention policy by CMP | Preventive |
| C-02 | Field-level provenance and annotated rendering for every AI-filled value | Preventive |
| C-03 | Referrer verification with evidence; inactive referrers force review | Preventive |
| C-04 | Hard gate: no ionising-modality worklist entry without a justification evaluation; radiographer role cannot self-justify (Class 1 gate under the no-slip charter) | Preventive |
| C-05 | Verbal referral confirmation timer with automatic hold on expiry | Corrective |
| C-06 | Recent-study alert requiring explicit confirmation | Preventive |
| C-07 | Referral Hand leash enforced by the runtime; weekly sampled QA; accuracy to AIO | Detective |
| C-08 | Appropriateness overrides logged per referrer, reviewed quarterly by the clinical lead | Detective |
| C-09 | POPIA: minimum data on WhatsApp; artefacts stored in SA; cross-Practice prior lookup only with consent | Preventive |
| C-10 | Segregation: Hand suggests codes, BIL confirms, M14 scrubber validates | Preventive |
| C-11 | Medico-legal chain of custody: hash at ingest, access log, restricted result routing | Detective |
| C-12 | Order expiry with referrer notification | Corrective |
