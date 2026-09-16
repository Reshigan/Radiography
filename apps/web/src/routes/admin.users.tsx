import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import { AdminShell } from './admin.index';

export const Route = createFileRoute('/admin/users')({ component: UsersPage });

interface User { id: string; name: string; email: string; persona: string; practiceId: string | null; hpcsaNo: string | null; status: string; lastLoginAt: string | null }
interface StaffRow { id: string; name: string; role: string; userId: string | null; competencies: string[]; hpcsaNo: string | null; hpcsaExpiry: string | null; radiationWorker: boolean; status: string; lapsed: number; expiring30: number }

function UsersPage() {
  const [q, setQ] = useState('');
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/auth/users') });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ staff: StaffRow[] }>('/workforce/staff').catch(() => ({ staff: [] as StaffRow[] })) });

  const rows = (users.data?.users ?? []).filter((u) => !q || `${u.name} ${u.email} ${u.persona}`.toLowerCase().includes(q.toLowerCase()));
  const lapsed = (staff.data?.staff ?? []).filter((s) => s.lapsed > 0);

  return (
    <AdminShell active="/admin/users" title="Users and roles" subtitle={`${users.data?.users.length ?? 0} accounts · persona-based access, HPCSA verification and credential state`}>
      {lapsed.length > 0 && <Banner kind="crit">{lapsed.length} staff member{lapsed.length > 1 ? 's have' : ' has'} a lapsed credential: clinical permissions are suspended in parallel with the rostering block.</Banner>}
      {users.isError && <Banner kind="crit">Users could not be loaded. Refresh, or call platform support with reference auth-users.</Banner>}

      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or persona" aria-label="Search users" style={{ minWidth: 300 }} />
        <span className="muted small">{rows.length} shown</span>
      </div>

      <Card title="Accounts">
        {users.isLoading ? <Skeleton rows={8} /> : !rows.length ? <EmptyState>No users match this search.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(u) => u.id}
            columns={[
              { key: 'name', header: 'User', render: (u) => <><b>{u.name}</b><div className="small muted mono">{u.email}</div></> },
              { key: 'persona', header: 'Persona', render: (u) => <Chip>{u.persona}</Chip> },
              { key: 'scope', header: 'Scope', render: (u) => u.practiceId ? <span className="small">{u.practiceId}</span> : <span className="small muted">Group</span> },
              { key: 'hpcsa', header: 'HPCSA', render: (u) => u.hpcsaNo ? <span className="mono small">{u.hpcsaNo}</span> : <span className="muted">—</span> },
              { key: 'last', header: 'Last sign-in', render: (u) => u.lastLoginAt ? <DateTime iso={u.lastLoginAt} /> : <span className="muted">never</span> },
              { key: 'status', header: 'Status', render: (u) => <StatusChip status={u.status} /> },
            ]}
          />
        )}
        <p className="note">Provisioning follows the worker lifecycle: no clinical account exists without a linked worker and a verified registration number where the role requires one.</p>
      </Card>

      <Card title="Workforce records" extra={staff.data ? `${staff.data.staff.length} staff` : undefined}>
        {staff.isLoading ? <Skeleton rows={5} /> : !staff.data?.staff.length ? <EmptyState>No workforce records for this practice.</EmptyState> : (
          <DataTable
            rows={staff.data.staff}
            rowKey={(s) => s.id}
            columns={[
              { key: 'name', header: 'Staff', render: (s) => <><b>{s.name}</b><div className="small muted">{s.role}{s.userId ? ' · has an account' : ' · no account'}</div></> },
              { key: 'comp', header: 'Competencies', render: (s) => <span className="small">{s.competencies.join(', ') || '—'}</span> },
              { key: 'hpcsa', header: 'HPCSA', render: (s) => s.hpcsaNo ? <><span className="mono small">{s.hpcsaNo}</span><div className="small muted">expires {s.hpcsaExpiry ?? '—'}</div></> : <span className="muted">—</span> },
              { key: 'rad', header: 'Radiation worker', render: (s) => s.radiationWorker ? <Chip kind="att">badge issued</Chip> : <span className="muted small">no</span> },
              { key: 'creds', header: 'Credentials', render: (s) => s.lapsed ? <Chip kind="crit">{s.lapsed} lapsed</Chip> : s.expiring30 ? <Chip kind="att">{s.expiring30} expiring</Chip> : <Chip kind="done">current</Chip> },
              { key: 'status', header: 'Status', render: (s) => <StatusChip status={s.status} /> },
            ]}
          />
        )}
      </Card>
    </AdminShell>
  );
}
