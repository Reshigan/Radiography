# 13 — Analytics and KPIs

Module M16 (Analytics & Insight) turns every event in the Platform into numbers that people can act on: the same definitions for a front-desk supervisor at one site and the Group CFO looking across 300. This document defines the analytics architecture, the semantic layer, the full KPI dictionary, the dashboards per persona, benchmarking, forecasting, alerting, self-service through the Insight Hand, and data governance. "Detailed analytics all round" means: every module contributes events, every persona has a home view, and every number shows the definition it was computed from.

## 1. Principles

1. **One definition per metric.** A KPI is defined once in the semantic layer (`packages/analytics`) and rendered everywhere from that definition. No dashboard, export or Hand computes a metric its own way.
2. **Event-sourced.** The warehouse is built from the domain event stream in 08 §5 plus nightly snapshots of slowly changing state. Every fact row can be traced to the events that produced it.
3. **Row-level security travels with the data.** A user sees only rows for practices, sites and roles in their `role_assignment` scope; Group-level views are de-identified (tier T1 or higher, 08 §7) unless a `data_sharing_basis` exists.
4. **Case-mix honesty.** Any productivity or throughput number is shown raw and case-mix adjusted side by side; the adjustment method is visible.
5. **Direction and target on every tile.** A tile without a target and a direction (higher is better, lower is better, within band) is not a KPI, it is a count.
6. **Charts follow `dataviz`.** One palette derived from BDL tokens (Signal, Iris, Beam, Flare, Marrow, Ash ramp); direct labels rather than legends; dark and light parity (Clinical lens on Carbon, Business lens on Bone, identical encodings); no 3D; no pie charts over three slices; AI-derived series drawn in the annotated style (dashed) with model version in the label.

## 2. Architecture

```
Domain events (outbox) ──▶ Stream ingest ──▶ Landing (raw, immutable, partitioned by day)
                                                  │
Nightly snapshots (dims, balances) ───────────────┤
                                                  ▼
                              Warehouse: staging → facts/dims → marts
                                                  │
                              Semantic layer (metric definitions, RLS, freshness)
                        ┌──────────────┬──────────┼──────────────┬───────────────┐
                    Dashboards    Insight Hand   Benchmarks    Forecasts     Exports/packs
```

| Layer | Internal (Docker) | Demo (Cloudflare) |
|---|---|---|
| Ingest | NATS JetStream consumer writes events to landing tables | Queue consumer writes to D1 landing tables and Analytics Engine datasets |
| Warehouse | PostgreSQL 16 for facts up to about 50 M rows per table; ClickHouse for high-volume facts (audit, telemetry, communication, claim lines at 30 M lines a year) | D1 (SQLite) marts; Analytics Engine for time-series counters |
| Transformation | SQL models in `packages/analytics` (dbt-style, versioned, tested); incremental by event time | Same SQL, SQLite dialect generated from the Postgres models |
| Semantic layer | YAML metric definitions compiled to SQL; served by the API with RLS | Same |
| Serving | BDL Analytics components (`StatTile`, `TrendChart`, `Heatmap`, `Funnel`, `Benchmark`, `Cohort`) | Same |
| Freshness tiers | Live (seconds: queues, arrivals, critical results); near-live (5 minutes: throughput, TAT, claims); daily (finance, workforce, benchmarks); monthly (management pack, distributions) | Live via Durable Objects, rest daily |

Core facts and dimensions:

| Fact (grain) | Key measures |
|---|---|
| `f_referral` (referral) | received, matched, placed, cancelled, time to each |
| `f_appointment` (appointment) | booked, confirmed, arrived, no-show, cancelled, lead time, slot lead time offered |
| `f_encounter` (encounter) | arrival, registration, in-room, out-room, discharge timestamps; wait segments |
| `f_study` (study) | segments referral→booked→arrived→scanned→available→signed→delivered; repeat count; dose; AI results; RVU-equivalent weight |
| `f_report` (report version) | assignment, draft, sign times; addenda; peer review score; critical result timings |
| `f_ai_result` (result) | latency, decision, agreement, model version |
| `f_communication` (attempt) | channel, delivered, read, cost |
| `f_charge`, `f_claim_line`, `f_remittance_line`, `f_payment`, `f_allocation` (line) | amounts by status and age, reason taxonomy |
| `f_journal_line` (line) | account, cost centre, dimensions |
| `f_shift`, `f_time_entry` (shift) | planned, worked, overtime, vacancy |
| `f_asset_event` (event) | up/down, maintenance, QA, licence |
| `f_incident`, `f_complaint`, `f_popia_request` (case) | open, closed, durations |
| `f_agent_task`, `f_agent_action` (task/action) | outcome, escalation, cost, approvals |
| Dimensions | `d_date` (SA public holidays, school terms, load-shedding stage by day), `d_practice`, `d_site`, `d_room`, `d_modality`, `d_procedure` (RVU weight, modality class), `d_referrer` (discipline, organisation, region), `d_funder` (type, scheme, option), `d_staff` (role, FTE), `d_ai_model_version`, `d_rejection_reason`, `d_patient_cohort` (age band, sex, funder class; never identity at T1+) |

## 3. Metric definition schema

Every metric in `packages/analytics/metrics/*.yaml` has these fields; the dictionary in §4 is the human-readable projection of the same files.

| Field | Meaning |
|---|---|
| `id` | Stable code, e.g. `ACC.TTA` |
| `name`, `description` | Plain-English name and one-paragraph definition including inclusions and exclusions |
| `formula` | Numerator, denominator (or aggregate) over named facts, with filters |
| `grain` | The unit the metric is computed at before aggregation (study, claim line, day) |
| `dimensions` | Allowed slicing dimensions |
| `owner` | Persona accountable for the definition (and for its target) |
| `target`, `direction` | Illustrative default target; `higher`, `lower` or `band`; targets are per Practice and stored as reference data |
| `freshness` | live, near-live, daily, monthly |
| `privacy_class` | minimum de-identification tier at which the metric may be shown outside the tenant; small-cell rule applies |
| `version`, `changed_by`, `change_note` | Definition change control (§13) |

