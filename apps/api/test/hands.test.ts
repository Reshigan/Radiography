import { describe, expect, it, beforeAll } from 'vitest';
import { defineHand } from '@bonakala/domain';
import { createTestApp, type TestApp } from './harness.js';
import { registerHand, runHand } from '../src/kernel/hands.js';

const testHand = defineHand({
  id: 'test', name: 'Test Hand', module: 'M20', mandate: 'Test leash and approval flow', level: 'A3',
  defaultLeash: { maxAmountCents: 100000 }, approvalPersona: 'PRM', approvalPolicy: 'PRM approves amounts above leash',
  tools: { 'db.read': 'R0', 'money.pay': 'R2', 'external.submit': 'R3' },
});

describe('hands runtime', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    registerHand<{ amount: number; submit?: boolean }, { paid: number }>(testHand, async (input, ctx) => {
      await ctx.step('db.read', {}, async () => 1);
      ctx.leashCheck([{ rule: 'maxAmountCents', actual: input.amount }]);
      const paid = await ctx.step('money.pay', { amount: input.amount }, async () => input.amount);
      if (input.submit) await ctx.step('external.submit', {}, async () => 'ok');
      return { paid };
    });
  });

  it('runs within leash', async () => {
    const task = await runHand(t.services, 'test', { amount: 500 }, { practiceId: 'prac_a', trigger: 'manual', title: 't1' });
    expect(task.status).toBe('done');
    expect(task.output).toEqual({ paid: 500 });
    expect(task.steps.length).toBe(2);
  });

  it('stops for approval above leash, then completes after approval', async () => {
    const task = await runHand(t.services, 'test', { amount: 500000 }, { practiceId: 'prac_a', trigger: 'manual', title: 't2' });
    expect(task.status).toBe('needs_approval');
    expect(task.approvalPersona).toBe('PRM');
    const prm = await t.login('prm@demo.bonakala');
    const fdk = await t.login('fdk@demo.bonakala');
    expect((await t.call(fdk, 'POST', `/api/hands/tasks/${task.id}/approve`)).status).toBe(403);
    const approved = await t.call(prm, 'POST', `/api/hands/tasks/${task.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.json.task.status).toBe('done');
  });

  it('refuses tools outside the mandate and R3 tools without approval', async () => {
    registerHand<Record<string, unknown>, Record<string, unknown>>(defineHand({ ...testHand, id: 'test2', tools: { 'db.read': 'R0' } }), async (_i, ctx) => {
      await ctx.step('money.pay', {}, async () => 1);
      return {};
    });
    const refused = await runHand(t.services, 'test2', {}, { practiceId: 'prac_a', trigger: 'manual', title: 't3' });
    expect(refused.status).toBe('refused');
    const needs = await runHand(t.services, 'test', { amount: 1, submit: true }, { practiceId: 'prac_a', trigger: 'manual', title: 't4' });
    expect(needs.status).toBe('needs_approval');
  });

  it('paused Hands do not run; registry lists hands with leash', async () => {
    const prm = await t.login('prm@demo.bonakala');
    expect((await t.call(prm, 'PATCH', '/api/hands/test', { status: 'paused', reason: 'test pause' })).status).toBe(200);
    const task = await runHand(t.services, 'test', { amount: 1 }, { practiceId: 'prac_b', trigger: 'manual', title: 't5' });
    expect(task.status).toBe('refused');
    const list = await t.call(prm, 'GET', '/api/hands');
    expect(list.json.hands.find((h: any) => h.id === 'test').status).toBe('paused');
  });
});
