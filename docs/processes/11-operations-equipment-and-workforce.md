# 11 — Operations: Workforce (M17) and Assets & Engineering (M18)

## 1. Purpose and scope

This document specifies how the Platform runs the two operational backbones of a national imaging
chain: the people who operate the sites (M17 Workforce) and the equipment, consumables and
facilities they operate (M18 Assets & Engineering). Both modules exist so that PRM, BIO and CMP
see problems before patients do, and so that two Hands, the **Roster Hand** and the
**Maintenance Hand**, remove the routine work of filling gaps and chasing service providers.

The target is "better than the market": most South African imaging practices roster on
spreadsheets, track HPCSA renewals in someone's diary, learn about a tube failure when the first
patient of the day is in the room, and count contrast vials at month-end. The Platform makes each
of these a visible, event-driven object with an owner, a due date and a Hand watching it.

| Item | Value |
|---|---|
| Owning modules | M17 Workforce, M18 Assets & Engineering |
| Primary personas | PRM, BIO, CMP, RAD, RGT, NUR, EXE |
| Supporting modules | M01 (access provisioning), M02 (sites, rooms, modalities), M05 (capacity), M08 (MPPS and worklist events), M10 (dosimetry and QA), M15 (budgets, procurement postings), M16 (KPIs), M19 (incidents), M20 (Hands), M21 (events, notifications) |
| Automation target | A3 for gap filling, maintenance scheduling and stock replenishment inside leash; A1 for anything that changes a person's pay, contract or registration status |

## 2. Workforce (M17)

### 2.1 Data model

