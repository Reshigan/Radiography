# 14 — Integrations and Interoperability

## 1. Purpose and principles

The Platform is one system of record surrounded by hundreds of external systems: modalities, hospital
information systems, referrers' practice-management software, claims switches, medical schemes and
administrators, pathology laboratories, payment providers, banks, messaging channels, accounting and
payroll, and government or statutory bodies. This document specifies the standards the Platform
speaks, the connectors it ships, and the governance that keeps a 300-site integration estate
observable and replayable.

Principles (from 07 §6):
1. **Every message is stored raw and immutable before it is parsed.** Parsing can be redone; the
   original cannot be recovered any other way.
2. **Every inbound message and outbound command is idempotent** by `(source, message_id)` or by a
   deterministic business key.
3. **Ports and adapters.** Domain modules depend on port interfaces in `packages/ports`; each external
   system is an adapter in `adapters-cloudflare` (cloud: production, staging and demo) or
   `adapters-docker` (internal). Feature flags select the real adapter or its simulator; in demo
   mode the whole estate runs against simulators in `apps/sim` on synthetic data so that every
   workflow is demonstrable end to end. "Sandbox" below means that demo-mode simulator.
4. **Direction and lawful basis are explicit.** Every connector declares what data leaves the Practice
   tenant, on which POPIA basis, and under which operator agreement (15).
5. **Fail visibly, retry safely.** Dead-letter queues are worked by SUP and by Hands; nothing is
   silently dropped.

Owning module for the bus, message store and governance is M21 Platform Core; individual connectors
belong to the module that owns the business process (claims to M14, messaging to M13, laboratory
results to M07, accounting to M15).

## 2. Standards

### 2.1 DICOM

The Platform is a DICOM node at two levels: the **Edge Gateway** at each site (Orthanc sidecar,
07 §5) and the **central archive** (M09). Classic DICOM (associations over TCP) exists only on the
site network between modalities and the gateway; raw DICOM never crosses the internet. The gateway
forwards to the central archive as DICOMweb STOW-RS over HTTPS through an outbound-only tunnel
(cloud) or the private network (internal). Application Entity titles are registered per modality in
M02 and per gateway and archive in M21.

| Service | Role | Use |
|---|---|---|
| Verification (C-ECHO) | SCP and SCU | Heartbeats for uptime (M18 §3.3) |
| Storage (C-STORE) | SCP at gateway and archive; SCU to referrer PACS, hospital PACS, hub reading nodes | Ingest of all instances; forwarding with resumable, de-duplicated transfer |
| Storage Commitment (N-ACTION/N-EVENT-REPORT) | SCP | Modalities may delete local copies only after commitment; the gateway commits only after central archive acknowledgement or local durable write when offline |
| Modality Worklist (C-FIND on MWL) | SCP | Built from M05 appointments and M07 check-in; includes Scheduled Procedure Step, patient demographics with ID number in Other Patient IDs, Requested Procedure Code from the tariff-linked procedure master, protocol code, referring physician; refreshed on every relevant event |
| Modality Performed Procedure Step (N-CREATE/N-SET) | SCP | Study start and completion, performed protocol, operator, exposure summary; feeds M08 status, M17 attendance corroboration, M18 telemetry |
| Query/Retrieve (C-FIND, C-MOVE, C-GET) | SCP and SCU | Prior fetch from legacy PACS at acquired practices and hospital PACS; DICOMweb preferred where available |
| Radiation Dose Structured Report (RDSR) and legacy dose screen capture (with OCR fallback in M10) | SCP | M10 dose registry, DRL comparison |
| Structured Report, Presentation State, Segmentation, Key Object Selection | Both | AI results (M11) stored as SR and overlays; radiologist key images (M12) |
| DICOMweb (QIDO-RS, WADO-RS, STOW-RS) | Server for the Reading Room viewer, Patient Space image sharing and referrer viewing; client for prior fetch and third-party AI vendors | TLS with OAuth2 bearer tokens; scoped to study; time-limited share tokens for patients and referrers |
| Print (Basic Grayscale Print) | SCU optional | Film printing at sites that still require it |

Conformance: the Platform publishes a DICOM Conformance Statement per release, generated from the
adapter configuration. Character sets: ISO_IR 192 (UTF-8) requested; legacy Latin-1 accepted and
transcoded. Time zone: modalities are synchronised by NTP from the gateway; MPPS and RDSR times are
normalised to UTC with SAST display.

De-identification for AI vendors and research uses the `packages/dicom` de-identifier implementing
the DICOM PS3.15 basic profile with configured retained options; burned-in annotation detection is
required before any pixel data leaves the tenant (15).

