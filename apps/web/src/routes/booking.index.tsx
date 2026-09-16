import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Button, Banner, Chip, StatusChip, Money, Skeleton, EmptyState, Queue, Field, Input, Tile, Provenance, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/booking/')({ component: Inbox });

interface Conversation {
  id: string; channel: string; mobile: string; state: string; handedOverReason: string | null; claimedBy: string | null; updatedAt: string; misunderstandings: number;
  patient: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; sex: string | null; language: string } | null;
  lastMessage: { dir: string; text: string; at: string } | null;
  offers: Array<{ appointmentId: string; label: string; startsAt: string }> | null;
}

function Inbox() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [inbound, setInbound] = useState({ from: '', text: '' });

  const list = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<{ conversations: Conversation[] }>('/scheduling/conversations'), refetchInterval: 20_000 });
  const analytics = useQuery({ queryKey: ['booking-analytics'], queryFn: () => api.get<any>('/scheduling/analytics') });
  const rows = list.data?.conversations ?? [];
  const escalated = rows.filter((c) => c.state === 'handed_over');
  const current = rows.find((c) => c.id === selected) ?? escalated[0] ?? rows[0] ?? null;
  const detail = useQuery({ queryKey: ['conversation', current?.id], queryFn: () => api.get<any>(`/scheduling/conversations/${current!.id}`), enabled: !!current });

  const claim = useMutation({ mutationFn: () => api.post(`/scheduling/conversations/${current!.id}/claim`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['conversation'] }); void qc.invalidateQueries({ queryKey: ['conversations'] }); } });
  const send = useMutation({ mutationFn: () => api.post(`/scheduling/conversations/${current!.id}/reply`, { text: reply }), onSuccess: () => { setReply(''); void qc.invalidateQueries({ queryKey: ['conversation'] }); } });
  const simulate = useMutation({
    mutationFn: () => api.post('/scheduling/conversations/inbound', inbound),
    onSuccess: (r: any) => { setInbound({ from: '', text: '' }); setSelected(r.conversationId); void qc.invalidateQueries({ queryKey: ['conversations'] }); },
  });
  const approve = useMutation({ mutationFn: (appointmentId: string) => api.post(`/scheduling/holds/${appointmentId}/confirm`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['conversation'] }); void qc.invalidateQueries({ queryKey: ['conversations'] }); } });

  const task = detail.data?.task;

  return (
    <div className="page">
      <PageHeader
        title="Omnichannel inbox"
        subtitle={`${rows.length} conversations · ${escalated.length} escalated by the Booking Hand`}
        actions={<><a className="btn" href="/booking/waitlist">Waitlist</a><a className="btn" href="/booking/calendar">Calendar</a></>}
      />
      {list.isError && <Banner kind="crit">The inbox could not be loaded. Refresh, or call platform support with reference booking-inbox.</Banner>}

      <div className="grid g4">
        <Tile label="Conversion" value={`${analytics.data?.totals.handConversionPct ?? 0} %`} delta="threads that ended in a booking" />
        <Tile label="Appointments, 30 days" value={analytics.data?.totals.appointments ?? '—'} />
        <Tile label="No-show rate" value={`${analytics.data?.totals.noShowPct ?? 0} %`} tone={(analytics.data?.totals.noShowPct ?? 0) > 12 ? 'down' : 'up'} />
        <Tile label="Waitlist" value={analytics.data?.totals.waitlist ?? 0} delta="open entries" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(360px, 1.6fr)', gap: 16, alignItems: 'start' }}>
        <Card title="Conversations" extra={`${rows.length}`}>
          {list.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState>No conversations yet.</EmptyState> : (
            <Queue
              rows={rows}
              rowKey={(c) => c.id}
              selectedKey={current?.id}
              onSelect={(c) => setSelected(c.id)}
              render={(c) => ({
                lead: <Chip kind="neutral">{c.channel === 'whatsapp' ? 'WA' : c.channel.toUpperCase()}</Chip>,
                title: c.patient ? `${c.patient.lastName}, ${c.patient.firstName}` : c.mobile,
                sub: c.lastMessage?.text.slice(0, 64) ?? 'No messages',
                aux: (
                  <>
                    <StatusChip status={c.state} />
                    {c.handedOverReason && <Chip kind="att">{c.handedOverReason.replace(/_/g, ' ')}</Chip>}
                  </>
                ),
              })}
            />
          )}
          <hr className="hr" />
          <h4>Simulate an inbound message</h4>
          <Field label="From (mobile)"><Input value={inbound.from} onChange={(e) => setInbound({ ...inbound, from: e.target.value })} placeholder="0821234567" /></Field>
          <Field label="Message"><Input value={inbound.text} onChange={(e) => setInbound({ ...inbound, text: e.target.value })} placeholder="Dr Naidoo sent me for an ultrasound of the abdomen" /></Field>
          <Button size="sm" disabled={!inbound.from || !inbound.text || simulate.isPending} onClick={() => simulate.mutate()}>Send to the Booking Hand</Button>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!current ? <Card title="Thread"><EmptyState>Choose a conversation.</EmptyState></Card> : (
            <Card
              title={current.patient ? `${current.patient.firstName} ${current.patient.lastName}` : current.mobile}
              extra={<><StatusChip status={current.state} />{current.claimedBy && <Chip kind="active">claimed</Chip>}</>}
            >
              {detail.isLoading ? <Skeleton rows={5} /> : (
                <>
                  <div className="wa" style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {(detail.data?.conversation.messages ?? []).map((m: any, i: number) => (
                      <div key={i} className={`m ${m.dir === 'in' ? '' : 'me'}`}>
                        {m.text}
                        {m.buttons && <div className="btns">{m.buttons.map((b: string) => <span key={b}>{b}</span>)}</div>}
                        <div className="t">{new Date(m.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
                      </div>
                    ))}
                  </div>
                  <div className="row-flex" style={{ marginTop: 10 }}>
                    <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as a person" style={{ flex: 1, height: 32 }} />
                    <Button disabled={!reply || send.isPending} onClick={() => send.mutate()}>Send</Button>
                    <Button variant="primary" disabled={!!current.claimedBy || claim.isPending} onClick={() => claim.mutate()}>Take over thread</Button>
                  </div>
                </>
              )}
            </Card>
          )}

          {task && (
            <Card title="Booking Hand" extra={<StatusChip status={task.status} />}>
              <Provenance prov={{ modelId: 'booking-hand', modelVersion: '2026.1', outputClass: 3, demo: true }}>
                <KV items={[
                  ['Trigger', task.trigger],
                  ['Steps', `${task.steps.length} tool calls`],
                  ['Leash checks', task.leashChecks.length ? task.leashChecks.map((l: any) => `${l.rule} ${l.actual}/${l.limit} ${l.ok ? 'ok' : 'exceeded'}`).join('; ') : 'within leash'],
                  ['Outcome', task.error ?? task.approvalReason ?? JSON.stringify(task.output ?? {}).slice(0, 180)],
                ]} />
                <div className="tl" style={{ marginTop: 8 }}>
                  {task.steps.slice(-8).map((s: any, i: number) => (
                    <li key={i} style={{ display: 'grid', gridTemplateColumns: '64px 14px 1fr', gap: 10, fontSize: 12 }}>
                      <span className="tm">{new Date(s.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                      <span className={`dot ${s.risk === 'R2' ? 'crit' : 'ai'}`} />
                      <span><span className="mono">{s.tool}</span> {s.note ?? ''}</span>
                    </li>
                  ))}
                </div>
              </Provenance>
              {current?.offers && current.offers.length > 0 && (
                <>
                  <h4 style={{ marginTop: 10 }}>Slots held for this patient</h4>
                  {current.offers.map((o) => (
                    <div key={o.appointmentId} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                      <span>{o.label}</span>
                      <Button size="sm" variant="primary" onClick={() => approve.mutate(o.appointmentId)} disabled={approve.isPending}>Approve and send</Button>
                    </div>
                  ))}
                </>
              )}
              {detail.data?.funding && (
                <p className="note" style={{ marginTop: 8 }}>
                  Funding: {detail.data.funding.status.replace(/_/g, ' ')} · patient portion <Money cents={detail.data.funding.patientPortionCents} />
                  {detail.data.funding.authRequired ? ` · authorisation ${detail.data.funding.authStatus}` : ''}
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
