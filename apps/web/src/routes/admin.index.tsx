import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Sheet, Field, Input, Select, TextArea, KV, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/admin/')({ component: HandsPage });

export interface Hand {
  id: string; name: string; module: string; mandate: string; level: string; status: string;
  leash: Record<string, number | string | boolean>; approvalPersona: string; approvalPolicy: string;
  tools: Record<string, string>;
}
interface AuditEntry { id: string; action: string; objectId: string | null; details: Record<string, unknown> | null; userId: string | null; persona: string | null; createdAt: string }

/** Settings navigation shared by every admin page. */
export function SettingsNav({ active }: { active: string }) {
  const groups: Array<[string, Array<[string, string]>]> = [
    ['Practice', [['/admin/organisation', 'Organisation'], ['/admin/sites', 'Sites and rooms'], ['/admin/users', 'Users and roles']]],
    ['Revenue', [['/billing/fee-schedules', 'Fee schedules']]],
    ['Platform', [['/admin', 'Hands and leashes'], ['/admin/flags', 'Feature flags']]],
  ];
  return (
    <nav aria-label="Settings" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 190 }}>
      {groups.map(([label, items]) => (
        <div key={label}>
          <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.04em', margin: '10px 0 4px' }}>{label}</div>
          {items.map(([href, text]) => (
            <a key={href} href={href} className={href === active ? 'btn primary sm' : 'btn sm'} style={{ display: 'block', textAlign: 'left', marginBottom: 2 }}>{text}</a>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({ active, title, subtitle, actions, children }: { active: string; title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'start' }}>
        <SettingsNav active={active} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
      </div>
    </div>
  );
}

function LeashEditor({ hand, onClose }: { hand: Hand; onClose: () => void }) {
  const qc = useQueryClient();
  const [leash, setLeash] = useState<Record<string, string>>(Object.fromEntries(Object.entries(hand.leash).map(([k, v]) => [k, String(v)])));
  const [status, setStatus] = useState(hand.status);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/hands/${hand.id}`, {
      leash: Object.fromEntries(Object.entries(leash).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v])),
      status, reason,
    }),
    onSuccess: () => { onClose(); void qc.invalidateQueries(); },
  });
  return (
    <Sheet open onClose={onClose} title={`${hand.name} · ${hand.module}`}>
      <KV items={[
        ['Mandate', hand.mandate],
        ['Automation level', <Chip key="l" kind={hand.level === 'A3' ? 'att' : 'neutral'}>{hand.level}</Chip>],
        ['Approval policy', hand.approvalPolicy],
        ['Approver', hand.approvalPersona],
        ['Tools', <span className="small mono" key="t">{Object.entries(hand.tools).map(([t, r]) => `${t} (${r})`).join(' · ')}</span>],
      ]} />
      <Card title="Leash">
        {Object.entries(leash).length === 0 ? <p className="small muted">This Hand has no numeric leash values.</p> : Object.entries(leash).map(([k, v]) => (
          <Field key={k} label={k} hint={k.toLowerCase().includes('cents') ? 'Integer cents in ZAR' : undefined}>
            <Input value={v} onChange={(e) => setLeash({ ...leash, [k]: e.target.value })} />
          </Field>
        ))}
      </Card>
      <Field label="Status" hint="Shadow records actions without external effects; paused refuses every run.">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {['active', 'shadow', 'paused'].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
      <Field label="Change reason (required)"><TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this leash or status changes" /></Field>
      <div className="row-flex">
        <Button variant="primary" disabled={reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Save change</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
      {save.isError && <Banner kind="crit">{(save.error as Error).message}</Banner>}
      <p className="note">The runtime enforces the leash outside the prompt. Reductions take effect immediately; every change is versioned in the audit log with its reason.</p>
    </Sheet>
  );
}

function HandsPage() {
  const [edit, setEdit] = useState<Hand | null>(null);
  const hands = useQuery({ queryKey: ['hands'], queryFn: () => api.get<{ hands: Hand[] }>('/hands') });
  const history = useQuery({ queryKey: ['hand-history'], queryFn: () => api.get<{ entries: AuditEntry[] }>('/auth/audit?action=hand.updated').catch(() => ({ entries: [] as AuditEntry[] })) });

  const rows = hands.data?.hands ?? [];
  const paused = rows.filter((h) => h.status === 'paused');
  const shadow = rows.filter((h) => h.status === 'shadow');

  return (
    <AdminShell
      active="/admin"
      title="Hands and leashes"
      subtitle={`${rows.length} Hands · mandate, level, leash, approval policy and status per practice, enforced by the runtime rather than the prompt`}
      actions={<a className="btn" href="/practice/approvals">Approvals queue</a>}
    >
      {hands.isError && <Banner kind="crit">The Hand registry could not be loaded. Refresh, or call platform support with reference hands-registry.</Banner>}
      {paused.length > 0 && <Banner kind="warn">{paused.length} Hand{paused.length > 1 ? 's are' : ' is'} paused: {paused.map((h) => h.name).join(', ')}. Paused Hands refuse every run.</Banner>}
      {shadow.length > 0 && <Banner kind="info">{shadow.map((h) => h.name).join(', ')} running in shadow: actions are recorded, external effects suppressed.</Banner>}

      <Card title="Registry" extra="clinical interpretation is capped at A1 by policy; no Hand holds a tool that can publish clinical content">
        {hands.isLoading ? <Skeleton rows={8} /> : !rows.length ? <EmptyState>No Hands registered.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(h) => h.id}
            onRowClick={(h) => setEdit(h)}
            columns={[
              { key: 'hand', header: 'Hand', width: 170, render: (h) => <><b>{h.name}</b><div className="small muted">{h.module} · exceptions {h.approvalPersona}</div></> },
              { key: 'mandate', header: 'Mandate summary', render: (h) => <span className="small">{h.mandate.slice(0, 150)}{h.mandate.length > 150 ? '…' : ''}</span> },
              { key: 'level', header: 'Level', width: 60, render: (h) => <Chip kind={h.level === 'A3' ? 'att' : 'neutral'}>{h.level}</Chip> },
              { key: 'leash', header: 'Leash (editable)', render: (h) => Object.keys(h.leash).length ? <div className="small mono">{Object.entries(h.leash).map(([k, v]) => <div key={k}>{k}: {typeof v === 'number' && k.toLowerCase().includes('cents') ? `R ${(Number(v) / 100).toLocaleString('en-ZA')}` : String(v)}</div>)}</div> : <span className="muted small">no numeric limits</span> },
              { key: 'policy', header: 'Approval policy', width: 200, render: (h) => <span className="small">{h.approvalPolicy.slice(0, 110)}</span> },
              { key: 'status', header: 'Status', width: 100, render: (h) => <StatusChip status={h.status} /> },
            ]}
          />
        )}
        <p className="note">Illustrative leash values are configurable reference data per practice. Automation levels: A1 assisted, A2 supervised auto, A3 autonomous with leash. Clinical interpretation never rises above A1.</p>
      </Card>

      <Card title="Change history" extra="from the hash-chained audit log">
        {history.isLoading ? <Skeleton rows={3} /> : !history.data?.entries.length ? (
          <EmptyState>No leash changes recorded yet. Every change records the previous value, the new value and the reason.</EmptyState>
        ) : (
          <DataTable
            rows={history.data.entries}
            rowKey={(e) => e.id}
            columns={[
              { key: 'when', header: 'When', render: (e) => <DateTime iso={e.createdAt} /> },
              { key: 'hand', header: 'Hand', render: (e) => e.objectId ?? '—' },
              { key: 'who', header: 'Changed by', render: (e) => e.persona ?? e.userId ?? 'system' },
              { key: 'change', header: 'Change', render: (e) => <span className="small mono">{JSON.stringify(e.details ?? {}).slice(0, 120)}</span> },
            ]}
          />
        )}
      </Card>

      {edit && <LeashEditor hand={edit} onClose={() => setEdit(null)} />}
    </AdminShell>
  );
}
