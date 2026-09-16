# 12 — Quality, Risk and Compliance (M19)

## 1. Purpose and scope

M19 is the module through which a Practice, the MSO and the Group prove, continuously and with
evidence, that they operate lawfully and safely. In the South African market compliance is usually a
filing cabinet and a diary: the SAHPRA licence renewal is remembered when the inspector phones, the
POPIA manual is a template nobody has read, incident forms are paper. The Platform replaces this with
a living **compliance calendar**, a **policy library with acknowledgements**, an **incident and
complaint system with learning loops**, an **audit workspace**, a **risk register** and a
**Compliance Hand** that collects evidence, drafts submissions and chases expiries, but never files
anything with a regulator without CMP approval.

| Item | Value |
|---|---|
| Owning module | M19 Quality, Risk & Compliance |
| Primary personas | CMP (owner), PRM, EXE, BIO, RGT, RAD, NUR, AIO, SHR (read), SUP |
| Supporting modules | M01 (acknowledgements, access reviews), M02 (entities, licences, officers), M07 (consent), M10 (dose, QA), M11 (AI monitoring), M13 (critical-results evidence), M14 (claims audits), M17 (credentials), M18 (assets, facilities), M20 (Hands), M21 (events, documents) |
| Automation target | Evidence collection A3/A4; drafting A2; submission to any regulator, funder or council A1 (CMP signs) |

## 2. Data model

| Entity | Key attributes |
|---|---|
| `obligation` | entity (Group, MSO, Practice, Site, Room, Modality, worker), regulator or counterparty, category, description, legal reference, frequency (once, annual, per event, rolling), due-date rule, evidence required, owner, status, linked reference data version |
| `calendar_item` | obligation instance with due date, reminders, assignee, evidence checklist, submission record, outcome |
| `policy` | title, category, version, effective date, owner, review cycle, applies-to (roles, sites), file, change summary, approval record |
| `acknowledgement` | worker, policy version, acknowledged at, method (in-app, e-signature), quiz result where used |
| `incident` | type, severity, site, room, modality, patient (optional, restricted), worker(s) involved (restricted), reporter, occurred/reported timestamps, immediate actions, notifications required (SAHPRA, Department of Employment and Labour, Information Regulator, patient, referrer, scheme), investigation, root causes, contributing factors, corrective and preventive actions (CAPA), closure, learning summary |
| `complaint` | channel (patient, referrer, scheme, HPCSA, CMS, Consumer Goods and Services Ombud or other CPA route), complainant, subject, linked encounter or claim, severity, SLA, response drafts, resolution, escalation |
| `audit` | type (internal, funder, regulator, ISO-style, POPIA, AI), scope, auditor, schedule, checklist, findings (non-conformances with grading), CAPA links, report |
| `risk` | title, category (clinical, radiation, information, financial, operational, legal, reputational, AI), owner, inherent likelihood and impact, controls, residual rating, review date, linked incidents and audits, appetite flag |
| `capa` | source (incident, complaint, audit, risk), action, owner, due, evidence of completion, effectiveness check date and result |
| `document` | controlled document with version, approvals, distribution, obsolete-marking |
| `committee` | name, members, terms of reference, meeting cadence, minutes, actions |
| `data_subject_request` | type (access, correction, deletion, objection, PAIA request), requester identity verification, received, statutory clock, response, fees where PAIA permits |
| `breach` | incident of the data-breach type with the Information Regulator notification record and data-subject notifications |

## 3. Compliance calendar

### 3.1 Obligation catalogue

The catalogue is reference data: each obligation type has a legal reference, an owner role and a
due-date rule. Specific dates, fee amounts and thresholds are stored as configurable reference data
and labelled illustrative where uncertain. The list below is the launch catalogue.

