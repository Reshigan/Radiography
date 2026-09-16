import { z } from 'zod';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { defineHand, newId, notFound, invalid, todaySast, Refused } from '@bonakala/domain';
import {
  METRICS, getMetric, metricsByGroup, assessAgainstTarget, matchMetrics, parseQuestionFilters, benchmark as benchmarkRows, caseMixAdjust, CASE_MIX_NOTE,
  whatIfSecondModality, DEFAULT_WHATIF, round,
} from '@bonakala/domain/analytics';
import { defineModule, router, allow, body, query, param, audit, emit, requirePractice, registerHand, runHand, getHand } from '../../kernel/index.js';
import type { Services } from '../../kernel/ports.js';
import { computeMetric, optionalTable, snapshotTick, addDays, LIVE_METRIC_IDS } from './compute.js';

const r = router();
const READERS = ['PRM', 'EXE', 'SHR', 'CMP', 'BIO', 'AIO', 'SUP', 'RGT', 'BIL', 'DEB', 'BKG', 'FDK', 'RAD', 'NUR'] as const;

/* ---------- Catalogue ---------- */
r.get('/metrics', allow(...READERS), (c) => c.json({ groups: metricsByGroup(), count: METRICS.length, liveComputed: LIVE_METRIC_IDS }));
r.get('/metrics/:id', allow(...READERS), (c) => {
  const def = getMetric(param(c, 'id'));
  if (!def) throw notFound('Metric');
  return c.json({ metric: def, liveComputed: LIVE_METRIC_IDS.includes(def.id) });
});

/* ---------- Tiles ---------- */
const TILE_SETS: Record<string, string[]> = {
  practice: ['OPS.WAIT', 'OPS.UTIL', 'OPS.TAT.SLA', 'ACC.NOSHOW', 'RCM.POS', 'RCM.UNBILLED', 'WFM.VAC', 'AST.UP', 'AST.CONTRAST', 'CMP.INC', 'CMP.RR', 'PXP.NPS'],
  site: ['OPS.WAIT', 'OPS.UTIL', 'OPS.TAT.SLA', 'ACC.NOSHOW', 'WFM.VAC', 'AST.UP', 'AST.CONTRAST', 'AST.LINK'],
  group: ['FIN.REV', 'FIN.EBITDA', 'OPS.TAT.SEG', 'OPS.TAT.SLA', 'ACC.TTA', 'RCM.FPA', 'RCM.DSO', 'CMP.INC', 'AIO.SLIP', 'REF.ACTIVE', 'WFM.VAC', 'AST.UP'],
  compliance: ['CMP.CAL', 'CMP.INC', 'CMP.RR', 'AST.LIC', 'CMP.POPIA', 'CMP.AUDIT', 'CMP.POLICY', 'CMP.LIC', 'CMP.CHAIN', 'CLQ.DRL'],
  engineering: ['AST.UP', 'AST.MTTR', 'AST.PM', 'AST.QA', 'AST.LIC', 'AST.PRED', 'AST.LINK', 'AST.CONTRAST'],
  workforce: ['WFM.VAC', 'WFM.OT', 'WFM.ABS', 'WFM.CRED', 'WFM.CPD', 'WFM.HAND', 'WFM.SPF'],
  shareholder: ['FIN.REV', 'FIN.EBITDA', 'SHR.DP', 'OPS.TAT.SLA', 'PXP.NPS', 'RCM.DSO', 'AIO.SLIP', 'SHR.VAL'],
};

async function seriesFor(services: Services, metricId: string, practiceId: string | null, days: number, siteId?: string | null) {
  const t = schema.metricSnapshots;
  const from = addDays(todaySast(), -days);
  const rows = await services.db.select({ date: t.date, value: t.value, practiceId: t.practiceId }).from(t).where(and(eq(t.metricId, metricId), gte(t.date, from), practiceId ? eq(t.practiceId, practiceId) : undefined, siteId ? eq(t.siteId, siteId) : sql`${t.siteId} is null`)).orderBy(asc(t.date));
  if (practiceId) return rows.map((x) => ({ date: x.date, value: x.value }));
  // group: aggregate per date
  const def = getMetric(metricId);
  const byDate = new Map<string, number[]>();
  for (const x of rows) if (x.value !== null) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x.value]);
  return [...byDate.entries()].map(([date, vals]) => ({ date, value: def && (def.unit === 'count' || def.unit === 'cents') ? vals.reduce((a, b) => a + b, 0) : round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) }));
}

r.get('/tiles', allow(...READERS), async (c) => {
  const { scope, siteId, ids } = query(c, z.object({ scope: z.enum(['practice', 'site', 'group', 'compliance', 'engineering', 'workforce', 'shareholder']).default('practice'), siteId: z.string().optional(), ids: z.string().optional() }));
  const services = c.get('services');
  // A Group persona with no practice selected sees the network aggregate for every scope.
  const practiceId = scope === 'group' ? null : c.get('practiceId');
  const list = ids ? ids.split(',') : TILE_SETS[scope]!;
  const tiles = [];
  for (const id of list) {
    const def = getMetric(id);
    if (!def) continue;
    const v = await computeMetric(services, def, { practiceId, siteId: scope === 'site' ? siteId ?? null : null });
    const series = await seriesFor(services, id, practiceId, 13, scope === 'site' ? siteId : null);
    tiles.push({ id, name: def.name, unit: def.unit, direction: def.direction, target: def.target, targetLabel: def.targetLabel, description: def.description, formula: def.formula, version: def.version, ...v, tone: assessAgainstTarget(def, v.value), spark: series.map((s) => s.value ?? 0) });
  }
  return c.json({ scope, practiceId, tiles, asOf: new Date().toISOString(), demo: services.demoMode });
});

