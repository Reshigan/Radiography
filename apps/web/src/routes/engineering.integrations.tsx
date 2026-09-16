import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/engineering/integrations')({ component: IntegrationsPage });

interface Feed { id: string; type: string; name: string; partner: string | null; transport: string | null; direction: string; siteName: string; lastMessageAt: string | null; lastMessageAgeSeconds: number | null; messages24h: number; errors24h: number; status: string; lastError: string | null }
interface Silence { assetId: string; name: string; siteName: string; reason: string }

function age(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

function IntegrationsPage() {
  const q = useQuery({
    queryKey: ['integrations'],
    refetchInterval: 60_000,
    queryFn: () => api.get<{ feeds: Feed[]; summary: { healthy: number; degraded: number; errors24h: number; messages24h: number }; silenceAlerts: Silence[] }>('/assets/integrations'),
  });

  const feeds = q.data?.feeds ?? [];
  const down = feeds.filter((f) => f.status === 'down');
  const review = feeds.filter((f) => f.status === 'mapping_review');

  return (
    <div className="page">
      <PageHeader title="Integrations" subtitle={q.data ? `${q.data.summary.healthy} healthy · ${q.data.summary.degraded} degraded · ${q.data.summary.messages24h} messages and ${q.data.summary.errors24h} errors in 24 hours` : 'DICOM, HL7, FHIR and switch health'} actions={<a className="btn" href="/engineering">Fleet</a>} />

      {down.length > 0 && <Banner kind="crit">{down.map((f) => `${f.name} (${f.siteName}) is down`).join(' · ')}.</Banner>}
      {review.length > 0 && <Banner kind="warn">{review.map((f) => `${f.name}: ${f.lastError ?? 'mapping review needed'}`).join(' · ')}.</Banner>}
      {q.isError && <Banner kind="crit">Integration health could not be loaded. Refresh, or call platform support with reference assets-integrations.</Banner>}

      <div className="grid g4">
        <Card title="Messages"><div style={{ font: '600 24px/1.1 var(--display)' }}>{q.data?.summary.messages24h ?? '—'}</div><div className="small muted">in the last 24 hours</div></Card>
        <Card title="Errors"><div style={{ font: '600 24px/1.1 var(--display)' }}>{q.data?.summary.errors24h ?? '—'}</div><div className="small muted">across every feed</div></Card>
        <Card title="Healthy feeds"><div style={{ font: '600 24px/1.1 var(--display)' }}>{q.data?.summary.healthy ?? '—'}</div><div className="small muted">of {feeds.length}</div></Card>
        <Card title="Modality silence alerts"><div style={{ font: '600 24px/1.1 var(--display)' }}>{q.data?.silenceAlerts.length ?? '—'}</div><div className="small muted">expected traffic not seen</div></Card>
      </div>

      <Card title="Feed health" extra="the raw-message store keeps every inbound message before and after parsing">
        {q.isLoading ? <Skeleton rows={6} /> : !feeds.length ? <EmptyState>No integration feeds configured.</EmptyState> : (
          <DataTable
            rows={feeds}
            rowKey={(f) => f.id}
            columns={[
              { key: 'feed', header: 'Feed', render: (f) => <><b>{f.name}</b><div className="small muted">{f.type}</div></> },
              { key: 'partner', header: 'Partner', render: (f) => f.partner ?? f.siteName },
              { key: 'transport', header: 'Transport', render: (f) => <span className="mono small">{f.transport ?? '—'} · {f.direction}</span> },
              { key: 'last', header: 'Last message', render: (f) => <span className="mono small">{f.lastMessageAt ? `${f.lastMessageAt.slice(11, 16)} · ${age(f.lastMessageAgeSeconds)}` : '—'}</span> },
              { key: 'msgs', header: 'Messages', num: true, render: (f) => <span className="mono">{f.messages24h}</span> },
              { key: 'errors', header: 'Errors', num: true, render: (f) => f.errors24h ? <span className="mono">{f.errors24h}</span> : <span className="mono muted">0</span> },
              { key: 'state', header: 'State', render: (f) => <><StatusChip status={f.status} />{f.lastError && <div className="small muted">{f.lastError}</div>}</> },
            ]}
          />
        )}
      </Card>

      {(q.data?.silenceAlerts.length ?? 0) > 0 && (
        <Card title="Modality silence" extra={<Chip kind="att">rule: no messages by 10:00 when traffic is expected</Chip>}>
          <DataTable
            rows={q.data!.silenceAlerts}
            rowKey={(s) => s.assetId}
            columns={[
              { key: 'device', header: 'Device', render: (s) => <b>{s.name}</b> },
              { key: 'site', header: 'Site', render: (s) => s.siteName },
              { key: 'reason', header: 'Reason', render: (s) => <span className="small">{s.reason}</span> },
            ]}
          />
          <p className="note">Silence that is explained by a known outage is annotated rather than alarmed, so the alert list stays worth reading.</p>
        </Card>
      )}
    </div>
  );
}
