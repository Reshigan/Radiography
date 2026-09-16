# 25 — UI Specification: Information Architecture, Screens, Flows and States

This document lays out the whole product surface by surface and screen by screen so that the
build has no undefined pages. It applies the Bonakala Design Language (`06-design-system-frontend.md`,
`brand/tokens.json`, `brand/bdl.css`) and is illustrated by the high-fidelity mockups in
`brand/screens/` (index: `brand/screens/index.html`). Screen identifiers (`S-XXX-nn`) are used
by the route map, the test plan and the analytics events.

## 1. Surfaces and lenses

| Surface | Personas | Lens | Device | Entry |
|---|---|---|---|---|
| Patient Space (PWA) | PAT, guardians | Patient | Phone first, tablet, desktop | WhatsApp link, SMS link, web, kiosk QR |
| WhatsApp channel | PAT, REF (notifications) | n/a (conversational) | Phone | WhatsApp Business number |
| Kiosk | PAT | Patient (touch) | 1080×1920 portrait touch screen | Site lobby |
| Referrer Space | REF, PAY (limited) | Referrer | Desktop, tablet, phone | Web, embedded widget in practice systems |
| Clinical consoles | RAD, NUR, RGT | Clinical (dark) | Desktop (dual monitor for RGT), tablet for RAD/NUR, phone for on-call | SSO |
| Business consoles | FDK, BKG, BIL, DEB, PRM, EXE, SHR | Business | Desktop, tablet | SSO |
| Governance consoles | CMP, AIO (BCI console is clinical lens), BIO (clinical lens), SUP | Governance / Clinical | Desktop | SSO |
| Admin and configuration | SUP, PRM, EXE, CMP | Governance | Desktop | SSO |

One React application (`apps/web`) serves all surfaces through route groups; the lens is set by
the route group and can be overridden per user with the Window/Level control.

## 2. Global frame and navigation

### 2.1 App frame (all signed-in surfaces)
* **Rail** (56 px, left): module switcher for the persona's modules; icons with labels on hover
  and in expanded mode; the mark at the top; settings and avatar at the bottom. Keyboard: `g` then
  a letter jumps to a module.
* **Top bar** (52 px): context breadcrumb (Group / Practice / Site / date, switchable when the
  user has cross-entity rights), global search and command palette (`Ctrl/⌘+K`), Window/Level
  control, notifications bell with count, help.
* **Content**: page header (title, status, primary action), key facts strip, tabs, body.
* **Inspector** (340 px, right, optional): details of the selected object without leaving the list;
  collapsible; remembers state per screen.
* **Status line** (bottom, clinical consoles only): connection state (online, Edge Gateway offline
  mode, store-and-forward backlog), load-shedding stage and next window, dictation state.

### 2.2 Navigation map (rail items per persona)
| Persona | Rail items in order |
|---|---|
| FDK | Today, Patients, Payments, Queue display, Help |
| BKG | Inbox, Calendar, Waitlist, Referrers, Analytics |
| RAD | Room worklist, Protocols, Dose, QA schedule, Stock, Analytics |
| NUR | Patients today, Contrast, Reactions, Stock |
| RGT | Worklist, Patients, Peer review, Analytics, Reading fees |
| BIL | Exceptions, Claims, Coding, Remittances, Fee schedules, Month-end |
| DEB | Ageing, Runs (Hands), Disputes, Plans, Handover, Reports |
| PRM | Control tower, Schedule, Staff, Equipment, Quality, Money, Approvals |
| EXE | Group, Practices, Money, Network, Acquisitions, Board pack |
| SHR | My practice, Distributions, Documents, Votes |
| CMP | Board, Register, Calendar, Incidents, Complaints, Requests, Audits, Policies |
| AIO | Models, Monitoring, Shadow, Incidents, Change control, Committee |
| BIO | Fleet, Devices, Integrations, Work orders, Access, Capacity |
| SUP | Tenants, Incidents, Onboarding, Observability, Runbooks |
| REF | Refer, Patients, Results, Urgent, Analytics, Settings |
| PAT | Home, Book, Prepare, Pay, Results, Family, Profile, Help |

