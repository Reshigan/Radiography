# 17 — Deployment: Internal Docker and Kubernetes (On-Premise / Private Cloud)

## 1. Purpose and scope

This document specifies how the Bonakala Platform is deployed for real clinical operation: identified
patient data, real modalities, real claims switches, real funders, real money. It covers the central
cluster, the per-site Edge Gateway, networking, storage, backup and disaster recovery, hardening,
upgrades, monitoring, capacity tiers, LLM connectivity, licensing obligations, operating roles and the
per-site go-live checklist. The demo deployment (16) is the same codebase with simulated adapters; the
differences are called out in 16 §11.

Design constraints that shape everything below:

* **Load-shedding and link failure are normal.** Imaging must continue at every site with no power grid
  and no internet (07 §5). The Edge Gateway is not optional.
* **Data residency.** Identified data is stored in South Africa (07 §10, POPIA s.72 for transfers).
* **Practices are tenants and separate responsible parties under POPIA.** Row-level security in
  Postgres is the primary isolation mechanism; the MSO operates as *operator* under recorded
  agreements (03 §3.2, M02-R-004).
* **Regulated components stay separate.** SAHPRA-registered vendor AI models run as separate
  containers behind the BCI adapter contract; GPL/AGPL services (Orthanc, MinIO, Grafana stack) run as
  separate processes reached over REST, never linked (07 §9).

### 1.1 Requirements (M21 Platform Core, internal profile)

* M21-R-120 The internal deployment MUST run the identical application images for `apps/api`,
  `apps/web`, `apps/agents`, `apps/whatsapp` and `apps/edge-gateway` as tagged in the release, with
  behaviour selected by configuration and feature flags only.
* M21-R-121 Every site MUST have an Edge Gateway that provides DICOM Modality Worklist, MPPS, C-STORE
  receipt, local 30-day image cache and store-and-forward to the central archive, and MUST keep
  accepting images with no central connectivity for at least 72 hours.
* M21-R-122 The central cluster MUST meet RPO 15 minutes and RTO 4 hours (07 §10) with a documented,
  quarterly-tested restore procedure.
* M21-R-123 All application images MUST be signed (cosign) and carry an SBOM; the cluster MUST refuse
  unsigned images (admission policy) and the Edge Gateway MUST verify signatures before update.
* M21-R-124 Identified clinical data MUST NOT leave the SA hosting boundary except through the LLM
  egress gateway with de-identification (§12) or through integrations with a recorded lawful basis.
* M21-R-125 The single-node docker-compose profile MUST be sufficient for a one-site pilot of up to
  60 000 studies per year and MUST be upgradeable in place to the Kubernetes profile without data
  conversion.

## 2. Topology

```
                          ┌────────────────────────────────────────────────────┐
                          │          Central cluster (SA data centre / VPC)     │
   Hospital HIS ─MLLP─▶   │  caddy/traefik (TLS)  keycloak  api  web  agents   │
   Claims switch ◀─EDI─▶  │  whatsapp  scheduler  inference(GPU)  orthanc-central│
   Funders / PSP ◀─API─▶  │  postgres16+pgvector  valkey  nats  minio/seaweedfs │
   LLM egress gateway ──▶ │  meilisearch  otel-collector  prometheus  grafana   │
                          │  loki  tempo  backup-agent                          │
                          └─────────────────────┬──────────────────────────────┘
                                                │  WireGuard / private link (site VPN)
              ┌─────────────────────────────────┼──────────────────────────────┐
              ▼                                 ▼                              ▼
   ┌───────────────────┐            ┌───────────────────┐           ┌───────────────────┐
   │ Edge Gateway      │            │ Edge Gateway      │           │ Edge Gateway      │
   │ Site: Sandton     │            │ Site: Umhlanga    │           │ Site: hospital JV │
   │ orthanc-edge      │            │ orthanc-edge      │           │ orthanc-edge      │
   │ gateway (Node)    │            │ gateway (Node)    │           │ gateway + MLLP    │
   │ qc-inference      │            │ qc-inference      │           │ qc-inference      │
   │ watchdog, UPS     │            │ watchdog, UPS     │           │ watchdog, UPS     │
   └───┬───────┬───────┘            └───────────────────┘           └───────────────────┘
       │DICOM  │DICOM (modality VLAN)
     CT / DX / MG / US / MR ...
```

