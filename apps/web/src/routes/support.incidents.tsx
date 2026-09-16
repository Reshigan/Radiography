import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Sheet, KV, Check, Field, Input, Select, TextArea, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import type { Ticket } from './support.index';

export const Route = createFileRoute('/support/incidents')({ component: SupportIncidentsPage });

function SupportIncidentsPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ category: 'outage', severity: 'p3', title: '', description: '' });

  const tickets = useQuery({ queryKey: ['tickets'], queryFn: () => api.get<{ tickets: Ticket[] }>('/assets/support/tickets'), refetchInterval: 60_000 });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/assets/support/tickets/${id}`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['tickets'] }) });
  const create = useMutation({ mutationFn: () => api.post('/assets/support/tickets', form), onSuccess: () => { setCreating(false); setForm({ category: 'outage', severity: 'p3', title: '', description: '' }); void qc.invalidateQueries({ queryKey: ['tickets'] }); } });

  const rows = tickets.data?.tickets ?? [];
  const current = rows.find((t) => t.id === openId) ?? null;
  const p1 = rows.filter((t) => t.severity === 'p1' && t.status !== 'closed');

  return (
    <div className="page">
      <PageHeader
        title="Support cases"
        subtitle={`${rows.filter((t) => t.status !== 'closed').length} open · runbooks tracked per case`}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>Open a case</Button>}
      />

      {p1.length > 0 && <Banner kind="crit">{p1.length} P1 case{p1.length > 1 ? 's' : ''} open.</Banner>}
      {tickets.isError && <Banner kind="crit">Cases could not be loaded. Refresh, or retry with reference support-tickets.</Banner>}

      <Card title="Queue" extra={`${rows.length} cases`}>
        {tickets.isLoading ? <Skeleton rows={6} /> : !rows.length ? <EmptyState>No support cases.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(t) => t.id}
            onRowClick={(t) => setOpenId(t.id)}
            selectedKey={openId ?? undefined}
            columns={[
              { key: 'ref', header: 'Reference', render: (t) => <span className="mono">{t.ref}</span> },
              { key: 'sev', header: 'Severity', render: (t) => <Chip kind={t.severity === 'p1' ? 'crit' : t.severity === 'p2' ? 'att' : 'neutral'}>{t.severity.toUpperCase()}</Chip> },
              { key: 'title', header: 'Case', render: (t) => <><b>{t.title}</b>{t.linkedRef && <div className="small muted">linked: {t.linkedRef}</div>}</> },
              { key: 'cat', header: 'Category', render: (t) => t.category },
              { key: 'runbook', header: 'Runbook', num: true, render: (t) => t.runbook ? <span className="mono">{t.runbook.filter((s) => s.done).length}/{t.runbook.length}</span> : <span className="muted">—</span> },
              { key: 'status', header: 'Status', render: (t) => <StatusChip status={t.status} /> },
              { key: 'when', header: 'Opened', render: (t) => <DateTime iso={t.createdAt} time={false} /> },
            ]}
          />
        )}
      </Card>

      {current && (
        <Sheet open onClose={() => setOpenId(null)} title={`${current.ref} · ${current.title}`}>
          <KV items={[
            ['Severity', current.severity.toUpperCase()],
            ['Category', current.category],
            ['Status', <StatusChip status={current.status} key="s" />],
            ['Detail', current.description ?? '—'],
            ['Linked', current.linkedRef ?? '—'],
            ['Opened', <DateTime iso={current.createdAt} key="d" />],
          ]} />
          {current.runbook && current.runbook.length > 0 && (
            <Card title="Runbook">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {current.runbook.map((s, i) => (
                  <Check key={i} checked={s.done} onChange={() => patch.mutate({ id: current.id, body: { runbookIndex: i } })} label={<span className={s.done ? '' : 'muted'}>{s.step}</span>} />
                ))}
              </div>
            </Card>
          )}
          <Field label="Status">
            <Select value={current.status} onChange={(e) => patch.mutate({ id: current.id, body: { status: e.target.value } })}>
              {['open', 'in_progress', 'waiting', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
        </Sheet>
      )}

      {creating && (
        <Sheet open onClose={() => setCreating(false)} title="Open a support case">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['outage', 'integration', 'access', 'data', 'onboarding', 'question'].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {['p1', 'p2', 'p3', 'p4'].map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </Select>
          </Field>
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Detail"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={form.title.trim().length < 4 || create.isPending} onClick={() => create.mutate()}>Open case</Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
