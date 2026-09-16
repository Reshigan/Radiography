import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Chip, StatusChip, Skeleton, EmptyState, DataTable, Tabs } from '@bonakala/bdl';
import { api } from '../lib/api';
import type { SiteStatus, Acquisition } from './group.index';
import type { Gateway } from './engineering.index';

export const Route = createFileRoute('/support/')({ component: SupportPage });

export interface Ticket { id: string; ref: string; practiceId: string | null; siteId: string | null; category: string; severity: string; title: string; description: string | null; status: string; linkedRef: string | null; runbook: Array<{ step: string; done: boolean }> | null; createdAt: string }

function SupportPage() {
  const [tab, setTab] = useState('tenants');
  const sites = useQuery({ queryKey: ['sites-status'], queryFn: () => api.get<{ sites: SiteStatus[] }>('/analytics/sites-status'), refetchInterval: 60_000 });
  const fleet = useQuery({ queryKey: ['fleet'], queryFn: () => api.get<{ gateways: Gateway[]; summary: { online: number; onUps: number; offline: number; backlog: number } }>('/assets/fleet') });
  const feeds = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<{ feeds: Array<{ id: string; name: string; status: string; errors24h: number; siteName: string }>; summary: { healthy: number; degraded: number; errors24h: number } }>('/assets/integrations') });
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: () => api.get<{ tickets: Ticket[] }>('/assets/support/tickets') });
  const acqs = useQuery({ queryKey: ['acquisitions'], queryFn: () => api.get<{ acquisitions: Acquisition[] }>('/analytics/acquisitions') });

  const practices = [...new Map((sites.data?.sites ?? []).map((s) => [s.practiceId || s.practice, s])).values()];
  const openTickets = (tickets.data?.tickets ?? []).filter((t) => t.status !== 'closed' && t.status !== 'resolved');
  const p1p2 = openTickets.filter((t) => t.severity === 'p1' || t.severity === 'p2');
  const onboarding = (acqs.data?.acquisitions ?? []).filter((a) => a.stage === 'onboarding' || a.stage === 'due_diligence');
  const offline = fleet.data?.summary.offline ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="Platform support"
        subtitle={`${practices.length} tenants · ${openTickets.length} open case${openTickets.length === 1 ? '' : 's'} · ${offline} gateway${offline === 1 ? '' : 's'} offline`}
        actions={<a className="btn" href="/admin">Administration</a>}
      />

      {p1p2.length > 0 && <Banner kind="crit">{p1p2.map((t) => `${t.ref} ${t.title}`).join(' · ')}</Banner>}
      {tickets.isError && <Banner kind="crit">Support cases could not be loaded. Refresh, or retry with reference support-tickets.</Banner>}

      <div className="grid g4">
        <Card title="Gateways online"><div style={{ font: '600 24px/1.1 var(--display)' }}>{fleet.data?.summary.online ?? '—'}</div><div className="small muted">{fleet.data?.summary.onUps ?? 0} on UPS · {offline} offline</div></Card>
        <Card title="Transfer backlog"><div style={{ font: '600 24px/1.1 var(--display)' }}>{fleet.data?.summary.backlog ?? '—'}</div><div className="small muted">studies waiting to forward</div></Card>
        <Card title="Integration errors"><div style={{ font: '600 24px/1.1 var(--display)' }}>{feeds.data?.summary.errors24h ?? '—'}</div><div className="small muted">in the last 24 hours</div></Card>
        <Card title="Open cases"><div style={{ font: '600 24px/1.1 var(--display)' }}>{openTickets.length}</div><div className="small muted">{p1p2.length} at P1 or P2</div></Card>
      </div>

      <Tabs tabs={[{ id: 'tenants', label: 'Tenants' }, { id: 'incidents', label: `Cases (${openTickets.length})` }, { id: 'onboarding', label: `Onboarding (${onboarding.length})` }]} active={tab} onChange={setTab} />

      {tab === 'tenants' && (
        <Card title="Tenant health" extra={`${sites.data?.sites.length ?? 0} sites`}>
          {sites.isLoading ? <Skeleton rows={6} /> : !sites.data?.sites.length ? <EmptyState>No tenants.</EmptyState> : (
            <DataTable
              rows={sites.data.sites}
              rowKey={(s) => s.siteId}
              columns={[
                { key: 'state', header: '', width: 28, render: (s) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: `var(--${s.state === 'crit' ? 'crit' : s.state === 'att' ? 'warn' : 'ok'})` }} /> },
                { key: 'practice', header: 'Tenant', render: (s) => <><b>{s.practice}</b><div className="small muted">{s.site}</div></> },
                { key: 'note', header: 'Health', render: (s) => <span className="small">{s.note}</span> },
                { key: 'gw', header: 'Gateway', render: (s) => s.gateway ? <><StatusChip status={s.gateway.status} />{s.gateway.backlog > 0 && <div className="small muted mono">backlog {s.gateway.backlog}</div>}</> : <span className="muted">—</span> },
                { key: 'studies', header: 'Studies today', num: true, render: (s) => <span className="mono">{s.studiesToday || '—'}</span> },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'incidents' && (
        <Card title="Support cases" extra={<a className="link" href="/support/incidents">Full queue</a>}>
          {tickets.isLoading ? <Skeleton rows={5} /> : !tickets.data?.tickets.length ? <EmptyState>No support cases.</EmptyState> : (
            <DataTable
              rows={tickets.data.tickets}
              rowKey={(t) => t.id}
              columns={[
                { key: 'ref', header: 'Reference', render: (t) => <span className="mono">{t.ref}</span> },
                { key: 'sev', header: 'Severity', render: (t) => <Chip kind={t.severity === 'p1' ? 'crit' : t.severity === 'p2' ? 'att' : 'neutral'}>{t.severity.toUpperCase()}</Chip> },
                { key: 'title', header: 'Case', render: (t) => <><b>{t.title}</b>{t.description && <div className="small muted">{t.description}</div>}</> },
                { key: 'cat', header: 'Category', render: (t) => t.category },
                { key: 'runbook', header: 'Runbook', num: true, render: (t) => t.runbook ? <span className="mono">{t.runbook.filter((s) => s.done).length}/{t.runbook.length}</span> : <span className="muted">—</span> },
                { key: 'status', header: 'Status', render: (t) => <StatusChip status={t.status} /> },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'onboarding' && (
        <Card title="Onboarding in flight" extra="five working days from entity capture to go-live">
          {acqs.isLoading ? <Skeleton rows={4} /> : !onboarding.length ? <EmptyState>No practices onboarding.</EmptyState> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {onboarding.map((a) => {
                const done = a.checklist.filter((c) => c.done).length;
                return (
                  <div key={a.id} className="card" style={{ padding: 12 }}>
                    <div className="spread"><b>{a.name}</b><Chip kind={a.stage === 'onboarding' ? 'active' : 'att'}>{a.stage.replace(/_/g, ' ')}</Chip></div>
                    <div className="small muted">{a.sites.join(', ')}{a.effectiveDate ? ` · effective ${a.effectiveDate}` : ''}</div>
                    <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 2, margin: '8px 0' }}>
                      <div style={{ height: '100%', width: `${(done / a.checklist.length) * 100}%`, background: 'var(--info)', borderRadius: 2 }} />
                    </div>
                    <div className="small mono">{done} of {a.checklist.length} steps</div>
                    <ul className="small" style={{ paddingLeft: 18, marginTop: 6 }}>
                      {a.checklist.filter((c) => !c.done).slice(0, 3).map((c, i) => <li key={i} className="muted">Day {c.day} · {c.item}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
          <p className="note">The Onboarding Hand stages entities, sites and configuration. Clinical rights and fee schedules are activated by a human after verification.</p>
        </Card>
      )}
    </div>
  );
}
