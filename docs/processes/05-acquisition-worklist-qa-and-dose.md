# 05: Acquisition, Worklist, QA and Dose

Modules: **M08 Acquisition & Worklist** (owner) and **M10 Dose & Radiation Safety**.
Related: M07 Registration & Safety (upstream), M09 Image Management (PACS) (downstream), M11 Clinical
Intelligence (BCI), M14 Revenue Cycle (Billing) (charge capture), M17 Workforce (credentials,
dosimetry), M18 Assets & Engineering (equipment, contrast stock), M19 Quality, Risk & Compliance,
M20 Agent Runtime ("Hands").

## 1. Purpose

Turn a registered, safety-cleared, funded order into a complete, correctly labelled, diagnostic-quality
image set, acquired at the lowest dose consistent with the clinical question, and hand it to the archive,
the reading worklist and charge capture without anyone re-keying anything.

The same process keeps the radiation-protection evidence live: every exposure produces a dose record,
every repeat has a coded reason, every room carries a current SAHPRA licence and a QA schedule that is
either on time or visibly overdue, and every staff member's badge cycle is tracked.

Better than the market means: no protocol looked up from a folder, no dose on a paper register, no repeat rate guessed from a reject log, no licence evidence in a lever-arch file, and no worklist that dies with the power. Each of those is replaced by a live record on the Platform, and the department keeps working through load-shedding from the Edge Gateway.

## 2. Scope and modality coverage

| Modality (type code) | MWL / MPPS | Dose object | QC models at the Edge Gateway |
|---|---|---|---|
| CR and DX (fixed and mobile radiography) | Yes / Yes | DAP where a meter is fitted; exposure index (EI, EIT, DI per IEC 62494-1); RDSR on newer units | Positioning, collimation, exposure index, motion, laterality marker, artefact |
| MG (mammography, tomosynthesis) | Yes / Yes | AGD per view, compression force and thickness, kV, target and filter | Positioning (pectoral muscle level, nipple in profile, inframammary fold), motion, view and laterality label, missing view |
| CT (including CBCT for dose purposes) | Yes / Yes | RDSR: CTDIvol, DLP per event and study, phantom size, SSDE where available | Coverage vs protocol, missing phase, contrast timing failure, motion, metal artefact, incomplete series |
| MR | Yes / Yes | No ionising dose; SAR and dB/dt recorded | Motion, wrap, missing sequence, wrong coil flag |
| US | Yes / where supported | None; thermal and mechanical index when available | Incomplete worksheet, missing required views, laterality |
| RF (fluoroscopy) | Yes / Yes | RDSR or DAP plus fluoroscopy time; peak skin dose estimate for long procedures | Incomplete series, laterality |
| DXA | Yes / partial | Effective dose estimate | ROI placement, incomplete regions |
| PX (dental panoramic, cephalometric) | Yes / partial | DAP, exposure factors | Positioning (Frankfort plane, bite block), motion |
| Mobile X-ray (ward, theatre, ICU) | Yes via the mobile app to the Edge Gateway | DAP, EI | As DX, run when the unit reconnects |
| NM | Modelled as a modality type only; out of scope for this document | | |

## 3. Trigger

| Trigger | Source | Effect |
|---|---|---|
| Patient checked in and safety questionnaire cleared | M07 `visit.ready_for_acquisition.v1` | One Scheduled Procedure Step (SPS) per order item, published to the site's Edge Gateway worklist |
| Inpatient or theatre order at a hospital JV site | HL7 ORM or FHIR ServiceRequest via M21 | Same; ADT feed supplies ward and bed |
| Mobile X-ray request from a ward | Referrer Space or hospital order | SPS flagged `mobile`, routed to the mobile unit queue |
| Add-on or changed protocol | M12 protocolling queue | SPS updated; MWL entry re-served |
| Unscheduled emergency | Technologist console "Emergency patient" action | Placeholder patient with temporary identifier; reconciled later (7.2) |

## 4. Actors

