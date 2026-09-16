import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import type { Services } from '../../kernel/index.js';

export const SAST_OFFSET = '+02:00';
export const IONISING_TYPES = ['XR', 'CT', 'MG', 'DXA', 'RF'];
/** Modalities that cannot run on a site generator during load-shedding unless listed for that site. */
export const POWER_HUNGRY = ['CT', 'MR', 'MG', 'DXA'];

export function sastDate(iso: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(typeof iso === 'string' ? new Date(iso) : iso);
}
export function sastTime(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(typeof iso === 'string' ? new Date(iso) : iso);
}
export function sastIso(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00${SAST_OFFSET}`).toISOString();
}
export function sastWeekday(date: string): number {
  return new Date(`${date}T12:00:00${SAST_OFFSET}`).getUTCDay();
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function roomTypeFor(modality: string): string {
  return modality === 'DX' || modality === 'CR' ? 'XR' : modality;
}

export interface Slot { siteId: string; siteName: string; roomId: string; roomName: string; modalityType: string; startsAt: string; endsAt: string; durationMin: number; blockType: string }
export interface LoadSheddingConfig { stage: number; schedule: Array<{ weekday: number; start: string; end: string }>; generatorModalities: string[]; roomsOnGenerator?: string[]; note?: string }

export const ACTIVE_APPT = ['held', 'booked', 'confirmed', 'arrived', 'in_room', 'done'];

export async function loadSheddingFor(services: Services, siteId: string): Promise<LoadSheddingConfig | null> {
  const [row] = await services.db.select().from(schema.referenceData).where(and(eq(schema.referenceData.kind, 'loadshedding'), eq(schema.referenceData.key, siteId))).limit(1);
  return row ? (row.value as unknown as LoadSheddingConfig) : null;
}

export interface AvailabilityInput { siteIds?: string[]; roomId?: string; modalityType: string; date: string; durationMin: number; now?: Date; leadMinutes?: number }
export interface RoomConstraint { roomId: string; roomName: string; siteId: string; blocked: string[]; loadShedding: Array<{ start: string; end: string }> }

/** Compute feasible slots for a day: templates minus bookings minus room status, licence and load-shedding (docs/processes/02 §7.1–7.2, §7.10). */
export async function availability(services: Services, input: AvailabilityInput): Promise<{ slots: Slot[]; rooms: RoomConstraint[] }> {
  const db = services.db;
  const now = input.now ?? services.clock.now();
  const type = roomTypeFor(input.modalityType);
  const roomRows = await db.select({ room: schema.rooms, site: schema.sites }).from(schema.rooms).innerJoin(schema.sites, eq(schema.sites.id, schema.rooms.siteId))
    .where(and(eq(schema.rooms.roomType, type), input.roomId ? eq(schema.rooms.id, input.roomId) : undefined, input.siteIds?.length ? inArray(schema.rooms.siteId, input.siteIds) : undefined));
  if (!roomRows.length) return { slots: [], rooms: [] };
  const roomIds = roomRows.map((r) => r.room.id);
  const mods = await db.select().from(schema.modalities).where(inArray(schema.modalities.roomId, roomIds));
  const weekday = sastWeekday(input.date);
  const templates = await db.select().from(schema.slotTemplates).where(and(inArray(schema.slotTemplates.roomId, roomIds), eq(schema.slotTemplates.weekday, weekday)));
  const dayStart = sastIso(input.date, '00:00');
  const dayEnd = sastIso(addDays(input.date, 1), '00:00');
  const booked = await db.select({ roomId: schema.appointments.roomId, startsAt: schema.appointments.startsAt, endsAt: schema.appointments.endsAt, status: schema.appointments.status, holdExpiresAt: schema.appointments.holdExpiresAt }).from(schema.appointments)
    .where(and(inArray(schema.appointments.roomId, roomIds), gte(schema.appointments.startsAt, dayStart), lt(schema.appointments.startsAt, dayEnd), inArray(schema.appointments.status, ACTIVE_APPT)));
  const lsBySite = new Map<string, LoadSheddingConfig | null>();
  const slots: Slot[] = [];
  const rooms: RoomConstraint[] = [];
  const minStart = new Date(now.getTime() + (input.leadMinutes ?? 20) * 60_000).toISOString();
  for (const { room, site } of roomRows) {
    const blocked: string[] = [];
    if (room.status !== 'active') blocked.push(`room ${room.status}`);
    if (room.licenceNo && IONISING_TYPES.includes(room.roomType) && room.licenceExpiry && room.licenceExpiry < input.date) blocked.push(`licence ${room.licenceNo} expired ${room.licenceExpiry}`);
    const rm = mods.filter((m) => m.roomId === room.id);
    if (rm.length && rm.every((m) => m.status !== 'active')) blocked.push(`modality ${rm[0]!.status}`);
    if (rm.some((m) => m.nextQaDue && m.nextQaDue < input.date)) blocked.push('QA overdue');
    if (!lsBySite.has(site.id)) lsBySite.set(site.id, await loadSheddingFor(services, site.id));
    const ls = lsBySite.get(site.id);
    const lsWindows: Array<{ start: string; end: string }> = [];
    if (ls && ls.stage > 0) {
      const onGen = ls.generatorModalities.includes(room.roomType) || ls.roomsOnGenerator?.includes(room.id);
      if (!onGen && POWER_HUNGRY.includes(room.roomType)) for (const w of ls.schedule.filter((w) => w.weekday === weekday)) lsWindows.push({ start: sastIso(input.date, w.start), end: sastIso(input.date, w.end) });
    }
    rooms.push({ roomId: room.id, roomName: room.name, siteId: site.id, blocked, loadShedding: lsWindows });
    if (blocked.length) continue;
    const roomBooked = booked.filter((b) => b.roomId === room.id && !(b.status === 'held' && b.holdExpiresAt && b.holdExpiresAt < now.toISOString()));
    for (const t of templates.filter((t) => t.roomId === room.id && t.effectiveFrom <= input.date && (!t.effectiveTo || t.effectiveTo >= input.date))) {
      const duration = t.durationByProcedure?.['*'] ?? input.durationMin;
      const start = new Date(sastIso(input.date, t.startTime)).getTime();
      const end = new Date(sastIso(input.date, t.endTime)).getTime();
      for (let s = start; s + duration * 60_000 <= end; s += t.slotMinutes * 60_000) {
        const sIso = new Date(s).toISOString();
        const eIso = new Date(s + duration * 60_000).toISOString();
        if (sIso < minStart) continue;
        if (roomBooked.some((b) => b.startsAt < eIso && b.endsAt > sIso)) continue;
        if (lsWindows.some((w) => w.start < eIso && w.end > sIso)) continue;
        slots.push({ siteId: site.id, siteName: site.name, roomId: room.id, roomName: room.name, modalityType: room.roomType, startsAt: sIso, endsAt: eIso, durationMin: duration, blockType: t.blockType });
      }
    }
  }
  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.roomName.localeCompare(b.roomName));
  return { slots, rooms };
}
