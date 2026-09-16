import { eq } from 'drizzle-orm';
import { hashPassword, newId, syntheticSaId, luhnCheckDigit, type PERSONAS } from '@bonakala/domain';
import type { Db } from '../types.js';
import * as s from '../schema/index.js';
import type { SeedContext } from './context.js';
import { FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES, LANGUAGES, SCHEMES, SUBURBS_GP, SUBURBS_KZN, pick, rng } from './data.js';

export const DEMO_PASSWORD = 'bonakala-demo';

export async function seedCore(db: Db, summary: Record<string, number>): Promise<SeedContext> {
  const existing = await db.select({ id: s.legalEntities.id }).from(s.legalEntities).limit(1);
  const now = new Date().toISOString();
  const r = rng(7);

  const group = 'ent_group';
  const mso = 'ent_mso';
  const profHold = 'ent_profhold';
  const practiceA = 'prac_a';
  const practiceB = 'prac_b';
  const hub = 'ent_hub';

  if (existing.length === 0) {
    await db.insert(s.legalEntities).values([
      { id: group, type: 'holding', registeredName: 'Bonakala Holdings (Pty) Ltd', tradingName: 'Bonakala', cipcNo: '2026/000001/07', vatNo: '4000000001', financialYearEnd: '02-28' },
      { id: mso, type: 'mso', registeredName: 'Bonakala Platform (Pty) Ltd', tradingName: 'Bonakala Platform', cipcNo: '2026/000002/07', vatNo: '4000000002', financialYearEnd: '02-28' },
      { id: profHold, type: 'professional_holding', registeredName: 'Bonakala Professional Holdings Inc.', cipcNo: '2026/000003/21', financialYearEnd: '02-28' },
      { id: practiceA, type: 'practice', registeredName: 'Practice A Inc.', tradingName: 'Bonakala Imaging Sandton & Randburg', cipcNo: '2026/000010/21', vatNo: '4000000010', bhfPracticeNo: '0123456', accessionPrefix: 'BSAN', financialYearEnd: '02-28' },
      { id: practiceB, type: 'practice', registeredName: 'Practice B Inc.', tradingName: 'Bonakala Imaging Umhlanga', cipcNo: '2026/000011/21', vatNo: '4000000011', bhfPracticeNo: '0123457', accessionPrefix: 'BUMH', financialYearEnd: '02-28' },
      { id: hub, type: 'hub', registeredName: 'Bonakala Reading Hub Inc.', cipcNo: '2026/000020/21', financialYearEnd: '02-28' },
    ]);
    await db.insert(s.entityRelationships).values([
      { id: newId('rel'), parentId: group, childId: mso, type: 'subsidiary', effectiveFrom: '2026-01-01' },
      { id: newId('rel'), parentId: group, childId: profHold, type: 'subsidiary', effectiveFrom: '2026-01-01' },
      { id: newId('rel'), parentId: profHold, childId: practiceA, type: 'subsidiary', effectiveFrom: '2026-01-01' },
      { id: newId('rel'), parentId: profHold, childId: practiceB, type: 'jv', effectiveFrom: '2026-02-01' },
      { id: newId('rel'), parentId: mso, childId: practiceA, type: 'management_agreement', feeModel: { basis: 'pct_of_collections', rate: 0.08 }, effectiveFrom: '2026-01-01' },
      { id: newId('rel'), parentId: mso, childId: practiceB, type: 'management_agreement', feeModel: { basis: 'pct_of_collections', rate: 0.08 }, effectiveFrom: '2026-02-01' },
      { id: newId('rel'), parentId: hub, childId: practiceA, type: 'reading_services', feeModel: { basis: 'per_study', perStudyCents: 32000 }, effectiveFrom: '2026-01-01' },
      { id: newId('rel'), parentId: hub, childId: practiceB, type: 'reading_services', feeModel: { basis: 'per_study', perStudyCents: 32000 }, effectiveFrom: '2026-02-01' },
    ]);
    await db.insert(s.shareholdings).values([
      { id: newId('shr'), entityId: practiceA, shareholderEntityId: profHold, shareholderName: 'Bonakala Professional Holdings Inc.', shareClass: 'ordinary', shares: 1000, effectiveFrom: '2026-01-01' },
      { id: newId('shr'), entityId: practiceB, shareholderEntityId: profHold, shareholderName: 'Bonakala Professional Holdings Inc.', shareClass: 'A ordinary', shares: 510, effectiveFrom: '2026-02-01' },
      { id: newId('shr'), entityId: practiceB, shareholderName: 'Dr A. Pillay', shareClass: 'B ordinary', shares: 245, effectiveFrom: '2026-02-01' },
      { id: newId('shr'), entityId: practiceB, shareholderName: 'Dr S. Naidoo', shareClass: 'B ordinary', shares: 245, effectiveFrom: '2026-02-01' },
    ]);
  }

  // Sites, rooms, modalities
  const siteDefs = [
    { key: 'SAN', practice: practiceA, name: 'Sandton', province: 'Gauteng', address: '12 Rivonia Road, Sandton, 2196', lat: -26.1076, lng: 28.0567 },
    { key: 'RBG', practice: practiceA, name: 'Randburg', province: 'Gauteng', address: '45 Bram Fischer Drive, Randburg, 2194', lat: -26.0936, lng: 27.9975 },
    { key: 'UMH', practice: practiceB, name: 'Umhlanga', province: 'KwaZulu-Natal', address: '8 Lighthouse Road, Umhlanga, 4319', lat: -29.7278, lng: 31.0855 },
    { key: 'BAL', practice: practiceB, name: 'Ballito', province: 'KwaZulu-Natal', address: '3 Compensation Beach Road, Ballito, 4420', lat: -29.5389, lng: 31.2144 },
  ] as const;
  const sitesOut: Record<string, string> = {};
  const roomsOut: Record<string, string> = {};
  const modsOut: Record<string, string> = {};
  const roomDefs: Record<string, Array<[string, string, string]>> = {
    SAN: [['XR1', 'XR', 'DX'], ['XR2', 'XR', 'DX'], ['CT1', 'CT', 'CT'], ['MR1', 'MR', 'MR'], ['US1', 'US', 'US'], ['MG1', 'MG', 'MG']],
    RBG: [['XR1', 'XR', 'DX'], ['CT1', 'CT', 'CT'], ['US1', 'US', 'US']],
    UMH: [['XR1', 'XR', 'DX'], ['CT1', 'CT', 'CT'], ['CT2', 'CT', 'CT'], ['MR1', 'MR', 'MR'], ['MR2', 'MR', 'MR'], ['US1', 'US', 'US'], ['MG1', 'MG', 'MG'], ['DXA1', 'DXA', 'DXA']],
    BAL: [['XR1', 'XR', 'DX'], ['US1', 'US', 'US']],
  };
  const vendors: Record<string, [string, string]> = { DX: ['DemoVendor', 'DR-7'], CT: ['DemoVendor', 'CT-128'], MR: ['DemoVendor', 'MR-1.5T'], US: ['DemoVendor', 'US-Pro'], MG: ['DemoVendor', 'MG-Tomo'], DXA: ['DemoVendor', 'DXA-1'] };
  for (const sd of siteDefs) {
    const siteId = `site_${sd.key.toLowerCase()}`;
    sitesOut[sd.key] = siteId;
    const existsSite = await db.select({ id: s.sites.id }).from(s.sites).where(eq(s.sites.id, siteId)).limit(1);
    if (existsSite.length === 0) {
      await db.insert(s.sites).values({
        id: siteId, practiceId: sd.practice, code: sd.key, name: sd.name, address: sd.address, province: sd.province,
        lat: Math.round(sd.lat * 1e6), lng: Math.round(sd.lng * 1e6), phone: '0800 000 000',
        openingHours: { mon_fri: '07:00-18:00', sat: '08:00-13:00', sun: 'closed' },
      });
    }
    for (const [rname, rtype, mtype] of roomDefs[sd.key]!) {
      const roomId = `room_${sd.key.toLowerCase()}_${rname.toLowerCase()}`;
      const modId = `mod_${sd.key.toLowerCase()}_${rname.toLowerCase()}`;
      roomsOut[`${sd.key}-${rname}`] = roomId;
      modsOut[`${sd.key}-${rname}`] = modId;
      const ex = await db.select({ id: s.rooms.id }).from(s.rooms).where(eq(s.rooms.id, roomId)).limit(1);
      if (ex.length === 0) {
        const ionising = ['XR', 'CT', 'MG', 'RF', 'DXA'].includes(rtype);
        await db.insert(s.rooms).values({
          id: roomId, siteId, practiceId: sd.practice, name: rname, roomType: rtype,
          licenceNo: ionising ? `RC-${sd.key}-${rname}-2024` : null,
          licenceExpiry: ionising ? (rname === 'XR2' && sd.key === 'RBG' ? '2026-12-05' : '2027-11-30') : null,
        });
        const [vendor, model] = vendors[mtype]!;
        await db.insert(s.modalities).values({
          id: modId, roomId, siteId, practiceId: sd.practice, type: mtype, vendor, model,
          serial: `${mtype}${sd.key}${rname}-${String(Math.floor(r() * 9000) + 1000)}`, aeTitle: `${sd.key}_${rname}`,
          installDate: '2024-03-01', status: sd.key === 'UMH' && rname === 'CT2' ? 'down' : 'active',
          lastQaAt: '2026-08-30', nextQaDue: '2026-11-30', nextPmDue: '2026-10-12',
        });
      }
    }
  }

  // Users: one per persona per relevant practice + group personas
  const usersOut: Record<string, string> = {};
  const pw = await hashPassword(DEMO_PASSWORD);
  const userDefs: Array<{ key: string; persona: (typeof PERSONAS)[number]; practice: string | null; name: string; email: string; hpcsa?: string; sites?: string[] }> = [
    { key: 'FDK', persona: 'FDK', practice: practiceA, name: 'Busisiwe Ngcobo', email: 'fdk@demo.bonakala', sites: ['site_san'] },
    { key: 'BKG', persona: 'BKG', practice: practiceB, name: 'Thandeka Mthembu', email: 'bkg@demo.bonakala' },
    { key: 'RAD', persona: 'RAD', practice: practiceA, name: 'Sizwe Molefe', email: 'rad@demo.bonakala', hpcsa: 'DR 0012345', sites: ['site_san'] },
    { key: 'RGT', persona: 'RGT', practice: practiceB, name: 'Dr Nandi Dlamini', email: 'rgt@demo.bonakala', hpcsa: 'MP 0456789' },
    { key: 'RGT2', persona: 'RGT', practice: practiceA, name: 'Dr Werner Botha', email: 'rgt2@demo.bonakala', hpcsa: 'MP 0456790' },
    { key: 'NUR', persona: 'NUR', practice: practiceA, name: 'Sister Lerato Mokoena', email: 'nur@demo.bonakala', sites: ['site_san'] },
    { key: 'BIL', persona: 'BIL', practice: practiceB, name: 'Thandi Zulu', email: 'bil@demo.bonakala' },
    { key: 'DEB', persona: 'DEB', practice: practiceA, name: 'Sarah Adams', email: 'deb@demo.bonakala' },
    { key: 'PRM', persona: 'PRM', practice: practiceB, name: 'Lerato Mahlangu', email: 'prm@demo.bonakala', sites: ['site_umh'] },
    { key: 'EXE', persona: 'EXE', practice: null, name: 'Priya Reddy', email: 'exe@demo.bonakala' },
    { key: 'SHR', persona: 'SHR', practice: practiceB, name: 'Dr A. Pillay', email: 'shr@demo.bonakala', hpcsa: 'MP 0400001' },
    { key: 'CMP', persona: 'CMP', practice: null, name: 'Nomvula Mahlangu', email: 'cmp@demo.bonakala' },
    { key: 'BIO', persona: 'BIO', practice: null, name: 'Kabelo Mokoena', email: 'bio@demo.bonakala' },
    { key: 'AIO', persona: 'AIO', practice: null, name: 'Dr R. Adams', email: 'aio@demo.bonakala' },
    { key: 'SUP', persona: 'SUP', practice: null, name: 'Platform Support', email: 'sup@demo.bonakala' },
    { key: 'REF', persona: 'REF', practice: null, name: 'Dr S. Naidoo', email: 'ref@demo.bonakala', hpcsa: 'MP 0123456' },
    { key: 'PAT', persona: 'PAT', practice: practiceB, name: 'Nomvula Dlamini', email: 'pat@demo.bonakala' },
    { key: 'PAY', persona: 'PAY', practice: null, name: 'Scheme A claims desk', email: 'pay@demo.bonakala' },
  ];
  for (const u of userDefs) {
    const uid = `user_${u.key.toLowerCase()}`;
    usersOut[u.key] = uid;
    const ex = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, uid)).limit(1);
    if (ex.length === 0) {
      await db.insert(s.users).values({
        id: uid, practiceId: u.practice, persona: u.persona, email: u.email, name: u.name, hpcsaNo: u.hpcsa ?? null,
        hpcsaVerifiedAt: u.hpcsa ? now : null, passwordHash: pw, siteIds: u.sites ?? null, mfaEnabled: false,
      });
    }
  }

  // Referrers
  const referrerDefs = [
    { id: 'ref_naidoo', name: 'Dr S. Naidoo', hpcsa: 'MP 0123456', bhf: '0223344', discipline: 'GP', practiceName: 'Chatsworth Family Practice', phone: '082 000 4471' },
    { id: 'ref_pillay', name: 'Dr R. Pillay', hpcsa: 'MP 0123457', bhf: '0223345', discipline: 'GP', practiceName: 'Umhlanga Medical Centre', phone: '082 000 4472' },
    { id: 'ref_moodley', name: 'Dr T. Moodley', hpcsa: 'MP 0123458', bhf: '0223346', discipline: 'GP', practiceName: 'Randburg Medicross', phone: '082 000 4473' },
    { id: 'ref_vanwyk', name: 'Dr J. van Wyk', hpcsa: 'MP 0123459', bhf: '0223347', discipline: 'orthopaedics', practiceName: 'Sandton Orthopaedic Group', phone: '082 000 4474' },
    { id: 'ref_casualty', name: 'Casualty, Umhlanga Hospital (demo)', hpcsa: 'MP 0123460', bhf: '0223348', discipline: 'casualty', practiceName: 'Umhlanga Hospital (demo)', phone: '031 000 0000' },
    { id: 'ref_occ', name: 'Dr L. Ndlovu', hpcsa: 'MP 0123461', bhf: '0223349', discipline: 'occupational', practiceName: 'Mine Occupational Health (demo)', phone: '013 000 0000' },
    { id: 'ref_onc', name: 'Dr M. Sibanda', hpcsa: 'MP 0123462', bhf: '0223350', discipline: 'oncology', practiceName: 'Durban Oncology Centre (demo)', phone: '031 000 0001' },
  ];
  const referrersOut: string[] = [];
  for (const rd of referrerDefs) {
    referrersOut.push(rd.id);
    const ex = await db.select({ id: s.referrers.id }).from(s.referrers).where(eq(s.referrers.id, rd.id)).limit(1);
    if (ex.length === 0) {
      await db.insert(s.referrers).values({
        id: rd.id, practiceId: null, name: rd.name, hpcsaNo: rd.hpcsa, hpcsaVerifiedAt: now, bhfPracticeNo: rd.bhf, discipline: rd.discipline,
        practiceName: rd.practiceName, phone: rd.phone, email: `${rd.id}@demo.bonakala`,
        deliveryPrefs: { whatsapp: true, portal: true, fhir: false, phoneCritical: rd.phone },
      });
    }
  }
  await db.update(s.users).set({ referrerId: 'ref_naidoo' }).where(eq(s.users.id, usersOut['REF']!));

  // Patients: 60 per practice, deterministic
  const patientsOut: string[] = [];
  const byPractice: Record<string, string[]> = { [practiceA]: [], [practiceB]: [] };
  const existingPatients = await db.select({ id: s.patients.id, practiceId: s.patients.practiceId }).from(s.patients);
  if (existingPatients.length === 0) {
    let seq = 1;
    for (const practice of [practiceA, practiceB]) {
      for (let i = 0; i < 60; i++) {
        const sex = r() < 0.55 ? 'F' : 'M';
        const first = pick(r, sex === 'F' ? FIRST_NAMES_F : FIRST_NAMES_M);
        const last = pick(r, LAST_NAMES);
        const year = 1945 + Math.floor(r() * 75);
        const dob = `${year}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
        const scheme = r() < 0.7 ? pick(r, SCHEMES) : null;
        const epidBase = String(100000000000 + seq * 7919).slice(0, 11);
        const epid = epidBase + luhnCheckDigit(epidBase);
        const pid = i === 0 && practice === practiceB ? 'pat_nomvula' : newId('pat');
        const isNomvula = pid === 'pat_nomvula';
        await db.insert(s.patients).values({
          id: pid, practiceId: practice, epid,
          firstName: isNomvula ? 'Nomvula' : first, lastName: isNomvula ? 'Dlamini' : last,
          dateOfBirth: isNomvula ? '1985-03-14' : dob, sex: isNomvula ? 'F' : sex,
          language: isNomvula ? 'zu' : pick(r, LANGUAGES.slice(0, 5)),
          mobile: `08${Math.floor(r() * 3) + 1} ${String(Math.floor(r() * 900) + 100)} ${String(Math.floor(r() * 9000) + 1000)}`,
          idType: 'sa_id', idNumber: syntheticSaId(isNomvula ? '1985-03-14' : dob, isNomvula ? 'F' : sex, seq), idVerifiedAt: r() < 0.8 ? now : null,
          schemeId: isNomvula ? 'scheme-a' : scheme?.id ?? null, schemeName: isNomvula ? 'Scheme A (demo)' : scheme?.name ?? null,
          schemeOption: isNomvula ? 'Core' : scheme ? pick(r, scheme.options) : null,
          memberNo: scheme || isNomvula ? String(100000000 + Math.floor(r() * 899999999)) : null, dependantCode: '00',
          address: `${Math.floor(r() * 200) + 1} ${pick(r, practice === practiceA ? SUBURBS_GP : SUBURBS_KZN)}`,
          consents: { imaging: { granted: true, at: now }, popia: { granted: true, at: now, channel: 'whatsapp' }, reminders: { granted: r() < 0.9, at: now } },
          flags: r() < 0.08 ? ['contrast_reaction'] : [],
        });
        patientsOut.push(pid);
        byPractice[practice]!.push(pid);
        seq++;
      }
    }
    await db.update(s.users).set({ patientId: 'pat_nomvula' }).where(eq(s.users.id, usersOut['PAT']!));
  } else {
    for (const p of existingPatients) {
      patientsOut.push(p.id);
      (byPractice[p.practiceId] ??= []).push(p.id);
    }
  }

  // Feature flags and sequences
  const flags = await db.select().from(s.featureFlags).limit(1);
  if (flags.length === 0) {
    await db.insert(s.featureFlags).values([
      { key: 'demo_mode', value: true },
      { key: 'bci.mammography_overlays_default', value: 'off' },
      { key: 'results.patient_release_delay_hours', value: 2 },
    ]);
  }

  summary.legalEntities = 6;
  summary.sites = Object.keys(sitesOut).length;
  summary.rooms = Object.keys(roomsOut).length;
  summary.users = userDefs.length;
  summary.referrers = referrerDefs.length;
  summary.patients = patientsOut.length;

  return {
    practiceA, practiceB, group, mso, hub,
    sites: sitesOut as SeedContext['sites'], rooms: roomsOut, modalities: modsOut, users: usersOut,
    patients: patientsOut, patientsByPractice: byPractice, referrers: referrersOut, now, extra: {},
  };
}