### 2.3 Global patterns
| Pattern | Rule |
|---|---|
| Object page | Header (identity + status + primary action) → facts strip → tabs (Timeline · Details · Documents · Money · Activity) → Inspector for related objects |
| Queue | Filters saved per user; sort by priority then age; claim/lock semantics; SLA bar (ok → beam at 80 % → flare at 100 %); bulk actions; keyboard `j/k` to move, `Enter` to open, `a` to claim |
| Forms | Labels above inputs; required marked by text, not colour alone; inline validation on blur; typed confirmation for destructive or clinical actions; autosave drafts |
| Tables | Virtualised; column presets per lens; sticky header; numbers right-aligned in mono; totals row; export respects RLS |
| Empty states | One sentence, one action, no illustration |
| Loading | Skeletons shaped like the content; "develop" motion 180 ms; never a spinner |
| Errors | Inline, plain language, what to do next, reference id; errors from integrations show the raw code in an expander |
| Confirmations | Non-destructive: single click; destructive or clinical: typed confirmation with the object's identifier |
| Offline | Clinical consoles show the status line; forms queue locally; a banner explains what will sync |
| Multi-entity context | Switching context is explicit and logged; cross-tenant screens are labelled with the lawful basis |
| AI provenance | Every AI-derived element in the annotated style; Accept / Edit / Reject; the accepted value loses the style and records who accepted it |
| Money | Arithmetic always visible; ZAR with space thousands separator; negative in Flare; VAT stated |
| Time | 24-hour SAST; relative age on queues ("36 min"); absolute on records |
| Identity | ID numbers masked to the last four digits except on the registration verification step |
| Language | Patient surfaces in the patient's language; staff surfaces in English with translatable strings |

## 3. Screen inventory

Each row: ID, screen, purpose, layout, key components, primary actions, states, mockup where one exists.

### 3.1 Patient Space (S-PAT) — Patient lens, phone first
| ID | Screen | Layout and components | Primary actions | States |
|---|---|---|---|---|
| S-PAT-01 | Sign-in | Mobile number, OTP, magic link; guardian switch | Continue | New, returning, locked |
| S-PAT-02 | Home | Next appointment card (time, site, directions, live status), quick actions, messages, language | Book, Prepare, Pay, Results | No appointment, appointment today, results ready |
| S-PAT-03 | Book: referral capture | Photo of referral or select from received e-referral; Referral Hand result in provenance style | Continue, Edit | Parsing, needs clarification, no referral (allowed procedures only) |
| S-PAT-04 | Book: choose slot | "Earliest near me" list across sites; distance; price certainty line; filters (site, day, time) | Select slot | No availability (waitlist offer), auth required first |
| S-PAT-05 | Book: confirm | Summary, quote, what to bring, consent to reminders | Confirm | Hold expiring |
| S-PAT-06 | Prepare | Safety questions as RadioCards (pregnancy, allergies, kidney function, metal, sedation), consent with signature, ID/scheme card capture | Submit | Incomplete, blocked item explained |
| S-PAT-07 | Pay | Collect card, Pay now (card, PayShap, EFT, QR), payment plan option, statement history | Pay | Nothing owed, plan active, disputed |
| S-PAT-08 | Results list | Studies with status (scanned, being reported, signed, released), images share | Open | Withheld pending referrer (explained) |
| S-PAT-09 | Result detail | Full report, plain-language layer toggle (reviewed template, provenance), key images, viewer link, share with a doctor, download | Share, Ask a question (routes to referrer) | Amended report notice |
| S-PAT-10 | Follow-up | Reminder cards (repeat imaging due), book from reminder | Book | Due, overdue |
| S-PAT-11 | Family | Dependants and guardian access, consent records | Add | Verification pending |
| S-PAT-12 | Profile and privacy | Identity, scheme, contact, language, consents, data requests | Save, Request my data | |
| S-PAT-13 | Help | WhatsApp, call, FAQ, complaint | | |
Mockup: `brand/screens/patient-space.html` (S-PAT-02, 04, 06/07, 09).

