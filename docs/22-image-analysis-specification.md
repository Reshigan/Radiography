# 22 — Image Analysis Specification (Bonakala Clinical Intelligence: Imaging)

This document specifies how the Platform analyses the pictures: the end-to-end imaging AI pipeline
from the modality to the radiologist's screen and back into monitoring. It complements the model
catalogue in `11-ai-catalogue-and-agentic-automation.md` (Part A) and is governed by
`12-ai-safety-no-slip-charter.md`. The practical guide for users and builders is
`23-image-analysis-guide.md`.

Scope: X-ray (CR/DX), mammography (MG), CT, MRI, ultrasound (US), fluoroscopy (RF), DXA and dental
panoramic (PX). Module owner: M11 with M08, M09, M10, M12.

## 1. Design goals
1. **Every image analysed, nothing autonomous.** Every study is analysed by the applicable QC and
   triage models within seconds of arrival; no analysis result reaches a record, referrer or patient
   without a radiologist's signature (Class 1 gate, doc 12).
2. **Seconds at the console, minutes in the queue.** Technologist QC feedback within 5 s on the
   Edge Gateway; triage priority within 3 min of study completion; findings candidates before the
   radiologist opens the study in ≥ 95 % of cases.
3. **Provenance on every pixel of output.** Model id, version, input hash, confidence, thresholds,
   compute location, latency.
4. **Validated for South Africa.** Every model is validated on SA data across sites, scanner vendors,
   age, sex, and the high-prevalence context (TB, HIV-related disease, trauma, silicosis) before
   activation; performance is monitored per site.
5. **Works offline.** QC models run on the Edge Gateway during load-shedding; triage and findings
   models run when the link returns; the queue never loses a study.
6. **Vendor-neutral.** In-house models and third-party SAHPRA-registered models plug into the same
   adapter contract, worklist, viewer and monitoring.

## 2. Pipeline

```
Modality ──C-STORE──▶ Edge Gateway (Orthanc + gateway service)
                        │ 1. validate DICOM, patient/worklist reconcile (M08)
                        │ 2. on-device QC models (positioning, exposure, motion, laterality, completeness)
                        │ 3. de-identified feature extraction for QC telemetry
                        │ 4. store-and-forward (resumable) ── STOW-RS over HTTPS via Cloudflare Tunnel ──▶
Cloud (Cloudflare)      ▼
   Ingest Worker ──▶ R2 (DICOM objects) + D1 (study index) ──▶ event study.series.received
        │
        ▼
   Inference Orchestrator (Workflow per study)
        │ 5. routing rules → inference plan (which models, order, priority, compute target)
        │ 6. pre-processing jobs (Containers): decode, window, resample, crop, series selection
        │ 7. inference jobs: Containers (CPU/GPU) | GPU inference cell (Tunnel) | vendor endpoint
        │ 8. post-processing: calibration, thresholds, localisation → DICOM SR + Segmentation/GSPS + bci.result.v1 JSON
        │ 9. consistency checks (laterality, body part, prior comparison)
        ▼
   Results store (R2 + D1) ──▶ events bci.result.available → worklist priority (M12), viewer overlays, dose alerts (M10)
        │
        ▼
   Radiologist accept/edit/reject (M12) ──▶ provenance record ──▶ monitoring (M11 dashboards, drift, agreement)
```

Internal (Docker) deployments replace Workers/R2/D1 with Node/MinIO/Postgres and Containers with
Kubernetes GPU jobs; the pipeline steps and contracts are identical.

## 3. Ingest and pre-processing

### 3.1 DICOM acceptance
* Accept all SOP classes for archive; analysis is run only on supported SOP classes per model.
* Validate mandatory tags (Patient ID, Accession Number, Modality, Body Part Examined or protocol
  code, Study Instance UID, Series Instance UID, SOP Instance UID, View Position/Laterality for
  projection radiography, Image Orientation for cross-sectional).
* Reconcile against the worklist (M08). Unmatched studies go to a reconciliation queue; analysis
  still runs but results are held until reconciled (no result may attach to the wrong patient).
* Compute `input_hash` = SHA-256 over pixel data + a canonical subset of tags; store in the result.

