import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, KV, Field, Input, Check, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/engineering/access')({ component: AccessPage });

interface Session {
  id: string; ref: string; vendor: string; engineer: string | null; purpose: string; scope: string; assetName: string | null; siteName: string;
  requestedStart: string; requestedEnd: string; approvedStart: string | null; approvedEnd: string | null; status: string;
  approvedBy: string | null; approvedAt: string | null; recordingRef: string | null; conditions: string[] | null;
}

function AccessPage() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [narrowed, setNarrowed] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [conditions, setConditions] = useState<Record<string, boolean>>({});

  const q = useQuery({ queryKey: ['vendor-access'], queryFn: () => api.get<{ sessions: Session[]; note: string }>('/assets/vendor-access') });
  const approve = useMutation({
    mutationFn: (s: Session) => api.post(`/assets/vendor-access/${s.id}/approve`, { confirm, approvedStart: narrowed.start || undefined, approvedEnd: narrowed.end || undefined }),
    onSuccess: () => { setConfirm(''); setNarrowed({ start: '', end: '' }); void qc.invalidateQueries({ queryKey: ['vendor-access'] }); },
  });
  const close = useMutation({ mutationFn: (id: string) => api.post(`/assets/vendor-access/${id}/close`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['vendor-access'] }) });

  const sessions = q.data?.sessions ?? [];
  const pending = sessions.filter((s) => s.status === 'requested');
  const active = sessions.filter((s) => s.status === 'approved' || s.status === 'active');
  const history = sessions.filter((s) => s.status === 'closed' || s.status === 'declined' || s.status === 'expired');
  const focus = pending[0] ?? null;

  return (
    <div className="page">
      <PageHeader title="Vendor remote access" subtitle={`${pending.length} awaiting approval · ${active.length} approved · every session brokered and recorded`} actions={<a className="btn" href="/engineering/devices">Devices</a>} />

      {pending.length > 0 && <Banner kind="warn">{pending.length} vendor session{pending.length > 1 ? 's are' : ' is'} awaiting approval. The runtime never auto-approves remote access.</Banner>}
      {q.isError && <Banner kind="crit">Vendor sessions could not be loaded. Refresh, or call platform support with reference assets-vendor-access.</Banner>}

      {focus && (
        <Card title={`Approve session · ${focus.ref}`} extra={<Chip kind="att">awaiting approval</Chip>}>
          <KV items={[
            ['Vendor', <>{focus.vendor}<div className="small muted">operator agreement on file</div></>],
            ['Engineer', focus.engineer ?? '—'],
            ['Target', `${focus.assetName ?? 'asset'} · ${focus.siteName}`],
            ['Purpose', focus.purpose],
            ['Scope', focus.scope],
            ['Requested window', <><DateTime iso={focus.requestedStart} /> to {focus.requestedEnd.slice(11, 16)}</>],
            ['Access path', 'Brokered through the Edge Gateway · no site network access · no standing credentials'],
            ['Recording', 'Screen and command log, attached to the asset timeline'],
            ['Patient data', 'The console may show identifiers; a confidentiality acknowledgement is required at session start'],
          ]} />

          <div className="row-flex" style={{ alignItems: 'flex-end' }}>
            <Field label="Narrow the window: start"><Input type="datetime-local" value={narrowed.start} onChange={(e) => setNarrowed({ ...narrowed, start: e.target.value ? `${e.target.value}:00.000Z` : '' })} /></Field>
            <Field label="End"><Input type="datetime-local" value={narrowed.end} onChange={(e) => setNarrowed({ ...narrowed, end: e.target.value ? `${e.target.value}:00.000Z` : '' })} /></Field>
          </div>

          {(focus.conditions ?? []).map((c) => (
            <Check key={c} checked={!!conditions[c]} onChange={(v) => setConditions({ ...conditions, [c]: v })} label={<span className="small">{c}</span>} />
          ))}

          <div className="row-flex" style={{ alignItems: 'flex-end', marginTop: 8 }}>
            <Field label={`Type ${focus.ref} to confirm`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={focus.ref} /></Field>
            <Button variant="primary" disabled={confirm !== focus.ref || approve.isPending} onClick={() => approve.mutate(focus)}>Approve session</Button>
          </div>
          {approve.isError && <Banner kind="crit">{(approve.error as Error).message}</Banner>}
          <p className="note">Standing access is not offered. A session closes automatically at the end of its window, and the on-call rota escalates to the Group engineering lead after fifteen minutes without a response.</p>
        </Card>
      )}

      <Card title="Sessions" extra={`${sessions.length} recorded`}>
        {q.isLoading ? <Skeleton rows={5} /> : !sessions.length ? <EmptyState>No vendor sessions requested.</EmptyState> : (
          <DataTable
            rows={[...pending, ...active, ...history]}
            rowKey={(s) => s.id}
            columns={[
              { key: 'ref', header: 'Reference', render: (s) => <span className="mono">{s.ref}</span> },
              { key: 'vendor', header: 'Vendor', render: (s) => <>{s.vendor}<div className="small muted">{s.engineer ?? ''}</div></> },
              { key: 'target', header: 'Target', render: (s) => <>{s.assetName ?? '—'}<div className="small muted">{s.siteName}</div></> },
              { key: 'purpose', header: 'Purpose', render: (s) => <span className="small">{s.purpose}</span> },
              { key: 'window', header: 'Window', render: (s) => <span className="mono small">{(s.approvedStart ?? s.requestedStart).slice(5, 16).replace('T', ' ')} to {(s.approvedEnd ?? s.requestedEnd).slice(11, 16)}</span> },
              { key: 'rec', header: 'Recording', render: (s) => s.recordingRef ? <span className="mono small">{s.recordingRef}</span> : <span className="muted">—</span> },
              { key: 'status', header: 'Status', render: (s) => <>{<StatusChip status={s.status} />}{(s.status === 'approved' || s.status === 'active') && <Button size="sm" onClick={() => close.mutate(s.id)}>Close</Button>}</> },
            ]}
          />
        )}
        <p className="note">{q.data?.note}</p>
      </Card>
    </div>
  );
}
