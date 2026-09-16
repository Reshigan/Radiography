# ADR-002 — Modular monolith with an in-process agent runtime

**Status**: accepted.

**Decision**: `apps/api` is one Hono application that registers each module (M01–M21) from
`src/modules/<module>/`. Domain events go to an outbox table and are dispatched in-process after the
response (Workers `waitUntil`, Node `setImmediate`). Hands run as event handlers and scheduled jobs
inside the same process, using the tool registry and leash enforcement in `packages/domain/hands`.
Simulators (modalities, claims switch, funders, payments) are routes under `/sim` enabled only when
`DEMO_MODE=true`.

**Consequences**: One deployable Worker plus one static site. Heavy compute (DICOM parsing, real
inference) is behind ports with demo adapters; production adapters (Containers, GPU cell) plug in
without touching module code.
