import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, DateTime, Sheet, Field, Input, Select, KV } from '@bonakala/bdl';
import { PERSONAS, PERSONA_LABEL, type Persona } from '@bonakala/domain';
import { api, ApiError } from '../lib/api';
import { AdminShell } from './admin.index';

export const Route = createFileRoute('/admin/users')({ component: UsersPage });

interface User { id: string; name: string; email: string; persona: string; practiceId: string | null; hpcsaNo: string | null; status: string; lastLoginAt: string | null }
interface StaffRow { id: string; name: string; role: string; userId: string | null; competencies: string[]; hpcsaNo: string | null; hpcsaExpiry: string | null; radiationWorker: boolean; status: string; lapsed: number; expiring30: number }

function UsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; value: string } | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/auth/users') });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ staff: StaffRow[] }>('/workforce/staff').catch(() => ({ staff: [] as StaffRow[] })) });

  const rows = (users.data?.users ?? []).filter((u) => !q || `${u.name} ${u.email} ${u.persona}`.toLowerCase().includes(q.toLowerCase()));
  const lapsed = (staff.data?.staff ?? []).filter((s) => s.lapsed > 0);

  return (
    <AdminShell active="/admin/users" title="Users and roles" subtitle={`${users.data?.users.length ?? 0} accounts · persona-based access, HPCSA verification and credential state`} actions={<Button variant="primary" onClick={() => setCreate(true)}>New user</Button>}>
      {lapsed.length > 0 && <Banner kind="crit">{lapsed.length} staff member{lapsed.length > 1 ? 's have' : ' has'} a lapsed credential: clinical permissions are suspended in parallel with the rostering block.</Banner>}
      {users.isError && <Banner kind="crit">Users could not be loaded. Refresh, or call platform support with reference auth-users.</Banner>}
      {tempPassword && (
        <Banner kind="ok" action={<Button size="sm" onClick={() => setTempPassword(null)}>Dismiss</Button>}>
          Temporary password for {tempPassword.email}: <b className="mono">{tempPassword.value}</b>. Shown once — it is not stored anywhere retrievable, so pass it to them now.
        </Banner>
      )}

      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or persona" aria-label="Search users" style={{ minWidth: 300 }} />
        <span className="muted small">{rows.length} shown</span>
      </div>

      <Card title="Accounts">
        {users.isLoading ? <Skeleton rows={8} /> : !rows.length ? <EmptyState>No users match this search.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(u) => u.id}
            onRowClick={(u) => setEdit(u)}
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
        <p className="note">Provisioning follows the worker lifecycle: no clinical account exists without a linked worker and a verified registration number where the role requires one. Click a row to change persona, scope, status or reset the password.</p>
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

      {create && <CreateUserSheet onClose={() => setCreate(false)} onCreated={(email, value) => { setCreate(false); setTempPassword({ email, value }); void qc.invalidateQueries({ queryKey: ['users'] }); }} />}
      {edit && <EditUserSheet user={edit} onClose={() => setEdit(null)} onReset={(value) => setTempPassword({ email: edit.email, value })} onSaved={() => { setEdit(null); void qc.invalidateQueries({ queryKey: ['users'] }); }} />}
    </AdminShell>
  );
}

function CreateUserSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string, tempPassword: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [persona, setPersona] = useState<Persona>('FDK');
  const [practiceId, setPracticeId] = useState('');
  const [hpcsaNo, setHpcsaNo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; tempPassword: string }>('/auth/users', { name, email, persona, practiceId: practiceId || null, hpcsaNo: hpcsaNo || undefined }),
    onSuccess: (r) => onCreated(email.toLowerCase(), r.tempPassword),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not create the user'),
  });

  return (
    <Sheet open onClose={onClose} title="New user">
      {error && <Banner kind="crit">{error}</Banner>}
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></Field>
      <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
      <Field label="Persona">
        <Select value={persona} onChange={(e) => setPersona(e.target.value as Persona)}>
          {PERSONAS.map((p) => <option key={p} value={p}>{p} — {PERSONA_LABEL[p]}</option>)}
        </Select>
      </Field>
      <Field label="Practice ID" hint="Blank = Group scope"><Input value={practiceId} onChange={(e) => setPracticeId(e.target.value)} placeholder="e.g. UMH" /></Field>
      <Field label="HPCSA number" hint="Clinical personas only"><Input value={hpcsaNo} onChange={(e) => setHpcsaNo(e.target.value)} /></Field>
      <div className="row-flex">
        <Button variant="primary" disabled={!name || !email || create.isPending} onClick={() => { setError(null); create.mutate(); }}>Create account</Button>
      </div>
      <p className="note">A one-time temporary password is generated and shown once on the next screen. There is no self-service password reset in the demo build; use "Reset password" on the user's record if it is lost.</p>
    </Sheet>
  );
}

function EditUserSheet({ user, onClose, onSaved, onReset }: { user: User; onClose: () => void; onSaved: () => void; onReset: (tempPassword: string) => void }) {
  const [persona, setPersona] = useState<Persona>(user.persona as Persona);
  const [practiceId, setPracticeId] = useState(user.practiceId ?? '');
  const [status, setStatus] = useState(user.status);
  const [hpcsaNo, setHpcsaNo] = useState(user.hpcsaNo ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.patch(`/auth/users/${user.id}`, { persona, practiceId: practiceId || null, status, hpcsaNo: hpcsaNo || null }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save changes'),
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ tempPassword: string }>(`/auth/users/${user.id}/reset-password`),
    onSuccess: (r) => onReset(r.tempPassword),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not reset the password'),
  });

  return (
    <Sheet open onClose={onClose} title={user.name}>
      {error && <Banner kind="crit">{error}</Banner>}
      <KV items={[['Email', user.email], ['Last sign-in', user.lastLoginAt ?? 'never']]} />
      <Field label="Persona">
        <Select value={persona} onChange={(e) => setPersona(e.target.value as Persona)}>
          {PERSONAS.map((p) => <option key={p} value={p}>{p} — {PERSONA_LABEL[p]}</option>)}
        </Select>
      </Field>
      <Field label="Practice ID" hint="Blank = Group scope"><Input value={practiceId} onChange={(e) => setPracticeId(e.target.value)} /></Field>
      <Field label="HPCSA number"><Input value={hpcsaNo} onChange={(e) => setHpcsaNo(e.target.value)} /></Field>
      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </Select>
      </Field>
      <div className="row-flex">
        <Button variant="primary" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save changes</Button>
        <Button disabled={reset.isPending} onClick={() => { setError(null); reset.mutate(); }}>Reset password</Button>
      </div>
      <p className="note">Setting a status other than Active immediately signs the user out everywhere.</p>
    </Sheet>
  );
}
