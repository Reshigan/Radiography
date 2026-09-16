# 12 — AI Safety: The No-Slip Charter

## 1. Purpose

This charter is the safety constitution for every model and every Hand in the Bonakala Platform. It
defines the four output classes, the verification tier that each class must pass, the twelve No-Slip
rules, the governance that approves and reviews AI, the South African regulatory mapping, the release
gates, the monitoring the AI operations persona (AIO) watches, the incident playbooks and the slip
taxonomy. `00-conventions.md` §7 defines an **AI slip** as any AI-generated content or decision that
reaches a patient, referrer, funder, ledger, regulator or the medical record without passing the
verification tier for its class. The Platform is built so that a Class 1 or Class 2 slip is
technically impossible and a Class 3 or Class 4 slip is detected within minutes.

The catalogue of what this charter governs is `11-ai-catalogue-and-agentic-automation.md` (doc 11):
Parts A to C list the models, Part D the Hands and Part E the engineering controls that implement the
rules below. Module ownership follows the module map in `00-conventions.md` §4: the charter's technical
requirements sit in M11 Clinical Intelligence and M20 Agent Runtime; incident, audit and regulatory
records sit in M19 Quality, Risk and Compliance; the rendering rules sit in the design system
(`06-design-system-frontend.md`).

## 2. Output classes and verification tiers

An output's class is set by the most sensitive place it can reach, not by the technology that produced
it (doc 11 §2.1). The Model Registry stores a class for every output field, and the runtime applies the
class's verification tier as a property of the data, so that a value cannot change class by being
copied from one screen to another.

| Class | Content | Verification tier | Automation ceiling | Slip possible by design? |
|---|---|---|---|---|
| 1 | Clinical interpretation content that could reach a medical record, referrer or patient: findings, impressions, report text, critical flags, measurements adopted into a report | Hard gate: a registered radiologist's explicit accept or sign; technically enforced | A1 | No |
| 2 | Financial or legal actions: claims, codes, invoices, distributions, contract terms, authorisations | Human confirm (A1/A2), or A3 with rule-pack pass, sampling and reversibility | A3, A4 for a defined clean class | No |
| 3 | Non-interpretive patient and referrer communication: appointments, preparation instructions, plain-language templates approved by radiologists, payment links, status messages | Templated generation with validators; free-text LLM output only inside guardrails | A3 | Detectable within minutes |
| 4 | Internal suggestions: worklist order, staffing, insights, forecasts, quality flags, triage priorities used for ordering | Monitored: provenance, audit and drift alarms | A2 to A4 | Detectable within minutes |

### 2.1 Class 1: the hard gate

Class 1 content exists in exactly two states: **unsigned** (a candidate, a draft, a suggestion, living
only in a radiologist's workspace or in the inference store) and **signed** (part of a report that a
registered radiologist signed in their own authenticated session). The Platform is built so that the
transition is only possible through the sign-off command in M12 Reporting, which:

1. Requires an authenticated RGT session with a current HPCSA registration verified by M01, and MFA
   within the session's step-up window.
2. Requires that every drafted sentence has a source (dictation span, accepted candidate, structured
   field) or has been edited or explicitly confirmed by the radiologist (doc 11 §4, BCI-DRAFT-REPORT).
3. Requires that every consistency warning from BCI-CONSIST has been acknowledged.
4. Writes the signed report, the signing identity and the provenance of every accepted AI element to
   an immutable record.

Everything downstream (results delivery in M13, referrer portal, patient plain-language layer, HL7
ORU and FHIR DiagnosticReport export, PDF generation, claim coding from the report) reads only from
the signed state. There is **no API path, no integration, no Hand tool and no export that reads
unsigned Class 1 content**, and the `ai-contracts` package types make an unsigned report structurally
different from a signed one so that a downstream function cannot accept the wrong type. Hand tools of
risk class R4 (sign, send, communicate a finding) do not exist in any Hand's allow-list, and the
registry refuses to save a Hand with one (M20-R-102 in doc 11).

Critical flags follow the same rule: a model's STAT priority reorders a worklist (Class 4), but a
**critical finding** is a flag the radiologist confirms, and only that confirmation triggers the
Critical Results Hand, which in turn never states the finding (doc 11 §6.10).

### 2.2 Class 2: financial and legal actions