* **Central cluster**: either a private cloud (VMware, Proxmox, OpenStack) or a South African region
  of a public cloud, or a co-located rack. The Platform is cloud-agnostic; only the object store and
  block storage classes change.
* **Edge Gateway**: one appliance per site (two for sites with more than four modalities or a
  hospital JV with HL7 feeds). Sites talk only to the central cluster over an encrypted tunnel.
* **Reading Hub** radiologists connect to the central cluster over zero-trust remote access; the
  Reading Room viewer streams from orthanc-central via DICOMweb through the API.

## 3. Deployment profiles and services

### 3.1 Profiles

| Profile | Use | Orchestration | Reference |
|---|---|---|---|
| **Single-node pilot** | One Practice, one to three sites, up to ~60 000 studies/year | docker-compose on one server (plus Edge Gateways) | `infra/docker/docker-compose.yml` |
| **Production** | Multi-practice, 10 to 300+ sites | Kubernetes with the Helm chart in `infra/k8s` (three control-plane nodes, worker pools: general, database, GPU) | `infra/k8s/` (to be written from the compose reference) |
| **Edge Gateway** | Every site | docker-compose on the appliance, managed by the fleet updater | `infra/edge-gateway/docker-compose.yml` |

The compose file is the source of truth for service contracts (ports, env, health checks, volumes); the
Helm chart mirrors it with StatefulSets for stateful services and Deployments with HPA for stateless
ones.

### 3.2 Central services

| Service | Image (illustrative) | Role | Stateful | Notes |
|---|---|---|---|---|
| `caddy` (or `traefik`) | official | TLS termination, HTTP/3, reverse proxy, ACME or internal CA | certs volume | Internal CA for private hostnames; public certs for patient/referrer hostnames |
| `web` | `bonakala/web` (Nginx serving `apps/web` build) | Persona surfaces, PWA | no | Immutable build per release; runtime config via `/config.json` |
| `api` | `bonakala/api` (Node 22, Hono) | M01–M21 domain API, webhooks, outbox publisher | no | Scale horizontally; sticky sessions not required |
| `agents` | `bonakala/agents` | Agent Runtime (Hands) queue consumers | no | Budget and leash enforcement; checkpoints in Postgres |
| `whatsapp` | `bonakala/whatsapp` | WhatsApp Cloud API webhook and conversation engine | no | Public hostname behind caddy; signature-verified |
| `scheduler` | `bonakala/scheduler` | Cron-like publisher to NATS (reminders, claims runs, dunning, month-end, retention) | leader election via Postgres advisory lock | Equivalent of Cloudflare Cron Triggers |
| `inference` | `bonakala/inference` (Python, FastAPI, ONNX Runtime / TensorRT) | BCI model server; hosts in-house models and proxies vendor containers | model cache volume | GPU profile; CPU fallback for QC models |
| `vendor-model-*` | vendor supplied | SAHPRA-registered third-party models behind the `bci.result.v1` contract | vendor-defined | Isolated network; only `inference` may reach them |
| `postgres` | `postgres:16` with `pgvector`, `pg_partman` | System of record; RLS per Practice; partitioned event and audit tables | yes | Primary + streaming replica (+ cross-site replica for DR) |
| `valkey` | `valkey/valkey:8` | Sessions, feature flags, rate limits, short locks | ephemeral (AOF optional) | BSD licence, preferred over newer Redis |
| `nats` | `nats:2` with JetStream | Queues, outbox stream, scheduled jobs, inference jobs | yes | Three-node cluster in production |
| `minio` or `seaweedfs` | `minio/minio` (AGPL) or `chrislusf/seaweedfs` (Apache-2.0) | Object store: DICOM archive tiers, PDFs, documents, backups | yes | S3 API; erasure coding; versioning and object lock |
| `meilisearch` | `getmeili/meilisearch` | Patient/study/claim search | yes | Postgres FTS is the fallback |
| `orthanc-central` | `jodogne/orthanc-plugins` (GPLv3) | Central DICOM archive: DICOMweb (WADO-RS/QIDO-RS/STOW-RS), C-STORE from gateways, routing to referrer PACS | index in Postgres, images in object store | Separate container; REST only |
| `keycloak` | `quay.io/keycloak/keycloak` | OIDC/SAML SSO, MFA, federation to Practice IdPs | Postgres schema | Realm export in `infra/docker/keycloak/` |
| `otel-collector` | `otel/opentelemetry-collector-contrib` | Traces, metrics, logs pipeline | no | Receives OTLP from all services and gateways |
| `prometheus` | official | Metrics and alert rules | yes | Remote-write to a long-term store optional |
| `grafana` | official (AGPL) | Dashboards; SLOs per module | yes | Separate service; OIDC to Keycloak |
| `loki` | official (AGPL) | Logs | object store backend | |
| `tempo` | official (AGPL) | Traces | object store backend | |
| `backup-agent` | `bonakala/backup` (wraps `pgbackrest` and object replication) | PITR, off-site copies, restore drills | no | Runs on a schedule; reports to Prometheus |