### 3.2 Series selection
Routing rules select series by modality, body part, orientation, contrast phase, slice thickness,
kernel and image type (e.g., CT head: axial, soft kernel, ≤ 5 mm; chest X-ray: PA/AP, not lateral;
mammography: standard CC/MLO views, for-presentation and for-processing where the model requires).

### 3.3 Normalisation
* Projection radiography: apply Modality LUT/VOI LUT, invert MONOCHROME1, resample to the model's
  input size with aspect preservation and padding, keep the original for localisation mapping.
* CT: HU conversion using Rescale Slope/Intercept; resample to isotropic where required; window
  presets per model (brain, subdural, bone, lung, soft tissue).
* MR: intensity normalisation (z-score or histogram matching per sequence); sequence identification
  from tags and, where unreliable, a sequence-classifier model.
* Mammography: manufacturer-specific processing handled via the for-processing image where
  available; else for-presentation with vendor-aware normalisation.
* Ultrasound: cine frames extracted; still images de-burned of overlay text where necessary
  (never removing patient identifiers from the archived original; only the analysis copy).

### 3.4 De-identification for compute outside the Platform boundary
When a model runs at a third-party vendor endpoint or an LLM is used for text, the analysis copy is
de-identified per the profile in `08-domain-model-and-data.md` (DICOM PS3.15 basic profile plus
pixel-burned-text detection for US and secondary captures). The Platform keeps the mapping.

## 4. Inference orchestration

### 4.1 Routing rules (configurable, versioned)
| Rule field | Example |
|---|---|
| Modality, body part, view, age band, sex | DX, chest, PA/AP, ≥ 16 years |
| Site / practice activation state | Activated at 12 sites; shadow at 3; off at 1 |
| Priority class | STAT studies first; inpatient before outpatient |
| Model set and order | `cxr-qc` → `cxr-triage` → `cxr-findings` → `cxr-consistency` |
| Compute target | Edge (QC), Containers CPU (triage), GPU cell (findings), Vendor X (mammography) |
| Time budget | QC 5 s; triage 180 s; findings 600 s; batch (opportunistic screening) 24 h |
| Fallback | If GPU cell unreachable → queue and retry, notify AIO if > 15 min backlog |

### 4.2 Execution
* One Cloudflare Workflow per study executes the plan with retries, timeouts and compensation;
  steps are idempotent by `(study_uid, model_id, model_version, input_hash)`.
* Inference workers pull from a priority queue; STAT and inpatient studies preempt.
* Each job records: start/end, compute target, container image digest, model file digest, GPU/CPU,
  peak memory, exit status.

### 4.3 Adapter contract (`bci.result.v1`)
Input: DICOMweb references (or a de-identified ZIP for vendor endpoints) + context (age band, sex,
modality, body part, priors list, prior results). Output JSON (schema in `packages/ai-contracts`):

```json
{
  "schema": "bci.result.v1",
  "study_uid": "...", "series_uids": ["..."], "input_hash": "sha256:...",
  "model": {"id": "cxr-triage", "version": "2.3.1", "vendor": "bonakala", "samd_status": "shadow|activated|off"},
  "output_class": 1,
  "task": "triage|findings|qc|measurement|segmentation|consistency|dose",
  "findings": [
    {"code": "pneumothorax", "display": "Pneumothorax", "laterality": "R", "score": 0.91,
     "calibrated_probability": 0.87, "threshold": 0.60, "flag": true,
     "localisation": {"type": "bbox|mask|point|none", "frame_of_reference": "...", "ref": "r2://..."},
     "severity_hint": "small|moderate|large|null", "measurements": [{"name": "apical_lung_distance_mm", "value": 21.4}]}
  ],
  "triage": {"priority": "P1|P2|P3|P4", "reason": ["pneumothorax"]},
  "quality": {"usable": true, "issues": []},
  "consistency": [{"check": "laterality_marker_vs_tag", "status": "pass|warn|fail", "detail": "..."}],
  "limitations": ["paediatric not validated"],
  "latency_ms": 2140, "compute": "cf-container-cpu|gpu-cell-jhb|edge|vendor:x",
  "created_at": "2026-09-16T07:41:02+02:00"
}
```

