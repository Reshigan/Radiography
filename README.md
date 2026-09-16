# Bonakala — National Radiography Chain Platform for South Africa

**Everything, made visible.**

This repository is the complete product specification for Bonakala: a national diagnostic-imaging
chain (wholly owned practices, joint ventures and hospital sites) and the single platform that runs
it: scheduling, registration, acquisition, PACS, AI-assisted reporting, closed-loop results,
automated billing and collections, practice and joint-venture finance, workforce, assets, compliance
and analytics, with autonomous agents ("Hands") under a no-slip AI safety charter.

The Platform runs **entirely on Cloudflare in the cloud** (production, staging and a public demo on
synthetic data) and as an optional **internal Docker/Kubernetes** stack for self-hosting, from one
codebase, with a per-site Edge Gateway for load-shedding resilience and on-site DICOM.

## Start here
| Read | For |
|---|---|
| `docs/01-executive-summary.md` | The one-page picture |
| `docs/00-conventions.md` | Names, modules M01–M21, personas, automation levels, the AI-slip definition |
| `docs/20-build-kickoff-claude-code.md` | Exactly how to open a Claude Code session and build this |
| `CLAUDE.md` | The rules the build session follows |
| `brand/styleguide.html` | Open in a browser: the design language, lenses and Window/Level control |
| `brand/screens/index.html` | Open in a browser: high-fidelity mockups of the principal screens for every persona (PNG previews in `brand/screens/previews/`) |

## Specification map
| # | Document |
|---|---|
| 00 | `docs/00-conventions.md` |
| 01 | `docs/01-executive-summary.md` |
| 02 | `docs/02-south-africa-context-and-regulation.md` |
| 03 | `docs/03-organisation-and-shareholding-model.md` (Group, MSO, subsidiaries, JVs, hospital JVs) |
| 04 | `docs/04-personas.md` |
| 05 | `docs/05-brand-identity.md` |
| 06 | `docs/06-design-system-frontend.md` |
| 07 | `docs/07-platform-architecture.md` |
| 08 | `docs/08-domain-model-and-data.md` |
| 09 | `docs/processes/` — end-to-end processes: |
|    | `01-referral-and-orders.md` · `02-scheduling-and-capacity.md` · `03-funding-and-authorisation.md` · `04-registration-checkin-and-safety.md` |
|    | `05-acquisition-worklist-qa-and-dose.md` · `06-image-management-pacs.md` · `07-reporting-and-peer-review.md` · `08-results-critical-findings-and-distribution.md` |
|    | `09-revenue-cycle-billing-and-claims.md` · `10-finance-consolidation-and-distributions.md` · `11-operations-equipment-and-workforce.md` · `12-quality-risk-and-compliance.md` |
| 10 | `docs/journeys/` — one journey per persona (patient, referrer, front desk, booking, radiographer, radiologist, nurse, billing, debtors, practice manager, executive, shareholder, compliance, biomedical/IT, AI operations, support) |
| 11 | `docs/11-ai-catalogue-and-agentic-automation.md` (every model, every Hand) |
| 12 | `docs/12-ai-safety-no-slip-charter.md` |
| 13 | `docs/13-analytics-and-kpis.md` |
| 14 | `docs/14-integrations-and-interoperability.md` |
| 15 | `docs/15-security-privacy-and-popia.md` |
| 16 | `docs/16-deployment-cloudflare-demo.md` (cloud on Cloudflare: production, staging, demo) |
| 17 | `docs/17-deployment-docker-internal.md` (internal / self-hosted option) |
| 18 | `docs/18-competitive-differentiation.md` |
| 19 | `docs/19-roadmap-and-release-plan.md` |
| 20 | `docs/20-build-kickoff-claude-code.md` |
| 21 | `docs/21-glossary.md` |
| 22 | `docs/22-image-analysis-specification.md` (AI analysis of the images: pipeline, models, training, validation, deployment) |
| 23 | `docs/23-image-analysis-guide.md` (guide for radiologists, radiographers, engineers and AI operations) |
| 24 | `docs/24-statutory-and-regulatory-register.md` (every statute and obligation mapped to controls and outputs; imaging results with statutory reporting duties; items awaiting legal confirmation) |
| 25 | `docs/25-ui-specification.md` (information architecture, every screen with layout, actions and states, key flows; mockups in `brand/screens/`) |

## Brand and infrastructure references
* `brand/tokens.json`, `brand/bdl.css`, `brand/logo.svg`, `brand/logo-dark.svg`, `brand/styleguide.html`, `brand/screens/*.html`
* `infra/cloudflare/wrangler.toml`, `infra/docker/docker-compose.yml`, `infra/docker/.env.example`,
  `infra/docker/orthanc/orthanc.json`, `infra/edge-gateway/docker-compose.yml`, `.github/workflows/ci.yml`

## Running the platform
The application code lives in `apps/` and `packages/` (pnpm monorepo, TypeScript). One codebase runs on
Cloudflare (Worker + D1 + R2 + Queues, serving the built web app as static assets) and on Node/Docker
(SQLite via libsql; see `docs/decisions/ADR-001-storage-dialect.md`).

```bash
corepack enable && pnpm install
pnpm dev                    # API on http://localhost:8787 (Node, demo seed) + web on http://localhost:5173
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e:smoke
pnpm --filter @bonakala/api dev:worker      # same API on the Workers runtime (local D1/R2)
docker compose -f infra/docker/docker-compose.yml up --build   # self-hosted: web on :8080, api on :8787
```
Demo sign-ins: every persona has `<persona>@demo.bonakala` (for example `rgt@demo.bonakala`), password
`bonakala-demo`. All data is synthetic and the demo re-seeds itself on an empty database.

Cloudflare: `infra/cloudflare/wrangler.toml` (environments demo, staging, production); CI in
`.github/workflows/ci.yml` runs lint, typecheck, unit tests, the Worker bundle dry run and the Playwright
smoke test, and deploys the demo environment from `main` when Cloudflare secrets are configured.

## Status
Specification complete; platform build in progress on this branch (foundation, all 21 modules, demo).

## Legal notes
"Bonakala" and the mark are working names pending trademark clearance (see `docs/05`). Fonts are
SIL OFL. Scheme, regulator and vendor names appear descriptively only. All tariff codes, prices and
statistics in this specification are illustrative and are stored as configurable reference data in
the Platform.
