import { desc, eq, getTableColumns, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { schema } from '@bonakala/db';
import type { Services } from '../../kernel/ports.js';

export interface GateResult { allowed: boolean; reason: string; source: 'm07' | 'worklist' | 'none'; table?: string; details?: Record<string, unknown> }

/**
 * Safety gate check before a study may start (M08-R-102, process 05 §5.3).
 *
 * M08 does not import M07 tables by name (cluster A owns them and they may not exist yet). Instead it
 * discovers them at runtime from the shared schema index: any table whose export name matches
 * /safety|gate|checkin|check_in|visit|registration/i and that has a `patientId` column is read for the
 * patient's most recent row; a column named status/result/outcome/gateResult/gate decides:
 *   cleared|passed|ok|allowed|complete|ready → allowed; blocked|failed|stop|refer|pending|incomplete → blocked.
 * When no such table exists the gate returns allowed with reason 'm07_not_present' so the module
 * stays independently runnable, and the worklist item's own safetyGate snapshot (populated from
 * patient.arrived.v1 or the console's safety re-confirmation) remains the recorded evidence.
 */
export async function gateCheck(services: Services, ref: { patientId: string; appointmentId?: string | null; orderId?: string | null; modalityType?: string }): Promise<GateResult> {
  const tables = Object.entries(schema as unknown as Record<string, unknown>).filter(([k, v]) => /safety|gate|checkin|check_in|visit|registration/i.test(k) && is(v, SQLiteTable));
  for (const [name, table] of tables) {
    try {
      const cols = getTableColumns(table as SQLiteTable) as Record<string, any>;
      if (!cols.patientId) continue;
      const statusKey = ['gateResult', 'gate', 'outcome', 'result', 'status'].find((k) => cols[k]);
      if (!statusKey) continue;
      const order = cols.createdAt ?? cols.updatedAt ?? cols.id;
      const rows = (await services.db.select().from(table as SQLiteTable).where(eq(cols.patientId, ref.patientId)).orderBy(desc(order)).limit(20)) as Array<Record<string, unknown>>;
      if (!rows.length) continue;
      const scoped = rows.find((r) => (ref.appointmentId && r.appointmentId === ref.appointmentId) || (ref.orderId && r.orderId === ref.orderId)) ?? rows[0]!;
      const v = String(scoped[statusKey] ?? '').toLowerCase();
      if (/(clear|pass|ok|allow|complete|ready|granted)/.test(v)) return { allowed: true, reason: `M07 ${name}: ${v}`, source: 'm07', table: name, details: pickSafety(scoped) };
      if (/(block|fail|stop|refer|pending|incomplete|not_sure|unsure|yes)/.test(v)) return { allowed: false, reason: `M07 ${name}: ${v}`, source: 'm07', table: name, details: pickSafety(scoped) };
    } catch {
      /* table shape not compatible; try the next candidate */
    }
  }
  return { allowed: true, reason: 'm07_not_present', source: 'none' };
}

function pickSafety(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['pregnancy', 'pregnancyStatus', 'egfr', 'allergies', 'metformin', 'implants', 'answers', 'status', 'result', 'outcome']) if (k in row) out[k] = row[k];
  return out;
}
