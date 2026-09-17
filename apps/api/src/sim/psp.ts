/**
 * Payment service provider simulator (demo only): hosted payment page for payment links, webhook that
 * settles the payment, and instalment collection for plans. The Platform never stores card numbers.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { Hono } from 'hono';
import type { AppEnv } from '../kernel/context.js';
import type { PaymentGatewayPort } from '../kernel/ports.js';
import { body, param } from '../kernel/index.js';
import { settlePendingPayment } from '../modules/m14-billing/service.js';

/** PaymentGatewayPort adapter over this simulator — the seam a real PSP integration replaces. See kernel/ports.ts. */
export const simPaymentGateway: PaymentGatewayPort = {
  available: true,
  async createLink(input) {
    return { url: `/api/sim/psp/pay/${input.token}` };
  },
};

export const pspRoutes = new Hono<AppEnv>();

/** Link details as the hosted page would show them (no auth: the token is the secret). */
pspRoutes.get('/link/:token', async (c) => {
  const db = c.get('services').db;
  const [p] = await db.select().from(schema.payments).where(eq(schema.payments.linkToken, param(c, 'token'))).limit(1);
  if (!p) return c.json({ error: 'not_found' }, 404);
  const expired = !!p.linkExpiresAt && p.linkExpiresAt < new Date().toISOString();
  return c.json({ amountCents: p.amountCents, status: expired && p.status === 'pending' ? 'expired' : p.status, expiresAt: p.linkExpiresAt, reference: p.reference, methods: ['card', 'payshap', 'qr'] });
});

/** Minimal hosted page (demo). */
pspRoutes.get('/pay/:token', async (c) => {
  const db = c.get('services').db;
  const [p] = await db.select().from(schema.payments).where(eq(schema.payments.linkToken, param(c, 'token'))).limit(1);
  if (!p) return c.html('<p>Link not found.</p>', 404);
  const rands = (p.amountCents / 100).toFixed(2);
  return c.html(`<!doctype html><meta charset="utf-8"><title>Pay R ${rands} (demo PSP)</title><body style="font-family:system-ui;max-width:420px;margin:40px auto"><h2>Bonakala Imaging · demo PSP</h2><p>Reference <code>${p.reference}</code></p><p style="font-size:28px">R ${rands}</p><p>Status: <b>${p.status}</b></p>${p.status === 'pending' ? `<form method="post" action="/api/sim/psp/pay/${p.linkToken}"><button style="font-size:16px;padding:10px 18px">Pay with card (simulated)</button></form>` : ''}<p style="color:#666;font-size:12px">DEMO · synthetic data · no card details are collected.</p></body>`);
});

/** Webhook / hosted-page callback: settles a pending link payment. */
pspRoutes.post('/pay/:token', async (c) => {
  const services = c.get('services');
  const token = param(c, 'token');
  const [p] = await services.db.select().from(schema.payments).where(eq(schema.payments.linkToken, token)).limit(1);
  if (!p) return c.json({ error: 'not_found' }, 404);
  if (p.linkExpiresAt && p.linkExpiresAt < new Date().toISOString() && p.status === 'pending') {
    await services.db.update(schema.payments).set({ status: 'expired' }).where(eq(schema.payments.id, p.id));
    return c.json({ error: 'expired' }, 410);
  }
  if (p.status !== 'pending') return c.json({ error: 'already_used', status: p.status }, 409);
  const method = (await c.req.json().catch(() => ({}))).method ?? 'card';
  await services.db.update(schema.payments).set({ method: ['card', 'payshap', 'qr'].includes(method) ? method : 'card' }).where(eq(schema.payments.id, p.id));
  const settled = await settlePendingPayment(services, p.id, `PSP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`);
  // plan instalment: mark the matching instalment paid
  if (settled?.accountId) {
    const plans = await services.db.select().from(schema.paymentPlans).where(eq(schema.paymentPlans.accountId, settled.accountId));
    for (const plan of plans) {
      if (plan.status !== 'active') continue;
      const next = plan.schedule.find((s) => s.status !== 'paid' && s.amountCents === settled.amountCents);
      if (!next) continue;
      next.status = 'paid';
      next.paidAt = new Date().toISOString();
      const done = plan.schedule.every((s) => s.status === 'paid');
      await services.db.update(schema.paymentPlans).set({ schedule: plan.schedule, status: done ? 'completed' : 'active', updatedAt: new Date().toISOString() }).where(eq(schema.paymentPlans.id, plan.id));
      break;
    }
  }
  return c.json({ ok: true, payment: settled });
});

/** Simulated chargeback (card dispute) — records a reversal on the account. */
pspRoutes.post('/chargeback', async (c) => {
  const services = c.get('services');
  const { paymentId } = await body(c, z.object({ paymentId: z.string() }));
  const [p] = await services.db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).limit(1);
  if (!p || p.status !== 'settled') return c.json({ error: 'not_settled' }, 409);
  await services.db.update(schema.payments).set({ status: 'reversed' }).where(eq(schema.payments.id, p.id));
  if (p.accountId) {
    const [acc] = await services.db.select().from(schema.patientAccounts).where(eq(schema.patientAccounts.id, p.accountId)).limit(1);
    if (acc) {
      const { postTransaction } = await import('../modules/m14-billing/service.js');
      await postTransaction(services, acc, { type: 'adjustment', amountCents: p.amountCents, description: 'Card chargeback reversed the payment', refType: 'payment', refId: p.id });
    }
  }
  return c.json({ ok: true });
});
