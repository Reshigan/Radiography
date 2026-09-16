import type { Db } from '@bonakala/db';

/** Object storage (R2 in the cloud, filesystem on Node). Keys are practice-scoped by convention. */
export interface ObjectStore {
  put(key: string, body: ArrayBuffer | Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<{ body: ArrayBuffer; contentType?: string } | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** Background work: a queue in the cloud, an in-process scheduler on Node. */
export interface JobQueue {
  enqueue(name: string, payload: Record<string, unknown>, opts?: { delaySeconds?: number }): Promise<void>;
}

export interface Clock {
  now(): Date;
}

/** LLM gateway: Claude API in production, deterministic stub when no key is configured. */
export interface LlmPort {
  readonly available: boolean;
  complete(input: { system: string; user: string; json?: boolean; maxTokens?: number }): Promise<string>;
}

export interface Services {
  db: Db;
  objects: ObjectStore;
  queue: JobQueue;
  clock: Clock;
  llm: LlmPort;
  demoMode: boolean;
  env: Record<string, string | undefined>;
  /** Defer work until after the response (waitUntil on Workers, setImmediate on Node). */
  defer(p: Promise<unknown>): void;
}
