# Journey: PAT — Patient

This journey follows the Patient persona (PAT) through the Bonakala Platform, one scene per kind of
patient. It is the flagship journey because every other persona exists to serve it. Scenes are
written as: Situation, What they see, What they do, What the Platform does, Edge cases, Success
measure. All names, amounts and tariff codes are illustrative and are stored as configurable
reference data.

## Persona snapshot (from 04-personas)

| Item | Detail |
|---|---|
| Who | Any person referred for imaging: medical-scheme members (about 16 % of the population), cash-paying patients, RAF and COIDA claimants, corporate and occupational-health employees, public-sector patients under NHI pilots, children with guardians, elderly patients, non-English first-language speakers |
| Goals | Get the scan quickly and close to home; know the cost before arriving; feel safe; get results to the doctor fast; never be chased for money they did not expect |
| Frustrations today | Phone-only booking, no price certainty, co-payment surprises months later, "the CD", repeat paperwork at every branch, waiting rooms with no status, no access to own images |
| Better than market | Book in 60 seconds on WhatsApp or web; guaranteed quote with scheme benefit check; digital pre-check-in and consent; live queue status; results and images in the Patient Space within minutes of sign-off; one identity across every site nationally; pay what you owe now with no later surprise, or a clear payment plan |
| Surfaces | WhatsApp channel, Patient Space (progressive web app, no install), SMS fallback, kiosk, front desk |
| Metrics | Time-to-appointment, quote accuracy, results turnaround |

Design lens: **Patient** (Bone surface, Spacious L1, Soft W1, warm Signal accent). Every screen in
this journey must work on a 3G connection on a five-year-old Android phone, and every step has an
SMS or WhatsApp equivalent. Copy is short sentences, numerals for numbers, 24-hour time, no idioms,
so that the isiZulu, isiXhosa, Afrikaans and Sesotho packs read as naturally as the English.

## Scene 1 - Scheme member: lumbar spine X-rays booked on WhatsApp

**Situation.** Nomvula, 41, has a referral note from her GP for lumbar spine X-rays (AP and lateral).
She is a member of a large open medical scheme on a hospital-plus-savings option. It is 17:10, she is
in a taxi, and she has R23 of airtime and a small data bundle. She wants to know two things: when,
and what it will cost.

**What they see.** The GP's note carries a printed Bonakala WhatsApp number and a QR code. Nomvula
sends "Hi" and receives, within seconds, a three-line message and three buttons: *Book a scan*,
*My appointments*, *Talk to a person*. She sends a photo of the referral. The reply names the study
in plain words ("2 X-rays of your lower back"), asks her to confirm her ID number (masked once
entered, `Id` component), and offers three slots at the two sites nearest the location she shares:
"Tomorrow 08:20 Randburg · Tomorrow 11:40 Sandton · Thursday 07:30 Randburg". After she picks one, a
`Quote` card arrives as a single image-light message: "Your scheme will pay R612. You pay R0 today.
This quote is guaranteed for this appointment." A link opens the Patient Space (under 150 kB) with
the Prepare section: what to bring, safety questions, consent.

**What they do.** Photograph the note, confirm ID, choose a slot, tap *Prepare now*, answer four
questions (pregnancy possibility, previous X-rays of the back, implants, preferred language), sign
consent with her finger, and add the appointment to her phone calendar from the link.