| Actor | Role in this process |
|---|---|
| RAD | Performs the study on the Technologist console, from identity check to repeat/reject coding, key images and notes to the radiologist |
| NUR | IV access, contrast preparation and administration, observation, reaction management, contrast stock scanning |
| RGT | Protocols CT, MR and complex studies; answers radiographer queries; signs off dose investigations with the RPO |
| CMP (RPO) | Licence register, QA schedule, dose alerts, personal dosimetry, pregnancy-at-work declarations, MRI safety |
| BIO | Maintains modalities; runs and records acceptance and periodic QA; manages downtime and failover |
| PRM | Room allocation, downtime decisions, staffing on the day |
| AIO | Governs the QC models and the Protocol Hand versions; monitors override rates |
| PAT | Confirms identity, answers re-confirmation questions, receives aftercare instructions |
| Protocol Hand (M20) | Pre-assigns protocols, contrast dosing suggestions and DRL references; requests radiologist protocolling where required |
| QC Hand (M20) | Consumes QC outputs and dose records; opens exceptions, releases studies, trends repeats and dose, collects QA evidence |
| Edge Gateway | Serves MWL, receives MPPS and C-STORE, runs on-device QC models, buffers during outages |

## 5. Preconditions

1. An order exists on M04 with tariff codes, ICD-10 codes and clinical indication; the funding state (authorised, cash quoted, RAF, COIDA, ODMWA, or a PRM override) is recorded on M06.
2. Patient identity is verified on M03 (ID number or passport, or guardian for a minor); a wristband or QR label is issued where site policy requires it.
3. The M07 safety questionnaire is complete for the modality (pregnancy declaration for patients of childbearing potential on ionising studies, MRI screening, contrast screening with eGFR, allergies and metformin).
4. The room and modality have a current SAHPRA licence, a completed acceptance test and no overdue blocking QA item (M02-R-006); a CMP override is possible with reason and audit.
5. The radiographer's HPCSA registration is current and the modality competency is on M17; the PRM can override for supervised trainees.
6. The Edge Gateway is healthy or in offline mode (12); either way the worklist is available.

## 6. Happy path (CT abdomen with intravenous contrast; simpler modalities skip the steps that do not apply)

1. **Worklist population.** On `visit.ready_for_acquisition.v1`, M08 creates an SPS with Patient Name, Patient ID (the Platform MPI identifier; the SA ID number is never used as the DICOM Patient ID), Accession Number, Requested Procedure, Scheduled Station AE Title, start time, Requested Procedure Code Sequence (tariff-mapped) and Protocol Code Sequence. The Edge Gateway MWL SCP answers the modality's C-FIND within one second.
2. **Protocol assignment.** The Protocol Hand reads the order, indication, age, weight, sex, pregnancy status, eGFR, allergies, implants and priors, and pre-assigns a protocol from the practice library. For CT and MR it places the study in the RGT protocolling queue with the suggestion attached; the radiologist accepts, edits or replaces it (A1). Standing protocols for defined indications (for example non-contrast CT KUB for renal colic in an adult with no red flags) skip the queue by configuration, and the Hand records that the standing rule applied.
3. **Open on the Technologist console.** The room queue shows the patient, order, protocol card, safety status chips, funding status, priors available and any referrer or radiologist comment. The card shows the DRL for this protocol at this site and the expected series list.
4. **Identity check.** The radiographer confirms two identifiers with the patient (full name and ID number or date of birth) and scans the wristband or label. The check is timestamped. A mismatch stops the flow (7.1).
5. **Safety re-confirmation.** The `SafetyChecklist` re-presents the safety answers: pregnancy (with last menstrual period where relevant), contrast checks (eGFR value and date, allergies, metformin, previous reaction, thyroid disease where relevant), MRI screening if applicable. A changed answer re-opens the M07 questionnaire. A "not sure" pregnancy answer routes to the pregnancy protocol (7.4).
6. **Contrast preparation.** The `ContrastCalculator` shows the Protocol Hand's suggested agent, concentration, weight-based volume and flow rate, and the eGFR gate (thresholds are configurable reference data). The nurse scans the vial barcode: M18 decrements stock and records batch and expiry against the study. The protocol is pushed to the contrast injector where the vendor exposes an interface; after injection the injector returns delivered volume, rate, peak pressure and any abort.
7. **Acquisition.** The modality selects the worklist entry and sends MPPS N-CREATE (In Progress). The console shows "In room" and starts the time-in-room clock. The radiographer positions the patient and scans on the assigned protocol.
8. **Images arrive.** Each series is sent by C-STORE to the Edge Gateway, which validates, stores locally and forwards to the central archive (process 06). Within seconds the on-device QC models run: positioning, collimation, exposure index or CTDIvol against the protocol range, motion, artefact, laterality marker presence and series completeness. Results appear as annotated findings candidates in the BDL provenance style; they never block.
9. **Image review, repeat and reject.** If a series must be repeated, the console requires a reason code (positioning, exposure, motion, artefact, anatomy cut-off, equipment fault, patient movement, wrong protocol, other with free text) before a repeat can start. Rejected images are never deleted: they are marked `rejected`, excluded from reading and distribution, and retained for QA review.
10. **Key images and comments.** The radiographer may flag key images and write a technologist note to the radiologist (for example "patient could not raise arms; streak artefact at L1"), shown in the Reading Room.
11. **Completion.** The modality sends MPPS N-SET (Completed) with performed series; for CT the RDSR arrives as a separate SR object. M10 parses CTDIvol and DLP per irradiation event and per study, phantom size and scan range, and compares against the DRL for the protocol and patient size class. Within the threshold the record is filed silently; above it, an alert opens (10.3).
12. **Completeness check.** M08 compares received series with the protocol's expected series. If complete, the study moves to `acquisition_complete` and emits `study.acquired.v1`, which drives archive routing (M09), inference routing (M11), the reading worklist (M12) and charge capture (M14: performed procedure with tariff codes, contrast units and consumables). If incomplete, the QC Hand asks the radiographer before the patient leaves the department.
13. **Aftercare.** The console sends aftercare instructions (contrast hydration, driving after sedation) to the Patient Space or prints them, records time-out-of-room and returns the room to the queue.

