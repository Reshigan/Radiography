# Journey: SUP — Platform Support (MSO)

## Persona snapshot

| Item | Detail |
|---|---|
| Code | SUP |
| Who | Platform support engineers in the MSO. First and second line for every tenant: users, sites, integrations, configuration changes, incidents, and the operational side of onboarding. Cross-tenant by the management services agreement; sees identified data only when a ticket requires it, with the access recorded. |
| Goals | Keep tenants running; onboard practices; resolve incidents. |
| Frustrations today | "The system is slow" tickets with no trace; configuration changes made in production by whoever had the password; no way to know which site is affected by a vendor's outage. |
| Better than market | A support console that opens on the affected object with its trace; configuration as recorded, approved changes; observability per tenant, per site, per integration; incidents that write their own timeline. |
| Surfaces | Governance lens (Bone, Comfortable L2, Standard W2, Marrow). Support console, Observability (SLO dashboards per module), Fleet view (shared with BIO), Configuration change log, `Queue`, `Timeline`, `Inspector`, `Confirm`. |
| Metrics | Time to acknowledge, time to resolve by severity, change failure rate. |
| Modules touched | M21 Platform Core (owner of support tooling), M01 Identity & Access, M20 Agent Runtime, M18 Assets & Engineering, M14 Revenue Cycle (integration side), all modules as configuration targets. |

The journey follows Musa, second-line support engineer on the day shift.

---

## Scene 1: A claims switch running slow

**Situation.** 09:20 SAST. The Observability view shows the claims switch adapter for one switch vendor with P95 response latency at 40 seconds against a normal 3 seconds; error rate is still low. The Claims Hand's queue for the three Practices that use that switch is growing. The CIO's console has already shown it (see the EXE journey).

**What they see.** The Support console has opened an incident automatically from the SLO breach with severity 2 (degraded, no data loss), the affected tenants listed, the integration's raw message store showing the last 50 requests and responses with timings, and the switch vendor's status page feed (down). The Support Hand (M20, A2) has drafted a tenant notice for the three Practices' BIL and PRM users: "Claims to [switch] are delayed; nothing is lost; submissions will catch up automatically."

**What they do.** Musa confirms the cause is on the switch's side (the requests are well-formed and the timeouts are at the vendor). He approves the notice, opens a ticket with the switch vendor through the integration's support channel, and sets the adapter to "queue and retry with backoff" so the Claims Hand stops waiting synchronously. He watches the recovery; at 11:05 latency normalises and the backlog drains. He closes the incident with the vendor's reference.

**What the Platform does.** SLOs per integration raise incidents; the raw message store makes finding the cause a matter of looking, not reproducing; the Claims Hand's leash includes "do not resubmit on timeout" so the recovery cannot create duplicates (idempotency by `(source, message_id)` also prevents it). Events: `incident.opened.v1`, `tenant.notice.sent.v1`, `integration.mode.changed.v1`, `incident.closed.v1`.

**Edge cases.** The switch returns errors for one Practice only: a practice-number registration problem at the switch. The incident narrows to that tenant, and BIL is told which claims are affected and by when they must be resubmitted against the stale-claim rule.

**Success measure.** Acknowledged within 5 minutes; affected users told within 15; zero duplicate claims; vendor reference on the incident.

---

## Scene 2: A configuration change from an incident

**Situation.** CMP at Practice A has asked, from the wrong-patient exposure incident in the CMP journey, that the technologist console's "wristband scan before exposure" gate be set to mandatory for the Sandton site.

**What they see.** A Configuration Change request in M21 linked to the incident: the setting, its current value (advisory), the requested value (mandatory), the scope (Practice A, Sandton), the requester (CMP), the impact analysis the Support Hand drafted (the gate blocks MPPS "in progress" until a wristband scan is recorded; portable X-ray on the ward uses the mobile app's scan; if the scanner is broken, the site's RAD lead can record a witnessed manual identity check with a reason, which is audited), and the rollout (immediate, reversible).

