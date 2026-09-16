# 23 — Image Analysis Guide

A practical guide to the AI analysis of images on the Bonakala Platform. It is written in four parts
for four audiences. The technical specification is `22-image-analysis-specification.md`; the model
catalogue is `11-ai-catalogue-and-agentic-automation.md` (Part A); the safety rules are
`12-ai-safety-no-slip-charter.md`.

* Part 1 — For radiologists (RGT): what the analysis shows you, what it never does, how to work with it.
* Part 2 — For radiographers and sonographers (RAD): quality checks at the console.
* Part 3 — For engineers (BIO, build team): how to add, test, deploy and run a model.
* Part 4 — For AI operations and compliance (AIO, CMP): monitoring, change control, incidents, regulators.

A one-page summary for practice managers and executives is at the end.

---

## Part 1 — For radiologists

### 1.1 What the analysis is
The Platform runs a set of computer models over every study as it arrives. They produce
**findings candidates**, a **triage priority**, **quality flags**, **measurements** and
**consistency warnings**. None of it is a diagnosis and none of it reaches a report, a referrer or a
patient until you accept it and sign. The models are there to order your worklist, to point, to
measure, and to catch the slips that happen at the end of a long list.

### 1.2 What you will see
| Where | What | Style |
|---|---|---|
| Worklist | Priority chip P1–P4 with reasons ("pneumothorax candidate, right") and a thumbnail with the overlay | Dashed AI chip with model id and version |
| Viewer | Toggleable overlays per model: boxes, heatmaps, masks; a "show why" heatmap; measurement callouts | Never burned in; opacity control; hotkey to hide all |
| Findings panel | A list of candidates, each with a confidence band, laterality and location; Accept / Edit / Reject | Accepted items pre-fill the structured report fields |
| Sign-off | Consistency warnings (e.g., "report says left; image laterality marker right"; "pneumothorax candidate present, report does not mention pneumothorax") | Must be resolved or dismissed with a reason |
| Prior comparison | Change candidates: new, enlarged, resolved, with measurements vs prior | Same dashed style |

Mammography: overlays are **off** until your first read is recorded. Then you can reveal the
marks. This protects your independent read and is required by policy.

### 1.3 How to work with it
1. Read the study as you always would. The overlays are a second look, not a first look.
2. Use Accept only when you have verified the candidate on the images yourself. Use Edit to correct
   laterality, location, size or wording. Use Reject when it is wrong; a one-tap reason (artefact,
   normal variant, misregistration, not clinically relevant) takes two seconds and trains nothing
   automatically: rejections feed monitoring and periodic retraining under governance.
3. A "normal" triage never writes a normal report. You still read every study.
4. Priority P1 means "look at this next", not "this is critical". Your judgement sets the critical
   flag; the Critical Results Hand only acts on your flag.
5. If the analysis is unavailable (link down, model paused), the worklist shows "not analysed" and
   falls back to order time and STAT flags. Nothing waits for the AI.
6. Consistency warnings at sign-off are there to catch transcription and laterality errors. If you
   dismiss one, give a reason; CMP reviews dismissals monthly, not to police you but to fix the
   models and the templates.

### 1.4 What it never does
* It never signs, never sends, never drafts a finding you did not accept.
* It never shows raw results to patients or referrers.
* It never hides a study from you or removes anything from your list.
* It never scores you against the model. Discrepancy and peer review use the signed reports and
  the peer review programme, not AI agreement.

### 1.5 Known limitations (read the model card)
Each model's card in the Reading Room ("About this model") lists intended use, the population it
was validated on (including SA sites and scanner vendors), its operating point, what it is not
validated for (for example paediatric chests below a stated age, portable images from a specific
detector), and its shadow-mode agreement at your site. Read it once per model version.

### 1.6 Override, feedback and kill switch
* Override is always available and is never penalised.
* Feedback: any candidate can be flagged "teach" with a note; this goes to the AIO queue.
* If a model behaves badly (a run of obvious false positives on a new detector), you can pause it
  for your site from the findings panel ("pause model at this site"); AIO is notified and confirms.

---

## Part 2 — For radiographers and sonographers

### 2.1 Quality checks at the console
Within a few seconds of exposure the console shows one of:
* **Green: good to send.**
* **Amber: check** with a reason: rotation, clipped apex, under/over-exposure with the exposure
  index deviation, motion, missing laterality marker, wrong body part for the order, incomplete
  series (missing view), artefact.
