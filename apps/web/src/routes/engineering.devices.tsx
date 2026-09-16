import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable, Money, KV, Sheet, Sparkline, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import { DeviceSignal, type Device, type WorkOrder } from './engineering.index';

export const Route = createFileRoute('/engineering/devices')({ component: DevicesPage });

interface DeviceDetail { asset: Device; telemetry: Array<{ metric: string; points: Array<{ at: string; value: number | null; text: string | null }> }>; workOrders: WorkOrder[]; vendorSessions: Array<{ id: string; ref: string; vendor: string; status: string; purpose: string; approvedStart: string | null }> }

function DevicesPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<{ devices: Device[] }>('/assets/devices') });
  const detail = useQuery({ queryKey: ['device', openId], enabled: !!openId, queryFn: () => api.get<DeviceDetail>(`/assets/devices/${openId}`) });

  const rows = devices.data?.devices ?? [];
  const licenceSoon = rows.filter((d) => d.licenceDays !== null && d.licenceDays < 90);

  return (
    <div className="page">
      <PageHeader title="Devices" subtitle={`${rows.length} assets · licence, QA, preventive maintenance and predictive signals`} actions={<a className="btn" href="/engineering">Fleet</a>} />

      {licenceSoon.length > 0 && <Banner kind="warn">{licenceSoon.map((d) => `${d.name}: licence expires ${d.licenceExpiry} (${d.licenceDays} days)`).join(' · ')}. Scheduling is blocked from the expiry date.</Banner>}
      {devices.isError && <Banner kind="crit">The device register could not be loaded. Refresh, or call platform support with reference assets-devices.</Banner>}

      <Card title="Modality register" extra={<Chip kind="ai">BCI-PRED-EQUIP 0.9.4 · daily risk score</Chip>}>
        {devices.isLoading ? <Skeleton rows={8} /> : !rows.length ? <EmptyState>No assets registered.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(d) => d.id}
            onRowClick={(d) => setOpenId(d.id)}
            selectedKey={openId ?? undefined}
            columns={[
              { key: 'device', header: 'Device', render: (d) => <><b>{d.name}</b>{d.serial && <div className="small muted mono">SN {d.serial}</div>}</> },
              { key: 'room', header: 'Room', render: (d) => <>{d.siteName}{d.roomName ? ` ${d.roomName}` : ''}</> },
              { key: 'licence', header: 'Licence expiry', render: (d) => d.licenceExpiry ? <span className={`mono ${d.licenceDays !== null && d.licenceDays < 90 ? '' : ''}`}>{d.licenceExpiry}{d.licenceDays !== null && d.licenceDays < 90 ? ` · ${d.licenceDays} d` : ''}</span> : <span className="muted mono">registration</span> },
              { key: 'uptime', header: 'Uptime 30 d', num: true, render: (d) => d.uptime30dPct === null ? <span className="muted">—</span> : <Chip kind={d.uptime30dPct >= 98 ? 'done' : d.uptime30dPct >= 95 ? 'att' : 'crit'}>{d.uptime30dPct} %</Chip> },
              { key: 'pm', header: 'Next PM', render: (d) => d.pmSchedule?.nextPm ? <span className="mono">{d.pmSchedule.nextPm}</span> : <span className="muted">—</span> },
              { key: 'signal', header: 'Predictive signal', render: (d) => <DeviceSignal device={d} /> },
              { key: 'wo', header: '', render: (d) => d.openWorkOrders[0] ? <span className="mono small">{d.openWorkOrders[0]!.ref}</span> : <StatusChip status={d.status} /> },
            ]}
          />
        )}
        <p className="note">Licence expiry comes from the room register; QA and preventive maintenance come from the dose and asset modules. A predictive score never takes a device out of service; that is a human action.</p>
      </Card>

      {openId && (
        <Sheet open onClose={() => setOpenId(null)} title={detail.data?.asset.name ?? 'Device'}>
          {detail.isLoading ? <Skeleton rows={6} /> : detail.data ? (
            <>
              <KV items={[
                ['Site and room', `${detail.data.asset.siteName}${detail.data.asset.roomName ? ` · ${detail.data.asset.roomName}` : ''}`],
                ['Vendor and model', `${detail.data.asset.vendor ?? '—'} ${detail.data.asset.model ?? ''}`],
                ['Serial', <span className="mono" key="s">{detail.data.asset.serial ?? '—'}</span>],
                ['Status', <StatusChip status={detail.data.asset.status} key="st" />],
                ['Uptime 30 days', detail.data.asset.uptime30dPct === null ? '—' : `${detail.data.asset.uptime30dPct} %`],
                ['Service contract', detail.data.asset.serviceContract
                  ? <>{detail.data.asset.serviceContract.vendor} · {detail.data.asset.serviceContract.coverage.join(', ')} · response {detail.data.asset.serviceContract.responseHours} h · uptime SLA {detail.data.asset.serviceContract.uptimeSlaPct} %<div className="small muted">expires {detail.data.asset.serviceContract.expires} · <Money cents={detail.data.asset.serviceContract.annualCents} /> a year</div></>
                  : 'none recorded'],
                ['Preventive maintenance', detail.data.asset.pmSchedule ? `every ${detail.data.asset.pmSchedule.intervalDays} days · last ${detail.data.asset.pmSchedule.lastPm ?? '—'} · next ${detail.data.asset.pmSchedule.nextPm ?? '—'}` : '—'],
              ]} />

              <Card title="Telemetry">
                {!detail.data.telemetry.length ? <EmptyState>No telemetry received for this asset.</EmptyState> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detail.data.telemetry.map((t) => (
                      <div key={t.metric} className="spread">
                        <span className="small">{t.metric.replace(/_/g, ' ')}</span>
                        <span className="row-flex">
                          <Sparkline values={t.points.map((p) => p.value ?? 0)} tone={t.metric === 'tube_arc_count' ? 'crit' : 'ok'} />
                          <span className="mono small">{t.points[t.points.length - 1]?.value ?? t.points[t.points.length - 1]?.text ?? '—'}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="note">Telemetry keeps flowing during an internet outage: the gateway stores and forwards it when connectivity returns (M18-R-103).</p>
              </Card>

              <Card title="Work orders">
                {!detail.data.workOrders.length ? <EmptyState>No work orders for this asset.</EmptyState> : (
                  <DataTable
                    rows={detail.data.workOrders}
                    rowKey={(w) => w.id}
                    columns={[
                      { key: 'ref', header: 'Reference', render: (w) => <span className="mono">{w.ref}</span> },
                      { key: 'type', header: 'Type', render: (w) => w.type },
                      { key: 'title', header: 'Title', render: (w) => <span className="small">{w.title}</span> },
                      { key: 'vendor', header: 'Vendor ticket', render: (w) => w.vendorTicket ? <span className="mono">{w.vendorTicket}</span> : <span className="muted">—</span> },
                      { key: 'status', header: 'Status', render: (w) => <StatusChip status={w.status} /> },
                    ]}
                  />
                )}
              </Card>

              {detail.data.vendorSessions.length > 0 && (
                <Card title="Vendor access history">
                  <ul className="tl">
                    {detail.data.vendorSessions.map((s) => (
                      <li key={s.id}><span className="tm">{s.approvedStart ? s.approvedStart.slice(5, 10) : '—'}</span><span className={`dot ${s.status === 'closed' ? 'ok' : ''}`} /><span><span className="mono">{s.ref}</span> · {s.vendor} · {s.purpose} · {s.status}</span></li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          ) : <EmptyState>Device not found.</EmptyState>}
        </Sheet>
      )}
    </div>
  );
}

export { DateTime };
