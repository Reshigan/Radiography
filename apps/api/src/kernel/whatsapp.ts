import type { WhatsAppSenderPort } from './ports.js';

/**
 * WhatsApp Business Cloud API gateway. When WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is
 * absent (demo, tests) the stub returns a fake provider id and sends nothing, matching createLlm's
 * key-gated pattern. Buttons become an interactive reply-button message; plain text otherwise.
 */
export function createWhatsAppSender(env: Record<string, string | undefined>): WhatsAppSenderPort {
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = env.WHATSAPP_API_VERSION ?? 'v20.0';
  if (!token || !phoneNumberId) {
    return {
      available: false,
      async send() {
        return { providerId: `stub-wa-${Date.now().toString(36)}` };
      },
    };
  }
  return {
    available: true,
    async send({ to, text, buttons }) {
      const body = buttons?.length
        ? {
            messaging_product: 'whatsapp', to, type: 'interactive',
            interactive: {
              type: 'button', body: { text },
              action: { buttons: buttons.slice(0, 3).map((b, i) => ({ type: 'reply', reply: { id: `btn_${i}`, title: b.slice(0, 20) } })) },
            },
          }
        : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
      const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`whatsapp_send_failed: ${res.status} ${await res.text().catch(() => '')}`);
      const json = (await res.json()) as { messages?: Array<{ id: string }> };
      return { providerId: json.messages?.[0]?.id ?? `wa-${Date.now().toString(36)}` };
    },
  };
}
