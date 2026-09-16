# 24 — Statutory and Regulatory Register and Reportable Results

This document is the authoritative register of the South African statutes, regulations, rules and
guidelines that bind Bonakala, and of the **results** the Platform must produce for them: flags at
sign-off, notifications, registers, returns, submissions, certificates and evidence packs. It is
owned by CMP with the Group's legal advisers and is reviewed quarterly. Every row is implemented by
a module and produces an auditable output; where the exact legal position is not certain it is
marked **[confirm]** and carried in the open-items list in §7 until a legal opinion is filed.

Structure:
* §1 How the register works (obligation → control → output → evidence).
* §2 Statutory register by domain (clinical, radiation, devices and AI, information, funders and
  claims, corporate and tax, employment, consumer and credit, competition and transformation).
* §3 **Reportable imaging results**: findings that carry statutory or regulatory duties, who the
  legal notifier is, and what the Platform does at sign-off.
* §4 Statutory outputs the Platform generates (returns, registers, submissions, packs).
* §5 Regulatory calendar and evidence automation.
* §6 Requirements (M19-R-300 upward).
* §7 Open items requiring legal confirmation.

## 1. How the register works

Each obligation is modelled in M19 as an `obligation` record:

| Field | Meaning |
|---|---|
| Instrument | Act, regulation, rule, guideline, licence condition, contract clause |
| Section | Specific section or regulation number where known |
| Obligation | What must be done, by whom, by when |
| Responsible entity | Group, MSO, Practice, Site, individual practitioner |
| Owner persona | CMP, PRM, EXE, RGT, RAD, BIL, AIO |
| Trigger | Event or date that starts the duty (for example `report.signed.v1` with a reportable flag, licence expiry minus 90 days) |
| Control | The Platform behaviour that discharges or supports the duty (gate, task, draft, register entry) |
| Output | The statutory result: notification, form, return, register, certificate, pack |
| Evidence | What is stored to prove it (document, timestamp, acknowledgement reference) |
| Automation | A0 to A4; external submissions to regulators are never above A2 (Compliance Hand drafts, CMP or the named practitioner submits) |
| Status | Confirmed by legal opinion, or [confirm] |

The register is data, not code: obligations, deadlines and form names are reference data with
effective dates so that changes in law are configuration changes with an audit trail.

## 2. Statutory register

### 2.1 Clinical practice and health establishments

