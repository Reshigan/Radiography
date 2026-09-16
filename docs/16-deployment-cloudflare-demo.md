# 16 — Deployment: Cloudflare Public Demo

## 1. Purpose and scope

The Cloudflare demo is the public, always-on instance of the Bonakala Platform. It exists for three
reasons:

1. **Sales demo.** A prospective Practice, hospital group, funder or JV partner can walk every persona
   surface with realistic synthetic data in a browser, on a phone, on WhatsApp, without a VPN or a
   laptop being couriered to them.
2. **Design validation.** The BDL "Latent Image" language, the Window/Level control and the persona
   lenses are validated with real users (radiographers, billing clerks, receptionists) on a live
   system before internal go-live. Product analytics on the demo feed the design backlog.
3. **Partner sandbox.** Integrators (claims switches, practice-management vendors, AI model vendors,
   funders) get their own demo tenant and API keys to build against the Platform's public contracts
   (FHIR R4, DICOMweb, webhook events, the `bci.result.v1` adapter contract) with no risk to patients.

The demo is the product (07 §1): the same `apps/web`, `apps/api`, `apps/agents` and `apps/whatsapp`
code runs on Cloudflare and on Docker. Only the adapters in `packages/adapters-cloudflare` and the
external systems differ. External systems on the demo are **all simulated** by `apps/sim`.

Three rules are absolute and are enforced technically, not by policy alone:

| Rule | Enforcement |
|---|---|
| **No PHI, ever.** No real patient, referrer, staff or funder data is loaded, entered or accepted by the demo. | Synthetic-only seed pipeline; WAF rule blocks inbound DICOM-like and HL7-like payloads; upload endpoints accept only demo-signed fixtures; every text field runs a "looks like a real SA ID number and is not in the synthetic register" guard (M03) and rejects with a visible "DEMO: synthetic data only" message. |
| **Everything is labelled DEMO.** | A persistent Beam-coloured `Banner` ("DEMO. Synthetic data. Not for clinical use.") on every surface, every PDF report footer, every WhatsApp message header, every API response header (`X-Bonakala-Environment: demo`). |
| **Nothing leaves the sandbox.** | No real claims switch, no real payment gateway, no real DICOM network, no real SMS. All outbound adapters point at `apps/sim`. Egress from Workers is allow-listed to Cloudflare services, the LLM Gateway and the WhatsApp Cloud API test number. |

### 1.1 Requirements (M21 Platform Core, demo profile)

* M21-R-100 The demo deployment MUST run the identical domain packages (`packages/domain`,
  `packages/billing-rules`, `packages/dicom`, `packages/hl7-fhir`, `packages/ai-contracts`) as the
  internal deployment with no demo-specific branches in business logic. Differences MUST live in
  adapters and feature flags only.
* M21-R-101 The demo MUST NOT store, accept or transmit any personal information of a real natural
  person. All seed data MUST come from the synthetic generator in `apps/sim` and MUST carry the
  `synthetic = true` marker at row level.
* M21-R-102 Every demo surface, document and message MUST carry the DEMO label described above.
* M21-R-103 Any demo tenant MUST be resettable to its seed state in under 2 minutes without affecting
  other demo tenants.
* M21-R-104 A partner sandbox tenant MUST be provisionable by SUP in under 10 minutes end to end,
  including seed data, personas, API keys and a WhatsApp test number binding.
* M21-R-105 The demo SHOULD run at automation level A3 for all Hands that are A3 in production and
  MUST surface every Hand action in the audit stream so a visitor can inspect provenance.

## 2. Service map