* **Red: likely repeat** with the reason and a one-tap "Repeat with reason" that records the repeat
  and its cause (M08 repeat/reject analysis).

The check never blocks sending. You decide. If you disagree, send anyway; the disagreement is
recorded and reviewed to improve the model.

### 2.2 Ultrasound
* Plane detection lists the standard views captured and those still missing for the protocol.
* Biometry assistance places calipers; you confirm or adjust before the measurement is stored.
* Quality scores are shown per image; only images you keep are analysed for the report.

### 2.3 Dose
The dose panel shows the study's dose indicators against the protocol's reference level and your
site's baseline. An outlier flag asks for a reason (patient size, repeat, protocol deviation) and
notifies the RPO. It is a safety loop, not a performance score.

### 2.4 Load-shedding and offline mode
Quality checks run on the site's Edge Gateway and keep working without internet. Triage and
findings analysis resume automatically when the link returns; the study is never lost.

### 2.5 What to do if
| Situation | Action |
|---|---|
| Console says "wrong body part" but the order is right | Send; select "order correct" as reason; the referral or protocol mapping is checked by the Protocol Hand |
| Marker not detected | Check that the marker is in the field; if it is, send with "marker present"; the OCR model is reviewed |
| Repeated amber on a specific detector | Report through the console; BIO checks calibration; AIO checks drift |
| Analysis stuck at "queued" for long | Nothing to do; the study is in the archive; if a STAT case, phone the radiologist as usual |

---

## Part 3 — For engineers

### 3.1 The pieces you touch
| Piece | Location (07 §2) | Language |
|---|---|---|
| Edge QC runtime | `apps/edge-gateway` | Node + ONNX Runtime |
| Inference service | `apps/inference` | Python 3.11, FastAPI, ONNX Runtime / TensorRT |
| Orchestrator (Workflows), routing rules, registry | `apps/api` (M11) | TypeScript |
| Contracts and schemas | `packages/ai-contracts` | TypeScript (Zod) + JSON Schema |
| DICOM utilities, de-identifier | `packages/dicom` | TypeScript; Python mirror in `apps/inference` |
| Viewer overlays, findings panel | `apps/web`, `packages/bdl` | React |

### 3.2 Adding a model (in-house)
1. **Register**: create a Model Registry entry (id, version, task, modality, body part, input spec,
   output class, intended use, limitations). The entry starts in `proposed`.
2. **Package**: export to ONNX (opset pinned), include `model.json` (input/output tensor spec,
   pre-processing recipe id, post-processing config, thresholds), and a `card.md`. Sign with cosign.
3. **Pre/post-processing**: implement as a named recipe in `apps/inference/recipes/` with unit tests
   against fixture DICOM (synthetic or licensed public test images; never patient data in the repo).
4. **Adapter**: implement the `bci.result.v1` producer; validate output against the JSON Schema in CI.
5. **Offline evaluation**: run `pnpm bci:eval --model <id>@<version> --set <sa-heldout-set>`; the
   harness computes the model-card metrics and subgroup tables and writes the validation report.
   The gate fails if any pre-registered target or subgroup floor is missed.
6. **Reader study** (Class 1 models): coordinate with the clinical lead; the Reading Room has a
   study mode that records reads with and without overlays.
7. **Shadow**: activate `shadow` for pilot sites via routing rules; results are computed and stored
   but hidden from clinicians; agreement vs signed reports accumulates on the AIO dashboard.
8. **Activation**: AI committee approval → change-control record → `activated` per site. Roll out
   in waves; watch the coverage/latency/agreement panels for 48 h per wave.

### 3.3 Adding a third-party model
Same steps, with: SAHPRA status recorded and verified; contract and data-processing agreement
uploaded; de-identification profile selected; endpoint adapter implemented against the vendor API
with retries, timeouts, circuit breaker and cost metering; vendor sees no identified data unless
contractually an SA-resident POPIA operator.

### 3.4 Running inference on Cloudflare
* Pre-processing and 2D CPU models run in Cloudflare Containers built from
  `apps/inference/Dockerfile`; the orchestrator scales instances by queue depth.
* Heavy 3D models run on the GPU inference cell (Kubernetes in an SA data centre) reached through a
  Cloudflare Tunnel; the cell exposes the same `/infer` API as Containers so routing rules choose
  the target by cost and availability.
