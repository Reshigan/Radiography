# Journey: CMP — Compliance, Quality, Radiation Protection and Information Officer

## Persona snapshot

| Item | Detail |
|---|---|
| Code | CMP |
| Who | The compliance and quality function of a Practice, often one person wearing several statutory hats: quality manager, Radiation Protection Officer (RPO) named on the SAHPRA licences, POPIA Information Officer registered with the Information Regulator, and the Practice's contact for HPCSA, SAHPRA, the Council for Medical Schemes and accreditation bodies. In larger Practices the roles are split; in the Group, a compliance lead in the MSO supports every Practice's CMP. |
| Goals | Prove compliance continuously: SAHPRA licences and QA, HPCSA registration, POPIA, dose, incidents, audits, accreditation. |
| Frustrations today | Evidence scattered in files and inboxes; licence renewals discovered late; incidents investigated by email; peer review as a chore that produces no learning; accreditation packs assembled over weeks; AI introduced without a change-control record. |
| Better than market | Evidence collected automatically; a living compliance calendar; regulator packs in one click; incident learning loops; AI change control as a first-class workflow. |
| Surfaces | Governance lens (Bone, Comfortable L2, Standard W2, Marrow). Compliance console (M19), `Calendar`, `Timeline`, `KanbanBoard`, `DataTable`, `Confirm`, `Inspector`, `DoseGauge`. |
| Metrics | Open non-conformances, licence currency, incident closure time. |
| Modules touched | M19 Quality, Risk & Compliance (owner), M10 Dose & Radiation Safety, M01 Identity & Access, M03 Patient Master Index, M09 Image Management, M11 Clinical Intelligence, M12 Reporting, M17 Workforce, M18 Assets & Engineering, M20 Agent Runtime, M21 Platform Core. |

The journey follows Nomvula, quality and compliance manager for Practice A (Sandton and Randburg), who is the RPO for both sites and the Practice's Information Officer.

---

## Scene 1: A POPIA access request

**Situation.** Monday 09:10 SAST. A patient emails the Practice's info@ address: he wants copies of all his records, including images, and wants to know who has accessed them, because he suspects a former employer obtained his report. Under POPIA section 23 a data subject may request confirmation of whether the responsible party holds their personal information, and a description of it and of the recipients. The Practice's policy (stored as configurable reference data) is to respond within the period the Regulations prescribe and, as a matter of practice, within 10 working days; the Platform tracks the statutory and the policy deadline separately, and the statutory deadline is labelled as reference data to be confirmed by the Practice's legal adviser.

**What they see.** The inbound email was classified by the intake Hand (M21 and M19, Class 4 classification) as a "data subject access request" and opened as an Access Request object in Nomvula's queue with the email attached, the deadline countdown as an SLA bar, and a checklist: verify identity, verify authority (self or representative), scope the request, collect the record, review for third-party information, prepare the disclosure, deliver securely, record.