**What the Platform does.**
* M04 Referral & Orders: the Referral Hand (M20, automation A3 when every mandatory field extracts
  above threshold and the referrer's practice number is known and active; otherwise a BKG task)
  extracts referrer, practice number, requested study and clinical indication from the photo, with a
  `Provenance` chip on every field. Here all fields clear and the order is created. Event: `referral.received.v1`, `order.created.v1`.
* M03 Patient Master Index: matches the ID number and mobile number to an existing patient record from
  a visit two years ago at a different Practice in the Group (cross-tenant lookup under the recorded
  data-sharing agreement); no re-registration.
* M06 Funding & Authorisation: the Authorisation Hand (A3) runs a real-time benefit check through the
  scheme's API or the claims switch, applies the scheme's rule pack for the two tariff codes
  (illustrative: 30110 and 30120 stored as reference data), confirms no pre-authorisation is required
  for plain radiography, and issues a guaranteed quote. Event: `quote.issued.v1`.
* M05 Scheduling & Capacity: the Booking Hand (A3) ranks slots by distance, modality availability,
  radiographer roster (M17), licence status of the room (M02) and predicted no-show risk; holds the
  chosen slot for 10 minutes with a Durable Object lock. Event: `appointment.booked.v1`.
* M07 Registration & Safety: the Front Desk Hand (A3) presents the safety questions, the consent
  and the preparation within its message leash; the Platform stores answers and consent with
  timestamp, device and language (the Hand never marks consent as given; only her signature does);
  a "not sure" on pregnancy holds the appointment and creates a RAD task.
* M13 Results & Communication: schedules a reminder for 06:30 the next day and a load-shedding advisory
  if the site's Edge Gateway reports grid loss (imaging continues on UPS, the message says so).

**Edge cases.**
* Photo unreadable: the reply asks for a clearer photo or the doctor's name and the words on the
  note; BKG picks it up if still unclear.
* Scheme benefit exhausted for radiology out of hospital: the quote shows the patient portion with the
  arithmetic (tariff × units − scheme paid = you pay) and offers a payment plan before booking.
* Nomvula's data runs out: every message has an SMS twin; the confirmation SMS carries the time,
  site, what to bring and the quote.
* She wants a different site than the ones offered: "Other" lists all sites in the province.

**Success measure.** Booking completed in under 90 seconds on WhatsApp; quote later matches the
claim outcome to the rand (quote accuracy is a headline PAT metric); zero re-keying at the desk.

## Scene 2 - Cash patient: chest X-ray with price certainty

**Situation.** Sipho, 29, has no medical scheme. A clinic nurse has written "CXR, cough 3 weeks" on a
slip. He earns weekly and cannot be surprised by a bill.

**What they see.** On WhatsApp the first reply after the photo is the price, before any slot: "Chest
X-ray: R390 including VAT. Radiologist's report included. Nothing more to pay later." Payment
options: pay now by PayShap or card link (`PayLink`), or pay at the desk. If he pays now the slot is
confirmed immediately; if not, the slot is confirmed and the `CollectCard` at the desk will show
R390. Afrikaans and isiZulu are offered as language buttons on the first message.

**What they do.** Chooses "pay at the desk", books Saturday 08:00 at the site nearest the taxi rank
he uses, and later pays with a QR code at the desk.

**What the Platform does.**
* M06: applies the Practice's cash tariff (configurable per Practice, VAT-inclusive display
  mandatory) and issues a fixed quote; the quote is a binding price for that study and site.
* M14 Revenue Cycle: creates the charge at booking, marks it cash, and links the `PayLink`; if paid,
  a receipt PDF and SMS follow within seconds.
* M05: applies cash-patient no-show prediction (higher when unpaid) and offers a waitlist backfill
  candidate for the same slot without ever double-booking.
* M13: the report, once signed, lands in the Patient Space Results section with a plain-language
  layer; the clinic nurse or referring doctor is notified in the way they prefer.

**Edge cases.**
* He asks for a discount: the desk may apply only pre-configured discount rules (student, pensioner,
  hardship) with reason codes; anything else routes to PRM approval.
* He wants only the image and not the report: policy is that every study is reported; the price
  includes it; copy explains why in one sentence.
* He cannot pay the full amount on the day: a payment plan (two or three instalments via PayShap
  request-to-pay) can be set at the desk; the Collections Hand (A3) sends respectful reminders.

**Success measure.** Price shown before slot offer in 100 % of cash bookings; no cash patient ever
receives an invoice for more than the quoted amount.

## Scene 3 - RAF claimant: CT cervical spine after a motor vehicle accident

**Situation.** Lerato, 35, was a passenger in a taxi collision. Her attorney's paralegal phones
central booking with a referral for CT of the cervical spine and a Road Accident Fund (RAF) matter
number. Lerato has a medical scheme but does not want it charged for an accident claim.