| Domain | Obligation | Level | Frequency and notes |
|---|---|---|---|
| Radiation (SAHPRA Radiation Control, Hazardous Substances Act 15 of 1973) | Licence to use each X-ray, CT, mammography, fluoroscopy and DXA unit at a named address with a named licence holder and RPO; amendments on relocation, replacement, disposal | Room/Modality | Per unit; renewal and inspection cycles as stated on the licence; the calendar reads expiry from M02 `room.licence expiry` |
| | Acceptance testing before clinical use; routine QA per the SAHPRA requirements for licence holders and the practice's QA programme | Modality | Per unit and per test frequency; results live in M10; calendar tracks due and overdue |
| | Radiation worker registration, personal dosimetry, dose record retention, medical surveillance where required | Worker | Continuous; M10 and M17 feed status |
| | Reporting of radiation incidents and accidental over-exposure to the regulator | Event | Per incident (see 5) |
| | RPO appointment and training currency | Site | Per licence holder |
| Medical devices (SAHPRA) | Vendors' establishment licences and device status captured at procurement; AI models classified as software as a medical device where applicable, with the AIO's regulatory file (M11) | Asset/Model | Per purchase; per model version |
| HPCSA | Registration and annual renewal for RGT, RAD; CPD; practice ethics (advertising, fee sharing, incorporation rules, informed consent, record keeping) | Worker/Practice | Annual; continuous; evidence from M17 |
| BHF PCNS | Practice number currency and correct particulars (principals, address, discipline codes); updates on any change | Practice | On change; annual verification |
| CMS and funders | DSP and network contract obligations (tariff schedules, reporting, audit access, service standards); PMB compliance; complaints handling standards | Practice | Per contract; the calendar reads contract terms from M02 `agreement` |
| POPIA (Act 4 of 2013) | Information Officer (and deputies) designated and registered with the Information Regulator; PAIA manual (s.51) published and current; processing register; consent and notice wording; operator agreements; data-subject request handling; breach notification (s.22); prior authorisation where applicable (s.57); cross-border transfer conditions (s.72) | Group/MSO/Practice | Registration once and on change; manual reviewed annually; requests within statutory periods; see 15 for the control mapping |
| PAIA | Manual, request handling within 30 days (extendable once), fee schedule | Entity | Per request |
| Occupational Health and Safety Act 85 of 1993 | Appointment letters (s.16(2)), health and safety representatives and committee, first aiders, fire equipment servicing, incident reporting to the Department of Employment and Labour (s.24) and record keeping, risk assessments, hazardous chemical and biological agent registers, ergonomics for reading rooms | Site | Appointments on change; committee meetings quarterly (illustrative); fire equipment annually |
| COIDA | Registration with the Compensation Fund, annual return of earnings, letter of good standing, reporting of injuries on duty within the statutory period | Employing entity | Annual; per event |
| SARS | VAT returns, PAYE (EMP201 monthly, EMP501 reconciliations), provisional and annual income tax, tax clearance status | Entity | Per SARS cycle; dates as configurable reference data; M15 produces the figures |
| CIPC | Annual returns within the window after the incorporation anniversary; beneficial ownership declarations; changes of directors and registered office | Entity | Annual and on change; M02 director records feed the filing |
| B-BBEE | Verification certificate or sworn affidavit (by entity size) renewed annually; ownership data with consent (M02 §7) | Entity | Annual |
| Municipal and provincial | Fire clearance and occupancy certificates, business licences where required, provincial health establishment licensing where the province requires it for imaging facilities (configurable per province), signage and zoning | Site | Per site; per municipality rules |
| Employment | BCEA compliance (M17), Employment Equity reporting where headcount thresholds apply, Skills Development levies and workplace skills plans, UIF | Employing entity | Annual; monthly |
| Clinical governance | Radiation safety committee, morbidity and mortality or discrepancy meetings, infection-control committee, AI safety committee, peer-review programme, critical-results audit | Practice/Group | Cadence per terms of reference |
| Accreditation (optional) | Practice-selected programmes (COHSASA-style facility accreditation, ISO 9001, ISO/IEC 27001 for the MSO); requirements mapped to Platform evidence | Entity | Per programme cycle |
| Contracts and insurance | Professional indemnity for principals, public liability, equipment and cyber insurance renewals; lease and service contract expiries (M18) | Entity/Site | Per policy term |

