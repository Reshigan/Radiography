# 02 — South African Context and Regulation

This document is the regulatory and market backdrop every module must respect. Specific thresholds,
codes and deadlines are stored as **configurable reference data** in the Platform and are marked
*illustrative* here where they change or vary by funder.

## 1. Market structure
* Two-tier system: a public sector serving the majority, and a private sector funded mainly by
  medical schemes (roughly one in six South Africans are scheme beneficiaries; the Platform stores
  current CMS statistics as reference).
* Private radiology is dominated by radiologist-owned practices and a handful of large groups,
  many hospital-based (co-located with private hospital groups) and many community-based.
* Funders: open and restricted medical schemes (examples: Discovery Health Medical Scheme, GEMS,
  Bonitas, Momentum, Bestmed, Medihelp, Polmed, Fedhealth), administrators and managed-care
  organisations acting for schemes, the Road Accident Fund (RAF), the Compensation Fund and
  licensed mutual associations under COIDA, employers (occupational health, mining under ODMWA),
  the state (contracts, NHI pilots), and cash patients.
* Claims flow electronically through **claims switches** to schemes; many schemes adjudicate in
  near-real time and return responses and remittance advices electronically.
* Radiology reports are legally the radiologist's professional act; radiographers acquire images.

## 2. Regulators and bodies
| Body | Relevance to the Platform |
|---|---|
| **HPCSA** (Health Professions Council of South Africa) | Registration of radiologists, radiographers, sonographers; ethical rules (ownership, fee sharing, advertising, telemedicine); CPD; complaints. Platform verifies HPCSA numbers and tracks renewals. |
| **SAHPRA** (South African Health Products Regulatory Authority) | (a) Radiation Control: licensing of X-ray, CT, mammography, fluoroscopy, DXA units per room/site; RPO; inspections; (b) Medical Devices: software as a medical device (AI) licensing/registration; vigilance reporting. |
| **BHF** (Board of Healthcare Funders) — PCNS | Practice Code Numbering System: practice numbers required on claims. |
| **CMS** (Council for Medical Schemes) | Medical Schemes Act 131 of 1998; PMBs (prescribed minimum benefits); DSP networks; complaints and rulings; scheme rules. |
| **Information Regulator** | POPIA (Protection of Personal Information Act 4 of 2013) and PAIA. Health data is special personal information. Information Officer registration, breach notification, prior authorisation for certain processing. |
| **National Department of Health** | National Health Act 61 of 2003 (health records, confidentiality, health establishments), NHI Act 2024 (phased), Office of Health Standards Compliance norms and standards. |
| **Department of Employment and Labour / Compensation Fund** | COIDA (injury on duty claims), Occupational Health and Safety Act, ODMWA for mine workers (MBOD/CCOD). |
| **SARS** | VAT (15 %), income tax, dividends tax, PAYE; e-invoicing readiness. |
| **CIPC** | Company registration, annual returns, beneficial ownership; trademark registry. |
| **Competition Commission** | Merger notification when acquiring practices above thresholds; findings of the Health Market Inquiry inform pricing transparency. |
| **RAF** | Road Accident Fund claims for accident-related imaging (often via attorneys, settled years later). |
| **B-BBEE Commission** | Ownership, management, skills development, enterprise and supplier development scorecards. |

## 3. Rules that shape design decisions
1. **Ownership**: only registered practitioners may own/share in a radiology practice's professional
   fees → subsidiaries/JVs are radiologist-owned entities; the Group operates through an MSO (see 03).
2. **Justification**: exposures to ionising radiation require clinical justification; walk-in
   self-referral policies are configurable per practice and modality with an accountable practitioner.
3. **Claims**: ICD-10 codes are mandatory on scheme claims; practice number, provider numbers,
   member and dependant codes are required; schemes apply their own tariff files and rules; late
   submission windows (commonly about 4 months from service date, *illustrative*) forfeit payment.
4. **PMBs**: certain conditions must be funded in full at DSP rates; the Platform flags PMB-eligible
   ICD-10 codes so claims are coded and routed correctly.
5. **Price transparency**: patients must be told costs and co-payments before service where
   possible; the Consumer Protection Act and HPCSA rules on informed financial consent apply.
6. **POPIA**: consent or another lawful basis for processing health information; purpose limitation;
   operators (MSO, cloud, LLM providers) under written contracts; cross-border transfers only under
   s.72 conditions; data-subject access requests within statutory timelines; breach notification.
7. **Records retention**: HPCSA guidance for health records (adults ≥ 6 years after last treatment;
   minors until age 21; occupational records longer; mammography programmes longer) → per-class
   retention in M09/M21.
8. **Radiation licensing**: every X-ray-emitting device is licensed per room; the licence holder,
   RPO and inspection status are tracked in M02/M10; unlicensed devices cannot be scheduled.
9. **AI as a medical device**: diagnostic-support software falls under SAHPRA's medical device
   framework; the Platform maintains a regulatory file per model and runs shadow mode before any
   activation (see 11, 12).
10. **Telemedicine/teleradiology**: HPCSA guidelines allow remote reporting by registered
    radiologists with appropriate consent and security; the Reading Hub follows them.
11. **NHI**: contracting units and standardised claims are expected; the Platform's data model keeps
    funder-agnostic claims so an NHI funder is "one more funder".
12. **Language**: patients are entitled to be informed in a language they understand; core
    patient-facing content is designed for all 11 official languages and SASL over time.

## 4. Operating realities the design must absorb
| Reality | Design response |
|---|---|
| Load-shedding and grid instability | Edge Gateway per site: offline worklist, store-and-forward, UPS telemetry, load-shedding-aware scheduling |
| Expensive mobile data, older Android phones | Patient Space under 150 kB JS; WhatsApp-first; SMS fallback; no app install |
| WhatsApp is the national messaging default | WhatsApp Business Cloud API as a first-class channel for booking, prep, results notification, payment links |
| Transport constraints (taxis, distance) | "Earliest near me" scheduling, batch family bookings, minimise repeat visits (same-day reads) |
| Multiple languages, variable literacy | Plain-language layer, voice notes, icons + text, interpreters flagged at booking |
| Scheme benefit exhaustion mid-year | Real-time benefit checks; honest Collect card; payment plans |
| RAF/COIDA long settlement cycles | Separate debtor classes, ageing and provisioning rules, document packs for attorneys |
| Occupational health volumes (mining) | Batch orders, ILO-classification reporting workflow, employer invoicing |
| Skills scarcity (radiologists, MRI radiographers) | Reading Hub, protocol Hands, case-mix-fair productivity, tele-support |
| Fraud and abuse pressure from funders | Audit-ready claims, anomaly detection, funder audit packs |

## 5. Coding and reference data (configurable)
* Diagnosis: ICD-10 (SA variant as published by the Department of Health / CMS).
* Procedures: SA radiology tariff coding structure and modifiers as used by funders and the
  radiology profession's tariff schedules (practice-specific fee schedules per funder loaded as
  versioned data; sample codes in the demo are illustrative).
* Consumables: NAPPI-style product codes for contrast and consumables where funders require them.
* Practice/provider identifiers: BHF practice numbers; HPCSA registration numbers.
* Patient identifiers: SA ID number (13-digit, Luhn check), passport + country, scheme member and
  dependant codes, hospital MRN.
* Geography: provinces, municipalities, postal codes; site geo-coordinates.
