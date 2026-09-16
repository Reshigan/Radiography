import { eq as eqFn } from 'drizzle-orm';
import { newId, formatAccession } from '@bonakala/domain';
import { PROCEDURES, findProcedure, routeModels, runDemoModel, runConsistencyCheck, runDoseOutlier, getDemoModel, DEMO_MODELS, hashString, seededRng, type BciPriority, type BciResult } from '@bonakala/domain/bci';
import type { Db } from '../types.js';
import * as s from '../schema/index.js';
import type { SeedContext } from './context.js';
import { rng, pick } from './data.js';

/**
 * Cluster B seeder: protocols, DRLs, templates, the model registry, 30 days of studies with
 * synthetic images metadata, dose records, inference results, signed reports, deliveries, critical
 * results, follow-ups and peer reviews. Idempotent: it checks for existing studies first.
 *
 * It publishes ctx.extra.studies and ctx.extra.reports for cluster C (billing) and consumes
 * ctx.extra.orders / ctx.extra.appointments from cluster A when they are present.
 */
export async function seedClusterB(db: Db, ctx: SeedContext): Promise<Record<string, number> | void> {
  const existing = await db.select({ id: s.studies.id }).from(s.studies).limit(1);
  if (existing.length) {
    // Republish the handles so later clusters still get them on a warm database.
    const studies = await db.select().from(s.studies);
    const reports = await db.select().from(s.reports);
    ctx.extra.studies = studies.map((x) => ({ id: x.id, accession: x.accession, patientId: x.patientId, practiceId: x.practiceId, siteId: x.siteId, modality: x.modality, procedureCode: x.procedureCode, referrerId: x.referrerId, orderId: x.orderId, receivedAt: x.receivedAt, status: x.status }));
    ctx.extra.reports = reports.filter((x) => x.status === 'signed' || x.status === 'amended').map((x) => ({ id: x.id, studyId: x.studyId, accession: x.accession, patientId: x.patientId, practiceId: x.practiceId, siteId: x.siteId, referrerId: x.referrerId, procedureCodes: [] as string[], icd10: [] as string[], signedAt: x.signedAt }));
    return;
  }

  const r = rng(1811);
  const now = new Date(ctx.now);
  const iso = (d: Date) => d.toISOString();
  const daysAgo = (n: number, hour = 9, minute = 0) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - n); d.setUTCHours(hour - 2, minute, 0, 0); return d; };
  const summary: Record<string, number> = {};

  /* ---------- 1. Protocol library ---------- */
  const roomTypeOf: Record<string, string> = { DX: 'XR', CT: 'CT', MR: 'MR', US: 'US', MG: 'MG', DXA: 'DXA' };
  const protocolRows: (typeof s.protocols.$inferInsert)[] = [];
  const protocolByProcedure = new Map<string, string>();
  const contrastRule = { agent: 'Iohexol 350 (demo)', concentration: '350 mgI/mL', mlPerKg: 1.5, maxMl: 150, rateMlS: 3, egfrMin: 30 };
  for (const proc of PROCEDURES) {
    const requiresRgt = proc.modality === 'CT' || proc.modality === 'MR' || proc.code === '34120';
    const standing = proc.code === '31135' || proc.code === '31110' ? `SR-${proc.code}` : null; // RGT-approved standing rules
    const adultId = `prot_${proc.code}_a`;
    protocolRows.push({
      id: adultId, practiceId: null, code: `${proc.modality}-${proc.code}-A`, name: `${proc.description} · adult`, modalityType: proc.modality, bodyPart: proc.bodyPart, procedureCodes: [proc.code], ageBand: 'adult', contrast: !!proc.contrast,
      parameters: paramsFor(proc.modality, proc.bodyPart, false), expectedSeries: proc.series.map((x) => x.description),
      drlQuantity: proc.doseQuantity ?? null, drlValue: proc.drl ? Math.round(proc.drl * 1000) : null, contrastRule: proc.contrast ? contrastRule : null,
      requiresRgt, standingRule: standing, version: 1, status: 'active',
    });
    protocolByProcedure.set(proc.code, adultId);
    // Paediatric variants for the common ionising studies
    if (proc.doseQuantity && ['chest', 'head', 'limb', 'hand', 'abdomen', 'knee'].includes(proc.bodyPart)) {
      protocolRows.push({
        id: `prot_${proc.code}_p`, practiceId: null, code: `${proc.modality}-${proc.code}-P`, name: `${proc.description} · paediatric`, modalityType: proc.modality, bodyPart: proc.bodyPart, procedureCodes: [proc.code], ageBand: 'paediatric', contrast: !!proc.contrast,
        parameters: paramsFor(proc.modality, proc.bodyPart, true), expectedSeries: proc.series.map((x) => x.description),
        drlQuantity: proc.doseQuantity ?? null, drlValue: proc.drl ? Math.round(proc.drl * 450) : null, contrastRule: proc.contrast ? { ...contrastRule, mlPerKg: 2, maxMl: 80 } : null,
        requiresRgt: true, standingRule: null, version: 1, status: 'active',
      });
    }
  }
  // Practice-specific variants so the library shows local entries too
  protocolRows.push(
    { id: 'prot_local_ctkub_b', practiceId: ctx.practiceB, code: 'CT-31135-UMH', name: 'CT KUB low dose · Umhlanga', modalityType: 'CT', bodyPart: 'abdomen', procedureCodes: ['31135'], ageBand: 'adult', contrast: false, parameters: { kvp: 120, mas: 'auto (ref 120)', slice: '3 mm', pitch: 1.2 }, expectedSeries: ['Scout', 'Axial 3 mm'], drlQuantity: 'DLP', drlValue: 520_000, contrastRule: null, requiresRgt: false, standingRule: 'SR-31135', version: 2, status: 'active' },
    { id: 'prot_local_cxr_a', practiceId: ctx.practiceA, code: 'DX-30110-SAN', name: 'Chest PA and lateral · Sandton high kV', modalityType: 'DX', bodyPart: 'chest', procedureCodes: ['30110'], ageBand: 'adult', contrast: false, parameters: { kvp: 125, mas: 2.5, grid: 'yes', sid: '180 cm' }, expectedSeries: ['PA', 'Lateral'], drlQuantity: 'DAP', drlValue: 280, contrastRule: null, requiresRgt: false, standingRule: null, version: 3, status: 'active' },
  );
  await db.insert(s.protocols).values(protocolRows);
  summary.protocols = protocolRows.length;

  /* ---------- 2. DRL reference data ---------- */
  const drlRows: (typeof s.referenceData.$inferInsert)[] = [];
  for (const proc of PROCEDURES) {
    if (!proc.drl || !proc.doseQuantity) continue;
    drlRows.push({ id: newId('ref'), kind: 'drl', key: proc.code, practiceId: null, value: { quantity: proc.doseQuantity, value: proc.drl, paediatric: Math.round(proc.drl * 0.45 * 1000) / 1000, large: Math.round(proc.drl * 1.3 * 1000) / 1000, source: 'national (illustrative; SA Directorate of Radiation Control values are revised periodically)', description: proc.description }, effectiveFrom: '2026-01-01', version: 1 });
  }
  drlRows.push({ id: newId('ref'), kind: 'drl', key: '31110', practiceId: ctx.practiceB, value: { quantity: 'DLP', value: 820, paediatric: 350, large: 1100, source: 'site-derived 75th percentile, recomputed monthly' }, effectiveFrom: '2026-08-01', version: 2 });
  await db.insert(s.referenceData).values(drlRows);
  summary.drls = drlRows.length;

  /* ---------- 3. Report templates ---------- */
  const templates: (typeof s.reportTemplates.$inferInsert)[] = [
    tpl('TPL-CXR', 'Chest radiograph', 'DX', 'chest', { technique: 'PA and lateral chest radiographs.', findings: 'Lungs are clear. Cardiomediastinal contour within normal limits. No pleural effusion. Osseous structures unremarkable.', impression: 'No acute cardiopulmonary abnormality.' }, ['findings', 'impression'], { pattern: ['normal', 'consolidation', 'effusion', 'pneumothorax', 'TB-suggestive', 'nodule'] }, ['R91.8', 'J18.9', 'A15.0']),
    tpl('TPL-ABDXR', 'Abdomen radiograph', 'DX', 'abdomen', { technique: 'Supine and erect abdominal radiographs.', findings: 'Bowel gas pattern is unremarkable. No free intraperitoneal gas. No abnormal calcification.', impression: 'No acute abdominal abnormality.' }, ['findings', 'impression'], {}, ['R10.4', 'K56.6']),
    tpl('TPL-MSK', 'Limb radiograph', 'DX', 'limb', { technique: 'Standard views of the affected limb.', findings: 'No fracture or dislocation. Joint spaces are preserved. Soft tissues are unremarkable.', impression: 'No acute bony injury.' }, ['findings', 'impression', 'laterality'], { fracture: ['none', 'undisplaced', 'displaced', 'comminuted'] }, ['S52.5', 'S82.6', 'M25.5']),
    tpl('TPL-SPINEXR', 'Spine radiograph', 'DX', 'spine', { technique: 'AP and lateral radiographs of the spine.', findings: 'Vertebral body heights are maintained. Alignment is normal. Disc spaces are preserved.', impression: 'No acute bony abnormality.' }, ['findings', 'impression'], {}, ['M54.5', 'S22.0']),
    tpl('TPL-CTH', 'CT brain', 'CT', 'head', { technique: 'Non-contrast axial CT of the brain, 5 mm and thin reconstructions.', findings: 'No intracranial haemorrhage, mass effect or midline shift. Grey-white differentiation is preserved. Ventricles are of normal size.', impression: 'No acute intracranial abnormality.' }, ['findings', 'impression'], { haemorrhage: ['none', 'subdural', 'extradural', 'subarachnoid', 'intraparenchymal'] }, ['I61.9', 'S06.5', 'R51']),
    tpl('TPL-CTCH', 'CT chest', 'CT', 'chest', { technique: 'Contrast-enhanced axial CT of the chest with soft tissue and lung reconstructions.', findings: 'No pulmonary embolus. No focal consolidation or pleural effusion. No mediastinal lymphadenopathy.', impression: 'No acute intrathoracic abnormality.' }, ['findings', 'impression'], { nodule: ['none', 'solid', 'part-solid', 'ground glass'] }, ['I26.9', 'C34.9', 'J84.9']),
    tpl('TPL-CTAB', 'CT abdomen and pelvis', 'CT', 'abdomen', { technique: 'Contrast-enhanced axial CT of the abdomen and pelvis, portal venous phase.', findings: 'Liver, spleen, pancreas, adrenals and kidneys are unremarkable. No free fluid or free gas. No bowel obstruction.', impression: 'No acute intra-abdominal abnormality.' }, ['findings', 'impression'], {}, ['R10.4', 'K35.8', 'N20.0']),
    tpl('TPL-CTSP', 'CT spine', 'CT', 'spine', { technique: 'Axial CT of the spine with sagittal and coronal reconstructions.', findings: 'Vertebral alignment is normal. No fracture. Disc spaces and facet joints are preserved.', impression: 'No acute bony injury of the spine.' }, ['findings', 'impression'], {}, ['S12.9', 'M54.2']),
    tpl('TPL-MRB', 'MRI brain', 'MR', 'head', { technique: 'Multiplanar multisequence MRI of the brain including T1, T2, FLAIR and diffusion-weighted imaging.', findings: 'No restricted diffusion. No intracranial mass or abnormal enhancement. White matter signal is within normal limits for age.', impression: 'Normal MRI of the brain.' }, ['findings', 'impression'], {}, ['G93.9', 'I63.9']),
    tpl('TPL-MRL', 'MRI lumbar spine', 'MR', 'spine', { technique: 'Sagittal T1 and T2, axial T2 sequences of the lumbar spine.', findings: 'Vertebral body heights and marrow signal are normal. No disc herniation or canal stenosis. Conus terminates at L1.', impression: 'No significant discogenic or compressive abnormality.' }, ['findings', 'impression', 'levels'], { level: ['L1-2', 'L2-3', 'L3-4', 'L4-5', 'L5-S1'] }, ['M51.1', 'M48.0']),
    tpl('TPL-MRK', 'MRI knee', 'MR', 'knee', { technique: 'Multiplanar MRI of the knee including proton density fat-saturated sequences.', findings: 'Menisci are intact. Cruciate and collateral ligaments are intact. No marrow oedema. Small joint effusion.', impression: 'No meniscal or ligamentous tear.' }, ['findings', 'impression', 'laterality'], {}, ['S83.2', 'M23.2']),
    tpl('TPL-USAB', 'Ultrasound abdomen', 'US', 'abdomen', { technique: 'Real-time greyscale ultrasound of the abdomen.', findings: 'Liver is of normal size and echotexture. Gallbladder is distended with no calculi. Kidneys are of normal size with no hydronephrosis.', impression: 'Normal abdominal ultrasound.' }, ['findings', 'impression'], {}, ['K76.0', 'N20.1']),
    tpl('TPL-USOB', 'Ultrasound obstetric', 'US', 'obstetric', { technique: 'Transabdominal obstetric ultrasound with biometry.', findings: 'Single intrauterine pregnancy with cardiac activity. Biometry is consistent with dates. Liquor volume is normal. Placenta is posterior and clear of the os.', impression: 'Single viable intrauterine pregnancy appropriate for dates.' }, ['findings', 'impression', 'biometry'], {}, ['Z36.3']),
    tpl('TPL-MG', 'Mammography', 'MG', 'breast', { technique: 'Bilateral digital mammography, CC and MLO views.', findings: 'Breast density category b. No dominant mass, suspicious calcification or architectural distortion in either breast.', impression: 'No mammographic evidence of malignancy. Routine screening interval recommended.' }, ['findings', 'impression', 'density', 'birads'], { birads: ['0', '1', '2', '3', '4', '5'], density: ['a', 'b', 'c', 'd'] }, ['Z12.31', 'N63']),
    tpl('TPL-DXA', 'DXA bone density', 'DXA', 'spine', { technique: 'Dual-energy X-ray absorptiometry of the lumbar spine and proximal femur.', findings: 'Lumbar spine and femoral neck bone mineral density are within the expected range for age.', impression: 'Normal bone mineral density.' }, ['findings', 'impression'], {}, ['M81.0', 'Z13.820']),
  ];
  await db.insert(s.reportTemplates).values(templates);
  summary.reportTemplates = templates.length;

  /* ---------- 4. Model registry with status per site ---------- */
  const siteIds = Object.values(ctx.sites);
  const registryRows: (typeof s.modelRegistry.$inferInsert)[] = DEMO_MODELS.map((m) => {
    const siteStatus: Record<string, 'activated' | 'shadow' | 'paused' | 'off'> = {};
    let lifecycle = 'activated';
    if (m.id === 'msk-fracture') { lifecycle = 'shadow'; for (const site of siteIds) siteStatus[site] = 'shadow'; }
    if (m.id === 'mg-detect') { siteStatus[ctx.sites.BAL] = 'off'; siteStatus[ctx.sites.RBG] = 'shadow'; }
    if (m.id === 'cxr-triage') siteStatus[ctx.sites.RBG] = 'activated';
    if (m.id === 'us-qc') siteStatus[ctx.sites.BAL] = 'shadow';
    return { id: `${m.id}@${m.version}`, modelId: m.id, practiceId: null, name: m.name, version: m.version, task: m.task, outputClass: m.outputClass, modalities: m.modalities, bodyParts: m.bodyParts ?? null, vendor: m.vendor, samdStatus: m.samdStatus, compute: m.compute, overlaysDefault: m.overlaysDefault, lifecycle, siteStatus, validationSummary: m.validation as unknown as Record<string, unknown>, limitations: m.limitations, description: m.description, demo: true, bundleDigest: `sha256:${m.id}-${m.version}-demo` };
  });
  // A superseded version kept in the registry so the change-control screen has history
  registryRows.push({ id: 'cxr-triage@2.2.0', modelId: 'cxr-triage', practiceId: null, name: 'BCI-CXR-TRIAGE', version: '2.2.0', task: 'triage', outputClass: 4, modalities: ['DX', 'CR'], bodyParts: ['chest'], vendor: 'bonakala', samdStatus: 'registered_samd_MD-2025-0413', compute: 'cf-container-cpu', overlaysDefault: 'on', lifecycle: 'deprecated', siteStatus: {}, validationSummary: { dataset: 'SA CXR held-out', n: 8800, sensitivity: 0.93, lastValidatedAt: '2025-11-02' }, limitations: ['superseded by 2.3.1'], description: 'Previous chest triage version, retained for rollback.', demo: true, bundleDigest: 'sha256:cxr-triage-2.2.0-demo' });
  // The M11 boot may already have inserted the Group registry rows; update those and insert the rest,
  // so the seeded per-site statuses (shadow, paused, off) are what the console shows.
  const existingModels = new Set((await db.select({ id: s.modelRegistry.id }).from(s.modelRegistry)).map((x) => x.id));
  const newModels = registryRows.filter((x) => !existingModels.has(x.id as string));
  for (const row of registryRows.filter((x) => existingModels.has(x.id as string))) {
    await db.update(s.modelRegistry).set({ lifecycle: row.lifecycle, siteStatus: row.siteStatus, validationSummary: row.validationSummary, limitations: row.limitations, description: row.description }).where(eqFn(s.modelRegistry.id, row.id as string));
  }
  if (newModels.length) await db.insert(s.modelRegistry).values(newModels);
  summary.bciModels = registryRows.length;

  /* ---------- 5. Studies over 30 days ---------- */
  const orders = (ctx.extra.orders as Array<{ id: string; patientId: string; practiceId: string; siteId?: string; referrerId?: string; procedures?: Array<{ code: string }>; priority?: string; icd10?: string[] }> | undefined) ?? [];
  const rooms = await db.select().from(s.rooms);
  const roomsBySite: Record<string, typeof rooms> = {};
  for (const room of rooms) (roomsBySite[room.siteId] ??= []).push(room);
  const usersByPersona = ctx.users;
  const sitePractice: Record<string, string> = { [ctx.sites.SAN]: ctx.practiceA, [ctx.sites.RBG]: ctx.practiceA, [ctx.sites.UMH]: ctx.practiceB, [ctx.sites.BAL]: ctx.practiceB };
  const accessionPrefix: Record<string, string> = { [ctx.practiceA]: 'BSAN', [ctx.practiceB]: 'BUMH' };
  const accSeq: Record<string, number> = { [ctx.practiceA]: 0, [ctx.practiceB]: 0 };

  const studyRows: (typeof s.studies.$inferInsert)[] = [];
  const seriesRows: (typeof s.series.$inferInsert)[] = [];
  const instanceRows: (typeof s.instances.$inferInsert)[] = [];
  const worklistRows: (typeof s.worklistItems.$inferInsert)[] = [];
  const doseRows: (typeof s.doseRecords.$inferInsert)[] = [];
  const inferenceRows: (typeof s.inferenceResults.$inferInsert)[] = [];
  const repeatRows: (typeof s.repeatRejects.$inferInsert)[] = [];
  const contrastRows: (typeof s.contrastAdministrations.$inferInsert)[] = [];
  const reportRows: (typeof s.reports.$inferInsert)[] = [];
  const deliveryRows: (typeof s.resultDeliveries.$inferInsert)[] = [];
  const criticalRows: (typeof s.criticalResults.$inferInsert)[] = [];
  const followupRows: (typeof s.followups.$inferInsert)[] = [];
  const notificationRows: (typeof s.notifications.$inferInsert)[] = [];
  const peerRows: (typeof s.peerReviews.$inferInsert)[] = [];
  const addendaRows: (typeof s.addenda.$inferInsert)[] = [];

  const patients = await db.select({ id: s.patients.id, practiceId: s.patients.practiceId, firstName: s.patients.firstName, lastName: s.patients.lastName, sex: s.patients.sex, dateOfBirth: s.patients.dateOfBirth, flags: s.patients.flags }).from(s.patients);
  const patientsByPractice: Record<string, typeof patients> = {};
  for (const p of patients) (patientsByPractice[p.practiceId] ??= []).push(p);

  const radiologists = [{ id: usersByPersona.RGT!, hpcsa: 'MP 0456789', practice: ctx.practiceB }, { id: usersByPersona.RGT2!, hpcsa: 'MP 0456790', practice: ctx.practiceA }];
  const TOTAL = 200;
  const publishedStudies: Array<Record<string, unknown>> = [];
  const publishedReports: Array<Record<string, unknown>> = [];
  let criticalOpen = 0;
  let followupsMade = 0;

  for (let i = 0; i < TOTAL; i++) {
    // Spread over 30 days with more today so consoles look alive
    const dayOffset = i < 24 ? 0 : Math.min(29, Math.floor(Math.pow(r(), 0.85) * 30));
    // Today's studies must already have happened: cap the hour at the current SAST hour.
    const sastHourNow = Number(new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(now));
    const latest = dayOffset === 0 ? Math.max(8, Math.min(17, sastHourNow - 1)) : 17;
    const hour = 7 + Math.floor(r() * Math.max(1, latest - 7));
    const minute = pick(r, [0, 10, 20, 30, 40, 50]);
    const when = daysAgo(dayOffset, hour, minute);
    const order = orders.length ? orders[i % orders.length] : undefined;
    const siteId = order?.siteId && sitePractice[order.siteId] ? order.siteId : pick(r, siteIds);
    const practiceId = sitePractice[siteId]!;
    const pool = patientsByPractice[practiceId] ?? patients;
    const patient = order?.patientId ? patients.find((p) => p.id === order.patientId) ?? pick(r, pool) : pick(r, pool);
    let procCode = order?.procedures?.[0]?.code && findProcedure(order.procedures[0]!.code) ? order.procedures[0]!.code : weightedProcedure(r);
    const patientAgeNow = patient.dateOfBirth ? Math.floor((when.getTime() - new Date(patient.dateOfBirth).getTime()) / (365.25 * 86400_000)) : 40;
    // Obstetric ultrasound and mammography are booked for adult female patients only; DXA for adults.
    const needsAdultFemale = ['34110', '34120', '33120'];
    if (needsAdultFemale.includes(procCode) && (patient.sex !== 'F' || patientAgeNow < (procCode === '33120' ? 16 : 35))) procCode = '30110';
    if (procCode === '35110' && patientAgeNow < 40) procCode = '30110';
    const proc = findProcedure(procCode)!;
    const room = (roomsBySite[siteId] ?? []).find((x) => x.roomType === roomTypeOf[proc.modality]) ?? (roomsBySite[siteId] ?? [])[0];
    if (!room) continue;
    const priority = order?.priority ?? (r() < 0.05 ? 'stat' : r() < 0.15 ? 'urgent' : 'routine');
    const referrerId = order?.referrerId ?? pick(r, ctx.referrers);
    const ageY = patient.dateOfBirth ? Math.floor((when.getTime() - new Date(patient.dateOfBirth).getTime()) / (365.25 * 86400_000)) : 40;
    const laterality = proc.laterality ? (hashString(patient.id + procCode) % 2 ? 'L' : 'R') : null;

    accSeq[practiceId]! += 1;
    const accession = formatAccession(accessionPrefix[practiceId]!, when.getUTCFullYear(), accSeq[practiceId]!);
    const studyId = newId('stu');
    const studyUid = `1.2.826.0.1.3680043.10.${hashString(accession) % 100000}.${hashString(studyId) % 100000}`;
    const storagePrefix = `${practiceId}/studies/${studyId}`;
    const receivedAt = iso(when);
    const completedAt = iso(new Date(when.getTime() + (8 + Math.floor(r() * 25)) * 60_000));
    const indication = pick(r, PROCEDURE_INDICATIONS[procCode] ?? INDICATIONS[proc.bodyPart] ?? ['Clinical assessment']);
    const isToday = dayOffset === 0;
    const wlId = newId('wl');
    const protocolId = ageY < 16 && protocolRows.some((x) => x.id === `prot_${procCode}_p`) ? `prot_${procCode}_p` : protocolByProcedure.get(procCode)!;
    const egfr = proc.contrast ? 45 + Math.floor(r() * 60) : null;

    // Worklist item (MWL)
    worklistRows.push({
      id: wlId, practiceId, siteId, roomId: room.id, modalityType: proc.modality, orderId: order?.id ?? null, appointmentId: null, patientId: patient.id, patientName: `${patient.lastName}, ${patient.firstName}`,
      referrerId, procedureCode: procCode, procedureDescription: proc.description, bodyPart: proc.bodyPart, laterality, contrast: !!proc.contrast, priority, indication,
      scheduledAt: iso(new Date(when.getTime() - 12 * 60_000)), status: 'completed', protocolId, protocolSource: proc.modality === 'CT' || proc.modality === 'MR' ? 'rgt' : 'hand',
      protocolProvenance: { modelId: 'protocol-hand', modelVersion: '2.4.1', confidence: 0.97, reasons: [`procedure ${procCode} maps to the library`, ageY < 16 ? `age ${ageY}: paediatric variant selected` : 'adult band'], acceptedBy: proc.modality === 'CT' || proc.modality === 'MR' ? radiologists[0]!.id : usersByPersona.RAD!, acceptedAt: iso(new Date(when.getTime() - 6 * 60_000)) },
      safetyGate: { allowed: true, reason: 'M07 safety questionnaire cleared', source: 'm07', checkedAt: iso(new Date(when.getTime() - 10 * 60_000)), pregnancy: patient.sex === 'F' && ageY >= 12 && ageY <= 55 ? 'no' : 'n/a', egfr, allergies: (patient.flags ?? []).includes('contrast_reaction') ? 'previous contrast reaction' : 'none', metformin: proc.contrast ? 'no' : 'n/a', reconfirmedAt: iso(new Date(when.getTime() - 4 * 60_000)), reconfirmedBy: usersByPersona.RAD! },
      identityCheck: { identifiers: ['full_name', 'date_of_birth'], wristbandScanned: true, checkedBy: usersByPersona.RAD!, checkedAt: iso(new Date(when.getTime() - 3 * 60_000)) },
      technologistUserId: usersByPersona.RAD!, studyId, accession, arrivedAt: iso(new Date(when.getTime() - 20 * 60_000)), startedAt: receivedAt, completedAt, emergency: false, createdAt: iso(new Date(when.getTime() - 86400_000)), updatedAt: completedAt,
    });

    // Study, series and instances
    let instanceCount = 0;
    const seriesIds: string[] = [];
    const seriesUids: string[] = [];
    proc.series.forEach((sd, si) => {
      const seriesId = newId('ser');
      seriesIds.push(seriesId);
      const seriesUid = `${studyUid}.${si + 1}`;
      seriesUids.push(seriesUid);
      seriesRows.push({ id: seriesId, practiceId, studyId, seriesUid, number: si + 1, description: sd.description, modality: proc.modality, view: sd.view ?? null, instanceCount: sd.instances, rejected: false, createdAt: receivedAt });
      for (let k = 0; k < Math.min(sd.instances, 6); k++) {
        instanceRows.push({ id: newId('img'), practiceId, studyId, seriesId, sopUid: `${seriesUid}.${k + 1}`, number: k + 1, storageKey: `${storagePrefix}/${seriesId}/${k + 1}.svg`, contentType: 'image/svg+xml', rows: 512, cols: 512, view: sd.view ?? null, laterality, rejected: false, createdAt: receivedAt });
      }
      instanceCount += sd.instances;
    });
    const priorIds = studyRows.filter((x) => x.patientId === patient.id).slice(-3).map((x) => x.id as string);
    studyRows.push({
      id: studyId, practiceId, siteId, roomId: room.id, patientId: patient.id, accession, studyUid, orderId: order?.id ?? null, appointmentId: null, worklistItemId: wlId, referrerId,
      modality: proc.modality, procedureCode: procCode, procedureDescription: proc.description, bodyPart: proc.bodyPart, laterality, indication, priority, status: 'complete',
      seriesCount: proc.series.length, instanceCount, storagePrefix, priorIds, keyImageIds: [], technologistNote: r() < 0.12 ? pick(r, TECH_NOTES) : null, technologistUserId: usersByPersona.RAD!,
      retentionClass: ageY < 18 ? 'paediatric' : 'standard', external: false, unmatched: false, receivedAt, completedAt, createdAt: receivedAt, updatedAt: completedAt,
    });

    // Repeats (about 4 % of studies)
    if (r() < 0.045) repeatRows.push({ id: newId('rr'), practiceId, siteId, roomId: room.id, modalityType: proc.modality, worklistItemId: wlId, studyId, seriesId: null, kind: 'repeat', reasonCode: pick(r, ['positioning', 'exposure', 'motion', 'artefact', 'patient_movement']), reasonText: null, technologistUserId: usersByPersona.RAD!, qcSuggested: r() < 0.6, createdAt: receivedAt });

    // Contrast administration
    if (proc.contrast && egfr && egfr >= 30) {
      const weight = 55 + Math.floor(r() * 50);
      contrastRows.push({ id: newId('ctr'), practiceId, siteId, worklistItemId: wlId, studyId, patientId: patient.id, agent: 'Iohexol 350 (demo)', concentration: '350 mgI/mL', weightKg: weight, egfr, volumePlannedMl: Math.min(150, Math.round(weight * 1.5)), volumeDeliveredMl: Math.min(150, Math.round(weight * 1.5)), rateMlS: 30, batchNo: `LOT-${2026}${String(1 + Math.floor(r() * 9)).padStart(2, '0')}-${Math.floor(r() * 900) + 100}`, expiry: '2027-06-30', manualReason: null, status: 'administered', administeredBy: usersByPersona.NUR!, administeredAt: receivedAt, reaction: null, createdAt: receivedAt });
    }

    // Dose record
    const repeats = repeatRows.filter((x) => x.studyId === studyId).length;
    const sizeClass = ageY < 16 ? 'paediatric' : hashString(accession) % 7 === 0 ? 'large' : 'standard';
    if (proc.doseQuantity && proc.doseTypical) {
      const dr = seededRng(hashString(`dose|${accession}`));
      const spread = Math.exp((dr() - 0.45) * 0.55);
      let value = proc.doseTypical * spread * (sizeClass === 'large' ? 1.35 : sizeClass === 'paediatric' ? 0.45 : 1) * (1 + repeats * 0.5);
      value = Math.round(value * 1000) / 1000;
      const drlValue = sizeClass === 'paediatric' ? (proc.drl ?? 0) * 0.45 : sizeClass === 'large' ? (proc.drl ?? 0) * 1.3 : proc.drl ?? 0;
      const ratioPct = drlValue ? Math.round((value / drlValue) * 100) : null;
      const outlierRun = runDoseOutlier({ accession, studyUid, modality: proc.modality, protocolCode: procCode, value, drl: drlValue, sizeClass, repeats });
      const ctdi = proc.doseQuantity === 'DLP' ? Math.round((value / (proc.bodyPart === 'head' ? 15 : 28)) * 1000) : null;
      const eff = proc.doseQuantity === 'DLP' ? value * (proc.bodyPart === 'head' ? 0.0021 : proc.bodyPart === 'chest' ? 0.014 : 0.015) : proc.doseQuantity === 'DAP' ? value * 0.2 : value * 0.12;
      doseRows.push({ id: newId('dose'), practiceId, siteId, roomId: room.id, studyId, accession, patientId: patient.id, modality: proc.modality, protocolId, protocolCode: procCode, quantity: proc.doseQuantity, valueX1000: Math.round(value * 1000), ctdiVolX1000: ctdi, effectiveMsvX1000: Math.round(eff * 1000), sizeClass, drlValueX1000: Math.round(drlValue * 1000), drlSource: 'national', ratioPct, outlier: outlierRun.outlier, alertLevel: ratioPct && ratioPct > 200 ? 'above_threshold' : ratioPct && ratioPct > 100 ? 'above_drl' : 'none', likelyCause: outlierRun.outlier ? outlierRun.cause : null, pregnancyDeclared: patient.sex === 'F' && ageY >= 12 && ageY <= 55 ? 'no' : null, justification: null, justifiedBy: null, reviewedBy: null, reviewedAt: null, source: 'rdsr', technologistUserId: usersByPersona.RAD!, repeats, version: 1, createdAt: completedAt });
    }

    // Inference: Edge QC then routed models
    const demoInput = { studyUid, accession, modality: proc.modality, bodyPart: proc.bodyPart, procedureCode: procCode, laterality, ageYears: ageY, sex: patient.sex, seriesUids, instanceCount, orderPriority: priority, createdAt: completedAt };
    const prios: Array<BciPriority | undefined> = [];
    const qcModel = proc.modality === 'US' ? 'us-qc' : ['DX', 'MG'].includes(proc.modality) ? 'cxr-qc' : null;
    const storeInference = (res: BciResult, mode: 'activated' | 'shadow') => {
      inferenceRows.push({ id: newId('inf'), practiceId, siteId, studyId, accession, modelId: res.model.id, modelVersion: res.model.version, task: res.task, mode, result: res as unknown as Record<string, unknown>, priority: res.triage?.priority ?? null, flagged: res.findings.some((f) => f.flag), positiveCount: res.findings.filter((f) => f.flag).length, latencyMs: res.latency_ms, compute: res.compute, inputHash: res.input_hash, createdAt: res.created_at });
    };
    if (qcModel) {
      const qcSite = registryRows.find((x) => x.modelId === qcModel)?.siteStatus as Record<string, string> | undefined;
      const mode = (qcSite?.[siteId] ?? 'activated') as 'activated' | 'shadow' | 'paused' | 'off';
      if (mode === 'activated' || mode === 'shadow') { const res = runDemoModel(qcModel, demoInput); storeInference(res, mode); if (mode === 'activated' && res.triage?.priority) prios.push(res.triage.priority); }
    }
    const models = routeModels(proc.modality, proc.bodyPart).filter((m) => m !== 'cxr-qc' && m !== 'us-qc');
    const candidateSource: Array<{ res: BciResult }> = [];
    for (const modelId of models) {
      const reg = registryRows.find((x) => x.modelId === modelId && x.lifecycle !== 'deprecated');
      const siteStatus = (reg?.siteStatus as Record<string, string> | undefined)?.[siteId];
      const mode = (siteStatus ?? (reg?.lifecycle === 'shadow' ? 'shadow' : 'activated')) as 'activated' | 'shadow' | 'paused' | 'off';
      if (mode === 'paused' || mode === 'off') { inferenceRows.push({ id: newId('inf'), practiceId, siteId, studyId, accession, modelId, modelVersion: reg?.version ?? '1', task: 'not_analysed', mode: 'activated', result: { reason: `model ${mode} at site ${siteId}` }, compute: 'orchestrator', latencyMs: 0, createdAt: completedAt }); continue; }
      const res = runDemoModel(modelId, demoInput);
      storeInference(res, mode);
      if (mode === 'activated') { prios.push(res.triage?.priority); if (getDemoModel(modelId)?.outputClass === 1) candidateSource.push({ res }); }
    }

    // Reports: about 80 % signed, the rest drafts (today's work in progress)
    const candidates = buildCandidates(candidateSource, inferenceRows, studyId);
    const template = templates.find((t) => t.modality === proc.modality && t.bodyPart === proc.bodyPart) ?? templates.find((t) => t.modality === proc.modality) ?? templates[0]!;
    const rad = practiceId === ctx.practiceA ? radiologists[1]! : radiologists[0]!;
    const signDelayMin = priority === 'stat' ? 12 + Math.floor(r() * 25) : priority === 'urgent' ? 40 + Math.floor(r() * 90) : 120 + Math.floor(r() * 900);
    const signedAt = new Date(new Date(completedAt).getTime() + signDelayMin * 60_000);
    const shouldSign = !isToday || i % 4 !== 0;
    const canSign = signedAt.getTime() < now.getTime();
    const reportId = newId('rep');
    const accepted = candidates.filter((x) => x.flag && r() < 0.78);
    for (const cand of candidates) {
      const isAccepted = accepted.includes(cand);
      cand.decision = isAccepted ? (r() < 0.2 ? 'edited' : 'accepted') : 'rejected';
      cand.reason = isAccepted ? undefined : 'Not supported on review of the images';
      cand.decidedBy = rad.id;
      cand.decidedAt = iso(signedAt);
      if (cand.decision === 'edited') cand.editedText = (cand.candidateText ?? `${cand.display} candidate.`).replace('candidate', 'finding');
    }
    const structured = candidates.filter((x) => x.decision === 'accepted' || x.decision === 'edited').map((cand) => ({ code: cand.code, display: cand.display, laterality: cand.laterality, text: cand.decision === 'edited' ? cand.editedText! : cand.candidateText ?? `${cand.display}.`, source: 'candidate' as const, provenance: { modelId: cand.modelId, modelVersion: cand.modelVersion, confidence: cand.score, acceptedBy: rad.id, acceptedAt: iso(signedAt) } }));
    const tplSections = template.sections as Record<string, string>;
    const findingsText = [structured.filter((f) => f.code !== 'density').map((f) => f.text).join(' '), tplSections.findings ?? ''].filter(Boolean).join(' ');
    const impressionFindings = structured.filter((f) => f.code !== 'density');
    const impressionText = impressionFindings.length ? impressionFindings.map((f, n) => `${n + 1}. ${f.text.replace(/ candidate/gi, '')}`).join('\n') : tplSections.impression ?? 'No acute abnormality identified.';
    const criticalFinding = structured.find((f) => ['pneumothorax', 'intracranial_haemorrhage'].includes(f.code));
    const urgentFinding = structured.find((f) => ['mass', 'fracture', 'pleural_effusion'].includes(f.code));
    const reportableCats: string[] = [];
    if (structured.some((f) => f.code === 'tb_pattern')) reportableCats.push('tb_suggestive');
    if (structured.some((f) => f.code === 'mass')) reportableCats.push('malignancy_suspected');
    const followupItems = structured.flatMap((f) => (f.code === 'nodule' ? [{ what: 'CT chest (thin section)', when: 'in 3 months', why: 'pulmonary nodule candidate accepted at reporting', who: 'referrer', dueAt: iso(new Date(signedAt.getTime() + 90 * 86400_000)), source: 'practice nodule follow-up schedule v2' }] : f.code === 'mass' ? [{ what: 'Targeted ultrasound of the breast', when: 'within 2 weeks', why: 'mass candidate accepted at reporting', who: 'referrer', dueAt: iso(new Date(signedAt.getTime() + 14 * 86400_000)), source: 'practice breast work-up schedule v1' }] : f.code === 'tb_pattern' ? [{ what: 'Sputum microbiology and clinical review', when: 'within 1 week', why: 'TB-suggestive pattern', who: 'referrer', dueAt: iso(new Date(signedAt.getTime() + 7 * 86400_000)), source: 'practice TB pathway v1' }] : f.code === 'consolidation' ? [{ what: 'Chest radiograph to confirm resolution', when: 'in 6 weeks', why: 'consolidation accepted at reporting', who: 'referrer', dueAt: iso(new Date(signedAt.getTime() + 42 * 86400_000)), source: 'practice pneumonia follow-up schedule v1' }] : []));
    const sections = { clinicalInfo: indication, technique: tplSections.technique ?? proc.description, comparison: priorIds.length ? `Comparison: previous imaging of the same region at this Practice.` : 'No previous imaging available for comparison.', findings: findingsText, impression: impressionText, recommendation: structured.length ? recommendationText(structured.map((f) => f.code)) : '' };
    const consistency = runConsistencyCheck({ accession, studyUid, modality: proc.modality, bodyPart: proc.bodyPart, laterality, sex: patient.sex, priorsCount: priorIds.length, sections, candidates: candidates.map((x) => ({ code: x.code, display: x.display, laterality: x.laterality, decision: x.decision, flag: x.flag })) }).consistency ?? [];
    const rvuX100 = Math.round(proc.rvu * 100);
    const multiplier = priority === 'stat' ? 1.5 : 1;
    const signStatus = shouldSign && canSign ? 'signed' : 'draft';
    const critical = signStatus === 'signed' && !!(criticalFinding || (urgentFinding && r() < 0.5));
    const criticalCategory = critical ? (criticalFinding ? 'critical' : 'urgent') : null;

    reportRows.push({
      id: reportId, practiceId, siteId, studyId, accession, patientId: patient.id, referrerId, radiologistUserId: signStatus === 'signed' ? rad.id : null, status: signStatus,
      templateId: template.id, sections, structuredFindings: structured, candidates, followups: signStatus === 'signed' ? followupItems : [], draftProvenance: { modelId: 'draft-report', modelVersion: '2.7.1', outputClass: 2, createdAt: completedAt, llmUsed: false, inputsHash: `${candidates.length}:${structured.length}:0`, reviewed: signStatus === 'signed' },
      critical, criticalCategory, reportableCategories: signStatus === 'signed' ? reportableCats : [], consistencyWarnings: consistency, warningsAcknowledged: signStatus === 'signed' && consistency.some((x) => x.status !== 'pass'), warningsAckReason: signStatus === 'signed' && consistency.some((x) => x.status !== 'pass') ? 'Reviewed on the images; wording is correct' : null,
      priority, subspecialty: subspecialtyOf(proc.bodyPart, proc.modality), claimedBy: signStatus === 'signed' ? rad.id : null, claimedAt: signStatus === 'signed' ? iso(signedAt) : null, lockExpiresAt: null,
      signedAt: signStatus === 'signed' ? iso(signedAt) : null, signedHpcsaNo: signStatus === 'signed' ? rad.hpcsa : null, readingTimeSec: signStatus === 'signed' ? 180 + Math.floor(r() * 900) : null,
      readingRvuX100: Math.round(rvuX100 * multiplier), readingFeeCents: signStatus === 'signed' ? Math.round((rvuX100 * multiplier / 100) * 32000) : null, version: 1, createdAt: completedAt, updatedAt: signStatus === 'signed' ? iso(signedAt) : completedAt,
    });

    if (signStatus === 'signed') {
      studyRows[studyRows.length - 1]!.status = 'reported';
      studyRows[studyRows.length - 1]!.reportedAt = iso(signedAt);
      const ref = ctx.referrers.includes(referrerId) ? referrerId : null;
      const opened = r() < 0.72;
      const acked = opened && r() < 0.7;
      const openAt = iso(new Date(signedAt.getTime() + (20 + Math.floor(r() * 400)) * 60_000));
      deliveryRows.push({ id: newId('del'), practiceId, reportId, studyId, referrerId: ref, recipientType: 'referrer', channel: 'referrer_portal', recipientMasked: 'Referrer Space', status: acked ? 'acknowledged' : opened ? 'opened' : 'delivered', sentAt: iso(signedAt), deliveredAt: iso(signedAt), openedAt: opened ? openAt : null, acknowledgedAt: acked ? openAt : null, acknowledgedBy: acked ? ref : null, amendment: 0, createdAt: iso(signedAt) });
      deliveryRows.push({ id: newId('del'), practiceId, reportId, studyId, referrerId: ref, recipientType: 'referrer', channel: 'whatsapp', recipientMasked: '··· 4471', status: 'delivered', sentAt: iso(signedAt), deliveredAt: iso(signedAt), amendment: 0, createdAt: iso(signedAt) });
      const withheld = reportableCats.some((cat) => cat === 'malignancy_suspected' || cat === 'nai_child');
      deliveryRows.push({ id: newId('del'), practiceId, reportId, studyId, patientId: patient.id, recipientType: 'patient', channel: 'patient_space', recipientMasked: 'Patient Space', status: withheld ? 'withheld' : 'sent', sentAt: iso(signedAt), amendment: 0, createdAt: iso(signedAt) });
      notificationRows.push({ id: newId('ntf'), practiceId, channel: 'whatsapp', recipientType: 'referrer', recipientMasked: '··· 4471', template: 'report_ready', body: 'A report is ready for your patient in the Referrer Space.', relatedType: 'report', relatedId: reportId, status: 'delivered', sentAt: iso(signedAt), createdAt: iso(signedAt) });

      if (critical && criticalCategory) {
        const keepOpen = criticalOpen < 2 && dayOffset <= 1;
        const critId = newId('crit');
        const chain = [{ step: 1, role: 'referring clinician', name: 'Referring clinician', phoneMasked: '··· 4471', channel: ['call', 'whatsapp', 'portal'] }, { step: 2, role: 'practice manager', name: 'Practice manager', channel: ['portal', 'call'] }];
        const attempts: Array<{ at: string; step: number; channel: string; to: string; outcome: string; by: string }> = [{ at: iso(new Date(signedAt.getTime() + 60_000)), step: 0, channel: 'call', to: '··· 4471', outcome: keepOpen ? 'no_answer' : 'answered', by: 'critical-results-hand' }, { at: iso(new Date(signedAt.getTime() + 90_000)), step: 0, channel: 'whatsapp', to: '··· 4471', outcome: 'sent', by: 'critical-results-hand' }];
        if (keepOpen) attempts.push({ at: iso(new Date(signedAt.getTime() + 16 * 60_000)), step: 1, channel: 'call', to: 'Practice manager', outcome: 'no_answer', by: 'critical-results-hand' });
        const ackAt = iso(new Date(signedAt.getTime() + (5 + Math.floor(r() * 20)) * 60_000));
        criticalRows.push({ id: critId, practiceId, siteId, reportId, studyId, accession, patientId: patient.id, referrerId: ref, radiologistUserId: rad.id, category: criticalCategory, windowMinutes: criticalCategory === 'critical' ? 30 : 240, contactChain: chain, attempts, escalationLevel: keepOpen ? 2 : 0, status: keepOpen ? 'escalated' : 'closed', openedAt: iso(signedAt), acknowledgedBy: keepOpen ? null : 'Dr S. Naidoo', acknowledgedAt: keepOpen ? null : ackAt, acknowledgementChannel: keepOpen ? null : 'voice', closedAt: keepOpen ? null : ackAt, handTaskId: null, takenOverBy: null, createdAt: iso(signedAt) });
        if (keepOpen) criticalOpen++;
      }
      if (followupItems.length && followupsMade < 12) {
        for (const f of followupItems) {
          const overdue = new Date(f.dueAt).getTime() < now.getTime();
          followupRows.push({ id: newId('fup'), practiceId, reportId, studyId, patientId: patient.id, referrerId: ref, what: f.what, whenText: f.when, why: f.why, who: f.who, scheduleSource: f.source, dueAt: f.dueAt, status: overdue ? 'overdue' : r() < 0.3 ? 'reminded' : 'open', reminders: overdue || r() < 0.3 ? [{ at: iso(new Date(new Date(f.dueAt).getTime() - 14 * 86400_000)), channel: 'portal', to: 'referrer', kind: 'due_window' }] : [], closedReason: null, closedEvidence: null, closedBy: null, closedAt: null, escalatedTo: overdue ? 'PRM' : null, createdAt: iso(signedAt) });
          followupsMade++;
        }
      }
      publishedReports.push({ id: reportId, studyId, accession, patientId: patient.id, practiceId, siteId, referrerId, procedureCodes: [procCode], icd10: (order?.icd10 as string[] | undefined) ?? (template.icd10Prompts as string[] | null)?.slice(0, 1) ?? [], signedAt: iso(signedAt), critical, modality: proc.modality, radiologistUserId: rad.id, readingFeeCents: Math.round((rvuX100 * multiplier / 100) * 32000) });
    }
    publishedStudies.push({ id: studyId, accession, patientId: patient.id, practiceId, siteId, roomId: room.id, modality: proc.modality, procedureCode: procCode, procedureDescription: proc.description, referrerId, orderId: order?.id ?? null, receivedAt, completedAt, status: signStatus === 'signed' ? 'reported' : 'complete', priority });
  }

  // A couple of unmatched studies for the reconciliation queue
  for (let k = 0; k < 2; k++) {
    const siteId = k === 0 ? ctx.sites.SAN : ctx.sites.UMH;
    const practiceId = sitePractice[siteId]!;
    const room = (roomsBySite[siteId] ?? []).find((x) => x.roomType === 'XR')!;
    const patient = pick(r, patientsByPractice[practiceId] ?? patients);
    accSeq[practiceId]! += 1;
    const when = daysAgo(0, 8, 52);
    const accession = formatAccession(accessionPrefix[practiceId]!, when.getUTCFullYear(), accSeq[practiceId]!);
    const studyId = newId('stu');
    const studyUid = `1.2.826.0.1.3680043.10.${hashString(accession) % 100000}.${hashString(studyId) % 100000}`;
    const seriesId = newId('ser');
    studyRows.push({ id: studyId, practiceId, siteId, roomId: room.id, patientId: patient.id, accession, studyUid, modality: 'DX', procedureCode: '30110', procedureDescription: 'Chest X-ray PA and lateral', bodyPart: 'chest', priority: 'routine', status: 'received', seriesCount: 1, instanceCount: 2, storagePrefix: `${practiceId}/studies/${studyId}`, priorIds: [], keyImageIds: [], retentionClass: 'standard', external: false, unmatched: true, receivedAt: iso(when), createdAt: iso(when), updatedAt: iso(when) });
    seriesRows.push({ id: seriesId, practiceId, studyId, seriesUid: `${studyUid}.1`, number: 1, description: 'PA', modality: 'DX', view: 'PA', instanceCount: 2, rejected: false, createdAt: iso(when) });
    instanceRows.push({ id: newId('img'), practiceId, studyId, seriesId, sopUid: `${studyUid}.1.1`, number: 1, storageKey: `${practiceId}/studies/${studyId}/${seriesId}/1.svg`, contentType: 'image/svg+xml', rows: 512, cols: 512, view: 'PA', rejected: false, createdAt: iso(when) });
    inferenceRows.push({ id: newId('inf'), practiceId, siteId, studyId, accession, modelId: 'orchestrator', modelVersion: '1', task: 'not_analysed', mode: 'activated', result: { reason: 'unmatched_study_pending_reconciliation' }, compute: 'orchestrator', latencyMs: 0, createdAt: iso(when) });
  }

  // Advance the accession sequences so runtime allocation continues where the seed stopped.
  for (const [practiceId, value] of Object.entries(accSeq)) {
    const key = `accession:${practiceId}:${String(now.getUTCFullYear() % 100).padStart(2, '0')}`;
    const existingSeq = await db.select().from(s.sequences).where(eqFn(s.sequences.key, key)).limit(1);
    if (existingSeq.length) await db.update(s.sequences).set({ value: Math.max(existingSeq[0]!.value, value) }).where(eqFn(s.sequences.key, key));
    else await db.insert(s.sequences).values({ key, value });
  }

  await insertChunked(db, s.studies, studyRows);
  await insertChunked(db, s.series, seriesRows);
  await insertChunked(db, s.instances, instanceRows);
  await insertChunked(db, s.worklistItems, worklistRows);
  await insertChunked(db, s.doseRecords, doseRows);
  await insertChunked(db, s.inferenceResults, inferenceRows);
  await insertChunked(db, s.repeatRejects, repeatRows);
  await insertChunked(db, s.contrastAdministrations, contrastRows);
  await insertChunked(db, s.reports, reportRows);
  await insertChunked(db, s.resultDeliveries, deliveryRows);
  // Keep the two most recent critical loops open so the console always shows live work.
  const openable = [...criticalRows].sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
  let leftOpen = criticalRows.filter((x) => x.status !== 'closed').length;
  for (const row of openable) {
    if (leftOpen >= 2) break;
    if (row.status !== 'closed') continue;
    row.status = 'escalated';
    row.escalationLevel = 2;
    row.acknowledgedBy = null;
    row.acknowledgedAt = null;
    row.acknowledgementChannel = null;
    row.closedAt = null;
    row.attempts = (row.attempts as Array<Record<string, unknown>>).map((a, i) => (i === 0 ? { ...a, outcome: 'no_answer' } : a)).concat([{ at: iso(new Date(new Date(row.openedAt as string).getTime() + 16 * 60_000)), step: 1, channel: 'call', to: 'Practice manager', outcome: 'no_answer', by: 'critical-results-hand' }]) as typeof row.attempts;
    leftOpen++;
  }
  await insertChunked(db, s.criticalResults, criticalRows);
  await insertChunked(db, s.followups, followupRows);
  await insertChunked(db, s.notifications, notificationRows);

  /* ---------- 6. Today's booked worklist (not yet acquired) so the console has live work ---------- */
  const todayWl: (typeof s.worklistItems.$inferInsert)[] = [];
  for (const [siteKey, siteId] of Object.entries(ctx.sites)) {
    const practiceId = sitePractice[siteId]!;
    const pool = patientsByPractice[practiceId] ?? patients;
    const count = siteKey === 'SAN' || siteKey === 'UMH' ? 8 : 5;
    for (let i = 0; i < count; i++) {
      // Give every site at least two live contrast cases today so the nurse console has work.
      let procCode = i === 2 ? '31130' : i === 4 ? '31120' : weightedProcedure(r);
      const patientPeek = pool[Math.floor(r() * pool.length)]!;
      const peekAge = patientPeek.dateOfBirth ? Math.floor((now.getTime() - new Date(patientPeek.dateOfBirth).getTime()) / (365.25 * 86400_000)) : 40;
      if (['34110', '34120', '33120'].includes(procCode) && (patientPeek.sex !== 'F' || peekAge < (procCode === '33120' ? 16 : 35))) procCode = '30110';
      if (procCode === '35110' && peekAge < 40) procCode = '30110';
      const proc = findProcedure(procCode)!;
      const room = (roomsBySite[siteId] ?? []).find((x) => x.roomType === roomTypeOf[proc.modality]) ?? (roomsBySite[siteId] ?? [])[0];
      if (!room) continue;
      const patient = patientPeek;
      const when = daysAgo(0, 8 + i, i % 2 ? 30 : 0);
      const ageY = patient.dateOfBirth ? Math.floor((now.getTime() - new Date(patient.dateOfBirth).getTime()) / (365.25 * 86400_000)) : 40;
      const status = when.getTime() < now.getTime() ? (i % 3 === 0 ? 'arrived' : 'scheduled') : 'scheduled';
      const needsRgt = proc.modality === 'CT' || proc.modality === 'MR';
      todayWl.push({
        id: newId('wl'), practiceId, siteId, roomId: room.id, modalityType: proc.modality, patientId: patient.id, patientName: `${patient.lastName}, ${patient.firstName}`, referrerId: pick(r, ctx.referrers),
        procedureCode: procCode, procedureDescription: proc.description, bodyPart: proc.bodyPart, laterality: proc.laterality ? (hashString(patient.id) % 2 ? 'L' : 'R') : null, contrast: !!proc.contrast,
        priority: i === 1 && siteKey === 'SAN' ? 'stat' : 'routine', indication: pick(r, PROCEDURE_INDICATIONS[procCode] ?? INDICATIONS[proc.bodyPart] ?? ['Clinical assessment']), scheduledAt: iso(when), status,
        protocolId: needsRgt && i % 2 === 0 ? null : (ageY < 16 && protocolRows.some((x) => x.id === `prot_${procCode}_p`) ? `prot_${procCode}_p` : protocolByProcedure.get(procCode)!),
        protocolSource: needsRgt && i % 2 === 0 ? null : 'hand',
        protocolProvenance: { modelId: 'protocol-hand', modelVersion: '2.4.1', confidence: needsRgt ? 0.81 : 0.97, reasons: [`procedure ${procCode} maps to the library`, needsRgt ? 'CT/MR: radiologist protocolling required (A1)' : 'A2 modality: radiographer accepts on the card'] },
        safetyGate: status === 'arrived' ? { allowed: true, reason: 'M07 safety questionnaire cleared', source: 'm07', checkedAt: iso(new Date(when.getTime() - 15 * 60_000)), pregnancy: patient.sex === 'F' && ageY >= 12 && ageY <= 55 ? 'no' : 'n/a', egfr: proc.contrast ? 60 + Math.floor(r() * 40) : null, allergies: 'none', metformin: proc.contrast ? 'no' : 'n/a' } : null,
        arrivedAt: status === 'arrived' ? iso(new Date(when.getTime() - 10 * 60_000)) : null, emergency: false, createdAt: iso(daysAgo(3)), updatedAt: iso(when),
      });
    }
  }
  await insertChunked(db, s.worklistItems, todayWl);
  summary.worklistItems = worklistRows.length + todayWl.length;

  /* ---------- 7. Peer reviews ---------- */
  const signedReports = reportRows.filter((x) => x.status === 'signed');
  const peerSample = signedReports.filter((_, idx) => idx % 22 === 0).slice(0, 12);
  for (const rep of peerSample) {
    const reviewer = rep.radiologistUserId === radiologists[0]!.id ? radiologists[1]! : radiologists[0]!;
    const scored = r() < 0.75;
    const score = scored ? pick(r, ['1', '1', '1', '1', '2a', '2b', '3a']) : null;
    peerRows.push({ id: newId('pr'), practiceId: rep.practiceId as string, reportId: rep.id as string, studyId: rep.studyId as string, originalRadiologistUserId: rep.radiologistUserId as string, reviewerUserId: reviewer.id, status: scored ? (score === '2b' || score!.startsWith('3') ? 'routed' : 'scored') : 'pending', score, category: score && score !== '1' ? pick(r, ['perception', 'interpretation', 'communication', 'technical']) : null, notes: score && score !== '1' ? 'Discussed at the monthly learning meeting; no change to patient care required.' : null, blindedImpression: scored ? 'Reviewer impression recorded before the original report was shown.' : null, sampledAt: rep.signedAt as string, scoredAt: scored ? rep.signedAt as string : null });
  }
  await insertChunked(db, s.peerReviews, peerRows);
  summary.peerReviews = peerRows.length;

  /* ---------- 8. Addenda on a few signed reports ---------- */
  for (const rep of signedReports.filter((_, idx) => idx % 47 === 0).slice(0, 4)) {
    addendaRows.push({ id: newId('add'), practiceId: rep.practiceId as string, reportId: rep.id as string, authorUserId: rep.radiologistUserId as string, kind: 'addendum', text: 'The prior study has since become available. Comparison confirms stability of the described appearances.', reason: 'Prior arrived after signing', signedAt: iso(new Date(new Date(rep.signedAt as string).getTime() + 2 * 86400_000)), createdAt: iso(new Date(new Date(rep.signedAt as string).getTime() + 2 * 86400_000)) });
  }
  if (addendaRows.length) await insertChunked(db, s.addenda, addendaRows);

  /* ---------- 9. QA schedule and dosimetry ---------- */
  const qaRows: (typeof s.qaTests.$inferInsert)[] = [];
  for (const room of rooms) {
    const ionising = ['XR', 'CT', 'MG', 'DXA'].includes(room.roomType);
    const plan: Array<[string, string, boolean, number]> = [
      ['daily_phantom', 'daily', false, 1],
      [room.roomType === 'CT' ? 'ct_water' : room.roomType === 'MR' ? 'mr_snr' : room.roomType === 'MG' ? 'mg_phantom' : 'detector_calibration', 'weekly', room.roomType === 'MG', 7],
      ['display_gsdf', 'monthly', false, 30],
      ['annual_compliance', 'annual', ionising, 365],
    ];
    for (const [testType, frequency, blocking, period] of plan) {
      // recent history
      for (let back = 3; back >= 1; back--) {
        const due = daysAgo(back * period, 7, 30);
        if (due.getTime() < now.getTime() - 400 * 86400_000) continue;
        qaRows.push({ id: newId('qa'), practiceId: room.practiceId, siteId: room.siteId, roomId: room.id, modalityType: room.roomType, testType, frequency, blocking, dueAt: iso(due), doneAt: iso(new Date(due.getTime() + 3600_000)), result: 'pass', values: { measured: Math.round(r() * 100) / 10, tolerance: '±10 %' }, performedBy: usersByPersona.RAD!, rpoSignedBy: frequency === 'annual' ? usersByPersona.CMP! : null, rpoSignedAt: frequency === 'annual' ? iso(new Date(due.getTime() + 2 * 86400_000)) : null, notes: null, createdAt: iso(due) });
      }
      // next occurrence; one room deliberately overdue and blocking
      const overdueRoom = room.id === ctx.rooms['RBG-XR1'];
      const nextDue = overdueRoom && blocking ? daysAgo(4, 7, 30) : new Date(now.getTime() + Math.floor(r() * period) * 86400_000);
      qaRows.push({ id: newId('qa'), practiceId: room.practiceId, siteId: room.siteId, roomId: room.id, modalityType: room.roomType, testType, frequency, blocking, dueAt: iso(nextDue), doneAt: null, result: null, values: null, performedBy: null, rpoSignedBy: null, rpoSignedAt: null, notes: overdueRoom && blocking ? 'Vendor service visit outstanding' : null, createdAt: iso(daysAgo(period)) });
    }
  }
  await insertChunked(db, s.qaTests, qaRows);
  summary.qaTests = qaRows.length;

  const dosimetryRows: (typeof s.dosimetry.$inferInsert)[] = [];
  const staff = [
    { userId: usersByPersona.RAD!, name: 'Sizwe Molefe', role: 'Radiographer', site: ctx.sites.SAN, practice: ctx.practiceA },
    { userId: usersByPersona.NUR!, name: 'Sister Lerato Mokoena', role: 'Nurse', site: ctx.sites.SAN, practice: ctx.practiceA },
    { userId: null, name: 'Thabo Nkosi', role: 'Radiographer', site: ctx.sites.RBG, practice: ctx.practiceA },
    { userId: null, name: 'Annelie Smit', role: 'Radiographer', site: ctx.sites.UMH, practice: ctx.practiceB },
    { userId: null, name: 'Musa Khumalo', role: 'Radiographer', site: ctx.sites.UMH, practice: ctx.practiceB },
    { userId: null, name: 'Karabo Sithole', role: 'Radiographer', site: ctx.sites.BAL, practice: ctx.practiceB },
  ];
  for (const person of staff) {
    for (let m = 5; m >= 0; m--) {
      const issue = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
      const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m + 1, 5));
      const past = due.getTime() < now.getTime();
      const result = past ? Math.floor(r() * 420) + 20 : null;
      const investigation = result !== null && result > 500;
      dosimetryRows.push({ id: newId('dos'), practiceId: person.practice, siteId: person.site, userId: person.userId, staffName: person.name, role: person.role, badgeType: 'OSL', badgePlacement: 'body', cycle: `${issue.getUTCFullYear()}-${String(issue.getUTCMonth() + 1).padStart(2, '0')}`, issuedAt: iso(issue), dueBackAt: iso(due), returnedAt: past ? iso(new Date(due.getTime() - 86400_000)) : null, resultUsv: result, investigationLevelUsv: 500, status: past ? (investigation ? 'investigation' : 'resulted') : 'issued', rpoSignedBy: past ? usersByPersona.CMP! : null, rpoSignedAt: past ? iso(new Date(due.getTime() + 86400_000)) : null, createdAt: iso(issue) });
    }
  }
  // one late return so the register shows an exception
  dosimetryRows.push({ id: newId('dos'), practiceId: ctx.practiceB, siteId: ctx.sites.BAL, userId: null, staffName: 'Prevan Govender', role: 'Radiographer', badgeType: 'TLD', badgePlacement: 'extremity', cycle: `${now.getUTCFullYear()}-${String(now.getUTCMonth()).padStart(2, '0')}`, issuedAt: iso(daysAgo(45)), dueBackAt: iso(daysAgo(10)), returnedAt: null, resultUsv: null, investigationLevelUsv: 500, status: 'late', rpoSignedBy: null, rpoSignedAt: null, createdAt: iso(daysAgo(45)) });
  await insertChunked(db, s.dosimetry, dosimetryRows);
  summary.dosimetry = dosimetryRows.length;

  /* ---------- 10. Model events: a drift alarm, an incident, change records ---------- */
  const modelEventRows: (typeof s.modelEvents.$inferInsert)[] = [
    { id: newId('mev'), practiceId: ctx.practiceA, siteId: ctx.sites.RBG, modelId: 'cxr-triage', modelVersion: '2.3.1', type: 'drift_alarm', severity: 'warn', title: 'BCI-CXR-TRIAGE positive rate up 38 % at Randburg', detail: { recentRatePct: 11.3, baselineRatePct: 8.2, deltaPct: 37.8, window: '7 d vs 30 d baseline', n: 212, linkedChange: 'Randburg R1 detector replaced by vendor service visit; DR-7 not on the validated input list', harmCheck: 'False-negative proxy unchanged; no recall needed', recommendation: 'pause at site (advisory-suppressed, model keeps running and logging)' }, status: 'open', createdAt: iso(daysAgo(0, 6, 30)) },
    { id: newId('mev'), practiceId: ctx.practiceA, siteId: ctx.sites.RBG, modelId: 'cxr-triage', modelVersion: '2.3.1', type: 'incident', severity: 'warn', title: 'AI incident: performance degradation at Randburg, no patient harm identified', detail: { category: 'performance_degradation', harm: 'none identified', linkedAlarm: 'drift alarm 06:30', owner: 'AIO' }, status: 'open', createdAt: iso(daysAgo(0, 6, 41)) },
    { id: newId('mev'), practiceId: null, siteId: null, modelId: 'msk-fracture', modelVersion: '1.0.0-rc2', type: 'change_record', severity: 'info', title: 'CR: BCI-MSK-FRAC-APP shadow to supervised activation, Practice A', detail: { stage: 'CMP review', plan: 'Sandton 30 days with weekly review, then Randburg', aioApproved: true, cmpApproved: false, scope: 'adults, long bones and ankle' }, status: 'open', createdAt: iso(daysAgo(2, 10, 0)) },
    { id: newId('mev'), practiceId: null, siteId: null, modelId: 'cxr-findings', modelVersion: '3.1.0', type: 'shadow_report', severity: 'info', title: 'Shadow report closed: BCI-CXR-FINDINGS 3.1.0 activated group-wide', detail: { weeks: 6, cases: 1840, agreement: 0.92, subgroupFloorsMet: true }, status: 'closed', resolvedAt: iso(daysAgo(20)), createdAt: iso(daysAgo(24)) },
    { id: newId('mev'), practiceId: ctx.practiceB, siteId: ctx.sites.BAL, modelId: 'mg-detect', modelVersion: '1.2.0', type: 'kill_switch', severity: 'crit', title: 'BCI-MG-LESION off at Ballito: human-first policy pending reader training', detail: { reason: 'Practice B human-first policy; overlays off by default', by: 'AIO' }, status: 'closed', resolvedAt: iso(daysAgo(12)), createdAt: iso(daysAgo(12)) },
    { id: newId('mev'), practiceId: null, siteId: null, modelId: 'cxr-triage', modelVersion: '2.3.1', type: 'revalidation', severity: 'info', title: 'Re-validation flagged: new detector model DR-7 at Randburg R1', detail: { source: 'M18 equipment change', validatedInputs: ['DR-5', 'DR-6', 'CR plates'], action: 'validation set queued through the DR-7 processing profile' }, status: 'open', createdAt: iso(daysAgo(6, 8, 10)) },
  ];
  await insertChunked(db, s.modelEvents, modelEventRows);
  summary.bciModelEvents = modelEventRows.length;

  ctx.extra.studies = publishedStudies;
  ctx.extra.reports = publishedReports;

  summary.studies = studyRows.length;
  summary.series = seriesRows.length;
  summary.instances = instanceRows.length;
  summary.doseRecords = doseRows.length;
  summary.inferenceResults = inferenceRows.length;
  summary.reports = reportRows.length;
  summary.reportsSigned = signedReports.length;
  summary.resultDeliveries = deliveryRows.length;
  summary.criticalResults = criticalRows.length;
  summary.followups = followupRows.length;
  summary.contrastAdministrations = contrastRows.length;
  summary.repeatRejects = repeatRows.length;
  return summary;
}

