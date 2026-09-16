import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable, Money, Provenance, SlaBar } from '@bonakala/bdl';
import { api } from '../lib/api';
import { MetricTiles, DefinitionSheet, type MetricTile, type TilesResponse } from './practice.index';

export const Route = createFileRoute('/engineering/')({ component: FleetPage });

/* ---------- shared types and pieces used by the other engineering pages and /practice/equipment ---------- */
export interface Gateway {
  id: string; siteId: string; siteName: string; name: string; status: 'online' | 'offline' | 'on_ups';
  lastHeartbeatAt: string | null; heartbeatAgeSeconds: number | null; tunnelMs: number | null; backlogStudies: number;
  diskPct: number; upsPct: number; upsMinutesLeft: number | null; stateMinutes: number | null; note: string | null;
  localWorklistMirror: boolean; modalities: number; modalitiesDown: number;
}
export interface Device {
  id: string; name: string; siteName: string; roomName: string | null; type: string | null; vendor: string | null; model: string | null; serial: string | null;
  status: string; uptime30dPct: number | null; licenceNo: string | null; licenceExpiry: string | null; licenceDays: number | null;
  downtimeStartedAt: string | null;
  pmSchedule: { intervalDays: number; lastPm: string | null; nextPm: string | null } | null;
  serviceContract: { vendor: string; coverage: string[]; responseHours: number; uptimeSlaPct: number; expires: string; annualCents: number } | null;
  predictiveSignal: { signal: string; riskPct: number; confidence: number; modelId: string; modelVersion: string; at: string; level: 'none' | 'watch' | 'warn' | 'crit' } | null;
  openWorkOrders: Array<{ id: string; ref: string; type: string; status: string }>;
}
export interface WorkOrder {
  id: string; ref: string; type: string; priority: string; title: string; symptoms: string | null; status: string;
  assetName: string | null; siteName: string; vendorTicket: string | null; slaHours: number | null; slaPct: number | null; slaBreached: boolean;
  poCents: number | null; rootCause: string | null; createdAt: string;
  timeline: Array<{ at: string; text: string; by?: string; kind?: string }>;
}

/** AI-derived predictive signal, always in the annotated style (docs/12). */
export function DeviceSignal({ device }: { device: Device }) {
  const sig = device.predictiveSignal;
  if (!sig || sig.level === 'none') return <span className="muted small">no signal</span>;
  return (
    <Provenance prov={{ modelId: sig.modelId, modelVersion: sig.modelVersion, confidence: sig.confidence, outputClass: 4, demo: true }}>
      <span className="small">{sig.signal} · failure risk 30 d {sig.riskPct} %</span>
    </Provenance>
  );
}

