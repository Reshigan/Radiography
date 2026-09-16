import { eq } from 'drizzle-orm';
import { newId, todaySast } from '@bonakala/domain';
import { METRICS } from '@bonakala/domain/analytics';
import type { Db } from '../types.js';
import * as s from '../schema/index.js';
import type { SeedContext } from './context.js';
import { rng } from './data.js';

/* ---------- helpers ---------- */
const DAY = 86400000;
function addDays(date: string, n: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoAt(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}
function hoursBetween(a: string, b: string): number {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (bh! * 60 + bm! - ah! * 60 - am!) / 60;
}

/**
 * Cluster D seeder: analytics snapshots and scenarios (M16), staff, roster, credentials and CPD (M17),
 * assets, telemetry, work orders, consumables, gateways, integrations and vendor access (M18),
 * and the statutory register, incidents, complaints, POPIA requests, audits, policies,
 * reportable results and evidence packs (M19). Idempotent: every block checks before inserting.
 */
export async function seedClusterD(db: Db, ctx: SeedContext): Promise<Record<string, number> | void> {
  const r = rng(419);
  const today = todaySast();
  const now = new Date().toISOString();
  const summary: Record<string, number> = {};
  const practices = [ctx.practiceA, ctx.practiceB];
  const siteOf: Record<string, { practice: string; code: string }> = {
    [ctx.sites.SAN]: { practice: ctx.practiceA, code: 'SAN' },
    [ctx.sites.RBG]: { practice: ctx.practiceA, code: 'RBG' },
    [ctx.sites.UMH]: { practice: ctx.practiceB, code: 'UMH' },
    [ctx.sites.BAL]: { practice: ctx.practiceB, code: 'BAL' },
  };

  /* ================= M17 Workforce ================= */
  const staffIds: Record<string, string> = {};
  if ((await db.select({ id: s.staff.id }).from(s.staff).limit(1)).length === 0) {
    const defs: Array<{ key: string; name: string; role: string; site: string; comp: string[]; hpcsaYears?: number; hpcsaExpiry?: string; rad?: boolean; type?: string; userKey?: string }> = [
      // Sandton
      { key: 'SAN-RAD1', name: 'Sizwe Molefe', role: 'RAD', site: ctx.sites.SAN, comp: ['DX', 'CT', 'MG', 'mammography'], rad: true, userKey: 'RAD' },
      { key: 'SAN-RAD2', name: 'Annelie Smit', role: 'RAD', site: ctx.sites.SAN, comp: ['DX', 'CT', 'mri_safety_level2'], rad: true },
      { key: 'SAN-RAD3', name: 'Thembi Ndlovu', role: 'RAD', site: ctx.sites.SAN, comp: ['DX', 'MG', 'mammography'], rad: true, hpcsaExpiry: addDays(today, 18) },
      { key: 'SAN-RAD4', name: 'Johan le Roux', role: 'RAD', site: ctx.sites.SAN, comp: ['DX', 'CT'], rad: true },
      { key: 'SAN-SON1', name: 'Kavitha Pillay', role: 'RAD', site: ctx.sites.SAN, comp: ['US', 'sonography:obstetric', 'sonography:vascular'] },
      { key: 'SAN-NUR1', name: 'Sister Lerato Mokoena', role: 'NUR', site: ctx.sites.SAN, comp: ['contrast', 'iv_cannulation'], userKey: 'NUR' },
      { key: 'SAN-FDK1', name: 'Busisiwe Ngcobo', role: 'FDK', site: ctx.sites.SAN, comp: [], userKey: 'FDK' },
      { key: 'SAN-FDK2', name: 'Chantal Jacobs', role: 'FDK', site: ctx.sites.SAN, comp: [] },
      // Randburg
      { key: 'RBG-RAD1', name: 'Mandla Khumalo', role: 'RAD', site: ctx.sites.RBG, comp: ['DX', 'CT'], rad: true },
      { key: 'RBG-RAD2', name: 'Refilwe Molefe', role: 'RAD', site: ctx.sites.RBG, comp: ['DX', 'CT', 'mammography'], rad: true },
      { key: 'RBG-SON1', name: 'Priya Naidoo', role: 'RAD', site: ctx.sites.RBG, comp: ['US', 'sonography:musculoskeletal'] },
      { key: 'RBG-NUR1', name: 'Sister Zanele Zulu', role: 'NUR', site: ctx.sites.RBG, comp: ['contrast', 'iv_cannulation'] },
      { key: 'RBG-FDK1', name: 'Naledi Mahlangu', role: 'FDK', site: ctx.sites.RBG, comp: [] },
      // Umhlanga
      { key: 'UMH-RAD1', name: 'Bongani Sithole', role: 'RAD', site: ctx.sites.UMH, comp: ['DX', 'CT', 'mri_safety_officer', 'mri_safety_level2'], rad: true },
      { key: 'UMH-RAD2', name: 'Zinhle Mthembu', role: 'RAD', site: ctx.sites.UMH, comp: ['DX', 'CT', 'MG', 'mammography'], rad: true },
      { key: 'UMH-RAD3', name: 'Werner Botha', role: 'RAD', site: ctx.sites.UMH, comp: ['CT', 'MR', 'mri_safety_level2'], rad: true },
      { key: 'UMH-RAD4', name: 'Nandi Govender', role: 'RAD', site: ctx.sites.UMH, comp: ['DX', 'DXA'], rad: true },
      { key: 'UMH-RAD5', name: 'Lucky Maseko', role: 'RAD', site: ctx.sites.UMH, comp: ['DX', 'CT'], rad: true, type: 'part_time' },
      { key: 'UMH-SON1', name: 'Ayanda Hlophe', role: 'RAD', site: ctx.sites.UMH, comp: ['US', 'sonography:obstetric'] },
      { key: 'UMH-SON2', name: 'Fatima Adams', role: 'RAD', site: ctx.sites.UMH, comp: ['US', 'sonography:vascular', 'sonography:musculoskeletal'] },
      { key: 'UMH-NUR1', name: 'Sister Precious Dlamini', role: 'NUR', site: ctx.sites.UMH, comp: ['contrast', 'iv_cannulation'] },
      { key: 'UMH-NUR2', name: 'Sister Karabo Modise', role: 'NUR', site: ctx.sites.UMH, comp: ['contrast'] },
      { key: 'UMH-FDK1', name: 'Thandeka Mthembu', role: 'FDK', site: ctx.sites.UMH, comp: [], userKey: 'BKG' },
      { key: 'UMH-PRM1', name: 'Lerato Mahlangu', role: 'PRM', site: ctx.sites.UMH, comp: [], userKey: 'PRM' },
      { key: 'UMH-BIL1', name: 'Thandi Zulu', role: 'BIL', site: ctx.sites.UMH, comp: [], userKey: 'BIL' },
      // Ballito
      { key: 'BAL-RAD1', name: 'Dumisani Zulu', role: 'RAD', site: ctx.sites.BAL, comp: ['DX'], rad: true },
      { key: 'BAL-SON1', name: 'Lindiwe Ngcobo', role: 'RAD', site: ctx.sites.BAL, comp: ['US', 'sonography:obstetric'] },
      { key: 'BAL-FDK1', name: 'Sarah Petersen', role: 'FDK', site: ctx.sites.BAL, comp: [] },
    ];
    for (const d of defs) {
      const id = newId('stf');
      staffIds[d.key] = id;
      const practiceId = siteOf[d.site]!.practice;
      await db.insert(s.staff).values({
        id, practiceId, userId: d.userKey ? ctx.users[d.userKey] ?? null : null, name: d.name, role: d.role,
        employmentType: d.type ?? 'permanent', homeSiteId: d.site, siteIds: [d.site], competencies: d.comp,
        hpcsaNo: ['RAD', 'RGT'].includes(d.role) ? `DR ${String(10000 + Math.floor(r() * 89999))}` : null,
        hpcsaExpiry: ['RAD', 'RGT'].includes(d.role) ? d.hpcsaExpiry ?? addDays(today, 120 + Math.floor(r() * 200)) : null,
        radiationWorker: !!d.rad, dosimetryBadge: d.rad ? `BDG-${d.key}` : null,
        contractHoursPerWeek: d.type === 'part_time' ? 22.5 : 45, ftePct: d.type === 'part_time' ? 50 : 100,
        hourlyCostCents: d.role === 'RAD' ? 32000 : d.role === 'NUR' ? 28000 : d.role === 'PRM' ? 48000 : 19000,
        startDate: '2024-06-01',
      });
    }
    summary.staff = defs.length;

    // Credentials: HPCSA for clinical staff, radiation worker, plus competency credentials with expiries.
    let credCount = 0;
    const staffRows = await db.select().from(s.staff);
    for (const st of staffRows) {
      if (st.hpcsaNo) {
        await db.insert(s.credentials).values({ id: newId('crd'), practiceId: st.practiceId, staffId: st.id, type: 'hpcsa', number: st.hpcsaNo, issuer: 'HPCSA', issuedAt: '2024-04-01', expiry: st.hpcsaExpiry, verified: true, verifiedAt: now, verifiedBy: ctx.users['CMP'] ?? null });
        credCount++;
      }
      if (st.role === 'NUR') {
        await db.insert(s.credentials).values({ id: newId('crd'), practiceId: st.practiceId, staffId: st.id, type: 'sanc', number: `SANC ${String(200000 + Math.floor(r() * 99999))}`, issuer: 'South African Nursing Council', expiry: addDays(today, 90 + Math.floor(r() * 200)), verified: true, verifiedAt: now });
        credCount++;
      }
      if (st.radiationWorker) {
        await db.insert(s.credentials).values({ id: newId('crd'), practiceId: st.practiceId, staffId: st.id, type: 'radiation_worker', number: st.dosimetryBadge, issuer: 'Approved dosimetry service (demo)', expiry: addDays(today, 60 + Math.floor(r() * 120)), verified: true, verifiedAt: now });
        credCount++;
      }
      if ((st.competencies ?? []).includes('mammography')) {
        await db.insert(s.credentials).values({ id: newId('crd'), practiceId: st.practiceId, staffId: st.id, type: 'mammography', issuer: 'Practice competency assessment', expiry: addDays(today, st.name === 'Thembi Ndlovu' ? -6 : 180 + Math.floor(r() * 200)), verified: st.name !== 'Thembi Ndlovu', verifiedAt: st.name === 'Thembi Ndlovu' ? null : now });
        credCount++;
      }
      if ((st.competencies ?? []).some((x) => x.startsWith('mri_safety'))) {
        await db.insert(s.credentials).values({ id: newId('crd'), practiceId: st.practiceId, staffId: st.id, type: 'mri_safety', issuer: 'MR safety programme (level 2)', expiry: addDays(today, 200 + Math.floor(r() * 150)), verified: true, verifiedAt: now });
        credCount++;
      }
      if (['RAD', 'NUR'].includes(st.role)) {
        await db.insert(s.credentials).values({ id: newId('crd'), practiceId: st.practiceId, staffId: st.id, type: 'bls', issuer: 'Resuscitation Council of Southern Africa (demo)', expiry: addDays(today, 24 + Math.floor(r() * 300)), verified: true, verifiedAt: now });
        credCount++;
      }
    }
    summary.credentials = credCount;

    // CPD: this cycle, most on pace, a few behind.
    let cpdCount = 0;
    const cycleYear = new Date().getFullYear();
    const activities = ['Discrepancy meeting', 'Radiation protection refresher', 'Vendor applications training', 'Ethics, human rights and medical law', 'Contrast reaction management', 'MRI safety update'];
    for (const st of staffRows.filter((x) => ['RAD', 'NUR'].includes(x.role))) {
      const entries = 2 + Math.floor(r() * 4);
      for (let i = 0; i < entries; i++) {
        const isEthics = i === 1;
        await db.insert(s.cpdPoints).values({
          id: newId('cpd'), practiceId: st.practiceId, staffId: st.id, cycleYear,
          activity: isEthics ? 'Ethics, human rights and medical law' : activities[Math.floor(r() * activities.length)]!,
          points: 3 + Math.floor(r() * 6), ethicsPoints: isEthics ? 5 : 0,
          certificateRef: `cpd_${st.id.slice(-6)}_${i}`, at: new Date(Date.now() - (30 + i * 45) * DAY).toISOString(),
        });
        cpdCount++;
      }
    }
    summary.cpdEntries = cpdCount;

    // Four-week roster from templates, with gaps and one agency swap pending.
    const templates: Array<{ site: string; role: string; start: string; end: string; competency?: string; days: number[] }> = [
      { site: ctx.sites.SAN, role: 'RAD', start: '07:00', end: '16:00', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.SAN, role: 'RAD', start: '10:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.SAN, role: 'RAD', start: '08:00', end: '13:00', competency: 'mammography', days: [1, 3, 5] },
      { site: ctx.sites.SAN, role: 'NUR', start: '07:30', end: '16:30', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.SAN, role: 'FDK', start: '07:00', end: '16:00', days: [1, 2, 3, 4, 5, 6] },
      { site: ctx.sites.RBG, role: 'RAD', start: '07:30', end: '16:30', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.RBG, role: 'NUR', start: '08:00', end: '16:00', days: [1, 2, 3, 4] },
      { site: ctx.sites.RBG, role: 'FDK', start: '07:30', end: '16:30', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.UMH, role: 'RAD', start: '07:00', end: '16:00', days: [1, 2, 3, 4, 5, 6] },
      { site: ctx.sites.UMH, role: 'RAD', start: '10:00', end: '19:00', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.UMH, role: 'RAD', start: '08:00', end: '13:00', competency: 'mammography', days: [2, 4] },
      { site: ctx.sites.UMH, role: 'RAD', start: '08:00', end: '17:00', competency: 'mri_safety_level2', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.UMH, role: 'NUR', start: '07:30', end: '16:30', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.UMH, role: 'FDK', start: '07:00', end: '16:00', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.BAL, role: 'RAD', start: '08:00', end: '16:00', days: [1, 2, 3, 4, 5] },
      { site: ctx.sites.BAL, role: 'FDK', start: '08:00', end: '16:00', days: [1, 2, 3, 4, 5] },
    ];
    const staffBySiteRole = new Map<string, string[]>();
    for (const st of staffRows) {
      const key = `${st.homeSiteId}:${st.role}`;
      staffBySiteRole.set(key, [...(staffBySiteRole.get(key) ?? []), st.id]);
    }
    const compOf = new Map(staffRows.map((x) => [x.id, x.competencies ?? []]));
    const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    let shiftCount = 0;
    let gapCount = 0;
    let rota = 0;
    for (let w = 0; w < 4; w++) {
      for (let d = 0; d < 7; d++) {
        const date = addDays(monday, w * 7 + d);
        const dow = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
        for (const t of templates) {
          if (!t.days.includes(dow)) continue;
          const pool = (staffBySiteRole.get(`${t.site}:${t.role}`) ?? []).filter((id) => !t.competency || (compOf.get(id) ?? []).includes(t.competency));
          const practiceId = siteOf[t.site]!.practice;
          const hours = hoursBetween(t.start, t.end);
          const id = newId('shf');
          rota++;
          // Deliberate demo states: a mammography gap today at Umhlanga, an agency shift pending, some future gaps.
          const isTodayMammoGap = date === today && t.competency === 'mammography' && t.site === ctx.sites.UMH;
          const isAgencyPending = date === addDays(today, 1) && t.competency === 'mammography' && t.site === ctx.sites.SAN;
          const randomGap = !isTodayMammoGap && !isAgencyPending && pool.length === 0;
          if (isTodayMammoGap || randomGap || (w > 0 && rota % 37 === 0)) {
            await db.insert(s.shifts).values({ id, practiceId, siteId: t.site, date, startTime: t.start, endTime: t.end, hours, role: t.role, requiredCompetency: t.competency ?? null, staffId: null, status: 'open_gap', gapReason: isTodayMammoGap ? 'sick' : 'unfilled', note: isTodayMammoGap ? 'Mammography radiographer called in sick; 17 patients booked' : null });
            gapCount++;
          } else if (isAgencyPending) {
            await db.insert(s.shifts).values({ id, practiceId, siteId: t.site, date, startTime: t.start, endTime: t.end, hours, role: t.role, requiredCompetency: t.competency ?? null, staffId: null, status: 'agency', filledBy: 'roster_hand', agencyName: 'Imaging Locums SA (demo)', agencyCents: 39000 * Math.round(hours), gapReason: 'sick', note: 'Agency mammographer from the approved panel, available 08:30; HPCSA verified; booking held pending PRM approval' });
          } else {
            const staffId = pool[rota % Math.max(1, pool.length)] ?? null;
            await db.insert(s.shifts).values({ id, practiceId, siteId: t.site, date, startTime: t.start, endTime: t.end, hours, role: t.role, requiredCompetency: t.competency ?? null, staffId, status: w === 0 ? 'confirmed' : 'planned', filledBy: 'prm' });
          }
          shiftCount++;
        }
      }
    }
    summary.shifts = shiftCount;
    summary.rosterGaps = gapCount;

    // Leave: a few approved and pending requests.
    const leaveDefs = [
      { key: 'SAN-RAD4', type: 'annual', from: addDays(today, 10), to: addDays(today, 17), status: 'approved' },
      { key: 'UMH-RAD5', type: 'sick', from: today, to: addDays(today, 1), status: 'approved' },
      { key: 'RBG-RAD2', type: 'study', from: addDays(today, 21), to: addDays(today, 22), status: 'requested' },
      { key: 'UMH-NUR2', type: 'family', from: addDays(today, 3), to: addDays(today, 3), status: 'requested' },
    ];
    for (const l of leaveDefs) {
      const staffId = staffIds[l.key];
      if (!staffId) continue;
      const days = Math.max(1, Math.round((new Date(l.to).getTime() - new Date(l.from).getTime()) / DAY) + 1);
      await db.insert(s.leave).values({ id: newId('lve'), practiceId: staffRows.find((x) => x.id === staffId)!.practiceId, staffId, type: l.type, fromDate: l.from, toDate: l.to, days, status: l.status, decidedBy: l.status === 'approved' ? ctx.users['PRM'] ?? null : null, decidedAt: l.status === 'approved' ? now : null });
    }
    summary.leave = leaveDefs.length;

    // Time and attendance for the trailing four weeks on confirmed shifts.
    let attCount = 0;
    const pastShifts = await db.select().from(s.shifts).where(eq(s.shifts.status, 'confirmed'));
    for (const sh of pastShifts) {
      if (sh.date > today || !sh.staffId) continue;
      const jitter = Math.round((r() - 0.5) * 20);
      const worked = Math.round((sh.hours + (r() < 0.2 ? 1 : 0)) * 10) / 10;
      await db.insert(s.timeAttendance).values({
        id: newId('att'), practiceId: sh.practiceId, staffId: sh.staffId, shiftId: sh.id, siteId: sh.siteId,
        clockIn: new Date(new Date(isoAt(sh.date, sh.startTime)).getTime() + jitter * 60000).toISOString(),
        clockOut: new Date(new Date(isoAt(sh.date, sh.startTime)).getTime() + worked * 3600000).toISOString(),
        method: 'app', hoursWorked: worked, overtimeHours: worked > 9 ? Math.round((worked - 9) * 10) / 10 : 0,
      });
      attCount++;
    }
    summary.attendance = attCount;
  }

  /* ================= M18 Assets & Engineering ================= */
  if ((await db.select({ id: s.assets.id }).from(s.assets).limit(1)).length === 0) {
    const modalities = await db.select().from(s.modalities);
    const rooms = await db.select().from(s.rooms);
    const vendorContacts: Record<string, { name: string; phone: string; email: string; portal: string }> = {
      CT: { name: 'DemoVendor CT service desk', phone: '0800 111 222', email: 'ct.service@demovendor.example', portal: 'https://service.demovendor.example' },
      MR: { name: 'DemoVendor MR service desk', phone: '0800 111 333', email: 'mr.service@demovendor.example', portal: 'https://service.demovendor.example' },
      DX: { name: 'DemoVendor DR support', phone: '0800 111 444', email: 'dr.support@demovendor.example', portal: 'https://service.demovendor.example' },
    };
    let assetCount = 0;
    for (const m of modalities) {
      const room = rooms.find((x) => x.id === m.roomId);
      const code = siteOf[m.siteId]?.code ?? '??';
      const label = `${m.type} ${room?.name ?? ''}`.trim();
      const isDown = m.status === 'down';
      await db.insert(s.assets).values({
        id: m.id, practiceId: m.practiceId, siteId: m.siteId, roomId: m.roomId, modalityId: m.id,
        name: `${label} · ${code}`, kind: 'modality', type: m.type, vendor: m.vendor, model: m.model, serial: m.serial,
        assetTag: `AST-${code}-${room?.name ?? ''}`,
        status: isDown ? 'down' : 'in_service',
        serviceContract: { vendor: m.vendor ?? 'DemoVendor', coverage: m.type === 'CT' ? ['parts', 'labour', 'tube'] : m.type === 'MR' ? ['parts', 'labour', 'coils', 'helium'] : ['parts', 'labour'], responseHours: m.type === 'CT' || m.type === 'MR' ? 4 : 8, uptimeSlaPct: 98, expires: addDays(today, 120 + Math.floor(r() * 400)), annualCents: m.type === 'CT' ? 180_000_00 : m.type === 'MR' ? 240_000_00 : 45_000_00, ref: `SC-${code}-${m.type}` },
        vendorContact: vendorContacts[m.type] ?? vendorContacts.DX,
        pmSchedule: { intervalDays: 90, lastPm: addDays(today, -60), nextPm: m.nextPmDue ?? addDays(today, 30), tolerance: 14 },
        predictiveSignal: { signal: 'No predictive signal', riskPct: 2, confidence: 0.72, modelId: 'BCI-PRED-EQUIP', modelVersion: '0.9.4', at: now, level: 'none' },
        uptime30dPct: isDown ? 91 : Math.round((96 + r() * 3.9) * 10) / 10,
        licenceRef: room?.licenceNo ?? null, downtimeStartedAt: isDown ? isoAt(today, '08:40') : null,
      });
      assetCount++;
    }
    // Non-modality assets: UPS and generators per site.
    for (const [siteId, meta] of Object.entries(siteOf)) {
      await db.insert(s.assets).values({ id: newId('ast'), practiceId: meta.practice, siteId, name: `UPS · ${meta.code}`, kind: 'ups', type: 'UPS', vendor: 'DemoPower', model: 'UPS-20kVA', status: 'in_service', uptime30dPct: 100, pmSchedule: { intervalDays: 180, lastPm: addDays(today, -90), nextPm: addDays(today, 90) } });
      if (meta.code !== 'BAL') await db.insert(s.assets).values({ id: newId('ast'), practiceId: meta.practice, siteId, name: `Generator · ${meta.code}`, kind: 'generator', type: 'GEN', vendor: 'DemoPower', model: 'GEN-100kVA', status: 'in_service', uptime30dPct: 100, pmSchedule: { intervalDays: 90, lastPm: addDays(today, -20), nextPm: addDays(today, 70) } });
      assetCount += meta.code === 'BAL' ? 1 : 2;
    }
    summary.assets = assetCount;

    // Telemetry: heartbeats everywhere, a rising tube arc trend on Umhlanga CT 2, helium on MR.
    let telCount = 0;
    const assetRows = await db.select().from(s.assets);
    for (const a of assetRows.filter((x) => x.kind === 'modality')) {
      for (let h = 0; h < 12; h++) {
        await db.insert(s.telemetry).values({ id: newId('tel'), practiceId: a.practiceId, siteId: a.siteId, assetId: a.id, metric: 'heartbeat', value: 1, unit: 's', source: 'edge', at: new Date(Date.now() - h * 3600000).toISOString() });
        telCount++;
      }
      if (a.type === 'MR') {
        for (let d = 0; d < 14; d++) {
          await db.insert(s.telemetry).values({ id: newId('tel'), practiceId: a.practiceId, siteId: a.siteId, assetId: a.id, metric: 'helium_pct', value: Math.round(70 - d * 0.15), unit: '%', source: 'vendor_log', at: new Date(Date.now() - d * DAY).toISOString() });
          telCount++;
        }
      }
      if (a.type === 'CT') {
        const umhCt2 = a.siteId === ctx.sites.UMH && a.name.includes('CT2');
        for (let d = 0; d < 7; d++) {
          const arcs = umhCt2 ? Math.max(0, Math.round(1 + d * 0.9 + r())) : Math.round(r() * 1.2);
          if (arcs > 0) {
            await db.insert(s.telemetry).values({ id: newId('tel'), practiceId: a.practiceId, siteId: a.siteId, assetId: a.id, metric: 'tube_arc_count', value: arcs, unit: 'events', source: 'vendor_log', at: new Date(Date.now() - d * DAY).toISOString() });
            telCount++;
          }
        }
        if (umhCt2) {
          await db.update(s.assets).set({ predictiveSignal: { signal: 'Tube arc events 14 in 7 d vs 2 baseline; cooling cycle up', riskPct: 22, confidence: 0.72, modelId: 'BCI-PRED-EQUIP', modelVersion: '0.9.4', at: now, level: 'crit' }, uptime30dPct: 91 }).where(eq(s.assets.id, a.id));
        }
      }
    }
    summary.telemetry = telCount;

    // Work orders across the kanban.
    const ctUmh2 = assetRows.find((a) => a.siteId === ctx.sites.UMH && a.name.includes('CT2'));
    const mrUmh1 = assetRows.find((a) => a.siteId === ctx.sites.UMH && a.type === 'MR');
    const drRbg = assetRows.find((a) => a.siteId === ctx.sites.RBG && a.type === 'DX');
    const mgSan = assetRows.find((a) => a.siteId === ctx.sites.SAN && a.type === 'MG');
    const usBal = assetRows.find((a) => a.siteId === ctx.sites.BAL && a.type === 'US');
    const woDefs = [
      { asset: ctUmh2, type: 'breakdown', priority: 'critical', status: 'in_progress', title: 'CT 2 down · tube arc fault', symptoms: 'Arc events on exposure; scanner halts mid-series. Predictive signal: tube arc events 14 in 7 d vs 2 baseline.', vendorTicket: 'VT-20931', slaHours: 4, downStart: isoAt(today, '08:40'), poCents: 4_800_000 },
      { asset: mrUmh1, type: 'pm', priority: 'normal', status: 'scheduled', title: 'Quarterly preventive maintenance · MRI 1', symptoms: null, vendorTicket: 'VT-20918', slaHours: 72 },
      { asset: drRbg, type: 'qa', priority: 'high', status: 'open', title: 'Annual QA test overdue · Randburg DR', symptoms: 'Licensed inspection body booking required before the licence renewal pack closes.', vendorTicket: null, slaHours: 72 },
      { asset: mgSan, type: 'breakdown', priority: 'normal', status: 'awaiting_parts', title: 'Mammography paddle replacement', symptoms: 'Compression paddle cracked; unit restricted to non-tomosynthesis work.', vendorTicket: 'VT-20902', slaHours: 8 },
      { asset: usBal, type: 'pm', priority: 'low', status: 'done', title: 'Probe integrity check · Ballito US', symptoms: null, vendorTicket: null, slaHours: 72, done: true },
      { asset: ctUmh2, type: 'pm', priority: 'normal', status: 'done', title: 'Tube cooling inspection · CT 2', symptoms: 'Predictive inspection raised by the Maintenance Hand.', vendorTicket: 'VT-20880', slaHours: 72, done: true },
    ];
    let woCount = 0;
    for (const [i, w] of woDefs.entries()) {
      if (!w.asset) continue;
      const id = newId('wo');
      const openedAt = new Date(Date.now() - (w.done ? 8 : i) * DAY).toISOString();
      const timeline: Array<{ at: string; text: string; by?: string; kind?: string }> = [{ at: openedAt, text: `Work order opened: ${w.title}`, by: 'maintenance_hand', kind: 'crit' }];
      if (w.vendorTicket) timeline.push({ at: new Date(new Date(openedAt).getTime() + 3 * 60000).toISOString(), text: `Vendor ticket ${w.vendorTicket} opened under contract; response SLA ${w.slaHours} h; logs attached`, by: 'maintenance_hand' });
      if (w.status === 'in_progress') timeline.push({ at: new Date(new Date(openedAt).getTime() + 90 * 60000).toISOString(), text: 'Vendor engineer en route; ETA 12:00', by: 'bio' });
      if (w.status === 'awaiting_parts') timeline.push({ at: new Date(new Date(openedAt).getTime() + 4 * 3600000).toISOString(), text: 'Part on order; unit restricted, not withdrawn', by: 'bio' });
      if (w.done) timeline.push({ at: new Date(new Date(openedAt).getTime() + 5 * 3600000).toISOString(), text: 'Repair verified with QA; released to service', by: 'bio', kind: 'ok' });
      const poId = w.poCents ? newId('po') : null;
      await db.insert(s.workOrders).values({
        id, practiceId: w.asset.practiceId, siteId: w.asset.siteId, assetId: w.asset.id, ref: `WO-${today.slice(2, 4)}${today.slice(5, 7)}-${String(30 + i)}`,
        type: w.type, priority: w.priority, title: w.title, symptoms: w.symptoms ?? null, status: w.status, vendorTicket: w.vendorTicket ?? null,
        slaHours: w.slaHours, slaStartedAt: openedAt, slaDueAt: new Date(new Date(openedAt).getTime() + w.slaHours * 3600000).toISOString(),
        poId, poCents: w.poCents ?? null,
        downtimeStartedAt: w.type === 'breakdown' ? w.downStart ?? openedAt : null,
        downtimeEndedAt: w.done ? new Date(new Date(openedAt).getTime() + 5 * 3600000).toISOString() : null,
        rootCause: w.done ? 'Wear within expected envelope; consumable replaced' : null, reportedBy: 'maintenance_hand',
        timeline, createdAt: openedAt,
      });
      woCount++;
      if (poId && w.poCents) {
        await db.insert(s.purchaseOrders).values({ id: poId, practiceId: w.asset.practiceId, siteId: w.asset.siteId, ref: `PO-3001`, supplier: 'DemoVendor', category: 'parts', lines: [{ product: `Replacement X-ray tube for ${w.asset.name}`, qty: 1, unitCents: w.poCents }], totalCents: w.poCents, status: 'awaiting_approval', raisedBy: 'maintenance_hand', workOrderId: id });
      }
    }
    summary.workOrders = woCount;

    // Contrast lots per site, with Ballito short of cover and one lot near expiry.
    const lotDefs = [
      { site: ctx.sites.SAN, product: 'Iodinated contrast 100 mL (demo)', lot: 'IOD-2601-A', qty: 240, usage: 22, expiry: addDays(today, 420) },
      { site: ctx.sites.SAN, product: 'Gadolinium 15 mL (demo)', lot: 'GAD-2602-B', qty: 60, usage: 6, expiry: addDays(today, 240) },
      { site: ctx.sites.RBG, product: 'Iodinated contrast 100 mL (demo)', lot: 'IOD-2601-C', qty: 120, usage: 11, expiry: addDays(today, 55) },
      { site: ctx.sites.UMH, product: 'Iodinated contrast 100 mL (demo)', lot: 'IOD-2603-D', qty: 186, usage: 31, expiry: addDays(today, 380) },
      { site: ctx.sites.UMH, product: 'Gadolinium 15 mL (demo)', lot: 'GAD-2603-E', qty: 84, usage: 9, expiry: addDays(today, 300) },
      { site: ctx.sites.BAL, product: 'Iodinated contrast 100 mL (demo)', lot: 'IOD-2604-F', qty: 24, usage: 4, expiry: addDays(today, 150) },
    ];
    for (const l of lotDefs) {
      const lotId = newId('lot');
      await db.insert(s.consumables).values({ id: lotId, practiceId: siteOf[l.site]!.practice, siteId: l.site, category: 'contrast', product: l.product, lot: l.lot, expiry: l.expiry, qtyOnHand: l.qty, unit: 'vial', reorderPoint: 40, dailyUsage: l.usage, supplier: 'DemoPharma SA', unitCents: l.product.startsWith('Gad') ? 42000 : 15300 });
      await db.insert(s.stockMovements).values({ id: newId('mov'), practiceId: siteOf[l.site]!.practice, siteId: l.site, lotId, type: 'receive', qty: l.qty + 40, at: new Date(Date.now() - 20 * DAY).toISOString(), note: 'Opening receipt' });
      await db.insert(s.stockMovements).values({ id: newId('mov'), practiceId: siteOf[l.site]!.practice, siteId: l.site, lotId, type: 'issue', qty: 40, at: new Date(Date.now() - 2 * DAY).toISOString(), note: 'Issued to studies' });
    }
    summary.contrastLots = lotDefs.length;

    // Edge gateways: Ballito offline on UPS, Randburg on UPS in a load-shedding window.
    const gwDefs = [
      { site: ctx.sites.SAN, name: 'Sandton Edge Gateway', status: 'online', tunnel: 9, backlog: 0, disk: 17, ups: 100, note: '6 modalities connected' },
      { site: ctx.sites.RBG, name: 'Randburg Edge Gateway', status: 'on_ups', tunnel: 11, backlog: 0, disk: 24, ups: 88, note: 'Load-shedding stage 2; generator covers X-ray and ultrasound' },
      { site: ctx.sites.UMH, name: 'Umhlanga Edge Gateway', status: 'online', tunnel: 12, backlog: 0, disk: 21, ups: 100, note: 'MRI 2 onboarding; tag checks 9 of 10' },
      { site: ctx.sites.BAL, name: 'Ballito Edge Gateway', status: 'offline', tunnel: null, backlog: 37, disk: 38, ups: 71, note: 'Mains lost 11:15, fibre not on UPS; imaging continues locally; STAT forwarded first on link return' },
    ];
    for (const g of gwDefs) {
      await db.insert(s.edgeGateways).values({
        id: newId('gw'), practiceId: siteOf[g.site]!.practice, siteId: g.site, name: g.name, status: g.status,
        lastHeartbeatAt: g.status === 'offline' ? new Date(Date.now() - 42 * 60000).toISOString() : now,
        tunnelMs: g.tunnel, backlogStudies: g.backlog, diskPct: g.disk, upsPct: g.ups,
        upsMinutesLeft: g.status === 'online' ? null : Math.round((g.ups / 100) * 180),
        stateSince: g.status === 'online' ? new Date(Date.now() - 9 * DAY).toISOString() : new Date(Date.now() - 42 * 60000).toISOString(),
        version: '2.4.1', localWorklistMirror: true, note: g.note,
      });
    }
    summary.edgeGateways = gwDefs.length;

    // Integration feeds.
    const feedDefs = [
      { type: 'HL7', name: 'HL7 ADT in', partner: 'Hospital, Umhlanga (demo)', transport: 'MLLP · TLS', dir: 'in', site: ctx.sites.UMH, msgs: 2108, errors: 3, status: 'healthy' },
      { type: 'HL7', name: 'HL7 ORM in', partner: 'Hospital, Umhlanga (demo)', transport: 'MLLP · TLS', dir: 'in', site: ctx.sites.UMH, msgs: 614, errors: 11, status: 'mapping_review' },
      { type: 'HL7', name: 'HL7 ORU out', partner: 'Hospital, Umhlanga (demo)', transport: 'MLLP · TLS', dir: 'out', site: ctx.sites.UMH, msgs: 588, errors: 0, status: 'healthy' },
      { type: 'DICOM', name: 'DICOM MWL / MPPS', partner: 'All modalities', transport: 'DICOM · site VLAN', dir: 'both', site: null, msgs: 3940, errors: 2, status: 'healthy' },
      { type: 'DICOM', name: 'STOW-RS forward', partner: 'Gateways to archive', transport: 'HTTPS · Tunnel', dir: 'out', site: null, msgs: 4216, errors: 0, status: 'backlog' },
      { type: 'FHIR', name: 'FHIR ServiceRequest', partner: 'Referrer portals (2)', transport: 'HTTPS · OAuth', dir: 'in', site: null, msgs: 96, errors: 0, status: 'healthy' },
      { type: 'switch', name: 'Claims switch', partner: 'Demo switch', transport: 'HTTPS · mTLS', dir: 'both', site: null, msgs: 812, errors: 4, status: 'healthy' },
      { type: 'DICOM', name: 'DICOM C-STORE in', partner: 'Ballito gateway', transport: 'DICOM · Tunnel', dir: 'in', site: ctx.sites.BAL, msgs: 118, errors: 0, status: 'down' },
    ];
    for (const f of feedDefs) {
      await db.insert(s.integrationFeeds).values({
        id: newId('ifd'), practiceId: f.site ? siteOf[f.site]!.practice : ctx.practiceB, siteId: f.site, type: f.type, name: f.name, partner: f.partner,
        transport: f.transport, direction: f.dir, lastMessageAt: f.status === 'down' ? new Date(Date.now() - 42 * 60000).toISOString() : new Date(Date.now() - 19000).toISOString(),
        messages24h: f.msgs, errors24h: f.errors, status: f.status, lastError: f.errors ? (f.name.includes('ORM') ? 'PID-3 assigning authority not mapped' : 'transient timeout') : null,
      });
    }
    summary.integrationFeeds = feedDefs.length;

    // Vendor access: one pending approval on the CT under investigation.
    if (ctUmh2) {
      await db.insert(s.vendorAccessSessions).values({
        id: newId('ras'), practiceId: ctUmh2.practiceId, siteId: ctUmh2.siteId, assetId: ctUmh2.id, ref: `RA-${today.slice(2, 4)}${today.slice(5, 7)}-022`,
        vendor: 'CT vendor service (external partner)', engineer: 'S. Pillay', purpose: 'Tube diagnostics after arc-event alert; proposed firmware update 4.2.1',
        scope: 'service console port only', requestedStart: isoAt(today, '13:00'), requestedEnd: isoAt(today, '15:00'),
        status: 'requested', requestedBy: ctx.users['BIO'] ?? null,
        conditions: ['Firmware change requires a change request with the SAHPRA-registered configuration confirmed in writing', 'Notify CMP of the device change'],
      });
      await db.insert(s.vendorAccessSessions).values({
        id: newId('ras'), practiceId: ctUmh2.practiceId, siteId: ctUmh2.siteId, assetId: ctUmh2.id, ref: `RA-${today.slice(2, 4)}${today.slice(5, 7)}-018`,
        vendor: 'CT vendor service (external partner)', engineer: 'S. Pillay', purpose: 'Routine log collection after PM', scope: 'service console port only',
        requestedStart: new Date(Date.now() - 9 * DAY).toISOString(), requestedEnd: new Date(Date.now() - 9 * DAY + 5400000).toISOString(),
        approvedStart: new Date(Date.now() - 9 * DAY).toISOString(), approvedEnd: new Date(Date.now() - 9 * DAY + 5400000).toISOString(),
        status: 'closed', approvedBy: ctx.users['BIO'] ?? null, approvedAt: new Date(Date.now() - 9 * DAY).toISOString(), recordingRef: 'rec_a41f2209',
      });
      summary.vendorSessions = 2;
    }

    // Load-shedding: a stage 4 window at Randburg today, stage 2 at Umhlanga tomorrow.
    await db.insert(s.loadSheddingWindows).values([
      { id: newId('lsw'), practiceId: ctx.practiceA, siteId: ctx.sites.RBG, stage: 4, startsAt: isoAt(today, '14:00'), endsAt: isoAt(today, '16:30'), generatorCovers: ['XR', 'US'], source: 'schedule' },
      { id: newId('lsw'), practiceId: ctx.practiceB, siteId: ctx.sites.UMH, stage: 2, startsAt: isoAt(addDays(today, 1), '12:00'), endsAt: isoAt(addDays(today, 1), '14:30'), generatorCovers: ['XR', 'US', 'CT', 'MR', 'MG', 'DXA'], source: 'schedule' },
      { id: newId('lsw'), practiceId: ctx.practiceB, siteId: ctx.sites.BAL, stage: 4, startsAt: isoAt(today, '14:00'), endsAt: isoAt(today, '16:30'), generatorCovers: [], source: 'schedule' },
    ]);
    summary.loadSheddingWindows = 3;

    // Support tickets for the SUP console.
    await db.insert(s.supportTickets).values([
      { id: newId('tkt'), practiceId: ctx.practiceB, siteId: ctx.sites.BAL, ref: 'SUP-0101', category: 'outage', severity: 'p2', title: 'Ballito gateway offline since 11:15', description: 'Mains lost; fibre not on UPS. Imaging continues locally, 37 studies in store-and-forward.', status: 'in_progress', linkedRef: 'Edge gateway', runbook: [{ step: 'Confirm UPS runtime and load', done: true }, { step: 'Raise ISP ticket', done: true }, { step: 'Confirm local worklist mirror serving RAD', done: true }, { step: 'Notify PRM and BKG of site constraints', done: true }, { step: 'Monitor backlog drain on link return', done: false }, { step: 'Post-incident note to BIO', done: false }, { step: 'Close with root cause', done: false }], openedBy: ctx.users['SUP'] ?? null, assignedTo: ctx.users['BIO'] ?? null },
      { id: newId('tkt'), practiceId: ctx.practiceB, siteId: ctx.sites.UMH, ref: 'SUP-0102', category: 'integration', severity: 'p3', title: 'HL7 ORM PID-3 mapping review', description: '11 errors in 24 hours from the hospital ORM feed; assigning authority not mapped.', status: 'open', linkedRef: 'HL7 ORM in', openedBy: ctx.users['SUP'] ?? null },
      { id: newId('tkt'), practiceId: ctx.practiceA, ref: 'SUP-0103', category: 'onboarding', severity: 'p3', title: 'Nelspruit onboarding: funders and switch configuration', description: 'Day 3 of 5. Switch credentials pending from the partner.', status: 'waiting', openedBy: ctx.users['SUP'] ?? null },
      { id: newId('tkt'), practiceId: ctx.practiceA, siteId: ctx.sites.SAN, ref: 'SUP-0104', category: 'access', severity: 'p4', title: 'MFA re-enrolment for two front-desk users', status: 'resolved', openedBy: ctx.users['SUP'] ?? null },
    ]);
    summary.supportTickets = 4;
  }

  /* ================= M19 Compliance ================= */
  if ((await db.select({ id: s.obligations.id }).from(s.obligations).limit(1)).length === 0) {
    type Ob = { domain: string; instrument: string; section?: string; obligation: string; entity: string; owner: string; trigger?: string; control?: string; output?: string; evidence?: string; automation?: string; status?: 'confirmed' | 'confirm'; frequency?: string; dueOffset: number };
    const obligations: Ob[] = [
      // Clinical practice and health establishments
      { domain: 'clinical', instrument: 'Health Professions Act 56 of 1974', section: 'HPCSA registration', obligation: 'Every radiologist, radiographer and sonographer holds current HPCSA registration in the correct category, renewed annually', entity: 'Practitioner', owner: 'CMP', trigger: 'Annual renewal cycle (HPCSA fees fall due 1 April, illustrative)', control: 'M01 verifies at onboarding and renewal; M17 blocks rostering and M12 blocks signing for lapsed registration', output: 'Registration register and block log', evidence: 'Registration certificates and practising cards', automation: 'A2', frequency: 'annual', dueOffset: 24 },
      { domain: 'clinical', instrument: 'HPCSA Ethical Rules of Conduct (GN R717 of 2006)', section: 'Rules 3, 4, 7, 8', obligation: 'Practice naming, advertising, fee sharing and ownership by juristic persons comply with the ethical rules', entity: 'Practice', owner: 'CMP', trigger: 'Marketing or structure change', control: 'M02 practitioner-owned structure; marketing review gate in M19', output: 'Marketing approval log', evidence: 'Shareholders and management agreements', automation: 'A1', status: 'confirm', frequency: 'per_event', dueOffset: 61 },
      { domain: 'clinical', instrument: 'HPCSA Booklet 9 (keeping of patient records)', obligation: 'Retain patient records for at least 6 years from the date they became dormant; minors until their 21st birthday', entity: 'Practice', owner: 'CMP', trigger: 'Retention schedule review', control: 'M09 and M21 retention classes; destruction requires CMP approval', output: 'Retention schedule and destruction certificates', evidence: 'Destruction log', automation: 'A2', status: 'confirm', frequency: 'annual', dueOffset: 96 },
      { domain: 'clinical', instrument: 'HPCSA Telemedicine Guidelines (2021)', obligation: 'Remote reporting by registered practitioners with patient consent, secure systems and the same standard of care', entity: 'Practice', owner: 'CMP', control: 'M12 Hub configuration; M07 consent records telemedicine reporting', output: 'Hub policy and consent artefacts', evidence: 'Consent records', automation: 'A1', frequency: 'annual', dueOffset: 112 },
      { domain: 'clinical', instrument: 'HPCSA Booklet 4 (informed consent)', obligation: 'Patients are informed of the procedure, its risks and its costs before the service', entity: 'Site', owner: 'PRM', control: 'M06 quote; M07 consent capture; Collect card', output: 'Signed consents and quote acceptances', evidence: 'Consent artefacts', automation: 'A2', frequency: 'continuous', dueOffset: 44 },
      { domain: 'clinical', instrument: 'National Health Act 61 of 2003', section: 's.14 to s.17', obligation: 'Confidentiality of user records; access only for legitimate purposes; disclosure register maintained', entity: 'Practice', owner: 'CMP', control: 'M15 ABAC and break-glass; disclosure register', output: 'Access audit log and disclosure register', evidence: 'Audit extract', automation: 'A2', frequency: 'quarterly', dueOffset: 37 },
      { domain: 'clinical', instrument: 'OHSC Norms and Standards Regulations (2018)', obligation: 'Health establishment complies with the norms and standards; inspection readiness maintained', entity: 'Site', owner: 'CMP', control: 'M19 self-assessment and evidence pack', output: 'OHSC evidence pack', evidence: 'Self-assessment record', automation: 'A2', status: 'confirm', frequency: 'annual', dueOffset: 88 },
      { domain: 'clinical', instrument: 'NMC Regulations (GN R1434 of 2017)', obligation: 'Notifiable medical conditions are flagged at sign-off and the referrer pack carries the current notification route', entity: 'Practice', owner: 'CMP', trigger: 'report.signed.v1 with a reportable flag', control: 'M12 reportable-result flag; M13 referrer pack', output: 'Flag record and notification support pack', evidence: 'Reportable-results register', automation: 'A2', status: 'confirm', frequency: 'per_event', dueOffset: 13 },
      { domain: 'clinical', instrument: 'Children’s Act 38 of 2005', section: 's.110', obligation: 'Suspected child abuse concluded on reasonable grounds is reported to a designated child protection organisation, the provincial DSD or a police official', entity: 'Practitioner', owner: 'CMP', trigger: 'Safeguarding flag at sign-off', control: 'M12 flag with mandatory guidance; M19 safeguarding case with the form pre-filled', output: 'Report evidence and case log', evidence: 'Safeguarding case record', automation: 'A1', status: 'confirm', frequency: 'per_event', dueOffset: 6 },
      { domain: 'clinical', instrument: 'Older Persons Act 13 of 2006', section: 's.26', obligation: 'Suspected abuse of an older person is reported to the Director-General or a police official', entity: 'Practitioner', owner: 'CMP', control: 'M12 flag; M19 case record', output: 'Report evidence', evidence: 'Case record', automation: 'A1', frequency: 'per_event', dueOffset: 51 },
      { domain: 'clinical', instrument: 'Medicines and Related Substances Act 101 of 1965', obligation: 'Contrast media are acquired, stored and administered under a registered practitioner with lot and expiry records; adverse drug reactions reported to SAHPRA', entity: 'Site', owner: 'PRM', control: 'M18 contrast lot tracking; M07 and M08 administration records; M19 ADR task', output: 'Contrast register and ADR reports', evidence: 'Stock movements per lot', automation: 'A2', status: 'confirm', frequency: 'continuous', dueOffset: 19 },
      { domain: 'clinical', instrument: 'Nursing Act 33 of 2005', obligation: 'Nurses performing IV cannulation and contrast administration are registered with SANC and within scope', entity: 'Practice', owner: 'PRM', control: 'M01 and M17 credential check', output: 'SANC register evidence', evidence: 'Credential records', automation: 'A2', frequency: 'annual', dueOffset: 73 },
      // Radiation and equipment
      { domain: 'radiation', instrument: 'Hazardous Substances Act 15 of 1973', section: 'Group III; SAHPRA Radiation Control', obligation: 'Every X-ray-emitting device is licensed to a licence holder at a named site; amendments on relocation, replacement or disposal', entity: 'Room', owner: 'CMP', trigger: 'Licence expiry minus 90 days', control: 'M02 licence per room and device; M05 blocks scheduling on unlicensed devices', output: 'Licence register and amendment applications', evidence: 'Licence certificates', automation: 'A2', frequency: 'annual', dueOffset: -4 },
      { domain: 'radiation', instrument: 'SAHPRA Radiation Control licence conditions', obligation: 'Radiation Protection Officer appointed, trained and current for each site', entity: 'Site', owner: 'CMP', control: 'M02 officer register', output: 'RPO appointment letters', evidence: 'Appointment and training records', automation: 'A1', frequency: 'annual', dueOffset: 29 },
      { domain: 'radiation', instrument: 'SAHPRA requirements for licence holders', obligation: 'Acceptance testing before clinical use and routine QA per the practice QA programme', entity: 'Modality', owner: 'BIO', trigger: 'QA schedule due date', control: 'M10 QA schedule and RPO sign-off; M05 blocks QA-overdue devices', output: 'QA and acceptance test register with certificates', evidence: 'QA certificates', automation: 'A2', frequency: 'quarterly', dueOffset: 3 },
      { domain: 'radiation', instrument: 'SAHPRA Radiation Control licence conditions', obligation: 'Significant radiation incidents (wrong patient, wrong site, unintended exposure, exposure of a pregnant patient without justification) are reported to the regulator within the specified period', entity: 'Practice', owner: 'CMP', trigger: 'incident.opened.v1 with a radiation category', control: 'M19 incident with radiation category; Compliance Hand drafts; RPO and CMP submit', output: 'Incident report and SAHPRA acknowledgement', evidence: 'Submission record', automation: 'A2', status: 'confirm', frequency: 'per_event', dueOffset: 2 },
      { domain: 'radiation', instrument: 'Occupational Health and Safety Act 85 of 1993; licence conditions', obligation: 'Radiation workers are registered for personal dosimetry, dose records retained and investigation levels applied', entity: 'Practitioner', owner: 'CMP', control: 'M10 dosimetry cycles; M17 radiation-worker registration', output: 'Dosimetry register', evidence: 'Badge cycle reports', automation: 'A2', frequency: 'monthly', dueOffset: 14 },
      { domain: 'radiation', instrument: 'SAHPRA DRL guidance', obligation: 'Typical doses are compared to diagnostic reference levels and outliers investigated', entity: 'Practice', owner: 'CMP', control: 'M10 DRL comparison and dose-outlier model', output: 'DRL review report', evidence: 'Dose audit', automation: 'A2', frequency: 'quarterly', dueOffset: 41 },
      { domain: 'radiation', instrument: 'Occupational Health and Safety Act 85 of 1993', section: 's.24', obligation: 'Incidents causing death, unconsciousness or injury likely to cause 14 days absence are reported to the Department of Employment and Labour within 7 days', entity: 'Site', owner: 'CMP', control: 'M19 incident classification and notification task', output: 'Incident report and DoEL acknowledgement', evidence: 'Submission record', automation: 'A2', status: 'confirm', frequency: 'per_event', dueOffset: 67 },
      { domain: 'radiation', instrument: 'Regulations for Hazardous Chemical Agents; pressure equipment', obligation: 'MRI cryogens, quench pipes and pressure vessels are inspected and handled safely', entity: 'Site', owner: 'BIO', control: 'M18 facilities checks; M19 policies', output: 'Inspection evidence', evidence: 'Inspection reports', automation: 'A1', frequency: 'annual', dueOffset: 78 },
      { domain: 'radiation', instrument: 'SAHPRA Radiation Control licence conditions', obligation: 'Shielding design and survey reports are current for each room; re-survey on structural change or modality replacement', entity: 'Room', owner: 'BIO', control: 'M18 shielding records', output: 'Shielding survey report', evidence: 'Survey certificates', automation: 'A1', frequency: 'annual', dueOffset: 104 },
      // Devices and AI
      { domain: 'devices_ai', instrument: 'Medical Devices Regulations (GN R1515 of 2016)', obligation: 'Vendors hold SAHPRA establishment licences and device registration status is captured at procurement', entity: 'Practice', owner: 'BIO', control: 'M11 model registry and M18 procurement evidence', output: 'Regulatory file per device and licence copies', evidence: 'Vendor licence copies', automation: 'A1', status: 'confirm', frequency: 'per_event', dueOffset: 58 },
      { domain: 'devices_ai', instrument: 'SAHPRA guideline on software as a medical device', obligation: 'Diagnostic-support models are classified, their regulatory status recorded, and activation gated on that status', entity: 'Group', owner: 'AIO', control: 'M11 model registry; activation gate', output: 'Regulatory file per model version', evidence: 'Classification opinions', automation: 'A1', status: 'confirm', frequency: 'per_event', dueOffset: 33 },
      { domain: 'devices_ai', instrument: 'SAHPRA medical device vigilance guideline', obligation: 'Adverse events and field safety corrective actions are reported within the timelines for the severity class', entity: 'Practice', owner: 'AIO', trigger: 'Device or model incident', control: 'M19 incident with device category; M11 kill switch and rollback', output: 'Vigilance reports and FSCA records', evidence: 'Submission records', automation: 'A2', status: 'confirm', frequency: 'per_event', dueOffset: 47 },
      { domain: 'devices_ai', instrument: 'National Health Act s.71; DoH Ethics in Health Research', obligation: 'Research use of images and data requires ethics approval and de-identification', entity: 'Group', owner: 'AIO', control: 'M11 training data manifests linked to ethics approvals', output: 'Ethics approvals', evidence: 'Approval letters', automation: 'A1', frequency: 'per_event', dueOffset: 118 },
      // Information and privacy
      { domain: 'information', instrument: 'POPIA (Act 4 of 2013)', section: 's.55, s.56', obligation: 'Information Officer and deputies designated and registered with the Information Regulator; registration updated on change', entity: 'Practice', owner: 'CMP', control: 'M19 registration record', output: 'Information Officer registration', evidence: 'Registration confirmation', automation: 'A2', frequency: 'annual', dueOffset: 45 },
      { domain: 'information', instrument: 'PAIA (Act 2 of 2000)', section: 's.51', obligation: 'PAIA manual published and reviewed annually; requests handled within 30 days (extendable once)', entity: 'Practice', owner: 'CMP', control: 'M19 request workflow with statutory clock', output: 'PAIA manual and request log', evidence: 'Published manual', automation: 'A2', frequency: 'annual', dueOffset: 26 },
      { domain: 'information', instrument: 'POPIA', section: 's.22', obligation: 'Security compromises are notified to the Information Regulator and to data subjects as soon as reasonably possible', entity: 'Practice', owner: 'CMP', trigger: 'Data-breach incident', control: 'M19 breach workflow; Compliance Hand drafts, CMP submits', output: 'Breach notifications', evidence: 'Notification records', automation: 'A2', frequency: 'per_event', dueOffset: 9 },
      { domain: 'information', instrument: 'POPIA', section: 's.23 to s.25', obligation: 'Data-subject access, correction and deletion requests are fulfilled within the statutory period', entity: 'Practice', owner: 'CMP', trigger: 'Request received', control: 'M19 data-subject request workflow with statutory and policy clocks', output: 'Response packs', evidence: 'Request log', automation: 'A2', frequency: 'per_event', dueOffset: 11 },
      { domain: 'information', instrument: 'POPIA', section: 's.20, s.21', obligation: 'Operator agreements are in place with every processor handling personal information', entity: 'Group', owner: 'CMP', control: 'M21 processing register and contract library', output: 'Operator agreements', evidence: 'Signed agreements', automation: 'A1', frequency: 'annual', dueOffset: 83 },
      { domain: 'information', instrument: 'POPIA', section: 's.57', obligation: 'Prior authorisation is applied for where required, including transfers of special or children’s information outside South Africa', entity: 'Group', owner: 'CMP', control: 'M19 assessment record', output: 's.57 application where required', evidence: 'Assessment and correspondence', automation: 'A1', status: 'confirm', frequency: 'per_event', dueOffset: 108 },
      { domain: 'information', instrument: 'POPIA', section: 's.72', obligation: 'Cross-border transfers to cloud and AI providers meet the transfer conditions', entity: 'Group', owner: 'CMP', control: 'M15 controls; M11 de-identification and DPA gating', output: 'Transfer assessment', evidence: 'Contractual protections on file', automation: 'A1', status: 'confirm', frequency: 'annual', dueOffset: 92 },
      { domain: 'information', instrument: 'POPIA', section: 's.19', obligation: 'Processing register maintained and security measures reviewed', entity: 'Practice', owner: 'CMP', control: 'M21 processing register', output: 'Processing register extract', evidence: 'Register version', automation: 'A2', frequency: 'quarterly', dueOffset: 22 },
      { domain: 'information', instrument: 'Electronic Communications and Transactions Act 25 of 2002', obligation: 'Electronic signatures on reports and consents meet the Act’s requirements and the records are admissible', entity: 'Practice', owner: 'CMP', control: 'M07 e-signature; M12 electronic signing; M21 record integrity', output: 'Signature audit', evidence: 'Audit chain extract', automation: 'A2', status: 'confirm', frequency: 'annual', dueOffset: 99 },
      { domain: 'information', instrument: 'Cybercrimes Act 19 of 2020', obligation: 'Evidence preservation supported for data and system offences', entity: 'Group', owner: 'CMP', control: 'M15 incident response; immutable logs', output: 'Forensic evidence packs', evidence: 'Immutable log extracts', automation: 'A2', status: 'confirm', frequency: 'annual', dueOffset: 115 },
      // Funders and claims
      { domain: 'funders', instrument: 'Medical Schemes Act 131 of 1998', section: 'Regulation 6', obligation: 'Claims are submitted within 4 months of the service date and corrections made within the correction period', entity: 'Practice', owner: 'BIL', control: 'M14 submission deadline monitoring and correction workflow', output: 'Claim files with submission timestamps', evidence: 'Submission and correction logs', automation: 'A3', status: 'confirm', frequency: 'monthly', dueOffset: 7 },
      { domain: 'funders', instrument: 'Medical Schemes Act', section: 'Regulation 8', obligation: 'Prescribed minimum benefits are handled correctly and paid in full at the designated service provider', entity: 'Practice', owner: 'BIL', control: 'M14 PMB flags and rules engine', output: 'PMB handling evidence', evidence: 'Claim line records', automation: 'A2', status: 'confirm', frequency: 'monthly', dueOffset: 16 },
      { domain: 'funders', instrument: 'BHF Practice Code Numbering System terms', obligation: 'Practice number is current and its particulars (principals, address, disciplines) are correct', entity: 'Practice', owner: 'BIL', control: 'M02 practice number lifecycle', output: 'PCNS certificate', evidence: 'PCNS confirmation', automation: 'A1', frequency: 'annual', dueOffset: 55 },
      { domain: 'funders', instrument: 'Council for Medical Schemes circulars and s.59 outcomes', obligation: 'Records are retained for funder claims audits and audit responses are given within the deadline', entity: 'Practice', owner: 'BIL', control: 'M14 audit packs; M19 funder audit disclosure log', output: 'Audit responses', evidence: 'Disclosure log', automation: 'A2', frequency: 'per_event', dueOffset: 35 },
      { domain: 'funders', instrument: 'Health Market Inquiry; Competition Act guidance', obligation: 'Fee schedules are set independently per practice with no collective tariff setting', entity: 'Practice', owner: 'EXE', control: 'M06 pricing governance; M14 fee schedules per practice', output: 'Fee-schedule approval records', evidence: 'Approval minutes', automation: 'A1', frequency: 'annual', dueOffset: 71 },
      { domain: 'funders', instrument: 'Road Accident Fund Act 56 of 1996', obligation: 'RAF supplier claims and undertakings follow the prescribed procedures and prescription periods are observed', entity: 'Practice', owner: 'BIL', control: 'M06 RAF funding case; M14 RAF debtor class', output: 'RAF packs and undertaking records', evidence: 'Submission records', automation: 'A2', status: 'confirm', frequency: 'per_event', dueOffset: 64 },
      { domain: 'funders', instrument: 'COIDA 130 of 1993', obligation: 'Medical reports and accounts for injuries on duty are submitted on the prescribed forms and tariffs within the time limits', entity: 'Practice', owner: 'BIL', control: 'M06 COIDA case; M12 medical report templates; M14 claim format', output: 'COIDA submissions and acknowledgements', evidence: 'Submission records', automation: 'A2', status: 'confirm', frequency: 'per_event', dueOffset: 28 },
      { domain: 'funders', instrument: 'ODMWA 78 of 1973', obligation: 'Benefit medical examination chest radiographs are ILO-classified by a qualified reader and submitted to the MBOD with extended retention', entity: 'Practice', owner: 'CMP', control: 'M12 ILO template with reader qualification check; M13 MBOD pack; M09 retention', output: 'ILO reports and MBOD submission records', evidence: 'Reader qualification and submission log', automation: 'A2', status: 'confirm', frequency: 'per_event', dueOffset: 86 },
      { domain: 'funders', instrument: 'Consumer Protection Act 68 of 2008', obligation: 'Prices are disclosed in plain language before service and complaints are handled within the Act’s expectations', entity: 'Practice', owner: 'PRM', control: 'M06 quote; M14 statements; M19 complaints', output: 'Quote acceptances and complaint records', evidence: 'Complaint register', automation: 'A2', frequency: 'quarterly', dueOffset: 31 },
      { domain: 'funders', instrument: 'National Credit Act 34 of 2005', obligation: 'Payment plans are structured as incidental credit with no charges beyond the Act’s provisions', entity: 'Practice', owner: 'BIL', control: 'M14 plan templates; Collections Hand leash', output: 'Plan agreements', evidence: 'Plan records', automation: 'A1', status: 'confirm', frequency: 'annual', dueOffset: 102 },
      { domain: 'funders', instrument: 'Debt Collectors Act 114 of 1998; Prescription Act 68 of 1969', obligation: 'Only registered debt collectors are used and prescribed debt is not pursued as enforceable', entity: 'Practice', owner: 'BIL', control: 'M14 handover approvals and prescription checks', output: 'Handover log', evidence: 'Collector registration certificates', automation: 'A1', frequency: 'annual', dueOffset: 110 },
      { domain: 'funders', instrument: 'Value-Added Tax Act 89 of 1991', obligation: 'Tax invoices carry the prescribed content and VAT201 returns are filed per the SARS cycle', entity: 'Practice', owner: 'BIL', control: 'M14 tax invoices; M15 VAT accounting and return exports', output: 'Tax invoices and VAT201 exports', evidence: 'Return submissions', automation: 'A2', frequency: 'monthly', dueOffset: 8 },
      { domain: 'funders', instrument: 'National Health Insurance Act 20 of 2023', obligation: 'Accreditation and contracting readiness is monitored as sections commence by proclamation', entity: 'Group', owner: 'EXE', control: 'M02 accreditation record; M14 funder-agnostic claims', output: 'Readiness checklist', evidence: 'Watch item notes', automation: 'A1', status: 'confirm', frequency: 'quarterly', dueOffset: 120 },
      // Corporate, tax and transformation
      { domain: 'corporate', instrument: 'Companies Act 71 of 2008', obligation: 'Annual returns (CoR 30.1) and beneficial ownership filings are lodged within the window after the incorporation anniversary', entity: 'Practice', owner: 'EXE', control: 'M02 entity register with filing calendar', output: 'CIPC filings', evidence: 'Filing confirmations', automation: 'A1', frequency: 'annual', dueOffset: 29 },
      { domain: 'corporate', instrument: 'Companies Act 71 of 2008', section: 's.46', obligation: 'The solvency and liquidity test is recorded before every distribution', entity: 'Practice', owner: 'EXE', control: 'M15 distribution approvals with the s.46 test record', output: 's.46 resolutions', evidence: 'Board resolutions', automation: 'A1', frequency: 'per_event', dueOffset: 18 },
      { domain: 'corporate', instrument: 'Income Tax Act 58 of 1962', obligation: 'Provisional tax, dividends tax withholding and returns are filed on the SARS cycle', entity: 'Practice', owner: 'EXE', control: 'M15 tax computations and exports', output: 'Returns and certificates', evidence: 'SARS acknowledgements', automation: 'A2', frequency: 'quarterly', dueOffset: 39 },
      { domain: 'corporate', instrument: 'Tax Administration Act 28 of 2011', obligation: 'Records are retained for the prescribed period (5 years illustrative)', entity: 'Practice', owner: 'EXE', control: 'M15 retention', output: 'Archive index', evidence: 'Retention schedule', automation: 'A2', status: 'confirm', frequency: 'annual', dueOffset: 94 },
      { domain: 'corporate', instrument: 'B-BBEE Act 53 of 2003 and Codes', obligation: 'Annual verification certificate or sworn affidavit is renewed by entity size', entity: 'Practice', owner: 'EXE', control: 'M02 ownership analytics; M17 skills spend; M18 supplier data', output: 'Verification certificate', evidence: 'Verification evidence pack', automation: 'A1', frequency: 'annual', dueOffset: 73 },
      { domain: 'corporate', instrument: 'Competition Act 89 of 1998', obligation: 'Merger notification thresholds are assessed before acquiring a practice', entity: 'Group', owner: 'EXE', control: 'M02 acquisition workflow with merger-threshold check; M19 legal review gate', output: 'Notification filings where required', evidence: 'Threshold assessment', automation: 'A1', status: 'confirm', frequency: 'per_event', dueOffset: 49 },
      { domain: 'corporate', instrument: 'Trade Marks Act 194 of 1993', obligation: 'The brand mark is cleared and registered before public launch', entity: 'Group', owner: 'EXE', control: 'Brand clearance protocol', output: 'Trade mark certificates', evidence: 'Clearance search reports', automation: 'A1', status: 'confirm', frequency: 'once', dueOffset: 60 },
      // Employment and workplace
      { domain: 'employment', instrument: 'Basic Conditions of Employment Act 75 of 1997', obligation: 'Hours, overtime, rest periods, night work and leave comply with the rule pack in force for the employing entity', entity: 'Practice', owner: 'PRM', control: 'M17 roster rule pack evaluated across all sites a worker is rostered to', output: 'Roster compliance reports', evidence: 'Override log', automation: 'A2', frequency: 'monthly', dueOffset: 12 },
      { domain: 'employment', instrument: 'Employment Equity Act 55 of 1998', obligation: 'Designated employers submit employment equity reports and plans annually', entity: 'Practice', owner: 'PRM', control: 'M17 EE reporting export', output: 'EEA2 and EEA4 exports (illustrative form names)', evidence: 'Submission receipts', automation: 'A1', status: 'confirm', frequency: 'annual', dueOffset: 76 },
      { domain: 'employment', instrument: 'Skills Development Act 97 of 1998', obligation: 'Workplace skills plan and annual training report are submitted to the SETA and the levy is paid', entity: 'Practice', owner: 'PRM', control: 'M17 training records', output: 'WSP and ATR exports', evidence: 'SETA acknowledgements', automation: 'A1', frequency: 'annual', dueOffset: 81 },
      { domain: 'employment', instrument: 'Unemployment Insurance Act 63 of 2001; COIDA employer duties', obligation: 'UIF and COIDA registration maintained; return of earnings filed and a letter of good standing held', entity: 'Practice', owner: 'PRM', control: 'M15 and M17 registers', output: 'Letter of good standing', evidence: 'Certificates', automation: 'A1', frequency: 'annual', dueOffset: 53 },
      { domain: 'employment', instrument: 'Occupational Health and Safety Act 85 of 1993', section: 's.16(2), s.17', obligation: 'Appointment letters, health and safety representatives, committee meetings and first aiders are current per site', entity: 'Site', owner: 'PRM', control: 'M19 OHS programme', output: 'Appointment letters and committee minutes', evidence: 'Meeting records', automation: 'A1', frequency: 'quarterly', dueOffset: 21 },
      { domain: 'employment', instrument: 'Protection from Harassment Act; EE harassment code', obligation: 'Harassment policy and complaint channels are published and acknowledged', entity: 'Practice', owner: 'CMP', control: 'M19 policies and acknowledgements', output: 'Policy acknowledgement coverage', evidence: 'Acknowledgement records', automation: 'A2', frequency: 'annual', dueOffset: 90 },
      // Clinical governance and assurance
      { domain: 'clinical', instrument: 'Clinical governance terms of reference', obligation: 'The radiation safety committee meets quarterly with dose, QA, licence and incident inputs', entity: 'Practice', owner: 'CMP', control: 'M19 committee records', output: 'Minutes and actions', evidence: 'Committee minutes', automation: 'A1', frequency: 'quarterly', dueOffset: 17 },
      { domain: 'clinical', instrument: 'Clinical governance terms of reference', obligation: 'The discrepancy and peer-review meeting runs monthly with de-identified learning cases', entity: 'Practice', owner: 'CMP', control: 'M12 peer review sampling; M19 minutes', output: 'Peer review programme summary', evidence: 'Meeting minutes', automation: 'A1', frequency: 'monthly', dueOffset: 5 },
      { domain: 'clinical', instrument: 'Clinical governance terms of reference', obligation: 'The AI safety committee reviews model performance, override rates and the slip log monthly', entity: 'Group', owner: 'AIO', control: 'M11 monitoring; M20 leash change records', output: 'Committee pack', evidence: 'Minutes and model reports', automation: 'A1', frequency: 'monthly', dueOffset: 10 },
      { domain: 'clinical', instrument: 'Infection prevention and control guidelines', obligation: 'Cleaning schedules, probe reprocessing and hand hygiene audits are completed and recorded per site', entity: 'Site', owner: 'PRM', control: 'M18 cleaning logs; M19 IPC audits', output: 'IPC audit results', evidence: 'Audit checklists with photo evidence', automation: 'A2', frequency: 'quarterly', dueOffset: 25 },
      { domain: 'corporate', instrument: 'Insurance and contract schedule', obligation: 'Professional indemnity, public liability, equipment and cyber cover are renewed before expiry', entity: 'Practice', owner: 'EXE', control: 'M02 contract register with renewal dates', output: 'Policy schedules', evidence: 'Renewal confirmations', automation: 'A1', frequency: 'annual', dueOffset: 43 },
      { domain: 'corporate', instrument: 'Business continuity policy', obligation: 'Business continuity plans are tested (tabletop annually, technical DR quarterly) and results recorded', entity: 'Group', owner: 'SUP', control: 'M19 calendar items with evidence', output: 'Test reports', evidence: 'DR test results', automation: 'A1', frequency: 'quarterly', dueOffset: 34 },
      { domain: 'devices_ai', instrument: 'AI safety charter (docs/12)', obligation: 'Every deployed model version has a validation report younger than 12 months', entity: 'Group', owner: 'AIO', control: 'M11 model registry validation currency check', output: 'Validation report index', evidence: 'Validation reports', automation: 'A2', frequency: 'annual', dueOffset: 68 },
      { domain: 'information', instrument: 'Access review policy (docs/15)', obligation: 'Role assignments with analytics or clinical scope are reviewed quarterly and break-glass opens reviewed within five days', entity: 'Practice', owner: 'CMP', control: 'M01 access review workflow; M19 break-glass review queue', output: 'Access review record', evidence: 'Review sign-off', automation: 'A2', frequency: 'quarterly', dueOffset: 15 },
    ];

    let obCount = 0;
    for (const practiceId of practices) {
      for (const o of obligations) {
        await db.insert(s.obligations).values({
          id: newId('obl'), practiceId, siteId: null, domain: o.domain, instrument: o.instrument, section: o.section ?? null,
          obligation: o.obligation, responsibleEntity: o.entity, ownerPersona: o.owner, trigger: o.trigger ?? null,
          control: o.control ?? null, output: o.output ?? null, evidence: o.evidence ?? null, automation: o.automation ?? 'A2',
          status: o.status ?? 'confirmed', frequency: o.frequency ?? 'annual',
          dueDate: addDays(today, o.dueOffset + (practiceId === ctx.practiceB ? 2 : 0)),
          lastDoneAt: o.dueOffset > 30 ? addDays(today, o.dueOffset - 365) : null,
          evidenceRefs: [], effectiveFrom: '2026-01-01',
        });
        obCount++;
      }
    }
    summary.obligations = obCount;

    // Calendar items with 90/60/30/7-day leads.
    const obRows = await db.select().from(s.obligations);
    let calCount = 0;
    for (const o of obRows) {
      if (!o.dueDate) continue;
      for (const lead of [90, 60, 30, 7, 0]) {
        const fire = addDays(o.dueDate, -lead);
        await db.insert(s.obligationEvents).values({
          id: newId('oev'), practiceId: o.practiceId, obligationId: o.id, dueDate: o.dueDate, leadDays: lead, fireDate: fire,
          title: `${o.instrument}${o.section ? ` ${o.section}` : ''} · ${lead ? `${lead}-day lead` : 'due'}`, assignee: o.ownerPersona,
          status: fire < today ? (o.lastDoneAt && o.lastDoneAt >= o.dueDate ? 'done' : o.dueDate < today ? 'overdue' : 'notified') : 'pending',
        });
        calCount++;
      }
    }
    summary.calendarItems = calCount;

    // Policies (Group-wide) and acknowledgements.
    const policyDefs = [
      { title: 'Radiation protection programme', category: 'clinical', roles: ['RAD', 'NUR', 'PRM', 'CMP'] },
      { title: 'Contrast administration and reaction management', category: 'clinical', roles: ['RAD', 'NUR'] },
      { title: 'MRI safety policy', category: 'clinical', roles: ['RAD', 'NUR', 'BIO'] },
      { title: 'Critical results communication', category: 'clinical', roles: ['RGT', 'RAD', 'FDK'] },
      { title: 'POPIA privacy policy', category: 'information', roles: ['RAD', 'NUR', 'FDK', 'BIL', 'PRM', 'BIO'] },
      { title: 'Information security and acceptable use', category: 'information', roles: ['RAD', 'NUR', 'FDK', 'BIL', 'PRM', 'BIO'] },
      { title: 'AI use policy', category: 'information', roles: ['RGT', 'RAD', 'PRM', 'CMP'] },
      { title: 'Incident reporting and just culture', category: 'people', roles: ['RAD', 'NUR', 'FDK', 'PRM', 'BIO'] },
      { title: 'Billing ethics, gifts and referrer relationships', category: 'commercial', roles: ['BIL', 'PRM'] },
    ];
    const policyIds: string[] = [];
    for (const p of policyDefs) {
      const id = newId('pol');
      policyIds.push(id);
      await db.insert(s.policies).values({ id, practiceId: null, title: p.title, category: p.category, version: 2, effectiveDate: addDays(today, -120), reviewDue: addDays(today, 245), owner: 'CMP', appliesTo: p.roles, mandatory: true, status: 'approved', summary: `${p.title} · version 2 · reviewed by the quality and risk committee` });
    }
    summary.policies = policyDefs.length;

    const staffAll = await db.select().from(s.staff);
    let ackCount = 0;
    for (const [i, pid] of policyIds.entries()) {
      const roles = policyDefs[i]!.roles;
      for (const st of staffAll.filter((x) => roles.includes(x.role))) {
        if (r() < 0.12) continue; // a few outstanding acknowledgements for the KPI
        await db.insert(s.policyAcknowledgements).values({ id: newId('ack'), practiceId: st.practiceId, policyId: pid, staffId: st.id, version: 2, acknowledgedAt: new Date(Date.now() - Math.floor(r() * 90) * DAY).toISOString(), method: 'in_app' });
        ackCount++;
      }
    }
    summary.policyAcknowledgements = ackCount;

    // Incidents: six, including the wrong-patient exposure with a drafted SAHPRA report awaiting CMP.
    const wrongPatientId = newId('inc');
    const incidentDefs: Array<Record<string, any>> = [
      {
        id: wrongPatientId, practiceId: ctx.practiceA, siteId: ctx.sites.SAN, ref: 'INC-2609-031', category: 'radiation_wrong_patient', severity: 1,
        title: 'Unintended exposure · wrong patient', description: 'Chest radiograph performed on the wrong patient after a surname-only queue call; wristband scan step was skipped.',
        occurredAt: new Date(Date.now() - 5 * DAY).toISOString(), reportedAt: new Date(Date.now() - 5 * DAY + 4 * 60000).toISOString(), reportedBy: ctx.users['RAD'] ?? 'system',
        patientMasked: '····7712 · M 61', roomId: ctx.rooms['SAN-XR1'] ?? null, modalityId: ctx.modalities['SAN-XR1'] ?? null, status: 'investigating', regulator: 'SAHPRA',
        timeline: [
          { at: new Date(Date.now() - 5 * DAY).toISOString(), text: 'Check-in: Dlamini, S (A) · CXR PA/LAT · queue position 6', kind: 'neutral', source: 'M07' },
          { at: new Date(Date.now() - 5 * DAY + 120000).toISOString(), text: 'Check-in: Dlamini, M (B) · CXR PA/LAT · queue position 7', kind: 'neutral', source: 'M07' },
          { at: new Date(Date.now() - 5 * DAY + 360000).toISOString(), text: 'Queue board call: "Dlamini" (surname only, site display rule v3)', kind: 'neutral', source: 'M07' },
          { at: new Date(Date.now() - 5 * DAY + 420000).toISOString(), text: 'Worklist selection at modality: patient B selected; wristband scan step skipped', kind: 'crit', source: 'M08 MPPS' },
          { at: new Date(Date.now() - 5 * DAY + 480000).toISOString(), text: 'MPPS: 2 exposures (PA, LAT) · DAP 0.11 Gy·cm² · effective dose estimate 0.02 mSv (ICRP 103 conversion, estimate)', kind: 'crit', source: 'M10 DoseSR' },
          { at: new Date(Date.now() - 5 * DAY + 540000).toISOString(), text: 'Wristband scan after exposure: mismatch, patient A in room; radiographer stops', kind: 'neutral', source: 'M07' },
          { at: new Date(Date.now() - 5 * DAY + 3600000).toISOString(), text: 'Exposed patient informed within the hour; RPO notified; dose estimate recorded', kind: 'ok', source: 'M19' },
          { at: new Date(Date.now() - 2 * DAY).toISOString(), text: 'Compliance Hand drafted the SAHPRA notification; awaiting CMP review', kind: 'ai', source: 'hand' },
        ],
        immediateActions: [{ item: 'RPO informed', done: true, at: new Date(Date.now() - 5 * DAY + 3600000).toISOString() }, { item: 'Patient dose estimated and recorded in M10', done: true }, { item: 'Patient and referrer informed (duty of candour)', done: true }, { item: 'Wristband scan made a hard gate at this site', done: false }],
        rca: { method: 'Contributing-factor framework (patient, task, individual, team, environment, equipment, organisation)', factors: [{ factor: 'Task', finding: 'Queue call used the surname only under site display rule v3' }, { factor: 'Equipment', finding: 'Site configuration allowed exposure without a wristband scan' }, { factor: 'Team', finding: 'Two patients with the same surname in the queue at the same time' }], conclusion: 'Identity confirmation was not enforced at the modality; the display rule increased the chance of a same-surname mix-up.', investigator: 'CMP with the RPO' },
        correctiveActions: [{ action: 'Make the wristband scan a hard gate before exposure at all sites', owner: 'BIO', due: addDays(today, 14), status: 'open', effectivenessCheck: addDays(today, 60) }, { action: 'Change the queue display rule to surname plus first initial', owner: 'PRM', due: addDays(today, 7), status: 'open' }],
        disclosure: { patient: 'Informed within the hour of the exposure', referrer: 'Informed same day', regulator: 'Draft awaiting CMP submission' },
        reportDraft: { status: 'awaiting_cmp', draftedAt: new Date(Date.now() - 2 * DAY).toISOString(), text: 'DRAFT notification to SAHPRA — not submitted.\n\nIncident reference: INC-2609-031\nCategory: radiation wrong patient · severity 1\nLicence holder site: Sandton · room XR1 · licence RC-SAN-XR1-2024\nDescription: Chest radiograph performed on the wrong patient after a surname-only queue call; wristband scan step was skipped.\nPatient (masked): ····7712 · M 61\nDose: DAP 0.11 Gy·cm², effective dose estimate 0.02 mSv (ICRP 103 conversion, estimate)\nImmediate actions: RPO informed; dose estimated; patient and referrer informed.\nInvestigation: contributing-factor framework; identity confirmation not enforced at the modality.\nCorrective actions: wristband scan hard gate (BIO); queue display rule change (PRM).\n\nThis draft is prepared from Platform records for CMP review. Submission to SAHPRA is a human action with a named submitter (docs/24 §6, M19-R-301).', provenance: { modelId: 'compliance-draft', modelVersion: '1.4.0', outputClass: 3, createdAt: new Date(Date.now() - 2 * DAY).toISOString(), demo: true } },
        linkedRefs: ['RR-2609-009'],
      },
      { practiceId: ctx.practiceB, siteId: ctx.sites.UMH, ref: 'INC-2609-028', category: 'contrast_reaction', severity: 2, title: 'Moderate contrast reaction · urticaria and wheeze', description: 'Patient developed urticaria and mild wheeze 8 minutes after iodinated contrast; treated on site, observed 60 minutes, discharged well.', occurredAt: new Date(Date.now() - 9 * DAY).toISOString(), reportedAt: new Date(Date.now() - 9 * DAY + 900000).toISOString(), patientMasked: '····4471 · F 44', status: 'investigating', regulator: 'SAHPRA', timeline: [{ at: new Date(Date.now() - 9 * DAY).toISOString(), text: 'Reaction reported from the nurse console; lot IOD-2603-D linked', kind: 'crit' }, { at: new Date(Date.now() - 9 * DAY + 3600000).toISOString(), text: 'Patient observed 60 minutes and discharged well; referrer informed', kind: 'ok' }], immediateActions: [{ item: 'Emergency trolley checked and restocked', done: true }, { item: 'Lot and batch recorded against the study', done: true }], rca: { method: 'Contributing-factor framework', factors: [{ factor: 'Patient', finding: 'No prior contrast reaction recorded; allergy history negative' }], conclusion: 'Idiosyncratic moderate reaction; no product defect suspected at this stage.' }, correctiveActions: [{ action: 'Add a contrast-reaction flag to the patient record', owner: 'NUR', due: addDays(today, -2), status: 'done' }], disclosure: { patient: 'Informed at the time', referrer: 'Informed same day' }, reportDraft: { status: 'none' }, linkedRefs: [] },
      { practiceId: ctx.practiceA, siteId: ctx.sites.RBG, ref: 'INC-2609-026', category: 'data_breach', severity: 2, title: 'Report delivered to the wrong referrer', description: 'A signed report was sent to a referrer with a similar practice number; recipient confirmed deletion.', occurredAt: new Date(Date.now() - 12 * DAY).toISOString(), reportedAt: new Date(Date.now() - 12 * DAY + 1800000).toISOString(), patientMasked: '····3388 · F 27', status: 'investigating', regulator: 'Information Regulator', timeline: [{ at: new Date(Date.now() - 12 * DAY).toISOString(), text: 'Misdirected delivery identified by the referrer portal audit', kind: 'crit' }, { at: new Date(Date.now() - 11 * DAY).toISOString(), text: 'Recipient confirmed deletion in writing; containment complete', kind: 'ok' }], immediateActions: [{ item: 'Containment: recipient confirmed deletion', done: true }, { item: 'Assess notifiability under POPIA s.22', done: true }], rca: { method: 'Contributing-factor framework', factors: [{ factor: 'Task', finding: 'Referrer selection list matched on practice number prefix only' }], conclusion: 'Selection list ambiguity; low risk of harm, single record, confirmed deleted.' }, correctiveActions: [{ action: 'Referrer picker shows practice name, number and suburb', owner: 'SUP', due: addDays(today, 10), status: 'open' }], disclosure: { patient: 'Notification decision recorded with CMP', regulator: 'Assessment recorded; notification decision pending' }, reportDraft: { status: 'none' }, linkedRefs: [] },
      { practiceId: ctx.practiceB, siteId: ctx.sites.UMH, ref: 'INC-2609-021', category: 'equipment', severity: 3, title: 'CT 2 tube arc fault during a series', description: 'Scanner halted mid-series with arc events; no patient harm; patient rescanned on CT 1.', occurredAt: isoAt(today, '08:40'), reportedAt: isoAt(today, '08:44'), status: 'open', regulator: 'SAHPRA', timeline: [{ at: isoAt(today, '08:40'), text: 'Arc fault; scanner halted mid-series; no exposure beyond the aborted series', kind: 'crit' }, { at: isoAt(today, '08:43'), text: 'Maintenance Hand opened work order and vendor ticket VT-20931', kind: 'ai' }], immediateActions: [{ item: 'Patient rescanned on CT 1', done: true }, { item: 'Device withdrawn from the calendar', done: true }], rca: null, correctiveActions: [], disclosure: { patient: 'No harm; informed of the delay' }, reportDraft: { status: 'none' }, linkedRefs: ['WO-2609-030'] },
      { practiceId: ctx.practiceA, siteId: ctx.sites.SAN, ref: 'INC-2608-019', category: 'needle_stick', severity: 3, title: 'Sharps injury during cannulation', description: 'Nurse sustained a needle-stick injury; source patient consented to testing; post-exposure pathway followed within the clinical window.', occurredAt: new Date(Date.now() - 26 * DAY).toISOString(), reportedAt: new Date(Date.now() - 26 * DAY + 600000).toISOString(), status: 'closed', regulator: 'DoEL', closedAt: new Date(Date.now() - 12 * DAY).toISOString(), learningSummary: 'Sharps containers at both cannulation trolleys were above the fill line. Fill-line checks added to the daily room checklist across all sites.', timeline: [{ at: new Date(Date.now() - 26 * DAY).toISOString(), text: 'Injury reported from the nurse console', kind: 'crit' }, { at: new Date(Date.now() - 26 * DAY + 3600000).toISOString(), text: 'Post-exposure prophylaxis pathway started within the window', kind: 'ok' }, { at: new Date(Date.now() - 12 * DAY).toISOString(), text: 'Closed by CMP with a learning summary', kind: 'ok' }], immediateActions: [{ item: 'Source patient testing consent obtained', done: true }, { item: 'COIDA injury-on-duty claim opened', done: true }], rca: { method: 'Contributing-factor framework', factors: [{ factor: 'Environment', finding: 'Sharps container above the fill line' }], conclusion: 'Container replacement interval too long for the trolley’s throughput.' }, correctiveActions: [{ action: 'Add sharps fill-line check to the daily room checklist', owner: 'NUR', due: addDays(today, -14), status: 'done', effectivenessCheck: addDays(today, 16) }], disclosure: {}, reportDraft: { status: 'submitted', submittedAt: new Date(Date.now() - 20 * DAY).toISOString(), reference: 'DOEL-DEMO-4471', text: 'Submitted section 24 report (demo reference).' }, linkedRefs: [] },
      { practiceId: ctx.practiceB, siteId: ctx.sites.BAL, ref: 'INC-2608-014', category: 'near_miss', severity: 4, title: 'Near miss · MRI ferrous trolley stopped at zone III', description: 'A cleaning trolley with ferrous castors was stopped at the zone III door by the screening check.', occurredAt: new Date(Date.now() - 34 * DAY).toISOString(), reportedAt: new Date(Date.now() - 34 * DAY + 300000).toISOString(), status: 'closed', regulator: 'none', closedAt: new Date(Date.now() - 25 * DAY).toISOString(), learningSummary: 'Screening at zone III worked as designed. Cleaning contractor equipment is now on the MR-safe inventory and labelled.', timeline: [{ at: new Date(Date.now() - 34 * DAY).toISOString(), text: 'Trolley stopped at the zone III door by the screening check', kind: 'ok' }], immediateActions: [{ item: 'Contractor briefed; MR-safe trolley issued', done: true }], rca: { method: 'Contributing-factor framework', factors: [{ factor: 'Organisation', finding: 'Contractor equipment was not on the MR-safe inventory' }], conclusion: 'Control worked; inventory gap closed.' }, correctiveActions: [{ action: 'Add contractor equipment to the MR-safe inventory', owner: 'BIO', due: addDays(today, -20), status: 'done' }], disclosure: {}, reportDraft: { status: 'none' }, linkedRefs: [] },
    ];
    for (const inc of incidentDefs) {
      await db.insert(s.incidents).values({ id: inc.id ?? newId('inc'), ...inc } as any);
    }
    summary.incidents = incidentDefs.length;

    // Complaints
    const complaintDefs = [
      { practiceId: ctx.practiceB, siteId: ctx.sites.UMH, ref: 'CPL-2609-011', channel: 'patient_space', route: 'internal', category: 'service', subject: 'Ultrasound wait of 70 minutes past the slot time', severity: 'minor', days: 4, ack: true },
      { practiceId: ctx.practiceA, siteId: ctx.sites.SAN, ref: 'CPL-2609-009', channel: 'scheme', route: 'CMS', category: 'billing', subject: 'Member states the patient portion was not disclosed before the scan', severity: 'moderate', days: 6, ack: true, externalRef: 'CMS-DEMO-88421' },
      { practiceId: ctx.practiceA, siteId: ctx.sites.RBG, ref: 'CPL-2609-006', channel: 'hpcsa', route: 'HPCSA', category: 'conduct', subject: 'Professional conduct allegation regarding chaperone arrangements', severity: 'major', days: 9, ack: true, legalHold: true, externalRef: 'HPCSA-DEMO-1192' },
      { practiceId: ctx.practiceB, siteId: ctx.sites.BAL, ref: 'CPL-2608-044', channel: 'whatsapp', route: 'CPA', category: 'service', subject: 'Results were not available when promised', severity: 'minor', days: 21, ack: true, closed: true },
    ];
    for (const cp of complaintDefs) {
      const receivedAt = new Date(Date.now() - cp.days * DAY).toISOString();
      await db.insert(s.complaints).values({
        id: newId('cmp'), practiceId: cp.practiceId, siteId: cp.siteId, ref: cp.ref, channel: cp.channel, route: cp.route, category: cp.category,
        complainantMasked: `····${String(1000 + Math.floor(r() * 8999))}`, subject: cp.subject, detail: cp.subject, severity: cp.severity,
        receivedAt, acknowledgeBy: new Date(new Date(receivedAt).getTime() + DAY).toISOString(),
        acknowledgedAt: cp.ack ? new Date(new Date(receivedAt).getTime() + 3 * 3600000).toISOString() : null,
        respondBy: new Date(new Date(receivedAt).getTime() + (cp.route === 'HPCSA' ? 21 : cp.route === 'CMS' ? 14 : 20) * DAY).toISOString(),
        respondedAt: cp.closed ? new Date(new Date(receivedAt).getTime() + 12 * DAY).toISOString() : null,
        status: cp.closed ? 'closed' : cp.ack ? 'investigating' : 'received', externalRef: cp.externalRef ?? null, legalHold: !!cp.legalHold,
      });
    }
    summary.complaints = complaintDefs.length;

    // POPIA / PAIA requests
    const dsrChecklist = ['Identity verified (ID match plus OTP to the registered number)', 'Record set collected (studies, reports, claims, disclosure log)', 'Third-party data reviewed for redaction under PAIA grounds', 'Response drafted', 'Information Officer approved release', 'Delivered through the Patient Space share link'];
    const dsrDefs = [
      { practiceId: ctx.practiceB, ref: 'DSR-2609-004', type: 'access', days: 6, done: 3, status: 'collecting' },
      { practiceId: ctx.practiceA, ref: 'DSR-2609-002', type: 'correction', days: 11, done: 5, status: 'awaiting_approval' },
      { practiceId: ctx.practiceA, ref: 'DSR-2608-021', type: 'paia', days: 24, done: 6, status: 'fulfilled' },
    ];
    for (const d of dsrDefs) {
      const receivedAt = new Date(Date.now() - d.days * DAY).toISOString();
      await db.insert(s.dataSubjectRequests).values({
        id: newId('dsr'), practiceId: d.practiceId, ref: d.ref, type: d.type, requesterMasked: `····${String(1000 + Math.floor(r() * 8999))}`,
        channel: 'patient_space', identityVerified: d.done >= 1, receivedAt,
        statutoryDays: 30, statutoryDueAt: new Date(new Date(receivedAt).getTime() + 30 * DAY).toISOString(),
        policyDays: 14, policyDueAt: new Date(new Date(receivedAt).getTime() + 14 * DAY).toISOString(),
        status: d.status, checklist: dsrChecklist.map((item, i) => ({ item, done: i < d.done, at: i < d.done ? new Date(new Date(receivedAt).getTime() + (i + 1) * 3600000).toISOString() : undefined })),
        fulfilledAt: d.status === 'fulfilled' ? new Date(new Date(receivedAt).getTime() + 19 * DAY).toISOString() : null,
        releasedBy: d.status === 'fulfilled' ? ctx.users['CMP'] ?? null : null,
        redactions: d.type === 'paia' ? [{ item: 'Referrer’s private clinical notes', ground: 'PAIA third-party information' }] : null,
      });
    }
    summary.dataSubjectRequests = dsrDefs.length;

    // Audits and findings
    const auditDefs = [
      { practiceId: ctx.practiceA, ref: 'AUD-2609-01', type: 'internal', scope: 'Radiation safety self-inspection: licences, QA, dosimetry, RPO appointment', status: 'reported', findings: [{ grade: 'minor', description: 'Two QA certificates filed without the inspection body reference', owner: 'BIO', dueOffset: 12 }, { grade: 'observation', description: 'Controlled-area signage at Randburg Room 2 is faded', owner: 'PRM', dueOffset: 30 }] },
      { practiceId: ctx.practiceA, ref: 'AUD-2608-02', type: 'accreditation', scope: 'Facility accreditation readiness (COHSASA-style)', status: 'reported', findings: [{ grade: 'major', description: 'Emergency trolley checklist not completed on 4 of 30 sampled days', owner: 'NUR', dueOffset: -3 }, { grade: 'minor', description: 'Fire equipment service certificate expires within 60 days', owner: 'PRM', dueOffset: 45 }, { grade: 'observation', description: 'Patient information leaflets available in 3 of 5 site languages', owner: 'PRM', dueOffset: 60 }] },
      { practiceId: ctx.practiceB, ref: 'AUD-2609-03', type: 'popia', scope: 'POPIA processing register and access review', status: 'in_progress', findings: [{ grade: 'minor', description: 'Two operator agreements pending counter-signature', owner: 'CMP', dueOffset: 20 }] },
      { practiceId: ctx.practiceB, ref: 'AUD-2609-04', type: 'funder', scope: 'Scheme claims audit: 50 random claims for coding accuracy', status: 'planned', findings: [] },
    ];
    let findingCount = 0;
    for (const a of auditDefs) {
      const auditId = newId('aud');
      await db.insert(s.audits).values({
        id: auditId, practiceId: a.practiceId, ref: a.ref, type: a.type, scope: a.scope, auditor: a.type === 'internal' ? 'CMP with the RPO' : a.type === 'funder' ? 'Scheme A (demo)' : 'External assessor (demo)',
        scheduledAt: addDays(today, a.status === 'planned' ? 21 : -20), completedAt: a.status === 'reported' ? addDays(today, -14) : null, status: a.status,
        checklist: [{ item: 'Evidence index generated', result: a.status === 'planned' ? 'pending' : 'pass' }, { item: 'Sampling completed', result: a.status === 'reported' ? 'pass' : 'pending' }],
      });
      for (const f of a.findings) {
        await db.insert(s.auditFindings).values({ id: newId('fnd'), practiceId: a.practiceId, auditId, grade: f.grade, description: f.description, owner: f.owner, dueDate: addDays(today, f.dueOffset), status: 'open' });
        findingCount++;
      }
    }
    summary.audits = auditDefs.length;
    summary.auditFindings = findingCount;

    // Reportable results (six rows across categories, per docs/24 §3).
    const rrDefs = [
      { practiceId: ctx.practiceA, siteId: ctx.sites.RBG, ref: 'RR-2609-014', category: 'tb_suggestive', label: 'TB-suggestive: consider notifiable medical condition', patient: '····4471 · M 38', referrer: 'Dr R. Pillay', ackHours: 24, status: 'acknowledged', ackAgoHours: 2, pack: 'NMC guidance and notification channel' },
      { practiceId: ctx.practiceA, siteId: ctx.sites.SAN, ref: 'RR-2609-013', category: 'nai_child', label: 'Suspected non-accidental injury (child)', patient: '····0921 · F 3', referrer: 'Casualty, Umhlanga Hospital (demo)', ackHours: 1, status: 'acknowledged', ackAgoHours: 20, pack: 'Children’s Act s.110 form pre-filled; skeletal survey offered', withhold: true },
      { practiceId: ctx.practiceA, siteId: ctx.sites.RBG, ref: 'RR-2609-011', category: 'occupational_lung', label: 'Possible occupational lung disease (ILO classification)', patient: '····5530 · M 52', referrer: 'Dr L. Ndlovu', ackHours: 24, status: 'open', createdAgoHours: 19, pack: 'ODMWA / MBOD pack for the employer and occupational health practitioner' },
      { practiceId: ctx.practiceA, siteId: ctx.sites.SAN, ref: 'RR-2609-009', category: 'radiation_incident', label: 'Radiation incident: wrong-patient or unintended exposure', patient: '····7712 · M 61', referrer: null, ackHours: 4, status: 'acknowledged', ackAgoHours: 100, pack: 'SAHPRA notification drafted by the Compliance Hand', linkIncident: wrongPatientId },
      { practiceId: ctx.practiceA, siteId: ctx.sites.SAN, ref: 'RR-2608-042', category: 'tb_suggestive', label: 'TB-suggestive: consider notifiable medical condition', patient: '····3388 · F 27', referrer: 'Dr J. van Wyk', ackHours: 24, status: 'closed', ackAgoHours: 320, pack: 'NMC guidance' },
      { practiceId: ctx.practiceB, siteId: ctx.sites.UMH, ref: 'RR-2608-037', category: 'malignancy_followup', label: 'Suspicious for malignancy: follow-up tracking', patient: '····6104 · F 58', referrer: 'Dr M. Sibanda', ackHours: 24, status: 'closed', ackAgoHours: 460, pack: 'Follow-up loop; oncology referral confirmed', withhold: true },
    ];
    for (const rr of rrDefs) {
      const createdAt = new Date(Date.now() - (rr.createdAgoHours ?? rr.ackAgoHours ?? 24) * 3600000 - 3600000).toISOString();
      await db.insert(s.reportableResults).values({
        id: newId('rr'), practiceId: rr.practiceId, siteId: rr.siteId, ref: rr.ref, category: rr.category, categoryLabel: rr.label,
        patientMasked: rr.patient, referrerName: rr.referrer, ackWindowHours: rr.ackHours,
        ackDueAt: new Date(new Date(createdAt).getTime() + rr.ackHours * 3600000).toISOString(),
        ackAt: rr.status === 'open' ? null : new Date(Date.now() - (rr.ackAgoHours ?? 1) * 3600000).toISOString(),
        ackBy: rr.status === 'open' ? null : rr.referrer ?? 'CMP (internal disclosure)',
        packName: rr.pack, packSentAt: createdAt, packChannel: 'Referrer Space and WhatsApp',
        status: rr.status, patientReleaseWithheld: !!rr.withhold, escalations: rr.status === 'open' ? 0 : 0,
        linkedIncidentId: rr.linkIncident ?? null, closedAt: rr.status === 'closed' ? new Date(Date.now() - 40 * 3600000).toISOString() : null,
        closedBy: rr.status === 'closed' ? ctx.users['CMP'] ?? null : null, createdAt,
      });
    }
    summary.reportableResults = rrDefs.length;

    // Evidence packs
    for (const [kind, title] of [['sahpra', 'SAHPRA inspection pack'], ['popia', 'Information Regulator readiness pack'], ['hpcsa', 'HPCSA practice evidence pack']] as const) {
      await db.insert(s.evidencePacks).values({
        id: newId('pack'), practiceId: ctx.practiceA, kind, title: `${title} · ${addDays(today, -6)}`, status: 'ready',
        manifest: { generatedAt: new Date(Date.now() - 6 * DAY).toISOString(), definitionsVersion: 'statutory register v1 (docs/24)', auditRange: { from: addDays(today, -365), to: addDays(today, -6) }, items: [{ section: 'Index', source: 'obligations', count: 12, hash: 'a41f22090cd41b77' }] },
        html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>Generated for CMP review. Nothing in this pack has been submitted to a regulator. DEMO synthetic data.</p></body></html>`,
        generatedBy: 'compliance_hand',
      });
    }
    summary.evidencePacks = 3;
  }

  /* ================= M16 Analytics: snapshots, scenarios, questions, acquisitions ================= */
  if ((await db.select({ id: s.metricSnapshots.id }).from(s.metricSnapshots).limit(1)).length === 0) {
    // 90 days of daily snapshots for the metrics the dashboards trend.
    const trended = ['OPS.WAIT', 'OPS.UTIL', 'OPS.TAT.SLA', 'OPS.TAT.SEG', 'ACC.TTA', 'ACC.NOSHOW', 'RCM.FPA', 'RCM.DSO', 'RCM.POS', 'RCM.UNBILLED', 'FIN.REV', 'FIN.EBITDA', 'PXP.NPS', 'WFM.VAC', 'WFM.OT', 'AST.UP', 'AST.MTTR', 'CMP.INC', 'CMP.CAL', 'AIO.SLIP', 'REF.ACTIVE', 'SHR.DP', 'SHR.VAL', 'CLQ.DRL', 'CLQ.CRIT.ACK'];
    const base: Record<string, number> = { 'OPS.WAIT': 21, 'OPS.UTIL': 78, 'OPS.TAT.SLA': 94, 'OPS.TAT.SEG': 168, 'ACC.TTA': 2.2, 'ACC.NOSHOW': 5.6, 'RCM.FPA': 95.4, 'RCM.DSO': 38, 'RCM.POS': 88, 'RCM.UNBILLED': 21_460_000, 'FIN.REV': 41_600_000, 'FIN.EBITDA': 24.1, 'PXP.NPS': 58, 'WFM.VAC': 2.8, 'WFM.OT': 4.4, 'AST.UP': 98.2, 'AST.MTTR': 7.4, 'CMP.INC': 3, 'CMP.CAL': 1, 'AIO.SLIP': 0, 'REF.ACTIVE': 46, 'SHR.DP': 14_120_000, 'SHR.VAL': 19800, 'CLQ.DRL': 0.92, 'CLQ.CRIT.ACK': 34 };
    let snapCount = 0;
    for (const practiceId of practices) {
      const scale = practiceId === ctx.practiceB ? 0.86 : 1;
      for (let d = 89; d >= 0; d--) {
        const date = addDays(today, -d);
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        for (const metricId of trended) {
          const b = base[metricId]! * (['FIN.REV', 'RCM.UNBILLED', 'SHR.DP', 'SHR.VAL', 'REF.ACTIVE', 'CMP.INC'].includes(metricId) ? scale : 1);
          const seasonal = dow === 0 ? 0.55 : dow === 6 ? 0.8 : 1;
          const drift = 1 + (89 - d) * (metricId === 'OPS.TAT.SLA' || metricId === 'RCM.FPA' ? 0.0004 : metricId === 'RCM.DSO' ? -0.0006 : 0.0002);
          const noise = 1 + (r() - 0.5) * 0.08;
          let value = b * drift * noise * (['FIN.REV', 'SHR.VAL', 'REF.ACTIVE'].includes(metricId) ? seasonal : 1);
          if (metricId === 'AIO.SLIP') value = 0;
          if (metricId === 'CMP.INC') value = Math.max(0, Math.round(value));
          if (metricId === 'CMP.CAL') value = d < 5 ? 1 : 0;
          if (metricId === 'OPS.WAIT' && d === 0) value = 27;
          const decimals = ['FIN.REV', 'RCM.UNBILLED', 'SHR.DP', 'SHR.VAL', 'REF.ACTIVE', 'CMP.INC', 'CMP.CAL', 'AIO.SLIP', 'PXP.NPS'].includes(metricId) ? 0 : 1;
          await db.insert(s.metricSnapshots).values({ id: newId('ms'), practiceId, siteId: null, metricId, date, value: Math.round(value * 10 ** decimals) / 10 ** decimals, source: 'seeded' });
          snapCount++;
        }
      }
    }
    summary.metricSnapshots = snapCount;
    summary.metricDefinitions = METRICS.length;

    // Saved questions for the Insight Hand panel.
    const questions = [
      { q: 'Which sites are over 85 % CT utilisation for three months?', metricIds: ['OPS.UTIL'], practiceId: null },
      { q: 'Which referrers dropped more than 30 % this month?', metricIds: ['REF.CHURN', 'REF.VOL'], practiceId: null },
      { q: 'What is our first-pass acceptance trend since June?', metricIds: ['RCM.FPA'], practiceId: ctx.practiceA },
      { q: 'How many roster gaps are open in the next two weeks?', metricIds: ['WFM.VAC'], practiceId: ctx.practiceB },
    ];
    for (const q of questions) {
      await db.insert(s.savedQuestions).values({ id: newId('sq'), practiceId: q.practiceId, userId: ctx.users['EXE'] ?? null, persona: 'EXE', question: q.q, metricIds: q.metricIds, answer: null, pinned: true });
    }
    summary.savedQuestions = questions.length;

    // A what-if scenario (second MRI at Umhlanga).
    await db.insert(s.scenarios).values({
      id: newId('scn'), practiceId: ctx.practiceB, siteId: ctx.sites.UMH, kind: 'second_modality', name: 'Second MRI · Umhlanga',
      inputs: { modality: 'MR', capexCents: 2_840_000_000, studiesPerDayYear1: 22, rampMonths: 6, revenuePerStudyCents: 420_000 },
      outputs: { paybackMonths: 31, utilisationYear1Pct: 68, irrPct: 19.4, ebitdaYear2Cents: 210_000_000 },
      provenance: { modelId: 'capex-whatif', modelVersion: '1.8.0', outputClass: 4, createdAt: new Date(Date.now() - 3 * DAY).toISOString(), demo: true },
      createdBy: ctx.users['EXE'] ?? null,
    });
    summary.scenarios = 1;

    // Acquisition pipeline with the Onboarding Hand checklist.
    const checklist = [
      { day: 1, item: 'Entity, shareholders and management agreement captured (BCI-DOC-CONTRACT extraction reviewed)' },
      { day: 1, item: 'Merger-threshold assessment recorded (Competition Act, thresholds illustrative)' },
      { day: 2, item: 'Sites, rooms and modalities registered with SAHPRA licence documents' },
      { day: 2, item: 'Radiation Protection Officer and Information Officer named' },
      { day: 3, item: 'Fee schedules and funder contracts staged (not activated)' },
      { day: 3, item: 'Claims switch and remittance feeds configured' },
      { day: 4, item: 'Users proposed from role templates; HPCSA verification queued' },
      { day: 4, item: 'Edge Gateway enrolled; DICOM MWL, MPPS and C-STORE conformance passed' },
      { day: 5, item: 'Report templates, rule packs and reportable-result statements loaded' },
      { day: 5, item: 'Go-live checklist signed by SUP and PRM; fee schedule activated by a human' },
    ];
    const acqDefs = [
      { name: 'Two-site practice · Polokwane North', region: 'Limpopo', sites: ['Polokwane North', 'Polokwane CBD'], modalities: ['DX', 'US'], stage: 'target', owner: 'CEO', ebitda: 410_000_000, done: 0, notes: 'Indicative EBITDA R 4.1 m; approach letter sent' },
      { name: 'Single-site MRI practice · Cape Town CBD', region: 'Western Cape', sites: ['Cape Town CBD'], modalities: ['MR'], stage: 'target', owner: 'CFO', ebitda: 260_000_000, done: 0, notes: '1.5 T; lease to 2029; first meeting scheduled' },
      { name: 'Three-site practice · Free State', region: 'Free State', sites: ['Bloemfontein Central', 'Welkom', 'Bethlehem'], modalities: ['DX', 'CT', 'US'], stage: 'due_diligence', owner: 'CFO', ebitda: 890_000_000, done: 2, notes: 'Data room open; SAHPRA licences verified 6 of 7; debtor book ageing under review' },
      { name: 'Mpumalanga group · Nelspruit, White River, Secunda', region: 'Mpumalanga', sites: ['Nelspruit', 'White River', 'Secunda'], modalities: ['DX', 'CT', 'US', 'MG'], stage: 'onboarding', owner: 'CEO', ebitda: 1_240_000_000, done: 6, jv: '60/40', effective: addDays(today, 15), notes: 'Day 3 of 5; gateways enrolled; funders and switch today' },
      { name: 'Kimberley · Practice K', region: 'Northern Cape', sites: ['Kimberley'], modalities: ['DX', 'CT'], stage: 'live', owner: 'COO', ebitda: 320_000_000, done: 10, notes: 'Live since 1 Aug; first-pass acceptance 93.9 % against Group 95.8 %; target within 2 points by October' },
    ];
    for (const a of acqDefs) {
      await db.insert(s.acquisitions).values({
        id: newId('acq'), practiceId: null, name: a.name, region: a.region, sites: a.sites, modalities: a.modalities, stage: a.stage, owner: a.owner,
        indicativeEbitdaCents: a.ebitda, jvSplit: a.jv ?? null, effectiveDate: a.effective ?? null,
        mergerThreshold: a.stage === 'target' ? { assessed: false } : { assessed: true, category: a.sites.length > 2 ? 'intermediate' : 'small', notifiable: a.sites.length > 2, note: 'Thresholds illustrative; confirm current values before filing' },
        checklist: checklist.map((x, i) => ({ ...x, done: i < a.done, at: i < a.done ? new Date(Date.now() - (a.done - i) * DAY).toISOString() : undefined, by: i < a.done ? 'onboarding_hand' : undefined })),
        notes: a.notes,
      });
    }
    summary.acquisitions = acqDefs.length;

    // A board pack for the current period.
    await db.insert(s.boardPacks).values({
      id: newId('bp'), practiceId: null, period: today.slice(0, 7), title: `Board pack ${today.slice(0, 7)} · Group`, status: 'draft',
      content: { period: today.slice(0, 7), generatedAt: now, scope: 'group', note: 'Regenerate from /api/analytics/board-pack for live figures.' },
      generatedBy: ctx.users['EXE'] ?? null,
    });
    summary.boardPacks = 1;
  }

  ctx.extra.clusterD = { seeded: true };
  return summary;
}