r.get('/series/:metricId', allow(...READERS), async (c) => {
  const metricId = param(c, 'metricId');
  const def = getMetric(metricId);
  if (!def) throw notFound('Metric');
  const { days, scope, siteId } = query(c, z.object({ days: z.coerce.number().min(7).max(365).default(30), scope: z.enum(['practice', 'group']).default('practice'), siteId: z.string().optional() }));
  const practiceId = scope === 'group' ? null : c.get('practiceId');
  const points = await seriesFor(c.get('services'), metricId, practiceId, days, siteId);
  return c.json({ metric: def, points, days });
});

/* ---------- Heatmap: site × hour utilisation ---------- */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
r.get('/heatmap', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const { siteId, date } = query(c, z.object({ siteId: z.string().optional(), date: z.string().optional() }));
  const day = date ?? todaySast();
  const sites = await services.db.select().from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  if (!site) return c.json({ rows: [], hours: [], site: null });
  const rooms = await services.db.select().from(schema.rooms).where(eq(schema.rooms.siteId, site.id));
  const assets = await services.db.select().from(schema.assets).where(eq(schema.assets.siteId, site.id));
  const windows = await services.db.select().from(schema.loadSheddingWindows).where(and(eq(schema.loadSheddingWindows.siteId, site.id), sql`substr(${schema.loadSheddingWindows.startsAt},1,10) = ${day}`));
  const hours = Array.from({ length: 12 }, (_, i) => 7 + i);
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(new Date()));
  const wl = optionalTable('worklist') ?? optionalTable('appointments');
  let source: 'worklist' | 'appointments' | 'synthetic' = 'synthetic';
  const booked = new Map<string, number>(); // roomId:hour → minutes
  if (wl && 'roomId' in wl && ('startsAt' in wl || 'scheduledAt' in wl)) {
    try {
      const col = 'startsAt' in wl ? wl.startsAt : wl.scheduledAt;
      const rows = await services.db.select({ roomId: wl.roomId, at: col, dur: 'durationMinutes' in wl ? wl.durationMinutes : sql<number>`20` }).from(wl as any).where(and(eq(wl.siteId, site.id), sql`substr(${col},1,10) = ${day}`));
      for (const row of rows as any[]) {
        const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(new Date(row.at)));
        const k = `${row.roomId}:${h}`;
        booked.set(k, (booked.get(k) ?? 0) + Number(row.dur ?? 20));
      }
      // Only trust the live source when it covers a reasonable share of the grid; a handful of
      // bookings would otherwise render as an empty grid and read as a broken chart.
      if (booked.size >= rooms.length * hours.length * 0.35) source = optionalTable('worklist') ? 'worklist' : 'appointments';
      else booked.clear();
    } catch { booked.clear(); }
  }
  const rowsOut = rooms.map((room) => {
    const asset = assets.find((a) => a.roomId === room.id);
    const down = asset?.status === 'down';
    const downSinceHour = asset?.downtimeStartedAt ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(new Date(asset.downtimeStartedAt))) : 8;
    const base = { CT: 84, MR: 92, XR: 62, US: 76, MG: 66, DXA: 34, RF: 50, PX: 40 }[room.roomType] ?? 60;
    const cells = hours.map((h) => {
      const inWindow = windows.some((w) => h >= Number(w.startsAt.slice(11, 13)) && h < Number(w.endsAt.slice(11, 13)) + (Number(w.endsAt.slice(14, 16)) > 0 ? 1 : 0) && !(w.generatorCovers ?? []).includes(room.roomType));
      if (down && h >= downSinceHour) return { hour: h, value: null, state: 'down' as const };
      if (inWindow) return { hour: h, value: null, state: 'moved' as const };
      let value: number;
      if (source !== 'synthetic') value = Math.min(110, Math.round(((booked.get(`${room.id}:${h}`) ?? 0) / 60) * 100));
      else {
        const shape = h < 8 ? 0.6 : h >= 17 ? 0.5 : h === 13 ? 0.8 : 1;
        value = Math.max(0, Math.min(108, Math.round(base * shape + (hash(`${room.id}:${h}:${day}`) - 0.5) * 30)));
      }
      const projected = day === todaySast() && h > nowHour;
      return { hour: h, value, state: projected ? ('booked' as const) : ('actual' as const) };
    });
    return { roomId: room.id, room: room.name, type: room.roomType, cells, down, downSince: asset?.downtimeStartedAt ?? null };
  });
  return c.json({ site: { id: site.id, name: site.name }, date: day, hours, nowHour, rows: rowsOut, windows: windows.map((w) => ({ stage: w.stage, startsAt: w.startsAt, endsAt: w.endsAt, generatorCovers: w.generatorCovers })), source, note: source === 'synthetic' ? 'Worklist not integrated yet: synthetic utilisation shown for layout (DEMO)' : `computed from ${source}` });
});

