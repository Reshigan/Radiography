import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Card, Chip, DateTime, EmptyState, PageHeader, Queue, Skeleton, StatusChip, Tile } from '@bonakala/bdl';
import { formatSast } from '@bonakala/domain';
import { api } from '../lib/api';

export const Route = createFileRoute('/tech/')({ component: RoomWorklist });

interface Item {
  id: string; scheduledAt: string; status: string; modalityType: string; roomId: string; siteId: string; procedureCode: string; procedureDescription: string | null;
  laterality: string | null; contrast: boolean; priority: string; indication: string | null; protocolId: string | null; protocolSource: string | null; accession: string | null; studyId: string | null; emergency: boolean;
  safetyGate: { allowed: boolean; pregnancy?: string; egfr?: number | null; allergies?: string; metformin?: string } | null;
  identityCheck: { checkedAt: string } | null;
  patient: { firstName: string; lastName: string; sex: string | null; dateOfBirth: string | null; flags: string[] | null } | null;
}
interface Room { id: string; name: string; roomType: string; siteId: string; licenceNo: string | null; licenceExpiry: string | null; modality: { type: string; status: string; aeTitle: string | null } | null; qaBlocked: Array<{ testType: string; dueAt: string }> }

export function patientAge(dob: string | null | undefined) {
  return dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400_000)) : null;
}

function RoomWorklist() {
  const navigate = useNavigate();
  const [siteId, setSiteId] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('');
  const rooms = useQuery({ queryKey: ['tech-rooms'], queryFn: () => api.get<{ sites: Array<{ id: string; code: string; name: string }>; rooms: Room[] }>('/acquisition/rooms') });
  useEffect(() => {
    if (!siteId && rooms.data?.sites[0]) setSiteId(rooms.data.sites[0].id);
  }, [rooms.data, siteId]);
  const wl = useQuery({
    queryKey: ['tech-worklist', siteId, roomId],
    queryFn: () => api.get<{ date: string; items: Item[]; unmatched: Array<{ id: string; accession: string; receivedAt: string; modality: string }> }>(`/acquisition/worklist?${siteId ? `siteId=${siteId}` : ''}${roomId ? `&roomId=${roomId}` : ''}`),
    enabled: !!siteId,
    refetchInterval: 30_000,
  });
  const siteRooms = (rooms.data?.rooms ?? []).filter((r) => !siteId || r.siteId === siteId);
  const blockedRooms = siteRooms.filter((r) => r.qaBlocked.length > 0);
  const items = wl.data?.items ?? [];
  const done = items.filter((x) => x.status === 'completed').length;

  return (
    <div className="page">
      <PageHeader
        title="Room worklist"
        subtitle="Modality worklist for the selected room and day. Identity and safety are recorded before any exposure."
        actions={
          <>
            <select value={siteId} onChange={(e) => { setSiteId(e.target.value); setRoomId(''); }} aria-label="Site" style={{ height: 32 }}>
              {(rooms.data?.sites ?? []).map((sx) => <option key={sx.id} value={sx.id}>{sx.name}</option>)}
            </select>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Room" style={{ height: 32 }}>
              <option value="">All rooms</option>
              {siteRooms.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.roomType}</option>)}
            </select>
          </>
        }
      />
      {wl.isError && <Banner kind="crit">The worklist could not be loaded. {(wl.error as Error).message}</Banner>}
      {blockedRooms.map((r) => (
        <Banner key={r.id} kind="crit">{r.name} is blocked: overdue {r.qaBlocked.map((q) => q.testType.replace(/_/g, ' ')).join(', ')}. Scheduling on this room stops until the test is recorded or a compliance override is granted.</Banner>
      ))}
      {siteRooms.some((r) => r.modality?.status === 'down') && (
        <Banner kind="warn">{siteRooms.filter((r) => r.modality?.status === 'down').map((r) => r.name).join(', ')} reported down. Affected studies need a re-routing plan from the practice manager.</Banner>
      )}
      {(wl.isLoading || rooms.isLoading) && <Skeleton rows={6} />}
      {wl.data && (
        <>
          <div className="grid g4">
            <Tile label="Scheduled today" value={items.length} delta={wl.data.date} />
            <Tile label="Completed" value={done} />
            <Tile label="Waiting" value={items.filter((x) => x.status === 'arrived' || x.status === 'in_room').length} />
            <Tile label="Unmatched studies" value={wl.data.unmatched.length} tone={wl.data.unmatched.length ? 'down' : undefined} />
          </div>
          {items.length === 0 ? (
            <EmptyState>Nothing is booked in this room today.</EmptyState>
          ) : (
            <Queue
              rows={items}
              rowKey={(x) => x.id}
              onSelect={(x) => void navigate({ to: '/tech/study/$id', params: { id: x.id } })}
              render={(x) => {
                const flags: string[] = [];
                if (x.safetyGate?.pregnancy && x.safetyGate.pregnancy !== 'n/a') flags.push(`Pregnancy: ${x.safetyGate.pregnancy}`);
                if (x.contrast) flags.push(x.safetyGate?.egfr ? `eGFR ${x.safetyGate.egfr}` : 'eGFR: none on file');
                if ((x.patient?.flags ?? []).includes('contrast_reaction')) flags.push('Previous contrast reaction');
                if (x.identityCheck) flags.push('Identity checked');
                if (!x.protocolId) flags.push('Protocol pending');
                const ageY = patientAge(x.patient?.dateOfBirth);
                return {
                  lead: <span className="mono small">{formatSast(x.scheduledAt, { date: false })}</span>,
                  title: <>{x.patient ? `${x.patient.lastName}, ${x.patient.firstName}` : 'Unknown'} <span className="muted">· {ageY ?? '—'} {x.patient?.sex ?? ''}</span></>,
                  sub: <>{x.procedureDescription}{x.laterality ? ` · ${x.laterality}` : ''} · {x.indication ?? 'no indication recorded'}</>,
                  aux: (
                    <>
                      {x.priority === 'stat' && <Chip kind="crit">STAT</Chip>}
                      {x.emergency && <Chip kind="crit">Emergency</Chip>}
                      <StatusChip status={x.status} />
                      {flags.map((f) => <span key={f} className="chip"><i />{f}</span>)}
                      {x.accession && <span className="mono small">{x.accession}</span>}
                    </>
                  ),
                };
              }}
            />
          )}
          {wl.data.unmatched.length > 0 && (
            <Card title="Unmatched studies" extra="acquired without a worklist entry">
              <Queue
                rows={wl.data.unmatched}
                rowKey={(x) => x.id}
                render={(x) => ({
                  lead: <Chip kind="att">Reconcile</Chip>,
                  title: <span className="mono">{x.accession}</span>,
                  sub: <>{x.modality} · acquired <DateTime iso={x.receivedAt} /></>,
                  aux: <span className="muted small">Bind to a worklist entry before any result may attach to a patient.</span>,
                })}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