* M21-R-100 Every DICOM association MUST be authenticated by calling AE title, IP allow-list on the
  modality VLAN, and TLS where the modality supports it; unknown AE titles MUST be rejected and
  logged.
* M09-R-160 Storage Commitment MUST NOT be granted for an instance until it is durably written to
  the gateway store or the central archive and its hash recorded.

### 2.2 HL7 v2.x

Used mainly with hospital information systems (hospital-based JVs, M02 §4) and with older
practice-management and laboratory systems. Transport is MLLP over a TLS tunnel or an IPsec VPN
between the hospital network and the Platform's integration endpoint (internal deployment) or a
hosted MLLP-to-HTTPS relay at the site gateway.

| Message | Direction | Use | Profile notes |
|---|---|---|---|
| ADT A01/A04/A08/A03/A11/A13, A40 (merge) | Inbound from hospital | Register, update, discharge and merge in-patients and hospital out-patients at hospital-based sites; M03 links the hospital's MRN as an identifier with assigning authority per hospital | PID-3 with multiple identifiers (MRN, SA ID number, passport); PV1 ward and attending doctor; IN1 scheme membership; message profile per hospital group, versioned |
| ORM O01 / OMG O19 | Inbound from hospital wards or referrer systems; outbound to hospital when the Practice originates the order | Orders become M04 orders with the hospital order number as a business key | OBR-4 mapped to the procedure master; ORC-1 NW/CA/XO for new, cancel, change |
| ORU R01 | Outbound to hospital and referrer systems; inbound from laboratories | Report delivery (text and PDF in OBX with ED type, plus a link to the referrer viewer); laboratory results inbound (eGFR, creatinine, INR, HCG) | OBX-5 with LOINC where the lab provides it; abnormal flags in OBX-8; report status in OBR-25 (P preliminary, F final, C corrected for addenda) |
| SIU S12/S13/S14/S15/S17 | Bidirectional with hospitals that schedule in their own system | Appointment create, reschedule, modify, cancel, delete | M05 remains the master for Practice-controlled rooms; hospital-controlled theatre or ward slots are mirrored |
| DFT P03 | Outbound to hospital billing where the hospital bills a facility fee | Charge lines (tariff code, ICD-10, units) | Only when the JV agreement assigns facility billing to the hospital |
| ACK | Both | Application-level acknowledgement with AA/AE/AR; original mode; enhanced mode where the partner supports it | Retries on no ACK with exponential back-off; duplicate detection on MSH-10 |

Each partner has a **message profile**: HL7 version (2.3 to 2.5.1 in practice), segment and field
map, code tables, character set (many SA hospital systems still send ISO-8859-1), delimiters,
acknowledgement mode, and test messages. Profiles are versioned reference data used by the
`packages/hl7-fhir` mapper; a profile change is a governed integration release (section 5).

### 2.3 FHIR R4

The Platform exposes and consumes FHIR R4 REST with JSON, using a **Bonakala implementation guide**
that constrains base resources and adds South African extensions. No national FHIR base profile is
assumed; where a national standard (for example under NHI implementation) becomes available, the
guide will derive from it and the extensions will be re-mapped.

| Resource | Use | SA extensions and constraints |
|---|---|---|
| Patient | M03 identity | `identifier` slices: SA ID number (system URI for the national identity number), passport with issuing country, hospital MRN, scheme membership number and dependant code; extension for preferred language from the 11 official languages and SASL; consent references |
| Coverage | Scheme membership | Payor as the medical scheme with administrator; class for plan/option; extension for scheme code from the funder reference table; RAF, COIDA and corporate payers modelled as Coverage with type codes |
| ServiceRequest | Referral and order (M04) | Requester with HPCSA number identifier and BHF practice number; reason with ICD-10; extension for clinical question, pregnancy status and eGFR reference |
| Appointment, Slot, Schedule | M05 | Site and modality as Location and Device; extension for load-shedding-aware availability |
| Encounter | Visit | Links registration (M07) |
| ImagingStudy | M09 | DICOM UIDs, series, modality codes, endpoint for DICOMweb |
| DiagnosticReport, Observation | M12, M13 | Signed reports with presented form (PDF), key images as ImagingSelection where supported, structured findings as Observations; critical-finding flag and acknowledgement Communication resources |
| Practitioner, PractitionerRole, Organization | Referrers, workers, entities | HPCSA number identifier; BHF practice number on Organization; DSP network membership |
| Consent | M07 | POPIA consent purposes and channel preferences |
| Claim, ClaimResponse, ExplanationOfBenefit | M14 canonical claim model | Tariff code system, ICD-10 diagnoses, modifiers, scheme-specific fields as extensions; the claims switch adapter translates to the switch's EDI format |
| Invoice, PaymentNotice, PaymentReconciliation | M14 debtors | Patient statements and remittance advices |
| Communication, CommunicationRequest | M13 | Notifications and critical-result acknowledgements |
| AuditEvent, Provenance | M21 | Disclosure logs for data-subject access; AI provenance on any AI-derived resource |
| Device, DeviceMetric | M18 | Modalities and telemetry |
| Subscription (R4 backport topics) | Third-party API | Webhooks (section 6) |