## 4. KPI dictionary

Unless stated, every metric slices by Practice, Site, Modality, Period (day, week, month, financial period) and, where the fact carries it, Room, Procedure group, Funder class, Referrer discipline and Staff role. Targets are illustrative defaults; each Practice sets its own in the Platform. "Median" and "P90" are used rather than means for durations. Business-hours variants (SAST, site operating hours) exist for every duration metric.

### 4.1 Access (owner: BKG lead, PRM)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| ACC.TTA | Time to appointment | Median and P90 of (appointment start − order placed) for first booking, calendar days; also "third next available slot" per modality | Appointment | Median ≤ 2 days routine, same day urgent | lower |
| ACC.OFFER | Slot offered within request window | Appointments whose first offered slot fell inside the patient's requested window ÷ bookings | Appointment | ≥ 85 % | higher |
| ACC.FILL | Fill rate | Booked slot minutes ÷ available slot minutes (excluding blocked) | Slot | 80–90 % | band |
| ACC.NOSHOW | No-show rate | `appointment.no_show` ÷ (arrived + no_show) | Appointment | ≤ 5 % | lower |
| ACC.CANCEL | Cancellation rate (and late-cancellation < 24 h) | cancelled ÷ booked; late subset | Appointment | ≤ 8 %; late ≤ 3 % | lower |
| ACC.WAITCONV | Waitlist conversion | waitlist offers accepted ÷ offers made; and waitlist entries booked ÷ entries | Waitlist entry | ≥ 60 % | higher |
| ACC.CONV | Referral conversion | orders placed that reached `arrived` ÷ referrals received (excluding duplicates) | Referral | ≥ 85 % | higher |
| ACC.SELF | Self-service booking share | bookings via Patient Space or WhatsApp ÷ all bookings | Appointment | ≥ 50 % | higher |
| ACC.AHT | Contact-centre handling time | Median duration of BKG interactions per booking outcome | Interaction | ≤ 4 min | lower |
| ACC.HAND | Booking Hand completion | bookings completed end-to-end by the Booking Hand ÷ bookings it started | Agent task | ≥ 70 % | higher |

### 4.2 Operations (owner: PRM, RAD lead)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| OPS.UTIL | Utilisation | Scanned minutes (in-room to out-room) ÷ staffed operating minutes, by modality, room and hour of day (Heatmap site × hour) | Encounter | CT/MR 70–85 %, X-ray 50–70 % | band |
| OPS.TIR | Time in room | Median and P90 (out-room − in-room), case-mix adjusted by procedure expected duration | Encounter | ≤ 1.1 × expected | lower |
| OPS.WAIT | Waiting-room time | Median (in-room − arrived) for on-time arrivals; late arrivals reported separately | Encounter | ≤ 15 min | lower |
| OPS.TAT.SEG | Turnaround segments | Median and P90 for each segment: referral→booked, booked→arrived (lead time), arrived→scanned (in-room), scanned→available, available→signed, signed→delivered; and end-to-end referral→delivered | Study | available→signed: STAT ≤ 30 min, urgent ≤ 4 h, routine ≤ 24 h; signed→delivered ≤ 5 min | lower |
| OPS.TAT.SLA | TAT within SLA | studies signed within the priority SLA ÷ studies signed | Study | ≥ 95 % | higher |
| OPS.REPEAT | Repeat/reject rate | repeat exposures ÷ total exposures, by reason and by radiographer (case-mix adjusted, shown to the individual only) | Exposure | ≤ 5 % projection radiography, ≤ 3 % CT | lower |
| OPS.COMPLETE | Exam completeness | studies `available` without `incomplete` or `qc_hold` history ÷ studies | Study | ≥ 98 % | higher |
| OPS.PROTOCOL | Protocol adherence | studies acquired on the assigned protocol version ÷ studies | Study | ≥ 97 % | higher |
| OPS.THRU | Studies per staffed hour | studies completed ÷ staffed RAD hours, RVU-weighted | Shift | per modality baseline | higher |
| OPS.UNSOL | Unsolicited studies | studies flagged `unsolicited` ÷ studies | Study | ≤ 0.5 % | lower |
| OPS.EDGE | Edge continuity | minutes imaging continued during link or grid outage ÷ outage minutes | Site day | 100 % | higher |

### 4.3 Clinical quality (owner: CMO office, RGT lead, CMP)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| CLQ.PEER | Peer review discrepancy rate | reviews scored major or critical ÷ reviews; by modality and (privately) radiologist; sampling rate shown alongside | Peer review | ≤ 2 % major | lower |
| CLQ.PEERCOV | Peer review coverage | reports peer-reviewed ÷ reports signed | Report | ≥ 3 % random plus all AI-discordant | higher |
| CLQ.CRIT.ACK | Critical result acknowledgement time | Median and P90 (acknowledged − raised); share acknowledged within 60 min | Critical result | P90 ≤ 60 min; 100 % acknowledged | lower |
| CLQ.CRIT.ESC | Critical results escalated | escalations ÷ critical results | Critical result | ≤ 10 % | lower |
| CLQ.FU | Follow-up completion | recommended follow-up imaging (structured recommendation with interval) that was booked and completed within interval + 30 days ÷ recommendations | Structured finding | ≥ 80 % | higher |
| CLQ.ADD | Addendum rate | addenda ÷ signed reports, by reason | Report | ≤ 1.5 % | lower |
| CLQ.DRL | Dose vs DRL | Median dose metric ÷ DRL per protocol and age band; share of studies above DRL | Dose record | Median ≤ 1.0; > DRL ≤ 10 % | lower |
| CLQ.DOSE.CAP | Dose capture rate | studies with an RDSR-sourced dose record ÷ ionising studies | Study | ≥ 99 % | higher |
| CLQ.CONTRAST | Contrast reactions | reactions by severity ÷ contrast administrations; extravasations ÷ injections | Encounter | ≤ 0.3 % mild; severe tracked individually | lower |
| CLQ.EGFR | eGFR check compliance | contrast CT with eGFR recorded within policy window ÷ contrast CT | Encounter | 100 % | higher |
| CLQ.AI.AGREE | AI agreement rate | findings candidates accepted (or edited) ÷ candidates presented, by model version and body part | Finding candidate | model baseline ± band | band |
| CLQ.AI.OVR | AI override rate | candidates rejected ÷ presented; and signed findings with no candidate (missed by AI) ÷ signed findings, by model version | Finding candidate | per model validation report | band |
| CLQ.AI.TRIAGE | Triage precision | studies prioritised by AI that the signed report confirms as critical/urgent ÷ prioritised studies | Study | ≥ validation report | higher |
| CLQ.ICD | ICD-10 specificity | claims lines with codes at full specificity (no unspecified suffix where a specific code exists) ÷ lines | Claim line | ≥ 90 % | higher |

