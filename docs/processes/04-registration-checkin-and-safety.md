# 04 — Registration, Check-in and Safety (M07 Registration & Safety, with M03 Patient Master Index)

## 1. Purpose

Make sure the right person is in front of the right modality with the right safety clearance,
consent and payment position before any image is acquired, and make the visit feel effortless.
This process spans two modules: **M03 Patient Master Index** (who the patient is, across every
Practice, without duplicates) and **M07 Registration & Safety** (the visit: pre-check-in, check-in,
identity capture, consent, safety questionnaires, queue, and the hard gate before acquisition).

"Better than the market" means: the patient does the paperwork once, on their phone, in their
language; the front desk re-keys nothing; the Collect card says exactly what to collect; safety
questions are asked in the right order at the right time and their answers travel to the
technologist; the queue is visible; and the modality cannot start an exposure on a patient whose
safety checks are incomplete, unless a clinician overrides with a recorded reason.

## 2. Trigger

* An appointment is confirmed (M05): pre-check-in opens in Patient Space or WhatsApp.
* The patient arrives at a Site (kiosk, QR on the confirmation, front desk, or hospital porter).
* A STAT or walk-in patient presents.
* A hospital ADT admission creates an inpatient encounter with a temporary or hospital identity.
* A safety-relevant answer or result changes (eGFR result arrives, pregnancy test result, MRI
  implant document received).
* A duplicate patient is suspected by the Patient Master Index.

## 3. Actors

| Persona | Role |
|---|---|
| PAT (and guardian) | Confirms identity, completes pre-check-in, consents, answers safety questions, pays |
| FDK | Verifies identity, captures documents, resolves exceptions, manages the queue |
| RAD | Reviews the safety summary, performs the final pause before exposure, requests overrides |
| NUR | Contrast and sedation pre-assessment, IV access, observations |
| RGT | Clinical decisions on safety overrides; MRI implant clearance where the MRI safety lead does not; consent for procedures |
| BKG | Handles pre-check-in exceptions remotely |
| CMP | Consent text, questionnaire content, POPIA notices, override audit; Information Officer duties |
| BIO | Kiosk and wristband printer uptime |
| SUP | Merge and unmerge support cases across Practices |
| Front Desk Hand | The M20 Hand that pre-fills, chases missing documents and answers, explains the Collect card and prepares the desk |

## 4. Preconditions

* Appointment or STAT Order exists with the procedure list, funding position (M06) and safety
  questionnaire set from the catalogue (M04).
* Consent templates, safety questionnaires and POPIA notices are configured per Practice and
  language, with versions (CMP).
* Site has kiosks, ID scanners, card readers and wristband or QR printers registered (M18), or a
  tablet fallback.
* Identity verification sources configured (§7.1) and their lawful basis recorded.
* Edge Gateway holds today's worklist and demographics for offline operation (07 §5).

## 5. Happy path (scheme member, CT with contrast, pre-check-in completed at home)

1. After booking, the Front Desk Hand sends: "Save time on Thursday: confirm your details and
   answer 6 safety questions now (about 3 minutes)." The link opens Patient Space with OTP sign-in.
2. PAT confirms name, ID number (validated, §7.1), date of birth, mobile, address, language, next
   of kin; photographs the ID or passport and the scheme card (M03 stores images and extracted
   fields with provenance); confirms scheme membership details already on file.
3. PAT reads the consent set for this visit in their language: imaging consent, contrast consent
   (what it is, common and rare reactions, what to tell us), POPIA processing notice and the
   optional choices (research opt-in, sharing images with named clinicians, receiving results in
   Patient Space, WhatsApp communication). Each is a separate, revocable choice with its own
   timestamp and version.
4. PAT answers the safety questionnaire for CT with contrast: pregnancy possibility and date of
   last menstrual period (where applicable by sex and age), allergies and previous contrast
   reactions, kidney disease or recent blood tests, diabetes and metformin, thyroid disease,
   asthma, current medication, weight. Answers that need clinical follow-up (a previous contrast
   reaction, no recent eGFR) create tasks for NUR before the day.