Class 2 outputs (suggested codes, scrubbed claims, invoice lines, remittance postings, contract terms,
distribution proposals) reach a funder, a ledger or a counterparty. They may be executed by a Hand at
A3 only when all four conditions hold, and the runtime checks each in code:

1. **Rule-pack pass**: the deterministic billing rules engine (or, for finance, the posting rules)
   validates the action; a suggestion the rules cannot validate is a task for a human, never an action.
2. **Leash**: the action is inside the Hand's numeric limits (per-claim value, daily value, count).
3. **Sampling**: a registered share of autonomous actions is routed to a human for audit, and the
   audit findings feed the monitoring dashboards; a rising audit-failure rate trips the Hand into A1.
4. **Reversibility**: the action can be reversed within its defined window (claim reversal while
   unpaid, journal reversal before period lock, authorisation withdrawal), and the reversal path is
   tested in CI.

Everything else in Class 2 is A1 or A2: a human confirms each item or reviews an exception queue.
Distributions to shareholders are never executed by a Hand; the Close Hand prepares the proposal and
the approval workflow in `03-organisation-and-shareholding-model.md` §5 applies.

### 2.3 Class 3: non-interpretive communication

Class 3 content is what patients and referrers read from the Platform without a radiologist's
involvement: appointment confirmations, preparation instructions, safety questionnaires, quotes,
payment links, queue status, "your report is ready", follow-up reminders, plain-language summaries.
The rules are:

* **Templates first.** Every Class 3 message type has an approved template per language. Clinical
  and consent templates are certified translations (doc 11 §4, BCI-TRANSLATE) approved by a
  radiologist and the information officer. The LLM fills variables; it does not compose.
* **Validators.** Before sending, a validator checks: the template id is approved and current; every
  variable resolved from a Platform field of the right type (a rand amount from the quote, a time from
  the appointment); no clinical vocabulary appears in any free-text slot (a maintained deny-list plus
  a classifier); the recipient consent and channel preferences allow the message; the send window and
  frequency caps are respected.
* **Free text inside guardrails only.** The conversational Hands may generate free text only for
  clarifying questions and acknowledgements in a conversation, limited in length, run through the
  same clinical-vocabulary validator, and logged in full. A message that would answer a question
  about findings, results, symptoms or medication is refused and replaced with the approved
  "your doctor will discuss your report with you" template, and a human task is created.
* **Plain-language summaries** are generated only from a signed report using radiologist-approved
  sentence templates, with a validator that maps every clinical statement back to a signed sentence,
  and they carry the standing disclaimer.

A Class 3 slip (a wrong amount, a message sent outside the window, a free-text reply that strays into
clinical territory) cannot reach a ledger or a record, but it can reach a person. Detection is by the
validators before send and by the audit stream after send (§7), with a response time target in §9.

### 2.4 Class 4: internal suggestions

Class 4 outputs (worklist order, protocol suggestions, QC flags, dose outliers, forecasts, staffing
demand, propensity scores, insight answers) are consumed by Bonakala staff and by other Hands. They
carry provenance, are rendered in the annotated style, are always overridable, and are monitored for
drift, bias and override rate. A Class 4 slip is a suggestion that was acted on without the
provenance being visible, or a score that drifted without an alarm; it is detected by the monitoring
in §7.

## 3. The twelve No-Slip rules

Each rule states what it forbids or requires, how it is enforced, and where it is implemented.

### Rule 1: No autonomous diagnosis

No model or Hand produces a diagnosis, and no output is labelled as one. Imaging outputs are findings
candidates, triage priorities, measurements and quality flags; language outputs are drafts and
suggestions. Clinical interpretation is capped at A1 (`00-conventions.md` §6). Enforcement: the
vocabulary is fixed in `ai-contracts` output types and in the UI copy rules (rule 12); a registered
radiologist signs every report (§2.1).

### Rule 2: Provenance on everything

Every AI-derived element carries model id, version, deployment, confidence or score, and the time of
inference, and is rendered in the annotated style until a human accepts it. Enforcement: BDL
components apply the style from the provenance field automatically; the design-system lint rejects an
AI value rendered without the `Provenance` component; the Model Registry stores every human action
against the inference result (doc 11 §7.3).

### Rule 3: Unsigned content never leaves

