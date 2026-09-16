import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import { ApprovalsPanel, type HandTask } from './practice.index';

export const Route = createFileRoute('/practice/approvals')({ component: ApprovalsPage });

function ApprovalsPage() {
  const recent = useQuery({ queryKey: ['hand-tasks', 'all'], queryFn: () => api.get<{ tasks: HandTask[] }>('/hands/tasks'), refetchInterval: 60_000 });
  const hands = useQuery({ queryKey: ['hands'], queryFn: () => api.get<{ hands: Array<{ id: string; name: string; module: string; level: string; status: string; leash: Record<string, unknown>; approvalPersona: string }> }>('/hands') });

  const tasks = recent.data?.tasks ?? [];
  const waiting = tasks.filter((t) => t.status === 'needs_approval');
  const done = tasks.filter((t) => t.status !== 'needs_approval').slice(0, 40);

  return (
    <div className="page">
      <PageHeader title="Approvals" subtitle="Every Hand request waiting for this practice, with the leash that stopped it" actions={<a className="btn" href="/admin">Hands and leashes</a>} />

      {recent.isError && <Banner kind="crit">Hand tasks could not be loaded. Refresh, or call platform support with reference hands-tasks.</Banner>}
      {waiting.length === 0 && !recent.isLoading && <Banner kind="ok">Nothing is waiting for approval. Hands are running inside their leashes.</Banner>}

      <div className="split">
        <ApprovalsPanel compact />
        <Card title="Hands running for this practice" extra={hands.data ? `${hands.data.hands.length} registered` : undefined}>
          {hands.isLoading ? <Skeleton rows={5} /> : (
            <DataTable
              rows={hands.data?.hands ?? []}
              rowKey={(h) => h.id}
              columns={[
                { key: 'name', header: 'Hand', render: (h) => <><b>{h.name}</b><div className="small muted">{h.module}</div></> },
                { key: 'level', header: 'Level', render: (h) => <Chip kind={h.level === 'A3' ? 'att' : 'neutral'}>{h.level}</Chip> },
                { key: 'leash', header: 'Leash', render: (h) => <span className="small mono">{Object.entries(h.leash).slice(0, 2).map(([k, v]) => `${k} ${String(v)}`).join(' · ') || '—'}</span> },
                { key: 'approver', header: 'Approver', render: (h) => h.approvalPersona },
                { key: 'status', header: 'Status', render: (h) => <StatusChip status={h.status} /> },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title="Recent Hand activity" extra={`${done.length} runs`}>
        {recent.isLoading ? <Skeleton rows={5} /> : !done.length ? <EmptyState>No Hand runs recorded yet.</EmptyState> : (
          <DataTable
            rows={done}
            rowKey={(t) => t.id}
            columns={[
              { key: 'hand', header: 'Hand', render: (t) => t.handId },
              { key: 'title', header: 'Task', render: (t) => t.title },
              { key: 'status', header: 'Outcome', render: (t) => <StatusChip status={t.status} /> },
              { key: 'checks', header: 'Leash checks', render: (t) => t.leashChecks.length ? <span className="small mono">{t.leashChecks.map((c) => `${c.rule} ${c.ok ? 'ok' : 'stopped'}`).join(' · ')}</span> : <span className="muted">—</span> },
              { key: 'when', header: 'Started', render: (t) => <DateTime iso={t.startedAt} /> },
            ]}
          />
        )}
        <p className="note">Every run records its tool calls, leash checks and approvals. Reversals within seven days feed the Hand reversal rate on the AI operations console.</p>
      </Card>
    </div>
  );
}
