import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, Field, Select, Sheet, KV, DateTime, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/desk/payments')({ component: Payments });

interface Account { id: string; accountNo: string; debtorName: string | null; balanceCents: number; ageDays: number; liabilityReason: string | null; patientId: string; debtorClass: string }
interface Payment { id: string; receiptNo: string | null; method: string; amountCents: number; status: string; at: string; reference: string | null; patientId: string | null }
interface CashUp { day: string; totalCents: number; count: number; byMethod: Record<string, { count: number; cents: number }>; cash: { countedCents: number; expectedCents: number; varianceCents: number; floatCents: number }; receipts: Payment[] }

const METHODS = [
  { id: 'card', label: 'Card (PSP terminal)' }, { id: 'payshap', label: 'PayShap (instant payment)' }, { id: 'qr', label: 'QR wallet' },
  { id: 'eft', label: 'EFT with a unique reference' }, { id: 'cash', label: 'Cash' },
];

function Payments() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Account | null>(null);
  const [method, setMethod] = useState('card');
  const [amount, setAmount] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const accounts = useQuery({ queryKey: ['desk-accounts'], queryFn: () => api.get<{ accounts: Account[] }>('/billing/debtors/accounts?limit=100') });
  const payments = useQuery({ queryKey: ['desk-payments'], queryFn: () => api.get<{ payments: Payment[]; today: { date: string; count: number; totalCents: number; byMethod: Record<string, { count: number; cents: number }>; cashCents: number } }>('/billing/payments') });
  const cashUp = useQuery({ queryKey: ['cash-up'], queryFn: () => api.get<CashUp>('/billing/cash-up') });
  const collect = useQuery({ queryKey: ['collect', selected?.patientId], enabled: !!selected, queryFn: () => api.get<any>(`/billing/patients/${selected!.patientId}/account`) });

  const refresh = () => { for (const k of ['desk-accounts', 'desk-payments', 'cash-up', 'collect']) void qc.invalidateQueries({ queryKey: [k] }); };
  const take = useMutation({
    mutationFn: () => api.post('/billing/payments', { accountId: selected!.id, method, amountCents: Math.round(Number(amount) * 100) }),
    onSuccess: (r: any) => { setToast(`Receipt ${r.receiptNo} issued. Balance now R ${(r.balanceCents / 100).toFixed(2)}.`); setAmount(''); refresh(); },
    onError: (e: Error) => setToast(e.message),
  });
  const link = useMutation({
    mutationFn: () => api.post('/billing/payments/link', { accountId: selected!.id, amountCents: selected!.balanceCents, channel: 'whatsapp' }),
    onSuccess: () => { setToast('A single-use payment link was sent on the patient’s consented channel. It expires in 72 hours.'); refresh(); },
    onError: (e: Error) => setToast(e.message),
  });

  const owing = (accounts.data?.accounts ?? []).filter((a) => a.balanceCents > 0);
  const t = payments.data?.today;
  const c = cashUp.data;
  const card = collect.data?.collect;

  return (
    <div className="page">
      <PageHeader title="Payments" subtitle="Take payment, issue receipts and cash up the day" />
      {accounts.isError && <Banner kind="crit">Accounts could not be loaded.</Banner>}

      <div className="grid g4">
        <Tile label="Collected today" value={<Money cents={t?.totalCents ?? 0} />} delta={`${t?.count ?? 0} receipts`} />
        <Tile label="Cash on hand" value={<Money cents={(c?.cash.countedCents ?? 0) + (c?.cash.floatCents ?? 0)} />} delta={<>float <Money cents={c?.cash.floatCents ?? 0} /> · variance <Money cents={c?.cash.varianceCents ?? 0} /></>} />
        <Tile label="Accounts with a balance" value={owing.length} delta={<Money cents={owing.reduce((a, x) => a + x.balanceCents, 0)} />} />
        <Tile label="Methods used today" value={Object.keys(t?.byMethod ?? {}).length} delta={Object.entries(t?.byMethod ?? {}).map(([k, v]) => `${k} ${v.count}`).join(' · ') || 'none yet'} />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="Balances at the desk" extra={`${owing.length}`}>
            {accounts.isLoading ? <Skeleton rows={6} /> : owing.length === 0 ? <EmptyState>Nothing is outstanding at the desk.</EmptyState> : (
              <div style={{ maxHeight: 320, overflow: 'auto' }}>
                <DataTable
                  rows={owing}
                  rowKey={(x) => x.id}
                  selectedKey={selected?.id}
                  onRowClick={(x) => { setSelected(x); setAmount((x.balanceCents / 100).toFixed(2)); }}
                  columns={[
                    { key: 'who', header: 'Patient', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.debtorName ?? '—'}<span className="small muted mono" style={{ display: 'block' }}>{x.accountNo}</span></div> },
                    { key: 'why', header: 'Reason', render: (x) => <span className="small">{(x.liabilityReason ?? '—').replace(/_/g, ' ')}</span> },
                    { key: 'age', header: 'Age', num: true, render: (x) => <span className="mono">{x.ageDays} d</span> },
                    { key: 'bal', header: 'Balance', num: true, render: (x) => <Money cents={x.balanceCents} /> },
                  ]}
                />
              </div>
            )}
          </Card>

          <Card title="Today's receipts" extra={c ? c.day : undefined}>
            {payments.isLoading ? <Skeleton rows={5} /> : (c?.receipts.length ?? 0) === 0 ? <EmptyState>No payments taken today.</EmptyState> : (
              <div style={{ maxHeight: 280, overflow: 'auto' }}>
                <DataTable
                  rows={c!.receipts}
                  rowKey={(x) => x.id}
                  columns={[
                    { key: 'r', header: 'Receipt', render: (x) => <span className="mono">{x.receiptNo}</span> },
                    { key: 'm', header: 'Method', render: (x) => <Chip>{x.method}</Chip> },
                    { key: 'a', header: 'Amount', num: true, render: (x) => <Money cents={x.amountCents} /> },
                    { key: 't', header: 'Time', render: (x) => <DateTime iso={x.at} date={false} /> },
                    { key: 's', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                  ]}
                />
              </div>
            )}
          </Card>

          <Card title="Cash-up" extra="counted against expected">
            {!c ? <Skeleton rows={3} /> : (
              <>
                <KV items={[
                  ['Opening float', <Money key="f" cents={c.cash.floatCents} />],
                  ['Cash taken', <Money key="t" cents={c.cash.countedCents} />],
                  ['Expected in the drawer', <Money key="e" cents={c.cash.floatCents + c.cash.expectedCents} />],
                  ['Variance', <span key="v" className={c.cash.varianceCents ? 'neg' : ''}><Money cents={c.cash.varianceCents} sign /></span>],
                  ['Card, PayShap and QR settle to the bank', <Money key="b" cents={c.totalCents - c.cash.countedCents} />],
                ]} />
                <p className="note" style={{ marginTop: 6 }}>Cash variances are reported daily. Card details are never stored: the PSP hosts the payment page.</p>
              </>
            )}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!selected ? <Card title="Collect"><EmptyState>Select a patient balance to take a payment.</EmptyState></Card> : (
            <>
              <div className="spread"><h3>{selected.debtorName ?? selected.accountNo}</h3><Chip kind="att">owes</Chip></div>
              <Card title="Collect card" extra={card ? card.funder : undefined}>
                {collect.isLoading ? <Skeleton rows={4} /> : (
                  <>
                    <div className="collect">
                      {card && <>
                        <span className="lbl">{card.procedure}<span className="small mono" style={{ display: 'block' }}>{card.serviceDate}</span></span><Money cents={card.totalCents} />
                        <span className="lbl">Scheme portion</span><Money cents={card.schemePortionCents} />
                        <span className="lbl">Patient portion</span><Money cents={card.patientPortionCents} />
                      </>}
                      {(collect.data?.priorBalanceCents ?? 0) > 0 && <><span className="lbl">Previous balance</span><Money cents={collect.data.priorBalanceCents} /></>}
                      <span className="lbl tot">Due now</span><span className="tot"><Money cents={selected.balanceCents} /></span>
                    </div>
                    {card?.reason && <div className="note" style={{ marginTop: 6 }}>Reason: {card.reason}</div>}
                  </>
                )}
              </Card>

              <Card title="Take payment">
                <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
                <Field label="Amount (rand)"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <div className="row-flex" style={{ marginTop: 8 }}>
                  <Button variant="primary" disabled={!amount || take.isPending} onClick={() => take.mutate()}>{take.isPending ? 'Taking…' : 'Take payment and print the receipt'}</Button>
                  <Button disabled={link.isPending} onClick={() => link.mutate()}>Send a payment link</Button>
                </div>
                <p className="note">If the patient cannot pay now, send the link or offer a plan. The study always goes ahead; urgent care is never blocked by a balance.</p>
              </Card>

              {(collect.data?.plans?.length ?? 0) > 0 && (
                <Card title="Plan on this account">
                  {collect.data.plans.map((pl: any) => (
                    <KV key={pl.id} items={[['Plan', `${pl.instalmentCount} instalments, no interest`], ['Status', pl.status]]} />
                  ))}
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Payments"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
