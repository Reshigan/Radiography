/**
 * Metric computation over whatever tables exist. Core tables and Cluster D tables are queried directly;
 * other clusters' tables only by name through the schema index with existence checks, so this module
 * works before and after integration. Missing sources return null with a "source not available" note.
 */
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { schema } from '@bonakala/db';
import { todaySast } from '@bonakala/domain';
import { METRICS, getMetric, median, pct, round, type MetricDefinition } from '@bonakala/domain/analytics';
import type { Services } from '../../kernel/ports.js';

export interface MetricValue {
  metricId: string;
  value: number | null;
  numerator?: number | null;
  denominator?: number | null;
  source: 'live' | 'snapshot' | 'unavailable';
  note?: string;
  asOf: string;
}

type AnyTable = Record<string, any>;
/** Another cluster's table, by name, or null when it has not been integrated yet. */
export function optionalTable(name: string): AnyTable | null {
  const t = (schema as any)[name];
  return t && typeof t === 'object' ? t : null;
}
function hasCols(t: AnyTable, ...cols: string[]) {
  return cols.every((c) => c in t);
}

const NOT_AVAILABLE = 'source not available: the owning module has not been integrated yet';

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString();
}
function dayDiff(a: string, b = todaySast()): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

/** Try a live computation from foreign tables; swallow errors so integration differences never break dashboards. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function countWhere(services: Services, t: AnyTable, where: SQL | undefined): Promise<number> {
  const rows = await services.db.select({ n: sql<number>`count(*)` }).from(t as any).where(where);
  return Number(rows[0]?.n ?? 0);
}

type Scope = { practiceId: string | null; siteId?: string | null };
function scopeWhere(t: AnyTable, scope: Scope, extra?: SQL): SQL | undefined {
  const parts: SQL[] = [];
  if (scope.practiceId && 'practiceId' in t) parts.push(eq(t.practiceId, scope.practiceId));
  if (scope.siteId && 'siteId' in t) parts.push(eq(t.siteId, scope.siteId));
  if (extra) parts.push(extra);
  return parts.length ? and(...parts) : undefined;
}

/**
 * Live computations keyed by metric id. Each returns {value, numerator, denominator} or null when the source is absent.
 * Foreign-table computations use generic status columns and are best-effort.
 */