### 3.2 WhatsApp channel (S-WA)
| ID | Flow | Notes |
|---|---|---|
| S-WA-01 | Opt-in and language | Template message; consent recorded |
| S-WA-02 | Book | Photo or text → Booking Hand → questions (≤ 3) → three slot buttons → confirmation → prep instructions → payment link |
| S-WA-03 | Reminders and reschedule | 48 h and 3 h; buttons Confirm / Reschedule / Cancel |
| S-WA-04 | Arrival and queue | "Reply HERE when you arrive"; live wait estimate |
| S-WA-05 | Results notification | Never contains findings; deep link to Patient Space |
| S-WA-06 | Payment | Link; receipt |
| S-WA-07 | Escalation | "Talk to a person" hands to BKG with transcript |
Mockup: `brand/screens/whatsapp-and-kiosk.html`.

### 3.3 Kiosk (S-KSK)
| ID | Screen | Notes |
|---|---|---|
| S-KSK-01 | Welcome and language | 11 languages listed; large tiles; attract loop |
| S-KSK-02 | Identify | Scan ID / passport / QR from WhatsApp, or enter number; privacy shield |
| S-KSK-03 | Confirm details | Name, scheme, procedure, time; "not me" path |
| S-KSK-04 | Safety questions | Only those not already answered; large RadioCards |
| S-KSK-05 | Done | Ticket number, wait estimate, "ask for help" |
Mockup: `brand/screens/whatsapp-and-kiosk.html`.

### 3.4 Referrer Space (S-REF) — Referrer lens
| ID | Screen | Layout and components | Primary actions | States |
|---|---|---|---|---|
| S-REF-01 | Refer | Structured order form with appropriateness guidance (provenance), laterality, contrast, ICD-10 picker, urgency, delivery preferences; alternative: upload photo of paper form | Send referral | Guidance override requires reason; protocolling required (CT/MR) |
| S-REF-02 | My patients | List with statuses through the pipeline; filters; attendance flags | Open | No-shows flagged for the referrer |
| S-REF-03 | Result | Structured report, key images, measurements and trends, viewer, prior comparison, download, forward | Acknowledge (critical), Reply | Critical banner until acknowledged; amended |
| S-REF-04 | Urgent | Call a radiologist now; call-back SLA; STAT referral | Request | On-call shown |
| S-REF-05 | Analytics | Volumes, TAT, attendance, by modality; export | | |
| S-REF-06 | Settings | Delivery channels, integration keys (FHIR), practice details, staff access | Save | |
Mockup: `brand/screens/referrer-space.html`.

### 3.5 Front Desk (S-FDK) — Business lens
| ID | Screen | Layout and components | Primary actions | States |
|---|---|---|---|---|
| S-FDK-01 | Today | Arrivals queue (left), registration panel (centre), Collect card Inspector (right); queue strip; load-shedding banner | Check in, Collect | Pre-checked-in, walk-in, missing items, blocked by safety |
| S-FDK-02 | Patient search and create | PMI search, duplicate warning, create with ID validation | Create | Possible duplicate |
| S-FDK-03 | Registration | Identity verification, scheme card capture, consents, safety summary, interpreter, chaperone | Save | Verification failed |
| S-FDK-04 | Payments | Take payment, receipts, refunds (approval), day cash-up | Take payment, Cash-up | Unallocated |
| S-FDK-05 | Queue display (public screen) | Ticket numbers and rooms, no names, wait estimates | | |
Mockup: `brand/screens/front-desk.html`.

### 3.6 Central Booking (S-BKG)
| ID | Screen | Layout and components | Primary actions |
|---|---|---|---|
| S-BKG-01 | Inbox | Omnichannel conversations; Booking Hand proposal panel; calendar Inspector | Approve, Edit, Take over |
| S-BKG-02 | Calendar | Modality/day/week/room views; drag to reschedule; holds; STAT insertion | Book |
| S-BKG-03 | Waitlist | Ranked by urgency and flexibility; backfill offers | Offer |
| S-BKG-04 | Referrers | Referrer master, verification status, preferences | Verify |
| S-BKG-05 | Analytics | Conversion, AHT, fill rate, no-show forecast | |
Mockup: `brand/screens/booking-console.html`.