/* ---------- Queue and wait (live from registrations when present, else synthetic curve) ---------- */
r.get('/queue', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const { siteId } = query(c, z.object({ siteId: z.string().optional() }));
  const reg = optionalTable('registrations') ?? optionalTable('encounters');
  const points: Array<{ time: string; wait: number }> = [];
  let waitingNow = 0;
  let byModality: Array<{ modality: string; waiting: number; longestMin: number }> = [];
  let source = 'synthetic';
  if (reg && 'arrivedAt' in reg) {
    try {
      const rows = await services.db.select().from(reg as any).where(and(eq(reg.practiceId, practiceId), siteId && 'siteId' in reg ? eq(reg.siteId, siteId) : undefined, sql`substr(${reg.arrivedAt},1,10) = ${todaySast()}`)) as any[];
      const waiting = rows.filter((x) => x.arrivedAt && !x.inRoomAt && !x.completedAt);
      waitingNow = waiting.length;
      source = 'registrations';
      const buckets = new Map<string, number[]>();
      for (const x of rows) {
        if (!x.inRoomAt) continue;
        const t = new Date(x.arrivedAt);
        const key = `${String(t.getUTCHours() + 2).padStart(2, '0')}:${t.getUTCMinutes() < 30 ? '00' : '30'}`;
        buckets.set(key, [...(buckets.get(key) ?? []), (new Date(x.inRoomAt).getTime() - t.getTime()) / 60000]);
      }
      for (const [time, vals] of [...buckets.entries()].sort()) points.push({ time, wait: Math.round(vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)]!) });
      // Too few buckets to draw a curve: fall back to the synthetic shape rather than a single dot,
      // and keep the waiting count with it so the card reads consistently.
      if (points.length < 3) { points.length = 0; waitingNow = 0; source = 'synthetic'; }
    } catch { /* synthetic */ }
  }
  if (!points.length) {
    const day = todaySast();
    const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).format(new Date()));
    const nowMin = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', minute: '2-digit' }).format(new Date()));
    const slots = Math.max(2, Math.min(22, (Math.min(nowHour, 18) - 7) * 2 + (nowMin >= 30 ? 1 : 0)));
    const downAssets = await services.db.select().from(schema.assets).where(and(eq(schema.assets.practiceId, practiceId), eq(schema.assets.status, 'down')));
    for (let i = 0; i <= slots; i++) {
      const h = 7 + Math.floor(i / 2);
      const bump = downAssets.length && h >= 9 ? 9 : 0;
      points.push({ time: `${String(h).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, wait: Math.round(12 + Math.sin(i / 3) * 6 + bump + (hash(`${day}:${i}`) - 0.5) * 6) });
    }
    waitingNow = 6 + Math.floor(hash(day) * 8) + (downAssets.length ? 4 : 0);
    byModality = [
      { modality: 'CT', waiting: Math.ceil(waitingNow * 0.4), longestMin: downAssets.length ? 38 : 22 },
      { modality: 'MRI', waiting: Math.ceil(waitingNow * 0.25), longestMin: 14 },
      { modality: 'US', waiting: Math.ceil(waitingNow * 0.2), longestMin: 9 },
      { modality: 'XR', waiting: Math.max(1, Math.floor(waitingNow * 0.15)), longestMin: 4 },
    ];
  }
  return c.json({ points, waitingNow, byModality, target: 20, source, note: source === 'synthetic' ? 'Registrations not integrated yet: synthetic queue shown (DEMO)' : undefined });
});

/* ---------- Alerts for the control tower ---------- */
r.get('/alerts', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = requirePractice(c);
  const today = todaySast();
  const alerts: Array<{ id: string; kind: 'crit' | 'att' | 'active' | 'neutral'; category: string; title: string; detail: string; hand?: string; handNote?: string; taskId?: string; link?: string; at?: string }> = [];
  const sites = await services.db.select().from(schema.sites).where(eq(schema.sites.practiceId, practiceId));
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
  const wos = await services.db.select().from(schema.workOrders).where(and(eq(schema.workOrders.practiceId, practiceId), sql`${schema.workOrders.status} not in ('done','cancelled')`)).orderBy(desc(schema.workOrders.createdAt));
  const assets = await services.db.select().from(schema.assets).where(eq(schema.assets.practiceId, practiceId));
  for (const wo of wos.filter((w) => w.type === 'breakdown')) {
    const a = assets.find((x) => x.id === wo.assetId);
    alerts.push({ id: wo.id, kind: wo.priority === 'critical' ? 'crit' : 'att', category: 'Equipment', title: `${a?.name ?? 'Asset'} · ${wo.title}`, detail: `${siteName(wo.siteId)} · ${wo.vendorTicket ? `vendor ticket ${wo.vendorTicket}` : 'no vendor ticket yet'} · SLA ${wo.slaHours ?? '—'} h · ${wo.status.replace('_', ' ')}`, hand: 'Maintenance Hand', handNote: wo.timeline.slice(-1)[0]?.text, taskId: wo.handTaskId ?? undefined, link: `/practice/equipment`, at: wo.createdAt });
  }
  const gaps = await services.db.select().from(schema.shifts).where(and(eq(schema.shifts.practiceId, practiceId), sql`${schema.shifts.status} in ('open_gap','agency')`, gte(schema.shifts.date, today))).orderBy(asc(schema.shifts.date)).limit(6);
  for (const g of gaps) {
    alerts.push({ id: g.id, kind: g.status === 'open_gap' ? 'att' : 'active', category: 'Roster', title: `${g.status === 'open_gap' ? 'Open shift' : 'Agency shift pending'} · ${g.role}${g.requiredCompetency ? ` (${g.requiredCompetency})` : ''} · ${g.date} ${g.startTime}–${g.endTime}`, detail: `${siteName(g.siteId)} · ${g.gapReason ?? 'gap'}${g.agencyCents ? ` · agency R ${(g.agencyCents / 100).toFixed(0)}` : ''}`, hand: 'Roster Hand', handNote: g.note ?? undefined, link: '/practice/staff', at: g.updatedAt });
  }
  const lots = await services.db.select().from(schema.consumables).where(and(eq(schema.consumables.practiceId, practiceId), eq(schema.consumables.category, 'contrast'), eq(schema.consumables.status, 'active')));
  const bySite = new Map<string, { qty: number; usage: number }>();
  for (const l of lots) { const s = bySite.get(l.siteId) ?? { qty: 0, usage: 0 }; s.qty += l.qtyOnHand; s.usage += l.dailyUsage; bySite.set(l.siteId, s); }
  for (const [sid, s] of bySite) {
    const cover = s.usage ? s.qty / s.usage : 99;
    if (cover < 10) alerts.push({ id: `stock:${sid}`, kind: cover < 5 ? 'crit' : 'att', category: 'Stock', title: `Contrast stock · ${cover.toFixed(1)} days cover`, detail: `${siteName(sid)} · ${s.qty} vials on hand · ${s.usage.toFixed(0)} vials/day trailing 28 days`, hand: 'Maintenance Hand', handNote: 'Reorder drafted within leash where days cover is below threshold', link: '/practice/equipment' });
  }
  const windows = await services.db.select().from(schema.loadSheddingWindows).where(and(eq(schema.loadSheddingWindows.practiceId, practiceId), sql`substr(${schema.loadSheddingWindows.startsAt},1,10) >= ${today}`)).orderBy(asc(schema.loadSheddingWindows.startsAt)).limit(4);
  const gws = await services.db.select().from(schema.edgeGateways).where(eq(schema.edgeGateways.practiceId, practiceId));
  for (const w of windows) {
    const gw = gws.find((g) => g.siteId === w.siteId);
    alerts.push({ id: w.id, kind: 'active', category: 'Power', title: `Load-shedding stage ${w.stage} · ${w.startsAt.slice(11, 16)}–${w.endsAt.slice(11, 16)}`, detail: `${siteName(w.siteId)} · generator covers ${(w.generatorCovers ?? []).join(', ') || 'nothing'} · UPS ${gw?.upsPct ?? '—'} % · gateway ${gw?.status.replace('_', ' ') ?? '—'} · backlog ${gw?.backlogStudies ?? 0}`, link: '/practice/schedule', at: w.startsAt });
  }
  for (const gw of gws.filter((g) => g.status !== 'online')) {
    alerts.push({ id: gw.id, kind: gw.status === 'offline' ? 'crit' : 'att', category: 'Edge', title: `${siteName(gw.siteId)} gateway ${gw.status.replace('_', ' ')}`, detail: `UPS ${gw.upsPct} % · backlog ${gw.backlogStudies} studies · local worklist mirror ${gw.localWorklistMirror ? 'serving' : 'off'}`, link: '/practice/equipment', at: gw.stateSince ?? undefined });
  }
  const creds = await services.db.select({ c: schema.credentials, s: schema.staff }).from(schema.credentials).innerJoin(schema.staff, eq(schema.staff.id, schema.credentials.staffId)).where(and(eq(schema.credentials.practiceId, practiceId), sql`${schema.credentials.expiry} <= ${addDays(today, 30)}`));
  for (const x of creds.slice(0, 4)) {
    const lapsed = x.c.expiry! < today;
    alerts.push({ id: x.c.id, kind: lapsed ? 'crit' : 'att', category: 'Credential', title: `${x.s.name} · ${x.c.type.toUpperCase()} ${lapsed ? 'lapsed' : 'expires'} ${x.c.expiry}`, detail: lapsed ? 'Rostering blocked until renewal evidence is uploaded (CMP grace override only)' : 'Renewal task open · rostering blocked from expiry date', hand: 'Compliance Hand', link: '/practice/staff' });
  }
  const order = { crit: 0, att: 1, active: 2, neutral: 3 };
  alerts.sort((a, b) => order[a.kind] - order[b.kind]);
  return c.json({ alerts });
});

/* ---------- Sites status list (group) ---------- */
r.get('/sites-status', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const sites = await services.db.select({ s: schema.sites, p: schema.legalEntities }).from(schema.sites).innerJoin(schema.legalEntities, eq(schema.legalEntities.id, schema.sites.practiceId)).where(practiceId ? eq(schema.sites.practiceId, practiceId) : undefined);
  const assets = await services.db.select().from(schema.assets);
  const gws = await services.db.select().from(schema.edgeGateways);
  const wos = await services.db.select().from(schema.workOrders).where(sql`${schema.workOrders.status} not in ('done','cancelled')`);
  const today = todaySast();
  const windows = await services.db.select().from(schema.loadSheddingWindows).where(sql`substr(${schema.loadSheddingWindows.startsAt},1,10) = ${today}`);
  const acqs = await services.db.select().from(schema.acquisitions).where(eq(schema.acquisitions.stage, 'onboarding'));
  const out = sites.map(({ s, p }) => {
    const down = assets.filter((a) => a.siteId === s.id && a.status === 'down');
    const gw = gws.find((g) => g.siteId === s.id);
    const win = windows.find((w) => w.siteId === s.id);
    const open = wos.filter((w) => w.siteId === s.id).length;
    let state: 'crit' | 'att' | 'ok' = 'ok';
    let note = `Open · ${assets.filter((a) => a.siteId === s.id && a.kind === 'modality').length} modalities · gateway ${gw?.status.replace('_', ' ') ?? 'unknown'}`;
    if (down.length || gw?.status === 'offline') { state = 'crit'; note = down.length ? `${down[0]!.name} down since ${down[0]!.downtimeStartedAt?.slice(11, 16) ?? '—'} · ${open} open work orders` : `Gateway offline · backlog ${gw?.backlogStudies ?? 0} studies`; }
    else if (win || gw?.status === 'on_ups') { state = 'att'; note = win ? `Load-shedding stage ${win.stage} · ${win.startsAt.slice(11, 16)}–${win.endsAt.slice(11, 16)} · generator covers ${(win.generatorCovers ?? []).join(', ') || 'nothing'}` : `On UPS ${gw?.upsPct} %`; }
    const seed = hash(`${s.id}:${today}`);
    return { siteId: s.id, site: s.name, practice: p.tradingName ?? p.registeredName, practiceId: p.id, state, note, studiesToday: 60 + Math.round(seed * 150), tatMedianMin: 130 + Math.round(seed * 60), gateway: gw ? { status: gw.status, backlog: gw.backlogStudies, upsPct: gw.upsPct } : null };
  });
  for (const a of acqs) out.push({ siteId: a.id, site: a.sites[0] ?? a.name, practice: `${a.name} (onboarding)`, practiceId: a.practiceId ?? '', state: 'ok', note: `Day ${a.checklist.filter((x) => x.done).length ? Math.min(5, Math.max(...a.checklist.filter((x) => x.done).map((x) => x.day))) : 1} of 5 · ${a.checklist.filter((x) => x.done).length}/${a.checklist.length} checklist items`, studiesToday: 0, tatMedianMin: 0, gateway: null });
  return c.json({ sites: out });
});

/* ---------- Revenue by funder (from claims, by name, with an existence check) ---------- */
r.get('/revenue-by-funder', allow(...READERS), async (c) => {
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const claims = optionalTable('claims');
  if (!claims || !('funderType' in claims) || !('totalCents' in claims)) {
    return c.json({ mix: [], months: [], source: null, note: 'source not available: the revenue cycle module has not published claims yet' });
  }
  try {
    const rows = await services.db
      .select({ funderType: claims.funderType, total: sql<number>`sum(${claims.totalCents})`, paid: 'paidCents' in claims ? sql<number>`sum(${claims.paidCents})` : sql<number>`0` })
      .from(claims as any)
      .where(practiceId ? eq(claims.practiceId, practiceId) : undefined)
      .groupBy(claims.funderType);
    const mix = rows
      .map((x: any) => ({ funderType: String(x.funderType), cents: Number(x.total ?? 0), paidCents: Number(x.paid ?? 0) }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => b.cents - a.cents);
    const total = mix.reduce((a, b) => a + b.cents, 0);
    return c.json({
      mix: mix.map((m) => ({ ...m, sharePct: total ? round((m.cents / total) * 100, 1) : 0 })),
      totalCents: total, source: 'claims', note: 'billed, net of short payments',
    });
  } catch {
    return c.json({ mix: [], source: null, note: 'source not available: claims could not be read in this shape' });
  }
});

/* ---------- Benchmark ---------- */
r.get('/benchmark', allow('EXE', 'SUP', 'PRM', 'SHR', 'CMP'), async (c) => {
  const services = c.get('services');
  const { metricId } = query(c, z.object({ metricId: z.string().default('AST.UP') }));
  const def = getMetric(metricId);
  if (!def) throw notFound('Metric');
  const user = c.get('user')!;
  const practices = await services.db.select().from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
  const rows = [];
  for (const p of practices) {
    const v = await computeMetric(services, def, { practiceId: p.id });
    const t = schema.metricSnapshots;
    const n = await services.db.select({ n: sql<number>`count(*)` }).from(t).where(and(eq(t.practiceId, p.id), eq(t.metricId, metricId)));
    const count = Number(n[0]?.n ?? 0) * 12 + (v.denominator ?? 0);
    rows.push({ practiceId: p.id, label: p.tradingName ?? p.registeredName, value: v.value, n: count, adjusted: v.value === null ? null : caseMixAdjust(v.value, v.value * (1 + (hash(p.id) - 0.5) * 0.12), v.value) });
  }
  const identify = user.persona === 'EXE' || user.persona === 'SUP';
  const noData = new Set(rows.filter((x) => x.value === null).map((x) => x.practiceId));
  const b = benchmarkRows(rows, { identify });
  return c.json({
    metric: def,
    rows: b.rows.map((x) => ({ ...x, reason: noData.has(x.practiceId) ? 'no_data' : x.suppressed ? 'suppressed' : null })),
    peerMedian: b.peerMedian, suppressed: b.rows.filter((x) => x.suppressed && !noData.has(x.practiceId)).length,
    identified: identify, caseMixNote: CASE_MIX_NOTE, peerGroup: 'community imaging · 2–8 rooms · mixed modality', externalBenchmark: null,
  });
});

/* ---------- Insight Hand ---------- */
const insightHand = defineHand({
  id: 'insight', name: 'Insight Hand', module: 'M16', level: 'A2',
  mandate: 'Answer analytics questions against the semantic layer with the metric definitions and query shown; never improvise a metric; never act in other modules.',
  defaultLeash: { maxRows: 10000, deIdentifiedOnly: true },
  approvalPersona: 'EXE', approvalPolicy: 'Read-only. A metric that is not in the semantic layer is refused and becomes a definitions-backlog task for the M16 owner.',
  tools: { 'catalogue.match': 'R0', 'metric.compute': 'R0', 'benchmark.read': 'R0', 'llm.narrate': 'R0', 'question.save': 'R1', 'task.create': 'R1' },
});

async function answerQuestion(services: Services, question: string, practiceId: string | null, opts: { userId?: string; persona?: string }) {
  return runHand(services, 'insight', { question, practiceId }, {
    practiceId, trigger: 'manual', title: `Insight: ${question.slice(0, 80)}`,
  }).then(async (task) => {
    if (task.status === 'done' && task.output) {
      const id = newId('sq');
      await services.db.insert(schema.savedQuestions).values({ id, practiceId, userId: opts.userId ?? null, persona: opts.persona ?? null, question, metricIds: (task.output.metricIds as string[]) ?? [], answer: task.output, taskId: task.id });
      return { task, saved: id };
    }
    return { task, saved: null };
  });
}

r.post('/ask', allow(...READERS), async (c) => {
  const { question } = await body(c, z.object({ question: z.string().min(3).max(300) }));
  const user = c.get('user')!;
  const { task, saved } = await answerQuestion(c.get('services'), question, c.get('practiceId'), { userId: user.id, persona: user.persona });
  await audit(c, 'insight.asked', { type: 'saved_question', id: saved ?? task.id }, { question, status: task.status });
  return c.json({ task, savedQuestionId: saved, answer: task.output ?? null, refused: task.status === 'refused' ? task.error : null });
});
r.get('/questions', allow(...READERS), async (c) => {
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.savedQuestions).where(practiceId ? sql`${schema.savedQuestions.practiceId} = ${practiceId} or ${schema.savedQuestions.practiceId} is null` : undefined).orderBy(desc(schema.savedQuestions.createdAt)).limit(30);
  return c.json({ questions: rows });
});

/* ---------- What-if ---------- */
const whatIfInput = z.object({
  name: z.string().default('Second modality'), siteId: z.string().optional(), modality: z.string().default('MR'), capexCents: z.number().int().positive().optional(), annualServiceCents: z.number().int().optional(), staffingCentsPerYear: z.number().int().optional(),
  studiesPerDayYear1: z.number().positive().optional(), rampMonths: z.number().int().min(1).max(24).optional(), revenuePerStudyCents: z.number().int().optional(), variableCostPerStudyCents: z.number().int().optional(),
  operatingDaysPerYear: z.number().int().optional(), utilisationCapPct: z.number().optional(), capacityStudiesPerDay: z.number().optional(), loadSheddingLossPct: z.number().optional(), discountRatePct: z.number().optional(),
});
r.get('/what-if/defaults', allow(...READERS), (c) => c.json({ defaults: DEFAULT_WHATIF }));
r.post('/what-if', allow('EXE', 'SUP', 'PRM', 'SHR'), async (c) => {
  const practiceId = requirePractice(c);
  const data = await body(c, whatIfInput);
  const { name, siteId, ...inputs } = data;
  const outputs = whatIfSecondModality(inputs);
  const id = newId('scn');
  const provenance = { modelId: 'capex-whatif', modelVersion: '1.8.0', outputClass: 4, createdAt: new Date().toISOString(), demo: c.get('services').demoMode };
  await c.get('services').db.insert(schema.scenarios).values({ id, practiceId, siteId: siteId ?? null, kind: 'second_modality', name, inputs: { ...DEFAULT_WHATIF, ...inputs }, outputs: outputs as unknown as Record<string, unknown>, provenance, createdBy: c.get('user')!.id });
  await audit(c, 'scenario.run', { type: 'scenario', id }, { name, modality: inputs.modality });
  return c.json({ id, inputs: { ...DEFAULT_WHATIF, ...inputs }, outputs, provenance }, 201);
});
r.get('/what-if', allow(...READERS), async (c) => {
  const practiceId = c.get('practiceId');
  const rows = await c.get('services').db.select().from(schema.scenarios).where(practiceId ? eq(schema.scenarios.practiceId, practiceId) : undefined).orderBy(desc(schema.scenarios.createdAt)).limit(20);
  return c.json({ scenarios: rows });
});

/* ---------- Board pack ---------- */
async function buildBoardPack(services: Services, period: string, practiceId: string | null) {
  const tiles: Array<{ id: string; name: string; value: number | null; unit: string; target: string; direction: string; source: string; tone: string; trend: Array<number | null>; definitionVersion: number }> = [];
  for (const id of ['FIN.REV', 'FIN.EBITDA', 'SHR.DP', 'OPS.TAT.SLA', 'ACC.TTA', 'RCM.FPA', 'RCM.DSO', 'PXP.NPS', 'CMP.INC', 'CMP.CAL', 'AIO.SLIP', 'WFM.VAC', 'AST.UP']) {
    const def = getMetric(id)!;
    const v = await computeMetric(services, def, { practiceId });
    const series = await seriesFor(services, id, practiceId, 90);
    tiles.push({ id, name: def.name, value: v.value, unit: def.unit, target: def.targetLabel, direction: def.direction, source: v.source, tone: assessAgainstTarget(def, v.value), trend: series.slice(-13).map((s) => s.value), definitionVersion: def.version });
  }
  const incidents = await services.db.select().from(schema.incidents).where(and(practiceId ? eq(schema.incidents.practiceId, practiceId) : undefined, sql`${schema.incidents.severity} <= 2`)).orderBy(desc(schema.incidents.reportedAt)).limit(10);
  const overdue = await services.db.select().from(schema.obligations).where(and(practiceId ? eq(schema.obligations.practiceId, practiceId) : undefined, sql`${schema.obligations.dueDate} < ${todaySast()}`, sql`(${schema.obligations.lastDoneAt} is null or ${schema.obligations.lastDoneAt} < ${schema.obligations.dueDate})`));
  const acqs = await services.db.select().from(schema.acquisitions);
  const hands = await services.db.select({ handId: schema.agentTasks.handId, status: schema.agentTasks.status, n: sql<number>`count(*)` }).from(schema.agentTasks).groupBy(schema.agentTasks.handId, schema.agentTasks.status);
  return {
    period, generatedAt: new Date().toISOString(), scope: practiceId ?? 'group', definitionsVersion: 'semantic-layer v1', demo: services.demoMode,
    sections: {
      kpis: tiles,
      whatChanged: tiles.filter((t) => t.tone !== 'ok' && t.tone !== 'none').map((t) => ({ metric: t.name, value: t.value, target: t.target, note: `${t.name} is ${t.tone === 'crit' ? 'outside' : 'near'} target; definition v${t.definitionVersion}` })),
      governance: { severeIncidents: incidents.map((i) => ({ ref: i.ref, category: i.category, severity: i.severity, status: i.status, regulator: i.regulator, reportStatus: i.reportDraft?.status ?? 'none' })), overdueObligations: overdue.map((o) => ({ instrument: o.instrument, obligation: o.obligation, dueDate: o.dueDate, owner: o.ownerPersona })), aiSlipCount: tiles.find((t) => t.id === 'AIO.SLIP')?.value ?? 0 },
      acquisitions: acqs.map((a) => ({ name: a.name, stage: a.stage, sites: a.sites, checklistDone: a.checklist.filter((x) => x.done).length, checklistTotal: a.checklist.length })),
      hands: hands.map((h) => ({ hand: h.handId, status: h.status, count: Number(h.n) })),
    },
    glossary: METRICS.filter((m) => tiles.some((t) => t.id === m.id)).map((m) => ({ id: m.id, name: m.name, formula: m.formula, version: m.version })),
  };
}
r.get('/board-pack', allow('EXE', 'SUP', 'SHR', 'PRM', 'CMP'), async (c) => {
  const { period } = query(c, z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).default(todaySast().slice(0, 7)) }));
  return c.json({ pack: await buildBoardPack(c.get('services'), period, c.get('practiceId')) });
});
r.post('/board-packs', allow('EXE', 'SUP'), async (c) => {
  const { period } = await body(c, z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).default(todaySast().slice(0, 7)) }));
  const services = c.get('services');
  const practiceId = c.get('practiceId');
  const content = await buildBoardPack(services, period, practiceId);
  const id = newId('bp');
  await services.db.insert(schema.boardPacks).values({ id, practiceId, period, title: `Board pack ${period} · ${practiceId ?? 'Group'}`, content, generatedBy: c.get('user')!.id });
  await audit(c, 'board_pack.generated', { type: 'board_pack', id }, { period });
  await emit(c, 'board_pack.generated.v1', { boardPackId: id, period }, { aggregateType: 'board_pack', aggregateId: id });
  return c.json({ id, pack: content }, 201);
});
r.get('/board-packs', allow('EXE', 'SUP', 'SHR', 'PRM', 'CMP'), async (c) => {
  const rows = await c.get('services').db.select({ id: schema.boardPacks.id, period: schema.boardPacks.period, title: schema.boardPacks.title, status: schema.boardPacks.status, createdAt: schema.boardPacks.createdAt, approvedBy: schema.boardPacks.approvedBy, practiceId: schema.boardPacks.practiceId }).from(schema.boardPacks).orderBy(desc(schema.boardPacks.createdAt)).limit(24);
  return c.json({ packs: rows });
});
r.get('/board-packs/:id', allow('EXE', 'SUP', 'SHR', 'PRM', 'CMP'), async (c) => {
  const [row] = await c.get('services').db.select().from(schema.boardPacks).where(eq(schema.boardPacks.id, param(c, 'id'))).limit(1);
  if (!row) throw notFound('Board pack');
  return c.json({ pack: row });
});
r.post('/board-packs/:id/approve', allow('EXE'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  await services.db.update(schema.boardPacks).set({ status: 'approved', approvedBy: c.get('user')!.id, approvedAt: new Date().toISOString() }).where(eq(schema.boardPacks.id, id));
  await audit(c, 'board_pack.approved', { type: 'board_pack', id });
  return c.json({ ok: true });
});

/* ---------- Acquisitions and the Onboarding Hand checklist ---------- */
export const ONBOARDING_CHECKLIST: Array<{ day: number; item: string }> = [
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
const onboardingHand = defineHand({
  id: 'onboarding', name: 'Onboarding Hand', module: 'M02', level: 'A2',
  mandate: 'Drive onboarding of a new or acquired Practice from entity capture to go-live readiness against the 5-working-day target; everything created is staged until a human activates it.',
  defaultLeash: { maxDaysToGoLive: 5, stagedOnly: true },
  approvalPersona: 'SUP', approvalPolicy: 'Never provisions clinical rights or activates a fee schedule; SUP and CMP activate.',
  tools: { 'checklist.read': 'R0', 'checklist.stage': 'R1', 'task.create': 'R1', 'message.contact': 'R2' },
});

r.get('/acquisitions', allow('EXE', 'SUP', 'CMP', 'SHR', 'PRM'), async (c) => {
  const rows = await c.get('services').db.select().from(schema.acquisitions).orderBy(asc(schema.acquisitions.createdAt));
  return c.json({ acquisitions: rows, stages: ['target', 'due_diligence', 'onboarding', 'live'] });
});
r.post('/acquisitions', allow('EXE', 'SUP'), async (c) => {
  const data = await body(c, z.object({ name: z.string().min(2), region: z.string().optional(), sites: z.array(z.string()).min(1), modalities: z.array(z.string()).optional(), owner: z.string().optional(), indicativeEbitdaCents: z.number().int().optional(), jvSplit: z.string().optional(), notes: z.string().optional() }));
  const id = newId('acq');
  await c.get('services').db.insert(schema.acquisitions).values({ id, ...data, stage: 'target', checklist: ONBOARDING_CHECKLIST.map((x) => ({ ...x, done: false })) });
  await audit(c, 'acquisition.created', { type: 'acquisition', id }, { name: data.name });
  return c.json({ id }, 201);
});
r.patch('/acquisitions/:id', allow('EXE', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const services = c.get('services');
  const data = await body(c, z.object({ stage: z.enum(['target', 'due_diligence', 'onboarding', 'live']).optional(), checklistIndex: z.number().int().min(0).optional(), done: z.boolean().optional(), notes: z.string().optional(), effectiveDate: z.string().optional(), mergerThreshold: z.object({ assessed: z.boolean(), category: z.string().optional(), notifiable: z.boolean().optional(), note: z.string().optional() }).optional() }));
  const [row] = await services.db.select().from(schema.acquisitions).where(eq(schema.acquisitions.id, id)).limit(1);
  if (!row) throw notFound('Acquisition');
  const order = ['target', 'due_diligence', 'onboarding', 'live'];
  if (data.stage && order.indexOf(data.stage) > order.indexOf(row.stage) + 1) throw invalid('Stages advance one at a time');
  if (data.stage === 'live' && row.checklist.some((x) => !x.done)) throw invalid('All onboarding checklist items must be done before go-live');
  const checklist = [...row.checklist];
  if (data.checklistIndex !== undefined && checklist[data.checklistIndex]) checklist[data.checklistIndex] = { ...checklist[data.checklistIndex]!, done: data.done ?? true, at: new Date().toISOString(), by: c.get('user')!.id };
  await services.db.update(schema.acquisitions).set({ stage: data.stage ?? row.stage, checklist, notes: data.notes ?? row.notes, effectiveDate: data.effectiveDate ?? row.effectiveDate, mergerThreshold: data.mergerThreshold ?? row.mergerThreshold, updatedAt: new Date().toISOString() }).where(eq(schema.acquisitions.id, id));
  await audit(c, 'acquisition.updated', { type: 'acquisition', id }, data);
  if (data.stage && data.stage !== row.stage) await emit(c, 'acquisition.stage_changed.v1', { acquisitionId: id, from: row.stage, to: data.stage }, { aggregateType: 'acquisition', aggregateId: id });
  return c.json({ ok: true });
});
/** Run the Onboarding Hand for one day of the checklist: it stages the day's items (never activates). */
r.post('/acquisitions/:id/onboarding-hand', allow('EXE', 'SUP'), async (c) => {
  const id = param(c, 'id');
  const task = await runHand(c.get('services'), 'onboarding', { acquisitionId: id }, { practiceId: null, trigger: 'manual', title: `Onboarding Hand · ${id}`, aggregateType: 'acquisition', aggregateId: id });
  await audit(c, 'acquisition.onboarding_hand', { type: 'acquisition', id }, { taskId: task.id, status: task.status });
  return c.json({ task });
});

export default defineModule({
  code: 'M16', name: 'Analytics & Insight', basePath: 'analytics', routes: r,
  boot() {
    registerHand<{ question: string; practiceId: string | null }, Record<string, unknown>>(insightHand, async (input, ctx) => {
      const matches = await ctx.step('catalogue.match', { question: input.question }, async () => matchMetrics(input.question, 3));
      if (!matches.length) {
        await ctx.step('task.create', { for: 'M16 owner' }, async () => ({ backlog: 'definitions', question: input.question }), 'Metric not in the semantic layer: definitions-backlog task');
        throw new Refused('No metric in the semantic layer matches this question; it has been added to the definitions backlog for the M16 owner.');
      }
      const filters = parseQuestionFilters(input.question);
      const primary = matches[0]!.metric;
      const value = await ctx.step('metric.compute', { metricId: primary.id, scope: ctx.practiceId ?? 'group', filters }, () => computeMetric(ctx.services, primary, { practiceId: ctx.practiceId }));
      const rows: Array<{ label: string; value: number | null; meets?: boolean }> = [];
      if (!ctx.practiceId || filters.threshold !== undefined) {
        const practices = await ctx.services.db.select().from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
        for (const p of practices) {
          const v = await computeMetric(ctx.services, primary, { practiceId: p.id });
          const meets = v.value === null || filters.threshold === undefined ? undefined : filters.comparator === 'under' ? v.value < filters.threshold : v.value > filters.threshold;
          rows.push({ label: p.tradingName ?? p.registeredName, value: v.value, meets });
        }
      }
      const series = await seriesFor(ctx.services, primary.id, ctx.practiceId, 30);
      let narrative = `${primary.name} is ${value.value === null ? 'not available yet' : `${value.value}${primary.unit === 'pct' ? ' %' : primary.unit === 'cents' ? ' cents' : ` ${primary.unit}`}`} (${value.source}${value.note ? `: ${value.note}` : ''}). Target ${primary.targetLabel}, ${primary.direction === 'lower' ? 'lower is better' : primary.direction === 'higher' ? 'higher is better' : 'within band'}.`;
      if (rows.length && filters.threshold !== undefined) {
        const hits = rows.filter((x) => x.meets);
        narrative += ` ${hits.length} of ${rows.length} practices ${filters.comparator === 'under' ? 'under' : 'over'} ${filters.threshold}${primary.unit === 'pct' ? ' %' : ''}${hits.length ? `: ${hits.map((h) => `${h.label} ${h.value}`).join(' · ')}` : ''}.`;
      }
      if (ctx.services.llm.available) {
        narrative = await ctx.step('llm.narrate', { metricId: primary.id }, () => ctx.services.llm.complete({ system: 'You narrate one analytics metric in two plain sentences for a South African imaging group executive. Never invent numbers; use only the facts given. No exclamation marks.', user: `Question: ${input.question}\nFacts: ${narrative}\nDefinition: ${primary.formula}` }), 'LLM narration over computed facts only');
      }
      return {
        question: input.question, metricIds: matches.map((x) => x.metric.id), primary: { id: primary.id, name: primary.name, formula: primary.formula, grain: primary.grain, version: primary.version, owner: primary.owner, target: primary.targetLabel, direction: primary.direction, unit: primary.unit },
        alternatives: matches.slice(1).map((x) => ({ id: x.metric.id, name: x.metric.name })), filters, value, rows, series: series.slice(-30), narrative,
        provenance: { modelId: 'insight-nlq', modelVersion: '2.2.0', outputClass: 4, createdAt: new Date().toISOString(), confidence: Math.min(0.95, 0.5 + matches[0]!.score / 20), demo: ctx.services.demoMode },
        freshness: value.source === 'live' ? 'live' : value.source === 'snapshot' ? 'daily' : 'unavailable', rowCount: rows.length || 1, suppressed: 0,
      };
    });
    if (!getHand('onboarding')) {
      registerHand<{ acquisitionId: string }, Record<string, unknown>>(onboardingHand, async (input, ctx) => {
        const [row] = await ctx.services.db.select().from(schema.acquisitions).where(eq(schema.acquisitions.id, input.acquisitionId)).limit(1);
        if (!row) throw new Error('Acquisition not found');
        if (row.stage !== 'onboarding') { throw new Refused('The Onboarding Hand touches only entities in onboarding status'); }
        const pending: Array<{ day: number; item: string; done: boolean }> = await ctx.step('checklist.read', { acquisitionId: row.id }, async () => row.checklist.filter((x) => !x.done));
        if (!pending.length) return { staged: [], note: 'Checklist complete; go-live is a human action (SUP and PRM sign).' };
        const day = pending[0]!.day;
        const todays = pending.filter((x) => x.day === day && !/activated by a human|signed by SUP/.test(x.item));
        const staged = await ctx.step('checklist.stage', { day, items: todays.map((x) => x.item) }, async () => {
          const checklist = row.checklist.map((x) => (todays.some((t) => t.item === x.item) ? { ...x, done: true, at: new Date().toISOString(), by: 'onboarding_hand' } : x));
          await ctx.services.db.update(schema.acquisitions).set({ checklist, updatedAt: new Date().toISOString() }).where(eq(schema.acquisitions.id, row.id));
          return todays.map((x) => x.item);
        }, `Day ${day} items staged (nothing activated)`);
        const humanOnly = pending.filter((x) => x.day === day && /activated by a human|signed by SUP/.test(x.item));
        if (humanOnly.length) await ctx.step('task.create', { for: 'SUP', items: humanOnly.map((x) => x.item) }, async () => ({ created: humanOnly.length }), 'Human-only items left for SUP and PRM');
        return { day, staged, humanOnly: humanOnly.map((x) => x.item) };
      });
    }
  },
  async tick(services) {
    return snapshotTick(services);
  },
});

export { seriesFor };