| Platform concern | Cloudflare service | Bound to | Notes |
|---|---|---|---|
| Web app (all persona surfaces, PWA) | **Pages** | `apps/web` | Static build; `_headers` for CSP; Pages Functions not used (all API in Workers) |
| API (Hono, M01–M21) | **Workers** | `apps/api` | One Worker, route `api.demo.<domain>/*`; Smart Placement off (D1 is regional) |
| Agent Runtime (Hands, M20) | **Workers** + **Queues** consumers | `apps/agents` | Claude API via LLM Gateway; long tasks checkpoint to D1 |
| WhatsApp conversation engine | **Workers** | `apps/whatsapp` | Cloud API webhook; test business number only |
| Simulators (modalities, switch, funders, PSP, bank) | **Workers** + **Cron Triggers** | `apps/sim` | Scripted responses; deterministic seeds per tenant |
| Relational data (system of record) | **D1** | one database per demo tenant group | SQLite mirror of the Drizzle Postgres schema; FTS5 for search |
| Imaging and documents | **R2** | `bonakala-demo-imaging`, `bonakala-demo-documents` | Synthetic DICOM (Part 10), rendered frames, PDFs; lifecycle rules |
| Async jobs, outbox, inference, claims | **Queues** | `events`, `inference`, `claims`, `notifications`, `agents` | Dead-letter queues per topic |
| Sessions, feature flags, rate limits, reference data cache | **KV** | `SESSIONS`, `FLAGS`, `REFDATA` | Tariff and scheme rule packs cached from D1 |
| Slot holds, worklist claims, per-study locks | **Durable Objects** | `SlotHold`, `WorklistLock`, `TenantCounter` | Strongly consistent per object; alarms for hold expiry |
| Patient / study / claim search, semantic priors | **Vectorize** + D1 FTS5 | `bonakala-demo-search` | Embeddings of report text and order text for "similar prior" and referrer search |
| Demo inference (QC, triage priority, OCR of referral photos) | **Workers AI** | `AI` binding | Only where a suitable model exists; outputs labelled DEMO and class-limited (12) |
| LLM for Hands, drafting, extraction | **Claude API via LLM Gateway** (AI Gateway) | secret `LLM_GATEWAY_URL`, `ANTHROPIC_API_KEY` | Caching, rate limiting, logging without PHI (there is none) |
| Scheduled Hands and jobs | **Cron Triggers** | `apps/api`, `apps/agents`, `apps/sim` | Reminders, claims runs, dunning, month-end, modality simulation |
| Staff persona sign-in | **Cloudflare Access** | `*.demo.<domain>` except patient and referrer paths | One-time PIN or IdP; persona chosen post-login |
| Patient and referrer surfaces (public) | **Turnstile** | Patient Space, Referrer Space, booking widget | Bot protection without CAPTCHA friction |
| Thumbnails, key images, report images | **Images** | transform URLs | Renders JPEG/WebP from R2 PNG frames for referrer/patient views |
| Product and demo analytics | **Analytics Engine** | `ANALYTICS` binding | Per-tenant, per-persona funnels; no personal data |
| Logs | **Logpush** + **Tail Workers** | `apps/observability-tail` | Structured logs to an R2 bucket and optional external sink |
| Postgres alternative | **Hyperdrive** (optional) | `HYPERDRIVE` binding | For a partner sandbox that insists on Postgres semantics; not the default |
| DNS, TLS, WAF, rate limiting | Cloudflare zone | `demo.<domain>` | Managed rules + custom rules (see §12) |

### 2.1 What runs where (request path)

1. Browser loads `apps/web` from Pages. Staff paths are behind Access; the Access JWT is verified by
   the API Worker on every request (`CF-Access-Jwt-Assertion`).
2. The web app calls `apps/api` (Hono). The API resolves the tenant from the hostname or the
   `X-Bonakala-Tenant` header, opens the matching D1 binding (tenant group), enforces the application
   tenancy guard (`practice_id` on every query), and runs the domain command.
3. State changes write to the outbox table in the same D1 transaction, then a Queue producer drains
   the outbox (at-least-once; consumers idempotent by event id).
4. Consumers (projections, agents, sim, notifications) run as Queue consumers in their own Workers.
5. Coordination that must be strongly consistent (a slot hold for 10 minutes, a radiologist
   claiming a study) goes through a Durable Object keyed by the entity id.

## 3. Environments

| Environment | Purpose | Trigger | Data | URL |
|---|---|---|---|---|
| **preview** | One per pull request | PR opened / updated | Ephemeral D1 seeded from the "small" fixture (1 practice, 2 sites, 200 patients, 400 studies) | `pr-<n>.preview.demo.<domain>` |
| **staging** | Integration and release candidate | Merge to `main` | Persistent, reset nightly from "medium" fixture | `staging.demo.<domain>` |
| **demo** | Public demo and partner sandboxes | Tag `demo-vX.Y.Z` or manual promotion from staging | Persistent per tenant; reset on request | `demo.<domain>`, `<partner>.demo.<domain>` |

