import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, Tabs, KV, Sparkline, Sheet, Bars } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/practice/money')({ component: Page });

function Page() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState('pnl');
  const [toast, setToast] = useState<string | null>(null);

  const pnl = useQuery({ queryKey: ['pnl'], queryFn: () => api.get<any>('/finance/pnl?months=6') });
  const billing = useQuery({ queryKey: ['billing-tiles'], queryFn: () => api.get<any>('/billing/tiles') });
  const debtors = useQuery({ queryKey: ['debtors-tiles'], queryFn: () => api.get<any>('/billing/debtors/tiles') });
  const budgets = useQuery({ queryKey: ['budgets'], queryFn: () => api.get<any>('/finance/budgets') });
  const periods = useQuery({ queryKey: ['fiscal-periods'], queryFn: () => api.get<any>('/finance/periods') });

  const close = useMutation({ mutationFn: () => api.post('/finance/close/run', {}), onSuccess: (r: any) => { const o = r.task?.output ?? {}; setToast(`Close Hand ran ${o.period ?? ''}. Steps done: ${(o.steps ?? []).filter((s: any) => s.status === 'done').length}. Approval and release stay with a human.`); void qc.invalidateQueries({ queryKey: ['fiscal-periods'] }); void qc.invalidateQueries({ queryKey: ['pnl'] }); }, onError: (e: Error) => setToast(e.message) });

  const p = pnl.data?.pnl;
  const history: any[] = pnl.data?.history ?? [];
  const bt = billing.data?.tiles;
  const dt = debtors.data?.tiles;
  const latestPeriod = periods.data?.periods?.[0];

  return (
    <div className="page">
      <PageHeader
        title="Practice money"
        subtitle={p ? `${p.period} · ${p.status === 'locked' ? 'locked' : 'soft close'} · revenue, collections and the close` : 'Loading the practice ledger'}
        actions={<>
          <Button onClick={() => void navigate({ to: '/billing/month-end' })}>Month-end register</Button>
          <Button variant="primary" disabled={close.isPending} onClick={() => close.mutate()}>{close.isPending ? 'Running…' : 'Run the close'}</Button>
        </>}
      />
      {pnl.isError && <Banner kind="crit">The practice P&amp;L could not be loaded.</Banner>}

      {pnl.isLoading ? <Skeleton rows={3} /> : p && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          <Tile label="Revenue" value={<Money cents={p.revenueCents} />} tone={p.budgetRevenueCents && p.revenueCents >= p.budgetRevenueCents ? 'up' : 'down'} delta={p.budgetRevenueCents ? <>budget <Money cents={p.budgetRevenueCents} /></> : undefined} />
          <Tile label="EBITDA" value={<Money cents={p.ebitdaCents} />} delta={`margin ${p.kpis?.ebitdaMarginPct ?? 0} %`} />
          <Tile label="Collections" value={<Money cents={p.collectionsCents} />} delta={p.revenueCents ? `${Math.round((p.collectionsCents / p.revenueCents) * 100)} % of revenue` : undefined} />
          <Tile label="Unbilled" value={<Money cents={p.unbilledCents} />} delta={bt ? `${bt.unbilled.count} items · oldest ${bt.unbilled.oldestDays} days` : undefined} tone={p.unbilledCents > p.revenueCents * 0.05 ? 'down' : 'up'} />
          <Tile label="Debtors" value={<Money cents={(dt?.openPatientCents ?? 0)} />} delta={dt ? `DSO ${dt.dsoDays} days` : undefined} />
          <Tile label="Distributable" value={<Money cents={p.distributableCents} />} delta="after tax provision and reserve" />
        </div>
      )}

      <Tabs tabs={[{ id: 'pnl', label: 'Profit and loss' }, { id: 'revenue', label: 'Revenue cycle' }, { id: 'budget', label: 'Budget versus actual' }, { id: 'close', label: 'Close' }]} active={tab} onChange={setTab} />

      {tab === 'pnl' && (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
          <Card title={`Profit and loss · ${p?.period ?? ''}`} extra="computed from posted events, not typed in">
            {!p ? <Skeleton rows={8} /> : (
              <table className="dt">
                <thead><tr><th>Line</th><th className="num">Actual</th><th className="num">Budget</th><th className="num">Variance</th></tr></thead>
                <tbody>
                  {p.lines.map((l: any) => (
                    <tr key={l.key} style={['ebitda', 'distributable'].includes(l.key) ? { background: 'var(--surface-3)', fontWeight: 600 } : undefined}>
                      <td style={{ whiteSpace: 'normal' }}>{l.label}{l.basis && <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>{l.basis}</span>}</td>
                      <td className={`num ${l.amountCents < 0 ? 'neg' : ''}`}><Money cents={l.amountCents} /></td>
                      <td className="num">{l.budgetCents === undefined ? <span className="muted">—</span> : <Money cents={l.budgetCents} />}</td>
                      <td className={`num ${(l.varianceCents ?? 0) < 0 ? 'neg' : ''}`}>{l.varianceCents === undefined ? <span className="muted">—</span> : <Money cents={l.varianceCents} sign />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Six months" extra="soft numbers are visible every day">
            {history.length === 0 ? <EmptyState>No history yet.</EmptyState> : (
              <div className="grid g2">
                <SparkTile label="Revenue" values={history.map((h) => h.revenueCents)} last={p?.revenueCents ?? 0} />
                <SparkTile label="EBITDA" values={history.map((h) => h.ebitdaCents)} last={p?.ebitdaCents ?? 0} />
                <SparkTile label="Collections" values={history.map((h) => h.collectionsCents)} last={p?.collectionsCents ?? 0} />
                <SparkTile label="Distributable" values={history.map((h) => h.distributableCents)} last={p?.distributableCents ?? 0} />
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'revenue' && (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <Card title="Claims" extra="the bureau works exceptions, not every study">
            {!bt ? <Skeleton rows={4} /> : (
              <>
                <KV items={[
                  ['Unbilled', <span key="u">{bt.unbilled.count} · <Money cents={bt.unbilled.valueCents} /></span>],
                  ['Ready to submit', <span key="r">{bt.ready.count} · <Money cents={bt.ready.valueCents} /></span>],
                  ['In flight', <span key="f">{bt.inFlight.count} · <Money cents={bt.inFlight.valueCents} /></span>],
                  ['Rejected', <span key="j">{bt.rejected.count} · <Money cents={bt.rejected.valueCents} /></span>],
                  ['First-pass acceptance', `${bt.firstPass.pct7d} % over seven days`],
                ]} />
                <div className="row-flex" style={{ marginTop: 8 }}>
                  <Button size="sm" onClick={() => void navigate({ to: '/billing' })}>Open the billing console</Button>
                </div>
              </>
            )}
          </Card>
          <Card title="Debtors" extra="ageing and provision">
            {!dt ? <Skeleton rows={4} /> : (
              <>
                <Bars data={Object.entries(debtors.data.ageing as Record<string, { total: number }>).filter(([, v]) => v.total > 0).map(([k, v]) => ({ label: k, value: Math.round(v.total / 100), tone: k === 'patient' ? 'warn' : 'info' }))} format={(v) => `R ${v.toLocaleString('en-ZA')}`} />
                <KV items={[
                  ['DSO', `${dt.dsoDays} days`],
                  ['Write-offs this month', <Money key="w" cents={dt.writeOffsMtdCents} />],
                  ['Bad-debt provision', <Money key="p" cents={dt.provisionCents} />],
                  ['Disputes open', String(dt.disputesOpen)],
                ]} />
                <div className="row-flex" style={{ marginTop: 8 }}>
                  <Button size="sm" onClick={() => void navigate({ to: '/debtors' })}>Open the debtors console</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {tab === 'budget' && (
        <Card title="Budget versus actual" extra="same chart and dimensions">
          {budgets.isLoading ? <Skeleton rows={6} /> : !(budgets.data?.vsActual?.length) ? <EmptyState>No approved budget for this practice.</EmptyState> : (
            <>
              <DataTable
                rows={budgets.data.vsActual}
                rowKey={(x: any) => x.period}
                columns={[
                  { key: 'p', header: 'Period', render: (x: any) => x.period },
                  { key: 'br', header: 'Budget revenue', num: true, render: (x: any) => <Money cents={x.budgetRevenueCents} /> },
                  { key: 'ar', header: 'Actual revenue', num: true, render: (x: any) => x.actualRevenueCents === null ? <span className="muted">—</span> : <Money cents={x.actualRevenueCents} /> },
                  { key: 'vr', header: 'Variance', num: true, render: (x: any) => x.actualRevenueCents === null ? <span className="muted">—</span> : <span className={x.actualRevenueCents < x.budgetRevenueCents ? 'neg' : ''}><Money cents={x.actualRevenueCents - x.budgetRevenueCents} sign /></span> },
                  { key: 'be', header: 'Budget EBITDA', num: true, render: (x: any) => <Money cents={x.budgetEbitdaCents} /> },
                  { key: 'ae', header: 'Actual EBITDA', num: true, render: (x: any) => x.actualEbitdaCents === null ? <span className="muted">—</span> : <Money cents={x.actualEbitdaCents} /> },
                ]}
              />
              {budgets.data.budgets?.[0]?.assumptions && (
                <p className="note" style={{ marginTop: 8 }}>
                  Assumptions: {Object.entries(budgets.data.budgets[0].assumptions).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()} ${v}`).join(' · ')}.
                </p>
              )}
            </>
          )}
        </Card>
      )}

      {tab === 'close' && (
        <Card title="Month-end close" extra={latestPeriod ? `${latestPeriod.period} · ${latestPeriod.status.replace(/_/g, ' ')}` : undefined}>
          {periods.isLoading ? <Skeleton rows={6} /> : !latestPeriod?.closeSteps ? <EmptyState action={<Button size="sm" variant="primary" onClick={() => close.mutate()}>Run the close</Button>}>The Close Hand has not run for this period.</EmptyState> : (
            <>
              <DataTable
                rows={latestPeriod.closeSteps}
                rowKey={(x: any) => x.id}
                columns={[
                  { key: 'd', header: 'Day', num: true, render: (x: any) => `D+${x.day}` },
                  { key: 'l', header: 'Step', render: (x: any) => <span style={{ whiteSpace: 'normal' }}>{x.label}</span> },
                  { key: 'lv', header: 'Level', render: (x: any) => <Chip kind={x.level === 'A0' ? 'att' : 'neutral'}>{x.level}</Chip> },
                  { key: 'o', header: 'Owner', render: (x: any) => x.owner },
                  { key: 's', header: 'Status', render: (x: any) => <StatusChip status={x.status} /> },
                ]}
              />
              <p className="note" style={{ marginTop: 8 }}>The Close Hand gathers, computes, reconciles and proposes. It may not post manual journals, approve anything, release payments or change a rule.</p>
              <DataTable
                rows={(periods.data.periods ?? []).slice(0, 6)}
                rowKey={(x: any) => x.period}
                columns={[
                  { key: 'p', header: 'Period', render: (x: any) => x.period },
                  { key: 's', header: 'Status', render: (x: any) => <Chip kind={x.status === 'locked' ? 'done' : 'att'}>{x.status.replace(/_/g, ' ')}</Chip> },
                  { key: 'r', header: 'Lock reference', render: (x: any) => <span className="mono small">{x.lockRef ?? '—'}</span> },
                ]}
              />
            </>
          )}
        </Card>
      )}

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Practice money"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}

function SparkTile({ label, values, last }: { label: string; values: number[]; last: number }) {
  return (
    <div className="tile">
      <span className="l">{label}</span>
      <span className="v" style={{ fontSize: 18 }}><Money cents={last} /></span>
      {values.length > 1 && <Sparkline values={values} tone={values[values.length - 1]! >= values[0]! ? 'ok' : 'crit'} />}
    </div>
  );
}
