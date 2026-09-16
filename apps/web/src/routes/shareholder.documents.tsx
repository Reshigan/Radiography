import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Money, Skeleton, EmptyState, Chip, Button, DataTable, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/shareholder/documents')({ component: Page });

function Page() {
  const me = useQuery({ queryKey: ['shareholder-me'], queryFn: () => api.get<any>('/finance/shareholder/me') });
  const periods = useQuery({ queryKey: ['fiscal-periods'], queryFn: () => api.get<{ periods: Array<{ period: string; status: string; lockRef: string | null; lockedAt: string | null }> }>('/finance/periods') });
  const dist = useQuery({ queryKey: ['distributions'], queryFn: () => api.get<{ statements: Array<{ period: string; grossCents: number; netCents: number; dividendsTaxCents: number; status: string; bankRef: string | null }> }>('/finance/distributions') });

  const docs = me.data?.documents ?? [];
  const statements = dist.data?.statements ?? [];

  return (
    <div className="page">
      <PageHeader title="Documents" subtitle="Agreements, management accounts and tax certificates — download only" />
      {me.isError && <Banner kind="crit">Documents could not be loaded.</Banner>}

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <Card title="Agreements and accounts">
          {me.isLoading ? <Skeleton rows={5} /> : docs.length === 0 ? <EmptyState>No documents are shared with you yet.</EmptyState> : (
            <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              {docs.map((d: { name: string; detail: string; kind: string }, i: number) => (
                <div key={d.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', padding: '10px 12px', borderBottom: i < docs.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 13 }}>
                  <span>{d.name}<span className="small muted" style={{ display: 'block' }}>{d.detail}</span></span>
                  <Button size="sm" variant="ghost">{d.kind}</Button>
                </div>
              ))}
            </div>
          )}
          <p className="note" style={{ marginTop: 8 }}>Documents are served through the secure share and every download is logged against your identity.</p>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="My distribution statements and tax certificates" extra={`${statements.length}`}>
            {dist.isLoading ? <Skeleton rows={4} /> : statements.length === 0 ? <EmptyState>No statements have been issued.</EmptyState> : (
              <DataTable
                rows={statements}
                rowKey={(x) => x.period}
                columns={[
                  { key: 'p', header: 'Period', render: (x) => x.period },
                  { key: 'g', header: 'Gross', num: true, render: (x) => <Money cents={x.grossCents} /> },
                  { key: 't', header: 'Dividends tax', num: true, render: (x) => <Money cents={x.dividendsTaxCents} /> },
                  { key: 'n', header: 'Net', num: true, render: (x) => <Money cents={x.netCents} /> },
                  { key: 's', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                  { key: 'd', header: 'Documents', render: (x) => x.status === 'paid' ? <><Button size="sm" variant="ghost">Statement</Button><Button size="sm" variant="ghost">Tax certificate</Button></> : <span className="muted">on payment</span> },
                ]}
              />
            )}
            <p className="note" style={{ marginTop: 6 }}>Annual certificates are generated per shareholder per tax year, with a year-to-date summary for provisional tax.</p>
          </Card>

          <Card title="Locked periods" extra="restatements are labelled, never silent">
            {periods.isLoading ? <Skeleton rows={4} /> : (periods.data?.periods.length ?? 0) === 0 ? <EmptyState>No periods have closed yet.</EmptyState> : (
              <DataTable
                rows={periods.data!.periods}
                rowKey={(x) => x.period}
                columns={[
                  { key: 'p', header: 'Period', render: (x) => x.period },
                  { key: 's', header: 'Status', render: (x) => <Chip kind={x.status === 'locked' ? 'done' : 'att'}>{x.status.replace(/_/g, ' ')}</Chip> },
                  { key: 'r', header: 'Lock reference', render: (x) => <span className="mono small">{x.lockRef ?? '—'}</span> },
                  { key: 'a', header: 'Locked', render: (x) => x.lockedAt ? new Date(x.lockedAt).toLocaleDateString('en-ZA') : '—' },
                ]}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
