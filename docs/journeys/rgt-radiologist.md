# Journey: RGT — Radiologist

This journey follows the Radiologist persona (RGT) through a reading day and a month-end. Each
scene is written as: Situation, What they see, What they do, What the Platform does, Edge cases,
Success measure. Turnaround targets, reading fees and model names are illustrative and stored as
configurable reference data. Clinical interpretation is capped at automation level A1 by policy: a
registered radiologist signs every report, and every AI output here is a findings candidate, a
triage priority, a draft or a suggested code until that signature.

## Persona snapshot (from 04-personas)

| Item | Detail |
|---|---|
| Who | HPCSA-registered radiologists reporting, protocolling and performing procedures for a Practice, on site or through the Hub (teleradiology pool); Practice principals and JV partners in many cases |
| Goals | Read efficiently and safely, prioritise the sick, never miss a critical finding, sign quality reports, protocol correctly, be paid fairly for reads |
| Frustrations today | Unprioritised worklists, priors in another system, dictation overhead, phone tag for critical results, peer review as a chore, no per-radiologist analytics |
| Better than market | AI-triaged worklist; hanging protocols and priors ready; findings-candidate overlays with one-click accept or reject; drafted structured report from dictation and AI, always under the radiologist's signature; the Critical Results Hand does the calling and confirms acknowledgement; built-in peer learning; reading-fee statements auto-computed |
| Surfaces | Reading Room (diagnostic viewer and reporting), mobile review for on-call, Hub pool |
| Metrics | Turnaround time by priority, discrepancy rate, RVU-equivalent throughput |

Design lens: **Clinical** (Carbon surface, Dense L3, High W3, Signal accent). The Reading Room is a
full-bleed layout: `Viewer` (Cornerstone3D) on the left or on the diagnostic monitor,
`ReportEditor` on the right, `HangingProtocolBar` and `PriorStrip` above, the `Queue` in a
collapsible panel. Chrome luminance stays low; nothing flashes white. AI overlays are on by default
for triage priorities and off by default for mammography.

## Scene 1 - 07:30: the morning STAT list

**Situation.** Dr Sithole starts the day at Sandton, reading for Practices A and C. Overnight, the
Hub covered on-call; three studies acquired since 06:00 are STAT.

**What they see.** The worklist develops most-critical-first: three STAT rows with SLA timers already
running as thin bars (one at Beam, two-thirds through its window), then urgent inpatients, then the
chest X-ray triage queue, then routine, sorted by priority then age. Each row shows study, site,
patient (masked ID), referrer, age of the study, the AI triage priority chip in the annotated style
where a model ran (model id and version on hover), whether priors are cached, and the claim state
(unclaimed, claimed by whom). A `StatTile` strip: STAT 3, urgent 11, routine 84, my reads yesterday
62, my median turnaround 2 h 10 min.

**What they do.** Claims the STAT row nearest to breaching, reads it with the hanging protocol
already applied and the prior from last month already in the `PriorStrip`, dictates, accepts the
draft, signs. Repeats for the other two. Twelve minutes.

**What the Platform does.**
* M12 Reporting: the worklist is a projection over `study.acquired.v1`, `bci.result.v1`, prior-fetch
  events and claims; claim semantics (lock) prevent two radiologists reading the same study; a claim
  expires if idle.
* M09 Image Management: the Priors Hand (A3) located and staged relevant priors (same identity above
  the M03 threshold, same body region, configurable look-back, external archives only under a signed
  data-sharing agreement) and tagged the comparison prior per the hanging-protocol rules before the
  study reached the top of the list; DICOMweb
  progressive loading gets the first image on screen in under a second on the LAN.
* M11 Clinical Intelligence: routing rules sent each study to the registered models for its modality
  and body part; results were stored as DICOM SR and JSON with provenance; the priority reordered the
  queue.
* M13 Results & Communication: STAT sign-off triggers immediate delivery to the referrer's chosen
  channel and, if a critical category is set, the Critical Results Hand (Scene 6).
* Events: `study.claimed.v1`, `report.signed.v1`, `report.distributed.v1`.

**Edge cases.**
* A STAT study from a hospital outside the Group has no prior: the `PriorStrip` shows "external,
  request" and a share-link request can be sent with consent.
