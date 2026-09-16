import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, Tabs, KV, Bars, Sheet, Sparkline } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/group/money')({ component: Page });

interface Consolidation {
  period: string;
  consolidation: {
    revenueCents: number; ebitdaCents: number; profitAfterTaxCents: number; eliminationsCents: number; minorityInterestCents: number; attributableToGroupCents: number;
    entities: Array<{ entityId: string; name: string; ownershipPct: number; revenueCents: number; ebitdaCents: number; profitAfterTaxCents: number; minorityInterestCents: number }>;
    eliminations: Array<{ pair: string; amountCents: number }>;
  };
  invoices: Array<{ id: string; number: string; practiceId: string; fromEntityId: string; toEntityId: string; period: string; ruleType: string; basis: string; amountExclCents: number; vatCents: number; totalCents: number; status: string }>;
  unmatchedPairs: number;
}

function Page() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('consolidation');
  const [toast, setToast] = useState<string | null>(null);

  const con = useQuery({ queryKey: ['consolidation'], queryFn: () => api.get<Consolidation>('/finance/consolidation') });
  const board = useQuery({ queryKey: ['board-pack'], queryFn: () => api.get<any>('/finance/board-pack') });
  const ic = useQuery({ queryKey: ['intercompany'], queryFn: () => api.get<{ invoices: Array<{ id: string; number: string; fromName: string; toName: string; period: string; ruleType: string; basis: string; amountExclCents: number; vatCents: number; totalCents: number; status: string }> }>('/finance/intercompany') });
  const cash = useQuery({ queryKey: ['cash-forecast'], queryFn: () => api.get<{ weeks: Array<{ week: number; inflowCents: number; outflowCents: number; netCents: number; closingCents: number }>; openingCents: number; schemeInFlightCents: number; patientOpenCents: number; floorCents: number }>('/finance/cash-forecast').catch(() => null) });

  const closeRun = useMutation({ mutationFn: () => api.post('/finance/close/run', {}), onSuccess: (r: any) => { const o = r.task?.output ?? {}; setToast(`Close Hand ran ${o.period ?? ''}: ${o.invoices ?? 0} intercompany invoices, distribution proposed. It never releases a payment.`); void qc.invalidateQueries({ queryKey: ['consolidation'] }); void qc.invalidateQueries({ queryKey: ['intercompany'] }); }, onError: (e: Error) => setToast(e.message) });

  const c = con.data?.consolidation;
  const b = board.data;

  return (
    <div className="page">
      <PageHeader
        title="Group money"
        subtitle={con.data ? `Consolidation for ${con.data.period} · eliminations from the intercompany invoice pairs` : 'Loading the consolidation'}
        actions={<Button variant="primary" disabled={closeRun.isPending} onClick={() => closeRun.mutate()}>{closeRun.isPending ? 'Running…' : 'Run the Close Hand'}</Button>}
      />
      {con.isError && <Banner kind="crit">The consolidation could not be loaded.</Banner>}
      {(con.data?.unmatchedPairs ?? 0) > 0 && <Banner kind="warn">{con.data!.unmatchedPairs} intercompany pair(s) are disputed. Consolidation uses the computed amount and flags it; it never plugs the difference.</Banner>}

      {con.isLoading ? <Skeleton rows={3} /> : c && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          <Tile label="Group revenue" value={<Money cents={c.revenueCents} />} delta={`${c.entities.length} practices consolidated`} />
          <Tile label="Group EBITDA" value={<Money cents={c.ebitdaCents} />} delta={c.revenueCents ? `${Math.round((c.ebitdaCents / c.revenueCents) * 1000) / 10} % margin` : undefined} />
          <Tile label="Eliminations" value={<Money cents={c.eliminationsCents} />} delta="intercompany revenue and costs" />
          <Tile label="Minority interest" value={<Money cents={c.minorityInterestCents} />} delta="JV partners' share of profit after tax" />
          <Tile label="Attributable to the Group" value={<Money cents={c.attributableToGroupCents} />} delta="after minority interest" />
        </div>
      )}

      <Tabs tabs={[{ id: 'consolidation', label: 'Consolidation' }, { id: 'intercompany', label: 'Intercompany' }, { id: 'cash', label: 'Cash forecast' }, { id: 'board', label: 'Board pack' }]} active={tab} onChange={setTab} />

      {tab === 'consolidation' && (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
          <Card title="By entity" extra="full consolidation; affiliates are excluded from scope">
            {!c ? <Skeleton rows={4} /> : (
              <DataTable
                rows={c.entities}
                rowKey={(x) => x.entityId}
                columns={[
                  { key: 'n', header: 'Practice', render: (x) => x.name },
                  { key: 'own', header: 'Group %', num: true, render: (x) => <span className="mono">{x.ownershipPct}</span> },
                  { key: 'rev', header: 'Revenue', num: true, render: (x) => <Money cents={x.revenueCents} /> },
                  { key: 'eb', header: 'EBITDA', num: true, render: (x) => <Money cents={x.ebitdaCents} /> },
                  { key: 'pat', header: 'Profit after tax', num: true, render: (x) => <Money cents={x.profitAfterTaxCents} /> },
                  { key: 'mi', header: 'Minority interest', num: true, render: (x) => x.minorityInterestCents ? <Money cents={x.minorityInterestCents} /> : <span className="muted">—</span> },
                ]}
              />
            )}
            <p className="note" style={{ marginTop: 6 }}>Ownership percentages come from the cap table on the period-end date, so any historical period recomputes exactly.</p>
          </Card>
          <Card title="Eliminations" extra={`${c?.eliminations.length ?? 0} pairs`}>
            {!c || c.eliminations.length === 0 ? <EmptyState>No intercompany pairs in this period.</EmptyState> : (
              <Bars data={c.eliminations.map((e) => ({ label: e.pair, value: Math.round(e.amountCents / 100), tone: 'info' }))} format={(v) => `R ${v.toLocaleString('en-ZA')}`} />
            )}
            <p className="note" style={{ marginTop: 6 }}>Every elimination references the invoice pair it eliminates. A mismatch between the two sides is an exception, not a plug.</p>
          </Card>
        </div>
      )}

      {tab === 'intercompany' && (
        <Card title="Intercompany invoices" extra="computed from posted rules with the evidence attached">
          {ic.isLoading ? <Skeleton rows={6} /> : (ic.data?.invoices.length ?? 0) === 0 ? <EmptyState>No intercompany invoices have been issued.</EmptyState> : (
            <DataTable
              rows={ic.data!.invoices}
              rowKey={(x) => x.id}
              columns={[
                { key: 'no', header: 'Number', render: (x) => <span className="mono">{x.number}</span> },
                { key: 'p', header: 'Period', render: (x) => x.period },
                { key: 'from', header: 'From', render: (x) => x.fromName },
                { key: 'to', header: 'To', render: (x) => x.toName },
                { key: 'rule', header: 'Rule', render: (x) => <Chip>{x.ruleType.replace(/_/g, ' ')}</Chip> },
                { key: 'basis', header: 'Basis', render: (x) => <span className="small" style={{ whiteSpace: 'normal' }}>{x.basis}</span> },
                { key: 'excl', header: 'Excl. VAT', num: true, render: (x) => <Money cents={x.amountExclCents} /> },
                { key: 'vat', header: 'VAT', num: true, render: (x) => <Money cents={x.vatCents} /> },
                { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
              ]}
            />
          )}
          <p className="note" style={{ marginTop: 6 }}>A management-fee rule cites the agreement clause it implements, and compliance reviews the basis for HPCSA fee-sharing.</p>
        </Card>
      )}

      {tab === 'cash' && (
        <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
          <Card title="Thirteen-week cash forecast" extra="from claims in flight and debtor propensity">
            {cash.isLoading ? <Skeleton rows={6} /> : !cash.data ? <EmptyState>Select a practice to forecast its cash.</EmptyState> : (
              <>
                <Sparkline values={cash.data.weeks.map((w) => w.closingCents)} width={520} height={60} tone={cash.data.weeks[cash.data.weeks.length - 1]!.closingCents >= cash.data.floorCents ? 'ok' : 'crit'} />
                <DataTable
                  rows={cash.data.weeks}
                  rowKey={(x) => String(x.week)}
                  columns={[
                    { key: 'w', header: 'Week', render: (x) => `W${x.week}` },
                    { key: 'in', header: 'Inflow', num: true, render: (x) => <Money cents={x.inflowCents} /> },
                    { key: 'out', header: 'Outflow', num: true, render: (x) => <Money cents={x.outflowCents} /> },
                    { key: 'net', header: 'Net', num: true, render: (x) => <Money cents={x.netCents} sign /> },
                    { key: 'close', header: 'Closing', num: true, render: (x) => <span className={x.closingCents < cash.data!.floorCents ? 'neg' : ''}><Money cents={x.closingCents} /></span> },
                  ]}
                />
              </>
            )}
          </Card>
          <Card title="What drives it">
            {cash.data && (
              <KV items={[
                ['Opening cash', <Money key="o" cents={cash.data.openingCents} />],
                ['Scheme claims in flight', <Money key="s" cents={cash.data.schemeInFlightCents} />],
                ['Open patient balances', <Money key="p" cents={cash.data.patientOpenCents} />],
                ['Working-capital floor', <Money key="f" cents={cash.data.floorCents} />],
              ]} />
            )}
            <p className="note" style={{ marginTop: 6 }}>Money never leaves a practice without a posted rule and an agreement reference. Sweeps post intercompany loan and interest journals automatically.</p>
          </Card>
        </div>
      )}

      {tab === 'board' && (
        <Card title={`Board pack · ${b?.period ?? ''}`} extra="built from locked periods only">
          {board.isLoading ? <Skeleton rows={6} /> : !b ? <EmptyState>The board pack could not be built.</EmptyState> : (
            <>
              <div className="grid g4">
                <Tile label="Group revenue" value={<Money cents={b.group.revenueCents} />} />
                <Tile label="Group EBITDA" value={<Money cents={b.group.ebitdaCents} />} />
                <Tile label="Distributable" value={<Money cents={b.group.distributableCents} />} />
                <Tile label="Studies" value={b.group.studies} />
              </div>
              <DataTable
                rows={b.practices}
                rowKey={(x: any) => x.practiceId}
                columns={[
                  { key: 'n', header: 'Practice', render: (x: any) => x.name },
                  { key: 'rev', header: 'Revenue', num: true, render: (x: any) => <Money cents={x.revenueCents} /> },
                  { key: 'eb', header: 'EBITDA', num: true, render: (x: any) => <Money cents={x.ebitdaCents} /> },
                  { key: 'm', header: 'Margin', num: true, render: (x: any) => <span className="mono">{x.ebitdaMarginPct} %</span> },
                  { key: 'fp', header: 'First-pass', num: true, render: (x: any) => <span className="mono">{x.firstPassPct} %</span> },
                  { key: 'un', header: 'Unbilled', num: true, render: (x: any) => <Money cents={x.unbilledCents} /> },
                  { key: 'wo', header: 'Short-pay and write-offs', num: true, render: (x: any) => <Money cents={x.writeOffsCents} /> },
                  { key: 'd', header: 'Distributable', num: true, render: (x: any) => <Money cents={x.distributableCents} /> },
                ]}
              />
              {b.openReservedMatters?.length > 0 && (
                <>
                  <h4 style={{ marginTop: 12 }}>Open reserved matters</h4>
                  {b.openReservedMatters.map((m: any) => <Chip key={m.ref} kind="att">{m.ref} · {m.title} · closes {new Date(m.closesAt).toLocaleDateString('en-ZA')}</Chip>)}
                </>
              )}
              <p className="note" style={{ marginTop: 8 }}>If a practice month reopens after the pack is locked, the pack shows a restatement note rather than changing silently.</p>
            </>
          )}
        </Card>
      )}

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Group money"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
