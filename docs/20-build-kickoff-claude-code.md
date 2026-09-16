# 20 — Build Kickoff: Opening a Claude Code Session for the Build

This document is the operating manual for turning this specification into working software with
Claude Code. It assumes the specification (this repository) is the single source of truth and that
`CLAUDE.md` at the repository root is kept current.

## 1. Prerequisites (one-time)

| Item | Notes |
|---|---|
| Git access to `Reshigan/Radiography` | Development branch per feature; `main` protected |
| Node.js 22 LTS, pnpm 9, Turborepo | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker Desktop / Docker Engine + Compose v2 | For the Edge Gateway appliance, Cloudflare Containers images and the internal (self-hosted) stack |
| Cloudflare account(s) | Workers Paid plan; separate accounts for production, staging and demo recommended; Zero Trust, R2, D1, Queues, Workflows, Containers, AI Gateway enabled; `wrangler` CLI |
| Anthropic API key (for the Hands and LLM Gateway) | Stored as a secret (`wrangler secret put ANTHROPIC_API_KEY`, or `.env` locally). Never commit keys. |
| Claude Code | CLI: `npm install -g @anthropic-ai/claude-code` (or the desktop app / claude.ai/code). Sign in with your Anthropic account. |
| Python 3.11 + uv (internal only) | For `apps/inference` |
| WhatsApp Business (Meta) developer account, an SA SMS aggregator, a PSP sandbox | Optional until R2; simulators cover the demo |

## 2. Open the session

### Option A — local terminal
```bash
git clone https://github.com/Reshigan/Radiography.git bonakala
cd bonakala
git checkout -b feat/r0-scaffold
claude
```

### Option B — Claude Code on the web (claude.ai/code)
1. Connect the GitHub account and select `Reshigan/Radiography`.
2. Create an environment with **network access enabled** (pnpm registry, Cloudflare API, fonts).
3. Add environment variables: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`
   as secrets in the environment, never in the repo.
4. Add a SessionStart hook (the `session-start-hook` skill in Claude Code sets this up) that runs
   `pnpm install --frozen-lockfile` so tests and linters work in every web session.
5. Start a session on a new branch named `feat/<release>-<topic>`.

### Recommended session settings
* Model: the most capable available; effort **xhigh** for scaffolding and architecture work,
  **high** for routine feature work.
* Use **plan mode** (`/plan` or Shift+Tab) for every new module: Claude reads the spec, proposes the
  plan, you approve, then it builds.
* Permissions: allow `pnpm`, `git`, `wrangler dev`, `docker compose`, `playwright` in
  `.claude/settings.json` so the session is not interrupted by prompts.
* Turn on hooks for `pnpm lint && pnpm typecheck` after edits (see `.claude/settings.json` once
  created by the scaffold prompt).

## 3. The first prompt (copy verbatim)

```
You are building the Bonakala Platform from the specification in ./docs. Read CLAUDE.md, then
docs/00-conventions.md, docs/07-platform-architecture.md, docs/06-design-system-frontend.md and
docs/16-deployment-cloudflare-demo.md in full before doing anything.

Task R0-1: scaffold the monorepo exactly as described in docs/07 §2 using pnpm workspaces and
Turborepo, TypeScript strict, ESLint + Prettier, Vitest, Playwright, Storybook for packages/bdl,
Hono for apps/api (runnable on Cloudflare Workers and Node), React 19 + Vite for apps/web,
Drizzle for packages/db (Postgres schema + generated SQLite mirror for D1).

Then:
1. Implement packages/bdl tokens from brand/tokens.json (CSS variables, TypeScript exports,
   lenses, the Window/Level control, the Provenance chip, Status chip, Money, DateTime).
2. Implement M21 Platform Core minimal: tenancy context, event outbox, feature flags, health.
3. Implement M02 Organisation (legal entities, relationships, shareholdings, sites, rooms,
   modalities) end-to-end: schema, migrations, API, UI (Business lens), tests.
4. Wire infra/cloudflare/wrangler.toml so `pnpm dev` runs the API on Workers locally with D1
   (per-tenant databases via a tenant directory), and infra/docker/docker-compose.yml so
   `docker compose up` runs the API on Node with Postgres for the internal option.
5. Add GitHub Actions CI from .github/workflows/ci.yml (fix anything that does not run).
6. Seed synthetic demo data (SA names across language groups, synthetic ID numbers that pass the
   Luhn check and are flagged synthetic, demo practices and sites).