**What they see.** Lerato receives a WhatsApp message asking her to confirm the accident date and to
upload a photo of the police accident report reference and any RAF or attorney letter. The Prepare
section shows a short consent explaining that her images and report may be shared with the RAF and
her attorney at her request, and only at her request. The quote card reads: "Funder: Road Accident
Fund claim. You will not be asked to pay today." with a note that if the RAF later declines, the
Practice will contact her before any other funder is billed.

**What they do.** Uploads the documents, confirms the date, books the CT, and grants attorney access
to results with a single toggle in Family & Sharing.

**What the Platform does.**
* M06: applies the Practice's RAF policy (configurable: bill the RAF directly under an undertaking,
  hold on account, or bill the scheme with the accident flag). Captures accident date, police case
  reference, attorney details, and the RAF claim number as structured fields; marks the scheme
  benefit check as suppressed for this order.
* M14: creates the account under the RAF funder class with the correct tariff schedule and holds
  submission until the required documents are present; the Coding Hand (A3) attaches ICD-10 external
  cause codes (V-codes, suggested from the indication, radiologist-confirmed on the report).
* M09 Image Management: a time-limited share link with audit trail can be issued to the attorney;
  no CD is ever burned unless requested.
* M19 Quality, Risk & Compliance: records the POPIA lawful basis for the third-party disclosure.

**Edge cases.**
* No RAF claim number yet: the order proceeds as "RAF pending"; the account is held with a 90-day
  review by DEB rather than dunned.
* Lerato later decides to use her scheme: the funder switch is a recorded change with reason and
  triggers a fresh benefit check and new quote.
* COIDA variant (injury on duty): the employer's report of accident and the Compensation Fund
  claim number are captured instead; the Compensation Fund tariff applies.

**Success measure.** No RAF or COIDA patient asked for money at the desk unless the policy says so;
zero claims sent to the wrong funder.

## Scene 4 - Occupational health worker: annual chest X-ray for a mine

**Situation.** Thabo, 52, is an underground worker. His employer's occupational health doctor has
ordered annual chest X-rays for 40 workers under the Occupational Diseases in Mines and Works Act
(ODMWA) programme. Bonakala's mobile unit visits the mine clinic.

**What they see.** Thabo gets an SMS the day before in Sesotho (his recorded preference), with the time
window and a one-line reason. At the mobile unit, a tablet shows his name, employee number and
photograph from the last visit; he confirms with a fingerprint on the site's ID device or his ID
document. After the study he receives: "Your chest X-ray is done. The mine doctor will get the
report. You can see it in your Patient Space." He can, because under POPIA it is his record.

**What they do.** Confirm identity, stand for the exposure, leave. Later, optionally, open the
Patient Space to see his own image and report.

**What the Platform does.**
* M04: a batch order from the occupational health doctor (see the REF journey) creates 40 orders under
  a corporate funder contract (M06), with the ILO classification read requested as a report template
  option (M12).
* M08 Acquisition & Worklist: the mobile unit's Edge Gateway serves the Modality Worklist offline; the
  radiographer's console keeps the batch in IndexedDB; images sync when the link returns.
* M10 Dose & Radiation Safety: dose per exposure is recorded against Thabo's cumulative record.
* M13: results are routed to the occupational health doctor as the primary recipient, to the
  employer's programme as a summary only (fit/unfit status, no images), and to Thabo's Patient
  Space. Retention follows the occupational record class (longer than the adult default).
* M14: one corporate invoice for the batch, itemised per worker, VAT applied, sent to the employer.

**Edge cases.**
* A worker is not on the batch list: the radiographer can add a walk-on under the same contract with
  PRM approval within the leash.
* A finding candidate for tuberculosis or pneumoconiosis: if the radiologist confirms a critical
  flag, the Critical Results Hand reaches the occupational health doctor, who then speaks to the
  radiologist; the employer is told nothing clinical.
* Thabo's phone is a feature phone: SMS only, no links; results are available in person at any site.