/* ---------- helpers ---------- */
async function insertChunked<T extends { id?: unknown }>(db: Db, table: any, rows: T[], size = 200) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (chunk.length) await db.insert(table).values(chunk as any);
  }
}

function tpl(code: string, name: string, modality: string, bodyPart: string, sections: Record<string, string>, mandatory: string[], pickLists: Record<string, string[]>, icd10: string[]): typeof s.reportTemplates.$inferInsert {
  return { id: `tpl_${code.toLowerCase()}`, practiceId: null, code, name, modality, bodyPart, sections, mandatoryFields: mandatory, pickLists, icd10Prompts: icd10, version: 1, status: 'active' };
}

function paramsFor(modality: string, bodyPart: string, paediatric: boolean): Record<string, string | number> {
  if (modality === 'CT') return { kvp: paediatric ? 100 : 120, mas: paediatric ? 'auto (ref 120)' : 'auto (ref 300)', slice: bodyPart === 'head' ? '5 mm axial + 0.625 mm thin' : '2 mm', pitch: 1.0, iterativeRecon: 'level 3' };
  if (modality === 'MR') return { sequences: 'T1, T2, FLAIR, DWI', slice: '4 mm', coil: 'head or body per region', duration: '25 min' };
  if (modality === 'US') return { probe: bodyPart === 'obstetric' ? 'curvilinear 3.5 MHz' : 'curvilinear 5 MHz', preset: bodyPart, worksheet: 'structured' };
  if (modality === 'MG') return { target: 'W/Rh', kvp: 29, aec: 'auto', compressionN: 120 };
  if (modality === 'DXA') return { regions: 'lumbar spine, proximal femur', mode: 'standard' };
  return { kvp: paediatric ? 60 : bodyPart === 'chest' ? 125 : 75, mas: paediatric ? 1.0 : bodyPart === 'chest' ? 2.5 : 8, grid: bodyPart === 'chest' ? 'yes' : 'no', sid: '110 cm', targetIndex: 300 };
}

