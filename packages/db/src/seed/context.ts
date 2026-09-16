/** Shared handles produced by the core seeder for module seeders. */
export interface SeedContext {
  /** Practice A: Sandton + Randburg (wholly owned). */
  practiceA: string;
  /** Practice B: Umhlanga (51/49 JV) + Ballito. */
  practiceB: string;
  group: string;
  mso: string;
  hub: string;
  sites: Record<'SAN' | 'RBG' | 'UMH' | 'BAL', string>;
  rooms: Record<string, string>; // e.g. 'SAN-CT1'
  modalities: Record<string, string>; // e.g. 'SAN-CT1'
  users: Record<string, string>; // persona code (or persona+n) -> user id
  patients: string[]; // patient ids in practice A then B
  patientsByPractice: Record<string, string[]>;
  referrers: string[];
  now: string;
  /** Cross-cluster handles (orders, studies, reports, claims …) that earlier seeders publish for later ones. Always check for presence. */
  extra: Record<string, unknown>;
}
