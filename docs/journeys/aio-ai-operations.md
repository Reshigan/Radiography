# AIO — AI Operations and Clinical Safety Officer for AI: Persona Journey

## Persona snapshot

| Item | Detail |
|---|---|
| Code | AIO |
| Who | AI operations and model governance for Bonakala Clinical Intelligence (BCI). A small MSO team: a clinical safety officer for AI (a radiologist or clinical scientist), an ML engineer and a regulatory lead for SAHPRA software-as-a-medical-device (SaMD) files. Cross-tenant by agreement; sees de-identified data by default. |
| Goals | Safe, monitored, explainable AI; regulatory files (SAHPRA SaMD); drift detection; no AI slip. |
| Frustrations today | Vendor models as black boxes with no site-level performance data; drift discovered by a radiologist's complaint; no record of who approved what version where; vigilance reports written from memory. |
| Better than market | A model registry with intended use and output class per model; daily performance proxies per model per site; shadow mode as a standard state; change control enforced by the runtime; a vigilance file that writes itself from events. |
| Surfaces | Clinical lens (Carbon, Dense L3, High W3, Signal). BCI console (M11): Model Registry, Monitoring, Shadow Evaluations, Incidents, Change Control, Committee; `TrendChart`, `Distribution`, `Cohort`, `Provenance`, `FindingOverlay`, `Confirm`. |
| Metrics | Model performance versus baseline, override rate, time-to-detect drift. |
| Modules touched | M11 Clinical Intelligence (owner), M12 Reporting, M08 Acquisition & Worklist, M09 Image Management, M18 Assets & Engineering, M19 Quality, Risk & Compliance, M20 Agent Runtime, M21 Platform Core. |

The journey follows Dr Adams, the clinical safety officer for AI, and Thabo, the ML engineer.

---

## Scene 1 — A drift alarm on chest X-ray triage at one site

**Situation.** Monday 06:30 SAST. The BCI Monitoring view raises a Beam alarm: "cxr-triage v3.2 at Randburg: input image statistics drifted (pixel intensity histogram and noise-texture distance above threshold since Thursday); triage-priority rate for 'urgent' up from 6.1 % to 11.4 %; radiologist override rate up from 4 % to 13 %. Other sites unchanged." The alarm is drawn in the annotated style with the monitor's own version.

**What they see.** The Monitoring view shows, per model per site, the daily proxies from M11: agreement with the signed report (computed by matching the model's findings candidates against structured report fields after sign-off), override rate (candidates rejected by the radiologist), triage-priority distribution, latency, quality flags, and drift on image statistics. A `TrendChart` for Randburg shows the step change on Thursday. The `Inspector` for Randburg's general X-ray room 1 shows an M18 event from Thursday morning: "detector replaced, vendor service visit, new detector model" (see the BIO journey for how device changes are recorded). Nobody told AIO, but the Platform did.

**What they do.** Dr Adams opens the `Cohort` of Randburg chest X-rays since Thursday, de-identified, and compares a sample of the model's outputs against the signed reports with Thabo: the model is over-calling "urgent" on images from the new detector, which has a different noise texture and a different default processing curve. There is no evidence of a missed urgent case (the false-negative proxy, which compares signed-report critical findings against the model's non-urgent priorities, is unchanged), but the over-calling is wasting radiologists' time and eroding trust. She takes three actions: (1) she sets the model to "advisory-suppressed" at Randburg room 1 (the model still runs and logs, but its triage priorities do not reorder the worklist; the Reading Room shows a note that triage is suspended for that room and why); (2) she opens an AI incident in M19 classified as "performance degradation, no patient harm identified", linked to the M18 detector change; (3) she asks Thabo to run the model's validation set through the new detector's processing profile and to ask the vendor whether the model was validated on that detector.

**What the Platform does.**
- Every inference result carries provenance (model id, version, confidence, input quality flags) and the acquisition context (modality, detector model and software version from the DICOM headers and M18). Monitoring is stratified by site, room and detector automatically, which is why a single-room drift is visible in days rather than months.
- Routing rules in M11 can suppress, shadow or disable a model per Practice, site, room, detector or population, effective immediately, with the change logged.
- M18 device changes emit `asset.change.recorded.v1`, and M11 subscribes: any change to a device in a model's input path opens a "re-validation needed" flag for that model at that room, even before drift appears. In this case the flag was raised on Thursday and would have been reviewed at the weekly check; the drift alarm arrived first.
- Events: `ai.drift.alarm.v1`, `ai.model.routing.changed.v1`, `ai.incident.opened.v1`, `ai.revalidation.flagged.v1`.