Operations: `$match` for patient identity, `$everything` for data-subject access exports, custom
`$quote` on ServiceRequest returning an estimated patient portion (M06) and `$eligibility` on
Coverage.

* M21-R-101 All FHIR resources that carry AI-derived content MUST include a Provenance resource with
  agent type "device", the model identifier, version and confidence, and MUST be validated against
  the implementation guide before storage.

### 2.4 IHE profiles referenced

| Profile | Application |
|---|---|
| Scheduled Workflow (SWF / SWF.b) | The order-to-report chain: MWL, MPPS, Storage Commitment, procedure status; the Platform's M04 to M08 flows follow the actor and transaction model |
| Patient Information Reconciliation (PIR) | Unidentified or mis-identified patients (trauma, wrong worklist selection) corrected after acquisition; M03 merge propagates to M09 with a reconciliation event |
| Cross-Enterprise Document Sharing for Imaging (XDS-I.b) and XCA-I | Where a hospital group or a future national health information exchange operates a registry; the Platform can act as Imaging Document Source; not required for launch |
| Radiation Exposure Monitoring (REM) | RDSR collection and export to a dose registry (M10) |
| Audit Trail and Node Authentication (ATNA) | Audit message format and node TLS for DICOM and HL7 between trusted nodes |
| Consistent Time (CT) | NTP across gateways and modalities |
| Invoke Image Display (IID) | Referrers' systems open the viewer on a study by URL with a scoped token |

## 3. South African ecosystem connectors

For each connector: direction, protocol, data, idempotency, error handling, monitoring, security,
and its sandbox in the Cloudflare demo. Owning-module requirements follow each group.

### 3.1 Claims switches (M14)

Medical scheme claims in South Africa flow through claims switches (EDI intermediaries) that
validate, route and return responses from schemes and administrators; some schemes also accept
claims directly. The Platform ships a **canonical claim message model** (FHIR Claim with SA
extensions, section 2.3) and per-switch adapters.

| Aspect | Specification |
|---|---|
| Direction | Outbound claims and reversals; inbound acknowledgements, validation responses, scheme responses, remittance advices; outbound eligibility and benefit queries where the switch offers them (M06) |
| Protocol | Two modes: EDI batch (files exchanged over SFTP or HTTPS upload on a schedule) and real-time (HTTPS API with a synchronous validation response and asynchronous scheme adjudication). Message formats differ per switch; each adapter maps the canonical model to the switch's format, versioned |
| Data | Practice number (BHF), treating and referring practitioner numbers, patient and member identifiers, dependant code, scheme and plan code, service date, tariff codes with modifiers and units, ICD-10 codes (mandatory on every line), amounts (VAT-inclusive rules per scheme), authorisation numbers, place of service, RAF and COIDA references where applicable |
| Conceptual message model | `ClaimSubmission` → `SwitchAck` (received, syntactically valid) → `ValidationResponse` (accepted for forwarding, or rejected with reason codes) → `SchemeResponse` (paid, short-paid, rejected, pended, per line with reason codes) → `RemittanceAdvice` (payment run reference, per-claim and per-line amounts, adjustments) → `ReversalRequest`/`ReversalResponse` |
| Idempotency | Claim number and a per-submission UUID; the switch's transaction reference stored on first acknowledgement; resubmission of the same claim number without a reversal is blocked unless the previous state is "rejected" |
| Error handling | Transport failures retried with back-off; syntactic rejections routed to BIL's exception queue with the reason taxonomy mapped to auto-fix paths (M14); scheme rejections update claim state and start the rejection workflow; unknown reason codes create a reference-data task |
| Monitoring | Per-switch dashboard: submitted, acknowledged, accepted, rejected, remitted, ageing of unacknowledged submissions, response latency, batch schedule adherence; alert when a batch acknowledgement is missing beyond the switch's SLA |
| Security | Mutual TLS or SFTP with key authentication; credentials in the secrets manager (15); claims contain health data, so the switch is a POPIA operator with a signed agreement; no claim data logged in clear text |
| Sandbox | `apps/sim/switch`: accepts the canonical model, applies a configurable rule set (random and rule-based rejections with realistic reason codes), produces scheme responses and remittance advices on a schedule, and replays scenarios (short payment, duplicate, resubmission deadline of typically four months from service date) |

