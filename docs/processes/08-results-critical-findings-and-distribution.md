# 08 — Results, Critical Findings and Distribution

Module: **M13 Results & Communication** (owner).
Related: M12 Reporting (upstream signed report), M09 Image Management (PACS) (key images, sharing
links), M04 Referral & Orders (referrer identity and delivery preferences), M01 Identity & Access
(consent, patient identity for results release), M03 Patient Master Index, M14 Revenue Cycle (Billing)
(RAF/COIDA documentation), M16 Analytics & Insight (referrer analytics), M19 Quality, Risk & Compliance
(incidents, chain of custody), M21 Platform Core (notifications, integration bus), M20 Agent Runtime.

## 1. Purpose

Make sure every signed report reaches the person who must act on it, that critical and urgent findings
are communicated and acknowledged inside a defined time window with a closed loop, that patients see
their own results in a form they can understand, and that no recommended follow-up is lost. In a
country where a patient may move between a private GP, a state clinic and a casualty department in one
month, a lost report or a missed follow-up is a common way for a treatable finding to become a late
diagnosis. Follow-up tracking to closure is therefore a national differentiator, not a feature.

| Today (typical SA practice) | Bonakala target |
|---|---|
| Critical result phoned by the radiologist between reads, sometimes to a switchboard; documentation in the report text only | The Critical Results Hand places the call, texts and WhatsApps, confirms acknowledgement, escalates on a timer, and records the closed loop; the radiologist speaks to the clinician when the clinician is on the line |
| Reports faxed or emailed as PDFs; the practice does not know if they were read | Referrer Space, HL7 ORU, FHIR DiagnosticReport, secure email; every open recorded; unread reports chased |
| Patients get results only from their doctor, weeks later, or not at all | Patient Space results with a plain-language layer and images, released per the practice's rules |
| Follow-up recommendations live in prose | Structured items tracked to closure; referrer and patient reminders; escalation when overdue |
| RAF and COIDA reports handled by email with no custody trail | Chain-of-custody record, hashed documents, access log |

## 2. Scope

Critical results policy and the Critical Results Hand; referrer distribution; patient results release
and the plain-language layer; notifications; amendment propagation; results for RAF, COIDA and
medico-legal matters; report access audit; unread-report chasing; follow-up recommendation tracking;
referrer analytics; KPIs; controls.

## 3. Trigger

| Trigger | Source |
|---|---|
| `report.signed.v1` | M12 |
| `report.critical_flagged.v1` (may precede signing when the radiologist flags during reading) | M12 |
| `report.addended.v1`, `report.corrected.v1` | M12 |
| Referrer opens, downloads, acknowledges, or queries a report | Referrer Space, integration receipts |
| Follow-up due date approaching or passed | Follow-up scheduler |
| Patient requests results or images | Patient Space, WhatsApp, front desk |
| RAF, COIDA, legal or regulator request for records | M19 request register |
| Unread report timer expiry | M13 scheduler |

## 4. Actors

| Actor | Role |
|---|---|
| RGT | Flags critical and urgent findings; speaks to the referrer when connected; approves plain-language templates; decides delayed release for sensitive findings; closes follow-up items where clinically appropriate |
| REF | Receives, acknowledges, acts; sets delivery preferences; provides on-call contacts; documents follow-up decisions |
| PAT | Receives results and plain-language explanation; views images; is reminded of follow-ups where the policy allows |
| FDK | Prints results for walk-ins after identity verification; captures consent for third-party sharing; handles physical media requests |
| BKG | Handles inbound calls about results; never conveys interpretation; routes to the referrer or to the radiologist call-back queue |
| PRM | Escalation point for unreachable referrers; owns the practice's release rules within Group policy |
| CMP | Owns the critical results policy, chain-of-custody procedure, audit responses, POPIA access requests |
| BIL | Uses RAF and COIDA report packages for claims (M14) |
| PAY | Receives reports for authorisation or audit only with consent and through the funder channel |
| Critical Results Hand (M20) | Runs the communication and escalation loop for flagged findings |
| Follow-up Hand (M20, shared with process 07) | Tracks recommendations to closure |
| Distribution service (M13) | Renders, routes, delivers, records receipts |

## 5. Preconditions