* Two radiologists claim at the same instant: the lock resolves it; the loser sees the row move.
* The SLA timer breaches: the row turns Flare, the clinical lead is notified, and the breach is
  recorded for the M16 turnaround metric with a reason.

**Success measure.** STAT turnaround within target every morning; no STAT study waits for a prior.

## Scene 2 - 08:15: the chest X-ray triage queue

**Situation.** 140 chest X-rays from four sites and a mine mobile unit arrived overnight and this
morning. Most are normal. A few are not.

**What they see.** The chest queue is ordered by the BCI chest model's triage priority: rows flagged
for possible pneumothorax, pleural effusion, consolidation or a nodule candidate at the top, each
with the priority chip (annotated, with the model version and a confidence band), then the rest by
age. Opening a flagged study shows the `FindingOverlay` as a dashed bounding region with a mono
label "pneumothorax candidate, model cxr-triage v3.2, 0.91" that can be toggled off with one key.
The chest X-ray structured template has a normal-study macro on a hotkey.

**What they do.** Reads the flagged studies first. For a true pneumothorax, accepts the finding
candidate into the report (it loses the annotated style and records `accepted_by`, `accepted_at`,
`model_version`), completes the report, marks the finding as urgent to the referrer. For a false
positive, rejects the candidate with one key and a reason from a short list; the rejection feeds
model monitoring. Then reads the unflagged studies at pace, and stays alert: unflagged does not mean
normal, and the interface never implies it.

**What the Platform does.**
* M11: the chest model is in the Model Registry with intended use, modality, output class,
  validation report and SAHPRA status; per-model daily proxies (override rate, agreement with the
  signed report) go to AIO; a rising override rate raises a drift alarm.
* M12: accept, edit, reject on every candidate (pattern 5.4); rejected candidates never appear in the
  report; the report records only what the radiologist signed.
* M12 and M16: the queue exposes the "unflagged studies read per hour" and the "flagged studies
  overridden" rates so that the Practice can see automation bias if it starts to creep in.
* M13: an urgent finding (as distinct from critical) is delivered to the referrer with a stronger
  notification and a required read receipt, without a phone call.

