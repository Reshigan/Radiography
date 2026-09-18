import { hashString } from '@bonakala/domain/bci';
import type { VoiceCallerPort } from './ports.js';

/**
 * Outbound voice via a Twilio-shaped Calls API. When TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/
 * TWILIO_FROM_NUMBER are absent (demo, tests) the stub reproduces the deterministic per-(number,
 * attempt) outcome the demo has always used, so demos and tests stay repeatable: the first attempt to
 * most numbers goes unanswered, the second is answered; numbers ending in 0000 never answer.
 *
 * Twilio's call-create response is immediate (queued/initiated) — the eventual outcome needs a short
 * poll of the call resource. Answering-machine detection (AMD) distinguishes voicemail from answered.
 */
export function createVoiceCaller(env: Record<string, string | undefined>): VoiceCallerPort {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  const twiml = env.TWILIO_CALL_TWIML_URL; // a TwiML bin/endpoint that reads the script and hangs up
  if (!accountSid || !authToken || !from) {
    return {
      available: false,
      async call({ to, attempt }) {
        const digits = to.replace(/\D/g, '');
        let outcome: Awaited<ReturnType<VoiceCallerPort['call']>>['outcome'];
        if (!digits) outcome = 'no_answer';
        else if (digits.endsWith('0000')) outcome = 'no_answer';
        else if (attempt >= 2) outcome = 'answered';
        else outcome = hashString(`${digits}|${attempt}`) % 5 === 0 ? 'answered' : hashString(digits) % 3 === 0 ? 'voicemail' : 'no_answer';
        return { outcome, durationSec: outcome === 'answered' ? 45 + (hashString(digits) % 90) : 0 };
      },
    };
  }
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;

  return {
    available: true,
    async call({ to, script }) {
      const createRes = await fetch(`${base}/Calls.json`, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          To: to, From: from,
          ...(twiml ? { Url: twiml } : { Twiml: `<Response><Say>${script.replace(/[<>&]/g, '')}</Say></Response>` }),
          MachineDetection: 'Enable',
        }),
      });
      if (!createRes.ok) throw new Error(`twilio_call_failed: ${createRes.status} ${await createRes.text().catch(() => '')}`);
      const created = (await createRes.json()) as { sid: string };

      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        const statusRes = await fetch(`${base}/Calls/${created.sid}.json`, { headers: { authorization: auth } });
        if (!statusRes.ok) continue;
        const call = (await statusRes.json()) as { status: string; duration?: string; answered_by?: string };
        if (['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(call.status)) {
          const durationSec = Number(call.duration ?? 0);
          if (call.answered_by?.startsWith('machine')) return { outcome: 'voicemail', durationSec, providerId: created.sid };
          if (call.status === 'completed') return { outcome: 'answered', durationSec, providerId: created.sid };
          if (call.status === 'busy') return { outcome: 'busy', durationSec: 0, providerId: created.sid };
          return { outcome: 'no_answer', durationSec: 0, providerId: created.sid };
        }
      }
      return { outcome: 'no_answer', durationSec: 0, providerId: created.sid };
    },
  };
}
