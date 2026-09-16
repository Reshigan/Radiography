# 16 — Cloud Deployment on Cloudflare (production and demo)

## 1. Purpose and scope

The cloud deployment of the Bonakala Platform runs end to end on Cloudflare: production (identified
patient data, real modalities behind Edge Gateways, real claims switches and funders), staging, and
the public demo (synthetic data, simulated external systems). All three run the same code from
`apps/web`, `apps/api`, `apps/agents`, `apps/whatsapp` and `apps/edge-gateway`; the demo adds
`apps/sim`. The Docker/Kubernetes deployment in 17 is the alternative for a Practice or group that
must run on its own infrastructure. This document covers:

* the production service map and how each Platform concern maps to a Cloudflare service;
* data residency and POPIA posture for identified data on a global edge platform;
* tenancy (D1 sharded per Practice with a tenant directory), coordination (Durable Objects),
  imaging (R2 with lifecycle tiers), long-running work (Workflows), analytics (Pipelines, R2 Data
  Catalog, Analytics Engine), inference (Containers, an SA GPU inference cell, Edge Gateway);
* the Edge Gateway link (Cloudflare Tunnel, DICOMweb STOW-RS over HTTPS);
* environments and account separation, wrangler configuration, D1 migrations;
* backups, DR, observability, security, CI/CD, DNS, rollback;
* limits of the platform and their mitigations;
* a cost model at 1, 10 and 100 sites;
* the public demo as a subsection: goals, synthetic data, scenarios, reset and partner sandboxes.

### 1.1 Requirements (M21 Platform Core, cloud profile)

* M21-R-100 The cloud deployment MUST run the identical domain packages (`packages/domain`,
  `packages/billing-rules`, `packages/dicom`, `packages/hl7-fhir`, `packages/ai-contracts`) as the
  internal deployment, with differences confined to `packages/adapters-cloudflare` and feature flags.
* M21-R-101 Each Practice tenant MUST have its own D1 database resolved through a tenant directory;
  no query MAY run without a resolved tenant binding and a `practice_id` guard, except directory and
  cross-tenant analytics services with a recorded lawful basis.
* M21-R-102 Identified data MUST be stored and processed in South Africa where Cloudflare provides
  the control (Regional Services, R2 jurisdiction restrictions); where a control is not available
  for South Africa, the cross-border transfer MUST be covered by POPIA s.72 conditions and a
  data-processing agreement, recorded in M19 before go-live.
* M21-R-103 Raw DICOM MUST NOT cross the internet. Edge Gateways MUST forward studies as DICOMweb
  STOW-RS over HTTPS through Cloudflare Tunnel; Workers MUST NOT expose DIMSE ports.
* M21-R-104 Production, staging and demo MUST be separated at least by Cloudflare account, with
  separate API tokens, Access organisations and R2 buckets.
* M21-R-105 The demo MUST NOT store, accept or transmit personal information of any real natural
  person; all demo data MUST come from the synthetic generator in `apps/sim` with `synthetic = true`
  at row level, and every demo surface, document and message MUST carry a DEMO label.
* M21-R-106 A demo tenant MUST be resettable in under 2 minutes, and a partner sandbox tenant MUST
  be provisionable by SUP in under 10 minutes.

## 2. Service map (production)

