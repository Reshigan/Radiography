import { z } from 'zod';
import { and, eq, isNull, or } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { newId, notFound } from '@bonakala/domain';
import { defineModule, router, allow, body, audit, emit, requirePractice, param } from '../../kernel/index.js';

const r = router();

r.get('/entities', allow(), async (c) => {
  const db = c.get('services').db;
  const entities = await db.select().from(schema.legalEntities);
  const relationships = await db.select().from(schema.entityRelationships);
  const holdings = await db.select().from(schema.shareholdings).where(isNull(schema.shareholdings.effectiveTo));
  return c.json({ entities, relationships, shareholdings: holdings });
});

r.get('/practices', allow(), async (c) => {
  const db = c.get('services').db;
  const practices = await db.select().from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
  return c.json({ practices });
});

r.get('/sites', allow(), async (c) => {
  const db = c.get('services').db;
  const practiceId = c.get('practiceId');
  const rows = practiceId ? await db.select().from(schema.sites).where(eq(schema.sites.practiceId, practiceId)) : await db.select().from(schema.sites);
  return c.json({ sites: rows });
});

r.get('/sites/:id/rooms', allow(), async (c) => {
  const db = c.get('services').db;
  const rooms = await db.select().from(schema.rooms).where(eq(schema.rooms.siteId, param(c, 'id')));
  const mods = await db.select().from(schema.modalities).where(eq(schema.modalities.siteId, param(c, 'id')));
  return c.json({ rooms: rooms.map((room) => ({ ...room, modalities: mods.filter((m) => m.roomId === room.id) })) });
});

r.get('/modalities', allow(), async (c) => {
  const db = c.get('services').db;
  const practiceId = c.get('practiceId');
  const rows = practiceId ? await db.select().from(schema.modalities).where(eq(schema.modalities.practiceId, practiceId)) : await db.select().from(schema.modalities);
  return c.json({ modalities: rows });
});

r.patch('/modalities/:id/status', allow('BIO', 'PRM', 'SUP'), async (c) => {
  const { status, reason } = await body(c, z.object({ status: z.enum(['active', 'down', 'maintenance', 'decommissioned']), reason: z.string().optional() }));
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [m] = await db.select().from(schema.modalities).where(eq(schema.modalities.id, id)).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  await db.update(schema.modalities).set({ status, updatedAt: new Date().toISOString() }).where(eq(schema.modalities.id, id));
  await audit(c, 'modality.status', { type: 'modality', id }, { from: m.status, to: status, reason });
  await emit(c, status === 'down' ? 'modality.down.v1' : 'modality.status_changed.v1', { modalityId: id, siteId: m.siteId, type: m.type, status, reason }, { aggregateType: 'modality', aggregateId: id, practiceId: m.practiceId });
  return c.json({ ok: true });
});

r.get('/shareholdings', allow('EXE', 'SHR', 'SUP', 'PRM', 'CMP'), async (c) => {
  const db = c.get('services').db;
  const user = c.get('user')!;
  const practiceId = c.get('practiceId');
  const rows = await db.select().from(schema.shareholdings).where(practiceId ? eq(schema.shareholdings.entityId, practiceId) : isNull(schema.shareholdings.effectiveTo));
  const total = rows.filter((h) => !h.effectiveTo).reduce((a, h) => a + h.shares, 0);
  return c.json({ shareholdings: rows.map((h) => ({ ...h, percentage: total ? Math.round((h.shares / total) * 10000) / 100 : 0, mine: h.shareholderName === user.name })) });
});

r.post('/sites', allow('EXE', 'SUP'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, z.object({ code: z.string().min(2).max(4), name: z.string(), address: z.string().optional(), province: z.string().optional() }));
  const id = newId('site');
  await c.get('services').db.insert(schema.sites).values({ id, practiceId, ...data });
  await audit(c, 'site.created', { type: 'site', id }, data);
  return c.json({ id }, 201);
});

r.patch('/sites/:id', allow('EXE', 'SUP', 'PRM'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, id)).limit(1);
  if (!site) throw notFound('Site');
  const data = await body(c, z.object({ name: z.string().optional(), address: z.string().optional(), province: z.string().optional(), phone: z.string().optional(), status: z.enum(['active', 'inactive']).optional() }));
  await db.update(schema.sites).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.sites.id, id));
  await audit(c, 'site.updated', { type: 'site', id }, { from: site, to: data });
  return c.json({ ok: true });
});

r.post('/sites/:id/rooms', allow('EXE', 'SUP', 'PRM', 'BIO'), async (c) => {
  const db = c.get('services').db;
  const siteId = param(c, 'id');
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1);
  if (!site) throw notFound('Site');
  const data = await body(c, z.object({ name: z.string(), roomType: z.enum(['XR', 'CT', 'MR', 'US', 'MG', 'RF', 'DXA', 'PX']), licenceNo: z.string().optional(), licenceExpiry: z.string().optional() }));
  const id = newId('room');
  await db.insert(schema.rooms).values({ id, siteId, practiceId: site.practiceId, ...data });
  await audit(c, 'room.created', { type: 'room', id }, data);
  return c.json({ id }, 201);
});