**Success measure.** 40 workers imaged in one visit with no paper; occupational health doctor receives
all reports within the contracted turnaround; worker access to own record at 100 %.

## Scene 5 - Child with guardian: forearm X-ray for a four-year-old

**Situation.** Zanele, 4, fell off a jungle gym. Her mother, Ayanda, brings her with a GP referral.
Ayanda is the scheme's principal member; Zanele is a dependant.

**What they see.** Ayanda's Patient Space already has a Family section. Adding Zanele asks for the
child's date of birth and ID or birth certificate number, and shows a one-line explanation of why:
"We keep your child's images until she is 27 (her 21st birthday plus 6 years). This is the law for
children's records." The Prepare section adapts: questions are asked about the child ("Does Zanele
have any metal in her arm from an earlier operation?"), and the consent is a guardian consent that
names Ayanda's relationship. At the site, a wristband is printed with Zanele's name and a picture
of a sun, because the paediatric protocol asks for a distraction object at the desk.

**What they do.** Add Zanele as a dependant, answer the safety questions, sign guardian consent,
check in on the kiosk with the wristband QR.

**What the Platform does.**
* M03: creates a child record linked to the guardian with a relationship type and effective date;
  the child's record becomes her own on her 18th birthday (guardian access lapses unless the child
  re-grants it; an SMS is sent to the child's own number if one is recorded).
* M07: applies the paediatric consent template and blocks check-in if the person presenting is not a
  recorded guardian, with a front-desk override that captures the relationship and a document.
* M08 and M10: the protocol card on the RAD console defaults to the paediatric exposure protocol
  and the paediatric diagnostic reference level; the `DoseGauge` uses the child's weight band.
* M06: the benefit check runs against the dependant code on the scheme membership, not the principal.
* M13: results are delivered to Ayanda as guardian, in a plain-language layer written for a parent.

**Edge cases.**
* Parents are separated and the father brings the child: any recorded guardian may consent; if he is
  not recorded, the desk records him with his ID and relationship and the principal member is
  notified of the visit.
* Zanele will not keep still: repeat exposures are recorded with the reason "patient movement,
  paediatric" and never counted against the radiographer's repeat-rate target without case-mix
  adjustment.
* Suspected non-accidental injury: the radiologist's report follows the Practice's safeguarding
  policy; the Platform records the notification pathway without exposing it in the Patient Space.

**Success measure.** Guardian consent captured before arrival in most cases; paediatric dose within
reference level; no child registered as a duplicate adult record.

## Scene 6 - Elderly patient with a family helper: hip X-rays and a lift to the site

**Situation.** Oom Pieter, 78, lives in a retirement village in Bloemfontein. His daughter, Marlize,
lives in Cape Town and manages his medical scheme and appointments. His Afrikaans is his first
language; his phone is old and his eyesight is poor. He needs hip and pelvis X-rays before a
possible replacement.

**What they see.** Marlize, as a delegated helper in the Family section (Pieter granted access with
an OTP read out to him by the front desk on a previous visit), books the study from Cape Town. Pieter
receives the confirmation in Afrikaans on SMS in large text: "U afspraak is Dinsdag 09:15 by
Bonakala Bloemfontein. Bring asseblief u ID en mediese fondskaart." (English gloss: "Your
appointment is Tuesday 09:15 at Bonakala Bloemfontein. Please bring your ID and medical scheme
card.") The Patient Space, opened on Marlize's phone, shows a *Transport* note: the site is on a
listed route and has step-free access; the village's shuttle time can be recorded so that the
reminder goes to the village office too.

**What they do.** Marlize books, answers the safety questions on Pieter's behalf (recorded as
answered by helper), and sets the reminder to go to both phones. Pieter arrives with the shuttle;
the front desk sees on the day screen that he has a helper and prefers Afrikaans and large print.

**What the Platform does.**
* M01 Identity & Access: helper access is a scoped grant (book, prepare, view results if allowed),
  revocable by the patient at any time, logged on every use.
* M05: applies the site's "mobility assistance" slot type (longer room time, ground-floor room).
* M07: the safety questionnaire records who answered; the radiographer confirms the pregnancy
  question is not applicable and reviews the answers with Pieter in person.
