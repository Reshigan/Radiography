# 00 — Specification Conventions (read first)

This file fixes the names, structures and vocabulary used across every other document in this
specification. Any document that contradicts this file is wrong; fix the document.

## 1. The product

| Item | Value |
|---|---|
| Working brand (group + platform) | **Bonakala** (isiZulu: *to become visible, to be seen clearly*) |
| Patient-facing chain name | Bonakala Imaging |
| Platform name (software) | Bonakala Platform (internal short form: "the Platform") |
| Design language | Bonakala Design Language (BDL), concept name "Latent Image" |
| AI layer | Bonakala Clinical Intelligence (BCI) — the umbrella for all AI models and agents |
| Agent runtime | "Hands" — every autonomous agent is a *Hand* with a name, a mandate and a leash (see 11 and 12) |
| Country / currency / VAT | South Africa, ZAR (R), VAT 15 % |
| Time zone | Africa/Johannesburg (SAST, UTC+2), no DST |
| Languages (UI) | English first; isiZulu, isiXhosa, Afrikaans, Sesotho, Setswana, Sepedi, Xitsonga, siSwati, Tshivenda, isiNdebele, SASL (video) planned in phases. All patient-facing copy is designed to be translated. |

> Trademark note: "Bonakala" is a coined-use of a common isiZulu verb. Before public launch it MUST be
> cleared by a registered trademark attorney against CIPC (SA), WIPO Global Brand Database and
> TMview in classes 9, 10, 35, 42 and 44. Fallback candidates are listed in `05-brand-identity.md`.

## 2. Organisational vocabulary (see 03 for detail)

| Term | Meaning |
|---|---|
| **Group** | The top-level holding entity (Bonakala Holdings). Owns the Platform, the brand, shared services. |
| **MSO** | Management Services Organisation — the Group subsidiary that provides platform, billing, HR, procurement and facilities to practices under a management agreement. Required because HPCSA rules constrain who may own a clinical practice. |
| **Practice** | A clinical legal entity registered with a BHF practice number, owned by HPCSA-registered radiologists (100 % subsidiary of a professional-owned entity, or a Joint Venture). Practices are tenants of the Platform. |
| **JV** | A Practice with more than one shareholder class (e.g., Group-affiliated professional entity 51 %, local radiologist partners 49 %). Shareholding is modelled on the Platform (cap table, distributions, minority interest). |
| **Site** | A physical location operated by a Practice (a branch). Has a street address, radiation licence(s), rooms and modalities. |
| **Room** | A licensed imaging room within a Site, containing one or more **Modalities** (devices). |
| **Hub** | A virtual reporting pool (radiologists reading for many Practices, teleradiology). |
| **Tenant** | Platform data isolation boundary = Practice. Group and MSO are *cross-tenant* roles, governed by data-sharing agreements. |

## 3. Personas (canonical short codes, see 04)

| Code | Persona |
|---|---|
| PAT | Patient (and guardian / next-of-kin) |
| REF | Referring clinician (GP, specialist, dentist, chiropractor, physio, occupational health doctor, casualty) |
| FDK | Front desk / reception / patient services |
| BKG | Central booking & contact-centre agent |
| RAD | Radiographer (diagnostic, mammography, sonographer, MRI, CT technologist) |
| RGT | Radiologist (reporting, protocolling, procedures) |
| NUR | Nurse / contrast & IV / patient care assistant |
| BIL | Billing, coding and claims clerk |
| DEB | Debtors / collections controller |
| PRM | Practice manager / site manager |
| EXE | Group executive (CEO, CFO, COO, CMO, CIO) |
| SHR | Practice shareholder / JV partner (non-exec view) |
| CMP | Compliance, quality, radiation-protection officer, POPIA information officer |
| BIO | Biomedical / clinical engineering & IT operations |
| AIO | AI operations / model governance (clinical safety officer for AI) |
| PAY | Medical scheme / administrator / funder (external, via portal/API) |
| SUP | Platform support (MSO) |

## 4. Module map (canonical names)

Every capability belongs to exactly one module. Use these names verbatim.

