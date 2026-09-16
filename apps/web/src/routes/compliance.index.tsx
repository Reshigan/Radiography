import { createFileRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, StatusChip, Skeleton, EmptyState, DataTable, Tile, Sheet, KV, Field, Input, Provenance, SlaBar, DateTime, Timeline } from '@bonakala/bdl';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/compliance/')({ component: ComplianceBoard });

/* ---------- shared types used by /compliance/* and /practice/quality ---------- */
export interface Incident {
  id: string; ref: string; category: string; severity: number; title: string; description: string | null; siteId: string | null;
  occurredAt: string; reportedAt: string; patientMasked: string | null; status: string; regulator: string | null;
  timeline: Array<{ at: string; text: string; kind?: 'ok' | 'crit' | 'ai' | 'neutral'; source?: string }>;
  immediateActions: Array<{ item: string; done: boolean; at?: string }> | null;
  rca: { method: string; factors: Array<{ factor: string; finding: string }>; conclusion?: string; investigator?: string } | null;
  correctiveActions: Array<{ action: string; owner: string; due: string; status: string; effectivenessCheck?: string }> | null;
  reportDraft: { status: string; text?: string; draftedAt?: string; submittedBy?: string; submittedAt?: string; reference?: string; provenance?: Record<string, unknown> } | null;
  learningSummary: string | null; linkedRefs: string[] | null;
}
export interface Complaint {
  id: string; ref: string; channel: string; route: string; category: string; subject: string; severity: string;
  receivedAt: string; acknowledgedAt: string | null; respondBy: string; respondedAt: string | null; status: string;
  externalRef: string | null; legalHold: boolean; slaPct: number; ackOverdue: boolean; respondOverdue: boolean;
}
export interface ReportableResult {
  id: string; ref: string; category: string; categoryLabel: string; patientMasked: string | null; siteId: string | null;
  referrerName: string | null; ackWindowHours: number; ackDueAt: string; ackAt: string | null; ackBy: string | null;
  packName: string | null; packSentAt: string | null; packChannel: string | null; status: string;
  patientReleaseWithheld: boolean; escalations: number; ackOverdue: boolean; ackPct: number; notes: string | null;
}
export interface DataSubjectRequest {
  id: string; ref: string; type: string; requesterMasked: string; receivedAt: string; statutoryDueAt: string; policyDueAt: string;
  statutoryDays: number; status: string; checklist: Array<{ item: string; done: boolean; at?: string }>; statutoryPct: number;
  policyPct: number; statutoryDaysLeft: number; pastStatutory: boolean; identityVerified: boolean;
}
export interface BoardTiles {
  tiles: {
    obligations: { total: number; current: number; due30: number; overdue: number };
    incidentsByRegulator: Array<{ regulator: string; open: number }>;
    incidentsOpen: number;
    reportableResults: { open: number; awaitingAck: number; acknowledged: number };
    licenceExpiries: Array<{ roomId: string; label: string; licenceNo: string | null; expiry: string | null; days: number | null }>;
    credentialExpiries: Array<{ staff: string; type: string; expiry: string | null; days: number | null }>;
    dataSubjectRequests: { open: number; withinPolicy: number; pastStatutory: number };
    auditFindings: { open: number; major: number; pastDue: number; byType: Array<{ type: string; n: number }> };
  };
  asOf: string;
}
export interface CalendarItem { dueDate: string; obligationId: string; title: string; instrument: string; owner: string; automation: string; leads: number[]; state: string; daysToDue: number | null; evidenceCount: number }

