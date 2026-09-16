import { and, desc, eq, ne, inArray } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, formatAccession } from '@bonakala/domain';
import { findProcedure, hashString } from '@bonakala/domain/bci';
import type { Services } from '../../kernel/ports.js';
import { nextSequence } from '../../kernel/events.js';
import { renderSyntheticImage } from './synthetic.js';

export interface CreateStudyInput {
  practiceId: string;
  siteId: string;
  roomId?: string | null;
  patientId: string;
  procedureCode: string;
  modality?: string;
  bodyPart?: string;
  laterality?: string | null;
  indication?: string | null;
  priority?: string;
  orderId?: string | null;
  appointmentId?: string | null;
  worklistItemId?: string | null;
  referrerId?: string | null;
  technologistUserId?: string | null;
  receivedAt?: string;
  /** Force an accession (seeds) instead of taking the next sequence. */
  accession?: string;
  id?: string;
  unmatched?: boolean;
  storeImages?: boolean;
}

export async function nextAccession(services: Services, practiceId: string, at = new Date()): Promise<string> {
  const [prac] = await services.db.select({ prefix: schema.legalEntities.accessionPrefix }).from(schema.legalEntities).where(eq(schema.legalEntities.id, practiceId)).limit(1);
  const prefix = prac?.prefix ?? 'BXXX';
  const yy = at.getUTCFullYear();
  const seq = await nextSequence(services, `accession:${practiceId}:${String(yy % 100).padStart(2, '0')}`);
  return formatAccession(prefix, yy, seq);
}

export function patientLabel(p: { lastName: string; firstName: string; sex: string | null; dateOfBirth: string | null }): string {
  return `${p.lastName.toUpperCase()}^${p.firstName[0]?.toUpperCase() ?? ''} · ${p.sex ?? 'X'} · ${p.dateOfBirth?.slice(0, 4) ?? '----'}`;
}

/** Create a study with series and instance metadata; images are rendered into the ObjectStore (or lazily on fetch). */
export async function createStudy(services: Services, input: CreateStudyInput) {
  const db = services.db;
  const proc = findProcedure(input.procedureCode);
  const modality = input.modality ?? proc?.modality ?? 'DX';
  const bodyPart = input.bodyPart ?? proc?.bodyPart ?? 'chest';
  const receivedAt = input.receivedAt ?? services.clock.now().toISOString();
  const accession = input.accession ?? (await nextAccession(services, input.practiceId, new Date(receivedAt)));
  const id = input.id ?? newId('stu');
  const studyUid = `1.2.826.0.1.3680043.10.${hashString(accession) % 100000}.${hashString(id) % 100000}`;
  const storagePrefix = `${input.practiceId}/studies/${id}`;
  const [pat] = await db.select().from(schema.patients).where(eq(schema.patients.id, input.patientId)).limit(1);
  const label = pat ? patientLabel(pat) : 'UNKNOWN^ · X · ----';
  const seriesDefs = proc?.series ?? [{ description: 'Series 1', instances: 1 }];
  const seriesRows: (typeof schema.series.$inferInsert)[] = [];
  const instRows: (typeof schema.instances.$inferInsert)[] = [];
  let instanceCount = 0;
  seriesDefs.forEach((sd, si) => {
    const seriesId = newId('ser');
    // Keep metadata compact: cross-sectional series store up to 6 representative instances.
    const count = Math.min(sd.instances, 6);
    seriesRows.push({ id: seriesId, practiceId: input.practiceId, studyId: id, seriesUid: `${studyUid}.${si + 1}`, number: si + 1, description: sd.description, modality, view: sd.view ?? null, instanceCount: sd.instances, createdAt: receivedAt });
    for (let i = 0; i < count; i++) {
      const instId = newId('img');
      instRows.push({ id: instId, practiceId: input.practiceId, studyId: id, seriesId, sopUid: `${studyUid}.${si + 1}.${i + 1}`, number: i + 1, storageKey: `${storagePrefix}/${seriesId}/${i + 1}.svg`, contentType: 'image/svg+xml', view: sd.view ?? null, laterality: input.laterality ?? null, createdAt: receivedAt });
    }
    instanceCount += sd.instances;
  });
  await db.insert(schema.studies).values({
    id, practiceId: input.practiceId, siteId: input.siteId, roomId: input.roomId ?? null, patientId: input.patientId, accession, studyUid,
    orderId: input.orderId ?? null, appointmentId: input.appointmentId ?? null, worklistItemId: input.worklistItemId ?? null, referrerId: input.referrerId ?? null,
    modality, procedureCode: input.procedureCode, procedureDescription: proc?.description ?? input.procedureCode, bodyPart, laterality: input.laterality ?? null,
    indication: input.indication ?? null, priority: input.priority ?? 'routine', status: 'received', seriesCount: seriesRows.length, instanceCount, storagePrefix,
    priorIds: [], keyImageIds: [], technologistUserId: input.technologistUserId ?? null, retentionClass: pat?.dateOfBirth && ageYears(pat.dateOfBirth, receivedAt) < 18 ? 'paediatric' : 'standard',
    unmatched: input.unmatched ?? false, receivedAt, createdAt: receivedAt, updatedAt: receivedAt,
  });
  if (seriesRows.length) await db.insert(schema.series).values(seriesRows);
  if (instRows.length) await db.insert(schema.instances).values(instRows);
  if (input.storeImages !== false) {
    for (const inst of instRows) {
      const sd = seriesRows.find((s) => s.id === inst.seriesId)!;
      await services.objects.put(inst.storageKey, renderSyntheticImage({ modality, bodyPart, view: inst.view, laterality: inst.laterality, accession, instanceNumber: inst.number, seriesDescription: sd.description, patientLabel: label }), 'image/svg+xml');
    }
  }
  // Link priors for the same patient (same practice always; other practices only with consent, handled by the Priors Hand)
  const priors = await db.select({ id: schema.studies.id }).from(schema.studies).where(and(eq(schema.studies.patientId, input.patientId), eq(schema.studies.practiceId, input.practiceId), ne(schema.studies.id, id))).orderBy(desc(schema.studies.receivedAt)).limit(5);
  if (priors.length) await db.update(schema.studies).set({ priorIds: priors.map((p) => p.id) }).where(eq(schema.studies.id, id));
  const [row] = await db.select().from(schema.studies).where(eq(schema.studies.id, id)).limit(1);
  return { study: row!, series: seriesRows, instances: instRows, patientLabel: label };
}

