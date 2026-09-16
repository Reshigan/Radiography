# 07 — Reporting and Peer Review

Module: **M12 Reporting** (owner), with **M11 Clinical Intelligence (BCI)** touchpoints.
Related: M09 Image Management (PACS) (viewer, priors), M13 Results & Communication (distribution,
critical results), M14 Revenue Cycle (Billing) (reading-fee capture, coding), M17 Workforce (rosters,
on-call, credentials), M19 Quality, Risk & Compliance (peer review programme, discrepancies),
M20 Agent Runtime.

## 1. Purpose

Get every study in front of the right radiologist in the right order, give that radiologist everything
needed to read it once and well, produce a structured, signed report as quickly as safety allows, and
close the loop on what the report recommends. Peer review is built into the same flow so that quality
improvement is continuous, fair and non-punitive.

Hard rule that governs the whole document: **a registered radiologist signs every report. Nothing the
Platform or any Hand produces is a report until a radiologist has reviewed it and signed it. There is
no auto-sign, for any modality, any priority, any staffing situation, ever.** Clinical interpretation is
capped at automation level A1 (00-conventions §6).

| Today (typical SA practice) | Bonakala target |
|---|---|
| Worklist sorted by arrival time; STAT studies found by phone call | Worklist ordered by clinical priority, with AI triage priorities shown as annotated candidates, sub-specialty routing and pooled hub reading |
| Priors in another system or on CD | Priors on screen when the study opens (process 06) |
| Free-text dictation typed by a transcriptionist hours later | Speech-to-text with a structured draft assembled from dictation, structured findings and accepted findings candidates, ready to edit and sign |
| Follow-up recommendations lost in prose | Recommendations captured as structured items with a due date and tracked to closure (process 08) |
| Peer review as an annual chore with a spreadsheet | Randomised sampling in the normal worklist, scored in under a minute, feeding learning meetings |
| Reading fees computed by hand from a report count | Reading-fee capture per signed report with configurable weights, visible to the radiologist daily |

## 2. Scope

Radiologist worklist, reading environment, structured templates, dictation and AI drafting, priors
comparison, measurements, impression and recommendations, incidental findings, critical findings
flagging (handover to process 08), addenda and corrections, second reads, supervised trainees, peer
review, turnaround SLAs, reading-fee capture, ergonomics and fatigue controls, KPIs, the Drafting Hand
and the Follow-up Hand.

## 3. Trigger

| Trigger | Source |
|---|---|
| `study.available.v1` (images complete and central, or readable from the site gateway) | M09 |
| `bci.result.v1` (triage priority or findings candidates ready) | M11; re-orders the worklist entry |
| Protocolling request | M08 (radiologist protocolling is handled in process 05 but appears in the same worklist) |
| Second read required by policy (screening mammography double reading, trainee supervision) | M12 rules |
| Addendum or correction request | RGT, REF (via Referrer Space query), M13 (amendment propagation), CMP (peer review outcome) |
| Peer review sample drawn | M12 sampling scheduler |
| Referrer "call a radiologist now" request | Referrer Space, routed to the on-call radiologist queue |

## 4. Actors

| Actor | Role |
|---|---|
| RGT | Reads, dictates, edits, signs; protocols; performs second reads and peer review; supervises trainees |
| Registrar or resident (RGT-in-training, teaching sites) | Drafts preliminary reports under supervision; cannot sign final reports |
| RAD | Provides technologist notes and key images; receives repeat requests from the reader |
| REF | Receives the signed report (process 08); may query it, which can produce an addendum |
| CMP | Runs the peer review programme, discrepancy classification and learning meetings; tracks SLAs |
| PRM and hub manager | Balances the pool, on-call rosters, SLA breaches |
| AIO | Monitors triage, findings candidate and drafting models; override rates |
| BIL | Consumes signed reports for coding (Coding Hand, M14) and reading-fee capture |
| Drafting Hand (M20) | Assembles the draft report from dictation, structured findings and accepted candidates |
| Follow-up Hand (M20) | Extracts, structures and tracks follow-up recommendations to closure (with process 08) |

## 5. Preconditions

