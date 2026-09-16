import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Tile, Card, Banner, Button, Chip, Money, Skeleton, EmptyState, Sheet, KV, Sparkline, Field, TextArea, DateTime, Provenance } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/practice/')({ component: ControlTower });

/* ============ shared types and helpers (imported by the other Cluster D pages) ============ */
export interface MetricTile {
  id: string; name: string; unit: string; direction: 'higher' | 'lower' | 'band'; target: number | null; targetLabel: string;
  description: string; formula: string; version: number; value: number | null; source: 'live' | 'snapshot' | 'unavailable';
  note?: string; asOf: string; tone: 'ok' | 'att' | 'crit' | 'none'; spark: number[];
}
export interface TilesResponse { scope: string; practiceId: string | null; tiles: MetricTile[]; asOf: string; demo?: boolean }

export function formatMetric(t: Pick<MetricTile, 'value' | 'unit'>): ReactNode {
  if (t.value === null || t.value === undefined) return <span className="muted">—</span>;
  switch (t.unit) {
    case 'pct': return `${t.value} %`;
    case 'cents': return <Money cents={Math.round(t.value)} />;
    case 'minutes': return `${Math.round(t.value)} min`;
    case 'hours': return `${t.value} h`;
    case 'days': return `${t.value} d`;
    case 'months': return `${t.value} months`;
    default: return String(t.value);
  }
}
const TONE_LABEL: Record<string, string> = { ok: 'on target', att: 'off target', crit: 'outside target', none: '' };

/** Stat tile with target, direction and a definition affordance (docs/13 §5, M16-R-100). */
export function MetricTiles({ tiles, loading, columns = 'g6', onDefine }: { tiles: MetricTile[]; loading?: boolean; columns?: string; onDefine?: (t: MetricTile) => void }) {
  if (loading) return <div className={`grid ${columns}`}>{Array.from({ length: 6 }, (_, i) => <Card key={i}><Skeleton rows={2} /></Card>)}</div>;
  return (
    <div className={`grid ${columns}`}>
      {tiles.map((t) => (
        <button key={t.id} type="button" onClick={() => onDefine?.(t)} style={{ all: 'unset', cursor: onDefine ? 'pointer' : 'default', display: 'block' }} title={`${t.name} · ${t.targetLabel}`}>
          <Tile
            label={t.name}
            value={t.source === 'unavailable' ? <span className="muted" style={{ fontSize: 15 }}>not available</span> : formatMetric(t)}
            delta={<>{t.targetLabel}{TONE_LABEL[t.tone] ? ` · ${TONE_LABEL[t.tone]}` : ''}{t.source === 'snapshot' ? ' · daily' : ''}</>}
            tone={t.tone === 'ok' ? 'up' : t.tone === 'none' ? undefined : 'down'}
          />
        </button>
      ))}
    </div>
  );
}

/** The metric definition sheet behind every tile. */
export function DefinitionSheet({ tile, onClose }: { tile: MetricTile | null; onClose: () => void }) {
  if (!tile) return null;
  return (
    <Sheet open onClose={onClose} title={`${tile.name} · ${tile.id}`}>
      <KV items={[
        ['Definition', tile.description],
        ['Formula', <span className="mono" key="f">{tile.formula}</span>],
        ['Target', `${tile.targetLabel} · ${tile.direction === 'lower' ? 'lower is better' : tile.direction === 'higher' ? 'higher is better' : 'within band'}`],
        ['Value', <>{formatMetric(tile)} {tile.source === 'unavailable' && <span className="muted">({tile.note})</span>}</>],
        ['Freshness', tile.source === 'live' ? 'computed now from source rows' : tile.source === 'snapshot' ? `daily snapshot · ${tile.note ?? ''}` : 'no source'],
        ['Definition version', `v${tile.version} · semantic layer, packages/domain/analytics`],
      ]} />
      <p className="note">Every surface renders this metric from this one definition. Changing a formula creates a new version with recomputed history (M16-R-100, M16-R-107).</p>
    </Sheet>
  );
}

