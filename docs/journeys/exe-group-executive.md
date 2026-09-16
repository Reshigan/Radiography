# EXE — Group Executive: Persona Journey

## Persona snapshot

| Item | Detail |
|---|---|
| Code | EXE |
| Who | The Group's executive team at Bonakala Holdings and the MSO: CEO, CFO, COO, CMO (Chief Medical Officer, an HPCSA-registered radiologist), CIO. Cross-tenant roles, governed by the data-sharing agreements recorded in M02; identified clinical data only under a recorded lawful basis, aggregated and de-identified data by default (M02-R-004). |
| Goals | Grow the network, protect margin, manage risk, integrate acquisitions fast. |
| Frustrations today | Monthly packs assembled by hand from six systems; acquisitions that take a year to integrate; scheme negotiations from anecdote; capex decisions on gut feel; regulator questions answered by asking each site. |
| Better than market | Group-wide live analytics, benchmarking across Practices, what-if modelling, acquisition onboarding in days, regulator-ready compliance. |
| Surfaces | Business lens (Bone, Dense L3, Standard W2, Marrow). Group console in M16 with a view per role, `Benchmark`, `TrendChart`, `Cohort`, `Funnel`, `Heatmap`; M02 onboarding flow; M15 consolidation; Command palette. |
| Metrics | Group EBITDA, network report TAT, compliance status. |
| Modules touched | M02 Organisation & Shareholding, M06 Funding & Authorisation, M14 Revenue Cycle, M15 Finance & Consolidation, M16 Analytics & Insight, M17 Workforce, M18 Assets & Engineering, M19 Quality, Risk & Compliance, M20 Agent Runtime, M21 Platform Core. |

The journey follows the five executives across one quarter: Naledi (CEO), Pieter (CFO), Zanele (COO), Dr Govender (CMO) and Ahmed (CIO).

---

## Scene 1 — Five views of the same Monday

**Situation.** 07:00 SAST, Monday. Each executive opens the Group console. The console is one page with a role view; the underlying metrics come from the same semantic layer (`packages/analytics`), so the CFO's revenue and the COO's studies reconcile by construction.

**What they see.**

| Role | What develops first | Then |
|---|---|---|
| CEO (Naledi) | Anything that crosses a Group risk threshold: a Flare `Banner` if any site has a licence within 30 days of expiry without a renewal filed, an open Class 1 AI incident, or a Practice more than 10 % below budget for the quarter to date. Today: none. | Network `StatTile`s: studies last 7 days, network report TAT by priority, EBITDA margin quarter to date versus plan, pipeline of acquisitions and new sites, NPS-style patient rating from the Patient Space (labelled as a sample, not a statistic). |
| CFO (Pieter) | Cash: Group cash position by entity, collections versus forecast, funder ageing by scheme with the rejection spike from Practice B last week annotated and now resolved. | Consolidation status by Practice (closed, in progress, late), intercompany invoices issued and disputed, VAT position by entity ahead of the VAT201 cycle, B-BBEE ownership and procurement inputs for the year's verification, distribution proposals awaiting approval. |
| COO (Zanele) | Uptime: any modality down now (one, an ultrasound at a Free State site, vendor on site), Edge Gateway health by site, load-shedding exposure for the week by province. | Utilisation `Heatmap` by site and modality against benchmark, no-show and fill rates, roster gaps predicted for the next 14 days, Hand action volumes and exception rates per Hand. |
| CMO (Dr Govender) | Clinical safety: critical findings not acknowledged within SLA (none), open peer-review discrepancies rated significant, AI model alarms (one, a drift alarm on chest X-ray triage at a single site, under AIO investigation). | Report TAT by radiologist and Hub, discrepancy rates de-identified by reader, dose versus DRL by protocol across the network, contrast reaction rate, repeat rates. |
| CIO (Ahmed) | Platform: availability against the 99.9 % SLO, security alerts, integrations health (a claims switch adapter with elevated latency), open SUP incidents by severity. | Cost of infrastructure per study, LLM and inference spend per Hand, vendor model licence utilisation, backlog of tenant change requests. |

**What they do.** Each executive spends ten minutes. Naledi reads the CMO's drift alarm and asks in the console thread who owns it; AIO's name and the investigation task appear, with an expected resolution today. Pieter approves two distribution proposals that have cleared their Practice approvals. Zanele asks the console, through the Command palette, "which sites are over 85 % CT utilisation for three months" and gets a `Cohort` of four, which she tags for the capex pipeline. Dr Govender opens the discrepancy list and finds nothing needing his personal intervention. Ahmed reads the switch latency and confirms SUP has a ticket open with the switch vendor.

