import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Tile, Card, Banner, Button, Chip, StatusChip, Money, Skeleton, EmptyState, KV, Queue, Check, Field, Input, Select } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/desk/')({ component: Today });

interface Row {
  appointmentId: string; orderId: string; encounterId: string | null; startsAt: string; time: string; status: string; appointmentStatus: string;
  procedure: string; modalityType: string; room: string | null; site: string | null; siteId: string;
  patient: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; sex: string | null; language: string; schemeName: string | null; flags: string[]; idMasked: string } | null;
  referrer: string | null; priority: string; funding: { status: string; patientPortionCents: number; authStatus: string | null; authNumber: string | null } | null;
  collect: { collectNowCents: number; patientPortionCents: number; schemePortionCents: number; totalCents: number; previousBalanceCents: number; reasonCodes: string[] } | null;
  stillNeeded: string[]; queueTicket: string | null; arrivedAt: string | null; safety: Array<{ set: string; status: string; completeness: number }>;
}

function age(dob: string | null | undefined) {
  if (!dob) return '';
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400_000))}`;
}

function Today() {
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Array<{ id: string; name: string }> }>('/org/sites') });
  const day = useQuery({ queryKey: ['desk-today', siteId], queryFn: () => api.get<{ date: string; rows: Row[]; counts: { booked: number; arrived: number; needsAttention: number; expectedCollectionsCents: number } }>(`/registration/encounters${siteId ? `?siteId=${siteId}` : ''}`), refetchInterval: 30_000 });
  const ls = useQuery({ queryKey: ['ls', siteId], queryFn: () => api.get<{ config: { stage: number; note?: string; generatorModalities: string[] } | null }>(`/scheduling/loadshedding/${siteId || 'site_san'}`), enabled: true });

  const rows = day.data?.rows ?? [];
  const current = rows.find((r) => r.appointmentId === selected)
    ?? rows.find((r) => r.arrivedAt && !['done', 'left'].includes(r.status))
    ?? rows.find((r) => r.stillNeeded.length > 0)
    ?? rows[0] ?? null;

  return (
    <div className="page">
      <PageHeader
        title={`Today at ${sites.data?.sites.find((s) => s.id === siteId)?.name ?? 'all sites'}`}
        subtitle={day.data ? `${day.data.counts.booked} booked · ${day.data.counts.arrived} arrived · ${day.data.counts.needsAttention} need attention` : 'Loading the day'}
        actions={
          <>
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
              <option value="">All sites</option>
              {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <a className="btn" href="/desk/queue">Waiting-room screen</a>
            <a className="btn" href="/kiosk">Kiosk supervisor</a>
          </>
        }
      />

      {ls.data?.config && ls.data.config.stage > 0 && (
        <Banner kind="warn">
          Load-shedding stage {ls.data.config.stage} for this area. {ls.data.config.note ?? ''} Generator carries {ls.data.config.generatorModalities.join(', ')}.
        </Banner>
      )}
      {day.isError && <Banner kind="crit">The day list could not be loaded. Refresh, or call platform support with reference desk-today.</Banner>}

      <div className="grid g4">
        <Tile label="Booked today" value={day.data?.counts.booked ?? '—'} delta={`${day.data?.counts.arrived ?? 0} arrived`} />
        <Tile label="Arrived so far" value={day.data?.counts.arrived ?? '—'} />
        <Tile label="Needs attention" value={day.data?.counts.needsAttention ?? '—'} delta="items outstanding before the scan" tone={day.data && day.data.counts.needsAttention > 0 ? 'down' : undefined} />
        <Tile label="Expected desk collections" value={<Money cents={day.data?.counts.expectedCollectionsCents ?? 0} />} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.4fr) minmax(260px, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card title="Arrivals" extra={`${rows.length} today`}>
          {day.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState>No appointments for this day.</EmptyState> : (
            <Queue
              rows={rows}
              rowKey={(r) => r.appointmentId}
              selectedKey={current?.appointmentId}
              onSelect={(r) => setSelected(r.appointmentId)}
              render={(r) => ({
                lead: <span className="mono">{r.time}</span>,
                title: r.patient ? `${r.patient.lastName}, ${r.patient.firstName} · ${age(r.patient.dateOfBirth)} ${r.patient.sex ?? ''}` : 'Unknown patient',
                sub: `${r.procedure}${r.room ? ` · ${r.room}` : ''}${r.site && !siteId ? ` · ${r.site}` : ''}`,
                aux: (
                  <>
                    <StatusChip status={r.arrivedAt ? r.status : r.appointmentStatus} />
                    {r.priority !== 'routine' && <Chip kind={r.priority === 'stat' ? 'crit' : 'att'}>{r.priority}</Chip>}
                    {r.stillNeeded.slice(0, 2).map((n) => <Chip key={n} kind="att">{n}</Chip>)}
                  </>
                ),
              })}
            />
          )}
        </Card>

        <RegistrationPanel row={current} onDone={() => void qc.invalidateQueries({ queryKey: ['desk-today'] })} />
        <CollectInspector row={current} onDone={() => void qc.invalidateQueries({ queryKey: ['desk-today'] })} />
      </div>
    </div>
  );
}

function RegistrationPanel({ row, onDone }: { row: Row | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [idVerified, setIdVerified] = useState(false);
  const [card, setCard] = useState(false);
  const [interpreter, setInterpreter] = useState('');
  const detail = useQuery({
    queryKey: ['encounter', row?.encounterId],
    queryFn: () => api.get<any>(`/registration/encounters/${row!.encounterId}`),
    enabled: !!row?.encounterId,
  });
  const ensure = useMutation({
    mutationFn: () => api.post('/registration/encounters', { orderId: row!.orderId, appointmentId: row!.appointmentId, channel: 'desk' }),
    onSuccess: () => { onDone(); void qc.invalidateQueries({ queryKey: ['encounter'] }); },
  });
  const checkIn = useMutation({
    mutationFn: () => api.post(`/registration/encounters/${row!.encounterId}/check-in`, { idVerified, schemeCardCaptured: card, interpreter: interpreter || undefined, consents: ['imaging', 'popia'] }),
    onSuccess: () => { onDone(); void qc.invalidateQueries({ queryKey: ['encounter'] }); },
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/registration/encounters/${row!.encounterId}/status`, { status, room: row?.room ?? undefined }),
    onSuccess: () => { onDone(); void qc.invalidateQueries({ queryKey: ['encounter'] }); },
  });

  if (!row) return <Card title="Registration"><EmptyState>Choose a patient from the arrivals list.</EmptyState></Card>;
  const gate = detail.data?.gate;
  const consents: Array<{ type: string }> = detail.data?.consents ?? [];

  return (
    <Card
      title={row.patient ? `${row.patient.firstName} ${row.patient.lastName}` : 'Patient'}
      extra={<StatusChip status={row.arrivedAt ? row.status : row.appointmentStatus} />}
    >
      <div className="facts" style={{ marginBottom: 10 }}>
        <div><span>Age and sex</span><b>{age(row.patient?.dateOfBirth)} {row.patient?.sex ?? ''}</b></div>
        <div><span>ID</span><b className="mono">{row.patient?.idMasked}</b></div>
        <div><span>Procedure</span><b>{row.procedure}</b></div>
        <div><span>Time and room</span><b>{row.time} {row.room ?? ''}</b></div>
        <div><span>Referrer</span><b>{row.referrer ?? 'Not recorded'}</b></div>
        {row.queueTicket && <div><span>Ticket</span><b className="mono">{row.queueTicket}</b></div>}
      </div>

      {(row.patient?.flags ?? []).length > 0 && <Banner kind="warn">Patient flags: {row.patient!.flags.join(', ')}</Banner>}
      {gate?.blocked && (
        <Banner kind="crit">
          Cannot send to the room yet: {gate.blocks.map((b: any) => b.detail).join('; ')}.
        </Banner>
      )}
      {!row.encounterId && (
        <div className="row-flex" style={{ marginBottom: 10 }}>
          <span className="note">No visit record yet for this appointment.</span>
          <Button variant="primary" size="sm" onClick={() => ensure.mutate()} disabled={ensure.isPending}>Start registration</Button>
        </div>
      )}

      {row.encounterId && (
        <>
          {detail.isLoading ? <Skeleton rows={4} /> : (
            <>
              <div className="grid g2" style={{ marginBottom: 10 }}>
                <div>
                  <h4>Identity and documents</h4>
                  <KV items={[
                    ['Identity level', `L${detail.data?.encounter.identityLevel ?? 0}`],
                    ['Verified', detail.data?.encounter.identityVerifiedAt ? 'Yes' : 'Not yet'],
                    ['Scheme', row.patient?.schemeName ?? 'Cash'],
                    ['Language', row.patient?.language ?? 'en'],
                  ]} />
                </div>
                <div>
                  <h4>Safety and consent</h4>
                  <div className="row-flex">
                    {(detail.data?.questionnaires ?? []).map((q: any) => <Chip key={q.id} kind={q.status === 'blocked' ? 'crit' : q.status.startsWith('cleared') ? 'done' : 'att'}>{q.title}: {q.status.replace(/_/g, ' ')}</Chip>)}
                  </div>
                  <div className="row-flex" style={{ marginTop: 6 }}>
                    {consents.length ? consents.map((c: any) => <Chip key={c.id} kind="done">{c.type}</Chip>) : <span className="note">No consents captured yet.</span>}
                  </div>
                </div>
              </div>

              {row.stillNeeded.length > 0 && (
                <Banner kind="warn">Still needed: {row.stillNeeded.join(', ')}.</Banner>
              )}

              {!row.arrivedAt ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Check checked={idVerified} onChange={setIdVerified} label="ID document seen and matches the record" />
                  <Check checked={card} onChange={setCard} label="Scheme card captured" />
                  <Field label="Interpreter needed (language code, optional)"><Input value={interpreter} onChange={(e) => setInterpreter(e.target.value)} placeholder="zu" /></Field>
                  <Button variant="primary" onClick={() => checkIn.mutate()} disabled={checkIn.isPending}>{checkIn.isPending ? 'Checking in…' : 'Check in and issue ticket'}</Button>
                </div>
              ) : (
                <div className="row-flex">
                  <Button onClick={() => setStatus.mutate('called')} disabled={setStatus.isPending}>Call to room</Button>
                  <Button variant="primary" onClick={() => setStatus.mutate('in_room')} disabled={setStatus.isPending || gate?.blocked}>Ready for {row.room ?? 'the room'}</Button>
                  <Button onClick={() => setStatus.mutate('done')} disabled={setStatus.isPending}>Done</Button>
                </div>
              )}
              {checkIn.isError && <Banner kind="crit">{(checkIn.error as Error).message}</Banner>}
            </>
          )}
        </>
      )}
    </Card>
  );
}