* M13: results go to Pieter's orthopaedic surgeon and, with Pieter's consent, to Marlize.
* M14: the `CollectCard` shows a co-payment of R120 (illustrative), which Marlize pays remotely via
  `PayLink` before he arrives so that nobody asks an elderly man for money at the desk.

**Edge cases.**
* Pieter has no phone: all messages go to Marlize; the site's reminder call (scripted by the Booking Hand in
  Afrikaans, placed by the site) goes to the village office number with his consent.
* Cognitive impairment: consent capacity is a clinical judgement; the Platform records that a
  helper or curator consented and the basis, and the radiographer confirms the patient's assent.
* Load-shedding at the retirement village on the morning of the appointment: the reminder includes
  the site's own status (imaging is running on UPS and generator).

**Success measure.** Helper-booked appointments complete without a single phone call to the patient;
large-print and language preferences honoured on every message.

## Scene 7 - Non-English speaker: booking in isiZulu on WhatsApp

**Situation.** MaDlamini, 63, from Umlazi, has a referral for an abdominal ultrasound. Her English is
limited; her daughter set up WhatsApp for her. She writes to the Bonakala number in isiZulu.

**What they see.** Her first message, "Sawubona, ngidinga i-scan yesisu" ("Hello, I need a scan of
the stomach"), is answered in isiZulu, with the language switch button still visible:

> "Sawubona MaDlamini. Sizokusiza. Sicela uthumele isithombe sencwadi kadokotela."
> (English gloss: "Hello MaDlamini. We will help you. Please send a photo of the doctor's letter.")

After the photo, the slot offer and quote follow in isiZulu with the same three-line, three-button
discipline. The preparation instruction for an abdominal ultrasound, which matters clinically, is
given as both text and a short voice note in isiZulu, because a voice note costs almost nothing in
data and is easier to follow than a paragraph:

> "Ungadli noma uphuze okungenani amahora ayisithupha ngaphambi kwe-scan. Amanzi kuphela."
> (English gloss: "Do not eat or drink for at least six hours before the scan. Water only.")

**What they do.** Sends the photo, picks the Umlazi-area site slot, listens to the voice note, and
replies "Yebo" to confirm.

**What the Platform does.**
* The WhatsApp conversation engine (apps/whatsapp) detects language from the first message, sets the
  patient's preferred language in M03, and loads the isiZulu message catalogue (packages/i18n).
  Where a message is not yet translated, the engine falls back to English and logs a translation gap
  for the content team; a Hand never machine-translates clinical instructions without a
  human-approved catalogue entry (translation is a Class 2 output in the AI charter and is gated).
* M05 books an ultrasound slot with a sonographer who lists isiZulu among their languages (M17
  credentials include languages spoken; a soft constraint).
* M07 records consent in isiZulu with the catalogue version, so the exact wording she agreed to can
  be reproduced.
* M13 delivers results with a plain-language layer in isiZulu; the full report stays in English for
  the referrer unless the referrer's preference says otherwise.

**Edge cases.**
* She writes in a mix of isiZulu and English: the engine responds in her preferred language and
  never "corrects" her.
* No sonographer speaks isiZulu at the nearest site: the confirmation says an interpreter (staff
  member or phone line) will be available; the site's day screen shows the need.
* SASL user: the Patient Space offers a SASL video for preparation instructions (planned phase) and
  the site books a longer slot.

**Success measure.** Conversations in isiZulu complete at the same rate as English ones; catalogue
coverage of patient-facing messages at 100 % for launch languages.

## Scene 8 - MRI-anxious patient: knee MRI with claustrophobia

**Situation.** Kevin, 47, has been referred for a knee MRI. He had a panic attack in a scanner ten
years ago and has been avoiding this for months.

**What they see.** The Prepare section for MRI begins with what the scan is like: a 40-second
audio clip of the actual gradient noise at low volume, a photo of the site's scanner (a real
photograph of the Bonakala room, not stock), and a line: "Your knee will be in the scanner. Your head
will be outside." The MRI safety questionnaire follows (pacemaker, implants, metal fragments in the
eyes, previous surgery, tattoos, kidney function if contrast is possible), then a question that
most services never ask: "Have you felt anxious in a scanner before?" Answering yes reveals three
options: a longer slot, a companion in the room, and a note to the radiographer. He can also choose
to visit the room beforehand at no charge.

