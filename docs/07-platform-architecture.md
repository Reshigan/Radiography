# 07 — Platform Architecture

## 1. Shape
One codebase, two deployment targets, one domain model:

* **Cloud = Cloudflare, end to end.** Production, staging and the public demo all run on Cloudflare
  (Workers, Pages, D1, R2, Queues, Workflows, Durable Objects, Containers, Workers AI, AI Gateway,
  Pipelines, Analytics Engine, Zero Trust, Tunnel). The demo is the production stack on synthetic data.
* **Internal = Docker/Kubernetes** for practices or groups that must run on their own infrastructure
  (Postgres, object storage, NATS, Orthanc, GPU inference).
* **Edge Gateway at every site** in both cases: DICOM never crosses the internet as raw DICOM; the
  gateway converts to DICOMweb over HTTPS through a Cloudflare Tunnel (cloud) or the private network
  (internal).

```
                 ┌────────────────────────────────────────────────────────────┐
                 │                      Bonakala Platform                      │
                 │                                                            │
  Patients ────▶ │  Patient Space (PWA)   Referrer Space   Clinical Consoles  │
  WhatsApp ────▶ │  Business Consoles     Governance       Shareholder Portal │
                 │  ───────────────────  BDL (design language)  ───────────── │
                 │                     API (Hono, TypeScript)                 │
                 │   M01…M21 domain modules  ·  Event bus  ·  Agent Runtime   │
                 │  ─────────────────  Ports & Adapters layer  ────────────── │
                 │  DB · Object store · Queue · KV · Search · LLM · Inference │
                 │  DICOM · HL7/FHIR · Claims switch · Payments · Messaging   │
                 └────────────────────────────────────────────────────────────┘
        Cloudflare adapters (cloud: prod/staging/demo)   Docker adapters (internal)
   D1 (per-tenant) · R2 · Queues · Workflows · KV       Postgres · MinIO/SeaweedFS · NATS · Valkey
   Durable Objects · Containers · Workers AI · AI Gw    Meilisearch · Orthanc · Python inference
   Pipelines · R2 Data Catalog · Analytics Engine       ClickHouse/Postgres warehouse
   Vectorize · Tunnel · Access · Cron Triggers          Keycloak · Caddy · OpenTelemetry stack
```

Principle: **the demo is the product**. Every module runs on Cloudflare in production with real
integrations, on Cloudflare in demo mode with simulated external systems (modalities, switches,
funders), and on Docker internally with the real integrations. Feature flags select adapters;
business logic is identical.

## 2. Repository layout (monorepo, pnpm + Turborepo)

```
bonakala/
├── apps/
│   ├── web/                # React SPA/PWA: all persona surfaces (route groups per lens)
│   ├── api/                # Hono API; runs on Workers (demo) and Node (internal)
│   ├── edge-gateway/       # Site appliance (Node + Orthanc sidecar): DICOM router, MWL, offline cache
│   ├── inference/          # Python FastAPI + ONNX Runtime/TensorRT model server (Cloudflare Containers or GPU inference cell; Docker internal)
│   ├── agents/             # Agent Runtime workers ("Hands"); Claude API tool-runner based
│   ├── whatsapp/           # WhatsApp Business (Cloud API) webhook worker + conversation engine
│   └── sim/                # Simulators: modalities (DICOM C-STORE), claims switch, funders, banks
├── packages/
│   ├── bdl/                # Design language: tokens, components, icons, lenses
│   ├── domain/             # Entities, value objects, Zod schemas, domain events (M01–M21)
│   ├── db/                 # Drizzle schema (Postgres) + generated SQLite mirror for D1; migrations
│   ├── ports/              # Interfaces: Storage, Queue, KV, Search, LLM, Inference, DICOM, Switch…
│   ├── adapters-cloudflare/
│   ├── adapters-docker/
│   ├── billing-rules/      # Tariff engine, scheme rule packs, scrubber rules (data-driven)
│   ├── dicom/              # DICOM tag dictionary, SR/DoseSR parsers, MWL builder, de-identifier
│   ├── hl7-fhir/           # HL7 v2 (ORM/ORU/ADT/SIU) and FHIR R4 mappers
│   ├── ai-contracts/       # Model I/O schemas, provenance, output classes (see 12)
│   ├── analytics/          # Metric definitions (semantic layer), SQL models, dashboards spec
│   └── i18n/               # Message catalogues
├── infra/
│   ├── cloudflare/         # wrangler.toml, D1 migrations, R2 buckets, Queues, Access policies
│   ├── docker/             # docker-compose.yml, Dockerfiles, Caddy, Keycloak realm, Orthanc config
│   └── k8s/                # Helm chart for larger internal deployments (optional)
├── docs/                   # This specification
└── brand/                  # Tokens, logos, style guide
```

## 3. Runtime components

