# 03 — Organisation, Subsidiaries and Joint-Venture Model

## 1. Why the structure matters

South African rules shape how a "national radiography chain" can legally exist:

* **HPCSA ethical rules (Health Professions Act 56 of 1974, Ethical Rules of Conduct)** restrict the
  ownership of a clinical practice, sharing of professional fees and incorporation of practices to
  registered practitioners (radiologists for a radiology practice). A non-clinical corporate cannot
  simply own a radiology practice and bill schemes for professional services.
* **BHF Practice Code Numbering System (PCNS)** issues the practice number that appears on every
  claim; it is tied to a legal entity whose principals are HPCSA-registered.
* **SAHPRA Radiation Control** licenses each X-ray/CT/mammography/fluoroscopy unit to a licence
  holder at a specific address, with a named Radiation Protection Officer (RPO).
* **Council for Medical Schemes (CMS)** regulates the schemes and their Designated Service Provider
  (DSP) networks that a Practice contracts into.
* **POPIA** requires each responsible party (each Practice) to have an Information Officer and lawful
  bases for cross-entity data flows.
* **Companies Act 71 of 2008** governs subsidiaries, shareholders' agreements, minority protections.
* **B-BBEE** and **Competition Act** (merger notification thresholds when acquiring practices).

The Platform therefore models a **two-layer structure**: professional-owned Practices (clinical
entities that bill) and a Group / MSO layer (commercial entities that own the brand, the Platform,
the facilities and shared services, and earn management fees). This is the standard, defensible
structure in SA private healthcare and it is fully first-class in the data model.

## 2. Entity hierarchy

```
Bonakala Holdings (Pty) Ltd                      [Group]
├── Bonakala Platform (Pty) Ltd                  [MSO: software, billing bureau, shared services]
├── Bonakala Properties (Pty) Ltd                [Facilities & equipment leasing]
├── Bonakala Professional Holdings Inc.          [Radiologist-owned entity that holds equity in Practices]
│   ├── Practice A Inc.  (100 % subsidiary)      [Practice, BHF nr, HPCSA principals]
│   │   ├── Site: Sandton                        [SAHPRA licences, rooms, modalities]
│   │   └── Site: Randburg
│   ├── Practice B Inc.  (JV 51/49 with local partners)
│   │   └── Site: Umhlanga
│   └── Practice C Inc.  (JV 60/40, hospital-based, with a hospital group's professional partners)
└── Reading Hub (Pty) Ltd / Inc.                 [Teleradiology pool; contracts with Practices]
```

The Platform does not force this exact tree. It models a **directed acyclic graph of legal entities
with typed relationships** so that any lawful structure can be represented.

## 3. Data model (M02)

### 3.1 Entities

| Entity | Key attributes |
|---|---|
| `legal_entity` | id, type (holding, mso, property, professional_holding, practice, hub, external_partner), registered_name, trading_name, CIPC registration no., VAT no., tax no., BHF practice no. (practices), financial year end, status |
| `entity_relationship` | parent, child, type (subsidiary, jv, management_agreement, lease, reading_services, referral_partner), effective_from/to, documents |
| `shareholding` | entity, shareholder (legal_entity or natural_person), share_class, shares_issued, percentage (derived), voting %, economic %, effective_from/to, source document |
| `share_class` | entity, name (A ordinary, B ordinary, preference), rights (voting, dividend priority, distribution waterfall) |
| `director_officer` | entity, person, role (director, HPCSA principal, RPO, information officer, public officer), HPCSA no., effective dates |
| `agreement` | type (shareholders, management services, lease, equipment, reading services, DSP contract), parties, fee model (fixed, % of collections, % of net revenue, per-study), term, escalation, files |
| `site` | practice, name, address (SA province, municipality, GPS), SAHPRA facility reference, operating hours, contact, capacity |
| `room` | site, name, SAHPRA licence no., licence expiry, room type, shielding survey date |
| `modality` | room, type (CR, DX, MG, CT, MR, US, DXA, RF, PX, NM), vendor/model/serial, AE title, install date, warranty, service contract, commissioning acceptance |
| `intercompany_rule` | from_entity, to_entity, basis (management fee %, platform fee per study, rent, reading fee schedule), VAT treatment, posting accounts |

