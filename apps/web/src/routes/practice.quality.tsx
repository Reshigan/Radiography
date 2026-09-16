import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable, Tabs, SlaBar, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import { MetricTiles, DefinitionSheet, type MetricTile, type TilesResponse } from './practice.index';
import { type Incident, type Complaint, IncidentTimeline } from './compliance.index';

export const Route = createFileRoute('/practice/quality')({ component: QualityPage });

function QualityPage() {
  const [tab, setTab] = useState('incidents');
  const [define, setDefine] = useState<MetricTile | null>(null);
  const [open, setOpen] = useState<Incident | null>(null);
  const tiles = useQuery({ queryKey: ['tiles', 'compliance'], queryFn: () => api.get<TilesResponse>('/analytics/tiles?scope=compliance') });
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api.get<{ incidents: Incident[] }>('/compliance/incidents') });
  const complaints = useQuery({ queryKey: ['complaints'], queryFn: () => api.get<{ complaints: Complaint[] }>('/compliance/complaints') });
  const rr = useQuery({ queryKey: ['reportable'], queryFn: () => api.get<{ results: Array<{ id: string; ref: string; categoryLabel: string; patientMasked: string | null; status: string; ackOverdue: boolean; referrerName: string | null }>; note: string }>('/compliance/reportable-results') });

  const openIncidents = (incidents.data?.incidents ?? []).filter((i) => i.status !== 'closed');
  const severe = openIncidents.filter((i) => i.severity <= 2);

  return (
    <div className="page">
      <PageHeader title="Quality" subtitle="Incidents, complaints and the reportable-results register for this practice" actions={<a className="btn" href="/compliance">Compliance board</a>} />

      {severe.length > 0 && <Banner kind="crit">{severe.length} open incident{severe.length > 1 ? 's' : ''} at severity 1 or 2: {severe.map((i) => `${i.ref} ${i.title}`).join(' · ')}.</Banner>}
      {incidents.isError && <Banner kind="crit">Quality records could not be loaded. Refresh, or call platform support with reference compliance-incidents.</Banner>}

      <MetricTiles tiles={(tiles.data?.tiles ?? []).slice(0, 6)} loading={tiles.isLoading} columns="g6" onDefine={setDefine} />

      <Tabs tabs={[{ id: 'incidents', label: `Incidents (${openIncidents.length})` }, { id: 'complaints', label: `Complaints (${(complaints.data?.complaints ?? []).filter((c) => c.status !== 'closed').length})` }, { id: 'reportable', label: 'Reportable results' }]} active={tab} onChange={setTab} />

      {tab === 'incidents' && (
        <div className="split">
          <Card title="Incidents" extra={incidents.data ? `${incidents.data.incidents.length} total` : undefined}>
            {incidents.isLoading ? <Skeleton rows={5} /> : !incidents.data?.incidents.length ? <EmptyState>No incidents recorded.</EmptyState> : (
              <DataTable
                rows={incidents.data.incidents}
                rowKey={(i) => i.id}
                selectedKey={open?.id}
                onRowClick={(i) => setOpen(i)}
                columns={[
                  { key: 'ref', header: 'Reference', render: (i) => <span className="mono">{i.ref}</span> },
                  { key: 'cat', header: 'Category', render: (i) => i.category.replace(/_/g, ' ') },
                  { key: 'sev', header: 'Severity', num: true, render: (i) => <Chip kind={i.severity <= 2 ? 'crit' : 'att'}>{i.severity}</Chip> },
                  { key: 'status', header: 'Status', render: (i) => <StatusChip status={i.status} /> },
                  { key: 'reg', header: 'Regulator', render: (i) => i.regulator && i.regulator !== 'none' ? i.regulator : <span className="muted">none</span> },
                  { key: 'when', header: 'Reported', render: (i) => <DateTime iso={i.reportedAt} time={false} /> },
                ]}
              />
            )}
          </Card>
          <Card title={open ? `${open.ref} · ${open.title}` : 'Select an incident'}>
            {open ? <IncidentTimeline incident={open} /> : <EmptyState>Choose an incident to see its reconstructed timeline and corrective actions.</EmptyState>}
          </Card>
        </div>
      )}

      {tab === 'complaints' && (
        <Card title="Complaints" extra={complaints.data ? `${complaints.data.complaints.length} total` : undefined}>
          {complaints.isLoading ? <Skeleton rows={4} /> : !complaints.data?.complaints.length ? <EmptyState>No complaints recorded.</EmptyState> : (
            <DataTable
              rows={complaints.data.complaints}
              rowKey={(c) => c.id}
              columns={[
                { key: 'ref', header: 'Reference', render: (c) => <span className="mono">{c.ref}</span> },
                { key: 'route', header: 'Route', render: (c) => <>{c.route}{c.legalHold && <Chip kind="crit">legal hold</Chip>}</> },
                { key: 'cat', header: 'Category', render: (c) => c.category },
                { key: 'subject', header: 'Subject', render: (c) => c.subject },
                { key: 'sla', header: 'Respond by', render: (c) => <><span className="mono small">{c.respondBy.slice(0, 10)}</span><SlaBar pct={c.slaPct} /></> },
                { key: 'status', header: 'Status', render: (c) => <StatusChip status={c.status} /> },
              ]}
            />
          )}
          <p className="note">Acknowledge within one working day. Scheme and council routes carry their own deadlines, which take precedence.</p>
        </Card>
      )}

      {tab === 'reportable' && (
        <Card title="Reportable results for this practice">
          {rr.isLoading ? <Skeleton rows={4} /> : !rr.data?.results.length ? <EmptyState>No reportable-result flags raised.</EmptyState> : (
            <DataTable
              rows={rr.data.results}
              rowKey={(x) => x.id}
              columns={[
                { key: 'ref', header: 'Reference', render: (x) => <span className="mono">{x.ref}</span> },
                { key: 'cat', header: 'Category', render: (x) => x.categoryLabel },
                { key: 'patient', header: 'Patient', render: (x) => <span className="mono">{x.patientMasked ?? '—'}</span> },
                { key: 'ref2', header: 'Referrer', render: (x) => x.referrerName ?? <span className="muted">internal</span> },
                { key: 'status', header: 'Status', render: (x) => x.ackOverdue ? <Chip kind="crit">acknowledgement overdue</Chip> : <StatusChip status={x.status} /> },
              ]}
            />
          )}
          <p className="note">{rr.data?.note}</p>
        </Card>
      )}

      <DefinitionSheet tile={define} onClose={() => setDefine(null)} />
    </div>
  );
}
