import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, Skeleton, EmptyState, DataTable } from '@bonakala/bdl';
import { api } from '../lib/api';
import { CalendarStrip, type CalendarItem } from './compliance.index';

export const Route = createFileRoute('/compliance/calendar')({ component: CalendarPage });

function CalendarPage() {
  const qc = useQueryClient();
  const [days, setDays] = useState(90);
  const cal = useQuery({ queryKey: ['cmp-calendar', days], queryFn: () => api.get<{ items: CalendarItem[]; leadDays: number[]; days: number }>(`/compliance/calendar?days=${days}`) });
  const generate = useMutation({ mutationFn: () => api.post<{ generated: number }>('/compliance/calendar/generate'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['cmp-calendar'] }) });

  const items = cal.data?.items ?? [];
  const overdue = items.filter((i) => i.state === 'overdue');
  const soon = items.filter((i) => (i.daysToDue ?? 999) >= 0 && (i.daysToDue ?? 999) <= 30);

  return (
    <div className="page">
      <PageHeader
        title="Regulatory calendar"
        subtitle={`${items.length} items in the window · lead times ${(cal.data?.leadDays ?? [90, 60, 30, 7]).join(' / ')} days`}
        actions={
          <>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window" className="btn">
              <option value={90}>Next 90 days</option>
              <option value={180}>Next 180 days</option>
              <option value={365}>Next year</option>
            </select>
            <Button variant="primary" disabled={generate.isPending} onClick={() => generate.mutate()}>Refresh calendar</Button>
          </>
        }
      />

      {overdue.length > 0 && <Banner kind="crit">{overdue.length} item{overdue.length > 1 ? 's are' : ' is'} overdue. Overdue items escalate to the assignee, then compliance, then the executive.</Banner>}
      {cal.isError && <Banner kind="crit">The calendar could not be loaded. Refresh, or call platform support with reference compliance-calendar.</Banner>}
      {generate.isSuccess && <Banner kind="ok">Calendar refreshed: {generate.data.generated} new lead items created from the register.</Banner>}

      <Card title="Next 90 days" extra="generated from effective-dated records">
        {cal.isLoading ? <Skeleton rows={4} /> : !items.length ? <EmptyState>No calendar items in this window.</EmptyState> : <CalendarStrip items={items} />}
      </Card>

      <Card title={`Due within 30 days (${soon.length})`}>
        {cal.isLoading ? <Skeleton rows={5} /> : !soon.length ? <EmptyState>Nothing due in the next 30 days.</EmptyState> : (
          <DataTable
            rows={soon}
            rowKey={(i) => `${i.obligationId}:${i.dueDate}`}
            columns={[
              { key: 'due', header: 'Due', render: (i) => <span className="mono">{i.dueDate}</span> },
              { key: 'in', header: 'In', num: true, render: (i) => <span className="mono">{i.daysToDue} d</span> },
              { key: 'instrument', header: 'Instrument', render: (i) => <><b>{i.instrument}</b><div className="small muted">{i.title}</div></> },
              { key: 'owner', header: 'Owner', render: (i) => i.owner },
              { key: 'auto', header: 'Automation', render: (i) => <Chip kind={i.automation === 'A1' ? 'neutral' : 'att'}>{i.automation}</Chip> },
              { key: 'evidence', header: 'Evidence', num: true, render: (i) => <span className="mono">{i.evidenceCount}</span> },
              { key: 'leads', header: 'Leads fired', render: (i) => <span className="small mono">{i.leads.sort((a, b) => b - a).join(' · ')}</span> },
            ]}
          />
        )}
      </Card>

      {overdue.length > 0 && (
        <Card title="Overdue">
          <DataTable
            rows={overdue}
            rowKey={(i) => `${i.obligationId}:${i.dueDate}`}
            columns={[
              { key: 'due', header: 'Was due', render: (i) => <span className="mono">{i.dueDate}</span> },
              { key: 'late', header: 'Late by', num: true, render: (i) => <span className="mono">{Math.abs(i.daysToDue ?? 0)} d</span> },
              { key: 'instrument', header: 'Instrument', render: (i) => <>{i.instrument}<div className="small muted">{i.title}</div></> },
              { key: 'owner', header: 'Owner', render: (i) => i.owner },
              { key: 'act', header: '', render: () => <a className="btn sm" href="/compliance/register">Record submission</a> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
