# 12 — AI Safety: The No-Slip Charter

## 1. Purpose

This charter is the safety constitution for every model and every Hand in the Bonakala Platform. It
defines the four output classes and their verification tiers, the twelve No-Slip rules, governance,
the South African regulatory mapping, release gates, the monitoring the AI operations persona (AIO)
watches, incident playbooks and the slip taxonomy. `00-conventions.md` §7 defines an **AI slip** as
any AI-generated content or decision that reaches a patient, referrer, funder, ledger, regulator or
the medical record without passing the verification tier for its class. The Platform is built so
that a Class 1 or Class 2 slip is technically impossible and a Class 3 or Class 4 slip is detected
within minutes.

What this charter governs is catalogued in `11-ai-catalogue-and-agentic-automation.md` (doc 11):
Parts A to C list the models, Part D the Hands and Part E the engineering that implements the rules
below. Per the module map in `00-conventions.md` §4, the technical requirements sit in M11 Clinical
Intelligence and M20 Agent Runtime; incident, audit and regulatory records sit in M19 Quality, Risk &
Compliance; rendering rules sit in `06-design-system-frontend.md`.

## 2. Output classes and verification tiers

An output's class is set by the most sensitive place it can reach, not by the technology that
produced it (doc 11 §2.1). The Model Registry stores a class per output field and the runtime applies
the verification tier as a property of the data, so a value cannot change class by being copied from
one screen to another.

| Class | Content | Verification tier | Automation ceiling | Slip possible by design? |
|---|---|---|---|---|
| 1 | Clinical interpretation that could reach a medical record, referrer or patient: findings, impressions, report text, critical flags, measurements adopted into a report | Hard gate: a registered radiologist's explicit accept or sign, technically enforced | A1 | No |
| 2 | Financial or legal actions: claims, codes, invoices, distributions, contract terms, authorisations | Human confirm (A1/A2), or A3 with rule-pack pass, sampling and reversibility | A3; A4 for a defined clean class | No |
| 3 | Non-interpretive patient and referrer communication: appointments, preparation, radiologist-approved plain-language templates, payment links, status messages | Templated generation with validators; free-text LLM output only inside guardrails | A3 | Detectable within minutes |
| 4 | Internal suggestions: worklist order, staffing, insights, forecasts, quality flags, triage priorities used for ordering | Monitored: provenance, audit, drift alarms | A2 to A4 | Detectable within minutes |

### 2.1 Class 1: the hard gate

Class 1 content exists in two states: **unsigned** (a candidate, draft or suggestion living only in a
radiologist's workspace or the inference store) and **signed** (part of a report a registered
radiologist signed in their own authenticated session). The only transition is the sign-off command in
M12 Reporting, which requires an authenticated RGT session with HPCSA registration verified by M01 and
MFA within the step-up window; a source (dictation span, accepted candidate, structured field) or an
explicit edit or confirmation for every drafted sentence (doc 11 §4, BCI-DRAFT-REPORT); acknowledgement
of every BCI-CONSIST warning; and an immutable record of the signature and the provenance of every
accepted AI element.

Everything downstream (M13 results delivery, referrer portal, patient plain-language layer, HL7 ORU
and FHIR DiagnosticReport export, PDF generation, coding from the report) reads only the signed state.
There is **no API path, integration, Hand tool or export that reads unsigned Class 1 content**; the
`ai-contracts` types make an unsigned report structurally different from a signed one so a downstream
function cannot accept the wrong type; Hand tools of risk class R4 (sign, send, communicate a finding)
exist in no allow-list and the registry refuses a Hand that declares one (doc 11 M20-R-102). Critical
flags follow the same rule: a model's STAT priority reorders a worklist (Class 4), but a **critical
finding** is a flag the radiologist confirms, and only that confirmation triggers the Critical Results
Hand, which never states the finding (doc 11 §6.10).

### 2.2 Class 2: financial and legal actions