| Entity | Key attributes |
|---|---|
| `worker` | person, employing entity (Practice, MSO, Hub, agency), employment type (permanent, fixed-term, part-time, locum, agency, independent contractor), home site, cost centre, BCEA earnings-threshold flag, start/end dates |
| `credential` | worker, type (HPCSA registration, HPCSA category, CPD cycle, radiation worker registration, mammography competency evidence, MRI safety training, BLS/ACLS, driver's licence for mobile units), number, issuer, issued/expiry, evidence file, verification status |
| `competency` | worker, modality (from `modality.type`), body-part or sub-specialty (e.g., obstetric, vascular, musculoskeletal ultrasound; cardiac CT; breast MRI), level (trainee, competent, independent, supervisor), assessed by, assessed date, review due |
| `role_assignment` | worker, role (RAD, NUR, FDK, RGT…), site, effective dates, MRI safety officer flag, RPO flag (links to M02 `director_officer`) |
| `shift_template` | site, room or function, weekday pattern, start/end (SAST), required skills, headcount, on-call flag |
| `roster` | site, period (week or month), status (draft, published, locked), version |
| `shift` | roster, worker, template, start/end, break minutes, status (planned, confirmed, swapped, open, filled by locum, cancelled), actual clock-in/out, cost estimate |
| `leave_request` | worker, type (annual, sick, family responsibility, maternity, parental, study, unpaid), dates, evidence (medical certificate after the BCEA threshold), approver, status |
| `timesheet` | worker, period, shifts, ordinary hours, overtime hours, Sunday hours, public-holiday hours, night hours, on-call hours, call-outs, approval chain, export status |
| `locum_request` | site, shift, skills required, rate cap, agency or pool, offers, accepted offer, purchase order |
| `productivity_snapshot` | worker, period, studies by modality, case-mix weight, repeat rate, safety checklist completion, peer-review participation; never exposed as a ranked league table |
| `onboarding_case` / `offboarding_case` | worker, checklist template, tasks with owners and evidence, access requests (M01), asset issue/return |

### 2.2 Rostering across sites

**Trigger**: a roster period opens (default four weeks ahead, configurable), or a shift becomes open
(sick leave, resignation, emergency), or capacity changes in M05 (a new evening CT list).

**Actors**: PRM (owns the roster), RAD/NUR/FDK/RGT (work it), Roster Hand, BIO (equipment
downtime feeds demand), CMP (compliance rules).

**Preconditions**: shift templates exist per site and room; every worker has current credentials and
competencies; M05 has published the modality calendars for the period.

**Happy path**
1. The Platform generates a draft roster from templates, expected demand (M05 bookings and
   M16 forecast per modality and hour), and each worker's contract hours, preferences and leave.
2. Hard constraints are enforced at generation: a mammography room MUST be staffed by a worker
   with mammography competency evidence; an MRI list MUST have a designated MRI safety officer on
   site or on call; a room MAY NOT be staffed by a worker whose HPCSA registration is lapsed;
   a sonographer MAY only be rostered to sub-specialty lists in which they are marked competent;
   BCEA limits (see 2.3) MUST hold across all sites the worker is rostered to, not per site.
3. Soft constraints are optimised: fairness of weekends and nights, travel between sites, cost
   (avoid overtime where a permanent worker on ordinary hours is available), continuity for
   trainees under a supervisor.
4. PRM reviews the draft in the `Calendar` (room and week views) with constraint violations shown
   as Attention or Critical chips; PRM edits and publishes.
5. Workers receive their published shifts in the staff app and WhatsApp (opt-in). Confirmation is
   requested; unconfirmed shifts 72 hours before start are surfaced to the Roster Hand.
6. Changes after publication (swap, drop, extra shift) go through the Roster Hand within its leash
   (see 2.9); every change is versioned and the worker's notification record is kept.
7. On the day, actual attendance flows in from clock-in (see 2.5) and reconciles against the shift.

**Variants and exceptions**
* Multi-site workers: a worker's roster is one object across sites; PRMs of each site see it; conflicts
  block publication.
* Hub radiologists (RGT): rostered as reading sessions with expected study volume per session rather
  than room shifts; on-call for critical findings is a separate template feeding M13.
* Mobile X-ray and on-site occupational health screening: shift includes vehicle, portable unit
  (M18 asset) and driver's licence credential.
* Load-shedding: when M18 publishes a site power schedule that closes rooms, the Platform proposes
  shift changes (start-time shifts, cross-site moves) rather than cancellations.
* Strike or mass absence: PRM switches the site to "minimum safe staffing" template; the Roster
  Hand's leash widens only by EXE approval.

**Automation level**: draft generation A2; publication A1 (PRM confirms); post-publication gap filling
A3 (Roster Hand); nothing about pay is above A1.

### 2.3 BCEA-compliant hours, overtime and on-call

The Basic Conditions of Employment Act 75 of 1997 is the floor; sectoral determinations,
bargaining-council agreements or individual contracts may be more generous. The Platform stores the
rules as a versioned rule pack per employing entity and never hard-codes them.

| Rule (illustrative, configurable reference data) | Platform behaviour |
|---|---|
| Ordinary hours ≤ 45 per week, ≤ 9 per day on a 5-day week or ≤ 8 on a 6-day week | Roster generation blocks exceeding; averaging over up to 4 months only where a written agreement is on file |
| Overtime by agreement only, ≤ 10 hours per week (up to 15 by collective agreement), paid at 1.5× or time off in lieu | Overtime requires a recorded agreement; weekly counter across sites; PRM approval per overtime shift; the Roster Hand cannot create overtime above the cap |
| Sunday work at 2× (1.5× if Sunday is an ordinary working day) and public holidays at 2× | Timesheet classifies hours automatically from the SA public-holiday calendar (`DatePicker` source) |
| Meal interval of at least 60 minutes after 5 continuous hours (reducible to 30 by agreement) | Shift templates carry break rules; unbroken shifts flagged |
| Daily rest 12 consecutive hours; weekly rest 36 consecutive hours | Cross-site validation; on-call call-outs count towards rest violations and are flagged for PRM |
| Night work (18:00–06:00) allowance or shift reduction, transport considerations | Night hours counted; allowance line generated for payroll |
| Earnings threshold above which some BCEA hours provisions do not apply | Stored as a dated threshold; worker flag maintained by payroll |
| Annual leave 21 consecutive days (or 1 day per 17 worked), sick leave cycle of 30 days per 36 months, family responsibility 3 days, maternity 4 months, parental leave | Leave balances computed per cycle; medical certificate required after the configurable threshold of consecutive sick days |

On-call is modelled as a standby shift with a call-out sub-shift. Call-outs are captured from the
worker's app (one tap "called in", "left site") and reconciled against M08 events (a study performed
at 02:14 on a modality at that site by that worker is a strong corroboration). On-call and standby
allowances are contract terms in the rule pack.

* M17-R-100 The Platform MUST evaluate BCEA-derived hour rules across all sites and entities a worker
  is rostered to, using the rule pack in force on the shift date.
