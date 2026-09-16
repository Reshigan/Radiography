import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Button, Field, Select, Sheet, KV, Tile } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/billing/fee-schedules')({ component: Page });

interface Schedule { id: string; funderId: string; funderType: string; name: string; kind: string; version: number; effectiveFrom: string; effectiveTo: string | null; upliftPct: number; status: string; lines: Array<{ code: string; priceExclCents: number; unit: string }> }

function Page() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ funderId: 'scheme-a', name: '', kind: 'scheme_rate', upliftPct: 0, effectiveFrom: new Date().toISOString().slice(0, 10), reason: '' });
  const [toast, setToast] = useState<string | null>(null);

  const schedules = useQuery({ queryKey: ['fee-schedules'], queryFn: () => api.get<{ schedules: Schedule[] }>('/billing/fee-schedules') });
  const tariffs = useQuery({ queryKey: ['tariffs'], queryFn: () => api.get<{ tariffs: Array<{ code: string; description: string; kind: string }>; baseRates: Record<string, number> }>('/billing/tariffs') });

  const create = useMutation({
    mutationFn: () => api.post('/billing/fee-schedules', form),
    onSuccess: (r: any) => { setToast(`Version ${r.version} created and now in force; the previous version is superseded.`); setOpen(false); setForm({ ...form, name: '', reason: '' }); void qc.invalidateQueries({ queryKey: ['fee-schedules'] }); },
    onError: (e: Error) => setToast(e.message),
  });

  const rows = schedules.data?.schedules ?? [];
  const current = rows.find((x) => x.id === selected) ?? null;
  const byCode = tariffs.data?.tariffs ? Object.fromEntries(tariffs.data.tariffs.map((x) => [x.code, x])) : {};

  return (
    <div className="page">
      <PageHeader
        title="Fee schedules"
        subtitle="Per funder, effective-dated and versioned. A schedule change never re-prices history."
        actions={<Button variant="primary" onClick={() => setOpen(true)}>New version</Button>}
      />
      {schedules.isError && <Banner kind="crit">Fee schedules could not be loaded.</Banner>}
      <Banner kind="info">Prices follow the service date. Where the shareholders&apos; agreement says so, a fee-schedule change is a reserved matter and routes to a shareholder vote.</Banner>

      <div className="grid g4">
        <Tile label="Schedules" value={rows.length} delta={`${rows.filter((x) => x.status === 'active').length} active`} />
        <Tile label="Funders priced" value={new Set(rows.map((x) => x.funderId)).size} />
        <Tile label="Codes per schedule" value={rows[0]?.lines.length ?? 0} delta="tariff, modifier and NAPPI lines" />
        <Tile label="Superseded versions" value={rows.filter((x) => x.status === 'superseded').length} delta="kept for historical pricing" />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <Card title="Schedules">
          {schedules.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState>No fee schedules are configured for this practice.</EmptyState> : (
            <DataTable
              rows={rows}
              rowKey={(x) => x.id}
              selectedKey={selected ?? undefined}
              onRowClick={(x) => setSelected(x.id)}
              columns={[
                { key: 'funder', header: 'Funder', render: (x) => x.funderId },
                { key: 'name', header: 'Schedule', render: (x) => x.name },
                { key: 'kind', header: 'Kind', render: (x) => <Chip>{x.kind.replace(/_/g, ' ')}</Chip> },
                { key: 'v', header: 'Version', num: true, render: (x) => <span className="mono">v{x.version}</span> },
                { key: 'uplift', header: 'Uplift', num: true, render: (x) => <span className="mono">{x.upliftPct >= 0 ? '+' : ''}{x.upliftPct} %</span> },
                { key: 'from', header: 'From', render: (x) => <span className="mono">{x.effectiveFrom}</span> },
                { key: 'st', header: 'Status', render: (x) => <Chip kind={x.status === 'active' ? 'done' : 'neutral'}>{x.status}</Chip> },
              ]}
            />
          )}
        </Card>

        <Card title={current ? `${current.name} · v${current.version}` : 'Schedule lines'} extra={current ? `${current.lines.length} lines` : undefined}>
          {!current ? <EmptyState>Select a schedule to see its priced lines.</EmptyState> : (
            <>
              <KV items={[
                ['In force', `${current.effectiveFrom} to ${current.effectiveTo ?? 'further notice'}`],
                ['Basis', `${current.kind.replace(/_/g, ' ')} at ${100 + current.upliftPct} % of the published rate`],
                ['Status', current.status],
              ]} />
              <div style={{ maxHeight: 380, overflow: 'auto', marginTop: 8 }}>
                <DataTable
                  rows={current.lines}
                  rowKey={(x) => x.code}
                  columns={[
                    { key: 'code', header: 'Code', render: (x) => <span className="mono">{x.code}</span> },
                    { key: 'desc', header: 'Description', render: (x) => byCode[x.code]?.description ?? '—' },
                    { key: 'kind', header: 'Kind', render: (x) => <span className="small muted">{byCode[x.code]?.kind ?? ''}</span> },
                    { key: 'price', header: 'Price excl. VAT', num: true, render: (x) => <Money cents={x.priceExclCents} /> },
                    { key: 'incl', header: 'Incl. VAT', num: true, render: (x) => <Money cents={Math.round(x.priceExclCents * 1.15)} /> },
                  ]}
                />
              </div>
            </>
          )}
        </Card>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="New fee schedule version">
        <Field label="Funder">
          <Select value={form.funderId} onChange={(e) => setForm({ ...form, funderId: e.target.value })}>
            {['scheme-a', 'scheme-b', 'scheme-c', 'cash', 'raf', 'coida', 'corporate'].map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </Field>
        <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Scheme A rate 2027" /></Field>
        <Field label="Kind">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {['scheme_rate', 'negotiated', 'cash', 'raf', 'coida', 'corporate'].map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Uplift on the published rate (%)" hint="0 means 100 % of the rate; 50 means 150 %"><input type="number" value={form.upliftPct} onChange={(e) => setForm({ ...form, upliftPct: Number(e.target.value) })} /></Field>
        <Field label="Effective from"><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
        <Field label="Reason (recorded on the audit trail)"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Annual tariff review approved by the board" /></Field>
        <div className="row-flex">
          <Button variant="primary" disabled={!form.name || form.reason.length < 3 || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create version'}</Button>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </Sheet>
      <Sheet open={!!toast} onClose={() => setToast(null)} title="Fee schedules"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