* M19-R-100 Every obligation MUST be an instance of a catalogued obligation type with a legal or
  contractual reference, an owner, a due-date rule and an evidence checklist.
* M19-R-101 The calendar MUST derive due dates from source data wherever it exists (licence expiry in
  M02, credential expiry in M17, contract terms in M02, QA schedule in M10) rather than from
  manually typed dates.
* M19-R-102 An obligation whose due date has passed without a recorded submission or extension MUST
  be Critical in the CMP console and reported in the monthly governance pack to EXE and SHR.

### 3.2 Process: running the calendar

**Trigger**: daily scheduler; any source-data change (new modality, new worker, contract renewal).

**Happy path**
1. The scheduler instantiates calendar items for the coming 12 months and updates reminders
   (default 120/90/60/30/7 days; per type configurable).
2. The Compliance Hand assembles the evidence checklist for each item as it enters its window:
   QA results from M10, credential files from M17, financial figures from M15, director data from M02,
   incident logs from M19.
3. For items requiring a submission (licence renewal form, return of earnings, annual return, PAIA
   manual update), the Hand drafts the submission document or form data from the evidence and stores
   it as a draft on the item.
4. CMP reviews the draft, corrects it, and records the submission (portal reference, e-mail, courier),
   or delegates to the accountable officer (public officer for SARS, company secretary for CIPC).
5. The Hand tracks the acknowledgement or outcome (licence issued, certificate received) and closes
   the item with the evidence attached.
6. Missed reminders escalate: assignee, then CMP, then EXE.

**Variants**: obligations that a third party fulfils (an external accountant for SARS, the hospital
partner for building certificates at a hospital-based site) are still tracked; the third party is a
counterparty with an evidence upload link. Group-level obligations aggregate Practice-level status
(a Group view showing licence currency across 300 sites in one heatmap).

**Automation level**: A3 for evidence and drafts; A1 for submission.

## 4. Policies and acknowledgements

The policy library holds controlled documents (see 10): clinical (radiation protection programme,
contrast administration, MRI safety, pregnancy screening, paediatric imaging, critical results),
information (POPIA privacy policy, acceptable use, information security, AI use policy), people
(code of conduct, incident reporting, whistle-blowing under the Protected Disclosures Act, harassment,
leave), commercial (billing ethics, gifts and inducements per HPCSA rules, referrer relationships).

Each policy version has an applies-to scope; workers in scope receive an acknowledgement task on
publication and at onboarding (M17 §2.8). Acknowledgements are recorded with version, timestamp and
optional comprehension check. CMP sees acknowledgement coverage per policy and per site.
Unacknowledged mandatory policies after the grace period restrict nothing clinical (patients come
first) but appear as a PRM task and a KPI.

* M19-R-103 Policies MUST be versioned controlled documents; an acknowledgement MUST bind to a
  version; the Platform MUST report coverage per policy version by role and site.

## 5. Incident and adverse-event management

### 5.1 Taxonomy and severity

| Type | Examples | Mandatory external notification (as applicable) |
|---|---|---|
| Wrong patient, wrong study, wrong site or side | Study performed on wrong patient; contralateral knee imaged | Patient and referrer disclosure; SAHPRA where an unintended exposure occurred |
| Radiation over-exposure or unintended exposure | Repeat CT due to protocol error; exposure of an undeclared pregnancy; dose far above DRL | SAHPRA Radiation Control per licence conditions; patient disclosure; RPO investigation |
| Contrast reaction or extravasation | Mild to severe reactions, anaphylaxis, contrast-associated kidney injury signals, extravasation | Product vigilance report to SAHPRA and the supplier where a product problem is suspected; lot linked (M18) |
| MRI safety event | Projectile, burn, implant event, quench | Manufacturer and SAHPRA (device) where a device is implicated |
| Patient fall or injury | Falls from tables, trolleys; sedation events | Insurer; OHS Act where a worker is also injured |
| Needle-stick and body-fluid exposure | Sharps injury to NUR/RAD | COIDA injury-on-duty; post-exposure prophylaxis pathway within the clinical window; OHS Act reporting where required |
| Occupational injury | Manual handling, slips, assault | OHS Act s.24 reporting to the Department of Employment and Labour where reportable; COIDA claim |
| Data breach or privacy incident | Report sent to wrong referrer; lost device; unauthorised access; ransomware | Information Regulator and data subjects under POPIA s.22 (see 15); scheme where claim data affected |
| Equipment failure with patient impact | Table collapse, tube failure during exposure, software fault causing wrong dose | SAHPRA device vigilance where applicable; M18 work order |
| Critical result communication failure | Critical finding not acknowledged within the SLA (M13) | Referrer and patient safety follow-up |
| AI-related event | Model output reached a surface without its verification tier (an AI slip); model degraded silently | AIO; SAHPRA where a registered SaMD is implicated; internal AI safety committee |
| Near miss | Any of the above caught before harm | None; encouraged and rewarded |