### 3.3 Edge Gateway services

| Service | Role |
|---|---|
| `orthanc-edge` | DICOM SCP for modalities (C-STORE), MWL SCP, MPPS SCP, 30-day local store, forwards to `orthanc-central` (resumable, throttled) |
| `gateway` | Node service: worklist mirror, demographics cache, offline technologist API, HL7 MLLP listener (hospital sites), transfer manager, telemetry, enrolment and update agent |
| `qc-inference` | ONNX Runtime (CPU or small GPU) positioning/exposure QC models; results as `bci.result.v1`; triage jobs queued for central when the link returns |
| `watchdog` | Health checks, UPS monitoring (NUT), disk pressure, self-healing restarts, signed update application, link tests |

## 4. Networking

### 4.1 Segmentation

| Segment | Contents | Rules |
|---|---|---|
| **Modality VLAN** (per site) | CT, DX, MG, US, MR, DXA, injectors, dose-tracking devices | Only the Edge Gateway may talk to modalities: DICOM (default 104 or 11112, illustrative and configurable) inbound to `orthanc-edge`, MWL/MPPS queries from modalities; no internet; no user devices |
| **Clinical VLAN** (per site) | Technologist consoles, front-desk PCs, kiosks, diagnostic workstations | HTTPS to the Edge Gateway (offline API) and to the central cluster over the site tunnel |
| **Site management** | Edge Gateway management interface, UPS, switches | SSH only from the SUP bastion via the tunnel |
| **Central services** | Kubernetes/compose networks: `frontend` (caddy, web, api, whatsapp), `backend` (postgres, valkey, nats, minio, meilisearch, orthanc-central), `ai` (inference, vendor models), `observability` | NetworkPolicies default-deny; explicit allow per service pair |
| **Integration DMZ** | MLLP listeners for hospitals, switch adapters, PSP webhooks | Allow-listed peers by IP and mTLS where the peer supports it |

### 4.2 Ports and protocols (illustrative defaults, configurable)

| Flow | Protocol / port | Direction |
|---|---|---|
| Modality to Edge Gateway | DICOM C-STORE, C-FIND (MWL), N-CREATE/N-SET (MPPS); TCP 104 or 11112 | inbound to gateway |
| Edge Gateway to central | WireGuard UDP 51820 tunnel; inside: HTTPS 443 to API, DICOM TLS 2762 or DICOMweb STOW-RS over HTTPS to orthanc-central | outbound from site |
| Hospital HIS to Platform | HL7 v2 MLLP TCP 2575 (illustrative), over the hospital's private link or the site gateway | inbound to gateway or central DMZ |
| Users to Platform | HTTPS 443 (HTTP/3 where available) | inbound |
| Claims switch | HTTPS or SFTP as per switch, outbound from central DMZ | outbound |
| WhatsApp Cloud API, SMS aggregator, PSP | HTTPS outbound; webhooks inbound on public hostnames | both |
| LLM egress gateway | HTTPS outbound to the Claude API from one egress point only | outbound |
| Referrer PACS push | DICOM TLS or DICOMweb from orthanc-central | outbound |

