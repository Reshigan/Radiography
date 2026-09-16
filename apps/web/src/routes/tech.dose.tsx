import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Bars, Card, Chip, DataTable, DateTime, EmptyState, PageHeader, Skeleton, Tile } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/tech/dose')({ component: Dose });

interface Record_ { id: string; accession: string; protocolCode: string; modality: string; quantity: string; value: number; unit: string; drlValue: number | null; ratioPct: number | null; outlier: boolean; sizeClass: string; likelyCause: string | null; createdAt: string; justification: string | null; reviewedAt: string | null }
interface Summary { protocolCode: string; n: number; mean: number; above: number; abovePct: number; quantity: string; unit: string; drl: number | null }

function Dose() {
  const [outliers, setOutliers] = useState(false);
  const q = useQuery({ queryKey: ['dose', outliers], queryFn: () => api.get<{ records: Record_[]; summary: Summary[]; outliers: number }>(`/dose?limit=300${outliers ? '&outliers=true' : ''}`) });
  return (
    <div className="page">
      <PageHeader
        title="Dose"
        subtitle="Every ionising exposure against its diagnostic reference level. A DRL is a review trigger, not a dose limit: a single study above it may be fully justified."
        actions={<label className="check" onClick={() => setOutliers((v) => !v)}><i className={outliers ? 'on' : ''} />Above reference only</label>}
      />
      {q.isError && <Banner kind="crit">Dose records could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (q.data.records.length === 0 ? <EmptyState>No dose records in this view.</EmptyState> : (
        <>
          <div className="grid g3">
            <Tile label="Records" value={q.data.records.length} />
            <Tile label="Above reference level" value={q.data.outliers} tone={q.data.outliers ? 'down' : 'up'} delta={`${Math.round((q.data.outliers / Math.max(1, q.data.records.length)) * 1000) / 10} % of studies`} />
            <Tile label="Protocols covered" value={q.data.summary.length} />
          </div>
          <Card title="Median dose against the reference level, by protocol">
            <Bars data={q.data.summary.slice(0, 10).map((sx) => ({ label: `${sx.protocolCode} (${sx.n})`, value: sx.drl ? Math.round((sx.mean / sx.drl) * 100) : 0, tone: sx.drl && sx.mean > sx.drl ? 'crit' : 'ok' }))} max={150} format={(v) => `${v} % of DRL`} />
          </Card>
          <Card title="Dose records">
            <DataTable
              rows={q.data.records.slice(0, 120)}
              rowKey={(x) => x.id}
              columns={[
                { key: 'acc', header: 'Accession', render: (x) => <span className="mono">{x.accession}</span> },
                { key: 'when', header: 'Acquired', render: (x) => <DateTime iso={x.createdAt} /> },
                { key: 'proto', header: 'Protocol', render: (x) => <>{x.protocolCode} <span className="muted small">{x.modality} · {x.sizeClass}</span></> },
                { key: 'value', header: 'Dose', num: true, render: (x) => <span className="mono">{x.value} {x.unit}</span> },
                { key: 'drl', header: 'DRL', num: true, render: (x) => (x.drlValue ? <span className="mono">{x.drlValue}</span> : <span className="muted">—</span>) },
                { key: 'ratio', header: 'Of DRL', num: true, render: (x) => (x.ratioPct === null ? <span className="muted">—</span> : <Chip kind={x.ratioPct > 200 ? 'crit' : x.ratioPct > 100 ? 'att' : 'done'}>{x.ratioPct} %</Chip>) },
                { key: 'cause', header: 'Note', render: (x) => x.justification ?? x.likelyCause ?? <span className="muted">—</span> },
              ]}
            />
          </Card>
        </>
      ))}
    </div>
  );
}