Suggested codes, scrubbed claims, invoice lines, remittance postings, contract terms and distribution
proposals reach a funder, a ledger or a counterparty. A Hand may execute them at A3 only when all four
conditions hold, each checked in runtime code:

1. **Rule-pack pass**: the deterministic billing rules engine (or posting rules for finance) validates
   the action; anything the rules cannot validate becomes a human task, never an action.
2. **Leash**: the action is inside the Hand's numeric limits (per-claim value, daily value, count).
3. **Sampling**: a registered share of autonomous actions goes to a human for audit; a rising
   audit-failure rate trips the Hand to A1 automatically.
4. **Reversibility**: the action can be reversed within its defined window (claim reversal while
   unpaid, journal reversal before period lock, authorisation withdrawal), and the reversal path is
   tested in CI.

Everything else in Class 2 is A1 or A2. Distributions to shareholders are never executed by a Hand;
the Close Hand prepares the proposal and the approval workflow in
`03-organisation-and-shareholding-model.md` §5 applies.

### 2.3 Class 3: non-interpretive communication

Class 3 is what patients and referrers read without a radiologist's involvement: confirmations,
preparation instructions, safety questionnaires, quotes, payment links, queue status, "your report is
ready", follow-up reminders, plain-language summaries.

* **Templates first.** Every message type has an approved template per language; clinical and consent
  templates are certified translations approved by a radiologist and the information officer (doc 11
  §4, BCI-TRANSLATE). The LLM fills variables; it does not compose.
* **Validators before send**: template id approved and current; every variable resolved from a
  Platform field of the right type (a rand amount from the quote, a time from the appointment); no
  clinical vocabulary in any free-text slot (deny-list plus classifier); recipient consent, channel
  preference, send window and frequency caps respected.
* **Free text inside guardrails only**: conversational Hands may generate free text only for
  clarifying questions and acknowledgements, length-limited, passed through the same validator and
  logged in full. A message that would answer a question about findings, results, symptoms or
  medication is refused, replaced with the approved "your doctor will discuss your report with you"
  template, and a human task is created.
* **Plain-language summaries** are generated only from a signed report using radiologist-approved
  sentence templates, with a validator mapping every clinical statement to a signed sentence, and
  carry the standing disclaimer.

A Class 3 slip (a wrong amount, a message outside the window, a reply that strays into clinical
territory) cannot reach a ledger or a record but can reach a person; detection is by the validators
before send and the audit classifier after send (§7), with response times in §9.

### 2.4 Class 4: internal suggestions

Worklist order, protocol suggestions, QC flags, dose outliers, forecasts, staffing demand, propensity
scores and insight answers are consumed by staff and other Hands. They carry provenance, render in the
annotated style, are always overridable and are monitored for drift, bias and override rate. A Class 4
slip is a suggestion acted on without visible provenance, or a score that drifted without an alarm.

## 3. The twelve No-Slip rules

1. **No autonomous diagnosis.** No model or Hand produces a diagnosis or labels an output as one.
   Imaging outputs are findings candidates, triage priorities, measurements and quality flags;
   language outputs are drafts and suggestions. Clinical interpretation is capped at A1. Enforced by
   the fixed vocabulary of the `ai-contracts` output types, the UI copy rules (rule 12) and the
   radiologist's signature on every report (§2.1).
2. **Provenance on everything.** Every AI-derived element carries model id, version, deployment,
   confidence or score and inference time, rendered in the annotated style until a human accepts it.
   Enforced by BDL components that apply the style from the provenance field, a design-system lint
   that rejects an AI value rendered without the `Provenance` component, and the registry's record of
   every human action against the inference result (doc 11 §7.3).
3. **Unsigned content never leaves.** Class 1 content leaves the Platform only in the signed state.
   Enforced by type-level separation of unsigned and signed reports, no read path for unsigned
   content outside the reporting workspace, no R4 tool in any Hand, and integration tests that attempt
   every export path with an unsigned report and expect refusal.
