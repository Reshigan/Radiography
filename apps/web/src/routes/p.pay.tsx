import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, Button, Banner, Money, Skeleton, EmptyState, Chip, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/p/pay')({ component: Pay });

function Pay() {
  const cases = useQuery({ queryKey: ['my-funding'], queryFn: () => api.get<{ cases: any[] }>('/funding/mine') });
  const payments = useQuery({ queryKey: ['my-payments'], queryFn: () => api.get<any>('/billing/mine').catch(() => null) });

  if (cases.isLoading) return <div className="page"><Skeleton rows={6} /></div>;
  if (cases.isError) return <div className="page"><Banner kind="crit">Your account could not be loaded. Please try again.</Banner></div>;

  const open = (cases.data?.cases ?? []).filter((c) => (c.collect?.collectNowCents ?? 0) > 0);
  const settled = (cases.data?.cases ?? []).filter((c) => (c.collect?.collectNowCents ?? 0) === 0);

  return (
    <div className="page">
      <h1 style={{ fontSize: 24 }}>Pay</h1>
      {open.length === 0 ? (
        <EmptyState>Nothing is owed. Your scheme covers your booked scans in full.</EmptyState>
      ) : open.map((c) => (
        <Card key={c.id} title={c.order?.procedures?.[0]?.description ?? 'Scan'} extra={<Chip kind="done">No surprises</Chip>}>
          <div className="collect">
            <span className="lbl">Tariff</span><span className="money"><Money cents={c.collect.totalCents} /></span>
            <span className="lbl">{c.schemeName ?? 'Scheme'} pays</span><span className="money"><Money cents={-c.collect.schemePortionCents} /></span>
            {c.collect.previousBalanceCents > 0 && <><span className="lbl">Earlier balance</span><span className="money"><Money cents={c.collect.previousBalanceCents} /></span></>}
            <span className="tot">To pay today</span><span className="tot"><Money cents={c.collect.collectNowCents} /></span>
          </div>
          {c.collect.reasons?.length > 0 && <p className="note">Why: {c.collect.reasons.join('; ')}.</p>}
          {c.collect.assumptions?.length > 0 && <p className="note">{c.collect.assumptions.join(' ')}</p>}
          <div className="row-flex" style={{ marginTop: 10 }}>
            {payments.data ? (
              <Button variant="primary" size="lg">Pay <Money cents={c.collect.collectNowCents} /> now</Button>
            ) : (
              <>
                <Button variant="primary" size="lg" disabled>Pay now</Button>
                <span className="note">Card, PayShap, EFT and QR payment opens when the payments module is switched on. You can pay at the desk.</span>
              </>
            )}
          </div>
          <p className="note">Quote version {c.collect.quoteVersion ?? 1}, binding on your portion until {c.collect.quoteValidUntil ? new Date(c.collect.quoteValidUntil).toLocaleDateString('en-ZA') : 'your visit'}. VAT of <Money cents={c.collect.vatCents ?? 0} /> is included at 15 %.</p>
        </Card>
      ))}

      {settled.length > 0 && (
        <Card title="Recent scans">
          {settled.slice(0, 5).map((c) => (
            <div key={c.id} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{c.order?.procedures?.[0]?.description ?? 'Scan'}</span>
              <span className="row-flex"><StatusChip status={c.status} /><Money cents={c.collect?.patientPortionCents ?? 0} /></span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