### 3.7 Technologist console (S-RAD) — Clinical lens
| ID | Screen | Layout and components | Primary actions | States |
|---|---|---|---|---|
| S-RAD-01 | Room worklist | MWL entries, safety flags, room status | Start | Offline mode |
| S-RAD-02 | Study | Protocol card (Protocol Hand), identity check, safety re-confirmation, contrast calculator, acquisition status, QC results, dose panel | Send, Repeat with reason, Comment to radiologist | QC amber/red; dose outlier reason |
| S-RAD-03 | Protocols | Library by modality, radiologist-protocolled queue | Request protocol | |
| S-RAD-04 | Dose | Per study, per protocol vs DRL, cumulative, dosimetry | Investigate | |
| S-RAD-05 | QA schedule | Daily/weekly/annual tests, phantom entries, RPO sign-off | Record test | Overdue blocks room |
| S-RAD-06 | Stock | Contrast lots, expiry, scan-to-issue | Issue | Recall |
| S-RAD-07 | Mobile X-ray (phone/tablet) | Route, ward patients, portable worklist, offline capture | Send | |
Mockup: `brand/screens/technologist-console.html`.

### 3.8 Nurse console (S-NUR)
| ID | Screen | Notes |
|---|---|---|
| S-NUR-01 | Patients today | Contrast cases, IV status, observations |
| S-NUR-02 | Contrast administration | eGFR, allergies, metformin, dose by weight, lot scan, reaction protocol on screen |
| S-NUR-03 | Reactions and incidents | Record, escalate, ADR report draft |

### 3.9 Reading Room (S-RGT) — Clinical lens
| ID | Screen | Layout and components | Primary actions | States |
|---|---|---|---|---|
| S-RGT-01 | Worklist | Priority chips, AI reasons, sub-specialty filters, pool, on-call | Claim | STAT banner |
| S-RGT-02 | Study | Viewer (hanging protocols, tools, overlays with provenance), priors strip, findings candidates panel, report editor (structured, dictation, macros), consistency warnings, reportable-result categories, sign | Sign, Flag critical, Addendum | Draft, signed, amended; mammography overlay rule |
| S-RGT-03 | Critical result | Category, contact chain, Critical Results Hand progress, take-over call, acknowledgement record | Take over, Escalate | Unacknowledged |
| S-RGT-04 | Peer review | Sampled cases, scoring, discrepancy categories, learning notes | Score | |
| S-RGT-05 | Analytics | TAT by priority, throughput case-mix adjusted, discrepancy rate, AI agreement (informational only) | | |
| S-RGT-06 | Reading fees | Statement per period, RVU-equivalents, disputes | Confirm | |
| S-RGT-07 | On-call (phone) | Priority list, quick view, call back, mark read | | |
Mockup: `brand/screens/reading-room.html`.

### 3.10 Billing (S-BIL) — Business lens
| ID | Screen | Layout and components | Primary actions |
|---|---|---|---|
| S-BIL-01 | Exceptions | Tiles, rejection-wave banner, exception table with Coding Hand suggestions, Inspector with arithmetic and switch response, rejections by reason chart | Accept, Edit, Escalate |
| S-BIL-02 | Claims | Claim lifecycle list; batch and real-time submissions; responses | Submit, Resubmit |
| S-BIL-03 | Coding | Unbilled studies, code proposals, ICD-10 and tariff pickers | Code |
| S-BIL-04 | Remittances | ERA matching, short-payments, unallocated | Match, Transfer to patient |
| S-BIL-05 | Fee schedules | Per funder, effective dates, versions | Edit (approval) |
| S-BIL-06 | Month-end | Unbilled register, in-flight, accruals, close checklist (Close Hand) | Close |
Mockup: `brand/screens/billing-console.html`.

