# ADR-003 — Demo deployment topology on Cloudflare

**Status**: accepted (live).

**Context**: The specification calls for an all-Cloudflare cloud (docs/16). The demo must be reachable,
self-contained, and carry no personal information.

**Decision**: One Worker (`bonakala-demo`) serves both the API (`/api/*`, `run_worker_first`) and the built
web app through Workers Static Assets with SPA fallback. It binds one D1 database, one R2 bucket and one
queue per environment. On first request against an empty database the Worker seeds itself with synthetic
South African demo data (`ensureDemoSeed` in `apps/api/src/app.ts`), so a fresh environment needs no
seeding step. A cron trigger every five minutes drains the event outbox and runs module ticks.

**Live demo**: https://bonakala-demo.reshigan-085.workers.dev

**Consequences**: Deployment is `wrangler d1 migrations apply` followed by `wrangler deploy --env demo`.
Resource identifiers (database id, bucket and queue names) live in `infra/cloudflare/wrangler.toml`;
API tokens never do — they are supplied as `CLOUDFLARE_API_TOKEN` at deploy time, and as repository
secrets in CI. Production uses the same Worker with `DEMO_MODE=false`, which disables the simulators,
the demo account listing and the self-seed.
