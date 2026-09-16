import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, Banner, Skeleton, EmptyState, StatusChip, DateTime, Button } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/p/results')({ component: Results });

interface Result { id: string; procedure?: string; procedureCode?: string; status: string; signedAt?: string | null; createdAt?: string; accession?: string }

function Results() {
  // Results are owned by the results module; this page shows them when that route exists.
  const results = useQuery({ queryKey: ['my-results'], queryFn: () => api.get<{ results: Result[] }>('/results/mine').catch(() => null) });
  const orders = useQuery({ queryKey: ['my-orders'], queryFn: () => api.get<{ orders: Array<{ id: string; procedures: Array<{ description: string }>; status: string; createdAt: string }> }>('/referrals/my-orders') });

  const done = (orders.data?.orders ?? []).filter((o) => ['completed', 'in_progress'].includes(o.status));

  return (
    <div className="page">
      <h1 style={{ fontSize: 24 }}>Results</h1>
      {results.isLoading || orders.isLoading ? <Skeleton rows={5} /> : results.data?.results?.length ? (
        results.data.results.map((r) => (
          <Card key={r.id} title={r.procedure ?? r.procedureCode ?? 'Scan'} extra={<StatusChip status={r.status} />}>
            <p className="muted"><DateTime iso={r.signedAt ?? r.createdAt ?? null} /></p>
            <Button size="sm">Open</Button>
          </Card>
        ))
      ) : done.length ? (
        <>
          <Banner kind="info">Your reports appear here as soon as a radiologist has signed them. We send you a message; findings are never sent by WhatsApp.</Banner>
          {done.map((o) => (
            <Card key={o.id} title={o.procedures[0]?.description ?? 'Scan'} extra={<StatusChip status={o.status === 'completed' ? 'being reported' : o.status} />}>
              <p className="muted">Scanned <DateTime iso={o.createdAt} date time={false} /></p>
              <p className="note">A radiologist is reporting this scan. Your doctor receives the signed report first, then it appears here.</p>
            </Card>
          ))}
        </>
      ) : (
        <EmptyState>You have no results yet. After a scan, your report appears here once a radiologist has signed it.</EmptyState>
      )}
    </div>
  );
}
