# 04 — Personas

Each persona has: goals, frustrations today (SA market), what "better than the market" means for them,
Platform surfaces, and the 3 metrics they care about. Codes are from `00-conventions.md`.

## PAT — Patient
* **Who**: Any person referred for imaging: medical-scheme members (about 16 % of the population),
  cash-paying patients, RAF/COIDA claimants, corporate/occupational-health employees, public-sector
  patients under NHI pilots, children (with guardians), elderly, non-English first-language speakers.
* **Goals**: Get the scan quickly and close to home, know what it will cost *before* arriving, feel
  safe, get results to the doctor fast, not be chased for money they didn't expect.
* **Frustrations today**: Phone-only booking, no price certainty, co-payment surprises months later,
  "the CD", repeat paperwork at every branch, waiting rooms with no status, no access to own images.
* **Better than market**: Book in 60 seconds on WhatsApp or web; guaranteed quote with scheme benefit
  check; digital pre-check-in and consent; live queue status; results and images in the Patient Space
  within minutes of sign-off; one identity across every site nationally; pay-what-you-owe-now with
  no later surprise (or a clear payment plan).
* **Surfaces**: WhatsApp channel, Patient Space (web app, no install), SMS fallback, kiosk, front desk.
* **Metrics**: time-to-appointment, quote accuracy, results turnaround.

## REF — Referring clinician
* **Who**: GPs, specialists (orthopaedics, oncology, neurology, pulmonology, gynaecology), dentists,
  chiropractors, physiotherapists, occupational health practitioners, casualty/ER doctors, hospital wards.
* **Goals**: Right test, quick appointment for their patient, fast reliable report, direct line to a
  radiologist for urgent cases, images viewable without a CD.
* **Frustrations today**: Fax/paper forms, phoning for reports, unstructured PDFs, no critical-result
  callback guarantee, no visibility of whether the patient attended.
* **Better than market**: e-Referral in one click from any system (or a photo of their form), instant
  slot offer for their patient, appropriateness guidance (right modality, right protocol), structured
  reports with key images and measurable trends, critical findings phoned *and* acknowledged
  digitally, referral analytics.
* **Surfaces**: Referrer Space (web), FHIR/HL7 integrations to practice-management systems, WhatsApp
  Business notifications, phone.
* **Metrics**: report TAT, critical-result acknowledgement time, patient attendance rate.

## FDK — Front desk / reception
* **Goals**: Move patients through with zero re-keying, know exactly what to collect, avoid queues.
* **Frustrations**: Scheme phone calls, manual benefit checks, paper consent, walk-ins, ID capture.
* **Better than market**: Everything pre-done on the Patient Space; ID scan; the *Collect* card says
  exactly what to collect and why; one screen for the day; a Hand does the scheme calls.
* **Surfaces**: Front Desk console (tablet/desktop), kiosk supervisor mode.
* **Metrics**: check-in time, front-desk collection rate, queue wait.

## BKG — Central booking / contact centre
* **Goals**: Convert every referral into a booked, funded appointment at the best site.
* **Better than market**: Omnichannel inbox (call, WhatsApp, email, fax-to-digital, portal); AI slot
  recommendation across all sites; booking Hand handles routine requests end-to-end.
* **Metrics**: conversion rate, average handling time, fill rate.

## RAD — Radiographer / sonographer / technologist
* **Goals**: Right patient, right study, right protocol, first time; low dose; no re-keying; safety.
* **Frustrations**: Worklist mismatches, manual protocol lookup, repeat exposures, chasing priors,
  contrast stock, MRI safety paperwork, dose logging.
* **Better than market**: Auto-populated worklist; protocol card with AI-suggested protocol and
  dose reference level; positioning/exposure QC in seconds; repeat/reject captured automatically;
  contrast tracking by barcode; safety checklists on the tablet; time-per-study analytics that are
  fair (case-mix adjusted).
* **Surfaces**: Technologist console (touch-first), modality integration, mobile app for portable X-ray.
* **Metrics**: repeat rate, dose vs DRL, studies per shift (case-mix adjusted).

## RGT — Radiologist
* **Goals**: Read efficiently and safely, prioritise the sick, never miss a critical finding, sign
  quality reports, protocol correctly, be paid fairly for reads.
* **Frustrations**: Unprioritised worklists, priors in another system, dictation overhead, phone tag
  for critical results, peer review as a chore, no per-radiologist analytics.
