import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable } from '@bonakala/bdl';
import { api } from '../lib/api';
import type { SiteStatus } from './group.index';
import type { Gateway } from './engineering.index';

export const Route = createFileRoute('/group/network')({ component: NetworkPage });

function NetworkPage() {
  const sites = useQuery({ queryKey: ['sites-status'], queryFn: () => api.get<{ sites: SiteStatus[] }>('/analytics/sites-status'), refetchInterval: 60_000 });
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api.get<{ gateways: Gateway[]; summary: { online: number; onUps: number; offline: number; backlog: number } }>('/assets/fleet') });
  const feeds = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<{ feeds: Array<{ id: string; type: string; name: string; partner: string | null; status: string; errors24h: number; messages24h: number; siteName: string }>; summary: { healthy: number; degraded: number; errors24h: number } }>('/assets/integrations') });
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api.get<{ entities: Array<{ id: string; type: string; registeredName: string; tradingName: string | null }>; relationships: Array<{ id: string; parentId: string; childId: string; type: string }> }>('/org/entities') });

  const byState = { crit: (sites.data?.sites ?? []).filter((s) => s.state === 'crit'), att: (sites.data?.sites ?? []).filter((s) => s.state === 'att'), ok: (sites.data?.sites ?? []).filter((s) => s.state === 'ok') };
  const hub = entities.data?.entities.find((e) => e.type === 'hub');

  return (
    <div className="page">
      <PageHeader title="Network" subtitle="Sites, reading hub, connectivity and partner integrations across the Group" actions={<a className="btn" href="/engineering">Engineering console</a>} />

      {byState.crit.length > 0 && <Banner kind="crit">{byState.crit.length} site{byState.crit.length > 1 ? 's need' : ' needs'} attention: {byState.crit.map((s) => s.site).join(', ')}.</Banner>}
      {sites.isError && <Banner kind="crit">The network view could not be loaded. Refresh, or call platform support with reference sites-status.</Banner>}

      <div className="grid g4">
        <Card title="Sites"><div style={{ font: '600 24px/1.1 var(--display)' }}>{sites.data?.sites.length ?? '—'}</div><div className="small muted">{byState.ok.length} normal · {byState.att.length} attention · {byState.crit.length} critical</div></Card>
        <Card title="Gateways"><div style={{ font: '600 24px/1.1 var(--display)' }}>{fleet.data?.summary.online ?? '—'}</div><div className="small muted">online · {fleet.data?.summary.onUps ?? 0} on UPS · {fleet.data?.summary.offline ?? 0} offline</div></Card>
        <Card title="Transfer backlog"><div style={{ font: '600 24px/1.1 var(--display)' }}>{fleet.data?.summary.backlog ?? '—'}</div><div className="small muted">studies in store-and-forward</div></Card>
        <Card title="Integration errors"><div style={{ font: '600 24px/1.1 var(--display)' }}>{feeds.data?.summary.errors24h ?? '—'}</div><div className="small muted">in the last 24 hours across {feeds.data?.feeds.length ?? 0} feeds</div></Card>
      </div>

      <Card title="Site map" extra="coloured by a single attention state">
        {sites.isLoading ? <Skeleton rows={4} /> : (
          <div className="grid g4">
            {(sites.data?.sites ?? []).map((s) => (
              <div key={s.siteId} className="card" style={{ padding: 12, borderLeft: `3px solid var(--${s.state === 'crit' ? 'crit' : s.state === 'att' ? 'warn' : 'ok'})` }}>
                <div className="spread"><b>{s.site}</b>{s.gateway && <StatusChip status={s.gateway.status} />}</div>
                <div className="small muted">{s.practice}</div>
                <div className="small" style={{ marginTop: 6 }}>{s.note}</div>
                {s.studiesToday > 0 && <div className="small muted mono" style={{ marginTop: 4 }}>{s.studiesToday} studies today · TAT {Math.floor(s.tatMedianMin / 60)} h {String(s.tatMedianMin % 60).padStart(2, '0')}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="split">
        <Card title="Reading hub and entities">
          {entities.isLoading ? <Skeleton rows={4} /> : (
            <>
              {hub && <p className="small">{hub.registeredName} provides reading services to the practices under a services agreement.</p>}
              <DataTable
                rows={entities.data?.entities ?? []}
                rowKey={(e) => e.id}
                columns={[
                  { key: 'name', header: 'Entity', render: (e) => e.tradingName ?? e.registeredName },
                  { key: 'type', header: 'Type', render: (e) => <Chip>{e.type.replace(/_/g, ' ')}</Chip> },
                  { key: 'rel', header: 'Agreements', render: (e) => <span className="small muted">{(entities.data?.relationships ?? []).filter((r) => r.parentId === e.id || r.childId === e.id).length} recorded</span> },
                ]}
              />
            </>
          )}
        </Card>

        <Card title="Partner integrations" extra={feeds.data ? `${feeds.data.summary.healthy} healthy · ${feeds.data.summary.degraded} degraded` : undefined}>
          {feeds.isLoading ? <Skeleton rows={4} /> : !feeds.data?.feeds.length ? <EmptyState>No integration feeds configured.</EmptyState> : (
            <DataTable
              rows={feeds.data.feeds}
              rowKey={(f) => f.id}
              columns={[
                { key: 'feed', header: 'Feed', render: (f) => <>{f.name}<div className="small muted">{f.partner ?? f.siteName}</div></> },
                { key: 'type', header: 'Type', render: (f) => f.type },
                { key: 'msgs', header: 'Messages', num: true, render: (f) => <span className="mono">{f.messages24h}</span> },
                { key: 'errors', header: 'Errors', num: true, render: (f) => <span className="mono">{f.errors24h}</span> },
                { key: 'state', header: 'State', render: (f) => <StatusChip status={f.status} /> },
              ]}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
