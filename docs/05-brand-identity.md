# 05 — Brand Identity: Bonakala

## 1. Naming

**Bonakala** (isiZulu / isiXhosa verb stem: *-bonakala*, "to be visible, to appear, to be seen
clearly") is the working name for the group, the patient-facing chain (*Bonakala Imaging*) and the
software (*Bonakala Platform*).

Why it works:
* It says what radiography does — makes the invisible visible — in a language spoken by the majority of
  patients, without translating a Western word.
* Four syllables, all open vowels: pronounceable in every SA language and in English (bo-na-KA-la).
* It is a verb, not a person or place: no founder-name, no geography lock-in as the network expands.
* Short, spellable, works as a domain stem and app name.

### 1.1 Clearance protocol (mandatory before launch)
1. Trademark attorney search in **CIPC** (South Africa) classes **9** (software), **10** (medical
   apparatus), **35** (business services), **42** (SaaS), **44** (medical/radiology services).
2. **WIPO Global Brand Database** and **TMview** for international conflicts (future expansion:
   Namibia, Botswana, Kenya, Nigeria — ARIPO/OAPI).
3. Domain and social-handle availability (`.co.za`, `.africa`, `.health`, `.com`).
4. Company name reservation at CIPC.
5. Linguistic check with isiZulu and isiXhosa language consultants for unintended connotations.

### 1.2 Fallback candidates (also require clearance)
| Candidate | Language / meaning | Note |
|---|---|---|
| Kganya | Sesotho / Setswana: light, shine | Strong in Gauteng, Free State, North West |
| Isibani | isiZulu: lamp, a light | Warm, slightly poetic |
| Vulani | isiZulu/isiXhosa: "open up" (plural imperative) | Energetic, community |
| Lumela | Sesotho greeting ("greet/believe") + Latin *lumen* | Cross-cultural, softer |

## 2. Brand idea

**"Everything, made visible."**

Radiography reveals what cannot be seen. So does this platform: the cost before you arrive, the queue
before you sit, the finding before it becomes a crisis, the practice's numbers before month-end, the
AI's reasoning before you trust it. Visibility is the brand promise and the design principle.

Positioning line (external): **Bonakala Imaging — see clearly, sooner.**
Platform line (B2B): **The visible practice.**

## 3. Voice and tone

| Principle | Do | Don't |
|---|---|---|
| Plain, South African English | "Your scan is at 09:40 at Umhlanga. Bring your ID and scheme card." | "Your imaging encounter has been provisioned." |
| Warm but not chummy | "We'll message you when the radiologist has signed your report." | "Yay! Your results are in! 🎉" |
| Honest about money | "Your scheme will pay R1 240. You'll pay R310 today." | "Co-payments may apply." |
| Honest about AI | "A computer check flagged this image for the radiologist to look at first." | "AI has diagnosed…" |
| Multilingual by design | Short sentences, no idioms, numerals for numbers, 24-hour time. | Puns that don't translate. |

No emoji in product UI. Emoji allowed only in WhatsApp conversational replies where the patient
used one first.

## 4. Visual identity — "Latent Image"

The visual system is built from radiography's own physics, not from healthcare clichés (no hearts, no
crosses, no stethoscopes, no blue-gradient people).

### 4.1 The mark
An **open ring with a point of light**: a thick ring (the detector) opened at the upper right (the
beam entering) with a single bright dot placed off-centre inside (the thing that becomes visible).
The ring's stroke tapers from heavy (lower-left) to light (upper-right) like a windowed greyscale.

* Original geometry, drawn from primitives; no derivative of any existing logo. `brand/logo.svg` is
  the reference construction.
* Works at 16 px (favicon), embroidered on scrubs, and etched on a glass door.
* Monochrome first: Carbon on Bone, Bone on Carbon. Signal Teal dot in colour contexts.

### 4.2 Wordmark
"bonakala" set in **Manrope** (SIL Open Font License) SemiBold, lowercase, tracking −2 %, with the
mark to the left. "Imaging" or "Platform" descriptor set in Inter Medium at 60 % size.