| Platform concern | Cloudflare service | Notes |
|---|---|---|
| Web app (all persona surfaces, PWA) | **Pages** | Static build of `apps/web`; strict CSP via `_headers`; no Pages Functions (API lives in Workers) |
| API (Hono, M01–M21) | **Workers** | `apps/api`; Smart Placement on so the Worker runs near D1 and R2; Access JWT verified on staff paths |
| Long-running processes (Hands, claims runs, month-end, onboarding, retention) | **Workflows** | Durable execution with retries and human-approval steps (`waitForEvent`); each Hand run is a Workflow instance with mandate, leash and budget checked at every step |
| Async jobs, outbox, notifications, inference dispatch | **Queues** | `events`, `inference`, `claims`, `notifications`, `agents`; dead-letter queue per topic |
| System of record | **D1** | One database per Practice tenant plus a directory database (`bonakala-directory`); SQLite mirror of the Drizzle schema; D1 Time Travel for PITR |
| Per-object coordination and per-tenant write batching | **Durable Objects** (SQLite-backed) | `SlotHold`, `WorklistLock`, `TenantWriter` (batches writes for a tenant and enforces the reset flag), `CriticalFinding` (acknowledgement state machine) |
| Imaging, documents, reports, exports | **R2** | `imaging-hot`, `imaging-cold` (lifecycle transition), `documents`, `exports`, `logs`; versioning on; jurisdiction restriction where available |
| Search | **D1 FTS5** + **Vectorize** | Patient/study/claim search per tenant; embeddings of report and order text for similar-prior retrieval and referrer search |
| Analytics warehouse | **Pipelines** → **R2 Data Catalog** (Iceberg) → **R2 SQL / Workers**; **Analytics Engine** | Domain events stream into Iceberg tables per tenant group; the semantic layer in `packages/analytics` queries them; Analytics Engine holds operational metrics |
| LLM gateway | **AI Gateway** | All Claude API calls pass through it: caching, rate limits, per-Hand budgets, logging with PHI redaction; Workers AI for utility tasks (classification, OCR of referral photos, embeddings) |
| Heavy compute | **Containers** | Python/Node containers for DICOM parsing, de-identification, batch exports, ONNX inference; started on demand from a Durable Object |
| PDF reports and statements | **Browser Rendering** | Renders the BDL report template to PDF; stored in R2 `documents` |
| Inference | **Workers AI** (utility), **Containers** (ONNX models, GPU availability to be verified), **GPU inference cell** in an SA data centre via **Tunnel** (heavy models, vendor containers), Edge Gateway local QC | See §7 |
| Email | **Email Workers** (inbound: referral and fax-to-email gateways) and an email API for outbound | Inbound e-referral mailboxes parsed by a Container |
| Thumbnails, key images | **Images** | Transforms of rendered PNG frames from R2 for referrer and patient views |
| Site connectivity | **Tunnel** (`cloudflared` on each Edge Gateway) | Outbound-only; no inbound ports at any site; Access service tokens per gateway |
| Staff identity and device posture | **Access** (Zero Trust) | Organisation IdP federation, MFA, passkeys, device posture for Reading Room; built-in OIDC provider for Practices without an IdP |
| Patient and referrer surfaces | **Turnstile** | OTP request, booking, referral upload |
| Security edge | **WAF**, Rate Limiting, Bot Management, DDoS | Managed rules plus Platform-specific custom rules |
| Scheduled work | **Cron Triggers** → Workflows | Reminders, claims runs, dunning, month-end, retention, DR exports |
| Observability | **Workers Logs**, **Logpush** to R2, **Tail Workers**, Analytics Engine | Structured logs with PHI redaction at the source |
| Sessions, feature flags, rate limits, reference data | **KV** | Tariff codes, scheme rule packs and ICD-10 subset cached from the directory database |

### 2.1 Request path

1. The browser loads `apps/web` from Pages. Staff paths require an Access session; the API verifies
   the `CF-Access-Jwt-Assertion` and maps the identity to a persona and Practice roles (M01).
2. The API resolves the tenant from the hostname (`<practice>.bonakala.<tld>`) or the session, looks
   up the tenant directory (KV-cached, D1-backed), and opens the tenant's D1 database through the
   per-tenant binding map. The Drizzle wrapper refuses tenant-scoped queries without a `practice_id`
   predicate.
3. Writes go to the `TenantWriter` Durable Object for that tenant, which batches them into D1
   transactions (write throughput headroom, §13) and appends outbox rows in the same transaction.
4. The outbox is drained to Queues; consumers run projections, integrations, notifications and
   Pipelines ingestion; long-running work is started as a Workflow instance.
5. Strongly consistent operations (a 10-minute slot hold, a radiologist claiming a study, a critical
   finding awaiting acknowledgement) live in Durable Objects keyed by entity id, with alarms.

## 3. Data residency and POPIA posture

Cloudflare is a global network; identified data on it needs explicit controls:

| Control | What it does | Status |
|---|---|---|
| **Regional Services** (Data Localization Suite) | Restricts where TLS termination and Worker execution of the zone happen to a chosen region | Verify availability for South Africa with Cloudflare; if only a wider region is offered, record the region and the transfer basis |
| **R2 jurisdiction restrictions** | Pins bucket storage to a jurisdiction | Verify availability for South Africa; until available, buckets use the closest offered jurisdiction with encryption keys held by the Platform (client-side envelope encryption for documents; DICOM pixel data encrypted at the Edge Gateway before STOW-RS) |
| **D1 location hint** | Places the primary database near a region | Set to the nearest supported location; read replication off for identified tenants unless replicas are in-region |
| **Customer Metadata Boundary** | Keeps logs and metadata in a region | Enable where available |
| **Keys** | Envelope encryption with keys held by the MSO in a KMS-backed store; Cloudflare holds ciphertext only for documents and pixel data | Required for any tenant while jurisdiction controls are not confirmed for South Africa |

