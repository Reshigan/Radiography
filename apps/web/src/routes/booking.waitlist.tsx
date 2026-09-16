import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Button, Banner, Chip, StatusChip, DataTable, Skeleton, EmptyState, Field, Input, Select } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/booking/waitlist')({ component: Waitlist });

interface Entry { id: string; orderId: string; patientId: string; procedure: string; procedureCode: string; modalityType: string; siteId: string | null; priority: string; status: string; flexibility: string; waitingDays: number; offersMade: number; offerExpiresAt: string | null; patient: { firstName: string; lastName: string; mobile: string | null } | null }

function Waitlist() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Entry | null>(null);
  const [roomId, setRoomId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const list = useQuery({ queryKey: ['waitlist'], queryFn: () => api.get<{ waitlist: Entry[] }>('/scheduling/waitlist') });
  const slots = useQuery({
    queryKey: ['wl-slots', selected?.id],
    queryFn: () => api.get<{ offers: Array<{ roomId: string; startsAt: string; siteName: string; distanceKm: number | null }> }>(`/scheduling/earliest?orderId=${selected!.orderId}&limit=5`),
    enabled: !!selected,
  });
  const offer = useMutation({
    mutationFn: () => api.post(`/scheduling/waitlist/${selected!.id}/offer`, { roomId, startsAt }),
    onSuccess: () => { setSelected(null); void qc.invalidateQueries({ queryKey: ['waitlist'] }); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/scheduling/waitlist/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['waitlist'] }) });

  return (
    <div className="page">
      <PageHeader title="Waitlist" subtitle="Ranked by urgency, then waiting time. Offers are held for 15 minutes." />
      {list.isError && <Banner kind="crit">The waitlist could not be loaded.</Banner>}
      <Card title="Waiting" extra={`${list.data?.waitlist.length ?? 0} entries`}>
        {list.isLoading ? <Skeleton rows={6} /> : (list.data?.waitlist.length ?? 0) === 0 ? <EmptyState>Nobody is waiting for a slot.</EmptyState> : (
          <DataTable
            rows={list.data!.waitlist}
            rowKey={(w) => w.id}
            selectedKey={selected?.id}
            onRowClick={(w) => { setSelected(w); setRoomId(''); setStartsAt(''); }}
            columns={[
              { key: 'priority', header: 'Priority', render: (w) => <Chip kind={w.priority === 'routine' ? 'neutral' : 'crit'}>{w.priority}</Chip> },
              { key: 'patient', header: 'Patient', render: (w) => (w.patient ? `${w.patient.lastName}, ${w.patient.firstName}` : '—') },
              { key: 'proc', header: 'Procedure', render: (w) => w.procedure },
              { key: 'flex', header: 'Availability', render: (w) => w.flexibility },
              { key: 'waiting', header: 'Waiting', num: true, render: (w) => `${w.waitingDays} d` },
              { key: 'offers', header: 'Offers', num: true, render: (w) => w.offersMade },
              { key: 'status', header: 'Status', render: (w) => <StatusChip status={w.status} /> },
              { key: 'act', header: '', render: (w) => <Button size="sm" onClick={() => remove.mutate(w.id)}>Withdraw</Button> },
            ]}
          />
        )}
      </Card>

      {selected && (
        <Card title={`Offer a slot to ${selected.patient?.firstName ?? 'this patient'}`} extra={<Chip kind="att">{selected.procedure}</Chip>}>
          {slots.isLoading ? <Skeleton rows={3} /> : (slots.data?.offers.length ?? 0) === 0 ? <EmptyState>No open slot matches this entry yet.</EmptyState> : (
            <>
              <Field label="Available slots">
                <Select
                  value={`${roomId}|${startsAt}`}
                  onChange={(e) => { const [r, s] = e.target.value.split('|'); setRoomId(r ?? ''); setStartsAt(s ?? ''); }}
                >
                  <option value="|">Choose a slot</option>
                  {slots.data!.offers.map((o) => (
                    <option key={`${o.roomId}${o.startsAt}`} value={`${o.roomId}|${o.startsAt}`}>
                      {new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(o.startsAt))} · {o.siteName}{o.distanceKm != null ? ` · ${o.distanceKm} km` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Input type="hidden" value={startsAt} readOnly />
              <div className="row-flex">
                <Button variant="primary" disabled={!roomId || !startsAt || offer.isPending} onClick={() => offer.mutate()}>Hold and offer</Button>
                <Button onClick={() => setSelected(null)}>Close</Button>
              </div>
              {offer.isError && <Banner kind="crit">{(offer.error as Error).message}</Banner>}
              <p className="note">The patient gets a WhatsApp message with a 15-minute window. If they do not reply, the slot goes to the next candidate.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
