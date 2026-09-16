import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, Card, Chip, DataTable, EmptyState, KV, PageHeader, Skeleton } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/bci/shadow')({ component: Shadow });

interface Evaluation {
  modelId: string; name: string; version: string; cases: number; required: number; lifecycle: string;
  sites: Array<{ siteId: string; n: number; positiveRatePct: number; floorMet: boolean }>;
  validation: Record<string, string | number>; limitations: string[];
}

function Shadow() {
  const q = useQuery({ queryKey: ['bci-shadow'], queryFn: () => api.get<{ evaluations: Evaluation[] }>('/bci/shadow') });
  return (
    <div className="page">
      <PageHeader title="Shadow evaluations" subtitle="Models running live without reaching the Reading Room, measured against signed reports before any activation decision." />
      {q.isError && <Banner kind="crit">Shadow evaluations could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (q.data.evaluations.length === 0 ? <EmptyState>No models are in shadow mode.</EmptyState> : q.data.evaluations.map((ev) => (
        <Card key={`${ev.modelId}-${ev.version}`} title={`${ev.name} ${ev.version}`} extra={<Chip kind={ev.cases >= ev.required ? 'done' : 'active'}>{ev.cases} of {ev.required} cases</Chip>}>
          <Banner kind="info">Shadow results are visible to AI operations only. They never order the reading worklist and never appear as candidates in a report.</Banner>
          <KV items={Object.entries(ev.validation).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), String(v)] as [string, string])} />
          <DataTable
            rows={ev.sites}
            rowKey={(sx) => sx.siteId}
            empty="No shadow results recorded yet."
            columns={[
              { key: 'site', header: 'Site', render: (sx) => sx.siteId.replace('site_', '').toUpperCase() },
              { key: 'n', header: 'Cases', num: true, render: (sx) => sx.n },
              { key: 'pos', header: 'Positive rate', num: true, render: (sx) => <span className="mono">{sx.positiveRatePct} %</span> },
              { key: 'floor', header: 'Subgroup floor', render: (sx) => <Chip kind={sx.floorMet ? 'done' : 'att'}>{sx.floorMet ? 'above' : 'review'}</Chip> },
            ]}
          />
          {ev.limitations.length > 0 && (
            <div className="note">Stated limitations: {ev.limitations.join('; ')}. Activation is staged per site with a change-control record signed by AI operations and compliance.</div>
          )}
        </Card>
      )))}
    </div>
  );
}