| Instrument | Obligation | Control (module) | Output / evidence |
|---|---|---|---|
| Health Professions Act 56 of 1974; HPCSA registration | Every radiologist, radiographer and sonographer holds current HPCSA registration in the correct category; annual renewal; practising without registration is an offence | M01 verifies HPCSA number at onboarding and on renewal cycle; M17 blocks rostering and M12 blocks signing for lapsed registration | Registration register; renewal evidence; block log |
| HPCSA Ethical Rules of Conduct (GN R717 of 2006 as amended) | Rules on ownership and sharing of fees (rule 7 and 8), naming of practices, advertising (rule 3, 4), impairment, supervision, informed consent, confidentiality; practice by juristic persons limited to registered practitioners | M02 models practices as practitioner-owned; MSO fee agreements structured as management fees not fee-sharing [confirm structure with HPCSA opinion]; brand and marketing review gate in M19 | Shareholders' agreements; management agreements; marketing approval log |
| HPCSA Booklet on keeping of patient records (Booklet 9) | Retain records for at least 6 years from date they became dormant; minors until 21st birthday; mentally incompetent patients for life; occupational health records longer [confirm periods]; records must be legible, dated, signed | M09/M21 retention classes; M12 signed and dated reports; audit trail | Retention schedule; destruction log with CMP approval |
| HPCSA General Ethical Guidelines for Good Practice in Telemedicine (2021 and later amendments) | Remote reporting permitted by registered practitioners with patient consent, secure systems and the same standard of care; the Reading Hub follows these | M12 Hub configuration; M07 consent records telemedicine reporting; M15 security | Hub policy; consent artefacts |
| HPCSA guidance on informed consent (Booklet 4) and financial consent | Patients informed of procedure, risks and costs before service | M06 Quote; M07 consent capture; Collect card | Signed consents; quote acceptance |
| National Health Act 61 of 2003, ss. 5 to 17 | Emergency treatment not refused; user informed of health status, treatment options and costs; confidentiality (s.14); access to records (s.15, s.16); records of health establishments (s.13, s.17: control of records, offences for unauthorised access) | M14 credit control never blocks urgent care; M13 results access; M15 access controls and s.17 audit of record access | Access audit log; disclosure register |
| National Health Act regulations: Office of Health Standards Compliance Norms and Standards Regulations (2018) | Health establishments comply with norms and standards; inspections | M19 self-assessment and evidence pack; M18 facilities | OHSC evidence pack |
| Certificate of need (National Health Act s.36 to s.40) | Not in operation (struck down 2023) [confirm current status]; monitor | M19 watch item | None |
| Regulations relating to the Surveillance and the Control of Notifiable Medical Conditions (GN R1434 of 2017) | Health care providers must notify listed conditions (Category 1 within 24 hours, Category 2 within 7 days) through the NMC system; see §3.1 | M12 reportable-result flag; M13 referrer pack | Flag record; notification support pack |
| Children's Act 38 of 2005, s.110 | Certain professionals (including medical practitioners) who on reasonable grounds conclude a child has been abused in a manner causing physical injury, sexually abused or deliberately neglected must report to a designated child protection organisation, provincial Department of Social Development or a police official; see §3.3 | M12 flag with mandatory guidance; M19 case record | Report evidence; case log |
| Older Persons Act 13 of 2006, s.26 | Any person who suspects abuse of an older person must report to the Director-General or a police official; see §3.3 | M12 flag; M19 case record | Report evidence |
| Criminal Law (Sexual Offences and Related Matters) Amendment Act 32 of 2007, s.54 | Duty to report knowledge of sexual offences against children or persons who are mentally disabled | M12 flag guidance; M19 case record | Report evidence |
| Medicines and Related Substances Act 101 of 1965 and Regulations | Contrast media are scheduled medicines: acquisition, storage, administration under a registered practitioner, cold-chain where applicable, records of stock and lot numbers, adverse drug reaction reporting to SAHPRA; possession and administration in a radiology practice without a dispensing licence permitted for administration in the course of treatment [confirm] | M18 contrast lot tracking; M07/M08 administration records; M19 ADR reporting task | Contrast register; ADR reports |
| Nursing Act 33 of 2005 | Nurses registered with SANC; scope of practice for IV cannulation and contrast administration | M01/M17 credential check | SANC register evidence |
| Mental Health Care Act 17 of 2002 | Consent and assisted or involuntary users (rare in imaging); guardians and curators | M07 consent variants | Consent record |
| Births and Deaths Registration Act | Not applicable to imaging | — | — |

### 2.2 Radiation and equipment

| Instrument | Obligation | Control (module) | Output / evidence |
|---|---|---|---|
| Hazardous Substances Act 15 of 1973; Regulations relating to Group III hazardous substances (electronic products); SAHPRA Radiation Control licensing | Every X-ray-emitting device (radiography, fluoroscopy, mammography, CT, DXA, dental) is licensed to a licence holder at a specific site; licence amendment on relocation, replacement, disposal; Radiation Protection Officer appointed; compliance with the Code of Practice for users of medical X-ray equipment; acceptance testing and periodic QC by an approved inspection body; inspections; incident reporting [confirm current code version and reporting timelines] | M02 licence per room and device with expiry; M05 blocks scheduling on unlicensed or QA-overdue devices; M10 QA schedule, RPO sign-offs; M18 disposal workflow triggers licence amendment | Licence register; QA certificates; inspection reports; amendment applications |
| Radiation incidents and overexposure (licence conditions) | Report significant incidents (unintended exposure, wrong patient, wrong site, repeated exposures beyond thresholds, equipment fault causing exposure, exposure of a pregnant patient without justification) to SAHPRA Radiation Control within the period specified [confirm period]; internal investigation | M19 incident with radiation category; Compliance Hand drafts the report; CMP and RPO submit | Incident report; SAHPRA acknowledgement |
| Personal dosimetry (licence conditions; Occupational Health and Safety Act) | Radiation workers monitored; dose records retained; dose limits observed; investigation levels | M10 dosimetry cycles and results; M17 radiation-worker registration | Dosimetry register |
| Diagnostic Reference Levels (SAHPRA guidance; national DRLs where published) | Compare typical doses to DRLs; investigate outliers | M10 DRL comparison; dose-outlier model | DRL review reports |
| Occupational Health and Safety Act 85 of 1993, s.24 and General Administrative Regulations | Report incidents causing death, unconsciousness, or injury likely to cause 14 days' absence to the Department of Employment and Labour within 7 days [confirm]; health and safety representatives and committees; risk assessments | M19 incident classification and notification task | Incident report; DoEL acknowledgement |
| Regulations for Hazardous Chemical Agents; MRI cryogens; pressure equipment | Safe handling of helium quench, pressure vessels and injectors | M18 facilities checks; M19 policies | Inspection evidence |

