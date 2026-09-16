import { createFileRoute } from '@tanstack/react-router';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, DateTime, Timeline, KV, Field, Sheet } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/billing/claims')({ component: Page });

interface Claim {
  id: string; claimRef: string; patient: string; funderId: string; funder: string; procedure: string; icd10: string[]; totalCents: number; expectedFunderCents: number; paidCents: number;
  status: string; channel: string; switchRef: string | null; submittedAt: string | null; respondedAt: string | null; serviceDate: string; staleDate: string | null; daysToStale: number | null;
  rejectionCode: string | null; rejectionReason: string | null; resubmitCount: number; pmb: boolean; exception: { family: string; suggestion: string } | null;
}

const STATUSES = ['scrubbed', 'held', 'submitted', 'accepted', 'pended', 'rejected', 'short_paid', 'paid', 'reversed'];

function Page() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [authRef, setAuthRef] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const claims = useQuery({ queryKey: ['claims', status, q], queryFn: () => api.get<{ claims: Claim[]; total: number }>(`/billing/claims?limit=300${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const detail = useQuery({ queryKey: ['claim', selected], enabled: !!selected, queryFn: () => api.get<any>(`/billing/claims/${selected}`) });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['claims'] }); void qc.invalidateQueries({ queryKey: ['claim'] }); };
  const submit = useMutation({ mutationFn: (ids?: string[]) => api.post('/billing/claims/submit', ids ? { claimIds: ids } : {}), onSuccess: (r: any) => { setToast(`${r.task?.output?.submitted ?? 0} submitted, ${r.task?.output?.held ?? 0} held by the Hand.`); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const resubmit = useMutation({ mutationFn: (id: string) => api.post(`/billing/claims/${id}/resubmit`, { authRef: authRef || undefined }), onSuccess: (r: any) => { setToast(r?.ok ? `Resubmitted: ${r.status}.` : 'The claim still fails the scrubber.'); setAuthRef(''); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const runBatch = useMutation({ mutationFn: () => api.post('/sim/switch/run-batch', {}), onSuccess: (r: any) => { setToast(`${r.applied ?? 0} batch responses applied.`); refresh(); }, onError: (e: Error) => setToast(e.message) });

  const rows = claims.data?.claims ?? [];
  const counts = STATUSES.map((s) => ({ s, n: rows.filter((x) => x.status === s).length }));
  const ready = rows.filter((x) => x.status === 'scrubbed');

  return (
    <div className="page">
      <PageHeader
        title="Claims"
        subtitle="Batch and real-time submissions, responses and resubmissions"
        actions={<>
          <Button onClick={() => runBatch.mutate()} disabled={runBatch.isPending}>Run switch batch</Button>
          <Button variant="primary" disabled={submit.isPending || !ready.length} onClick={() => submit.mutate(undefined)}>Submit batch ({ready.length})</Button>
        </>}
      />
      {claims.isError && <Banner kind="crit">Claims could not be loaded.</Banner>}

      <div className="grid g4">
        <Tile label="In this view" value={rows.length} delta={<Money cents={rows.reduce((a, x) => a + x.totalCents, 0)} />} />
        <Tile label="Ready to submit" value={ready.length} delta={<Money cents={ready.reduce((a, x) => a + x.totalCents, 0)} />} />
        <Tile label="Rejected or held" value={rows.filter((x) => ['rejected', 'held'].includes(x.status)).length} tone="down" delta={<Money cents={rows.filter((x) => ['rejected', 'held'].includes(x.status)).reduce((a, x) => a + x.totalCents, 0)} />} />
        <Tile label="Paid or remitted" value={rows.filter((x) => ['paid', 'short_paid'].includes(x.status)).length} tone="up" delta={<Money cents={rows.reduce((a, x) => a + x.paidCents, 0)} />} />
      </div>

      <div className="toolbar">
        <input placeholder="Search claim reference or member number" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <button className="link" onClick={() => setStatus('')}><Chip kind={status ? 'neutral' : 'active'}>All {rows.length}</Chip></button>
        {counts.filter((x) => x.n > 0 || status === x.s).map((x) => (
          <button key={x.s} className="link" onClick={() => setStatus(x.s === status ? '' : x.s)}><Chip kind={x.s === status ? 'active' : 'neutral'}>{x.s.replace(/_/g, ' ')} {x.n}</Chip></button>
        ))}
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <Card title="Claim lifecycle">
          {claims.isLoading ? <Skeleton rows={8} /> : rows.length === 0 ? <EmptyState>No claims match this filter.</EmptyState> : (
            <div style={{ maxHeight: 560, overflow: 'auto' }}>
              <DataTable
                rows={rows}
                rowKey={(x) => x.id}
                selectedKey={selected ?? undefined}
                onRowClick={(x) => setSelected(x.id)}
                columns={[
                  { key: 'ref', header: 'Claim', render: (x) => <span className="mono">{x.claimRef}</span> },
                  { key: 'pt', header: 'Patient · funder', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.patient}<span className="small muted" style={{ display: 'block' }}>{x.funder}</span></div> },
                  { key: 'proc', header: 'Procedure', render: (x) => x.procedure },
                  { key: 'ch', header: 'Channel', render: (x) => <Chip kind={x.channel === 'realtime' ? 'active' : 'neutral'}>{x.channel}</Chip> },
                  { key: 'total', header: 'Total', num: true, render: (x) => <Money cents={x.totalCents} /> },
                  { key: 'paid', header: 'Paid', num: true, render: (x) => x.paidCents ? <Money cents={x.paidCents} /> : <span className="muted">—</span> },
                  { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                  { key: 'stale', header: 'Stale in', num: true, render: (x) => x.daysToStale === null ? <span className="muted">—</span> : <span className={x.daysToStale <= 30 ? 'neg mono' : 'mono'}>{x.daysToStale} d</span> },
                ]}
              />
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!selected ? <Card title="Claim detail"><EmptyState>Select a claim to see its lines, responses and audit trail.</EmptyState></Card>
            : detail.isLoading ? <Skeleton rows={8} />
              : detail.isError ? <Banner kind="crit">This claim could not be loaded.</Banner>
                : <ClaimDetail data={detail.data} authRef={authRef} setAuthRef={setAuthRef} onResubmit={() => resubmit.mutate(selected)} busy={resubmit.isPending} onSubmit={() => submit.mutate([selected])} />}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Claims"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}

function ClaimDetail({ data, authRef, setAuthRef, onResubmit, onSubmit, busy }: { data: any; authRef: string; setAuthRef: (v: string) => void; onResubmit: () => void; onSubmit: () => void; busy: boolean }) {
  const claim = data.claim;
  const lines: Array<{ code: string; description: string; quantity: number; exclCents: number; vatCents: number }> = claim.lines ?? [];
  const responses: Array<{ outcome: string; code: string | null; message: string | null; receivedAt: string }> = data.responses ?? [];
  const timeline: Array<{ at: string; text: string; tone: string }> = data.timeline ?? [];
  return (
    <>
      <div className="spread"><h3 className="mono" style={{ fontSize: 15 }}>{claim.claimRef}</h3><StatusChip status={claim.status} /></div>
      {data.patient && <div className="muted small">{data.patient.name} · {data.patient.schemeName ?? ''} {data.patient.schemeOption ?? ''}{data.patient.memberNo ? ` · member ····${String(data.patient.memberNo).slice(-4)}` : ''}</div>}
      <Card title="Lines" extra={`ICD-10 ${(claim.icd10 ?? []).join(', ') || '—'}`}>
        <div className="collect" style={{ fontSize: 13 }}>
          {lines.map((l, i) => (
            <Fragment key={i}>
              <span className="lbl">{l.code} {l.description} × {l.quantity}</span>
              <Money cents={l.exclCents} />
            </Fragment>
          ))}
          <span className="lbl">VAT 15 %</span><Money cents={claim.totalCents - lines.reduce((a, l) => a + l.exclCents, 0)} />
          <span className="lbl tot">Total</span><span className="tot"><Money cents={claim.totalCents} /></span>
          <span className="lbl">Expected from funder</span><Money cents={claim.expectedFunderCents} />
          <span className="lbl">Paid</span><Money cents={claim.paidCents} />
        </div>
      </Card>
      <Card title="Lifecycle" extra={`${claim.channel} · rule pack ${claim.rulePackVersion ?? '—'}`}>
        <KV items={[
          ['Service date', claim.serviceDate],
          ['Submitted', claim.submittedAt ? <DateTime key="s" iso={claim.submittedAt} /> : <span key="s" className="muted">not yet</span>],
          ['Responded', claim.respondedAt ? <DateTime key="r" iso={claim.respondedAt} /> : <span key="r" className="muted">awaiting</span>],
          ['Switch reference', <span key="w" className="mono">{claim.switchRef ?? '—'}</span>],
          ['Stale date', <span key="d" className="mono">{claim.staleDate ?? '—'}</span>],
          ['Resubmissions', String(claim.resubmitCount)],
          ['PMB', claim.pmb ? 'flagged' : 'no'],
        ]} />
      </Card>
      {claim.exception && <Banner kind="warn">{claim.exception.family}: {claim.exception.reason}. {claim.exception.suggestion}</Banner>}
      {['rejected', 'held', 'pended'].includes(claim.status) && (
        <Card title="Fix and resubmit">
          <Field label="Authorisation number (if the funder asked for one)"><input value={authRef} onChange={(e) => setAuthRef(e.target.value)} placeholder="RA-B-3311" /></Field>
          <div className="row-flex" style={{ marginTop: 8 }}><Button variant="primary" disabled={busy} onClick={onResubmit}>{busy ? 'Sending…' : 'Resubmit'}</Button></div>
        </Card>
      )}
      {claim.status === 'scrubbed' && <div className="row-flex"><Button variant="primary" onClick={onSubmit}>Submit this claim</Button></div>}
      <Card title="Responses" extra={`${responses.length}`}>
        {responses.length === 0 ? <EmptyState>No responses yet.</EmptyState> : (
          <Timeline items={responses.map((x) => ({ time: new Date(x.receivedAt).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), text: `${x.outcome}${x.code ? ` · RSP ${x.code}` : ''}${x.message ? ` · ${x.message}` : ''}`, kind: x.outcome === 'rejected' ? 'crit' : x.outcome === 'accepted' || x.outcome === 'paid' ? 'ok' : 'neutral' }))} />
        )}
      </Card>
      <Card title="Audit trail" extra={`${timeline.length} events`}>
        <Timeline items={timeline.slice(-10).map((x) => ({ time: new Date(x.at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), text: x.text, kind: x.tone as 'ok' | 'crit' | 'ai' | 'neutral' }))} />
      </Card>
    </>
  );
}
