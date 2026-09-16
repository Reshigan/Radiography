import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, Card, Chip, DataTable, DateTime, EmptyState, Money, PageHeader, Skeleton, Tile } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/read/fees')({ component: Fees });

interface Line { reportId: string; accession: string; signedAt: string | null; priority: string; subspecialty: string | null; rvu: number; feeCents: number }
interface Data { from: string; to: string; count: number; totalRvu: number; totalCents: number; lines: Line[] }

function Fees() {
  const q = useQuery({ queryKey: ['read-fees'], queryFn: () => api.get<Data>('/reporting/fees') });
  return (
    <div className="page">
      <PageHeader title="Reading fees" subtitle="Weighted per signed report under the reading services agreement. Corrections reverse the event; addenda are paid only where the contract says so." />
      {q.isError && <Banner kind="crit">The statement could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={4} />}
      {q.data && (q.data.count === 0 ? <EmptyState>No reports were signed in this period.</EmptyState> : (
        <>
          <div className="grid g3">
            <Tile label="Reports signed" value={q.data.count} delta={<><DateTime iso={q.data.from} time={false} /> to <DateTime iso={q.data.to} time={false} /></>} />
            <Tile label="RVU-equivalents" value={q.data.totalRvu.toFixed(2)} delta="STAT ×1.5, after hours ×1.25" />
            <Tile label="Statement total" value={<Money cents={q.data.totalCents} />} delta="R 320.00 per 1.0 RVU-equivalent" />
          </div>
          <Card title="Statement lines" extra={`${q.data.lines.length} lines`}>
            <DataTable
              rows={q.data.lines}
              rowKey={(x) => x.reportId}
              columns={[
                { key: 'acc', header: 'Accession', render: (x) => <span className="mono">{x.accession}</span> },
                { key: 'signed', header: 'Signed', render: (x) => <DateTime iso={x.signedAt} /> },
                { key: 'sub', header: 'Sub-specialty', render: (x) => x.subspecialty ?? '—' },
                { key: 'pri', header: 'Priority', render: (x) => (x.priority === 'stat' ? <Chip kind="crit">STAT</Chip> : x.priority === 'urgent' ? <Chip kind="att">Urgent</Chip> : <Chip>Routine</Chip>) },
                { key: 'rvu', header: 'RVU-eq', num: true, render: (x) => <span className="mono">{x.rvu.toFixed(2)}</span> },
                { key: 'fee', header: 'Fee', num: true, render: (x) => <Money cents={x.feeCents} /> },
              ]}
            />
          </Card>
        </>
      ))}
    </div>
  );
}