* M14-R-190 The Platform MUST support at least two switch adapters plus direct-to-scheme submission
  through the same canonical model, selectable per scheme per Practice.
* M14-R-191 Every claim state change from a switch or scheme response MUST be traceable to the raw
  stored message.

### 3.2 Medical scheme and administrator portals and APIs (M06, M14)

| Aspect | Specification |
|---|---|
| Direction | Outbound eligibility checks, benefit and PMB queries, pre-authorisation requests, claim status queries; inbound authorisation decisions, tariff and rule updates where offered |
| Protocol | HTTPS APIs where a scheme or administrator publishes one (formats vary; JSON or SOAP); otherwise portal automation is prohibited and the Platform uses a **Authorisation Hand** that prepares the request for a human (BKG or BIL) to submit, with the response captured by upload or structured entry |
| Data | Member number, dependant code, ID number, planned procedure (tariff and ICD-10), site, date, clinical motivation |
| Idempotency | Request reference per authorisation attempt; a decision is attached to the order and the claim |
| Error handling | Timeouts fall back to the manual path with a task; conflicting decisions (portal says approved, API says pended) are surfaced, never auto-resolved |
| Monitoring | Authorisation turnaround per scheme, approval rate, API availability |
| Security | Per-scheme credentials, scoped to the Practice's practice number; consent recorded in M07 for the benefit check |
| Sandbox | `apps/sim/funder`: scheme rule packs for the listed example funders, PMB logic, authorisation decisions with realistic delays |

### 3.3 Practice-management systems used by referrers (M04, M13)

| Aspect | Specification |
|---|---|
| Direction | Inbound referrals; outbound reports, images links, appointment status |
| Protocol | FHIR R4 (ServiceRequest in, DiagnosticReport out) via the third-party API (section 6); HL7 v2 ORM/ORU over MLLP for older systems; secure e-mail with structured attachment and a fax-to-digital gateway as the lowest tier; the Referrer Space embedded widget for systems without integration |
| Data | Referral content, referrer identifiers (HPCSA, practice number), patient demographics, clinical question |
| Idempotency | Referrer's order identifier with assigning authority; duplicate referrals matched by patient, procedure and date window and presented to BKG |
| Error handling | Unparseable referrals (poor fax quality) route to the referral intake queue with the OCR draft in annotated style |
| Monitoring | Referral volume per source, parse success rate, report delivery confirmation rate |
| Security | Per-referrer client credentials; report delivery only to verified endpoints; a referrer sees only their own referrals |
| Sandbox | Simulated referrer system emitting FHIR ServiceRequests and HL7 ORM messages; fax images synthetic |

### 3.4 Hospital information systems (M02, M03, M04, M05, M13, M14)

Covered by 2.2. Additional points: hospital groups typically operate their own integration engine;
onboarding involves agreeing the message profile, an IP-to-IP VPN, test in the hospital's UAT
environment, and go-live with a parallel-run period. ADT merges must be honoured within one minute
to avoid wrong-patient worklist entries. Sandbox: a hospital ADT and order simulator with realistic
ward flows and merge scenarios.

* M03-R-160 Hospital MRNs MUST be stored as identifiers with assigning authority and MUST NOT be
  used as the Platform patient identifier; merges MUST be recorded as reversible link events.

### 3.5 Laboratory results for eGFR and other safety checks (M07, NUR)

| Aspect | Specification |
|---|---|
| Direction | Inbound results; outbound result requests where a laboratory offers a query interface |
| Protocol | HL7 v2 ORU R01 over MLLP or the laboratory's HTTPS API; FHIR Observation where available; patient-uploaded result PDF as fallback (extracted to a draft value in annotated style, confirmed by NUR) |
| Data | Creatinine, eGFR (with the equation used), potassium, INR, HCG, TSH for iodine considerations, with collection time and reference ranges |
| Idempotency | Laboratory accession number plus test code |
| Error handling | Unmatched patients queue for M03 matching; results older than the configurable validity window (for example 30 days for eGFR before contrast) are shown as expired |
| Monitoring | Result latency, match rate |
| Security | Laboratory as an independent responsible party sharing under the patient's consent for the imaging episode; results stored as clinical data with restricted access |
| Sandbox | Laboratory simulator producing realistic eGFR values and edge cases (acute kidney injury, missing units) |

### 3.6 SA ID verification services (M03)

