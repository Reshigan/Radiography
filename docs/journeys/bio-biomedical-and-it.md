# BIO — Biomedical Engineering and IT Operations: Persona Journey

## Persona snapshot

| Item | Detail |
|---|---|
| Code | BIO |
| Who | Biomedical / clinical engineering and IT operations. In the Group, a small central team in the MSO with regional engineers, plus a site IT contact at each Site. Owns equipment uptime, maintenance and QA scheduling, image quality, site network, the Edge Gateway, DICOM and HL7 integration health, and vendor access. |
| Goals | Uptime, maintenance, image quality, network, integration health. |
| Frustrations today | Faults found by radiographers, not sensors; vendor engineers on the phone asking for TeamViewer; QA reminders in a diary; DICOM configuration by trial and error; no idea what the modality logs say until the vendor reads them. |
| Better than market | Predictive maintenance from modality logs (tube arc counts, helium levels, detector calibrations); automated QA reminders; DICOM/HL7 traffic observability; time-boxed, recorded vendor access. |
| Surfaces | Clinical lens (Carbon surface, Dense L3, High W3, Signal accent). Engineering console (M18), Integration console (M21), Edge Gateway fleet view, `DataTable`, `TrendChart`, `Timeline`, `Inspector`, `Confirm`. |
| Metrics | Uptime, MTTR, QA compliance. |
| Modules touched | M18 Assets & Engineering (owner), M21 Platform Core (integration bus, Edge Gateway), M08 Acquisition & Worklist, M09 Image Management, M10 Dose & Radiation Safety, M01 Identity & Access, M19 Quality, Risk & Compliance, M20 Agent Runtime, M05 Scheduling & Capacity. |

The journey follows Kabelo, regional biomedical engineer for the Group's KwaZulu-Natal sites, and Priya, the MSO's integration engineer.

---

## Scene 1 — A predictive-maintenance alert on a CT tube

**Situation.** Tuesday 06:40 SAST. The Engineering console shows a Beam alert for CT 1 at Umhlanga: "Tube arc events: 14 in the last 7 days, up from a 30-day baseline of 2 per week. Cooling-cycle duration trending up. Recommended: vendor inspection within 5 working days. Predicted failure window: 2 to 4 weeks (model confidence 0.72)." The alert is drawn in the annotated style with its model id and version.