### 4.3 Connectivity to hospitals and remote access

* **Hospital JV sites**: a private link or site-to-site VPN between the hospital network and the Edge
  Gateway's integration interface; ADT/ORM/ORU over MLLP terminate at the gateway which forwards to
  the central integration bus (M21). No Platform component is reachable from the hospital network
  except the MLLP listener.
* **Zero-trust remote access** for radiologists (Hub), SUP and vendors: an identity-aware proxy in
  front of caddy (Keycloak-authenticated, device posture check optional), per-app policies, no full
  VPN for users. Vendor remote service on modalities goes through a brokered, recorded session on
  the modality VLAN via the gateway, never direct.
* **Site links**: primary fibre or LTE/5G with an LTE failover on the gateway; the transfer manager
  adapts throughput to link class and prioritises STAT studies.

## 5. Edge Gateway appliance specification

| Item | Minimum (up to 3 modalities) | Recommended (4 to 8 modalities, CT/MR) |
|---|---|---|
| CPU | 6 cores x86-64 (or 8-core ARM) | 8 to 12 cores |
| RAM | 16 GB ECC preferred | 32 GB ECC |
| Storage | 1 TB NVMe (OS + 30-day cache) in a mirrored pair | 2 to 4 TB NVMe mirrored; sized by §6 |
| GPU | none (CPU QC inference) | small inference GPU (8 to 16 GB) for on-site triage models |
| Network | 2 × 1 GbE (modality VLAN, clinical/uplink) | 2 × 2.5 GbE or 10 GbE + LTE/5G modem |
| UPS | line-interactive, 30 to 60 minutes for gateway + switch, USB/SNMP signalling (NUT) | online double-conversion; modality UPS separate |
| Form factor | fanless industrial PC or 1U short-depth server | 1U server |
| OS | Ubuntu LTS, unattended security updates, full-disk encryption (TPM-sealed key) | same |

Behaviours:

* **Enrolment**: SUP creates the site in M02 and issues a site code and a one-time token. The
  appliance boots the enrolment image, the technician enters the code and token, the gateway generates
  its WireGuard and mTLS identities, registers with the central cluster, receives its configuration
  (AE titles, modality list, worklist scope) and starts. Zero further typing.
* **Update channel**: `stable`, `canary`, `pinned`. The watchdog polls the release registry, verifies
  cosign signatures and the SBOM digest, pulls images, and applies during the site's maintenance
  window with automatic rollback if health checks fail within 10 minutes.
* **Offline behaviour**: with the central link down, modalities keep working (MWL from the local
  mirror, C-STORE to `orthanc-edge`, MPPS recorded locally); technologists use the offline console
  (PWA plus gateway API) for check-in confirmations, safety checklists and repeat/reject capture;
  local QC inference continues; the gateway queues events, images and triage requests and drains
  them when the link returns, STAT first. Front desk and billing functions that need central data
  degrade to read-only cached views with a clear Beam banner.
* **Store-and-forward**: resumable multipart transfers, per-study checksums, backlog visible on the
  BIO dashboard and on the gateway's local status page; STAT studies pre-empt bulk.
* **Power**: on UPS "on battery" the gateway informs the technologist console (a banner with runtime
  remaining), pauses non-urgent transfers, and shuts down cleanly at the low-battery threshold; on
  power return it resumes automatically.
* **Local QC inference**: positioning/exposure models run on CPU in under 5 seconds per image
  (illustrative target); triage priorities that need larger models run centrally or on the
  recommended GPU appliance.

## 6. Storage sizing model

Per-study sizes are illustrative planning values stored as reference data (M18) and refined from
observed data per site.