### 4.4 Patient experience (owner: PRM, Group patient experience lead)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| PXP.NPS | NPS | promoters − detractors (0–10 question sent 2 hours after discharge and after results release) as % of responses, per touchpoint (booking, arrival, scan, results, billing) | Survey response | ≥ 60 | higher |
| PXP.CSAT | CSAT per touchpoint | 1–5 responses ≥ 4 ÷ responses | Survey response | ≥ 90 % | higher |
| PXP.RESP | Survey response rate | responses ÷ invitations | Invitation | ≥ 25 % | higher |
| PXP.WAIT | Reported and measured wait | OPS.WAIT alongside patient-reported wait band | Encounter | ≤ 15 min | lower |
| PXP.QUOTE | Quote accuracy | quotes where final patient liability = quoted patient portion (± R50, illustrative) ÷ quotes accepted | Quote | ≥ 95 % | higher |
| PXP.SURPRISE | Surprise balance rate | patient statements with liability not disclosed before the visit ÷ statements | Statement | ≤ 2 % | lower |
| PXP.RIH | Results-in-hand time | Median (results released to patient − report signed); share within 24 h | Report | ≤ 10 min where policy is immediate; ≥ 95 % within 24 h | lower |
| PXP.COMPLAINT | Complaint rate | complaints ÷ encounters, by category | Complaint | ≤ 0.2 % | lower |
| PXP.PREP | Pre-check-in completion | encounters with questionnaire and consent completed before arrival ÷ encounters | Encounter | ≥ 70 % | higher |
| PXP.LANG | Language match | communications sent in the patient's preferred language ÷ communications | Communication | ≥ 95 % | higher |

### 4.5 Referrer (owner: Group referrer relations, PRM)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| REF.VOL | Referral volume | referrals received, by referrer, organisation, discipline, region; trailing 4-week vs prior | Referral | plan | higher |
| REF.SOW | Share of wallet | referrer's studies at Bonakala ÷ estimated total imaging referrals (from scheme claims data where shared, or a modelled estimate labelled as such) | Referrer month | growth | higher |
| REF.TAT | TAT per referrer | OPS.TAT.SEG available→signed and signed→delivered by referrer, with their preferred channel | Study | per SLA | lower |
| REF.CHURN | Churn risk | share of active referrers whose volume fell > 40 % vs their own 12-week baseline or with no referral in 60 days; risk score from the Referrer Hand with provenance | Referrer | ≤ 5 % of active | lower |
| REF.NEW | New referrers | referrers with first referral in period; share still active after 90 days | Referrer | plan | higher |
| REF.ACTIVE | Active referrers | referrers with ≥ 1 referral in trailing 90 days | Referrer | growth | higher |
| REF.EREF | Electronic referral share | referrals via portal, FHIR, HL7 ÷ referrals | Referral | ≥ 60 % | higher |
| REF.APPROP | Appropriateness change rate | orders changed after an appropriateness suggestion ÷ suggestions shown | Order procedure | tracked | band |
| REF.ATTEND | Referred patient attendance | ACC.CONV by referrer, shown to the referrer in Referrer Space | Referral | ≥ 85 % | higher |