* Where Cloudflare offers GPU-backed Containers in a suitable region, prefer them; treat this as a
  configuration change, not a code change.
* All inputs are read from R2 through presigned, short-lived URLs; results are written back to R2
  and indexed in the tenant's D1 database; events go to Queues.
* The demo environment uses deterministic demo models that return scripted results for the
  synthetic case library; they are labelled `DEMO` in provenance and can never be activated in
  production (the registry rejects `vendor: demo` outside the demo environment).

### 3.5 Testing
| Level | What |
|---|---|
| Unit | Recipes, tensor shapes, post-processing, schema validation, laterality/consistency rules |
| Contract | Every adapter must pass the `bci.result.v1` conformance suite (golden inputs → expected outputs) |
| Integration | Workflow end-to-end on synthetic studies through Edge simulator → ingest → inference → results → worklist |
| Performance | Latency and throughput per compute target under load; time budgets enforced in CI |
| Safety | Attempt to publish an unaccepted Class 1 result through every API; the test suite must prove no path exists |
| Regression | Model-level evaluation on the held-out set on every version bump; gate on pre-registered targets |

### 3.6 Operations runbook (short)
* Backlog growing: check queue depth per compute target; scale Containers; check Tunnel health for
  the GPU cell; if a vendor endpoint is failing, the circuit breaker moves those studies to
  "not analysed (vendor)" and AIO is paged.
* Latency P95 breach: inspect per-step timings in the Workflow trace; common causes are R2 fetch of
  very large series (use series-level range reads) and cold Containers (raise minimum instances).
* Bad model version: roll back in the registry (previous digest); routing picks it up within a
  minute; keep the bad version's results for analysis, flagged.
* Edge bundle rollout: waves by site; a site that fails health checks reverts automatically.

---

## Part 4 — For AI operations and compliance

### 4.1 Daily
* Coverage, latency, agreement, override rate, positive rate, drift score per model and site.
* Slip counter (must be zero) and the audit of any dismissed consistency warnings.
* Vendor endpoint health and spend.

### 4.2 Weekly
* Calibration drift; subgroup performance; new-detector or new-protocol alerts from BIO; review of
  radiologist "teach" flags; queue of proposed threshold changes.

### 4.3 Monthly / quarterly
* AI committee: activation requests, shadow-mode reports, incident reviews, retraining decisions,
  model retirements; minutes stored in M19.
* SAHPRA: vigilance reports where required; regulatory file updates per model version.
* POPIA: DPIA review for any new data flow (new vendor, new compute location).

### 4.4 Change control
Every model version, threshold change, routing change and activation is a change record with:
reason, evidence (validation or shadow report), approvals (AIO + clinical lead + CMP for Class 1),
rollout plan, rollback plan, and post-implementation review at 2 weeks.

### 4.5 Incidents and near-slips
* Definition: any Class 1 content that reached a record, referrer or patient without acceptance is a
  slip (severity 1). Any path that could have allowed it is a near-slip (severity 2). A model
  producing systematically wrong candidates at a site is a performance incident (severity 3).
* Response: pause the model/site (kill switch) → contain (identify affected studies) → notify the
  radiologists and, where a report was affected, correct via addendum with referrer notification →
  root cause → fix → report to the AI committee and, where required, to SAHPRA.
* Times: severity 1 detection within minutes (audit stream alarm), containment within 1 hour,
  written report within 5 working days.

### 4.6 Evidence for regulators and auditors
One click produces, per model: model card, validation report, SA subgroup analysis, calibration
report, shadow report, activation approvals, monitoring history, incident history, and the
data-provenance statement (training data manifest, lawful basis, ethics approval).

---

## One-page summary for practice managers and executives
* Every study is analysed for quality within seconds and for priority within minutes; radiologists
  read the sickest first and get pointers, measurements and safety checks.
* Nothing the AI produces reaches a report or a patient without a radiologist's signature. That is
  enforced in code, not policy.
* Models are validated on South African data, per site, before they are switched on; they run in
  shadow first; a site or model can be paused in a minute.
* Quality feedback at the console reduces repeats and dose; consistency checks reduce laterality
  and transcription errors.
* The Platform records everything (provenance, overrides, monitoring) so regulators, funders and
  the AI committee can see exactly what happened.
* What to watch on your control tower: coverage, triage time, repeat rate, consistency warnings
  resolved, and the slip counter, which should always read zero.
