import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, Bars, Check, Sheet, KV, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/billing/month-end')({ component: Page });

interface MonthEnd {
  period: string; status: string; signedBy: string | null; signedAt: string | null;
  register: { items: Array<{ chargeId: string; serviceDate: string; ageDays: number; modality: string | null; procedureCodes: string[]; funderId: string; totalCents: number; status: string; blockingReason: string; owner: string }>; count: number; valueCents: number; oldestDays: number; olderThan7: number; olderThan30: number; byReason: Record<string, { count: number; cents: number }> };
  inFlight: { count: number; valueCents: number; byFunder: Record<string, { count: number; cents: number; oldestDays: number }> };
  ageing: Record<string, Record<string, number> & { total: number }>;
  provision: { totalExposureCents: number; totalProvisionCents: number; lines: Array<{ debtorClass: string; bucket: string; exposureCents: number; rate: number; provisionCents: number }> };
  checklist: Array<{ id: string; label: string; done: boolean; owner: string }>;
  performed: number; claimed: number; signedReports: number; revenueCents: number; vatCents: number;
}

function Page() {
  const qc = useQueryClient();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const data = useQuery({ queryKey: ['month-end'], queryFn: () => api.get<MonthEnd>('/billing/month-end') });

  const sign = useMutation({
    mutationFn: () => api.post('/billing/month-end/sign', { period: data.data!.period, confirm: 'Confirm', checklist: data.data!.checklist.map((c) => ({ ...c, done: checks[c.id] ?? c.done })) }),
    onSuccess: () => { setToast('The unbilled snapshot is locked and handed to finance. The Close Hand starts the M15 side.'); void qc.invalidateQueries({ queryKey: ['month-end'] }); },
    onError: (e: Error) => setToast(e.message),
  });

  const d = data.data;
  const unbilledPct = d && d.performed ? Math.round(((d.performed - d.claimed) / d.performed) * 1000) / 10 : 0;

  return (
    <div className="page">
      <PageHeader
        title={`Month-end · ${d?.period ?? ''}`}
        subtitle="Unbilled register, claims in flight, accruals and the close checklist"
        actions={d?.status === 'signed'
          ? <Chip kind="done">Signed{d.signedAt ? ` ${new Date(d.signedAt).toLocaleDateString('en-ZA')}` : ''}</Chip>
          : <Button variant="primary" disabled={sign.isPending || !d} onClick={() => sign.mutate()}>{sign.isPending ? 'Signing…' : 'Sign the register'}</Button>}
      />
      {data.isError && <Banner kind="crit">The month-end view could not be loaded.</Banner>}
      {d && d.register.olderThan30 > 0 && <Banner kind="warn">{d.register.olderThan30} unbilled items are older than 30 days. Every one needs a named owner before the period closes.</Banner>}

      {data.isLoading ? <Skeleton rows={3} /> : d && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
            <Tile label="Performed" value={d.performed} delta={`${d.signedReports} with a signed report`} />
            <Tile label="Claimed" value={d.claimed} delta={`${unbilledPct} % unbilled`} tone={unbilledPct > 5 ? 'down' : 'up'} />
            <Tile label="Unbilled value" value={<Money cents={d.register.valueCents} />} delta={`${d.register.count} items · oldest ${d.register.oldestDays} days`} />
            <Tile label="In flight" value={d.inFlight.count} delta={<Money cents={d.inFlight.valueCents} />} />
            <Tile label="Bad-debt provision" value={<Money cents={d.provision.totalProvisionCents} />} delta={<>on <Money cents={d.provision.totalExposureCents} /> exposure</>} />
          </div>

          <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
            <Card title="Unbilled register" extra={`${d.register.count} items`}>
              {d.register.items.length === 0 ? <EmptyState>Nothing unbilled: every performed study is claimed.</EmptyState> : (
                <div style={{ maxHeight: 420, overflow: 'auto' }}>
                  <DataTable
                    rows={d.register.items}
                    rowKey={(x) => x.chargeId}
                    columns={[
                      { key: 'date', header: 'Service date', render: (x) => <span className="mono">{x.serviceDate}</span> },
                      { key: 'age', header: 'Age', num: true, render: (x) => <span className={x.ageDays > 30 ? 'neg mono' : 'mono'}>{x.ageDays} d</span> },
                      { key: 'proc', header: 'Codes', render: (x) => <span className="mono">{x.procedureCodes.join(' + ')}</span> },
                      { key: 'funder', header: 'Funder', render: (x) => x.funderId },
                      { key: 'why', header: 'Blocking reason', render: (x) => <span className="small">{x.blockingReason.replace(/_/g, ' ')}</span> },
                      { key: 'owner', header: 'Owner', render: (x) => <Chip>{x.owner}</Chip> },
                      { key: 'val', header: 'Value', num: true, render: (x) => <Money cents={x.totalCents} /> },
                      { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                    ]}
                  />
                </div>
              )}
            </Card>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <Card title="Where the unbilled sits" extra="by blocking reason">
                <Bars data={Object.entries(d.register.byReason).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v.count, tone: k.includes('reject') ? 'crit' : 'info' }))} />
              </Card>

              <Card title="Claims in flight" extra="for the accrual">
                <DataTable
                  rows={Object.entries(d.inFlight.byFunder).map(([funderId, v]) => ({ funderId, ...v }))}
                  rowKey={(x) => x.funderId}
                  columns={[
                    { key: 'f', header: 'Funder', render: (x) => x.funderId },
                    { key: 'n', header: 'Claims', num: true, render: (x) => x.count },
                    { key: 'v', header: 'Expected', num: true, render: (x) => <Money cents={x.cents} /> },
                    { key: 'age', header: 'Oldest', num: true, render: (x) => <span className="mono">{x.oldestDays} d</span> },
                  ]}
                />
              </Card>

              <Card title="Expected credit loss" extra="IFRS-style provision matrix">
                <DataTable
                  rows={d.provision.lines}
                  rowKey={(x) => `${x.debtorClass}:${x.bucket}`}
                  columns={[
                    { key: 'c', header: 'Class', render: (x) => x.debtorClass },
                    { key: 'b', header: 'Bucket', render: (x) => x.bucket },
                    { key: 'e', header: 'Exposure', num: true, render: (x) => <Money cents={x.exposureCents} /> },
                    { key: 'r', header: 'Rate', num: true, render: (x) => <span className="mono">{Math.round(x.rate * 1000) / 10} %</span> },
                    { key: 'p', header: 'Provision', num: true, render: (x) => <Money cents={x.provisionCents} /> },
                  ]}
                />
              </Card>

              <Card title="Close checklist" extra={`${d.checklist.filter((c) => checks[c.id] ?? c.done).length}/${d.checklist.length}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {d.checklist.map((c) => (
                    <Check key={c.id} checked={checks[c.id] ?? c.done} onChange={(v) => setChecks({ ...checks, [c.id]: v })} label={<span>{c.label} <Chip>{c.owner}</Chip></span>} />
                  ))}
                </div>
                <p className="note" style={{ marginTop: 8 }}>Signing locks an immutable snapshot for finance. Revenue is recognised on the service date at the expected transaction price.</p>
              </Card>

              <Card title="Revenue for the period">
                <KV items={[
                  ['Revenue excl. VAT', <Money key="r" cents={d.revenueCents} />],
                  ['VAT at 15 %', <Money key="v" cents={d.vatCents} />],
                  ['Total billed', <Money key="t" cents={d.revenueCents + d.vatCents} />],
                ]} />
              </Card>
            </div>
          </div>
        </>
      )}

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Month-end"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