const live: Record<string, (services: Services, scope: Scope) => Promise<{ value: number | null; numerator?: number; denominator?: number; note?: string } | null>> = {
  /* ---- access / operations from other clusters (by name) ---- */
  async 'ACC.NOSHOW'(services, scope) {
    const t = optionalTable('appointments');
    if (!t || !hasCols(t, 'status')) return null;
    return safe(async () => {
      const since = daysAgoIso(30);
      const base = 'createdAt' in t ? gte(t.createdAt, since) : undefined;
      const noShow = await countWhere(services, t, scopeWhere(t, scope, and(eq(t.status, 'no_show'), base)));
      const arrived = await countWhere(services, t, scopeWhere(t, scope, and(sql`${t.status} in ('arrived','completed','in_room','done')`, base)));
      return { value: pct(noShow, noShow + arrived), numerator: noShow, denominator: noShow + arrived };
    });
  },
  async 'ACC.CANCEL'(services, scope) {
    const t = optionalTable('appointments');
    if (!t || !hasCols(t, 'status')) return null;
    return safe(async () => {
      const cancelled = await countWhere(services, t, scopeWhere(t, scope, eq(t.status, 'cancelled')));
      const all = await countWhere(services, t, scopeWhere(t, scope));
      return { value: pct(cancelled, all), numerator: cancelled, denominator: all };
    });
  },
  async 'ACC.TTA'(services, scope) {
    const a = optionalTable('appointments');
    const o = optionalTable('orders');
    if (!a || !o || !hasCols(a, 'orderId', 'startsAt') || !hasCols(o, 'createdAt')) return null;
    return safe(async () => {
      const rows = await services.db.select({ s: a.startsAt, c: o.createdAt }).from(a as any).innerJoin(o as any, eq(o.id, a.orderId)).where(scopeWhere(a, scope)).limit(2000);
      const days = rows.map((r: any) => (new Date(r.s).getTime() - new Date(r.c).getTime()) / 86400000).filter((d: number) => d >= 0);
      const v = median(days);
      return { value: v === null ? null : round(v, 1), denominator: days.length };
    });
  },
  async 'ACC.CONV'(services, scope) {
    const o = optionalTable('orders');
    if (!o || !hasCols(o, 'status')) return null;
    return safe(async () => {
      const all = await countWhere(services, o, scopeWhere(o, scope));
      const arrived = await countWhere(services, o, scopeWhere(o, scope, sql`${o.status} in ('arrived','completed','done','signed','reported')`));
      return { value: pct(arrived, all), numerator: arrived, denominator: all };
    });
  },
  async 'REF.VOL'(services, scope) {
    const o = optionalTable('orders');
    if (!o) return null;
    return safe(async () => {
      const base = 'createdAt' in o ? gte(o.createdAt, daysAgoIso(28)) : undefined;
      const n = await countWhere(services, o, scopeWhere(o, scope, base));
      return { value: n, numerator: n };
    });
  },
  async 'REF.ACTIVE'(services, scope) {
    const o = optionalTable('orders');
    if (!o || !hasCols(o, 'referrerId')) return null;
    return safe(async () => {
      const base = 'createdAt' in o ? gte(o.createdAt, daysAgoIso(90)) : undefined;
      const rows = await services.db.select({ n: sql<number>`count(distinct ${o.referrerId})` }).from(o as any).where(scopeWhere(o, scope, base));
      return { value: Number(rows[0]?.n ?? 0) };
    });
  },
  async 'OPS.TAT.SLA'(services, scope) {
    const r = optionalTable('reports');
    if (!r || !hasCols(r, 'status')) return null;
    return safe(async () => {
      const signed = await countWhere(services, r, scopeWhere(r, scope, eq(r.status, 'signed')));
      if (!signed) return { value: null, denominator: 0, note: 'no signed reports yet' };
      const within = 'withinSla' in r ? await countWhere(services, r, scopeWhere(r, scope, and(eq(r.status, 'signed'), eq(r.withinSla, true)))) : null;
      if (within === null) return null;
      return { value: pct(within, signed), numerator: within, denominator: signed };
    });
  },
  async 'RCM.FPA'(services, scope) {
    const c = optionalTable('claims');
    if (!c || !hasCols(c, 'status')) return null;
    return safe(async () => {
      const submitted = await countWhere(services, c, scopeWhere(c, scope, sql`${c.status} in ('submitted','accepted','paid','rejected','responded','partially_paid')`));
      const accepted = await countWhere(services, c, scopeWhere(c, scope, sql`${c.status} in ('accepted','paid','partially_paid')`));
      if (!submitted) return { value: null, denominator: 0, note: 'no submitted claims yet' };
      return { value: pct(accepted, submitted), numerator: accepted, denominator: submitted };
    });
  },
  async 'RCM.REJ'(services, scope) {
    const c = optionalTable('claims');
    if (!c || !hasCols(c, 'status')) return null;
    return safe(async () => {
      const submitted = await countWhere(services, c, scopeWhere(c, scope, sql`${c.status} in ('submitted','accepted','paid','rejected','responded','partially_paid')`));
      const rejected = await countWhere(services, c, scopeWhere(c, scope, eq(c.status, 'rejected')));
      if (!submitted) return { value: null, denominator: 0 };
      return { value: pct(rejected, submitted), numerator: rejected, denominator: submitted };
    });
  },
  async 'SHR.VAL'(services, scope) {
    const s = optionalTable('studies');
    if (!s) return null;
    return safe(async () => {
      const n = await countWhere(services, s, scopeWhere(s, scope, 'createdAt' in s ? gte(s.createdAt, daysAgoIso(365)) : undefined));
      return { value: n };
    });
  },

  /* ---- workforce (own tables) ---- */
  async 'WFM.VAC'(services, scope) {
    const t = schema.shifts;
    const today = todaySast();
    const rows = await services.db.select({ status: t.status, hours: t.hours }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined, gte(t.date, today), lte(t.date, addDays(today, 27))));
    const planned = rows.reduce((a, r) => a + r.hours, 0);
    const gap = rows.filter((r) => r.status === 'open_gap').reduce((a, r) => a + r.hours, 0);
    return { value: pct(gap, planned), numerator: round(gap, 1), denominator: round(planned, 1) };
  },
  async 'WFM.OT'(services, scope) {
    const t = schema.timeAttendance;
    const rows = await services.db.select({ h: t.hoursWorked, ot: t.overtimeHours }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined, gte(t.clockIn, daysAgoIso(28))));
    const worked = rows.reduce((a, r) => a + (r.h ?? 0), 0);
    const ot = rows.reduce((a, r) => a + r.ot, 0);
    return { value: pct(ot, worked), numerator: round(ot, 1), denominator: round(worked, 1) };
  },
  async 'WFM.CRED'(services, scope) {
    const t = schema.credentials;
    const rows = await services.db.select({ expiry: t.expiry }).from(t).where(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined);
    const n = rows.filter((r) => r.expiry && dayDiff(r.expiry) <= 30).length;
    return { value: n, numerator: n, denominator: rows.length };
  },
  async 'WFM.CPD'(services, scope) {
    const staffRows = await services.db.select({ id: schema.staff.id, role: schema.staff.role }).from(schema.staff).where(and(scope.practiceId ? eq(schema.staff.practiceId, scope.practiceId) : undefined, eq(schema.staff.status, 'active'), sql`${schema.staff.role} in ('RAD','RGT','NUR')`));
    if (!staffRows.length) return { value: null, denominator: 0 };
    const pts = await services.db.select({ staffId: schema.cpdPoints.staffId, points: sql<number>`sum(${schema.cpdPoints.points})` }).from(schema.cpdPoints).where(eq(schema.cpdPoints.cycleYear, new Date().getFullYear())).groupBy(schema.cpdPoints.staffId);
    const map = new Map(pts.map((p) => [p.staffId, Number(p.points)]));
    const monthFrac = (new Date().getMonth() + 1) / 12;
    const onPace = staffRows.filter((s) => (map.get(s.id) ?? 0) >= 30 * monthFrac * 0.9).length;
    return { value: pct(onPace, staffRows.length), numerator: onPace, denominator: staffRows.length };
  },
  async 'WFM.HAND'(services, scope) {
    const t = schema.shifts;
    const rows = await services.db.select({ status: t.status, filledBy: t.filledBy, gapReason: t.gapReason }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, sql`${t.gapReason} is not null`));
    const gaps = rows.length;
    const hand = rows.filter((r) => r.filledBy === 'roster_hand').length;
    return { value: pct(hand, gaps), numerator: hand, denominator: gaps };
  },
  async 'WFM.ABS'(services, scope) {
    const t = schema.shifts;
    const rows = await services.db.select({ gapReason: t.gapReason }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, gte(t.date, addDays(todaySast(), -28))));
    const absent = rows.filter((r) => r.gapReason === 'sick').length;
    return { value: pct(absent, rows.length), numerator: absent, denominator: rows.length };
  },

  /* ---- assets (own tables + core) ---- */
  async 'AST.UP'(services, scope) {
    const t = schema.assets;
    const rows = await services.db.select({ u: t.uptime30dPct }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined, eq(t.kind, 'modality')));
    const vals = rows.map((r) => r.u).filter((v): v is number => v !== null);
    if (!vals.length) return { value: null };
    return { value: round(vals.reduce((a, b) => a + b, 0) / vals.length, 1), denominator: vals.length };
  },
  async 'AST.MTTR'(services, scope) {
    const t = schema.workOrders;
    const rows = await services.db.select({ s: t.downtimeStartedAt, e: t.downtimeEndedAt }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, eq(t.type, 'breakdown'), eq(t.status, 'done')));
    const hrs = rows.filter((r) => r.s && r.e).map((r) => (new Date(r.e!).getTime() - new Date(r.s!).getTime()) / 3600000);
    const v = median(hrs);
    return { value: v === null ? null : round(v, 1), denominator: hrs.length };
  },
  async 'AST.MTBF'(services, scope) {
    const t = schema.workOrders;
    const failures = await countWhere(services, t, and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, eq(t.type, 'breakdown'), gte(t.createdAt, daysAgoIso(365))));
    const assets = await countWhere(services, schema.assets, and(scope.practiceId ? eq(schema.assets.practiceId, scope.practiceId) : undefined, eq(schema.assets.kind, 'modality')));
    if (!failures) return { value: null, note: 'no unplanned failures recorded' };
    return { value: round((assets * 11 * 300) / failures, 0), numerator: assets * 11 * 300, denominator: failures };
  },
  async 'AST.PM'(services, scope) {
    const t = schema.workOrders;
    const rows = await services.db.select({ status: t.status, due: t.slaDueAt, updated: t.updatedAt }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, eq(t.type, 'pm'), sql`${t.status} in ('done','cancelled')`));
    const done = rows.filter((r) => r.status === 'done');
    const onTime = done.filter((r) => !r.due || r.updated <= r.due).length;
    return { value: pct(onTime, done.length), numerator: onTime, denominator: done.length };
  },
  async 'AST.QA'(services, scope) {
    const t = schema.modalities;
    const rows = await services.db.select({ due: t.nextQaDue }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined, sql`${t.status} != 'decommissioned'`));
    const today = todaySast();
    const ok = rows.filter((r) => !r.due || r.due >= today).length;
    return { value: pct(ok, rows.length), numerator: ok, denominator: rows.length };
  },
  async 'AST.LIC'(services, scope) {
    const t = schema.rooms;
    const rows = await services.db.select({ exp: t.licenceExpiry }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined));
    const n = rows.filter((r) => r.exp && dayDiff(r.exp) <= 90).length;
    return { value: n, denominator: rows.filter((r) => r.exp).length };
  },
  async 'AST.CONTRAST'(services, scope) {
    const t = schema.consumables;
    const rows = await services.db.select({ qty: t.qtyOnHand, usage: t.dailyUsage, siteId: t.siteId, status: t.status }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined, eq(t.category, 'contrast'), eq(t.status, 'active')));
    const bySite = new Map<string, { qty: number; usage: number }>();
    for (const r of rows) {
      const s = bySite.get(r.siteId) ?? { qty: 0, usage: 0 };
      s.qty += r.qty; s.usage += r.usage;
      bySite.set(r.siteId, s);
    }
    const covers = [...bySite.values()].filter((s) => s.usage > 0).map((s) => s.qty / s.usage);
    if (!covers.length) return { value: null };
    return { value: round(Math.min(...covers), 1), denominator: covers.length };
  },
  async 'AST.PRED'(services, scope) {
    const t = schema.assets;
    const rows = await services.db.select({ sig: t.predictiveSignal }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined));
    const n = rows.filter((r) => r.sig && (r.sig.level === 'warn' || r.sig.level === 'crit')).length;
    return { value: n, denominator: rows.length };
  },
  async 'AST.LINK'(services, scope) {
    const t = schema.edgeGateways;
    const rows = await services.db.select({ b: t.backlogStudies }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, scope.siteId ? eq(t.siteId, scope.siteId) : undefined));
    if (!rows.length) return { value: null };
    return { value: Math.max(...rows.map((r) => r.b)) * 2, denominator: rows.length };
  },
  async 'OPS.EDGE'(services, scope) {
    const t = schema.edgeGateways;
    const rows = await services.db.select({ s: t.status, mirror: t.localWorklistMirror }).from(t).where(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined);
    if (!rows.length) return { value: null };
    const ok = rows.filter((r) => r.s === 'online' || r.mirror).length;
    return { value: pct(ok, rows.length), numerator: ok, denominator: rows.length };
  },

  /* ---- compliance (own tables) ---- */
  async 'CMP.INC'(services, scope) {
    const n = await countWhere(services, schema.incidents, and(scope.practiceId ? eq(schema.incidents.practiceId, scope.practiceId) : undefined, sql`${schema.incidents.status} != 'closed'`));
    return { value: n };
  },
  async 'CMP.CLOSE'(services, scope) {
    const t = schema.incidents;
    const rows = await services.db.select({ r: t.reportedAt, c: t.closedAt }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, eq(t.status, 'closed')));
    const days = rows.filter((r) => r.c).map((r) => (new Date(r.c!).getTime() - new Date(r.r).getTime()) / 86400000);
    const v = median(days);
    return { value: v === null ? null : round(v, 1), denominator: days.length };
  },
  async 'CMP.POPIA'(services, scope) {
    const t = schema.dataSubjectRequests;
    const rows = await services.db.select({ due: t.statutoryDueAt, done: t.fulfilledAt }).from(t).where(and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, eq(t.status, 'fulfilled')));
    const inTime = rows.filter((r) => r.done && r.done <= r.due).length;
    return { value: pct(inTime, rows.length), numerator: inTime, denominator: rows.length };
  },
  async 'CMP.AUDIT'(services, scope) {
    const n = await countWhere(services, schema.auditFindings, and(scope.practiceId ? eq(schema.auditFindings.practiceId, scope.practiceId) : undefined, eq(schema.auditFindings.status, 'open')));
    return { value: n };
  },
  async 'CMP.POLICY'(services, scope) {
    const pols = await services.db.select().from(schema.policies).where(and(eq(schema.policies.status, 'approved'), eq(schema.policies.mandatory, true)));
    const staffRows = await services.db.select({ id: schema.staff.id }).from(schema.staff).where(and(scope.practiceId ? eq(schema.staff.practiceId, scope.practiceId) : undefined, eq(schema.staff.status, 'active')));
    if (!pols.length || !staffRows.length) return { value: null };
    const acks = await services.db.select({ policyId: schema.policyAcknowledgements.policyId, staffId: schema.policyAcknowledgements.staffId, version: schema.policyAcknowledgements.version }).from(schema.policyAcknowledgements).where(scope.practiceId ? eq(schema.policyAcknowledgements.practiceId, scope.practiceId) : undefined);
    const set = new Set(acks.map((a) => `${a.policyId}:${a.staffId}:${a.version}`));
    let need = 0; let have = 0;
    for (const p of pols) for (const s of staffRows) { need++; if (set.has(`${p.id}:${s.id}:${p.version}`)) have++; }
    return { value: pct(have, need), numerator: have, denominator: need };
  },
  async 'CMP.LIC'(services, scope) {
    const rooms = await services.db.select({ exp: schema.rooms.licenceExpiry, lic: schema.rooms.licenceNo }).from(schema.rooms).where(scope.practiceId ? eq(schema.rooms.practiceId, scope.practiceId) : undefined);
    const today = todaySast();
    const licensed = rooms.filter((r) => r.lic);
    const current = licensed.filter((r) => !r.exp || r.exp >= today).length;
    return { value: pct(current, licensed.length), numerator: current, denominator: licensed.length };
  },
  async 'CMP.CHAIN'(services) {
    const rows = await services.db.select({ prev: schema.auditLog.prevHash, hash: schema.auditLog.hash }).from(schema.auditLog).orderBy(schema.auditLog.createdAt).limit(500);
    let ok = true;
    for (let i = 1; i < rows.length; i++) if (rows[i]!.prev && rows[i]!.prev !== rows[i - 1]!.hash) { ok = false; break; }
    return { value: ok ? 100 : 0, denominator: rows.length };
  },
  async 'CMP.CAL'(services, scope) {
    const t = schema.obligations;
    const today = todaySast();
    const n = await countWhere(services, t, and(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined, sql`${t.dueDate} < ${today}`, sql`(${t.lastDoneAt} is null or ${t.lastDoneAt} < ${t.dueDate})`));
    return { value: n };
  },
  async 'CMP.RR'(services, scope) {
    const n = await countWhere(services, schema.reportableResults, and(scope.practiceId ? eq(schema.reportableResults.practiceId, scope.practiceId) : undefined, sql`${schema.reportableResults.status} != 'closed'`));
    return { value: n };
  },
  async 'PXP.COMPLAINT'(services, scope) {
    const n = await countWhere(services, schema.complaints, and(scope.practiceId ? eq(schema.complaints.practiceId, scope.practiceId) : undefined, gte(schema.complaints.receivedAt, daysAgoIso(30))));
    const reg = optionalTable('registrations') ?? optionalTable('appointments');
    if (!reg) return { value: null, numerator: n, note: 'encounter denominator not available; complaint count shown' };
    const enc = await safe(() => countWhere(services, reg, scopeWhere(reg, scope, 'createdAt' in reg ? gte(reg.createdAt, daysAgoIso(30)) : undefined)));
    if (!enc) return { value: null, numerator: n };
    return { value: pct(n, enc, 2), numerator: n, denominator: enc };
  },

  /* ---- AI ops (Hands runtime + incidents) ---- */
  async 'AIO.SLIP'(services, scope) {
    const n = await countWhere(services, schema.incidents, and(scope.practiceId ? eq(schema.incidents.practiceId, scope.practiceId) : undefined, eq(schema.incidents.category, 'ai_slip')));
    return { value: n };
  },
  async 'AIO.HAND'(services, scope) {
    const t = schema.agentTasks;
    const rows = await services.db.select({ status: t.status }).from(t).where(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined);
    const done = rows.filter((r) => r.status === 'done').length;
    return { value: pct(done, rows.length), numerator: done, denominator: rows.length };
  },
  async 'AIO.HAND.REV'(services, scope) {
    const t = schema.agentTasks;
    const rows = await services.db.select({ status: t.status }).from(t).where(scope.practiceId ? eq(t.practiceId, scope.practiceId) : undefined);
    const executed = rows.filter((r) => r.status === 'done').length;
    const reversed = rows.filter((r) => r.status === 'rejected').length;
    return { value: pct(reversed, executed + reversed, 2), numerator: reversed, denominator: executed + reversed };
  },
};

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Latest stored snapshot for a metric (practice-scoped; group scope averages practices for rates and sums counts/cents). */
async function latestSnapshot(services: Services, metricId: string, scope: Scope): Promise<{ value: number | null; date: string } | null> {
  const t = schema.metricSnapshots;
  if (scope.practiceId) {
    const rows = await services.db.select().from(t).where(and(eq(t.metricId, metricId), eq(t.practiceId, scope.practiceId), scope.siteId ? eq(t.siteId, scope.siteId) : sql`${t.siteId} is null`)).orderBy(desc(t.date)).limit(1);
    return rows[0] ? { value: rows[0].value, date: rows[0].date } : null;
  }
  const rows = await services.db.select().from(t).where(and(eq(t.metricId, metricId), sql`${t.siteId} is null`)).orderBy(desc(t.date)).limit(20);
  if (!rows.length) return null;
  const date = rows[0]!.date;
  const same = rows.filter((r) => r.date === date && r.value !== null);
  if (!same.length) return { value: null, date };
  const def = getMetric(metricId);
  const sum = same.reduce((a, r) => a + (r.value ?? 0), 0);
  const value = def && (def.unit === 'count' || def.unit === 'cents') ? sum : round(sum / same.length, 1);
  return { value, date };
}