4. **Hallucination controls.** Language outputs are grounded in structured Platform data and cite the
   source field, document region or dictation span for every value or sentence. When the needed data
   is missing the model refuses and the step escalates; "not found" is a valid extraction result and is
   never replaced with a plausible value. Enforced by output schemas that require a source per field,
   the Drafting Hand's block on unsourced sentences, extraction validators that reject values without a
   region, and refusal-correctness scoring in the evaluation harness (doc 11 §7.5).
5. **Confidence calibration and thresholds.** Every model reports calibrated confidence; every output
   field has a registered operating point with a documented trade-off (sensitivity preferred for
   triage, precision preferred for auto-actions), set per subgroup where validation shows the need.
   Below-threshold outputs are shown as low confidence or not at all, never as confident. Enforced by
   `threshold_set` in the registry, daily calibration monitoring and change control on any threshold
   change (§4.3).
6. **Kill switches per model, Hand and site.** AIO, CMP and PRM can suspend any model version, any
   Hand, or all AI at a Site or Practice within one minute with a recorded reason. Suspension is
   automatic on licence or registration lapse, a severity 1 alarm and a Hand budget breach. Enforced by
   the `deployment` kill-switch state checked on every job and step; suspended models show "AI not
   available" rather than nothing.
7. **Shadow mode before activation.** Every model version and Hand runs in shadow per Practice for the
   registered minimum (illustrative: two weeks or 500 cases, whichever is later), producing outputs and
   proposed actions compared with what humans did, with no UI effect and no external action. Activation
   requires the shadow report to pass the gates in §6. Enforced by `deployment.mode`; the router excludes
   shadow results from worklists and Hand triggers.
8. **South African population validation.** No imaging model leaves shadow without external validation
   on SA data from multiple Sites and provinces with the subgroup analysis in doc 11 §2.3, including TB
   and HIV prevalence context and paediatric cohorts where in scope; vendor claims are no substitute.
   Enforced by the validation report being a required field for the "active" release state, reviewed
   by the AI Committee.
9. **Bias monitoring.** Performance and action rates are monitored by age band, sex, Site, scanner,
   funding type and, where consented, population group, for imaging, language and predictive models
   and for Hands (for example whether collections contact intensity or booking priority differs by
   funding type beyond what the underlying variables justify). Enforced by subgroup monitoring
   snapshots with alarms, a quarterly fairness audit signed by AIO and CMP, and the exclusion of proxy
   features (doc 11 M11-R-110).
10. **Incident reporting to AIO and, where required, SAHPRA vigilance.** Every suspected AI incident
    (a missed critical finding the model was expected to flag, a wrong-site QC failure, a hallucinated
    extraction that reached a claim, a message outside guardrails) is recorded in M19 with the §9
    taxonomy, reviewed by AIO within the class response time and, where the model is a registered
    medical device and the event meets the criteria, reported by CMP to SAHPRA under medical-device
    vigilance, with the vendor notified for vendor models. Personal-information breaches follow POPIA
    s.22 notification to the Information Regulator and the data subject. Enforced by incident pre-fill
    from alarms, a mandatory AIO review step and the Compliance Hand's regulator checklist.
11. **Human override always available and never penalised.** Every suggestion can be rejected, edited
    or ignored with one action; a Hand's proposed action can be stopped; a worklist re-sorted. Override
    rates are a signal about the model, never used in individual performance management, and this is
    written into M17 workforce policy. Enforced by Accept / Edit / Reject on every element and by the
    analytics semantic layer exposing override rates only at model and Site level outside the AIO
    console.
12. **Explicit language rules in UI copy.** Copy follows `05-brand-identity.md` §3 and these rules:
    say "flagged for the radiologist", "suggested", "draft", "candidate", "estimate"; never
    "diagnosed", "detected" without "candidate", "normal", "clear" or "AI confirms"; absence of a flag
    reads "no candidate found" or "AI not available", never "normal"; every patient-facing mention of
    AI states that a radiologist reads and signs the report. Enforced by a deny-list lint on the i18n
    catalogue in every language and review by the clinical safety officer.