Preview environments use Wrangler's `--env preview` with `name` suffixed by the PR number and D1
databases created on demand by the workflow (deleted when the PR closes). Pages builds previews
natively per branch; the preview web build receives `VITE_API_BASE` pointing at the matching API
Worker.

## 4. Wrangler configuration outline

The reference skeleton is `infra/cloudflare/wrangler.toml`. Structure:

* One `wrangler.toml` per Worker app (`apps/api`, `apps/agents`, `apps/whatsapp`, `apps/sim`). The
  infra folder holds the API Worker's file as the canonical example; the others follow the same
  pattern with fewer bindings.
* Top-level (default) section is the **preview** shape; `[env.staging]` and `[env.demo]` override
  names, routes, and binding ids.
* Bindings on the API Worker: `DB_*` (D1 per tenant group), `IMAGING` and `DOCUMENTS` (R2),
  `SESSIONS`, `FLAGS`, `REFDATA` (KV), `EVENTS`, `INFERENCE`, `CLAIMS`, `NOTIFICATIONS`, `AGENTS`
  (Queues, producers), `SLOT_HOLD`, `WORKLIST_LOCK`, `TENANT_COUNTER` (Durable Objects), `AI`
  (Workers AI), `SEARCH` (Vectorize), `ANALYTICS` (Analytics Engine), optional `HYDRA` (Hyperdrive),
  and `SIM` (a service binding to the simulator Worker so the API never leaves the account to reach
  a "switch").
* Secrets are never in the file. They are set with `wrangler secret put` per environment and listed by
  name in a comment block: `ANTHROPIC_API_KEY`, `LLM_GATEWAY_URL`, `WHATSAPP_TOKEN`,
  `WHATSAPP_VERIFY_TOKEN`, `ACCESS_AUD`, `SESSION_SIGNING_KEY`, `SIM_WEBHOOK_SECRET`,
  `TURNSTILE_SECRET`.
* Routes: `api.demo.<domain>/*` for demo; `api.staging.demo.<domain>/*` for staging; preview uses
  `workers.dev` subdomains with the PR number.
* Cron Triggers on the API Worker: every 5 minutes (reminder dispatch, hold expiry sweep), hourly
  (claims run at A3, dunning), daily 02:00 SAST (retention, analytics roll-up), monthly 1st 03:00 SAST
  (month-end close proposal). Times are written in UTC in the file (SAST = UTC+2, no DST).
* `compatibility_date` pinned; `nodejs_compat` flag on for the Hono Node server shim and for
  libraries in `packages/dicom` that use `Buffer`.
* `[observability] enabled = true` for Workers Logs; Logpush configured at zone level (§9).

Migrations for Durable Object classes are declared in `[[migrations]]` and are append-only.

## 5. D1 migration strategy (Drizzle SQLite mirror)

`packages/db` owns one Drizzle schema written for Postgres. A build step generates the SQLite mirror:

1. `pnpm db:generate` produces Postgres migrations (`packages/db/migrations/pg/*.sql`) from the
   schema, as normal.
2. `pnpm db:mirror` walks the same Drizzle schema through a type map (`uuid` to `text`, `timestamptz`
   to `text` ISO-8601 UTC, `numeric(14,2)` to `integer` cents, `jsonb` to `text` with JSON check,
   `pgvector` columns dropped in favour of Vectorize ids, `enum` to `text` with CHECK) and emits
   `packages/db/migrations/d1/NNNN_<name>.sql`.
3. Row-level security has no SQLite equivalent; the mirror adds a `practice_id` column index on every
   tenant table and the API applies the tenancy guard in the query builder (a Drizzle wrapper that
   refuses to run a tenant-scoped query without a `practice_id` predicate).
4. FTS5 virtual tables (`patient_fts`, `study_fts`, `claim_fts`) are added in the mirror only, with
   triggers that keep them in sync.