## 7. Variants and exceptions

### 7.1 Worklist mismatch and identity failures

| Situation | Behaviour |
|---|---|
| Worklist entry does not match the person in the room | Flow stops; RAD selects the correct entry or calls FDK; no exposure until resolved; every stop logged |
| Wrong worklist entry selected and images arrived under another patient | M09 wrong-patient correction (process 06 §7.1) with a mandatory M19 incident |
| Study performed off-worklist (typed on the modality) | Edge Gateway holds it in the `unmatched` queue; the QC Hand proposes a match by name, date of birth, accession or time proximity; RAD or FDK confirms (A2) |
| Duplicate SPS | RAD completes one; the other is cancelled with reason and the M05 slot released |

### 7.2 Emergency and unscheduled patients

The "Emergency patient" action creates a placeholder on M03 (temporary identifier, estimated age, sex) and an SPS in under 30 seconds. Reconciliation to the real identity happens on M03 with the merge audit. The Platform never blocks a resuscitation study on missing demographics or funding.

### 7.3 Paediatric patients

Paediatric protocols are separate library entries with weight or age-band exposure factors, DRLs by age band and the practice's shielding policy (configurable; recent international guidance favours not using gonadal shielding for most exams, and the practice records its chosen position as a policy document). Guardian identity and consent are re-confirmed; immobilisation and distraction options are noted.

### 7.4 Pregnancy declaration handling

1. For patients of childbearing potential (configurable age range) on ionising studies, M07 captures "no", "yes" or "not sure", with LMP date.
2. "Yes" or "not sure" routes to the pregnancy protocol: the console shows the justification path (RGT decision to proceed, defer or substitute a non-ionising modality), the site's rule (10-day or 28-day rule for pelvic and abdominal irradiation, configurable) and the foetal dose category for the protocol.
3. The RGT decision, the patient's informed consent and the estimated foetal dose are recorded on M10 as a pregnancy exposure record. An exposure later found to have occurred in an undeclared pregnancy opens an M19 incident and the RPO computes a foetal dose estimate.
4. Ultrasound and MRI (per policy on trimester) are offered as substitutes where clinically reasonable.

### 7.5 Contrast reactions and extravasation

A "Reaction" button opens the reaction protocol (mild, moderate, severe; treatment steps; emergency trolley checklist), records vital signs, medications, and the radiologist called, and creates an M19 incident and an allergy flag on M03. Extravasation is recorded with volume and site. Both feed the NUR metrics.

### 7.6 MRI safety

