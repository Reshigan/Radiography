import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Tile, Bars, Sparkline, Skeleton, Banner, EmptyState } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/booking/analytics')({ component: Analytics });

interface Analytics {
  totals: { appointments: number; done: number; noShow: number; cancelled: number; noShowPct: number; handConversionPct: number; waitlist: number };
  bySource: Array<{ label: string; value: number }>;
  byModality: Array<{ label: string; value: number }>;
  trend: Array<{ label: string; value: number }>;
}

function Analytics() {
  const a = useQuery({ queryKey: ['booking-analytics'], queryFn: () => api.get<Analytics>('/scheduling/analytics') });
  const funding = useQuery({ queryKey: ['funding-analytics'], queryFn: () => api.get<{ byStatus: Array<{ status: string; n: number }>; authorisations: Array<{ status: string; n: number }> }>('/funding/analytics') });

  if (a.isLoading) return <div className="page"><Skeleton rows={8} /></div>;
  if (a.isError) return <div className="page"><Banner kind="crit">Analytics could not be loaded.</Banner></div>;
  const d = a.data!;

  return (
    <div className="page">
      <PageHeader title="Booking analytics" subtitle="Last 30 days of appointments across this practice" />
      <div className="grid g4">
        <Tile label="Appointments" value={d.totals.appointments} delta={<Sparkline values={d.trend.map((t) => t.value)} />} />
        <Tile label="Completed" value={d.totals.done} />
        <Tile label="No-show rate" value={`${d.totals.noShowPct} %`} tone={d.totals.noShowPct > 12 ? 'down' : 'up'} delta={`${d.totals.noShow} no-shows, ${d.totals.cancelled} cancellations`} />
        <Tile label="Hand conversion" value={`${d.totals.handConversionPct} %`} delta="threads that ended in a booking" />
      </div>
      <div className="split">
        <Card title="Booking channel">
          {d.bySource.length === 0 ? <EmptyState>No appointments in the window.</EmptyState> : <Bars data={d.bySource.map((x) => ({ label: x.label.replace(/_/g, ' '), value: x.value, tone: x.label === 'hand' || x.label === 'whatsapp' ? 'info' : 'ok' }))} />}
        </Card>
        <Card title="Modality mix">
          {d.byModality.length === 0 ? <EmptyState>No appointments in the window.</EmptyState> : <Bars data={d.byModality} />}
        </Card>
        <Card title="Appointments per day, last 14 days">
          <Bars data={d.trend} />
        </Card>
        <Card title="Funding position">
          {funding.isLoading ? <Skeleton rows={4} /> : (
            <>
              <Bars data={(funding.data?.byStatus ?? []).map((x) => ({ label: x.status.replace(/_/g, ' '), value: x.n, tone: x.status.includes('declined') || x.status === 'expired' ? 'crit' : x.status.includes('auth') ? 'warn' : 'ok' }))} />
              <p className="note" style={{ marginTop: 8 }}>Authorisations: {(funding.data?.authorisations ?? []).map((x) => `${x.n} ${x.status}`).join(', ') || 'none yet'}.</p>
            </>
          )}
        </Card>
      </div>
      <p className="note">No-show risk is a score used for reminder intensity and waitlist ranking only. It is never shown to a patient and never refuses a booking.</p>
    </div>
  );
}