Severity is graded on a four-level matrix of actual or potential harm and likelihood of recurrence
(stored as configurable reference data). The highest level triggers an immediate CMP and EXE alert,
a same-day disclosure decision, and a formal root-cause analysis.

### 5.2 Process

**Trigger**: a worker reports in any console ("Report an incident" is one tap on every surface),
a patient or referrer complaint, a Hand detects a pattern (M13 SLA breach, M10 dose outlier, M08
repeat exposure on the same accession), or M11 detects an AI slip.

**Actors**: reporter, PRM (immediate response), CMP (owner), RPO (radiation), Information Officer
(data), RGT (clinical review), BIO (equipment), AIO (AI), Compliance Hand.

**Happy path**
1. Report captured in under two minutes: type, what happened, where, who was affected, immediate
   actions; the Platform attaches context automatically (study, modality, dose from M10, operator,
   worklist events, contrast lot).
2. Severity proposed by the Platform from the taxonomy and context (annotated as a suggestion);
   PRM confirms or changes it.
3. Immediate safety actions checklist for the type (for over-exposure: RPO informed, patient dose
   estimated, referrer informed; for needle-stick: source patient testing consent, post-exposure
   prophylaxis pathway; for data breach: containment steps from the 15 runbook).
4. Disclosure decision recorded: to the patient (HPCSA ethical duty of candour), the referrer, the
   scheme, the regulator; the Compliance Hand drafts the notifications with the facts known and CMP
   approves each.
5. Investigation: a structured root-cause method (contributing-factor framework: patient, task,
   individual, team, environment, equipment, organisation), interviews, timeline from Platform
   events (immutable audit trail), findings.
6. CAPA created with owners and due dates; effectiveness check scheduled.
7. Learning: a de-identified learning summary is published to the relevant roles across the Group
   (a wrong-side event at one site becomes a checklist change at all sites); linked to CPD.
8. Closure by CMP; the incident feeds the risk register and the governance pack.

**Variants and exceptions**: anonymous reporting (a reporter may withhold their identity; the
Platform still records the site and time); a worker involved in an incident sees only their own
statement and the learning summary; incidents involving a Hand are also reviewed by AIO and M20's
audit stream is attached; incidents at hospital-based sites are mirrored to the hospital's system by
agreement.

**Automation level**: capture A1; context attachment and draft notifications A3; severity A1;
closure A0 (CMP).

* M19-R-104 The Platform MUST support incident reporting from every persona surface, including the
  kiosk and the staff app offline, with sync when connectivity returns.
* M19-R-105 An incident's timeline MUST be reconstructable from immutable Platform events without
  relying on the reporter's memory; the reconstruction MUST be attached to the investigation.
* M19-R-106 Incidents graded at the highest severity MUST alert CMP and EXE within five minutes and
  MUST NOT be closable without a completed root-cause analysis and CAPA.

## 6. Complaints

Channels: Patient Space and WhatsApp ("I have a complaint"), front desk, referrer portal, scheme
or administrator (usually about billing, sent to the Practice or via the CMS complaints route),
HPCSA (professional conduct complaints against a registered practitioner), the Consumer Protection
Act routes (National Consumer Commission, an ombud), social media (captured by the contact centre).

