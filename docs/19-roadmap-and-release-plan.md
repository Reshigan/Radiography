# 19 — Roadmap and Release Plan

## 1. Principles
* Ship the demo continuously; every module lands on Cloudflare first (synthetic data), then in the
  internal pilot.
* Clinical AI goes: offline validation → shadow mode at pilot sites → supervised activation → scale.
* Nothing is "done" without: persona surfaces, exceptions, audit, analytics, docs, tests.

## 2. Releases (indicative, ~18 months; durations are planning estimates)

### R0 — Spec, brand, scaffold (weeks 0–4)
* This specification; BDL tokens and style guide; monorepo scaffold; CI; Cloudflare preview; Docker
  compose skeleton; synthetic data generator; simulators (modality, switch, funder).

### R1 — Foundation (months 1–5)
* M01 Identity & Access, M02 Organisation & Shareholding (entities, sites, rooms, modalities,
  licences), M03 Patient Master Index, M04 Referral & Orders (portal, WhatsApp, OCR via Referral
  Hand in A1), M05 Scheduling (slot engine, reminders, self-service), M06 Funding (quotes, manual
  auth, benefit check adapter), M07 Registration & Safety (pre-check-in, kiosk, consent, safety
  forms), M08 Acquisition (MWL/MPPS via Edge Gateway), M09 PACS (ingest, archive, viewer, priors),
  M12 Reporting (structured templates, dictation, sign-off, addenda), M13 Results (referrer portal,
  patient results, critical-results workflow manual), M14 Billing core (charge capture, pricing,
  claims assembly, switch simulator, remittance matching), M21 Platform Core, Patient Space,
  Referrer Space, Front Desk, Technologist console, Reading Room v1, BDL v1.
* Demo scenarios: "the 09:40 patient", "the STAT head CT".
* Pilot: 1 internal site on Docker + Edge Gateway.

### R2 — Revenue and Intelligence (months 5–9)
* M14 full automation (Coding Hand, Claims Hand, Remittance Hand, Collections Hand; real switch
  adapter; real PSP; scheme rule packs), M06 Authorisation Hand, M05 Booking Hand (A3),
  M11 BCI v1 (QC models on Edge; chest X-ray triage, ICH, fracture in **shadow mode**), M10 Dose
  (RDSR, DRLs, alerts), M16 Analytics v1 (semantic layer, persona dashboards), M20 Agent Runtime
  (leashes, approvals, audit), M15 Finance core (P&L per practice, intercompany, GL export).
* Demo scenarios: "the rejection wave", "month-end in 4 minutes".
* Pilot: 3 sites, one JV.

### R3 — Network (months 9–14)
* Reading Hub (pooling, on-call, reading fees), M02 JV waterfalls and distributions, M15
  consolidation and shareholder portal, M17 Workforce + Roster Hand, M18 Assets + Maintenance Hand,
  M19 Compliance + Compliance Hand, M16 benchmarking and forecasting + Insight Hand, Onboarding
  Hand, Edge fleet management, multilingual WhatsApp (isiZulu, isiXhosa, Afrikaans, Sesotho first),
  BCI activation (supervised) for QC and triage where validation passes; SAHPRA regulatory files.
* Demo scenario: "onboarding a practice".
* Scale: 10–25 sites.

### R4 — Scale and Frontier (months 14–18+)
* NHI-ready claims, occupational health module (ODMWA/ILO workflow), mammography programme tooling
  (double reading, recall), oncology serial imaging tracking, mobile X-ray routing, opportunistic
  screening features (opt-in), third-party SAHPRA-registered model marketplace via the BCI adapter,
  Kubernetes internal deployment, DR automation, SASL video support, research de-identification
  pipeline with ethics workflow.
* Scale: 50+ sites; national.

## 3. Cross-cutting tracks
| Track | Cadence |
|---|---|
| Security and POPIA | DPIA per release; pen-test annually; POPIA audit quarterly |
| AI safety | AI committee monthly; model review per activation; slip drills quarterly |
| Design | BDL releases monthly; accessibility audit per release |
| Data | Metric definitions change control; data-quality dashboards |
| Regulatory | SAHPRA SaMD engagement from R1; radiation licence register from R1 |

## 4. Team shape (indicative)
Product lead, clinical lead (radiologist), radiographer lead, revenue-cycle lead, 2 designers (BDL),
6–10 engineers (TypeScript full-stack, DICOM/integration, data, ML), 1 ML engineer, 1 clinical
safety officer (AI), 1 compliance/POPIA officer, QA/test engineer, site implementation team.
