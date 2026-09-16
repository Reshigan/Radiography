import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Card, Chip, DateTime, EmptyState, PageHeader, Queue, Skeleton } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/read/patients')({ component: Patients });

interface Patient { id: string; firstName: string; lastName: string; sex: string | null; dateOfBirth: string | null; epid: string; reports: Array<{ id: string; accession: string; signedAt: string | null; critical: boolean }> }

function Patients() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: ['read-patients', q], queryFn: () => api.get<{ patients: Patient[] }>(`/reporting/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  return (
    <div className="page">
      <PageHeader title="Patients I have reported" subtitle="Reported studies grouped by patient, newest first." actions={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or enterprise id" style={{ height: 32, minWidth: 260 }} aria-label="Search patients" />} />
      {query.isError && <Banner kind="crit">Patients could not be loaded. {(query.error as Error).message}</Banner>}
      {query.isLoading && <Skeleton rows={5} />}
      {query.data && (query.data.patients.length === 0 ? <EmptyState>No patients match this search.</EmptyState> : (
        <Card title={`${query.data.patients.length} patients`}>
          <Queue
            rows={query.data.patients}
            rowKey={(p) => p.id}
            render={(p) => ({
              lead: <Chip>{p.reports.length}</Chip>,
              title: <>{p.lastName}, {p.firstName} <span className="muted small mono">· {p.epid}</span></>,
              sub: <>{p.sex ?? ''} {p.dateOfBirth ?? ''} · latest <DateTime iso={p.reports[0]?.signedAt ?? null} time={false} /></>,
              aux: (
                <>
                  {p.reports.some((r) => r.critical) && <Chip kind="crit">critical result</Chip>}
                  {p.reports.slice(0, 3).map((r) => (
                    <button key={r.id} className="link mono small" onClick={(e) => { e.stopPropagation(); void navigate({ to: '/read/study/$id', params: { id: r.id } }); }}>{r.accession}</button>
                  ))}
                </>
              ),
            })}
          />
        </Card>
      ))}
    </div>
  );
}
