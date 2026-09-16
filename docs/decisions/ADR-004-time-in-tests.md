# ADR-004 — Time is faked globally in tests; the clock port stays the production contract

**Status**: accepted.

**Context**: Scheduling, SLA and ageing logic reads "now". Tests that searched from the current time
passed in the morning and failed after about 16:20 SAST, because rooms close at 17:00 and the slot
engine applies a 20-minute lead time. Separately, module code is a mixture: some call
`services.clock.now()` (the injected port) and some call `new Date()` directly. When a test pinned
only the port, one module saw the pinned time and another saw the wall clock, so a cancellation
decided the freed slot was in the past and skipped the waitlist backfill.

**Decision**: `createTestApp()` exposes `setNow(when)`, which fakes time **globally** with
`vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })` and also drives the clock port.
Both styles of module code therefore agree on "now", and no test depends on the hour it runs at.
Time-sensitive suites pin a time in `beforeAll` and release it in `afterAll`.

**Consequences**: The suite is deterministic in CI at any hour. The port remains the production
contract, so a future time-shifted simulation or replay can still inject a clock. Converting the
remaining direct `new Date()` calls to the port is a worthwhile tidy-up but is not required for
correctness, since both read the same clock at run time; it is tracked as follow-up work rather than
attempted as a single large sweep across every module.
