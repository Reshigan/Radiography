import { describe, expect, it } from 'vitest';
import { accessionValid, formatAccession, luhnValid, newId } from './ids.js';
import { parseSaId, syntheticSaId } from './sa-id.js';
import { addVat, formatZAR } from './money.js';

describe('ids', () => {
  it('generates unique sortable ids', () => {
    const a = newId('pat');
    const b = newId('pat');
    expect(a).not.toEqual(b);
    expect(a.startsWith('pat_')).toBe(true);
    expect(a.length).toBe(30);
  });
  it('luhn', () => {
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('79927398710')).toBe(false);
  });
  it('accession format and check', () => {
    const acc = formatAccession('BUMH', 2026, 1234);
    expect(acc).toMatch(/^BUMH-26-0001234-\d$/);
    expect(accessionValid(acc)).toBe(true);
    expect(accessionValid(acc.slice(0, -1) + ((Number(acc.slice(-1)) + 1) % 10))).toBe(false);
  });
});

describe('sa id', () => {
  it('synthetic ids validate and parse', () => {
    const id = syntheticSaId('1985-03-14', 'F', 42);
    const info = parseSaId(id, new Date('2026-09-16'));
    expect(info.valid).toBe(true);
    expect(info.dateOfBirth).toBe('1985-03-14');
    expect(info.sex).toBe('F');
    expect(info.synthetic).toBe(true);
  });
});

describe('money', () => {
  it('formats ZAR with space separators', () => {
    expect(formatZAR(318000)).toBe('R 3 180.00');
    expect(formatZAR(-124000)).toBe('-R 1 240.00');
    expect(addVat(390000)).toEqual({ vat: 58500, incl: 448500 });
  });
});
