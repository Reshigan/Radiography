# ADR-001 — One SQL dialect: SQLite (D1 in the cloud, libsql on Node)

**Status**: accepted (build R0).

**Context**: The specification (07, 17) names Postgres for the internal Docker deployment and D1 for
Cloudflare. Maintaining two Drizzle schemas doubles every module's data work and invites drift.
The cloud is the production target (all Cloudflare), and D1 is SQLite.

**Decision**: One schema in Drizzle `sqlite-core`. Cloudflare uses D1 (one database per Practice
tenant via the tenant directory). Node (Docker, tests, local dev) uses `@libsql/client` against a
file or in-memory database with the same migrations. Postgres becomes an adapter to add later if a
self-hosted customer requires it; the ports layer keeps that possible.

**Consequences**: Money is stored as integer cents; JSON columns hold structured payloads; full-text
search uses FTS5 where needed; analytics marts are SQL views over the same dialect. Docker compose
runs the API on Node with a persistent SQLite volume for the pilot tier; docs 07 and 17 carry a note.