**What they see.** The `Inspector` on the CT 1 asset shows: the modality log stream from the Edge Gateway (the gateway pulls the scanner's service log and DICOM MPPS and Dose SR metadata; it never touches images for this purpose), a `TrendChart` of arc events and tube heat units by day, the tube's install date and exposure count against the vendor's expected life, warranty and service-contract status (parts and labour, tube not covered after 18 months, illustrative), the vendor's SLA, the last preventive-maintenance visit and its findings, and the site's booked CT load for the next 14 days from M05. The Maintenance Hand (M18, A3) has drafted a vendor inspection request and a proposed maintenance window (Sunday 07:00 to 11:00, when the site has no CT bookings) and estimated the cost of a planned tube replacement against an unplanned failure (lost studies, agency reads, rebooking) using M16's figures.

**What they do.** Kabelo reads the trend. He agrees the pattern is real (he has seen the same tube model fail this way) and approves the inspection request; the Hand sends it to the vendor through the service-desk integration and books the window in M05 as a maintenance block, which the Capacity Hand honours. He adds a note for PRM that CT 1 may need a planned replacement and that the Sunday window avoids patient impact. He sets a watch on the alert: if arc events exceed 4 in any 24 hours before the inspection, the Hand should escalate to him and to PRM immediately, and the scanner's protocol library should switch to the "tube-conserving" protocol set that the site's radiologists approved for such periods.

**What the Platform does.**
- The Edge Gateway collects modality telemetry (service logs where the vendor exposes them, MPPS, Dose SR, error codes) and forwards it over the Cloudflare Tunnel to M18; the predictive model (Class 4 output, monitored by AIO like any other model) scores each asset daily.
- The Maintenance Hand may draft and send vendor requests, book maintenance windows, and order parts within a ZAR leash; it may not authorise a tube replacement (a capex or service-contract decision for PRM and, above threshold, a reserved matter).
- Vendor SLA clocks and breaches are recorded against the service contract in M02's agreement register.
- Events: `asset.alert.raised.v1`, `maintenance.request.sent.v1`, `maintenance.window.booked.v1`, `asset.watch.set.v1`.

**Edge cases.**
- The vendor says the log pattern is within normal range. Kabelo records the vendor's assessment on the alert; the model's prediction is kept, and if the tube fails inside the window the outcome is a labelled example for the model and evidence for the next service-contract negotiation.
- The alert fires on the scanner that PRM's journey describes failing at 09:52 two weeks later. The Platform's incident record links the failure to the alert and the vendor's response, and the Group's engineering lead sees the vendor's SLA performance across sites.
- The scanner's service log is proprietary and not exposed. The model falls back to MPPS and Dose SR timing and error-code signals only, and its confidence band widens, which is shown.

**Success measure.** Tube failures preceded by an alert at least 7 days earlier in more than 70 % of cases; planned replacements done in maintenance windows; MTTR falling year on year.

---

## Scene 2 — An Edge Gateway offline at a site

**Situation.** Thursday 11:15. The fleet view shows the Edge Gateway at the Secunda site (one of the three acquired Mpumalanga sites) as offline: no heartbeat for 6 minutes. The site has a general X-ray room, ultrasound and, recently, a CT.

**What they see.** The Fleet view lists every gateway with heartbeat age, link quality, UPS state, disk, transfer backlog and modality connectivity. Secunda is Flare. The last telemetry before silence: mains power lost, UPS on battery at 100 %, link up. Then nothing. The `Timeline` shows a municipal outage in Secunda reported via the load-shedding schedule feed ten minutes earlier, outside the published window. The Platform Support console (SUP) has a linked ticket opened automatically.

**What they do.** Kabelo phones the site's IT contact. The site is dark: the outage took out the site's fibre equipment, which is not on the UPS (an oversight from onboarding; the acquired site's network cupboard was never surveyed). The gateway itself is on the UPS and running: the radiographer's technologist console shows the worklist from the gateway's local mirror, the X-ray unit is on the generator and studies are being acquired and stored locally. What is lost is the link. Kabelo's checklist for "gateway offline, site operating": confirm imaging continues locally (yes), confirm the UPS runtime (about 3 hours at current load), confirm the generator covers the modalities (X-ray and ultrasound yes, CT no), tell the Capacity Hand to treat the CT as unavailable and to re-offer CT bookings, tell the Reading Room that Secunda's studies will arrive late (the Hub's worklist shows the site with an expected delay), and raise a facilities action to put the fibre equipment on the UPS. He also checks that the site's on-device QC models are still giving radiographers positioning feedback offline (they are, per the last telemetry).

**What the Platform does.**
- The Edge Gateway is designed for exactly this: DICOM C-STORE from modalities, MWL and MPPS, 30 days of local storage, resumable forwarding. The technologist console (PWA) keeps the worklist and forms in IndexedDB. When the link returns, uploads resume as STOW-RS over HTTPS through the Cloudflare Tunnel with the backlog visible on the fleet view.
- The site's power map in M18 (added for Secunda during onboarding, but incomplete) is what told Kabelo the generator did not cover the CT; he updates it with the fibre equipment's circuit.
- Report TAT SLAs for Secunda's studies are annotated with the outage so the Hub's TAT metrics are fair.
- Events: `gateway.offline.v1`, `gateway.on_ups.v1`, `modality.unavailable.v1`, `capacity.replanned.v1`, `gateway.online.v1`, `gateway.backlog.cleared.v1`.

**Edge cases.**
- The UPS runs down before power returns. The gateway shuts down cleanly on the UPS signal; local studies are on disk. When power returns, the gateway boots, verifies its store and resumes. The technologist console warns radiographers before shutdown so no exposure is taken without a worklist entry.
- The outage lasts two days and the local store approaches its disk threshold. The fleet view shows disk in Beam; Kabelo can raise the local retention pressure threshold or bring a portable link (a cellular router on the site's failover list) and enrol it; the gateway then forwards over cellular with transfers prioritised by clinical priority (STAT first).
- A trauma patient's CT is needed during the outage. The Capacity Hand offers the nearest site with a working CT and tells the referring casualty through the Referrer Space.

**Success measure.** Zero studies lost; backlog cleared within 2 hours of the link returning; the facilities action (fibre on UPS) closed within 14 days and the power map complete for every site.

---

## Scene 3 — DICOM integration for a new modality

**Situation.** The second MRI approved in the EXE and SHR journeys has been delivered to Umhlanga. Priya and Kabelo need to bring it onto the Platform: DICOM Modality Worklist, MPPS, image storage to the gateway, protocol library, dose (not applicable for MRI) but safety questionnaire routing (M07), hanging protocols in the Reading Room, and billing codes for the new protocols.

**What they see.** The Modality Onboarding flow in M18 is a `Stepper`: register the asset (vendor, model, serial, room, AE title, IP on the site's modality VLAN), configure DICOM (MWL query from the gateway, MPPS to the gateway, C-STORE to the gateway's AE title, transfer syntaxes, character sets), verify (C-ECHO both ways, a test worklist entry, a test study with a phantom, a check that the Study Instance UID, Accession Number and patient identifiers round-trip from the order), protocol library (import the site's approved MRI protocols with their durations for the slot engine and their safety requirements), Reading Room (hanging protocols for the modality and body parts), commissioning (acceptance test record, the medical physicist's report, the vendor's handover), and go-live (the slot engine opens the room).

**What they do.** Priya registers the asset and assigns the AE title from the Group's naming convention. She configures the MRI's DICOM settings from the gateway's generated configuration sheet, and the vendor's application specialist enters them on the console. She runs verification: C-ECHO passes, the test worklist entry appears on the scanner, the phantom study arrives at the gateway and is forwarded to the central archive, and the Integration console shows the study's DICOM headers with a `DataTable` of tag-level checks: Accession Number matched the order, Patient ID matched M03, Study Instance UID matched the MWL, the Institution Name tag is the Practice's registered name, and the Station Name is the asset's AE title. One check fails: the scanner sent Patient Name in a different component order. She fixes the scanner's setting with the specialist and reruns. Kabelo uploads the acceptance test and the physicist's report; CMP is notified that a new modality has commissioning evidence to review. The slot engine opens the room on the go-live date PRM chose.

**What the Platform does.**
- The Edge Gateway generates the modality's DICOM configuration and validates every test study against the order with tag-level checks, so misconfiguration is caught before the first patient.
- Protocol durations feed the slot engine (M05); safety requirements (MRI safety questionnaire, implants) feed M07's routing; and the Coding Hand's tariff mappings for the new protocols are drawn from the Group's protocol-to-tariff library, with BIL confirming the Practice's fee schedule.
- The DICOM/HL7 observability view shows per-modality traffic, error rates and latency from day one; an alert fires if a modality that normally sends 40 studies a day sends none by 10:00.
- Events: `modality.registered.v1`, `modality.dicom.verified.v1`, `modality.commissioned.v1`, `room.opened.v1`.

**Edge cases.**
- The vendor's scanner supports only an older transfer syntax for some sequences. The gateway accepts and transcodes for the central archive, recording both representations' hashes.
- The site's network VLAN for modalities was designed with inbound firewall rules from the old PACS. Because the Edge Gateway needs no inbound ports from the internet (outbound Tunnel only), the only rules needed are local: modality to gateway. Priya's network checklist confirms nothing is exposed.
- A hospital-based site needs the hospital's HL7 ADT feed matched to the new modality's worklist. Priya adds the ADT mapping in the integration bus, tests with replayed messages, and the Platform's raw-message store shows every inbound message before and after parsing.

**Success measure.** New modality live within 5 working days of vendor handover; zero patient-identifier mismatches after go-live; observability alert configured before the first patient.

---

## Scene 4 — A vendor engineer's remote access approval

**Situation.** The CT 1 vendor's engineer, following the inspection from Scene 1, wants remote access to the scanner's service console to run diagnostics and update firmware. Historically this meant a shared VPN account or a screen-sharing tool with no record.

**What they see.** A Remote Access Request in M18 and M01: the vendor (an `external_partner` with a signed operator agreement under POPIA, since the engineer could see patient identifiers on the console), the named engineer (identity verified through the vendor's federated login or a one-time invitation), the target device, the purpose, the requested window (2 hours), the access path (a brokered session through the Edge Gateway to the scanner's service port, no site-wide network access), whether the session will be recorded (yes, screen and command log), whether patient studies may be visible (yes; the engineer must acknowledge the confidentiality terms at session start), and the site's operational state (CT 1 must be idle; the Capacity Hand has confirmed no bookings in the window).

**What they do.** Kabelo reviews the request. He confirms the engineer is on the vendor's authorised list, narrows the window to 90 minutes, and approves with a typed `Confirm`. The engineer receives a link that works only inside the window and only from the vendor's federated identity. During the session Kabelo watches the live session view; the engineer runs diagnostics and proposes a firmware update. The update is a change to a medical device: Kabelo checks that the firmware version is on the vendor's SAHPRA-registered device configuration (the vendor confirms in writing in the session chat, which is recorded) and approves the update as a change request in M18 with CMP informed. After the session the recording, the command log and the change record are attached to the asset's `Timeline`, and the access is automatically revoked.

**What the Platform does.**
- Remote access is brokered through the Edge Gateway using Cloudflare Zero Trust policies (or the internal equivalent): a device-scoped, time-boxed, identity-bound session with no standing credentials and no inbound ports at the site.
- Every session is recorded and attached to the asset; the access log is part of the POPIA audit stream, so a data-subject access request (see the CMP journey) can show that a vendor engineer saw a console with the patient's name on it, and why.
- Firmware and software changes to modalities are change requests with the device's regulatory configuration recorded; a change outside the registered configuration blocks the modality for clinical use until CMP reviews.
- Events: `remote_access.requested.v1`, `remote_access.approved.v1`, `remote_access.session.started.v1`, `remote_access.session.ended.v1`, `asset.change.recorded.v1`.

**Edge cases.**
- The engineer needs more time. He requests an extension in the session; Kabelo approves another 30 minutes; the extension is recorded.
- The vendor asks for standing access "for monitoring". Standing access is not a supported option; the Platform offers instead a read-only telemetry feed of the parameters the vendor needs, which the Group controls.
- An emergency at 02:00 with no BIO awake: the Practice's on-call BIO rota in M17 receives the request; if nobody responds within 15 minutes, the request escalates to the Group's engineering lead. The runtime never auto-approves remote access.

**Success measure.** 100 % of vendor sessions time-boxed, identity-bound and recorded; zero standing vendor accounts; firmware changes always linked to the device's registered configuration.

---

## Moments that beat the market

- A tube fault is predicted from the modality's own logs, a maintenance window is booked around bookings, and the cost of planned versus unplanned replacement is shown before the decision.
- A site loses its link and keeps imaging; the engineer's checklist starts from "confirm imaging continues", and the backlog is a number on a screen.
- A new modality is configured from a generated sheet and verified tag by tag against real orders before the first patient.
- Vendor remote access is a brokered, recorded, time-boxed session with no inbound ports at the site and no standing accounts.
- DICOM and HL7 traffic is observable per modality and per integration, with alerts for silence, not only for errors.
- The site power map is a first-class record that the Capacity Hand plans against during load-shedding.
- Vendor SLA performance is recorded against the contract and shows up in the next negotiation.
- Firmware changes to medical devices are change-controlled with CMP in the loop.

## Failure modes designed out

- **Faults discovered by radiographers.** Telemetry, predictive alerts and silence alerts.
- **Data loss during outages.** Edge Gateway store-and-forward, clean UPS shutdown, prioritised resumption.
- **Misconfigured modalities reaching patients.** Tag-level verification is a gate in the onboarding stepper.
- **Shared vendor VPN accounts.** Identity-bound, time-boxed brokered sessions; standing access not offered.
- **Unrecorded device changes.** Firmware and software changes are change requests linked to the registered configuration.
- **Inbound network exposure at sites.** Outbound-only Tunnel; the only firewall rules are local modality-to-gateway.
- **Unfair TAT metrics after outages.** Outage annotations on affected studies.
- **Incomplete site surveys after acquisitions.** The power map and network checklist are onboarding gates, and gaps found in incidents become facilities actions with due dates.
