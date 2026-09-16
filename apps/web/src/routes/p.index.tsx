import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, Chip, Button, Money, Skeleton, EmptyState, Banner, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/p/')({ component: Home });

interface Appt { id: string; startsAt: string; status: string; procedureDescription: string | null; procedureCode: string; site: string | null; room: string | null; distanceKm: number | null; orderId: string }

function Home() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const appts = useQuery({ queryKey: ['my-appointments'], queryFn: () => api.get<{ appointments: Appt[] }>('/scheduling/mine') });
  const funding = useQuery({ queryKey: ['my-funding'], queryFn: () => api.get<{ cases: Array<{ collect: { collectNowCents: number }; order: { id: string } | null }> }>('/funding/mine') });
  const visits = useQuery({ queryKey: ['my-visits'], queryFn: () => api.get<{ encounters: Array<any> }>('/registration/mine') });

  const next = (appts.data?.appointments ?? []).filter((a) => new Date(a.startsAt).getTime() > Date.now() - 3600_000 && ['booked', 'confirmed', 'arrived', 'held'].includes(a.status)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const due = (funding.data?.cases ?? []).reduce((a, c) => a + (c.collect?.collectNowCents ?? 0), 0);
  const visit = (visits.data?.encounters ?? []).find((e: any) => e?.encounter?.appointmentId === next?.id);
  const needed: string[] = visit?.stillNeeded ?? [];
  const ticket = visit?.ticket;

  return (
    <div className="page">
      <h1 style={{ fontSize: 26 }}>Sawubona, {me?.user?.name.split(' ')[0]}</h1>
      {appts.isError && <Banner kind="crit">Your appointments could not be loaded. Please try again.</Banner>}
      {appts.isLoading ? <Skeleton rows={4} /> : next ? (
        <Card title="Next appointment" extra={<Chip kind={next.status === 'arrived' ? 'active' : 'done'}>{next.status}</Chip>}>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 22, color: 'var(--heading)' }}>{next.procedureDescription ?? next.procedureCode}</h2>
          <p className="muted"><DateTime iso={next.startsAt} /> · {next.site}</p>
          {ticket && <Banner kind="info">You are checked in. Your number is {ticket.ticket}; about {ticket.estimatedWaitMinutes} minutes.</Banner>}
          <h4 style={{ marginTop: 10 }}>What to bring</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            <li>Your ID or passport</li>
            <li>Your medical scheme card</li>
            <li>The referral from your doctor (a photo is fine)</li>
          </ul>
          {needed.length > 0 && <Banner kind="warn">Still to do before your visit: {needed.join(', ')}.</Banner>}
          <div className="row-flex" style={{ marginTop: 10 }}>
            <Button variant="primary" onClick={() => void navigate({ to: '/p/prepare' })}>Prepare</Button>
            <Button onClick={() => void navigate({ to: '/p/pay' })}>Pay</Button>
          </div>
        </Card>
      ) : (
        <EmptyState action={<Button variant="primary" onClick={() => void navigate({ to: '/p/book' })}>Book a scan</Button>}>You have no appointment booked.</EmptyState>
      )}

      <div className="grid g2">
        <Card title="Book"><p className="note">A new scan from a referral</p><Button size="sm" onClick={() => void navigate({ to: '/p/book' })}>Start</Button></Card>
        <Card title="Prepare"><p className="note">{needed.length ? `${needed.length} item(s) left` : 'Safety questions and consent'}</p><Button size="sm" onClick={() => void navigate({ to: '/p/prepare' })}>Open</Button></Card>
        <Card title="Pay"><p className="note">{due > 0 ? <><Money cents={due} /> due, no surprises</> : 'Nothing owed'}</p><Button size="sm" onClick={() => void navigate({ to: '/p/pay' })}>Open</Button></Card>
        <Card title="Results"><p className="note">Reports and images</p><Button size="sm" onClick={() => void navigate({ to: '/p/results' })}>Open</Button></Card>
      </div>

      <Card title="Need help?">
        <p className="note">Message us on WhatsApp and a person will call you back. We never send scan findings on WhatsApp; your doctor discusses them with you.</p>
      </Card>
    </div>
  );
}