### 4.6 Revenue cycle (owner: BIL lead, DEB lead, CFO)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| RCM.FPA | First-pass acceptance | claim lines accepted on first submission ÷ lines submitted | Claim line | ≥ 95 % | higher |
| RCM.REJ | Rejection rate by reason | lines rejected ÷ lines submitted, by taxonomy reason, funder, site, coder (human or Hand) | Claim line | ≤ 4 % | lower |
| RCM.REJ.FIX | Rejection recovery | rejected lines eventually paid ÷ rejected lines; median days to recover; share auto-fixed by the Rejection Hand | Claim line | ≥ 80 % | higher |
| RCM.DTB | Days to bill | Median (claim submitted − service date), split available→signed and signed→submitted | Claim | ≤ 1 day for clean claims | lower |
| RCM.UNBILLED | Unbilled | value of charges in draft, coded, ready or held older than 2 days; count and ZAR, by hold reason | Charge | ≤ 2 % of monthly revenue | lower |
| RCM.DSO | Days sales outstanding | debtors balance ÷ (trailing 90-day net revenue ÷ 90); split scheme and patient | Account | ≤ 35 days scheme, ≤ 45 patient | lower |
| RCM.NCR | Net collection rate | collections ÷ (charges − contractual adjustments) for a service-month cohort at 90 and 180 days | Service month | ≥ 97 % at 180 days | higher |
| RCM.POS | Point-of-service collection rate | patient portion collected on day of service ÷ patient portion quoted | Encounter | ≥ 90 % | higher |
| RCM.AGE | Debtors ageing | balance by bucket (current, 30, 60, 90, 120+) and payer class | Account | ≤ 10 % over 90 | lower |
| RCM.WO | Write-offs | write-offs ÷ gross charges, by reason (bad debt, PMB shortfall, contractual, goodwill, prescription) | Charge | ≤ 1.5 % | lower |
| RCM.C2C | Cost to collect | RCM staff cost + switch fees + PSP fees + communication cost + Hand cost ÷ collections | Period | ≤ 3 % | lower |
| RCM.RPS | Revenue per study | net revenue ÷ studies, by modality, payer class, site; also per RVU | Study | plan | higher |
| RCM.MIX | Payer mix | net revenue share by funder type (scheme, cash, RAF, COIDA, corporate, government) and by scheme | Period | plan | band |
| RCM.CONTRACT | Contract performance | actual paid per tariff code ÷ contracted rate, by funder contract; lines paid below contract | Claim line | ≥ 99 % | higher |
| RCM.DEADLINE | Resubmission deadline risk | value of rejected lines within 30 days of the funder's resubmission deadline | Claim line | R0 | lower |
| RCM.PLAN | Payment plan performance | instalments paid on time ÷ due | Payment plan | ≥ 85 % | higher |
| RCM.DISPUTE | Disputes open and age | open disputes, median age, value | Dispute | ≤ 14 days | lower |
| RCM.AUTO | Straight-through claims | claims that reached `submitted` with no human touch ÷ claims | Claim | ≥ 85 % | higher |

### 4.7 Finance (owner: CFO, Practice finance)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| FIN.REV | Net revenue | gross charges − contractual adjustments − write-offs, accrual basis, by entity, site, modality | Period | budget | higher |
| FIN.EBITDA | EBITDA and margin | revenue − operating costs (allocated by intercompany drivers) before interest, tax, depreciation; margin = EBITDA ÷ revenue | Period | budget | higher |
| FIN.MARGIN.SITE | Contribution margin per site and modality | revenue − direct costs (staff, consumables, reading fees, equipment lease and maintenance) | Period | budget | higher |
| FIN.CPS | Cost per study | total allocated cost ÷ studies, by modality; direct-cost variant | Study | benchmark | lower |
| FIN.IC | Intercompany | management fees, platform fees, rent, reading fees issued and settled; days to settle; disputed value | Invoice | settled ≤ 30 days | lower |
| FIN.DIST | Distributions | distributable profit, proposed, approved, paid; days from period close to payment | Period | ≤ 45 days | lower |
| FIN.VAR | Budget variance | actual − budget per line and KPI, with driver decomposition (volume, price, mix, cost) | Period | within ± 5 % | band |
| FIN.CASH | Cash and runway | closing cash, 13-week forecast, collections vs forecast | Week | plan | higher |
| FIN.CAPEX | Capex return | incremental EBITDA of an asset ÷ its cost, tracked against the business case | Asset | business case | higher |

### 4.8 Workforce (owner: PRM, Group HR)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| WFM.SPF | Studies per FTE, case-mix adjusted | RVU-weighted studies ÷ FTE worked, by role and modality | Period | benchmark | higher |
| WFM.OT | Overtime | overtime hours ÷ worked hours; cost | Shift | ≤ 5 % | lower |
| WFM.VAC | Vacancies and gap hours | unfilled roster hours ÷ planned hours; open positions | Roster | ≤ 3 % | lower |
| WFM.ABS | Absence | absent shifts ÷ published shifts | Shift | ≤ 3 % | lower |
| WFM.CRED | Credential expiry | staff with a credential expiring within 90/30 days; expired (must be 0 rostered) | Staff | 0 expired | lower |
| WFM.CPD | CPD compliance | staff on track for cycle points ÷ staff | Staff | 100 % | higher |
| WFM.RGT | Radiologist throughput | RVU-weighted reports signed per reading hour; TAT contribution; peer review score (private to RGT and RGT lead) | Shift | benchmark | higher |
| WFM.HAND | Rostering Hand fill | gaps filled by the Rostering Hand ÷ gaps detected | Gap | ≥ 60 % | higher |

### 4.9 Assets (owner: BIO)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| AST.UP | Uptime | (operating minutes − unplanned downtime) ÷ operating minutes, per modality | Asset day | ≥ 98 % | higher |
| AST.MTBF | MTBF | operating hours ÷ unplanned failures, trailing 12 months | Asset | vendor baseline | higher |
| AST.MTTR | MTTR | Median (downtime ended − downtime started) for corrective jobs | Job | ≤ 8 h | lower |
| AST.PM | Preventive maintenance on time | PM jobs completed by due date ÷ due | Job | ≥ 95 % | higher |
| AST.QA | QA compliance | QA tests completed by due ÷ due; pass rate | Test | 100 % completed | higher |
| AST.LIC | Licence expiry | licences (SAHPRA, software) expiring within 90/30 days; expired (must be 0 in use) | Licence | 0 expired | lower |
| AST.CONTRAST | Contrast stock days | on-hand contrast volume ÷ trailing 28-day daily usage, per site; expiries within 60 days | Site day | 10–30 days | band |
| AST.PRED | Predictive alarms | telemetry alarms that preceded a failure ÷ failures (recall) and alarms that led to a job ÷ alarms (precision) | Alarm | tracked | higher |
| AST.LINK | Site connectivity and edge health | link uptime, transfer backlog minutes, UPS events | Site day | backlog ≤ 15 min | lower |

