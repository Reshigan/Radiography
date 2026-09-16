import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, DataTable, Skeleton, EmptyState, DateTime, Tabs } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/r/patients')({ component: MyPatients });

interface Order {
  id: string; orderNo: string; status: string; priority: string; createdAt: string; procedures: Array<{ description: string; modality: string; laterality?: string }>;
  patient: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; sex: string | null } | null;
  appointment: { id: string; startsAt: string; status: string; siteName?: string } | null;
  appropriateness: { band: string } | null;
}

function MyPatients() {
  const [tab, setTab] = useState('open');
  const q = useQuery({ queryKey: ['my-referrals'], queryFn: () => api.get<{ orders: Order[] }>('/referrals/my-referrals') });

  const all = q.data?.orders ?? [];
  const rows = tab === 'open' ? all.filter((o) => !['completed', 'cancelled'].includes(o.status))
    : tab === 'attention' ? all.filter((o) => o.appointment?.status === 'no_show' || o.status === 'cancelled' || o.appropriateness?.band === 'usually_not_appropriate')
      : all;

  return (
    <div className="page">
      <PageHeader title="My patients" subtitle="Every referral you sent, through the pipeline" />
      {q.isError && <Banner kind="crit">Your referrals could not be loaded.</Banner>}
      <Tabs
        tabs={[{ id: 'open', label: `Open (${all.filter((o) => !['completed', 'cancelled'].includes(o.status)).length})` }, { id: 'attention', label: 'Needs my action' }, { id: 'all', label: `All (${all.length})` }]}
        active={tab}
        onChange={setTab}
      />
      <Card title={tab === 'open' ? 'Open referrals' : tab === 'attention' ? 'Needs my action' : 'All referrals'}>
        {q.isLoading ? <Skeleton rows={8} /> : rows.length === 0 ? <EmptyState>Nothing here.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(o) => o.id}
            columns={[
              { key: 'patient', header: 'Patient', render: (o) => (o.patient ? <>{o.patient.lastName}, {o.patient.firstName}<div className="note">{o.patient.dateOfBirth ?? ''} {o.patient.sex ?? ''}</div></> : '—') },
              { key: 'proc', header: 'Procedure', render: (o) => <>{o.procedures[0]?.description}{o.procedures[0]?.laterality && o.procedures[0].laterality !== 'na' ? ` · ${o.procedures[0].laterality}` : ''}</> },
              { key: 'sent', header: 'Referred', render: (o) => <DateTime iso={o.createdAt} time={false} /> },
              { key: 'appt', header: 'Appointment', render: (o) => (o.appointment ? <><DateTime iso={o.appointment.startsAt} />{o.appointment.siteName ? <div className="note">{o.appointment.siteName}</div> : null}</> : <span className="muted">not booked</span>) },
              { key: 'status', header: 'Status', render: (o) => <StatusChip status={o.appointment?.status === 'no_show' ? 'no_show' : o.status} /> },
              { key: 'flags', header: '', render: (o) => <>{o.priority !== 'routine' && <Chip kind={o.priority === 'stat' ? 'crit' : 'att'}>{o.priority}</Chip>}{o.appropriateness?.band === 'usually_not_appropriate' && <Chip kind="att">guidance override</Chip>}</> },
            ]}
          />
        )}
      </Card>
      <p className="note">Attendance and no-shows are shown so you can follow up. WhatsApp tells you when a patient is booked, reported or does not attend.</p>
    </div>
  );
}