Class 1 content leaves the Platform only in the signed state (§2.1). Enforcement: type-level
separation of unsigned and signed reports, no read path for unsigned content outside the reporting
workspace, no R4 tool in any Hand, integration tests that attempt every export path with an unsigned
report and expect refusal.

### Rule 4: Hallucination controls

Language outputs are grounded in structured Platform data and cite the source field, document region
or dictation span for every value or sentence. When the data needed to answer is missing, the model
refuses and the step escalates rather than guessing; "not found" is a valid extraction result and is
never replaced with a plausible value. Enforcement: structured output schemas require a source per
field; the Drafting Hand blocks sign-off of unsourced sentences; extraction validators reject values
without a region; the evaluation harness scores refusal correctness (doc 11 §7.5).

### Rule 5: Confidence calibration and thresholds

Every model reports calibrated confidence, and every output field has a registered operating point
with a documented trade-off (for triage, sensitivity is preferred; for auto-actions, precision is
preferred). Thresholds are set per subgroup where validation shows the need. Below-threshold outputs
are shown as "low confidence" or not shown, never as confident. Enforcement: `threshold_set` in the
Model Registry; calibration monitored daily; a threshold change is a change-control event (§4.3).

### Rule 6: Kill switches per model, Hand and site

AIO, CMP and PRM can suspend any model version, any Hand, or all AI at a Site or Practice within one
minute, with a recorded reason. Suspension is automatic on licence or registration lapse, on a
monitoring alarm of the highest severity, and on a Hand budget breach. Enforcement: `deployment`
kill-switch state checked by the router and the runtime on every job and every step; suspended
models show "AI not available" rather than nothing.

### Rule 7: Shadow mode before activation

Every model version and every Hand runs in shadow mode per Practice for the registered minimum period
(illustrative: two weeks or 500 cases, whichever is later, configurable), producing outputs and
proposed actions that are compared with what humans did, with no UI effect and no external action.
Activation requires the shadow report to meet the release gates (§6). Enforcement: `deployment.mode`;
shadow results are excluded from worklists and Hand triggers by the router.

### Rule 8: South African population validation

No imaging model leaves shadow mode without external validation on South African data from multiple
sites and provinces with the subgroup analysis in doc 11 §2.4, including TB and HIV prevalence
context and paediatric cohorts where in scope. Vendor claims are not accepted as a substitute.
Enforcement: the validation report is a required field on `model_version` for release state
"active"; the AI Committee reviews it.

### Rule 9: Bias monitoring

Performance and action rates are monitored by age band, sex, site, scanner, funding type and, where
consented, population group, for imaging, language and predictive models and for Hands (for example
whether collections contact intensity or booking priority differs by funding type beyond what the
underlying variables justify). Enforcement: monitoring snapshots per subgroup with alarms; a
quarterly fairness audit signed by AIO and CMP; predictive models exclude proxy features
(M11-R-110).

### Rule 10: Incident reporting to AIO and, where required, SAHPRA vigilance

Every suspected AI incident (a missed critical finding the model was expected to flag, a wrong-site
QC failure, a hallucinated extraction that reached a claim, a message sent outside guardrails) is
reported in M19 with the AI incident taxonomy (§9), reviewed by AIO within the response time for its
class, and, where the model is a registered medical device and the event meets the reporting
criteria, reported to SAHPRA under its medical-device vigilance requirements by CMP, with the vendor
notified for vendor models. Patient-data breaches follow POPIA s.22 notification to the Information
Regulator and the data subject. Enforcement: incident pre-fill from monitoring alarms, mandatory AIO
review step, regulator reporting checklist in the Compliance Hand.

### Rule 11: Human override always available and never penalised

Every AI suggestion can be rejected, edited or ignored by the responsible person with one action; a
Hand's proposed action can be stopped; a worklist can be re-sorted. Override rates are monitored as a
signal about the model, never used in individual performance management, and this is written into the
workforce policies in M17. Enforcement: BDL Accept / Edit / Reject on every element; the analytics
semantic layer exposes override rates only at model and site level, not per user, outside the AIO
console.

### Rule 12: Explicit language rules in UI copy

UI copy about AI follows the brand voice (`05-brand-identity.md` §3) and these rules: say "flagged
for the radiologist", "suggested", "draft", "candidate", "estimate"; never "diagnosed", "detected"
without "candidate", "normal", "clear", or "AI confirms"; absence of a flag is shown as "no candidate
found" or "AI not available", never "normal"; every patient-facing mention of AI states that a
radiologist reads and signs the report. Enforcement: the i18n message catalogue is linted against a
deny-list and reviewed by the AI Committee's clinical safety officer; certified translations carry the
same rules.

