import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Money, DateTime, Sparkline } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/group/board-pack')({ component: BoardPackPage });

interface PackKpi { id: string; name: string; value: number | null; unit: string; target: string; direction: string; source: string; tone: string; trend: Array<number | null>; definitionVersion: number }
interface Pack {
  period: string; generatedAt: string; scope: string; definitionsVersion: string; demo?: boolean;
  sections: {
    kpis: PackKpi[];
    whatChanged: Array<{ metric: string; value: number | null; target: string; note: string }>;
    governance: { severeIncidents: Array<{ ref: string; category: string; severity: number; status: string; regulator: string | null; reportStatus: string }>; overdueObligations: Array<{ instrument: string; obligation: string; dueDate: string | null; owner: string }>; aiSlipCount: number };
    acquisitions: Array<{ name: string; stage: string; sites: string[]; checklistDone: number; checklistTotal: number }>;
    hands: Array<{ hand: string; status: string; count: number }>;
  };
  glossary: Array<{ id: string; name: string; formula: string; version: number }>;
}

function value(k: PackKpi) {
  if (k.value === null) return <span className="muted">not available</span>;
  if (k.unit === 'cents') return <Money cents={Math.round(k.value)} />;
  if (k.unit === 'pct') return `${k.value} %`;
  if (k.unit === 'minutes') return `${Math.round(k.value)} min`;
  if (k.unit === 'days') return `${k.value} d`;
  return String(k.value);
}

function BoardPackPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const live = useQuery({ queryKey: ['board-pack', period], queryFn: () => api.get<{ pack: Pack }>(`/analytics/board-pack?period=${period}`) });
  const saved = useQuery({ queryKey: ['board-packs'], queryFn: () => api.get<{ packs: Array<{ id: string; period: string; title: string; status: string; createdAt: string; approvedBy: string | null }> }>('/analytics/board-packs') });
  const generate = useMutation({ mutationFn: () => api.post('/analytics/board-packs', { period }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['board-packs'] }) });
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/analytics/board-packs/${id}/approve`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['board-packs'] }) });

  const pack = live.data?.pack;

  return (
    <div className="page">
      <PageHeader
        title="Board pack"
        subtitle={pack ? `${pack.period} · ${pack.scope === 'group' ? 'Group' : pack.scope} · ${pack.definitionsVersion}` : 'Generated from the semantic layer'}
        actions={
          <>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" className="btn" />
            <Button variant="primary" disabled={generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? 'Generating…' : 'Save this pack'}</Button>
          </>
        }
      />

      {live.isError && <Banner kind="crit">The board pack could not be built. Refresh, or call platform support with reference board-pack.</Banner>}
      {pack && pack.sections.governance.aiSlipCount === 0 && <Banner kind="ok">AI slip counter: 0 for the period. Any non-zero value links straight to the incident.</Banner>}
      {pack && pack.sections.governance.aiSlipCount > 0 && <Banner kind="crit" action={<a className="btn sm" href="/compliance/incidents">Open incident</a>}>AI slip counter: {pack.sections.governance.aiSlipCount}. This is investigated immediately and never batched.</Banner>}

      <Card title="KPIs against plan" extra={pack ? `generated ${new Date(pack.generatedAt).toLocaleString('en-ZA', { hour12: false })}` : undefined}>
        {live.isLoading ? <Skeleton rows={6} /> : !pack ? <EmptyState>No pack for this period.</EmptyState> : (
          <DataTable
            rows={pack.sections.kpis}
            rowKey={(k) => k.id}
            columns={[
              { key: 'name', header: 'Metric', render: (k) => <><b>{k.name}</b><div className="small muted mono">{k.id} v{k.definitionVersion}</div></> },
              { key: 'value', header: 'Actual', num: true, render: (k) => value(k) },
              { key: 'target', header: 'Target', render: (k) => <span className="small">{k.target}</span> },
              { key: 'tone', header: 'State', render: (k) => k.tone === 'none' ? <span className="muted">—</span> : <Chip kind={k.tone === 'ok' ? 'done' : k.tone === 'att' ? 'att' : 'crit'}>{k.tone === 'ok' ? 'on target' : k.tone === 'att' ? 'off target' : 'outside target'}</Chip> },
              { key: 'trend', header: 'Trend', render: (k) => k.trend.filter((x) => x !== null).length > 2 ? <Sparkline values={k.trend.map((x) => x ?? 0)} tone={k.tone === 'crit' ? 'crit' : 'ok'} /> : <span className="muted small">no history</span> },
              { key: 'source', header: 'Source', render: (k) => <span className="small muted">{k.source}</span> },
            ]}
          />
        )}
      </Card>

      {pack && (
        <div className="split">
          <Card title="What changed" extra="largest variances against target">
            {!pack.sections.whatChanged.length ? <EmptyState>Every metric is on target for the period.</EmptyState> : (
              <ul className="small" style={{ paddingLeft: 18 }}>
                {pack.sections.whatChanged.map((x, i) => <li key={i}><b>{x.metric}</b>: {x.note}</li>)}
              </ul>
            )}
          </Card>

          <Card title="Governance">
            <h4 style={{ marginBottom: 6 }}>Severity 1 and 2 incidents</h4>
            {!pack.sections.governance.severeIncidents.length ? <p className="small muted">None in the period.</p> : (
              <DataTable
                rows={pack.sections.governance.severeIncidents}
                rowKey={(i) => i.ref}
                columns={[
                  { key: 'ref', header: 'Reference', render: (i) => <span className="mono">{i.ref}</span> },
                  { key: 'cat', header: 'Category', render: (i) => i.category.replace(/_/g, ' ') },
                  { key: 'status', header: 'Status', render: (i) => <StatusChip status={i.status} /> },
                  { key: 'report', header: 'Regulator report', render: (i) => i.reportStatus === 'none' ? <span className="muted">not required</span> : <Chip kind={i.reportStatus === 'submitted' ? 'done' : 'att'}>{i.reportStatus.replace(/_/g, ' ')}</Chip> },
                ]}
              />
            )}
            <h4 style={{ margin: '12px 0 6px' }}>Overdue obligations</h4>
            {!pack.sections.governance.overdueObligations.length ? <p className="small muted">None overdue.</p> : (
              <ul className="small" style={{ paddingLeft: 18 }}>
                {pack.sections.governance.overdueObligations.slice(0, 6).map((o, i) => <li key={i}>{o.instrument} · due {o.dueDate} · owner {o.owner}</li>)}
              </ul>
            )}
          </Card>
        </div>
      )}

      {pack && (
        <div className="split">
          <Card title="Acquisitions">
            <DataTable
              rows={pack.sections.acquisitions}
              rowKey={(a) => a.name}
              columns={[
                { key: 'name', header: 'Target', render: (a) => <>{a.name}<div className="small muted">{a.sites.join(', ')}</div></> },
                { key: 'stage', header: 'Stage', render: (a) => <Chip kind={a.stage === 'live' ? 'done' : 'active'}>{a.stage.replace(/_/g, ' ')}</Chip> },
                { key: 'checklist', header: 'Onboarding', num: true, render: (a) => <span className="mono">{a.checklistDone}/{a.checklistTotal}</span> },
              ]}
            />
          </Card>
          <Card title="Hand activity">
            <DataTable
              rows={pack.sections.hands}
              rowKey={(h) => `${h.hand}:${h.status}`}
              columns={[
                { key: 'hand', header: 'Hand', render: (h) => h.hand },
                { key: 'status', header: 'Outcome', render: (h) => <StatusChip status={h.status} /> },
                { key: 'n', header: 'Runs', num: true, render: (h) => <span className="mono">{h.count}</span> },
              ]}
            />
          </Card>
        </div>
      )}

      <Card title="Saved packs" extra={saved.data ? `${saved.data.packs.length} versions` : undefined}>
        {saved.isLoading ? <Skeleton rows={3} /> : !saved.data?.packs.length ? <EmptyState>No packs saved yet.</EmptyState> : (
          <DataTable
            rows={saved.data.packs}
            rowKey={(p) => p.id}
            columns={[
              { key: 'title', header: 'Pack', render: (p) => p.title },
              { key: 'status', header: 'Status', render: (p) => <StatusChip status={p.status} /> },
              { key: 'created', header: 'Generated', render: (p) => <DateTime iso={p.createdAt} /> },
              { key: 'act', header: '', render: (p) => p.status === 'draft' ? <Button size="sm" variant="primary" disabled={approve.isPending} onClick={() => approve.mutate(p.id)}>Approve</Button> : <Chip kind="done">approved</Chip> },
            ]}
          />
        )}
      </Card>

      {pack && (
        <Card title="Glossary" extra="every metric used in this pack, with its formula and version">
          <DataTable
            rows={pack.glossary}
            rowKey={(g) => g.id}
            columns={[
              { key: 'id', header: 'Code', render: (g) => <span className="mono">{g.id}</span> },
              { key: 'name', header: 'Metric', render: (g) => g.name },
              { key: 'formula', header: 'Formula', render: (g) => <span className="small">{g.formula}</span> },
              { key: 'v', header: 'Version', num: true, render: (g) => <span className="mono">v{g.version}</span> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