| Modality | Typical study size (compressed, JPEG 2000 or JPEG-LS lossless) | Studies/year per unit (illustrative) | Growth per unit per year |
|---|---|---|---|
| DX / CR | 20 to 40 MB | 12 000 | ~0.4 TB |
| MG (incl. tomosynthesis) | 150 MB to 1.5 GB | 4 000 | 0.6 to 6 TB |
| CT | 200 MB to 1 GB | 8 000 | 1.6 to 8 TB |
| MR | 100 to 500 MB | 4 000 | 0.4 to 2 TB |
| US | 20 to 100 MB (cine higher) | 6 000 | 0.1 to 0.6 TB |
| DXA, PX, RF, NM | 5 to 100 MB | 3 000 | small |

Tiering:

| Tier | Where | Age | Media |
|---|---|---|---|
| Hot | `orthanc-edge` local cache | 0 to 30 days at site | NVMe |
| Warm | `orthanc-central` fast object store | 0 to 18 months | SSD-backed object storage, erasure coded |
| Cold | object store cold class (or a second cluster on HDD) | 18 months to retention end | HDD erasure coded, versioned, object lock |
| Archive copy | off-site immutable bucket (second SA data centre) | all | HDD or tape gateway |

Retention (07 §10): adults ≥ 6 years from last treatment; minors until 21st birthday plus 6 years;
mammography and occupational (ODMWA/COIDA) longer per configurable record class; deletion only by
the M09 retention job with CMP approval and an audit record. Priors are recalled from cold to warm by
the prefetch service when an appointment is booked (M09) so the Reading Room never waits on cold
storage.

Postgres sizing: roughly 2 to 4 KB per study across clinical rows plus 1 to 2 KB per claim line, plus
events and audit (partitioned monthly, older partitions moved to cheaper tablespaces or archived to
object store as Parquet through the analytics layer).

## 7. Backup and disaster recovery

| Asset | Method | Frequency | RPO | Off-site |
|---|---|---|---|---|
| Postgres | `pgbackrest` full weekly, differential daily, continuous WAL archiving to object store | continuous | ≤ 15 min | WAL and backups replicated to the second data centre; streaming replica there |
| Object store (imaging, documents) | Bucket versioning + object lock (compliance mode) + cross-site replication | continuous | ≤ 15 min | Immutable copy in a second SA data centre; cold tier also mirrored |
| Orthanc index | In Postgres (covered) plus a nightly rebuild test from object store | daily | n/a | covered |
| Keycloak realm, configuration, secrets (encrypted) | Export to versioned object store; SOPS-encrypted git | daily / on change | 24 h | yes |
| NATS JetStream | Replicated streams; outbox in Postgres is the source of truth so streams are rebuildable | n/a | n/a | n/a |
| Meilisearch / Valkey | Rebuildable from Postgres | n/a | n/a | n/a |
| Edge Gateway | Configuration held centrally; images re-fetchable from central once forwarded; local cache not backed up | n/a | n/a | n/a |
| Observability data | 30 to 90 days; not part of DR scope | n/a | n/a | optional |

Disaster recovery:

* **Warm standby** in a second South African data centre: Postgres streaming replica, replicated
  object store, a minimal Kubernetes cluster with the Helm release applied but scaled to zero.
  Failover: promote the replica, scale up, switch DNS (short TTL), re-point gateways (they learn the
  standby address at enrolment). RTO target 4 hours; drill target 2 hours.
* **Restore drills** quarterly: restore Postgres to a point in time on an isolated environment,
  rebuild the Orthanc index, open a random sample of 50 studies, replay one day of outbox events,
  and record results in M19 as evidence.
* Sites keep operating on their Edge Gateways during a central outage; the drain after recovery is
  monitored and STAT-first.

## 8. Security hardening

* **Baseline**: CIS Benchmarks for Ubuntu, Docker and Kubernetes; automated scanning (kube-bench,
  docker-bench) in the platform CI against a reference cluster; findings tracked in M19.
