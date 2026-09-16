/** Synthetic South African demo data. Names span language groups; nothing here is a real person. */
export const FIRST_NAMES_F = ['Nomvula', 'Thandeka', 'Priya', 'Anneke', 'Lerato', 'Zanele', 'Fatima', 'Kavitha', 'Lindiwe', 'Annelie', 'Nandi', 'Ayanda', 'Busisiwe', 'Sarah', 'Refilwe', 'Naledi', 'Chantal', 'Zinhle', 'Precious', 'Karabo'];
export const FIRST_NAMES_M = ['Thabo', 'Sipho', 'Pieter', 'Mandla', 'Riaan', 'Kabelo', 'Sizwe', 'Bongani', 'Andries', 'Prevan', 'Tshepo', 'Johan', 'Lwazi', 'Musa', 'Dumisani', 'Ismail', 'Werner', 'Themba', 'Lucky', 'Neo'];
export const LAST_NAMES = ['Dlamini', 'Naidoo', 'Van der Merwe', 'Khumalo', 'Mokoena', 'Botha', 'Sithole', 'Petersen', 'Zulu', 'Govender', 'Mthembu', 'Pillay', 'Mahlangu', 'Van Wyk', 'Ngcobo', 'Adams', 'Molefe', 'Jacobs', 'Nkosi', 'Le Roux', 'Ndlovu', 'Smit', 'Maseko', 'Hlophe', 'Modise'];
export const LANGUAGES = ['en', 'zu', 'xh', 'af', 'st', 'tn', 'nso', 'ts', 'ss', 've', 'nr'];
export const SCHEMES = [
  { id: 'scheme-a', name: 'Scheme A (demo)', options: ['Core', 'Plus', 'Executive'] },
  { id: 'scheme-b', name: 'Scheme B (demo)', options: ['Option Core', 'Option Plus'] },
  { id: 'scheme-c', name: 'Scheme C (demo)', options: ['Standard', 'Comprehensive'] },
];
export const SUBURBS_GP = ['Sandton', 'Randburg', 'Soweto', 'Alexandra', 'Roodepoort', 'Midrand', 'Fourways', 'Diepsloot'];
export const SUBURBS_KZN = ['Umhlanga', 'Durban North', 'Phoenix', 'Chatsworth', 'Ballito', 'Pinetown', 'KwaMashu', 'Verulam'];

/** Deterministic pseudo-random so seeds are reproducible. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)]!;
}
