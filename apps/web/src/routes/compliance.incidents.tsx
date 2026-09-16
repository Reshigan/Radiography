import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Sheet, Field, Input, Select, TextArea, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import { IncidentTimeline, type Incident } from './compliance.index';

export const Route = createFileRoute('/compliance/incidents')({ component: IncidentsPage });

const CATEGORIES = ['radiation_wrong_patient', 'radiation_wrong_site', 'radiation_overexposure', 'contrast_reaction', 'data_breach', 'mri_safety', 'fall', 'needle_stick', 'equipment', 'critical_result_failure', 'ai_performance', 'near_miss'];

function IncidentsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [closing, setClosing] = useState<Incident | null>(null);
  const [form, setForm] = useState({ category: 'near_miss', severity: 3, title: '', description: '' });
  const [learning, setLearning] = useState('');

  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api.get<{ incidents: Incident[] }>('/compliance/incidents') });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string; ref: string }>('/compliance/incidents', form),
    onSuccess: (r) => { setReporting(false); setSelected(r.id); setForm({ category: 'near_miss', severity: 3, title: '', description: '' }); void qc.invalidateQueries({ queryKey: ['incidents'] }); },
  });
  const close = useMutation({
    mutationFn: (id: string) => api.post(`/compliance/incidents/${id}/close`, { learningSummary: learning }),
    onSuccess: () => { setClosing(null); setLearning(''); void qc.invalidateQueries({ queryKey: ['incidents'] }); },
  });

  const rows = incidents.data?.incidents ?? [];
  const current = rows.find((i) => i.id === selected) ?? rows.find((i) => i.status !== 'closed') ?? rows[0] ?? null;
  const open = rows.filter((i) => i.status !== 'closed');

  return (
    <div className="page">
      <PageHeader
        title="Incidents"
        subtitle={`${open.length} open · ${rows.filter((i) => i.severity <= 2 && i.status !== 'closed').length} at severity 1 or 2`}
        actions={<Button variant="primary" onClick={() => setReporting(true)}>Report an incident</Button>}
      />

      {incidents.isError && <Banner kind="crit">Incidents could not be loaded. Refresh, or call platform support with reference compliance-incidents.</Banner>}
      <Banner kind="info">Just culture: incident data never triggers discipline, reporter identity is protected and learning summaries are de-identified before they are shared across the Group.</Banner>

      <div className="split">
        <Card title="Incident register" extra={`${rows.length} records`}>
          {incidents.isLoading ? <Skeleton rows={6} /> : !rows.length ? <EmptyState>No incidents recorded.</EmptyState> : (
            <DataTable
              rows={rows}
              rowKey={(i) => i.id}
              selectedKey={current?.id}
              onRowClick={(i) => setSelected(i.id)}
              columns={[
                { key: 'ref', header: 'Reference', render: (i) => <span className="mono">{i.ref}</span> },
                { key: 'cat', header: 'Category', render: (i) => <>{i.category.replace(/_/g, ' ')}<div className="small muted">{i.title}</div></> },
                { key: 'sev', header: 'Severity', num: true, render: (i) => <Chip kind={i.severity <= 2 ? 'crit' : 'att'}>{i.severity}</Chip> },
                { key: 'status', header: 'Status', render: (i) => <StatusChip status={i.status} /> },
                { key: 'report', header: 'Report', render: (i) => !i.reportDraft || i.reportDraft.status === 'none' ? <span className="muted">—</span> : <Chip kind={i.reportDraft.status === 'submitted' ? 'done' : 'att'}>{i.reportDraft.status.replace(/_/g, ' ')}</Chip> },
                { key: 'when', header: 'Reported', render: (i) => <DateTime iso={i.reportedAt} time={false} /> },
              ]}
            />
          )}
        </Card>

        <Card
          title={current ? `${current.ref} · ${current.title}` : 'Select an incident'}
          extra={current && current.status !== 'closed' ? <Button size="sm" onClick={() => setClosing(current)}>Close</Button> : current ? <Chip kind="done">closed</Chip> : undefined}
        >
          {incidents.isLoading ? <Skeleton rows={6} /> : current ? <IncidentTimeline incident={current} /> : <EmptyState>Choose an incident from the register.</EmptyState>}
        </Card>
      </div>

      {reporting && (
        <Sheet open onClose={() => setReporting(false)} title="Report an incident">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Severity (1 is highest)">
            <Select value={String(form.severity)} onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="What happened"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="One line" /></Field>
          <Field label="Detail" hint="The Platform attaches the study, modality, dose and worklist context automatically."><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={form.title.trim().length < 4 || create.isPending} onClick={() => create.mutate()}>Report</Button>
            <Button onClick={() => setReporting(false)}>Cancel</Button>
          </div>
          {create.isError && <Banner kind="crit">{(create.error as Error).message}</Banner>}
        </Sheet>
      )}

      {closing && (
        <Sheet open onClose={() => setClosing(null)} title={`Close ${closing.ref}`}>
          {closing.severity <= 2 && (!closing.rca || !(closing.correctiveActions ?? []).length) && (
            <Banner kind="crit">A severity 1 or 2 incident cannot be closed without a completed root-cause analysis and at least one corrective action.</Banner>
          )}
          <Field label="Learning summary (de-identified, shared across the Group)"><TextArea value={learning} onChange={(e) => setLearning(e.target.value)} placeholder="What changed as a result" /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={learning.trim().length < 10 || close.isPending} onClick={() => close.mutate(closing.id)}>Close incident</Button>
            <Button onClick={() => setClosing(null)}>Cancel</Button>
          </div>
          {close.isError && <Banner kind="crit">{(close.error as Error).message}</Banner>}
        </Sheet>
      )}
    </div>
  );
}