## 4. Governance

### 4.1 Bodies and roles

| Body or role | Composition | Responsibilities |
|---|---|---|
| AI Committee | Chief Medical Officer (chair, EXE), clinical safety officer for AI (AIO), two practising radiologists from different Practices (RGT), information officer (CMP), head of engineering (BIO or CIO), a patient representative for Class 3 matters | Approves every model and Hand for shadow and for activation; sets thresholds and leashes; reviews monitoring and incidents monthly; approves changes to this charter; owns the model card standard |
| Clinical safety officer for AI (AIO) | A registered clinician or medical physicist with AI governance training | Day-to-day owner of the BCI console, monitoring, drift response, incident triage, model cards, evaluation harness sign-off; can invoke any kill switch |
| Information officer (CMP) | POPIA information officer for each Practice, coordinated by the Group | DPIA per AI processing activity, data-processing agreements, s.71 compliance, breach notification |
| Radiation protection officer (CMP) | Per Site | Consulted for dose and protocol models |
| Model owner (AIO) and clinical owner (RGT) | Per model | Accountable for the model card, validation, monitoring thresholds and the response to alarms |
| Hand exception owner | Per Hand (doc 11 Part D) | Handles escalations; reviews monthly sampled transcripts; proposes leash changes |
| Practice principals (RGT) | Per Practice | Decide which models and Hands are activated in their Practice and at what automation level, within the charter |

### 4.2 Model cards

Every model version and every Hand has a model card stored in the registry and readable from the BCI
console and, in summarised form, from the provenance chip. The card contains: intended use and
contraindicated uses; population and modality scope; training data description; validation results
including subgroup tables; operating points and thresholds; known failure modes; SAHPRA status;
monitoring plan and alarm thresholds; DPIA reference; version history; the names of the owners.
Vendor models require the vendor's instructions for use and the Group's own validation addendum.

### 4.3 Change control

The following are change-control events that require a registry entry, an evaluation run and the
approval named:

| Change | Approval |
|---|---|
| New model or Hand | AI Committee, after shadow report |
| New model version (weights, container, provider model) | AIO plus clinical owner; AI Committee if any validation metric moved beyond the registered tolerance |
| Prompt or tool-definition change for a Hand or language model | AIO after the evaluation harness passes; exception owner informed |
| Threshold or leash change | AIO plus clinical owner (Class 1 and 4) or exception owner (Class 2 and 3); AI Committee if the change widens autonomy |
| Automation level change for a process in a Practice | Practice principals plus AIO |
| Scope change (new modality, new site, new age band) | AI Committee; requires validation on the new scope |
| Rollback | AIO alone, immediately, recorded afterwards |

Changes are versioned, and the registry keeps every prior version deployable for rollback.

### 4.4 DPIA under POPIA

Each AI processing activity that involves personal information (which is all of them except purely
synthetic demo runs) has a Data Protection Impact Assessment maintained by the information officer:
purpose and lawful basis (s.11 consent or legitimate interest, and s.27 to s.32 conditions for
special personal information, which health information is); minimality; operators and transborder
flows (s.72); retention; security measures (s.19); the s.71 automated decision-making analysis (§5);
the risks to data subjects and mitigations. DPIAs are reviewed annually and at every scope change.

## 5. Regulatory mapping