| Component | Purpose | Cloud (Cloudflare: production, staging, demo) | Internal (Docker) |
|---|---|---|---|
| Web app | All UI | Cloudflare Pages (static, PWA) | Nginx/Caddy container |
| API | Domain modules, REST + typed routes, webhooks | Workers (Hono), Smart Placement | Node 22 (Hono, `@hono/node-server`) |
| Relational DB | System of record | D1 (SQLite), **one database per Practice tenant** plus a directory DB; D1 Time Travel for PITR | PostgreSQL 16 (+ pgvector, pg_partman) |
| Object store | DICOM, PDFs, documents | R2 (jurisdiction-restricted buckets where available; lifecycle tiers; versioning) | MinIO (AGPL, separate service) or SeaweedFS |
| Queue | Async jobs, outbox, inference, claims | Cloudflare Queues | NATS JetStream |
| Long-running processes | Hands, claims runs, month-end, onboarding | Cloudflare Workflows (durable execution, retries, human-approval steps) | Temporal-style worker on NATS + Postgres (or Workflows-compatible runner) |
| KV / cache | Sessions, feature flags, rate limits | Workers KV | Valkey |
| Coordination | Per-object locks (worklist claim, slot holds), per-tenant write batching | Durable Objects (SQLite-backed) | Postgres advisory locks + Valkey |
| Search | Patient/study/claim search; semantic search | D1 FTS5 + Vectorize | Meilisearch + pgvector |
| Scheduler | Cron: reminders, claims runs, dunning, month-end | Cron Triggers → Workflows | NATS scheduled + `scheduler` service |
| DICOM | SCP/SCU, MWL, MPPS at the site; DICOMweb centrally | Edge Gateway (Orthanc) at each site → STOW-RS over HTTPS via Cloudflare Tunnel → Workers → R2; QIDO/WADO-RS served by Workers from R2 + D1 index. Demo: simulators. | Orthanc at edge and central (GPLv3, separate process; REST/DICOMweb only) |
| Heavy compute | DICOM parsing, PDF rendering, de-identification, batch jobs | Cloudflare Containers (Python/Node) + Browser Rendering for PDFs; parsing also on the Edge Gateway | Worker containers on Kubernetes |
| Inference | AI models | Workers AI for LLM/vision utility tasks; Cloudflare Containers for ONNX models (verify GPU availability); a GPU **inference cell** in an SA data centre attached via Cloudflare Tunnel for heavy models; Edge Gateway local QC models. Demo: deterministic demo models (labelled DEMO). | Python inference service on GPU nodes; vendor models via the BCI adapter |
| LLM | Drafting, extraction, agents | Claude API through Cloudflare AI Gateway (caching, rate limits, logging with PHI redaction) | Claude API via LLM Gateway; private-model adapter |
| Analytics warehouse | Events → warehouse → semantic layer | Pipelines → R2 Data Catalog (Iceberg) → R2 SQL / Workers; Analytics Engine for operational metrics | ClickHouse or Postgres warehouse |
| Identity | SSO, MFA, device posture | Cloudflare Access (Zero Trust) + built-in OIDC provider; passkeys | Keycloak (Apache-2.0); built-in OIDC fallback |
| Site connectivity | Edge Gateway ↔ cloud | Cloudflare Tunnel (outbound only; no inbound ports at sites) | Private network / VPN |
| Messaging | WhatsApp, SMS, email | WhatsApp Cloud API, SA SMS aggregator, Email Workers / email API | same |
| Payments | Cards, PayShap, EFT, QR | SA PSP adapter + simulator | same |
| Claims switch | EDI to funders | Switch adapter(s) over HTTPS/SFTP from Workers/Containers; simulator in demo | Switch adapter(s) (see 14) |
| Security edge | WAF, bot, rate limits, DDoS | Cloudflare WAF, Turnstile, Rate Limiting, Bot Management | Caddy + CrowdSec or equivalent |
| Observability | Logs, metrics, traces | Workers Logs, Analytics Engine, Logpush to R2, Tail Workers | OpenTelemetry → Prometheus/Grafana/Loki/Tempo |

## 4. Domain module design (M01–M21)
* Each module = a folder in `packages/domain` with: entities, commands, queries, events, policies,
  read models. Hexagonal: modules never import adapters.
* **Events**: every state change emits a versioned domain event (`study.signed.v1`) into the outbox
  table, published to the queue, consumed by projections, analytics, integrations and agents.
* **Multi-tenancy**: every row carries `practice_id`; row-level security in Postgres; on Cloudflare
  each Practice has its own D1 database (isolation, size and write-throughput headroom) resolved
  through a tenant directory, with an application guard. Group/MSO cross-tenant queries go through
  the analytics layer or explicit cross-tenant services with recorded lawful basis.
* **Idempotency**: all inbound integration messages and commands are idempotent by
  `(source, message_id)`.
* **Time**: stored UTC, displayed SAST. Financial periods by Practice financial year.

## 5. Edge Gateway (site appliance) — the load-shedding answer
A small box (or VM) per site, Docker-based, Ubuntu LTS, on UPS:
* Receives DICOM from modalities (C-STORE), provides MWL and MPPS, stores 30 days locally, forwards to
  central archive with resumable transfers; **all imaging continues without internet or power grid**.
* Runs a local read-only mirror of today's worklist and patient demographics; technologist console
  works offline (PWA + gateway API).
* Runs on-device QC models (positioning/exposure) so technologists get feedback in seconds even
  when offline; triage inference is queued for when the link returns.