export async function computeMetric(services: Services, def: MetricDefinition, scope: Scope, opts: { preferSnapshot?: boolean } = {}): Promise<MetricValue> {
  const now = new Date().toISOString();
  const fn = live[def.id];
  if (fn && !opts.preferSnapshot) {
    const r = await fn(services, scope);
    if (r && r.value !== null) return { metricId: def.id, value: r.value, numerator: r.numerator ?? null, denominator: r.denominator ?? null, source: 'live', note: r.note, asOf: now };
  }
  const snap = await latestSnapshot(services, def.id, scope);
  if (snap && snap.value !== null) return { metricId: def.id, value: snap.value, source: 'snapshot', note: `daily snapshot ${snap.date}`, asOf: snap.date };
  return { metricId: def.id, value: null, source: 'unavailable', note: fn ? 'no rows yet for this metric' : NOT_AVAILABLE, asOf: now };
}

/** Compute and store today's snapshot for every live-computable metric, per practice. Returns counts. */
export async function snapshotTick(services: Services): Promise<Record<string, number>> {
  const practices = await services.db.select({ id: schema.legalEntities.id }).from(schema.legalEntities).where(eq(schema.legalEntities.type, 'practice'));
  const today = todaySast();
  let stored = 0;
  for (const p of practices) {
    for (const def of METRICS) {
      const fn = live[def.id];
      if (!fn) continue;
      const r = await fn(services, { practiceId: p.id });
      if (!r || r.value === null) continue;
      const t = schema.metricSnapshots;
      const existing = await services.db.select({ id: t.id }).from(t).where(and(eq(t.practiceId, p.id), eq(t.metricId, def.id), eq(t.date, today), sql`${t.siteId} is null`)).limit(1);
      if (existing[0]) {
        await services.db.update(t).set({ value: r.value, numerator: r.numerator ?? null, denominator: r.denominator ?? null, source: 'computed' }).where(eq(t.id, existing[0].id));
      } else {
        const { newId } = await import('@bonakala/domain');
        await services.db.insert(t).values({ id: newId('ms'), practiceId: p.id, siteId: null, metricId: def.id, date: today, value: r.value, numerator: r.numerator ?? null, denominator: r.denominator ?? null, source: 'computed' });
      }
      stored++;
    }
  }
  return { snapshots: stored };
}

export const LIVE_METRIC_IDS = Object.keys(live);