**Edge cases.**
* The model was not run (an unsupported view, a paediatric study outside the model's intended use):
  the row shows "no triage" rather than a neutral priority, so the absence is visible.
* The occupational batch from the mine: the ILO classification section requires Dr Sithole's ILO
  reader credential (M17); if she lacks it, the section routes to a credentialed colleague and the
  report is co-signed.
* A tuberculosis findings candidate on a mine worker: after signing, the urgent pathway to the
  occupational health doctor runs; the employer receives no clinical detail.

**Success measure.** Flagged studies read first with a measured time-to-read; override rate stable;
no reduction in detection on unflagged studies (monitored by peer review sampling).

## Scene 3 - 09:40: CT head with an AI intracranial haemorrhage flag

**Situation.** A CT head from Practice C's hospital site arrives with a high triage priority from
the intracranial haemorrhage model.

**What they see.** The row develops at the top in Flare with the chip "ICH candidate, model
ct-ich v2.4, 0.96". The hanging protocol opens brain, subdural and bone windows; the overlay draws a
dashed region on the relevant slices with a heatmap toggle. The `PriorStrip` shows a prior CT head
from 2023 at another Practice in the Group. The report template is the CT head structured template;
the critical-finding category picker is one keystroke away.

**What they do.** Reviews the whole study, not only the flagged slices; confirms a subdural
haematoma with midline shift; accepts the candidate into the findings with edits to its description;
measures the shift (the measurement is a data field, not prose); sets the critical category
("acute intracranial haemorrhage, new") and signs. The Critical Results Hand takes over reaching
Dr Botha (Scene 6); she will state the finding herself when he is connected.

**What the Platform does.**
* M11: the ICH model output is Class 2 in the AI charter: it may reorder and annotate but can never
  reach the referrer or the record without the radiologist's acceptance; the gate is technical, not
  procedural.
* M12: the critical category is a coded field; confirming it at sign-off is the radiologist's act and
  emits `report.critical_flag.confirmed.v1` with the referrer and the study; a model score can never
  emit it.
* M09: the overlay is stored as a DICOM presentation state or segmentation object with provenance;
  it is not burned into the images.
* M16: the time from image arrival to signed report for ICH-flagged studies is a tracked quality
  measure and part of the model's monitoring plan.

**Edge cases.**
* The model flags, the radiologist finds nothing: rejection with reason; the study is sampled for
  peer review; the model's false-positive rate is updated.
* The model does not flag, the radiologist finds a haemorrhage: the finding is recorded as a
  human-first finding; the miss is a monitoring event to AIO; nothing about the queue implied the
  study was normal.
* The referrer is a ward, not a named doctor: the responsible clinician is resolved from the
  hospital's on-call roster feed, or the ward landline as fallback.

**Success measure.** ICH-flagged CT heads signed within the STAT target; every critical finding
carries a coded category and a recorded acknowledgement.

## Scene 4 - 10:30: mammography double read

**Situation.** Screening mammograms, including Precious's (PAT journey, Scene 9), are on the
double-read worklist. Dr Sithole is the first reader; Dr Van Wyk in Cape Town is the second, blind.

**What they see.** The mammography hanging protocol: current CC and MLO bilateral, the priors from
another provider alongside, magnification and inversion on hotkeys, the GSDF-calibrated display
confirmed by the calibration status indicator in the chrome. AI overlays are off; the AI triage
score exists but is hidden from the first reader by policy. The report is a screening template with
a category outcome per breast.

**What they do.** Reads and records the category. Dr Van Wyk, later, reads without seeing Dr
Sithole's result. Where both agree, the result is released. Where they disagree, an arbitration
task goes to a third reader (or a consensus meeting per the Practice's screening protocol), who may
now toggle the AI overlay and score as an additional input.

**What the Platform does.**
* M12: the double-read workflow hides each reader's outcome from the other until both are signed;
  agreement releases the result; disagreement creates an arbitration task; the release rule is
  enforced by the module, not by convention.
* M11: the mammography model's outputs are stored with the study; the policy on when they are shown
  (after first read, arbitration only, or as a third reader in a defined study) is a configurable
  registry setting approved by AIO and the clinical lead.
* M13: the patient's result message comes only from the released outcome and the approved catalogue.
* M16 and M19: recall rate, cancer detection rate, reader agreement and interval metrics are
  computed per reader and per programme against reference standards stored as reference data.

**Edge cases.**
* One reader is unavailable for days: the second read is reallocated within the Hub pool to keep
  the promised turnaround.
* A diagnostic mammogram (symptomatic) arrives in the same session: it is a single read with
  ultrasound, and the overlay policy for diagnostic studies applies.
* The priors were fetched after the first read: the second reader sees them; the first reader may
  addend.

**Success measure.** Double-read completion within the programme's turnaround; reader agreement
tracked; no screening result released on a single read.

## Scene 5 - 11:20: dictation and draft acceptance

**Situation.** A routine CT abdomen and pelvis with a long list of findings.

**What they see.** Push-to-talk dictation into the `ReportEditor`. As she speaks, the structured
template fills: organ-by-organ findings, measurements as data fields, impression. A drafted
comparison paragraph from the prior study's measurements appears in the annotated style. After she
stops, the Drafting Hand (A1, the policy cap) writes into her unsigned workspace a draft
impression generated only from her dictated findings and the structured fields, annotated with a
model label and a `Provenance` chip; a suggested ICD-10 code and suggested tariff codes appear as chips in
the sidebar for BIL, annotated. Nothing in the annotated style can be signed.

**What they do.** Reads the draft impression, edits two phrases, accepts. Accepts the comparison
paragraph after checking the measurements against the images. Leaves the coding suggestions to BIL. Signs with the sign-off hotkey; the signature dialog
shows the referrer, the delivery channels and any critical or urgent category.

**What the Platform does.**
* M12: speech-to-text runs through the LLM Gateway with a radiology vocabulary; the draft impression
  is a Class 2 output generated only from the radiologist's own dictated findings and the structured
  fields, never from the images directly; the Drafting Hand writes only to the unsigned workspace of
  her session and has no tool that changes report state, creates addenda or sends anything; an
  unsourced sentence or a contradiction between findings and impression is highlighted and blocks
  sign-off until she acts; accepting removes the annotated style and records the acceptance;
  editing records the diff for monitoring.
* M12 sign-off: a signed report is immutable; changes after signing are addenda (Scene 7); the PDF
  and structured versions are generated at sign-off with the Practice's letterhead, the
  radiologist's HPCSA number and practice number.
* M14 Revenue Cycle: the Coding Hand (A3) codes from the order and the signed report; its suggested
  codes shown to the radiologist are the same suggestions BIL will see; the radiologist's signature
  is on the report, not on the claim.
* M13: delivery on sign-off to the referrer's channels and the Patient Space (with the plain-language
  layer approved in the same dialog if the Practice enables it).

**Edge cases.**
* The dictation misheard a laterality: the structured laterality field is a separate confirmation in
  the sign-off dialog for any report with a laterality; a mismatch between dictated text and the
  field blocks signing until resolved.
* The LLM Gateway is unavailable: dictation still works with the local speech engine; drafts are
  simply absent; signing is never blocked by AI availability.
* No template exists for an unusual study: free text with mandatory impression and recommendation
  fields.

**Success measure.** Time from dictation end to signature falls; draft edit rate monitored; zero
signed reports containing annotated content.

## Scene 6 - 11:45: the critical finding call

**Situation.** The subdural haematoma from Scene 3 was signed with a critical category. The referrer
is Dr Botha in casualty (REF journey, Scene 3), who is with the patient.

**What they see.** A Flare site-wide banner at the top of the Reading Room: "Critical finding:
CT head, wristband 4471, Dr Botha, not yet acknowledged, 00:02:10", with the Critical Results Hand's
live status: "Message sent 11:45. Calling Dr Botha (casualty mobile) 11:50. Answered; acknowledged
by keypress and link 11:51. Connecting." Her console shows the incoming connected call with the
study open. After the conversation, the banner turns Signal and collapses to the study's timeline.

**What they do.** Takes the connected call and tells Dr Botha the finding in her own words; the
conversation is recorded on the study as the clinical communication. Everything before and after
the conversation, the chasing, the ladder and the documentation, is the Hand's. She keeps reading.
When she is later asked by the neurosurgeon for the images, she sends a share link from the study
page.

**What the Platform does.**
* M13 Critical Results Hand (M20, automation A3): triggered by `report.critical_flag.confirmed.v1`,
  the radiologist's act, never a model score. Mandate: deliver the contact request to the
  responsible referrer through the configured escalation ladder (illustrative: templated WhatsApp,
  SMS and email at 0 min, scripted call at 5, alternate contact at 15, on-call radiologist task at
  20; 10 attempts per case), confirm acknowledgement (keypress with name, link tap, or a named
  system read receipt) and document every attempt. Leash: it never states the finding, which is
  Class 1 and is communicated by the radiologist; the script says only that a radiologist needs to
  speak to the doctor urgently, and connects the two.
* M13: the banner never auto-dismisses; only acknowledgement or a radiologist's recorded manual
  contact closes it (pattern 5.5).
* M19: critical-result acknowledgement time is a quality measure with a target; breaches are
  incidents.
* Events: `report.acknowledged.v1` with the acknowledger, the channel and the timestamp.

**Edge cases.**
* The Hand cannot verify the person answering: it does not connect the call; it asks for a call back
  through the recorded number and escalates.
* The referrer has left for the day and the patient is in a ward: the ward's responsible clinician is
  resolved from the hospital's roster feed or the ward landline; the Hand hands over and records the
  named person.
* The critical finding is on an outpatient whose GP is closed: the escalation ladder ends in a task
  for the radiologist, who may phone the patient to attend an emergency unit; the Hand never speaks
  to the patient about a finding.

**Success measure.** Acknowledgement within minutes on every critical finding; radiologist time on
critical results limited to the conversation itself, never the chase; zero critical findings closed
without a named acknowledger.

## Scene 7 - 13:00: an addendum

**Situation.** The mammography priors for Precious arrived after Dr Sithole's first read and change
nothing, but a CT from yesterday needs an addendum: the referrer phoned to say the clinical
question was different, and a small finding deserves comment.

**What they see.** The signed report is read-only. *Add addendum* opens a dated, signed addendum
block below the original, with the reason category (new clinical information, additional finding,
correction, prior comparison). A correction addendum that changes the impression triggers a
re-delivery with a notification that says "corrected" plainly, and, if the change is critical, the
Critical Results Hand.

**What they do.** Writes the addendum, signs it.

**What the Platform does.**
* M12: the original remains immutable; the addendum is versioned; the report's outward
  representation carries both; `report.addended.v1` is emitted, or `report.corrected.v1` when the
  impression changes.
* M13: re-delivery to every channel that received the original, with the addendum highlighted; the
  Patient Space shows the addendum with a plain-language note if enabled.
* M14: if the addendum changes coding, the Coding Hand re-evaluates and, where a claim was already
  submitted, raises a BIL task rather than resubmitting automatically.
* M19: correction addenda are sampled for peer review by default.

**Edge cases.**
* The addendum is on a Hub-read study by another radiologist: the original reader is notified and
  may be the one to addend; the Practice's policy decides who may addend whose report.

**Success measure.** Addenda delivered to every original recipient; corrections visible as
corrections.

## Scene 8 - 14:00: peer review

**Situation.** The Practice's peer review programme samples reads for learning, and Dr Sithole's
turn to review comes daily as a small batch.

**What they see.** Five studies from colleagues (blinded by default, configurable), each with the
signed report and images; a peer review score entry (a standard scale, used descriptively, with
categories for agreement, minor discrepancy, major discrepancy) and a free-text learning note.
Discrepancies open a private thread with the original reader and, if the score is major, a task for
the clinical lead. Her own reviewed cases appear in her Learning tab as they close, reviewer
anonymised by default.

**What they do.** Reviews five cases in twenty minutes; records one minor discrepancy with a note.

**What the Platform does.**
* M12 and M19: sampling is stratified (random, plus targeted samples: AI-overridden studies,
  corrections, critical findings, new radiologists, the Hub); the scoring scale and the follow-up
  rules are the Practice's; results feed a discrepancy rate per radiologist visible to that
  radiologist and the clinical lead only.
* M16: discrepancy rates are case-mix adjusted and never shown as a league table.
* M17 Workforce: peer review participation counts toward CPD where the Practice's programme is
  accredited; the record is available for HPCSA CPD audits.

**Edge cases.**
* A major discrepancy with patient impact: the clinical lead opens an incident (M19), the report is
  addended, and the referrer and patient are informed under the Practice's open disclosure policy.

**Success measure.** Peer review completed daily rather than at quarter-end; learning notes read;
discrepancy trends visible per radiologist.

## Scene 9 - 22:15: on call from home through the Hub

**Situation.** Dr Van Wyk is on call for the Hub, covering six Practices from home in Cape Town.
Load-shedding is scheduled in her suburb from 22:00 to 00:30.

**What they see.** The Reading Room on her home workstation with a calibrated monitor, on UPS, over
fibre with LTE failover. The Hub worklist spans tenants, each row tagged with its Practice; her
credentials for each Practice (HPCSA number, reading services agreement) are verified. STAT studies
develop at the top; the mobile review app on her phone shows the same list, for triage and for
reading plain films if the workstation is dark. A CT pulmonary angiogram from Practice B arrives
with a pulmonary embolism findings candidate. She reads it, signs with a critical flag, and the
Critical Results Hand reaches the casualty doctor in Umhlanga and connects her to him.

**What they do.** Reads STAT and urgent work through the night, uses the phone app to check the list
during a short power cut when the UPS is nearly exhausted, and hands over at 07:00 with a generated shift note.

**What the Platform does.**
* M01 Identity & Access and M02: Hub access is cross-tenant under recorded reading services
  agreements; every read is attributed to the Practice for billing and to the radiologist for the
  reading fee; MFA and device checks apply to home workstations.
* M09: images stream by DICOMweb with progressive loading; the mobile app is for review and for
  reads the Practice's policy allows on a phone (plain films for triage, never for a final
  mammography read).