## 4. Governance

### 4.1 Bodies and roles

| Body or role | Composition | Responsibilities |
|---|---|---|
| AI Committee | Chief Medical Officer (chair, EXE), clinical safety officer for AI (AIO), two practising radiologists from different Practices (RGT), information officer (CMP), head of engineering (BIO or CIO), a patient representative for Class 3 matters | Approves every model and Hand for shadow and activation; sets thresholds and leashes; reviews monitoring and incidents monthly; approves charter changes; owns the model card standard |
| Clinical safety officer for AI (AIO) | A registered clinician or medical physicist with AI governance training | Owns the BCI console, monitoring, drift response, incident triage, model cards and evaluation sign-off; can invoke any kill switch |
| Information officer (CMP) | POPIA information officer per Practice, coordinated by the Group | DPIA per AI processing activity, data-processing agreements, s.71 compliance, breach notification |
| Radiation protection officer (CMP) | Per Site | Consulted on dose and protocol models |
| Model owner (AIO) and clinical owner (RGT) | Per model | Accountable for the model card, validation, thresholds and alarm response |
| Hand exception owner | Per Hand (doc 11 Part D) | Handles escalations; reviews monthly sampled transcripts; proposes leash changes |
| Practice principals (RGT) | Per Practice | Decide which models and Hands are active in their Practice and at what automation level, within the charter |

### 4.2 Model cards

Every model version and Hand has a model card in the registry, readable from the BCI console and in
summary from the provenance chip: intended and contraindicated uses; population and modality scope;
training data description; validation results with subgroup tables; operating points; known failure
modes; SAHPRA status; monitoring plan and alarm thresholds; DPIA reference; version history; owners.
Vendor models add the vendor's instructions for use and the Group's validation addendum.

### 4.3 Change control

| Change | Approval |
|---|---|
| New model or Hand | AI Committee, after the shadow report |
| New model version (weights, container, provider model) | AIO plus clinical owner; AI Committee if any validation metric moved beyond tolerance |
| Prompt or tool-definition change | AIO after the evaluation harness passes; exception owner informed |
| Threshold or leash change | AIO plus clinical owner (Classes 1 and 4) or exception owner (Classes 2 and 3); AI Committee if autonomy widens |
| Automation level change in a Practice | Practice principals plus AIO |
| Scope change (new modality, Site, age band) | AI Committee, with validation on the new scope |
| Rollback | AIO alone, immediately, recorded afterwards |

Every change is versioned with an evaluation run, and prior versions stay deployable for rollback.

### 4.4 DPIA under POPIA

Each AI processing activity involving personal information (all of them except synthetic demo runs)
has a Data Protection Impact Assessment maintained by the information officer: purpose and lawful basis
(s.11, and the s.27 to s.32 conditions for health information as special personal information);
minimality; operators and transborder flows (s.72); retention; security (s.19); the s.71 automated
decision-making analysis (§5); risks to data subjects and mitigations. DPIAs are reviewed annually and
at every scope change.

## 5. Regulatory mapping

