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

/**
 * Funder claims switch: submits one claim for adjudication. Only the simulator (`apps/api/src/sim/switch.ts`)
 * implements this today — there is no real funder switch connection. The shape here is the port's own contract
 * (deliberately structural, not imported from the billing module) so a real adapter can be written and wired in
 * at the composition root (node.ts / worker.ts) without any change to billing's domain logic or types.
 */
export interface SwitchAdjudication {
  outcome: 'accepted' | 'rejected' | 'pended' | 'acknowledged';
  code?: string; message?: string; rule?: string; switchRef: string; channel: 'realtime' | 'batch';
  adjudicatedFunderCents?: number; patientLiabilityCents?: number;
}
export interface ClaimsSwitchPort {
  readonly available: boolean;
  submit(claim: {
    id: string; claimRef: string; funderId: string; funderType: string; lines: unknown; icd10: string[];
    fields: Record<string, unknown>; totalCents: number; expectedFunderCents: number; expectedPatientCents: number;
    memberNo: string | null; pmb: boolean;
  }): Promise<{ ack: SwitchAdjudication; adjudication: SwitchAdjudication | null }>;
}

/**
 * Payment service provider: turns a pending payment into a hosted link the patient can pay. Only the simulator
 * (`apps/api/src/sim/psp.ts`) implements this today — no real PSP (card/PayShap/QR) is connected. Same seam
 * pattern as ClaimsSwitchPort: swap the adapter at the composition root, nothing else changes.
 */
export interface PaymentGatewayPort {
  readonly available: boolean;
  createLink(input: { paymentId: string; token: string; amountCents: number; expiresAt: string }): Promise<{ url: string }>;
}

export interface Services {
  db: Db;
  objects: ObjectStore;
  queue: JobQueue;
  clock: Clock;
  llm: LlmPort;
  claimsSwitch: ClaimsSwitchPort;
  paymentGateway: PaymentGatewayPort;
  demoMode: boolean;
  env: Record<string, string | undefined>;
  /** Defer work until after the response (waitUntil on Workers, setImmediate on Node). */
  defer(p: Promise<unknown>): void;
}