Legal basis: POPIA s.72 permits cross-border transfer where the recipient is bound by law or
agreement to an adequate level of protection. The MSO signs a data-processing agreement with
Cloudflare as operator, records the transfer impact assessment per tenant in M19, discloses the
processing in each Practice's privacy notice, and CMP re-verifies availability of the residency
controls quarterly. Every Practice's Information Officer signs the tenant's data-flow record before
go-live. Where a Practice cannot accept the posture, the Docker deployment (17) applies.

## 4. Tenancy on D1

* **One D1 database per Practice.** D1's per-database size limit (illustrative: 10 GB, verify current
  limits) is why tenants are sharded rather than grouped. Clinical rows for a large practice (300 000
  studies per year, several years of claims) fit within that with imaging in R2 and events archived
  to Iceberg; if a tenant approaches 70 % of the limit an alert to SUP triggers a planned split of
  historical partitions into an archive database (`<practice>-archive-<year>`).
* **Tenant directory** (`bonakala-directory` D1): `tenant` (practice id, hostname, D1 binding name
  and id, region, status, residency posture, feature flags), `tenant_group`, `user_tenant`,
  reference data tables (tariff codes, scheme rule packs, ICD-10 subset, public holidays) and the
  cross-tenant `legal_entity` graph (M02). The directory is KV-cached with a 60-second TTL.
* **Binding map.** Wrangler bindings are static, so `wrangler.toml` lists a pool of D1 bindings
  (`DB_T001`…`DB_T250`) and the directory maps a tenant to a binding name. Adding a tenant beyond
  the pool means a configuration deploy (no code change). Alternatively, the D1 REST API opens
  databases dynamically for low-traffic tenants; the pool is preferred for latency.
* **Group and MSO views** never join across tenant databases at request time; they read the
  warehouse (§8) or call an explicit cross-tenant service that records the lawful basis (M02-R-004).
* **Write batching** by `TenantWriter` Durable Object (§13) keeps each tenant under D1's write
  throughput ceilings and serialises conflicting writes.

## 5. Imaging on R2 and the Edge Gateway link

1. Modalities send DICOM to the site's Edge Gateway (Orthanc SCP) on the modality VLAN (17 §5).
2. The gateway parses headers, extracts Dose SRs, runs local QC inference, de-identifies nothing
   (production keeps identity) but encrypts pixel data with the tenant key if the residency posture
   requires it, and forwards the study as **DICOMweb STOW-RS over HTTPS** through **Cloudflare
   Tunnel** to the API Worker. Large instances go **direct to R2 with presigned multipart uploads**
   (§13); the Worker receives only metadata and the R2 object keys.
3. The Worker writes the study, series and instance index to the tenant's D1, emits `study.received.v1`,
   and enqueues inference routing (M11).
4. QIDO-RS and WADO-RS are served by Workers from the D1 index and R2 (range reads, frame-level
   endpoints, progressive JPEG 2000 or HTJ2K where the modality supports it, transcoded in a
   Container otherwise). The Reading Room viewer (Cornerstone3D) reads DICOMweb only.
5. Lifecycle: `imaging-hot` (0 to 18 months) transitions to `imaging-cold` (infrequent access class)
   by lifecycle rule; priors are pre-warmed into hot when an appointment is booked (M09 prefetch).
   Retention deletes follow 07 §10 through the M09 retention Workflow with CMP approval.
6. Referrer PACS push and CD/USB export run in a Container using DICOMweb pull from R2.

## 6. Long-running processes on Workflows

Every Hand (M20) and every multi-step business process runs as a Workflow:

| Workflow | Trigger | Steps (abridged) | Human step |
|---|---|---|---|
| `hand.<name>` | Queue message or Cron | load mandate and leash; plan; call typed tools; checkpoint; budget check per step | approval task via `waitForEvent` when the policy requires it |
| `claims.run` | Cron hourly | select ready claims; scrub; submit to switch adapter; poll responses; post remittances | exceptions to BIL queue |
| `month-end.close` | Cron monthly and on demand | unbilled sweep; intercompany fees; management accounts; distributions proposal | approvals by EXE/SHR |
| `practice.onboard` | SUP action | create tenant D1; migrate; seed reference data; Access group; hostname; Tunnel tokens for gateways | checklist sign-off |
| `retention.sweep` | Cron daily | select expired record classes; propose deletions | CMP approval |
| `dr.export` | Cron daily | D1 export per tenant to `exports` bucket; R2 replication verification | none |

Workflows give durable state, retries with backoff and idempotent steps; the Platform keeps its own
audit stream per instance so a Hand's reasoning and tool calls are inspectable by AIO.

## 7. Inference options