* M12: the Hub worklist balances STAT load among on-call readers by claim; a study unclaimed past a
  threshold pages the next reader.
* M15 Finance & Consolidation: each signed Hub read creates an intercompany reading-fee line per the
  reading services agreement.
* M21: the on-call session records link quality; if her link fails, unclaimed studies re-route to the
  next reader and STAT studies are phoned to the site's on-site or backup radiologist.

**Edge cases.**
* Her workstation dies mid-report: the draft is checkpointed; the study claim is released after the
  idle timeout; another reader can pick it up with the draft visible as "draft by Dr Van Wyk".
* A Practice without an agreement with her sends a STAT study to the Hub: she sees a count only and
  the Hub coordinator is paged.

**Success measure.** Night STAT turnaround equal to daytime; no STAT study unclaimed past the
threshold; Hub reads billed automatically to the right Practice.

## Scene 10 - Month-end: the reading-fee statement

**Situation.** The first working day of the month. Dr Sithole is a JV partner in Practice A and reads
for Practice C and the Hub.

**What they see.** Her reading-fee statement in the Business lens: reads by Practice, by modality, by
priority, by day and night; the fee schedule applied per agreement (per-study fees, RVU-equivalent
weights, STAT and after-hours uplifts, all as reference data); addenda and peer review counted per
the agreement; the amount due from each Practice and from the Hub; VAT treatment; and a link from
every line to the signed report it came from. A separate view, as a shareholder of Practice A, shows
the Practice's month (the SHR persona's portal), which is a different thing from her reading fees
and is kept visibly separate.

