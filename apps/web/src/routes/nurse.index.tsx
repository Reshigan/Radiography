import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Banner, Card, Chip, EmptyState, PageHeader, Queue, Skeleton, StatusChip, Tile } from '@bonakala/bdl';
import { formatSast } from '@bonakala/domain';
import { api } from '../lib/api';

export const Route = createFileRoute('/nurse/')({ component: PatientsToday });

export interface NurseItem {
  id: string; scheduledAt: string; status: string; contrast: boolean; procedureDescription: string | null; laterality: string | null; priority: string; siteId: string;
  safetyGate: { egfr?: number | null; allergies?: string; metformin?: string; pregnancy?: string } | null;
  patient: { firstName: string; lastName: string; sex: string | null; dateOfBirth: string | null; flags: string[] | null } | null;
  administration: { id: string; agent: string; volumeDeliveredMl: number | null; batchNo: string | null; status: string; reaction: { severity: string; symptoms: string } | null } | null;
}

export function nurseAge(dob: string | null | undefined) {
  return dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400_000)) : null;
}

function PatientsToday() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['nurse-today'], queryFn: () => api.get<{ items: NurseItem[] }>('/acquisition/contrast'), refetchInterval: 30_000 });
  const items = q.data?.items ?? [];
  const contrastCases = items.filter((x) => x.contrast);
  const reactions = items.filter((x) => x.administration?.reaction);

  return (
    <div className="page">
      <PageHeader title="Patients today" subtitle="Every patient in the department today, with the contrast cases and their intravenous status first." />
      {q.isError && <Banner kind="crit">Today's list could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={6} />}
      {q.data && (
        <>
          <div className="grid g4">
            <Tile label="Patients today" value={items.length} />
            <Tile label="Contrast cases" value={contrastCases.length} />
            <Tile label="Administered" value={contrastCases.filter((x) => x.administration?.status === 'administered').length} />
            <Tile label="Reactions recorded" value={reactions.length} tone={reactions.length ? 'down' : undefined} />
          </div>
          {contrastCases.length === 0 ? <EmptyState>No contrast cases are booked today.</EmptyState> : (
            <Card title="Contrast cases" extra="eGFR gate, allergies and metformin are re-checked before every injection">
              <Queue
                rows={contrastCases}
                rowKey={(x) => x.id}
                onSelect={() => void navigate({ to: '/nurse/contrast' })}
                render={(x) => ({
                  lead: <span className="mono small">{formatSast(x.scheduledAt, { date: false })}</span>,
                  title: <>{x.patient ? `${x.patient.lastName}, ${x.patient.firstName}` : 'Unknown'} <span className="muted">· {nurseAge(x.patient?.dateOfBirth) ?? '—'} {x.patient?.sex ?? ''}</span></>,
                  sub: <>{x.procedureDescription}</>,
                  aux: (
                    <>
                      <StatusChip status={x.status} />
                      {x.safetyGate?.egfr ? <Chip kind={x.safetyGate.egfr < 30 ? 'crit' : 'done'}>eGFR {x.safetyGate.egfr}</Chip> : <Chip kind="att">eGFR: none on file</Chip>}
                      {(x.patient?.flags ?? []).includes('contrast_reaction') && <Chip kind="crit">previous reaction</Chip>}
                      {x.administration ? <Chip kind="done">{x.administration.volumeDeliveredMl ?? 0} mL given</Chip> : <Chip>awaiting injection</Chip>}
                    </>
                  ),
                })}
              />
            </Card>
          )}
          <Card title="All patients today">
            <Queue
              rows={items}
              rowKey={(x) => `all-${x.id}`}
              render={(x) => ({
                lead: <span className="mono small">{formatSast(x.scheduledAt, { date: false })}</span>,
                title: x.patient ? `${x.patient.lastName}, ${x.patient.firstName}` : 'Unknown',
                sub: <>{x.procedureDescription}{x.contrast ? ' · contrast' : ''}</>,
                aux: <><StatusChip status={x.status} />{x.priority === 'stat' && <Chip kind="crit">STAT</Chip>}</>,
              })}
            />
          </Card>
        </>
      )}
    </div>
  );
}