* M17-R-101 The Platform MUST NOT allow a Hand to create or accept a shift that breaches daily or
  weekly rest rules; PRM MAY override with a typed reason, and CMP MUST see overrides in the
  compliance calendar (M19).
* M17-R-102 Timesheets MUST be derived from published shifts plus attendance evidence, with every
  manual adjustment attributed and reasoned, and exported to payroll only after worker acknowledgement
  and PRM approval.

### 2.4 Leave

Leave requests are made in the staff app; balances, cycle rules and blackout periods (month-end for
BIL, festive season caps per site) are shown before submission. The Roster Hand assesses the
roster impact and either approves within leash (no open shift created, or an open shift it can fill at
no extra cost) or routes to PRM with the cost of filling the gap. Sick leave notified before a shift
immediately creates an open shift. Medical certificates are stored as evidence with restricted access.

### 2.5 Time and attendance

Attendance evidence, in order of preference: (1) staff app check-in with site geofence and the Edge
Gateway's local network as corroboration, (2) kiosk PIN or QR at the site, (3) optional biometric
terminal integrated as an adapter. Biometric data is special personal information under POPIA; a
site MAY enable biometrics only with a documented purpose, a worker consent record and encrypted
template storage (see 15). Corroboration from M08 (MPPS events carry the operator) and M01 (console
sign-in) reconciles disputed times, never as covert monitoring; workers see their own trail.

### 2.6 Registration, CPD and radiation worker status

| Credential | Source of truth | Platform behaviour |
|---|---|---|
| HPCSA registration (Radiography and Clinical Technology board for RAD; Medical and Dental board for RGT; Nursing Council for NUR, tracked as an external credential) | Registration certificate and annual practising card; verification via the HPCSA register lookup where an interface exists, otherwise evidence upload | Renewal is annual (HPCSA fees fall due 1 April, illustrative); the Platform opens a task 90, 60 and 30 days before expiry; rostering onto clinical shifts is blocked from the expiry date unless proof of payment is uploaded and CMP grants a grace period; M01 clinical permissions are suspended in parallel |
| CPD | HPCSA requires CEUs per 12-month cycle, including an ethics, human rights and medical law component (30 CEUs with 5 ethics is the commonly cited figure; stored as reference data) | Workers log activities with certificates; the Platform tracks the cycle, proposes internal CPD (peer review sessions, M&M meetings, vendor applications training) and warns at 75 % of the cycle if below pace |
| Radiation worker registration and dosimetry | The licence holder registers radiation workers with an approved personal dosimetry service; M10 receives dose reports | M17 holds the registration and badge number; M10 holds dose history; a worker without an active badge cannot be rostered to an ionising-radiation room; pregnant workers who declare are re-rostered under the RPO's plan (declaration is voluntary and confidential) |
| Mammography competency | Post-basic qualification or training evidence and a supervised case log, per practice policy (no separate statutory certificate is assumed) | Competency record with review date; annual image-quality review evidence attached |
| MRI safety training and MRI safety officer | Practice policy aligned to international MR safety practice (level 1 and level 2 personnel, a designated MR safety officer per MRI site) | Level recorded; zone IV access in M01 requires level 2; rostering rule as in 2.2 |
| Sonographer sub-specialties | Qualification and assessed competency | Competency list drives list eligibility |

* M17-R-103 The Platform MUST block clinical rostering and suspend clinical permissions for a worker
  whose HPCSA registration is expired, suspended or erased, with CMP-only grace override.
* M17-R-104 The Platform MUST expose CPD status to the worker, PRM and CMP and MUST produce the
  evidence bundle for an HPCSA CPD audit on request.
* M17-R-105 Pregnancy declarations MUST be visible only to the worker, the RPO and CMP.

### 2.7 Performance and productivity (case-mix adjusted, non-punitive)

Raw studies per shift punish the technologist who does the difficult paediatric CT and rewards the
one who does chest X-rays all day. The Platform computes a **case-mix weight** per study (modality,
protocol complexity, contrast, patient factors such as age under 5, mobility, sedation, interpreter
required) and reports weighted throughput, repeat/reject rate (M08), dose against DRL (M10), safety
checklist completion (M07) and patient feedback per worker, per period.

Rules of use, enforced by design:
* Each worker sees their own figures with the site distribution; PRM sees site figures with anonymised
  distribution and can open a named view only inside a documented review conversation.
