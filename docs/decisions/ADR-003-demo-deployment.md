# ADR-003 — Demo deployment topology on Cloudflare

**Status**: accepted (live).

**Context**: The specification calls for an all-Cloudflare cloud (docs/16). The demo must be reachable,
self-contained, and carry no personal information.

**Decision**: One Worker (`bonakala-demo`) serves both the API (`/api/*`, `run_worker_first`) and the built
web app through Workers Static Assets with SPA fallback. It binds one D1 database, one R2 bucket and one
queue per environment. A cron trigger every five minutes drains the event outbox and runs module ticks.

**Seeding.** The Worker self-seeds an empty database (`ensureDemoSeed` in `apps/api/src/app.ts`),
which is fine for the core fixture but **not** for the full demo: that is about 17 000 rows, and a
Worker cannot issue that many D1 statements inside one request's subrequest budget. The full demo is
therefore seeded offline and imported:

```bash
pnpm --filter @bonakala/api start          # DB_SYNC=schema, seeds a local SQLite file
node packages/db/tools/dump.mjs            # writes a dependency-ordered SQL dump
wrangler d1 execute bonakala-demo --env demo --remote --file=seed.sql
```

Two constraints learned the hard way and encoded in the dump tool: D1 rejects large multi-row
`INSERT` statements with `SQLITE_TOOBIG`, so rows are emitted one statement at a time; and the dump
must list parent tables (`legal_entities`, `sites`, `rooms`, `modalities`, `users`, `patients`,
`referrers`) before the rest, or the import fails on foreign keys.

**Live demo**: https://bonakala-demo.reshigan-085.workers.dev

**Consequences**: Deployment is `wrangler d1 migrations apply` followed by `wrangler deploy --env demo`.
Resource identifiers (database id, bucket and queue names) live in `infra/cloudflare/wrangler.toml`;
API tokens never do — they are supplied as `CLOUDFLARE_API_TOKEN` at deploy time, and as repository
secrets in CI. Production uses the same Worker with `DEMO_MODE=false`, which disables the simulators,
the demo account listing and the self-seed.