/** Incident detail: reconstructed timeline, RCA, corrective actions and the Compliance Hand draft. */
export function IncidentTimeline({ incident, onSubmitted }: { incident: Incident; onSubmitted?: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [reference, setReference] = useState('');
  const draft = useMutation({ mutationFn: () => api.post(`/compliance/incidents/${incident.id}/draft-report`), onSuccess: () => void qc.invalidateQueries() });
  const submit = useMutation({
    mutationFn: () => api.post(`/compliance/incidents/${incident.id}/submit-report`, { confirm, reference: reference || undefined }),
    onSuccess: () => { setConfirm(''); setReference(''); void qc.invalidateQueries(); onSubmitted?.(); },
  });
  const d = incident.reportDraft;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="facts">
        <div><span>Severity</span><b>{incident.severity}</b></div>
        <div><span>Status</span><b>{incident.status.replace(/_/g, ' ')}</b></div>
        <div><span>Regulator</span><b>{incident.regulator && incident.regulator !== 'none' ? incident.regulator : 'none'}</b></div>
        <div><span>Occurred</span><b><DateTime iso={incident.occurredAt} /></b></div>
        {incident.patientMasked && <div><span>Patient</span><b className="mono">{incident.patientMasked}</b></div>}
      </div>

      <div>
        <h4 style={{ marginBottom: 6 }}>Timeline reconstructed from events</h4>
        <Timeline items={incident.timeline.map((t) => ({ time: t.at.slice(11, 16), text: <>{t.text}{t.source ? <span className="muted small"> · {t.source}</span> : null}</>, kind: t.kind }))} />
      </div>

      {incident.immediateActions && incident.immediateActions.length > 0 && (
        <div>
          <h4 style={{ marginBottom: 6 }}>Immediate actions</h4>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            {incident.immediateActions.map((a, i) => <li key={i}>{a.item} {a.done ? <Chip kind="done">done</Chip> : <Chip kind="att">open</Chip>}</li>)}
          </ul>
        </div>
      )}

      {incident.rca && (
        <div>
          <h4 style={{ marginBottom: 6 }}>Root-cause analysis</h4>
          <div className="small muted">{incident.rca.method}{incident.rca.investigator ? ` · ${incident.rca.investigator}` : ''}</div>
          <ul className="small" style={{ paddingLeft: 18 }}>{incident.rca.factors.map((f, i) => <li key={i}><b>{f.factor}:</b> {f.finding}</li>)}</ul>
          {incident.rca.conclusion && <p className="small">{incident.rca.conclusion}</p>}
        </div>
      )}

      {incident.correctiveActions && incident.correctiveActions.length > 0 && (
        <div>
          <h4 style={{ marginBottom: 6 }}>Corrective actions</h4>
          <DataTable
            rows={incident.correctiveActions}
            rowKey={(a) => a.action}
            columns={[
              { key: 'a', header: 'Action', render: (a) => a.action },
              { key: 'o', header: 'Owner', render: (a) => a.owner },
              { key: 'd', header: 'Due', render: (a) => <span className="mono">{a.due}</span> },
              { key: 's', header: 'Status', render: (a) => <StatusChip status={a.status} /> },
            ]}
          />
        </div>
      )}

      <div>
        <h4 style={{ marginBottom: 6 }}>Regulator notification</h4>
        {(!d || d.status === 'none') && incident.regulator && incident.regulator !== 'none' && (
          <>
            <p className="small muted">No draft yet. The Compliance Hand assembles the facts from Platform records; it has no tool that can submit.</p>
            <Button size="sm" variant="primary" disabled={draft.isPending} onClick={() => draft.mutate()}>Ask the Compliance Hand to draft</Button>
          </>
        )}
        {(!incident.regulator || incident.regulator === 'none') && <p className="small muted">This category carries no regulator notification duty.</p>}
        {d && d.status !== 'none' && (
          <Provenance prov={{ modelId: (d.provenance?.modelId as string) ?? 'compliance-draft', modelVersion: (d.provenance?.modelVersion as string) ?? '1.4.0', outputClass: 3, demo: true }} accepted={d.status === 'submitted'}>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--mono)' }}>{d.text}</pre>
          </Provenance>
        )}
        {d?.status === 'awaiting_cmp' && (
          <div style={{ marginTop: 10 }}>
            <Banner kind="warn">This draft has not been submitted. Submission to {incident.regulator} is a human action by compliance, with a named submitter recorded.</Banner>
            <div className="row-flex" style={{ marginTop: 8, alignItems: 'flex-end' }}>
              <Field label={`Type ${incident.ref} to confirm`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={incident.ref} /></Field>
              <Field label="Portal reference (optional)"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SAHPRA-..." /></Field>
              <Button variant="primary" disabled={confirm !== incident.ref || submit.isPending} onClick={() => submit.mutate()}>Submit to {incident.regulator}</Button>
            </div>
            {submit.isError && <Banner kind="crit">{(submit.error as Error).message}</Banner>}
          </div>
        )}
        {d?.status === 'submitted' && (
          <div className="note" style={{ marginTop: 8 }}>Submitted {d.submittedAt ? new Date(d.submittedAt).toLocaleDateString('en-ZA') : ''}{d.reference ? ` · reference ${d.reference}` : ''}. The submitter is recorded in the audit log.</div>
        )}
      </div>

      {incident.learningSummary && (
        <div><h4 style={{ marginBottom: 6 }}>Learning summary</h4><p className="small">{incident.learningSummary}</p></div>
      )}
    </div>
  );
}