### 4.10 Compliance and risk (owner: CMP)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| CMP.INC | Open incidents | open by severity and age; incidents per 1 000 studies | Incident | tracked | lower |
| CMP.CLOSE | Incident closure time | Median (closed − reported), by severity; CAPA verified on time ÷ CAPA | Incident | sev 1–2 ≤ 30 days | lower |
| CMP.POPIA | POPIA requests | received, fulfilled within statutory period ÷ received; median days | Request | 100 % in time | higher |
| CMP.BREACH | Break-glass and breach events | break-glass opens per 1 000 encounters; reviewed within 5 days ÷ opens; data breach incidents | Event | reviewed 100 % | higher |
| CMP.AUDIT | Audit findings | open findings by severity; overdue; closed ÷ raised in period | Finding | 0 overdue major | lower |
| CMP.POLICY | Policy acknowledgement | staff acknowledged current version ÷ staff in scope | Policy | 100 % within 14 days | higher |
| CMP.LIC | Licence and registration currency | modalities with valid SAHPRA licence ÷ modalities; staff with verified HPCSA ÷ clinical staff | Day | 100 % | higher |
| CMP.CHAIN | Audit chain integrity | days with verified hash chain ÷ days | Day | 100 % | higher |
| CMP.CAL | Compliance calendar | obligations due in 30 days, overdue | Obligation | 0 overdue | lower |

### 4.11 AI operations (owner: AIO)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| AIO.LAT | Inference latency | Median and P95 (finished − study available), by model version and site | Job | P95 ≤ 5 min triage, ≤ 15 min others | lower |
| AIO.COV | Coverage | studies eligible for a model that received a result ÷ eligible studies | Study | ≥ 98 % | higher |
| AIO.FAIL | Inference failure rate | failed jobs ÷ jobs, by reason | Job | ≤ 1 % | lower |
| AIO.DRIFT | Drift | distance of weekly input statistics (pixel intensity, spacing, scanner mix) and output score distribution from the validation baseline; days since last drift alarm | Model week | within band | band |
| AIO.AGREE | Agreement with signed report | CLQ.AI.AGREE and CLQ.AI.OVR by model version, with trend and control limits | Candidate | validation band | band |
| AIO.EXPIRED | Undecided candidates | candidates that expired at sign-off without a decision ÷ presented | Candidate | ≤ 2 % | lower |
| AIO.SLIP | AI slip incidents | incidents of type `ai_slip` (08 §3.18) in period | Incident | **0** | lower |
| AIO.HAND | Hand outcomes | tasks completed ÷ started, escalated ÷ started, approvals requested and approval rate, cost per task, by Hand | Task | per mandate | band |
| AIO.HAND.REV | Hand reversal rate | Hand actions rolled back or corrected by a human within 7 days ÷ actions executed | Action | ≤ 0.5 % | lower |
| AIO.VAL | Validation currency | models with a validation report younger than 12 months ÷ deployed models | Model | 100 % | higher |

### 4.12 Shareholder (owner: CFO, SHR)

| ID | KPI | Formula | Grain | Target | Direction |
|---|---|---|---|---|---|
| SHR.DP | Distributable profit | FIN.EBITDA − capex reserve − working-capital reserve − tax provision − debt service, per entity and period, per shareholder by economic % | Period | plan | higher |
| SHR.PAID | Distribution timeliness | days from period close to payment; paid ÷ declared | Distribution | ≤ 45 days; 100 % | lower |
| SHR.PLAN | KPI vs plan | actual ÷ budget for revenue, studies, EBITDA, DSO, TAT, NPS, with variance drivers | Period | ≥ 100 % | higher |
| SHR.RM | Reserved matters | open reserved-matter approvals and age | Approval | ≤ 10 days | lower |
| SHR.VAL | Value indicators | trailing 12-month EBITDA, net debt, studies, active referrers (context for valuation, not a valuation) | Period | tracked | higher |

## 5. Dashboards

Every dashboard is built from the semantic layer with the persona's lens. Tiles use `StatTile` (value, target, direction arrow, sparkline for the trailing 13 periods), charts use direct labels at the end of each series, one palette (Signal for actual, Ash for target or prior, Beam and Flare only for attention and critical states), and identical encodings in Carbon (Clinical lens) and Bone (Business and Governance lenses). AI-derived series are dashed with the model version in the label. Every tile has a "definition" affordance that opens the metric's YAML rendered in plain English, and a drill path to the rows behind the number (subject to RLS). Drill rows open the object page (06 §5.1).

| Persona | Home dashboard: tiles and charts | Drill paths |
|---|---|---|
| FDK | Today: arrivals expected vs arrived, queue (live), OPS.WAIT live, RCM.POS today, PXP.PREP for today's list, unmatched identities, consent missing | Queue → encounter; POS → Collect card; unmatched → merge case |
| BKG | Inbox by channel and age, ACC.CONV funnel (received → matched → placed → booked → arrived), ACC.TTA by modality and site, ACC.WAITCONV, ACC.HAND, ACC.AHT | Funnel stage → referrals list → referral |
| RAD | My shift: worklist by status, OPS.TIR vs expected (own, case-mix adjusted), OPS.REPEAT own vs site (private), CLQ.DRL by protocol, protocol adherence, edge/link health | Repeat → study and reason; DRL → dose record |
| RGT | Reading Room stats (§5.3) | Study, report, peer review case |
| NUR | Contrast administrations today, CLQ.EGFR, CLQ.CONTRAST, stock days, safety flags awaiting review | Flag → questionnaire; stock → lot |
| BIL | Work queue by hold reason and age, RCM.FPA, RCM.REJ by reason (bar, direct-labelled), RCM.DTB, RCM.UNBILLED, RCM.DEADLINE, RCM.AUTO, coding confidence distribution | Reason → claim lines → claim; unbilled → charges |
| DEB | RCM.DSO split, RCM.AGE (stacked bar by bucket and payer class), RCM.NCR cohort curves, RCM.POS, RCM.PLAN, RCM.DISPUTE, Collections Hand activity and reversals | Bucket → accounts → account and statement |
| PRM | Practice daily control tower (§5.2) | All |
| EXE | Group control tower (§5.1) | Practice → site → module dashboards |
| SHR | Shareholder pack (§5.4), read-only | Period → management accounts lines |
| CMP | Compliance calendar (timeline), CMP.INC by severity and age, CMP.CLOSE, CMP.POPIA, CMP.LIC, CMP.AUDIT, CMP.CHAIN, CLQ.DRL exceptions, dosimetry investigation levels | Obligation → evidence; incident → case |
| BIO | AST.UP per modality (site × modality heatmap), open maintenance jobs, AST.MTTR, AST.QA due, AST.LIC, telemetry alarms, AST.LINK, integration message failures | Modality → asset timeline |
| AIO | BCI console: AIO.LAT, AIO.COV, AIO.DRIFT control charts per model version, CLQ.AI.AGREE and OVR by body part, AIO.EXPIRED, AIO.SLIP (always shown, always 0 expected), Hand outcomes and reversals, cost | Model version → validation report; candidate decisions → studies (T1) |
| REF (Referrer Space) | Own REF.VOL trend, REF.ATTEND, REF.TAT, critical results and acknowledgements, results delivered by channel | Patient status list (own patients only) |
| PAY (Funder portal) | Claim quality for their members (RCM.FPA, RCM.REJ from their side), audit requests and response time, authorisation turnaround, appropriateness summary at T3 | Claim → line (with consent basis) |
| SUP | Tenant health: integration errors, queue backlogs, edge gateway status, API latency SLOs, feature flag state, open support cases | Tenant → integration → message |