| # | Module | Scope |
|---|---|---|
| M01 | **Identity & Access** | SSO, MFA, RBAC/ABAC, HPCSA registration verification, consent, break-glass |
| M02 | **Organisation & Shareholding** | Group/MSO/Practice/JV/Site/Room, cap tables, agreements, intercompany |
| M03 | **Patient Master Index** | Patient identity, ID/passport verification, scheme membership, duplicates, merge |
| M04 | **Referral & Orders** | Referral intake (paper, e-referral, portal, WhatsApp, fax-to-digital), order entry, appropriateness |
| M05 | **Scheduling & Capacity** | Slot engine, modality calendars, constraints, waitlists, reminders, no-show prediction |
| M06 | **Funding & Authorisation** | Benefit checks, pre-authorisation, quotes, RAF/COIDA/corporate/cash rules |
| M07 | **Registration & Safety** | Check-in, kiosks, consent, safety questionnaires (pregnancy, MRI, contrast), wristbands |
| M08 | **Acquisition & Worklist** | DICOM Modality Worklist, MPPS, protocol, technologist workflow, repeat/reject tracking |
| M09 | **Image Management (PACS)** | DICOM ingest, storage tiers, routing, viewer, prior fetch, sharing, retention |
| M10 | **Dose & Radiation Safety** | Dose Structured Reports, DRLs, dosimetry, licence registers, QA tests |
| M11 | **Clinical Intelligence (BCI)** | AI model registry, inference orchestration, triage, QC, drafting, monitoring |
| M12 | **Reporting** | Radiologist worklist, structured reporting, dictation, peer review, addenda, sign-off |
| M13 | **Results & Communication** | Critical findings, referrer portal, patient results, notifications |
| M14 | **Revenue Cycle (Billing)** | Coding, charge capture, pricing, claims, switch integration, remittances, rejections, debtors, cash |
| M15 | **Finance & Consolidation** | GL mapping, intercompany, JV distributions, budgets, management accounts |
| M16 | **Analytics & Insight** | Warehouse, KPIs, dashboards, benchmarking, forecasting |
| M17 | **Workforce** | Rostering, credentials, CPD, time & attendance, productivity |
| M18 | **Assets & Engineering** | Equipment register, maintenance, uptime, licences, consumables, contrast stock |
| M19 | **Quality, Risk & Compliance** | Incidents, complaints, audits, policies, POPIA, HPCSA, SAHPRA, accreditation |
| M20 | **Agent Runtime ("Hands")** | Agent definitions, tools, leashes, approvals, audit |
| M21 | **Platform Core** | Tenancy, events, integration bus, files, notifications, feature flags, observability |

## 5. Writing rules for this spec

1. Every process document has: purpose, trigger, actors, preconditions, happy path (numbered), variants and exceptions, automation level (see 6), AI/agent touchpoints, data produced, KPIs, controls.
2. Every journey document is per persona and is written as scenes with what the user sees, does, and what the Platform does in the background.
3. Requirements are numbered `MXX-R-nnn` (module) and use MUST / SHOULD / MAY (RFC 2119 sense).
4. Use ZAR. Use SAST. Use ID number, not SSN. Use "medical scheme", not "insurance". Use "tariff code", not "CPT".
5. Never claim an AI output is a diagnosis. AI outputs are *findings candidates*, *triage priorities*, *drafts* or *scores* until a registered radiologist signs.
6. Illustrative tariff codes, scheme names and prices are examples; the Platform stores them as configurable reference data.

## 6. Automation levels (used everywhere)

| Level | Name | Meaning |
|---|---|---|
| A0 | Manual | Human does it, Platform records it |
| A1 | Assisted | Platform pre-fills / suggests, human confirms every item |
| A2 | Supervised auto | Platform executes, human reviews a queue of exceptions or a sample |
| A3 | Autonomous with leash | A Hand executes within a mandate; anything outside it escalates |
| A4 | Fully autonomous | No human step by design; monitored by metrics and audits |

Clinical interpretation is capped at **A1** by policy (radiologist signs). Billing of cleanly coded,
authorised, non-disputed claims may run at **A3/A4**.

## 7. Statutory and regulatory results

Obligations, reportable imaging results and statutory outputs are governed by
`24-statutory-and-regulatory-register.md`. No document may state a legal deadline, form name or
threshold as fact unless it is confirmed there; otherwise it is labelled illustrative or [confirm].

## 8. AI Slip — definition

An **AI slip** is any AI-generated content or decision that reaches a patient, referrer, funder,
ledger, regulator, or the medical record without passing the verification tier defined for that
output class in `12-ai-safety-no-slip-charter.md`. The Platform is designed so that a slip is
technically impossible for Class 1–2 outputs (hard gates), and detectable within minutes for
Class 3–4 outputs (audit + monitoring).