/** 90-day calendar strip drawn as inline SVG (docs/25 S-CMP-01). */
export function CalendarStrip({ items }: { items: CalendarItem[] }) {
  const days = 90;
  const back = 14;
  const w = 960;
  const h = 190;
  const axisY = 96;
  const left = 46;
  const pxPerDay = (w - left - 24) / (days + back);
  const x = (d: number) => left + (Math.max(-back, Math.min(days, d)) + back) * pxPerDay;

  // Pick items that can be labelled without colliding: nearest first, keeping a minimum gap per lane.
  const MIN_GAP = 132;
  const candidates = items
    .filter((i) => (i.daysToDue ?? 999) <= days && (i.daysToDue ?? -999) >= -back)
    .sort((a, b) => (a.state === 'overdue' ? -1 : 0) - (b.state === 'overdue' ? -1 : 0) || (a.daysToDue ?? 0) - (b.daysToDue ?? 0));
  const lanes: Array<{ above: boolean; row: number; lastX: number }> = [
    { above: true, row: 0, lastX: -Infinity }, { above: true, row: 1, lastX: -Infinity },
    { above: false, row: 0, lastX: -Infinity }, { above: false, row: 1, lastX: -Infinity },
  ];
  const placed: Array<{ item: CalendarItem; cx: number; above: boolean; row: number }> = [];
  const markers: Array<{ cx: number; tone: string }> = [];
  for (const it of candidates) {
    const cx = x(it.daysToDue ?? 0);
    const tone = it.state === 'overdue' ? 'var(--crit)' : (it.daysToDue ?? 99) <= 30 ? 'var(--warn)' : 'var(--ok)';
    markers.push({ cx, tone });
    const lane = lanes.find((l) => cx - l.lastX >= MIN_GAP);
    if (!lane || placed.length >= 8) continue;
    lane.lastX = cx;
    placed.push({ item: it, cx, above: lane.above, row: lane.row });
  }

  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" width="100%" aria-label={`Regulatory calendar: ${candidates.length} obligations due in the next 90 days`} style={{ fontFamily: 'var(--sans, inherit)', fontSize: 10 }}>
        <line x1={left - 6} y1={axisY} x2={w - 16} y2={axisY} stroke="var(--line-strong)" />
        {[0, 30, 60, 90].map((m) => (
          <g key={m}>
            <line x1={x(m)} y1={axisY - 4} x2={x(m)} y2={axisY + 4} stroke="var(--line-strong)" />
            <text x={x(m)} y={axisY + 17} textAnchor="middle" fill="var(--text-2)" style={{ fontFamily: 'var(--mono)' }}>{m === 0 ? 'today' : `+${m} d`}</text>
          </g>
        ))}
        <line x1={x(0)} y1={16} x2={x(0)} y2={h - 16} stroke="var(--iris-ink, var(--primary))" strokeWidth="1.5" />
        {markers.map((m, i) => <circle key={i} cx={m.cx} cy={axisY} r="3" fill={m.tone} />)}
        {placed.map(({ item: it, cx, above, row }) => {
          const tone = it.state === 'overdue' ? 'var(--crit)' : (it.daysToDue ?? 99) <= 30 ? 'var(--warn)' : 'var(--ok)';
          const labelY = above ? axisY - 22 - row * 30 : axisY + 40 + row * 30;
          const anchor = cx > w - 150 ? 'end' : 'start';
          const tx = anchor === 'end' ? cx - 6 : cx + 6;
          return (
            <g key={`${it.obligationId}:${it.dueDate}`}>
              <line x1={cx} y1={above ? labelY + 6 : labelY - 14} x2={cx} y2={axisY} stroke={tone} strokeWidth="1" />
              <text x={tx} y={labelY} textAnchor={anchor} fill="var(--text)">{it.instrument.length > 30 ? `${it.instrument.slice(0, 29)}…` : it.instrument}</text>
              <text x={tx} y={labelY + 11} textAnchor={anchor} fill="var(--text-2)" style={{ fontFamily: 'var(--mono)' }}>{it.dueDate} · {it.owner} · {it.automation}</text>
            </g>
          );
        })}
      </svg>
      <div className="small muted" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>{candidates.length} obligations in the window</span>
        <span>{candidates.filter((i) => i.state === 'overdue').length} overdue</span>
        <span>{candidates.filter((i) => (i.daysToDue ?? 99) >= 0 && (i.daysToDue ?? 99) <= 30).length} due within 30 days</span>
        <span>labels shown for the {placed.length} nearest; the full list is on the calendar page</span>
      </div>
    </>
  );
}

function SubTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' }) {
  return <Tile label={label} value={value} delta={sub} tone={tone} />;
}

/* ============================== the page ============================== */
function ComplianceBoard() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [openIncident, setOpenIncident] = useState<Incident | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [packKind, setPackKind] = useState('sahpra');

  const board = useQuery({ queryKey: ['cmp-board'], queryFn: () => api.get<BoardTiles>('/compliance/board'), refetchInterval: 120_000 });
  const calendar = useQuery({ queryKey: ['cmp-calendar'], queryFn: () => api.get<{ items: CalendarItem[]; leadDays: number[] }>('/compliance/calendar?days=90') });
  const rr = useQuery({ queryKey: ['reportable'], queryFn: () => api.get<{ results: ReportableResult[]; note: string }>('/compliance/reportable-results') });
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api.get<{ incidents: Incident[] }>('/compliance/incidents') });
  const requests = useQuery({ queryKey: ['dsr'], queryFn: () => api.get<{ requests: DataSubjectRequest[]; note: string }>('/compliance/requests') });
  const packs = useQuery({ queryKey: ['packs'], queryFn: () => api.get<{ packs: Array<{ id: string; kind: string; title: string; createdAt: string }>; kinds: string[] }>('/compliance/evidence-packs') });

  const generate = useMutation({
    mutationFn: () => api.post<{ packId: string | null }>('/compliance/evidence-packs', { kind: packKind }),
    onSuccess: () => { setPackOpen(false); void qc.invalidateQueries({ queryKey: ['packs'] }); },
  });
  const acknowledge = useMutation({
    mutationFn: ({ id, by }: { id: string; by: string }) => api.post(`/compliance/reportable-results/${id}/acknowledge`, { by }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reportable'] }),
  });

  const t = board.data?.tiles;
  const focusIncident = openIncident ?? (incidents.data?.incidents ?? []).find((i) => i.status !== 'closed' && i.severity <= 2) ?? null;
  const focusRequest = (requests.data?.requests ?? []).find((r) => r.status !== 'fulfilled') ?? null;
  const openRr = (rr.data?.results ?? []).filter((x) => x.status !== 'closed');
  const groupScope = !!me && !me.practiceId;

  return (
    <div className="page">
      <PageHeader
        title="Regulatory status board"
        subtitle={board.data ? `Register built from effective-dated records · refreshed ${new Date(board.data.asOf).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'Loading the register'}
        actions={
          <>
            <a className="btn" href="/compliance/calendar">Regulatory calendar</a>
            <a className="btn" href="/compliance/audits">Audits and policies</a>
            <Button variant="primary" onClick={() => setPackOpen(true)}>Generate inspection pack</Button>
          </>
        }
      />

      {groupScope && (
        <Banner kind="info">
          Showing every practice in scope. Select a practice in the context bar before generating a pack or recording a submission: those acts belong to one practice.
        </Banner>
      )}
      {t && t.obligations.overdue > 0 && <Banner kind="crit" action={<a className="btn sm" href="/compliance/register">Open register</a>}>{t.obligations.overdue} obligation{t.obligations.overdue > 1 ? 's are' : ' is'} past due without a recorded submission. Overdue items escalate to the group executive.</Banner>}
      {board.isError && <Banner kind="crit">The compliance board could not be loaded. Refresh, or call platform support with reference compliance-board.</Banner>}

      {board.isLoading || !t ? <div className="grid g6">{Array.from({ length: 6 }, (_, i) => <Card key={i}><Skeleton rows={2} /></Card>)}</div> : (
        <div className="grid g6">
          <SubTile label="Obligations" value={t.obligations.total} sub={`${t.obligations.current} current · ${t.obligations.due30} due in 30 d · ${t.obligations.overdue} overdue`} tone={t.obligations.overdue ? 'down' : 'up'} />
          <SubTile label="Open incidents by regulator" value={t.incidentsOpen} sub={t.incidentsByRegulator.filter((x) => x.open).map((x) => `${x.regulator} ${x.open}`).join(' · ') || 'none open'} />
          <SubTile label="Reportable-result flags open" value={t.reportableResults.open} sub={`${t.reportableResults.awaitingAck} awaiting acknowledgement · ${t.reportableResults.acknowledged} acknowledged`} tone={t.reportableResults.awaitingAck ? 'down' : 'up'} />
          <SubTile label="Licence expiries in 90 days" value={t.licenceExpiries.length} sub={t.licenceExpiries.slice(0, 2).map((l) => `${l.label} ${l.days} d`).join(' · ') || 'none'} />
          <SubTile label="Data-subject requests" value={t.dataSubjectRequests.open} sub={`${t.dataSubjectRequests.withinPolicy} within policy · ${t.dataSubjectRequests.pastStatutory} past statutory`} tone={t.dataSubjectRequests.pastStatutory ? 'down' : 'up'} />
          <SubTile label="Audit findings open" value={t.auditFindings.open} sub={`${t.auditFindings.major} major · ${t.auditFindings.pastDue} past due`} tone={t.auditFindings.pastDue ? 'down' : undefined} />
        </div>
      )}

      <Card title="Regulatory calendar · next 90 days" extra="Lead times 90 / 60 / 30 / 7 days · overdue escalates to the executive">
        {calendar.isLoading ? <Skeleton rows={4} /> : !calendar.data?.items.length ? <EmptyState>No calendar items in the window.</EmptyState> : <CalendarStrip items={calendar.data.items} />}
      </Card>

      <Card
        title="Reportable-results register"
        extra={openRr.length ? <Chip kind="att">{openRr.length} open</Chip> : <Chip kind="done">all closed</Chip>}
      >
        {rr.isLoading ? <Skeleton rows={4} /> : !rr.data?.results.length ? <EmptyState>No reportable-result flags raised.</EmptyState> : (
          <DataTable
            rows={rr.data.results}
            rowKey={(x) => x.id}
            columns={[
              { key: 'ref', header: 'Reference', width: 120, render: (x) => <span className="mono">{x.ref}</span> },
              { key: 'cat', header: 'Category', render: (x) => x.categoryLabel },
              { key: 'patient', header: 'Patient', width: 120, render: (x) => <span className="mono">{x.patientMasked ?? '—'}</span> },
              {
                key: 'ack', header: 'Referrer acknowledgement', width: 230,
                render: (x) => x.ackAt
                  ? <><Chip kind="done">acknowledged</Chip><div className="small muted">{new Date(x.ackAt).toLocaleString('en-ZA', { hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {x.ackBy}</div></>
                  : <><Chip kind={x.ackOverdue ? 'crit' : 'att'}>{x.ackOverdue ? 'overdue' : `awaiting · ${x.ackWindowHours} h window`}</Chip><SlaBar pct={x.ackPct} /></>,
              },
              { key: 'pack', header: 'Pack sent', render: (x) => <><div className="small">{x.packName}</div>{x.referrerName && <div className="small muted">{x.referrerName} · {x.packChannel}</div>}</> },
              {
                key: 'status', header: 'Status', width: 170,
                render: (x) => (
                  <>
                    <StatusChip status={x.status} />
                    {x.patientReleaseWithheld && <div className="small muted">patient release withheld</div>}
                    {x.escalations > 0 && <div className="small muted">escalated {x.escalations}×</div>}
                    {x.status === 'open' && <Button size="sm" onClick={() => acknowledge.mutate({ id: x.id, by: x.referrerName ?? 'referrer' })}>Record acknowledgement</Button>}
                  </>
                ),
              },
            ]}
          />
        )}
        <p className="note">{rr.data?.note}</p>
      </Card>

      <div className="split">
        <Card title={focusIncident ? `Incident · ${focusIncident.ref}` : 'Incidents'} extra={focusIncident ? <Chip kind="crit">{focusIncident.category.replace(/_/g, ' ')}</Chip> : undefined}>
          {incidents.isLoading ? <Skeleton rows={5} /> : focusIncident ? <IncidentTimeline incident={focusIncident} onSubmitted={() => setOpenIncident(null)} /> : <EmptyState>No open incidents at severity 1 or 2.</EmptyState>}
          {(incidents.data?.incidents ?? []).length > 1 && (
            <div className="row-flex" style={{ marginTop: 10 }}>
              {(incidents.data?.incidents ?? []).filter((i) => i.status !== 'closed').slice(0, 5).map((i) => (
                <Button key={i.id} size="sm" onClick={() => setOpenIncident(i)}>{i.ref}</Button>
              ))}
              <a className="btn sm" href="/compliance/incidents">All incidents</a>
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="POPIA and PAIA requests" extra={<a className="link" href="/compliance/requests">All requests</a>}>
            {requests.isLoading ? <Skeleton rows={3} /> : !focusRequest ? <EmptyState>No requests in progress.</EmptyState> : (
              <>
                <KV items={[
                  ['Reference', <span className="mono" key="r">{focusRequest.ref}</span>],
                  ['Type', focusRequest.type],
                  ['Requester', <span className="mono" key="q">{focusRequest.requesterMasked}</span>],
                  ['Statutory clock', <>{focusRequest.statutoryDaysLeft} days left of {focusRequest.statutoryDays} <SlaBar pct={focusRequest.statutoryPct} /></>],
                  ['Policy clock', <SlaBar pct={focusRequest.policyPct} key="p" />],
                ]} />
                <ul className="small" style={{ paddingLeft: 18 }}>
                  {focusRequest.checklist.map((c, i) => <li key={i} className={c.done ? '' : 'muted'}>{c.item}{c.done ? ' · done' : ''}</li>)}
                </ul>
                <p className="note">{requests.data?.note}</p>
              </>
            )}
          </Card>

          <Card title="Evidence packs" extra={packs.data ? `${packs.data.packs.length} generated` : undefined}>
            {packs.isLoading ? <Skeleton rows={3} /> : !packs.data?.packs.length ? <EmptyState action={<Button size="sm" variant="primary" onClick={() => setPackOpen(true)}>Generate a pack</Button>}>No packs generated yet.</EmptyState> : (
              <DataTable
                rows={packs.data.packs}
                rowKey={(p) => p.id}
                columns={[
                  { key: 'kind', header: 'Pack', render: (p) => <>{p.title}<div className="small muted">{p.kind.toUpperCase()}</div></> },
                  { key: 'when', header: 'Generated', render: (p) => <DateTime iso={p.createdAt} time={false} /> },
                  { key: 'open', header: '', render: (p) => <a className="btn sm" href={`/api/compliance/evidence-packs/${p.id}?format=html`} target="_blank" rel="noreferrer">Open</a> },
                ]}
              />
            )}
            <p className="note">The Compliance Hand collects the evidence and hashes each section. Nothing in a pack has been submitted to a regulator.</p>
          </Card>
        </div>
      </div>

      {packOpen && (
        <Sheet open onClose={() => setPackOpen(false)} title="Generate an evidence pack">
          <Field label="Pack">
            <select value={packKind} onChange={(e) => setPackKind(e.target.value)}>
              {(packs.data?.kinds ?? ['sahpra']).map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
            </select>
          </Field>
          <p className="note">The Hand reads the registers, hashes each evidence section and stores a manifest with the audit range. Generation takes a few seconds.</p>
          {generate.isError && <Banner kind="crit">{(generate.error as Error).message}</Banner>}
          <div className="row-flex">
            <Button variant="primary" disabled={generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? 'Collecting evidence…' : 'Generate'}</Button>
            <Button onClick={() => setPackOpen(false)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