Also emitted: DICOM SR (TID 1500 measurement report style) for archival interoperability, DICOM
Segmentation or GSPS for overlays, and a thumbnail with the overlay for the worklist card.

## 5. Model families (technical specification)
Each family lists: task, input, architecture class, outputs, thresholds and activation policy.
Detailed intended-use statements are in doc 11 Part A. Architecture classes are stated to guide the
build, not to lock a specific network.

| Family | Task | Input | Architecture class | Outputs | Activation policy |
|---|---|---|---|---|---|
| `xr-qc` | Positioning, collimation, exposure index deviation, motion, artefacts, laterality marker detection, wrong body part, incomplete series | Single projection image | Lightweight CNN/ViT (≤ 20 M params) for Edge CPU; OCR head for markers | Quality flags, exposure index z-score, repeat suggestion | A2 at technologist console; never blocks acquisition; suggests repeat with reason |
| `cxr-triage` | Priority for chest radiographs | PA/AP chest | Multi-label classifier (ConvNeXt/ViT-class), calibrated | P1–P4 + reasons (pneumothorax, large effusion, consolidation, tension signs, lines/tubes malposition) | Shadow → supervised activation per site |
| `cxr-findings` | Findings candidates with localisation | PA/AP chest (+ lateral optional) | Detection/segmentation (multi-task) | Findings list with bboxes/heatmaps, TB-suggestive pattern score, nodule candidates, cardiothoracic ratio | A1 overlays default on for triage-flagged, radiologist accept/reject |
| `cxr-lines` | Lines and tubes position | Portable chest | Segmentation + rule geometry | ETT tip-to-carina distance, NGT course, CVC tip position | A1 |
| `msk-fracture` | Fracture detection appendicular, hip, C-spine, paediatric | Radiographs (all views of a study) | Detection with view-aware fusion | Fracture candidates with bboxes and per-study probability | Shadow → A1 |
| `ct-head` | Intracranial haemorrhage (types), midline shift, mass effect, hydrocephalus hints, skull fracture | Non-contrast CT head | 3D CNN / 2.5D slice fusion + segmentation | Findings candidates, haemorrhage volume estimate (ml), midline shift (mm) | Shadow → A1 with triage P1 |
| `ct-pe` | Pulmonary embolism triage | CTPA | 3D detection | PE candidate, clot burden hint, RV/LV ratio | Shadow → A1 |
| `ct-abdomen` | Free air, appendicitis suspicion, obstruction hints | CT abdomen/pelvis | 3D classifier + localisation | Findings candidates | Shadow → A1 |
| `ct-lung-nodule` | Nodule detection and tracking | Chest CT | 3D detection + registration to priors | Nodule list with size, volume, doubling time vs prior, descriptive risk category (Lung-RADS-style, descriptive) | A1; follow-up tracking via Follow-up Hand |
| `mg-detect` | Lesion detection, density category, prior comparison | 2D MG (and DBT where available) | High-resolution detection (vendor or in-house) | Lesion candidates with marks, density (a–d), asymmetry vs prior | Overlays default OFF; shown after first read; double-read support; never a sole reader |
| `us-qc` | Image quality and plane detection (obstetric, abdominal) | US stills/cine | Frame classifier | Plane labels, quality score, missed-standard-views list | A2 at console |
| `us-biometry` | Obstetric biometry (BPD, HC, AC, FL), bladder volume, thyroid nodule measurements | US stills | Landmark/segmentation | Measurements with calipers (sonographer confirms) | A1 |
| `mr-knee`, `mr-spine`, `mr-brain-qc` | Findings candidates (ACL, meniscus; disc herniation, stenosis), sequence QC | MR series | 3D/2.5D classifiers, sequence-classifier | Findings candidates; sequence mislabel alerts | Shadow → A1 |
| `bone-age` | Bone age estimation | Left hand radiograph | Regression CNN | Bone age (months) with interval; standard reference stated | A1 |
| `dxa-assist` | ROI placement QC and T-score consistency | DXA outputs | Rules + small models | QC flags | A2 |
| `opp-screen` | Opportunistic screening: vertebral bone density proxy, coronary calcium presence, aortic diameter, liver attenuation, sarcopenia proxies | Existing CT | Segmentation + measurement | Structured measurements flagged as opportunistic | Opt-in; A1; research/quality first |
| `prior-change` | Change detection vs prior | Any modality with a prior | Registration + difference | Change map, "new/enlarged/resolved" candidates | A1 |
| `consistency` | Report–image consistency | Signed draft + result JSON | Rules + LLM over structured data (no free image reasoning) | Warnings: laterality mismatch, body part mismatch, finding stated but no candidate and vice versa | Class 4 warnings to radiologist before sign |
| `dose-outlier` | Dose outliers | RDSR + protocol | Statistical model per protocol/site | Outlier flags vs DRL and site baseline | A2 to RPO/CMP |

