import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Sheet, KV, Field, Select, TextArea, SlaBar, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import type { Complaint } from './compliance.index';

export const Route = createFileRoute('/compliance/complaints')({ component: ComplaintsPage });

function ComplaintsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Complaint | null>(null);
  const [status, setStatus] = useState('acknowledged');
  const [response, setResponse] = useState('');

  const complaints = useQuery({ queryKey: ['complaints'], queryFn: () => api.get<{ complaints: Complaint[] }>('/compliance/complaints') });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/compliance/complaints/${id}`, body),
    onSuccess: () => { setOpen(null); setResponse(''); void qc.invalidateQueries({ queryKey: ['complaints'] }); },
  });

  const rows = complaints.data?.complaints ?? [];
  const ackOverdue = rows.filter((c) => c.ackOverdue);
  const byRoute = ['internal', 'CPA', 'HPCSA', 'CMS'].map((r) => ({ route: r, n: rows.filter((c) => c.route === r).length }));

  return (
    <div className="page">
      <PageHeader title="Complaints" subtitle={`${rows.filter((c) => c.status !== 'closed').length} open · routes: ${byRoute.filter((b) => b.n).map((b) => `${b.route} ${b.n}`).join(' · ')}`} />

      {ackOverdue.length > 0 && <Banner kind="crit">{ackOverdue.length} complaint{ackOverdue.length > 1 ? 's have' : ' has'} passed the one working day acknowledgement deadline.</Banner>}
      {complaints.isError && <Banner kind="crit">Complaints could not be loaded. Refresh, or call platform support with reference compliance-complaints.</Banner>}

      <Card title="Complaint register" extra={`${rows.length} records`}>
        {complaints.isLoading ? <Skeleton rows={6} /> : !rows.length ? <EmptyState>No complaints recorded.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(c) => c.id}
            onRowClick={(c) => { setOpen(c); setStatus(c.status === 'received' ? 'acknowledged' : 'responded'); }}
            columns={[
              { key: 'ref', header: 'Reference', render: (c) => <span className="mono">{c.ref}</span> },
              { key: 'route', header: 'Route', render: (c) => <>{c.route}{c.legalHold && <div><Chip kind="crit">legal hold</Chip></div>}</> },
              { key: 'channel', header: 'Channel', render: (c) => <span className="small">{c.channel.replace(/_/g, ' ')}</span> },
              { key: 'cat', header: 'Category', render: (c) => c.category },
              { key: 'subject', header: 'Subject', render: (c) => <span className="small">{c.subject}</span> },
              { key: 'ack', header: 'Acknowledged', render: (c) => c.acknowledgedAt ? <Chip kind="done">within a day</Chip> : <Chip kind={c.ackOverdue ? 'crit' : 'att'}>{c.ackOverdue ? 'overdue' : 'pending'}</Chip> },
              { key: 'sla', header: 'Respond by', render: (c) => <><span className="mono small">{c.respondBy.slice(0, 10)}</span><SlaBar pct={c.slaPct} /></> },
              { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.status} /> },
            ]}
          />
        )}
        <p className="note">Scheme, council and consumer routes carry their own deadlines, which take precedence over the practice target. Complaints that reveal harm open an incident.</p>
      </Card>

      {open && (
        <Sheet open onClose={() => setOpen(null)} title={`${open.ref} · ${open.subject}`}>
          <KV items={[
            ['Route', <>{open.route}{open.externalRef ? <span className="mono"> · {open.externalRef}</span> : null}</>],
            ['Channel', open.channel.replace(/_/g, ' ')],
            ['Category', open.category],
            ['Severity', open.severity],
            ['Received', <DateTime iso={open.receivedAt} key="r" />],
            ['Acknowledged', open.acknowledgedAt ? <DateTime iso={open.acknowledgedAt} key="a" /> : 'not yet'],
            ['Respond by', <DateTime iso={open.respondBy} key="b" time={false} />],
            ['Legal hold', open.legalHold ? 'yes · correspondence and response drafts are under legal-hold marking' : 'no'],
          ]} />
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {['acknowledged', 'investigating', 'responded', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Response" hint="The Compliance Hand may draft a fact summary from the encounter record; compliance or the practice manager signs the response."><TextArea value={response} onChange={(e) => setResponse(e.target.value)} /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={update.isPending} onClick={() => update.mutate({ id: open.id, body: { status, response: response || undefined } })}>Save</Button>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