5. Migrations are applied with `wrangler d1 migrations apply <db> --env <env>` in CI for every tenant
   group database listed in `infra/cloudflare/tenants.json`. A migration that fails on any database
   stops the deploy.
6. Both migration sets are tested in CI: Postgres in a service container, D1 via `wrangler d1 execute
   --local` (Miniflare). A schema diff test asserts that every table and column in the Postgres
   schema exists in the mirror or is on an explicit allow-list of intentional omissions.

Money is stored as integer cents in both targets to avoid floating-point divergence; the `Money`
component and the tariff engine work in cents.

## 6. Data seeding (synthetic South African data)

The seed pipeline lives in `apps/sim/seed` and is deterministic: the same `(tenant, seed)` pair
always produces the same data set, which makes demo scripts repeatable and screenshots stable.

### 6.1 People

* **Names** are generated from curated first-name and surname lists across South African language
  groups (isiZulu, isiXhosa, Afrikaans, English, Sesotho, Setswana, Sepedi, Xitsonga, siSwati,
  Tshivenda, isiNdebele, and common Indian South African and other names), combined randomly so
  that no generated full name is copied from a real person list. Lists are authored in-house.
* **SA ID numbers** follow the 13-digit format (YYMMDD SSSS C A Z) with a valid Luhn check digit so
  that ID validation in M03 passes, but every generated number is drawn from a reserved synthetic
  range recorded in `synthetic_id_register` and displayed with a "synthetic" tag in the `Id`
  component. The M03 guard rejects any entered ID that is not in the register. Passports and
  asylum documents are generated similarly for non-citizen patients.
* **Addresses** use real provinces and municipalities, real suburb names, and fabricated street
  numbers and street names; GPS points are jittered inside the suburb polygon.
* **Contact details** use the reserved 0600 000 000 to 0600 999 999 style ranges that the WhatsApp
  and SMS simulators treat as internal; email addresses use `@example.demo`.
* **Scheme membership**: demo funders (§6.4) with fabricated membership numbers, plan names that
  resemble real market structures (hospital plan, comprehensive, network plan) without copying a real
  scheme's product names, dependant codes, and benefit balances that change through the demo year.
* **Staff**: one persona set per demo tenant (PAT, REF, FDK, BKG, RAD, RGT, NUR, BIL, DEB, PRM, EXE,
  SHR, CMP, BIO, AIO, PAY, SUP) with fabricated HPCSA and practice numbers in a format-valid but
  reserved range (illustrative; stored as reference data).

### 6.2 Studies and images

* Synthetic DICOM studies are produced by `apps/sim/dicom` in two ways:
  1. **Procedural phantoms**: programmatically rendered images (chest, extremity, skull, abdomen,
     mammography-like textures, CT slice stacks, MR-like contrast series, ultrasound-like speckle) that
     look plausible at thumbnail and viewer scale, carry correct DICOM headers (modality, body part,
     SOP classes, series structure, pixel spacing, window presets) and are obviously synthetic on
     close inspection. No real anatomy, no derived data from any patient.
  2. **Public-domain phantom images** (physical test phantoms, calibration objects) where a licence
     permits, recorded in `apps/sim/dicom/SOURCES.md` with licence and provenance.
* Each study includes a Dose Structured Report (CT, DX) so M10 dashboards populate, and an MPPS
  timeline so M08 analytics work.
* Studies are written to R2 as Part 10 files plus a rendered PNG per frame for the viewer's fast path
  and for `Images` transforms.
* The "demo inference" pipeline attaches `bci.result.v1` payloads generated by deterministic demo
  models (rule-based positioning/exposure QC, a scripted triage priority for the STAT scenarios) and,
  where a Workers AI model is suitable (image classification of phantom type, OCR of referral form
  photos), from Workers AI. All results carry `model_id = demo.*`, a version, a confidence, and the
  DEMO output class; the `Provenance` chip shows it.

### 6.3 Simulated modalities

`apps/sim/modalities` runs on a Cron Trigger every 5 minutes during the demo tenant's configured
"opening hours" (SAST) and emulates a site's rooms: it queries the tenant's worklist (MWL semantics
over the API), "performs" studies that are due, emits MPPS in-progress and completed events, and
stores images to R2 via the ingest API with realistic timing (DX 3 minutes, CT 12 minutes, MR 30
minutes, US 20 minutes, illustrative). A configurable fraction of studies are late, repeated, or
mismatched to exercise exception queues. Load-shedding blocks and a "gateway offline" period can be
scripted so that store-and-forward backlogs appear on the BIO dashboards.