* **Secrets**: SOPS with age keys for configuration in git (never plaintext); HashiCorp-Vault-class
  secret manager (or the cloud provider's KMS-backed store) for runtime secrets injected as files;
  database credentials rotated automatically; per-service identities. The `.env` file in the compose
  profile is for pilot only and is generated from SOPS at deploy time.
* **Supply chain**: every image built in CI, signed with cosign (keyless with the CI identity),
  SBOM (SPDX) attached as an attestation, vulnerability scanned; admission controller (Kyverno or
  Sigstore policy-controller) enforces signatures; the Edge watchdog verifies before pull.
* **Encryption**: TLS 1.2+ everywhere including inside the cluster (mTLS via the proxy layer or
  service mesh), DICOM TLS between gateways and central, full-disk encryption on gateways, encrypted
  volumes and object store SSE with KMS keys; keys per Practice for documents where required.
* **Identity**: Keycloak with MFA enforced for all staff; HPCSA registration verification at
  onboarding (M01); break-glass access with time-boxed elevation and CMP notification.
* **Audit immutability**: audit tables append-only with hash chaining, exported daily to
  object-locked storage.
* **Host hardening**: no SSH passwords, bastion only, unattended upgrades, kernel live-patching where
  available, AppArmor profiles for containers, read-only root filesystems, non-root users, dropped
  capabilities.
* **Network**: default-deny policies, egress restricted to named endpoints, IDS on the integration DMZ.
* **Vulnerability management**: weekly scans, SLAs by severity (critical 7 days), monthly patch window
  for the fleet.

## 9. Upgrades

* **Application (central)**: blue/green at the proxy layer. The new release is deployed alongside,
  smoke-tested against the live database (migrations are expand-only, see below), then traffic is
  switched; the old release stays for 24 hours for instant rollback.
* **Database migrations**: expand/contract. Release N adds columns, tables and backfills; release N+1
  removes the old shapes after every consumer is upgraded. Migrations run as a Kubernetes Job (or
  compose one-shot) before the switch, are idempotent, and are tested on a restored production copy
  in staging on every release. Migrations that rewrite large partitions run in batches with
  `pg_partman` awareness.
* **Stateful services**: Postgres minor versions rolling on the replica first; major versions via
  logical replication cut-over in a planned window. Orthanc, Keycloak and MinIO upgrades follow vendor
  procedures on staging first.
* **Edge fleet rollout waves**: `canary` (two internal sites) for 48 hours, then wave 1 (10 %), wave 2
  (50 %), wave 3 (100 %), each gated on fleet health (no increase in transfer failures, MWL errors or
  restarts). A site can be pinned by BIO during an accreditation visit or a modality installation.
* **Compatibility**: gateways may run one minor version behind central; the API version-negotiates.

## 10. Monitoring, alerting and runbooks

Every service exports OTLP to the collector; Prometheus rules generate alerts; Grafana holds per-module
SLO dashboards (07 §10). Alerts route to SUP on-call with escalation to BIO (site or modality issues)
and AIO (model issues).

| Alert (illustrative) | Condition | Severity | Runbook summary |
|---|---|---|---|
| Gateway offline | No telemetry for 5 min | P2 (P1 if STAT backlog) | Check site power (UPS state), link; call site; if hardware, dispatch spare appliance (enrol with site code) |
| Transfer backlog | > 200 studies or > 2 h age | P2 | Check link throughput, throttle settings, central STOW-RS errors; prioritise STAT |
| MWL failures | Modality C-FIND errors > 5 in 10 min | P1 | Verify AE title config, gateway service health, worklist mirror freshness |
| Postgres replication lag | > 5 min | P2 | Check WAL shipping, disk, network; escalate to DB runbook |
| Queue lag | NATS consumer lag > 10 min on `claims` or `inference` | P2 | Scale consumers; check poison messages in DLQ |
| Inference latency | P95 > 60 s for triage models | P3 (P2 if STAT) | GPU saturation, model container health, vendor endpoint |
| Model performance proxy | Override rate drift > threshold | P3 to AIO | Model registry entry, hold model if required (M11) |
| Certificate expiry | < 14 days | P3 | ACME renewal or internal CA re-issue |
| Backup failure | Any failed backup or drill | P2 | Re-run; if two consecutive failures, P1 |
| Licence expiry | Room licence < 30 days | P3 to CMP | M02-R-006 scheduling block if expired |
| Security | Unsigned image pull attempt, admission denial | P1 | Investigate source; freeze rollout |

Runbooks live in the SUP knowledge base (M21) as versioned Markdown linked from every alert.

## 11. Capacity guidance per tier

| Tier | Sites / studies per year | Central compute (illustrative) | Storage year 1 | Notes |
|---|---|---|---|---|
| **Pilot** (1 site, docker-compose) | 1 site, ≤ 60 000 studies | 1 server: 16 cores, 128 GB RAM, 4 TB NVMe, optional GPU; plus one Edge Gateway | 5 to 15 TB object storage | Single-node; nightly backups off-site mandatory; no HA (accepted for pilot) |
| **Regional** (10 sites) | ≤ 600 000 studies, ~300 users | Kubernetes: 3 control plane, 6 to 8 general workers (8 cores/64 GB), 3 DB nodes, 1 to 2 GPU nodes | 60 to 150 TB | Postgres HA with replica; NATS 3-node; object store erasure-coded across 4+ nodes |
| **National** (100+ sites) | 3 to 10 M studies, 3 000 users | 20 to 40 general workers, dedicated DB pool with read replicas, 4 to 8 GPU nodes, separate ingest pool for orthanc-central | 0.5 to 2 PB tiered | Multi-AZ or dual data centre; sharded object store; dedicated integration DMZ; separate analytics warehouse |

Scaling levers: `api` and `agents` scale horizontally on CPU and queue lag; `orthanc-central` scales by
sharding archives per region with a routing layer; Postgres scales up first, then read replicas for
analytics; inference scales by GPU node pool with model-specific queues.

## 12. LLM connectivity options

Hands and drafting use the Claude API by default (07 §7). Internally, no identified data may reach the
provider without controls:

| Option | Description | When |
|---|---|---|
| **Claude API through the egress gateway with de-identification** (default) | All LLM calls pass through the `llm-gateway` service: it enforces per-Hand budgets and rate limits, applies the de-identification pipeline from `packages/dicom` (DICOM tags) and the text de-identifier (names, ID numbers, contact details, addresses replaced with reversible tokens held only in the gateway), logs prompts and completions without identifiers, and re-identifies responses inside the boundary. Uses prompt caching and structured outputs. | All tenants, unless a Practice's data-sharing agreement requires otherwise |
| **Private model adapter** | The `LLM` port implemented against a self-hosted open-weights model served by the `inference` service (or a dedicated LLM node) for tasks that must not leave the boundary even de-identified, or for offline continuity | Configured per output class in the AI registry (M11); lower capability accepted for those tasks |
| **Hybrid** | Classification and extraction on the private model; reasoning Hands on Claude with de-identified context | Default recommendation for national tier |

Model choice per task follows 07 §7 and is recorded as provenance on every output (model id, version,
gateway request id). The egress gateway is the only component with internet access to the provider.

## 13. Licensing obligations for bundled open-source software

The Platform's own code is proprietary. Bundled services are used unmodified as separate containers
communicating over network protocols, which keeps the Platform outside the scope of GPL/AGPL
copyleft (07 §9). Obligations are still real:

| Component | Licence | Obligation | How met |
|---|---|---|---|
| Orthanc and plugins | GPLv3 | Offer corresponding source of the distributed binaries; keep licence notices | `infra/docker/orthanc/SOURCE.md` records the exact image digest and upstream source URL; a source tarball is mirrored in the release artefacts; NOTICE file in the installer |
| MinIO | AGPLv3 | Network use counts as distribution: source of the exact version must be available to users interacting with it | Unmodified upstream image pinned by digest; source link and version shown in the SUP console "About" page; alternative SeaweedFS (Apache-2.0) supported |
| Grafana, Loki, Tempo | AGPLv3 | Same as MinIO | Unmodified; source links in About page; observability is internal-only |
| Keycloak, NATS, OpenTelemetry, ONNX Runtime | Apache-2.0 / MIT | Notices | NOTICE file |
| PostgreSQL, Valkey, Meilisearch, Caddy | PostgreSQL / BSD / MIT / Apache-2.0 | Notices | NOTICE file |
| Vendor AI models | Commercial | Per contract; SAHPRA registration evidence in the model registry | M11 registry entry with licence terms and expiry |

Rule: no modification of GPL/AGPL images. If a modification is ever necessary, the modified source is
published under the same licence and the change is recorded in M19.

## 14. Operations roles (SUP)

| Role | Responsibilities | On-call |
|---|---|---|
| Platform on-call engineer | Alerts, incident command, rollbacks, restores | 24 × 7 rota |
| Fleet engineer | Edge Gateway enrolment, updates, spares, site network liaison | business hours + escalation |
| Database administrator | Postgres health, PITR, migrations review, capacity | business hours + escalation |
| Integration engineer | HL7/DICOM/switch/PSP connectivity, message replay | business hours |
| Security engineer | Hardening, scanning, key rotation, access reviews | business hours + P1 |
| AI operations (with AIO) | Model deployment, monitoring, holds | business hours |
| Release manager | Blue/green, waves, release notes, change advisory | per release |
| Tenant onboarding lead | Practice/site onboarding, go-live checklist, training hand-off | per project |

## 15. Go-live checklist per site

1. **Organisation** (M02): Practice, Site, Rooms and Modalities created; BHF practice number, HPCSA
   principals, SAHPRA licences with expiry and RPO, POPIA Information Officer recorded; agreements
   uploaded.
2. **Network**: modality VLAN provisioned; firewall rules applied; site tunnel up; LTE failover tested;
   hospital private link tested (JV sites).
3. **Edge Gateway**: appliance installed on UPS; enrolled with site code; storage mirror healthy;
   update channel set; watchdog reporting; offline drill performed (pull the uplink for 30 minutes,
   confirm MWL and C-STORE continue, confirm drain).
4. **Modalities**: each modality configured with gateway AE title, MWL and MPPS; test patient (synthetic,
   flagged) studies sent for every modality; DICOM conformance recorded in M18; dose SR verified (M10).
5. **Identity**: staff accounts created in Keycloak with MFA; HPCSA numbers verified (M01); roles
   assigned per persona; break-glass tested.
6. **Integrations**: claims switch certified for the practice number (test claims accepted and
   rejected correctly); PSP live; SMS/WhatsApp sender verified; HL7 feeds validated with the hospital;
   referrer PACS push tested.
7. **Reference data** (M14): tariff codes, scheme rule packs, DSP contracts, price lists loaded and
   dated; ICD-10 version confirmed.
8. **Data migration**: legacy patient index and priors imported (where agreed) with de-duplication
   report signed by PRM; historical debtors loaded and reconciled with DEB.
9. **Safety and compliance** (M19): consent forms, safety questionnaires, radiation signage and QA
   schedules in place; CMP sign-off.
10. **Observability**: site dashboard live; alerts routed; runbook contacts confirmed.
11. **Backup**: site included in central backup scope; restore drill ticket scheduled.
12. **Training and support**: personas trained on their consoles; hyper-care rota for the first
    two weeks; SUP contact on the technologist console status page.
13. **Go-live decision**: PRM, BIO, CMP and the tenant onboarding lead sign the checklist in M19; the
    site status flips to `live` and scheduling opens.

## 16. KPIs and controls

| KPI | Target |
|---|---|
| Platform availability (central) | 99.9 % monthly |
| Imaging continuity at sites (MWL and C-STORE availability) | 100 % during central or link outages |
| Backup RPO achieved | ≤ 15 min |
| Restore drill RTO achieved | ≤ 4 h (target 2 h) |
| Fleet on latest or previous minor | ≥ 95 % of gateways |
| Critical vulnerability remediation | ≤ 7 days |
| Unsigned image admissions | 0 |
| Identified data egress outside the boundary | 0 (any occurrence is a P1 and a POPIA incident review) |

Controls: change advisory for every production release; quarterly access review; quarterly restore
drill; annual penetration test; annual review of OSS licence obligations; SAHPRA and HPCSA evidence
exported from M19 on request.