## 6. Thresholds, calibration and triage policy
* Each model ships with a calibration report (reliability diagram, ECE) on SA validation data and
  per-finding operating points chosen by the AI committee with radiologist input: triage models
  favour sensitivity (target ≥ 0.95 for critical findings at the activation operating point);
  findings models expose a confidence band and a default threshold; QC models favour precision to
  avoid nagging.
* Priority mapping: P1 = critical candidate present (pneumothorax, ICH, PE, free air, tension);
  P2 = urgent candidate; P3 = normal-appearing or routine; P4 = quality-limited requiring
  technologist action. STAT ordered studies are P1 regardless of AI.
* "Normal" is never auto-reported. A high-confidence normal triage only orders the worklist.

## 7. Training and data strategy (South Africa)
### 7.1 Data
* Sources: Bonakala studies with signed reports (labels derived from structured reports via M12
  structured fields, not free text alone), radiologist annotations, dose records, outcomes where
  lawfully linked. External public datasets may be used for pre-training where licences allow
  (recorded in the model card); no external dataset defines the SA operating point.
* Lawful basis: POPIA-compliant de-identified research dataset with ethics approval (a registered
  Health Research Ethics Committee), documented in the DPIA; patients may opt out of research use;
  no training on identified data.
* Stratification: province, site, scanner vendor/model, age band, sex, referral source (casualty,
  GP, occupational), disease prevalence (TB, HIV-associated patterns, silicosis, trauma).

### 7.2 Annotation
* Annotation platform inside the Reading Room (bounding boxes, masks, labels) with double
  annotation and adjudication for ground truth; annotator agreement tracked.
* Label taxonomy versioned in the Model Registry; mapping to structured-report fields.
* Annotation is paid radiologist work, scheduled outside clinical reading hours.

### 7.3 Training
* Frameworks: PyTorch, MONAI, torchvision; experiments tracked; datasets versioned with hashes.
* Splits are by patient and by site (held-out sites) to measure generalisation.
* Every release: training data manifest, hyperparameters, seeds, environment digest.

### 7.4 Validation (release gate)
| Test | Requirement |
|---|---|
| Held-out SA test set (≥ 2 sites unseen in training) | Primary metrics at operating point: sensitivity/specificity (triage), FROC/AP (detection), Dice (segmentation), MAE (measurement) meet the model's pre-registered targets |
| Subgroup analysis | No subgroup (site, vendor, age band, sex, portable vs fixed) below the floor defined in the model card |
| Reader study (for Class 1 models before activation) | Radiologists with and without AI: no reduction in accuracy; measured time and override behaviour |
| Robustness | Performance under compression, rotation, cropping, exposure variation, vendor processing variants |
| Failure analysis | Documented false positives/negatives with categories |
| Latency and cost | Within time budget on the target compute |
| Shadow mode | ≥ 4 weeks live at pilot sites with agreement analysis vs signed reports before activation |

### 7.5 Third-party models
Vendor models are onboarded through the adapter contract, SAHPRA status verified, validated on the
same SA held-out sets (vendor sees only de-identified data under contract), monitored identically.
Commercial terms are per-study or per-site and are tracked in M18/M15.

