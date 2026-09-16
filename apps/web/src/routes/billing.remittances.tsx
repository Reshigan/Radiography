import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, DateTime, Sheet, Field, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/billing/remittances')({ component: Page });

interface Line { claimRef: string; claimId: string | null; expectedCents: number; paidCents: number; reasonCode: string | null; shortPaymentClass: string | null; route: string | null; matchConfidence?: number; status: string; remittanceId?: string; reference?: string; funderId?: string }
interface Remittance { id: string; funderId: string; reference: string; receivedAt: string; totalCents: number; matchedCents: number; unmatchedCents: number; shortCents: number; status: string; bankRef: string | null; lines: Line[]; lineCount: number; matchedLines: number }

function Page() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [claimRef, setClaimRef] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const data = useQuery({ queryKey: ['remittances'], queryFn: () => api.get<{ remittances: Remittance[]; unallocated: Line[]; shortPaid: Line[]; unallocatedCents: number; autoMatchPct: number }>('/billing/remittances') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['remittances'] });

  const match = useMutation({ mutationFn: (id: string) => api.post(`/billing/remittances/${id}/match`, {}), onSuccess: (r: any) => { const o = r.task?.output ?? {}; setToast(`Matched ${o.matched ?? 0}, short-paid ${o.short ?? 0}, unmatched ${o.unmatched ?? 0}; ${o.liabilities ?? 0} transferred to patients.`); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const allocate = useMutation({ mutationFn: (v: { id: string; claimRef: string; paidToMember: boolean }) => api.post(`/billing/remittances/${v.id}/allocate`, { claimRef: v.claimRef, paidToMember: v.paidToMember }), onSuccess: () => { setToast('Allocated and re-run through the Remittance Hand.'); setClaimRef(''); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const generate = useMutation({ mutationFn: (funderId: string) => api.post('/sim/switch/remit', { funderId, shortPayEvery: 4 }), onSuccess: (r: any) => { setToast(`ERA ${r.reference} received with ${r.lines} lines and matched by the Hand.`); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const bank = useMutation({ mutationFn: (v: { reference: string; amountCents: number }) => api.post('/sim/bank/credit', v), onSuccess: (r: any) => { setToast(r.credit?.matchedTo ? 'Bank credit matched; the remittance is banked.' : 'Bank credit is unmatched and queued for review.'); refresh(); }, onError: (e: Error) => setToast(e.message) });

  const rows = data.data?.remittances ?? [];
  const current = rows.find((x) => x.id === selected) ?? null;

  return (
    <div className="page">
      <PageHeader
        title="Remittances"
        subtitle="ERA matching, short-payments and unallocated cash"
        actions={<>
          <Button onClick={() => generate.mutate('scheme-a')} disabled={generate.isPending}>Request Scheme A ERA</Button>
          <Button onClick={() => generate.mutate('scheme-b')} disabled={generate.isPending}>Request Scheme B ERA</Button>
        </>}
      />
      {data.isError && <Banner kind="crit">Remittances could not be loaded.</Banner>}

      <div className="grid g4">
        <Tile label="Remittances" value={rows.length} delta={<Money cents={rows.reduce((a, x) => a + x.totalCents, 0)} />} />
        <Tile label="Auto-match rate" value={`${data.data?.autoMatchPct ?? 0} %`} tone={(data.data?.autoMatchPct ?? 0) >= 95 ? 'up' : 'down'} delta="target ≥ 95 %" />
        <Tile label="Unallocated" value={data.data?.unallocated.length ?? 0} tone="down" delta={<Money cents={data.data?.unallocatedCents ?? 0} />} />
        <Tile label="Short-paid lines" value={data.data?.shortPaid.length ?? 0} delta="routed by the short-payment taxonomy" />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <Card title="Remittance advices">
          {data.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState>No remittance advices have arrived.</EmptyState> : (
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <DataTable
                rows={rows}
                rowKey={(x) => x.id}
                selectedKey={selected ?? undefined}
                onRowClick={(x) => setSelected(x.id)}
                columns={[
                  { key: 'ref', header: 'Reference', render: (x) => <span className="mono">{x.reference}</span> },
                  { key: 'funder', header: 'Funder', render: (x) => x.funderId },
                  { key: 'rec', header: 'Received', render: (x) => <DateTime iso={x.receivedAt} time={false} /> },
                  { key: 'lines', header: 'Lines', num: true, render: (x) => `${x.matchedLines}/${x.lineCount}` },
                  { key: 'total', header: 'Total', num: true, render: (x) => <Money cents={x.totalCents} /> },
                  { key: 'short', header: 'Short', num: true, render: (x) => x.shortCents ? <span className="neg"><Money cents={x.shortCents} /></span> : <span className="muted">—</span> },
                  { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                  { key: 'act', header: '', render: (x) => <span onClick={(e) => e.stopPropagation()}><Button size="sm" disabled={match.isPending} onClick={() => match.mutate(x.id)}>Match</Button></span> },
                ]}
              />
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {current ? (
            <>
              <Card title={<span className="mono">{current.reference}</span>} extra={`${current.funderId} · ${current.status}`}>
                <KV items={[
                  ['Total', <Money key="t" cents={current.totalCents} />],
                  ['Matched', <Money key="m" cents={current.matchedCents} />],
                  ['Short-paid', <Money key="s" cents={current.shortCents} />],
                  ['Unmatched', <Money key="u" cents={current.unmatchedCents} />],
                  ['Bank reference', <span key="b" className="mono">{current.bankRef ?? 'not yet banked'}</span>],
                ]} />
                {!current.bankRef && <div className="row-flex" style={{ marginTop: 8 }}><Button size="sm" disabled={bank.isPending} onClick={() => bank.mutate({ reference: current.reference, amountCents: current.totalCents })}>Receive the bank credit</Button></div>}
              </Card>
              <Card title="Lines" extra={`${current.lines.length}`}>
                <div style={{ maxHeight: 280, overflow: 'auto' }}>
                  <DataTable
                    rows={current.lines}
                    rowKey={(x, ) => x.claimRef}
                    columns={[
                      { key: 'ref', header: 'Claim', render: (x) => <span className="mono">{x.claimRef}</span> },
                      { key: 'exp', header: 'Expected', num: true, render: (x) => <Money cents={x.expectedCents} /> },
                      { key: 'paid', header: 'Paid', num: true, render: (x) => <Money cents={x.paidCents} /> },
                      { key: 'why', header: 'Reason', render: (x) => x.shortPaymentClass ? <span className="small">{x.shortPaymentClass.replace(/_/g, ' ')}</span> : <span className="muted">—</span> },
                      { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                    ]}
                  />
                </div>
              </Card>
            </>
          ) : <Card title="Detail"><EmptyState>Select a remittance to see its lines and bank match.</EmptyState></Card>}

          <Card title="Unallocated cash" extra={`${data.data?.unallocated.length ?? 0} lines`}>
            {(data.data?.unallocated.length ?? 0) === 0 ? <EmptyState>Every credit is allocated.</EmptyState> : (
              <>
                <DataTable
                  rows={data.data!.unallocated}
                  rowKey={(x) => `${x.remittanceId}:${x.claimRef}`}
                  columns={[
                    { key: 'ref', header: 'Reference', render: (x) => <span className="mono">{x.claimRef}</span> },
                    { key: 'f', header: 'Funder', render: (x) => x.funderId ?? '—' },
                    { key: 'p', header: 'Paid', num: true, render: (x) => <Money cents={x.paidCents} /> },
                  ]}
                />
                <p className="note" style={{ marginTop: 6 }}>An unmatched credit is never absorbed silently. Allocate it to a claim, or mark it as paid to the member so the balance moves to the patient.</p>
                {current && (
                  <>
                    <Field label="Allocate to claim reference"><input value={claimRef} onChange={(e) => setClaimRef(e.target.value)} placeholder="B-018342" /></Field>
                    <div className="row-flex" style={{ marginTop: 8 }}>
                      <Button size="sm" variant="primary" disabled={!claimRef || allocate.isPending} onClick={() => allocate.mutate({ id: current.id, claimRef, paidToMember: false })}>Allocate</Button>
                      <Button size="sm" disabled={!claimRef || allocate.isPending} onClick={() => allocate.mutate({ id: current.id, claimRef, paidToMember: true })}>Paid to member</Button>
                    </div>
                  </>
                )}
              </>
            )}
          </Card>

          <Card title="Short-payments" extra="routed by taxonomy">
            {(data.data?.shortPaid.length ?? 0) === 0 ? <EmptyState>No short-payments to route.</EmptyState> : (
              <div style={{ maxHeight: 240, overflow: 'auto' }}>
                <DataTable
                  rows={data.data!.shortPaid.slice(0, 40)}
                  rowKey={(x) => `${x.remittanceId}:${x.claimRef}`}
                  columns={[
                    { key: 'ref', header: 'Claim', render: (x) => <span className="mono">{x.claimRef}</span> },
                    { key: 'gap', header: 'Short by', num: true, render: (x) => <span className="neg"><Money cents={x.expectedCents - x.paidCents} /></span> },
                    { key: 'cls', header: 'Class', render: (x) => <Chip kind="att">{(x.shortPaymentClass ?? 'unknown').replace(/_/g, ' ')}</Chip> },
                    { key: 'route', header: 'Routed to', render: (x) => (x.route ?? 'deb review').replace(/_/g, ' ') },
                  ]}
                />
              </div>
            )}
          </Card>
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Remittances"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
