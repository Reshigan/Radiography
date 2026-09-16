import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, Skeleton, EmptyState, DataTable, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';
import { Heatmap, type HeatmapData } from './practice.index';

export const Route = createFileRoute('/practice/schedule')({ component: SchedulePage });

interface PowerResponse {
  windows: Array<{ id: string; siteId: string; siteName: string; stage: number; startsAt: string; endsAt: string; generatorCovers: string[] | null; active: boolean }>;
  readiness: Array<{ siteId: string; siteName: string; gateway: string; upsPct: number; upsMinutesLeft: number | null; backlog: number }>;
}

function SchedulePage() {
  const [siteId, setSiteId] = useState('');
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Array<{ id: string; name: string }> }>('/org/sites') });
  const heat = useQuery({ queryKey: ['heatmap-sched', siteId], queryFn: () => api.get<HeatmapData>(`/analytics/heatmap${siteId ? `?siteId=${siteId}` : ''}`) });
  const power = useQuery({ queryKey: ['power'], queryFn: () => api.get<PowerResponse>('/assets/power') });
  const rooms = useQuery({ queryKey: ['rooms', siteId || heat.data?.site?.id], queryFn: () => api.get<{ rooms: Array<{ id: string; name: string; roomType: string; licenceNo: string | null; licenceExpiry: string | null; status: string; modalities: Array<{ id: string; type: string; status: string; nextQaDue: string | null }> }> }>(`/org/sites/${siteId || heat.data!.site!.id}/rooms`), enabled: !!(siteId || heat.data?.site?.id) });

  const windows = power.data?.windows ?? [];
  const activeWindow = windows.find((w) => w.active);

  return (
    <div className="page">
      <PageHeader
        title="Schedule and capacity"
        subtitle="Room capacity against booked load, with the published load-shedding windows"
        actions={
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site" className="btn">
            <option value="">First site</option>
            {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        }
      />

      {activeWindow && (
        <Banner kind="warn">
          Load-shedding stage {activeWindow.stage} at {activeWindow.siteName} from {activeWindow.startsAt.slice(11, 16)} to {activeWindow.endsAt.slice(11, 16)}.
          {' '}Generator covers {(activeWindow.generatorCovers ?? []).join(', ') || 'nothing'}; lists in the window are moved rather than cancelled.
        </Banner>
      )}
      {(heat.isError || power.isError) && <Banner kind="crit">Capacity could not be loaded. Refresh, or call platform support with reference practice-schedule.</Banner>}

      <Card title="Room capacity by hour" extra={heat.data?.date}>
        {heat.isLoading ? <Skeleton rows={6} /> : heat.data && heat.data.rows.length ? <Heatmap data={heat.data} /> : <EmptyState>No rooms configured for this site.</EmptyState>}
      </Card>

      <div className="split">
        <Card title="Published outage windows" extra={`${windows.length} in the schedule`}>
          {power.isLoading ? <Skeleton rows={3} /> : windows.length === 0 ? <EmptyState>No load-shedding windows published for the next days.</EmptyState> : (
            <DataTable
              rows={windows}
              rowKey={(w) => w.id}
              columns={[
                { key: 'site', header: 'Site', render: (w) => w.siteName },
                { key: 'stage', header: 'Stage', render: (w) => <Chip kind={w.stage >= 4 ? 'crit' : 'att'}>stage {w.stage}</Chip> },
                { key: 'when', header: 'Window', render: (w) => <span className="mono">{w.startsAt.slice(5, 10)} {w.startsAt.slice(11, 16)}–{w.endsAt.slice(11, 16)}</span> },
                { key: 'gen', header: 'Generator covers', render: (w) => (w.generatorCovers ?? []).length ? (w.generatorCovers ?? []).join(', ') : <span className="muted">nothing · lists moved</span> },
                { key: 'state', header: '', render: (w) => w.active ? <Chip kind="crit">running</Chip> : null },
              ]}
            />
          )}
          <p className="note">Windows publish to scheduling, to the Roster Hand for shift-time changes, and to central booking before slots are offered (M18-R-107).</p>
        </Card>

        <Card title="Site readiness">
          {power.isLoading ? <Skeleton rows={3} /> : (
            <DataTable
              rows={power.data?.readiness ?? []}
              rowKey={(x) => x.siteId}
              columns={[
                { key: 'site', header: 'Site', render: (x) => x.siteName },
                { key: 'gw', header: 'Gateway', render: (x) => <StatusChip status={x.gateway} /> },
                { key: 'ups', header: 'UPS', num: true, render: (x) => <span className="mono">{x.upsPct} %{x.upsMinutesLeft ? ` · ${x.upsMinutesLeft} min` : ''}</span> },
                { key: 'backlog', header: 'Backlog', num: true, render: (x) => <span className="mono">{x.backlog}</span> },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title="Rooms, licences and QA" extra={rooms.data ? `${rooms.data.rooms.length} rooms` : undefined}>
        {rooms.isLoading ? <Skeleton rows={5} /> : !rooms.data?.rooms.length ? <EmptyState>No rooms for this site.</EmptyState> : (
          <DataTable
            rows={rooms.data.rooms}
            rowKey={(x) => x.id}
            columns={[
              { key: 'room', header: 'Room', render: (x) => <b>{x.name}</b> },
              { key: 'type', header: 'Type', render: (x) => x.roomType },
              { key: 'licence', header: 'Licence', render: (x) => x.licenceNo ? <span className="mono">{x.licenceNo}</span> : <span className="muted">not ionising</span> },
              { key: 'expiry', header: 'Licence expiry', render: (x) => x.licenceExpiry ? <span className="mono">{x.licenceExpiry}</span> : <span className="muted">—</span> },
              { key: 'qa', header: 'Next QA', render: (x) => x.modalities[0]?.nextQaDue ? <span className="mono">{x.modalities[0]!.nextQaDue}</span> : <span className="muted">—</span> },
              { key: 'status', header: 'Device', render: (x) => x.modalities[0] ? <StatusChip status={x.modalities[0]!.status} /> : <span className="muted">—</span> },
            ]}
          />
        )}
        <p className="note">Scheduling is blocked on a room whose licence has expired or whose QA is overdue (M02-R-006, M19-R-308).</p>
      </Card>
    </div>
  );
}