### 3.11 Debtors (S-DEB)
| ID | Screen | Notes |
|---|---|---|
| S-DEB-01 | Ageing | Tiles; ageing by debtor class; Collections Hand run panel; approvals |
| S-DEB-02 | Account | Ledger timeline, statements, plans, disputes, contact log |
| S-DEB-03 | Runs | Dunning batches, channel mix, exclusions, results |
| S-DEB-04 | Disputes | Workflow with evidence |
| S-DEB-05 | Handover | Approval list with prescription checks |
Mockup: `brand/screens/debtors-console.html`.

### 3.12 Practice control tower (S-PRM)
| ID | Screen | Notes |
|---|---|---|
| S-PRM-01 | Control tower | Tiles, site × hour heatmap, alerts with Hand actions, queue and wait chart, approvals list |
| S-PRM-02 | Schedule and capacity | Rooms, templates, closures, load-shedding windows |
| S-PRM-03 | Staff | Roster, gaps, Roster Hand proposals, leave, credentials |
| S-PRM-04 | Equipment | Devices, downtime, work orders, licences |
| S-PRM-05 | Quality | Incidents, complaints, peer review summary |
| S-PRM-06 | Money | Revenue vs budget, cash, unbilled, collections |
| S-PRM-07 | Approvals | All Hand requests awaiting approval with leash context |
Mockup: `brand/screens/practice-control-tower.html`.

### 3.13 Group executive (S-EXE)
| ID | Screen | Notes |
|---|---|---|
| S-EXE-01 | Group control tower | Entity switcher, tiles including AI slip counter, benchmarking, revenue by funder, sites status, acquisition kanban, what-if, Insight Hand question box |
| S-EXE-02 | Practices | Per-practice P&L, KPIs, distributions |
| S-EXE-03 | Money | Consolidation, intercompany, cash forecast |
| S-EXE-04 | Network | Hub capacity, referrer analytics, funder contracts |
| S-EXE-05 | Acquisitions | Pipeline, merger-threshold check, onboarding wizard status |
| S-EXE-06 | Board pack | Generated pack, approvals |
Mockup: `brand/screens/group-analytics.html`.

### 3.14 Shareholder portal (S-SHR)
| ID | Screen | Notes |
|---|---|---|
| S-SHR-01 | My practice | Holding, tiles, P&L vs budget, KPI sparklines |
| S-SHR-02 | Distributions | History, statements, tax certificates |
| S-SHR-03 | Votes | Reserved matters, deadlines |
| S-SHR-04 | Documents | Agreements, AFS |
Mockup: `brand/screens/shareholder-portal.html`.

### 3.15 Compliance (S-CMP) — Governance lens
| ID | Screen | Notes |
|---|---|---|
| S-CMP-01 | Board | Regulatory status tiles, calendar strip, reportable-results register, incident card, POPIA request card, evidence pack generator |
| S-CMP-02 | Register | Statutory register (24) with obligations, owners, evidence |
| S-CMP-03 | Incidents | Investigation workflow, RCA, regulator reports (A2) |
| S-CMP-04 | Complaints | CPA/HPCSA/CMS routes |
| S-CMP-05 | Requests | POPIA and PAIA requests with statutory clocks |
| S-CMP-06 | Audits and policies | Findings, acknowledgements |
Mockup: `brand/screens/compliance-board.html`.

### 3.16 BCI console (S-AIO) — Clinical lens
| ID | Screen | Notes |
|---|---|---|
| S-AIO-01 | Models | Registry, status per site, SAHPRA status, validation |
| S-AIO-02 | Monitoring | Coverage, latency, agreement, override, drift; site alarms; slip counter |
| S-AIO-03 | Shadow | Evaluation panels with subgroup tables and floors |
| S-AIO-04 | Kill switches and change control | Per model/site/practice; change records |
| S-AIO-05 | Incidents and committee | Near-slip reviews, vigilance reports, minutes |
Mockup: `brand/screens/ai-ops-console.html`.

