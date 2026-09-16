/** All money is integer cents in ZAR. */
export type Cents = number;
export const VAT_RATE = 0.15;

export function rand(cents: Cents): number {
  return cents / 100;
}
export function cents(rands: number): Cents {
  return Math.round(rands * 100);
}
export function addVat(exclCents: Cents, rate = VAT_RATE): { vat: Cents; incl: Cents } {
  const vat = Math.round(exclCents * rate);
  return { vat, incl: exclCents + vat };
}
/** "R 3 180.00" with a space thousands separator (South African convention). */
export function formatZAR(c: Cents, opts: { sign?: boolean } = {}): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const s = `R ${grouped}.${frac}`;
  if (neg) return `-${s}`;
  return opts.sign ? `+${s}` : s;
}