r.patch('/rooms/:id', allow('EXE', 'SUP', 'PRM', 'BIO'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [room] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, id)).limit(1);
  if (!room) throw notFound('Room');
  const data = await body(c, z.object({ name: z.string().optional(), licenceNo: z.string().nullable().optional(), licenceExpiry: z.string().nullable().optional(), status: z.enum(['active', 'inactive']).optional() }));
  await db.update(schema.rooms).set(data).where(eq(schema.rooms.id, id));
  await audit(c, 'room.updated', { type: 'room', id }, { from: room, to: data });
  return c.json({ ok: true });
});

r.post('/rooms/:id/modalities', allow('EXE', 'SUP', 'PRM', 'BIO'), async (c) => {
  const db = c.get('services').db;
  const roomId = param(c, 'id');
  const [room] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).limit(1);
  if (!room) throw notFound('Room');
  const data = await body(c, z.object({ type: z.enum(['DX', 'CR', 'CT', 'MR', 'US', 'MG', 'RF', 'DXA', 'PX', 'NM']), vendor: z.string().optional(), model: z.string().optional(), serial: z.string().optional(), aeTitle: z.string().optional() }));
  const id = newId('mod');
  await db.insert(schema.modalities).values({ id, roomId, siteId: room.siteId, practiceId: room.practiceId, ...data });
  await audit(c, 'modality.created', { type: 'modality', id }, data);
  return c.json({ id }, 201);
});

r.patch('/modalities/:id', allow('EXE', 'SUP', 'PRM', 'BIO'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [mod] = await db.select().from(schema.modalities).where(eq(schema.modalities.id, id)).limit(1);
  if (!mod) throw notFound('Modality');
  const data = await body(c, z.object({ vendor: z.string().optional(), model: z.string().optional(), serial: z.string().optional(), aeTitle: z.string().optional() }));
  await db.update(schema.modalities).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.modalities.id, id));
  await audit(c, 'modality.updated', { type: 'modality', id }, { from: mod, to: data });
  return c.json({ ok: true });
});

r.post('/entities', allow('EXE', 'SUP'), async (c) => {
  const data = await body(c, z.object({
    type: z.enum(['holding', 'mso', 'property', 'professional_holding', 'practice', 'hub', 'external_partner']),
    registeredName: z.string(), tradingName: z.string().optional(), cipcNo: z.string().optional(), vatNo: z.string().optional(),
    bhfPracticeNo: z.string().optional(), accessionPrefix: z.string().max(4).optional(), financialYearEnd: z.string().optional(),
  }));
  const id = newId('ent');
  await c.get('services').db.insert(schema.legalEntities).values({ id, ...data });
  await audit(c, 'entity.created', { type: 'entity', id }, data);
  return c.json({ id }, 201);
});

r.patch('/entities/:id', allow('EXE', 'SUP'), async (c) => {
  const db = c.get('services').db;
  const id = param(c, 'id');
  const [entity] = await db.select().from(schema.legalEntities).where(eq(schema.legalEntities.id, id)).limit(1);
  if (!entity) throw notFound('Entity');
  const data = await body(c, z.object({
    tradingName: z.string().optional(), cipcNo: z.string().optional(), vatNo: z.string().optional(),
    bhfPracticeNo: z.string().optional(), accessionPrefix: z.string().max(4).optional(), financialYearEnd: z.string().optional(), status: z.enum(['active', 'inactive']).optional(),
  }));
  await db.update(schema.legalEntities).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.legalEntities.id, id));
  await audit(c, 'entity.updated', { type: 'entity', id }, { from: entity, to: data });
  return c.json({ ok: true });
});

r.get('/licences', allow('CMP', 'PRM', 'BIO', 'EXE', 'SUP', 'RAD'), async (c) => {
  const db = c.get('services').db;
  const practiceId = c.get('practiceId');
  const rows = await db.select({ room: schema.rooms, site: schema.sites }).from(schema.rooms).innerJoin(schema.sites, eq(schema.sites.id, schema.rooms.siteId))
    .where(practiceId ? eq(schema.rooms.practiceId, practiceId) : or(isNull(schema.rooms.licenceNo), and()));
  const today = new Date().toISOString().slice(0, 10);
  return c.json({
    licences: rows.filter((x) => x.room.licenceNo).map((x) => ({
      roomId: x.room.id, room: x.room.name, site: x.site.name, licenceNo: x.room.licenceNo, expiry: x.room.licenceExpiry,
      daysToExpiry: x.room.licenceExpiry ? Math.round((new Date(x.room.licenceExpiry).getTime() - new Date(today).getTime()) / 86400000) : null,
    })),
  });
});

export default defineModule({ code: 'M02', name: 'Organisation & Shareholding', basePath: 'org', routes: r });