1. The report is signed (or a critical flag was raised during reading by a radiologist).
2. The referrer is identified on M04 with at least one verified delivery channel and, for critical results, a contact telephone number and an after-hours or on-call number, or a fallback (practice manager, hospital switchboard, ward).
3. The patient's identity, mobile number and Patient Space status are on M03; consent preferences (results in the Patient Space, WhatsApp notifications, guardian access, third-party sharing) are on M01.
4. The practice's release rules (immediate versus delayed for sensitive categories) are configured.
5. Plain-language templates are radiologist-approved and versioned for the report templates in use.
6. Telephony, WhatsApp Business, SMS and email adapters are healthy; a degraded adapter falls back to the next channel in the policy.

## 6. Happy path (routine signed report with one follow-up recommendation)

1. **Render.** On `report.signed.v1`, M13 renders the report in each required format: PDF with the practice letterhead, the radiologist's name, HPCSA number and practice number, key images embedded, a QR code to the Referrer Space view; HL7 ORU R01 for referrers and hospitals with HL7 feeds; FHIR DiagnosticReport with ImagingStudy references for FHIR-capable systems; structured JSON for the Referrer Space and Patient Space; and a plain-language layer (see 7.3) as a separate, clearly labelled object.
2. **Route to referrer.** The distribution service applies the referrer's delivery preferences in order: Referrer Space notification (in-app plus WhatsApp Business or SMS "A report is ready for [patient initials], [modality]"), HL7 ORU or FHIR push to their practice-management system where integrated, secure email with a link (no attachments by default; attachment allowed where the referrer has opted in and the mail domain is verified), fax as a last resort where the referrer has only a fax number (fax-to-digital confirmation kept), and printed copy for walk-in collection. Copies go to additional recipients named on the order (a second doctor, the hospital ward, the occupational health provider).
3. **Delivery receipts.** Each channel records a receipt: HL7 ACK, FHIR response, email delivered and link opened, WhatsApp delivered and read, fax transmission report. The report's distribution status shows per recipient: sent, delivered, opened, acknowledged.
4. **Referrer opens and acknowledges.** In the Referrer Space the referrer sees the structured report, key images, the follow-up item, measurements and trends against priors, and one-tap actions: acknowledge, query the radiologist, forward to a colleague (consent-checked), book the follow-up now (M05 slot offer), print. Opening is logged; acknowledgement is recorded with identity and time.
5. **Patient release.** The release rules decide timing: for a routine result with no sensitive category, the report and plain-language layer are released to the Patient Space immediately after signing, with a WhatsApp or SMS notification ("Your report from Bonakala Imaging is ready. Your doctor has also received it.") The Patient Space shows the plain-language layer first, the full report, the images (process 06 patient viewer), and the follow-up recommendation in plain words with a "Book it now" action where the referrer has already endorsed it or the policy allows patient self-booking.
6. **Follow-up tracking.** The Follow-up Hand creates the tracking item from the structured recommendation (for example "CT chest in 6 months for a 6 mm nodule"), sets reminders for the referrer at configurable points before the due date, and watches M04 and M05 for a matching order or booking anywhere in the network.
7. **Closure.** When the follow-up study is performed and reported, or the referrer documents a decision (not indicated, patient declined, managed elsewhere with evidence), the item closes. Items past due with no evidence escalate (see 11).
8. **Analytics.** Report-to-referrer time, open and acknowledgement times, and follow-up status feed M16 and the Referrer Space analytics.

## 7. Variants and exceptions

### 7.1 Critical results policy