* Health telemetry to the Platform (link, disk, UPS state, modality connectivity, transfer backlog).
* Zero-touch enrolment: a site code + one-time token; auto-updates via signed images.

## 6. Integration bus (M21 + 14)
* Inbound: HL7 v2 (MLLP) from hospitals, FHIR R4 REST, DICOM, e-mail/fax gateways, WhatsApp
  webhooks, PSP webhooks, switch responses, bank statements (CSV/OFX/API).
* Outbound: HL7 ORU, FHIR DiagnosticReport/ImagingStudy, DICOM push to referrer PACS, PDF reports,
  claims (EDI), remittance requests, accounting journals, SMS/WhatsApp/email.
* All messages stored raw (immutable) + parsed; replayable; per-integration dashboards.

## 7. Agent Runtime ("Hands", M20)
* Built on the Claude API tool runner (see `11-ai-catalogue-and-agentic-automation.md`); default
  model `claude-opus-5` for reasoning Hands, `claude-sonnet-5` for high-volume worker Hands,
  `claude-haiku-4-5` for classification-only steps; adaptive thinking; structured outputs for every
  tool result that writes to the Platform.
* Every Hand has: a mandate (what it may do), a leash (limits: amounts, counts, entities, time),
  tools (typed, allow-listed, each with a risk class), an approval policy, a budget, and an audit
  stream. A Hand cannot call a tool outside its mandate — enforced by the runtime, not the prompt.
* Hands never see identified clinical images or free-text reports unless the task requires it and
  the data path is approved (de-identification by default; see 12 and 15).
* Runs as queue consumers; long-running tasks checkpoint state in the DB; human approvals surface as
  tasks in the relevant persona's queue.

## 8. Clinical Intelligence (BCI, M11)
* **Model Registry**: every model (in-house or vendor) has an entry: intended use, modality, body
  part, input spec, output class (12), version, validation report, SAHPRA status, monitoring plan.
* **Inference orchestration**: study arrives → routing rules (modality, body part, site, age) →
  inference jobs → results stored as DICOM SR + JSON + optional overlays (DICOM Presentation State
  / Segmentation) → events to worklists.
* **Adapter contract** (`ai-contracts`): DICOM in, `bci.result.v1` out (findings candidates with
  localisation, scores, model id/version, latency, quality flags). Vendor models plug in by
  implementing the contract (container with HTTP endpoint or DICOM node).
* **Monitoring**: per-model daily performance proxies (override rate, agreement with signed report,
  drift on image statistics, latency), alarms to AIO.

## 9. Open-source components and licences
| Component | Licence | Use | Note |
|---|---|---|---|
| React, Vite, TanStack, Zod, Hono, Drizzle | MIT | Core | Attribution in NOTICE |
| Radix UI, visx, D3 | MIT / BSD | BDL | |
| Cornerstone3D, OHIF (optional) | MIT | Viewer | |
| Orthanc | GPLv3 | DICOM server, separate process via REST | No linking; ship as separate container; source offered |
| dcm4che (optional alternative) | MPL/LGPL | DICOM | |
| pydicom, highdicom, dicomweb-client | MIT | Python DICOM | |
| ONNX Runtime | MIT | Inference | |
| MONAI, torchvision (training) | Apache-2.0 / BSD | Model training | |
| Keycloak | Apache-2.0 | Identity | |
| PostgreSQL | PostgreSQL | DB | |
| MinIO | AGPLv3 | Object store, separate service | Alternative: SeaweedFS (Apache-2.0) |
| NATS, Redis/Valkey, Meilisearch | Apache-2.0 / BSD / MIT | Infra | Redis ≥7.4 licence changed; prefer Valkey (BSD) |
| Grafana stack | AGPLv3 | Observability | Separate service |
| Fonts | SIL OFL | BDL | |

No GPL/AGPL code is linked into the Platform's distributed application code.

## 10. Non-functional requirements
| Area | Requirement |
|---|---|
| Availability | 99.9 % Platform; imaging continues at 100 % via Edge Gateway during outages |
| Performance | Worklist < 300 ms P95; first image < 1 s on LAN, < 3 s on 20 Mbps; report sign-off < 500 ms |
| Scale | 300 sites, 3 000 users, 10 M studies/year, 2 PB imaging (tiered), 30 M claims lines/year |
| Data residency | Identified data kept in South Africa where the platform allows it (Cloudflare Data Localization Suite: Regional Services and R2 jurisdiction restrictions, availability for South Africa to be verified with Cloudflare; POPIA s.72 conditions and a data-processing agreement cover any cross-border processing); internal: SA data centres |
| Retention | Images and reports ≥ 6 years adults (HPCSA guidance), until 21st birthday + 6 years for minors, longer for mammography/occupational records (ODMWA/COIDA); configurable per record class |
| Backup / DR | RPO 15 min, RTO 4 h; cross-region replica; quarterly DR tests |
| Security | See 15: zero trust, MFA, encryption at rest and in transit, key management, audit immutability |
| Accessibility | WCAG 2.2 AA |
| Observability | Every request traced; every event replayable; SLO dashboards per module |
