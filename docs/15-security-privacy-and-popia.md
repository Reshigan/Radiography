# 15 — Security, Privacy and POPIA

## 1. Purpose and scope

This document specifies how the Platform protects patients, workers, Practices and the Group against
the threats that apply to a national imaging network holding health data for millions of South
Africans, and how it complies with the Protection of Personal Information Act 4 of 2013 (POPIA), the
Promotion of Access to Information Act 2 of 2000 (PAIA), the Electronic Communications and
Transactions Act 25 of 2002, the Cybercrimes Act 19 of 2020, HPCSA record-keeping and
confidentiality guidance, and the National Health Act 61 of 2003 provisions on health records.

Security here is a property of the whole system: identity (M01), tenancy (M21), the Edge Gateway and
site networks, DICOM and modality estates, the AI layer (M11 and M20), integrations (14), and the
compliance evidence that proves it (M19). Requirements in this document are numbered M01-R-1xx
(identity and authorisation), M21-R-2xx (platform and infrastructure), M19-R-2xx (privacy governance),
M09-R-1xx (imaging data) and M11-R-1xx (AI privacy) to avoid clashes with other documents.

## 2. Threat model

| Threat actor | Motivation | Typical vectors against an imaging chain | Primary controls |
|---|---|---|---|
| Ransomware crews (financially motivated) | Extortion; SA healthcare has been hit repeatedly | Phishing to staff, exposed remote access, vendor VPNs into modality networks, unpatched modality operating systems, flat site networks | Zero trust access, MFA, network segmentation, immutable backups, endpoint controls, vendor access brokering |
| Insiders (curious, coerced or malicious) | Snooping on public figures or family, selling data, fraud | Over-broad access, shared logins at the front desk, exports, printing | ABAC on patient relationship, break-glass with review, audit analytics, least privilege, no shared accounts |
| Medical-aid fraud syndicates | Fabricated or inflated claims | Compromised billing accounts, forged referrals, collusion with staff | Segregation of duties in M14, claim anomaly detection, referrer identity verification, immutable audit |
| Identity thieves | SA ID numbers and scheme details are valuable | Bulk exfiltration via API or reports, lost devices | Field-level encryption of identifiers, rate limits, export controls, device posture |
| Hostile third parties in integrations | Lateral movement from a hospital, referrer or vendor network | Compromised HL7 endpoints, trusted VPN abuse | Per-partner isolation, allow-lists, mutual TLS, message validation |
| AI-specific | Prompt injection through referral text or WhatsApp; model inversion; data leakage to model providers | Free-text fields reaching Hands; identified data in prompts | De-identification before inference, tool allow-lists enforced by the runtime, prompt and output logging with redaction, provider agreements |
| Nation-state or activist | Disruption, data theft | DDoS, supply-chain compromise | Edge DDoS protection, SBOM and signed builds, DR |
| Physical | Theft of workstations, gateways, modality consoles | Site burglary, unattended screens | Full-disk encryption, session locks, asset tracking, no local patient data on workstations |
| Environmental and infrastructural | Load-shedding, connectivity loss | Corrupted writes, unsafe fail-open behaviour | Edge Gateway on UPS, offline-safe design, store-and-forward with integrity checks |

Assets ranked by sensitivity: pixel data and reports (health data, special personal information);
identifiers (ID number, scheme membership); worker health and biometric data; financial data;
credentials, keys and secrets; audit logs; AI models and prompts; availability of imaging itself
(patient safety depends on it).

## 3. Zero-trust architecture and identity (M01)

### 3.1 Principles

No network location is trusted. Every request to any Platform surface carries an authenticated
identity, a device context and an authorisation decision evaluated per request. Sites connect
outbound only (Cloudflare Tunnel in the cloud deployment; private network or VPN internally);
nothing at a site listens on the internet. Modalities are never reachable from outside their VLAN.

### 3.2 Identity for staff

