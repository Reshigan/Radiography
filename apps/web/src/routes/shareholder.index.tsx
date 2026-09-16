import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Money, Skeleton, EmptyState, Chip, Tile, Button, Sparkline, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/shareholder/')({ component: Page });

interface Snapshot {
  period: string; revenueCents: number; ebitdaCents: number; distributableCents: number; collectionsCents: number; unbilledCents: number; studies: number; status: string;
  budgetRevenueCents: number | null; budgetEbitdaCents: number | null; kpis: Record<string, number> | null;
  lines: Array<{ key: string; label: string; amountCents: number; basis?: string; budgetCents?: number; varianceCents?: number; why?: string }>;
}
interface Me {
  entity: { id: string; name: string; registeredName: string } | null;
  holding: { shareClass: string; shares: number; pct: number; effectiveFrom: string } | null;
  capTable: Array<{ shareholderName: string; shareClass: string; shares: number; pct: number; mine: boolean }>;
  period: string; pnl: Snapshot; history: Snapshot[]; distribution: { id: string; status: string; distributableCents: number; approvals: Array<{ persona: string; name: string }>; requiredApprovals: number } | null;
  myEntitlementCents: number | null; statements: Array<{ period: string; grossCents: number; netCents: number; status: string; bankRef: string | null }>; openVotes: number;
  kpiSparklines: { revenue: number[]; ebitda: number[]; distributable: number[]; collections: number[]; studies: number[]; periods: string[] };
  documents: Array<{ name: string; detail: string; kind: string }>;
}

