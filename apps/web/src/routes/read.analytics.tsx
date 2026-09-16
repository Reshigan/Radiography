import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Bars, Card, EmptyState, PageHeader, Skeleton, Tile, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/read/analytics')({ component: Analytics });

interface Data {
  days: number; signed: number; tatMedianMinutes: { stat: number | null; urgent: number | null; routine: number | null };
  slaBreaches: number; byModality: Record<string, number>; critical: number; aiAgreementPct: number | null;
  peerReviews: { total: number; discrepancies: number };
}

function mins(v: number | null) {
  if (v === null) return '—';
  return v < 60 ? `${v} min` : `${Math.round((v / 60) * 10) / 10} h`;
}

function Analytics() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['read-analytics', days], queryFn: () => api.get<Data>(`/reporting/analytics?days=${days}`) });
  return (
    <div className="page">
      <PageHeader
        title="Reading analytics"
        subtitle="Turnaround against the SLA per priority class, throughput and AI agreement. Informational only."
        actions={<select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" style={{ height: 32 }}>{[7, 30, 90].map((dv) => <option key={dv} value={dv}>Last {dv} days</option>)}</select>}
      />
      {q.isError && <Banner kind="crit">Analytics could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={4} />}
      {q.data && (q.data.signed === 0 ? <EmptyState>No reports were signed in this period.</EmptyState> : (
        <>
          <div className="grid g4">
            <Tile label="Signed reports" value={q.data.signed} delta={`${q.data.days} days`} />
            <Tile label="SLA breaches" value={q.data.slaBreaches} tone={q.data.slaBreaches ? 'down' : 'up'} delta={`${Math.round((q.data.slaBreaches / Math.max(1, q.data.signed)) * 1000) / 10} % of signed`} />
            <Tile label="Critical flagged" value={q.data.critical} delta="communication loop opened" />
            <Tile label="AI agreement" value={q.data.aiAgreementPct === null ? '—' : `${q.data.aiAgreementPct} %`} delta="candidates accepted ÷ decided" />
          </div>
          <div className="split">
            <Card title="Turnaround, median" extra="study completion to signature">
              <KV items={[
                ['STAT (target 30 min)', mins(q.data.tatMedianMinutes.stat)],
                ['Urgent (target 2 h)', mins(q.data.tatMedianMinutes.urgent)],
                ['Routine (target 24 working hours)', mins(q.data.tatMedianMinutes.routine)],
              ]} />
            </Card>
            <Card title="Volume by modality">
              <Bars data={Object.entries(q.data.byModality).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
            </Card>
          </div>
          <Card title="Peer review">
            <KV items={[
              ['Cases reviewed', String(q.data.peerReviews.total)],
              ['Discrepancies recorded', `${q.data.peerReviews.discrepancies} (${q.data.peerReviews.total ? Math.round((q.data.peerReviews.discrepancies / q.data.peerReviews.total) * 1000) / 10 : 0} %)`],
              ['Use', 'Learning and system improvement. Scores are never used alone for performance management.'],
            ]} />
          </Card>
        </>
      ))}
    </div>
  );
}
