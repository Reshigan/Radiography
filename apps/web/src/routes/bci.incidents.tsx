import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DateTime, EmptyState, KV, PageHeader, Queue, Skeleton, Tile } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/bci/incidents')({ component: Incidents });

export interface ModelEvent { id: string; siteId: string | null; modelId: string; modelVersion: string | null; type: string; severity: string; title: string; detail: Record<string, unknown>; status: string; createdAt: string; resolvedAt: string | null }

function Incidents() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bci-events'], queryFn: () => api.get<{ events: ModelEvent[] }>('/bci/events') });
  const resolve = useMutation({ mutationFn: (v: { id: string; status: string }) => api.post(`/bci/events/${v.id}/resolve`, { status: v.status, note: 'Reviewed in the AI operations console' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['bci-events'] }) });
  const events = (q.data?.events ?? []).filter((e) => ['incident', 'drift_alarm', 'revalidation'].includes(e.type));
  const open = events.filter((e) => e.status === 'open');

  return (
    <div className="page">
      <PageHeader title="Incidents and drift alarms" subtitle="Performance degradation, near-slips and re-validation flags. A model failure with potential for harm is a vigilance matter for the clinical safety officer." />
      {q.isError && <Banner kind="crit">Events could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (
        <>
          <div className="grid g3">
            <Tile label="Open" value={open.length} tone={open.length ? 'down' : 'up'} />
            <Tile label="Drift alarms" value={events.filter((e) => e.type === 'drift_alarm').length} />
            <Tile label="Re-validation flags" value={events.filter((e) => e.type === 'revalidation').length} />
          </div>
          {events.length === 0 ? <EmptyState>No incidents or alarms are recorded.</EmptyState> : events.map((e) => (
            <Card key={e.id} title={e.title} extra={<span className="row-flex"><Chip kind={e.severity === 'crit' ? 'crit' : e.severity === 'warn' ? 'att' : 'neutral'}>{e.type.replace(/_/g, ' ')}</Chip><Chip kind={e.status === 'open' ? 'att' : 'done'}>{e.status}</Chip></span>}>
              <div className="ai">
                <div className="prov">
                  <span>model <b>{e.modelId}{e.modelVersion ? `@${e.modelVersion}` : ''}</b></span>
                  {e.siteId && <span>site <b>{e.siteId.replace('site_', '').toUpperCase()}</b></span>}
                  <span>raised <b>{e.createdAt.slice(0, 16).replace('T', ' ')}</b></span>
                </div>
                <KV items={Object.entries(e.detail).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string])} />
              </div>
              {e.status === 'open' && (
                <div className="row-flex" style={{ marginTop: 8 }}>
                  <Button size="sm" onClick={() => resolve.mutate({ id: e.id, status: 'acknowledged' })}>Acknowledge</Button>
                  <Button size="sm" variant="primary" onClick={() => resolve.mutate({ id: e.id, status: 'closed' })}>Close</Button>
                  <span className="muted small">Closing records who reviewed it and when. Pausing a model is done on the registry page.</span>
                </div>
              )}
              {e.resolvedAt && <div className="muted small">Resolved <DateTime iso={e.resolvedAt} />.</div>}
            </Card>
          ))}
          <Card title="Near-slip definition">
            <Queue
              rows={[
                { id: '1', t: 'Class 1 content reaching a record without a radiologist signature', s: 'Technically impossible: only the sign route publishes report text and no Hand holds a sign tool.' },
                { id: '2', t: 'A rejected candidate appearing in a report', s: 'Blocked at the editor and checked again by the pre-sign consistency model.' },
                { id: '3', t: 'A result attaching to an unreconciled study', s: 'Inference is held until the study is reconciled, then back-filled.' },
              ]}
              rowKey={(x) => x.id}
              render={(x) => ({ lead: <Chip kind="done">guarded</Chip>, title: x.t, sub: x.s })}
            />
          </Card>
        </>
      )}
    </div>
  );
}
