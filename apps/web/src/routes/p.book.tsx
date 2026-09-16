import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, Button, Banner, Provenance, TextArea, Field, Money, Skeleton, EmptyState, Chip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/p/book')({ component: Book });

interface Parsed { procedureCode?: string; procedureDescription?: string; modality?: string; laterality?: string; contrast?: boolean; urgency?: string; referrerName?: string; clinicalInfo?: string; confidence: number; missing: string[] }
interface Offer { roomId: string; startsAt: string; siteName: string; siteId: string; distanceKm: number | null; travelMin: number | null; patientPortionCents: number | null; priceCertainty: string; reason: string }

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

function ReferralRead({ parsed }: { parsed: Parsed }) {
  return (
    <Provenance prov={{ modelId: 'referral-extract', modelVersion: '2.4.1', confidence: parsed.confidence, outputClass: 3, demo: true }}>
      <b>{parsed.procedureDescription ?? 'Procedure not recognised'}</b>
      <div className="note">
        {parsed.laterality && parsed.laterality !== 'na' ? `${parsed.laterality} side · ` : ''}
        {parsed.contrast ? 'with contrast · ' : 'no contrast · '}
        {parsed.urgency ?? 'routine'}
        {parsed.referrerName ? ` · from ${parsed.referrerName}` : ''}
      </div>
      {parsed.missing.length > 0 && <div className="note">Not certain about: {parsed.missing.join(', ')}. A person checks anything we are unsure of.</div>}
    </Provenance>
  );
}

