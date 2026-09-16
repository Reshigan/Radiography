import { z } from 'zod';
import { Hono } from 'hono';
import { hashString } from '@bonakala/domain/bci';
import { newId } from '@bonakala/domain';
import type { AppEnv } from '../kernel/context.js';
import { body, requireUser } from '../kernel/index.js';
import type { Services } from '../kernel/ports.js';
import { registerSim } from './index.js';

export interface SimCall { id: string; at: string; to: string; toMasked: string; script: string; outcome: 'answered' | 'no_answer' | 'busy' | 'voicemail'; durationSec: number; bridged: boolean; relatedId?: string }

const calls: SimCall[] = [];

export function maskPhone(p: string | null | undefined): string {
  if (!p) return '(no number)';
  const digits = p.replace(/\D/g, '');
  return digits.length >= 4 ? `··· ${digits.slice(-4)}` : '····';
}

/**
 * Telephony adapter simulator used by the Critical Results Hand. The outcome is deterministic per
 * (number, attempt) so demos and tests are repeatable: the first attempt to most numbers goes
 * unanswered, the second is answered; numbers ending in 0000 never answer (unreachable referrer).
 */
export async function placeCall(services: Services, input: { to: string | null | undefined; script: string; attempt: number; relatedId?: string; bridgeTo?: string }): Promise<SimCall> {
  const to = input.to ?? '';
  const digits = to.replace(/\D/g, '');
  let outcome: SimCall['outcome'];
  if (!digits) outcome = 'no_answer';
  else if (digits.endsWith('0000')) outcome = 'no_answer';
  else if (input.attempt >= 2) outcome = 'answered';
  else outcome = hashString(`${digits}|${input.attempt}`) % 5 === 0 ? 'answered' : hashString(digits) % 3 === 0 ? 'voicemail' : 'no_answer';
  const call: SimCall = { id: newId('call'), at: services.clock.now().toISOString(), to, toMasked: maskPhone(to), script: input.script, outcome, durationSec: outcome === 'answered' ? 45 + (hashString(digits) % 90) : 0, bridged: outcome === 'answered' && !!input.bridgeTo, relatedId: input.relatedId };
  calls.push(call);
  if (calls.length > 500) calls.splice(0, calls.length - 500);
  return call;
}
export function listCalls(relatedId?: string): SimCall[] {
  return relatedId ? calls.filter((c) => c.relatedId === relatedId) : [...calls];
}

export function registerTelephonySim() {
  const sim = new Hono<AppEnv>();
  sim.post('/call', async (c) => {
    requireUser(c);
    const data = await body(c, z.object({ to: z.string(), script: z.string().default('A radiologist at Bonakala Imaging needs to speak to the doctor about a patient.'), attempt: z.number().default(1), relatedId: z.string().optional() }));
    const call = await placeCall(c.get('services'), data);
    return c.json({ call: { ...call, to: undefined } });
  });
  sim.get('/calls', (c) => {
    requireUser(c);
    return c.json({ calls: listCalls(c.req.query('relatedId')).map((x) => ({ ...x, to: undefined })) });
  });
  registerSim('telephony', sim);
}