MRI rooms carry the four-zone model on M10 with the zone map, controlled access list, ferromagnetic detector log where fitted and the screening form. Implants are checked against the implant safety reference (configurable, with MR conditional parameters). A safety event (projectile, burn, quench, claustrophobia abort) is an M19 incident with RPO and MRI safety officer review.

### 7.7 Mammography

Screening uses the standard four views; the console enforces view and laterality labels, records compression force and thickness per view and the AGD from the header, and shows the positioning candidates. Diagnostic work-ups are radiologist-protocolled and may add spot compression, magnification or tomosynthesis. Implant patients use implant-displaced views. Mammography competency is verified on M17.

### 7.8 Fluoroscopy

The console records fluoroscopy time, DAP, acquisitions and, for longer procedures, an estimated peak skin dose. Configurable skin-dose thresholds trigger a notice during the procedure and a patient follow-up flag (skin check at a configured interval) when exceeded.

### 7.9 Other modality-specific variants

| Variant | Behaviour |
|---|---|
| Ultrasound | No ionising dose; structured worksheet on the console (measurements imported from the machine's SR where supported); limited studies flagged with a reason |
| Dental panoramic, cephalometric, CBCT | Same worklist and QC flow with the Edge Gateway in its smallest configuration; CBCT treated as CT for dose with its own DRL set |
| Mobile X-ray | Mobile app shows ward, bed, isolation status and protocol; wristband scanned at the bedside; images sent when back in range; exposures recorded against the mobile unit licence |
| Hospital inpatients at JV sites | ADT keeps location current; transport time recorded so time-in-department is fair; routing per the site's integration configuration |
| Patient refuses or cannot complete | Study closed as `not_performed` or `partial` with a coded reason; partial studies are readable and billable only for what was performed |
| Wrong-patient, wrong-side or wrong-part exposure | M19 incident, M10 unintended-exposure record with dose, and a drafted report for the RPO to submit to SAHPRA Radiation Control where the (configurable) reporting conditions apply |

## 8. Automation level

| Step | Level | Note |
|---|---|---|
| Worklist population | A4 | Deterministic from check-in; monitored by mismatch rate |
| Protocol pre-assignment (plain film, US, DXA, dental) | A2 | Protocol Hand assigns; RAD reviews the card and can change it |
| Protocol assignment (CT, MR, diagnostic mammography, complex RF) | A1 | Radiologist confirms every protocol; standing protocol rules run at A2 |
| Contrast dose suggestion, eGFR gate, injector programming | A1 | Nurse or RAD confirms |
| Identity check, safety re-confirmation, positioning, exposure | A0 | Human acts by design; Platform records and supports |
| Automatic QC | A2 | Runs automatically; RAD reviews; QC Hand handles exceptions |
| Repeat/reject coding | A1 | Console proposes the reason from the QC result; RAD confirms |
| Dose capture and DRL comparison | A4 | Automatic; alerts are A2 for RAD and RPO review |
| Completeness and release to reading and billing | A3 | QC Hand releases within its mandate; blocked studies escalate |
| Licence and QA schedule tracking | A3 | Reminders and evidence collection automated; RPO signs off |
| Personal dosimetry cycle | A2 | Badge exchange scheduled; results reviewed by the RPO |
| Downtime failover | A1 | PRM confirms the re-routing plan proposed by the Platform |

## 9. AI and agent touchpoints

### 9.1 QC models (M11, run on the Edge Gateway)

| Model | Modalities | Output | Behaviour |
|---|---|---|---|
| Positioning adequacy | CR/DX, MG, PX, DXA | Per-view score and reason candidates (rotation, cut-off anatomy, pectoral muscle level) | Advisory; never blocks; feeds repeat-reason suggestion |
| Collimation | CR/DX | Field-to-anatomy ratio, off-centre flag | Advisory; trended per room and radiographer |
| Exposure index | CR/DX | DI outside the protocol target range | Advisory; over- and under-exposure trend by protocol |
| Motion and artefact | All | Blur, grid lines, metal, clothing, wrap (MR) | Advisory; suggests repeat |
| Laterality marker | CR/DX, MG | Marker present and matching the requested side | Advisory, but a missing marker on a laterality-critical study opens a QC Hand exception before release |
| Series completeness | CT, MR, MG, US | Expected vs received series | Deterministic rule; blocks `acquisition_complete` until resolved or overridden with reason |

All models are BCI Model Registry entries (intended use, version, validation report, SAHPRA status where the model is software as a medical device). Every output carries model id, version and confidence, is a technical quality assessment, and is never presented to patients or referrers as a finding.

### 9.2 The Protocol Hand

| Attribute | Definition |
|---|---|
| Mandate | Pre-assign the protocol, contrast suggestion and DRL reference for every SPS; place CT, MR and configured studies in the RGT protocolling queue with a suggestion; apply standing protocol rules; answer radiographer protocol questions with the library entry and its source |
| Inputs | Order (tariff codes, ICD-10, indication), patient factors (age, sex, weight, pregnancy, eGFR, allergies, implants), priors index, practice protocol library, site modality capabilities |
| Tools | `read_order`, `read_patient_safety_profile`, `read_priors_index`, `read_protocol_library`, `propose_protocol`, `enqueue_for_protocolling`, `propose_contrast_dose`, `notify_rad` |
| Leash | May not finalise a CT, MR, diagnostic mammography or interventional protocol without RGT acceptance; may not exceed the library's dose ceiling for a protocol; may not propose contrast when eGFR is below the practice gate or a documented severe reaction exists; may not create standing rules |
| Approval policy | RAD accepts on the card for A2 modalities; RGT accepts in the protocolling queue for A1 modalities |
| Audit and monitoring | Every proposal stored with model id, version, prompt version, inputs hash, output and the human decision; AIO monitors override rate by modality and radiologist, queue time, and suggestions outside the library |

### 9.3 The QC Hand

| Attribute | Definition |
|---|---|
| Mandate | Consume QC outputs, MPPS and dose records; release complete, QC-clean studies to reading and billing; open exceptions for incomplete studies, missing laterality markers, unmatched studies and dose alerts; propose repeat reasons; produce daily repeat and dose summaries per room; schedule QA reminders and collect QA evidence from modality logs |
| Tools | `read_study_status`, `read_qc_results`, `read_dose_record`, `read_expected_series`, `release_study`, `open_exception`, `propose_unmatched_match`, `notify_rad`, `notify_rpo`, `create_qa_task`, `attach_evidence` |
| Leash | Releases only studies with all expected series and no blocking exception; may not delete or modify image objects; may not close a dose alert (RPO does); may not merge patients; escalates to PRM if an exception is unresolved beyond a configurable time (default 20 minutes while the patient is in the department) |
| Approval policy | Releases are A3; unmatched-study matches are A2; dose alert closure is A0 by the RPO |
| Audit | Every release, exception and notification with inputs, reason, recipient and acknowledgement |

## 10. Dose management (M10)

### 10.1 Dose sources

| Source | Standard | Fields |
|---|---|---|
| Radiation Dose Structured Report (RDSR) | DICOM PS3.16 TID 10001 (X-ray) and TID 10011 (CT) | Irradiation events, CTDIvol, DLP, phantom, kV, mAs, scan range, DAP, reference point air kerma, fluoroscopy time |
| Exposure index | IEC 62494-1 | EI, EIT, DI |
| Mammography header | DICOM MG IOD | AGD, entrance dose, compression force and thickness, target and filter, kV |
| Legacy dose screen capture | Secondary capture image | OCR by an M11 model into structured fields, flagged `ocr_derived` with confidence; RAD confirms on first use per modality |
| Manual entry | Console form | For units with no electronic dose output; flagged `manual` |

Patient size (weight, height, or CT water-equivalent diameter from the images) is stored with the dose record so that comparisons are by size class.

### 10.2 Diagnostic Reference Levels

* DRL sets exist at three levels: national (South African DRLs as published by the Directorate of Radiation Control, stored as configurable reference data because they are revised periodically and do not cover every protocol), practice-defined, and site-derived (the site's own 75th percentile per protocol, recomputed monthly). Where no SA value exists the practice may adopt an international reference and label it as such.
* DRLs are per protocol code, modality, patient size or age band, and dose quantity (CTDIvol and DLP for CT, DAP for radiography and fluoroscopy, AGD for mammography, EI where DAP is unavailable).
* DRLs are not dose limits: the console explains that a single exposure above the DRL may be justified and that the comparison is a review trigger, not a fault.

### 10.3 Alerts

| Alert | Trigger (configurable) | Recipient | Handling |
|---|---|---|---|
| Above DRL | Study dose above the DRL for its protocol and size class | RAD (console), RPO (queue) | RAD adds a note (large patient, repeat, extended range); RPO reviews weekly; recurrent alerts on one protocol trigger a protocol review |
| Above alert threshold | Above a higher practice threshold (illustrative: twice the DRL) | RAD immediately; RPO and RGT within the hour | Mandatory justification; may become an M19 incident |
| Fluoroscopy skin dose | Estimated peak skin dose above the configured value | RGT during the procedure, RPO after | Patient follow-up flag |
| Cumulative dose | Cumulative effective dose estimate or repeat CT count above a configurable value in a rolling period | RGT at protocolling; REF via the Referrer Space appropriateness prompt | Supports justification and substitution; never blocks an emergency study |
| Pregnancy exposure | Exposure on a "yes" or "not sure" declaration, or a later disclosed pregnancy | RPO, RGT | Foetal dose estimate, counselling record |
| Paediatric on adult protocol | Paediatric patient scanned on an adult protocol | RAD, RPO | Investigation |

### 10.4 Cumulative dose per patient

Every ionising exposure contributes to the patient's dose history on M03 (effective dose estimate from the recorded quantities and configurable conversion coefficients, labelled as an estimate). It is visible to RGT and RAD on the protocol card and to the patient in the Patient Space in plain language, with the explanation that estimates are approximate and that the study was justified by the referring doctor and the radiologist.

### 10.5 Personal dosimetry for staff

* Every worker in a controlled or supervised area is enrolled with an accredited personal dosimetry service provider; the Platform records badge type (TLD or OSL), body and extremity badges, the wear cycle (monthly or quarterly per licence conditions), issue and return dates, and the provider's result per cycle.
* Results are imported (file or provider API) into the dosimetry register on M10 and linked to M17 staff records. Investigation levels are configurable; occupational limits per the SA regulations (aligned to the ICRP system of 20 mSv per year averaged over five years with 50 mSv in any single year) are stored as reference data. Exceedances trigger an RPO review with the worker.
* Declared pregnancy at work is recorded confidentially; the foetal dose constraint and any duty adjustment are documented by the RPO.
* Missing or late badge returns are chased by a QC Hand task to the PRM; the RPO signs off each cycle.

### 10.6 Radiation licence and QA schedule per room and modality

| Item | Frequency (configurable; typical) | Evidence | Sign-off |
|---|---|---|---|
| SAHPRA Radiation Control licence per unit and address, named RPO | Per licence conditions | Licence document, number, expiry, conditions | CMP |
| Acceptance testing on installation, relocation or major repair | Per event | Report from a licensed inspection body or qualified person | RPO, BIO |
| Annual QA and compliance test | Annual | Test report, deviations, corrective actions | RPO |
| Daily and weekly phantom tests (CT water, MR SNR, DR detector calibration, US phantom) | Daily or weekly | Values logged, pass or fail | RAD; reviewed by BIO |
| Mammography QC per the accepted programme standard (phantom scoring, compression, AEC reproducibility, monitor checks, repeat analysis) | Daily to semi-annual | Structured QC forms | QC radiographer, medical physicist where required, RPO |
| Display calibration (GSDF) for reading and review stations | Per policy | Calibration log | BIO |
| MRI safety programme (zone signage, access control, quench pipe, cryogen, ferromagnetic detector) | Annual audit, event-driven | Audit form, photos | MRI safety officer, RPO |
| Shielding survey per room | On commissioning and after changes | Survey report | RPO |
| Contrast injector and emergency trolley checks | Daily | Checklist | NUR |

The M19 compliance calendar schedules each item, reminds the responsible persona, collects evidence (console forms, files, values pulled from modality logs by the QC Hand) and shows overdue items on the PRM control tower. Overdue blocking items enforce M02-R-006.

## 11. Equipment downtime and failover

1. A fault is logged by RAD or BIO, or detected by the Edge Gateway when the modality stops answering DICOM echo; M18 opens a downtime record and a service call where a contract exists.
2. The Platform proposes a re-routing plan for affected appointments: another room of the same modality at the site; another site within a configurable travel distance; or reschedule. The plan shows funding and licence constraints (an authorisation tied to a practice number may need re-authorisation on M06).
3. The PRM confirms the plan (A1); patients are notified by WhatsApp or SMS.
4. Studies in progress are completed on the alternative modality with a new SPS linked to the original accession, so the report and the claim remain single.
5. Downtime and patient impact feed M18 uptime and M16 KPIs.

## 12. Load-shedding mode

The Edge Gateway on UPS keeps the department working through power and connectivity outages: the worklist for today
and tomorrow is mirrored locally and MWL and MPPS continue; walk-ins are captured on the console and synchronised
later; C-STORE is accepted into the 30-day local store and forwarding resumes automatically with resumable transfers
and a backlog indicator on the PRM control tower; QC models run on the gateway while triage inference queues for the
central BCI; dose records and repeat codes are captured locally with gateway (NTP-disciplined) timestamps and
synchronised in order. The console shows "Offline: working from the site gateway" and lists the deferred functions
(priors from other sites, benefit checks, report distribution). Modalities themselves must be on UPS or generator per
the site engineering plan; M18 records each site's load-shedding readiness and shows the municipal block schedule
where available.

## 13. Data produced

| Object | Key content |
|---|---|
| `scheduled_procedure_step`, `performed_procedure_step` | SPS and MPPS identifiers, accession, MPI id, protocol code, station, status, times, performed series, radiographer, room |
| `protocol_assignment`, `contrast_administration` | Protocol id and version, source, acceptance; agent, volume planned and delivered, rate, injector log, batch, expiry, eGFR used |
| `identity_check`, `safety_reconfirmation` | Identifiers confirmed, wristband scan; answers, changes, pregnancy declaration, LMP |
| `qc_result`, `repeat_reject`, `technologist_note`, `key_image` | Model provenance, scores, RAD response; image UIDs and reason code; free text; key image references |
| `dose_record`, `pregnancy_exposure_record`, `dosimetry_result` | Dose quantities per event and study, source, size class, DRL comparison, alerts; declaration, justification, foetal dose estimate; worker, badge, cycle, result |
| `licence`, `qa_item`, `downtime_record` | Licence numbers and expiries; QA schedule, evidence, sign-offs; fault, duration, patients affected |
| Events | `study.acquired.v1`, `study.incomplete.v1`, `dose.alert.v1`, `repeat.recorded.v1`, `modality.downtime.v1`, `qa.overdue.v1` |

## 14. KPIs

| KPI | Definition | Target (illustrative, configurable) | Persona |
|---|---|---|---|
| Repeat rate | Rejected ÷ total images per modality, room, protocol and radiographer (case-mix adjusted) | CR/DX below 5 %; mammography below 3 %; trend down | RAD, PRM, CMP |
| Dose vs DRL | Share of studies above the DRL per protocol; site median vs national DRL | Site median below the DRL for every protocol with 20 or more studies a month | RPO, RGT |
| Time-in-room | MPPS start to end, and door-to-door, by protocol | Within the planned duration for 85 % of studies | PRM |
| Exam completeness at release | Studies released with all expected series and no QC block on first pass | Above 98 % | QC Hand, RAD |
| Worklist mismatch rate | Unmatched or corrected studies ÷ studies | Below 0.2 % | BIO, FDK |
| QC feedback latency | Image arrival to QC result on the console | Under 10 seconds P95 | BIO, AIO |
| Protocolling turnaround | SPS creation to RGT acceptance for A1 modalities | Under 30 minutes for same-day studies | RGT |
| Licence currency and QA compliance | Rooms with a current licence and no overdue blocking QA item | 100 % | CMP, BIO |
| Dosimetry return compliance | Badges returned by the cycle deadline | Above 98 % | RPO |

## 15. Controls

1. No exposure without an identity check recorded against the SPS; sites without modality-side enforcement record the check manually and the gap is reported.
2. Rejected images are retained, excluded from reading and distribution, visible in QA review only; deletion is not available to any user.
3. Repeat reason codes are mandatory; "other" requires free text and is reviewed monthly.
4. Dose records are immutable; corrections create a new version with reason.
5. DRL sets, alert thresholds and conversion coefficients are edited only by CMP with a versioned change record.
6. Standing protocol rules require RGT approval and are versioned; the Protocol Hand cannot create them.
7. Contrast cannot be marked administered without a batch scan or a documented manual reason.
8. Licence expiry and overdue blocking QA stop scheduling on the modality (M02-R-006); overrides are by CMP with audit.
9. Pregnancy declarations and dosimetry results are special personal information under POPIA; access is role-limited and logged.
10. QC model versions deployed to gateways are signed; a gateway running an unapproved version reports itself and its outputs are marked `unverified_model`.
11. Offline-captured records synchronise with conflict detection; conflicts route to the BIO queue rather than silently overwriting.

## 16. Requirements

### M08 Acquisition & Worklist

* M08-R-100 The Platform MUST provide DICOM Modality Worklist (C-FIND) and MPPS (N-CREATE, N-SET) services at each site through the Edge Gateway, populated from M07 check-in events within 5 seconds.
* M08-R-101 The Platform MUST NOT use the SA ID number or passport number as the DICOM Patient ID; it MUST use the MPI identifier.
* M08-R-102 The Technologist console MUST record an identity check with two identifiers and, where issued, a wristband or label scan before the study can be marked in progress, and MUST re-present the M07 safety answers for confirmation, routing "yes" and "not sure" pregnancy declarations on ionising studies to the pregnancy protocol.
* M08-R-103 The Platform MUST support radiologist protocolling for CT, MR, diagnostic mammography and interventional studies with Protocol Hand suggestions shown in the provenance style, and MUST support radiologist-approved, versioned standing protocol rules with a record of when a rule applied.
* M08-R-104 The Platform MUST integrate with contrast injectors where the vendor exposes an interface, record delivered volume and rate, and provide manual capture otherwise; contrast administration MUST require a batch scan or a documented manual reason.
* M08-R-105 Repeat and reject MUST require a reason code; rejected images MUST be retained, excluded from reading and distribution, and available to QA review.
* M08-R-106 The Platform MUST compute study completeness against the protocol's expected series before emitting `study.acquired.v1`, and MUST support key image flags and technologist notes visible in the Reading Room.
* M08-R-107 The Platform MUST support unscheduled emergency studies with a placeholder identity and later reconciliation with full audit.
* M08-R-108 The Technologist console MUST work offline against the Edge Gateway for worklist, forms, QC feedback, repeat coding and dose capture, and MUST synchronise with conflict detection.
* M08-R-109 The Platform MUST support mobile X-ray through a mobile app with bedside wristband scanning and deferred image transfer.
* M08-R-110 The Platform MUST propose re-routing plans on modality downtime, keep the accession single across the re-route, and notify affected patients.
* M08-R-111 The Platform SHOULD case-mix adjust radiographer productivity and repeat metrics before presenting them per person.

### M10 Dose & Radiation Safety

* M10-R-100 The Platform MUST parse RDSR objects (CT and X-ray templates), exposure index values and mammography dose fields, and where necessary OCR dose screen captures (flagged), into a structured dose record per study and per irradiation event with patient size class.
* M10-R-101 The Platform MUST hold DRL sets at national, practice and site level per protocol, modality, size or age band, MUST compare every ionising study against the applicable DRL, and SHOULD recompute site-derived DRLs monthly.
* M10-R-102 The Platform MUST raise configurable dose alerts (above DRL, above alert threshold, fluoroscopy skin dose, paediatric on adult protocol, pregnancy exposure, cumulative dose) to the personas defined in this document and MUST record their handling.
* M10-R-103 The Platform MUST maintain a cumulative dose history per patient and show it to RGT at protocolling and to the patient in plain language.
* M10-R-104 The Platform MUST maintain a personal dosimetry register with badge cycles, results import, investigation levels and RPO sign-off, and MUST treat results as special personal information.
* M10-R-105 The Platform MUST maintain the radiation licence register per room and modality, the QA schedule with evidence and sign-offs (including mammography QC forms, MRI safety zone records and shielding surveys), and MUST enforce M02-R-006.
* M10-R-106 The Platform MUST record unintended exposures (wrong patient, wrong side, undeclared pregnancy) as incidents with dose estimates and MUST support the RPO's regulatory reporting with a drafted report.
* M10-R-107 Dose records MUST be immutable with versioned corrections; DRLs, alert thresholds, occupational investigation levels and conversion coefficients MUST be configurable reference data with version history and CMP-only editing.