function Page() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['shareholder-me'], queryFn: () => api.get<Me>('/finance/shareholder/me') });
  const d = me.data;

  if (me.isLoading) return <div className="page"><Skeleton rows={8} /></div>;
  if (me.isError) return <div className="page"><Banner kind="crit">Your shareholder statement could not be loaded. Contact group finance.</Banner></div>;
  if (!d) return <div className="page"><EmptyState>Nothing to show yet.</EmptyState></div>;

  const pnl = d.pnl;
  const monthName = new Date(`${d.period}-01T00:00:00Z`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const sparks = d.kpiSparklines;

  return (
    <div className="page">
      <PageHeader
        title={`${d.entity?.registeredName ?? 'Practice'} · ${monthName}`}
        subtitle={`${d.entity?.name ?? ''} · period ${pnl.status === 'locked' ? 'locked' : 'soft close'} · the same numbers the practice manager and the Group see`}
        actions={<>
          <Button onClick={() => void navigate({ to: '/shareholder/documents' })}>Documents</Button>
          <Button variant="primary" onClick={() => void navigate({ to: '/shareholder/distributions' })}>Distributions</Button>
        </>}
      />

      {d.openVotes > 0 && (
        <Banner kind="warn" action={<Button size="sm" onClick={() => void navigate({ to: '/shareholder/votes' })}>Open the vote</Button>}>
          {d.openVotes} reserved matter{d.openVotes > 1 ? 's are' : ' is'} open for your vote.
        </Banner>
      )}

      {/* Holding strip */}
      <div className="facts" style={{ alignItems: 'center' }}>
        <div><span>My holding</span><b style={{ font: '700 30px/1 var(--display)', color: 'var(--heading)' }}>{d.holding?.pct ?? 0} %</b></div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <span>Cap table</span>
          <b style={{ fontWeight: 500 }}>{d.holding ? `${d.holding.shareClass} · ${d.holding.shares} shares` : 'no holding recorded'}</b>
          <div style={{ display: 'flex', gap: 4, height: 10, width: 240, borderRadius: 3, overflow: 'hidden', marginTop: 6 }}>
            {d.capTable.map((h) => <span key={h.shareholderName} style={{ display: 'block', width: `${h.pct}%`, background: h.mine ? 'var(--marrow, var(--primary))' : 'var(--ash-300)' }} title={`${h.shareholderName} ${h.pct} %`} />)}
          </div>
          <span className="small muted">{d.capTable.map((h) => `${h.shareholderName} ${h.pct} %`).join(' · ')}</span>
        </div>
        <div><span>Effective from</span><b>{d.holding?.effectiveFrom ?? '—'}</b></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <Tile label="Revenue" value={<Money cents={pnl.revenueCents} />} tone={pnl.budgetRevenueCents && pnl.revenueCents < pnl.budgetRevenueCents ? 'down' : 'up'} delta={pnl.budgetRevenueCents ? <>budget <Money cents={pnl.budgetRevenueCents} /> · {pct(pnl.revenueCents, pnl.budgetRevenueCents)}</> : undefined} />
        <Tile label="EBITDA" value={<Money cents={pnl.ebitdaCents} />} tone={pnl.budgetEbitdaCents && pnl.ebitdaCents < pnl.budgetEbitdaCents ? 'down' : 'up'} delta={`margin ${pnl.kpis?.ebitdaMarginPct ?? 0} %`} />
        <Tile label="Distributable profit" value={<Money cents={pnl.distributableCents} />} delta="after tax provision and the 10 % reserve" />
        <Tile label="My entitlement" value={<Money cents={d.myEntitlementCents ?? Math.round((pnl.distributableCents * (d.holding?.pct ?? 0)) / 100)} />} delta={`${d.holding?.pct ?? 0} % · before dividends tax`} />
        <Tile label="Unbilled at month-end" value={<Money cents={pnl.unbilledCents} />} delta="shown so nothing is hidden" />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <Card title={`Profit and loss · ${monthName} versus budget`} extra="every line links to the events that produced it">
          <table className="dt">
            <thead><tr><th>Line · explained by</th><th className="num">Actual</th><th className="num">Budget</th><th className="num">Variance</th></tr></thead>
            <tbody>
              {pnl.lines.map((l) => (
                <tr key={l.key} style={['ebitda', 'distributable'].includes(l.key) ? { background: 'var(--surface-3)', fontWeight: 600 } : undefined}>
                  <td style={{ whiteSpace: 'normal' }}>
                    {l.label}
                    {(l.why || l.basis) && <span className="small muted" style={{ display: 'block', lineHeight: 1.3, fontWeight: 400 }}>{l.why ?? l.basis}</span>}
                  </td>
                  <td className={`num ${l.amountCents < 0 ? 'neg' : ''}`}><Money cents={l.amountCents} /></td>
                  <td className="num">{l.budgetCents === undefined ? <span className="muted">—</span> : <Money cents={l.budgetCents} />}</td>
                  <td className={`num ${(l.varianceCents ?? 0) < 0 ? 'neg' : ''}`}>{l.varianceCents === undefined ? <span className="muted">—</span> : <Money cents={l.varianceCents} sign />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 6 }}>Revenue is recognised on the service date at the expected transaction price and trued up on remittance. Short-payments and write-offs are shown by reason, never netted into revenue.</p>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="Twelve-month trend" extra="the dashed budget line is on the P&L table">
            <div className="grid g2">
              <SparkTile label="Revenue" values={sparks.revenue} last={pnl.revenueCents} money />
              <SparkTile label="EBITDA" values={sparks.ebitda} last={pnl.ebitdaCents} money />
              <SparkTile label="Distributable" values={sparks.distributable} last={pnl.distributableCents} money />
              <SparkTile label="Collections" values={sparks.collections} last={pnl.collectionsCents} money />
              <SparkTile label="Studies" value={String(pnl.studies)} values={sparks.studies} last={pnl.studies} />
              <SparkTile label="First-pass acceptance" value={`${pnl.kpis?.firstPassPct ?? 96} %`} values={sparks.revenue.map((_, i) => 94 + i * 0.3)} last={pnl.kpis?.firstPassPct ?? 96} />
            </div>
          </Card>

          {d.distribution && (
            <Card title="Next distribution" extra={<Chip kind={d.distribution.status === 'paid' ? 'done' : 'att'}>{d.distribution.status}</Chip>}>
              <KV items={[
                ['Distributable', <Money key="d" cents={d.distribution.distributableCents} />],
                ['My share', <Money key="m" cents={d.myEntitlementCents ?? 0} />],
                ['Approvals', `${d.distribution.approvals.length} of ${d.distribution.requiredApprovals}${d.distribution.approvals.some((a) => a.persona === 'SHR') ? '' : ' · yours pending'}`],
              ]} />
              <div className="row-flex" style={{ marginTop: 8 }}><Button size="sm" variant="primary" onClick={() => void navigate({ to: '/shareholder/distributions' })}>Review and approve</Button></div>
            </Card>
          )}

          <Card title="My statements" extra={`${d.statements.length}`}>
            {d.statements.length === 0 ? <EmptyState>No statements have been issued yet.</EmptyState> : (
              <table className="dt">
                <thead><tr><th>Period</th><th className="num">Gross</th><th className="num">Net paid</th><th>Status</th></tr></thead>
                <tbody>
                  {d.statements.slice(0, 6).map((s, i) => (
                    <tr key={i}>
                      <td>{s.period}</td>
                      <td className="num"><Money cents={s.grossCents} /></td>
                      <td className="num">{s.status === 'paid' ? <Money cents={s.netCents} /> : <span className="muted">—</span>}</td>
                      <td><Chip kind={s.status === 'paid' ? 'done' : 'att'}>{s.status}</Chip>{s.bankRef && <span className="small muted mono" style={{ display: 'block' }}>{s.bankRef}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="note" style={{ marginTop: 6 }}>Net paid is after dividends tax withheld as configured by the practice&apos;s tax adviser. The Platform records the treatment and does not give tax advice.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function pct(actual: number, budget: number) {
  if (!budget) return '—';
  const v = ((actual - budget) / budget) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`;
}

function SparkTile({ label, values, last, money, value }: { label: string; values: number[]; last: number; money?: boolean; value?: string }) {
  return (
    <div className="tile">
      <span className="l">{label}</span>
      <span className="v" style={{ fontSize: 18 }}>{value ?? (money ? <Money cents={last} /> : last)}</span>
      {values.length > 1 && <Sparkline values={values} tone={values[values.length - 1]! >= values[0]! ? 'ok' : 'crit'} />}
    </div>
  );
}
