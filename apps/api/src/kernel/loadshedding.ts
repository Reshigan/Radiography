import type { LoadSheddingSchedulePort } from './ports.js';

/**
 * National load-shedding stage via the EskomSePush API. When ESP_API_KEY is absent (demo, tests) this
 * returns null so callers keep using the manually-published stage (`POST /sim/loadshedding/stage`).
 *
 * EskomSePush's `/status` endpoint gives the national Eskom stage; a per-site adapter would resolve
 * each site's municipal area via EskomSePush's area search and call `/area` instead — left as a
 * refinement once a site's GPS/suburb is on record, since the national stage is a reasonable default
 * for every site today.
 */
export function createLoadSheddingSchedule(env: Record<string, string | undefined>): LoadSheddingSchedulePort {
  const apiKey = env.ESP_API_KEY;
  if (!apiKey) {
    return { available: false, async currentStage() { return null; } };
  }
  return {
    available: true,
    async currentStage() {
      const res = await fetch('https://developer.sepush.co.za/business/2.0/status', { headers: { token: apiKey } });
      if (!res.ok) throw new Error(`esp_status_failed: ${res.status}`);
      const json = (await res.json()) as { status?: { eskom?: { stage?: string } } };
      const stage = Number(json.status?.eskom?.stage ?? 0);
      return { stage: Number.isFinite(stage) ? stage : 0 };
    },
  };
}
