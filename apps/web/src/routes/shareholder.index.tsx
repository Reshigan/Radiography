import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Tile, Money, Skeleton, EmptyState, Banner, Chip, DataTable, Sparkline, Button, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/shareholder/')({ component: Page });

interface Snapshot {
  period: string; status: string; lockedAt: string | null;
  revenueCents: number; shortPaymentsCents: number; readingFeesCents: number; managementFeeCents: number;
  rentCents: number; staffCents: number; consumablesCents: number; otherCents: number;
  ebitdaCents: number; taxProvisionCents: number; distributableCents: number;
  collectionsCents: number; studies: number;
  budget?: Record<string, number> | null;
}
interface Me {
  entity: { id: string; name: string; registeredName: string } | null;
  holding: { shareClass: string; shares: number; pct: number; effectiveFrom: string } | null;
  capTable: Array<{ shareholderName: string; shareClass: string; shares: number; pct: number; mine: boolean }>;
  period: string;
  pnl: Snapshot;
  history: Snapshot[];
  distribution: { id: string; period: string; distributableCents: number; status: string } | null;
  myEntitlementCents: number | null;
  statements: Array<{ id: string; period: string; netCents: number; status: string }>;
  openVotes: number;
  kpiSparklines: { revenue: number[]; ebitda: number[]; distributable: number[]; collections: number[]; studies: number[]; periods: string[] };
  documents: Array<{ name: string; detail: string; kind: string }>;
}

/** P&L lines in statement order. Costs are shown as the negatives they are. */
const LINES: Array<{ key: keyof Snapshot; label: string; cost?: boolean }> = [
  { key: 'revenueCents', label: 'Revenue' },
  { key: 'shortPaymentsCents', label: 'Short-payments and write-offs', cost: true },
  { key: 'readingFeesCents', label: 'Reading fees to the Hub', cost: true },
  { key: 'managementFeeCents', label: 'Management fee', cost: true },
  { key: 'rentCents', label: 'Rent (intercompany)', cost: true },
  { key: 'staffCents', label: 'Staff', cost: true },
  { key: 'consumablesCents', label: 'Consumables', cost: true },
  { key: 'otherCents', label: 'Other operating costs', cost: true },
  { key: 'ebitdaCents', label: 'EBITDA' },
  { key: 'taxProvisionCents', label: 'Tax provision and reserve', cost: true },
  { key: 'distributableCents', label: 'Distributable profit' },
];

