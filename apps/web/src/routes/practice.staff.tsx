import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Money, Sheet, KV, Tabs } from '@bonakala/bdl';
import { api } from '../lib/api';
import { MetricTiles, DefinitionSheet, type MetricTile, type TilesResponse } from './practice.index';

export const Route = createFileRoute('/practice/staff')({ component: StaffPage });

interface Shift {
  id: string; siteId: string; siteName: string; roomName: string | null; date: string; startTime: string; endTime: string; hours: number;
  role: string; requiredCompetency: string | null; staffId: string | null; staffName: string | null; status: string;
  filledBy: string | null; agencyName: string | null; agencyCents: number | null; gapReason: string | null; note: string | null;
}
interface RosterResponse {
  weekStart: string; days: string[]; shifts: Shift[]; sites: Array<{ id: string; name: string }>;
  summary: { plannedHours: number; gapHours: number; gapPct: number; shifts: number; open: number; agency: number };
}
interface Gap extends Shift { hoursOut: number; urgent: boolean }
interface Credential { id: string; staffId: string; staffName: string; role: string; type: string; number: string | null; expiry: string | null; daysToExpiry: number | null; state: string; blocksRostering: boolean; verified: boolean }

function addWeeks(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function StaffPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('roster');
  const [week, setWeek] = useState<string>(new Date().toISOString().slice(0, 10));
  const [siteId, setSiteId] = useState('');
  const [define, setDefine] = useState<MetricTile | null>(null);
  const [gapOpen, setGapOpen] = useState<Gap | null>(null);

  const tiles = useQuery({ queryKey: ['tiles', 'workforce'], queryFn: () => api.get<TilesResponse>('/analytics/tiles?scope=workforce') });
  const roster = useQuery({ queryKey: ['roster', week, siteId], queryFn: () => api.get<RosterResponse>(`/workforce/roster?week=${week}${siteId ? `&siteId=${siteId}` : ''}`) });
  const gaps = useQuery({ queryKey: ['gaps'], queryFn: () => api.get<{ gaps: Gap[] }>('/workforce/gaps'), refetchInterval: 60_000 });
  const creds = useQuery({ queryKey: ['credentials'], queryFn: () => api.get<{ credentials: Credential[]; note: string }>('/workforce/credentials') });
  const cpd = useQuery({ queryKey: ['cpd'], queryFn: () => api.get<{ cycleYear: number; target: number; ethicsTarget: number; paceToDate: number; staff: Array<{ staffId: string; name: string; role: string; points: number; ethics: number; onPace: boolean }>; note: string }>('/workforce/cpd') });
  const leave = useQuery({ queryKey: ['leave'], queryFn: () => api.get<{ leave: Array<{ id: string; staffName: string; type: string; fromDate: string; toDate: string; days: number; status: string }> }>('/workforce/leave') });

  const rosterHand = useMutation({
    mutationFn: (shiftId: string) => api.post<{ task: { status: string; output: Record<string, unknown> | null; approvalReason: string | null } }>(`/workforce/shifts/${shiftId}/roster-hand`),
    onSuccess: () => { setGapOpen(null); void qc.invalidateQueries(); },
  });

  const shifts = roster.data?.shifts ?? [];
  const roles = [...new Set(shifts.map((s) => s.role))];
  const lapsed = (creds.data?.credentials ?? []).filter((c) => c.state === 'lapsed');

  return (
    <div className="page">
      <PageHeader
        title="Staff"
        subtitle={roster.data ? `Week of ${roster.data.weekStart} · ${roster.data.summary.shifts} shifts this week · ${roster.data.summary.gapHours} gap hours (${roster.data.summary.gapPct} %); the tiles cover the next four weeks` : 'Roster, gaps, credentials and CPD'}
        actions={
          <>
            <Button size="sm" onClick={() => setWeek(addWeeks(week, -1))}>Previous week</Button>
            <Button size="sm" onClick={() => setWeek(addWeeks(week, 1))}>Next week</Button>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site" className="btn">
              <option value="">All sites</option>
              {roster.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        }
      />

      {lapsed.length > 0 && (
        <Banner kind="crit">
          {lapsed.length} credential{lapsed.length > 1 ? 's have' : ' has'} lapsed: {lapsed.slice(0, 3).map((c) => `${c.staffName} (${c.type})`).join(', ')}.
          {' '}Clinical rostering is blocked from the expiry date; a CMP grace override needs a typed reason.
        </Banner>
      )}
      {roster.isError && <Banner kind="crit">The roster could not be loaded. Refresh, or call platform support with reference workforce-roster.</Banner>}

      <MetricTiles tiles={tiles.data?.tiles ?? []} loading={tiles.isLoading} columns="g4" onDefine={setDefine} />

      <Tabs tabs={[{ id: 'roster', label: 'Roster' }, { id: 'gaps', label: `Gaps (${gaps.data?.gaps.length ?? 0})` }, { id: 'credentials', label: 'Credentials' }, { id: 'cpd', label: 'CPD' }, { id: 'leave', label: 'Leave' }]} active={tab} onChange={setTab} />

      {tab === 'roster' && (
        <Card title={`Roster · week of ${roster.data?.weekStart ?? ''}`} extra={roster.data ? `${roster.data.summary.plannedHours} planned hours` : undefined}>
          {roster.isLoading ? <Skeleton rows={6} /> : !shifts.length ? <EmptyState>No shifts in this week.</EmptyState> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="dt">
                <thead><tr><th style={{ width: 90 }}>Role</th>{(roster.data?.days ?? []).map((d) => <th key={d}>{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })}</th>)}</tr></thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role}>
                      <td><b>{role}</b></td>
                      {(roster.data?.days ?? []).map((d) => {
                        const cell = shifts.filter((s) => s.date === d && s.role === role);
                        return (
                          <td key={d} style={{ verticalAlign: 'top' }}>
                            {cell.map((s) => (
                              <div key={s.id} style={{ marginBottom: 4 }}>
                                <div className="mono small">{s.startTime}–{s.endTime}</div>
                                {s.status === 'open_gap' ? <Chip kind="crit">open · {s.gapReason ?? 'gap'}</Chip>
                                  : s.status === 'agency' ? <Chip kind="att">agency</Chip>
                                  : <span className="small">{s.staffName ?? '—'}</span>}
                                {s.requiredCompetency && <div className="small muted">{s.requiredCompetency}</div>}
                              </div>
                            ))}
                            {!cell.length && <span className="muted small">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'gaps' && (
        <Card title="Open gaps and Roster Hand proposals" extra={gaps.data ? `${gaps.data.gaps.length} open` : undefined}>
          {gaps.isLoading ? <Skeleton rows={4} /> : !gaps.data?.gaps.length ? <EmptyState>Every published shift is filled.</EmptyState> : (
            <DataTable
              rows={gaps.data.gaps}
              rowKey={(g) => g.id}
              onRowClick={(g) => setGapOpen(g)}
              columns={[
                { key: 'when', header: 'When', render: (g) => <span className="mono">{g.date} {g.startTime}–{g.endTime}</span> },
                { key: 'site', header: 'Site', render: (g) => g.siteName },
                { key: 'role', header: 'Role', render: (g) => <>{g.role}{g.requiredCompetency ? <span className="muted"> · {g.requiredCompetency}</span> : null}</> },
                { key: 'reason', header: 'Reason', render: (g) => g.gapReason ?? '—' },
                { key: 'status', header: 'Status', render: (g) => g.status === 'agency' ? <Chip kind="att">agency proposed</Chip> : <Chip kind="crit">open</Chip> },
                { key: 'cost', header: 'Cost', num: true, render: (g) => g.agencyCents ? <Money cents={g.agencyCents} /> : <span className="muted">—</span> },
                { key: 'out', header: 'Starts in', num: true, render: (g) => <span className={g.urgent ? 'mono' : 'mono muted'}>{g.hoursOut} h</span> },
              ]}
            />
          )}
          <p className="note">The Roster Hand fills a gap by internal swap in fairness order, or books agency cover from the approved panel within the per-shift cap. Above the cap, or inside 12 hours of the start, it asks the practice manager.</p>
        </Card>
      )}

      {tab === 'credentials' && (
        <Card title="Credentials" extra={creds.data ? `${creds.data.credentials.length} records` : undefined}>
          {creds.isLoading ? <Skeleton rows={5} /> : (
            <DataTable
              rows={creds.data?.credentials ?? []}
              rowKey={(c) => c.id}
              columns={[
                { key: 'staff', header: 'Staff', render: (c) => <>{c.staffName} <span className="muted">· {c.role}</span></> },
                { key: 'type', header: 'Credential', render: (c) => c.type.replace(/_/g, ' ') },
                { key: 'no', header: 'Number', render: (c) => c.number ? <span className="mono">{c.number}</span> : <span className="muted">—</span> },
                { key: 'expiry', header: 'Expiry', render: (c) => c.expiry ? <span className="mono">{c.expiry}</span> : <span className="muted">—</span> },
                { key: 'days', header: 'Days', num: true, render: (c) => c.daysToExpiry === null ? <span className="muted">—</span> : <span className="mono">{c.daysToExpiry}</span> },
                { key: 'state', header: 'State', render: (c) => <StatusChip status={c.state === 'watch' ? 'due' : c.state} /> },
                { key: 'blocks', header: '', render: (c) => c.blocksRostering ? <Chip kind="crit">blocks rostering</Chip> : c.verified ? <Chip kind="done">verified</Chip> : <Chip kind="att">unverified</Chip> },
              ]}
            />
          )}
          <p className="note">{creds.data?.note}</p>
        </Card>
      )}

      {tab === 'cpd' && (
        <Card title={`CPD cycle ${cpd.data?.cycleYear ?? ''}`} extra={cpd.data ? `pace to date ${cpd.data.paceToDate} of ${cpd.data.target}` : undefined}>
          {cpd.isLoading ? <Skeleton rows={4} /> : (
            <DataTable
              rows={cpd.data?.staff ?? []}
              rowKey={(x) => x.staffId}
              columns={[
                { key: 'name', header: 'Staff', render: (x) => <>{x.name} <span className="muted">· {x.role}</span></> },
                { key: 'points', header: 'CEUs', num: true, render: (x) => <span className="mono">{x.points} / {cpd.data?.target ?? 30}</span> },
                { key: 'ethics', header: 'Ethics', num: true, render: (x) => <span className="mono">{x.ethics} / {cpd.data?.ethicsTarget ?? 5}</span> },
                { key: 'pace', header: 'Pace', render: (x) => x.onPace ? <Chip kind="done">on pace</Chip> : <Chip kind="att">behind pace</Chip> },
              ]}
            />
          )}
          <p className="note">{cpd.data?.note}</p>
        </Card>
      )}

      {tab === 'leave' && (
        <Card title="Leave">
          {leave.isLoading ? <Skeleton rows={4} /> : !leave.data?.leave.length ? <EmptyState>No leave requests.</EmptyState> : (
            <DataTable
              rows={leave.data.leave}
              rowKey={(l) => l.id}
              columns={[
                { key: 'staff', header: 'Staff', render: (l) => l.staffName },
                { key: 'type', header: 'Type', render: (l) => l.type },
                { key: 'dates', header: 'Dates', render: (l) => <span className="mono">{l.fromDate} to {l.toDate}</span> },
                { key: 'days', header: 'Days', num: true, render: (l) => <span className="mono">{l.days}</span> },
                { key: 'status', header: 'Status', render: (l) => <StatusChip status={l.status} /> },
              ]}
            />
          )}
          <p className="note">Approving leave opens the affected shifts as gaps, which wakes the Roster Hand.</p>
        </Card>
      )}

      {gapOpen && (
        <Sheet open onClose={() => setGapOpen(null)} title={`${gapOpen.role} · ${gapOpen.date} ${gapOpen.startTime}–${gapOpen.endTime}`}>
          <KV items={[
            ['Site', gapOpen.siteName],
            ['Competency required', gapOpen.requiredCompetency ?? 'none'],
            ['Reason', gapOpen.gapReason ?? '—'],
            ['Status', <StatusChip status={gapOpen.status} key="s" />],
            ['Proposal', gapOpen.note ?? 'No Roster Hand proposal yet'],
            ['Agency cost', gapOpen.agencyCents ? <Money cents={gapOpen.agencyCents} key="c" /> : '—'],
          ]} />
          {rosterHand.data && (
            <Banner kind={rosterHand.data.task.status === 'done' ? 'ok' : 'warn'}>
              {rosterHand.data.task.status === 'done'
                ? `Filled by ${String(rosterHand.data.task.output?.method).replace('_', ' ')}${rosterHand.data.task.output?.staffName ? `: ${rosterHand.data.task.output.staffName}` : ''}.`
                : `Needs approval: ${rosterHand.data.task.approvalReason}`}
            </Banner>
          )}
          <div className="row-flex">
            <Button variant="primary" disabled={rosterHand.isPending} onClick={() => rosterHand.mutate(gapOpen.id)}>Ask the Roster Hand to fill this gap</Button>
          </div>
          <p className="note">The Hand checks credentials, BCEA rest rules across every site the worker is rostered to, leave and clashes before it offers a shift.</p>
        </Sheet>
      )}

      <DefinitionSheet tile={define} onClose={() => setDefine(null)} />
    </div>
  );
}
