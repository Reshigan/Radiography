import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable, Money, Tabs } from '@bonakala/bdl';
import { api } from '../lib/api';
import { MetricTiles, DefinitionSheet, type MetricTile, type TilesResponse } from './practice.index';
import { type Device, type WorkOrder, DeviceSignal, WorkOrderKanban } from './engineering.index';

export const Route = createFileRoute('/practice/equipment')({ component: EquipmentPage });

interface ConsumablesResponse {
  lots: Array<{ id: string; siteName: string; product: string; lot: string; expiry: string; qtyOnHand: number; unit: string; dailyUsage: number; daysToExpiry: number; expired: boolean; status: string }>;
  cover: Array<{ siteId: string; siteName: string; qty: number; dailyUsage: number; daysCover: number | null }>;
  note: string;
}

function EquipmentPage() {
  const [tab, setTab] = useState('devices');
  const [define, setDefine] = useState<MetricTile | null>(null);
  const tiles = useQuery({ queryKey: ['tiles', 'engineering'], queryFn: () => api.get<TilesResponse>('/analytics/tiles?scope=engineering') });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.get<{ devices: Device[] }>('/assets/devices') });
  const wos = useQuery({ queryKey: ['work-orders'], queryFn: () => api.get<{ columns: string[]; workOrders: WorkOrder[] }>('/assets/work-orders') });
  const stock = useQuery({ queryKey: ['consumables'], queryFn: () => api.get<ConsumablesResponse>('/assets/consumables') });
  const pos = useQuery({ queryKey: ['purchase-orders'], queryFn: () => api.get<{ purchaseOrders: Array<{ id: string; ref: string; supplier: string; category: string; totalCents: number; status: string; raisedBy: string | null }> }>('/assets/purchase-orders') });

  const down = (devices.data?.devices ?? []).filter((d) => d.status === 'down');
  const shortCover = (stock.data?.cover ?? []).filter((c) => c.daysCover !== null && c.daysCover < 10);

  return (
    <div className="page">
      <PageHeader title="Equipment" subtitle="Devices, downtime, work orders, contrast stock and licences" actions={<a className="btn" href="/engineering">Engineering console</a>} />

      {down.length > 0 && <Banner kind="crit">{down.map((d) => `${d.name} down since ${d.downtimeStartedAt?.slice(11, 16) ?? 'earlier'}`).join(' · ')}. The Maintenance Hand has opened the work orders and vendor tickets below.</Banner>}
      {shortCover.length > 0 && <Banner kind="warn">Contrast cover is short at {shortCover.map((c) => `${c.siteName} (${c.daysCover} days)`).join(', ')}. The Maintenance Hand drafts a reorder within its monthly site cap.</Banner>}
      {devices.isError && <Banner kind="crit">The equipment register could not be loaded. Refresh, or call platform support with reference assets-devices.</Banner>}

      <MetricTiles tiles={tiles.data?.tiles ?? []} loading={tiles.isLoading} columns="g4" onDefine={setDefine} />

      <Tabs tabs={[{ id: 'devices', label: 'Devices' }, { id: 'work', label: `Work orders (${(wos.data?.workOrders ?? []).filter((w) => w.status !== 'done').length})` }, { id: 'stock', label: 'Contrast stock' }, { id: 'orders', label: 'Purchase orders' }]} active={tab} onChange={setTab} />

      {tab === 'devices' && (
        <Card title="Device register" extra={devices.data ? `${devices.data.devices.length} assets` : undefined}>
          {devices.isLoading ? <Skeleton rows={6} /> : !devices.data?.devices.length ? <EmptyState>No assets registered.</EmptyState> : (
            <DataTable
              rows={devices.data.devices}
              rowKey={(d) => d.id}
              columns={[
                { key: 'name', header: 'Device', render: (d) => <><b>{d.name}</b>{d.serial && <div className="small muted mono">{d.serial}</div>}</> },
                { key: 'site', header: 'Site', render: (d) => <>{d.siteName}{d.roomName ? ` · ${d.roomName}` : ''}</> },
                { key: 'status', header: 'Status', render: (d) => <StatusChip status={d.status} /> },
                { key: 'uptime', header: 'Uptime 30 d', num: true, render: (d) => d.uptime30dPct === null ? <span className="muted">—</span> : <span className="mono">{d.uptime30dPct} %</span> },
                { key: 'licence', header: 'Licence expiry', render: (d) => d.licenceExpiry ? <span className={`mono ${d.licenceDays !== null && d.licenceDays < 90 ? '' : 'muted'}`}>{d.licenceExpiry}{d.licenceDays !== null && d.licenceDays < 90 ? ` · ${d.licenceDays} d` : ''}</span> : <span className="muted">—</span> },
                { key: 'pm', header: 'Next PM', render: (d) => d.pmSchedule?.nextPm ? <span className="mono">{d.pmSchedule.nextPm}</span> : <span className="muted">—</span> },
                { key: 'signal', header: 'Predictive signal', render: (d) => <DeviceSignal device={d} /> },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'work' && (
        <Card title="Work orders">
          {wos.isLoading ? <Skeleton rows={5} /> : <WorkOrderKanban columns={wos.data?.columns ?? []} rows={wos.data?.workOrders ?? []} />}
        </Card>
      )}

      {tab === 'stock' && (
        <>
          <Card title="Contrast cover by site">
            {stock.isLoading ? <Skeleton rows={3} /> : (
              <DataTable
                rows={stock.data?.cover ?? []}
                rowKey={(c) => c.siteId}
                columns={[
                  { key: 'site', header: 'Site', render: (c) => c.siteName },
                  { key: 'qty', header: 'On hand', num: true, render: (c) => <span className="mono">{c.qty}</span> },
                  { key: 'use', header: 'Daily usage', num: true, render: (c) => <span className="mono">{c.dailyUsage}</span> },
                  { key: 'cover', header: 'Days cover', num: true, render: (c) => c.daysCover === null ? <span className="muted">—</span> : <Chip kind={c.daysCover < 10 ? 'crit' : c.daysCover > 30 ? 'att' : 'done'}>{c.daysCover} d</Chip> },
                ]}
              />
            )}
          </Card>
          <Card title="Lots" extra={stock.data ? `${stock.data.lots.length} lots` : undefined}>
            {stock.isLoading ? <Skeleton rows={4} /> : (
              <DataTable
                rows={stock.data?.lots ?? []}
                rowKey={(l) => l.id}
                columns={[
                  { key: 'product', header: 'Product', render: (l) => l.product },
                  { key: 'lot', header: 'Lot', render: (l) => <span className="mono">{l.lot}</span> },
                  { key: 'site', header: 'Site', render: (l) => l.siteName },
                  { key: 'qty', header: 'On hand', num: true, render: (l) => <span className="mono">{l.qtyOnHand} {l.unit}s</span> },
                  { key: 'expiry', header: 'Expiry', render: (l) => <span className="mono">{l.expiry}</span> },
                  { key: 'days', header: 'Days', num: true, render: (l) => <span className="mono">{l.daysToExpiry}</span> },
                  { key: 'state', header: '', render: (l) => l.expired ? <Chip kind="crit">expired</Chip> : l.daysToExpiry < 60 ? <Chip kind="att">expiring</Chip> : <Chip kind="done">active</Chip> },
                ]}
              />
            )}
            <p className="note">{stock.data?.note}</p>
          </Card>
        </>
      )}

      {tab === 'orders' && (
        <Card title="Purchase orders">
          {pos.isLoading ? <Skeleton rows={3} /> : !pos.data?.purchaseOrders.length ? <EmptyState>No purchase orders raised.</EmptyState> : (
            <DataTable
              rows={pos.data.purchaseOrders}
              rowKey={(p) => p.id}
              columns={[
                { key: 'ref', header: 'Reference', render: (p) => <span className="mono">{p.ref}</span> },
                { key: 'supplier', header: 'Supplier', render: (p) => p.supplier },
                { key: 'cat', header: 'Category', render: (p) => p.category },
                { key: 'total', header: 'Total', num: true, render: (p) => <Money cents={p.totalCents} /> },
                { key: 'by', header: 'Raised by', render: (p) => p.raisedBy === 'maintenance_hand' ? <Chip kind="ai">Maintenance Hand</Chip> : <span className="muted">{p.raisedBy ?? 'manual'}</span> },
                { key: 'status', header: 'Status', render: (p) => <StatusChip status={p.status} /> },
              ]}
            />
          )}
          <p className="note">Orders raised by the Hand within its leash still need a human approval before they are sent.</p>
        </Card>
      )}

      <DefinitionSheet tile={define} onClose={() => setDefine(null)} />
    </div>
  );
}