| Category | Definition (examples; the practice's policy on M19 is the source of truth and is configurable) | Communication window | Who is contacted | Acknowledgement required |
|---|---|---|---|---|
| Critical | Findings that may cause death or serious harm without immediate action: tension pneumothorax, intracranial haemorrhage, acute stroke findings in a treatable window, aortic dissection or rupture, ectopic pregnancy, free intraperitoneal air, unstable spinal injury, pulmonary embolism with strain, misplaced line or tube in a dangerous position | Direct voice contact with the responsible clinician within 30 minutes of the finding (illustrative), 24 hours a day | The referring clinician; if unreachable, the on-call or covering clinician, then the ward or casualty doctor for inpatients, then the referrer's practice manager, then the patient's emergency pathway per policy | Yes, by the clinician who will act, by voice and digitally |
| Urgent | Findings needing action within hours to days: new malignancy with complications, abscess, bowel obstruction without perforation, unexpected fracture, DVT | Contact within 4 hours (illustrative) during the referrer's working hours, otherwise next morning by 09:00 with a same-day attempt where an on-call contact exists | Referring clinician or their practice | Yes, digitally at minimum; voice where the policy requires |
| Unexpected significant | Findings that are not urgent but are clinically important and were not the reason for the study: incidental mass, unexpected lymphadenopathy, aneurysm below intervention size, significant incidental cardiac or lung findings | Digital notification with a distinct "unexpected significant" flag within 24 hours; acknowledgement chased | Referring clinician | Yes, digitally |

Every category requires documentation of: who was contacted, by what channel, at what time, by whom (Hand or radiologist), what was conveyed, and the acknowledgement by name and time. The report carries a communication note with these details once the loop is closed (or "communication attempted, see log" if still open at signing, which is allowed only for urgent and unexpected significant categories; critical reports cannot be signed without an initiated loop, per M12-R-110).

### 7.2 The Critical Results Hand

| Attribute | Definition |
|---|---|
| Mandate | On a critical, urgent or unexpected significant flag, identify the responsible clinician and their contact chain, initiate contact in the order the policy defines, connect the radiologist to the clinician by voice for critical findings, confirm and record acknowledgement, escalate on timers, and close the loop with full documentation |
| Channels | Telephony (outbound call through the practice's telephony adapter with a recorded script and call recording where consented; an interactive voice flow that says a radiologist at Bonakala Imaging needs to speak to the doctor about a patient, and bridges the radiologist in), WhatsApp Business (template message, no clinical content, with a secure link), SMS (same, no clinical content), Referrer Space push, email (no clinical content), and, for hospitals, HL7 ORU with the critical flag to the ward system |
| Content rule | Messages contain the patient's initials and the study, the category, and how to reach the radiologist; the clinical content is conveyed by the radiologist on the call or in the report behind authentication. The Hand never interprets or explains a finding |
| Patients | The Hand never contacts a patient about a critical finding's meaning. Where the policy defines a patient emergency pathway (no clinician reachable and the finding is immediately life-threatening), the Hand escalates to the on-call radiologist and the practice manager, who decide and may call the patient personally; the Hand can only send the patient an instruction to contact the practice or go to an emergency department, in the radiologist-approved wording, on the radiologist's explicit instruction |
| Tools | `read_flag`, `read_referrer_contacts`, `read_oncall_roster`, `place_call`, `bridge_call_to_rgt`, `send_whatsapp_template`, `send_sms`, `send_referrer_push`, `send_hl7_critical`, `record_attempt`, `record_acknowledgement`, `escalate`, `notify_prm`, `close_loop` |
| Leash | May contact only the clinicians in the contact chain for that order and the practice's escalation list; may not send clinical content over any unauthenticated channel; may not mark a loop closed without an acknowledgement event from an identified clinician (voice confirmation recorded by the radiologist, or a digital acknowledgement); escalation timers per category are policy values it cannot change; maximum attempts per channel per hour configured; after the final escalation step it hands to PRM and RGT with the full log |
| Approval policy | Contact attempts and escalations are A3 within the policy; the voice conversation is A0 (radiologist to clinician); patient-facing emergency instructions are A1 (radiologist instructs) |
| Audit | Every attempt with channel, number or address (masked in views), time, outcome, call recording reference, escalation step; the closed-loop record attached to the report |
| Monitoring | Time to first attempt, time to acknowledgement, escalation rate, unreachable rate per referrer (feeds referrer contact hygiene), adapter failures |

Flow for a critical finding: radiologist flags → Hand reads the chain → simultaneous WhatsApp or SMS and Referrer Space push (no clinical content) plus an outbound call → clinician answers → Hand bridges the radiologist (or, if the radiologist is mid-read, offers a call-back within 5 minutes and holds the clinician's line or books an immediate call-back) → radiologist conveys the finding → clinician acknowledges by voice; the radiologist confirms on screen → digital acknowledgement is also requested via the Referrer Space → loop closed. No answer within the first window → next contact in the chain → practice manager → RGT and PRM decision on the patient emergency pathway.

### 7.3 Patient results release and the plain-language layer

| Rule | Behaviour |
|---|---|
| Immediate release | Default for results with no sensitive category; report and plain-language layer visible in the Patient Space on signing |
| Delayed release for sensitive findings | Categories configured per practice (illustrative: new malignancy, unexpected pregnancy-related findings, findings likely to cause distress) are released to the patient after the referrer has opened the report, or after a configurable period (illustrative: 3 working days) if the referrer has not, so that the patient hears it from their doctor first where possible but is never kept from their own information indefinitely. The Patient Space shows "Your report is ready and has been sent to Dr [name]. It will appear here after your doctor has seen it, or by [date]." |
| Referrer-requested hold | A referrer may request a longer hold with a reason; the practice's policy caps it and the CMP can review; the patient's POPIA right of access remains and a direct request to the practice is honoured after identity verification and, where appropriate, a radiologist conversation |
| Guardian access | For minors and patients with a recorded guardian on M01, results go to the guardian's Patient Space with the age-based rules the practice configures |
| Plain-language layer | Generated as a Class 3 output from radiologist-approved templates per report template and finding type: what was examined, what was found in plain words at a reading level suitable for a broad public, what the recommended next step is, and the sentence that the full report was written and signed by Dr [name], a registered radiologist, and that questions about what it means for the patient should go to their doctor. It never introduces a finding that is not in the signed report, never states prognosis, never gives treatment advice. It is labelled "plain-language summary, not the medical report" and shows the model provenance. Translations into the patient's chosen language use the same template set (planned per the language roadmap), with the English version always available |
| Quality gate | The plain-language layer passes an automated consistency check against the structured findings (every finding mentioned must map to a signed finding; every recommendation must map to a follow-up item); failures fall back to a template-only version with no free generation; a sample is reviewed weekly by a radiologist and reported to AIO |
| Images | Key images first, then the full study via the patient viewer; a "Share with another doctor" action creates a consented, time-bound link (process 06 §11.4) |

### 7.4 Notifications

Notifications follow the design system voice rules: short, plain, no clinical content on unauthenticated channels. Channel order per persona is configurable (WhatsApp Business, SMS, email, in-app); every notification records delivery and read status where the channel supports it; patients can change preferences in the Patient Space; the Platform respects quiet hours for non-urgent patient notifications (configurable, illustrative 20:00 to 07:00 SAST).

### 7.5 Amendments (addenda and corrections)

On `report.addended.v1` or `report.corrected.v1`, distribution re-runs to every recipient who received the original, with the amendment clearly marked (HL7 ORU with the corrected result status, FHIR DiagnosticReport status `amended` or `corrected`, PDF with a banner and the changed sections highlighted). If the patient has already opened the original, the Patient Space shows the amendment with a plain explanation and, for material corrections, a notification. Acknowledgement is requested again for corrections that change the impression or a recommendation. Where the correction is a wrong-patient report, all copies are revoked (links expire, HL7 cancellation sent) and an M19 incident and POPIA breach assessment are opened.

### 7.6 Results for RAF, COIDA and medico-legal matters

* Reports and images for Road Accident Fund claims, Compensation Fund (COIDA) injury-on-duty cases and ODMWA cases are produced as a **records package**: the signed report (all versions), the images or a secure link, the dose record where relevant, and a chain-of-custody record listing every person and system that handled the package, hashes of each document, the recipient's identity and authority (the attorney's letter of authority, the employer's claim reference, the Fund's request), the lawful basis, and the release approver.
* Requests are logged on M19; the CMP or a delegated FDK lead approves release after verifying the requester; a copy of the package with hashes is retained; every subsequent access is logged.
* Radiologist medico-legal reports (a separate, fee-bearing narrative) are handled as a report type with its own template and are not distributed to the clinical referrer unless requested.
* The Platform never sends identified clinical content to a funder without a consent or a legal basis recorded (PAY access is via the funder channel with the patient's authorisation on M06).

### 7.7 Walk-in and printed results

A patient or referrer who walks in is identified (ID document or Patient Space sign-in) and the FDK prints the report; the print is logged as a distribution event with the identity verified. Third parties (a relative, an employer) receive nothing without the patient's recorded consent.

### 7.8 Degraded channels and load-shedding

If the telephony adapter is down, the Hand falls back to the radiologist's own mobile for direct calls and records the attempt from the radiologist's confirmation; voice notes are never used for clinical content. If the Referrer Space is unreachable for a referrer (their side), secure email and SMS carry the notification; HL7 queues retry with the integration bus. Patient notifications queue and send when the channel returns.

### 7.9 Referrer cannot be identified or has left

If the referrer is unknown (self-referral where allowed, a locum who has moved on, a hospital doctor who has rotated), the distribution goes to the responsible practice or hospital department and the PRM's queue; critical findings escalate immediately to the practice manager and, where none exists, to the patient emergency pathway.

## 8. Automation level

| Step | Level | Note |
|---|---|---|
| Rendering and referrer distribution | A4 | Deterministic; delivery receipts monitored |
| Critical results contact loop | A3 | Critical Results Hand within the policy; voice conversation is human; escalation to PRM at the leash boundary |
| Patient release timing | A3 | Rules execute; the radiologist may override release timing per report; CMP monitors |
| Plain-language layer | A3 for generation with the quality gate; sample review is human | Class 3 output; templates radiologist-approved |
| Amendment propagation | A4 | Deterministic |
| Unread-report chasing | A3 | Escalation steps per policy |
| Follow-up tracking to closure | A3 | Follow-up Hand; closure requires evidence; escalation to RGT and PRM |
| RAF, COIDA, medico-legal package release | A1 | Human approval per release |
| Referrer analytics | A4 | Computed |

## 9. Unread-report chasing

| Step | Timing (illustrative, configurable) | Action |
|---|---|---|
| 1 | Report not opened 48 hours after delivery (routine) | Reminder on the referrer's preferred channel |
| 2 | Not opened after 5 working days | Second reminder plus a call from BKG or a Hand-placed call with a script that asks the practice to confirm receipt; the referrer's delivery preferences are re-verified |
| 3 | Not opened after 10 working days, or any report with an unexpected significant flag not acknowledged after 72 hours | PRM task; the radiologist is informed; where the report contains a follow-up recommendation the patient is informed (in the radiologist-approved wording) that their doctor has a report to discuss with them |
| Ongoing | Referrer with a persistently low open rate | Referrer analytics flag; the practice's referrer liaison contacts them to fix the channel |

## 10. Report access audit

Every access to a report or its images (who, role, channel, time, IP or device class, purpose where stated, break-glass flag) is logged immutably (M09 and M13 logs join on the study). The patient can see in the Patient Space who has accessed their report (referrer, radiologist, practice staff by role, funder if consented). POPIA access requests are answered from the log within the statutory period with a report generated by the Platform. Unusual patterns (staff access without a care relationship, bulk access) raise M19 alerts.

## 11. Follow-up recommendation tracking to closure

| Element | Design |
|---|---|
| Item creation | From the structured recommendation confirmed at signing (process 07 §6 step 9); carries the finding, the recommended study, the interval or date, the responsible clinician, the schedule source, and the patient's notification preference |
| Referrer reminders | Referrer Space task list plus channel reminders at configurable points (illustrative: when the due window opens, 2 weeks before due, on due, 2 weeks after due); one-tap "Order now" creates the M04 order and offers M05 slots; one-tap "Not indicated" or "Managed elsewhere" with a reason closes the item |
| Patient reminders | Where the practice's policy and the patient's consent allow, the Patient Space and WhatsApp remind the patient in plain words ("Your radiologist recommended a follow-up scan around [month]. Please discuss it with Dr [name] or book here.") The reminder never explains the finding beyond the plain-language layer already released |
| Network watch | The Follow-up Hand watches orders, bookings and performed studies across the whole network (and consented external priors) so that a follow-up done at another Bonakala site closes the item automatically |
| Escalation | Past due with no evidence: referrer chased, then the radiologist is asked whether direct patient contact is appropriate (A1 decision), then the PRM; the item remains open and visible until closed with evidence; lost-to-follow-up is a reported KPI per practice and per referrer |
| Evidence of closure | Performed study, referrer decision with reason, patient decline recorded (by the referrer or, if the patient tells the practice, by FDK with the radiologist informed), death notification, or transfer of care with a documented recipient |
| Governance | Monthly lost-to-follow-up review by CMP and the lead radiologist; categories of failure (referrer unreachable, patient unreachable, funding barrier, scheduling barrier) drive fixes (for example a funding pre-check for the follow-up study on M06 before the reminder is sent) |

## 12. Referrer distribution formats

| Format | Content | Use |
|---|---|---|
| Referrer Space | Structured report, key images, measurements and trends, follow-up items, actions, history of the patient's studies at the practice | Primary channel |
| PDF | Letterhead, radiologist identity (name, HPCSA number), practice number, report text, key images, QR code, amendment banner where applicable | Email, print, attachments to practice-management systems |
| HL7 v2 ORU R01 | Report text and structured observations, critical flag, status (final, corrected), links | Hospitals, practice-management systems with HL7 |
| FHIR R4 DiagnosticReport plus ImagingStudy and Observation resources | Structured findings, measurements, recommendations as CarePlan or ServiceRequest suggestions, media links | Modern integrations, NHI-aligned interoperability where required |
| Secure email | Notification with a link; attachment only by opted-in, verified domains | Referrers without integrations |
| Fax | Report PDF via fax-to-digital gateway with transmission confirmation | Last resort |
| Printed | Same as PDF | Walk-ins, patients without connectivity |
| WhatsApp Business | Notification template only; no clinical content | Notification |

## 13. Referrer analytics

The Referrer Space and the practice's referrer liaison view show, per referrer: referral volumes by modality, attendance rate, report turnaround by priority, open and acknowledgement times, critical result response times, follow-up completion rate, and appropriateness prompts accepted. Practice-side analytics (M16) add revenue by referrer, growth, and lapsed-referrer detection with liaison tasks. No referrer is shown another referrer's data; Group-level benchmarks are anonymised.

## 14. Data produced

| Object | Key content |
|---|---|
| `distribution` | Report version, recipient, channel, format, sent, delivered, opened, acknowledged, receipts |
| `critical_communication` | Category, chain, attempts (channel, time, outcome), bridge call reference, acknowledgement (who, when, how), escalations, closure |
| `patient_release` | Rule applied, release time, hold reason, notification, opened |
| `plain_language_summary` | Template version, model provenance, consistency check result, sample review |
| `amendment_propagation` | Original recipients, re-sent, re-acknowledged |
| `records_package` | Purpose (RAF, COIDA, ODMWA, legal, regulator), contents with hashes, requester identity and authority, approver, chain of custody, accesses |
| `report_access_log` | As described in section 10 |
| `unread_chase` | Steps taken, outcomes |
| `followup_item` (shared with M12) | Status history, reminders, evidence, escalation, closure |
| `referrer_analytics` | Aggregates per referrer |
| Events | `report.distributed.v1`, `report.opened.v1`, `report.acknowledged.v1`, `critical.communicated.v1`, `critical.escalated.v1`, `critical.closed.v1`, `patient_results.released.v1`, `followup.reminded.v1`, `followup.closed.v1`, `followup.lost.v1`, `records_package.released.v1` |

## 15. KPIs

| KPI | Definition | Target (illustrative) | Persona |
|---|---|---|---|
| Report-to-referrer time | `report.signed.v1` to first successful delivery | Under 5 minutes P95 | PRM, REF |
| Referrer open rate | Reports opened within 48 hours ÷ delivered | Above 90 % | PRM, referrer liaison |
| Acknowledgement rate | Reports acknowledged where required ÷ required | Above 95 %; 100 % for critical | CMP |
| Critical result time to acknowledgement | Flag to voice acknowledgement | Within the policy window for 98 %; every breach reviewed | RGT, CMP |
| Critical result escalation rate | Loops needing escalation beyond the referrer | Trend down; feeds referrer contact hygiene | PRM |
| Patient results availability | Signing to Patient Space release (routine) | Under 10 minutes | PAT |
| Patient results opened | Released results opened within 7 days | Above 60 %, trend up | PRM |
| Plain-language quality | Consistency check pass rate; sample review agreement | Above 99 % pass; review agreement above 95 % | AIO, RGT |
| Follow-up completion | Items closed with evidence by due date plus grace | Above 80 % within grace, trend up; lost-to-follow-up below 5 % | CMP, lead radiologist |
| Amendment propagation | Amended reports re-delivered to all original recipients | 100 % within 10 minutes | CMP |
| Records package turnaround | Request to release for RAF, COIDA, legal | Within the configured service level; 100 % with chain of custody | CMP, BIL |
| Access anomalies | Alerts raised and resolved | All resolved within 5 working days | CMP |

## 16. Controls

1. The Critical Results Hand cannot close a loop without an acknowledgement event from an identified clinician; the tool contract requires the acknowledgement reference.
2. No clinical content is sent over WhatsApp, SMS or email bodies; only notifications with authenticated links.
3. The Hand never explains a finding to a patient; the only patient-facing messages it can send are radiologist-approved instruction templates on explicit radiologist instruction.
4. Release rules are configured per practice within Group policy; per-report overrides by a radiologist are logged with reason; referrer holds are capped and reviewed.
5. The plain-language layer is Class 3: template-bound, consistency-checked against signed findings, provenance-labelled, sample-reviewed; failures fall back to template-only text.
6. Every distribution, open, acknowledgement and print is logged immutably and visible to the patient.
7. Amendments propagate to every original recipient; wrong-patient reports are revoked everywhere with incident and breach assessment.
8. Records packages require verified requester authority, an approver, hashes and a chain of custody; funder access requires recorded authorisation.
9. Follow-up items cannot be closed without evidence; overdue items escalate and remain visible; lost-to-follow-up is reported monthly.
10. Quiet hours apply to non-urgent patient notifications; critical communication ignores quiet hours for clinicians by policy.
11. Referrer contact details are re-verified on every unreachable event and annually.

## 17. Requirements

* M13-R-100 The Platform MUST render every signed report as PDF with key images, HL7 ORU R01, FHIR DiagnosticReport with ImagingStudy references, structured JSON for the Referrer Space and Patient Space, and a labelled plain-language layer.
* M13-R-101 The Platform MUST deliver reports per referrer delivery preferences across Referrer Space, HL7, FHIR, secure email, fax and print, record per-channel receipts, and show per-recipient status (sent, delivered, opened, acknowledged).
* M13-R-102 The Platform MUST implement a configurable critical results policy with at least the categories critical, urgent and unexpected significant, each with a time window, contact chain, escalation steps and acknowledgement requirement.
* M13-R-103 The Critical Results Hand MUST initiate contact via telephony, WhatsApp Business, SMS and Referrer Space within the policy, bridge the radiologist to the clinician for critical findings, record every attempt, and MUST NOT close a loop without an identified clinician's acknowledgement.
* M13-R-104 The Critical Results Hand MUST NOT convey clinical interpretation to patients; patient-facing emergency instructions MUST be radiologist-approved templates sent only on explicit radiologist instruction.
* M13-R-105 The Platform MUST support patient results release rules per practice with immediate release by default and delayed release for configured sensitive categories, capped referrer holds, and guardian access rules; the patient's right of access MUST be honoured on request.
* M13-R-106 The plain-language layer MUST be generated only from radiologist-approved templates, MUST pass an automated consistency check against the signed structured findings, MUST carry provenance and a "not the medical report" label, and MUST fall back to template-only text on check failure.
* M13-R-107 The Platform MUST propagate addenda and corrections to every original recipient with clear marking and status codes, re-request acknowledgement for material corrections, and revoke wrong-patient reports everywhere with an M19 incident.
* M13-R-108 The Platform MUST produce records packages for RAF, COIDA, ODMWA, legal and regulator requests with document hashes, verified requester authority, approver, chain of custody and access logging.
* M13-R-109 The Platform MUST log every report and image access immutably, show the patient who accessed their results, and generate POPIA access-request reports.
* M13-R-110 The Platform MUST chase unread reports on a configurable schedule with escalation to the PRM and radiologist, and re-verify referrer contact details on unreachable events.
* M13-R-111 The Follow-up Hand MUST track every structured recommendation to closure with referrer reminders, policy-gated patient reminders, network-wide detection of the follow-up study, evidence-based closure, escalation and monthly lost-to-follow-up reporting.
* M13-R-112 The Platform MUST provide referrer analytics in the Referrer Space (own data only) and practice-side referrer analytics with anonymised Group benchmarks.
* M13-R-113 The Platform MUST NOT send clinical content in WhatsApp, SMS or email bodies; notifications MUST link to authenticated surfaces.
* M13-R-114 The Platform SHOULD offer one-tap follow-up ordering and booking from the Referrer Space and, where policy allows, from the Patient Space.
* M13-R-115 The Platform SHOULD run a funding pre-check on M06 for a recommended follow-up study before sending patient reminders, so that funding barriers are surfaced early.
* M13-R-116 The Platform MAY offer translated plain-language layers per the language roadmap, with the English version always available.