**What they do.** Listens to the clip, answers yes to anxiety, picks a longer slot with a companion,
and adds "please talk to me through the headphones".

**What the Platform does.**
* M07: the MRI safety questionnaire is Class 1 safety data; positive answers for implants block the
  study until a radiographer clears it with documentation (implant card photo, model, MR-conditional
  status), recorded in the `SafetyChecklist`.
* M05: books the "extended MRI" slot type and adds the companion to the room booking; the
  radiographer's worklist shows the anxiety note before the patient arrives, not after.
* M08: the protocol card offers the shortest adequate knee protocol as the radiologist-approved
  default, with a note that a "feet-first, head out" position is possible for this study.
* M13: a message the evening before repeats what to expect and offers a WhatsApp voice reply from a
  radiographer for questions (routed to the site's MRI radiographer during hours; the Front Desk
  Hand answers routine preparation questions from the approved catalogue and escalates anything
  clinical to the radiographer).

**Edge cases.**
* He cannot complete the scan: the study is recorded as partial with reason; the radiologist reads
  what was acquired; the account is adjusted per the Practice's policy; a rebooking with sedation
  (arranged with the referrer) is offered.
* He needs sedation: this requires a prescriber and a nurse (NUR) in attendance; the booking is
  routed to a site that offers it.
* An implant answer is "not sure": the Platform never guesses; the study is held until cleared.

**Success measure.** MRI incomplete-for-anxiety rate falls against the baseline; anxiety disclosed
before arrival, not on the table.

## Scene 9 - Mammography screening invitee

**Situation.** Precious, 46, receives an invitation to screening mammography. Her scheme funds an
annual screening mammogram from a certain age (age thresholds vary by scheme and are stored as
reference data). She has no symptoms and is unsure whether it hurts.

**What they see.** A WhatsApp invitation that states the benefit clearly: "Your scheme pays for a
screening mammogram this year. Cost to you: R0." A link explains in five short lines what happens,
that the compression lasts seconds, that a female mammographer performs the study at Bonakala, and
what a "recall" means so that a recall never arrives as a shock. Booking asks the date of her last
period to avoid the most tender days, and whether she has prior mammograms elsewhere so that they
can be fetched. Results arrive within the stated turnaround as one of two plain messages: "No signs
of cancer were found. Your next screening is due in 12 months." or "We would like to take a closer
look. This is common and usually not cancer. Please book here." The full report and images are in
the Patient Space.

**What they do.** Books, confirms prior imaging at another provider and consents to fetching it,
attends, and receives her result.

**What the Platform does.**
* M04: creates a screening order under the scheme's screening benefit with the correct tariff and
  screening flag; M06 verifies eligibility (age, interval since last screen).
* M09: requests prior images from the other provider through DICOM exchange or a share link, with her
  consent recorded; priors sit in the `PriorStrip` for the radiologists.
* M11 BCI: the mammography AI model produces a findings candidate and a triage score; overlays are
  off by default for mammography (human-first policy) and are available on toggle after the first
  read.
* M12: double read by two radiologists (see the RGT journey), with arbitration on disagreement; the
  Platform does not release a screening result until both reads are signed or arbitrated.
* M13: recall messages are worded from the approved catalogue, never generated freely, and a recall
  appointment is offered in the same message.
* M19: the screening programme's recall rate, cancer detection rate and interval metrics are tracked
  against published programme standards (as reference data, not invented targets).

**Edge cases.**
* Symptomatic on booking ("I felt a lump"): the flow converts to a diagnostic mammogram with
  ultrasound, a different tariff and a same-week slot, and the referrer is informed.
* Breast implants: longer slot, implant-displacement views, safety note.
* She does not respond to a recall: the Platform retries by WhatsApp and SMS from the approved
  catalogue, then creates a site task to phone her, and tells the referrer; nothing is silently
  dropped.

