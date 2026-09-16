import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Sheet, KV, Field, Input, Select, Check, SlaBar, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import type { DataSubjectRequest } from './compliance.index';

export const Route = createFileRoute('/compliance/requests')({ component: RequestsPage });

function RequestsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<DataSubjectRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ type: 'access', requesterMasked: '' });

  const requests = useQuery({ queryKey: ['dsr'], queryFn: () => api.get<{ requests: DataSubjectRequest[]; note: string }>('/compliance/requests') });
  const create = useMutation({ mutationFn: () => api.post('/compliance/requests', form), onSuccess: () => { setCreating(false); setForm({ type: 'access', requesterMasked: '' }); void qc.invalidateQueries({ queryKey: ['dsr'] }); } });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/compliance/requests/${id}`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['dsr'] }) });

  const rows = requests.data?.requests ?? [];
  const current = open ? rows.find((r) => r.id === open.id) ?? open : null;
  const late = rows.filter((r) => r.pastStatutory);

  return (
    <div className="page">
      <PageHeader
        title="Data-subject and PAIA requests"
        subtitle={`${rows.filter((r) => r.status !== 'fulfilled').length} in progress · statutory period 30 days (illustrative)`}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>Log a request</Button>}
      />

      {late.length > 0 && <Banner kind="crit">{late.length} request{late.length > 1 ? 's are' : ' is'} past the statutory period.</Banner>}
      {requests.isError && <Banner kind="crit">Requests could not be loaded. Refresh, or call platform support with reference compliance-requests.</Banner>}

      <Card title="Requests" extra={`${rows.length} records`}>
        {requests.isLoading ? <Skeleton rows={5} /> : !rows.length ? <EmptyState>No requests received.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpen(r)}
            columns={[
              { key: 'ref', header: 'Reference', render: (r) => <span className="mono">{r.ref}</span> },
              { key: 'type', header: 'Type', render: (r) => r.type.toUpperCase() },
              { key: 'who', header: 'Requester', render: (r) => <><span className="mono">{r.requesterMasked}</span>{!r.identityVerified && <div><Chip kind="att">identity unverified</Chip></div>}</> },
              { key: 'received', header: 'Received', render: (r) => <DateTime iso={r.receivedAt} time={false} /> },
              { key: 'statutory', header: 'Statutory clock', render: (r) => <><span className="mono small">{r.statutoryDaysLeft} d left</span><SlaBar pct={r.statutoryPct} /></> },
              { key: 'policy', header: 'Policy clock', render: (r) => <SlaBar pct={r.policyPct} /> },
              { key: 'progress', header: 'Checklist', num: true, render: (r) => <span className="mono">{r.checklist.filter((c) => c.done).length}/{r.checklist.length}</span> },
              { key: 'status', header: 'Status', render: (r) => <StatusChip status={r.status} /> },
            ]}
          />
        )}
        <p className="note">{requests.data?.note}</p>
      </Card>

      {current && (
        <Sheet open onClose={() => setOpen(null)} title={`${current.ref} · ${current.type.toUpperCase()}`}>
          <KV items={[
            ['Requester', <span className="mono" key="q">{current.requesterMasked}</span>],
            ['Received', <DateTime iso={current.receivedAt} key="r" />],
            ['Statutory due', <><DateTime iso={current.statutoryDueAt} time={false} /> · {current.statutoryDaysLeft} days left</>],
            ['Policy due', <DateTime iso={current.policyDueAt} key="p" time={false} />],
            ['Status', <StatusChip status={current.status} key="s" />],
          ]} />
          <Card title="Checklist">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {current.checklist.map((c, i) => (
                <Check key={i} checked={c.done} onChange={() => patch.mutate({ id: current.id, body: { checklistIndex: i, identityVerified: i === 0 ? true : undefined } })} label={<span className={c.done ? '' : 'muted'}>{c.item}</span>} />
              ))}
            </div>
          </Card>
          <div className="row-flex">
            <Button variant="primary" disabled={current.checklist.some((c) => !c.done) || patch.isPending} onClick={() => patch.mutate({ id: current.id, body: { status: 'fulfilled' } })}>Record fulfilment</Button>
            <Button disabled={patch.isPending} onClick={() => patch.mutate({ id: current.id, body: { status: 'extended', extensionReason: 'Volume of records; extension recorded' } })}>Extend once</Button>
          </div>
          {patch.isError && <Banner kind="crit">{(patch.error as Error).message}</Banner>}
          <p className="note">Images are delivered through the Patient Space share link. Third-party data is redacted on PAIA grounds with a recorded reason, and the release is approved by the Information Officer.</p>
        </Sheet>
      )}

      {creating && (
        <Sheet open onClose={() => setCreating(false)} title="Log a data-subject request">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {['access', 'correction', 'deletion', 'objection', 'paia'].map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </Select>
          </Field>
          <Field label="Requester (masked)" hint="Identity is verified by ID match plus an OTP to the registered number."><Input value={form.requesterMasked} onChange={(e) => setForm({ ...form, requesterMasked: e.target.value })} placeholder="····4471" /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={form.requesterMasked.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>Log request</Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
