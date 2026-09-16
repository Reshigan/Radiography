# 06: Image Management (PACS)

Module: **M09 Image Management (PACS)** (owner).
Related: M08 Acquisition & Worklist (upstream), M03 Patient Master Index (identity), M11 Clinical
Intelligence (BCI) (inference routing), M12 Reporting (viewer), M13 Results & Communication (sharing),
M01 Identity & Access (consent, break-glass), M19 Quality, Risk & Compliance (retention, legal holds,
POPIA), M21 Platform Core (files, events), M20 Agent Runtime.

## 1. Purpose

Receive every image object produced at every site, validate it, store it durably and cheaply, put it
in front of the right people (radiologist, referrer, patient, AI model) within seconds, keep it for as
long as the law and the practice require, and prove at any time that it is complete and unaltered.

The Platform replaces the pattern that still dominates the SA market: one PACS per practice, priors on
a CD in the patient's handbag, a courier for outside films, and images that are inaccessible the moment
the patient crosses to another provider. Bonakala has one image index across the whole network, with
tenant isolation by Practice and consented sharing between them.

| Today (typical) | Bonakala target |
|---|---|
| Priors from another branch fetched by phoning the branch | Priors from any site of the same Practice pre-fetched before the appointment; cross-Practice priors fetched on consent |
| Images on CD or USB | Secure, time-bound viewing link in the Patient Space and Referrer Space; CD burning kept for those who need it |
| Wrong-patient fixes done by the vendor engineer | Wrong-patient correction by an authorised user with full audit, no engineer |
| Retention "forever, on the same disks" | Tiered storage with a retention and destruction schedule per record class and legal holds |
| Research and teaching extracts done by hand | De-identification pipeline aligned with DICOM PS3.15 basic profile, with consent checks |

## 2. Scope

Ingest, conformance, reconciliation, routing, storage tiers, compression, priors, DICOMweb services,
viewers, sharing and export, retention and destruction, integrity, disaster recovery, hanging protocols,
key images, teaching files, research extracts, performance targets, KPIs and the Priors Hand.

Out of scope: image interpretation (M12), AI model behaviour (M11), report distribution (M13).

## 3. Trigger

| Trigger | Source |
|---|---|
| Image object received by C-STORE at an Edge Gateway | Modality, contrast injector (secondary capture), workstation (post-processing), external DICOM node |
| STOW-RS upload | Reading Room post-processing, external import tool, mobile app |
| Import from CD, USB or another provider's link | Front desk import station, Patient Space upload (consented), Referrer Space upload |
| Appointment created or check-in | Priors pre-fetch by the Priors Hand |
| `study.acquired.v1` | Routing to reading hub, referrer PACS, AI |
| `report.signed.v1` | Routing of key images and presentation states to distribution |
| Scheduled | Tier migration, retention review, integrity verification, DR tests |

## 4. Actors

| Actor | Role |
|---|---|
| RAD | Sends images, corrects laterality and view labels, flags key images, imports outside studies at the modality |
| RGT | Consumes images in the Reading Room; requests priors; creates key images, presentation states and teaching cases |
| FDK | Imports CDs and USBs; issues sharing links and burns CDs on request; records consent |
| REF | Views images in the Referrer Space; receives DICOM push to their own PACS where configured |
| PAT | Views images in the Patient Space; shares a link with another doctor; uploads outside images |
| BIO | Operates gateways and the central archive; manages DICOM conformance, AE titles, routing rules, storage capacity, DR tests |
| CMP | Owns retention schedule, legal holds, destruction approvals, POPIA access requests, research and teaching de-identification approvals |
| AIO | Consumes routed studies for inference; owns the research extract pipeline validation |
| Priors Hand (M20) | Finds and fetches relevant prior studies from any source the patient has consented to, before the reading starts |
| Edge Gateway | DICOM SCP, local cache, validation, forwarding |
| Central archive | Durable object storage, index, DICOMweb services |

## 5. Preconditions

1. Each modality and external node is registered on M18 with AE title, IP, allowed services and conformance notes; the gateway rejects unknown calling AE titles (configurable allow list).
2. The Edge Gateway is enrolled and healthy or in offline mode.
3. The patient exists on M03 (or a placeholder for emergency work).
4. Routing rules for the Practice and site are configured (defaults are provided at onboarding).
5. The retention schedule and record classes are configured for the Practice (defaults from M19).

