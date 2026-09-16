import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, Banner, Chip, Skeleton, EmptyState, DataTable } from '@bonakala/bdl';
import { api } from '../lib/api';
import { AdminShell } from './admin.index';

export const Route = createFileRoute('/admin/organisation')({ component: OrganisationPage });

interface Entity { id: string; type: string; registeredName: string; tradingName: string | null; cipcNo: string | null; vatNo: string | null; bhfPracticeNo: string | null; accessionPrefix: string | null; financialYearEnd: string | null; status: string }
interface Relationship { id: string; parentId: string; childId: string; type: string; feeModel: { basis: string; rate?: number; perStudyCents?: number } | null; effectiveFrom: string; effectiveTo: string | null }
interface Shareholding { id: string; entityId: string; shareholderName: string; shareClass: string; shares: number; percentage: number; effectiveFrom: string }

function OrganisationPage() {
  const q = useQuery({ queryKey: ['entities'], queryFn: () => api.get<{ entities: Entity[]; relationships: Relationship[]; shareholdings: Shareholding[] }>('/org/entities') });
  const entities = q.data?.entities ?? [];
  const nameOf = (id: string) => entities.find((e) => e.id === id)?.tradingName ?? entities.find((e) => e.id === id)?.registeredName ?? id;

  const roots = entities.filter((e) => e.type === 'holding');
  const childrenOf = (id: string) => (q.data?.relationships ?? []).filter((r) => r.parentId === id && ['subsidiary', 'jv'].includes(r.type)).map((r) => ({ rel: r, entity: entities.find((e) => e.id === r.childId) })).filter((x) => x.entity);

  return (
    <AdminShell active="/admin/organisation" title="Organisation" subtitle="Entities, relationships, agreements and shareholding">
      {q.isError && <Banner kind="crit">The organisation register could not be loaded. Refresh, or call platform support with reference org-entities.</Banner>}

      <Card title="Entity tree" extra="a practice is a clinical legal entity owned by registered practitioners">
        {q.isLoading ? <Skeleton rows={5} /> : !entities.length ? <EmptyState>No entities registered.</EmptyState> : (
          <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
            {roots.map((root) => (
              <li key={root.id}>
                <div className="spread" style={{ padding: '6px 0' }}>
                  <span><b>{root.tradingName ?? root.registeredName}</b> <Chip>{root.type}</Chip></span>
                  <span className="small muted mono">{root.cipcNo ?? ''}</span>
                </div>
                <ul style={{ listStyle: 'none', paddingLeft: 20, margin: 0, borderLeft: '1px solid var(--line)' }}>
                  {childrenOf(root.id).map(({ rel, entity }) => (
                    <li key={rel.id}>
                      <div className="spread" style={{ padding: '4px 0' }}>
                        <span>{entity!.tradingName ?? entity!.registeredName} <Chip kind={rel.type === 'jv' ? 'att' : 'neutral'}>{rel.type}</Chip></span>
                        <span className="small muted mono">{entity!.bhfPracticeNo ? `practice no ${entity!.bhfPracticeNo}` : entity!.cipcNo ?? ''}</span>
                      </div>
                      <ul style={{ listStyle: 'none', paddingLeft: 20, margin: 0, borderLeft: '1px solid var(--line)' }}>
                        {childrenOf(entity!.id).map(({ rel: r2, entity: e2 }) => (
                          <li key={r2.id} className="spread" style={{ padding: '4px 0' }}>
                            <span>{e2!.tradingName ?? e2!.registeredName} <Chip kind={r2.type === 'jv' ? 'att' : 'neutral'}>{r2.type}</Chip></span>
                            <span className="small muted mono">{e2!.accessionPrefix ? `accession ${e2!.accessionPrefix}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Entities">
        {q.isLoading ? <Skeleton rows={5} /> : (
          <DataTable
            rows={entities}
            rowKey={(e) => e.id}
            columns={[
              { key: 'name', header: 'Entity', render: (e) => <><b>{e.tradingName ?? e.registeredName}</b><div className="small muted">{e.registeredName}</div></> },
              { key: 'type', header: 'Type', render: (e) => <Chip>{e.type.replace(/_/g, ' ')}</Chip> },
              { key: 'cipc', header: 'CIPC', render: (e) => <span className="mono small">{e.cipcNo ?? '—'}</span> },
              { key: 'vat', header: 'VAT', render: (e) => <span className="mono small">{e.vatNo ?? '—'}</span> },
              { key: 'bhf', header: 'Practice number', render: (e) => <span className="mono small">{e.bhfPracticeNo ?? '—'}</span> },
              { key: 'fye', header: 'Year end', render: (e) => <span className="mono small">{e.financialYearEnd ?? '—'}</span> },
            ]}
          />
        )}
      </Card>

      <div className="split">
        <Card title="Agreements">
          {q.isLoading ? <Skeleton rows={4} /> : (
            <DataTable
              rows={(q.data?.relationships ?? []).filter((r) => !['subsidiary'].includes(r.type))}
              rowKey={(r) => r.id}
              columns={[
                { key: 'parties', header: 'Parties', render: (r) => <span className="small">{nameOf(r.parentId)} → {nameOf(r.childId)}</span> },
                { key: 'type', header: 'Type', render: (r) => <Chip>{r.type.replace(/_/g, ' ')}</Chip> },
                { key: 'fee', header: 'Fee model', render: (r) => r.feeModel ? <span className="small mono">{r.feeModel.basis}{r.feeModel.rate ? ` ${(r.feeModel.rate * 100).toFixed(0)} %` : ''}{r.feeModel.perStudyCents ? ` R ${(r.feeModel.perStudyCents / 100).toFixed(0)}/study` : ''}</span> : <span className="muted">—</span> },
                { key: 'from', header: 'From', render: (r) => <span className="mono small">{r.effectiveFrom}</span> },
              ]}
            />
          )}
          <p className="note">Management services are structured as management fees rather than fee sharing, in line with the ethical rules on practice ownership.</p>
        </Card>

        <Card title="Shareholding">
          {q.isLoading ? <Skeleton rows={4} /> : (
            <DataTable
              rows={q.data?.shareholdings ?? []}
              rowKey={(s) => s.id}
              columns={[
                { key: 'entity', header: 'Entity', render: (s) => nameOf(s.entityId) },
                { key: 'holder', header: 'Shareholder', render: (s) => s.shareholderName },
                { key: 'class', header: 'Class', render: (s) => s.shareClass },
                { key: 'shares', header: 'Shares', num: true, render: (s) => <span className="mono">{s.shares.toLocaleString('en-ZA')}</span> },
                { key: 'pct', header: 'Holding', num: true, render: (s) => <span className="mono">{s.percentage} %</span> },
              ]}
            />
          )}
        </Card>
      </div>
    </AdminShell>
  );
}