### 6.4 Demo funders and the simulated claims switch

* **Funders**: six fabricated schemes (`Ithemba Health`, `Sable Medical`, `Karoo Med`, `Ubuntu
  Care`, `Protea Fund`, `Highveld Health`, all fictitious), plus simulated RAF, Compensation Fund
  (COIDA) and a mine-worker (ODMWA) funder, and cash. Each has a rule pack in `packages/billing-rules`
  covering tariff acceptance, modifiers, PMB handling, pre-authorisation requirements, and network
  (DSP) status. Real scheme names may be shown as *examples* in the funder list UI but are never
  attached to demo claims.
* **Claims switch simulator**: implements the switch adapter port (14) with scripted responses:
  accepted, rejected with reason codes drawn from a realistic taxonomy (invalid ICD-10, member not
  found, benefit exhausted, missing authorisation, tariff not covered, duplicate), partial payment,
  delayed remittance, and a "switch down" window. Response mix is configurable per tenant and per
  scenario (the rejection wave scenario sets it to 35 % rejections for one hour).
* **Remittances**: the simulator produces ERA files and bank statement lines so M14 remittance
  matching and M15 cash reconciliation are demonstrable.

## 7. Demo scenarios and scripts

Each scenario is a guided tour available from the demo home page and as a scripted document for a
presenter. Scenarios run against the `demo-main` tenant and can be reset individually. Each has a
"start" button that fast-forwards seed time to the scenario's starting state.

| Scenario | Personas | What the visitor sees | Automation shown |
|---|---|---|---|
| **The 09:40 patient** | PAT, BKG, FDK, RAD, RGT, REF | A referral arrives on WhatsApp as a photo of a paper form; the Referral Hand extracts the order (A3), the Booking Hand offers 09:40 at the nearest site, a quote is produced with a scheme benefit check, the patient pre-checks in, the technologist sees the worklist populate, QC feedback appears, the radiologist signs a drafted report, the referrer and patient get results. Total elapsed demo time: 8 minutes. | Referral extraction A3, booking A3, quote A2, QC A2, report drafting A1 |
| **The STAT head CT** | REF, RAD, RGT, NUR | A casualty referral marked STAT; contrast safety checks; triage priority raised by a demo model; the Reading Room shows the study at the top with the annotated overlay; radiologist signs; the Critical Findings Hand phones the referrer (simulated call transcript) and secures acknowledgement; the 5.5 banner is shown and then cleared. | Triage A1 (radiologist signs), critical results A3 |
| **The rejection wave** | BIL, DEB, PRM | The switch simulator returns a burst of rejections for one scheme. The Rejection Hand classifies the reasons, auto-fixes the fixable (A3, within leash: no amount change, only code corrections it is confident in), resubmits, and escalates the rest to BIL with suggested fixes. PRM sees first-pass acceptance recover on the control tower. | Rejection handling A3, exceptions A1 |
| **Month-end in 4 minutes** | BIL, EXE, SHR, PRM | Close the period: unbilled backlog cleared, intercompany fees computed, management accounts proposed, distributable profit and shareholder entitlements computed for a 51/49 JV, a distribution proposed for approval, shareholder statements generated. | Month-end A2, distributions A1 |
| **Onboarding a practice** | EXE, SUP, CMP | The practice onboarding wizard (03 §5): legal entity, BHF practice number, HPCSA principals, SAHPRA licences, sites, rooms, modalities, fee schedules, DSP contracts, users. Ends with a "site operational" checklist and a fresh tenant. | Guided A1 with a Hand pre-filling from uploaded documents |

Supporting mini-tours (3 minutes each): "Window/Level the interface", "A Hand explains itself" (open
any agent task and read the mandate, leash, tools and audit), "Load-shedding at Umhlanga" (edge
gateway offline, imaging continues, backlog drains), "The funder portal" (PAY persona).