| Aspect | Specification |
|---|---|
| Direction | Outbound query, inbound verification result |
| Protocol | HTTPS API of an accredited verification provider; Department of Home Affairs direct access only where a lawful channel and agreement exist (see also 3.15) |
| Data | ID number, names, date of birth; photo match optional with explicit consent |
| Lawful basis | POPIA s.11(1)(a) consent or s.11(1)(c) legal obligation where funder contracts require identity verification, and fraud prevention as legitimate interest; the purpose is recorded and the result stored as a verification status only, not the provider's full record; children's data under s.34 handled through guardian consent |
| Idempotency | One verification per ID number per configurable period; results cached with expiry |
| Error handling | Provider unavailable: registration proceeds with "unverified" status and a follow-up task; mismatch: front desk resolution flow |
| Monitoring | Verification rate, mismatch rate, provider latency and cost per query (data costs are real in SA; the Platform reports spend) |
| Security | Provider is an operator; minimum data sent; no bulk lookups |
| Sandbox | Deterministic simulator with valid Luhn-checked synthetic ID numbers and mismatch cases |

### 3.7 WhatsApp Business Cloud API (M13, M04, M05)

| Aspect | Specification |
|---|---|
| Direction | Inbound messages and status webhooks; outbound template and session messages |
| Protocol | WhatsApp Business Cloud API over HTTPS; webhook receiver in `apps/whatsapp` with signature verification |
| Data | Patient mobile number as the identifier, conversation content, media (referral photos, ID photos) |
| Templates and windows | Business-initiated messages outside the 24-hour customer-service window MUST use approved message templates (utility category for appointment reminders, results-ready notices, payment links; authentication category for OTP); within a session window free-form replies are allowed; template approval status tracked as reference data; language variants per official language as they are translated |
| Opt-in | Explicit opt-in recorded (checkbox on the Patient Space, a keyword reply, or front-desk capture with the patient present) with timestamp and channel; opt-out honoured immediately and mirrored in M07 consent preferences |
| Idempotency | WhatsApp message identifiers; outbound de-duplicated by (patient, template, business key, day) |
| Error handling | Delivery failures fall back to SMS then voice call task; number not on WhatsApp recorded to avoid retries |
| Monitoring | Delivery, read and reply rates per template; session window usage; quality rating and messaging limits from the API |
| Security | Content minimised (no diagnosis text in messages; results are links to the Patient Space with OTP); media stored in the tenant object store and deleted from the channel provider where the API allows; conversation transcripts are clinical records only when they carry clinical content |
| Sandbox | Conversation simulator with a web chat UI in the demo; templates rendered locally |

* M13-R-150 The Platform MUST NOT send clinical findings, report text or images in a WhatsApp or SMS
  body; messages carry status and authenticated links only.

### 3.8 SMS aggregators, email, telephony and CTI (M13, BKG)

| Connector | Direction | Protocol | Notes |
|---|---|---|---|
| SMS aggregator (SA) | Outbound; inbound replies and delivery receipts | HTTPS API of a local aggregator with reply short codes | Fallback channel for reminders and OTPs; sender ID registered; cost per message tracked; templates identical to WhatsApp utility copy |
| Email | Outbound transactional (reports to referrers via secure link, statements, invoices); inbound (referrals, complaints, laboratory results) | SMTP relay or email API; inbound parsing with attachment extraction | DKIM, SPF and DMARC configured for every sending domain; PDF reports are password-protected or link-only per referrer preference |
| Telephony and CTI | Click-to-call from consoles; inbound screen-pop for BKG; call recording for critical results (M13) and complaints | SIP-based cloud PBX or contact-centre platform API; WebRTC softphone in the browser | Recordings stored in the tenant object store with retention per 15; critical-result calls link the recording to the acknowledgement event; consent announcement for recording |
| Fax-to-digital | Inbound | Fax gateway delivering images to the referral queue | Still used by some referrers; OCR draft in annotated style |

Sandbox: all four are simulated with in-browser inboxes and a soft-phone mock.

### 3.9 Payment service providers (M14, DEB, FDK)

| Aspect | Specification |
|---|---|
| Direction | Outbound payment requests (hosted page, payment link, QR); inbound webhooks (authorised, settled, refunded, disputed); outbound refunds |
| Methods | Card (3-D Secure), PayShap (instant payment by proxy or QR), EFT (instant EFT where offered; standard EFT with reference matching in 3.10), QR wallets, debit orders for payment plans |
| Data | Amount, reference (statement or invoice number), patient reference token; no card data touches the Platform (PSP hosted fields) |
| Idempotency | PSP transaction reference plus Platform payment intent; webhook replay tolerated |
| Error handling | Pending states time out to "unpaid" with re-offer; disputes open a DEB task |
| Monitoring | Authorisation rate, settlement latency, fees per method |
| Security | PCI DSS scope kept at the PSP; webhook signature verification; PSP as operator for personal data |
| Sandbox | PSP simulator with a hosted page, success/failure/dispute scenarios |