**What they do.** Checks two expected lines (an after-hours uplift and a co-signed occupational
batch), queries one line with a click, approves the statement.

**What the Platform does.**
* M15: reading fees are computed from `report.signed.v1` events and the fee schedules in the reading
  services agreements (M02), and the statement is emitted as `readingfee.statement.issued.v1`; intercompany invoices between Practices and the Hub are generated from
  the same data; queries route to the Practice's PRM and the MSO's finance function with the line's
  evidence attached.
* M17: productivity views (studies per hour by modality, case-mix adjusted) are hers to see; the
  Practice sees them with her knowledge, per the workforce policy.
* M16: her turnaround by priority, discrepancy rate and throughput are presented as her own
  dashboard, benchmarked against anonymised peers.

**Edge cases.**
* A report signed on the last day but delivered after midnight: the fee follows the sign-off
  timestamp in SAST.
* A fee schedule changed mid-month: effective-dated schedules split the month.

**Success measure.** Statement accepted without manual reconciliation; every line traceable to a
signed report; disputes resolved from evidence.

## Moments that beat the market

* A worklist ordered by clinical priority, with STAT timers, claims and priors already cached, so the
  sickest patient is read first without anyone sorting.
* Findings candidates and triage priorities drawn in the annotated style with model and version,
  accepted or rejected with one key, and never able to reach a report without the radiologist.