export function WorkOrderKanban({ columns, rows, onOpen }: { columns: string[]; rows: WorkOrder[]; onOpen?: (w: WorkOrder) => void }) {
  if (!rows.length) return <EmptyState>No work orders.</EmptyState>;
  return (
    <div className="kan">
      {columns.map((col) => {
        const items = rows.filter((w) => w.status === col);
        return (
          <div className="col" key={col}>
            <h4>{col.replace(/_/g, ' ')}<span className="pill">{items.length}</span></h4>
            {items.map((w) => (
              <div className="k" key={w.id} onClick={() => onOpen?.(w)} style={{ cursor: onOpen ? 'pointer' : undefined }}>
                <div className="spread"><b>{w.assetName ?? w.title}</b><span className="mono small">{w.ref}</span></div>
                <div className="muted">{w.title}</div>
                <div className="row-flex" style={{ gap: 4 }}>
                  <Chip kind={w.priority === 'critical' ? 'crit' : w.priority === 'high' ? 'att' : 'neutral'}>{w.type}</Chip>
                  {w.vendorTicket && <span className="mono small">{w.vendorTicket}</span>}
                </div>
                {w.slaPct !== null && w.status !== 'done' && <SlaBar pct={w.slaPct} />}
                {w.slaBreached && <Chip kind="crit">SLA breached</Chip>}
              </div>
            ))}
            {!items.length && <span className="muted small">Nothing here.</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ============================== the page ============================== */
function FleetPage() {
  const [define, setDefine] = useState<MetricTile | null>(null);
  const tiles = useQuery({ queryKey: ['tiles', 'engineering'], queryFn: () => api.get<TilesResponse>('/analytics/tiles?scope=engineering') });
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api.get<{ gateways: Gateway[]; summary: { online: number; onUps: number; offline: number; backlog: number } }>('/assets/fleet'), refetchInterval: 30_000 });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<{ devices: Device[] }>('/assets/devices') });
  const wos = useQuery({ queryKey: ['work-orders'], queryFn: () => api.get<{ columns: string[]; workOrders: WorkOrder[] }>('/assets/work-orders') });

  const offline = (fleet.data?.gateways ?? []).filter((g) => g.status === 'offline');
  const atRisk = (devices.data?.devices ?? []).filter((d) => d.predictiveSignal && (d.predictiveSignal.level === 'warn' || d.predictiveSignal.level === 'crit'));

  return (
    <div className="page">
      <PageHeader
        title="Fleet and engineering"
        subtitle={fleet.data ? `${fleet.data.summary.online} online · ${fleet.data.summary.onUps} on UPS · ${fleet.data.summary.offline} offline · ${fleet.data.summary.backlog} studies in store-and-forward` : 'Edge Gateways, modalities and integration health'}
        actions={<><a className="btn" href="/engineering/devices">Devices</a><a className="btn" href="/engineering/work-orders">Work orders</a><a className="btn" href="/engineering/access">Vendor access</a></>}
      />

      {offline.map((g) => (
        <Banner key={g.id} kind="crit" action={<a className="btn sm" href="/support">Support ticket</a>}>
          <b>{g.siteName} Edge Gateway offline{g.stateMinutes !== null ? ` ${Math.floor(g.stateMinutes / 60)}:${String(g.stateMinutes % 60).padStart(2, '0')}` : ''}.</b>{' '}
          {g.note ?? 'Imaging continues locally.'} {g.backlogStudies} studies in store-and-forward · UPS {g.upsPct} %{g.upsMinutesLeft ? `, about ${Math.floor(g.upsMinutesLeft / 60)} h ${g.upsMinutesLeft % 60} min` : ''}.
        </Banner>
      ))}
      {fleet.isError && <Banner kind="crit">The fleet could not be loaded. Refresh, or call platform support with reference assets-fleet.</Banner>}

      <MetricTiles tiles={tiles.data?.tiles ?? []} loading={tiles.isLoading} columns="g4" onDefine={setDefine} />

      <Card title="Edge Gateway fleet" extra="Heartbeat, tunnel, UPS, disk and transfer backlog">
        {fleet.isLoading ? <Skeleton rows={4} /> : !fleet.data?.gateways.length ? <EmptyState>No gateways enrolled.</EmptyState> : (
          <div className="grid g3">
            {fleet.data.gateways.map((g) => (
              <div key={g.id} className="card" style={{ borderLeft: `3px solid var(--${g.status === 'offline' ? 'crit' : g.status === 'on_ups' ? 'warn' : 'ok'})`, padding: 12 }}>
                <div className="spread"><b>{g.siteName}</b><StatusChip status={g.status} /></div>
                <div className="kv small" style={{ marginTop: 8 }}>
                  <span>Heartbeat</span><div className="mono">{g.heartbeatAgeSeconds === null ? '—' : g.heartbeatAgeSeconds > 300 ? `${Math.round(g.heartbeatAgeSeconds / 60)} min ago` : `${g.heartbeatAgeSeconds} s`}</div>
                  <span>Tunnel</span><div className="mono">{g.tunnelMs === null ? 'down' : `${g.tunnelMs} ms`}</div>
                  <span>UPS</span><div className="mono">{g.status === 'online' ? 'mains' : `battery ${g.upsPct} %`}</div>
                  <span>Disk</span><div className="mono">{g.diskPct} %</div>
                  <span>Backlog</span><div className="mono">{g.backlogStudies} studies</div>
                </div>
                <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 2, marginTop: 8 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, g.backlogStudies)}%`, background: g.backlogStudies > 20 ? 'var(--crit)' : 'var(--ok)', borderRadius: 2 }} />
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>{g.note ?? `${g.modalities} modalities connected`}</div>
              </div>
            ))}
          </div>
        )}
        <p className="note">Outbound only: no inbound ports at any site. During an outage the local worklist mirror keeps the technologist working and STAT studies are forwarded first when the link returns.</p>
      </Card>

      {atRisk.length > 0 && (
        <Card title="Predictive signals" extra={<Chip kind="ai">BCI-PRED-EQUIP</Chip>}>
          <DataTable
            rows={atRisk}
            rowKey={(d) => d.id}
            columns={[
              { key: 'device', header: 'Device', render: (d) => <><b>{d.name}</b><div className="small muted">{d.siteName}</div></> },
              { key: 'signal', header: 'Signal', render: (d) => <DeviceSignal device={d} /> },
              { key: 'wo', header: 'Work order', render: (d) => d.openWorkOrders[0] ? <span className="mono">{d.openWorkOrders[0]!.ref}</span> : <span className="muted">none open</span> },
            ]}
          />
          <p className="note">A risk score is a signal, not an instruction. The Maintenance Hand may open an inspection work order within its leash; it can never take a device out of service.</p>
        </Card>
      )}

      <Card title="Open work orders" extra={<a className="link" href="/engineering/work-orders">Full kanban</a>}>
        {wos.isLoading ? <Skeleton rows={4} /> : <WorkOrderKanban columns={(wos.data?.columns ?? []).filter((c) => c !== 'done')} rows={(wos.data?.workOrders ?? []).filter((w) => w.status !== 'done')} />}
      </Card>

      <DefinitionSheet tile={define} onClose={() => setDefine(null)} />
    </div>
  );
}

export { Money };
