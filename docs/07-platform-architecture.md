# 07 — Platform Architecture

## 1. Shape
One codebase, two deployment targets, one domain model.

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
        Cloudflare demo adapters                     Docker internal adapters
   D1 · R2 · Queues · KV · Vectorize · Workers AI    Postgres · MinIO/FS · NATS · Redis
   Durable Objects · Cron Triggers · Access          Meilisearch · Orthanc · Python inference
```

Principle: **the demo is the product**. Every module runs on Cloudflare with simulated external
systems (modalities, switches, funders) and on Docker with the real integrations. Feature flags
select adapters; business logic is identical.

## 2. Repository layout (monorepo, pnpm + Turborepo)

```
bonakala/
├── apps/
│   ├── web/                # React SPA/PWA: all persona surfaces (route groups per lens)
│   ├── api/                # Hono API; runs on Workers (demo) and Node (internal)
│   ├── edge-gateway/       # Site appliance (Node + Orthanc sidecar): DICOM router, MWL, offline cache
│   ├── inference/          # Python FastAPI + ONNX Runtime/TensorRT model server (internal)
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

| Component | Purpose | Demo (Cloudflare) | Internal (Docker) |
|---|---|---|---|
| Web app | All UI | Cloudflare Pages (static) | Nginx/Caddy container |
| API | Domain modules, REST + tRPC-style typed routes, webhooks | Workers (Hono) | Node 22 (Hono, `@hono/node-server`) |
| Relational DB | System of record | D1 (SQLite) per demo tenant group | PostgreSQL 16 (+ pgvector, pg_partman) |
| Object store | DICOM, PDFs, documents | R2 | MinIO (AGPL, separate service) or S3-compatible |
| Queue | Async jobs, outbox, inference, claims | Cloudflare Queues | NATS JetStream |
| KV / cache | Sessions, feature flags, rate limits | Workers KV | Redis / Valkey |
| Coordination | Per-object locks (worklist claim, slot holds) | Durable Objects | Postgres advisory locks + Redis |
| Search | Patient/study/claim search | D1 FTS5 | Meilisearch or Postgres FTS |
| Scheduler | Cron: reminders, claims runs, dunning, month-end | Cron Triggers | NATS scheduled + a `scheduler` service |
| DICOM | SCP/SCU, DICOMweb, MWL, MPPS | Simulated: R2-backed WADO-RS subset | Orthanc (GPLv3, separate process; REST/DICOMweb only, no linking) in edge gateway and central archive |
| Inference | AI models | Workers AI + deterministic demo models (labelled DEMO) | Python inference service on GPU nodes; third-party SAHPRA-registered vendor models via the BCI adapter |
| LLM | Drafting, extraction, agents | Claude API via LLM Gateway | Claude API via LLM Gateway; private-model adapter available |
| Identity | SSO, MFA | Cloudflare Access + built-in OIDC | Keycloak (Apache-2.0) or Authentik; built-in OIDC fallback |
| Messaging | WhatsApp, SMS, email | WhatsApp Cloud API, SMS aggregator (SA), email API | same |
| Payments | Cards, PayShap, EFT, QR | SA PSP adapter (e.g., a local gateway) + simulator | same |
| Claims switch | EDI to funders | Simulator | Switch adapter(s) (see 14) |
| Observability | Logs, metrics, traces | Workers Analytics Engine, Logpush | OpenTelemetry → Prometheus/Grafana/Loki/Tempo |

## 4. Domain module design (M01–M21)
* Each module = a folder in `packages/domain` with: entities, commands, queries, events, policies,
  read models. Hexagonal: modules never import adapters.
* **Events**: every state change emits a versioned domain event (`study.signed.v1`) into the outbox
  table, published to the queue, consumed by projections, analytics, integrations and agents.
* **Multi-tenancy**: every row carries `practice_id`; row-level security in Postgres; D1 uses one
  database per tenant group with an application guard. Group/MSO cross-tenant queries go through
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
| Data residency | Identified data stored in South Africa (Cloudflare: Jurisdictional Restrictions/regional services where available; internal: SA data centres) |
| Retention | Images and reports ≥ 6 years adults (HPCSA guidance), until 21st birthday + 6 years for minors, longer for mammography/occupational records (ODMWA/COIDA); configurable per record class |
| Backup / DR | RPO 15 min, RTO 4 h; cross-region replica; quarterly DR tests |
| Security | See 15: zero trust, MFA, encryption at rest and in transit, key management, audit immutability |
| Accessibility | WCAG 2.2 AA |
| Observability | Every request traced; every event replayable; SLO dashboards per module |
