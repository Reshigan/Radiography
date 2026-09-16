# 06 — Design System and Frontend: Bonakala Design Language (BDL) — "Latent Image"

## 1. Principles
1. **Visible state.** Every object (appointment, study, claim, agent task) shows its state, who owns it,
   and what happens next, on every surface where it appears.
2. **Window / Level.** The user controls information density (*level*) and contrast/emphasis
   (*window*) of the interface with a single two-axis control in the top bar. Defaults come from the
   persona lens; the user's setting persists per device. This is the world-first interaction of BDL.
3. **Latent Image.** Pages develop most-critical-first: STAT items, safety flags and money owed appear
   first; decoration last. Loading is choreographed, never spun.
4. **One language, five lenses.** Patient, Referrer, Clinical, Business, Governance lenses are token
   overrides (surface, density, motion, accent temperature), not separate designs.
5. **Provenance for everything AI.** AI-derived content is always rendered in the *annotated* style
   (dashed hairline border, mono label with model id and version, confidence band) with an explicit
   human action to accept. It can never be visually confused with human-entered data.
6. **Low-bandwidth, load-shedding, phone-first.** Every patient and referrer surface must work on a
   3G connection, on a 5-year-old Android phone, and degrade to SMS/WhatsApp when the web fails.
7. **Accessible by default.** WCAG 2.2 AA; keyboard-complete; screen-reader tested; dyslexia-friendly
   spacing option; large-touch kiosk mode; colour-vision-safe statuses.

## 2. Tokens (source of truth: `brand/tokens.json`)

### 2.1 Surfaces and lenses
| Lens | Default surface | Density (level) | Emphasis (window) | Accent temperature | Used by |
|---|---|---|---|---|---|
| Patient | Bone (light) | Spacious (L1) | Soft (W1) | Warm Signal | PAT |
| Referrer | Bone | Comfortable (L2) | Standard (W2) | Marrow | REF, PAY |
| Clinical | Carbon (dark) | Dense (L3) | High (W3) | Signal | RAD, RGT, NUR, BIO, AIO |
| Business | Bone | Dense (L3) | Standard (W2) | Marrow | FDK, BKG, BIL, DEB, PRM, EXE, SHR |
| Governance | Bone | Comfortable (L2) | Standard (W2) | Marrow | CMP, SUP |

Level L1–L4 sets spacing unit (8/6/4/3 px), row heights (56/48/40/32 px), type size (16/15/14/13 px).
Window W1–W3 sets border strength, shadow presence, status-chip saturation, and how many secondary
fields are shown before "more".

### 2.2 Spacing, radius, elevation
* Base unit 4 px. Scale: 2, 4, 8, 12, 16, 24, 32, 48, 64.
* Radius: 2 px (inputs, chips), 6 px (cards), 12 px (sheets), full (avatars). Nothing bigger.
* Elevation: no drop shadows on Carbon; on Bone, one subtle 1-px hairline + 0/1/2 elevation tints.

### 2.3 Status vocabulary (single source, used by every module)
| Status family | Colour token | Icon | Example states |
|---|---|---|---|
| Neutral / scheduled | ash-500 | circle | Booked, Draft, Pending |
| Active / in progress | iris | half-circle | Arrived, In room, Reading, Submitted |
| Done / good | signal | check-circle | Signed, Paid, Acknowledged |
| Attention | beam | triangle | Needs auth, Unmatched, Overdue 30 |
| Critical | flare | octagon | STAT, Critical finding, Rejected, Licence expired |
| AI-derived | ash-700 dashed | sparkle-square (custom) | Triage priority, Draft, Suggested code |

## 3. Layout system
* **App frame**: left rail (module switcher, 56 px, icons+labels on hover), top bar (context: entity /
  site / date, global search, Window-Level control, notifications, user), content, optional right
  **Inspector** panel (details of the selected object) — same on every module so users learn once.
* **Grid**: 12-column, 1440-px design width, min 320 px. Reading Room uses a dedicated full-bleed
  layout with the viewer on the left and reporting on the right (or on a second monitor).
* **Command palette** (`Ctrl/Cmd+K`): search patients, studies, claims, sites; run actions; ask a
  Hand.
* **Kiosk** layout: 1080×1920 portrait, 64-px touch targets, 3-step maximum flows.
* **WhatsApp**: conversational; every message ≤ 3 lines; buttons ≤ 3; links to Patient Space for
  anything more.