### 3.17 Engineering (S-BIO) — Clinical lens
| ID | Screen | Notes |
|---|---|---|
| S-BIO-01 | Fleet | Edge Gateways, tunnels, backlogs |
| S-BIO-02 | Devices | Register, licences, QA, PM, predictive signals |
| S-BIO-03 | Integrations | DICOM/HL7/FHIR/switch health, message store, replay |
| S-BIO-04 | Work orders | Kanban |
| S-BIO-05 | Access | Vendor remote sessions, approvals, recordings |
Mockup: `brand/screens/engineering-console.html`.

### 3.18 Support (S-SUP)
| ID | Screen | Notes |
|---|---|---|
| S-SUP-01 | Tenants | Practices, sites, health, plan |
| S-SUP-02 | Incidents | Tickets, Support Hand runbooks |
| S-SUP-03 | Onboarding | Onboarding Hand wizard progress per practice (day 1 to 5) |
| S-SUP-04 | Observability | Dashboards, alerts |

### 3.19 Admin and configuration (S-ADM) — Governance lens
| ID | Screen | Notes |
|---|---|---|
| S-ADM-01 | Organisation | Entities, relationships, shareholdings, agreements |
| S-ADM-02 | Sites and rooms | Licences, modalities, AE titles |
| S-ADM-03 | Users and roles | RBAC/ABAC, HPCSA verification, MFA, break-glass |
| S-ADM-04 | Fee schedules and funder contracts | Versions, effective dates |
| S-ADM-05 | Scheme rule packs | Rules, tests, versions |
| S-ADM-06 | Report templates and reportable-result statements | Structured templates; legally reviewed statements with approval |
| S-ADM-07 | Hands and leashes | 21 Hands, leash values, approval policy, status, change control |
| S-ADM-08 | Integrations | Connectors, keys, webhooks |
| S-ADM-09 | Feature flags | Per environment/tenant |
| S-ADM-10 | Onboarding wizard | New practice in 5 days |
Mockup: `brand/screens/admin-settings.html`.

## 4. Key flows (wire level)

### 4.1 Booking (WhatsApp → Patient Space → Front Desk)
```
S-WA-02 photo ─▶ Booking Hand parse ─▶ questions ─▶ slot buttons ─▶ confirm ─▶ prep + pay link
        │                                  │
        └── needs clarification ──▶ S-BKG-01 (human) ──▶ back to WhatsApp
S-PAT-06 prepare ─▶ S-PAT-07 pay (optional) ─▶ S-FDK-01 arrival ─▶ Collect card ─▶ S-RAD-01
```
### 4.2 Acquisition and reading
```
S-RAD-01 start ─▶ S-RAD-02 identity → safety → protocol → acquire → QC → send
   ─▶ ingest ─▶ inference ─▶ S-RGT-01 priority ─▶ S-RGT-02 read → accept candidates → sign
   ─▶ S-REF-03 (+ acknowledgement if critical) ─▶ S-PAT-09 (after release rule)
```
### 4.3 Claim exception
```
signed report ─▶ Coding Hand ─▶ rule packs pass? ──yes──▶ auto-submit (A3) ─▶ response ─▶ remittance
                                    │ no
                                    ▼
                              S-BIL-01 exception ─▶ Accept/Edit ─▶ submit ─▶ … ─▶ S-DEB-01 if patient portion
```
### 4.4 Month-end
```
Close Hand checklist ─▶ S-BIL-06 unbilled cleared ─▶ accruals ─▶ P&L per practice ─▶ intercompany
─▶ S-EXE-03 consolidation ─▶ distributions proposal ─▶ S-SHR-03 approvals ─▶ payment file
```
### 4.5 Practice onboarding (5 days)
```
S-ADM-10 wizard: entity + documents ─▶ sites/rooms/modalities + licences ─▶ fee schedules + contracts
─▶ users + HPCSA verification ─▶ Edge Gateway enrolment ─▶ templates + rule packs ─▶ go-live checklist
```