**Success measure.** Screening invitations converted to attended studies; recall delivered with a
booked follow-up in the same message; no recall lost.

## Scene 10 - Emergency: casualty patient at 02:00 in a hospital-based site

**Situation.** An unidentified man, about 30, is brought to a private hospital casualty unit after a
fall. The casualty doctor orders a STAT CT head. Bonakala Practice C runs the imaging department in
this hospital as a JV. The patient cannot give his details.

**What they see.** The patient sees very little in the moment: a radiographer who calls him by the
temporary name on his wristband, and a scanner. What he sees afterwards matters: when he is
identified the next day, his sister receives, with his consent, a WhatsApp message linking the
Patient Space where the study, the report and the account are already correctly attributed to him.

**What they do.** Nothing at the time. Later: confirm identity, link scheme membership, review the
account.

**What the Platform does.**
* M02 and M21: the hospital's HL7 ADT feed creates a temporary patient ("Unknown Male 02:14") with a
  hospital visit number; the Platform mirrors it as a temporary M03 record flagged for later merge.
* M04: the casualty doctor's STAT order arrives as an HL7 ORM (or via the Referrer Space Urgent path);
  the order is priority STAT and skips authorisation (the funding class is "emergency, pending").
* M08: the Modality Worklist entry appears on the CT within seconds; the radiographer scans the
  wristband.
* M11: the intracranial haemorrhage model runs on arrival at the archive; a triage priority (never a
  diagnosis) is attached; the on-call Hub radiologist's worklist develops the study at the top.
* M12 and M13: the report is signed within the STAT target; for a critical finding the Critical
  Results Hand (A3) reaches the casualty doctor and records his acknowledgement, and the radiologist
  states the finding to him directly.
* M03: the next day the temporary record is merged into the identified patient by FDK with a typed
  `Confirm`; every study, dose record and charge follows the merge; the audit shows both identities.
* M06 and M14: once the scheme is known, the emergency is claimed under Prescribed Minimum Benefit
  rules where they apply (PMB status is suggested by the Coding Hand and confirmed by BIL), so that
  the patient is not billed for what the scheme must pay.

**Edge cases.**
* Patient never identified: the account is held under the hospital's unidentified-patient process;
  clinical records are retained under the standard class.
* Two temporary records for one person (a second scan ordered under a new visit number): the merge
  tool detects the same wristband and time window and proposes a single merge.
* Load-shedding hits the hospital: the Edge Gateway keeps MWL, MPPS and local storage alive; the
  study is read from the local cache by the on-site radiologist if the link is down, and the Hub
  reads when it returns.

**Success measure.** STAT CT head reported within target; critical finding acknowledged by the
casualty doctor within minutes; identity merged the next day with zero orphaned charges.

## Scene 11 - Results and follow-up: a lung nodule and a reminder six months later

**Situation.** Back to Sipho from Scene 2 (chest X-ray for a cough). His radiologist noted a small
pulmonary nodule, incidental, and recommended a follow-up CT in six months per the Practice's
incidental-findings policy. Six months is a long time in a life without a diary.

