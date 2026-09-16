import { createFileRoute } from '@tanstack/react-router';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, Sheet, KV, Timeline, Check } from '@bonakala/bdl';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/shareholder/distributions')({ component: Page });

interface Entitlement { shareholderName: string; shareClass: string; pct: number; grossCents: number; dividendsTaxCents: number; netCents: number; segments: Array<{ from: string; to: string; days: number; pct: number; grossCents: number }> }
interface Distribution {
  id: string; period: string; distributableCents: number; status: string; resolutionRef: string | null; requiredApprovals: number;
  bridge: Array<{ key: string; label: string; amountCents: number }>;
  solvencyTest: { passed: boolean; solvency: boolean; liquidity: boolean; cashAfterCents: number; notes: string[] } | null;
  waterfall: { entitlements: Entitlement[]; segments: Array<{ from: string; to: string; days: number }>; dividendsTaxRate: number; totalGrossCents: number; totalNetCents: number };
  approvals: Array<{ persona: string; name: string; at: string }>; releasedAt: string | null; paidAt: string | null; bankRef: string | null; paymentFileHash: string | null;
}
interface Statement { id: string; period: string; shareholderName: string; pct: number; grossCents: number; dividendsTaxCents: number; netCents: number; status: string; bankRef: string | null }

function Page() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const data = useQuery({ queryKey: ['distributions'], queryFn: () => api.get<{ distributions: Distribution[]; statements: Statement[] }>('/finance/distributions') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['distributions'] }); void qc.invalidateQueries({ queryKey: ['shareholder-me'] }); };
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/finance/distributions/${id}/approve`, { confirm: 'Confirm' }), onSuccess: (r: any) => { setToast(`Approved. ${r.approvals} of ${r.required} approvals in; status ${r.status}.`); setConfirmed(false); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const release = useMutation({ mutationFn: (id: string) => api.post(`/finance/distributions/${id}/release`, { confirm: 'Confirm' }), onSuccess: (r: any) => { setToast(`Payment file released and hashed (${String(r.hash).slice(0, 12)}…). Total ${(r.totalCents / 100).toFixed(2)}.`); refresh(); }, onError: (e: Error) => setToast(e.message) });

  const rows = data.data?.distributions ?? [];
  const statements = data.data?.statements ?? [];
  const current = rows.find((x) => x.id === selected) ?? rows[0] ?? null;
  const persona = me?.user?.persona;
  const alreadyApproved = current?.approvals.some((a) => a.name === me?.user?.name);

  return (
    <div className="page">
      <PageHeader title="Distributions" subtitle="Computed from the cap table, effective-dated, with the full audit trail" />
      {data.isError && <Banner kind="crit">Distributions could not be loaded.</Banner>}

      <div className="grid g4">
        <Tile label="Runs" value={rows.length} delta={`${rows.filter((x) => x.status === 'paid').length} paid`} />
        <Tile label="Awaiting approval" value={rows.filter((x) => x.status === 'proposed').length} tone={rows.some((x) => x.status === 'proposed') ? 'down' : undefined} />
        <Tile label="Distributed to date" value={<Money cents={rows.filter((x) => x.status === 'paid').reduce((a, x) => a + x.distributableCents, 0)} />} />
        <Tile label="My net received" value={<Money cents={statements.filter((s) => s.status === 'paid').reduce((a, s) => a + s.netCents, 0)} />} delta="after dividends tax" />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <Card title="Distribution history" extra="bank references come from statement matching">
          {data.isLoading ? <Skeleton rows={5} /> : rows.length === 0 ? <EmptyState>No distributions have been proposed.</EmptyState> : (
            <DataTable
              rows={rows}
              rowKey={(x) => x.id}
              selectedKey={current?.id}
              onRowClick={(x) => { setSelected(x.id); setConfirmed(false); }}
              columns={[
                { key: 'p', header: 'Period', render: (x) => x.period },
                { key: 'd', header: 'Distributable', num: true, render: (x) => <Money cents={x.distributableCents} /> },
                { key: 'mine', header: 'My share', num: true, render: (x) => { const e = x.waterfall.entitlements.find((y) => y.shareholderName === me?.user?.name); return e ? <Money cents={e.grossCents} /> : <span className="muted">—</span>; } },
                { key: 'net', header: 'Net paid', num: true, render: (x) => { const s = statements.find((y) => y.period === x.period && y.status === 'paid'); return s ? <Money cents={s.netCents} /> : <span className="muted">—</span>; } },
                { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                { key: 'bank', header: 'Bank reference', render: (x) => <span className="mono small">{x.bankRef ?? '—'}</span> },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!current ? <Card title="Detail"><EmptyState>Select a distribution.</EmptyState></Card> : (
            <>
              <div className="spread"><h3>{current.period}</h3><StatusChip status={current.status} /></div>

              <Card title="Distributable-profit bridge" extra={current.resolutionRef ?? undefined}>
                <div className="collect" style={{ fontSize: 13 }}>
                  {current.bridge.map((b) => (
                    <Fragment key={b.key}>
                      <span className={b.key === 'distributable' ? 'lbl tot' : 'lbl'}>{b.label}</span>
                      <span className={b.key === 'distributable' ? 'tot' : undefined}><Money cents={b.amountCents} /></span>
                    </Fragment>
                  ))}
                </div>
              </Card>

              {current.solvencyTest && (
                <Card title="Solvency and liquidity test" extra="Companies Act section 46">
                  <div className="row-flex">
                    <Chip kind={current.solvencyTest.solvency ? 'done' : 'crit'}>solvency {current.solvencyTest.solvency ? 'passed' : 'failed'}</Chip>
                    <Chip kind={current.solvencyTest.liquidity ? 'done' : 'crit'}>liquidity {current.solvencyTest.liquidity ? 'passed' : 'failed'}</Chip>
                  </div>
                  <KV items={[['Cash after the distribution', <Money key="c" cents={current.solvencyTest.cashAfterCents} />]]} />
                  {current.solvencyTest.notes.map((n, i) => <Banner key={i} kind="warn">{n}</Banner>)}
                  <p className="note">No distribution proceeds without a passed test and a board resolution.</p>
                </Card>
              )}

              <Card title="Waterfall" extra={`${current.waterfall.segments.length} cap-table segment(s) · dividends tax ${Math.round(current.waterfall.dividendsTaxRate * 100)} %`}>
                <DataTable
                  rows={current.waterfall.entitlements}
                  rowKey={(x) => x.shareholderName}
                  columns={[
                    { key: 'n', header: 'Shareholder', render: (x) => <div style={{ lineHeight: 1.25, whiteSpace: 'normal' }}>{x.shareholderName}<span className="small muted" style={{ display: 'block' }}>{x.shareClass}</span></div> },
                    { key: 'p', header: '%', num: true, render: (x) => <span className="mono">{x.pct}</span> },
                    { key: 'g', header: 'Gross', num: true, render: (x) => <Money cents={x.grossCents} /> },
                    { key: 't', header: 'Tax', num: true, render: (x) => <Money cents={x.dividendsTaxCents} /> },
                    { key: 'net', header: 'Net', num: true, render: (x) => <Money cents={x.netCents} /> },
                  ]}
                />
                {current.waterfall.segments.length > 1 && <p className="note" style={{ marginTop: 6 }}>The cap table changed during the period; entitlements are pro-rated by days across {current.waterfall.segments.map((s) => `${s.from} to ${s.to} (${s.days} days)`).join(' and ')}.</p>}
                {current.waterfall.segments.length === 1 && <p className="note" style={{ marginTop: 6 }}>Where the agreement is silent the remainder is pro-rata by economic percentage from the cap table.</p>}
              </Card>

              <Card title="Approvals" extra={`${current.approvals.length} of ${current.requiredApprovals}`}>
                {current.approvals.length === 0 ? <EmptyState>No approvals recorded yet.</EmptyState> : (
                  <Timeline items={current.approvals.map((a) => ({ time: new Date(a.at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }), text: `${a.name} (${a.persona}) approved`, kind: 'ok' as const }))} />
                )}
                {current.status === 'proposed' && !alreadyApproved && (
                  <>
                    <Check checked={confirmed} onChange={setConfirmed} label="I approve this distribution proposal" />
                    <div className="row-flex" style={{ marginTop: 8 }}>
                      <Button variant="primary" disabled={!confirmed || approve.isPending} onClick={() => approve.mutate(current.id)}>{approve.isPending ? 'Recording…' : 'Approve'}</Button>
                    </div>
                  </>
                )}
                {alreadyApproved && <Chip kind="done">You have approved this run</Chip>}
                {current.status === 'approved' && persona === 'EXE' && (
                  <div className="row-flex" style={{ marginTop: 8 }}>
                    <Button variant="primary" disabled={release.isPending} onClick={() => release.mutate(current.id)}>{release.isPending ? 'Releasing…' : 'Release the payment file'}</Button>
                  </div>
                )}
                {current.paymentFileHash && <p className="note" style={{ marginTop: 6 }}>Payment file hash <span className="mono">{current.paymentFileHash.slice(0, 16)}…</span> verified at release. A second, independent approver releases the file.</p>}
                {current.paidAt && <p className="note">Paid {new Date(current.paidAt).toLocaleDateString('en-ZA')} · bank reference <span className="mono">{current.bankRef}</span>.</p>}
              </Card>
            </>
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Distributions"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