export interface AlertRow { id: string; kind: 'crit' | 'att' | 'active' | 'neutral'; category: string; title: string; detail: string; hand?: string; handNote?: string; taskId?: string; link?: string; at?: string }

export function AlertList({ alerts, loading }: { alerts: AlertRow[]; loading?: boolean }) {
  if (loading) return <Skeleton rows={4} />;
  if (!alerts.length) return <EmptyState>No open alerts for this practice.</EmptyState>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {alerts.map((a) => (
        <div key={a.id} className="card" style={{ borderLeft: `3px solid var(--${a.kind === 'crit' ? 'crit' : a.kind === 'att' ? 'warn' : 'info'})`, padding: 12 }}>
          <div className="spread" style={{ alignItems: 'flex-start', gap: 8 }}>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <Chip kind={a.kind === 'crit' ? 'crit' : a.kind === 'att' ? 'att' : 'active'}>{a.category}</Chip>
                <b>{a.title}</b>
              </div>
              <div className="small muted">{a.detail}</div>
              {a.hand && <div className="note" style={{ marginTop: 6 }}><b>{a.hand}</b> · {a.handNote ?? 'watching this item within its leash'}</div>}
            </div>
            {a.link && <a className="btn sm" href={a.link}>Open</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface HandTask {
  id: string; handId: string; title: string; status: string; approvalPersona: string | null; approvalReason: string | null;
  input: Record<string, unknown>; output: Record<string, unknown> | null; startedAt: string;
  leashChecks: Array<{ rule: string; limit: unknown; actual: unknown; ok: boolean }>;
  steps: Array<{ at: string; tool: string; risk: string; note?: string }>;
}

/** Hands awaiting approval, with the leash context and Approve / Edit / Reject (docs/25 §3.12). */
export function ApprovalsPanel({ persona = 'PRM', compact }: { persona?: string; compact?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<HandTask | null>(null);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['hand-tasks', 'needs_approval'], queryFn: () => api.get<{ tasks: HandTask[] }>('/hands/tasks?status=needs_approval'), refetchInterval: 30_000 });
  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/hands/tasks/${id}/approve`),
    onSuccess: () => { setOpen(null); void qc.invalidateQueries(); },
  });
  const reject = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => api.post(`/hands/tasks/${id}/reject`, { reason: why }),
    onSuccess: () => { setOpen(null); setReason(''); void qc.invalidateQueries(); },
  });
  const tasks = q.data?.tasks ?? [];
  return (
    <>
      <Card title="Hands awaiting my approval" extra={tasks.length ? <Chip kind="att">{tasks.length}</Chip> : <Chip kind="done">clear</Chip>}>
        {q.isLoading ? <Skeleton rows={3} /> : tasks.length === 0 ? <EmptyState>Nothing is waiting for {persona} approval.</EmptyState> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.map((t) => (
              <div key={t.id} className="card" style={{ padding: 10 }}>
                <div className="spread"><b>{t.title}</b><Chip kind="att">{t.handId}</Chip></div>
                <div className="small muted" style={{ marginTop: 4 }}>{t.approvalReason}</div>
                {t.leashChecks.filter((c) => !c.ok).map((c) => (
                  <div key={c.rule} className="note" style={{ marginTop: 4 }}>Leash <span className="mono">{c.rule}</span>: limit {String(c.limit)}, proposed {String(c.actual)}</div>
                ))}
                <div className="row-flex" style={{ marginTop: 8 }}>
                  <Button size="sm" variant="primary" disabled={approve.isPending} onClick={() => approve.mutate(t.id)}>Approve</Button>
                  <Button size="sm" onClick={() => setOpen(t)}>Edit and review</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!compact && <p className="note">Approving re-runs the Hand with the leash lifted for this task only. Every run is recorded with its steps and checks.</p>}
      </Card>
      {open && (
        <Sheet open onClose={() => setOpen(null)} title={open.title}>
          <KV items={[
            ['Hand', open.handId],
            ['Requested', <DateTime iso={open.startedAt} key="d" />],
            ['Reason', open.approvalReason ?? '—'],
            ['Input', <span className="mono small" key="i">{JSON.stringify(open.input)}</span>],
          ]} />
          <Card title="Steps recorded">
            <ul className="tl">
              {open.steps.map((s, i) => (
                <li key={i}><span className="tm">{s.at.slice(11, 16)}</span><span className="dot" /><span><span className="mono">{s.tool}</span> · {s.risk}{s.note ? ` · ${s.note}` : ''}</span></li>
              ))}
            </ul>
          </Card>
          <Field label="Reason (required to reject)"><TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this proposal is not accepted" /></Field>
          <div className="row-flex">
            <Button variant="primary" onClick={() => approve.mutate(open.id)} disabled={approve.isPending}>Approve and run</Button>
            <Button variant="danger" onClick={() => reject.mutate({ id: open.id, why: reason })} disabled={reason.trim().length < 2 || reject.isPending}>Reject</Button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/* ---------------- Heatmap ---------------- */
export interface HeatCell { hour: number; value: number | null; state: 'actual' | 'booked' | 'down' | 'moved' }
export interface HeatRow { roomId: string; room: string; type: string; cells: HeatCell[]; down: boolean; downSince: string | null }
export interface HeatmapData { site: { id: string; name: string } | null; date: string; hours: number[]; nowHour: number; rows: HeatRow[]; windows: Array<{ stage: number; startsAt: string; endsAt: string; generatorCovers: string[] | null }>; source: string; note?: string }

/** Room × hour utilisation heatmap, drawn as inline SVG (docs/25 S-PRM-01). */
export function Heatmap({ data }: { data: HeatmapData }) {
  const cellW = 46;
  const cellH = 22;
  const labelW = 52;
  const gapX = 2;
  const gapY = 2;
  const top = 18;
  const width = labelW + data.hours.length * (cellW + gapX);
  const height = top + data.rows.length * (cellH + gapY) + 4;
  const opacity = (v: number) => (v >= 100 ? 0.92 : v >= 80 ? 0.72 : v >= 60 ? 0.5 : v >= 40 ? 0.32 : 0.14);
  const nowX = labelW + (data.nowHour - data.hours[0]!) * (cellW + gapX);
  const win = data.windows[0];
  const winFrom = win ? labelW + (Number(win.startsAt.slice(11, 13)) - data.hours[0]!) * (cellW + gapX) : 0;
  const winTo = win ? labelW + (Number(win.endsAt.slice(11, 13)) + (Number(win.endsAt.slice(14, 16)) > 0 ? 1 : 0) - data.hours[0]!) * (cellW + gapX) : 0;
  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" width="100%" aria-label={`Utilisation heatmap by room and hour for ${data.site?.name ?? 'the site'} on ${data.date}`} style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
        {data.hours.map((h, i) => (
          <text key={h} x={labelW + i * (cellW + gapX) + cellW / 2} y={11} textAnchor="middle" fill="var(--text-2)" style={{ fontSize: 11 }}>{String(h).padStart(2, '0')}</text>
        ))}
        {win && winTo > winFrom && (
          <>
            <rect x={winFrom} y={top - 2} width={winTo - winFrom} height={data.rows.length * (cellH + gapY)} fill="none" stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="4 3" rx="3" />
            <text x={winFrom + 4} y={height - 1} fill="var(--warn)" style={{ fontSize: 10 }}>Stage {win.stage} · {win.startsAt.slice(11, 16)}–{win.endsAt.slice(11, 16)}</text>
          </>
        )}
        {data.rows.map((row, ri) => (
          <g key={row.roomId}>
            <text x={0} y={top + ri * (cellH + gapY) + 15} fill="var(--text-2)" style={{ fontFamily: 'var(--sans, inherit)', fontSize: 11 }}>{row.room}</text>
            {row.cells.map((c, ci) => {
              const x = labelW + ci * (cellW + gapX);
              const y = top + ri * (cellH + gapY);
              if (c.state === 'down') return <g key={ci}><rect x={x} y={y} width={cellW} height={cellH} rx="2" fill="var(--crit-bg)" /><text x={x + cellW / 2} y={y + 15} textAnchor="middle" fill="var(--crit)">down</text></g>;
              if (c.state === 'moved') return <g key={ci}><rect x={x} y={y} width={cellW} height={cellH} rx="2" fill="var(--warn-bg)" /><text x={x + cellW / 2} y={y + 15} textAnchor="middle" fill="var(--warn)">moved</text></g>;
              const v = c.value ?? 0;
              return (
                <g key={ci}>
                  <rect x={x} y={y} width={cellW} height={cellH} rx="2" fill="var(--signal-ink, var(--primary))" fillOpacity={opacity(v)} />
                  <text x={x + cellW / 2} y={y + 15} textAnchor="middle" fill={v >= 60 ? '#fff' : 'var(--text)'}>{v}</text>
                </g>
              );
            })}
          </g>
        ))}
        {nowX > labelW && nowX < width && <><line x1={nowX} y1={top - 4} x2={nowX} y2={height - 12} stroke="var(--iris-ink, var(--primary))" strokeWidth="1.5" /><text x={nowX + 3} y={top - 6} fill="var(--text-2)" style={{ fontSize: 10 }}>now</text></>}
      </svg>
      <div className="small muted" style={{ marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span>scanned ÷ available minutes</span>
        <span>actual to now, then booked</span>
        {data.source === 'synthetic' && <span>{data.note}</span>}
      </div>
    </>
  );
}

/* ---------------- Wait chart ---------------- */
export function WaitChart({ points, target, waitingNow }: { points: Array<{ time: string; wait: number }>; target: number; waitingNow: number }) {
  if (!points.length) return <EmptyState>No arrivals recorded yet today.</EmptyState>;
  const w = 520;
  const h = 150;
  const max = Math.max(target * 2, ...points.map((p) => p.wait)) * 1.1;
  const x = (i: number) => 28 + (i / Math.max(1, points.length - 1)) * (w - 88);
  const y = (v: number) => 126 - (v / max) * 112;
  const line = points.map((p, i) => `${x(i)},${y(p.wait)}`).join(' ');
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" width="100%" aria-label={`Median patient wait per half hour, target ${target} minutes`} style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
        {[0, target, Math.round(max)].map((v) => (
          <g key={v}><line x1={28} y1={y(v)} x2={w - 60} y2={y(v)} stroke={v === target ? 'var(--warn)' : 'var(--line)'} strokeWidth={v === target ? 1.5 : 1} strokeDasharray={v === target ? '4 3' : undefined} /><text x={24} y={y(v) + 3} textAnchor="end" fill="var(--text-2)">{v}</text></g>
        ))}
        <text x={w - 56} y={y(target) + 3} fill="var(--warn)">target {target}</text>
        <polyline points={line} fill="none" stroke="var(--iris-ink, var(--primary))" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.wait)} r="3" fill="var(--iris-ink, var(--primary))" />)}
        <text x={x(0)} y={142} textAnchor="middle" fill="var(--text-2)">{points[0]!.time}</text>
        <text x={x(points.length - 1)} y={142} textAnchor="middle" fill="var(--text-2)">{points[points.length - 1]!.time}</text>
        <text x={x(points.length - 1) + 8} y={y(points[points.length - 1]!.wait) + 3} fill="var(--text)">{points[points.length - 1]!.wait}</text>
      </svg>
      <div className="small muted">Waiting now: {waitingNow} patients · median minutes past slot time</div>
    </>
  );
}

/* ============================== the page ============================== */
function ControlTower() {
  const [define, setDefine] = useState<MetricTile | null>(null);
  const [siteId, setSiteId] = useState('');
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Array<{ id: string; name: string }> }>('/org/sites') });
  const tiles = useQuery({ queryKey: ['tiles', 'practice'], queryFn: () => api.get<TilesResponse>('/analytics/tiles?scope=practice'), refetchInterval: 60_000 });
  const heat = useQuery({ queryKey: ['heatmap', siteId], queryFn: () => api.get<HeatmapData>(`/analytics/heatmap${siteId ? `?siteId=${siteId}` : ''}`), refetchInterval: 120_000 });
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api.get<{ points: Array<{ time: string; wait: number }>; waitingNow: number; byModality: Array<{ modality: string; waiting: number; longestMin: number }>; target: number }>('/analytics/queue'), refetchInterval: 30_000 });
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<{ alerts: AlertRow[] }>('/analytics/alerts'), refetchInterval: 60_000 });
  const packs = useQuery({ queryKey: ['board-packs'], queryFn: () => api.get<{ packs: Array<{ id: string; period: string; status: string }> }>('/analytics/board-packs').catch(() => ({ packs: [] })) });

  const crit = (alerts.data?.alerts ?? []).find((a) => a.kind === 'crit');
  const reviewDue = (packs.data?.packs ?? []).find((p) => p.status === 'draft');

  return (
    <div className="page">
      <PageHeader
        title={heat.data?.site ? `Today at ${heat.data.site.name}` : 'Control tower'}
        subtitle={tiles.data ? `${heat.data?.rows.length ?? 0} rooms · refreshed ${new Date(tiles.data.asOf).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'Loading the day'}
        actions={
          <>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site" className="btn">
              <option value="">First site</option>
              {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <a className="btn" href="/practice/schedule">Schedule</a>
            <a className="btn" href="/practice/quality">Quality</a>
            <a className="btn primary" href="/practice/approvals">Approvals</a>
          </>
        }
      />

      {crit && <Banner kind="crit" action={crit.link ? <a className="btn sm" href={crit.link}>Open</a> : undefined}><b>{crit.title}.</b> {crit.detail}</Banner>}
      {tiles.isError && <Banner kind="crit">The control tower could not load its metrics. Refresh, or call platform support with reference analytics-tiles.</Banner>}
      {reviewDue && <Banner kind="info" action={<a className="btn sm" href="/group/board-pack">Open pack</a>}>Shareholder review: the {reviewDue.period} board pack is in draft and waiting for approval.</Banner>}

      <MetricTiles tiles={tiles.data?.tiles ?? []} loading={tiles.isLoading} onDefine={setDefine} />

      <div className="split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Utilisation by room and hour" extra={heat.data?.date}>
            {heat.isLoading ? <Skeleton rows={6} /> : heat.data && heat.data.rows.length ? <Heatmap data={heat.data} /> : <EmptyState>No rooms configured for this site.</EmptyState>}
          </Card>
          <Card title="Queue and wait" extra={queue.data ? `${queue.data.waitingNow} waiting` : undefined}>
            {queue.isLoading ? <Skeleton rows={4} /> : queue.data ? (
              <>
                <WaitChart points={queue.data.points} target={queue.data.target} waitingNow={queue.data.waitingNow} />
                {queue.data.byModality.length > 0 && (
                  <div className="grid g4" style={{ marginTop: 10 }}>
                    {queue.data.byModality.map((m) => (
                      <div key={m.modality}><div className="small muted">{m.modality}</div><b>{m.waiting} waiting</b><div className="small muted">longest {m.longestMin} min</div></div>
                    ))}
                  </div>
                )}
              </>
            ) : <EmptyState>No queue data.</EmptyState>}
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Alerts" extra={alerts.data ? `${alerts.data.alerts.length} open` : undefined}>
            <AlertList alerts={alerts.data?.alerts ?? []} loading={alerts.isLoading} />
          </Card>
          <ApprovalsPanel />
        </div>
      </div>

      <DefinitionSheet tile={define} onClose={() => setDefine(null)} />
    </div>
  );
}

/** Shared: small provenance-wrapped block for Hand drafts. */
export function HandDraft({ title, modelId, modelVersion, children, onAccept, onEdit, onReject, accepted }: { title?: string; modelId: string; modelVersion: string; children: ReactNode; onAccept?: () => void; onEdit?: () => void; onReject?: () => void; accepted?: boolean }) {
  return (
    <div>
      {title && <div className="small muted" style={{ marginBottom: 4 }}>{title}</div>}
      <Provenance prov={{ modelId, modelVersion, outputClass: 3, demo: true }} onAccept={onAccept} onEdit={onEdit} onReject={onReject} accepted={accepted}>
        {children}
      </Provenance>
    </div>
  );
}

export { Sparkline };