export function ageYears(dob: string | null | undefined, at: string | Date = new Date()): number {
  if (!dob) return 40;
  const a = new Date(at).getTime() - new Date(dob).getTime();
  return Math.floor(a / (365.25 * 24 * 3600_000));
}

/** Fetch (or lazily render and store) the pixel object for an instance. */
export async function getInstanceObject(services: Services, inst: typeof schema.instances.$inferSelect, study: typeof schema.studies.$inferSelect) {
  const existing = await services.objects.get(inst.storageKey);
  if (existing) return existing;
  const [ser] = await services.db.select().from(schema.series).where(eq(schema.series.id, inst.seriesId)).limit(1);
  const [pat] = await services.db.select().from(schema.patients).where(eq(schema.patients.id, study.patientId)).limit(1);
  const svg = renderSyntheticImage({ modality: study.modality, bodyPart: study.bodyPart, view: inst.view, laterality: inst.laterality, accession: study.accession, instanceNumber: inst.number, seriesDescription: ser?.description ?? 'Series', patientLabel: pat ? patientLabel(pat) : 'UNKNOWN^' });
  await services.objects.put(inst.storageKey, svg, 'image/svg+xml');
  return { body: new TextEncoder().encode(svg).buffer as ArrayBuffer, contentType: 'image/svg+xml' };
}

export async function studyBundle(services: Services, studyId: string) {
  const db = services.db;
  const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId)).limit(1);
  if (!study) return null;
  const ser = await db.select().from(schema.series).where(eq(schema.series.studyId, studyId)).orderBy(schema.series.number);
  const inst = await db.select().from(schema.instances).where(eq(schema.instances.studyId, studyId)).orderBy(schema.instances.number);
  const priors = study.priorIds?.length ? await db.select({ id: schema.studies.id, accession: schema.studies.accession, modality: schema.studies.modality, procedureDescription: schema.studies.procedureDescription, bodyPart: schema.studies.bodyPart, receivedAt: schema.studies.receivedAt, siteId: schema.studies.siteId, practiceId: schema.studies.practiceId, status: schema.studies.status }).from(schema.studies).where(inArray(schema.studies.id, study.priorIds)) : [];
  return { study, series: ser, instances: inst, priors };
}
