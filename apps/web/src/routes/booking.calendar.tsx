import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Select, Input, Skeleton, EmptyState, Banner, Chip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/booking/calendar')({ component: Calendar });

interface Appt { id: string; startsAt: string; endsAt: string; time: string; roomId: string; status: string; patientLabel: string; procedureCode: string; procedureDescription: string | null; funding: { status: string; authStatus: string | null } | null }
interface Room { id: string; name: string; roomType: string; siteId: string; blocked: string[] }

const HOURS = Array.from({ length: 13 }, (_, i) => 7 + i); // 07:00 to 19:00

function Calendar() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
  const [date, setDate] = useState(today);
  const [siteId, setSiteId] = useState('');
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Array<{ id: string; name: string }> }>('/org/sites') });
  const cal = useQuery({ queryKey: ['calendar', date, siteId], queryFn: () => api.get<{ date: string; rooms: Room[]; appointments: Appt[] }>(`/scheduling/calendar?date=${date}${siteId ? `&siteId=${siteId}` : ''}`) });

  const rooms = cal.data?.rooms ?? [];
  const appts = cal.data?.appointments ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Calendar"
        subtitle="Room and day grid. Holds show for 10 minutes; blocked rooms show the reason."
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
              <option value="">All sites</option>
              {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </>
        }
      />
      {cal.isError && <Banner kind="crit">The calendar could not be loaded.</Banner>}
      {cal.isLoading ? <Skeleton rows={8} /> : rooms.length === 0 ? <EmptyState>No rooms for this site.</EmptyState> : (
        <Card title={cal.data!.date} extra={`${appts.length} appointments`}>
          <div style={{ overflowX: 'auto' }}>
            <div className="cal" style={{ gridTemplateColumns: `60px repeat(${rooms.length}, minmax(140px, 1fr))`, minWidth: 120 + rooms.length * 150 }}>
              <div className="h" />
              {rooms.map((r) => (
                <div key={r.id} className="h">
                  {r.name} · {r.roomType}
                  {r.blocked.length > 0 && <div className="note" style={{ color: 'var(--crit)' }}>{r.blocked.join('; ')}</div>}
                </div>
              ))}
              {HOURS.map((h) => (
                <Row key={h} hour={h} rooms={rooms} appts={appts} />
              ))}
            </div>
          </div>
          <div className="row-flex" style={{ marginTop: 10 }}>
            <Chip kind="active">booked</Chip><Chip kind="att">held or awaiting authorisation</Chip><Chip kind="done">done</Chip><Chip kind="crit">no-show or blocked</Chip>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ hour, rooms, appts }: { hour: number; rooms: Room[]; appts: Appt[] }) {
  return (
    <>
      <div className="t">{String(hour).padStart(2, '0')}:00</div>
      {rooms.map((r) => {
        const inHour = appts.filter((a) => a.roomId === r.id && Number(a.time.slice(0, 2)) === hour);
        return (
          <div key={r.id} className="c">
            {inHour.slice(0, 2).map((a, i) => {
              const tone = a.status === 'no_show' ? 'crit' : a.status === 'done' ? 'ok' : a.status === 'held' || a.funding?.authStatus === 'requested' ? 'warn' : '';
              return (
                <span key={a.id} className={`ev ${tone}`} style={{ top: 2 + i * 20, height: 18 }} title={`${a.time} ${a.patientLabel} · ${a.procedureDescription ?? a.procedureCode} · ${a.status}`}>
                  {a.time} {a.patientLabel || a.procedureCode}
                </span>
              );
            })}
            {inHour.length > 2 && <span className="ev" style={{ top: 42, height: 18 }}>+{inHour.length - 2} more</span>}
          </div>
        );
      })}
    </>
  );
}