| Option | Use | Notes |
|---|---|---|
| **Edge Gateway local models** | Positioning/exposure QC, first-pass STAT flags | CPU ONNX; works offline; results reach the tenant when the link is up |
| **Workers AI** | Utility: embeddings, referral-form OCR, classification, small vision tasks | No identified clinical images unless the model and data path are approved (12) |
| **Containers** | In-house ONNX models, DICOM parsing, de-identification, transcoding | GPU availability on Containers must be verified; CPU-only models run here today |
| **GPU inference cell** | Heavy triage models, vendor SAHPRA-registered containers | A small GPU cluster in an SA data centre exposed only through Cloudflare Tunnel with Access service tokens; implements the `bci.result.v1` contract; falls back to Edge Gateway QC when unreachable |

Routing rules in the model registry (M11) choose the option per model; provenance records where the
inference ran.

## 8. Analytics warehouse

Domain events (`*.v1`) from every tenant's outbox are sent by a Queue consumer to **Pipelines**, which
land them as Iceberg tables in **R2 Data Catalog** (partitioned by tenant group, event type, month).
The semantic layer in `packages/analytics` defines metrics once (07) and runs them through R2 SQL or a
Worker-hosted query engine; dashboards (M16) read the results. Cross-tenant aggregation for Group and
MSO happens here, de-identified by default (no patient identifiers land in the warehouse; a
tokenised patient key allows longitudinal counts). **Analytics Engine** carries operational metrics
(latency, queue lag, gateway telemetry) with per-tenant dimensions.

## 9. Environments and account separation

| Environment | Cloudflare account | Data | Access org | URL tree |
|---|---|---|---|---|
| **production** | `bonakala-prod` | Identified; residency posture per §3 | `bonakala` | `<practice>.bonakala.<tld>`, `api.bonakala.<tld>`, `app.bonakala.<tld>` |
| **staging** | `bonakala-staging` | Synthetic (medium fixture) plus anonymised load shapes; never identified data | `bonakala-staging` | `*.staging.bonakala.<tld>` |
| **demo** | `bonakala-demo` | Synthetic only; partner sandboxes | `bonakala-demo` | `demo.bonakala.<tld>`, `<partner>.demo.bonakala.<tld>` |
| **preview** (per PR) | inside `bonakala-demo` | Synthetic (small fixture), ephemeral | none (workers.dev) | `bonakala-api-pr-<n>.workers.dev` |

Separate accounts give separate API tokens, audit logs, billing, Access organisations and R2
namespaces; a token leak in demo cannot touch production. The `<tld>` is chosen after the trademark
clearance in 05 §1.1.

## 10. Wrangler configuration outline

The reference skeleton is `infra/cloudflare/wrangler.toml` (API Worker). Structure:

* One `wrangler.toml` per Worker app; the API file is canonical. The default (top-level) section is
  the preview shape; `[env.staging]`, `[env.demo]` and `[env.production]` override names, routes,
  account ids and binding ids.
* Bindings: `DIRECTORY` and a pool `DB_T001`… (D1); `IMAGING_HOT`, `IMAGING_COLD`, `DOCUMENTS`,
  `EXPORTS` (R2); `SESSIONS`, `FLAGS`, `REFDATA` (KV); Queue producers and consumers; Durable
  Objects `SlotHold`, `WorklistLock`, `TenantWriter`, `CriticalFinding`, `ContainerHost`; Workflows
  `HAND_RUN`, `CLAIMS_RUN`, `MONTH_END`, `PRACTICE_ONBOARD`, `RETENTION_SWEEP`, `DR_EXPORT`;
  `AI` (Workers AI, routed through AI Gateway); `SEARCH` (Vectorize); `ANALYTICS` (Analytics Engine);
  `PIPELINE` (Pipelines); `BROWSER` (Browser Rendering); `IMAGES`; `[[containers]]` for the compute
  image; `[[send_email]]`; service bindings to `sim` (demo/staging only) and to the `inference`
  Worker.
* Secrets are set per environment with `wrangler secret put`: `ANTHROPIC_API_KEY` (or the AI
  Gateway token), `AI_GATEWAY_URL`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
  `ACCESS_AUD`, `SESSION_SIGNING_KEY`, `TURNSTILE_SECRET`, `TENANT_KEK_REF` (key-encryption key
  reference), `SWITCH_CLIENT_CERT`, `PSP_API_KEY`, `SMS_API_KEY`.
* Cron Triggers written in UTC (SAST = UTC+2, no DST).
* `[[migrations]]` for Durable Object classes is append-only; `compatibility_date` pinned;
  `nodejs_compat` on.

## 11. D1 migration strategy (Drizzle SQLite mirror)