| Regime | What it requires of the Platform | Where the charter meets it |
|---|---|---|
| SAHPRA medical-device regulation (Medicines and Related Substances Act, Medical Devices Regulations) | Software intended to analyse images for detection, triage or diagnosis is a medical device (SaMD). Vendors must hold establishment licences; devices must be registered as the phased programme requires; adverse events are reported under medical-device vigilance. In-house software for clinical use needs its own regulatory pathway. Exact risk classification per model is to be confirmed with SAHPRA | Doc 11 §2.5; registry status with automatic suspension on lapse (rule 6); vigilance reporting (rule 10); QMS for in-house models; demo models labelled "DEMO — not a medical device" |
| SAHPRA Radiation Control | Licensed equipment, RPO, dose management | Dose outlier and protocol models feed M10; RPO consulted on protocol automation |
| HPCSA (Health Professions Act, ethical rules, guidelines on telehealth and any guidance on AI as issued) | Clinical responsibility remains with the registered practitioner; reports are signed by a registered radiologist; teleradiology practised within the guidelines; practitioners must not allow a device or a third party to make clinical decisions on their behalf; patient communication is honest | Rules 1, 3 and 11; HPCSA registration verified at sign-off (M01); Hub teleradiology follows the telehealth guidance; override never penalised |
| POPIA s.71 automated decision-making | A data subject may not be subject to a decision with legal or substantially similar effect based solely on automated processing intended to profile them, unless an exception applies and measures exist for the data subject to make representations | No Class 1 decision is automated (rule 1). Class 2 automated actions (claims, collections plans) are checked against s.71: they are taken in the context of a contract and the patient can query any amount, with a human review path on every statement and communication; propensity scores never determine whether care is provided; the DPIA records the analysis per activity |
| POPIA generally (s.19 security, s.20 to s.21 operators, s.22 breach notification, s.72 transborder flows) | Security safeguards, operator agreements, notification, transborder conditions | Doc 11 §7.2; DPIA (§4.4); incident playbooks (§8) |
| National Health Act (confidentiality, health records) | Confidentiality of health records; access controls | De-identification by default; audit of identified routes |
| Consumer Protection Act | Plain and understandable language (s.22); fair and honest dealing; no false or misleading representations; fair value | Class 3 templates in plain language; money explained with arithmetic (`06-design-system-frontend.md` §5.6); no claim that AI "diagnoses"; quotes only when the tariff engine is certain |
| Council for Medical Schemes and funder contracts | Accurate claims, no upcoding, cooperation with audits | Class 2 rule-pack pass and sampling; fraud and anomaly monitoring; audit packs |
| Compensation Fund (COIDA), RAF, ODMWA | Specific claim processes and certified reads for occupational disease | These claim classes are A1 in the first year; ILO reading is manual (doc 11 §3.1) |
| NHI Act 2024 (as implemented) | Future contracting and information requirements | Registry and audit trails are designed to be exportable to a national health information system when the regulations are published |

## 6. Testing and release gates

Release states are development, shadow, limited, active, suspended and retired. Moving right requires
the gates below; moving left (rollback, suspension) requires none.

| Gate | Required for | Evidence |
|---|---|---|
| G1 Contract | Shadow | Output schema in `ai-contracts`; output classes assigned per field; provenance fields populated; model card draft |
| G2 Offline evaluation | Shadow | Golden set run with all metrics at or above floors; subgroup deltas within tolerance; adversarial set passed (prompt injection refused, out-of-scope input refused); zero leash violations for Hands |
| G3 Security and privacy | Shadow | DPIA complete; data path approved (de-identified or under an identified-route agreement); no PHI in logs verified by test |
| G4 Shadow report | Limited | Minimum shadow period met; agreement with human outcomes at or above the offline result within tolerance; latency SLO met; no critical incident |
| G5 Clinical review | Limited (Class 1 outputs) | Radiologist panel review of a sample of candidates and drafts; UI copy reviewed against rule 12 |
| G6 Regulatory | Active (imaging models) | SAHPRA status recorded and acceptable for the intended use; vendor licence current; in-house pathway milestone met |
| G7 Operational readiness | Active | Monitoring thresholds set; kill switch tested in the target environment; exception owner trained; runbooks in place; cost per task within budget |
| G8 Practice acceptance | Active in a Practice | Practice principals approve the automation level; staff briefed; Class 3 templates for the Practice's languages certified |

Continuous integration enforces G1 to G3 on every change (doc 11 §7.5). A failed gate cannot be
waived; it can only be re-run after a fix, and the AI Committee minutes record every release.

## 7. Monitoring dashboards for AIO

The BCI console (Clinical lens, Carbon surface) presents the following, per model version, per Hand,
per Practice, Site and scanner, with alarms routed to AIO and, for severity 1, to CMP and the
clinical owner.