## 6. Happy path (ingest to availability)

1. **Receive.** The modality sends the series by C-STORE to the site Edge Gateway (Orthanc sidecar as the DICOM SCP, behind the gateway service). The gateway acknowledges only after the object is written to local disk.
2. **Validate.** The gateway checks: DICOM conformance (required tags for the SOP class, transfer syntax accepted, pixel data present or a valid SR/PR/SEG object), calling AE title allowed, Study Instance UID consistent within the study, Accession Number and Patient ID present. Objects that fail validation are quarantined with the reason, not discarded.
3. **Match.** The gateway matches Accession Number and Patient ID to the SPS on the worklist mirror. A match links the study to the order and visit. A mismatch places the study in the `unmatched` queue (see 7.1) while still storing the images.
4. **De-duplicate.** SOP Instance UIDs already present (a modality resend, a gateway retry, an import of an already-held study) are acknowledged and dropped, with a counter; objects with the same UID but different pixel hash are quarantined as a conflict.
5. **Local cache and forward.** The object is kept in the gateway's 30-day cache and enqueued for forwarding to the central archive. Raw DICOM never crosses the internet: the gateway forwards by STOW-RS over HTTPS through the outbound-only Cloudflare Tunnel (cloud) or the private network (internal deployments). Transfers are resumable, batched per study, compressed on the wire, and rate-limited by the site link policy (data cost awareness: bulk backfill after outages runs at a configurable off-peak rate).
6. **Central ingest.** The central archive writes the object to hot object storage, computes and stores its SHA-256 hash, indexes patient, study, series and instance metadata in the relational index, and emits `image.instance.stored.v1`. When the last expected object of a study arrives (from M08's completeness check) it emits `study.available.v1`.
7. **Route.** Routing rules evaluate the study: to the reading worklist (M12) at the assigned hub or practice; to BCI inference (M11) by modality, body part, site and age; to the referrer's PACS by DICOM push or to the referrer's account in the Referrer Space (after sign-off unless the referrer is configured for pre-report image access); to a hospital PACS at JV sites; to a second archive replica for DR.
8. **Priors ready.** The Priors Hand has already fetched relevant priors (see 9.1); the reading worklist entry shows priors availability.
9. **Serve.** The viewer opens the study over DICOMweb (WADO-RS with progressive loading, thumbnails and pre-rendered frames from the archive; on the site LAN the gateway serves from its cache so the first image appears in under a second).
10. **Tier.** After 90 days without access the study moves from hot to warm storage; after 2 years to cold archive; retrieval from cold is transparent to the user with a visible "retrieving" state and a target of under 15 minutes.

## 7. Variants and exceptions

### 7.1 Patient and study reconciliation

| Situation | Handling |
|---|---|
| Accession Number missing or unknown (typed at the modality) | `unmatched` queue; the QC Hand (process 05) proposes a match by patient name, date of birth, modality, time and room; RAD or FDK confirms; the study is re-labelled with the correct accession and Patient ID by a coercion record that keeps the original values |
| Patient ID matches but name differs beyond a tolerance (typo at the modality) | Auto-coerced to the MPI values, difference logged |
| Images stored under the wrong patient | Wrong-patient correction: an authorised user (RAD lead, BIO or CMP) selects the study, chooses the correct patient, states the reason; the Platform moves the study, rewrites the patient-level tags in the served copies while keeping the original objects immutable with a correction record, invalidates any routed copies (revocation messages to referrer PACS and the Referrer Space, link expiry), notifies the radiologist if a report exists, and opens an M19 incident |
| Two MPI records merged (M03) | All studies re-indexed under the surviving identifier; served tags follow the surviving record; original objects untouched |
| Study split (two patients scanned under one accession) | The user selects the series that belong to the second patient; a new study is created with new Study Instance UID for the served copy; both carry a link to the split record |
| Series belongs to a different study of the same patient | Series move with audit |

### 7.2 External imports

* CD and USB import at the front desk: the import station reads the disc, shows the patient details found on the media, requires the FDK to confirm the M03 match (two identifiers), records the source (provider name if present, date) and consent basis, de-duplicates against the archive, and stores with the `external` flag and the original provider's UIDs preserved. Imported studies are readable, comparable and shareable but are never billed.
* Imports from other providers through the Referrer Space or Patient Space upload (zip of DICOM or a DICOMweb link) follow the same path.
* Imports where the media is corrupt or non-DICOM (JPEG prints) are stored as documents with an `image_document` type, not as DICOM.

### 7.3 Priors fetching

* Same Practice, any site: automatic; no additional consent needed (same responsible party).
* Cross-Practice within the network: allowed under the Group data-sharing agreement only when the patient has consented (recorded on M01 with a purpose "continuity of imaging care"); the Priors Hand checks the consent flag before fetching. Where consent is absent, the Reading Room shows "Prior exists at [Practice], consent not recorded" and offers the FDK a one-tap consent capture with the patient.
* External providers with a DICOM query/retrieve or DICOMweb interface and an agreement: fetched by the Priors Hand on consent.
* Patient-uploaded outside images: treated as external imports.

### 7.4 Large studies and slow links

Tomosynthesis, CT perfusion, cardiac and long MR studies can be several gigabytes. The gateway serves the site's own readers from cache; central forwarding runs with priority for studies awaiting reading elsewhere; the viewer uses progressive loading and precomputed lower-resolution frames for first paint.

### 7.5 Load-shedding and link loss

Ingest continues on the gateway; routing decisions are recorded and executed when the link returns; readers at the site read from the gateway; readers at the hub see the study as "at site, transferring" with an estimated time.

### 7.6 Legal holds

A CMP user can place a legal hold on a patient, study or date range (RAF, COIDA, medico-legal, complaint, regulator request). Held objects are exempt from tier destruction and from patient-requested deletion; the hold has a reason, an owner, a review date and an audit trail.

## 8. Storage tiers, compression, retention and destruction

### 8.1 Tiers

| Tier | Medium | Rule (configurable per Practice) | Access target |
|---|---|---|---|
| Edge cache | Gateway disk | 30 days rolling; longer for sites with poor links | First image under 1 s on LAN |
| Hot | Object storage, SA region | 90 days from last access | First image under 3 s on 20 Mbps |
| Warm | Object storage, infrequent access class | 90 days to 2 years | Under 10 s |
| Cold archive | Archive class | 2 years to end of retention | Under 15 minutes, transparent retrieval |
| DR replica | Second region, within South Africa where the platform allows it (see architecture §10 on data residency; otherwise under POPIA s.72 conditions and a data-processing agreement recorded on M19) | All tiers | RPO 15 min, RTO 4 h |

Studies with a scheduled follow-up or a pending report stay hot regardless of age; mammography priors are pre-warmed before the next screening appointment.

### 8.2 Compression

* Archive storage is always lossless (JPEG 2000 lossless or JPEG-LS transfer syntaxes; originals stored with their received transfer syntax and hash; any transcoding is recorded).
* Lossy compression is used only for non-diagnostic sharing (Patient Space previews, WhatsApp thumbnails, referrer quick-look on mobile) and is always labelled "not for diagnostic use" on the image and in the metadata. Referrers can always open the lossless object.
* Mammography and CT are never served lossy to the Reading Room.

### 8.3 Retention and destruction schedule

| Record class | Minimum retention (configurable; defaults from HPCSA guidance and the Platform's architecture NFRs) |
|---|---|
| Adult imaging and reports | 6 years from the date of the study |
| Minors | Until the patient's 21st birthday plus 6 years |
| Mentally incapacitated patients | Duration of the patient's life (per HPCSA guidance) |
| Mammography | Longer, configurable; screening programmes typically keep priors for comparison for many years |
| Occupational health (COIDA), mine workers (ODMWA) | Extended retention per the applicable statute; stored as reference data |
| RAF and medico-legal cases | Until the matter is closed plus the configured period; legal hold applies |
| Research extracts | Per the ethics approval, then destroyed |

Destruction runs as a reviewed batch: the Platform lists candidates past retention with no hold and no pending follow-up; CMP approves; objects are cryptographically erased in all tiers and replicas; a destruction certificate (list of study UIDs, hashes, date, approver) is retained permanently. Patient POPIA deletion requests are evaluated against the retention obligations and answered with the lawful basis where deletion is refused.

## 9. AI and agent touchpoints

### 9.1 The Priors Hand

| Attribute | Definition |
|---|---|
| Mandate | For every scheduled or acquired study, find prior studies that a radiologist would want for comparison, fetch them into hot storage before reading starts, and record what was fetched and why; surface consent gaps to FDK |
| Inputs | Study modality and body part, order indication, patient MPI id and linked identities (M03), consent flags (M01), Practice and network study index, external source agreements |
| Relevance rules | Same body region and modality first; any modality of the same region within a configurable window; oncology and follow-up contexts extend to all relevant regions; mammography always fetches the two most recent screening rounds and any diagnostic work-up |
| Tools | `search_priors_index`, `read_consent`, `fetch_study` (network, external DICOM Q/R, DICOMweb), `warm_tier`, `annotate_worklist_entry`, `request_consent_capture`, `notify_fdk` |
| Leash | May not fetch from another Practice or an external provider without a recorded consent; may not fetch more than a configurable data volume per study without RGT request; may not modify any object; may not fetch for a study that has no order (no speculative fetching) |
| Approval policy | Same-Practice and consented fetches are A3; external fetches under a new agreement are A2 until the agreement is validated by BIO |
| Audit | Every search, fetch, consent check and refusal; per-fetch source, size, duration |
| Monitoring | Priors-ready rate at reading start; fetch latency; consent-gap rate; irrelevant-prior rate (RGT feedback button) |

### 9.2 Other AI touchpoints

* Body-part and laterality inference from images (M11) is used to improve routing and hanging protocols where the header is incomplete; it is stored as a `derived_body_part` with provenance and never overwrites header values.
* De-identification quality checks (see 12) use an OCR model to detect burned-in text in pixel data before an object may leave for research or teaching.

## 10. DICOMweb and DICOM services

| Service | Purpose | Notes |
|---|---|---|
| C-STORE SCP (gateway and central) | Ingest | Accepts all storage SOP classes in the conformance statement, including SR, PR, SEG, KOS and RDSR |
| C-FIND / C-MOVE / C-GET SCP (gateway) | Query and retrieve by modalities and workstations on site | Restricted to registered AE titles |
| C-STORE SCU (on site or over a private link only) | Push to a hospital PACS on the same network or a referrer PACS reachable over a VPN or private link | Per routing rule, with retry and delivery receipts; raw DICOM is never sent over the public internet |
| STOW-RS client | Gateway to central archive; push to referrer systems that accept DICOMweb over HTTPS | The default outbound path |
| QIDO-RS | Study, series, instance search for the viewer, Referrer Space, Patient Space and integrations | Tenant-scoped; consent-scoped for cross-Practice |
| WADO-RS | Retrieve instances, frames, rendered images, thumbnails, metadata, bulk data | Progressive; supports transfer syntax negotiation |
| STOW-RS | Uploads from the Reading Room, mobile app, import tools, external partners | Validated as C-STORE |
| WADO-URI | Legacy retrieval for older referrer systems | Read-only, time-limited tokens |
| FHIR ImagingStudy | Study-level metadata for the integration bus | Generated from the index |

A published DICOM conformance statement covers the gateway and the central archive, listing SOP classes, transfer syntaxes, character sets (ISO_IR 192 UTF-8 for African-language names), and services. It is versioned in the repo and provided to modality vendors at onboarding.

## 11. Viewers, hanging protocols, key images, sharing and export

### 11.1 Viewer requirements

| Viewer | Users | Requirements |
|---|---|---|
| Reading Room diagnostic viewer | RGT | Per the design system §6: Cornerstone3D, DICOMweb, progressive loading, MPR, MIP, 3D, mammography hanging protocols, cine, measurements, key images, GSDF-calibrated display support, AI overlays with provenance |
| Clinical review viewer (zero-footprint) | REF, RAD, NUR, hospital clinicians | Browser only, no install; window and level, zoom, pan, scroll, cine, basic measurements, key images first, series thumbnails; works on 3G with progressive loading; labelled "for review, not primary diagnosis" unless the display and connection meet the diagnostic policy |
| Patient viewer (zero-footprint) | PAT | Simplified; key images first; lossy previews with a link to the lossless study; plain-language labels; no measurements; works on a 5-year-old Android phone |
| Mobile on-call viewer | RGT | Same as clinical review with diagnostic-quality retrieval on request and a visible warning about display limits |

### 11.2 Hanging protocols

Hanging protocols are stored per radiologist, per modality and body part, with Practice defaults. They define layout, series selection by description or derived body part, prior placement (current left, prior right, or top and bottom), window presets, and mammography standard views (CC and MLO with prior comparison, tomosynthesis stacks). A protocol that cannot be satisfied (missing series) falls back to the next best and shows why.

### 11.3 Key images and presentation states

Key images are stored as DICOM Key Object Selection documents; annotations and windowing as Grayscale Softcopy Presentation States; AI overlays as separate Presentation States or Segmentation objects with provenance in the metadata. Key images selected by the radiographer and by the radiologist are both kept, labelled by author.

### 11.4 Sharing links

* A sharing link is created by FDK, RGT, REF (for a colleague) or PAT (from the Patient Space) for a study or a report with images.
* Every link is time-bound (default 30 days, configurable), requires an OTP to the recipient's mobile number or a Referrer Space login, records the consent basis (patient-initiated, referrer under the referral, third party with patient consent), applies a visible watermark on rendered images (recipient name and date) and a "not for diagnostic use" label on lossy renders, is revocable, and logs every open.
* A link can be scoped to a study, a series, key images only, or the report only.

### 11.5 Export and physical media

* The default export is the secure link. CD or DVD burning and USB export remain available at sites with a burner, with the DICOMDIR, an embedded viewer that runs without installation (open-source, licence-compatible), the report PDF, and a label printed with patient name, date of study and a warning that the media contains personal information.
* Every export is logged with the recipient and reason. RAF, COIDA and medico-legal exports produce a chain-of-custody record (see process 08).
* Bulk export to a departing radiologist or a practice leaving the network runs as a CMP-approved job with hash manifests.

## 12. Teaching files and research extracts

### 12.1 Teaching files

A radiologist can save a case to the Practice teaching library. The Platform de-identifies the images (see 12.2), asks for the patient's teaching consent status from M01 (consent captured at registration or specifically), strips the report of identifiers, and stores the case with a diagnosis category, modality, and teaching notes. Cases without teaching consent cannot be saved. Teaching files are searchable within the Practice and shareable to the network's education programme by CMP approval.

### 12.2 De-identification pipeline

* Aligned with DICOM PS3.15 Annex E, Basic Application Level Confidentiality Profile, with the options configured per purpose: Clean Pixel Data (burned-in text detection by OCR and masking, with manual review for modalities known to burn in text such as ultrasound and secondary captures), Clean Descriptors (free-text tags checked for identifiers), Retain Longitudinal Temporal Information with Modified Dates (date shifting per patient, consistent across studies), Retain Patient Characteristics (age band, sex, size for dose and AI research) where the ethics approval permits, Retain Device Identity for QA research where approved.
* UIDs are replaced with mapped values; the mapping is stored separately under CMP control and used only for re-identification under the ethics protocol.
* A quality gate checks every extract: tag scan, OCR pass, sampling review by a human for the first batch of each new pipeline configuration.

### 12.3 Research extracts

Requests are recorded on M19 with the ethics approval reference (a registered Health Research Ethics Committee), the data specification, the recipient, and the retention period. The pipeline produces the extract into a controlled bucket with a manifest and a hash; AIO validates the de-identification report; CMP approves release. Model training within BCI uses the same pipeline; consent for use of de-identified data in model development is part of the registration consent set, with an opt-out that the pipeline honours.

## 13. Integrity, audit and disaster recovery

* Every object has a SHA-256 hash stored at ingest; integrity verification runs continuously on a sample and fully on every object at least annually, and on every tier migration; mismatches quarantine the object and restore from the replica.
* Access to every study is logged (who, when, from where, which service, which instances); the log is immutable and queryable for POPIA access requests and for the report access audit in process 08.
* The DR replica is in a second region, within South Africa where the platform allows it and otherwise under the POPIA s.72 conditions recorded on M19; RPO 15 minutes for the index and the outbox, near-real-time for objects; RTO 4 hours; quarterly DR tests restore a sample of studies and the index to an isolated environment and are recorded on M19.
* Gateways hold 30 days so that a central outage never stops acquisition; a gateway failure is covered by the central archive plus a spare gateway image that re-enrols in under an hour.

## 14. Performance targets

| Measure | Target |
|---|---|
| C-STORE acknowledgement at the gateway | Under 200 ms per object on the LAN |
| Study available centrally after acquisition (normal link) | Under 2 minutes for CR/DX, under 10 minutes for a 2 GB CT |
| First image in the Reading Room | Under 1 s on LAN, under 3 s on 20 Mbps |
| QIDO-RS query | Under 300 ms P95 |
| Cold retrieval | Under 15 minutes |
| Priors ready at reading start | Above 95 % of studies with a known prior |
| Sharing link open on a 3G phone | First key image under 5 s |

## 15. Data produced

| Object | Key content |
|---|---|
| `image_instance`, `image_series`, `image_study` | UIDs, tags index, hash, size, tier, transfer syntax, source, external flag, coercions |
| `reconciliation_record` | Type (match, coercion, wrong-patient move, merge, split), before and after values, user, reason, incident link |
| `routing_decision` | Rule, destination, status, delivery receipt |
| `prior_fetch` | Source, consent basis, relevance rule, size, duration, outcome |
| `import_record` | Media type, source provider, consent basis, duplicates found |
| `sharing_link` | Scope, recipient, expiry, OTP channel, watermark, opens, revocation |
| `export_record` | Media, recipient, reason, chain-of-custody where applicable |
| `legal_hold` | Scope, reason, owner, review date |
| `destruction_certificate` | Study UIDs, hashes, approver, date |
| `deid_extract` | Purpose, profile options, ethics reference, manifest, validation report |
| `hanging_protocol`, `key_object_selection`, `presentation_state` | As stored objects |
| Events | `image.instance.stored.v1`, `study.available.v1`, `study.reconciled.v1`, `study.wrong_patient_corrected.v1`, `priors.ready.v1`, `study.shared.v1`, `study.tier_changed.v1`, `study.destroyed.v1` |

## 16. KPIs

| KPI | Definition | Target (illustrative) | Persona |
|---|---|---|---|
| Ingest success | Objects stored ÷ objects received (excluding duplicates) | 99.99 % | BIO |
| Quarantine rate | Objects quarantined ÷ received | Below 0.05 %, every one resolved within 1 working day | BIO |
| Unmatched study rate | Studies entering `unmatched` ÷ studies | Below 0.2 % | BIO, FDK |
| Wrong-patient corrections | Count per 10 000 studies | Trend to zero; each with a closed incident | CMP |
| Priors ready at reading start | As defined in 14 | Above 95 % | Priors Hand, RGT |
| Consent-gap resolution | Cross-Practice priors requests where consent was captured before reading | Above 80 % | FDK |
| Transfer backlog | Studies at gateways not yet central, by age | None older than 24 hours except during declared outages | BIO |
| Viewer performance | First image time P95 per site | Per section 14 | BIO |
| Physical media share | CDs burned ÷ exports | Trend down; secure link above 90 % of exports | FDK, PRM |
| Retention compliance | Studies past retention without hold and not destroyed | Zero after the monthly run | CMP |
| Integrity | Hash mismatches found | Zero unrecovered | BIO |
| DR test | Quarterly test passed within RTO | 4 of 4 per year | BIO, CMP |

## 17. Controls

1. Original received objects are immutable; every correction is a new record or a served-copy coercion with a link to the original.
2. Wrong-patient correction, merge and split require an authorised role, a reason, and generate an M19 incident where images were viewable under the wrong identity.
3. Cross-Practice and external fetches require a recorded consent; the Priors Hand is technically unable to call `fetch_study` without a consent reference.
4. Sharing links are time-bound, OTP-protected, watermarked and logged; revocation is immediate.
5. Lossy renders are labelled in the pixel data and metadata; diagnostic viewers never receive lossy objects.
6. Legal holds override destruction and deletion requests; holds are reviewed on a schedule.
7. Destruction requires CMP approval and produces a permanent certificate.
8. De-identified extracts pass an automated tag scan and OCR gate and a human sample review; the re-identification map is held separately under CMP control.
9. All access to images is logged immutably; break-glass access (M01) is flagged and reviewed within 24 hours.
10. Only registered AE titles can store or query at gateways; conformance is tested at onboarding with the simulator; sites expose no inbound ports (outbound-only tunnel).
11. Tier migrations verify hashes before deleting from the source tier.

## 18. Requirements

* M09-R-100 The Platform MUST accept DICOM C-STORE at each site's Edge Gateway, acknowledge only after durable local write, validate conformance, quarantine failures with reasons, and forward to the central archive with resumable transfers.
* M09-R-101 The Platform MUST de-duplicate by SOP Instance UID and pixel hash, and MUST quarantine UID collisions with differing content.
* M09-R-102 The Platform MUST match studies to orders by Accession Number and Patient ID, hold unmatched studies in a queue, and support match confirmation with a coercion record that preserves original values.
* M09-R-103 The Platform MUST support wrong-patient correction, patient merge re-indexing, study split and series move, each with an authorised role, a reason, immutable originals, revocation of routed copies and an audit record; wrong-patient correction MUST open an M19 incident.
* M09-R-104 The Platform MUST evaluate configurable routing rules on `study.available.v1` to reading worklists, BCI inference, referrer and hospital PACS, and DR replicas, with delivery receipts and retries.
* M09-R-105 The Platform MUST store objects losslessly with SHA-256 hashes, verify integrity on migration and at least annually, and restore from the replica on mismatch.
* M09-R-106 The Platform MUST implement storage tiers (edge cache, hot, warm, cold, DR replica) with configurable rules per Practice, transparent retrieval and pre-warming for scheduled follow-ups and mammography priors.
* M09-R-107 The Platform MUST use lossy compression only for labelled non-diagnostic renders and MUST never serve lossy objects to the Reading Room.
* M09-R-108 The Platform MUST provide QIDO-RS, WADO-RS and STOW-RS services scoped by tenant and consent, plus C-FIND/C-MOVE/C-GET on site, and MUST publish a versioned DICOM conformance statement.
* M09-R-109 The Priors Hand MUST fetch same-Practice priors automatically, cross-Practice and external priors only with a recorded consent, and MUST record relevance rule, source and outcome for every fetch.
* M09-R-110 The Platform MUST support external imports from CD, USB, uploads and partner links with identity confirmation, de-duplication, source and consent recording, and an `external` flag that excludes them from billing.
* M09-R-111 The Platform MUST provide a zero-footprint viewer for clinicians and patients that works on a 3G connection with progressive loading, and a diagnostic viewer per the design system §6.
* M09-R-112 The Platform MUST support hanging protocols per radiologist with Practice defaults, Key Object Selection documents, Presentation States and AI overlays as separate objects with provenance.
* M09-R-113 Sharing links MUST be time-bound, OTP or login protected, consent-recorded, watermarked, revocable and logged; CD and USB export MUST remain available with logging and chain-of-custody where required.
* M09-R-114 The Platform MUST implement a retention and destruction schedule per record class with legal holds, CMP-approved destruction batches, cryptographic erasure across tiers and replicas, and permanent destruction certificates.
* M09-R-115 The Platform MUST log every image access immutably and support POPIA access-request reporting from the log.
* M09-R-116 The Platform MUST provide a de-identification pipeline aligned with DICOM PS3.15 Basic Application Level Confidentiality Profile with configurable options, burned-in text detection, separate re-identification mapping under CMP control, and a validation report per extract.
* M09-R-117 Teaching file creation MUST require the patient's teaching consent; research extracts MUST require a recorded ethics approval reference and CMP release approval.
* M09-R-118 The Platform MUST maintain a DR replica in a second region (within South Africa where the platform allows it, otherwise under recorded POPIA s.72 conditions) with RPO 15 minutes and RTO 4 hours, and MUST record quarterly DR tests.
* M09-R-121 The Platform MUST NOT send raw DICOM over the public internet; gateway-to-archive and external pushes MUST use DICOMweb over HTTPS (through the Cloudflare Tunnel or a private network) or a private link.
* M09-R-119 The Platform SHOULD rate-limit backfill transfers per site link policy and report transfer backlog by age on the PRM control tower.
* M09-R-120 The Platform MAY use body-part and laterality inference to improve routing and hanging, stored with provenance and never overwriting header values.