## 8. Deployment of inference on Cloudflare
| Compute target | Used for | Notes |
|---|---|---|
| Edge Gateway (site CPU, optional small GPU) | `xr-qc`, `us-qc`, marker OCR, thumbnails | ONNX Runtime; works offline; model bundles signed and pushed as fleet updates |
| Cloudflare Containers (CPU) | Pre-processing, DICOM decode, SR generation, 2D triage models at modest throughput | Container image per model family; scaled by queue depth; verify CPU/memory limits |
| Cloudflare Containers (GPU) | 3D CT/MR models, mammography | Only where GPU-backed Containers are available in a suitable region; verify with Cloudflare |
| GPU inference cell (SA data centre) | All heavy models when Containers GPU is unavailable or for data-residency reasons | Kubernetes with NVIDIA runtime; connected via Cloudflare Tunnel; treated as a Platform-managed adapter |
| Workers AI | Utility vision tasks (thumbnails, OCR of referral photos), embeddings | Not for diagnostic models |
| Vendor endpoints | SAHPRA-registered third-party models | De-identified data; contract; monitoring |

Model bundles: ONNX (preferred) or TorchScript; signed (cosign) with digest recorded in the
registry; a bundle runs only if its digest matches the activated registry entry for that site.

## 9. Presentation in the Reading Room and consoles
* Worklist card: priority chip (AI provenance style), reasons, thumbnail with overlay; sort by
  priority then age.
* Viewer: overlays per model toggle (default per policy in §5), opacity control, "show why"
  (heatmap), measurement callouts; overlays are never burned into the archived image.
* Findings panel: candidates listed with Accept / Edit / Reject; accepted candidates pre-populate
  structured report fields (Class 1 gate: the radiologist's signature publishes them).
* Consistency warnings appear at sign time and must be dismissed with a reason if not fixed.
* Technologist console: QC flags with a plain-language reason and a one-tap repeat with reason code.
* Patient and referrer surfaces never show raw AI results; they see the signed report.

## 10. Monitoring and lifecycle (M11 dashboards for AIO)
| Signal | Frequency | Alarm |
|---|---|---|
| Coverage (% eligible studies analysed within time budget) | Hourly | < 95 % |
| Latency P50/P95 per model and compute target | Hourly | P95 > budget |
| Agreement with signed reports (per finding, per site) | Daily | Drop > 5 points vs baseline |
| Override rate (reject/edit of candidates) | Daily | Sustained rise |
| Positive rate per finding per site | Daily | Outside control limits |
| Input drift (image statistics, vendor mix, exposure index) | Daily | Distribution shift score |
| Calibration drift | Weekly | ECE above threshold |
| Slip incidents (Class 1 content escaping the gate) | Real-time | Any (must be 0) |
| Vendor endpoint health | Real-time | Errors, latency |

Lifecycle: proposed → offline validated → shadow (per site) → supervised activation → activated →
deprecated → retired. Kill switch per model, per site, per Practice; rollback to previous version
within minutes; every state change is a change-control record with CMP and AIO sign-off.

## 11. Requirements
* M11-R-200 The Platform MUST analyse every eligible study with the activated model set and MUST
  record a result (or an explicit "not analysed" reason) per study.
* M11-R-201 No AI result MAY attach to a study before patient/worklist reconciliation succeeds.
* M11-R-202 Every result MUST carry provenance (§4.3) and MUST be stored immutably with the input hash.
* M11-R-203 QC feedback MUST be available at the technologist console within 5 s at the Edge,
  including offline.
* M11-R-204 Triage priority MUST be available within 3 min of study completion for ≥ 95 % of
  studies when the link is up, and MUST be back-filled on reconnection.
* M11-R-205 Class 1 outputs MUST only reach report text through radiologist acceptance in M12.
* M11-R-206 Mammography overlays MUST default to off until the radiologist's first read is recorded.
* M11-R-207 Each model MUST have a model card, validation report, SA subgroup analysis, calibration
  report and monitoring plan before shadow mode; and a shadow-mode report before activation.
* M11-R-208 Kill switches MUST act within 60 s and MUST be available to AIO and CMP.
* M11-R-209 Third-party models MUST run only on de-identified data unless the vendor is a POPIA
  operator under contract with data residency in South Africa.
* M11-R-210 Overlays MUST never be burned into archived images.
* M11-R-211 The Platform MUST keep per-site performance and MUST alert when a site diverges.
* M11-R-212 Model bundles MUST be signed and MUST be refused if the digest does not match the registry.