### 5.1 Group control tower (EXE)

Layout: a top strip of eight `StatTile`s with sparklines (studies today vs same weekday plan, FIN.REV month-to-date vs budget, OPS.TAT.SLA network, ACC.TTA network median, RCM.FPA, RCM.DSO, CMP open severity 1–2 incidents, AIO.SLIP). Below: a network map of sites coloured by a single composite "attention" state (Ash normal, Beam attention, Flare critical), never by more than one variable; a `Benchmark` chart of practices on the selected KPI as a dot plot with the Group median line and case-mix-adjusted values; a `TrendChart` of revenue, studies and EBITDA margin (three small multiples rather than dual axes); a "what changed" list produced by the Insight Hand (largest variances vs plan and vs prior period with the definition and the driver decomposition). Drill: site → module dashboard → object.

### 5.2 Practice daily control tower (PRM)

Starts at 06:30 SAST and updates live. Sections: Today's plan (booked vs capacity per room, predicted no-shows highlighted in Beam, waitlist candidates ready to fill), Now (queue, wait, in-room, staff on shift vs roster, modality status), Money today (POS collected vs quoted, unbilled from yesterday, claims held), Risks (safety flags unreviewed, credential and licence expiries within 30 days, contrast stock days, edge health, load-shedding stage and UPS state), Yesterday closed (TAT SLA, repeat rate, NPS responses, complaints), Hands (tasks awaiting approval by the PRM, tasks escalated). Every risk row has an action, most of which delegate to a Hand with a leash shown inline.

### 5.3 Reading Room stats (RGT)

Personal and private by default: reports signed today and this week (RVU-weighted and raw), OPS.TAT.SEG available→signed for own reads by priority against SLA (histogram with the SLA line direct-labelled), worklist ageing by priority, CLQ.PEER own score distribution vs anonymised peer distribution, CLQ.ADD own rate, critical results raised and acknowledgement times, AI candidate decisions (accepted, edited, rejected) by model with agreement vs peers, follow-up recommendations issued and CLQ.FU. A Hub view adds pool-level queues, SLA at risk, and per-Practice reading fee accrual. Comparison with named colleagues is only visible to the RGT lead and only case-mix adjusted.

### 5.4 Shareholder pack (SHR)

Generated monthly on `period.closed.v1` as a page and a PDF: management accounts summary (revenue, costs by category, EBITDA, margin), SHR.DP waterfall from EBITDA to distributable profit to the shareholder's entitlement (a single waterfall chart with direct labels), KPI vs plan table (studies, revenue, TAT SLA, NPS, DSO, FPA) with variance and one-line driver explanations, distributions history, reserved matters open, and a glossary of every metric used. The pack is identical for all shareholders of an entity except for the entitlement lines.

### 5.5 Regulator and accreditation packs

One-click, evidence-linked packs generated by the CMP: SAHPRA Radiation Control (licence register, QA test history per unit, DRL comparisons, dosimetry summaries, incidents involving radiation), HPCSA (registration verification per practitioner, peer review programme summary, CPD status), Information Regulator and POPIA (requests and fulfilment, breach register, access audit summary, consent coverage), Council for Medical Schemes and funder audits (claims accuracy, PMB handling, appropriateness at T3), accreditation bodies (quality indicators in their template). Packs cite the metric definition version and the audit log range used.

## 6. Benchmarking

Practices differ in modality mix, case complexity, funder mix and setting. Benchmarks that ignore that are worse than none.

| Element | Method |
|---|---|
| Case-mix weights | Every procedure in the catalogue carries an RVU-equivalent weight (technical and professional components) derived from the tariff structure and adjusted annually by the clinical committee. Throughput and cost metrics are expressed per weighted study. |
| Expected values | For duration and productivity metrics, an expected value per study is computed from procedure, patient age band, contrast, inpatient status and modality model (indirect standardisation). The adjusted metric is observed ÷ expected × Group mean. |
| Peer groups | Practices are grouped by setting (community, hospital-based, mobile, hub), size band (studies per month), and modality mix cluster. A practice sees its peer group and the whole network; peer identities are shown to EXE only, anonymised (P1…Pn) to PRM and SHR. |
| Small cells | Any benchmark cell below the suppression threshold (08 §7, illustrative 10) is suppressed, and complementary suppression is applied so it cannot be recovered by subtraction. |
| Statistical honesty | Funnel plots (control limits by volume) rather than league tables for quality metrics; confidence bands drawn as a light Ash band with direct labels. |
| External benchmarks | Where an industry body or a funder publishes comparators, they are loaded as reference data with source and date and shown in Ash as a dotted line, clearly labelled as external and not case-mix adjusted unless the source says so. |