function CollectInspector({ row, onDone }: { row: Row | null; onDone: () => void }) {
  const [method, setMethod] = useState('card');
  const collect = useQuery({ queryKey: ['collect', row?.orderId], queryFn: () => api.get<{ collect: any }>(`/funding/collect/${row!.orderId}`), enabled: !!row?.orderId });
  const take = useMutation({
    mutationFn: (amountCents: number) => api.post(`/registration/encounters/${row!.encounterId}/collect`, { amountCents, method }),
    onSuccess: () => { onDone(); void collect.refetch(); },
  });

  if (!row) return <Card title="Collect"><EmptyState>Nothing to collect until a patient is chosen.</EmptyState></Card>;
  const c = collect.data?.collect;
  return (
    <>
      <Card title="Collect" extra={c && c.collectNowCents > 0 ? <Chip kind="att">due now</Chip> : <Chip kind="done">nothing due</Chip>}>
        {collect.isLoading || !c ? <Skeleton rows={5} /> : (
          <>
            <div className="collect">
              <span className="lbl">{c.procedure}</span><span className="money"><Money cents={c.totalCents} /></span>
              <span className="lbl">{c.schemeName ?? 'Scheme'} pays</span><span className="money"><Money cents={-c.schemePortionCents} /></span>
              <span className="lbl">Patient portion</span><span className="money"><Money cents={c.patientPortionCents} /></span>
              {c.previousBalanceCents > 0 && <><span className="lbl">Previous balance</span><span className="money"><Money cents={c.previousBalanceCents} /></span></>}
              {c.depositsPaidCents > 0 && <><span className="lbl">Already paid</span><span className="money"><Money cents={-c.depositsPaidCents} /></span></>}
              <span className="tot">Collect now</span><span className="tot"><Money cents={c.collectNowCents} /></span>
            </div>
            {c.reasons?.length > 0 && <p className="note" style={{ marginTop: 8 }}>Reason: {c.reasons.join('; ')}. VAT of <Money cents={c.vatCents} /> is included at 15 %.</p>}
            {c.assumptions?.length > 0 && <p className="note">{c.assumptions.join(' ')}</p>}
            <hr className="hr" />
            <div className="row-flex">
              {['card', 'payshap', 'eft', 'cash'].map((m) => (
                <Button key={m} size="sm" variant={method === m ? 'primary' : undefined} onClick={() => setMethod(m)}>{m === 'eft' ? 'EFT' : m === 'payshap' ? 'PayShap' : m[0]!.toUpperCase() + m.slice(1)}</Button>
              ))}
            </div>
            <div className="row-flex" style={{ marginTop: 8 }}>
              <Button variant="primary" disabled={!row.encounterId || c.collectNowCents === 0 || take.isPending} onClick={() => take.mutate(c.collectNowCents)}>
                Take payment
              </Button>
              <a className="btn" href="/desk/payments">Payments</a>
            </div>
            <p className="note">Quote version {c.quoteVersion ?? 1} · binding on the patient portion until {c.quoteValidUntil ? new Date(c.quoteValidUntil).toLocaleDateString('en-ZA') : 'the visit'}. The desk cannot edit these amounts.</p>
          </>
        )}
      </Card>
      <Card title="Funding" extra={c ? <StatusChip status={c.status} /> : null}>
        {c && (
          <KV items={[
            ['Funder', `${c.schemeName ?? c.funderType}${c.schemeOption ? ` · ${c.schemeOption}` : ''}`],
            ['Benefit check', c.benefitMessage ?? 'Not checked'],
            ['Authorisation', c.authRequired ? `${c.authStatus}${c.authNumber ? ` · ${c.authNumber}` : ''}` : 'Not required'],
          ]} />
        )}
      </Card>
    </>
  );
}