function weightedProcedure(r: () => number): string {
  // Realistic SA outpatient mix: chest and limb radiographs dominate, then US, CT, MG, MR.
  const roll = r();
  if (roll < 0.26) return pick(r, ['30110', '30111']);
  if (roll < 0.46) return pick(r, ['30410', '30420', '30430', '30440', '30450', '30460']);
  if (roll < 0.56) return pick(r, ['30210', '30310', '30320']);
  if (roll < 0.71) return pick(r, ['33110', '33120', '33130', '33140']);
  if (roll < 0.87) return pick(r, ['31110', '31120', '31125', '31130', '31135', '31140', '31150']);
  if (roll < 0.94) return pick(r, ['34110', '34120']);
  if (roll < 0.99) return pick(r, ['32110', '32120', '32130']);
  return '35110';
}

function subspecialtyOf(bodyPart: string, modality: string): string {
  if (bodyPart === 'breast') return 'breast';
  if (bodyPart === 'head' || bodyPart === 'neck') return 'neuro';
  if (['limb', 'knee', 'hand', 'spine', 'pelvis'].includes(bodyPart)) return 'msk';
  if (bodyPart === 'chest') return 'chest';
  if (bodyPart === 'obstetric') return 'obstetric';
  return modality === 'US' ? 'body' : 'body';
}