## 8. Demo reset and multi-tenant sandbox provisioning

### 8.1 Reset

`POST /admin/tenants/:id/reset` (SUP only, Access-protected, also a button on the Support console):

1. Mark the tenant `resetting` in the `TenantCounter` Durable Object (rejects new writes).
2. Drop and recreate the tenant's tables in its D1 database (the database is shared by a tenant group,
   so the reset is per `practice_id`, executed as batched deletes in dependency order).
3. Delete R2 objects under `tenants/<id>/` (listing with prefix, batched deletes).
4. Purge KV keys under `t:<id>:` and Vectorize vectors with metadata filter `tenant = id`.
5. Re-seed from the tenant's recorded `(fixture, seed)` pair.
6. Clear the resetting flag; emit `tenant.reset.v1`.

Target: under 2 minutes for the "medium" fixture (M21-R-103). The public `demo-main` tenant resets
automatically every night at 02:30 SAST and on demand by presenters.

### 8.2 Partner sandbox

`POST /admin/tenants` with `{ partner, fixture, seed, personas, integrations }`:

1. Allocate the tenant to a D1 tenant group with capacity (each group holds up to 20 demo tenants;
   groups are created ahead of time by CI from `tenants.json`).
2. Create the hostname `<partner>.demo.<domain>` (Cloudflare for SaaS custom hostname or a wildcard
   route) and an Access policy group for the partner's email domain.
3. Seed data; create persona accounts; issue API keys scoped to the tenant; register partner webhook
   endpoints; optionally bind a WhatsApp test number.
4. Write a sandbox welcome page with credentials, scenario links and the FHIR/DICOMweb base URLs.
5. Sandboxes expire after 60 days by default and are deleted with the same reset routine.

Partners can point their own integration at the simulated switch or expose a simulated switch of their
own by implementing the port; the `SIM` service binding is configurable per tenant.

## 9. Observability

* **Workers Logs** enabled on every Worker; structured JSON with `tenant`, `request_id`, `trace_id`,
  `persona`, `module`, never a name or identifier (there is none, but the log schema is the same as
  production so the discipline holds).
* **Logpush** at zone level to an R2 bucket (`bonakala-demo-logs`, 30-day lifecycle) with optional
  push to an external log sink for the platform team.
* **Tail Worker** (`apps/observability-tail`) computes per-module SLO counters (worklist P95, sign-off
  latency, queue lag) and writes them to Analytics Engine; a Grafana-compatible SQL API query feeds
  the SUP dashboard.
* **Queues** metrics (backlog, retries, DLQ depth) alert via a Cron-triggered checker that posts to the
  team channel.
* **Synthetic checks**: an external uptime probe hits `/healthz` and runs the "09:40 patient" API
  script hourly; failures page SUP.
* **AI Gateway** logs every Claude API call (tokens, latency, cache hits, cost) per Hand and per tenant.

## 10. Cost estimate model

All figures are order-of-magnitude **estimates** for planning, not quotes; Cloudflare pricing changes
and is stored as configurable reference data in the cost model sheet (`packages/analytics`). ZAR
values assume an illustrative rate of R18 per USD.

| Component | Driver (demo scale: 5 tenants, 50 000 studies, 200 000 requests/day) | USD / month (est.) | ZAR / month (est.) |
|---|---|---|---|
| Workers Paid plan (API, agents, whatsapp, sim, tail) | Base plan + ~6 M requests, CPU time | 5 to 30 | 90 to 540 |
| Pages | Static, within free/pro limits | 0 to 20 | 0 to 360 |
| D1 | ~2 GB storage, ~50 M rows read, ~5 M rows written | 5 to 25 | 90 to 450 |
| R2 | ~200 GB synthetic imaging and documents, Class A/B ops; no egress fees | 5 to 15 | 90 to 270 |
| Queues | ~10 M operations | 5 to 10 | 90 to 180 |
| KV | Small | 0 to 5 | 0 to 90 |
| Durable Objects | ~1 M requests, small storage | 1 to 10 | 20 to 180 |
| Vectorize | ~1 M vectors, moderate queries | 1 to 10 | 20 to 180 |
| Workers AI | ~50 000 small inferences | 5 to 20 | 90 to 360 |
| Claude API via gateway (Hands) | ~2 000 Hand runs/day, mostly `claude-sonnet-5` and `claude-haiku-4-5`, cached prompts | 100 to 400 | 1 800 to 7 200 |
| Cloudflare Access | Up to 50 staff seats (often within free tier) | 0 to 150 | 0 to 2 700 |
| Images | Transformations for thumbnails | 5 to 10 | 90 to 180 |
| Logpush / Analytics Engine | Within plan | 0 to 10 | 0 to 180 |
| WhatsApp Cloud API (test number) | Test traffic | 0 to 20 | 0 to 360 |
| Domain, DNS, TLS, WAF | Zone plan | 20 to 200 | 360 to 3 600 |
| **Total** | | **~150 to 900** | **~2 700 to 16 000** |