1. `pnpm db:generate` produces Postgres migrations from the single Drizzle schema in `packages/db`.
2. `pnpm db:mirror` emits the SQLite mirror (`uuid` to `text`, `timestamptz` to ISO-8601 text UTC,
   `numeric` money to integer cents, `jsonb` to text with JSON check, enums to text with CHECK,
   pgvector columns replaced by Vectorize ids) plus FTS5 tables and sync triggers.
3. Row-level security has no SQLite equivalent; the mirror indexes `practice_id` everywhere and the
   query wrapper enforces the predicate. Because each tenant has its own database, an RLS gap cannot
   leak across Practices.
4. CI applies both sets: Postgres in a service container, D1 via local Miniflare, then a schema-diff
   test asserting parity or an explicit omission allow-list.
5. Production rollout: the `practice.onboard` Workflow and the release pipeline apply migrations
   tenant by tenant (`wrangler d1 migrations apply` or the D1 REST API) in waves (staging, canary
   tenants, 10 %, 100 %), recording a Time Travel bookmark per database before each apply.
   Migrations are expand-only within a release; contraction ships one release later.

## 12. Backups and disaster recovery

| Asset | Mechanism | RPO | Off-site |
|---|---|---|---|
| D1 (per tenant + directory) | D1 Time Travel (point-in-time restore within the retention window) plus daily `dr.export` SQL dumps to `exports` bucket | Time Travel: minutes; exports: 24 h | Exports replicated to a second R2 jurisdiction (or to the internal object store of the DR site) |
| R2 imaging and documents | Versioning; cross-bucket replication to a second jurisdiction bucket; object lock for the audit and report classes | ≤ 15 min (replication lag) | Yes; plus optional Tunnel-connected on-premise mirror for a Practice that requires it |
| Durable Object state | SQLite-backed with point-in-time recovery; state is rebuildable from D1 events for holds and locks | minutes | n/a |
| Workflows state | Managed; steps idempotent so a re-run is safe | n/a | n/a |
| Warehouse (Iceberg in R2) | Rebuildable from the event archive; replicated with R2 | 24 h | yes |
| Configuration and secrets | `wrangler.toml` in git; secrets in a SOPS-encrypted vault; Access policies exported nightly | on change | yes |

DR posture: Cloudflare's network provides regional resilience for Workers, KV, Queues and R2; the
Platform's own recovery plan covers data corruption and account compromise. Quarterly drill: restore
one tenant's D1 to a bookmark in staging, rehydrate its Durable Objects, replay one day of events,
open 50 studies through WADO-RS, and record evidence in M19. RPO 15 minutes and RTO 4 hours (07 §10)
apply; a full-account loss scenario is mitigated by the second-jurisdiction exports and the ability to
stand up the Docker profile (17) from them.

## 13. Limits and mitigations

