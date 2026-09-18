import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { schema, type ConversationMessage } from '@bonakala/db';
import { newId } from '@bonakala/domain';
import type { AppEnv } from '../kernel/context.js';
import type { Services } from '../kernel/ports.js';
import { registerSim } from './index.js';

/**
 * WhatsApp Business simulator (demo). Outbound messages are recorded on the conversation thread and in an
 * in-memory outbox; inbound messages are routed to the Booking Hand (M05) by the handler registered at boot.
 * Content rules from docs/processes/02 §7.6: <= 3 lines, <= 3 buttons, no clinical detail beyond the procedure name.
 */
export interface OutboundMessage { id: string; to: string; text: string; buttons?: string[]; at: string; by: string; conversationId: string; practiceId: string; providerId?: string }

const outbox: OutboundMessage[] = [];
export function whatsappOutbox() {
  return outbox;
}

export function normaliseMobile(m: string): string {
  const digits = m.replace(/\D/g, '');
  if (digits.startsWith('27') && digits.length === 11) return `0${digits.slice(2)}`;
  return digits;
}

export async function findOrCreateConversation(services: Services, practiceId: string, mobile: string, patientId?: string | null) {
  const norm = normaliseMobile(mobile);
  const [existing] = await services.db.select().from(schema.conversations).where(and(eq(schema.conversations.mobile, norm), eq(schema.conversations.practiceId, practiceId))).orderBy(desc(schema.conversations.updatedAt)).limit(1);
  if (existing && existing.state !== 'closed') return existing;
  const id = newId('conv');
  await services.db.insert(schema.conversations).values({ id, practiceId, channel: 'whatsapp', mobile: norm, patientId: patientId ?? null, state: 'new', messages: [], offers: [] });
  const [row] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1);
  return row!;
}

export async function appendMessage(services: Services, conversationId: string, msg: ConversationMessage, patch: Partial<typeof schema.conversations.$inferInsert> = {}) {
  const [conv] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
  if (!conv) throw new Error('conversation not found');
  const messages = [...conv.messages, msg];
  await services.db.update(schema.conversations).set({ messages, updatedAt: new Date().toISOString(), ...patch }).where(eq(schema.conversations.id, conversationId));
  return messages;
}

/** Send a templated WhatsApp message (R2 tool). Validates the content rules and records the message. */
export async function sendWhatsApp(services: Services, input: { practiceId: string; to: string; text: string; buttons?: string[]; by: string; patientId?: string | null }): Promise<OutboundMessage> {
  if (input.buttons && input.buttons.length > 3) throw new Error('WhatsApp content rule: at most 3 buttons');
  if (/\b(finding|impression|tumou?r|fracture seen|haemorrhage|diagnos)/i.test(input.text)) throw new Error('WhatsApp content rule: no clinical findings in messages');
  const conv = await findOrCreateConversation(services, input.practiceId, input.to, input.patientId);
  const at = new Date().toISOString();
  await appendMessage(services, conv.id, { dir: 'out', text: input.text, at, buttons: input.buttons, by: input.by }, input.patientId && !conv.patientId ? { patientId: input.patientId } : {});
  const sent = await services.whatsAppSender.send({ to: conv.mobile, text: input.text, buttons: input.buttons });
  const msg: OutboundMessage = { id: newId('wa'), to: conv.mobile, text: input.text, buttons: input.buttons, at, by: input.by, conversationId: conv.id, practiceId: input.practiceId, providerId: sent.providerId };
  outbox.push(msg);
  if (outbox.length > 500) outbox.splice(0, outbox.length - 500);
  return msg;
}

/** Count of outbound messages to a mobile today (leash: maxMessagesPerDay). */
export async function outboundCountToday(services: Services, conversationId: string): Promise<number> {
  const [conv] = await services.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
  const today = new Date().toISOString().slice(0, 10);
  return (conv?.messages ?? []).filter((m) => m.dir === 'out' && m.at.startsWith(today)).length;
}

export type InboundHandler = (services: Services, input: { practiceId: string; from: string; text: string; conversationId: string }) => Promise<{ replies: ConversationMessage[]; state: string; taskId?: string }>;
let inboundHandler: InboundHandler | null = null;
export function setInboundHandler(h: InboundHandler) {
  inboundHandler = h;
}

export async function handleInbound(services: Services, input: { practiceId: string; from: string; text: string }) {
  const conv = await findOrCreateConversation(services, input.practiceId, input.from);
  await appendMessage(services, conv.id, { dir: 'in', text: input.text, at: new Date().toISOString(), by: 'patient' });
  if (!inboundHandler) throw new Error('No inbound handler registered (Booking Hand not booted)');
  const result = await inboundHandler(services, { ...input, conversationId: conv.id });
  return { conversationId: conv.id, ...result };
}

const routes = new Hono<AppEnv>();
routes.post('/inbound', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { from?: string; text?: string; practiceId?: string };
  if (!b.from || !b.text) return c.json({ error: 'invalid', message: 'from and text are required' }, 400);
  const practiceId = b.practiceId ?? c.get('practiceId') ?? 'prac_b';
  const result = await handleInbound(c.get('services'), { practiceId, from: b.from, text: b.text });
  return c.json(result);
});
routes.get('/outbox', (c) => c.json({ messages: outbox.slice(-100).reverse() }));
routes.get('/threads/:id', async (c) => {
  const [conv] = await c.get('services').db.select().from(schema.conversations).where(eq(schema.conversations.id, c.req.param('id'))).limit(1);
  return conv ? c.json({ conversation: conv }) : c.json({ error: 'not_found' }, 404);
});

export function registerWhatsAppSim() {
  registerSim('whatsapp', routes);
}