The dominant variable cost is LLM usage by Hands. The demo caps each tenant's Hand budget per day
(a leash on the runtime, M20) so a partner cannot run up the bill; the cap is visible on the SUP
console. Partner sandboxes beyond five are charged back to the partner programme at an estimated
R1 500 to R3 000 per tenant per month, mostly LLM.

## 11. Limits: what the demo intentionally does not do

| Not on the demo | Why | Internal deployment instead |
|---|---|---|
| Real DICOM network (C-STORE, C-FIND, MWL over DIMSE) | Workers have no raw TCP listeners; no modality is ever pointed at the public internet | Orthanc at the Edge Gateway and central archive (17 §3) |
| Real HL7 v2 over MLLP | Same; also no hospital would send ADT to a demo | Integration bus with MLLP listeners at the central cluster or Edge Gateway |
| Real claims switch | Contracts, certification and PHI | Switch adapters certified per switch (14) |
| Real payments | PSP onboarding requires a real merchant; demo shows simulated PayShap, card and EFT flows with a sandbox PSP where available | Live PSP adapter |
| Real SMS and email to arbitrary numbers | Abuse and cost | SA SMS aggregator and transactional email |
| Vendor AI models (SAHPRA-registered) | Licensing and hardware; the demo uses deterministic demo models and Workers AI | Python inference service on GPU with vendor containers via the BCI adapter |
| Diagnostic-quality viewer performance on large CT/MR | R2-backed WADO-RS subset serves synthetic studies of modest size | Orthanc DICOMweb with full progressive loading |
| Postgres row-level security, pg_partman, pgvector | D1 has an application guard instead | Postgres 16 with RLS and partitioning |
| Identified data residency guarantees | No identified data exists | SA data centre or private cloud |
| Keycloak SSO with an organisation's IdP | Access handles staff sign-in | Keycloak federated to the Practice's IdP |

The demo does implement the full event model, the full agent runtime, all persona surfaces, all billing
rules, dose dashboards, analytics and the shareholder portal, so a visitor experiences the whole
product, not a subset.

## 12. Security posture

* **No PHI** (§1). The Information Officer of the MSO signs off the demo as processing no personal
  information; the demo privacy notice says so and describes the product analytics collected.
* **Cloudflare Access** on all staff surfaces and on the API paths they call. Policies: `bonakala-staff`
  (company email domain, MFA enforced by the IdP), `partner-<name>` (partner domain, limited to their
  hostname), `presenter` (short-lived service tokens for trade-show kiosks). Access logs feed Logpush.
* **Turnstile** on patient and referrer entry points (booking, OTP request, referral upload) to stop
  scripted abuse; the token is validated in the API Worker.
* **WAF**: managed ruleset on; custom rules block request bodies that match DICOM preambles
  (`DICM` at byte 128), HL7 `MSH|` segments, and CSV bank statement signatures on any endpoint other
  than the simulator's internal service binding; geo-based rate limits; bot fight mode on public paths.
* **Rate limits**: per IP and per API key (KV-backed sliding window in the API, plus zone-level rules);
  WhatsApp webhook verified by signature; OTP requests limited per number and per IP.
* **Secrets** only in Wrangler secrets and GitHub Environments; rotated quarterly; the LLM Gateway holds
  the Claude API key so Workers hold only a gateway token where the gateway supports it.
