/** Time-ordered, URL-safe ids (26 chars, Crockford base32), usable in Workers and Node. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newId(prefix?: string): string {
  const time = Date.now();
  let t = '';
  let n = time;
  for (let i = 0; i < 10; i++) {
    t = ALPHABET[n % 32] + t;
    n = Math.floor(n / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let r = '';
  for (let i = 0; i < 16; i++) r += ALPHABET[bytes[i]! % 32];
  const id = t + r;
  return prefix ? `${prefix}_${id}` : id;
}

/** Luhn check digit over digits (0-9). */
export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true; // start doubling from the rightmost digit of the payload
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhnValid(numberWithCheck: string): boolean {
  if (!/^\d{2,}$/.test(numberWithCheck)) return false;
  const payload = numberWithCheck.slice(0, -1);
  return luhnCheckDigit(payload) === Number(numberWithCheck.slice(-1));
}

/**
 * National accession number: <PREFIX 4 letters>-<YY>-<7-digit sequence>-<Luhn>
 * Letters are mapped to digits (A=10 … Z=35) for the check, IBAN style.
 */
export function formatAccession(prefix: string, year: number, sequence: number): string {
  const p = prefix.toUpperCase().padEnd(4, 'X').slice(0, 4);
  const yy = String(year % 100).padStart(2, '0');
  const seq = String(sequence).padStart(7, '0');
  const payload = (p + yy + seq).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return `${p}-${yy}-${seq}-${luhnCheckDigit(payload)}`;
}

export function accessionValid(acc: string): boolean {
  const m = /^([A-Z]{4})-(\d{2})-(\d{7})-(\d)$/.exec(acc);
  if (!m) return false;
  const payload = (m[1]! + m[2]! + m[3]!).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return luhnCheckDigit(payload) === Number(m[4]);
}
