import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Skeleton, EmptyState, StatusChip, DataTable, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/r/results')({ component: Results });

function Results() {
  // The results module owns delivery; this page lists them when that route exists.
  const results = useQuery({ queryKey: ['ref-results'], queryFn: () => api.get<{ results: any[] }>('/results/referrer').catch(() => null) });
  const orders = useQuery({ queryKey: ['my-referrals'], queryFn: () => api.get<{ orders: any[] }>('/referrals/my-referrals') });

  const reported = (orders.data?.orders ?? []).filter((o) => o.status === 'completed');

  return (
    <div className="page">
      <PageHeader title="Results" subtitle="Signed reports for the patients you referred" />
      {results.isLoading || orders.isLoading ? <Skeleton rows={6} /> : results.data?.results?.length ? (
        <Card title="Signed reports">
          <DataTable
            rows={results.data.results}
            rowKey={(r: any) => r.id}
            columns={[
              { key: 'patient', header: 'Patient', render: (r: any) => r.patientName ?? r.patientId },
              { key: 'proc', header: 'Study', render: (r: any) => r.procedure ?? r.accession },
              { key: 'signed', header: 'Signed', render: (r: any) => <DateTime iso={r.signedAt} /> },
              { key: 'status', header: 'Status', render: (r: any) => <StatusChip status={r.status} /> },
            ]}
          />
        </Card>
      ) : reported.length ? (
        <>
          <Banner kind="info">Signed reports appear here as soon as the radiologist signs. Critical findings are phoned to you and need your acknowledgement.</Banner>
          <Card title="Studies completed, report pending">
            <DataTable
              rows={reported}
              rowKey={(o: any) => o.id}
              columns={[
                { key: 'patient', header: 'Patient', render: (o: any) => (o.patient ? `${o.patient.lastName}, ${o.patient.firstName}` : '—') },
                { key: 'proc', header: 'Procedure', render: (o: any) => o.procedures[0]?.description },
                { key: 'when', header: 'Scanned', render: (o: any) => <DateTime iso={o.appointment?.startsAt ?? o.createdAt} /> },
                { key: 'status', header: 'Status', render: () => <StatusChip status="being reported" /> },
              ]}
            />
          </Card>
        </>
      ) : (
        <EmptyState>No results yet for the patients you referred.</EmptyState>
      )}
    </div>
  );
}