## 7. Forecasting

| Forecast | Method | Horizon and use |
|---|---|---|
| Volumes | Weekly and daily series per site and modality; seasonal decomposition with regressors for public holidays, school terms, referrer count and mix, load-shedding stage, marketing campaigns, new-site ramp curves. Prediction intervals shown as a band; the point forecast is dashed (it is model-derived and carries provenance). | 13 weeks for rostering and stock; 12 months for budget |
| Revenue | Volume forecast × expected revenue per weighted study by payer class, with tariff and contract changes applied on their effective dates | Monthly budget and re-forecast |
| Cash | Collections curves by payer class from RCM.NCR cohorts (share collected at 7, 30, 60, 90, 180 days) applied to billed and forecast revenue; outflows from payroll, intercompany, leases, capex plan | 13-week cash forecast per entity |
| No-show | Per-appointment probability (lead time, channel, prior history, day and hour, weather season, funder class) used by M05 for overbooking within a leash and by BKG for reminders | Live |
| Demand for capacity | Forecast volumes vs capacity per modality; weeks in which ACC.TTA is projected to breach target | Capital planning |

Forecast accuracy (MAPE by series) is itself a metric on the AIO and EXE dashboards, and every forecast keeps the model version, features and training window in `ai_provenance`.

## 8. What-if scenarios

Scenarios are saved objects with inputs, assumptions and outputs, run by the Insight Hand against the semantic layer, and are never written back to the ledgers.

| Scenario | Inputs | Outputs |
|---|---|---|
| New modality at a site | Capital cost, lease terms, staffing, expected volumes (from waitlist, referrer demand, ACC.TTA breaches and peer-group utilisation), tariff and payer mix | Incremental studies, revenue, contribution margin, payback, effect on ACC.TTA and OPS.UTIL, licence and QA obligations |
| New site | Catchment (referrer density, competitor presence entered by EXE), modality set, ramp curve from comparable openings | 36-month P&L, cash, break-even month, staffing plan |
| Contract change | A funder's proposed tariff, DSP status or rule pack change | Revenue effect by tariff code, expected RCM.REJ change from the rule diff, patient liability effect, PMB exposure |
| Roster and hours | Extended hours, weekend clinics, hub reading share | Utilisation, TAT, overtime, cost |
| Tariff and cash price | Cash price list changes | Volume elasticity estimate (labelled as an assumption), revenue |
| Acquisition | Target practice data (imported at T1) mapped onto Group definitions | Pro-forma KPIs, synergy assumptions, integration checklist |

## 9. Alerting

Alerts are metric conditions evaluated at the metric's freshness tier; each alert names an owner persona, a Hand that may act, and a route (in-app queue, WhatsApp, SMS, email, on-call). Thresholds are per Practice reference data. Anomaly detection uses the forecast band: a value outside the 95 % interval for two consecutive periods raises an anomaly alert, with the definition and the band shown.

| Alert | Condition (illustrative) | Owner | Hand action |
|---|---|---|---|
| Critical result unacknowledged | 30 min since raised | RGT, PRM | Critical Result Hand escalates per policy |
| TAT SLA at risk | Study within 20 % of SLA and unassigned | RGT lead, Hub | Reading Hand reassigns within pool |
| Utilisation gap | Predicted fill rate tomorrow < 70 % | PRM, BKG | Booking Hand offers waitlist slots |
| No-show risk | Predicted no-shows > 3 in a session | FDK | Attendance Hand sends confirmations, offers reschedule |
| Rejection spike | RCM.REJ for a funder > 2 × trailing 8-week mean | BIL | Rejection Hand classifies, pauses submission for that rule if systematic |
| Unbilled ageing | RCM.UNBILLED > threshold or any charge > 5 days | BIL | Coding Hand retries; lists blockers |
| Resubmission deadline | Rejected value within 30 days of deadline | BIL lead | Rejection Hand prioritises |
| Cash | Collections week-to-date < 85 % of forecast | CFO, DEB | Collections Hand reviews stage transitions |
| Licence or credential | Expiry within 30 days; any expired in use | CMP, BIO, PRM | Renewal task created; scheduling blocked |
| QA overdue or failed | Any | BIO, RPO | Maintenance job opened; slots blocked |
| Dose | Study > 2 × DRL or protocol median > DRL for 4 weeks | RPO, RGT lead | Protocol review task |
| Contrast stock | Days cover < 10 | PRM | Procurement Hand raises order within leash |
| Modality down | Telemetry or MPPS silence during operating hours > 15 min | BIO, PRM | Maintenance Hand opens job; Booking Hand moves patients |
| Edge backlog | Transfer backlog > 15 min or UPS on battery | BIO, SUP | Support case |
| AI latency or coverage | P95 latency or coverage outside target for 1 hour | AIO | Inference queue scaled; fallback to no-priority worklist with banner |
| Drift | Weekly drift statistic outside band | AIO | Model version flagged for review; candidates still shown with provenance |
| AI slip | Any incident of type `ai_slip` | AIO, CMP, EXE | Immediate, no batching |
| Hand reversal | AIO.HAND.REV > 1 % for a Hand over 7 days | AIO | Hand paused pending review |
| Data quality | Any §10 check fails | SUP, data owner | Ingest paused for the affected model |

## 10. Data quality monitoring

