import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, Sheet, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/debtors/plans')({ component: Page });

interface Plan {
  id: string; accountId: string; debtorName: string | null; accountNo: string | null; totalCents: number; instalmentCount: number; instalmentCents: number; interestPct: number; method: string; status: string;
  schedule: Array<{ n: number; dueDate: string; amountCents: number; status: string; paidAt: string | null }>; nextDue: { n: number; dueDate: string; amountCents: number } | null; inArrears: boolean; approvedBy: string | null;
}

function Page() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ plans: Plan[]; policy: { maxInstalments: number; maxPlanCents: number; interestPct: number } }>('/billing/debtors/plans') });
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/billing/debtors/plans/${id}/approve`, {}), onSuccess: () => { setToast('Plan approved and active. The Hand switches to plan mode.'); void qc.invalidateQueries({ queryKey: ['plans'] }); }, onError: (e: Error) => setToast(e.message) });

  const rows = plans.data?.plans ?? [];
  const active = rows.filter((x) => x.status === 'active');
  const proposed = rows.filter((x) => x.status === 'proposed');
  const arrears = active.filter((x) => x.inArrears);
  const book = active.reduce((a, x) => a + x.schedule.filter((s) => s.status !== 'paid').reduce((b, s) => b + s.amountCents, 0), 0);
  const current = rows.find((x) => x.id === selected) ?? null;

  return (
    <div className="page">
      <PageHeader title="Payment plans" subtitle="Interest free by policy, which keeps them inside the National Credit Act's incidental-credit rules" />
      {plans.isError && <Banner kind="crit">Plans could not be loaded.</Banner>}
      {proposed.length > 0 && <Banner kind="warn">{proposed.length} plan(s) are above the Hand&apos;s plan leash and wait for your approval.</Banner>}

      <div className="grid g4">
        <Tile label="Active plans" value={active.length} delta={<Money cents={book} />} />
        <Tile label="Awaiting approval" value={proposed.length} tone={proposed.length ? 'down' : undefined} delta="above the plan leash" />
        <Tile label="In arrears" value={arrears.length} tone={arrears.length ? 'down' : 'up'} delta={book ? `${Math.round((arrears.reduce((a, x) => a + x.totalCents, 0) / book) * 100)} % of the book` : '—'} />
        <Tile label="Interest charged" value="0 %" delta="policy reviewed by compliance" />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <Card title="Plan book" extra={`${rows.length}`}>
          {plans.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState>No payment plans yet. Offer one from a debtor account.</EmptyState> : (
            <DataTable
              rows={rows}
              rowKey={(x) => x.id}
              selectedKey={selected ?? undefined}
              onRowClick={(x) => setSelected(x.id)}
              columns={[
                { key: 'who', header: 'Account', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.debtorName ?? '—'}<span className="small muted mono" style={{ display: 'block' }}>{x.accountNo}</span></div> },
                { key: 'total', header: 'Total', num: true, render: (x) => <Money cents={x.totalCents} /> },
                { key: 'n', header: 'Instalments', num: true, render: (x) => x.instalmentCount },
                { key: 'each', header: 'Each', num: true, render: (x) => <Money cents={x.instalmentCents} /> },
                { key: 'method', header: 'Method', render: (x) => <Chip>{x.method.replace(/_/g, ' ')}</Chip> },
                { key: 'next', header: 'Next due', render: (x) => x.nextDue ? <span className={x.inArrears ? 'neg mono' : 'mono'}>{x.nextDue.dueDate}</span> : <span className="muted">complete</span> },
                { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.inArrears ? 'arrears' : x.status} /> },
                { key: 'act', header: '', render: (x) => x.status === 'proposed' ? <span onClick={(e) => e.stopPropagation()}><Button size="sm" variant="primary" disabled={approve.isPending} onClick={() => approve.mutate(x.id)}>Approve</Button></span> : null },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!current ? <Card title="Schedule"><EmptyState>Select a plan to see its instalments.</EmptyState></Card> : (
            <>
              <div className="spread"><h3>{current.debtorName ?? current.accountNo}</h3><StatusChip status={current.inArrears ? 'arrears' : current.status} /></div>
              <Card title="Terms">
                <KV items={[
                  ['Balance spread', <Money key="b" cents={current.totalCents} />],
                  ['Instalments', `${current.instalmentCount} × ${(current.instalmentCents / 100).toFixed(2)}, no interest`],
                  ['Method', current.method.replace(/_/g, ' ')],
                  ['Approved by', current.approvedBy ? 'a debtors controller' : 'awaiting approval'],
                ]} />
              </Card>
              <Card title="Instalments">
                <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, current.schedule.length)}, 1fr)`, gap: 6 }}>
                  {current.schedule.map((s) => (
                    <div key={s.n} style={{ borderRadius: 2, padding: '6px 8px', fontSize: 11, background: 'var(--surface-3)', borderTop: `3px solid ${s.status === 'paid' ? 'var(--ok)' : s.status === 'missed' ? 'var(--crit)' : 'var(--ash-300)'}`, color: s.status === 'paid' ? 'var(--ok)' : s.status === 'missed' ? 'var(--crit)' : 'var(--text-2)' }}>
                      <b style={{ display: 'block', fontSize: 12 }}>{s.n} of {current.schedule.length}</b>
                      {s.dueDate}<br />{(s.amountCents / 100).toFixed(2)} · {s.status}
                    </div>
                  ))}
                </div>
                <p className="note" style={{ marginTop: 8 }}>The Hand reminds three days before each instalment and thanks the patient after payment. A missed instalment escalates to you at seven days late; it never restarts dunning.</p>
              </Card>
              {current.inArrears && <Banner kind="warn">This plan is in arrears. Offer to move the date once without penalty before any escalation.</Banner>}
            </>
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Payment plans"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
