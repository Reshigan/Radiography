import { luhnValid } from './ids.js';

export interface SaIdInfo {
  valid: boolean;
  dateOfBirth?: string; // ISO yyyy-mm-dd
  sex?: 'F' | 'M';
  citizen?: boolean;
  synthetic?: boolean;
}

/**
 * South African ID number: YYMMDD SSSS C A Z
 * SSSS 0000–4999 female, 5000–9999 male; C 0 citizen / 1 permanent resident; Z Luhn check digit.
 * Synthetic demo IDs use the A digit = 9 (real IDs use 8), so they can never collide with a real person.
 */
export function parseSaId(id: string, now = new Date()): SaIdInfo {
  if (!/^\d{13}$/.test(id)) return { valid: false };
  if (!luhnValid(id)) return { valid: false };
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { valid: false };
  const century = yy <= now.getFullYear() % 100 ? 2000 : 1900;
  const dob = new Date(Date.UTC(century + yy, mm - 1, dd));
  if (dob.getUTCMonth() !== mm - 1) return { valid: false };
  const seq = Number(id.slice(6, 10));
  return {
    valid: true,
    dateOfBirth: dob.toISOString().slice(0, 10),
    sex: seq < 5000 ? 'F' : 'M',
    citizen: id[10] === '0',
    synthetic: id[11] === '9',
  };
}

/** Build a synthetic (never-real) SA ID that passes the checksum. */
export function syntheticSaId(dob: string, sex: 'F' | 'M', seq: number): string {
  const [y, m, d] = dob.split('-');
  const base = `${y!.slice(2)}${m}${d}${String((sex === 'F' ? 0 : 5000) + (seq % 5000)).padStart(4, '0')}09`;
  let sum = 0;
  let dbl = true;
  for (let i = base.length - 1; i >= 0; i--) {
    let n = Number(base[i]);
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return base + String((10 - (sum % 10)) % 10);
}

export function maskId(id: string | null | undefined): string {
  if (!id) return '';
  return `····${id.slice(-4)}`;
}
