import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, Card, DataTable, DateTime, EmptyState, KV, PageHeader, Skeleton } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/tech/stock')({ component: Stock });

interface Admin { id: string; agent: string; batchNo: string | null; volumeDeliveredMl: number | null; administeredAt: string | null; status: string }

function Stock() {
  // Contrast lots and scan-to-issue live in M18 Assets (cluster D). This page shows the consumption
  // this console produces and links to the asset register once it is available.
  const q = useQuery({ queryKey: ['contrast-today'], queryFn: () => api.get<{ items: Array<{ id: string; administration: Admin | null }> }>('/acquisition/contrast') });
  const admins = (q.data?.items ?? []).map((x) => x.administration).filter(Boolean) as Admin[];
  return (
    <div className="page">
      <PageHeader title="Stock" subtitle="Contrast consumption recorded by this console. Lots, expiry and scan-to-issue are held in the equipment and consumables register." />
      {q.isError && <Banner kind="crit">Contrast records could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={4} />}
      {q.data && (admins.length === 0 ? <EmptyState>No contrast was administered today.</EmptyState> : (
        <Card title="Contrast administered today" extra={`${admins.length} records`}>
          <DataTable
            rows={admins}
            rowKey={(x) => x.id}
            columns={[
              { key: 'agent', header: 'Agent', render: (x) => x.agent },
              { key: 'batch', header: 'Batch', render: (x) => (x.batchNo ? <span className="mono">{x.batchNo}</span> : <span className="muted">manual reason recorded</span>) },
              { key: 'vol', header: 'Volume', num: true, render: (x) => <span className="mono">{x.volumeDeliveredMl ?? 0} mL</span> },
              { key: 'at', header: 'Administered', render: (x) => <DateTime iso={x.administeredAt} /> },
              { key: 'status', header: 'Status', render: (x) => x.status },
            ]}
          />
        </Card>
      ))}
      <Card title="Where the rest of this lives">
        <KV items={[
          ['Lots, expiry and recalls', 'Equipment and consumables register (M18), built by its module builder.'],
          ['Scan-to-issue', 'A vial barcode scan decrements stock and records batch and expiry against the study; the nurse console captures it.'],
          ['Controls', 'Contrast cannot be marked administered without a batch scan or a documented manual reason.'],
        ]} />
      </Card>
    </div>
  );
}
