# 01 — Executive Summary

## The opportunity
South African private diagnostic imaging is a large, fragmented, radiologist-owned market that still
runs on phone bookings, paper referrals, CDs, unstructured PDFs, manual coding and month-long
collections. Patients discover what they owe after the fact. Referrers phone for reports. Practices
run separate RIS, PACS, billing and accounting systems held together by re-keying. Load-shedding and
connectivity failures stop work. AI is arriving as bolt-on vendor products with no governance.

Bonakala is a **national radiography chain and the platform that runs it**: one identity for every
patient across every site, one worklist for every radiologist across every practice, one revenue
cycle that bills the same day and collects the same week, and one analytics layer that a shareholder,
an executive, a practice manager and a regulator can each trust. AI is embedded in every process
under a safety charter that makes an "AI slip" technically impossible for clinical content.

## What we are building
| Layer | What it is |
|---|---|
| **Bonakala Imaging** | The consumer brand: a network of radiology practices (wholly owned subsidiaries and joint ventures with local radiologists), hospital-based sites, and a national reading hub. |
| **Bonakala Platform** | A single software platform (21 modules) replacing RIS, PACS, reporting, billing, debtors, practice finance, compliance and analytics, with an Edge Gateway per site so imaging never stops. |
| **Bonakala Clinical Intelligence** | Imaging AI (triage, QC, findings candidates, dose; see 22 and 23), language AI (referral extraction, coding, drafting, plain-language results, multilingual WhatsApp) and 21 autonomous "Hands" (agents) with mandates and leashes. |
| **Bonakala Design Language** | A world-first, original design system ("Latent Image") with one language and five persona lenses, a Window/Level control for interface density, and provenance-first AI presentation. |

## What "better than the market" means, concretely
| Today (typical SA practice) | Bonakala |
|---|---|
| Phone booking in office hours | 60-second WhatsApp/web booking, any site, 24/7, with a binding quote |
| Co-payment surprise months later | Scheme benefit checked before the visit; exact amount collected at the desk or via link |
| Paper referral re-typed | Photo of referral → structured order in seconds (Referral Hand) |
| Report by fax/PDF in 24–72 h | Structured report with key images to the referrer minutes after sign-off; STAT within the SLA; critical findings phoned and acknowledged, tracked to closure |
| Images on CD | Secure links; patient owns their images in the Patient Space |
| Manual coding, 10–20 % rejections | Coding Hand + scheme rule packs; first-pass acceptance target ≥ 97 %; exception-only work |
| Month-end in weeks | Close Hand: management accounts and JV distributions computed from live data |
| Load-shedding stops the day | Edge Gateway keeps worklists, imaging and QC running offline |
| AI as a black box | Model registry, provenance on every output, shadow mode, drift monitoring, kill switches |
| Separate systems per practice | One platform, one patient identity, one worklist, one analytics layer, tenant-isolated |

## Business model
* Practices (subsidiaries and JVs) earn clinical revenue; the MSO earns management/platform fees;
  the Group consolidates. All three are first-class in the Platform (cap tables, waterfalls,
  intercompany, distributions).
* The Platform can also be licensed to independent practices as a managed service, and the Reading
  Hub sells teleradiology capacity.

## Regulatory posture
Built around HPCSA ownership rules (radiologist-owned practices, MSO structure), SAHPRA (radiation
licensing per room; AI as software medical device), BHF practice numbers, CMS/scheme rules, POPIA,
and NHI readiness. See `02-south-africa-context-and-regulation.md`.

## Deployment
* **Cloud: all Cloudflare.** Production, staging and the public demo run on Cloudflare (Pages,
  Workers, D1 per tenant, R2, Queues, Workflows, Durable Objects, Containers, Workers AI, AI Gateway,
  Pipelines, Zero Trust, Tunnel). The demo is the production stack on synthetic data with simulated
  modalities, funders and switch.
* **Internal on Docker/Kubernetes** for organisations that must self-host: the same code with
  Postgres, object storage, NATS, Orthanc, GPU inference, in South African data centres.
* **Edge Gateway at every site** in both cases, so imaging continues through outages and raw DICOM
  never leaves the site network.
* **Image analysis** has its own specification (`22-image-analysis-specification.md`) and guide
  (`23-image-analysis-guide.md`).

## Programme
Four releases over about 18 months (see `19-roadmap-and-release-plan.md`): R1 Foundation (identity,
organisation, scheduling, registration, PACS, reporting, billing core, demo), R2 Revenue and AI
(claims automation, Hands, triage models in shadow mode), R3 Network (hub, JVs, consolidation,
analytics benchmarking, Edge fleet), R4 Scale (NHI readiness, advanced AI, marketplace for
SAHPRA-registered third-party models).

## Where to start
`20-build-kickoff-claude-code.md` contains the exact instructions to open a Claude Code session
and start the build from this specification.