| Control | Specification |
|---|---|
| Single sign-on | OIDC through the identity provider (Cloudflare Access with the built-in OIDC provider in the cloud deployment; Keycloak internally); one identity per person across every Practice they work for, with per-tenant role assignments |
| Multi-factor authentication | Mandatory for every staff account, no exceptions; passkeys (FIDO2/WebAuthn) as the primary factor, TOTP as fallback; SMS OTP is not accepted for staff; step-up authentication for sensitive actions (break-glass, export, signing a report from a new device, changing bank details) |
| HPCSA-number-linked accounts | Clinical roles (RGT, RAD, NUR where applicable) require a verified HPCSA (or Nursing Council) number on the `worker` record (M17 §2.6); the number is a claim in the token; report signing embeds it in the signature record; a lapsed registration suspends the clinical role automatically |
| Device posture | Reading Room and clinical consoles require a managed or enrolled device with disk encryption, screen lock and a current OS; posture is checked by the access layer (Cloudflare Access device posture in the cloud deployment; an equivalent agent or certificate-based check internally); unmanaged devices get read-only, watermarked access to a reduced surface or none |
| Shared workstations | Front desk and technologist consoles use fast user switching with individual credentials (passkey or badge tap plus PIN); no shared logins; automatic lock after a configurable idle period (short for shared spaces) |
| Just-in-time elevated access | Administrative and cross-tenant roles (SUP, BIO, AIO, Group finance) hold no standing privilege; elevation is requested with a reason and a duration, approved by a second person (or auto-approved for pre-defined low-risk tasks), logged, and expires automatically |
| Break-glass | A clinician may open a record outside their normal relationship (an unassigned patient in an emergency) by declaring break-glass with a mandatory typed reason; the access is granted immediately, flagged on the record, notified to CMP and reviewed within a defined period; patterns of misuse are surfaced by audit analytics; break-glass is not available to non-clinical roles |
| Session management | Short-lived access tokens, refresh with rotation, binding to device; sessions revocable centrally; concurrent-session limits for shared-space roles |
| Service accounts and Hands | Every Hand and every integration client is a non-human identity with its own credentials, scopes and audit stream; Hands act under their own identity, never under a human's session |

* M01-R-100 MFA MUST be enforced for all staff and third-party identities at the identity provider;
  the Platform MUST refuse tokens without an MFA claim.
* M01-R-101 Clinical roles MUST be bound to a verified professional registration number and MUST be
  suspended automatically when M17 records a lapse.
* M01-R-102 Break-glass MUST require a typed reason, MUST notify CMP within one minute, MUST be
  reviewed within the configured period (default five working days) and MUST be visible on the
  patient's disclosure log.

### 3.3 Identity for patients, guardians and referrers

Patients sign in to the Patient Space with a magic link or OTP to the mobile number verified at
registration, with optional passkey enrolment; higher-value actions (viewing images, changing
banking or contact details) step up. Guardians hold delegated access to a child's record with proof
captured at registration (M07); delegation is time-limited for minors approaching majority and
revocable. Referrers use SSO from their organisations where available or Platform credentials with
mandatory MFA; their access is bound to a verified HPCSA number and practice number.

## 4. Authorisation model

### 4.1 RBAC × ABAC

Roles are defined per persona (00 §3) with permission sets per module; attributes then constrain
every decision:

| Attribute | Examples | Effect |
|---|---|---|
| Tenant (Practice) | The Practice the user is assigned to | Row-level isolation; no cross-tenant read without a cross-tenant role and a recorded lawful basis |
| Site | Sites within the Practice the role covers | Worklists, rosters and stock scoped to sites |
| Patient relationship | Referred by me; booked at my site today; assigned to my reading list; in my Hub pool; my own record; my child's record | Clinical data readable only where a relationship exists or break-glass is declared |
| Data class | Identified, pseudonymised, de-identified, aggregated | Group analytics see aggregated or de-identified by default |
| Purpose | Care, billing, quality, research, legal | Purpose is a claim on the request; the audit log records it; some purposes require prior consent |
| Time | Roster, on-call window, elevation window | Access to a site's worklist outside a rostered shift requires a reason |
| Device posture | Managed, unmanaged | Reduces surface as in 3.2 |
| Sensitivity flags | VIP or restricted record, worker-as-patient, legal hold | Additional approval or narrowed roles |

Policies are expressed as data (a policy language evaluated in the API layer with a decision cache)
so that CMP can read them and auditors can test them. Every decision is logged with the attributes
that determined it.

### 4.2 Cross-tenant rules for Group and MSO

| Access need | Rule |
|---|---|
| MSO billing bureau processing claims for a Practice | The MSO acts as POPIA operator under a written agreement (M02); BIL and DEB users of the MSO hold per-Practice role assignments; access is identified but purpose-limited to billing |
| Group analytics and benchmarking | Aggregated or de-identified data only, produced by the analytics layer; re-identification prohibited by policy and by design (small-cell suppression) |
| Hub radiologists reading for many Practices | Reading services agreement (M02) creates the relationship; the RGT sees studies assigned to the Hub pool and the patient context needed to report, nothing else |
| Product recall or safety query across Practices | Cross-tenant service with a recorded lawful basis (M18-R-105); CMP-initiated; disclosure logged per patient |
| SUP support access | Just-in-time elevation with the Practice's PRM or CMP consent for identified data; masked views by default |
| EXE and SHR | Financial and operational read models; no patient-identified data |