1. The study is available (all expected series, no blocking QC exception) with the order, indication, ICD-10 codes, technologist notes and key images attached.
2. Priors are fetched or their absence is stated; consent gaps are shown.
3. The radiologist is signed in with a current HPCSA registration (verified on M01 and M17), the sub-specialty and modality privileges configured, and a reading contract with the Practice or the Reading Hub (M02 reading services agreement) that determines fee capture.
4. Reading-room displays and dictation devices are registered; a diagnostic display is required for primary reads of mammography and is warned for other modalities when reading from a non-calibrated device.
5. BCI results are either present or marked "pending" or "not applicable"; the radiologist is never made to wait for AI.

## 6. Happy path (CT chest with findings candidates, hub-pooled reading)

1. **Worklist entry.** On `study.available.v1`, M12 creates a worklist item with priority (see 7.1), sub-specialty tag (from protocol and body part), site, Practice, hub eligibility, age of study, SLA deadline and a "priors ready" chip. When `bci.result.v1` arrives with a triage priority, the item re-sorts within its priority class and shows the annotated triage chip with model id, version and confidence.
2. **Assignment.** The radiologist either self-assigns from the pool (the item is locked to them; a lock has a configurable time-out with a visible timer) or receives an item routed by the fairness rules (7.2). On-call items go to the on-call radiologist first.
3. **Open in the Reading Room.** The hanging protocol lays out the current study and the most relevant prior; key images and the technologist note appear in the inspector; the clinical indication, ICD-10 codes, referrer, safety flags (contrast given, pregnancy, implant), dose summary, and the report template pre-selected by modality and body part sit on the reporting pane.
4. **AI overlays.** Findings candidates (for example a pulmonary nodule candidate with a bounding box and a size estimate) are shown in the annotated style. The radiologist accepts, edits or rejects each candidate. Accepted candidates become structured findings with `accepted_by`, `accepted_at` and `model_version`; rejected ones are recorded with a reason and feed AIO monitoring. For mammography, overlays are off by default and must be turned on deliberately after the unaided read (human-first policy).
5. **Read and dictate.** The radiologist reads the study and dictates with push-to-talk. Speech-to-text runs with a radiology vocabulary; the recognised text appears in the report editor immediately. Measurements from the viewer (length, area, density, volumes) drop into the measurement table with series and image references.
6. **Draft assembly.** The Drafting Hand assembles a draft that fills the structured template: technique (from the protocol and contrast record), comparison (auto-text from the priors record, for example "Comparison: CT chest 14 March 2026, same Practice"), findings (from dictation, mapped into template sections, plus accepted candidates and measurements), impression (a proposed synthesis of the findings), and recommendations (proposed follow-up items with the guideline source). The draft is a Class 2 output: it is rendered entirely in the annotated style until the radiologist reviews it.
7. **Edit.** The radiologist edits freely: the editor supports macros, structured pick-lists, free text, tables (nodules, lesions, vertebral levels) and a comparison table with prior measurements. Mandatory fields for the template (for example laterality for a limb, presence or absence of a lesion on a screening study, the RADS category where the template is a scoring system) are enforced before sign.
8. **Critical or urgent finding.** If the impression contains a finding in the critical or urgent category, the radiologist flags it (or confirms the Drafting Hand's suggestion to flag). The flag hands over to process 08: the Critical Results Hand starts the communication while the radiologist continues; the report cannot be signed as "critical" without a communication record being initiated.
9. **Follow-up recommendations.** Each recommendation is captured as a structured item: what (modality and body part), when (interval or date), why (finding), and who is responsible (referrer by default). The Follow-up Hand validates against the practice's follow-up schedules (for example a lung nodule schedule) and shows the schedule source in the annotated style; the radiologist confirms.
10. **Sign.** The radiologist signs with their credential (re-authentication by MFA is required at a configurable interval, and always for critical-flagged reports). Sign-off completes in under 500 ms and emits `report.signed.v1` with the report, structured findings, recommendations, critical flag, reading time, and the signing radiologist's HPCSA number and practice number.
11. **Downstream.** M13 distributes; M14 codes and captures the reading fee; M16 records turnaround; the peer review sampler may select the study; the Follow-up Hand opens follow-up tracking items.

## 7. Variants and exceptions

### 7.1 Priority classes and turnaround SLAs

| Priority | Definition | Reading start target | Signed report target (from `study.available.v1`) | Set by |
|---|---|---|---|---|
| STAT | Life-threatening or time-critical indication (stroke pathway, trauma, suspected dissection, acute abdomen in a sick patient), or an AI triage priority for a critical pattern | 5 minutes | 30 minutes | Order (REF or casualty), RGT, AI triage (elevates only, never lowers) |
| Urgent | Same-day clinical decision depends on the result (inpatients, pre-theatre, oncology restaging with a clinic today) | 30 minutes | 2 hours | Order, RGT |
| Routine outpatient | Everything else | Same working day | 24 hours (working) | Default |
| Screening mammography | Double reading where used | Next working day | 3 working days including the second read and arbitration | Policy |
| Deferred | Studies awaiting comparison, additional views or clinical information | On resolution | 24 hours after resolution | RGT |

SLA timers are shown as thin progress bars turning Beam then Flare (design system §5.2). Targets are illustrative and configurable per Practice and per referrer contract (hospital JV contracts often set stricter inpatient targets). Breaches are visible to the hub manager in real time and are analysed weekly.

### 7.2 Fairness of distribution and pooling

* The pool is defined per hub and per Practice: which radiologists may read which Practice's studies (reading services agreements on M02), which modalities and sub-specialties.
* Routing prefers: priority first, then sub-specialty match, then the radiologist with the lowest case-mix-weighted load in the current session, then the oldest study. Self-assignment is allowed within these rules; "cherry-picking" (taking only high-weight or simple studies) is discouraged by showing each radiologist's weighted mix versus the pool average and by capping consecutive self-assignments outside the routed order (configurable).
* A locked study that is not opened within the lock time-out returns to the pool with a notice.
* On-call: the M17 roster defines the on-call radiologist per hub and time window; STAT and urgent studies route to them first, then to any available reader; mobile review is supported for a preliminary read with a mandatory final sign on a diagnostic workstation when the policy requires it.

### 7.3 Structured templates

Templates are defined per modality and body part with sections (clinical information, technique, comparison, findings, impression, recommendations), mandatory fields, pick-lists, macros, scoring systems where applicable (for example BI-RADS for breast imaging, Lung-RADS for lung screening, LI-RADS, PI-RADS, TI-RADS, used descriptively and stored as configurable template content), measurement tables, and referrer-specific output formats. Template versions are governed by the Practice's lead radiologist; changes are versioned and take effect for new reports only. Templates carry the ICD-10 code prompts that help the Coding Hand (M14) later.

### 7.4 Dictation and speech-to-text

Speech recognition runs on the Platform's LLM Gateway or a private adapter; audio is retained for a configurable period (default 30 days) for correction and dispute review, then deleted. Recognition text is Class 3 in the sense that it is always edited and signed by the author before it becomes a report. Radiologists can dictate in English; other language dictation is planned per the language roadmap. Vocabulary includes SA drug names, scheme terms and local place names.

### 7.5 Comparison with priors

The comparison line is generated from the priors record: modality, date, source Practice or external provider, and a note if the prior is external or lossy. Where measurements exist in a prior structured report, the comparison table shows them next to the current measurements with the delta and the percentage change, so that growth statements are computed, not estimated. The radiologist may reject a prior as not relevant (feedback to the Priors Hand).

### 7.6 Incidental findings

Incidental findings are captured as structured findings with an "incidental" attribute. The Follow-up Hand proposes the applicable management schedule (for example pulmonary nodule size-based intervals, adrenal incidentaloma work-up, thyroid nodule criteria; the schedules are stored as configurable reference content with their source and version) and the radiologist decides which recommendation to make. Incidental findings with a recommendation are tracked to closure in process 08 so that the referrer, and where appropriate the patient, are not left without a next step.

### 7.7 Addenda and corrections

| Type | Trigger | Rules |
|---|---|---|
| Addendum | New information (a clinical query, a prior arrived late, a second reader's opinion, a peer review outcome) | Appends to the signed report; the original is unchanged; the addendum is signed; distribution re-runs with the addendum clearly marked (process 08) |
| Correction | Error in the signed report (wrong side, wrong measurement, wrong patient) | A new version supersedes the original; both versions retained and visible to authorised users; the correction reason is recorded; the referrer and, where the patient has already seen the report, the patient are notified; wrong-patient corrections open an M19 incident |
| Preliminary to final | Registrar preliminary, on-call preliminary on a mobile device | The final report references the preliminary; any material change between preliminary and final is a discrepancy record and, if clinically significant, a critical or urgent communication |

### 7.8 Second reads and double reading

* Screening mammography: where the Practice runs double reading, every screening study is read independently by two radiologists blinded to each other's read; disagreement routes to arbitration (a third reader or consensus) before sign. The Platform enforces blinding (the second reader cannot see the first read until their own is submitted) and records recall decisions per reader.
* Requested second opinion: any radiologist can request a colleague's opinion on a study; the opinion is recorded as an addendum or incorporated before sign with attribution.
* AI as a "second reader" for mammography is supported only as a findings candidate overlay after the human read, never as a substitute for the second human read, unless and until the Practice adopts a validated protocol approved by its clinical governance and recorded on M19.

### 7.9 Trainees (registrars) at teaching sites

A registrar drafts a preliminary report; the supervising radiologist reviews the images and the draft, edits, and signs. The Platform records both identities, the changes made, and a teaching discrepancy score (optional) that feeds the training programme. The preliminary report may be released to the ward as "preliminary, unsigned by consultant" only where the site's policy allows and with that label in every output. A registrar cannot sign a final report; the signing control is not rendered for the role.

### 7.10 Studies that cannot be reported

If images are inadequate (motion, incomplete), the radiologist returns the study to the site with a repeat request (a task for RAD, tracked in process 05), or reports it as "limited study" with the limitation stated. Unreported studies older than a configurable age are escalated to the hub manager daily.

## 8. Automation level

| Step | Level | Note |
|---|---|---|
| Worklist creation and sorting | A4 | Deterministic with AI triage priority as an input; monitored |
| Sub-specialty routing and fairness | A3 | Routing rules execute; hub manager reviews exceptions and overrides |
| AI triage priority | A2 | Elevates priority; the radiologist sees why; can only raise, never lower |
| Findings candidates | A1 | Every candidate accepted, edited or rejected by the radiologist |
| Speech-to-text | A1 | Author edits the text |
| Draft assembly (Drafting Hand) | A1 | Class 2 output; reviewed and signed by the radiologist; no auto-sign |
| Comparison auto-text and measurement tables | A1 | Pre-filled; radiologist confirms in the signed report |
| Follow-up recommendation structuring | A1 | Radiologist confirms; tracking afterwards is A3 (process 08) |
| Critical finding flag suggestion | A1 | Radiologist flags; the Hand suggests only |
| Sign-off | A0 | The human act that makes it a report |
| Reading-fee capture | A4 | Computed from the signed report and the fee schedule; disputes route to the hub manager |
| Peer review sampling | A4 | Random and stratified; the scoring is A0 |
| SLA monitoring and escalation | A3 | Hub manager notified; the Hand may re-route within rules |

## 9. AI and agent touchpoints

### 9.1 Models (M11)

| Model | Output | Class | Use in this process |
|---|---|---|---|
| Triage (for example intracranial haemorrhage, pneumothorax, pulmonary embolism, large vessel occlusion, fracture) | Triage priority with localisation | Priority signal (raises worklist position) | Worklist sort; never a report content item until accepted as a finding |
| Findings candidates (nodules, fractures, breast lesions, measurements) | Findings candidates with localisation and confidence | Class 2 | Overlays; accept, edit, reject |
| Speech-to-text | Text | Author-edited | Dictation |
| Report drafting (Drafting Hand's LLM step) | Draft sections | Class 2 | Draft; reviewed and signed |
| Follow-up extraction | Structured recommendations | Class 2 | Confirmed by the radiologist |
| Critical finding detector (text) | Flag suggestion | Class 2 | Confirmed by the radiologist |

Every output carries model id, version and confidence and is rendered in the provenance style until accepted. The AIO monitors override rates, agreement with signed reports, and latency; drift alarms remove a model from the routing table pending review.

### 9.2 The Drafting Hand

| Attribute | Definition |
|---|---|
| Mandate | Assemble a structured draft for the radiologist from the dictation transcript, the structured findings entered in the editor, the accepted findings candidates, the measurement table, the priors record and the template; propose an impression and follow-up items; suggest a critical or urgent flag when the content matches the practice's critical results policy categories |
| Inputs | Template and version, transcript (live), structured findings, accepted candidates (only accepted ones; rejected candidates are never included), measurements, priors record, order and indication, protocol and contrast record |
| Tools | `read_template`, `read_transcript`, `read_structured_findings`, `read_accepted_candidates`, `read_measurements`, `read_priors_record`, `read_followup_schedules`, `propose_draft`, `propose_followup_items`, `suggest_critical_flag` |
| Leash | Output is always a draft in the annotated style; it cannot call any sign, distribute or notify tool (those tools are not in its mandate and the runtime blocks them); it may not include a finding that is not in the dictation, the structured findings or the accepted candidates; it may not omit a dictated finding; it may not change a measurement value; it may not lower a severity stated by the radiologist |
| Approval policy | The radiologist reviews the whole draft; unaccepted sections are visibly annotated; signing with any unreviewed annotated section is blocked |
| Audit | Every draft version with inputs hash, model id and version, prompt version, and the diff between draft and signed report (feeds AIO monitoring of drafting quality) |
| Data handling | Sees the identified study only within the reading session's data path approved for M12; no persistence outside the report record |

### 9.3 The Follow-up Hand

| Attribute | Definition |
|---|---|
| Mandate | Turn confirmed recommendations into tracked follow-up items with due dates, owners and the schedule source; watch for the follow-up study being ordered, booked and performed; chase the referrer and, where the practice's policy allows, the patient; close the item or escalate to the radiologist and practice manager when the due date passes (detailed in process 08) |
| Tools | `read_signed_report`, `read_followup_schedules`, `create_followup_item`, `watch_orders`, `notify_referrer`, `notify_patient` (policy-gated), `escalate_to_rgt`, `escalate_to_prm`, `close_followup_item` |
| Leash | May not create a recommendation the radiologist did not sign; may not contact a patient about a finding's meaning (only about the recommended next step, in the radiologist-approved wording); may not close an item without evidence (a performed study, a referrer's documented decision, a patient's documented decline) |
| Approval policy | Item creation is A1 at signing; tracking and chasing are A3; closure without evidence is not possible |
| Audit | Every item, message, escalation and closure with evidence reference |

## 10. Peer review programme

| Element | Design |
|---|---|
| Purpose | Learning and system improvement; not performance management. Scores are never used alone for disciplinary action; the programme charter is on M19 and signed by the radiologists |
| Sampling | Randomised, stratified by radiologist, modality and priority; configurable rate (illustrative: 2 to 5 % of signed reports per radiologist per month); additional targeted samples for new radiologists, new modalities and after a discrepancy |
| Method | The reviewer reads the study blinded to the original report, records their impression, then sees the original and scores agreement |
| Scoring scale (configurable; illustrative) | 1 Concur; 2a Minor discrepancy, unlikely clinical significance; 2b Minor discrepancy, possible clinical significance; 3a Major discrepancy, unlikely clinical significance; 3b Major discrepancy, likely clinical significance |
| Discrepancy categories | Perception (missed finding), interpretation (finding seen, wrong conclusion), communication (report unclear or incomplete), technical (limited study not stated), follow-up recommendation omitted or inconsistent |
| Handling | Scores 2b and 3 route to the original radiologist for comment; 3b triggers an addendum consideration, a critical communication if still relevant, and an M19 review; the patient's care is always corrected first, the learning second |
| Learning meetings | Monthly per Practice or hub; de-identified cases selected by CMP and the lead radiologist; attendance recorded for CPD on M17 |
| Feedback to radiologists | Personal dashboard with their scores, the pool distribution, and the anonymised comparison; no league table |
| Feedback to AI | Discrepancies are compared with BCI candidates for the same study (was the finding a candidate that was rejected? was it not detected?) and feed AIO monitoring |
| Also reviewed | Preliminary versus final discrepancies (trainees, on-call), and referrer-raised concerns |

## 11. Reading-fee capture

* Each signed report generates a reading-fee event with the study's procedure codes, modality, a configurable weight (an RVU-like relative value per procedure code, maintained by the Practice or Hub as reference data), the signing radiologist, the reading contract (M02 reading services agreement or employment), and any multipliers (STAT, after-hours, second read, addendum, teaching supervision) defined in the contract.
* The Hub's intercompany invoice to each Practice (M15) is generated from these events; the radiologist's statement is visible daily in their dashboard with the weighted count, the fee, and any disputed items.
* Corrections and wrong-patient reports reverse the event; addenda generate an event only if the contract pays for them.
* Peer review, protocolling and critical result calls may carry their own weights so that non-reporting clinical work is visible and fairly paid.

## 12. Reading environment, ergonomics and fatigue controls

* The Reading Room follows the design system §6: dark Carbon chrome, GSDF-calibrated diagnostic displays, hotkeys, push-to-talk, second-monitor mode.
* Session controls: the Platform shows session reading time and weighted volume; a configurable prompt suggests a break after a continuous reading period (illustrative: 2 hours); the hub manager sees fatigue indicators (session length, after-hours reads, consecutive STAT reads) and may cap assignment.
* Interruptions are minimised: critical result calls are handled by the Critical Results Hand (process 08); referrer calls are queued with a call-back SLA; the radiologist chooses when to take them except for STAT clinical queries.
* Ambient light, monitor calibration and workstation ergonomics are recorded per reading station on M18 as part of the QA schedule (process 05 §10.6).

## 13. Data produced

| Object | Key content |
|---|---|
| `worklist_item` | Study, priority, SLA deadline, sub-specialty, pool, lock, assignment history, triage chip with provenance |
| `report` (versions) | Template and version, sections, structured findings, measurements, comparison, impression, recommendations, critical flag, status (draft, preliminary, final, addended, corrected), author, supervisor, signed_at, HPCSA number, practice number |
| `findings_candidate_decision` | Model id and version, candidate, decision (accept, edit, reject), reason, user, timestamp |
| `draft_version` | Drafting Hand output, inputs hash, diff to signed |
| `dictation_audio` and `transcript` | Retained per policy |
| `followup_item` | Recommendation, due date, owner, schedule source, status, evidence |
| `second_read` | Reader, blinded read, arbitration outcome |
| `peer_review` | Sample, reviewer, score, category, comments, actions |
| `reading_fee_event` | Codes, weight, multipliers, contract, amount |
| Events | `report.drafted.v1`, `report.preliminary.v1`, `report.signed.v1`, `report.addended.v1`, `report.corrected.v1`, `report.critical_flagged.v1`, `followup.created.v1`, `peer_review.scored.v1`, `reading_fee.captured.v1` |

## 14. KPIs

| KPI | Definition | Target (illustrative) | Persona |
|---|---|---|---|
| Turnaround by priority | `study.available.v1` to `report.signed.v1`, P50 and P90 per priority | Within the SLA table for 95 % of studies | RGT, hub manager, REF |
| STAT reading start | Availability to first open | Under 5 minutes P90 | Hub manager |
| Backlog age | Unreported routine studies older than 24 hours | Zero at 08:00 daily | Hub manager |
| Discrepancy rate | Peer review scores 3a and 3b ÷ reviewed | Below the programme's benchmark; trend down | CMP, RGT |
| Peer review completion | Samples scored within 14 days | Above 90 % | CMP |
| Candidate acceptance and override | Accepted ÷ presented per model | Monitored against validation baseline | AIO |
| Draft edit distance | Character-level change between draft and signed report | Trend down without an increase in discrepancy | AIO |
| Addendum and correction rate | Per 1 000 signed reports | Monitored; corrections for wrong side or wrong patient trend to zero | CMP |
| Follow-up items structured | Reports with a recommendation that have a structured item | 100 % | Follow-up Hand |
| Double reading arbitration rate | Screening studies needing arbitration | Monitored | CMP |
| Weighted throughput | Weighted reports per session hour, case-mix adjusted | Fair comparison within the pool; not a target for individuals | RGT, hub manager |
| Fatigue indicator | Sessions over the break prompt without a break | Trend down | Hub manager |

## 15. Controls

1. No auto-sign: the signing action requires an authenticated radiologist with a current HPCSA registration and, for critical-flagged reports and at configured intervals, MFA re-authentication. No tool available to any Hand can sign, and the runtime enforces the mandate.
2. A draft with any unreviewed annotated section cannot be signed; the editor blocks the action and names the sections.
3. Rejected findings candidates never appear in a draft; the Drafting Hand's inputs are restricted to accepted candidates by the tool contract.
4. AI triage can raise but never lower a human-set priority.
5. Mammography overlays are off by default and their activation time relative to the read is recorded.
6. Registrar roles cannot sign; preliminary reports carry the "preliminary" label in every rendering.
7. Double reading enforces blinding in the Platform, not by convention.
8. Report versions are immutable; corrections supersede with reason and notify recipients.
9. Peer review scores are visible to the radiologist, CMP and the lead radiologist only; aggregate reporting to EXE is anonymised.
10. Dictation audio retention and deletion follow the configured period and are logged.
11. Reading-fee weights and multipliers are versioned reference data; changes require the Practice or Hub's approval workflow (reserved matters where the agreement says so).
12. SLA definitions are per Practice and contract; the hub manager's overrides are logged.

## 16. Requirements

* M12-R-100 The Platform MUST present a radiologist worklist sorted by priority class, then AI triage priority within class, then age, with sub-specialty, site, SLA timer, priors-ready state and lock state visible.
* M12-R-101 The Platform MUST support self-assignment with locking and time-out, routed assignment by configurable fairness rules, on-call routing from the M17 roster, and hub pooling across Practices under reading services agreements.
* M12-R-102 AI triage MUST only raise a study's position within or across priority classes and MUST show model id, version and confidence.
* M12-R-103 The Platform MUST provide structured reporting templates per modality and body part with mandatory fields, pick-lists, macros, scoring systems, measurement tables and versioning; a report MUST NOT be signable with mandatory fields empty.
* M12-R-104 The Platform MUST provide speech-to-text dictation with a radiology vocabulary and configurable audio retention.
* M12-R-105 The Drafting Hand MUST produce drafts only from the transcript, structured findings, accepted candidates, measurements, priors record and template; drafts MUST be rendered in the provenance style until reviewed; the Drafting Hand MUST NOT have access to sign, distribute or notify tools.
* M12-R-106 The Platform MUST NOT provide any automatic signing of reports under any condition; signing MUST require an authenticated radiologist with current HPCSA registration and MFA re-authentication for critical-flagged reports.
* M12-R-107 Findings candidates MUST require an explicit accept, edit or reject decision recorded with provenance; rejected candidates MUST NOT appear in the report.
* M12-R-108 The Platform MUST generate comparison auto-text and measurement comparison tables from the priors record and prior structured reports, editable by the radiologist.
* M12-R-109 Recommendations MUST be captured as structured follow-up items (what, when, why, who) confirmed by the radiologist at signing and tracked by the Follow-up Hand.
* M12-R-110 The Platform MUST support critical and urgent finding flags that initiate the process 08 communication and MUST block signing a critical-flagged report without a communication record.
* M12-R-111 The Platform MUST support addenda (append, signed) and corrections (supersede with reason, both versions retained, recipients notified) and preliminary-to-final tracking with discrepancy records.
* M12-R-112 The Platform MUST support blinded double reading with arbitration for screening mammography where the Practice adopts it, and second-opinion requests with attribution.
* M12-R-113 The Platform MUST support trainee roles that draft but cannot sign, with supervisor sign-off recorded and preliminary labelling on every output.
* M12-R-114 The Platform MUST run a peer review programme with randomised stratified sampling, blinded review, a configurable scoring scale, discrepancy categories, routing of significant discrepancies to patient-care correction and M19 review, learning meeting support and anonymised aggregate reporting.
* M12-R-115 The Platform MUST measure turnaround per priority against configurable SLAs per Practice and contract, escalate breaches to the hub manager, and report daily backlog age.
* M12-R-116 The Platform MUST capture a reading-fee event per signed report using configurable weights and multipliers per contract, reverse it on correction, and feed M15 intercompany invoicing and the radiologist's statement.
* M12-R-117 The Platform SHOULD provide session reading time, break prompts and fatigue indicators to the radiologist and hub manager.
* M12-R-118 The Platform SHOULD compare peer review discrepancies with BCI candidates for the same study and feed the result to AIO monitoring.
* M12-R-119 The Platform MAY release registrar preliminary reports to wards where site policy allows, with the preliminary label enforced.

## Reportable-result categories at sign-off

At sign-off the radiologist can select reportable-result categories (for example TB-suggestive
pattern, suspected non-accidental injury in a child, possible occupational lung disease, radiation
incident). Each category inserts a legally reviewed standard statement into the report; AI never
generates legal wording. The categories, statements and downstream duties are governed by
`24-statutory-and-regulatory-register.md` §3 and §6.