**Edge cases.**
- The false-negative proxy had moved. The incident would be classified as potential harm, the Cohort would be reviewed by a radiologist for missed findings, and any affected patient recalled through the addendum and Critical Result workflow in M12 and M13.
- The vendor confirms the detector is out of the model's validated scope. The model stays suppressed for that room until a validated version exists; the registry entry's "validated inputs" list is updated so the routing rule excludes that detector model at every site.
- The site's radiologists ask for the triage back because the worklist is busy. The Reading Room still shows priorities from the radiologist's own clinical indication ranking and STAT flags; AI triage is an addition, never the only ordering.

**Success measure.** Drift detected within 3 days of the cause; suppression within an hour of confirmation; no patient harm; the device-change subscription catches the next such change before drift.

---

## Scene 2 — Shadow-mode evaluation of a new fracture model

**Situation.** A vendor's fracture-detection model for extremity radiographs (SAHPRA registration reference recorded in the registry, with the class and the intended use as registered) is proposed for the Group. The AI committee has approved a shadow-mode evaluation at four sites for 8 weeks.

**What they see.** The Shadow Evaluation object in M11: the registry entry, the protocol (sites, modalities, body parts, age scope, sample size target, primary and secondary measures, stopping rules), the routing rule (run in shadow: results stored, not shown to radiologists), the data path (de-identified DICOM to the vendor's container in the SA inference cell; no image leaves the country; the vendor's operator agreement under POPIA is attached), and the live dashboard: studies processed, agreement with signed reports for "fracture present" by body part, estimated sensitivity and specificity proxies with confidence intervals (labelled as proxies because the signed report is the reference, not adjudicated ground truth), latency, quality-flag rate, and the distribution by site, detector and age band. A weekly sample of disagreements is routed to a radiologist reviewer for adjudication (an A0 judgement).

**What they do.** At week 4 Dr Adams reviews the interim: agreement is strong for long bones and weak for scaphoid and paediatric elbows (the model was not validated for under-16s; the protocol excluded them, but the evaluation deliberately logs, without acting on, the out-of-scope population to characterise the risk of mis-routing). She narrows the proposed live scope to adults, long bones and ankle. Thabo adds a monitor for the repeat rate at the sites, at CMP's request, so that any change in radiographer behaviour after overlays go live is detected. At week 8 the evaluation closes; Dr Adams writes the recommendation and opens the change request for Practice A that the CMP journey describes.

**What the Platform does.**
- Shadow mode is a first-class state of every model: results are stored as DICOM SR and JSON with provenance, excluded from worklists and the Reading Room, and included in monitoring.
- The adjudication sample is a `Queue` for the reviewing radiologist, with the images, the model's `FindingOverlay` in the annotated style, and the signed report; the adjudication is stored as a labelled example.
- Age scope is enforced technically: the routing rule uses M03's date of birth; a study from an under-16 is never routed to the live model, and the shadow run tags it as out-of-scope.
- Events: `ai.shadow.started.v1`, `ai.shadow.interim.v1`, `ai.adjudication.recorded.v1`, `ai.shadow.closed.v1`, `ai.change_request.opened.v1`.

**Edge cases.**
- A stopping rule fires: the model's quality-flag rate at one site exceeds 20 % because of a non-standard collimation practice. The evaluation pauses at that site automatically, and BIO and the site's RAD lead are asked to check positioning practice (which is also a dose and quality question for M10).
- The vendor asks for the evaluation images to improve their model. The operator agreement does not permit it; the request is declined in the record, and any future secondary use would require a separate lawful basis and CMP approval.

**Success measure.** Evaluation completed to protocol; live scope narrower than the vendor's claim where evidence is weaker; every adjudication stored; no out-of-scope routing.

---

## Scene 3 — A near-slip incident review

**Situation.** A radiologist at the Hub reports, through the Reading Room, that a draft report for a CT brain contained the sentence "No acute intracranial abnormality" pre-populated in the findings section from the AI-drafted text, and that he nearly signed it before noticing that the AI's own findings candidate list for the same study had flagged a small subdural collection at 0.61 confidence. He rejected the draft, reported the collection, and filed the report. No slip occurred: the report was signed by the radiologist with the correct finding. But the draft was inconsistent with the model's own candidate, and the inconsistency was not surfaced.

