import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, DateTime, Sheet, Field, Select, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/debtors/disputes')({ component: Page });

interface Dispute {
  id: string; accountId: string; debtorName: string | null; accountNo: string | null; reason: string; message: string | null; amountCents: number; status: string; outcome: string | null;
  slaDueAt: string; overdue: boolean; raisedVia: string; createdAt: string; resolvedAt: string | null; evidence: { claimRef?: string; totalCents?: number; paidCents?: number; funder?: string; reason?: string } | null;
}

function Page() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Dispute | null>(null);
  const [outcome, setOutcome] = useState('upheld');
  const [writeOff, setWriteOff] = useState(0);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const disputes = useQuery({ queryKey: ['disputes'], queryFn: () => api.get<{ disputes: Dispute[] }>('/billing/debtors/disputes') });
  const resolve = useMutation({
    mutationFn: (d: Dispute) => api.post(`/billing/debtors/disputes/${d.id}/resolve`, { outcome, note: note || 'Resolved from the disputes console', writeOffCents: outcome === 'upheld' ? (writeOff || d.amountCents) : 0, reason: 'quote_honoured_practice_error' }),
    onSuccess: () => { setToast('Resolved. A corrected statement goes out on the same channel and dunning resumes only if a balance remains.'); setSelected(null); setNote(''); setWriteOff(0); void qc.invalidateQueries({ queryKey: ['disputes'] }); void qc.invalidateQueries({ queryKey: ['debtors-tiles'] }); },
    onError: (e: Error) => setToast(e.message),
  });

  const rows = disputes.data?.disputes ?? [];
  const open = rows.filter((x) => x.status === 'open');

  return (
    <div className="page">
      <PageHeader title="Disputes" subtitle="A dispute pauses dunning on the disputed lines until it is resolved" />
      {disputes.isError && <Banner kind="crit">Disputes could not be loaded.</Banner>}
      {open.some((x) => x.overdue) && <Banner kind="crit">{open.filter((x) => x.overdue).length} dispute(s) are past the five working-day SLA.</Banner>}

      <div className="grid g4">
        <Tile label="Open" value={open.length} delta={<Money cents={open.reduce((a, x) => a + x.amountCents, 0)} />} />
        <Tile label="Past SLA" value={open.filter((x) => x.overdue).length} tone={open.some((x) => x.overdue) ? 'down' : 'up'} delta="five working days" />
        <Tile label="Upheld" value={rows.filter((x) => x.status === 'upheld').length} delta="quote honoured or practice error" />
        <Tile label="Resolved this view" value={rows.filter((x) => x.status !== 'open').length} delta={`${rows.length} total`} />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
        <Card title="Dispute workflow" extra={`${rows.length}`}>
          {disputes.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState>No disputes have been raised.</EmptyState> : (
            <DataTable
              rows={rows}
              rowKey={(x) => x.id}
              selectedKey={selected?.id}
              onRowClick={(x) => { setSelected(x); setWriteOff(x.amountCents); setOutcome(x.status === 'open' ? 'upheld' : x.status); }}
              columns={[
                { key: 'who', header: 'Account', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.debtorName ?? '—'}<span className="small muted mono" style={{ display: 'block' }}>{x.accountNo}</span></div> },
                { key: 'reason', header: 'Reason', render: (x) => <span style={{ whiteSpace: 'normal' }}>{x.reason}</span> },
                { key: 'via', header: 'Raised via', render: (x) => <Chip>{x.raisedVia}</Chip> },
                { key: 'amt', header: 'Amount', num: true, render: (x) => <Money cents={x.amountCents} /> },
                { key: 'sla', header: 'SLA', render: (x) => x.status === 'open' ? <span className={x.overdue ? 'neg' : ''}><DateTime iso={x.slaDueAt} time={false} /></span> : <span className="muted">closed</span> },
                { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!selected ? <Card title="Evidence"><EmptyState>Select a dispute to see the quote, the claim and the remittance side by side.</EmptyState></Card> : (
            <>
              <div className="spread"><h3>{selected.debtorName ?? 'Account'}</h3><StatusChip status={selected.status} /></div>
              {selected.message && (
                <div className="wa" style={{ padding: 8 }}>
                  <div className="m" style={{ maxWidth: '100%', fontSize: 13 }}>{selected.message}<div className="t"><DateTime iso={selected.createdAt} /> · {selected.raisedVia}</div></div>
                </div>
              )}
              <Card title="Evidence" extra="claim, remittance and quote in one view">
                {selected.evidence ? (
                  <KV items={[
                    ['Claim', <span key="c" className="mono">{selected.evidence.claimRef ?? '—'}</span>],
                    ['Funder', selected.evidence.funder ?? '—'],
                    ['Claim total', <Money key="t" cents={selected.evidence.totalCents ?? 0} />],
                    ['Scheme paid', <Money key="p" cents={selected.evidence.paidCents ?? 0} />],
                    ['Patient portion', <Money key="pp" cents={selected.amountCents} />],
                    ['Funder reason', selected.evidence.reason ?? 'per the remittance advice'],
                  ]} />
                ) : <p className="note">The account ledger carries the arithmetic for this balance.</p>}
              </Card>
              {selected.status === 'open' ? (
                <Card title="Decide">
                  <Field label="Outcome">
                    <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                      <option value="upheld">Upheld — the patient is right</option>
                      <option value="partly_upheld">Partly upheld</option>
                      <option value="not_upheld">Not upheld — explain and hold</option>
                      <option value="referred_to_funder">Referred to the funder (appeal)</option>
                    </Select>
                  </Field>
                  {outcome === 'upheld' && <Field label="Write off (cents)" hint="Above R500 a practice manager approves"><input type="number" value={writeOff} onChange={(e) => setWriteOff(Number(e.target.value))} /></Field>}
                  <Field label="What the patient is told"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="You are right. We quoted R0 at booking and we will honour that." /></Field>
                  <div className="row-flex" style={{ marginTop: 8 }}>
                    <Button variant="primary" disabled={resolve.isPending} onClick={() => resolve.mutate(selected)}>{resolve.isPending ? 'Resolving…' : 'Resolve and send'}</Button>
                  </div>
                  <p className="note">The write-off reason feeds the quote-accuracy KPI, so the cost of a bad quote lands where it was caused, not on the patient.</p>
                </Card>
              ) : (
                <Card title="Outcome" extra={selected.resolvedAt ? new Date(selected.resolvedAt).toLocaleDateString('en-ZA') : undefined}>
                  <p>{selected.outcome ?? 'Resolved.'}</p>
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Disputes"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