* No ranking screens, no automatic disciplinary triggers; the Platform is not a surveillance tool.
* Weighted figures are shown with confidence bands; below a minimum sample size the number is hidden.
* Positive deviations (low repeat rate at high throughput) feed CPD and peer learning.

### 2.8 Recruitment, onboarding and offboarding

Recruitment pipeline (A1): requisition (approved against the M15 headcount budget), advert, candidate
records (POPIA purpose: recruitment; retention limited), HPCSA number verification at screening,
interview scoring, offer, background checks with consent. Candidates are `person` records, not
`worker` records, until an offer is accepted.

Onboarding checklist (per role template, A2):
1. Contract signed (e-signature connector) and BCEA particulars captured.
2. Credentials verified (2.6) before the first clinical shift.
3. M01 access requested from the role template; provisioning happens only on the start date and only
   for the assigned sites; MFA enrolment completed on day one.
4. Induction: POPIA and information-security acknowledgements, radiation protection programme,
   MRI safety, infection control, incident reporting (all M19 policies with acknowledgement records).
5. Dosimetry badge issued and linked (M10); uniform, access card, devices issued (M18 minor assets).
6. Supervised period with competency sign-off.

Offboarding (A2, same day): M01 access revoked at the recorded end time (immediate for dismissal),
devices and badge returned, final dose report requested, handover of open tasks, exit interview,
payroll final calculation, credential records retained per the retention schedule (15). The Roster
Hand removes future shifts and opens replacements.

* M17-R-106 M01 provisioning and de-provisioning MUST be driven by `worker` lifecycle events; no
  clinical account may exist without a linked worker and a verified HPCSA number where the role
  requires one.

### 2.9 The Roster Hand

| Attribute | Definition |
|---|---|
| Mandate | Keep every published shift filled with an eligible worker at the lowest compliant cost; process routine leave; manage swaps; raise locum requests |
| Tools | read roster and eligibility; propose and confirm swaps between consenting workers; offer open shifts to eligible internal workers (in fairness order); create a locum request to approved agencies or the internal locum pool; approve leave within rules; message workers via staff app/WhatsApp; create PRM tasks |
| Leash (defaults, configurable per Practice) | No overtime above the BCEA cap; no shift that breaches rest rules; locum spend per site per month ≤ a ZAR cap and per-shift rate ≤ the agency contract rate; no changes within 12 hours of shift start without PRM confirmation; cannot alter pay classification; cannot roster a worker with a credential exception |
| Escalation | Unfilled shift 48 hours out; locum cost above cap; any clinical-safety staffing rule at risk (no MRI safety officer); repeated declines by the same worker (fairness) |
| Audit | Every offer, decline, acceptance and message is an event with the worker's response time; PRM sees a daily digest |