| Check | Rule | Action on failure |
|---|---|---|
| Event completeness | Events in landing = events in outbox per hour per practice | Re-publish from outbox; alert SUP |
| Referential integrity | Every fact key resolves to a dimension | Quarantine rows; alert data owner |
| Timeliness | Landing lag per stream within tier | Alert; dashboards show "stale since" banner |
| Reconciliation to source | Daily: studies in warehouse = studies in M09; billed = charges in M14; journal totals = M15; balances = patient accounts | Block mart refresh; alert CFO or PRM |
| Definition drift | Metric result for a frozen test dataset matches the stored expected value after every deploy | Block deploy |
| Duplicates and merges | Merged patients re-pointed in facts within 1 hour | Re-run merge projection |
| Null and range | Durations non-negative and under caps; money within plausible bounds; dose within physical bounds | Quarantine with reason |
| Small-cell compliance | No T3 output cell below threshold | Suppress; alert CMP |

Data quality results are themselves shown on the SUP and CMP dashboards, and every dashboard carries a freshness stamp and a data-quality state for the marts it uses.

## 11. Self-service: the Insight Hand

The Insight Hand answers natural-language questions over the semantic layer for any persona, within their row-level security scope.

1. The user asks in the command palette or on any dashboard ("Why was CT TAT worse at Umhlanga last week?", "Which referrers dropped more than 30 % this month?", "Show my no-show rate by weekday").
2. The Hand maps the question to metrics, dimensions and filters from the semantic layer only; it cannot write ad hoc SQL against raw tables. Ambiguity is resolved by asking one clarifying question with options.
3. The query runs under the user's identity; RLS and de-identification tier apply exactly as for dashboards.
4. The answer always shows: the chart or table, the metric definition(s) used with version, the filters applied, the freshness, and the row count; if any cell was suppressed, it says so. Narrative text is drawn in the annotated style with provenance.
5. Follow-up actions are offered as links to the owning module (open the claims list, create a scenario, set an alert), never executed silently.
6. Every question and answer is logged to `agent_task` for AIO review; questions that could not be answered from the semantic layer become candidate metric requests in the definitions backlog.

The Hand runs at A3 for reading (mandate: semantic layer queries only, no exports above 10 000 rows, no T0 data outside the user's tenant) and never at A4 for anything that leaves the Platform.

## 12. Exports and scheduled reports

| Capability | Rule |
|---|---|
| Ad hoc export | CSV and XLSX from any table view within RLS; exports of identified data are audited as `export` with purpose; exports over 10 000 rows require PRM or CMP approval; every file carries the metric definition versions and a watermark with user and time |
| Scheduled reports | Any dashboard or Insight Hand answer can be scheduled (daily 07:00, weekly Monday, monthly on period close) to in-app, email or WhatsApp (summary only, link to the page); recipients must hold the scope |
| Packs | Shareholder, regulator and management packs (§5.4, §5.5) as page plus PDF; versions immutable and stored as `file` with retention class RC-FIN or RC-AUDIT |
| API | The semantic layer is exposed as a read API (metrics, dimensions, query) for approved integrations such as a funder's audit portal or a Group BI tool, with the same RLS and definitions |
| Accounting and payroll | Journal exports (M15) and time exports (M17) are integrations, not analytics exports, and are reconciled back |

## 13. Data governance

| Area | Rule |
|---|---|
| Ownership | Every metric has an owner persona (dictionary) and a named steward per Practice; every fact table has a data owner module |
| Definition change control | Changes to a metric formula create a new version with an effective date; dashboards show the version; historical values are recomputed and both series are available for 12 months; changes to targets are Practice-level configuration and do not version the definition; changes are approved by the owner and announced in the release notes |
| Definitions backlog | Requests from the Insight Hand, PRM and EXE are triaged monthly by the analytics steward group (owner personas plus CMP) |
| Privacy in analytics | Tenant dashboards run at T0 within scope; Group and MSO views at T1 by default; benchmarks shared across practices at T3 with small-cell suppression; AI training sets at T2 with consent ids; no individual staff productivity is shown to anyone but the person and their direct lead, and never in benchmarks |
| Retention | Marts follow the retention class of their source facts; aggregates at T3 may be kept indefinitely |
| Access review | Quarterly review of role assignments with analytics scope; export logs reviewed monthly by CMP |
| Demo data | Demo tenants use synthetic data labelled DEMO in every chart title and export |

## 14. Requirements

* M16-R-100 Every KPI shown on any surface MUST be computed from the semantic layer definition and MUST expose its definition, version, filters and freshness on demand.
* M16-R-101 The Platform MUST enforce row-level security and de-identification tier in the semantic layer so that dashboards, the Insight Hand, exports and the API cannot bypass it.
* M16-R-102 Productivity and throughput metrics MUST be presented with case-mix adjustment and the adjustment method, and individual staff comparisons MUST be restricted to the individual and their direct lead.
* M16-R-103 Shared benchmarks MUST apply small-cell suppression with complementary suppression, and MUST anonymise peer identities except to EXE.
* M16-R-104 Forecasts and anomaly bands MUST carry provenance (model version, features, training window) and MUST be drawn in the annotated style.
* M16-R-105 The Insight Hand MUST only query the semantic layer, MUST show the definitions used in every answer, and MUST NOT execute actions in other modules.
* M16-R-106 AIO.SLIP MUST be present on the Group control tower, the AIO console and the shareholder pack at all times, with a target of zero, and any non-zero value MUST link to the incident.
* M16-R-107 Metric definition changes MUST be versioned with recomputed history, and the previous version MUST remain queryable for 12 months.
* M16-R-108 Every dashboard MUST render correctly in both Carbon and Bone surfaces with identical encodings, MUST use direct labels, and MUST pass the `dataviz` palette validator in CI.
* M16-R-109 The demo deployment MUST run the same metric definitions on D1 and Analytics Engine as the internal deployment runs on Postgres and ClickHouse, verified by the frozen-dataset test in §10.
