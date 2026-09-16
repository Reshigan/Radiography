import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DataTable, EmptyState, KV, PageHeader, Sheet, Skeleton, Tile } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/bci/')({ component: Registry });

export interface Model {
  id: string; modelId: string; name: string; version: string; task: string; outputClass: number; modalities: string[]; bodyParts: string[] | null;
  vendor: string; samdStatus: string; compute: string; overlaysDefault: string; lifecycle: string; siteStatus: Record<string, string>;
  validationSummary: Record<string, string | number>; limitations: string[] | null; description: string | null; demo: boolean; bundleDigest: string | null;
  deployments: { activated: number; shadow: number; paused: number; off: number }; resultCount: number;
}
export interface Site { id: string; code: string; name: string; practiceId: string }

export function samdLabel(s: string) {
  if (s.startsWith('registered_samd')) return `Registered SaMD · ${s.replace('registered_samd_', '')}`;
  if (s === 'assessed_not_a_medical_device') return 'Assessed: not a medical device';
  return s.replace(/_/g, ' ');
}

function Registry() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bci-models'], queryFn: () => api.get<{ models: Model[]; sites: Site[] }>('/bci/models') });
  const [open, setOpen] = useState<Model | null>(null);
  const [reason, setReason] = useState('');
  const change = useMutation({
    mutationFn: (v: { id: string; siteId: string; status: string }) => api.patch(`/bci/models/${v.id}/status`, { siteId: v.siteId, status: v.status, reason: reason || 'Operator change from the BCI console' }),
    onSuccess: () => { setReason(''); void qc.invalidateQueries({ queryKey: ['bci-models'] }); },
  });

  return (
    <div className="page">
      <PageHeader title="Model registry" subtitle="Every model, every version, its output class, its regulatory status and where it is running. A new version is a new entry and a new change request." />
      {q.isError && <Banner kind="crit">The registry could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={6} />}
      {q.data && (q.data.models.length === 0 ? <EmptyState>No models are registered.</EmptyState> : (
        <>
          <div className="grid g4">
            <Tile label="Models" value={new Set(q.data.models.map((m) => m.modelId)).size} delta={`${q.data.models.length} versions`} />
            <Tile label="Class 1 models" value={q.data.models.filter((m) => m.outputClass === 1).length} delta="findings reach the report only through the radiologist" />
            <Tile label="In shadow" value={q.data.models.filter((m) => m.lifecycle === 'shadow').length} />
            <Tile label="Results stored" value={q.data.models.reduce((a, m) => a + m.resultCount, 0)} />
          </div>
          <Card title="Registry" extra="click a row for the model card">
            <DataTable
              rows={q.data.models}
              rowKey={(x) => x.id}
              onRowClick={(x) => setOpen(x)}
              columns={[
                { key: 'id', header: 'Model', render: (x) => <><span className="mono">{x.name}</span><div className="muted small">{x.modalities.join(', ')}{x.bodyParts ? ` · ${x.bodyParts.join(', ')}` : ''}</div></> },
                { key: 'v', header: 'Version', render: (x) => <span className="mono">{x.version}</span> },
                { key: 'task', header: 'Task · class', render: (x) => <>{x.task} · <Chip kind={x.outputClass === 1 ? 'crit' : 'neutral'}>class {x.outputClass}</Chip></> },
                { key: 'dep', header: 'Deployment', render: (x) => (
                  <span className="row-flex">
                    {x.deployments.activated > 0 && <Chip kind="done">activated {x.deployments.activated}</Chip>}
                    {x.deployments.shadow > 0 && <Chip>shadow {x.deployments.shadow}</Chip>}
                    {x.deployments.paused > 0 && <Chip kind="crit">paused {x.deployments.paused}</Chip>}
                    {x.deployments.off > 0 && <Chip kind="att">off {x.deployments.off}</Chip>}
                    {x.lifecycle === 'deprecated' && <Chip kind="att">deprecated</Chip>}
                  </span>
                ) },
                { key: 'samd', header: 'Regulatory status', render: (x) => <span className="small">{samdLabel(x.samdStatus)}</span> },
                { key: 'val', header: 'Last validation', render: (x) => <span className="mono small">{String(x.validationSummary.lastValidatedAt ?? '—')}</span> },
              ]}
            />
          </Card>
        </>
      ))}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${open.name} ${open.version}` : ''}>
        {open && (
          <>
            <KV items={[
              ['Intended use', open.description ?? '—'],
              ['Task and class', `${open.task} · output class ${open.outputClass}`],
              ['Scope', `${open.modalities.join(', ')}${open.bodyParts ? ` · ${open.bodyParts.join(', ')}` : ''}`],
              ['Vendor', open.vendor],
              ['Regulatory status', samdLabel(open.samdStatus)],
              ['Compute', open.compute],
              ['Overlays', open.overlaysDefault === 'off' ? 'off by default (human-first policy)' : 'on for flagged studies'],
              ['Bundle digest', <span key="d" className="mono small">{open.bundleDigest}</span>],
              ['Demo model', open.demo ? 'Yes: deterministic demo model, not a diagnostic device' : 'No'],
            ]} />
            <Card title="Validation summary">
              <KV items={Object.entries(open.validationSummary).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), String(v)] as [string, string])} />
            </Card>
            {open.limitations?.length ? (
              <Card title="Known limitations">
                <ul style={{ margin: 0, paddingLeft: 18 }}>{open.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
              </Card>
            ) : null}
            <Card title="Status per site" extra="a kill switch acts immediately">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (recorded)" style={{ width: '100%', height: 30, marginBottom: 8 }} aria-label="Reason" />
              <DataTable
                rows={q.data?.sites ?? []}
                rowKey={(sx) => sx.id}
                columns={[
                  { key: 'site', header: 'Site', render: (sx) => sx.name },
                  { key: 'status', header: 'Status', render: (sx) => <Chip kind={open.siteStatus[sx.id] === 'paused' || open.siteStatus[sx.id] === 'off' ? 'crit' : open.siteStatus[sx.id] === 'shadow' || open.lifecycle === 'shadow' ? 'neutral' : 'done'}>{open.siteStatus[sx.id] ?? open.lifecycle}</Chip> },
                  { key: 'act', header: '', render: (sx) => (
                    <span className="row-flex">
                      <Button size="sm" onClick={() => change.mutate({ id: open.id, siteId: sx.id, status: 'activated' })}>Activate</Button>
                      <Button size="sm" onClick={() => change.mutate({ id: open.id, siteId: sx.id, status: 'shadow' })}>Shadow</Button>
                      <Button size="sm" variant="danger" onClick={() => change.mutate({ id: open.id, siteId: sx.id, status: 'paused' })}>Pause</Button>
                    </span>
                  ) },
                ]}
              />
              <div className="note">Pausing a model stops inference at that site within seconds, opens a change record and keeps every earlier result immutable.</div>
            </Card>
          </>
        )}
      </Sheet>
    </div>
  );
}