## 5. Responsive and device matrix
| Surface | 390 phone | 768 tablet | 1024 laptop | 1440+ desktop | Dual monitor |
|---|---|---|---|---|---|
| Patient Space | primary | ok | ok | ok | n/a |
| Referrer Space | read + acknowledge | full | full | full | n/a |
| Front Desk | queue only | full (tablet at desk) | full | full | n/a |
| Technologist | mobile X-ray | full (touch) | full | full | n/a |
| Reading Room | on-call view | review only | single-monitor split | full | viewer + report |
| Business consoles | tiles + approvals | full | full | full | n/a |
| Governance | read | full | full | full | n/a |
Breakpoints: 640, 900, 1200, 1440. Below 900 the rail collapses to a bottom bar and the Inspector
becomes a sheet.

## 6. Accessibility, language and performance
* WCAG 2.2 AA; keyboard-complete; visible focus; screen-reader labels for every icon; no colour-only
  meaning; 44 px touch targets on patient surfaces, 64 px on kiosk.
* Text scaling to 200 % without loss; dyslexia-friendly spacing option; high-contrast mode via
  Window control W3.
* Language packs for patient surfaces (English first; isiZulu, isiXhosa, Afrikaans, Sesotho in R3);
  staff surfaces English with translatable strings; date and number formats per locale (en-ZA).
* Budgets: Patient Space ≤ 150 kB JS gz, TTI < 3 s on 3G; consoles < 1.5 s first interaction on
  broadband; Reading Room first image < 1 s on LAN.

## 7. Mockup index and build mapping
| Mockup | Screens | Route group (apps/web) |
|---|---|---|
| `patient-space.html` | S-PAT-02/04/06/07/09 | `/p/*` |
| `whatsapp-and-kiosk.html` | S-WA-02, S-KSK-01..05 | `apps/whatsapp`, `/kiosk/*` |
| `referrer-space.html` | S-REF-01/02/03/05 | `/r/*` |
| `front-desk.html` | S-FDK-01 | `/desk/*` |
| `booking-console.html` | S-BKG-01/02 | `/booking/*` |
| `technologist-console.html` | S-RAD-01/02/04 | `/tech/*` |
| `reading-room.html` | S-RGT-01/02 | `/read/*` |
| `billing-console.html` | S-BIL-01 | `/billing/*` |
| `debtors-console.html` | S-DEB-01/02/03 | `/debtors/*` |
| `practice-control-tower.html` | S-PRM-01 | `/practice/*` |
| `group-analytics.html` | S-EXE-01/05 | `/group/*` |
| `shareholder-portal.html` | S-SHR-01/02/03 | `/shareholder/*` |
| `compliance-board.html` | S-CMP-01/03/05 | `/compliance/*` |
| `ai-ops-console.html` | S-AIO-01..04 | `/bci/*` |
| `engineering-console.html` | S-BIO-01..05 | `/engineering/*` |
| `admin-settings.html` | S-ADM-04/07 | `/admin/*` |
Each mockup uses `brand/bdl.css`, which is the reference implementation of the tokens and
components that `packages/bdl` must reproduce as React components.

## 8. Requirements
* M21-R-500 Every screen in §3 MUST exist with the listed primary actions and states before its
  module is declared complete.
* M21-R-501 All signed-in surfaces MUST use the shared app frame, command palette, Inspector and
  status vocabulary; no module may introduce its own navigation pattern.
* M21-R-502 AI-derived content MUST use the provenance style everywhere, including tables and
  chips, and MUST expose Accept / Edit / Reject where acceptance is possible.
* M21-R-503 Clinical consoles MUST show the connection and load-shedding status line and MUST keep
  working in Edge Gateway offline mode for the screens marked in §3.7 and §3.9.
* M21-R-504 Patient surfaces MUST meet the performance budgets in §6 and MUST render without
  JavaScript for the appointment and payment confirmation pages (progressive enhancement).
* M21-R-505 Every screen MUST define its empty, loading and error states in Storybook with axe
  checks passing.
