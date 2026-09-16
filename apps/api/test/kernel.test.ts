import { describe, expect, it, beforeAll } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';
import { syntheticSaId } from '@bonakala/domain';

describe('kernel', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp(); });

  it('health lists modules', async () => {
    const res = await t.app.request('/api/health');
    const j = (await res.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.modules.length).toBe(20);
  });

  it('logs in as front desk and reads patients with tenant scoping', async () => {
    const cookie = await t.login('fdk@demo.bonakala');
    const me = await t.call(cookie, 'GET', '/api/auth/me');
    expect(me.json.user.persona).toBe('FDK');
    expect(me.json.practiceId).toBe('prac_a');
    const list = await t.call(cookie, 'GET', '/api/patients?limit=100');
    expect(list.status).toBe(200);
    expect(list.json.patients.length).toBe(60);
    expect(list.json.patients[0].idNumber).toBeUndefined();
    expect(list.json.patients[0].idNumberMasked).toMatch(/^····\d{4}$/);
  });

  it('group user must select a practice; patient persona cannot list', async () => {
    const exe = await t.login('exe@demo.bonakala');
    const noPractice = await t.call(exe, 'GET', '/api/patients');
    expect(noPractice.status).toBe(400);
    const withPractice = await t.call(exe, 'GET', '/api/patients', undefined, { 'x-practice-id': 'prac_b' });
    expect(withPractice.status).toBe(200);
    const pat = await t.login('pat@demo.bonakala');
    expect((await t.call(pat, 'GET', '/api/patients')).status).toBe(403);
    expect((await t.call(pat, 'GET', '/api/patients/me')).json.patient.firstName).toBe('Nomvula');
  });

  it('creates a patient with SA ID validation, duplicate detection and events', async () => {
    const cookie = await t.login('fdk@demo.bonakala');
    const bad = await t.call(cookie, 'POST', '/api/patients', { firstName: 'Test', lastName: 'Person', idType: 'sa_id', idNumber: '9001015009087' });
    expect(bad.status).toBe(400);
    const idNo = syntheticSaId('1990-01-01', 'M', 777);
    const good = await t.call(cookie, 'POST', '/api/patients', { firstName: 'Test', lastName: 'Person', idType: 'sa_id', idNumber: idNo });
    expect(good.status).toBe(201);
    const dup = await t.call(cookie, 'POST', '/api/patients', { firstName: 'Test', lastName: 'Person', idType: 'sa_id', idNumber: idNo });
    expect(dup.status).toBe(409);
    await t.flush();
    const { schema } = await import('@bonakala/db');
    const evts = await t.services.db.select().from(schema.events);
    expect(evts.some((e) => e.name === 'patient.created.v1' && e.processedAt)).toBe(true);
    const audit = await t.services.db.select().from(schema.auditLog);
    expect(audit.length).toBeGreaterThan(2);
    expect(audit[audit.length - 1]!.prevHash).toBe(audit[audit.length - 2]!.hash);
  });

  it('modality status change emits modality.down.v1', async () => {
    const bio = await t.login('bio@demo.bonakala');
    const r = await t.call(bio, 'PATCH', '/api/org/modalities/mod_san_ct1/status', { status: 'down', reason: 'tube arc' });
    expect(r.status).toBe(200);
    await t.flush();
    const { schema } = await import('@bonakala/db');
    const evts = await t.services.db.select().from(schema.events);
    expect(evts.some((e) => e.name === 'modality.down.v1')).toBe(true);
  });
});