Level: A3. The Hand talks to workers in plain language ("Open CT shift at Randburg, Thursday
14:00–20:00, ordinary hours. Reply YES to take it.") and never negotiates rates.

### 2.10 Workforce KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Fill rate at publication | Shifts filled / shifts required when roster is published | ≥ 98 % |
| Open shifts at T-48h | Shifts unfilled 48 hours before start | 0 |
| Overtime share | Overtime hours / total hours | ≤ 5 % |
| Locum cost share | Locum and agency spend / total staff cost | ≤ 8 % |
| Credential currency | Workers with all mandatory credentials current | 100 % |
| CPD on pace | Workers at or above cycle pace | ≥ 90 % |
| Absence rate | Unplanned absence hours / rostered hours | ≤ 3 % |
| Onboarding time | Offer acceptance to first independent shift | ≤ 10 working days |
| Access hygiene | Accounts revoked within 1 hour of recorded end time | 100 % |

## 3. Assets and Engineering (M18)

### 3.1 Equipment register

The register extends the M02 `modality` table (room, type, vendor, model, serial, AE title, install
date, warranty, service contract, commissioning acceptance). M18 adds:

| Entity | Key attributes |
|---|---|
| `asset` | modality or non-modality asset (injector, ultrasound probe, workstation, monitor with GSDF calibration, UPS, generator, chiller, lead apron, mobile unit vehicle), parent asset, asset tag, cost, funding (owned, leased from Bonakala Properties, hospital-owned), depreciation link (M15), status (ordered, delivered, accepted, commissioned, in service, restricted, down, decommissioned) |
| `licence_link` | asset → M02 `room.SAHPRA licence`, SAHPRA medical device status of the model (where applicable), RPO |
| `service_contract` | vendor, coverage (parts, labour, tube, coils, helium), response and uptime SLAs, hours, exclusions, term, cost, escalation, renewal date |
| `maintenance_plan` | asset, task (preventive maintenance, QA test from M10, calibration, safety inspection, software patch), frequency, responsible (vendor, BIO, RAD, licensed inspection body), tolerance window |
| `work_order` | asset, type (PM, breakdown, QA failure, upgrade, decommission), priority, reported by, symptoms, vendor ticket reference, timeline, parts, cost, downtime interval, root cause, closure |
| `telemetry_reading` | asset, metric (heartbeat, tube mAs counter, arc count, helium level, cold-head status, detector calibration drift, chiller temperature, error code), value, source (edge gateway, DICOM traffic, vendor log, manual) |
| `remote_access_session` | asset, vendor, requested by, approved by, window, purpose, session recording reference (see 15) |
| `stock_item` / `stock_lot` / `stock_movement` | consumable, site, lot, expiry, quantity, storage conditions, movement type (receipt, issue to study, wastage, return, transfer, count adjustment) |

* M18-R-100 Every modality in M02 MUST have an M18 asset record with a status; the M05 slot engine
  MUST treat only `in service` and `restricted` (with the restriction's constraints) as bookable.
* M18-R-101 An asset MUST NOT move to `in service` until acceptance testing evidence and, for
  ionising modalities, the SAHPRA licence for its room are attached and verified by CMP.

### 3.2 Equipment lifecycle

**Trigger**: an approved capital requisition (procurement), a vendor visit, a telemetry alarm, a
breakdown report, or a planned decommissioning.

**Actors**: BIO (owner), PRM, CMP (licence and acceptance), EXE and SHR (capex reserved matters,
M02 §5), vendor, Maintenance Hand.

**Happy path: procurement to commissioning**
1. Business case in M16 (what-if: a new CT at site X) becomes a capex requisition with budget link
   (M15) and, above the threshold, a reserved-matters approval task.
2. Tender or quote comparison recorded; the vendor's SAHPRA medical device establishment licence and
   the device's registration or listing status are captured as evidence; the purchase order is issued
   from procurement.
3. Room readiness: shielding design and survey, SAHPRA licence application or amendment for the room
   and unit (CMP task in M19 calendar), electrical supply, HVAC, RF cage for MRI, quench pipe,
   floor loading, data points and modality VLAN (BIO and Bonakala Properties tasks).
4. Delivery and installation work order; vendor commissioning report attached.
5. Acceptance testing by the required party (licensed inspection body for ionising units, per
   SAHPRA requirements for licence holders; vendor and BIO for non-ionising) and clinical
   acceptance by a RGT and a senior RAD (image quality, protocols loaded, DRL baselines set in M10).
6. Integration acceptance: MWL query, MPPS, C-STORE to the Edge Gateway, RDSR output where
   supported, AE title registered, time synchronisation verified, heartbeat visible.
7. CMP verifies licence, acceptance evidence and RPO; status becomes `in service`; M05 opens the
   calendar; M10 starts the QA schedule; M15 starts depreciation.

**Happy path: preventive maintenance**
1. The maintenance plan schedules PM visits from the service contract; the Maintenance Hand books
   the vendor slot, blocks the modality calendar in M05 for the window (preferring low-demand hours
   from M16), and notifies PRM and RAD.
2. The vendor engineer's remote or on-site session is approved (3.4); the work order captures the
   report and any parts.
3. Post-PM checks: a RAD runs the daily QA (M10) before the first patient; the Hand releases the
   calendar block.

**Happy path: breakdown**
1. Report from RAD (technologist console: "Report equipment fault", with photo and error code), or
   from telemetry (heartbeat lost, error code pattern), creates a work order with priority derived
   from clinical impact (only CT in the region, STAT list scheduled).
2. The Maintenance Hand opens a vendor ticket under the contract, attaches logs, requests an ETA, and
   in parallel re-routes booked patients (M05: same-site alternative modality, nearest site, or
   reschedule with patient notification via M13), within its leash.
3. Downtime interval starts; PRM sees the effect on the day; BKG sees the site as restricted.
4. Repair, verification QA, release; downtime ends; root cause recorded; contract SLA compliance
   computed for the vendor scorecard.

**Decommissioning**: end-of-life or replacement triggers a work order that includes SAHPRA licence
amendment or disposal notification (CMP), data wiping of the modality's local storage (patient
data on the console is a POPIA obligation; certificate of destruction attached), removal of the
AE title and VLAN port, asset disposal posting (M15) and record retention.

**Variants and exceptions**
* Hospital-based JV: the hospital may own the room, the UPS and the HVAC; ownership and
  responsibility are per-asset attributes and work orders route to the hospital's facilities desk.
* Leased equipment: lessor is Bonakala Properties; lease schedules and buy-out options are agreements
  in M02.
* Loan units during long repairs: temporary asset with its own licence amendment.
* Software upgrades that change dose or image processing require re-baselining DRLs (M10) and a
  clinical acceptance sign-off.

**Automation level**: PM scheduling and vendor ticketing A3 (Maintenance Hand); acceptance and
release to service A1 (CMP and BIO confirm); decommissioning A1.

### 3.3 Uptime, heartbeats and predictive maintenance

Uptime is measured, not declared. The Edge Gateway (07 §5) records for every modality: DICOM
C-ECHO heartbeat (interval configurable, default 5 minutes), MWL query cadence, MPPS events, C-STORE
volume, and RDSR arrival. A modality is `up` when it responds to echo and has performed as expected
relative to its booked calendar; `degraded` when it responds but produces errors or slow transfers;
`down` when heartbeat is lost during operating hours. Planned downtime (PM blocks) is excluded from
the uptime denominator; unplanned downtime is not.

Predictive signals (vendor logs are ingested via the vendor's export, a syslog feed on the modality
VLAN, or manual entry where the vendor exposes nothing):

| Signal | Modality | Use |
|---|---|---|
| Tube usage (mAs accumulated, exposure count, arc count, heat-unit excursions) | CT, DX, RF, MG | Tube life forecasting; pre-order under tube contract before failure; adjust PM |
| Helium level and cold-head hours, compressor faults | MR | Quench-risk and chiller-failure early warning; alert at configurable levels; load-shedding correlation |
| Detector calibration drift and dead-pixel maps | DX, MG, CT | Trend against QA constancy tests (M10); schedule recalibration before image-quality QA fails |
| Error and warning code frequency | All | Pattern rules (same code 3 times in 24 hours) create a work order at low priority before a hard failure |
| Transducer (probe) faults from ultrasound QA phantom tests | US | Probe replacement planning |
| UPS runtime and battery health, generator run hours and fuel | Facilities | Load-shedding readiness |
| Chiller temperatures and room humidity | MR, CT | HVAC alarm before modality shutdown |

The Maintenance Hand watches these streams; BCI models (M11) MAY produce a failure-risk score per
asset with provenance, shown in the annotated style and never acted on above A3.

* M18-R-102 Uptime per modality MUST be computed from telemetry and calendar data with planned and
  unplanned downtime distinguished, and MUST be available per site, per vendor and per contract.
* M18-R-103 Telemetry ingestion MUST work from the Edge Gateway during internet outages and backfill
  when connectivity returns.

### 3.4 Vendor management and remote access

Vendors are `legal_entity` records of type external_partner with contracts, contacts, escalation
paths, and a scorecard (SLA response, uptime delivered, first-time-fix, PM punctuality, spend).
Vendor remote access to a modality or workstation is never standing. A session is requested (by the
vendor through the portal or by BIO), approved by BIO with a purpose and window, brokered through the
Platform's remote-access gateway (15 §10) that records the session, and closed automatically at the
window end. Vendors sign a data-processing agreement (POPIA operator terms) because a modality
console holds patient data.

* M18-R-104 Vendor remote access MUST be time-boxed, brokered, logged and linked to a work order;
  direct vendor VPNs into modality VLANs are prohibited by policy and blocked by network design.

### 3.5 Spares and consumables

| Category | Tracking | Rules |
|---|---|---|
| Contrast media (iodinated, gadolinium-based, ultrasound agents, oral) | Lot, expiry, quantity per site, barcode scan at receipt and at administration (NUR console decrements per study and links the lot to the study record), storage conditions (room temperature with light protection for most agents; warmed cabinet temperatures logged where used) | Expiry alerts at 90/30 days; first-expiry-first-out picking; lot recall search across all sites in seconds; adverse-reaction reports (M19) carry the lot |
| Radiopharmaceuticals (NM sites) | Lot, calibration time, activity, cold-chain and shielding log, decay computed | Received-activity and residual-activity records; disposal per radiation licence |
| Injector consumables, cannulas, needles, syringes, sharps containers | Par levels per site | Reorder from usage rate |
| Film, CD/DVD and USB media, printer consumables | Par levels | Declining category as Patient Space sharing grows; tracked to show the shift |
| Cleaning and infection-control supplies, PPE | Par levels; usage against infection-control schedule | Linked to M19 infection-control audits |
| Lead aprons, spares (tubes under contract, coils, probes, detectors), dosimetry badges | Aprons as assets with annual integrity checks (M10); spares contract-held or site-held; badges issued and returned per period (M10, M17) | Failed aprons withdrawn; spare availability shown on the work order; missing badge alerts |

Replenishment: the Maintenance Hand computes days-of-cover from usage and creates purchase
requisitions within its leash (approved suppliers, price list, monthly cap per site); above leash or
for new items, a PRM approval task. Receipts are scanned; invoices match to purchase orders in M15.
Stock counts are cycle counts prompted by the Hand, not month-end marathons.

* M18-R-105 Every contrast administration MUST record the lot and expiry against the study; the
  Platform MUST be able to list every patient who received a given lot across all Practices with a
  recorded lawful basis for the cross-tenant query (product recall).
* M18-R-106 Expired stock MUST be blocked from issue at scan time; an override requires CMP.

### 3.6 Procurement approvals and budget links

Every requisition carries a cost centre, a budget line (M15) and a category. Approval matrices are
configurable: consumables within par to PRM, capital to EXE and reserved matters per M02 §5,
service contract renewals to EXE with a BIO recommendation and the vendor scorecard attached. The
Maintenance Hand prepares renewal comparisons 120 days before expiry (uptime delivered versus SLA,
cost per study, alternative offers). Purchase orders, goods receipts and invoices post to M15;
commitments are visible against budget in real time.

### 3.7 The Maintenance Hand

| Attribute | Definition |
|---|---|
| Mandate | Keep every asset in service, maintained and licensed; keep consumables in cover; minimise patient disruption from downtime |
| Tools | read telemetry, calendars and contracts; create and update work orders; open vendor tickets by email or vendor API; book PM windows and block M05 calendars; propose and, within leash, execute patient re-routing via M05 and M13; raise purchase requisitions; request remote-access sessions for BIO approval; create tasks for BIO, PRM and CMP; draft vendor SLA breach notices for BIO review |
| Leash (defaults) | Consumable requisitions ≤ a ZAR cap per site per month from approved suppliers only; calendar blocks ≤ 4 hours in low-demand windows without PRM confirmation; re-routing of ≤ 20 patients per incident without PRM confirmation; cannot approve remote access; cannot change asset status to `in service`; cannot commit capital |
| Escalation | Heartbeat lost on any modality during operating hours (immediate to BIO and PRM); helium or chiller alarms; any licence or QA expiry within 30 days (to CMP); vendor SLA breach; stock below 3 days of cover after a failed reorder |
| Audit | All actions as events; monthly vendor scorecard and downtime report to BIO and EXE |

Level: A3.

### 3.8 Facilities

Facilities are assets with plans and telemetry, owned by Bonakala Properties or the hospital partner
per site.

**Power and load-shedding**. Each site records its municipal or Eskom supply area and the
load-shedding block; the Platform ingests the published stage and schedule (via a schedule connector
or manual entry when feeds are unreliable) and computes the site's expected outages. UPS covers
the Edge Gateway, network, workstations and console shutdown time; a generator (with automatic
transfer switch, fuel level and run-hours telemetry) covers CT and MRI chillers where installed.
MRI without generator backup is the highest-risk asset: chiller loss risks helium boil-off, so the
schedule drives a pre-emptive plan (confirm generator test, reduce lists during long outages). M05
receives room availability windows; the Roster Hand receives shift-time suggestions; BKG sees the
site's expected constraints before offering slots.

**HVAC**. MRI and CT rooms carry temperature and humidity limits from the vendor's site planning
guide; readings are telemetry; excursions create work orders; chiller maintenance is a maintenance
plan item.

**Shielding**. Each room stores its shielding design, the shielding survey report and date (M02
`room.shielding survey date`), RF cage integrity tests for MRI, and the re-survey trigger (any
structural change, modality replacement, or the interval in the SAHPRA licence conditions).

**Cleaning and infection control**. Cleaning schedules per room type (between-patient wipe-down,
daily, terminal cleaning), with completion logs on the technologist console or a cleaner's
tablet, linked to M19 infection-control audits and outbreak response.

**Security**. Access control zones (public, staff, MRI zones III and IV, server room), key and card
issue as minor assets, CCTV under POPIA rules (signage, retention, access log), alarm and
armed-response contracts, after-hours procedures for on-call staff. MRI zone IV access is a
physical control mirrored in M01 role permissions.

* M18-R-107 Each site MUST carry a load-shedding readiness record (UPS capacity, generator, fuel,
  last test) and the Platform MUST publish predicted outage windows to M05 and M17.
* M18-R-108 Environmental excursions in MRI and CT rooms MUST alert BIO within one minute of the
  reading.

### 3.9 Assets and facilities KPIs

| KPI | Definition | Target (illustrative) |
|---|---|---|
| Unplanned downtime | Unplanned down hours / operating hours, per modality | ≤ 1 % |
| Uptime vs contract | Delivered uptime against the contract SLA, per vendor | 100 % of contracts met |
| MTTR | Mean time from work-order open to release for breakdowns | ≤ 8 operating hours (CT/MR ≤ 24) |
| PM punctuality | PM tasks completed within tolerance window | ≥ 95 % |
| Predictive catch rate | Failures preceded by a telemetry-driven work order | Trending up; reported, not targeted at launch |
| Patients re-routed within 30 minutes of downtime | Booked patients notified with an alternative within 30 minutes | ≥ 90 % |
| Stock-outs | Study delays caused by consumable unavailability | 0 |
| Expired stock issued | Count | 0 |
| Licence and acceptance currency | Modalities in service with valid licence and acceptance evidence | 100 % |
| Remote-access hygiene | Vendor sessions outside an approved window | 0 |
| Load-shedding continuity | Booked studies completed during grid outages / booked studies in outage windows | ≥ 95 % |

## 4. Cross-cutting controls

| Control | Mechanism |
|---|---|
| Segregation of duties | The worker who approves a timesheet cannot be its subject; the requester of a purchase cannot receive it and approve the invoice; the Hand cannot approve its own escalations |
| Change versioning | Rosters, maintenance plans and rule packs are versioned with effective dates |
| Evidence | Credentials, acceptance tests, service reports and stock receipts are files with hash, uploader and timestamp; CMP evidence bundles pull from these (M19) |
| Privacy | Worker health data (sick notes, pregnancy declarations, dose records) is restricted to the roles named here; biometric templates never leave the terminal or the encrypted store; productivity data is never exported to a named league table |
| Hand leashes | Enforced by M20 at the tool layer; leash changes are CMP- or EXE-approved and logged |
| Reconciliation | Daily: shifts vs attendance vs MPPS operators; stock issued vs studies performed with contrast; calendar blocks vs work orders |
| Reporting to governance | Monthly workforce and engineering packs to EXE and SHR; radiation-safety items to the radiation safety committee (M19) |

## 5. Data produced and consumed

Events produced: `shift.published.v1`, `shift.open.v1`, `shift.filled.v1`, `timesheet.approved.v1`
(to M05, M15, M16 and the payroll connector); `credential.expiring.v1`, `credential.lapsed.v1`
(to M01 and M19); `asset.status.changed.v1`, `asset.downtime.started.v1`, `asset.downtime.ended.v1`
(to M05, M13, M16); `telemetry.alarm.v1` (to the Maintenance Hand and BIO); `stock.lot.received.v1`,
`stock.issued.v1`, `stock.expiring.v1` (to NUR, M15, M19); `remote_access.session.opened.v1` and
`closed.v1` (to the 15 audit stream); `site.power.window.v1` (to M05, M17, BKG).

Consumed: M02 sites, rooms, modalities and agreements; M05 bookings and forecasts; M08 MPPS;
M10 QA results and dose; M15 budgets; M19 policies and incidents; M21 notifications.