| Regime | What it requires | Where the charter meets it |
|---|---|---|
| SAHPRA medical-device regulation (Medicines and Related Substances Act, Medical Devices Regulations) | Software intended to analyse images for detection, triage or diagnosis is a medical device (SaMD); vendors hold establishment licences; devices are registered as the phased programme requires; adverse events are reported under vigilance; in-house clinical software needs its own pathway; classification per model to be confirmed | Doc 11 §2.4; registry status with automatic suspension on lapse (rule 6); vigilance reporting (rule 10); QMS for in-house models; demo models labelled "DEMO — not a medical device" |
| SAHPRA Radiation Control | Licensed equipment, RPO, dose management | Dose outlier and protocol models feed M10; RPO consulted on protocol automation |
| HPCSA (Health Professions Act, ethical rules, telehealth guidelines, AI guidance as issued) | Clinical responsibility stays with the registered practitioner; reports signed by a registered radiologist; teleradiology within the guidelines; no device or third party decides on the practitioner's behalf; honest patient communication | Rules 1, 3 and 11; HPCSA registration verified at sign-off (M01); Hub teleradiology follows the telehealth guidance; override never penalised |
| POPIA s.71 automated decision-making | No decision with legal or substantially similar effect based solely on automated profiling unless an exception applies with a route for representations | No Class 1 decision is automated (rule 1). Class 2 automated actions are taken in the context of a contract, every amount can be queried, a human review path exists on every statement, and propensity scores never determine whether care is provided; the DPIA records the analysis per activity |
| POPIA generally (s.19 security, s.20 and s.21 operators, s.22 breach notification, s.72 transborder flows) | Safeguards, operator agreements, notification, transborder conditions | Doc 11 §7.2; DPIA (§4.4); playbooks (§8) |
| National Health Act (confidentiality, health records) | Confidentiality and access control | De-identification by default; audit of identified routes |
| Consumer Protection Act | Plain and understandable language; fair and honest dealing; no misleading representations | Class 3 templates in plain language; money explained with arithmetic (`06-design-system-frontend.md` §5.6); no claim that AI "diagnoses"; quotes only when the tariff engine is certain |
| Council for Medical Schemes and funder contracts | Accurate claims, no upcoding, audit cooperation | Class 2 rule-pack pass and sampling; fraud and anomaly monitoring; audit packs |
| Compensation Fund (COIDA), RAF, ODMWA | Specific claim processes; certified reads for occupational disease | These claim classes are A1 in year one; ILO reading is manual (doc 11 §3.1) |
| NHI Act 2024 (as implemented) | Future contracting and information requirements | Registry and audit trails are exportable to a national health information system when regulations are published |

## 6. Testing and release gates

Release states: development, shadow, limited, active, suspended, retired. Moving right requires the
gates below; moving left (rollback, suspension) requires none. A failed gate cannot be waived, only
re-run after a fix, and AI Committee minutes record every release.

| Gate | Required for | Evidence |
|---|---|---|
| G1 Contract | Shadow | Output schema in `ai-contracts`; class per field; provenance populated; model card draft |
| G2 Offline evaluation | Shadow | Golden set at or above floors; subgroup deltas within tolerance; adversarial set passed (injection refused, out-of-scope refused); zero leash violations for Hands |
| G3 Security and privacy | Shadow | DPIA complete; data path approved (de-identified or identified-route agreement); no PHI in logs, verified by test |
| G4 Shadow report | Limited | Minimum period met; agreement with human outcomes within tolerance of the offline result; latency SLO met; no critical incident |
| G5 Clinical review | Limited (Class 1) | Radiologist panel review of sampled candidates and drafts; copy reviewed against rule 12 |
| G6 Regulatory | Active (imaging) | SAHPRA status recorded and acceptable for the intended use; vendor licence current; in-house pathway milestone met |
| G7 Operational readiness | Active | Thresholds set; kill switch tested in the target environment; exception owner trained; runbooks in place; cost per task within budget |
| G8 Practice acceptance | Active in a Practice | Principals approve the automation level; staff briefed; Class 3 templates for the Practice's languages certified |

CI enforces G1 to G3 on every change (doc 11 §7.5).

## 7. Monitoring dashboards for AIO

The BCI console (Clinical lens, Carbon surface) presents the following per model version, Hand,
Practice, Site and scanner, with alarms to AIO and, for severity 1, to CMP and the clinical owner.