function Book() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Offer | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => api.post<{ referral: any; order: any; provenance: any }>('/referrals', { channel: 'paper_photo', photoText: text, autoConvert: true }),
    onSuccess: (r) => {
      setParsed(r.referral.parsed);
      setError(null);
      if (r.referral.orderId) { setOrderId(r.referral.orderId); setStep(2); }
      else setError('We could not read everything on that referral. Check the words, or send us a WhatsApp message and a person will help.');
    },
    onError: (e: Error) => setError(e.message),
  });

  const offers = useQuery({
    queryKey: ['earliest', orderId],
    queryFn: () => api.get<{ offers: Offer[]; searched: { sites: number; days: number } }>(`/scheduling/earliest?orderId=${orderId}&limit=3`),
    enabled: !!orderId && step === 2,
  });

  const hold = useMutation({
    mutationFn: (o: Offer) => api.post<{ appointment: { id: string } }>('/scheduling/holds', { orderId, roomId: o.roomId, startsAt: o.startsAt, source: 'patient_space' }),
    onSuccess: (r, o) => { setHoldId(r.appointment.id); setChosen(o); setStep(3); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const confirm = useMutation({
    mutationFn: () => api.post(`/scheduling/holds/${holdId}/confirm`),
    onSuccess: () => void navigate({ to: '/p' }),
    onError: (e: Error) => setError(e.message),
  });

  const funding = useQuery({ queryKey: ['order-funding', orderId], queryFn: () => api.get<{ fundingCase: any; quote: any }>(`/funding/orders/${orderId}`), enabled: !!orderId && step >= 2 });

  return (
    <div className="page">
      <h1 style={{ fontSize: 24 }}>Book a scan</h1>
      <p className="muted">Step {step} of 3 · {step === 1 ? 'your referral' : step === 2 ? 'choose a time' : 'confirm'}</p>
      {error && <Banner kind="crit">{error}</Banner>}

      {step === 1 && (
        <Card title="Your referral">
          <p className="note">Photograph the referral from your doctor, or type the words on it. We read it and fill in the details for you to check.</p>
          <Field label="Words on the referral">
            <TextArea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dr S. Naidoo MP 0123456. MRI right knee, no contrast. Knee locking after rugby." />
          </Field>
          <div className="row-flex">
            <Button variant="primary" disabled={text.length < 10 || send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Reading…' : 'Continue'}</Button>
            <Button onClick={() => setText('Dr R. Pillay PR 0223345. CT of the head, no contrast. Headache and confusion after a fall.')}>Use an example</Button>
          </div>
          {parsed && <div style={{ marginTop: 12 }}><ReferralRead parsed={parsed} /></div>}
        </Card>
      )}

      {step === 2 && parsed && <ReferralRead parsed={parsed} />}

      {step === 2 && (
        <Card title="Earliest near me" extra={offers.data ? `${offers.data.searched.sites} sites` : null}>
          {offers.isLoading ? <Skeleton rows={4} /> : (offers.data?.offers.length ?? 0) === 0 ? (
            <EmptyState action={<Button onClick={() => void api.post('/scheduling/waitlist', { orderId }).then(() => navigate({ to: '/p' }))}>Join the waitlist</Button>}>
              No open times in the next two weeks.
            </EmptyState>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {offers.data!.offers.map((o) => (
                <button key={`${o.roomId}${o.startsAt}`} type="button" className="btn" style={{ height: 'auto', padding: 12, justifyContent: 'space-between', textAlign: 'left' }} onClick={() => hold.mutate(o)} disabled={hold.isPending}>
                  <span>
                    <b style={{ display: 'block' }}>{timeLabel(o.startsAt)}</b>
                    <span className="note">{o.siteName}{o.distanceKm != null ? ` · ${o.distanceKm} km · about ${o.travelMin} min` : ''} · {o.reason}</span>
                  </span>
                  {o.patientPortionCents != null && <span className="money"><Money cents={o.patientPortionCents} /></span>}
                </button>
              ))}
            </div>
          )}
          {funding.data?.quote && (
            <div style={{ marginTop: 12 }}>
              <h4>Your price</h4>
              <div className="collect">
                <span className="lbl">Tariff · {funding.data.quote.lines[0]?.description}</span><span className="money"><Money cents={funding.data.quote.totalCents} /></span>
                <span className="lbl">{funding.data.fundingCase.schemeName ?? 'Scheme'} pays</span><span className="money"><Money cents={-funding.data.quote.schemePortionCents} /></span>
                <span className="tot">You pay</span><span className="tot"><Money cents={funding.data.quote.patientPortionCents} /></span>
              </div>
              <p className="note">
                {funding.data.fundingCase.authRequired && funding.data.fundingCase.authStatus !== 'approved'
                  ? 'Your scheme must authorise this scan first. We have asked, and we will confirm your price before the appointment.'
                  : 'This quote is guaranteed for this appointment. Nothing more to pay later.'}
              </p>
            </div>
          )}
        </Card>
      )}

      {step === 3 && chosen && (
        <Card title="Confirm" extra={<Chip kind="att">held for 10 minutes</Chip>}>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--heading)' }}>{timeLabel(chosen.startsAt)}</h2>
          <p className="muted">{chosen.siteName}{chosen.distanceKm != null ? ` · ${chosen.distanceKm} km` : ''}</p>
          {funding.data?.quote && (
            <div className="collect" style={{ marginTop: 8 }}>
              <span className="lbl">{funding.data.fundingCase.schemeName ?? 'Scheme'} pays</span><span className="money"><Money cents={-funding.data.quote.schemePortionCents} /></span>
              <span className="tot">You pay on the day</span><span className="tot"><Money cents={funding.data.quote.patientPortionCents} /></span>
            </div>
          )}
          <h4 style={{ marginTop: 10 }}>What to bring</h4>
          <p className="note">Your ID, your scheme card and the referral. We will send the preparation instructions on WhatsApp.</p>
          <div className="row-flex" style={{ marginTop: 10 }}>
            <Button variant="primary" size="lg" disabled={confirm.isPending} onClick={() => confirm.mutate()}>{confirm.isPending ? 'Confirming…' : 'Confirm this appointment'}</Button>
            <Button onClick={() => { setStep(2); setHoldId(null); void api.delete(`/scheduling/holds/${holdId}`); }}>Choose another time</Button>
          </div>
          <p className="note">By confirming you agree to reminders about this appointment. You can stop them at any time.</p>
        </Card>
      )}
    </div>
  );
}
