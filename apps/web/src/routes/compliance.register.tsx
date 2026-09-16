import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, Skeleton, EmptyState, DataTable, Sheet, KV, Field, Input } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/compliance/register')({ component: RegisterPage });

interface Obligation {
  id: string; domain: string; instrument: string; section: string | null; obligation: string; responsibleEntity: string; ownerPersona: string;
  trigger: string | null; control: string | null; output: string | null; evidence: string | null; automation: string; status: string;
  frequency: string; dueDate: string | null; lastDoneAt: string | null; submissionRef: string | null; version: number;
  daysToDue: number | null; state: 'overdue' | 'due' | 'current';
}

function RegisterPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [open, setOpen] = useState<Obligation | null>(null);
  const [doneAt, setDoneAt] = useState('');
  const [ref, setRef] = useState('');

  const reg = useQuery({ queryKey: ['register', domain], queryFn: () => api.get<{ obligations: Obligation[]; domains: string[] }>(`/compliance/register${domain ? `?domain=${domain}` : ''}`) });
  const record = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/compliance/register/${id}`, body),
    onSuccess: () => { setOpen(null); setDoneAt(''); setRef(''); void qc.invalidateQueries(); },
  });

  const rows = (reg.data?.obligations ?? []).filter((o) => !q || `${o.instrument} ${o.obligation} ${o.section ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const overdue = rows.filter((o) => o.state === 'overdue');
  const confirmItems = rows.filter((o) => o.status === 'confirm');

  return (
    <div className="page">
      <PageHeader
        title="Statutory and regulatory register"
        subtitle={reg.data ? `${reg.data.obligations.length} obligations · ${overdue.length} overdue · ${confirmItems.length} awaiting legal confirmation` : 'Loading the register'}
        actions={<a className="btn" href="/compliance/calendar">Calendar</a>}
      />

      {overdue.length > 0 && <Banner kind="crit">{overdue.length} obligation{overdue.length > 1 ? 's are' : ' is'} past due without a recorded submission.</Banner>}
      {reg.isError && <Banner kind="crit">The register could not be loaded. Refresh, or call platform support with reference compliance-register.</Banner>}

      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search instrument, section or obligation" aria-label="Search the register" style={{ minWidth: 320 }} />
        <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain">
          <option value="">All domains</option>
          {(reg.data?.domains ?? []).map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="muted small">{rows.length} shown</span>
      </div>

      <Card title="Register" extra="obligation → control → output → evidence">
        {reg.isLoading ? <Skeleton rows={8} /> : !rows.length ? <EmptyState>No obligations match this filter.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(o) => o.id}
            onRowClick={(o) => setOpen(o)}
            columns={[
              { key: 'instrument', header: 'Instrument', render: (o) => <><b>{o.instrument}</b>{o.section && <div className="small muted">{o.section}</div>}</> },
              { key: 'obligation', header: 'Obligation', render: (o) => <span className="small">{o.obligation}</span> },
              { key: 'entity', header: 'Responsible', render: (o) => <>{o.responsibleEntity}<div className="small muted">{o.ownerPersona}</div></> },
              { key: 'auto', header: 'Automation', render: (o) => <Chip kind={o.automation === 'A3' ? 'att' : 'neutral'}>{o.automation}</Chip> },
              { key: 'due', header: 'Due', render: (o) => o.dueDate ? <span className="mono">{o.dueDate}</span> : <span className="muted">continuous</span> },
              { key: 'state', header: 'State', render: (o) => <Chip kind={o.state === 'overdue' ? 'crit' : o.state === 'due' ? 'att' : 'done'}>{o.state}</Chip> },
              { key: 'status', header: '', render: (o) => o.status === 'confirm' ? <Chip kind="att">[confirm]</Chip> : null },
            ]}
          />
        )}
        <p className="note">The register is effective-dated reference data, not code: obligations, deadlines and form names change as configuration with an audit trail. Rows marked [confirm] carry an open item in the legal-review queue until an opinion is filed (M19-R-310).</p>
      </Card>

      {open && (
        <Sheet open onClose={() => setOpen(null)} title={`${open.instrument}${open.section ? ` · ${open.section}` : ''}`}>
          <KV items={[
            ['Obligation', open.obligation],
            ['Responsible entity', open.responsibleEntity],
            ['Owner persona', open.ownerPersona],
            ['Trigger', open.trigger ?? '—'],
            ['Control', open.control ?? '—'],
            ['Output', open.output ?? '—'],
            ['Evidence', open.evidence ?? '—'],
            ['Automation', `${open.automation} · external submissions are never above A2`],
            ['Frequency', open.frequency.replace(/_/g, ' ')],
            ['Due', open.dueDate ?? 'continuous'],
            ['Last done', open.lastDoneAt ?? 'not recorded'],
            ['Version', `v${open.version}`],
            ['Legal status', open.status === 'confirm' ? 'awaiting legal confirmation [confirm]' : 'confirmed'],
          ]} />
          <Card title="Record a submission">
            <div className="row-flex" style={{ alignItems: 'flex-end' }}>
              <Field label="Date discharged"><Input type="date" value={doneAt} onChange={(e) => setDoneAt(e.target.value)} /></Field>
              <Field label="Submission reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Portal or courier reference" /></Field>
              <Button variant="primary" disabled={!doneAt || record.isPending} onClick={() => record.mutate({ id: open.id, body: { lastDoneAt: doneAt, submissionRef: ref || undefined } })}>Record</Button>
            </div>
            <p className="note">Recording a submission closes the calendar item and stores the evidence reference against this obligation.</p>
          </Card>
        </Sheet>
      )}
    </div>
  );
}