| Dashboard | Contents | Alarm examples (thresholds registered per model) |
|---|---|---|
| Fleet status | Release state, mode, kill-switch state, licence status, last successful inference per deployment | Any suspension; licence within 30 days of expiry; failure rate above threshold |
| Performance proxies | Agreement with signed reports, override, accept and edit rates, priority concordance, extraction accuracy on sample, coding acceptance | Override rate outside its band for 3 days; agreement below floor |
| Drift | Input statistics, positive rate, calibration curve, latency versus baseline | Positive-rate shift; calibration error; a new scanner model without a validation entry |
| Fairness | All metrics and action rates by subgroup | Any subgroup delta beyond tolerance |
| Hands | Runs, success, escalations, leash utilisation, sampling audit results, budget, cost per completed task, reversals | Any leash-violation attempt (alarmed even when blocked); rising audit failure; budget at 80 % |
| Class 3 communications | Messages per template, validator rejections, free-text share, human hand-offs, complaints per 1 000 messages | Rejection spike; any clinical-vocabulary hit that reached send |
| Slips and incidents | Open incidents by class and severity, time to detect, time to respond, closure | Any Class 1 or 2 incident |
| Cost | Tokens, cache hit rate, batch share, rand per route | Cache hit drop; route above unit cost target |

Time-to-detect drift is an AIO KPI (`04-personas.md`). Every tile shows its metric definition and
query on demand, as the Insight Hand does.

## 8. Incident playbooks

All AI incidents are recorded in M19 with the §9 taxonomy. Severity 1 is any Class 1 or 2 slip, any
wrong-patient or wrong-site event involving AI, or any patient harm; severity 2 is a Class 3 slip or a
Class 4 event with clinical effect; severity 3 is everything else.

**8.1 Suspected missed critical finding the model was expected to flag.** RGT or peer review raises
the incident from the study with the inference result attached. AIO reviews within the §9 response
time: did the model produce a candidate, at what score, is a threshold or subgroup implicated. If a
pattern is suspected (same scanner, appearance or Site), the model is suspended for that scope and a
look-back query lists every affected study for radiologist re-review through M12. Clinical follow-up
of affected patients is led by the Practice's radiologists through the referrer, with the Platform
providing the list and tools; the communication is a radiologist's act. Vendor notified where
applicable; SAHPRA vigilance report by CMP if criteria are met; AI Committee review; model card
updated with the failure mode.

**8.2 Wrong extraction reached a claim, quote or ledger.** Detected by remittance mismatch, funder
rejection, patient query or sampling audit. The Claims or Remittance Hand drops to A1 for the
Practice. Every item produced by the same prompt version and model since the last known-good audit is
queried; affected items are reversed or corrected through normal reversal paths; the funder is told
where a submitted claim was wrong; patients receive corrected statements. Root cause (prompt, schema,
rule pack, reference data) is fixed, the case joins the evaluation harness, and release goes back
through the gates.

**8.3 Class 3 message outside guardrails.** Detected by the post-send classifier or a complaint. The
route switches to templates-only immediately; the conversation is handed to FDK or BKG with an apology
template. AIO and the information officer review the transcript; if clinical content about a person
was disclosed, the POPIA breach assessment starts. Validator and deny-list updated; adversarial set
extended.

**8.4 Wrong-site or wrong-body-part event after a QC override.** Detected at reporting or by the audit
of typed override reasons. Handled as a clinical incident in M19 with the override reason attached; the
QC model's performance on the case and the Site's override policy are reviewed by PRM and CMP.

**8.5 Drift alarm.** AIO confirms the alarm is not an artefact (pipeline, new scanner, tag change).
A new scanner or protocol without validation suspends the model for that scope until a scoped
validation is done. Genuine drift moves the model to shadow for the scope, radiologists are told via
the console banner, and a re-validation or retraining plan opens.

**8.6 Prompt injection or adversarial input.** Detected by the runtime refusing an out-of-allow-list
tool call, the evaluation classifier or a human noticing odd reasoning. The source document is
quarantined, the run inspected, any action reversed. The case joins the adversarial set; if it came
from a referrer channel, PRM contacts the referrer.