Each complaint has a category (clinical, service, billing, privacy, facility, staff conduct), an
SLA (acknowledge within one working day; resolve or give a substantive response within a
configurable period, with scheme and regulator deadlines taking precedence), a linked encounter or
claim, and a response trail. The Compliance Hand drafts acknowledgements and, from the encounter
record, a fact summary for the responder; CMP or PRM signs responses. Complaints that reveal harm
open an incident. HPCSA and CMS matters are flagged as legal and route to the responsible principal
and the Group's legal adviser; the Platform stores correspondence and the practitioner's response
drafts under legal-hold marking.

Billing complaints from members ("I did not know I would owe this") link to the quote and Collect
card (M06, M14) so the response can show what the patient was told and when; the KPI "quote accuracy"
is the Group's structural answer to this complaint class.

* M19-R-107 Every complaint MUST be acknowledged within the channel SLA and linked to its source
  objects; scheme and HPCSA complaints MUST carry their external reference numbers and deadlines in
  the compliance calendar.

## 7. Audits

| Audit type | Who | Platform support |
|---|---|---|
| Internal (self-inspection against the compliance catalogue, radiation safety, infection control, records, billing accuracy) | CMP, PRM, RPO | Checklists with evidence links; sampling from M08/M12/M14 (for example, 30 random signed reports per radiologist per quarter for peer review; 50 random claims for coding accuracy) |
| Funder (scheme claims audit, DSP contract audit, fraud-waste-abuse review) | PAY | Audit workspace: the funder's request, scope, a consent-checked disclosure set (only the claims and clinical records in scope, with a recorded lawful basis), response deadlines, findings, recoveries disputed or accepted (M14) |
| Regulator (SAHPRA inspection, Department of Employment and Labour, Information Regulator, HPCSA inspection of a practice) | Regulator | Inspection pack in one click: licences, QA, dosimetry, RPO appointment, policies, training records, incident register; inspector findings captured and CAPA linked |
| ISO-style and accreditation | External assessor | Requirement-to-evidence mapping; nonconformance register; management review minutes |
| POPIA and security | Information Officer, external assessor | Processing register, access reviews, breach log, operator agreements, penetration test reports (15) |
| AI (model governance) | AIO, clinical safety committee | Model registry entries, validation reports, monitoring dashboards, override rates, slip log (M11) |

Findings are graded (major, minor, observation), owned and closed through CAPA. Repeat findings
raise the residual rating of the linked risk.

* M19-R-108 The Platform MUST produce a regulator inspection pack for a Site in under five minutes
  with every document current at the time of generation and an index of evidence hashes.
* M19-R-109 Funder audit disclosures MUST be limited to the scope requested, logged as a disclosure
  event per patient with the lawful basis, and available to the patient in their access log.

## 8. Risk register

Risks are owned, rated on a 5×5 likelihood-and-impact matrix (configurable), linked to controls that
are themselves Platform objects where possible (a control "licence expiry blocks scheduling" is
M02-R-006 and its evidence is the block log), and reviewed on a cycle by category. The register is
seeded with the sector's standard risks: unlicensed or overdue-QA equipment in use; radiation
over-exposure; missed critical finding; wrong patient; contrast reaction without a trained
responder on site; data breach; ransomware; load-shedding damage to MRI; claim rejection backlog
and cash-flow; HPCSA ethical breach through referrer inducements; key-person dependency on a single
radiologist; AI model drift; vendor lock-in; regulatory change (NHI Act implementation). Residual
ratings above appetite create EXE tasks and appear in the SHR portal as a governance item.

## 9. Clinical governance committees