### 3.2 Requirements

* M02-R-001 The Platform MUST represent any number of levels of ownership with effective-dated
  shareholdings so historical distributions can be recomputed exactly.
* M02-R-002 Percentages MUST be derived from shares issued, never stored as the source of truth.
* M02-R-003 Any change to shareholding, directors or agreements MUST be an approved, versioned
  change with attached source documents (CoR forms, resolutions, signed agreements).
* M02-R-004 Practices MUST be isolated tenants for clinical data; the Group MAY see aggregated and
  de-identified data by default, and identified data only under a recorded data-sharing lawful basis
  (e.g., MSO billing bureau operating as *operator* under POPIA s.20–21).
* M02-R-005 The Platform MUST compute, per period, per Practice: revenue, collections, costs allocated
  by intercompany rules, management fees, EBITDA, distributable profit, and each shareholder's
  entitlement (economic %) with a full audit trail.
* M02-R-006 Each Site MUST carry its radiation licences and each Room/Modality its licence number,
  expiry and RPO; the Platform MUST block scheduling on a modality whose licence is expired or
  whose acceptance/QA is overdue (configurable grace, with CMP override and audit).
* M02-R-007 The Platform MUST support *sale of a practice interest*: a shareholding transaction that
  reassigns entitlements from an effective date, with pro-rata period splitting.
* M02-R-008 The Platform MUST support *hospital-based JVs* where the site is inside a third-party
  hospital: the hospital is an `external_partner` with a lease/service agreement, and HL7 ADT feeds
  from the hospital are attached to that site.

## 4. Commercial models supported (all configurable)

| Model | Description | Platform behaviour |
|---|---|---|
| Wholly owned subsidiary | Professional Holdings owns 100 % of Practice | Full consolidation; 100 % distribution |
| Equity JV | Two or more shareholders, one shareholders' agreement | Cap table; waterfall; minority interest reporting; reserved matters workflow |
| Management-only affiliate | Independent practice buys Platform + billing bureau services | Tenant without shareholding; MSO fee invoicing; no consolidation |
| Reading services | Hub reads for a Practice | Per-study reading fee schedule; automatic intercompany invoice from signed reports |
| Hospital JV | Practice operates in a hospital; hospital partners hold equity or a revenue share | Site linked to external_partner; ADT integration; revenue share calculation |

## 5. Governance workflows

* **Reserved matters**: capex above threshold, new borrowings, changes to fee schedules, appointment of
  principals — routed as approval tasks to the shareholders defined in the agreement.
* **Distributions**: monthly management accounts close → distributable profit computed → proposed
  distribution → approvals → payment file (bank EFT batch) → shareholder statements.
* **Shareholder portal (SHR persona)**: read-only P&L, KPIs, distributions, documents, votes.
* **Practice onboarding**: a guided flow that creates the legal entity, captures BHF/HPCSA/SAHPRA/POPIA
  particulars, uploads documents, creates sites/rooms/modalities, configures fee schedules and DSP
  contracts, and provisions users. Target: a new site operational on the Platform in 5 working days.

## 6. Intercompany & consolidation (M15)

* Costs pooled by the MSO (Platform, staff, consumables, marketing) are allocated by configurable
  drivers: studies, revenue, headcount, square metres, direct attribution.
* Management fees are invoiced (VAT applicable) monthly, generated automatically from posted
  intercompany rules; disputes route to EXE.
* Consolidation eliminates intercompany revenue/costs, computes minority interests, and exports to the
  accounting system (Xero, Sage, SAP Business One — via connectors) and to IFRS-based management packs.

## 7. B-BBEE and ownership analytics

The Platform records ownership by demographic classification where shareholders consent, and produces
ownership-scorecard inputs. It never stores race data without explicit consent and purpose limitation.