5. The Hand checks completeness, requests the missing eGFR from the referrer or arranges a
   point-of-care test at the Site, and updates the Collect card from M06 ("R310 co-payment; pay
   now or at the desk").
6. On the day, PAT scans the QR from the confirmation at the kiosk or shows it to FDK. Identity is
   confirmed against the stored ID photo (visual match by FDK, or optional biometric where the
   patient has consented). The Platform marks `Arrived`, prints or issues a wristband or a digital
   QR band, and shows the patient their queue position in Patient Space.
7. FDK sees the Collect card and collects the patient portion (or confirms it was paid). Nothing
   else is asked at the desk.
8. NUR calls the patient for contrast pre-assessment: verifies the questionnaire, records the
   eGFR, weight and IV access; the contrast safety status becomes `Cleared`.
9. RAD opens the study on the technologist console: the safety summary shows all items green,
   consent signed, identity verified, funding ready. The Modality Worklist entry is released to the
   scanner (M08). The final pause (identity, procedure, laterality, pregnancy, contrast) is
   confirmed on the tablet, and acquisition proceeds.

Target: desk time under 2 minutes for a pre-checked-in patient; 90 % of scheme patients complete
pre-check-in before arrival.

## 6. Variants and exceptions

### 6.1 Identity types and special cases

| Case | Handling |
|---|---|
| South African ID number | 13-digit format validated (date of birth, sex digits, citizenship digit, checksum); mismatch with stated DOB or sex is flagged, not silently corrected. Where lawful and contracted, a verification against the Department of Home Affairs identity service through an authorised channel confirms the number belongs to the person; result and basis stored. |
| Passport or foreign ID | Country, number, expiry captured; photo of the document stored; no checksum validation; foreign-patient funding path (M06 §6.9). |
| Asylum seeker or refugee permit | Permit number as identity; treated as a passport-type identity for validation. |
| Minor with guardian | Guardian identity and relationship captured; consent given by the guardian; the minor's own assent recorded where age-appropriate. Family links live in M03 and appear in Patient Space "Family". |
| Unaccompanied minor | The Platform applies the Practice's policy for age-of-consent to medical treatment under the Children's Act (a child of the configured age with sufficient maturity may consent; below it a guardian must consent, remotely by OTP-signed consent where allowed). Radiation exposures on unaccompanied minors below the threshold are blocked until guardian consent is captured or a clinician records an emergency override. Ages and rules are configurable policy with legal review, not hard-coded. |
| Newborn | Temporary identity linked to the mother's record ("Baby of [mother]", date and time of birth, sex); replaced by the registered identity when the birth is registered; both remain linked. |
| Unidentified or unconscious trauma patient | Temporary identity ("Unknown, male, approximately 30, trauma ref T-2026-0912") with the hospital MRN; imaging proceeds under emergency justification; identity reconciliation (merge to the real person) is a controlled M03 operation with audit. |
| Inpatient via ADT | Hospital MRN and visit number are identity keys; the hospital's demographics are trusted to the degree configured for that partner; conflicts with M03 create review tasks. |
| Deceased patient (medico-legal imaging) | Identity from the instructing party; record class medico-legal; no Patient Space. |
| Patient who refuses ID capture | Permitted for care; funding path may change (scheme claims need member identity); the reason is recorded. |
| Biometric (optional) | Fingerprint or face template enrolment only with explicit, separate, revocable consent (POPIA special personal information); used only for check-in identity confirmation; templates stored encrypted and never shared. |

### 6.2 Patient Master Index operations (M03)

* **Enterprise identity with consent**: each Practice holds its own patient record; a Group-level
  enterprise ID links records across Practices only when the patient has consented to sharing
  (captured in Patient Space or at the desk) or a lawful basis exists (for example continuity of
  care between two Practices treating the same episode). Without consent, the Practices see only
  their own record.
* **Duplicate detection**: deterministic match on ID or passport number, then probabilistic match
  on name, date of birth, sex, mobile and address with transliteration and spelling variants
  common in South African names. Candidates above the auto-link threshold are linked; those in the
  review band go to FDK or SUP; below the band nothing happens. Thresholds are configurable and
  the matching model is registered in M11 with monitoring.
* **Merge**: a controlled action that keeps both source records, designates a survivor, re-points
  Orders, studies, claims and consents, and records who merged and why. **Unmerge** restores the
  prior state; the Platform never destroys data on merge. Merges involving studies already
  reported notify RGT (M12) so report headers can be corrected via addendum.
* **Demographic changes** (name change, sex marker, new ID) are versioned; DICOM headers of
  existing studies are not rewritten, but the PACS (M09) maps the current identity for display.

### 6.3 Kiosk check-in without pre-check-in

The kiosk (1080×1920, 64 px targets, three-step maximum per 06 §3) offers: scan ID, confirm
appointment, sign consent, answer safety questions, pay. Each step can be handed to FDK in
supervisor mode. Kiosks run the same PWA as Patient Space with a kiosk lens and a session that
wipes on completion or timeout.

### 6.4 Walk-in and STAT

Walk-ins go through M04 (referral) and M05 (same-day slot) before or alongside registration. STAT
patients from casualty are registered against the ADT encounter; safety questions that cannot be
answered (unconscious patient) are recorded as "unable to obtain" with the responsible clinician,
and the pregnancy and contrast items follow the emergency protocol (§6.7).

### 6.5 Language, interpreters, SASL, accessibility

Language preference is stored in M03. Pre-check-in and kiosk run in all configured languages; the
consent text is the CMP-approved translation. Interpreter needs (including South African Sign
Language by video) are scheduling constraints (M05) and are shown on the day board. Accessibility:
large-text and dyslexia-friendly modes, screen-reader support, wheelchair and hoist flags, and a
"needs assistance" call from the kiosk.

### 6.6 Chaperones and dignity

Intimate examinations (transvaginal ultrasound, mammography, some fluoroscopy) offer a chaperone;
the offer, the patient's choice and the chaperone's identity are recorded. Patients may bring a
companion; companion presence in a radiation area follows M10 rules (pregnancy check for the
companion, lead apron, distance).

### 6.7 Safety questionnaires by modality and procedure

| Set | Questions (illustrative; CMP versions the content) | Clearance rule |
|---|---|---|
| Ionising radiation (X-ray, CT, fluoroscopy, mammography, nuclear medicine) | For patients of childbearing potential: possibility of pregnancy, LMP date, contraception; for all: previous studies of the same region recently (feeds M04 recent-study) | Pregnancy "possible" or LMP outside the Practice's rule window (a 10-day or 28-day rule, configurable by examination) requires RGT or REF decision: proceed with justification and dose optimisation, defer, or test. Emergency protocol for STAT. |
| MRI safety | Pacemaker, ICD or other active implant; cochlear implant; neurostimulator; aneurysm clips; stents, valves and orthopaedic implants with dates and documents; metal foreign bodies, shrapnel, metalworker history; tattoos and permanent make-up; medication patches; pregnancy; claustrophobia; weight and girth for bore limits; prior MRI without incident | Any implant answer requires the MRI safety lead to classify (MR Safe, MR Conditional with conditions, MR Unsafe) from documentation before the slot (M05 §6.10). Unsafe blocks. Conditional records the conditions on the protocol card. |
| Iodinated contrast (CT, fluoroscopy, angiography) | Previous contrast reaction and severity; allergies and asthma; kidney disease, dialysis, single kidney; eGFR value and date; diabetes and metformin; thyroid disease; multiple myeloma; current nephrotoxic drugs; weight | eGFR below the Practice's threshold or older than the allowed window (both configurable, for example an eGFR threshold in the low-30s mL/min/1.73 m² is a common decision point but the Practice sets its own) routes to RGT for a decision; metformin holding instructions follow the Practice's protocol; previous moderate or severe reaction requires RGT decision on premedication or alternative. |
| Gadolinium-based contrast (MRI) | Previous gadolinium reaction; kidney disease and eGFR; pregnancy; breastfeeding | Practice protocol by agent class; RGT decision for severe renal impairment. |
| Sedation and anaesthesia | Fasting times; airway and medical history; escort arrangements; consent by guardian for children | Sedation practitioner clears; no escort blocks discharge planning. |
| Infection control | Respiratory symptoms, suspected or known TB, recent exposure to notifiable disease, isolation status for inpatients | Positive answers trigger the Site's infection control pathway (mask, separate waiting, room cleaning time added to the slot, staff PPE) and are shown on the day board. |
| Procedures (biopsy, injection) | Anticoagulants and antiplatelets with last dose; bleeding disorders; INR where required; allergies to local anaesthetic; pregnancy | RGT clears against the procedure's protocol. |

Each answer carries who answered (patient, guardian, clinician), when, and the questionnaire
version. Answers persist to the patient record and are pre-filled at the next visit with an
explicit "still correct?" confirmation, never silently reused.

### 6.8 Consent

* Consent types: general imaging consent, contrast, sedation or anaesthesia, procedure-specific
  (with risks explained), POPIA processing notice and specific consents (research opt-in, image
  and report sharing with named recipients, enterprise-ID linking across Practices, WhatsApp
  communication, biometric enrolment, use of de-identified images for AI model improvement).
* Each consent is a versioned document with the language shown, the signature or OTP evidence, the
  signer's relationship (self, guardian, proxy), the witness where required, and the point in the
  visit where it was taken. Withdrawal is one tap in Patient Space and propagates immediately.
* Consent in emergencies: "unable to consent" with the responsible clinician recorded; a later
  retrospective consent is attached when possible.

### 6.9 Missing documents and unresolved items on the day

The Front Desk Hand prepares a per-patient "still needed" list before the day (ID photo, scheme
card, eGFR result, implant card, guardian consent, deposit). Items still missing at arrival show
on the FDK screen with the fastest resolution path (photograph now, call the referrer, point-of-care
test, guardian OTP). Nothing blocks the patient waiting; only the acquisition gate blocks (§7.4).

### 6.10 Wristbands and QR

Wristbands (or a QR shown on the patient's phone for outpatients) carry the visit id, name, DOB
and a barcode. Scanned at the modality by RAD, the band confirms identity against the worklist
entry before the final pause. Inpatients keep the hospital band; the Platform links the hospital
MRN barcode.

### 6.11 Queue management and live status

The day board (M05 §7.7) drives a patient-facing status: "Checked in", "Next", "In room",
"Done: results with the radiologist". Estimated wait is derived from running durations per room.
Patients may leave the waiting area and be called back by WhatsApp when they are next (Site
policy). Delays beyond a threshold trigger an apology message and an FDK prompt.

### 6.12 Offline and load-shedding

Kiosk, front desk and technologist consoles keep today's worklist, questionnaires and consent
templates locally (PWA and Edge Gateway). Check-ins, answers and signatures captured offline sync
when the link returns; identity verification against external sources is deferred and flagged;
the acquisition gate works entirely on local data.

## 7. Detailed design

### 7.1 Identity verification ladder

| Level | Evidence | Used for |
|---|---|---|
| L0 Asserted | Name and DOB stated | Enquiries only |
| L1 Documented | ID, passport or permit captured with a photo | Routine imaging |
| L2 Verified | L1 plus matching Home Affairs or issuer verification through a lawful, contracted channel, or scheme membership match | Scheme claims, enterprise-ID linking |
| L3 Biometric | L2 plus consented biometric confirmation at check-in | Optional; high-volume Sites |

The level achieved is recorded on the visit and feeds M06 (funders may require L2) and M14.

### 7.2 Registration data

Visit: id, appointment_id or STAT order, patient_id (or temporary identity), identity level and
evidence, guardian or proxy, language, interpreter, chaperone choice, accessibility needs,
infection control status, arrival time, check-in channel (Patient Space, WhatsApp, kiosk, desk,
ADT), wristband id, queue events, Collect card actions and payments, consents (versions and
evidence), questionnaire answers with provenance, clearance statuses per safety set (`Not
started`, `Answered`, `Needs review`, `Cleared`, `Cleared with conditions`, `Blocked`,
`Overridden`), gate decisions, override records.

Events: `visit.prechecked_in`, `visit.arrived`, `consent.captured`, `consent.withdrawn`,
`safety.answered`, `safety.cleared`, `safety.blocked`, `safety.overridden`, `identity.verified`,
`patient.duplicate_suspected`, `patient.merged`, `patient.unmerged`, `queue.updated`.

### 7.3 The Front Desk Hand (M20)

| Element | Definition |
|---|---|
| Mandate | Invite and guide pre-check-in; pre-fill forms from M03, M04 and M06; chase missing documents and answers by WhatsApp, SMS and email; obtain guardian consent remotely where policy allows; explain the Collect card and payment options in plain language; prepare the desk's "still needed" list; answer routine questions (directions, parking, preparation, what to bring); route clinical questions to NUR or RGT and complaints to PRM. |
| Tools | `visit.read/update`, `patient.read` (demographics, contact, consent status), `document.request/receive`, `questionnaire.send/read_status`, `consent.send`, `collect_card.read` (M06), `message.send`, `task.create` (FDK, NUR, BKG), `referrer.request_result` (eGFR and implant documents via M13 channels) |
| Leash | May not alter questionnaire answers or clearance statuses; may not mark identity verified; may not take consent on anyone's behalf; may not quote amounts other than the M06 Collect card; may not give clinical advice (it can state the Practice's published preparation instructions and must hand clinical questions to NUR or RGT); at most 4 outbound messages per patient per visit; hands over on distress, confusion or any request to speak to a person. |
| Automation level | A3 for pre-check-in orchestration, document chasing, Collect card explanation and desk preparation; A1 for guardian consent flows (FDK confirms the relationship before the consent link is sent). |
| Data | Demographics, appointment, procedure name, questionnaire completion status (not clinical answers, except to route a flagged item to NUR), Collect card. Never images or reports. |
| Audit | Every message and task with the model version; weekly sample review by the FDK lead; complaint linkage in M19. |

### 7.4 The acquisition gate

The gate is a deterministic rule evaluated by M07 and enforced by M08 when the Modality Worklist
entry is released and again at the technologist's final pause:

| Check | Requirement | Block or warn |
|---|---|---|
| Identity | Identity level ≥ L1 or a temporary identity with an emergency reason | Block |
| Justification | M04 justification `justified` or `justified_pending_confirmation` | Block (M04 C-04) |
| Consent | General imaging consent for this visit; contrast, sedation or procedure consent where applicable; guardian consent for minors per policy | Block |
| Pregnancy | Ionising sets answered; "possible" or out-of-window resolved by a clinician decision | Block until decision |
| MRI safety | Questionnaire complete and no item in `Needs review` or `Blocked` | Block |
| Contrast | Contrast set `Cleared` or `Cleared with conditions`; eGFR within window where required | Block until decision |
| Sedation | Sedation practitioner clearance and escort | Block |
| Funding | M06 status is not `Expired`; `Proceed at risk` acknowledged where relevant | Warn (funding never blocks emergency care; routine care follows Practice policy) |
| Infection control | Pathway acknowledged by RAD | Warn |
| Procedure specifics | Anticoagulation and INR checks for procedures | Block until RGT decision |

**Override**: a blocked gate can be overridden only by a clinician role defined by CMP (RGT for
clinical items; the sedation practitioner for sedation; never a radiographer alone for pregnancy,
MRI or contrast items unless the Practice's policy explicitly delegates a specific item), with a
typed reason, a `Confirm` dialog with typed confirmation (06 §4), and an event that notifies CMP.
Overrides appear on the study record, in the report header context for RGT, and in the M19
incident view for review. Overrides are never silent and never bulk.

### 7.5 Identity confirmation at the modality

Before the final pause RAD scans the wristband or QR, and the console displays the patient's name,
DOB, photo (if captured), the procedure, laterality and any conditions. The patient is asked to
state their name and date of birth (or the guardian does). A mismatch between the band and the
worklist stops the study from starting and creates an incident (M19).

### 7.6 Data minimisation and POPIA

* Pre-check-in collects only what the visit needs; optional fields are marked optional.
* Special personal information (health, biometric, children's data) is processed under the
  applicable POPIA provisions with the Practice as responsible party; the MSO acts as operator
  under a recorded agreement (M02-R-004).
* Retention follows the record class (07 §10); consent evidence is retained with the record.
* Patients can view and correct their demographics in Patient Space; corrections that affect
  claims are versioned.

## 8. Automation level summary

| Step | Level |
|---|---|
| Pre-check-in invitations, reminders, document chasing | A3 (Front Desk Hand) |
| Form pre-fill from prior records | A3 with explicit "still correct?" confirmation by PAT |
| ID number validation, document OCR | A2 (auto with FDK exception review) |
| External identity verification | A3 where contracted and lawful |
| Duplicate detection and auto-link | A2 above threshold; A1 in the review band |
| Merge and unmerge | A0 (FDK or SUP performs; Platform records) |
| Consent capture | A0 (the person consents; Platform records) |
| Safety questionnaire routing | A3 (answers route to NUR or RGT tasks) |
| Safety clearance decisions | A0 (clinician decides; Platform records) |
| Acquisition gate evaluation | A4 (deterministic) with A0 override |
| Collect card | A4 (computed by M06) with FDK action |
| Queue status and delay messaging | A3 |

## 9. Requirements

### 9.1 M03 Patient Master Index

* M03-R-100 The Platform MUST validate South African ID numbers for format, embedded date of
  birth, sex digits, citizenship digit and checksum, and MUST flag rather than auto-correct
  mismatches with stated demographics.
* M03-R-101 The Platform MUST support passport, permit, temporary newborn, unidentified-trauma and
  hospital-MRN identities with typed evidence and reconciliation to a permanent identity under
  audit.
* M03-R-102 External identity verification (Home Affairs or issuer services) MUST be used only
  through lawful, contracted channels with the basis recorded per verification.
* M03-R-103 Enterprise-ID linking across Practices MUST require patient consent or a recorded
  lawful basis, and Practices MUST NOT see other Practices' records without it.
* M03-R-104 Duplicate detection MUST combine deterministic and probabilistic matching with
  configurable thresholds and a human review band, and the matching model MUST be registered in
  M11.
* M03-R-105 Merge MUST preserve all source records, MUST re-point dependent objects, MUST be
  reversible by unmerge, and MUST notify RGT when reported studies are affected.
* M03-R-106 Biometric enrolment MUST be optional, MUST require separate explicit revocable
  consent, and templates MUST be encrypted and never shared outside the Practice.
* M03-R-107 Demographic changes MUST be versioned and MUST NOT rewrite stored DICOM headers.

### 9.2 M07 Registration & Safety

* M07-R-100 Pre-check-in MUST be available in Patient Space and WhatsApp in every configured
  language and MUST work on a 3G connection on a five-year-old Android phone.
* M07-R-101 Kiosk flows MUST follow 06 §3 kiosk rules and MUST wipe session data on completion or
  timeout.
* M07-R-102 Consent MUST be captured per type, versioned, with language, signer relationship,
  evidence and timestamp, and withdrawal MUST propagate immediately.
* M07-R-103 Safety questionnaires MUST be modality- and procedure-specific, versioned by CMP,
  pre-filled from prior answers only with an explicit confirmation, and every answer MUST record
  who answered and when.
* M07-R-104 The acquisition gate in §7.4 MUST be evaluated at worklist release and at the final
  pause, MUST block on the listed items, and MUST work offline from Edge Gateway data.
* M07-R-105 Gate overrides MUST be limited to CMP-defined clinician roles, MUST require a typed
  reason and typed confirmation, MUST notify CMP, and MUST be visible on the study and in M19.
* M07-R-106 A radiographer role MUST NOT override pregnancy, MRI safety or contrast blocks alone
  unless the Practice's policy explicitly delegates that specific item.
* M07-R-107 Unaccompanied-minor rules MUST be configurable policy referencing the Children's Act
  age and maturity provisions, and radiation exposures below the configured age MUST be blocked
  without guardian consent or an emergency override.
* M07-R-108 Identity confirmation at the modality MUST scan the wristband or QR and MUST stop the
  study on mismatch with an incident created.
* M07-R-109 Funding status MUST NOT block emergency care and MUST only warn for routine care
  according to Practice policy.
* M07-R-110 The Front Desk Hand MUST operate under the leash in §7.3 and MUST NOT alter answers,
  clearances, identity levels or consents.
* M07-R-111 Interpreter, SASL, chaperone, accessibility and infection-control needs MUST be
  captured before the day and shown on the day board.
* M07-R-112 Queue status MUST be visible to the patient in Patient Space with an estimated wait
  and MUST trigger a delay message beyond a configurable threshold.
* M07-R-113 Companion presence in a radiation area MUST follow M10 rules with a recorded pregnancy
  check and protection.
* M07-R-114 The Collect card MUST be computed by M06 and MUST NOT be editable by FDK beyond
  recording the collection action.
* M07-R-115 The Platform SHOULD offer point-of-care eGFR and pregnancy testing workflows at Sites
  that provide them, with results recorded against the safety set.
* M07-R-116 The Platform MAY let patients wait outside and be recalled by WhatsApp where Site
  policy allows.

## 10. KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Pre-check-in completion | Appointments with pre-check-in complete before arrival | ≥ 90 % scheme, ≥ 75 % overall |
| Desk time | Arrival to `Arrived` for pre-checked-in patients | Median ≤ 2 min |
| Check-in to room | `Arrived` to `In room` versus planned start | Median ≤ 10 min after planned start |
| Identity level | Visits at L2 or higher | ≥ 85 % scheme visits |
| Duplicate rate | New records later merged / new records created | ≤ 0.5 % |
| Consent completeness | Studies with all required consents before acquisition | 100 % |
| Safety questionnaire completeness before arrival | Applicable sets answered pre-arrival | ≥ 85 % |
| Gate blocks | Blocks at final pause per 1 000 studies | Tracked; each reviewed |
| Override rate | Overrides per 1 000 studies, by item and role | ≤ 2, reviewed monthly by CMP |
| Wrong-patient or wrong-side events | Incidents per 100 000 studies | Zero tolerance; each investigated |
| eGFR compliance | Contrast studies with a valid eGFR or documented decision | 100 % |
| Front-desk collection rate | Patient portion collected at visit | ≥ 90 % |
| Patient wait satisfaction | "I knew how long I would wait" | ≥ 85 % agree |
| Missing-document resolution | Items resolved before arrival by the Hand | ≥ 80 % |

## 11. Controls

| ID | Control | Type |
|---|---|---|
| C-01 | Deterministic acquisition gate enforced at worklist release and final pause; offline-capable | Preventive (Class 1 gate under the no-slip charter) |
| C-02 | Overrides role-limited, typed reason, typed confirmation, CMP notification, M19 review | Detective and corrective |
| C-03 | Wristband or QR scan and verbal identity confirmation before exposure; mismatch stops the study | Preventive |
| C-04 | ID number validation and external verification with recorded basis | Preventive |
| C-05 | Merge preserves sources and is reversible; RGT notified on reported studies | Corrective |
| C-06 | Consent versioning with evidence; withdrawal propagation tested in release QA | Preventive |
| C-07 | Questionnaire pre-fill requires explicit confirmation; answers carry provenance | Preventive |
| C-08 | Front Desk Hand leash: no clinical advice, no answer or clearance edits, message caps, hand-off triggers | Preventive |
| C-09 | POPIA: data minimisation on pre-check-in; special personal information handling; biometric consent separate | Preventive |
| C-10 | Guardian relationship confirmed by FDK before remote consent links are sent | Preventive |
| C-11 | Infection control flags shown on the day board; room turnaround time enforced in M05 | Preventive |
| C-12 | Monthly CMP review of gate blocks, overrides and identity exceptions with trend reporting to M19 | Detective |