**What they see.** The AI incident in M19 and M11, classified "near-slip, Class 2 output, no harm": the study (identified, because the incident requires it, with the access recorded), the drafting model's output and provenance, the triage model's candidate and provenance, the Reading Room session log (what was on screen, in what order, for how long, which overlays were toggled), and the radiologist's report. The Incident Hand (A2) has reconstructed the sequence: the drafting Hand composed the draft from the dictation and the structured template's defaults, and the template default for "intracranial" was normal text; the findings candidate from the triage model was in the overlay panel, which was collapsed in this radiologist's saved layout.

**What they do.** Dr Adams convenes a short review with the Hub's clinical lead and the BDL team. The root causes recorded: (1) template defaults can be populated by the drafting Hand without a cross-check against the study's own findings candidates; (2) the overlay panel can be collapsed while an above-threshold candidate exists; (3) the draft's provenance chip did not distinguish "from dictation" from "from template default". Corrective actions: the drafting Hand must include a "candidate conflict" flag whenever a draft sentence contradicts an above-threshold findings candidate, and the `ReportEditor` must render such sentences in Flare annotated style until the radiologist explicitly resolves the conflict; the Reading Room must not allow sign-off while an unresolved candidate conflict exists (a hard gate, consistent with the no-slip design); the provenance chip must carry the source segment (dictation, template default, AI draft). Each becomes a change request in M11, M12 and the BDL package with a version and a test.

**What the Platform does.**
- Near-slips are incidents with the same rigour as slips; the definition in the conventions (AI content reaching a signed record without the verification tier) was not met, and the Platform records why: the radiologist's review was the tier, and it worked.
- The Reading Room session log is retained for every signed report so that any question about what the radiologist saw can be answered.
- The change requests are tracked to deployment, and the monitoring adds a "candidate conflict" proxy: how often drafts conflict with candidates, how often radiologists resolve them each way.
- Events: `ai.incident.opened.v1`, `ai.incident.root_cause.recorded.v1`, `ai.change_request.opened.v1`, `ai.incident.closed.v1`.

**Edge cases.**
- The review finds that a similar draft was signed unchanged by another radiologist last month. That is a potential slip: the study is re-read, an addendum is issued if needed, the patient and referrer are informed through M12 and M13, and the incident is reclassified.
- The radiologist who reported it asks that the report not identify him. Reporter identity is protected by the just-culture setting in M19; the review sees the role, not the name, unless the reporter opts in.

**Success measure.** Near-slip reported and reviewed within 5 working days; the hard gate deployed within one release; candidate-conflict rate tracked from day one; the reporter thanked.

---

## Scene 4 — A SAHPRA vigilance report

**Situation.** The drift incident (Scene 1) and the near-slip (Scene 3) both involve software that is a medical device under SAHPRA's framework: the chest X-ray triage model is a vendor SaMD with a SAHPRA registration reference, and the drafting Hand is part of the Platform's own regulated function (the Group's regulatory lead has recorded the Platform's own SaMD position and registration or exemption reference in the registry, with the legal advice attached). The Group's vigilance policy requires the regulatory lead to assess each AI incident against the reporting criteria in the vendor's and the Platform's post-market surveillance plans and, where met, to report to SAHPRA and to the vendor within the periods those plans and the regulator's guidance prescribe (the Platform stores the periods as reference data, labelled to be confirmed against current SAHPRA guidance).

**What they see.** The Vigilance view in M11 and M19: each AI incident with a reportability assessment field, the applicable criteria, the deadline countdown from the date of awareness, and the report draft assembled by the Compliance Hand from the incident's facts: device identification (model, version, registration reference, manufacturer), the event description, the patient outcome (none), the root cause, the corrective actions, the affected population (studies processed by the model at that room in the period), and the Group's contact details.

**What they do.** The regulatory lead assesses the drift incident: no patient harm, but a performance degradation of a registered device in a specific configuration, which the vendor's surveillance plan treats as a reportable field-performance event to the manufacturer and, per the Group's policy, as a notifiable event to SAHPRA. She approves the vendor notification and the SAHPRA report; the Hand submits each through the configured channel and records the references. For the near-slip, her assessment is that the criteria are not met (no device malfunction reached a patient; the human control worked), but she records the assessment and the reasoning so that a later reviewer can disagree with evidence.

**What the Platform does.**
- Vigilance is a workflow on incidents, not a separate file: every AI incident must have a reportability assessment before closure.
- The affected-population count is computed from inference events, not estimated.
- Vendor notifications go through the vendor's agreed channel with the Group's operator agreement reference; the vendor's response is attached.
- Events: `vigilance.assessment.recorded.v1`, `vigilance.report.submitted.v1`, `vigilance.vendor.notified.v1`.