### 4.3 Patient-delegated access

Patients grant access to family members, a caregiver, a specific referrer not on the original
referral, or a legal representative, from the Patient Space; each grant has a scope (results,
images, appointments, billing), an expiry and a revocation path. Guardians of minors are handled
under s.34 with proof; when the minor reaches the age at which they may consent independently to
medical treatment (configurable reference data aligned to the Children's Act), the guardian's grant
is reviewed.

* M01-R-103 Every authorisation decision MUST evaluate tenant, patient relationship and purpose
  attributes in addition to role, and MUST be logged with the evaluated attributes.

## 5. Data classification

| Class | Examples | Handling |
|---|---|---|
| C4 Special personal information (health) | Images, reports, dose, safety questionnaires, contrast reactions, worker health and pregnancy declarations, biometric templates | Encrypted at rest with tenant keys; access by relationship or break-glass; never in message bodies; de-identified before AI inference unless the data path is approved; retention per schedule |
| C3 Identifiers and financial | ID number, passport, scheme membership, contact details, bank references, claims | Field-level encryption for identifiers; masked by default in UI (`Id` component); export controls |
| C2 Internal | Rosters, stock, contracts, policies, non-patient audit | Tenant-scoped; standard encryption |
| C1 Public | Site addresses, hours, price lists for cash patients, PAIA manual | Published |

## 6. Encryption and key management

| Layer | Specification |
|---|---|
| In transit | TLS 1.3 everywhere externally (TLS 1.2 accepted only for a named legacy partner with an expiry date); mutual TLS for funders and switches where supported; HL7 MLLP wrapped in TLS or an IPsec tunnel; DICOM on the site VLAN with TLS where the modality supports it, otherwise isolated by network; HSTS on all web surfaces; certificate automation with short lifetimes |
| At rest (databases) | Provider-managed encryption on D1 and R2 (cloud) and volume encryption plus PostgreSQL TDE-equivalent (internal), with tenant-scoped application-layer envelope encryption for C3 and C4 columns |
| Field-level | ID numbers, passport numbers, scheme membership numbers and bank references are encrypted with per-tenant data keys; searchable by deterministic blind index (HMAC) for exact match; never decrypted in bulk queries |
| DICOM at rest | Envelope encryption: each study's objects are encrypted with a unique data key; data keys are wrapped by the tenant key in the KMS; pixel data in the Edge Gateway's 30-day cache is on an encrypted volume with the gateway's key sealed to the device |
| Key management | A KMS (cloud provider KMS or an internal HSM-backed service) holds tenant master keys; keys never leave the KMS; rotation annually or on compromise with re-wrapping of data keys; separation of duties between key administrators and data administrators; key-use audit |
| Backups | Encrypted with separate keys held in a different administrative domain from production |
| Hashing | Passwords are not stored (passkeys and OIDC); where a fallback password exists, Argon2id; audit chains use SHA-256 |

* M21-R-200 Identifiers in class C3 MUST be encrypted at the field level with tenant keys and
  searchable only through blind indexes.
* M09-R-170 Every DICOM object at rest, centrally and at the gateway, MUST be encrypted with a data
  key wrapped by a tenant key; a key-management audit trail MUST show every unwrap.

## 7. Secrets

All credentials (switch keys, PSP secrets, WhatsApp tokens, HL7 VPN keys, vendor portal logins,
KMS references) live in the secrets manager of the deployment (Workers secrets in the cloud
deployment, a vault service internally), injected at runtime, never in code, configuration files,
tickets or chat. Rotation schedules per secret class; automatic rotation where the counterparty
supports it; secret scanning in CI blocks commits containing secrets; each adapter uses distinct
credentials per Practice where the counterparty issues them.

## 8. Audit logging

| Property | Specification |
|---|---|
| Coverage | Every read of C3 and C4 data (who, what, when, purpose, relationship basis, device, IP), every write, every authorisation decision of interest (denied, break-glass, elevated), every Hand action and tool call, every disclosure to an external party, every configuration and key change |
| Structure | Append-only stream per tenant; each entry carries a hash of its content and the previous entry's hash (hash chain); periodic anchors (the chain head) are written to a separate administrative domain and, optionally, to an external timestamping service, making tampering detectable |
| Storage | Separate from operational data; write-only from the application; read by CMP, the Information Officer and auditors through a dedicated read model; no delete API; retention per schedule (minimum the record's own retention) |
| Patient view | The Patient Space shows the patient a plain-language disclosure log: which organisations and roles accessed their record and why, including break-glass events and funder audit disclosures (M19-R-109) |
| Analytics | Anomaly detection on access patterns (a user opening records of patients not on their list, after-hours bulk access, access to a colleague's record) creates CMP review tasks; models produce scores in the annotated style, never automatic sanctions |
| Format | Aligned with IHE ATNA and FHIR AuditEvent so that exports are standard |

* M21-R-201 Audit logs MUST be append-only and hash-chained with anchors stored outside the
  production administrative domain; integrity MUST be verifiable on demand and verified daily.

## 9. De-identification and pseudonymisation

The `packages/dicom` de-identifier implements the DICOM PS3.15 basic application-level
confidentiality profile with configured options (retain longitudinal temporal information with
modified dates for research; retain patient characteristics for AI where clinically needed; clean
descriptors) and a burned-in text detector for pixel data (ultrasound and secondary captures are
high-risk). Reports and free text pass through a named-entity redactor (names, ID numbers, contact
details, addresses, scheme numbers, dates shifted consistently per subject). Pseudonymisation keys
(subject identifier to pseudonym) are held in the KMS-protected linkage table accessible only to
CMP-approved processes; de-identified datasets carry a data-use record. Re-identification is a
logged, approved event.

## 10. Infrastructure and network security

### 10.1 Cloud deployment (Cloudflare: production, staging and demo)

| Control | Specification |
|---|---|
| Access | Cloudflare Access in front of every staff surface with the identity provider, MFA and device posture policies; service tokens for non-human clients; per-application policies per persona surface |
| Edge protection | WAF managed rules plus custom rules for the API; rate limiting per client, per IP and per endpoint (login, OTP, quote, search); bot management and Turnstile on public forms (site finder, booking, complaints); DDoS protection |
| Tunnels | Edge Gateways and the inference cell connect through outbound-only tunnels; no inbound ports at sites |
| Data residency | Regional services and jurisdiction-restricted buckets where available for South Africa (availability to be verified per 07 §10); the Information Officer records the residency status and the s.72 basis for any component that processes data outside the Republic |
| Isolation | One D1 database per Practice; R2 prefixes and keys per tenant; Workers bound only to their tenant directory |
| Demo | Synthetic data only; separate accounts and keys from production; demo surfaces labelled |

### 10.2 Internal deployment (Docker/Kubernetes)

| Control | Specification |
|---|---|
| Perimeter | Caddy with automatic TLS and a request-filtering layer (CrowdSec or equivalent); no direct database exposure; bastion-free administration through the identity-aware proxy |
| Network segmentation | Separate networks for web and API, databases and object store, integration endpoints (HL7, DICOMweb ingress), inference, and management; default-deny policies between segments |
| Identity | Keycloak with the same MFA and posture requirements; short-lived tokens |
| Secrets | Vault service with dynamic database credentials |
| Observability | OpenTelemetry stack with security dashboards and alerts |

### 10.3 Site networks, DICOM isolation and vendor access

| Control | Specification |
|---|---|
| Modality VLANs | Each modality on an isolated VLAN (or per-port isolation) that can reach only the Edge Gateway's DICOM ports and NTP; no internet, no user workstations, no printers on modality VLANs |
| Edge Gateway | Hardened Ubuntu LTS, disk encryption, signed images and updates, host firewall, no listening ports on the WAN side, outbound tunnel only; local admin only through the Platform's brokered session; tamper telemetry |
| Workstations | Managed devices with disk encryption, endpoint protection, automatic patching, no local storage of patient data (browser-based consoles; the viewer caches in memory and encrypted cache with short expiry); USB mass storage disabled except on designated media-burning stations |
| Wi-Fi | Staff and patient Wi-Fi separated; patient Wi-Fi internet-only with fair-use limits |
| Vendor remote access | Brokered sessions only (M18-R-104): the vendor authenticates to the Platform's remote-access gateway with MFA, receives a time-boxed session to one asset, the session is recorded, and the modality VLAN opens a rule only for that session; vendor-owned modems, standing VPNs and remote-desktop listeners on modalities are removed at acceptance |
| Physical | Server and network cabinets locked; MRI zone controls; CCTV per M18 §3.8 |

* M21-R-202 Modalities MUST be network-isolated so that only the Edge Gateway can reach them, and
  vendor access MUST be possible only through brokered, recorded sessions.

## 11. Medical-device cybersecurity hygiene

Modalities often run unsupported operating systems and cannot be patched by the Practice. The
Platform treats them as untrusted devices and manages the risk around them:

| Practice | Specification |
|---|---|
| Inventory | Every modality's operating system, software version, open services and patch status recorded in M18 as telemetry or manual entry; SAHPRA device status and vendor security advisories linked |
| Compensating controls | VLAN isolation, no internet, DICOM allow-lists by AE title and IP, USB policy on consoles, local accounts inventoried and default passwords changed at acceptance (a checklist item in M18 §3.2) |
| Vendor obligations | Service contracts require security patches within a defined window, vulnerability disclosure, a software bill of materials on request, and compliance with the brokered-access rule |
| Data on consoles | Local patient data on modality consoles is minimised (auto-delete after storage commitment where the modality supports it) and wiped at decommissioning with a certificate |
| Monitoring | Unusual traffic from a modality VLAN (anything other than DICOM to the gateway and NTP) alerts BIO |
| Legacy | Devices that cannot meet the minimum are recorded on the risk register with an end-of-life plan |

## 12. Backup, disaster recovery and ransomware resilience

| Control | Specification |
|---|---|
| Backup tiers | Continuous replication of databases (point-in-time recovery); object-store versioning with object lock (immutability) for imaging and documents; daily snapshots retained on a schedule (daily for 30 days, weekly for a year, monthly for the retention period); one copy in a separate administrative domain with separate credentials; one offline or air-gapped copy of the imaging archive index and encrypted objects refreshed on a schedule |
| Targets | RPO 15 minutes, RTO 4 hours (07 §10); the Edge Gateway's 30-day local store means imaging continues during a central outage |
| Ransomware | Immutable backups cannot be encrypted or deleted by a compromised production credential; restoration is rehearsed quarterly with a documented time; a clean-room rebuild procedure exists for the API and web tiers from signed artefacts |
| Testing | Quarterly DR test with a report as a M19 calendar item; annual full-site failover exercise |
| Integrity | Backups verified by hash; restored samples compared to production audit anchors |

* M21-R-203 At least one backup copy of every record class MUST be immutable for its retention
  window and one MUST be held offline or in an isolated administrative domain; restore tests MUST be
  evidenced quarterly.

## 13. Incident response runbook

| Phase | Actions | Owner |
|---|---|---|
| Detect | Alerts from the access layer, WAF, endpoint protection, audit analytics, integration monitoring, staff reports ("Report a security concern" on every surface), partner notices | SUP on-call, BIO |
| Triage (within 1 hour) | Classify (malware, account compromise, data exposure, availability, vendor); assess whether personal information is affected (POPIA s.22 clock starts on reasonable belief of a compromise); open the incident in M19 with the security type | SUP lead, Information Officer |
| Contain | Isolate affected sites' networks (gateways continue imaging if clean), revoke sessions and rotate credentials, block indicators at the edge, suspend affected integrations, preserve evidence (forensic images, log exports) | SUP, BIO |
| Eradicate and recover | Rebuild from signed artefacts, restore from immutable backups to a verified point, re-verify audit chain integrity, staged reconnection of sites and partners | SUP, BIO |
| Notify | Information Regulator and affected data subjects as soon as reasonably possible after discovery (s.22), with the content the section requires; the Cybercrimes Act reporting obligations to the South African Police Service where applicable; funders under contract terms; hospital partners; the insurer; SAHPRA where a device is implicated | Information Officer, CMP, EXE |
| Learn | Root cause and CAPA in M19; runbook and control updates; a tabletop exercise on the scenario | CMP, SUP |

The Compliance Hand drafts notifications and collects the timeline from the audit chain; humans
send them. Communication templates for patients are in plain language in the supported languages.

* M19-R-200 The security incident process MUST record the time of reasonable belief of compromise,
  the notification decision and the notification time for every incident that touches personal
  information.

## 14. POPIA compliance mapping

### 14.1 Roles

| Entity | POPIA role | Notes |
|---|---|---|
| Each Practice | Responsible party for its patients' and workers' personal information | Has an Information Officer (a director or the principal, who may delegate to a deputy) registered with the Information Regulator |
| MSO (Bonakala Platform) | Operator for Practices (platform hosting, billing bureau, contact centre, Hands); responsible party for its own staff and for the Group's commercial data | Operator agreement per Practice (s.20 and s.21): process only on instructions, security safeguards, notify the responsible party of any compromise |
| Group (Bonakala Holdings) | Responsible party for aggregated and de-identified analytics; responsible party for shareholder data | Data-sharing agreement for aggregated data |
| Reading Hub | Operator for Practices when reading under a reading-services agreement; responsible party for its radiologists' data | |
| Cloud provider, LLM provider, switches, PSPs, messaging providers, ID verification providers, vendors with remote access | Operators (or in some cases independent responsible parties, for example schemes and laboratories) | Written agreements; s.72 conditions for those outside the Republic |

### 14.2 The eight conditions

| Condition | Platform implementation |
|---|---|
| 1 Accountability (s.8) | Information Officer per entity with registration evidence in M19; the processing register; this document and the policies it references; board-level reporting through the quality and risk committee |
| 2 Processing limitation (s.9–12) | Lawful basis recorded per data flow (14 §5) and per purpose; minimality enforced by scopes and data classification; consent captured in M07 with withdrawal paths; direct-marketing rules for any promotional messaging (opt-in only, none by default) |
| 3 Purpose specification (s.13–14) | Purpose is a claim on every access and every connector; retention schedule (section 15) enforced by automation; records not retained beyond purpose except where law requires |
| 4 Further processing limitation (s.15) | Any new purpose (research, AI training, benchmarking) is a documented compatibility assessment approved by the Information Officer, with consent or another basis where required |
| 5 Information quality (s.16) | Patient Master Index with ID verification, duplicate detection and merge (M03); patients can correct details in the Patient Space; correction requests tracked |
| 6 Openness (s.17–18) | PAIA manual per entity; privacy notice shown at registration and in the Patient Space in the patient's language; notice records versioned (M19 §10) |
| 7 Security safeguards (s.19–22) | This document; operator agreements; breach notification runbook (section 13) |
| 8 Data subject participation (s.23–25) | Access, correction and deletion workflows in the Patient Space and through the Information Officer, with identity verification and statutory timelines (M19 §15) |

### 14.3 Specific provisions

| Provision | Implementation |
|---|---|
| Special personal information (s.26–33), health (s.32) | Processing of health information is by medical professionals and health institutions subject to confidentiality duties (s.32(1)(a)) and, for scheme claims, by the schemes and administrators under s.32(1)(b) and their own duties; every other processor (MSO, Hub, vendors) acts as operator; the Platform stores the applicable basis on the data flow and blocks flows without one |
| Children (s.34–35) | A child's record is created with a competent person's consent recorded in M07; guardian access is delegated and reviewable; no direct marketing to children; age-of-consent rules for medical treatment held as reference data |
| Prior authorisation (s.57–58) | Where the Platform would process unique identifiers (ID numbers) for a purpose other than the original and to link information, or transfer special personal information across borders for a new purpose, the Information Officer assesses whether prior authorisation from the Information Regulator is required before the flow is enabled; the assessment is a M19 record |
| Automated decision-making (s.71) | No decision with legal or similarly significant effect on a data subject is taken solely by automated processing: clinical outputs are signed by a radiologist; funding, credit-style and collections decisions (payment plans, dunning intensity, propensity scores) always include a human path and an explanation; patients can request a human review; Hands' leashes encode this |
| Cross-border transfers (s.72) | Every component that processes personal information outside the Republic (cloud regions, LLM providers, some messaging providers) is listed in the transfer register with the s.72 basis (typically a binding agreement providing an adequate level of protection, or consent where required); identified imaging and reports are not sent to LLM providers; de-identified data flows are still recorded |
| Breach notification (s.22) | Section 13; notifications to the Regulator and to data subjects in writing through the channels the section allows, including the Patient Space, e-mail, SMS and, where necessary, the press |
| Information Officer duties (s.55–56) and regulations | Registration, compliance framework, impact assessments (a privacy impact assessment for every new data flow and every new AI model), PAIA manual, internal awareness, handling of requests; the Compliance Hand tracks these as obligations |
| Direct marketing (s.69) | Patients receive only service messages by default; any marketing requires recorded opt-in with an unsubscribe in every message |
| PAIA | Manual published per entity; requests logged and answered within the statutory period; fees per the regulations; refusal grounds recorded |

* M19-R-201 The Platform MUST maintain a processing register and a cross-border transfer register as
  data, generated from the data-flows register and connector configuration, and MUST block enabling
  any connector that lacks a lawful basis and, where applicable, an operator agreement.
* M19-R-202 No workflow MAY finalise a decision with legal or similarly significant effect for a
  data subject without a human step and an explanation available to the data subject.

## 15. Retention schedule

Retention is configurable per record class per entity; the defaults below are the launch values and
are labelled as reference data because guidance differs by source and may change.

| Record class | Default retention (illustrative) | Basis and notes |
|---|---|---|
| Images and reports, adults | At least 6 years from the last entry | HPCSA record-keeping guidance; longer where a Practice's policy or a funder contract requires |
| Images and reports, minors | Until the 21st birthday plus 6 years | HPCSA guidance |
| Mentally incapacitated patients | Duration of the patient's lifetime where guidance so requires | HPCSA guidance; flagged record class |
| Occupational health, mine workers | Longer periods per ODMWA and COIDA (decades) | Flagged at registration |
| Mammography | Longer where screening programmes require prior comparison | Practice policy |
| Dose records and dosimetry | Per radiation control requirements, typically the working life of the worker plus a period | M10 |
| Claims, invoices, remittances | At least 5 years for tax; funder contract periods | Tax Administration Act; VAT Act |
| Audit logs | At least the retention of the record they concern | |
| Recruitment candidates not hired | Short period, then deletion | POPIA minimality |
| Worker records | Employment period plus statutory periods (BCEA, tax) | |
| CCTV | Short period (weeks) unless preserved for an incident | POPIA; signage |
| Call recordings | Critical-results calls: with the record; other calls: months | |
| WhatsApp conversations | Clinical content: with the record; transactional: months | |
| Message store (integrations) | Aligned to the records they created | 14 §4 |
| Backups | Rolling per section 12; deletion propagates on expiry | |

Disposal is automated by the scheduler, logged, and reversible only within a short grace period;
legal hold suspends disposal for named records.

## 16. Consent management

Consent is one object model across the Platform (M07 owns capture): purpose (imaging procedure,
contrast, data processing, sharing with a specific party, marketing, research, biometric
attendance for workers), scope, channel, language, document version shown, signature or affirmative
act, timestamp, and withdrawal record. Consent is not the sole lawful basis for care and billing (those
rest on the contract and legal obligations), so withdrawal of a research or marketing consent never
affects care. The Patient Space shows current consents with one-tap withdrawal; the referrer and
funder portals see only whether the required consent exists.

## 17. Vendor, cloud and LLM data-processing agreements

Every operator signs an agreement covering: processing only on documented instructions; security
measures at least equivalent to this document; sub-processor disclosure and approval; confidentiality
of personnel; breach notification to the responsible party without undue delay; assistance with
data-subject requests; deletion or return at the end of service; audit rights; cross-border
conditions; no use of Practice data for the operator's own purposes including model training. The
LLM provider agreement additionally requires zero data retention or the shortest available retention
for prompts and outputs, no training on submitted data, and a documented processing region. The
CMP keeps the agreements and their review dates in the compliance calendar (M19).

## 18. AI-specific privacy (M11, M20)

| Rule | Specification |
|---|---|
| De-identification before inference | Images and text sent to any model outside the tenant boundary (vendor models, LLM providers) are de-identified per section 9; models inside the tenant boundary (the inference cell, Edge Gateway QC models) may process identified data under the Practice's basis with the data path recorded in the model registry |
| Hands and identified data | Hands receive the minimum context for the task; identified clinical images and free-text reports are excluded unless the Hand's data path is approved (07 §7); tool outputs that return patient data are scoped by the same ABAC as humans |
| No training on patient data without basis | Training or fine-tuning on Practice data requires a documented compatibility assessment, consent or another lawful basis, research ethics committee approval where the activity is research, de-identification, and an AIO-approved data-use record; vendor agreements prohibit training on Bonakala data |
| Prompt and response logging | All prompts and outputs to LLMs pass through the gateway with identifier redaction before logging; logs are retained for a short period for safety and quality review, access-controlled to AIO and CMP, and excluded from analytics exports; patients' free text (WhatsApp) is treated as untrusted input and never executed as instructions |
| Provenance | Every AI output carries model identifier, version and confidence, stored with the record and shown in the annotated style; AI outputs are never presented as diagnoses |
| Automated decisions | Section 14.3, s.71 |
| Model registry security | Model artefacts signed; deployment only from the registry; inference endpoints authenticated; drift monitoring by AIO |

* M11-R-160 No identified pixel data or report text MAY leave the tenant boundary for inference or
  drafting unless the model registry entry records an approved identified data path with its lawful
  basis; the default path is de-identified.

## 19. Application security

| Practice | Specification |
|---|---|
| Standard | OWASP Application Security Verification Standard level 2 as the baseline for all surfaces, level 3 controls for authentication, session management, access control and cryptography |
| Secure development | Threat modelling per module and per connector; security requirements in the definition of done; code review with a security checklist; branch protection; signed commits and builds |
| Testing | Static analysis (SAST) and secret scanning on every commit; dependency and container scanning with a software bill of materials (SBOM) per release; dynamic testing (DAST) against staging per release; fuzzing of parsers (DICOM, HL7, FHIR, switch formats) because they consume untrusted input from partners; an independent penetration test annually and after major changes, with findings tracked as M19 CAPA |
| Input handling | Schema validation (Zod) at every boundary; output encoding; parameterised queries; file-type verification and malware scanning for uploads (referral photos, PDFs); size limits |
| Supply chain | Pinned dependencies, allow-listed registries, provenance attestations, review of licence changes (07 §9) |
| Vulnerability management | Severity-based remediation windows (critical within days, high within weeks) as reference data; a coordinated disclosure policy and security contact published on the developer portal |
| Front-end | Content security policy, no third-party trackers on patient surfaces (06 §9), subresource integrity, secure cookies, anti-CSRF |

## 20. Compliance evidence automation

Security evidence is generated, not assembled by hand: the Compliance Hand pulls access-review
results (quarterly attestation by PRMs of their sites' users, generated from M01), MFA coverage,
device posture coverage, break-glass reviews, key rotation logs, backup and restore test reports,
vulnerability scan summaries, penetration test status, operator agreement status, transfer register,
audit chain verification results, and training and acknowledgement coverage into a monthly security
and privacy pack for CMP and the quality and risk committee, and into inspection packs for the
Information Regulator, funders and accreditation bodies (M19-R-108). Each evidence item carries its
source query and hash so that an auditor can re-run it.

## 21. Security and privacy KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| MFA coverage | Staff and partner identities with MFA enforced | 100 % |
| Passkey adoption | Staff identities with a passkey enrolled | ≥ 90 % within a year |
| Device posture compliance | Clinical sessions from compliant devices | ≥ 99 % |
| Access reviews completed | Quarterly reviews attested on time | 100 % |
| Break-glass review | Break-glass events reviewed within the period | 100 % |
| Inappropriate-access findings | Confirmed findings per quarter | Reported; trend down |
| Patch latency | Critical vulnerabilities remediated within the window | 100 % |
| Vendor sessions outside window | Count | 0 |
| Audit chain integrity | Daily verifications passed | 100 % |
| Backup restore test | Quarterly tests within RTO | 100 % |
| Breach notification time | Hours from reasonable belief of compromise to Regulator notification | Reported per event |
| Data-subject requests on time | Within statutory period | 100 % |
| Operator agreements current | Operators with signed, in-date agreements | 100 % |
| Phishing simulation failure | Staff clicking simulated phishing | Trend down; training, not sanction |
| De-identification defects | Identified data found in de-identified outputs (sampled) | 0 |

## 22. Controls summary

| Control | Enforced by |
|---|---|
| MFA, posture, SSO | Identity provider and access layer; API refuses tokens lacking claims |
| RBAC × ABAC with purpose and relationship | Policy engine in the API; row-level tenancy in the database; logged decisions |
| Break-glass and just-in-time elevation | M01 workflows with CMP notification and review |
| Encryption and keys | KMS with separation of duties; envelope encryption; blind indexes |
| Append-only, hash-chained audit | Separate store; daily verification; external anchors |
| Network isolation and brokered vendor access | Site network design, Edge Gateway, remote-access gateway |
| Immutable backups and rehearsed restores | Object lock; separate administrative domain; quarterly tests |
| POPIA registers and agreements | M19 data-flows, processing and transfer registers; connector enable gate |
| AI data paths | Model registry gate (M11-R-160); M20 tool allow-lists; gateway redaction |
| Application security pipeline | CI gates (SAST, secrets, SBOM, DAST), annual penetration test |
| Evidence | Automated packs with hashed sources |
