import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, Sheet, KV, Field, Input, Select, TextArea, Money, Timeline, SlaBar } from '@bonakala/bdl';
import { api } from '../lib/api';
import { WorkOrderKanban, type WorkOrder } from './engineering.index';

export const Route = createFileRoute('/engineering/work-orders')({ component: WorkOrdersPage });

const NEXT: Record<string, string[]> = {
  open: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'awaiting_parts', 'cancelled'],
  in_progress: ['awaiting_parts', 'done', 'cancelled'],
  awaiting_parts: ['in_progress', 'done', 'cancelled'],
  done: [],
  cancelled: [],
};

function WorkOrdersPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ siteId: '', type: 'breakdown', priority: 'normal', title: '', symptoms: '' });

  const wos = useQuery({ queryKey: ['work-orders'], queryFn: () => api.get<{ columns: string[]; workOrders: WorkOrder[] }>('/assets/work-orders'), refetchInterval: 60_000 });
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Array<{ id: string; name: string }> }>('/org/sites') });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/assets/work-orders/${id}`, body),
    onSuccess: () => { setNote(''); setRootCause(''); void qc.invalidateQueries({ queryKey: ['work-orders'] }); },
  });
  const create = useMutation({
    mutationFn: () => api.post('/assets/work-orders', { ...form, siteId: form.siteId || sites.data?.sites[0]?.id }),
    onSuccess: () => { setCreating(false); setForm({ siteId: '', type: 'breakdown', priority: 'normal', title: '', symptoms: '' }); void qc.invalidateQueries({ queryKey: ['work-orders'] }); },
  });

  const rows = wos.data?.workOrders ?? [];
  const current = rows.find((w) => w.id === openId) ?? null;
  const breached = rows.filter((w) => w.slaBreached);

  return (
    <div className="page">
      <PageHeader
        title="Work orders"
        subtitle={`${rows.filter((w) => w.status !== 'done').length} open · ${breached.length} past the contract SLA`}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>New work order</Button>}
      />

      {breached.length > 0 && <Banner kind="crit">{breached.length} work order{breached.length > 1 ? 's are' : ' is'} past the vendor SLA: {breached.map((w) => w.ref).join(', ')}. SLA breaches feed the vendor scorecard.</Banner>}
      {wos.isError && <Banner kind="crit">Work orders could not be loaded. Refresh, or call platform support with reference assets-work-orders.</Banner>}

      <Card title="Kanban">
        {wos.isLoading ? <Skeleton rows={5} /> : <WorkOrderKanban columns={wos.data?.columns ?? []} rows={rows} onOpen={(w) => { setOpenId(w.id); setStatus(''); }} />}
      </Card>

      {current && (
        <Sheet open onClose={() => setOpenId(null)} title={`${current.ref} · ${current.title}`}>
          <KV items={[
            ['Asset', current.assetName ?? '—'],
            ['Site', current.siteName],
            ['Type and priority', <><Chip kind={current.priority === 'critical' ? 'crit' : 'att'}>{current.type}</Chip> <Chip>{current.priority}</Chip></>],
            ['Status', <StatusChip status={current.status} key="s" />],
            ['Vendor ticket', current.vendorTicket ? <span className="mono" key="v">{current.vendorTicket}</span> : 'none'],
            ['Contract SLA', current.slaHours ? <>{current.slaHours} h {current.slaPct !== null && <SlaBar pct={current.slaPct} />}</> : '—'],
            ['Part order', current.poCents ? <Money cents={current.poCents} key="p" /> : 'none'],
            ['Symptoms', current.symptoms ?? '—'],
            ['Root cause', current.rootCause ?? 'not recorded'],
          ]} />

          <Card title="Timeline">
            <Timeline items={current.timeline.map((t) => ({ time: t.at.slice(11, 16), text: <>{t.text}{t.by ? <span className="muted small"> · {t.by}</span> : null}</>, kind: t.kind as 'ok' | 'crit' | 'ai' | 'neutral' | undefined }))} />
          </Card>

          {NEXT[current.status]!.length > 0 && (
            <Card title="Move this work order">
              <Field label="Next status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Choose</option>
                  {NEXT[current.status]!.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </Select>
              </Field>
              <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened" /></Field>
              {status === 'done' && current.type === 'breakdown' && (
                <Field label="Root cause (required to close a breakdown)"><TextArea value={rootCause} onChange={(e) => setRootCause(e.target.value)} /></Field>
              )}
              <div className="row-flex">
                <Button
                  variant="primary"
                  disabled={!status || update.isPending || (status === 'done' && current.type === 'breakdown' && rootCause.trim().length < 5)}
                  onClick={() => update.mutate({ id: current.id, body: { status, note: note || undefined, rootCause: rootCause || undefined } })}
                >
                  Update
                </Button>
              </div>
              {update.isError && <Banner kind="crit">{(update.error as Error).message}</Banner>}
              <p className="note">Closing a breakdown releases the asset back to service and ends the downtime clock, which feeds uptime and mean time to repair.</p>
            </Card>
          )}
        </Sheet>
      )}

      {creating && (
        <Sheet open onClose={() => setCreating(false)} title="New work order">
          <Field label="Site">
            <Select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">First site</option>
              {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {['breakdown', 'pm', 'qa', 'upgrade', 'decommission'].map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['low', 'normal', 'high', 'critical'].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Symptoms"><TextArea value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={form.title.trim().length < 4 || create.isPending} onClick={() => create.mutate()}>Open work order</Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </Sheet>
      )}

      {!rows.length && !wos.isLoading && <EmptyState>No work orders yet.</EmptyState>}
    </div>
  );
}