**8.7 Provider or infrastructure failure.** The gateway's circuit breaker moves affected routes to
shadow or to an evaluated private-model adapter. Worklists show "AI not available"; Hands pause and
their queues fall to the exception owners with an explanation banner. Recovery re-runs missed
inference by priority; no queued external action executes without a fresh leash check.

**8.8 Data breach involving an AI route.** The information officer leads under POPIA s.22; the route
is suspended; scope is determined from the gateway audit log (lawful basis and de-identification
state per call). Notification to the Information Regulator and affected data subjects within the
required time; the provider's breach obligations under the data-processing agreement are invoked.

## 9. Slip taxonomy

Response time runs from detection to a responsible human having acted (suspension, correction or
hand-off), measured in the BCI console.

| Code | Slip | Class | Primary detection | Detection target | Response time |
|---|---|---|---|---|---|
| S1.1 | Unsigned AI report text reaching a referrer, patient or record | 1 | Structurally prevented; integration tests and export-path audit verify | Not applicable | If ever observed: immediate global suspension of the route; severity 1 |
| S1.2 | AI critical flag communicated without radiologist confirmation | 1 | Prevented (Hand trigger is the RGT's act); trigger audit | Not applicable | As S1.1 |
| S1.3 | Drafted sentence without a source signed unchanged | 1 | Prevented at sign-off; source-map audit per signed report | Not applicable | As S1.1; report re-reviewed by the RGT, addendum if needed |
| S1.4 | Accepted candidate later proved wrong (a human decision, tracked for learning) | 1 | Peer review, discrepancy reporting | Continuous | AIO review within 1 working day; pattern analysis |
| S2.1 | Claim, code or posting executed outside leash or without rule-pack pass | 2 | Prevented by runtime; attempts alarmed | Real time | AIO review within 1 hour; Hand to A1 if repeated |
| S2.2 | Wrong extracted value posted within leash and rules | 2 | Sampling audit, remittance mismatch, rejection taxonomy, patient query | Daily sampling cycle | Correction and look-back within 1 working day (§8.2) |
| S2.3 | Contract term or fee schedule activated without human confirmation | 2 | Prevented (A1 only); configuration audit | Not applicable | Immediate reversal; severity 1 |
| S3.1 | Message sent with an unresolved or wrong variable | 3 | Pre-send validator; post-send audit; recipient reply | Minutes | Correction message within 1 hour in operating hours |
| S3.2 | Free-text reply containing clinical content | 3 | Post-send classifier on every message; complaint | 15 minutes | Templates-only within 15 minutes (§8.3) |
| S3.3 | Message outside consent, channel preference, frequency cap or time window | 3 | Pre-send validator; audit | Minutes | Suppress and correct within 1 hour |
| S3.4 | Plain-language statement without a matching signed sentence | 3 | Validator before publication; RGT sampling | Minutes | Withdraw from the Patient Space within 15 minutes |
| S4.1 | Suggestion acted on without visible provenance | 4 | Design-system lint; UI audit; user report | Release time | Fix in next release; incident if clinical effect |
| S4.2 | Drift beyond threshold without an alarm | 4 | Weekly independent recomputation of drift metrics | 1 week | Alarm pipeline fix within 1 week; scope review |
| S4.3 | Subgroup gap beyond tolerance in production | 4 | Fairness dashboard; quarterly audit | Daily snapshot | AIO review within 2 working days; threshold or scope change |
| S4.4 | Roster or worklist suggestion breaching a legal or credential rule | 4 | Prevented for rosters (hard rules); worklist SLA QC | Real time | Review within 1 working day |
| S4.5 | QC block overridden and later shown to be a genuine mismatch | 4 with clinical effect | Reporting; override audit | At reporting | Clinical incident (§8.4) |

Every slip, prevented or observed, is counted. The KPI "AI slips per class" (doc 11 §9) reports
observed slips; prevented attempts are reported separately as a control-health measure.

## 10. Requirements

Numbering continues from doc 11 within M11 and M20.

* M11-R-200 The Platform MUST store an output class for every AI output field and MUST apply that
  class's verification tier wherever the value is used, independent of surface.
* M11-R-201 The Platform MUST NOT provide any API, export, integration, Hand tool or rendering path
  that reads unsigned Class 1 content outside the signing radiologist's workspace and the inference
  store, and integration tests MUST verify this on every release.
* M11-R-202 Sign-off MUST require an authenticated session of a radiologist with verified HPCSA
  registration, every drafted sentence sourced or confirmed, and every consistency warning acknowledged.
* M11-R-203 Class 3 messages MUST be generated from approved templates with validated fills; free text
  MUST be limited to clarifying questions and acknowledgements that pass the clinical-vocabulary
  validator, and every free-text message MUST be logged and classified after sending.
* M11-R-204 Every model version MUST have calibrated confidence and a registered operating point per
  output field (and per subgroup where required); a threshold change MUST be a change-control event.
* M11-R-205 The Platform MUST provide kill switches per model version, Hand, Site and Practice,
  effective within one minute, and MUST suspend automatically on licence lapse, severity 1 alarm or
  budget breach.
* M11-R-206 The Platform MUST monitor every model and Hand by the subgroups in rule 9 and MUST produce
  a quarterly fairness audit.
* M11-R-207 Override rates MUST be exposed at model and Site level only; per-user override metrics MUST
  NOT exist outside the AIO console.
* M11-R-208 UI copy and templates about AI MUST pass the rule 12 language lint before release, in every
  language.
* M11-R-209 Every model version and Hand MUST have a model card in the registry, readable from the
  provenance chip.
* M11-R-210 Every release state transition MUST pass the §6 gates and MUST be recorded with evidence
  and approver.
* M11-R-211 Every AI incident MUST be recorded in M19 with its taxonomy code, reviewed by AIO within
  the §9 response time and, where criteria are met, reported to SAHPRA vigilance and, for breaches, to
  the Information Regulator.
* M11-R-212 A DPIA MUST exist for every AI processing activity involving personal information and MUST
  include the POPIA s.71 analysis.
* M20-R-200 R3 tool execution MUST require a rule-pack pass, a leash check, sampling at the registered
  rate and a tested reversal path, all enforced in the runtime.
* M20-R-201 The runtime MUST alarm on every attempted tool call outside a Hand's allow-list or leash,
  even when blocked.
* M20-R-202 A rising sampling-audit failure rate MUST automatically reduce the Hand to A1 for the
  affected Practice until AIO re-enables it.
* M20-R-203 No communication Hand MAY have a template or free-text path that can carry a finding,
  impression or result value.
* M20-R-204 After an outage, Hands MUST NOT execute queued external actions without a fresh leash and
  rule check at execution time.

## 11. Cross-references

* `00-conventions.md` §4 (module map), §6 (automation levels, A1 cap), §7 (AI slip definition).
* `11-ai-catalogue-and-agentic-automation.md`: models and Hands (Parts A to D), shared validation and
  SAHPRA expectations (§2.3, §2.4), monitoring metrics (§2.5), tool risk classes (§6.1), LLM Gateway
  and PHI handling (§7.1, §7.2), Model Registry (§7.3), evaluation harness (§7.5), requirements
  M11-R-100 to M11-R-116 and M20-R-100 to M20-R-111.
* `04-personas.md`: AIO, CMP, RGT and the exception owners per Hand.
* `05-brand-identity.md` §3 and §6; `06-design-system-frontend.md` §1, §2.3, §5.4, §5.5, §6.
* `07-platform-architecture.md` §7, §8, §10 and the security document it references as 15.
* Module documents for M12 Reporting (sign-off), M13 Results & Communication, M14 Revenue Cycle
  (reversal windows), M17 Workforce (override never penalised), M19 Quality, Risk & Compliance
  (incidents, vigilance, DPIA records) and M21 Platform Core (audit immutability, feature flags as
  kill switches).