| Committee | Cadence (illustrative) | Inputs from the Platform |
|---|---|---|
| Radiation safety committee (chaired by the RPO) | Quarterly | Dose vs DRL (M10), QA compliance, over-exposure incidents, dosimetry outliers, licence status |
| Discrepancy and peer-review meeting | Monthly | Peer-review scores (M12), addenda, critical-result audit (M13), learning cases de-identified |
| Infection prevention and control committee | Quarterly | Cleaning logs (M18), needle-stick incidents, outbreak notices, PPE stock |
| AI safety committee (AIO chair, RGT members, CMP) | Monthly | Model performance (M11), override rates, slip log, new model approvals, Hand leash changes |
| Quality and risk committee (CMP chair, EXE sponsor) | Quarterly | Compliance calendar status, incidents and complaints trend, audits, risk register, CAPA ageing |
| Health and safety committee (OHS Act) | Quarterly | Occupational incidents, inspections, fire drills |

Minutes and actions are Platform objects; actions become CAPA items; attendance counts as CPD where
the activity is accredited.

## 10. Document control

Controlled documents (policies, procedures, protocols, forms, QA test procedures, the PAIA manual,
consent forms in each language) have: unique identifier, version, author, reviewer, approver,
effective and review dates, distribution scope, change history, and an obsolete state that keeps the
old version readable but marks every rendered copy "obsolete". Consent forms and patient information
leaflets are linked to M07 so that the version shown to a patient is recorded with the consent
event. Translations are versions of the same document with a translation-approval record.

* M19-R-110 A document MUST NOT be available for use in any workflow (consent, checklist, protocol
  card) unless it is in the approved, effective state; the version used MUST be recorded on the
  transaction.

## 11. Radiation protection programme

The programme is a policy set plus live data: licence register (M02), RPO appointments, QA
schedules and results (M10), dosimetry (M10, M17), DRLs and dose audits, pregnancy screening (M07),
shielding surveys (M18), warning signage and controlled-area rules, training records, incident
procedures and the regulator liaison log. M19 renders it as one page per Site that is always
inspection-ready. Over-exposure investigations follow 5.2 with the RPO as investigator and the
patient's estimated dose recorded in M10 and disclosed to the patient and referrer.

## 12. Infection prevention and control

Aligned to national IPC guidelines: hand hygiene audits, cleaning schedules per room and modality
(ultrasound probe reprocessing by risk class), isolation and outbreak procedures (a TB or measles
exposure pathway including contact tracing from the appointment log), sharps management, waste
streams (health-care risk waste contractor certificates as obligations), staff vaccination records
(voluntary, restricted), PPE stock (M18). Audits use checklists with photo evidence.

## 13. Business continuity

| Threat | Plan on the Platform |
|---|---|
| Load-shedding and grid failure | Site readiness record (M18); Edge Gateway keeps imaging and worklists running; patient notifications from M05/M13 for affected slots; manual downtime forms only when the gateway itself fails; recovery checklist |
| Connectivity loss | Edge Gateway offline mode; store-and-forward; WhatsApp and SMS queued; reading continues on cached priors; escalation to the ISP with ticket tracking |
| Cyber incident | 15 §13 runbook; isolation of the site network; imaging continues on the gateway if uncompromised; communications plan; Information Regulator assessment |
| Water, fire, flood, civil unrest | Site closure procedure; patient re-routing to nearest sites; staff safety check-in via the staff app; insurer notification |
| Key-person loss (single radiologist) | Hub reading agreement fallback (M02); credentialing of locum RGTs |
| Supplier failure (contrast shortage, switch outage) | Alternative supplier list (M18); switch fallback channel (14) |
| Platform outage | 07 §10 DR targets; status page; downtime procedures per persona |

Each plan has a test schedule (tabletop annually, technical DR quarterly per 07) whose results are
calendar items with evidence.

## 14. The Compliance Hand