**Edge cases.**
- SAHPRA requests further information. The correspondence attaches to the incident; the countdown resets to the regulator's date.
- The vendor issues a field safety notice for the model. The registry marks the version, the routing rules apply the notice's restriction (for example, suppression on the affected detector model) across every Practice at once, and each Practice's CMP is notified because the change affects their tenants.

**Success measure.** Every AI incident has a recorded reportability assessment; reports submitted inside the prescribed period; vendor notices applied network-wide within a day.

---

## Scene 5 — The quarterly AI committee

**Situation.** Quarter-end. The AI committee (the CMO as chair, the clinical safety officer for AI, a Practice CMP representative, a radiologist from the Hub, the regulatory lead, the CIO's delegate and a patient representative) meets to review the quarter and to approve the next quarter's changes.

**What they see.** The Committee view in M11 assembles the quarter: the model registry with status per model per Practice (live, shadow, suppressed, retired), performance versus baseline per model with site-level outliers, override rates by model and by reader band (de-identified), incidents and near-slips with their status, vigilance reports, shadow evaluations completed and proposed, change requests approved and pending (including the fracture model's staged rollout from the CMP journey and the Reading Room hard gate from Scene 3), the Hands' operational metrics (exception rates, budget, mandate breaches attempted and refused by the runtime, which should be zero and are), the fairness review (performance by age band, sex and site, since the Platform does not process race data without consent), patient-facing communication status (the Patient Space and consent copy about computer checks, in each language), and the training status of readers per model.

**What they do.** The committee reviews. It approves the fracture model's rollout to Randburg after Sandton's 30 days, declines a vendor's proposal to run a mammography triage model with overlays on by default (the Group's human-first policy for mammography keeps overlays off), asks for the chest X-ray triage model's validated-input list to be reviewed across all detector models in the fleet (M18 provides the list), and records a decision that the drafting Hand's candidate-conflict proxy becomes a standing committee metric. The patient representative asks whether patients can opt out of AI triage; the answer recorded is that triage affects reading order only, never the report, and the Patient Space explains this; a per-patient opt-out from findings-candidate overlays is put on the roadmap for discussion with CMP and the CMO. The minutes are generated from the recorded decisions, reviewed, and locked.

**What the Platform does.**
- The Committee view is a saved query over M11, M18, M19 and M20 events; nothing is assembled by hand.
- Decisions become effective-dated changes in the registry and the routing rules, each still subject to Practice-level CMP change control.
- The minutes are part of the board pack (see the EXE journey) and the accreditation evidence (see the CMP journey).
- Events: `ai.committee.decision.recorded.v1`, `ai.committee.minutes.locked.v1`.

**Edge cases.**
- A Practice's CMP declines a network-wide decision for their tenant. Tenancy wins: the decision is recorded as "not adopted at Practice X, reason", and the committee sees it.
- A model is retired. The registry keeps its full history, and every report that used its candidates keeps the provenance; retirement never rewrites the past.

**Success measure.** Every model has a committee-reviewed status each quarter; zero mandate breaches by Hands; fairness review completed; decisions traceable to routing changes.

---

## Moments that beat the market

- Drift is detected per room and per detector within days, and the device change that caused it is already linked because M18 told M11.
- A model can be suppressed for one room in one Practice in a minute, with the Reading Room explaining why.
- Shadow mode is a standard state with a protocol, adjudication and stopping rules, and the live scope is narrowed to what the evidence supports.
- A near-slip is treated as an incident, reconstructed from the Reading Room session log, and turned into a hard gate that makes the next one impossible.
- The vigilance file writes itself from events, with affected populations computed rather than estimated.
- Age and population scope are enforced by routing rules, not by policy documents.
- Hands' attempted mandate breaches are a committee metric, and the runtime keeps them at zero.
- The quarterly committee approves from a saved query, and its decisions become effective-dated changes still subject to each Practice's CMP.

## Failure modes designed out

- **Drift found by complaint.** Stratified daily proxies and device-change subscriptions.
- **Silent version changes.** Every version is a new registry entry and a new change request; the old version keeps running until approved.
- **Out-of-scope inference.** Routing rules use the patient's date of birth and the device's validated inputs technically.
- **AI drafts signed unread.** Candidate-conflict flags and a sign-off gate on unresolved conflicts.
- **Images leaving the country for vendor benefit.** De-identified inference in the SA inference cell; secondary use requires a separate lawful basis.
- **Vigilance from memory.** Reportability assessment is mandatory before incident closure; drafts assemble from facts.
- **Network decisions overriding tenants.** Practice-level CMP change control always applies.
- **Fairness assumed.** Quarterly performance by age band, sex and site is a committee deliverable.