## 4. Component library (BDL React, 60 components, all keyboard-complete)
Foundations: `Text`, `Icon`, `Money` (ZAR, tabular, negative in Flare), `DateTime` (SAST), `Id`
(SA ID / passport masked), `Status`, `Provenance` (AI chip), `Skeleton`.
Inputs: `Input`, `Select`, `Combobox`, `DatePicker` (SA public holidays aware), `TimeSlotPicker`,
`Toggle`, `Checkbox`, `RadioCard`, `Signature` (touch), `PhotoCapture`, `IdScan`, `FileDrop`,
`VoiceNote`, `Search`.
Structure: `AppFrame`, `Rail`, `TopBar`, `WindowLevelControl`, `Inspector`, `Card`, `Sheet`,
`Dialog`, `Tabs`, `Stepper`, `Timeline`, `DataTable` (virtualised, column presets per lens),
`KanbanBoard`, `Calendar` (modality/day/week/room), `Queue` (worklist), `SplitPane`.
Feedback: `Toast`, `Banner`, `EmptyState`, `Progress` (develop-in), `Confirm` (typed
confirmation for destructive/clinical actions).
Clinical: `Viewer` (Cornerstone3D based), `HangingProtocolBar`, `FindingOverlay` (AI annotated
style), `ReportEditor` (structured + free text, macros), `DoseGauge`, `SafetyChecklist`,
`ContrastCalculator`, `PriorStrip`.
Money: `Quote`, `CollectCard`, `ClaimStatus`, `RemittanceMatch`, `StatementView`, `PayLink`.
Analytics: `StatTile`, `Sparkline`, `TrendChart`, `Distribution`, `Heatmap` (site × hour),
`Funnel`, `Benchmark`, `Cohort`. Charts follow `dataviz` rules: one palette, dark/light parity,
direct labels over legends, no 3D, no pie charts for more than 3 slices.

## 5. Patterns

### 5.1 Object pages
Patient, Study, Appointment, Claim, Practice, Modality, Agent Task all use the same anatomy:
header (identity + status + primary action), key facts strip, tabs (Timeline · Details ·
Documents · Money · Activity), Inspector for related objects.

### 5.2 Worklists and queues
All work is a queue with: filters saved per user, sort by priority then age, bulk actions,
"claim" (lock) semantics, SLA timers rendered as thin progress bars turning Beam then Flare.

### 5.3 The Collect card (FDK)
Shows in one glance: scheme portion, patient portion, reason (co-pay, benefit exhausted, not covered,
cash), what to collect now, payment methods, and any outstanding balance from previous visits.

### 5.4 Provenance and acceptance
AI suggestion → `Provenance` chip → explicit **Accept / Edit / Reject** → the accepted value loses the
annotated style and records `accepted_by`, `accepted_at`, `model_version`.

### 5.5 Critical finding banner
Site-wide Flare banner for the radiologist and the responsible referrer until acknowledged; never
auto-dismisses; the acknowledgement path is recorded.

### 5.6 Money explained
Every amount owed shows the arithmetic: tariff × units − scheme paid − adjustments = patient owes,
with links to the tariff description in plain language.

## 6. Reading Room (RGT) specification
* Diagnostic viewer: Cornerstone3D (MIT) with DICOMweb (WADO-RS/QIDO-RS) and progressive loading;
  MPR, MIP, 3D for CT/MR; mammography hanging protocols (CC/MLO, prior comparison); cine for US and
  fluoroscopy; measurement tools; key image selection.
* Display: supports DICOM GSDF-calibrated monitors; UI chrome in Carbon with luminance ≤ 20 cd/m²
  equivalents; no white flashes; hotkeys configurable; dictation push-to-talk.
* AI overlays: bounding boxes / heatmaps toggled per model; each overlay has a provenance label;
  overlays default **off** for mammography per human-first policy, **on** for triage priorities.
* Reporting: structured templates by modality/body part, RadLex-inspired vocabulary (used
  descriptively), macros, comparison auto-text from priors, addendum workflow, peer review score
  entry, referrer-specific report formats (key images embedded).
* Second-monitor mode and single-monitor split mode.

## 7. Patient Space (PAT)
Progressive web app, no install, magic-link + OTP sign-in (SA mobile number), sections: Appointments
(book/reschedule), Prepare (safety questions, consent, what to bring), Pay (quote, pay now, plans),
Results (report in plain language layer + full report + images share link), Family (guardian access),
Profile (ID, scheme, consent preferences), Help (WhatsApp).

## 8. Referrer Space (REF)
Web + embedded widget: Refer (structured order, protocol suggestion, upload photo of paper form),
Patients (status of every referral), Results (structured, key images, trends), Urgent (call a
radiologist now, with call-back SLA), Analytics (their referral volumes and TAT), Settings (delivery
preferences, integration keys).

## 9. Front-end engineering
* React 19 + TypeScript, Vite, TanStack Router/Query/Table, Zod schemas shared with the API.
* BDL package `@bonakala/bdl` (tokens, primitives, components, icons, lenses). Primitives built on
  Radix UI (MIT). Charts on visx/D3 (MIT). Viewer on Cornerstone3D (MIT).
* Storybook with visual regression; axe-core accessibility CI; Lighthouse budgets (patient pages:
  ≤ 150 kB JS gz, TTI < 3 s on 3G).
* i18n via ICU messages; RTL not required; language packs loaded lazily.
* Offline: PWA with background sync for patient forms; technologist console keeps worklist and
  forms in IndexedDB for load-shedding periods.
* Telemetry: privacy-preserving product analytics (no third-party trackers on patient surfaces).

## 10. Deliverables in this repo
* `docs/25-ui-specification.md` — information architecture, screen inventory, flows, states.
* `brand/bdl.css` — reference stylesheet implementing the tokens and components.
* `brand/screens/` — high-fidelity mockups of the principal screens (index at `brand/screens/index.html`).
* `brand/tokens.json` — design tokens (source of truth).
* `brand/styleguide.html` — static style guide preview (no build step).
* `brand/logo.svg`, `brand/logo-dark.svg` — the mark.