| Attribute | Definition |
|---|---|
| Mandate | Keep the compliance calendar current and evidenced; draft submissions, notifications and responses; chase expiring items; prepare audit and inspection packs; summarise incidents for learning |
| Tools | read all M19 objects and the evidence sources (M02, M10, M15, M17, M18, M11 read models); create and update calendar items, checklists and drafts; message owners and counterparties for missing evidence; generate packs; create tasks for CMP, PRM, RPO, Information Officer, AIO |
| Leash | MUST NOT submit anything to a regulator, council, funder or court; MUST NOT send external incident or breach notifications; MUST NOT change severity, close incidents or alter risk ratings; MUST NOT disclose identified patient data outside the Practice; MAY send internal reminders and evidence requests without approval; drafts are always rendered in the annotated style until CMP accepts |
| Escalation | Any obligation within 30 days without evidence; any highest-severity incident; any data-subject request at 50 % of its statutory clock; any funder audit request with a deadline under 10 working days |
| Audit | All drafts, edits and acceptances are events; CMP's monthly report includes the Hand's proposal-acceptance rate |

Level: A3 for collection and drafting; A1 for all external acts.

* M19-R-111 The M20 runtime MUST enforce, at the tool layer, that no Hand possesses a tool capable of
  transmitting to an external regulator, council or funder on behalf of M19; such transmissions are
  human actions with a recorded approver.

## 15. Data-subject and PAIA requests (summary; detail in 15)

Requests arrive through the Patient Space, e-mail, or paper. The Platform verifies the requester's
identity (ID number match, OTP to the registered number; guardian proof for minors), opens a
`data_subject_request` with the statutory clock, collects the record set (studies, reports, claims,
audit log of disclosures), drafts the response, and CMP or the Information Officer approves release.
Images are delivered via the Patient Space share link rather than CDs unless the requester insists.
Third-party data (a referrer's private notes) is redacted per PAIA grounds with a recorded reason.

## 16. KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Licence and registration currency | Rooms, modalities and workers with all statutory items current | 100 % |
| Calendar on time | Obligations submitted before due date | 100 %; any miss is a governance item |
| Evidence completeness at T-30 | Items with full evidence 30 days before due | ≥ 95 % |
| Incident reporting rate | Incidents and near misses per 10 000 studies | Rising in year one (reporting culture), then stable; never a target to minimise |
| Highest-severity incident closure | Days from report to CAPA effectiveness check | ≤ 60 days |
| CAPA on time | CAPA closed by due date | ≥ 90 % |
| Complaint acknowledgement | Within one working day | 100 % |
| Complaint resolution | Within SLA per channel | ≥ 90 % |
| Policy acknowledgement coverage | Mandatory policies acknowledged by in-scope workers | ≥ 98 % |
| Audit findings ageing | Major findings open more than 90 days | 0 |
| Data-subject requests on time | Within statutory period | 100 % |
| Breach notification timeliness | Information Regulator notified as soon as reasonably possible, measured in hours from confirmation | Reported per event |
| Inspection pack generation time | Request to pack | ≤ 5 minutes |
| Compliance Hand acceptance | Drafts accepted with minor edits | ≥ 80 % |

## 17. Controls

| Control | Mechanism |
|---|---|
| Human-only external acts | Enforced by M20 tool allow-lists (M19-R-111); every external submission has a named human approver |
| Immutable evidence | Evidence files hashed and timestamped; incident timelines from append-only audit (15) |
| Restricted access | Incidents naming workers or patients, complaints under legal hold, health data of workers and pregnancy declarations restricted to named roles; cross-tenant visibility for Group is aggregated unless a lawful basis is recorded |
| Just culture | No disciplinary trigger from incident data; reporter identity protected; learning summaries de-identified; PRM cannot query incident reports by reporter |
| Segregation | The investigator of an incident cannot be the person primarily involved; CMP cannot approve their own policy without a second approver |
| Retention | Incident, complaint, licence and QA records retained per the 15 schedule (regulatory minimums, longer for radiation and occupational records) |
| Versioned reference data | Obligation catalogue, severity matrix, SLAs and fee tables versioned with effective dates and change approvals |
| Reporting | Monthly governance pack to EXE and SHR; quarterly committee packs; annual management review |

## Statutory register

The obligation catalogue in this document is operationalised as the statutory and regulatory
register in `24-statutory-and-regulatory-register.md`, which is the authoritative list of
instruments, obligations, controls, statutory outputs, the regulatory calendar, and the open items
awaiting legal confirmation. Where this document and 24 differ, 24 governs.