* Dictation into a structured template with a drafted impression from the radiologist's own
  findings, and measurements stored as data that referrers can trend.
* The Critical Results Hand does the chasing: message, call, alternate contact, escalation ladder
  and a recorded acknowledgement; the radiologist does only the conversation.
* A mammography double read whose release rule is enforced by the module.
* Peer review as a daily, blinded, learning practice with case-mix adjusted, private discrepancy
  rates.
* On call from home through the Hub with cross-tenant credentials, load-shedding resilience and
  automatic intercompany reading fees.
* A month-end statement where every rand links to a signed report.

## Failure modes designed out

* AI content signed by accident: annotated content cannot be signed; acceptance is explicit and
  recorded.
* Automation bias on unflagged studies: "no triage" is shown as an absence, and detection on
  unflagged studies is monitored by stratified peer review.
* Two radiologists reading one study, or none: claim locks with idle expiry and unclaimed-study
  paging.
* Critical result on voicemail: the Hand verifies the person, records acknowledgement, escalates on
  silence.
* Laterality and patient errors: separate confirmation fields at sign-off; wristband-bound studies.
* Reports altered after signing: immutable originals, versioned addenda, re-delivery flagged as
  corrections.
* Screening results released on one read: enforced double-read release rule.
* Unfair productivity comparisons: case-mix adjustment and private dashboards.
