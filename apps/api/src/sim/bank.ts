/**
 * Bank feed simulator (demo only): credits that match remittances (ERA totals), EFT payments by
 * reference, and distribution payment-file settlement. Unmatched credits are surfaced for DEB.
 *
 * No hexagonal port here: unlike the switch/PSP/WhatsApp/voice integrations, there is no generic South
 * African bank-feed API to adapt to — each bank's statement/webhook integration (format, auth, delivery)
 * is proprietary and would need to be built against a specific bank's spec. The real integration point
 * is `POST /credit` itself: move it out from behind the demoMode gate (`sim/index.ts`), replace the
 * `allow(...)` staff-persona check with that bank's webhook signature verification, and this matching
 * logic runs unchanged.
 */
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { Hono } from 'hono';
import type { AppEnv } from '../kernel/context.js';
import { allow, body } from '../kernel/index.js';
import { emitDirect } from '../kernel/events.js';
import { settlePendingPayment } from '../modules/m14-billing/service.js';

export interface BankCredit { id: string; practiceId: string; reference: string; amountCents: number; at: string; matchedTo: { type: string; id: string } | null }
export const bankState: { credits: BankCredit[] } = { credits: [] };

export const bankRoutes = new Hono<AppEnv>();

bankRoutes.get('/statement', allow('DEB', 'BIL', 'PRM', 'EXE', 'SUP'), (c) => {
  const practiceId = c.get('practiceId');
  return c.json({ credits: bankState.credits.filter((x) => !practiceId || x.practiceId === practiceId) });
});

/** A credit arrives on the feed; match it to an ERA reference, an EFT payment reference or a distribution file. */
bankRoutes.post('/credit', allow('DEB', 'BIL', 'PRM', 'EXE', 'SUP'), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  if (!practiceId) return c.json({ error: 'practice_required' }, 400);
  const { reference, amountCents } = await body(c, z.object({ reference: z.string(), amountCents: z.number().int().positive() }));
  const at = new Date().toISOString();
  const credit: BankCredit = { id: `bnk_${Date.now().toString(36)}`, practiceId, reference, amountCents, at, matchedTo: null };
  const db = services.db;
  const [rem] = await db.select().from(schema.remittances).where(and(eq(schema.remittances.practiceId, practiceId), eq(schema.remittances.reference, reference), isNull(schema.remittances.bankRef))).limit(1);
  if (rem && Math.abs(rem.totalCents - amountCents) <= 100) {
    await db.update(schema.remittances).set({ bankRef: credit.id, bankedAt: at, status: 'banked' }).where(eq(schema.remittances.id, rem.id));
    credit.matchedTo = { type: 'remittance', id: rem.id };
    await emitDirect(services, 'remittance.banked.v1', { remittanceId: rem.id, practiceId, bankRef: credit.id, amountCents }, { aggregateType: 'remittance', aggregateId: rem.id, practiceId });
  } else {
    const [pay] = await db.select().from(schema.payments).where(and(eq(schema.payments.practiceId, practiceId), eq(schema.payments.reference, reference), eq(schema.payments.status, 'pending'))).limit(1);
    if (pay && pay.amountCents === amountCents) {
      await settlePendingPayment(services, pay.id, credit.id);
      credit.matchedTo = { type: 'payment', id: pay.id };
    }
  }
  if (!credit.matchedTo) await emitDirect(services, 'bank.credit.unmatched.v1', { bankRef: credit.id, practiceId, reference, amountCents }, { aggregateType: 'bank_credit', aggregateId: credit.id, practiceId });
  bankState.credits.push(credit);
  return c.json({ credit });
});

/** Settle a released distribution payment file (bank acknowledgement). */
bankRoutes.post('/settle-distribution', allow('EXE', 'SUP'), async (c) => {
  const services = c.get('services');
  const { distributionId } = await body(c, z.object({ distributionId: z.string() }));
  const [d] = await services.db.select().from(schema.distributions).where(eq(schema.distributions.id, distributionId)).limit(1);
  if (!d || d.status !== 'released') return c.json({ error: 'not_released' }, 409);
  const at = new Date().toISOString();
  const bankRef = `BNK-PB-${at.slice(2, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 90) + 10)}`;
  await services.db.update(schema.distributions).set({ status: 'paid', paidAt: at, bankRef, updatedAt: at }).where(eq(schema.distributions.id, distributionId));
  await services.db.update(schema.shareholderStatements).set({ status: 'paid', bankRef }).where(eq(schema.shareholderStatements.distributionId, distributionId));
  await emitDirect(services, 'distribution.paid.v1', { distributionId, practiceId: d.practiceId, bankRef, period: d.period }, { aggregateType: 'distribution', aggregateId: distributionId, practiceId: d.practiceId });
  return c.json({ ok: true, bankRef });
});