* **Better than market**: AI-triaged worklist; hanging protocols and priors ready; findings-candidates
  overlays with one-click accept/reject; drafted structured report from dictation + AI, always under
  the radiologist's signature; critical-result Hand does the calling and confirms acknowledgement;
  built-in peer learning; reading-fee statements auto-computed.
* **Surfaces**: Reading Room (diagnostic viewer + reporting), mobile review for on-call, Hub pool.
* **Metrics**: TAT by priority, discrepancy rate, RVU-equivalent throughput.

## NUR — Nurse / contrast / patient care
* **Goals**: Safe contrast administration, IV access, patient observation, reactions handled.
* **Better than market**: eGFR/allergy/metformin checks surfaced automatically; contrast dose per weight;
  reaction protocol on screen; stock decrement by scan.
* **Metrics**: contrast reactions, extravasations, eGFR check compliance.

## BIL — Billing / coding / claims
* **Goals**: Every study billed correctly the same day, first-pass acceptance, no leakage.
* **Frustrations**: Manual coding from reports, scheme rule differences, rejections with cryptic codes,
  resubmission deadlines (typically 4 months from service date), modifiers, multiple-procedure rules.
* **Better than market**: Coding Hand codes from order + report with confidence; scrubber applies
  scheme-specific rules; real-time claims where available; rejection reason taxonomy with auto-fix
  paths; exception-only work queue.
* **Metrics**: first-pass acceptance, days-to-bill, unbilled backlog.

## DEB — Debtors / collections
* **Goals**: Collect what is owed quickly and kindly; minimise write-offs and bad debt handover.
* **Better than market**: Propensity-to-pay scoring, automated, respectful multi-channel dunning with
  payment links (PayShap, card, EFT, SnapScan/Zapper-style QR), payment plans, dispute workflow,
  scheme-vs-patient liability split explained on every statement.
* **Metrics**: DSO, collection rate at 30/60/90, write-off %.

## PRM — Practice / site manager
* **Goals**: Run the site: capacity, staff, equipment, patient experience, cash.
* **Better than market**: One daily control tower; alerts before problems (downtime, no-shows, staff
  gaps, stock); actions delegated to Hands.
* **Metrics**: utilisation, patient wait, revenue vs budget.

## EXE — Group executive
* **Goals**: Grow the network, protect margin, manage risk, integrate acquisitions fast.
* **Better than market**: Group-wide live analytics, benchmarking across practices, what-if
  modelling (a new CT at site X), acquisition onboarding in days, regulator-ready compliance.
* **Metrics**: EBITDA, network TAT, compliance status.

## SHR — Practice shareholder / JV partner
* **Goals**: Transparent P&L, distributions on time, say in reserved matters.
* **Surfaces**: Shareholder portal.
* **Metrics**: distributable profit, distribution timeliness, KPI vs plan.

## CMP — Compliance / quality / RPO / information officer
* **Goals**: Prove compliance continuously: SAHPRA licences and QA, HPCSA registration, POPIA,
  dose, incidents, audits, accreditation (e.g., SANAS/ISO 15189-style or COHSASA-style standards).
* **Better than market**: Evidence collected automatically; a living compliance calendar; regulator
  packs in one click; incident learning loops.
* **Metrics**: open non-conformances, licence currency, incident closure time.

## BIO — Biomedical engineering / IT ops
* **Goals**: Uptime, maintenance, image quality, network, integration health.
* **Better than market**: Predictive maintenance from modality logs (tube arc counts, helium levels,
  detector calibrations), automated QA reminders, DICOM/HL7 traffic observability.
* **Metrics**: uptime, MTTR, QA compliance.

## AIO — AI operations / clinical safety officer for AI
* **Goals**: Safe, monitored, explainable AI; regulatory files (SAHPRA SaMD); drift detection.
* **Surfaces**: BCI console.
* **Metrics**: model performance vs baseline, override rate, time-to-detect drift.

## PAY — Funder (medical scheme / administrator / RAF / Compensation Fund / corporate)
* **Goals**: Clean claims, clinical appropriateness, fraud control, fast reconciliation.
* **Surfaces**: Funder API and portal for authorisation and audit requests (with consent).
* **Metrics**: claim quality, audit response time.

## SUP — Platform support (MSO)
* **Goals**: Keep tenants running; onboard practices; resolve incidents.
* **Surfaces**: Support console, observability.
