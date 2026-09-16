import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DataTable, DateTime, EmptyState, PageHeader, Skeleton, Tile } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/tech/qa')({ component: QA });

interface Test { id: string; roomId: string; siteId: string; modalityType: string; testType: string; frequency: string; blocking: boolean; dueAt: string; doneAt: string | null; result: string | null; state: string; rpoSignedAt: string | null; notes: string | null }
interface Room { id: string; name: string; siteId: string; siteCode: string | null; roomType: string; licenceNo: string | null; licenceExpiry: string | null }

function QA() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['qa', filter], queryFn: () => api.get<{ tests: Test[]; rooms: Room[]; overdue: number; blocking: number }>(`/dose/qa${filter ? `?status=${filter}` : ''}`) });
  const record = useMutation({ mutationFn: (v: { id: string; result: 'pass' | 'fail' }) => api.post(`/dose/qa/${v.id}/record`, { result: v.result, values: { measured: 'within tolerance' } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['qa'] }) });

  const roomName = (id: string) => {
    const r = q.data?.rooms.find((x) => x.id === id);
    return r ? `${r.siteCode ?? ''} ${r.name}`.trim() : id;
  };
  return (
    <div className="page">
      <PageHeader
        title="QA schedule"
        subtitle="Daily, weekly and annual tests with evidence and radiation protection officer sign-off. An overdue blocking test stops scheduling on the room."
        actions={<select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter" style={{ height: 32 }}><option value="">All tests</option><option value="overdue">Overdue</option><option value="due">Due</option><option value="done">Completed</option><option value="failed">Failed</option></select>}
      />
      {q.isError && <Banner kind="crit">The QA schedule could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (
        <>
          {q.data.blocking > 0 && <Banner kind="crit">{q.data.blocking} overdue blocking {q.data.blocking === 1 ? 'test' : 'tests'}. The affected rooms cannot take bookings until the test is recorded or compliance grants an override with a reason.</Banner>}
          <div className="grid g3">
            <Tile label="Scheduled tests" value={q.data.tests.length} />
            <Tile label="Overdue" value={q.data.overdue} tone={q.data.overdue ? 'down' : 'up'} />
            <Tile label="Blocking overdue" value={q.data.blocking} tone={q.data.blocking ? 'down' : 'up'} />
          </div>
          {q.data.tests.length === 0 ? <EmptyState>No tests match this filter.</EmptyState> : (
            <Card title="Tests">
              <DataTable
                rows={q.data.tests.slice(0, 150)}
                rowKey={(x) => x.id}
                columns={[
                  { key: 'room', header: 'Room', render: (x) => <>{roomName(x.roomId)} <span className="muted small">{x.modalityType}</span></> },
                  { key: 'test', header: 'Test', render: (x) => <>{x.testType.replace(/_/g, ' ')} {x.blocking && <Chip kind="att">blocking</Chip>}</> },
                  { key: 'freq', header: 'Frequency', render: (x) => x.frequency },
                  { key: 'due', header: 'Due', render: (x) => <DateTime iso={x.dueAt} time={false} /> },
                  { key: 'state', header: 'State', render: (x) => <Chip kind={x.state === 'overdue' || x.state === 'failed' ? 'crit' : x.state === 'due' ? 'att' : 'done'}>{x.state}</Chip> },
                  { key: 'sign', header: 'RPO sign-off', render: (x) => (x.rpoSignedAt ? <DateTime iso={x.rpoSignedAt} time={false} /> : <span className="muted">—</span>) },
                  { key: 'act', header: '', render: (x) => (x.doneAt ? <span className="muted small">{x.result}</span> : <span className="row-flex"><Button size="sm" onClick={() => record.mutate({ id: x.id, result: 'pass' })}>Pass</Button><Button size="sm" onClick={() => record.mutate({ id: x.id, result: 'fail' })}>Fail</Button></span>) },
                ]}
              />
            </Card>
          )}
          <Card title="Radiation licences per room">
            <DataTable
              rows={q.data.rooms}
              rowKey={(x) => x.id}
              empty="No rooms."
              columns={[
                { key: 'name', header: 'Room', render: (x) => `${x.siteCode ?? ''} ${x.name}`.trim() },
                { key: 'type', header: 'Type', render: (x) => x.roomType },
                { key: 'lic', header: 'Licence', render: (x) => (x.licenceNo ? <span className="mono">{x.licenceNo}</span> : <span className="muted">not required</span>) },
                { key: 'exp', header: 'Expires', render: (x) => (x.licenceExpiry ? <Chip kind={new Date(x.licenceExpiry) < new Date(Date.now() + 90 * 86400000) ? 'att' : 'done'}>{x.licenceExpiry}</Chip> : <span className="muted">—</span>) },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