**What the Platform does.** The Group console is built from M16 read models fed by events from every tenant; cross-tenant access is logged with the lawful basis (the MSO's management agreement and the Group's data-sharing agreement) and de-identified unless the role and task require identified data (the CMO's peer-review drill-down, for example, is identified for the reader, not the patient, and is recorded as such).

**Edge cases.** A management-only affiliate (a Practice that buys the Platform and bureau services but has no Group shareholding) appears in the COO's and CIO's operational views only to the extent its agreement allows; it never appears in consolidation or in benchmarks as an identified peer.

**Success measure.** Each executive can name the Group's top three risks today by 07:15, and every number they see reconciles to the CFO's ledger.

---

## Scene 2 — Acquiring a three-site practice and onboarding it in five days

**Situation.** The Group has signed a sale agreement to acquire a three-site radiology practice in Mpumalanga (Nelspruit, White River, Secunda; two general X-ray and ultrasound sites and one with CT and mammography). The structure is an equity JV: Bonakala Professional Holdings takes 60 %, the two founding radiologists keep 40 %, and the MSO signs a management services agreement. Effective date is the first of next month, 12 working days away. The Competition Commission notification threshold has been assessed by the Group's attorneys as not triggered at this size (the Platform records the assessment as a document; it does not make the determination). Naledi wants the practice live on the Platform on day one, and Zanele has committed to the "5 working days" onboarding target from the organisation model.

**What they see.** Zanele opens the Practice Onboarding flow in M02. It is a `Stepper` with the Onboarding Hand (M20, A3 within a leash that spans M01, M02, M03, M05, M06, M09, M14, M17, M18 and M19 for a Practice in "onboarding" status only) working ahead of her. The stepper shows:

1. Legal entity and agreements: CIPC registration, VAT number, tax number, BHF practice number, financial year end; shareholders' agreement, management services agreement, reading services agreement with the Hub; cap table by share class.
2. Regulatory particulars: HPCSA registrations of the principals and all clinical staff; SAHPRA radiation licences per room; the Radiation Protection Officer; the POPIA Information Officer and registration with the Information Regulator.
3. Sites, rooms, modalities: addresses, GPS, operating hours, licence numbers and expiry, modalities with vendor, model, serial and AE title.
4. Funders and fees: scheme contracts and DSP status by scheme and option, RAF and COIDA settings, cash price list, tariff schedule versions.
5. Data migration: patient master, open debtors, historic images and reports from the practice's existing PACS and RIS.
6. People: users, roles, credentials, roster patterns, leave balances.
7. Integrations: Edge Gateway enrolment per site, modality DICOM configuration, claims switch practice registration, bank account and PSP, referrer directory import, WhatsApp number.
8. Go-live readiness: test claims, test bookings, dose report ingestion, a dry-run day.

**What they do.**

*Day 1.* Zanele uploads the signed agreements and the practice's document bundle (the due-diligence data room export). The Onboarding Hand extracts the entity particulars, the cap table, the licence numbers, the equipment list and the staff list from the documents, fills the stepper, and marks each extracted field with a `Provenance` chip and the page it came from. Zanele and the Group's company secretary confirm the entity and the cap table (A1 for legal particulars). The Hand requests HPCSA verification for every practitioner through M01 and SAHPRA licence confirmation against the uploaded licence certificates; two staff have registrations that verify only after a name-format correction.

*Day 2.* Ahmed's team ships three Edge Gateways by overnight courier with site codes; the practice's IT contact plugs each in and enters the one-time token. The Hand configures the modalities' DICOM destinations from the equipment list and asks each site to send a test image; all seven modalities are seen by the afternoon. Pieter's team maps the practice's chart of accounts to the Group GL in M15 (A1, the Hand proposes the mapping) and configures the intercompany rules: management fee 8 % of collections (illustrative), reading fees per the Hub schedule, no rent because the properties are leased from third parties.

*Day 3.* Funders. The Hand reads the practice's existing scheme contracts, identifies DSP participation by scheme and option, and configures the fee schedules and rule packs from the Group's library, noting three schemes where the acquired practice's contracted rates differ from the Group's; Pieter decides to keep the acquired rates until renegotiation and records it as a decision on the agreement. The practice's registration on the claims switch is transferred; the Hand submits five test claims to the switch simulator and then five live zero-value validation claims where the switch supports them.

*Day 4.* Data migration. The Hand runs the patient master import through M03's duplicate detection: 61 000 records, 2 300 probable duplicates flagged, 900 auto-merged under the deterministic rule (same ID number, same date of birth), the rest queued for FDK at the sites. Open debtors import into M14 with their ages and liability reasons mapped; the Collections Hand is held off for 14 days on migrated balances so that the first contact from Bonakala is a statement that explains the change of name and how to pay, not a reminder. Historic images (18 TB) start a background transfer to the central archive with the practice's old PACS remaining readable through a DICOM query proxy so nothing is unavailable in the meantime.

*Day 5.* Dry-run day. The sites run a parallel day: real patients booked in the Platform, imaging through the gateways, reports signed in the Reading Room, claims scrubbed but held. Dr Govender's team reviews the acquired practice's protocol library against the Group's and the DRLs from M10 flag two CT protocols with dose above the Group reference; the CMO asks the site's radiologist to align before go-live. The go-live checklist in the stepper goes Signal item by item. Zanele signs the readiness with a typed `Confirm`; Naledi's console shows the new Practice in the network map.

**What the Platform does.**
- The Onboarding Hand's mandate is bounded to entities in "onboarding" status; it cannot touch live tenants. It extracts, proposes and configures; humans confirm legal particulars, fee decisions, GL mappings and go-live.
- Every extracted field carries provenance; every confirmation is a versioned change with the source document attached (M02-R-003).
- The practice becomes a tenant on day 1 in "onboarding" isolation; cross-tenant access for the Group starts only when the effective date and the signed data-sharing agreement are both recorded.
- Events: `entity.created.v1`, `shareholding.recorded.v1`, `site.created.v1`, `gateway.enrolled.v1`, `modality.verified.v1`, `funder.contract.configured.v1`, `migration.completed.v1`, `practice.live.v1`.

**Edge cases.**
- The practice's SAHPRA licence for the White River CT is in the name of the selling entity and must be amended to the new licence holder. The Compliance Hand prepares the amendment application; until SAHPRA confirms, the Platform records the transitional arrangement the attorneys advised and CMP approves the scheduling override with an expiry.
- The practice's radiologists want to keep reporting in their own template style. The Reading Room supports Practice-level templates; the Group's structured-report elements (key images, critical-finding fields) are mandatory and the rest is theirs.
- The old billing system's rejections and remittances for the last four months must stay workable because of stale-claim rules; those claims are imported as "legacy" with their switch references so the Claims Hand can resubmit.
- B-BBEE: the acquired practice's ownership by demographic classification is captured only with each shareholder's consent, for the Group's ownership scorecard.

**Success measure.** Live on the effective date; first claims out on day one of operation; no historic image unavailable at any point; the acquired sites' first-pass acceptance within two points of the Group average by month two.

---

## Scene 3 — Negotiating a scheme DSP contract with data

**Situation.** A large open medical scheme is renegotiating its Designated Service Provider network for radiology for next year. The scheme proposes a network rate at a discount to its standard tariff for CT and MRI in exchange for volume, and a requirement that pre-authorisation for all MRI be obtained through its portal within a turnaround SLA. Pieter and Dr Govender lead; Naledi decides.

**What they see.** The Funder Negotiation view in M16 for this scheme: the last 24 months of claims by option, tariff family and site; paid versus billed at line level; rejection reasons and their cost; authorisation turnaround by the scheme (from M06's request and response timestamps); the Group's cost-to-serve per study by modality and site (from M15 allocations); the patient co-payment burden on that scheme's members by option (from M14 liability splits); the scheme's members' share of each site's volume; and the report TAT and critical-finding acknowledgement times the scheme's members received, which the scheme has never seen from a provider before. A what-if panel models the proposal: network rate, expected volume shift, effect on EBITDA by site and Practice, and, because the JV partners share in Practice profit, the effect on each JV's distributable profit.

**What they do.** Pieter runs three scenarios: accept as proposed; accept with a lower discount and a mutual authorisation SLA (the scheme commits to a response time, and the Platform shows the scheme's current median is longer than the SLA they want to impose on the Group); decline and remain out of network, modelling the co-payment burden and the likely volume loss. Dr Govender adds the clinical case: the Group's structured reports, critical-finding acknowledgement record and dose-versus-DRL results, and a proposal that the scheme accept the Group's appropriateness guidance (M04) in place of portal pre-authorisation for a defined set of MRI indications, with the Platform reporting adherence monthly through the Funder API. Naledi chooses the second scenario with the appropriateness proposal as the opening position.

**What the Platform does.**
- The negotiation view uses the Group's own data only; no member-identified data leaves the Platform, and the pack for the scheme contains aggregates under the Funder API's consent model.
- Draft contract terms, when agreed, are captured as an `agreement` in M02 with fee schedules, DSP flags by option, authorisation rules and SLAs, and then become rule-pack and fee-schedule versions in M14 and M06, effective-dated, with a dry-run against last quarter's claims before the effective date.
- The Funder API (M13 and M14 with PAY) can expose adherence and quality reports to the scheme monthly, which makes the SLA mutual and measurable.
- Events: `agreement.drafted.v1`, `agreement.signed.v1`, `fee_schedule.versioned.v1`, `rules.pack.changed.v1`.

**Edge cases.**
- The scheme's proposed rate for a tariff code is below the Group's cost-to-serve at two rural sites. The what-if shows it by site; Pieter negotiates a rural-site carve-out, which the Platform models as a site-scoped fee schedule.
- The scheme wants exclusivity clauses that the Group's attorneys consider a Competition Act risk. The Platform records the legal opinion against the agreement draft; it does not evaluate competition law.
- The JV partners of a Practice heavily exposed to this scheme must be consulted because changes to fee schedules are a reserved matter in their shareholders' agreement (see the SHR journey); M02 routes the approval task automatically.

**Success measure.** The negotiation is conducted on line-level evidence; the signed terms are live in the rule packs on the effective date; the mutual SLA is reported monthly and the scheme's authorisation turnaround improves.

---

## Scene 4 — A capex what-if for a second MRI

**Situation.** Umhlanga (Practice B) has run its MRI above 85 % utilisation for four months, with a median wait for a routine MRI slot of nine days. Lerato (PRM) and the JV partners have asked for a second MRI. It is a reserved matter (capex above threshold) and a Group capital allocation question.

**What they see.** The Capex What-If in M16 for a modality addition. Inputs (each labelled as an assumption, editable, with the source): demand history and referrer growth for MRI at Umhlanga and the three sites within 25 km, current wait and the volume the Platform estimates is lost to competitors when wait exceeds five days (from cancellations and referrer analytics, labelled as an estimate), the protocol mix and funder mix, the effect of the DSP contract from Scene 3, staffing (one additional MRI radiographer, credential availability in the market from M17), the MRI's power and helium dependence and the load-shedding history at the site (M18), the vendor quotes with service-contract terms, the room build cost and the SAHPRA position (MRI does not fall under the Radiation Control licence, but the room and building work does need municipal approval, which the Platform records as a project dependency), the lease terms from Bonakala Properties, and the financing options. Outputs: monthly cash flow, payback, IRR, EBITDA effect on Practice B and the Group, the JV partners' share, and the sensitivity to three variables.

**What they do.** Pieter and Zanele run the base case and two alternatives: a refurbished 1.5 T unit, and no second MRI but a re-routing of routine MRI to the nearby Gateway site with a shuttle. Dr Govender adds a clinical constraint: the mix at Umhlanga includes cardiac and prostate MRI that need the higher-field unit. Naledi takes the base case to the board with the alternatives shown, and M02 opens the reserved-matter vote for Practice B's shareholders in parallel.

**What the Platform does.**
- The what-if is a model in `packages/analytics` with named assumptions; each run is saved with its assumptions so a later reader can see what was believed at the time.
- If approved, the project becomes an asset-in-construction in M18 with milestones (order, room build, delivery, acceptance testing, staff credentialing, go-live), each of which emits events into the Control Tower and the board pack.
- Events: `capex.proposed.v1`, `reserved_matter.proposed.v1`, `capex.approved.v1`, `asset.project.milestone.v1`.

**Edge cases.**
- The vendor quote is in US dollars with a rand exposure; the model shows the exposure and the CFO's hedging decision is recorded against the project.
- The JV partners approve but the Group's board defers a quarter; the Platform records both decisions and the effective dates, and the reserved-matter record shows the status honestly to the partners.

**Success measure.** The decision is taken in one board cycle with the alternatives visible; the project's actuals are compared with the what-if monthly after go-live, and the variance is used to calibrate the next model.

---

## Scene 5 — The board pack

**Situation.** Quarter-end. The Group's board meets in three weeks. Pieter owns the pack; the other executives own sections.

**What they see.** The Board Pack builder in M16 assembles from locked periods (M15) and live compliance state (M19). Sections: Group results and consolidation (revenue, EBITDA, cash, capex, minority interests by JV); Practice performance versus budget with the bridges; network operations (studies, TAT, utilisation, uptime, load-shedding cost); revenue cycle (first-pass acceptance, DSO, write-offs, funder concentration); people (headcount, vacancies, credential currency, CPD status, B-BBEE skills-development inputs); compliance and risk (licence currency across every site, open non-conformances, incidents by class, complaints, POPIA requests and breaches, SAHPRA and HPCSA interactions, accreditation status); AI governance (models in production, performance versus baseline, override rates, incidents, SAHPRA SaMD status, the quarterly AI committee minutes from AIO); technology (availability, security posture, spend per study); strategy (acquisition pipeline, capex pipeline, funder negotiations). Every chart follows the `dataviz` rules and every number links to its source.

**What they do.** Each executive writes their narrative in the pack's editor. A drafting Hand proposes a first narrative for each section from the numbers and the recorded decisions, in the annotated style; the executive edits and accepts, at which point it loses the annotation. Pieter locks the pack, and the Platform produces the PDF and the board portal version, with an appendix of the assumptions behind every forecast and what-if.

**What the Platform does.**
- The pack draws from locked periods only; if a Practice's month is reopened after the pack is locked, the pack shows a restatement note rather than silently changing.
- Drafting is a Class 4 output: an executive's acceptance is recorded, and the pack marks which paragraphs were AI-drafted and human-edited.
- Access is by board role in M01; directors of a JV see their Practice's section, not other JVs' identified numbers.
- Events: `board_pack.locked.v1`, `period.restated.v1`.

**Edge cases.**
- A director asks a question in the portal ("why did Practice C's TAT worsen in month two"). The question is routed to the section owner; the answer, with the linked events, is added to the pack's Q&A record for the minutes.
- The auditors ask for the same numbers with a different cut. The semantic layer serves them the same metrics with their own filters; there is no second spreadsheet.

**Success measure.** Pack locked seven days before the meeting; zero numbers questioned for reconciliation; every question answered from the Platform in the meeting.

---

## Moments that beat the market

- Five executive views, one semantic layer: the COO's studies and the CFO's revenue cannot disagree.
- A three-site acquisition is live on the Platform in five working days, with the Onboarding Hand extracting particulars from the data room and humans confirming only what the law requires them to confirm.
- Migrated debtors get a statement that explains the change before any reminder; migrated images are never unavailable.
- Scheme negotiations are conducted on line-level paid-versus-billed, cost-to-serve and clinical quality, with a mutual SLA the Platform can measure and report through the Funder API.
- Capex what-ifs use the site's own demand, funder mix and load-shedding history, with assumptions saved and compared to actuals after go-live.
- Reserved matters for JV partners run in parallel with the Group's decision, automatically, from the shareholders' agreement recorded in M02.
- The board pack is built from locked periods and live compliance state; restatements are visible, not silent.
- Regulator, auditor and director questions are answered from the same data, in the meeting.

## Failure modes designed out

- **Executive dashboards that disagree with the ledger.** One semantic layer; the CFO's numbers are the source for every role view.
- **Identified patient data in the boardroom.** Cross-tenant views are aggregated and de-identified by default; identified access requires a role, a task and a recorded lawful basis.
- **Year-long integrations.** The onboarding flow is a product feature with a Hand, not a project plan; the tenant isolation and the go-live checklist are enforced.
- **A Hand touching live tenants during onboarding.** The Onboarding Hand's mandate is bound to entities in "onboarding" status by the runtime.
- **Negotiating from anecdote.** The negotiation view is line-level evidence, and signed terms become effective-dated rule packs with a dry-run.
- **Capex on gut feel.** Saved assumptions, alternatives modelled in the same run, and post-go-live variance tracking.
- **Silent restatements.** Locked periods, restatement notes in the pack.
- **Reserved matters overlooked.** Fee-schedule changes, capex and borrowings route to JV partners from the agreement, not from memory.