### 3.10 Banks (M15, M14)

Statement feeds by API where the bank offers business banking APIs, otherwise scheduled CSV/OFX
downloads uploaded by finance or fetched over SFTP. Data: transactions with references, amounts,
dates. Matching: remittance advices from switches (3.1) and PSP settlements are matched to bank
lines; unmatched EFTs from patients are matched by reference and amount with a DEB queue for the
rest. Outbound: EFT batch files for supplier payments, JV distributions (M02 §5) and refunds,
released by two approvers. Idempotency by bank transaction identifier. Sandbox: bank simulator
producing statement lines aligned to the switch and PSP simulators.

### 3.11 Accounting systems (M15)

Connectors for Xero, Sage and SAP Business One as examples, each an adapter implementing the
`AccountingPort` (journals, invoices, credit notes, suppliers, customers, payments, period locks).
Direction: outbound journals from M15 (revenue by tariff group, VAT, management fees, intercompany,
depreciation), outbound supplier invoices from M18 procurement; inbound chart of accounts and period
status. Idempotency by journal reference; a journal already posted is never re-posted. Errors (period
closed, mapping missing) create finance tasks. Sandbox: an in-memory ledger with a UI.

### 3.12 Payroll (M17, M15)

Outbound approved timesheet lines (ordinary, overtime, Sunday, public holiday, night, on-call,
locum invoices) and leave balances to the payroll provider; inbound cost by cost centre and payslip
availability notices. Format: the provider's import file or API. Security: worker data restricted;
bank details never stored on the Platform. Sandbox: payroll import validator.

### 3.13 E-signature (M02, M07, M17)

Outbound signing requests for shareholder resolutions, agreements, employment contracts, consent
where a formal signature is required; inbound signed documents with audit certificates. The
Platform's own `Signature` component covers routine patient consent; an external e-signature
provider is used for legal documents. Advanced electronic signatures under the Electronic
Communications and Transactions Act are used where a statute requires them.

### 3.14 RAF and Compensation Fund submissions (M06, M14)

| Aspect | Specification |
|---|---|
| RAF | Claims for imaging of road-accident victims are typically lodged with the RAF's supplier claims channel with the claim reference, the treating practitioner details, invoices and reports; the Platform prepares the pack (invoice, report, referral, RAF reference) and submits through the channel available at the time (portal upload or e-mail with a tracking reference), recorded as a human submission with the pack hash; status tracked as a debtor class with its own ageing rules (long settlement periods) |
| Compensation Fund (COIDA) | Injury-on-duty claims require the employer's claim number, the medical report forms and invoices in the Compensation Fund's format; submission via the Fund's electronic channel where available or through a medical-claims administrator; the Platform generates the forms and tracks the claim; ODMWA cases for mine workers follow the Medical Bureau for Occupational Diseases pathway with the occupational record retention rules |
| Idempotency | External claim reference plus invoice number |
| Monitoring | Ageing, acceptance rate, resubmission reasons |
| Sandbox | Simulated portals with realistic states (registered, pending, approved, paid, queried) |

### 3.15 Home Affairs (where lawful)

Direct verification against the National Population Register is available only through accredited
channels and agreements. The Platform includes the port; the adapter is enabled only when a lawful
agreement exists and the Information Officer has recorded the basis. Otherwise the ID verification
provider (3.6) is used. Death notifications (to stop reminders and dunning) are handled through the
same port with the same constraints.

### 3.16 SARS e-filing exports (M15)