function recommendationText(codes: string[]): string {
  const recs: string[] = [];
  if (codes.includes('pneumothorax')) recs.push('Clinical correlation; repeat radiograph in 4 to 6 hours or sooner if symptoms progress.');
  if (codes.includes('nodule')) recs.push('CT chest for characterisation, with follow-up interval per the practice nodule schedule.');
  if (codes.includes('tb_pattern')) recs.push('Sputum for microbiological confirmation; correlate clinically.');
  if (codes.includes('mass')) recs.push('Targeted ultrasound and tissue sampling as clinically indicated.');
  if (codes.includes('fracture')) recs.push('Orthopaedic review; further views or CT if clinically indicated.');
  if (codes.includes('intracranial_haemorrhage')) recs.push('Urgent neurosurgical referral and repeat CT as clinically indicated.');
  return [...new Set(recs)].join(' ');
}

function buildCandidates(sources: Array<{ res: BciResult }>, inferenceRows: Array<{ id: string; studyId: string; modelId: string }>, studyId: string) {
  const out: Array<{ id: string; inferenceResultId: string; modelId: string; modelVersion: string; code: string; display: string; laterality?: string; score: number; flag: boolean; candidateText?: string; localisation?: any; decision: 'pending' | 'accepted' | 'edited' | 'rejected'; editedText?: string; reason?: string; decidedBy?: string; decidedAt?: string }> = [];
  const seen = new Set<string>();
  for (const { res } of sources) {
    const row = inferenceRows.find((x) => x.studyId === studyId && x.modelId === res.model.id);
    for (const f of res.findings) {
      if (!f.flag) continue;
      const key = `${f.code}|${f.laterality ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `${row?.id ?? res.model.id}:${f.code}`, inferenceResultId: row?.id ?? '', modelId: res.model.id, modelVersion: res.model.version, code: f.code, display: f.display, laterality: f.laterality, score: f.score, flag: f.flag, candidateText: f.candidate_text, localisation: f.localisation, decision: 'pending' });
    }
  }
  return out;
}

const INDICATIONS: Record<string, string[]> = {
  chest: ['Cough and fever for 5 days, query pneumonia', 'Shortness of breath, known asthma', 'Pre-employment medical', 'Chest pain, query pneumothorax', 'Weight loss and night sweats, query tuberculosis', 'Follow-up of treated pneumonia'],
  abdomen: ['Right upper quadrant pain, query gallstones', 'Acute abdominal pain, query obstruction', 'Renal colic, query calculus', 'Abdominal distension'],
  head: ['Headache 3 weeks, worse on waking; no trauma', 'Head injury with loss of consciousness', 'Sudden onset weakness, query stroke', 'Recurrent sinusitis', 'Seizure, first presentation'],
  spine: ['Low back pain with radiculopathy', 'Neck pain after motor vehicle accident', 'Query vertebral compression fracture'],
  limb: ['Ankle injury, unable to weight bear', 'Shoulder pain after fall', 'Query fracture after sports injury'],
  hand: ['Wrist injury after fall on outstretched hand', 'Query scaphoid fracture', 'Bone age assessment'],
  knee: ['Knee pain and locking, query meniscal tear', 'Knee injury during rugby'],
  pelvis: ['Hip pain in an older adult after a fall', 'Query hip dysplasia'],
  breast: ['Routine screening mammography', 'Palpable lump in the left breast', 'Recall from screening programme'],
  neck: ['Thyroid swelling', 'Neck lump for characterisation'],
  obstetric: ['Growth scan at 32 weeks', 'Reduced fetal movements', 'Dating scan'],
};

const PROCEDURE_INDICATIONS: Record<string, string[]> = {
  '33140': ['Calf swelling and pain, query deep vein thrombosis', 'Query venous insufficiency'],
  '33130': ['Thyroid swelling', 'Thyroid nodule for characterisation'],
  '33120': ['Growth scan at 32 weeks', 'Reduced fetal movements', 'Dating scan'],
  '30450': ['Shoulder pain after a fall', 'Query rotator cuff injury'],
  '30420': ['Ankle injury, unable to weight bear', 'Query ankle fracture after inversion injury'],
  '30430': ['Knee pain and swelling after a twisting injury', 'Query knee effusion'],
  '30440': ['Hip pain in an older adult after a fall', 'Query femoral neck fracture'],
  '30460': ['Bone age assessment for short stature'],
  '30410': ['Wrist injury after a fall on an outstretched hand', 'Query scaphoid fracture'],
  '31125': ['Pleuritic chest pain and hypoxia, query pulmonary embolism'],
  '31135': ['Renal colic, query ureteric calculus'],
  '31150': ['Recurrent sinusitis, pre-operative assessment'],
  '31140': ['Neck pain after a motor vehicle accident, query cervical fracture'],
  '32130': ['Knee locking and instability, query meniscal tear'],
  '35110': ['Osteoporosis screening', 'Fragility fracture, bone density assessment'],
  '34110': ['Routine screening mammography'],
  '34120': ['Palpable lump, diagnostic work-up', 'Recall from the screening programme'],
};

const TECH_NOTES = [
  'Patient could not raise arms; some streak artefact at the level of the shoulders.',
  'Study performed with the patient seated; limited inspiration.',
  'Patient unable to lie flat; images acquired semi-erect.',
  'Interpreter assisted; instructions confirmed with the patient.',
  'Contrast injection through a 20G cannula in the right antecubital fossa without incident.',
];
