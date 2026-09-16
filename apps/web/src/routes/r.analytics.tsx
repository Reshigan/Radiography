import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Tile, Bars, Sparkline, Skeleton, Banner, EmptyState } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/r/analytics')({ component: Analytics });

interface Data { weeks: Array<{ label: string; value: number }>; byModality: Array<{ label: string; value: number }>; totals: { referrals: number; completed: number; attendancePct: number; open: number } }

function Analytics() {
  const q = useQuery({ queryKey: ['ref-analytics'], queryFn: () => api.get<Data>('/referrals/my-analytics') });

  if (q.isLoading) return <div className="page"><Skeleton rows={6} /></div>;
  if (q.isError) return <div className="page"><Banner kind="crit">Your analytics could not be loaded.</Banner></div>;
  const d = q.data!;

  return (
    <div className="page">
      <PageHeader title="My referral analytics" subtitle="Volumes, attendance and modality mix for the patients you sent" />
      <div className="grid g4">
        <Tile label="Referrals" value={d.totals.referrals} delta={<Sparkline values={d.weeks.map((w) => w.value)} />} />
        <Tile label="Completed" value={d.totals.completed} />
        <Tile label="Attendance" value={`${d.totals.attendancePct} %`} tone={d.totals.attendancePct >= 90 ? 'up' : 'down'} delta="of booked patients attended" />
        <Tile label="Open" value={d.totals.open} delta="not yet completed" />
      </div>
      <div className="split">
        <Card title="Referrals per week">
          {d.weeks.every((w) => w.value === 0) ? <EmptyState>No referrals in the last four weeks.</EmptyState> : <Bars data={d.weeks.map((w) => ({ label: w.label.replace('w-', 'week -'), value: w.value }))} />}
        </Card>
        <Card title="Modality mix">
          {d.byModality.length === 0 ? <EmptyState>No referrals yet.</EmptyState> : <Bars data={d.byModality} />}
        </Card>
      </div>
      <p className="note">Turnaround and critical acknowledgement times appear here once the reporting module is switched on for your practice.</p>
    </div>
  );
}