**What they do.** Musa reviews the impact, confirms the mobile app path works at Sandton, and applies the change with a typed `Confirm`. The change log records it with the incident reference. He tells CMP and the site's RAD lead through the console. He suggests, in the Group's configuration baseline discussion, that "mandatory" become the default for every site; that is a Group policy decision, not his, and he records the suggestion for the operations lead.

**What the Platform does.** Configuration is data with scope (Group, Practice, Site, Room), history, requester, approver, reason and roll-back. Feature flags and settings cannot be changed in production without a recorded change. Events: `config.change.requested.v1`, `config.change.applied.v1`.

**Edge cases.** A change would break a Hand's mandate assumptions (for example, a setting that changes who may approve a write-off). The runtime's mandate checker flags the conflict at request time and the change cannot be applied until the Hand's approval policy is updated too.

**Success measure.** Every production configuration change has a request, an approver and a reason; change failure rate below 2 %.

---

## Scene 3: Onboarding support and a tenant restore

**Situation.** During the Mpumalanga acquisition's onboarding (see the EXE journey), the Secunda site's IT contact enrolled the Edge Gateway with the wrong site code, pairing it with White River. Twenty test studies landed under the wrong site. Separately, a user at a management-only affiliate deleted a saved worklist filter set for their whole Practice by mistake and asks for it back.

**What they see.** Two tickets. The first opened automatically when the gateway's telemetry reported a serial number that did not match the site's expected appliance. The second is a user ticket with the affected object linked. The `Inspector` for the tenant shows the point-in-time recovery options for its database (per-Practice isolation means a tenant can be inspected and restored without touching any other tenant).

**What they do.** For the gateway, Musa re-enrols the appliance with the correct site code (the one-time token is reissued to the site contact, and the old pairing is revoked), and re-attributes the 20 test studies to Secunda through the M09 site-correction workflow with BIO as second approver; because they were phantom test studies, no patient record is involved, which the workflow confirms before allowing a single-approver path. For the filter set, he restores the object from the tenant's point-in-time history to the minute before the deletion, into the live database, without a full restore; the user is told and the action is recorded with the user's consent on the ticket.

**What the Platform does.** Tenant isolation makes object-level recovery safe; the Fleet view validates every gateway against its expected serial and site; site attribution of studies is a controlled workflow, never a database edit. Events: `gateway.enrolment.revoked.v1`, `gateway.enrolled.v1`, `study.site.corrected.v1`, `object.restored.v1`.

**Edge cases.** The wrongly attributed studies were real patients. The correction would then require CMP at both Practices, because a study landed in the wrong tenant, and the event would be recorded as a POPIA incident with the affected patients assessed for notification.

**Success measure.** Gateway mis-enrolment caught before a patient study; object restores completed within an hour without a full tenant restore.

---

## Moments that beat the market

- Incidents open themselves from SLO breaches with the affected tenants, the raw messages and a draft notice ready.
- A degraded switch cannot create duplicate claims; the Hand waits and idempotency guards the rest.
- Configuration is data with scope, history and approval; an incident's corrective action becomes a recorded change in minutes.
- Per-tenant isolation means an object can be restored to the minute without touching another Practice.
- A mis-enrolled gateway is detected by serial mismatch before any patient study arrives.
- The support engineer sees identified data only when a ticket needs it, and the access is on the audit stream a patient can request.

## Failure modes designed out

- **Production changes by password.** No unrecorded configuration changes; mandate conflicts block changes.
- **Duplicate claims after an outage.** Leash plus idempotency.
- **Tenant restores that roll back everyone.** Per-Practice databases and object-level recovery.
- **Studies in the wrong tenant fixed by a database edit.** A workflow with second approvers and POPIA assessment.
- **Users told nothing during degradation.** Draft notices ready at incident open, approved by a human.
- **Gateways paired to the wrong site.** Serial and site validation at enrolment.