| Dashboard | Contents | Alarm examples (thresholds registered per model) |
|---|---|---|
| Fleet status | Every deployment with release state, mode, kill-switch state, licence status, last successful inference | Any suspension; licence within 30 days of expiry; inference failure rate above threshold |
| Performance proxies | Agreement with signed reports, override rate, accept and edit rates, priority concordance, extraction accuracy on audit sample, coding acceptance | Override rate outside its band for 3 days; agreement below floor |
| Drift | Input statistics versus baseline, positive rate versus baseline, calibration curve, latency | Positive rate shift beyond threshold; calibration error above threshold; new scanner model appearing without a validation entry |
| Fairness | All performance and action-rate metrics by subgroup | Any subgroup delta beyond tolerance |
| Hands | Runs, success, escalations, leash utilisation, sampling audit results, budget consumption, cost per completed task, reversals | Any leash violation attempt (always an alarm even when blocked); audit failure rate rising; budget at 80 % |
| Class 3 communications | Messages sent per template, validator rejections, free-text share, human hand-offs, complaints per 1 000 messages | Validator rejection spike; any clinical-vocabulary hit that reached send |
| Slips and incidents | Open incidents by class and severity, time to detect, time to respond, closure | Any Class 1 or 2 incident (severity 1) |
| Cost | Tokens, cache hit rate, batch share, rand per route | Cache hit rate drop; route above unit cost target |

Time-to-detect drift is an AIO KPI (`04-personas.md`). Dashboards show the metric definition and the
query on demand, in the same way as the Insight Hand.

## 8. Incident playbooks

All AI incidents are recorded in M19 with the taxonomy in §9. Severity 1 is any Class 1 or Class 2
slip, any wrong-patient or wrong-site event involving AI, or any patient harm; severity 2 is a Class 3
slip or a Class 4 event with clinical effect; severity 3 is everything else.

### 8.1 Suspected missed critical finding where a model was expected to flag

1. RGT or peer review raises the incident from the study; the inference result is attached
   automatically.
2. AIO reviews within the response time in §9; determines whether the model produced a candidate, its
   score and whether the threshold or a subgroup issue is implicated.
3. If a systematic pattern is suspected (same scanner, same appearance, same site), the model is
   suspended for that scope (rule 6) and a look-back query runs over the affected period; every
   affected study is listed for radiologist re-review through M12.
4. Clinical follow-up of affected patients is led by the Practice's radiologists through the
   referrer; the Platform provides the list and the communication tools, and the communication is a
   radiologist's act.
5. Vendor notified where applicable; SAHPRA vigilance report by CMP if criteria are met; AI Committee
   review; model card updated with the failure mode.

### 8.2 Hallucinated or wrong extraction reached a claim, quote or ledger

1. Detected by remittance mismatch, funder rejection, patient query or sampling audit.
2. The Claims Hand or Remittance Hand is switched to A1 for the affected Practice pending analysis.
3. Every claim or posting produced by the same prompt version and model since the last known-good
   audit is queried; affected items are reversed or corrected through the normal reversal paths; the
   funder is notified where a submitted claim was wrong; patients receive corrected statements.
4. Root cause: prompt, schema, rule pack or reference data; fix; evaluation harness extended with the
   case; re-release through the gates.

### 8.3 Class 3 message outside guardrails

1. Detected by the post-send audit classifier or a recipient complaint.
2. The conversational route is switched to templates-only immediately; the affected conversation is
   handed to a human (FDK or BKG) with an apology template.
3. The transcript is reviewed by AIO and the information officer; if clinical content about a person
   was disclosed, the POPIA breach assessment starts.
4. Validator and deny-list updated; adversarial set extended.

### 8.4 Wrong-site or wrong-body-part event with a QC override

1. Detected at reporting or by the audit of typed override reasons.
2. Treated as a clinical incident under M19 with the radiographer's override reason attached; the
   QC model's performance on the case reviewed; the override policy for the Site reviewed by PRM and
   CMP.

### 8.5 Drift alarm

1. AIO confirms the alarm is not an artefact (data pipeline, new scanner, tag change).
2. For a new scanner or protocol without validation, the model is suspended for that scope until a
   scoped validation is done.
3. For genuine performance drift, the model is moved to shadow for the scope, radiologists are told
   through the console banner, and a re-validation or retraining plan is opened.

### 8.6 Prompt injection or adversarial input

1. Detected by the runtime refusing an out-of-allow-list tool call, by the evaluation classifier, or
   by a human noticing odd Hand reasoning.
2. The source document is quarantined; the Hand run is inspected; if any action was taken it is
   reversed.