Rules: follow docs/00 vocabulary; never store PHI; no AI output may be rendered without the
Provenance component; keep every module hexagonal (no adapter imports in domain code); write
tests for every command and query; commit in small, descriptive commits; open no PR until I ask.
When done, run lint, typecheck, unit tests and a Playwright smoke test and report the results.
```

## 4. Build sequence (one session per line; each starts with "Read CLAUDE.md and docs/… first")

| Step | Session prompt topic | Spec sources |
|---|---|---|
| R0-1 | Monorepo, BDL tokens, M21, M02, CI, seeds (above) | 06, 07, 16, 03 |
| R0-2 | Simulators: modality C-STORE sender, claims switch, funder eligibility, PSP, bank feed | 16, 14 |
| R1-1 | M01 Identity & Access (OIDC, MFA, RBAC/ABAC, break-glass, HPCSA number verification) | 15, 04 |
| R1-2 | M03 Patient Master Index + M07 Registration & Safety + Patient Space pre-check-in | processes/04, journeys/pat |
| R1-3 | M04 Referral & Orders + Referrer Space + Referral Hand (A1) | processes/01, journeys/ref, 11 |
| R1-4 | M05 Scheduling & Capacity (slot engine, reminders, self-service, WhatsApp booking) | processes/02, journeys/bkg |
| R1-5 | M06 Funding & Authorisation (quotes, benefit-check adapter, funder contracts) | processes/03 |
| R1-6 | M08 Acquisition & Worklist + Edge Gateway v1 (Orthanc, MWL, MPPS, store-and-forward, Cloudflare Tunnel, STOW-RS to Workers/R2) | processes/05, 07 §5, 16, 17 |
| R1-7 | M09 PACS (ingest, archive tiers, DICOMweb, viewer, priors, sharing) | processes/06 |
| R1-8 | M12 Reporting + Reading Room v1 (structured templates, dictation, sign-off, addenda) | processes/07, journeys/rgt |
| R1-9 | M13 Results & Communication (referrer delivery, patient results, critical-results workflow) | processes/08 |
| R1-10 | M14 Billing core (charge capture, pricing, claims, switch simulator, remittance) | processes/09 |
| R1-11 | Demo scenarios "the 09:40 patient", "the STAT head CT"; Cloudflare demo deploy | 16 |
| R2-1 | M20 Agent Runtime (Hands: mandates, leashes, tools, approvals, audit) + LLM Gateway | 11 §D–E, 12 |
| R2-2 | Coding, Claims, Remittance, Collections Hands; scheme rule packs; PSP; real switch adapter | processes/09 |
| R2-3 | Booking, Authorisation, Front Desk Hands | processes/02–04 |
| R2-4 | M11 BCI: model registry, inference orchestration, QC models on Edge, shadow mode, image-analysis pipeline | 11 §A, 12, 22, 23 |
| R2-5 | M10 Dose (RDSR, DRLs, alerts, dosimetry) | processes/05 |
| R2-6 | M16 Analytics v1 (semantic layer, persona dashboards) + M15 Finance core | 13, processes/10 |
| R3-1 | Reading Hub, JV waterfalls, consolidation, shareholder portal | 03, processes/10, journeys/shr |
| R3-2 | M17 Workforce + Roster Hand; M18 Assets + Maintenance Hand | processes/11 |
| R3-3 | M19 Compliance + Compliance Hand; POPIA workflows | processes/12, 15 |
| R3-4 | Benchmarking, forecasting, Insight Hand; Onboarding Hand; Edge fleet | 13, 11 |
| R4-* | NHI claims, occupational health, mammography programme, marketplace, K8s | 19 |

## 5. Working agreement with Claude Code
* **Spec first**: if the spec is silent, Claude proposes the smallest reasonable behaviour, records it
  in `docs/decisions/ADR-nnn.md`, and continues. If the spec is contradictory, it fixes the spec.
* **Vertical slices**: each session ends with a runnable, tested slice on the Cloudflare preview.
* **Subagents**: use parallel subagents for independent modules; the main session integrates.
* **Never**: commit secrets; use real patient data; bypass the Provenance gate; skip tests to get
  green; introduce GPL/AGPL code into linked application code.
* **Verification each session**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e:smoke`,
  and `wrangler deploy --dry-run`; for Docker sessions `docker compose config` and a health check.
* **Definition of done (module)**: persona surfaces, exceptions, audit, analytics events, docs
  (`docs/modules/MXX.md` generated from code comments), tests ≥ 80 % on domain code, demo seed.

## 6. Cloudflare setup commands (reference)
```bash
wrangler login
wrangler d1 create bonakala-demo
wrangler r2 bucket create bonakala-imaging-demo
wrangler r2 bucket create bonakala-documents-demo
wrangler queues create bonakala-events
wrangler queues create bonakala-inference
wrangler kv namespace create BONAKALA_KV
wrangler vectorize create bonakala-search --dimensions=768 --metric=cosine
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put WHATSAPP_TOKEN
pnpm --filter api exec wrangler deploy --env demo
```

## 7. Docker setup commands (reference)
```bash
cp infra/docker/.env.example infra/docker/.env   # fill in secrets
docker compose -f infra/docker/docker-compose.yml up -d
pnpm --filter db migrate:pg
pnpm --filter api dev:node
```

## 8. Governance during the build
* Weekly: demo on the Cloudflare preview to the product, clinical and revenue leads.
* Per module: clinical safety review (RGT + AIO) for anything touching Class 1–2 outputs.
* Per release: POPIA DPIA update, security scan results, accessibility audit, BDL review.