The Platform produces VAT201, EMP201 and EMP501 supporting schedules and IT14SD-style
reconciliations as export files for the accountant or the payroll provider to file; direct filing is
not attempted at launch. Tax invoices comply with the VAT Act requirements (VAT number, "Tax
Invoice" wording, 15 %). Exports are versioned and reconciled to the ledger.

### 3.17 Maps and site finder (M05, PAT)

Google Maps Platform or OpenStreetMap-based services for geocoding sites, travel-time estimation
for slot recommendation (nearest site with capacity), and the public site finder. Patient location
is used only with browser consent and never stored beyond the session. Sandbox: static geocodes.

### 3.18 Courier and CD logistics (M09, M13)

For patients and referrers who require physical media or printed reports: courier API for
collection and tracking, with the parcel linked to the study and a chain-of-custody record;
media encrypted and password-protected; a KPI tracks the decline of physical media as Patient Space
sharing grows. Sandbox: tracking simulator.

### 3.19 Load-shedding schedules (M18)

Ingest of published stage and area schedules from an available schedule service or manual entry;
feeds M18 §3.8. Sandbox: schedule generator.

### 3.20 Connector summary

| Connector | Owning module | Direction | Protocol | Demo sandbox |
|---|---|---|---|---|
| Modalities (DICOM) | M08/M09 | Both | DICOM, DICOMweb | `apps/sim/modality` C-STORE and MWL client |
| Claims switches | M14 | Both | EDI batch, HTTPS real-time | `apps/sim/switch` |
| Scheme portals and APIs | M06 | Both | HTTPS | `apps/sim/funder` |
| Referrer PMS | M04/M13 | Both | FHIR, HL7, email, fax | referrer simulator |
| Hospital HIS | M02/M03/M04 | Both | HL7 v2 MLLP | hospital simulator |
| Laboratories | M07 | Inbound | HL7, FHIR, API | lab simulator |
| ID verification | M03 | Both | HTTPS | deterministic simulator |
| WhatsApp | M13 | Both | Cloud API | conversation simulator |
| SMS, email, telephony, fax | M13 | Both | API, SMTP, SIP | inbox and softphone mocks |
| PSP | M14 | Both | HTTPS, webhooks | PSP simulator |
| Banks | M15 | Both | API, SFTP, files | bank simulator |
| Accounting | M15 | Both | API | in-memory ledger |
| Payroll | M17 | Both | API, files | import validator |
| E-signature | M02/M17 | Both | API, webhooks | signing mock |
| RAF, Compensation Fund | M06/M14 | Outbound | Portal, files | portal simulators |
| Home Affairs | M03 | Both | Accredited channel | disabled in demo |
| SARS exports | M15 | Outbound | Files | file validator |
| Maps | M05 | Outbound | HTTPS | static |
| Courier | M09 | Both | API | tracking simulator |
| Load-shedding schedules | M18 | Inbound | HTTPS, manual | generator |

## 4. Message store, replay and observability (M21)

Every inbound and outbound message (DICOM association metadata and instance hashes, HL7, FHIR,
switch, webhook, email) is written to the **message store** before processing: raw bytes (or object
store reference for large payloads), source, direction, received time, message identifier,
correlation identifiers, parse status, processing outcome, and links to domain objects created or
updated. The store is append-only, tenant-scoped, encrypted and retained per 15.

Replay: an operator (SUP) or a Hand with the replay tool may re-process a message or a range by
filter after a mapping fix; replays are idempotent by design and are themselves logged. Poison
messages sit in a dead-letter queue with the parse error, a proposed fix (annotated) and an owner.

Observability: per-connector dashboards (throughput, latency, error rate, backlog, last successful
message, SLA breaches), traces across the bus, and alerts to SUP and BIO. Modality connectivity
appears in M18; claims flows in M14; messaging in M13. A Group-level integration health map shows
every site and partner.

* M21-R-102 The message store MUST retain the raw message and MUST support replay of any message or
  range without side effects beyond those of first processing.
* M21-R-103 Every connector MUST expose a health endpoint and metrics; a connector with no
  successful message beyond its expected interval MUST alert.

## 5. Integration governance

| Practice | Specification |
|---|---|
| Versioning | Every adapter, message profile and FHIR implementation guide version is tagged; breaking changes require a new major version and a partner migration window; the API supports at least two major versions concurrently |
| Conformance testing | An automated conformance suite per standard: DICOM (Storage, MWL, MPPS, Q/R, DICOMweb) against reference toolkits; HL7 profiles with message sets per partner; FHIR validation against the implementation guide; switch adapters against recorded (de-identified) response corpora; tests run in CI and before each partner go-live |
| Partner onboarding kit | Per partner type: integration guide, sample messages, test credentials for the sandbox environment, conformance checklist, security questionnaire, operator agreement template, go-live checklist with parallel-run criteria, support contacts |
| Change control | Integration changes go through the same release process as code; partner-facing changes are announced through the developer portal with dates |
| Reference data | Tariff codes, ICD-10, scheme codes, switch reason codes, HL7 tables, template catalogues are versioned reference data with effective dates and a change approval (BIL or CMP) |
| Data flows register | Each connector's data flow, purpose, lawful basis, operator and cross-border status is recorded for the POPIA processing register (15) |

## 6. Third-party API and developer portal

The Platform exposes a public API for referrers' systems, funders, hospital groups, AI vendors and
integrators.

| Aspect | Specification |
|---|---|
| Authentication | OAuth 2.0 client credentials for system-to-system; authorisation code with PKCE where a user context is needed (a referrer using a third-party app); mutual TLS optional for funders |
| Scopes | Fine-grained and per Practice: `referral.write`, `report.read`, `imaging.read`, `appointment.read`, `appointment.write`, `claim.read`, `eligibility.read`, `webhook.manage`, `ai.result.write` (AI vendors), each with a data-minimisation note; scopes issued only under a signed agreement and recorded lawful basis |
| Rate limits | Per client and per scope with burst and sustained limits; 429 with `Retry-After`; funders and hospitals on negotiated tiers |
| Webhooks | Subscriptions per event type (`report.signed`, `appointment.changed`, `critical.finding.acknowledged`, `claim.responded`) with HMAC signatures, retries with back-off for 24 hours, replay from the portal, and a delivery log |
| Formats | FHIR R4 JSON per the implementation guide; REST for non-FHIR resources (quotes, slots, Hand tasks); OpenAPI specification published |
| Environments | Sandbox (the Cloudflare demo with simulators and synthetic data) and production; sandbox keys self-service, production keys by onboarding |
| Developer portal | Documentation, implementation guide, OpenAPI, sample code, conformance test runner, key management, webhook logs, status page, change log, support tickets |
| Security | 15 applies: TLS 1.3, token lifetimes, audience-bound tokens, IP allow-lists for funders, audit of every call with client identifier |

* M21-R-104 Third-party access to identified patient data MUST be scoped to the Practice's patients
  with a relationship to the client (a referrer's own referrals; a funder's own members for a claim
  in question), enforced by ABAC (15 §4), and logged as a disclosure.
* M21-R-105 The sandbox MUST contain only synthetic data labelled as such and MUST be functionally
  identical to production for every published endpoint.

## 7. Process view: onboarding an integration partner

**Trigger**: a new hospital JV, a referrer group asking for e-referral, a scheme offering a
real-time API, an AI vendor.

**Actors**: SUP (integration engineer), BIO (site networks), CMP (agreements and lawful basis), the
partner, the Integration Hand.

**Happy path**
1. Partner classified by type; the onboarding kit is sent from the developer portal.
2. CMP records the operator or data-sharing agreement and lawful basis in the data-flows register.
3. Sandbox credentials issued; the partner runs the conformance suite; the Integration Hand reviews
   failures, drafts mapping proposals for the message profile and prepares test evidence.
4. Network path established (VPN, allow-lists, AE titles) by BIO; security questionnaire closed.
5. Production credentials issued with scopes; parallel run for a defined period with reconciliation
   reports (messages sent versus received versus acted on).
6. Go-live sign-off by SUP and the partner; monitoring thresholds set; the partner appears on the
   integration health map.

**Variants**: legacy PACS migration at an acquired practice (bulk DICOM Q/R migration with
throttling, de-duplication and verification counts); switch migration (dual submission blocked;
cut-over by service date). **Automation level**: A2 for testing and mapping proposals; A1 for
credentials and go-live.

The Integration Hand's leash: it may run conformance tests, propose mappings, draft partner
communications and open tickets; it may not issue credentials, change production mappings or change
network rules.

## 8. KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Modality connectivity | Modalities with heartbeat in the last interval / total in service | 100 % |
| MWL accuracy | Studies acquired against a worklist entry / studies acquired | ≥ 99.5 % |
| HL7 acknowledgement latency | P95 time to application ACK | < 2 s |
| Claim switch acceptance latency | Submission to validation response (real-time) | < 10 s P95 |
| Batch acknowledgement adherence | Batches acknowledged within the switch SLA | 100 % |
| Report delivery confirmation | Signed reports with confirmed delivery to the referrer's chosen channel within 15 minutes | ≥ 98 % |
| WhatsApp delivery | Template messages delivered | ≥ 97 % |
| Dead-letter age | Oldest unresolved message | < 4 hours |
| Replay success | Replays completing without new errors | ≥ 95 % |
| Partner onboarding time | Kit sent to production go-live | ≤ 30 days (referrer PMS), ≤ 90 days (hospital HIS) |
| API availability | Public API monthly availability | ≥ 99.9 % |
| Webhook delivery | First-attempt success | ≥ 99 % |

## 9. Controls

| Control | Mechanism |
|---|---|
| Lawful basis per flow | No connector is enabled for a Practice until its data-flow record and agreement are approved by CMP |
| Idempotency | Enforced in the bus for all inbound messages and all outbound commands with external effects (claims, payments, messages) |
| Raw retention | Message store append-only; deletion only by the retention schedule |
| Least privilege | Adapter credentials scoped per Practice and per function; secrets rotated per 15 |
| Segregation | The engineer who changes a mapping cannot approve its production release alone |
| Synthetic data in sandboxes | Simulators generate labelled synthetic data; production data never copied to sandbox |
| Change announcements | Partner-facing changes announced with notice periods; two concurrent API majors |
| Monitoring and alerting | Every connector on the health map with owner and escalation |
