import type { InProcessQueue } from './kernel/adapters-node.js';
import type { Services } from './kernel/ports.js';

/** Job handlers by name; modules register via registerJob(). */
const jobs = new Map<string, (payload: Record<string, unknown>, services: Services) => Promise<void>>();
export function registerJob(name: string, handler: (payload: Record<string, unknown>, services: Services) => Promise<void>) {
  jobs.set(name, handler);
}
export function registerJobs(queue: InProcessQueue, services: Services) {
  for (const [name, h] of jobs) queue.on(name, (p) => h(p, services));
  // late registrations
  const orig = jobs.set.bind(jobs);
  jobs.set = (name, h) => {
    queue.on(name, (p) => h(p, services));
    return orig(name, h);
  };
}
export async function runJob(name: string, payload: Record<string, unknown>, services: Services) {
  const h = jobs.get(name);
  if (!h) throw new Error(`unknown job ${name}`);
  await h(payload, services);
}