### 4.3 Colour — materials, not moods
| Token | Name | Hex | Role |
|---|---|---|---|
| `bone` | Bone | `#F5F1E9` | Light surface (patient, business, print) |
| `bone-2` | Bone shade | `#EAE4D8` | Light surface elevated / dividers |
| `carbon` | Carbon | `#0E1113` | Dark surface (reading room, clinical consoles) |
| `graphite` | Graphite | `#171B1E` | Dark elevated surface |
| `ink` | Ink | `#1B1F22` | Text on light |
| `marrow` | Marrow | `#14324A` | Brand deep blue: headings, chrome on light |
| `signal` | Signal | `#12B5A5` | Primary action on dark; success |
| `signal-ink` | Signal ink | `#0A7268` | Primary action / links on light (AA on Bone) |
| `beam` | Beam | `#F0A52B` | Warning, attention, amber statuses |
| `flare` | Flare | `#E5484D` | Critical, error, STAT |
| `iris` | Iris | `#5B8FE8` | Informational, links on dark |
| `iris-ink` | Iris ink | `#2A5FC0` | Informational text / links on light |
| `ash-050…950` | Ash ramp | 12-step neutral warm-grey ramp | UI structure |

Contrast rules: all text ≥ 4.5:1 (WCAG 2.2 AA), UI icons ≥ 3:1; verified pairs are enumerated in
`brand/tokens.json`. Colour is never the only carrier of meaning (icons + text labels always present).

### 4.4 Typography (all open-licensed, no infringement)
| Use | Face | Licence |
|---|---|---|
| Display / headings | Manrope | SIL OFL 1.1 |
| Body / UI | Inter | SIL OFL 1.1 |
| Data / codes / DICOM tags / money | IBM Plex Mono | SIL OFL 1.1 |
| African-language fallback | Noto Sans (subset per language) | SIL OFL 1.1 |

Type scale: 12 / 13 / 14 / 16 / 18 / 22 / 28 / 36 / 48 / 64 px; line height 1.45 body, 1.15 display.
Tabular numerals everywhere numbers align (money, dose, times).

### 4.5 Imagery
* Real radiographs are **never** used for decoration. The brand uses **field studies**: abstract
  greyscale compositions generated from the *geometry* of imaging (grids, collimation, windowing
  curves) drawn in-house as SVG. No stock photography of patients or staff.
* Photography, when used (recruitment, site pages): actual Bonakala staff and sites, consented,
  natural light, no staged "doctor pointing at screen".

### 4.6 Motion — "develop, don't spin"
Content develops into view (opacity + 2 px rise over 180 ms, staggered by importance) instead of
spinners. Skeletons are shaped like the content. Motion is reduced under `prefers-reduced-motion`.

### 4.7 Sound (optional, kiosks/WhatsApp voice notes)
Two-note "reveal" chime (rising minor third), soft, under 400 ms, licensed original composition.

## 5. World-first elements (and why they are defensible)
1. **Window/Level for the interface** (see 06): users set information density and contrast of the
   whole UI the way a radiologist windows an image. The same product feels like a calm patient app and
   a dense clinical console without separate codebases.
2. **Persona lenses**: a single design language with lenses per persona (Patient, Referrer, Clinical,
   Business, Governance), specified as token overrides not separate designs.
3. **Materials palette from radiographic physics** rather than "healthcare blue".
4. **Latent Image progressive disclosure**: pages develop most-critical-first, driven by clinical
   priority, not DOM order.
5. **Provenance-first AI presentation**: every AI-derived element is drawn in a distinct "annotated"
   style (dashed hairline, mono label, model version) so a human can never mistake it for a human
   finding. This is a brand rule, not just a UI rule.

## 6. Anti-slip (design) — what Bonakala never looks like
* No purple-to-blue gradients, no glass blur cards, no floating 3D blobs, no "hero robot".
* No generic icon packs with rounded-everything; the icon set is drawn on a 24-px grid with 1.5 px
  strokes, squared terminals, and is published as `brand/icons/` (original).
* No stock testimonials, no fake logos, no invented statistics. Demo data is synthetic and labelled.
* No AI-generated imagery of people. Ever.
* No copy that starts with "Welcome to" or "Unlock". No exclamation marks in UI.

## 7. Legal hygiene checklist
* Fonts: OFL only; embed licences in the repo.
* Icons/illustrations: authored in-house; CC-BY assets are not used in the brand.
* Viewer/PACS open-source components: licence compatibility recorded in `docs/07-platform-architecture.md` §9.
* Scheme, funder and vendor names are used descriptively only (nominative use), never in the
  brand or marketing as endorsement.
* "Bonakala" and the mark are to be registered before public use; ™ used until ® is granted.