3. The case is added to the adversarial set; if the injection came from a referrer channel, the
   referrer is contacted by PRM.

### 8.7 Provider or infrastructure failure

1. The gateway's circuit breaker moves affected routes to shadow or to the private-model adapter
   where evaluated.
2. Worklists show "AI not available"; Hands pause and their queues fall to the exception owners with
   an explanation banner.
3. Recovery re-runs missed inference jobs by priority; no action is auto-executed retrospectively
   without a fresh leash check.

### 8.8 Data breach involving an AI route

1. Information officer leads under POPIA s.22; the route is suspended; scope of data determined from
   the gateway audit log (which records lawful basis and de-identification state per call).
2. Notification to the Information Regulator and affected data subjects within the required time;
   the provider's breach obligations under the data-processing agreement invoked.

## 9. Slip taxonomy

Detection method and response time per class. Response time is the time from detection to a
responsible human having acted (suspension, correction or hand-off), measured in the BCI console.

| Code | Slip | Class | Primary detection | Detection target | Response time |
|---|---|---|---|---|---|
| S1.1 | Unsigned AI report text reaching a referrer, patient or record | 1 | Structurally prevented; integration tests and export-path audit verify | Not applicable (prevented) | If ever observed: immediate global suspension of the route; severity 1 |
| S1.2 | AI critical flag communicated without radiologist confirmation | 1 | Prevented (Critical Results Hand trigger is the RGT's act); audit of Hand triggers | Not applicable | As above |
| S1.3 | Drafted sentence without a source signed unchanged | 1 | Prevented at sign-off; audit of source map per signed report | Not applicable | As above; if found, the report is re-reviewed by the RGT and an addendum issued if needed |
| S1.4 | Model candidate accepted that later proves wrong (a human decision, not a slip, but tracked) | 1 | Peer review, discrepancy reporting | Continuous | AIO review within 1 working day; pattern analysis |
| S2.1 | Claim, code or posting executed outside leash or without rule-pack pass | 2 | Prevented by runtime; leash-violation attempts alarmed | Real time | AIO review within 1 hour; Hand to A1 if repeated |
| S2.2 | Wrong value from extraction posted within leash and rules | 2 | Sampling audit, remittance mismatch, rejection taxonomy, patient query | Within the sampling cycle (daily) | Correction and look-back within 1 working day; §8.2 |
| S2.3 | Contract term or fee schedule activated from extraction without human confirmation | 2 | Prevented (A1 only); configuration audit | Not applicable | Immediate reversal; severity 1 |
| S3.1 | Message sent with an unresolved or wrong variable | 3 | Pre-send validator; post-send audit; recipient reply | Minutes | Correction message within 1 hour in operating hours |
| S3.2 | Free-text reply containing clinical content | 3 | Post-send classifier on every message; complaint | Within 15 minutes | Route to templates-only within 15 minutes; §8.3 |
| S3.3 | Message outside consent, channel preference, frequency cap or time window | 3 | Pre-send validator; audit | Minutes | Suppress and correct within 1 hour |
| S3.4 | Plain-language summary statement without a matching signed sentence | 3 | Validator before publication; RGT sampling | Minutes | Withdraw summary from the Patient Space within 15 minutes |
| S4.1 | Suggestion acted on without visible provenance | 4 | Design-system lint; UI audit; user report | Release time | Fix in next release; if clinical effect, incident |
| S4.2 | Drift beyond threshold without alarm | 4 | Weekly independent recomputation of drift metrics | 1 week | Alarm pipeline fix within 1 week; scope review |
| S4.3 | Subgroup performance gap beyond tolerance in production | 4 | Fairness dashboard; quarterly audit | Daily snapshot | AIO review within 2 working days; threshold or scope change |
| S4.4 | Worklist or staffing suggestion that breaches a legal or credential rule | 4 | Prevented for rosters (hard rules); QC on worklist SLA breaches | Real time | Review within 1 working day |
| S4.5 | QC block overridden and later shown to be a genuine mismatch | 4 with clinical effect | Reporting; override audit | At reporting | Clinical incident; §8.4 |

Every slip, prevented or observed, is counted; the KPI "AI slips per class" (doc 11 §9) reports
observed slips, and the count of prevented attempts is reported separately as a control-health
measure.

## 10. Requirements

Numbering continues from doc 11 within M11 and M20.

* M11-R-200 The Platform MUST store an output class for every AI output field and MUST apply the
  verification tier of that class wherever the value is used, independent of the surface.
* M11-R-201 The Platform MUST NOT provide any API, export, integration, Hand tool or rendering path
  that reads unsigned Class 1 content outside the signing radiologist's reporting workspace and the
  inference store, and integration tests MUST verify this on every release.
* M11-R-202 Sign-off MUST require an authenticated session of a radiologist whose HPCSA registration
  is verified, with every drafted sentence sourced or confirmed and every consistency warning
  acknowledged.
* M11-R-203 Class 3 messages MUST be generated from approved templates with validated variable fills;
  free-text generation MUST be limited to clarifying questions and acknowledgements that pass the
  clinical-vocabulary validator, and every free-text message MUST be logged and classified after
  sending.
* M11-R-204 Every model version MUST have calibrated confidence and a registered operating point per
  output field and per subgroup where required, and a threshold change MUST be a change-control event.
* M11-R-205 The Platform MUST provide kill switches per model version, per Hand, per Site and per
  Practice, effective within one minute, and MUST suspend automatically on licence lapse, severity 1
  alarm or budget breach.
* M11-R-206 The Platform MUST monitor every model and Hand by the subgroups listed in rule 9 and MUST
  produce a quarterly fairness audit.
* M11-R-207 The Platform MUST expose override rates at model and site level only, and MUST NOT
  provide per-user override metrics outside the AIO console.
* M11-R-208 UI copy and templates about AI MUST pass the rule 12 language lint before release, in
  every language.
* M11-R-209 Every model version and Hand MUST have a model card in the registry, readable from the
  provenance chip.
* M11-R-210 Every release state transition MUST pass the gates in §6 and MUST be recorded with the
  evidence and the approver.
* M11-R-211 Every AI incident MUST be recorded in M19 with the slip taxonomy code, reviewed by AIO
  within the response time in §9, and, where criteria are met, reported to SAHPRA vigilance and, for
  breaches, to the Information Regulator.
* M11-R-212 A DPIA MUST exist for every AI processing activity involving personal information and
  MUST include the POPIA s.71 analysis.
* M20-R-200 R3 tool execution MUST require a rule-pack pass, a leash check, sampling at the registered
  rate and a tested reversal path, all enforced in the runtime.
* M20-R-201 The runtime MUST alarm on every attempted tool call outside a Hand's allow-list or leash,
  even when blocked.
* M20-R-202 A rising sampling-audit failure rate for a Hand MUST automatically reduce that Hand to A1
  for the affected Practice until AIO re-enables it.
* M20-R-203 The Critical Results Hand and any communication Hand MUST NOT have a template or free-text
  path that can carry a finding, impression or result value.
* M20-R-204 After a provider or infrastructure outage, Hands MUST NOT execute queued external actions
  without a fresh leash and rule check at the time of execution.

## 11. Cross-references

* `00-conventions.md` §4 (module map), §6 (automation levels, A1 cap on clinical interpretation), §7
  (AI slip definition that this charter implements).
* `11-ai-catalogue-and-agentic-automation.md`: the models and Hands governed here (Parts A to D),
  shared validation and SAHPRA expectations (§2.4, §2.5), monitoring metrics (§2.6), tool risk
  classes (§6.1), LLM Gateway and PHI handling (§7.1, §7.2), Model Registry (§7.3), evaluation harness
  (§7.5), requirements M11-R-100 to M11-R-116 and M20-R-100 to M20-R-111.
* `04-personas.md`: AIO, CMP, RGT and the exception owners named per Hand.
* `05-brand-identity.md` §3 (honest about AI) and §6 (anti-slip design).
* `06-design-system-frontend.md` §1 principle 5, §2.3 (AI-derived status), §5.4 (provenance and
  acceptance), §5.5 (critical finding banner), §6 (mammography overlay default).
* `07-platform-architecture.md` §7, §8, §10 and the security document referenced there as 15.
* Module documents for M12 Reporting (sign-off), M13 Results & Communication, M14 Revenue Cycle
  (claims reversal windows), M17 Workforce (override never penalised), M19 Quality, Risk & Compliance
  (incidents, vigilance, DPIA records) and M21 Platform Core (audit immutability, feature flags used
  as kill switches).