### 2.3 Medical devices and AI

| Instrument | Obligation | Control (module) | Output / evidence |
|---|---|---|---|
| Medicines and Related Substances Act; Medical Devices Regulations (GN R1515 of 2016); SAHPRA medical device licensing and registration; SAHPRA guideline on software as a medical device [confirm current guidance] | Manufacturers and distributors of medical devices, including software with a medical purpose, require SAHPRA licences; devices subject to registration call-up by class; the Platform's diagnostic-support models are software as a medical device and the Group is their manufacturer; third-party models must be supplied by licensed entities | M11 Model Registry holds regulatory status per model; activation gated on status; vendor licence evidence | Regulatory file per model; licence copies |
| SAHPRA medical device vigilance (adverse event reporting guideline) | Report adverse events and field safety corrective actions within the timelines for the severity class [confirm timelines]; keep complaint and trend records | M19 incident with device category; AIO and CMP submit; M11 kill switch and rollback | Vigilance reports; FSCA records |
| PACS, viewers and Edge Gateway as medical devices | Image display and management software may itself be a medical device depending on function [confirm classification for the Platform's viewer and PACS] | M19 regulatory assessment record | Classification opinion |
| Clinical trials and research (National Health Act s.71; Department of Health Ethics in Health Research guidelines; Research Ethics Committees) | Research use of images and data requires ethics approval and, for children and certain categories, ministerial consent | M11 training data manifests linked to ethics approvals; M21 de-identification | Ethics approvals; consent records |

### 2.4 Information, privacy and access

| Instrument | Obligation | Control (module) | Output / evidence |
|---|---|---|---|
| Protection of Personal Information Act 4 of 2013 (POPIA) | Eight conditions for lawful processing; health information is special personal information (s.26 to s.32: processing by health professionals and institutions permitted for proper treatment and administration, s.32); children's information (s.34, s.35); Information Officer registration and duties (s.55, s.56); PAIA manual; processing records; operator contracts (s.20, s.21); security measures (s.19); breach notification to the Regulator and data subjects (s.22); data-subject rights (s.23 to s.25); direct marketing consent (s.69); automated decision-making (s.71); cross-border transfers (s.72); prior authorisation (s.57) for certain processing including transfer of special or children's information to a foreign country lacking adequate protection and processing of unique identifiers for a different purpose [confirm applicability to cloud and LLM providers] | M15 controls; M07 consent; M19 data-subject request workflow; M21 processing register; M11 de-identification and DPA gating | Information Officer registration; PAIA manual; processing register; breach notifications; s.57 authorisation applications where required |
| Promotion of Access to Information Act 2 of 2000 (PAIA) | PAIA manual published; requests handled within 30 days (extendable) | M19 request workflow | PAIA manual; request log |
| Electronic Communications and Transactions Act 25 of 2002 | Electronic signatures and records; advanced electronic signature where a law requires a signature [confirm which consents]; data messages admissible | M07 e-signature; M12 electronic signing of reports; M21 record integrity | Signature audit |
| Cybercrimes Act 19 of 2020 | Offences relating to data and systems; preserve evidence; reporting duties fall on electronic communications service providers and financial institutions rather than health providers [confirm]; the Platform supports evidence preservation | M15 incident response; immutable logs | Forensic evidence packs |
| National Health Act s.14 to s.17 | Confidentiality; disclosure only with consent, court order or law; access by health workers for legitimate purposes only; offences | M15 ABAC; break-glass; disclosure register | Disclosure register |

### 2.5 Funders, claims and pricing

| Instrument | Obligation | Control (module) | Output / evidence |
|---|---|---|---|
| Medical Schemes Act 131 of 1998 and Regulations | Claims must carry the information the scheme requires (practice number, ICD-10 codes, tariff codes); Regulation 6 timelines: claim submitted within 4 months of service date; scheme pays or notifies within 30 days; correction period 60 days [confirm exact wording]; Regulation 8 PMBs paid in full at DSP; scheme rules on co-payments and networks; balance billing and disclosure | M14 required-field scrubber, submission deadlines, PMB flags, correction workflow | Claim files; submission timestamps; rejection and correction logs |
| Council for Medical Schemes rulings, circulars and Section 59 investigation outcomes | Fair treatment of providers in claims audits and fraud, waste and abuse processes; keep records for audits | M14 audit packs; M19 funder audit disclosure log | Audit responses |
| BHF Practice Code Numbering System (PCNS) terms | Practice number obtained and maintained; details current; disciplines correct | M02 practice number lifecycle | PCNS certificates |
| Health Market Inquiry recommendations; Competition Commission guidance on tariff determination | No collective tariff setting; practice fee schedules set independently; transparency of fees to patients | M06 pricing governance; M14 fee schedules per practice | Fee-schedule approval records |
| Road Accident Fund Act 56 of 1996 and Regulations | Claims lodged by claimants with prescribed forms (RAF 1); serious injury assessment report (RAF 4) by a medical practitioner; supplier claims and undertakings (s.17(4)(a)) [confirm current procedures]; prescription periods | M06 RAF funding case; M14 RAF debtor class; M13 medico-legal pack with chain of custody | RAF packs; undertaking records |
| Compensation for Occupational Injuries and Diseases Act 130 of 1993 (COIDA) | Employer reports accidents (W.Cl.2) and occupational diseases (W.Cl.1); medical practitioner submits first medical report (W.Cl.4 accident, W.Cl.22 occupational disease) and progress or final reports [form names confirm]; accounts submitted to the Compensation Fund or licensed mutual association on prescribed tariffs; time limits | M06 COIDA case with employer letter and claim number; M14 COIDA claim format; M12 medical report templates | COIDA submissions; acknowledgements |
| Occupational Diseases in Mines and Works Act 78 of 1973 (ODMWA) | Benefit medical examinations including chest radiographs; certification by the Medical Bureau for Occupational Diseases (MBOD); compensation via the Compensation Commissioner for Occupational Diseases (CCOD); ILO classification of radiographs by readers; record retention | M04 ODMWA batch orders; M12 ILO classification template and reader qualification; M13 submission pack to MBOD; M09 extended retention | ILO reports; MBOD submission records |
| National Health Insurance Act 20 of 2023 (assented 2024; sections commenced by proclamation) | Accreditation of providers, contracting units, standardised claims when in force | M02 accreditation record; M14 funder-agnostic claims | Watch item; readiness checklist |
| Consumer Protection Act 68 of 2008 | Plain-language terms; disclosure of prices; fair marketing; complaints handling; cooling-off for direct marketing | M06 Quote; M14 statements; M19 complaints | Quote acceptance; complaint records |
| National Credit Act 34 of 2005 | Payment plans structured as incidental credit agreements (no interest or charges beyond the Act's incidental-credit provisions) [confirm structure]; collections conduct | M14 plan templates; Collections Hand leash | Plan agreements |
| Debt Collectors Act 114 of 1998; Prescription Act 68 of 1969 | Only registered debt collectors; prescribed debt (3 years for ordinary debts) not pursued as if enforceable | M14 handover approvals; prescription checks | Handover log |
| Value-Added Tax Act 89 of 1991 | Medical services by private practitioners are standard-rated at 15 %; tax invoices with prescribed content; VAT returns (VAT201) | M14 tax invoices; M15 VAT accounting and return exports | Tax invoices; VAT201 exports |

### 2.6 Corporate, tax and transformation

| Instrument | Obligation | Control (module) | Output / evidence |
|---|---|---|---|
| Companies Act 71 of 2008 | Incorporation; memorandum of incorporation aligned to HPCSA ownership rules; annual returns (CoR 30.1) and beneficial ownership filings (2023 amendments); solvency and liquidity test before distributions (s.46); financial statements and independent review or audit by public interest score; director duties; reserved matters in shareholders' agreements | M02 entity register with filing calendar; M15 distribution approvals with s.46 test record | CIPC filings; s.46 resolutions; AFS |
| Income Tax Act 58 of 1962 | Provisional tax; dividends tax withholding (20 % illustrative) and returns; PAYE; tax clearance | M15 tax computations and exports | Returns; certificates |
| Tax Administration Act 28 of 2011 | Record retention (5 years illustrative); SARS e-invoicing readiness | M15 retention | Archive |
| Broad-Based Black Economic Empowerment Act 53 of 2003 and Codes | Annual verification for entities above thresholds; ownership, management, skills, enterprise and supplier development, socio-economic development scorecards | M02 ownership analytics (consented demographics); M17 skills spend; M18 supplier data | Verification evidence |
| Competition Act 89 of 1998 | Merger notification when acquiring practices above thresholds (small, intermediate, large: thresholds illustrative and updated by notice); no coordination on fees between competitors | M02 acquisition workflow with merger-threshold check; M19 legal review gate | Notification filings |
| Financial Intelligence Centre Act 38 of 2001 | Not an accountable institution [confirm]; bank KYC | — | — |
| Trade Marks Act 194 of 1993; Copyright Act 98 of 1978 | Register the Bonakala mark; fonts and assets licensed; no infringing use | Brand clearance protocol (05 §1.1) | Trade mark certificates; licence files |

### 2.7 Employment and workplace

| Instrument | Obligation | Control (module) | Output / evidence |
|---|---|---|---|
| Basic Conditions of Employment Act 75 of 1997 | Hours, overtime, rest periods, night work, leave; written particulars | M17 roster rule pack | Roster compliance reports |
| Labour Relations Act 66 of 1995 | Fair procedures; disputes | M17 case records | HR files |
| Employment Equity Act 55 of 1998 | Designated employers submit EE reports and plans | M17 EE reporting export | EEA2 and EEA4 exports (illustrative form names) |
| Skills Development Act 97 of 1998 and Skills Development Levies Act | Workplace skills plan and annual training report to the SETA; levy | M17 training records | WSP and ATR exports |
| Unemployment Insurance Act 63 of 2001; COIDA employer duties | UIF and COIDA registration; return of earnings; letter of good standing | M15/M17 registers | Certificates |
| Occupational Health and Safety Act | Health and safety representatives, first aid, incident reporting, medical surveillance of radiation workers | M19 OHS programme | OHS evidence |
| Protection from Harassment Act; Employment Equity harassment code | Policies and complaint channels | M19 policies | Acknowledgements |

## 3. Reportable imaging results

Imaging findings can trigger legal duties. In almost every case the **legal notifier is the
treating or diagnosing practitioner**, not the radiologist, and a radiological appearance is not a
diagnosis. The Platform therefore never notifies a regulator from a report by itself. It does four
things: it lets the radiologist raise a **reportable-result flag** at sign-off, it makes sure the
referrer receives and acknowledges that flag, it gives the practice and the referrer a ready
notification support pack, and it tracks the flag to closure so nothing is lost. Where the
radiologist personally holds a statutory duty (for example under the Children's Act as a medical
practitioner), the Platform provides the form, the guidance and the record.

### 3.1 Notifiable medical conditions

| Finding pattern | Legal basis | Notifier | Platform behaviour |
|---|---|---|---|
| Radiographic pattern suggestive of pulmonary tuberculosis (adult or child); miliary pattern; TB spine | Tuberculosis is a notifiable medical condition under the 2017 NMC Regulations (category and period per current schedule [confirm]) | The health care provider who makes the clinical or laboratory diagnosis (usually the referrer) | Radiologist selects "TB-suggestive: consider notifiable medical condition" at sign-off; the report carries a standard statement; the referrer's delivery requires acknowledgement; the referrer pack includes NMC guidance and the NMC notification channel; unacknowledged flags escalate through the Critical Results Hand as an urgent (not critical) category; occupational health referrers for miners see the ODMWA path as well |
| Other imaging patterns associated with notifiable conditions (for example suspected congenital rubella, hydatid disease, some encephalitides) [confirm list] | NMC Regulations | Diagnosing practitioner | Same flag mechanism with the condition selected from the NMC reference list |
| Silicosis, asbestos-related disease, pneumoconiosis, occupational asthma-related findings | COIDA occupational disease reporting (employer and medical practitioner); ODMWA for mineworkers; also relevant to NMC reporting of certain occupational conditions [confirm] | Employer reports; treating practitioner completes medical reports; MBOD certification for miners | Flag "possible occupational lung disease"; ILO classification when ordered under ODMWA; pack for employer and occupational health practitioner; extended retention class |

### 3.2 Occupational and compensation results

| Result | Duty | Platform behaviour |
|---|---|---|
| ODMWA benefit medical examination chest radiograph | ILO-classified reading by a qualified reader; submission to MBOD; records retained for the statutory period | M12 ILO template with reader qualification check; M13 MBOD pack; M09 retention class `occupational` |
| COIDA injury on duty imaging | First and progress medical reports by the treating practitioner; accounts to the Compensation Fund on prescribed tariffs | M06/M14 COIDA case; report templates that include the fields the medical reports need; claim format per fund |
| RAF accident imaging | Reports become evidence; RAF 4 serious injury assessment by a medical practitioner | M13 medico-legal pack with hashes and chain of custody; disclosure log |

### 3.3 Abuse and safeguarding

| Finding pattern | Legal basis | Notifier | Platform behaviour |
|---|---|---|---|
| Fracture patterns and injuries suspicious for non-accidental injury in a child (metaphyseal corner fractures, posterior rib fractures, fractures of differing ages, unexplained skull fractures, and similar) | Children's Act s.110 mandatory reporting by listed professionals including medical practitioners; the radiologist may personally hold the duty when they form the reasonable conclusion | Radiologist and referrer; institution supports | Radiologist selects "suspected non-accidental injury (child)"; the report uses guarded standard wording; the Platform triggers an immediate call via the Critical Results Hand to the referrer, opens a safeguarding case in M19 with the s.110 form (Form 22 [confirm]) pre-filled from demographics, and records who reported, to whom, and when; results release to the Patient Space is withheld pending clinician review; a skeletal survey protocol is offered |
| Injuries in an older person suggestive of abuse or neglect | Older Persons Act s.26 duty on any person who suspects abuse | Radiologist and referrer | Same case mechanism with the s.26 report route |
| Imaging findings suggesting sexual abuse of a child or a person with a mental disability | Sexual Offences Act s.54 | Any person with knowledge | Same case mechanism |
| Gunshot, stab or assault injuries in adults | No general statutory reporting duty for adults in South Africa [confirm]; medico-legal documentation standards apply | Treating practitioner at their discretion and patient consent | Report wording preserves forensic detail; medico-legal pack on request |

### 3.4 Radiation and device events discovered in images or records

| Event | Duty | Platform behaviour |
|---|---|---|
| Wrong patient, wrong site or side, wrong protocol, unintended repeat exposure, exposure of a pregnant patient without justification | Radiation incident under licence conditions; internal investigation; SAHPRA report where thresholds met [confirm] | M08/M12 raise incident automatically from mismatches and from radiologist flag; M19 investigation; Compliance Hand drafts the SAHPRA report; RPO and CMP submit |
| Dose outlier above investigation level | Licence conditions and DRL guidance | M10 investigation task; register entry |
| Equipment malfunction affecting images or dose | Device vigilance (user reporting encouraged; manufacturer must report); licence incident reporting where dose affected | M18 fault record; M19 vigilance task; vendor notified |
| AI model failure with potential for harm | SAHPRA vigilance for software as a medical device | M11 incident; kill switch; AIO and CMP report (12) |

### 3.5 Public health and other flags

| Result | Duty | Platform behaviour |
|---|---|---|
| Cancer diagnoses (histologically confirmed) | National Cancer Registry notification is a duty of pathology laboratories and, for clinical diagnoses, the treating clinician under the Cancer Registry Regulations (2011) [confirm scope] | Radiologist flag "suspicious for malignancy" ensures referrer acknowledgement and follow-up tracking; no direct notification by the Platform |
| Screening mammography programme results | Programme protocol (recall rates, double reading, audit) | M12 double-read support; M13 recall management; programme statistics |
| Incidental findings requiring follow-up | Standard of care and HPCSA duty to communicate | Follow-up Hand tracks to closure; lost-to-follow-up KPI |

### 3.6 Flag mechanics (M12 and M13)

1. The radiologist selects one or more reportable-result categories from the configurable list.
2. The report carries a standard, legally reviewed statement for that category (no free-text
   improvisation of legal wording).
3. Delivery to the referrer requires acknowledgement; the acknowledgement window is category-specific
   (safeguarding: immediate call plus acknowledgement; notifiable condition: within 24 hours).
4. A reportable-result record is created in M19 with the referrer, the category, the pack sent, the
   acknowledgement, and, where the practice or radiologist is the notifier, the submission evidence.
5. Patient-facing release rules apply (withhold pending referrer contact for safeguarding and
   malignancy categories by default).
6. Analytics report flags raised, acknowledged and closed, by category and site; unclosed flags
   escalate weekly to PRM and CMP.

## 4. Statutory outputs the Platform generates

| Output | Frequency or trigger | Module | Automation |
|---|---|---|---|
| Radiation licence register and renewal/amendment applications | Continuous; 90 days before expiry; on device move or disposal | M02, M18, M19 | A2 (Compliance Hand drafts; RPO and CMP submit) |
| QA and acceptance test register with certificates | Per schedule | M10 | A2 |
| Personal dosimetry register | Per badge cycle | M10 | A2 |
| Radiation incident reports | On incident | M19 | A2 |
| Device vigilance reports and complaint trend records | On event; periodic | M19, M11 | A2 |
| SaMD regulatory file per model (technical file, clinical evaluation, risk management, post-market surveillance plan) | Per version | M11 | A1 |
| POPIA processing register; Information Officer registration; PAIA manual; data-subject request responses; breach notifications | Continuous; on request; on breach | M19, M15 | A2 (breach notifications drafted, CMP submits) |
| s.57 prior authorisation applications where applicable | On new processing | M19 | A1 |
| Notifiable-condition and safeguarding support packs | On flag | M13, M19 | A2 |
| ILO classification reports and MBOD submission packs | Per ODMWA examination | M12, M13 | A2 |
| COIDA medical report templates and claim files | Per case | M12, M14 | A2 |
| RAF medico-legal packs | On request | M13 | A2 |
| Claims files compliant with scheme requirements; Regulation 6 timeline monitoring | Daily | M14 | A3 |
| Tax invoices; VAT201 exports; dividends tax returns; PAYE exports | Per period | M14, M15 | A2 |
| Companies Act filings calendar, s.46 solvency and liquidity resolutions, beneficial ownership filings | Per event and annually | M02, M15 | A1 |
| B-BBEE verification evidence pack | Annually | M02, M17, M18 | A1 |
| Employment Equity, skills development and OHS reports | Annually or per event | M17, M19 | A1 |
| Merger-threshold assessment for acquisitions | Per acquisition | M02 | A1 |
| Complaints register and responses (CPA, HPCSA, CMS) | On complaint | M19 | A2 |
| Retention and destruction certificates | Per schedule | M09, M21 | A2 (destruction requires CMP approval) |
| Regulator inspection evidence packs (SAHPRA, OHSC, Information Regulator, DoEL) | On demand | M19 | A2 |

## 5. Regulatory calendar and evidence automation

* Every obligation with a date generates calendar items with lead times (90, 60, 30, 7 days) to
  the owner persona and PRM; overdue items escalate to EXE.
* Evidence is collected automatically from Platform events wherever it exists (a signed QA test, a
  submitted claim, a delivered notification); manual evidence is uploaded against the obligation.
* The **regulatory status board** (M16) shows, per Practice and Site: obligations current,
  due, overdue; open incidents by regulator; reportable-result flags open; licence expiries;
  registration lapses; data-subject requests in progress; audit findings open.
* Quarterly: CMP reviews the register against legal updates (Government Gazette notices, SAHPRA
  guidelines, HPCSA rules, CMS circulars); changes are effective-dated reference data.

## 6. Requirements

* M19-R-300 The Platform MUST hold the statutory register as effective-dated reference data with
  an owner, trigger, control, output and evidence for each obligation.
* M19-R-301 The Platform MUST NOT submit anything to a regulator autonomously; all external
  regulatory submissions are A2 at most, with a named human submitter recorded.
* M19-R-302 M12 MUST offer reportable-result categories at sign-off with legally reviewed standard
  statements; free-text legal wording MUST NOT be generated by AI (Class 1 and Class 2 gates apply).
* M19-R-303 A reportable-result flag MUST require referrer acknowledgement within its category
  window and MUST escalate through M13 when unacknowledged.
* M19-R-304 Safeguarding flags MUST open a case with the applicable statutory form pre-filled from
  demographics only, MUST withhold patient-facing release pending clinician review, and MUST record
  who reported, to whom and when.
* M19-R-305 TB-suggestive flags MUST carry the notifiable-medical-condition statement and the
  referrer pack MUST include the current notification route.
* M19-R-306 ODMWA examinations MUST use the ILO classification template and MUST verify reader
  qualification before sign-off.
* M19-R-307 Radiation incidents detected by the Platform (wrong patient, wrong side, unintended
  repeat, pregnancy without justification) MUST open an incident automatically.
* M19-R-308 Licence, registration and QA expiries MUST block the dependent activity (scheduling,
  signing, rostering) per M02-R-006 and M17 rules, with CMP override and audit.
* M19-R-309 The Platform MUST produce the statutory outputs in §4 from Platform data with an audit
  trail linking each output to its source records.
* M19-R-310 Every [confirm] item in this document MUST have an open item in the M19 legal-review
  queue with an owner and a target date until a legal opinion is filed.
* M19-R-311 Changes to obligations, deadlines or standard statements MUST be versioned with
  effective dates and an approver.
* M19-R-312 Analytics MUST report reportable-result flags raised, acknowledged and closed by
  category, site and referrer, and unclosed flags MUST escalate weekly.

## 7. Open items requiring legal confirmation

| # | Item | Why it matters | Owner |
|---|---|---|---|
| 1 | MSO management-fee structure versus HPCSA rules on fee sharing and ownership by juristic persons | Foundational to the Group structure | EXE, legal |
| 2 | NMC category and notification period for tuberculosis and the list of imaging-relevant notifiable conditions | Drives flag windows and packs | CMP |
| 3 | Children's Act s.110 reporting form and route per province; whether radiologists reporting remotely hold the duty personally | Safeguarding cases | CMP, clinical lead |
| 4 | SAHPRA Radiation Control code of practice version, incident reporting thresholds and periods, QC inspection body requirements | Radiation compliance | RPO, CMP |
| 5 | SAHPRA SaMD classification of each model and of the viewer/PACS; vigilance timelines | AI activation | AIO, CMP |
| 6 | POPIA s.57 prior authorisation applicability for cloud and LLM providers outside South Africa; adequacy of Cloudflare and Anthropic contractual protections under s.72 | Cloud and AI architecture | CMP, CIO |
| 7 | Regulation 6 timelines and wording under the Medical Schemes Act; PMB coding practice | Revenue cycle | BIL lead |
| 8 | COIDA and ODMWA current form names, tariffs and electronic submission channels | Occupational workflows | BIL lead, CMP |
| 9 | RAF supplier claim and undertaking procedures | RAF debtors | BIL lead |
| 10 | HPCSA record retention periods for occupational and mammography records | Retention classes | CMP |
| 11 | Contrast media handling: whether any licence beyond practitioner administration is required | Pharmacy compliance | CMP |
| 12 | National Cancer Registry clinical notification scope | Flag behaviour | CMP |
| 13 | Adult assault and gunshot injuries: absence of a statutory reporting duty | Flag wording | CMP |
| 14 | Payment plans as incidental credit under the NCA | Collections | BIL lead |
| 15 | Competition Act merger thresholds current values | Acquisitions | EXE |
| 16 | Certificate of need status; OHSC applicability to stand-alone imaging practices; provincial health-establishment licensing | Site onboarding | CMP |
