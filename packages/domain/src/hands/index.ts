/**
 * Hands: autonomous agents with a mandate, a leash and allow-listed tools (docs/11 Part D, docs/12).
 * The runtime (apps/api/src/kernel/hands.ts) enforces tools and leashes outside the prompt.
 */
export type RiskClass = 'R0' | 'R1' | 'R2' | 'R3'; // R0 read, R1 internal write, R2 external message/money within leash, R3 needs approval. R4 (sign/publish clinical) is never available.
export type HandLevel = 'A1' | 'A2' | 'A3';
export type ApprovalPersona = 'FDK' | 'BKG' | 'RAD' | 'RGT' | 'NUR' | 'BIL' | 'DEB' | 'PRM' | 'EXE' | 'CMP' | 'BIO' | 'AIO' | 'SUP';

export interface LeashSpec {
  /** Named numeric limits, e.g. { maxAmountCents: 1500000, maxMessagesPerPatient: 8 } */
  [key: string]: number | string | boolean;
}

export interface HandDefinition {
  id: string; // 'referral' | 'booking' | ...
  name: string; // 'Referral Hand'
  module: string; // 'M04'
  mandate: string;
  level: HandLevel;
  defaultLeash: LeashSpec;
  approvalPersona: ApprovalPersona;
  approvalPolicy: string;
  /** Tools this Hand may call, with their risk class. Calls outside this list are refused by the runtime. */
  tools: Record<string, RiskClass>;
}

export function defineHand(def: HandDefinition): HandDefinition {
  if (Object.values(def.tools).some((r) => (r as string) === 'R4')) throw new Error(`${def.id}: R4 tools are never available to a Hand`);
  return def;
}

/** Outcome of a leash check. */
export interface LeashCheck { rule: string; limit: unknown; actual: unknown; ok: boolean }

export function checkLeash(leash: LeashSpec, checks: Array<{ rule: string; actual: number | boolean | string; compare?: 'lte' | 'gte' | 'eq' }>): LeashCheck[] {
  return checks.map(({ rule, actual, compare = 'lte' }) => {
    const limit = leash[rule];
    if (limit === undefined) return { rule, limit: undefined, actual, ok: true };
    let ok = true;
    if (typeof limit === 'number' && typeof actual === 'number') ok = compare === 'lte' ? actual <= limit : compare === 'gte' ? actual >= limit : actual === limit;
    else ok = actual === limit;
    return { rule, limit, actual, ok };
  });
}

/** Thrown by a Hand when it must stop and ask a human. */
export class NeedsApproval extends Error {
  constructor(public reason: string, public checks: LeashCheck[] = []) {
    super(reason);
    this.name = 'NeedsApproval';
  }
}
/** Thrown when the Hand refuses on policy (never a slip: e.g. asked to state a finding). */
export class Refused extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = 'Refused';
  }
}
