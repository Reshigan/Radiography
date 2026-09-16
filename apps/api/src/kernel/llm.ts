import type { LlmPort } from './ports.js';

/**
 * Claude API gateway. When ANTHROPIC_API_KEY is absent (demo, tests) the stub returns deterministic
 * output so every Hand still runs end-to-end. PHI must be de-identified by callers (docs/15, 11 §E).
 */
export function createLlm(env: Record<string, string | undefined>): LlmPort {
  const apiKey = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_MODEL ?? 'claude-opus-5';
  if (!apiKey) {
    return {
      available: false,
      async complete({ user, json }) {
        return json ? JSON.stringify({ stub: true, echo: user.slice(0, 200) }) : `[stub] ${user.slice(0, 200)}`;
      },
    };
  }
  return {
    available: true,
    async complete({ system, user, json, maxTokens }) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens ?? 4000,
        system: json ? `${system}\nRespond with a single JSON object and nothing else.` : system,
        messages: [{ role: 'user', content: user }],
      } as any);
      if ((res as any).stop_reason === 'refusal') throw new Error('llm_refusal');
      const text = (res as any).content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      return text;
    },
  };
}
