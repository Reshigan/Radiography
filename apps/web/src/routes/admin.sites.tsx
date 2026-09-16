import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable } from '@bonakala/bdl';
import { api } from '../lib/api';
import { AdminShell } from './admin.index';

export const Route = createFileRoute('/admin/sites')({ component: SitesPage });

interface Site { id: string; practiceId: string; code: string; name: string; address: string | null; province: string | null; phone: string | null; status: string }
interface Room { id: string; name: string; roomType: string; licenceNo: string | null; licenceExpiry: string | null; status: string; modalities: Array<{ id: string; type: string; vendor: string | null; model: string | null; serial: string | null; aeTitle: string | null; status: string; lastQaAt: string | null; nextQaDue: string | null }> }

function SitesPage() {
  const [siteId, setSiteId] = useState('');
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Site[] }>('/org/sites') });
  const selected = siteId || sites.data?.sites[0]?.id || '';
  const rooms = useQuery({ queryKey: ['rooms', selected], enabled: !!selected, queryFn: () => api.get<{ rooms: Room[] }>(`/org/sites/${selected}/rooms`) });
  const licences = useQuery({ queryKey: ['licences'], queryFn: () => api.get<{ licences: Array<{ roomId: string; room: string; site: string; licenceNo: string | null; expiry: string | null; daysToExpiry: number | null }> }>('/org/licences') });

  const expiring = (licences.data?.licences ?? []).filter((l) => l.daysToExpiry !== null && l.daysToExpiry < 90);

  return (
    <AdminShell
      active="/admin/sites"
      title="Sites and rooms"
      subtitle={`${sites.data?.sites.length ?? 0} sites · licences, modalities and AE titles`}
      actions={
        <select value={selected} onChange={(e) => setSiteId(e.target.value)} aria-label="Site" className="btn">
          {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      }
    >
      {expiring.length > 0 && <Banner kind="warn">{expiring.map((l) => `${l.site} ${l.room}: licence expires ${l.expiry} (${l.daysToExpiry} days)`).join(' · ')}. A room is blocked for scheduling from the expiry date.</Banner>}
      {sites.isError && <Banner kind="crit">Sites could not be loaded. Refresh, or call platform support with reference org-sites.</Banner>}

      <Card title="Sites">
        {sites.isLoading ? <Skeleton rows={4} /> : !sites.data?.sites.length ? <EmptyState>No sites registered.</EmptyState> : (
          <DataTable
            rows={sites.data.sites}
            rowKey={(s) => s.id}
            selectedKey={selected}
            onRowClick={(s) => setSiteId(s.id)}
            columns={[
              { key: 'code', header: 'Code', render: (s) => <span className="mono">{s.code}</span> },
              { key: 'name', header: 'Site', render: (s) => <b>{s.name}</b> },
              { key: 'address', header: 'Address', render: (s) => <span className="small">{s.address ?? '—'}</span> },
              { key: 'province', header: 'Province', render: (s) => s.province ?? '—' },
              { key: 'phone', header: 'Phone', render: (s) => <span className="mono small">{s.phone ?? '—'}</span> },
              { key: 'status', header: 'Status', render: (s) => <StatusChip status={s.status} /> },
            ]}
          />
        )}
      </Card>

      <Card title="Rooms, modalities and licences" extra={sites.data?.sites.find((s) => s.id === selected)?.name}>
        {rooms.isLoading ? <Skeleton rows={5} /> : !rooms.data?.rooms.length ? <EmptyState>No rooms at this site.</EmptyState> : (
          <DataTable
            rows={rooms.data.rooms}
            rowKey={(r) => r.id}
            columns={[
              { key: 'room', header: 'Room', render: (r) => <><b>{r.name}</b><div className="small muted">{r.roomType}</div></> },
              { key: 'licence', header: 'Licence', render: (r) => r.licenceNo ? <span className="mono small">{r.licenceNo}</span> : <span className="muted small">not ionising</span> },
              { key: 'expiry', header: 'Expiry', render: (r) => r.licenceExpiry ? <span className="mono small">{r.licenceExpiry}</span> : <span className="muted">—</span> },
              { key: 'device', header: 'Modality', render: (r) => r.modalities[0] ? <>{r.modalities[0]!.vendor} {r.modalities[0]!.model}<div className="small muted mono">SN {r.modalities[0]!.serial ?? '—'}</div></> : <span className="muted">none</span> },
              { key: 'ae', header: 'AE title', render: (r) => r.modalities[0]?.aeTitle ? <span className="mono small">{r.modalities[0]!.aeTitle}</span> : <span className="muted">—</span> },
              { key: 'qa', header: 'QA', render: (r) => r.modalities[0] ? <span className="small mono">last {r.modalities[0]!.lastQaAt ?? '—'} · next {r.modalities[0]!.nextQaDue ?? '—'}</span> : <span className="muted">—</span> },
              { key: 'status', header: 'Device', render: (r) => r.modalities[0] ? <StatusChip status={r.modalities[0]!.status} /> : <span className="muted">—</span> },
            ]}
          />
        )}
        <p className="note">A modality may not move to in service until acceptance testing evidence and, for ionising units, the room licence are attached and verified by compliance.</p>
      </Card>

      <Card title="Licence register" extra={<Chip kind={expiring.length ? 'att' : 'done'}>{expiring.length} within 90 days</Chip>}>
        {licences.isLoading ? <Skeleton rows={4} /> : (
          <DataTable
            rows={licences.data?.licences ?? []}
            rowKey={(l) => l.roomId}
            columns={[
              { key: 'site', header: 'Site', render: (l) => l.site },
              { key: 'room', header: 'Room', render: (l) => l.room },
              { key: 'no', header: 'Licence', render: (l) => <span className="mono small">{l.licenceNo ?? '—'}</span> },
              { key: 'expiry', header: 'Expiry', render: (l) => <span className="mono small">{l.expiry ?? '—'}</span> },
              { key: 'days', header: 'Days', num: true, render: (l) => l.daysToExpiry === null ? <span className="muted">—</span> : <Chip kind={l.daysToExpiry < 30 ? 'crit' : l.daysToExpiry < 90 ? 'att' : 'done'}>{l.daysToExpiry}</Chip> },
            ]}
          />
        )}
      </Card>
    </AdminShell>
  );
}
