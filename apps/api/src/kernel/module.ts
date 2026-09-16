import { Hono } from 'hono';
import type { AppEnv } from './context.js';
import type { Services } from './ports.js';

export interface ModuleDefinition {
  /** M01 … M21 */
  code: string;
  name: string;
  /** Mounted at /api/<basePath> */
  basePath: string;
  routes: Hono<AppEnv>;
  /** Register event handlers, Hands, queue jobs. Called once at boot. */
  boot?: (services: Services) => void | Promise<void>;
  /** Scheduled work (cron in the cloud, interval on Node). Returns a short summary. */
  tick?: (services: Services) => Promise<Record<string, number> | void>;
}

export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}
export function router(): Hono<AppEnv> {
  return new Hono<AppEnv>();
}
