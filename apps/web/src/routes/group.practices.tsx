import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Skeleton, EmptyState, DataTable, Chip, Bars } from '@bonakala/bdl';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMetric, DefinitionSheet, type MetricTile, type TilesResponse } from './practice.index';

export const Route = createFileRoute('/group/practices')({ component: PracticesPage });

const COMPARE = ['FIN.REV', 'FIN.EBITDA', 'OPS.TAT.SLA', 'RCM.FPA', 'RCM.DSO', 'WFM.VAC', 'AST.UP', 'CMP.INC'];

function PracticesPage() {
  const { me } = useAuth();
  const [define, setDefine] = useState<MetricTile | null>(null);
  const practices = me?.practices ?? [];

  const queries = useQuery({
    queryKey: ['practice-compare', practices.map((p) => p.id).join(',')],
    enabled: practices.length > 0,
    queryFn: async () => {
      const out: Array<{ id: string; name: string | null; tiles: MetricTile[] }> = [];
      for (const p of practices) {
        const res = await fetch(`/api/analytics/tiles?scope=practice&ids=${COMPARE.join(',')}`, { headers: { 'x-practice-id': p.id }, credentials: 'include' });
        const json = (await res.json()) as TilesResponse;
        out.push({ id: p.id, name: p.name, tiles: json.tiles ?? [] });
      }
      return out;
    },
  });

  const shareholdings = useQuery({ queryKey: ['shareholdings'], queryFn: () => api.get<{ shareholdings: Array<{ id: string; entityId: string; shareholderName: string; shareClass: string; shares: number; percentage: number }> }>('/org/shareholdings') });

  const rows = queries.data ?? [];

  return (
    <div className="page">
      <PageHeader title="Practices" subtitle="The same metric definitions applied to every practice, side by side" actions={<a className="btn" href="/group">Group tower</a>} />

      {queries.isError && <Banner kind="crit">Practice comparison could not be loaded. Refresh, or call platform support with reference analytics-tiles.</Banner>}

      <Card title="Practice comparison" extra={`${rows.length} practices`}>
        {queries.isLoading ? <Skeleton rows={6} /> : !rows.length ? <EmptyState>No practices in scope.</EmptyState> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dt">
              <thead>
                <tr>
                  <th>Metric</th>
                  {rows.map((r) => <th key={r.id} className="num">{r.name ?? r.id}</th>)}
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((id) => {
                  const sample = rows[0]?.tiles.find((t) => t.id === id);
                  if (!sample) return null;
                  return (
                    <tr key={id} className="clickable" onClick={() => setDefine(sample)}>
                      <td><b>{sample.name}</b><div className="small muted mono">{id}</div></td>
                      {rows.map((r) => {
                        const t = r.tiles.find((x) => x.id === id);
                        return (
                          <td key={r.id} className="num">
                            {t ? <>{formatMetric(t)} {t.tone !== 'none' && <Chip kind={t.tone === 'ok' ? 'done' : t.tone === 'att' ? 'att' : 'crit'}>{t.tone === 'ok' ? 'on target' : 'off'}</Chip>}</> : <span className="muted">—</span>}
                          </td>
                        );
                      })}
                      <td className="small muted">{sample.targetLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Every cell is computed from the one definition in the semantic layer. Select a row to see the formula, grain and version.</p>
      </Card>

      <div className="split">
        <Card title="Shareholding by entity">
          {shareholdings.isLoading ? <Skeleton rows={4} /> : !shareholdings.data?.shareholdings.length ? <EmptyState>No shareholdings recorded.</EmptyState> : (
            <DataTable
              rows={shareholdings.data.shareholdings}
              rowKey={(s) => s.id}
              columns={[
                { key: 'entity', header: 'Entity', render: (s) => practices.find((p) => p.id === s.entityId)?.name ?? s.entityId },
                { key: 'holder', header: 'Shareholder', render: (s) => s.shareholderName },
                { key: 'class', header: 'Class', render: (s) => s.shareClass },
                { key: 'pct', header: 'Holding', num: true, render: (s) => <span className="mono">{s.percentage} %</span> },
              ]}
            />
          )}
        </Card>

        <Card title="Studies per FTE by practice" extra="case-mix adjusted">
          {queries.isLoading ? <Skeleton rows={4} /> : (
            <Bars
              data={rows.map((r) => ({ label: r.name ?? r.id, value: Math.round(r.tiles.find((t) => t.id === 'AST.UP')?.value ?? 0), tone: 'ok' as const }))}
              format={(v) => `${v} %`}
            />
          )}
          <p className="note">Individual staff productivity is never shown in a benchmark; only practice-level, case-mix adjusted figures appear here.</p>
        </Card>
      </div>

      <DefinitionSheet tile={define} onClose={() => setDefine(null)} />
    </div>
  );
}
