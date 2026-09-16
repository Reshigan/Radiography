# CLAUDE.md — Bonakala Platform

Bonakala is a national radiography (diagnostic imaging) chain platform for South Africa. This
repository holds the full specification (`docs/`), brand (`brand/`) and reference infrastructure
(`infra/`). The application code is built from this specification in the layout defined in
`docs/07-platform-architecture.md`.

## Read first, always
1. `docs/00-conventions.md` — names, module map M01–M21, persona codes, automation levels, AI-slip definition.
2. The document(s) for the module you are working on (`docs/processes/*`, `docs/journeys/*`).
3. `docs/12-ai-safety-no-slip-charter.md` before touching anything that generates or displays AI output.
4. `docs/15-security-privacy-and-popia.md` before touching identity, data access or integrations.
5. `docs/24-statutory-and-regulatory-register.md` before touching sign-off, results delivery, claims, licences, incidents or anything that produces a regulatory submission.

## Non-negotiables
- **No AI slip**: Class 1 content (findings, impressions, report text, critical flags) can only reach a record, referrer or patient through a registered radiologist's explicit sign/accept. There must be no code path that publishes unsigned AI text. Every AI output renders with the `Provenance` component and stores model id, version, confidence and acceptance.
- **No PHI in this repo, in demos, in logs or in prompts to external LLMs without de-identification** (see docs/15). Demo data is synthetic and labelled.
- **Hexagonal modules**: domain code in `packages/domain` never imports adapters. Cloudflare and Docker adapters implement the same ports.
- **Tenancy**: every row carries `practice_id`; cross-tenant access only via explicit services with a recorded lawful basis.
- **Vocabulary**: use the exact module names, persona codes and "Hand" terminology from docs/00. ZAR, SAST, "medical scheme", "tariff code", "practice number", "ICD-10".
- **Licences**: MIT/Apache/BSD/OFL only in linked code; GPL/AGPL services (Orthanc, MinIO, Grafana) run as separate containers.
- **Design**: tokens come from `brand/tokens.json`; lenses per persona; no emoji, no exclamation marks, no generic gradient aesthetics (docs/05 §6).
- **Secrets**: never committed. Use `wrangler secret` / `.env` (git-ignored).

## Commands (once the scaffold exists)
```
pnpm install
pnpm dev            # web + api (Workers local via wrangler) + simulators
pnpm dev:node       # api on Node against Docker Postgres
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e:smoke
pnpm --filter db migrate:pg | migrate:d1
docker compose -f infra/docker/docker-compose.yml up -d
```

## How to work
- Plan before building a module; record decisions in `docs/decisions/ADR-nnn.md`.
- Vertical slices: schema → domain → API → UI → tests → seed → docs, one module at a time.
- Small commits with descriptive messages. Do not open pull requests unless asked.
- Run the fast checks before every commit. A red CI push is a failure of the process.
- When the spec is silent, choose the smallest reasonable behaviour and document it; when it contradicts itself, fix the spec in the same commit.