**What they do.** Nomvula verifies identity: the Access Request Hand (M19, A2) has matched the email address to a patient in M03 with 0.94 confidence; she asks the patient, through the Patient Space, to confirm with the OTP flow and to specify the date range. Once confirmed, she scopes the request: all encounters at Practice A in the last five years. The Hand assembles the record: reports (M12), images as a DICOM export and as a viewer share link (M09), the referral and order documents (M04), the consent records (M07), the claims and statements (M14), and the access log for those records from the immutable audit stream (M21) showing every user, role, purpose and time, including any Hand that touched them and any cross-tenant access by the MSO bureau. She reviews the access log: it shows a request by a Referrer Space user (the patient's GP), the radiologist, the bureau's Coding Hand and clerk, and no unexplained access. It also shows that the report was sent to the referring GP, as the patient consented at registration. She prepares the disclosure with the Hand's draft cover letter in plain language, redacts nothing (there is no third-party information), and delivers it through the Patient Space with a secure download that expires, never as an email attachment. She records the request as closed with the response date.

**What the Platform does.**
- Every read of clinical, financial or identity data is logged immutably with user, role, purpose and lawful basis; the access report for a data subject is a query, not an investigation.
- The Access Request object has statutory and policy timers, the identity verification step, and the delivery method as required fields; delivery by email attachment is not an option.
- The Information Officer register (M19) records the request for the annual report to the Information Regulator, and the Group's compliance lead sees counts across Practices without content.
- Events: `popia.access_request.opened.v1`, `popia.access_request.identity_verified.v1`, `popia.access_request.fulfilled.v1`.

**Edge cases.**
- The access log shows an access the patient did not expect: a scheme's audit request under the Funder API, done with the consent given at registration. Nomvula explains it in the cover letter and the consent record is included.
- The patient asks for deletion. Medical records have retention obligations (HPCSA guidance, stored as reference data per record class); Nomvula explains the lawful basis for retention and records the objection.

**Success measure.** Identity verified within one working day; disclosure delivered within the policy deadline; zero disclosures by email; every request in the Information Officer register.

---

## Scene 2: Radiation licence renewal

**Situation.** The SAHPRA Radiation Control licence for Randburg's general X-ray room 2 expires in 120 days. Licences under the Hazardous Substances Act for Group III equipment are issued to the licence holder for equipment at an address with an RPO; renewal needs the application, the licence conditions evidence (QA, shielding, staff training, dosimetry) and the fee.

**What they see.** The compliance `Calendar` in M19 shows every licence, registration, accreditation, QA test, dosimetry wear period, policy review and training expiry across the Practice as dated items with countdowns. The renewal item for room 2 turned Beam at 120 days. The Compliance Hand (M19, A3) has opened a renewal task with the application pre-filled from M02 (licence holder, address, RPO), M18 (equipment serials, model, install date, last service), M10 (acceptance and routine QA results, shielding survey date and report) and M17 (staff radiation-safety training). Items still missing are listed: the annual QA test for the unit is due in 20 days and must be in the pack.

**What they do.** Nomvula asks BIO to bring the QA test forward; the Maintenance Hand schedules it. She reviews the pre-filled application, corrects one contact detail, and, when the QA result arrives, approves the pack with a typed `Confirm`. The Hand submits it through the channel SAHPRA accepts (email or portal, configured per regulator), records the submission reference, and starts a follow-up timer. The fee is raised as a payment request to the Practice's finance in M15 with the licence as the reference.

**What the Platform does.**
- The compliance calendar is generated from effective-dated records, not maintained by hand: a new modality adds its licence and QA items on commissioning; a staff member's training expiry appears from M17.
- The Hand may prepare and submit applications the CMP has approved; it may not sign as the RPO or licence holder, and it cannot mark a licence renewed until the regulator's document is uploaded and its number and dates are read and confirmed.
- Escalation: 120 days to CMP, 60 days to PRM, 30 days to EXE; at expiry the slot engine blocks the room (M02-R-006) unless CMP records an override with the regulator's written extension attached.
- Events: `licence.renewal.due.v1`, `licence.renewal.submitted.v1`, `licence.renewed.v1`.

**Edge cases.**
- SAHPRA requests additional information. The correspondence is attached to the licence record and the timer resets to the new due date.

**Success measure.** No licence at the Practice ever reaches expiry without a submitted renewal; renewal packs prepared with zero manual document hunting.

---

## Scene 3: A wrong-patient exposure incident

**Situation.** Thursday 15:40. At Sandton, a radiographer calls two patients with the same surname from the waiting area; the wrong Mr Dlamini enters room 1 and receives a chest X-ray (two projections) intended for the other. The error is noticed at the modality when the radiographer compares the wristband ID to the worklist after exposure. No harm beyond an unnecessary exposure; the second patient is imaged correctly afterwards.

**What they see.** The radiographer reports the incident on the technologist console within minutes (M19 incident form, with the study, the MPPS record and the dose from the Dose Structured Report attached automatically by M10 and M08). The incident opens in Nomvula's queue at Flare priority because the classification is "unintended exposure, wrong patient". The `Inspector` shows: the two patients' identities, the wristband scan log (the scan happened after exposure, not before), the worklist selection log, the dose (effective dose estimate from the DoseSR, labelled as an estimate with the conversion method), the radiographer, the room, and the site's procedure for patient identification.

**What they do.**

1. Nomvula confirms the classification and the immediate actions: the exposed patient has been told, apologised to and given the option of a discussion with a radiologist about the dose (the site's principal did this within the hour; the conversation is recorded as a disclosure event). The wrongly acquired images are quarantined in M09 against the correct patient (they are Mr Dlamini A's images, so they stay on his record marked "acquired in error, not clinically indicated", never deleted, never merged into Mr Dlamini B's record).
2. She decides whether the incident is reportable to SAHPRA under the licence conditions. The Platform shows the Practice's reporting thresholds (stored as configurable reference data, labelled to be confirmed against the current licence conditions) and the dose; the Hand drafts the notification with the facts. Nomvula decides it is reportable, approves the draft and the Compliance Hand submits it, recording the reference.
3. She opens the investigation. The Incident Hand (M19, A2) reconstructs the timeline from events: appointment check-in times, the queue board call, the worklist selection at the modality (the radiographer picked the patient from the worklist before the wristband scan; the console allows this but requires the scan before exposure, and the scan step was skipped), and MPPS timestamps. Nomvula interviews the radiographer with a structured, just-culture form; the root causes are recorded from the taxonomy: identification step order, same-surname queue call, console allowed exposure without a wristband scan under a site-level configuration.
4. Corrective actions: the technologist console's "wristband scan before exposure" gate is set to mandatory for the site (SUP applies the configuration; the change is recorded in M21 with the incident as the reason); the queue board call is changed to first name plus surname plus year of birth on the display; the finding is shared through the Group's incident learning feed de-identified, so every site reviews its own configuration.

**What the Platform does.**
- Incidents are objects with classification, severity, patient link, timeline from events, investigation, root causes, actions, regulator notifications and closure; nothing is done by email.
- Wrong-patient images are handled by an M09 procedure: quarantine flag, correct-patient attribution, DICOM tags corrected only by the M09 identity-correction workflow with a second approver, and an audit trail. The images remain available for the dose record.
- The dose is recorded on the exposed patient's cumulative dose history (M10) with the incident reference, so a future clinician sees it.
- The Incident Hand may reconstruct, draft and remind; it may not close an incident or decide reportability.
- Events: `incident.reported.v1`, `incident.classified.v1`, `regulator.notification.sent.v1`, `images.quarantined.v1`, `incident.action.assigned.v1`, `incident.closed.v1`.

**Edge cases.**
- The exposed patient is pregnant. The pregnancy screening record from M07 is shown; the incident severity is raised and a radiologist and a medical physicist (an `external_partner` contracted to the Practice) are added to the investigation for dose estimation to the foetus.
- The wrong patient's scheme was billed before the error was noticed. The Coding Hand's claim is reversed automatically when the study is marked "acquired in error", and DEB is blocked from any balance for it.

**Success measure.** Reported within 30 minutes of discovery; patient disclosed to within an hour; regulator notified within the licence-condition period; corrective actions closed within 30 days; no repeat of the same root cause at any Group site in the following year.

---

## Scene 4: The peer-review learning meeting

**Situation.** The monthly peer-review learning meeting for Practice A's radiologists (and, by invitation, the Hub readers who report for the Practice). Peer review in M12 is continuous: a sample of signed reports is allocated to a second radiologist for scoring, and discrepancies from addenda, referrer feedback and clinical follow-up are added.

**What they see.** The Peer Review view in M12 and M19 for the month: cases reviewed (a 3 % sample plus all addenda and referrer-raised concerns, illustrative), scores by category (agree; minor discrepancy, unlikely to be clinically significant; significant discrepancy), the de-identified discrepancy list with the reviewer's comments, and, for each case selected for the meeting, the images, the original report, the second read and the follow-up. A separate section shows AI-related cases: reports where the radiologist rejected a findings candidate that later proved correct, and where the radiologist accepted one that was later found wrong (both fed to AIO). Reader-level statistics are visible to the CMO and to each reader for themselves; the meeting sees case-level, de-identified material.

**What they do.** Nomvula facilitates; the clinical lead presents six cases. For each, the group records a learning point and, where appropriate, a template or protocol change (for example: a chest CT template gets a mandatory "incidental adrenal nodule follow-up" field after two missed follow-up recommendations). One significant discrepancy leads to a patient recall: the radiologist who signed the original report issues an addendum in M12, the Critical Results Hand (M13) contacts the referrer and confirms acknowledgement, and the recall is tracked as an incident with disclosure to the patient. Actions are recorded with owners and dates.

**What the Platform does.**
- Sampling, allocation and reminders run at A3; scoring is by a registered radiologist (A0 for the judgement, A1 for the form).
- Template and protocol changes from the meeting are versioned in M12 and M08 with the meeting minute as the source.
- Reader statistics are computed case-mix adjusted and are shown only to those entitled; the accreditation evidence pack (Scene 5) uses the programme's existence and its outputs, not individual scores.
- Events: `peer_review.allocated.v1`, `peer_review.scored.v1`, `report.addendum.signed.v1`, `learning.action.recorded.v1`.

**Edge cases.**
- Referrer feedback through the Referrer Space ("the fracture was visible on the films") is routed to peer review as a case, and the referrer gets a reply once the review is done.

**Success measure.** Every significant discrepancy leads to a recorded learning action; addenda and recalls are completed with acknowledgement; the discrepancy rate by category is stable or improving.

---

## Scene 5: The accreditation evidence pack

**Situation.** The Practice is preparing for its accreditation surveillance visit under the standard it has chosen (a COHSASA-style or ISO-style healthcare quality standard; the Platform stores the standard's criteria as a configurable framework). The surveyor's request list arrives six weeks before the visit.

**What they see.** The Accreditation view in M19 maps each criterion of the framework to evidence sources in the Platform: policies (with review dates and staff acknowledgements), licences and QA (M10, M18), staff registrations, credentials and training (M17, M01), incidents and complaints with closure (M19), peer review (M12), dose monitoring and DRL comparisons (M10), infection-control and contrast-safety checklists (M07 and NUR's records), patient information and consent (M07), POPIA (the Information Officer register, the access log policy, breach register), business continuity (the Edge Gateway and load-shedding records from M18 and M21), and AI governance (M11 and the change-control records from Scene 6). Each criterion shows a readiness state: evidence current, evidence stale, evidence missing.

**What they do.** Nomvula works the "stale" and "missing" list. Two policies are past their review date; she assigns the owners. The contrast-safety checklist compliance at Randburg is 91 % against a 95 % target; she raises an action with the site's NUR lead. She generates the pack: the Compliance Hand assembles the documents and reports per criterion into an indexed bundle with a cover index the surveyor can navigate, and a live portal view the surveyor may be given read-only access to for the visit (M01 role: external auditor, time-boxed).

**What the Platform does.**
- Evidence is collected as a by-product of operation: a completed QA test, a signed policy acknowledgement, a closed incident all update the readiness state.
- The pack is a rendered snapshot with a lock reference; the live portal shows the current state and the snapshot date.
- Events: `accreditation.readiness.changed.v1`, `evidence_pack.generated.v1`, `audit.external.opened.v1`.

**Edge cases.**

**Success measure.** Readiness known continuously; pack generated in under an hour; no criterion without evidence at the visit.

---

## Scene 6: An AI change-control review

**Situation.** AIO proposes to move a new fracture-detection model for extremity X-rays from shadow mode to live findings-candidate overlays at Practice A's two sites (see the AIO journey for the shadow evaluation). The Practice's AI governance policy requires CMP's change-control review before any Class 2 output (findings candidate visible to a radiologist) goes live at the Practice, and the quarterly AI committee's minute.

**What they see.** The Change Request in M11 and M19: the model registry entry (intended use, modality, body part, input specification, output class, version, vendor or in-house, SAHPRA status as a medical device with the registration or exemption reference, validation report), the shadow-mode results at these sites (agreement with signed reports, sensitivity and specificity proxies with confidence intervals, the population and detector types covered, the exclusions), the monitoring plan (daily performance proxies, drift thresholds, alarm routing), the roll-back plan, the radiologist training record (each reader must complete the model's orientation in M17 before overlays appear for them), the patient-facing communication (the Patient Space explains that a computer check may be used and that a radiologist signs every report), the POPIA assessment (de-identified inference, no data leaves the country, the vendor's operator agreement), and the AI committee's provisional recommendation.

**What they do.** Nomvula reviews each item against the policy's checklist. She asks two questions in the thread: whether the shadow evaluation included the paediatric population (it excluded under-16s and the model is scoped accordingly; she confirms the routing rule in M11 excludes under-16s technically, not just by policy), and whether the DRL and repeat-rate monitoring will detect a change in radiographer behaviour after overlays go live (AIO adds a repeat-rate monitor for the sites). She approves the change for a staged rollout: Sandton first for 30 days with weekly review, then Randburg. Her approval is a typed `Confirm`, and the committee's minute is attached.

**What the Platform does.**
- A model's routing rule cannot be changed from shadow to live for a Practice without a recorded change-control approval by CMP and AIO; the runtime enforces it, not procedure.
- The change is effective-dated and reversible; roll-back is one action by AIO or CMP, and the model returns to shadow with an incident opened.
- The AI change-control record is part of the accreditation evidence (Scene 5) and the SAHPRA vigilance file (see the AIO journey).
- Events: `ai.change_request.opened.v1`, `ai.change_request.approved.v1`, `ai.model.routing.changed.v1`.

**Edge cases.**
- A vendor pushes a new model version. The registry treats a version change as a new change request; the old version keeps running until approved.

**Success measure.** No Class 2 AI output live at the Practice without a change-control record; roll-back tested before go-live; staged rollout reviewed on schedule.

---

## Moments that beat the market

- A POPIA access request is fulfilled from an immutable access log and a secure delivery, not from a week of asking colleagues who looked at what.
- Licence renewals are prepared 120 days out from live records; the compliance calendar maintains itself.
- A wrong-patient exposure is reported from the console with the dose attached, the images are quarantined not deleted, the patient is disclosed to within the hour, and the fix is pushed to every site as learning.
- Peer review is continuous, allocated by the Platform, and its outputs become template and protocol changes with a minute as the source.
- Accreditation readiness is visible every day; the pack is generated in an hour.
- AI cannot go live at a Practice without CMP's change-control approval, and roll-back is a single action.
- Break-glass, cross-tenant and Hand access are all in the same audit stream and can be explained to a patient.

## Failure modes designed out

- **Disclosure by email attachment.** Not an option on the Access Request object.
- **Licence expiry discovered by an inspector.** Countdowns, staged escalation and a scheduling block at expiry.
- **Wrong-patient images merged or deleted.** M09 quarantine and identity-correction workflow with a second approver.
- **Incidents investigated in inboxes.** One object, one timeline from events, one closure with actions.
- **Peer review without learning.** Every significant discrepancy needs a recorded action; addenda and recalls are tracked to acknowledgement.
- **Evidence assembled under pressure.** Readiness state is a by-product of operation.
- **AI going live by configuration change.** Routing changes require recorded change-control approval; the runtime refuses otherwise.
- **Individual reader scores in an accreditation pack.** The pack uses programme outputs; reader statistics stay with the entitled roles.
