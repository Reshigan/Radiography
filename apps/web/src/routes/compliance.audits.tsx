import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Tabs, Sheet, Field, TextArea } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/compliance/audits')({ component: AuditsPage });

interface Finding { id: string; auditId: string; grade: string; description: string; owner: string | null; dueDate: string | null; status: string; capa: string | null }
interface Audit { id: string; ref: string; type: string; scope: string; auditor: string | null; scheduledAt: string | null; completedAt: string | null; status: string; findings: Finding[] }
interface Policy { id: string; title: string; category: string; version: number; effectiveDate: string; reviewDue: string | null; owner: string | null; appliesTo: string[] | null; mandatory: boolean; status: string; acknowledged: number; inScope: number; coveragePct: number | null }

function AuditsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('audits');
  const [closing, setClosing] = useState<Finding | null>(null);
  const [capa, setCapa] = useState('');

  const audits = useQuery({ queryKey: ['audits'], queryFn: () => api.get<{ audits: Audit[] }>('/compliance/audits') });
  const policies = useQuery({ queryKey: ['policies'], queryFn: () => api.get<{ policies: Policy[] }>('/compliance/policies') });
  const close = useMutation({
    mutationFn: (id: string) => api.post(`/compliance/findings/${id}/close`, { capa }),
    onSuccess: () => { setClosing(null); setCapa(''); void qc.invalidateQueries({ queryKey: ['audits'] }); },
  });

  const allFindings = (audits.data?.audits ?? []).flatMap((a) => a.findings.map((f) => ({ ...f, auditRef: a.ref, auditType: a.type })));
  const openFindings = allFindings.filter((f) => f.status === 'open');
  const majorOverdue = openFindings.filter((f) => f.grade === 'major' && f.dueDate && f.dueDate < new Date().toISOString().slice(0, 10));
  const lowCoverage = (policies.data?.policies ?? []).filter((p) => p.mandatory && (p.coveragePct ?? 100) < 98);

  return (
    <div className="page">
      <PageHeader title="Audits and policies" subtitle={`${openFindings.length} open findings · ${policies.data?.policies.length ?? 0} controlled policies`} />

      {majorOverdue.length > 0 && <Banner kind="crit">{majorOverdue.length} major finding{majorOverdue.length > 1 ? 's are' : ' is'} past its due date.</Banner>}
      {lowCoverage.length > 0 && <Banner kind="warn">{lowCoverage.length} mandatory polic{lowCoverage.length > 1 ? 'ies are' : 'y is'} below 98 % acknowledgement coverage. Unacknowledged policies restrict nothing clinical; patients come first.</Banner>}
      {audits.isError && <Banner kind="crit">Audits could not be loaded. Refresh, or call platform support with reference compliance-audits.</Banner>}

      <Tabs tabs={[{ id: 'audits', label: `Audits (${audits.data?.audits.length ?? 0})` }, { id: 'findings', label: `Findings (${openFindings.length})` }, { id: 'policies', label: 'Policies' }]} active={tab} onChange={setTab} />

      {tab === 'audits' && (
        <Card title="Audit programme">
          {audits.isLoading ? <Skeleton rows={5} /> : !audits.data?.audits.length ? <EmptyState>No audits scheduled.</EmptyState> : (
            <DataTable
              rows={audits.data.audits}
              rowKey={(a) => a.id}
              columns={[
                { key: 'ref', header: 'Reference', render: (a) => <span className="mono">{a.ref}</span> },
                { key: 'type', header: 'Type', render: (a) => <Chip>{a.type}</Chip> },
                { key: 'scope', header: 'Scope', render: (a) => <span className="small">{a.scope}</span> },
                { key: 'auditor', header: 'Auditor', render: (a) => a.auditor ?? <span className="muted">—</span> },
                { key: 'when', header: 'Scheduled', render: (a) => a.scheduledAt ? <span className="mono">{a.scheduledAt}</span> : <span className="muted">—</span> },
                { key: 'findings', header: 'Findings', num: true, render: (a) => <span className="mono">{a.findings.filter((f) => f.status === 'open').length} open of {a.findings.length}</span> },
                { key: 'status', header: 'Status', render: (a) => <StatusChip status={a.status} /> },
              ]}
            />
          )}
          <p className="note">A regulator inspection pack for a site is generated in under five minutes from the compliance board, with every document current at the time of generation and an index of evidence hashes (M19-R-108).</p>
        </Card>
      )}

      {tab === 'findings' && (
        <Card title="Findings" extra={`${openFindings.length} open`}>
          {audits.isLoading ? <Skeleton rows={5} /> : !allFindings.length ? <EmptyState>No findings raised.</EmptyState> : (
            <DataTable
              rows={allFindings}
              rowKey={(f) => f.id}
              columns={[
                { key: 'audit', header: 'Audit', render: (f) => <><span className="mono">{f.auditRef}</span><div className="small muted">{f.auditType}</div></> },
                { key: 'grade', header: 'Grade', render: (f) => <Chip kind={f.grade === 'major' ? 'crit' : f.grade === 'minor' ? 'att' : 'neutral'}>{f.grade}</Chip> },
                { key: 'desc', header: 'Finding', render: (f) => <span className="small">{f.description}</span> },
                { key: 'owner', header: 'Owner', render: (f) => f.owner ?? <span className="muted">—</span> },
                { key: 'due', header: 'Due', render: (f) => f.dueDate ? <span className={`mono ${f.dueDate < new Date().toISOString().slice(0, 10) && f.status === 'open' ? '' : 'muted'}`}>{f.dueDate}</span> : <span className="muted">—</span> },
                { key: 'status', header: 'Status', render: (f) => f.status === 'open' ? <Button size="sm" onClick={() => setClosing(f)}>Close with CAPA</Button> : <Chip kind="done">closed</Chip> },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'policies' && (
        <Card title="Policy library">
          {policies.isLoading ? <Skeleton rows={5} /> : !policies.data?.policies.length ? <EmptyState>No policies published.</EmptyState> : (
            <DataTable
              rows={policies.data.policies}
              rowKey={(p) => p.id}
              columns={[
                { key: 'title', header: 'Policy', render: (p) => <><b>{p.title}</b><div className="small muted">{p.category}</div></> },
                { key: 'version', header: 'Version', render: (p) => <span className="mono">v{p.version}</span> },
                { key: 'effective', header: 'Effective', render: (p) => <span className="mono">{p.effectiveDate}</span> },
                { key: 'review', header: 'Review due', render: (p) => p.reviewDue ? <span className="mono">{p.reviewDue}</span> : <span className="muted">—</span> },
                { key: 'scope', header: 'Applies to', render: (p) => <span className="small">{(p.appliesTo ?? []).join(', ') || 'all staff'}</span> },
                { key: 'cov', header: 'Acknowledged', num: true, render: (p) => p.coveragePct === null ? <span className="muted">—</span> : <Chip kind={p.coveragePct >= 98 ? 'done' : 'att'}>{p.acknowledged}/{p.inScope} · {p.coveragePct} %</Chip> },
              ]}
            />
          )}
          <p className="note">An acknowledgement binds to a policy version. Coverage is reported per policy version by role and site (M19-R-103).</p>
        </Card>
      )}

      {closing && (
        <Sheet open onClose={() => setClosing(null)} title="Close finding with a corrective action">
          <p className="small">{closing.description}</p>
          <Field label="Corrective and preventive action, with the evidence of completion"><TextArea value={capa} onChange={(e) => setCapa(e.target.value)} /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={capa.trim().length < 5 || close.isPending} onClick={() => close.mutate(closing.id)}>Close finding</Button>
            <Button onClick={() => setClosing(null)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