**What they see.** Within minutes of sign-off, Sipho receives: "Your chest X-ray report is ready.
Your doctor has it too. Open it here." The Results section shows three layers, in this order: a
plain-language summary written for him ("The radiologist saw a small spot on your lung. Most small
spots are not cancer. The radiologist recommends a CT scan in 6 months to check it has not
changed."), the full signed report, and the images with a share link. The plain-language layer is
marked as "written with computer help, checked by your radiologist" (the `Provenance` chip), because
it is generated from the signed report and is reviewed before release. A *Follow-up* card appears
with the due month and a button: "Remind me". Six months later, a message: "Your doctor
recommended a follow-up scan around now. Please contact your doctor. We have reminded the doctor
too." The message does not repeat the reason, by design: the Follow-up Hand never tells the patient
the reason and never books without a new referral. When the referral arrives, the booking and quote
flow from Scene 1 or 2 runs again, with the prior X-ray already in the `PriorStrip` for comparison.

**What they do.** Reads the summary, taps "Remind me", shows the report to his clinic nurse. Six
months later, goes to the clinic; the clinic sends the referral by WhatsApp and the booking follows.

**What the Platform does.**
* M12: the structured report carries a coded recommendation (follow-up CT, interval 6 months,
  reason: incidental pulmonary nodule) so that the follow-up is data, not a sentence buried in prose.
* M11 and M13: the plain-language layer is produced by the BCI plain-summary model (Class 3, A2)
  only from the signed report, using radiologist-approved sentence templates and a validator that
  maps every clinical statement to a signed sentence; the Practice may require the radiologist's
  one-click approval at sign-off for chosen report types and samples the rest. Event:
  `report.signed.v1`, `report.distributed.v1`.
* M13: the Follow-up Hand (A3) creates a follow-up obligation with a due date, owner (referrer) and
  patient; it reminds the referrer ahead of the due date (up to three reminders per loop) and, with
  the referrer's consent, sends the patient the neutral reminder above; a loop still open 30 days
  past the recommended date becomes a PRM task and a visibility flag for the radiologist. Event:
  `followup.due.v1`, `followup.closed.v1`.
* M06 and M14: the reminder message carries the expected price or scheme position so that cost is
  never the reason to skip a follow-up.
* M16 Analytics & Insight: the Practice sees its follow-up completion rate, a quality measure that
  most of the market does not track.

**Edge cases.**
* Sipho changes his number: the Follow-up Hand tries SMS, WhatsApp and email; if all fail, the
  referrer is asked; the obligation is never closed silently, only with a reason.
* The referrer does not respond: the loop escalates to PRM, who contacts the referrer's practice;
  the Hand never books without a new referral, and the patient is told whom to contact.
* The follow-up CT shows the nodule has grown: the report triggers the critical or urgent results
  pathway to the referrer; the patient message is the approved neutral wording and directs him to
  his doctor.

**Success measure.** Incidental-finding follow-ups completed on time as a tracked percentage;
plain-language layer read rate; no follow-up obligation closed without a recorded reason.

## Moments that beat the market

* The price is shown before the slot, and the quote is guaranteed; the desk collects what the quote
  said and nothing else.
* Booking, preparation and consent happen on WhatsApp or a page under 150 kB, in the patient's own
  language, and every step has an SMS twin for when data runs out.
* One identity across every Bonakala site nationally: no forms at the second branch, priors fetched
  automatically, guardian and helper access built in.
* The waiting room has a status: "You are next. Room 2." on the phone, not a paper number.
* Results and images arrive in the Patient Space minutes after sign-off, with a plain-language layer
  the radiologist approved, and a share link instead of a CD.
* A follow-up recommendation becomes a tracked obligation with reminders to both doctor and patient,
  so an incidental nodule is not forgotten for two years.
* Safety questions (MRI, pregnancy, contrast, anxiety) are asked at home the day before, where the
  patient can check an implant card, not on the table.
* Load-shedding is invisible: imaging continues on the Edge Gateway, and the reminder tells the
  patient so.

## Failure modes designed out

* Co-payment surprise months later: the benefit check and rule pack run at booking; any later
  variance between quote and claim is absorbed or explained, never silently billed.
* Wrong patient: ID scan, wristband QR, guardian and helper grants, and typed confirmation on merges.
* Lost paper referral: the photo becomes a structured order with provenance; the original image is
  retained.
* Missed critical result: the Critical Results Hand reaches the referrer, records the
  acknowledgement and connects the radiologist; the site-wide banner never auto-dismisses.
* Machine translation of clinical instructions: all patient-facing catalogue entries are
  human-approved per language; the engine falls back to English rather than guess.
* AI presented as a diagnosis: every AI-derived element carries the annotated style and the model
  version; the patient sees only radiologist-signed content.
* Missed follow-up: follow-up obligations are data with owners and due dates; closure requires a reason.
* Child records merged with adults, or guardian access outliving childhood: relationship types with
  effective dates, automatic lapse at 18.
