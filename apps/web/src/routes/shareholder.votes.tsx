import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Money, Skeleton, EmptyState, Chip, Button, StatusChip, Sheet, Field, Timeline, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/shareholder/votes')({ component: Page });

interface Matter {
  id: string; ref: string; kind: string; title: string; description: string; amountCents: number | null;
  rule: { majorityPct: number; quorumBothClasses: boolean; requireLocalPartner: boolean; abstentionCountsAs: string };
  votes: Array<{ shareholderName: string; pct: number; vote: string; condition: string | null; at: string }>;
  attachments: Array<{ name: string; kind: string }> | null; thread: Array<{ from: string; at: string; text: string }> | null;
  opensAt: string; closesAt: string; status: string; myVote: { vote: string; condition: string | null } | null; tally: { approve: number; decline: number; abstain: number };
}

function Page() {
  const qc = useQueryClient();
  const [condition, setCondition] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const data = useQuery({ queryKey: ['votes'], queryFn: () => api.get<{ matters: Matter[] }>('/finance/votes') });
  const vote = useMutation({
    mutationFn: (v: { id: string; vote: string }) => api.post(`/finance/votes/${v.id}/vote`, { vote: v.vote, condition: condition || undefined }),
    onSuccess: (r: any) => { setToast(`Vote recorded. Approve ${r.tally.approve} %, decline ${r.tally.decline} %. The matter is ${r.status}.`); setCondition(''); void qc.invalidateQueries({ queryKey: ['votes'] }); void qc.invalidateQueries({ queryKey: ['shareholder-me'] }); },
    onError: (e: Error) => setToast(e.message),
  });

  const matters = data.data?.matters ?? [];
  const open = matters.filter((m) => m.status === 'open');

  return (
    <div className="page">
      <PageHeader title="Reserved matters" subtitle="Recorded votes under the shareholders' agreement, with quorum, majority rules and deadlines" />
      {data.isError && <Banner kind="crit">Votes could not be loaded.</Banner>}
      {data.isLoading ? <Skeleton rows={6} /> : matters.length === 0 ? <EmptyState>No reserved matters have been proposed.</EmptyState> : null}
      {open.length === 0 && matters.length > 0 && <Banner kind="ok">No vote is open. Decided matters are kept below with their outcome.</Banner>}

      {matters.map((m) => (
        <Card key={m.id} title={<span>{m.title} <Chip>{m.ref}</Chip></span>} extra={<StatusChip status={m.status} />}>
          <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
            <div>
              {m.amountCents !== null && <div className="money" style={{ font: '700 24px/1.1 var(--display)', color: 'var(--heading)' }}><Money cents={m.amountCents} /></div>}
              <p className="small" style={{ marginTop: 6 }}>{m.description}</p>
              <div className="row-flex" style={{ marginTop: 8 }}>
                {(m.attachments ?? []).map((a) => <Chip key={a.name}>{a.name} · {a.kind}</Chip>)}
              </div>
              <div style={{ borderLeft: '2px solid var(--line-strong)', paddingLeft: 8, marginTop: 10, font: '11px var(--mono)', color: 'var(--text-2)' }}>
                rule: {m.rule.majorityPct} % of voting shares{m.rule.quorumBothClasses ? ' · quorum both classes' : ''}{m.rule.requireLocalPartner ? ' · at least one local partner' : ''} · abstention by the deadline counts as {m.rule.abstentionCountsAs}
              </div>
              {m.thread && m.thread.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <h4>Discussion</h4>
                  <Timeline items={m.thread.map((x) => ({ time: new Date(x.at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }), text: <><b>{x.from}</b>: {x.text}</>, kind: 'neutral' as const }))} />
                </div>
              )}
            </div>
            <div>
              <h4>Votes so far</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '6px 10px', fontSize: 12, alignItems: 'center', marginTop: 6 }}>
                {m.votes.map((v) => (
                  <Row key={v.shareholderName} name={v.shareholderName} pct={v.pct} vote={v.vote} />
                ))}
                {!m.myVote && m.status === 'open' && <Row name="You" pct={0} vote="pending" />}
              </div>
              <div className="row-flex" style={{ marginTop: 8, fontSize: 12 }}>
                <Chip kind="done">approve {m.tally.approve} %</Chip>
                <Chip kind="crit">decline {m.tally.decline} %</Chip>
                <Chip>abstain {m.tally.abstain} %</Chip>
              </div>
              <p className="note" style={{ marginTop: 6 }}>Closes <DateTime iso={m.closesAt} />.</p>

              {m.status === 'open' && !m.myVote && (
                <>
                  <Field label="Vote with a condition (optional)"><input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Subject to the rural carve-out being kept" /></Field>
                  <div className="row-flex" style={{ marginTop: 8 }}>
                    <Button variant="primary" size="lg" disabled={vote.isPending} onClick={() => vote.mutate({ id: m.id, vote: 'approve' })}>Approve</Button>
                    <Button size="lg" disabled={vote.isPending} onClick={() => vote.mutate({ id: m.id, vote: 'decline' })}>Decline</Button>
                    <Button variant="ghost" disabled={vote.isPending} onClick={() => vote.mutate({ id: m.id, vote: 'abstain' })}>Abstain</Button>
                  </div>
                  <p className="note">Your identity and the time are recorded with the vote. A condition is recorded for the Group to respond to before the vote closes.</p>
                </>
              )}
              {m.myVote && <Banner kind="ok">You voted to {m.myVote.vote}{m.myVote.condition ? `, with the condition: ${m.myVote.condition}` : ''}.</Banner>}
            </div>
          </div>
        </Card>
      ))}

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Reserved matters"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}

function Row({ name, pct, vote }: { name: string; pct: number; vote: string }) {
  return (
    <>
      <span>{name}{pct ? ` · ${pct} %` : ''}</span>
      <span style={{ display: 'block', height: 6, borderRadius: 3, background: 'var(--line)', position: 'relative' }}>
        <b style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, width: `${pct}%`, background: vote === 'approve' ? 'var(--ok)' : vote === 'decline' ? 'var(--crit)' : 'var(--ash-300)' }} />
      </span>
      <Chip kind={vote === 'approve' ? 'done' : vote === 'decline' ? 'crit' : 'neutral'}>{vote}</Chip>
    </>
  );
}