| Limit (verify current values) | Impact | Mitigation |
|---|---|---|
| Worker CPU time per request | Parsing a large DICOM file or a CT series in a Worker is not viable | Parse on the Edge Gateway (index and Dose SR extracted before upload); heavy parsing, transcoding and de-identification in Containers |
| Request body size | Instances larger than the limit cannot be posted through the Worker | Presigned multipart uploads direct to R2; the Worker receives keys and metadata; STOW-RS response assembled after R2 completion events |
| D1 write throughput and database size | Bursty writes from a busy site; large tenants | Per-tenant sharding; `TenantWriter` Durable Object batches writes into transactions; archive databases for historical partitions; events archived to Iceberg |
| Durable Object single-threaded per object | A hot object (one tenant's writer) serialises throughput | Shard writer objects by module (`TenantWriter:<practice>:<module>`) when a tenant exceeds the throughput target; keep locks fine-grained |
| Queue message size and batch limits | Large payloads | Messages carry references (R2 keys, row ids), never payloads |
| Workers AI model catalogue | No clinical-grade models | Clinical models run in Containers, the inference cell or at the Edge; Workers AI restricted to utility tasks |
| Containers GPU availability | Unverified | Inference cell in an SA data centre via Tunnel; Edge Gateway CPU models |
| Subrequest and connection limits | Fan-out to many tenants in one request | Fan-out through Queues and Workflows, never in one request |
| Regional Services and R2 jurisdiction coverage | May not include South Africa | §3 controls; Docker profile as the fallback for a Practice that cannot accept the posture |
| Tail Worker and Logpush contents | Logs may contain identifiers | Redaction at the log call site; Logpush filtered; log retention 30 days |
| No raw TCP listeners | No DIMSE, no MLLP in Workers | DICOM and HL7 terminate at the Edge Gateway (or a hospital-side gateway) and are forwarded as HTTPS |

## 14. Security posture

* **Zero Trust**: Access in front of every staff surface and API path; organisation IdP with MFA;
  passkeys for the built-in provider; device posture (managed device, disk encryption) required for
  the Reading Room; service tokens for Edge Gateways, the inference cell and integrations, rotated
  every 90 days; short-lived service tokens for kiosks.
* **Tunnel**: every site is outbound-only; no port forwarding at any site; gateway identity bound to
  the tenant in the directory.
* **WAF**: managed rulesets; custom rules block DICOM preambles and `MSH|` bodies on non-STOW paths,
  enforce per-tenant hostnames, geo-rate-limit public paths; Bot Management on patient and referrer
  surfaces; Turnstile on OTP, booking and referral upload.
* **Rate limits**: zone rules plus KV-backed per-key limits in the API; OTP limited per number and IP.
* **Encryption**: TLS 1.3 at the edge; envelope encryption for documents and pixel data with tenant
  keys (KEK in a KMS-backed store, DEKs per object); D1 and R2 at rest by Cloudflare; audit tables
  hash-chained and exported daily to object-locked R2.
* **Secrets**: Wrangler secrets per account; never in git; rotation calendar in M19.
* **Egress allow-list**: a fetch wrapper in `packages/adapters-cloudflare` permits only AI Gateway,
  WhatsApp Cloud API, the SMS aggregator, the PSP, the claims switch endpoints and the inference
  cell hostname; CI fails on any other literal host.
* **Content security**: strict CSP; self-hosted fonts; no third-party scripts on patient surfaces.
* **Audit**: every write records actor, persona, tenant, request id; SUP actions in a separate table.
* **Vulnerability management**: dependency audit in CI; monthly review; emergency redeploys.

## 15. Observability

Workers Logs on every Worker with structured JSON (`tenant`, `request_id`, `trace_id`, `persona`,
`module`) and redaction of identifiers at the call site; Logpush to R2 `logs` (30-day lifecycle) and
optionally to an external sink; a Tail Worker computes SLO counters (worklist P95, sign-off latency,
queue lag, STOW-RS failures per gateway) into Analytics Engine; Queues DLQ depth, Workflow failure
rate and Tunnel health are checked by a Cron Workflow that pages SUP; AI Gateway logs per-Hand
tokens, latency, cache hits and cost; external synthetic probes run the API scenario scripts hourly
against staging and the demo, and a read-only health scenario against production.

## 16. CI/CD

Reference workflow: `.github/workflows/ci.yml` (pnpm + Turborepo, remote cache).

1. **Pull request**: install; `turbo lint typecheck test build` on affected packages; Postgres and D1
   migrations plus schema-diff test; Storybook visual regression and axe; Playwright e2e against a
   Miniflare-hosted API with the small fixture; Lighthouse budgets; then deploy a preview (Workers
   with PR-suffixed names and an ephemeral D1, Pages preview) and comment the URLs. Previews are
   deleted when the PR closes.
2. **Merge to `main`**: same checks; deploy to staging; apply migrations; run scenario smoke tests;
   reset staging from the medium fixture.
3. **Tag `demo-v*`**: deploy demo (GitHub Environment `demo`, reviewer approval); migrations across
   all demo tenants; gradual Worker rollout (10 % then 100 %) with smoke between.
4. **Tag `v*`**: deploy production (GitHub Environment `production`, two reviewers, change record
   in M19); migrations in tenant waves with Time Travel bookmarks; gradual Worker rollout; Pages
   production; post-deploy read-only health scenario.

Secrets in GitHub: one `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` per environment, scoped to
that account; `TURBO_TOKEN`. Runtime secrets are set once per environment with `wrangler secret put`.

## 17. Custom domains, DNS and rollback

* Zone `bonakala.<tld>` in the production account: `app`, `api`, `<practice>` hostnames (Cloudflare
  for SaaS custom hostnames or wildcard), `wa` (WhatsApp webhook), `mail` (Email Workers routing).
  Staging and demo zones are delegated subdomains in their own accounts. Advanced certificates for
  wildcards, HSTS, TLS 1.2 minimum, DNSSEC; SPF, DKIM and DMARC at reject for all zones.
* **Rollback**: Workers versions allow instant rollback (`wrangler rollback` or the dashboard) and
  gradual deployments make a bad version visible at 10 %; Pages re-promotes a previous deployment;
  D1 rolls back by restoring to the pre-deploy bookmark recorded by the pipeline, per tenant;
  Durable Objects are restored from their point-in-time history where needed. Runbook: roll back
  Workers, assess data impact, restore affected tenants, re-run smoke, record in M19.

## 18. Cost model

Order-of-magnitude **estimates** for planning, not quotes; Cloudflare and Claude API prices change
and are stored as reference data in the cost model sheet (`packages/analytics`). Illustrative rate
R18 per USD. Assumptions per site: 3 modalities, 15 000 studies per year, 30 users, average study
150 MB stored, 40 % of studies routed to inference, 5 Hand runs per study across booking, coding,
claims and results.

| Component | 1 site | 10 sites | 100 sites |
|---|---|---|---|
| Workers, Workflows, Queues, DO, KV (requests and CPU) | USD 30 to 80 | USD 150 to 400 | USD 1 000 to 3 000 |
| D1 (storage, reads, writes) | USD 5 to 20 | USD 40 to 120 | USD 300 to 900 |
| R2 storage year 1 (2.2 TB / 22 TB / 220 TB) and operations, no egress fees | USD 40 to 60 | USD 350 to 500 | USD 3 000 to 4 500 |
| R2 growth: cumulative, roughly linear per year; cold class reduces after 18 months | | | |
| Containers, Browser Rendering, Images | USD 20 to 60 | USD 150 to 400 | USD 1 000 to 3 000 |
| Workers AI, Vectorize, Pipelines, Data Catalog, Analytics Engine | USD 20 to 50 | USD 100 to 300 | USD 800 to 2 000 |
| Claude API via AI Gateway (Hands and drafting; mostly `claude-sonnet-5` and `claude-haiku-4-5`, cached prompts) | USD 150 to 400 | USD 1 200 to 3 500 | USD 10 000 to 30 000 |
| GPU inference cell (SA data centre, colocation or rental) | USD 0 (Edge QC only) to 500 | USD 1 500 to 3 000 | USD 8 000 to 20 000 |
| Zero Trust (Access seats), WAF, Bot Management, Logpush, DLS add-ons | USD 50 to 300 | USD 300 to 1 500 | USD 2 000 to 8 000 |
| Messaging (WhatsApp, SMS, email) | USD 50 to 150 | USD 500 to 1 500 | USD 5 000 to 15 000 |
| **Total per month (USD)** | **~400 to 1 600** | **~4 300 to 12 000** | **~31 000 to 86 000** |
| **Total per month (ZAR)** | **~R7 000 to R29 000** | **~R77 000 to R216 000** | **~R560 000 to R1.55 M** |
| Per study (ZAR, illustrative) | R6 to R23 | R6 to R17 | R4.5 to R12 |

Enterprise contracts for Zero Trust, Data Localization Suite, Bot Management and Logpush change the
fixed part materially at 10+ sites and are negotiated, not listed. LLM spend is leashed per tenant
per day (M20) and reviewed monthly by SUP with EXE.

## 19. The public demo (subsection)

### 19.1 Goals and rules

The demo exists for sales demonstrations, design validation with real users and a partner sandbox
for integrators. It runs the production stack in the `bonakala-demo` account with `apps/sim`
replacing modalities, the claims switch, funders, the PSP, banks, SMS and WhatsApp (a test business
number only). Three rules are enforced technically: **no PHI ever** (synthetic-only seed pipeline;
an M03 guard rejects any entered ID number not in the synthetic register; WAF blocks DICOM and HL7
payloads; upload endpoints accept only demo-signed fixtures), **everything is labelled DEMO**
(Beam-coloured `Banner` on every surface, PDF footers, WhatsApp headers, `X-Bonakala-Environment:
demo` response header), and **nothing leaves the sandbox** (egress limited to AI Gateway and the
WhatsApp test number).

### 19.2 Demo-only services

`apps/sim` on Workers and Cron Triggers: modality simulator (performs worklist studies on a schedule
during configured opening hours, emits MPPS, stores synthetic studies through the same STOW-RS path
the gateway uses; scripted load-shedding and "gateway offline" windows), claims switch simulator
(accepted, rejected with a realistic reason taxonomy, partial payment, delayed remittance, switch
down; mix configurable per scenario), funders (six fictitious schemes such as `Ithemba Health` and
`Sable Medical` plus simulated RAF, Compensation Fund and ODMWA funders and cash; real scheme names
appear only as examples in reference lists), PSP and bank statements, and demo inference
(deterministic QC and triage models labelled `demo.*` with provenance; Workers AI for OCR of referral
photos and phantom classification).

### 19.3 Synthetic data

Deterministic per `(tenant, fixture, seed)`. Names combine in-house first-name and surname lists
across South African language groups so no full name is copied from a real list; SA ID numbers are
13-digit, Luhn-valid, drawn from a reserved synthetic range and shown with a "synthetic" tag by the
`Id` component; addresses use real provinces and suburbs with fabricated streets; contact numbers use
reserved ranges routed to the simulators; scheme memberships, benefits and authorisations are
fabricated; staff personas carry format-valid reserved HPCSA and practice numbers (illustrative).
Studies are procedurally rendered phantoms (chest, extremity, skull, CT stacks, MR-like series,
ultrasound-like speckle, mammography-like textures) with correct DICOM headers, Dose SRs and MPPS
timelines, plus public-domain phantom images where licences permit (recorded in
`apps/sim/dicom/SOURCES.md`). Fixtures: small (1 practice, 2 sites, 200 patients), medium (2
practices including a 51/49 JV, 5 sites, 5 000 patients, one year of claims), large (load testing).

### 19.4 Guided scenarios

| Scenario | Personas | Automation shown |
|---|---|---|
| **The 09:40 patient**: WhatsApp photo of a paper referral; Referral Hand extracts the order; Booking Hand offers 09:40 at the nearest site; quote with benefit check; pre-check-in; worklist; QC; drafted report signed; results to referrer and patient (8 minutes) | PAT, BKG, FDK, RAD, RGT, REF | Referral A3, booking A3, quote A2, QC A2, drafting A1 |
| **The STAT head CT**: casualty referral; contrast safety checks; triage priority from a demo model; annotated overlay in the Reading Room; radiologist signs; Critical Findings Hand calls (simulated) and secures acknowledgement | REF, RAD, RGT, NUR | Triage A1, critical results A3 |
| **The rejection wave**: switch returns 35 % rejections for one scheme; Rejection Hand classifies, auto-fixes within leash, resubmits, escalates the rest with suggested fixes; first-pass acceptance recovers on the control tower | BIL, DEB, PRM | Rejections A3, exceptions A1 |
| **Month-end in 4 minutes**: unbilled backlog, intercompany fees, management accounts, JV distributable profit and entitlements, distribution proposal, shareholder statements | BIL, EXE, SHR, PRM | Month-end A2, distributions A1 |
| **Onboarding a practice**: the M02 wizard from legal entity to a live tenant with sites, rooms, modalities, fee schedules, DSP contracts and users | EXE, SUP, CMP | Guided A1 with a Hand pre-filling from documents |

Mini-tours: Window/Level the interface; a Hand explains itself (mandate, leash, tools, audit);
load-shedding at Umhlanga (gateway offline, imaging continues, backlog drains); the funder portal.

### 19.5 Reset and partner sandboxes

Reset (`POST /admin/tenants/:id/reset`, SUP only): set the reset flag in `TenantWriter`, drop and
recreate the tenant's D1 tables, delete R2 objects under the tenant prefix, purge KV and Vectorize
entries, re-seed, clear the flag, emit `tenant.reset.v1`; under 2 minutes for the medium fixture.
`demo-main` resets nightly at 02:30 SAST and on demand.

Partner sandbox (`POST /admin/tenants`): the `practice.onboard` Workflow in demo mode creates a
tenant D1 from the pool, hostname `<partner>.demo.bonakala.<tld>`, an Access group for the partner's
domain, seed data, persona accounts, tenant-scoped API keys, webhook registrations and optionally a
WhatsApp test number binding, then writes a welcome page with credentials, scenario links and FHIR and
DICOMweb base URLs. Sandboxes expire after 60 days. Partners may implement the switch port
themselves and point the `SIM` binding at their simulator.

### 19.6 Demo cost and limits

Five demo tenants at 50 000 synthetic studies and 200 000 requests per day cost roughly USD 150 to
900 per month (R2 700 to R16 000), dominated by LLM usage, which is capped per tenant per day
(illustrative R150). The demo does not use a real DICOM network, switch, PSP, SMS or vendor AI
models, and has no identified data; everything else, including the full event model, the agent
runtime, all persona surfaces, billing rules, dose dashboards, analytics and the shareholder portal,
is the production code.

## 20. KPIs and controls

| KPI | Target |
|---|---|
| Production availability (API and DICOMweb) | 99.9 % monthly |
| Imaging continuity at sites during cloud or link outage | 100 % (Edge Gateway) |
| STOW-RS forward latency, gateway to R2 (P95, normal link) | < 60 s per study |
| D1 restore drill RTO | ≤ 4 h (target 1 h per tenant) |
| Residency control verification | quarterly, recorded in M19 |
| Tenant onboarding (technical) | < 30 min via Workflow |
| Demo tenant reset / partner sandbox provisioning | < 2 min / < 10 min |
| Identified data outside the approved posture | 0 (P1 and POPIA incident review) |
| PHI on the demo | 0 (P1, full reset, review) |

Controls: change record for every production release; quarterly access and service-token review;
quarterly restore drill; annual penetration test of the edge and of one tenant's surfaces; monthly
cost review by SUP with EXE; CMP re-verification of Cloudflare residency controls each quarter.