function Page() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['shareholder-me'], queryFn: () => api.get<Me>('/finance/shareholder/me') });

  if (q.isLoading) return <div className="page"><PageHeader title="My practice" /><Skeleton rows={6} /></div>;
  if (q.error) return <div className="page"><PageHeader title="My practice" /><Banner kind="crit">{(q.error as Error).message}</Banner></div>;

  const d = q.data!;
  const p = d.pnl;
  const budget = p.budget ?? null;
  const spark = d.kpiSparklines;

  return (
    <div className="page">
      <PageHeader
        title={`${d.entity?.name ?? 'My practice'} · ${d.period}`}
        subtitle={`${d.entity?.registeredName ?? ''} · period ${p.status === 'locked' ? `locked ${p.lockedAt?.slice(0, 10)}` : 'soft close'} · the same numbers the site manager sees`}
        actions={
          <>
            {d.openVotes > 0 && (
              <Button variant="primary" onClick={() => void navigate({ to: '/shareholder/votes' })}>
                {d.openVotes} vote{d.openVotes === 1 ? '' : 's'} open
              </Button>
            )}
            <Button onClick={() => void navigate({ to: '/shareholder/distributions' })}>Distributions</Button>
            <Button onClick={() => void navigate({ to: '/shareholder/documents' })}>Documents</Button>
          </>
        }
      />

      {d.holding ? (
        <Card>
          <div className="row-flex" style={{ gap: 20, alignItems: 'baseline' }}>
            <span style={{ font: '600 32px/1 var(--display)', color: 'var(--heading)' }}>{d.holding.pct} %</span>
            <div>
              <div><b>{d.holding.shareClass}</b> · {d.holding.shares.toLocaleString('en-ZA')} shares · held since {d.holding.effectiveFrom}</div>
              <div className="note">Economic and voting rights per the shareholders' agreement. Entitlements are computed from the effective-dated cap table.</div>
            </div>
          </div>
          <div className="row-flex" style={{ marginTop: 10 }}>
            {d.capTable.map((h) => (
              <Chip key={h.shareholderName + h.shareClass} kind={h.mine ? 'done' : 'neutral'}>
                {h.shareholderName} · {h.pct} % {h.shareClass}
              </Chip>
            ))}
          </div>
        </Card>
      ) : (
        <Banner kind="info">Your user is not linked to a shareholding in this practice. The practice numbers below are still shown, but no entitlement can be computed.</Banner>
      )}

      <div className="grid g4">
        <Tile label="Revenue" value={<Money cents={p.revenueCents} />} delta={budget ? `budget ${((budget.revenueCents ?? 0) / 100).toLocaleString('en-ZA')}` : undefined} />
        <Tile label="EBITDA" value={<Money cents={p.ebitdaCents} />} delta={`margin ${p.revenueCents ? Math.round((p.ebitdaCents / p.revenueCents) * 1000) / 10 : 0} %`} />
        <Tile label="Distributable profit" value={<Money cents={p.distributableCents} />} delta="after tax provision and reserve" />
        <Tile
          label="My entitlement"
          value={d.myEntitlementCents === null ? <span className="muted">n/a</span> : <Money cents={d.myEntitlementCents} />}
          delta={d.holding ? `${d.holding.pct} % · before dividends tax` : 'no holding linked'}
        />
      </div>

      <div className="split">
        <Card title={`Profit and loss · ${d.period}`} extra={budget ? 'actual vs budget' : 'actual'}>
          <table className="dt">
            <thead>
              <tr><th>Line</th><th className="num">Actual</th>{budget && <th className="num">Budget</th>}{budget && <th className="num">Variance</th>}</tr>
            </thead>
            <tbody>
              {LINES.map((l) => {
                const raw = Number(p[l.key] ?? 0);
                const actual = l.cost ? -Math.abs(raw) : raw;
                const b = budget ? Number(budget[l.key as string] ?? 0) : null;
                const bud = b === null ? null : l.cost ? -Math.abs(b) : b;
                const variance = bud === null ? null : actual - bud;
                const emphasis = l.key === 'ebitdaCents' || l.key === 'distributableCents';
                return (
                  <tr key={String(l.key)}>
                    <td style={{ fontWeight: emphasis ? 600 : 400 }}>{l.label}</td>
                    <td className="num" style={{ fontWeight: emphasis ? 600 : 400 }}><Money cents={actual} /></td>
                    {budget && <td className="num"><Money cents={bud ?? 0} /></td>}
                    {budget && <td className="num"><Money cents={variance ?? 0} sign /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="note" style={{ marginTop: 8 }}>
            {p.studies.toLocaleString('en-ZA')} studies · collections <Money cents={p.collectionsCents} /> in the period.
          </div>
        </Card>

        <Card title="Twelve months" extra={`${spark.periods.length} periods`}>
          {spark.periods.length < 2 ? (
            <EmptyState>Not enough closed periods yet to draw a trend.</EmptyState>
          ) : (
            <div className="grid g2">
              <div className="tile"><span className="l">Revenue</span><Sparkline values={spark.revenue} /><span className="d">{spark.periods[0]} to {spark.periods[spark.periods.length - 1]}</span></div>
              <div className="tile"><span className="l">EBITDA</span><Sparkline values={spark.ebitda} /><span className="d">margin trend</span></div>
              <div className="tile"><span className="l">Distributable</span><Sparkline values={spark.distributable} /><span className="d">after tax and reserve</span></div>
              <div className="tile"><span className="l">Studies</span><Sparkline values={spark.studies} tone="info" /><span className="d">volume</span></div>
            </div>
          )}
        </Card>
      </div>

      <div className="split">
        <Card title="My statements" extra={d.statements.length ? `${d.statements.length} periods` : undefined}>
          <DataTable
            rows={d.statements}
            rowKey={(s) => s.id}
            empty="No distribution statements yet. They appear once a distribution is released."
            columns={[
              { key: 'period', header: 'Period', render: (s) => s.period },
              { key: 'net', header: 'Net', num: true, render: (s) => <Money cents={s.netCents} /> },
              { key: 'status', header: 'Status', render: (s) => <StatusChip status={s.status} /> },
            ]}
          />
          {d.distribution && (
            <div className="note" style={{ marginTop: 8 }}>
              Next distribution for {d.distribution.period}: <Money cents={d.distribution.distributableCents} /> distributable, status {d.distribution.status}.
            </div>
          )}
        </Card>

        <Card title="Documents" extra="download only">
          {d.documents.map((doc) => (
            <div key={doc.name} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{doc.name}</div>
                <div className="note">{doc.detail}</div>
              </div>
              <span className="mono small">{doc.kind}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