* **Egress allow-list**: Workers may only fetch the LLM Gateway, WhatsApp Cloud API and Cloudflare
  services; enforced by a fetch wrapper in `packages/adapters-cloudflare` and reviewed in CI.
* **Content security**: strict CSP from Pages `_headers`; no third-party scripts on patient surfaces;
  Subresource Integrity for any CDN font fallback (fonts are self-hosted).
* **Audit**: every write carries actor, persona, tenant and request id in the immutable audit stream;
  SUP actions (reset, provision) are logged to a separate audit table and to Logpush.
* **Vulnerability management**: dependency audit in CI; monthly review; Workers redeployed on a
  security release regardless of feature cadence.

## 13. CI/CD

The reference workflow is `.github/workflows/ci.yml`. Pipeline (pnpm + Turborepo, remote cache):

1. **On pull request**: install, `turbo lint typecheck test build` (affected packages only), D1 and
   Postgres migration tests, Storybook build with visual regression and axe checks, Playwright e2e
   against a Miniflare-hosted API with the "small" fixture, Lighthouse budget check on Patient Space
   routes, then **deploy preview**: Wrangler deploys the API, agents, whatsapp and sim Workers to
   `--env preview` with a PR-suffixed name and a freshly created D1 database; Pages deploys the web
   preview; a bot comment posts the preview URLs and the scenario links.
2. **On merge to `main`**: same checks, then deploy to **staging**, apply D1 migrations to staging
   databases, run the scenario API scripts as smoke tests, then reset staging from the "medium"
   fixture.
3. **On tag `demo-v*`** (or manual `workflow_dispatch` with approval in the `demo` GitHub Environment):
   apply D1 migrations to every demo tenant group database, deploy Workers with a gradual rollout
   (Wrangler versions with a percentage split, 10 % then 100 % after the smoke script passes),
   deploy Pages production, and post release notes to the demo home page.
4. **Preview cleanup**: on PR close, delete the preview Workers and D1 database.

Required GitHub secrets: `CLOUDFLARE_API_TOKEN` (scoped to the demo account: Workers, Pages, D1, R2,
Queues, KV, Vectorize, Access read), `CLOUDFLARE_ACCOUNT_ID`, `TURBO_TOKEN`, `TURBO_TEAM`. Runtime
secrets are set once per environment with `wrangler secret put` and are not stored in GitHub.

## 14. Custom domain, DNS and rollback

* Zone: `<domain>` (e.g. `bonakala.co.za` once cleared; the demo uses the `demo.` subdomain tree).
  Records: `demo` (Pages, CNAME), `api.demo` (Workers route), `staging.demo`, `api.staging.demo`,
  `*.demo` (partner hostnames, proxied), `wa.demo` (WhatsApp webhook Worker). Universal SSL with
  Advanced Certificate for the wildcard; HSTS on; minimum TLS 1.2; DNSSEC on.
* Email for the demo domain: SPF, DKIM and DMARC records set to reject so nobody can spoof demo mail.
* **Rollback**: Workers keep previous versions; `wrangler rollback` (or the dashboard) restores the
  last known good version in seconds; Pages rollbacks by re-promoting a previous deployment. D1
  migrations are forward-only; a rollback that requires schema reversal is done by restoring the D1
  database from Time Travel (point-in-time restore within the retention window) and then redeploying
  the previous Worker version. The runbook is: (1) roll back Workers, (2) if data-affecting, restore D1
  to the pre-deploy bookmark recorded by the workflow, (3) re-run the smoke script, (4) post to the
  team channel.

## 15. KPIs and controls for the demo

| KPI | Target |
|---|---|
| Demo availability (external probe) | 99.5 % monthly |
| Scenario success rate (hourly synthetic run) | 99 % |
| Partner sandbox provisioning time | < 10 min |
| Tenant reset time (medium fixture) | < 2 min |
| Preview deploy time from PR push | < 12 min |
| LLM spend per tenant per day | within configured cap (default illustrative R150) |
| PHI incidents | 0 (any occurrence is a P1 incident and triggers a full reset and review) |

Controls: quarterly review of the synthetic register and WAF rules by CMP; monthly cost review by SUP;
Access policy review on every partner offboarding; annual penetration test of the demo perimeter.
