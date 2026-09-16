import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DataTable, DateTime, EmptyState, PageHeader, Queue, Skeleton } from '@bonakala/bdl';
import { api } from '../lib/api';
import { type Model, type Site } from './bci.index';
import { type ModelEvent } from './bci.incidents';

export const Route = createFileRoute('/bci/change-control')({ component: ChangeControl });

function ChangeControl() {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const models = useQuery({ queryKey: ['bci-models'], queryFn: () => api.get<{ models: Model[]; sites: Site[] }>('/bci/models') });
  const events = useQuery({ queryKey: ['bci-events'], queryFn: () => api.get<{ events: ModelEvent[] }>('/bci/events') });
  const change = useMutation({
    mutationFn: (v: { id: string; siteId?: string; status: string }) => api.patch(`/bci/models/${v.id}/status`, { siteId: v.siteId, status: v.status, reason: reason || 'Change made from the change-control page' }),
    onSuccess: () => { setReason(''); void qc.invalidateQueries({ queryKey: ['bci-models'] }); void qc.invalidateQueries({ queryKey: ['bci-events'] }); },
  });
  const records = (events.data?.events ?? []).filter((e) => ['change_record', 'kill_switch', 'activation', 'shadow_report'].includes(e.type));

  return (
    <div className="page">
      <PageHeader title="Change control and kill switches" subtitle="Every activation, pause and version change is a recorded change with a reason. A kill switch acts immediately and returns the model to shadow." />
      {(models.isLoading || events.isLoading) && <Skeleton rows={6} />}
      {models.isError && <Banner kind="crit">Models could not be loaded. {(models.error as Error).message}</Banner>}
      {models.data && (
        <>
          <Card title="Kill switches" extra="per model, all deployments">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the next change (recorded with your name)" style={{ width: '100%', height: 32, marginBottom: 8 }} aria-label="Reason" />
            <DataTable
              rows={models.data.models.filter((m) => m.lifecycle !== 'deprecated')}
              rowKey={(m) => m.id}
              columns={[
                { key: 'm', header: 'Model', render: (m) => <><span className="mono">{m.name} {m.version}</span><div className="muted small">{m.deployments.activated} activated · {m.deployments.shadow} shadow · {m.deployments.paused + m.deployments.off} stopped</div></> },
                { key: 'class', header: 'Class', render: (m) => <Chip kind={m.outputClass === 1 ? 'crit' : 'neutral'}>class {m.outputClass}</Chip> },
                { key: 'state', header: 'Lifecycle', render: (m) => <Chip kind={m.lifecycle === 'activated' ? 'done' : m.lifecycle === 'paused' ? 'crit' : 'neutral'}>{m.lifecycle}</Chip> },
                { key: 'act', header: '', render: (m) => (
                  <span className="row-flex">
                    <Button size="sm" variant="danger" onClick={() => change.mutate({ id: m.id, status: 'paused' })}>Pause everywhere</Button>
                    <Button size="sm" onClick={() => change.mutate({ id: m.id, status: 'shadow' })}>Return to shadow</Button>
                  </span>
                ) },
              ]}
            />
            <div className="note">Switching a model off opens a change record and returns it to shadow. Re-enabling needs a change record approved by the practice's compliance officer.</div>
          </Card>
          <Card title="Per site and practice">
            <Queue
              rows={models.data.models.flatMap((m) => Object.entries(m.siteStatus).map(([siteId, st]) => ({ id: `${m.id}-${siteId}`, model: m, siteId, st })))}
              rowKey={(x) => x.id}
              render={(x) => ({
                lead: <Chip kind={x.st === 'paused' || x.st === 'off' ? 'crit' : x.st === 'shadow' ? 'neutral' : 'done'}>{x.st}</Chip>,
                title: <>{x.model.name} {x.model.version}</>,
                sub: <>{models.data!.sites.find((sx) => sx.id === x.siteId)?.name ?? x.siteId}{x.model.overlaysDefault === 'off' ? ' · overlays off by policy' : ''}</>,
                aux: <Button size="sm" onClick={() => change.mutate({ id: x.model.id, siteId: x.siteId, status: x.st === 'activated' ? 'paused' : 'activated' })}>{x.st === 'activated' ? 'Pause here' : 'Activate here'}</Button>,
              })}
            />
          </Card>
        </>
      )}
      {events.data && (records.length === 0 ? <EmptyState>No change records yet.</EmptyState> : (
        <Card title="Change records" extra={`${records.length} records`}>
          <DataTable
            rows={records}
            rowKey={(e) => e.id}
            columns={[
              { key: 'when', header: 'Raised', render: (e) => <DateTime iso={e.createdAt} /> },
              { key: 'type', header: 'Type', render: (e) => <Chip kind={e.type === 'kill_switch' ? 'crit' : e.type === 'activation' ? 'done' : 'neutral'}>{e.type.replace(/_/g, ' ')}</Chip> },
              { key: 'title', header: 'Change', render: (e) => <>{e.title}<div className="muted small">{String((e.detail as any).reason ?? (e.detail as any).plan ?? '')}</div></> },
              { key: 'status', header: 'Status', render: (e) => <Chip kind={e.status === 'open' ? 'att' : 'done'}>{e.status}</Chip> },
            ]}
          />
        </Card>
      ))}
    </div>
  );
}
