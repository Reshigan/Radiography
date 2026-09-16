import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, Provenance, Timeline, KV, StatusChip, Sheet, Field, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/debtors/')({ component: Page });

type Bucket = 'current' | '30' | '60' | '90' | '120+';
const BUCKETS: Bucket[] = ['current', '30', '60', '90', '120+'];
const CLASS_NOTE: Record<string, string> = { scheme: 'submission date', patient: 'notification date', raf: 'lodgement · long cycle', coida: 'long cycle', corporate: '30-day terms' };

interface Tiles {
  tiles: {
    openPatientCents: number; dsoDays: number; collection: { d30: number; d60: number; d90: number }; writeOffsMtdCents: number; writeOffPct: number;
    plansInArrearsPct: number; planBookCents: number; activePlans: number; disputesOpen: number; disputesPastSla: number; handoversPending: number; handoverCents: number;
    accounts: number; provisionCents: number; collectedCents: number;
  };
  ageing: Record<string, Record<Bucket, number> & { total: number }>;
  provision: { totalExposureCents: number; totalProvisionCents: number };
  lastRun: { id: string; startedAt: string; actions: number; byChannel: Record<string, number>; byStep: Record<string, number>; byBand: Record<string, number>; exclusions: Record<string, number>; insideWindow: number; needsHuman: number; policyVersion: string; sampleReviewedBy: string | null } | null;
}
interface Account { id: string; accountNo: string; debtorName: string | null; debtorClass: string; balanceCents: number; ageDays: number; liabilityReason: string | null; flags: string[]; dunningStage: string | null; propensityBand: string | null; planId: string | null; status: string; patientId: string }

function Page() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [cls, setCls] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [planInstalments, setPlanInstalments] = useState(3);

  const tiles = useQuery({ queryKey: ['debtors-tiles'], queryFn: () => api.get<Tiles>('/billing/debtors/tiles') });
  const accounts = useQuery({ queryKey: ['debtors-accounts', cls], queryFn: () => api.get<{ accounts: Account[] }>(`/billing/debtors/accounts?limit=200${cls ? `&debtorClass=${cls}` : ''}`) });
  const handover = useQuery({ queryKey: ['handover'], queryFn: () => api.get<{ handovers: Array<{ id: string; debtorName: string | null; amountCents: number; clean: boolean; failing: string[]; status: string }>; minimumCents: number }>('/billing/debtors/handover') });
  const disputes = useQuery({ queryKey: ['disputes'], queryFn: () => api.get<{ disputes: Array<{ id: string; debtorName: string | null; reason: string; message: string | null; amountCents: number; status: string; overdue: boolean; slaDueAt: string; evidence: any; raisedVia: string }> }>('/billing/debtors/disputes') });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<{ plans: Array<{ id: string; debtorName: string | null; totalCents: number; instalmentCount: number; status: string; nextDue: { n: number; dueDate: string; amountCents: number } | null; inArrears: boolean; schedule: Array<{ n: number; dueDate: string; amountCents: number; status: string }> }> }>('/billing/debtors/plans') });
  const detail = useQuery({ queryKey: ['account', selected], enabled: !!selected, queryFn: () => api.get<any>(`/billing/debtors/accounts/${selected}`) });

  const refreshAll = () => { for (const k of ['debtors-tiles', 'debtors-accounts', 'handover', 'disputes', 'plans', 'account']) void qc.invalidateQueries({ queryKey: [k] }); };
  const run = useMutation({ mutationFn: () => api.post('/billing/debtors/run', { dryRun: false }), onSuccess: (r: any) => { const o = r.task?.output ?? {}; setToast(`${o.actions ?? 0} actions inside the contact window; ${o.needsHuman ?? 0} need you. Excluded: ${Object.entries(o.exclusions ?? {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') || 'none'}.`); refreshAll(); }, onError: (e: Error) => setToast(e.message) });
  const review = useMutation({ mutationFn: (id: string) => api.post(`/billing/debtors/runs/${id}/review`, {}), onSuccess: () => { setToast('Sample reviewed and recorded against the Hand.'); refreshAll(); } });
  const makePlan = useMutation({ mutationFn: (id: string) => api.post('/billing/debtors/plans', { accountId: id, instalments: planInstalments }), onSuccess: (r: any) => { setToast(r.status === 'proposed' ? 'Plan proposed; it is above the Hand leash and needs approval.' : 'Plan active, interest free.'); refreshAll(); }, onError: (e: Error) => setToast(e.message) });
  const resolveDispute = useMutation({ mutationFn: (v: { id: string; outcome: string; writeOffCents: number }) => api.post(`/billing/debtors/disputes/${v.id}/resolve`, { outcome: v.outcome, note: v.outcome === 'upheld' ? 'We quoted this amount at booking and will honour it.' : 'Explained with the acquisition record and the remittance.', writeOffCents: v.writeOffCents, reason: 'quote_honoured_practice_error' }), onSuccess: () => { setToast('Dispute resolved and a corrected statement sent.'); refreshAll(); }, onError: (e: Error) => setToast(e.message) });
  const payLink = useMutation({ mutationFn: (v: { accountId: string; amountCents: number }) => api.post('/billing/payments/link', v), onSuccess: () => { setToast('Payment link sent on the consented channel.'); refreshAll(); }, onError: (e: Error) => setToast(e.message) });

  const t = tiles.data?.tiles;
  const ageing = tiles.data?.ageing;
  const run0 = tiles.data?.lastRun;
  const rows = accounts.data?.accounts ?? [];
  const openDispute = disputes.data?.disputes.find((d) => d.status === 'open') ?? null;
  const livePlan = plans.data?.plans.find((p) => p.status === 'active') ?? null;
  const approvals = [
    ...(handover.data?.handovers.filter((h) => h.status === 'proposed' && h.clean).length ? [{ kind: 'Handover', text: `${handover.data!.handovers.filter((h) => h.status === 'proposed' && h.clean).length} balances checklist-clean`, tone: 'att' as const, action: 'Review list', go: () => void navigate({ to: '/debtors/handover' }) }] : []),
    ...(plans.data?.plans.filter((p) => p.status === 'proposed').map((p) => ({ kind: 'Plan', text: `${p.debtorName ?? 'Account'} · ${(p.totalCents / 100).toFixed(2)} over ${p.instalmentCount} instalments`, tone: 'att' as const, action: 'Approve', go: () => void navigate({ to: '/debtors/plans' }) })) ?? []),
    ...(disputes.data?.disputes.filter((d) => d.overdue).map((d) => ({ kind: 'Dispute', text: `${d.debtorName ?? 'Account'} past the 5-day SLA`, tone: 'crit' as const, action: 'Open', go: () => void navigate({ to: '/debtors/disputes' }) })) ?? []),
  ].slice(0, 5);

  return (
    <div className="page">
      <PageHeader
        title="Debtors and collections"
        subtitle={t ? <>Open patient balances <Money cents={t.openPatientCents} /> · Hand ran {run0 ? new Date(run0.startedAt).toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}, {run0?.actions ?? 0} actions · {run0?.needsHuman ?? 0} need you</> : 'Loading the debtor book'}
        actions={<>
          <Button onClick={() => void navigate({ to: '/debtors/handover' })}>Handover ({t?.handoversPending ?? 0})</Button>
          <Button variant="primary" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? 'Running…' : 'Run collections'}</Button>
        </>}
      />
      {tiles.isError && <Banner kind="crit">The debtor book could not be loaded.</Banner>}
      {t && t.disputesPastSla > 0 && <Banner kind="crit">{t.disputesPastSla} dispute(s) past the five working-day SLA. Dunning is paused on every disputed balance.</Banner>}

      {tiles.isLoading ? <Skeleton rows={2} /> : t && (
        <div className="grid g6">
          <Tile label="DSO" value={<>{t.dsoDays}<small style={{ font: '500 13px var(--text-font)', color: 'var(--text-2)', marginLeft: 6 }}>days</small></>} delta="scheme ≤ 35 · patient ≤ 45" />
          <Tile label="Collected 30/60/90" value={`${t.collection.d30}·${t.collection.d60}·${t.collection.d90}`} tone="up" delta="per cent of the patient book" />
          <Tile label="Write-offs MTD" value={<Money cents={t.writeOffsMtdCents} />} delta={`${t.writeOffPct} % of gross`} />
          <Tile label="Plan book" value={<Money cents={t.planBookCents} />} delta={`${t.activePlans} active · ${t.plansInArrearsPct} % in arrears`} tone={t.plansInArrearsPct > 10 ? 'down' : 'up'} />
          <Tile label="Disputes open" value={t.disputesOpen} tone={t.disputesPastSla ? 'down' : undefined} delta={t.disputesPastSla ? `${t.disputesPastSla} past SLA` : 'all within SLA'} />
          <Tile label="Bad-debt provision" value={<Money cents={t.provisionCents} />} delta="ECL matrix by class and bucket" />
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="Collections Hand · last run" extra={run0 ? `${run0.actions} actions · policy v${run0.policyVersion}` : 'not run yet'}>
            {!run0 ? <EmptyState action={<Button size="sm" variant="primary" onClick={() => run.mutate()}>Run now</Button>}>The Hand has not run for this practice yet.</EmptyState> : (
              <Provenance prov={{ modelId: 'collections-hand', modelVersion: '2026.09.1', outputClass: 4, demo: true }} accepted={!!run0.sampleReviewedBy}>
                <div className="small"><b>Channel mix</b> · consent order WhatsApp, SMS, email, then post</div>
                <div style={{ display: 'flex', height: 10, borderRadius: 2, overflow: 'hidden', margin: '6px 0 4px' }}>
                  {Object.entries(run0.byChannel).map(([ch, n], i) => (
                    <span key={ch} style={{ display: 'block', height: '100%', width: `${(n / Math.max(1, run0.actions)) * 100}%`, background: ['var(--ok)', 'var(--info)', 'var(--warn)', 'var(--ash-500)'][i % 4] }} />
                  ))}
                </div>
                <div className="row-flex" style={{ fontSize: 11 }}>{Object.entries(run0.byChannel).map(([ch, n]) => <span key={ch} className="muted">{ch} {n}</span>)}</div>
                <KV items={[
                  ['Contact windows', <b key="w">08:00 to 20:00 SAST, never on a Sunday · {run0.insideWindow} of {run0.actions} inside the window</b>],
                  ['Sequence steps', <b key="s">{Object.entries(run0.byStep).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}</b>],
                  ['Propensity bands', <b key="b">{Object.entries(run0.byBand).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}</b>],
                ]} />
                <div className="small" style={{ marginTop: 8 }}><b>Excluded from this run · {Object.values(run0.exclusions).reduce((a, b) => a + b, 0)}</b></div>
                <div className="row-flex" style={{ marginTop: 4 }}>
                  {Object.entries(run0.exclusions).map(([k, n]) => <Chip key={k} kind={k === 'deceased' ? 'crit' : ['disputed', 'prescription_risk', 'vulnerable'].includes(k) ? 'att' : 'neutral'}>{k.replace(/_/g, ' ')} {n}</Chip>)}
                </div>
                <div className="acts">
                  <Button size="sm" variant="primary" disabled={!!run0.sampleReviewedBy || review.isPending} onClick={() => review.mutate(run0.id)}>{run0.sampleReviewedBy ? 'Sample reviewed' : 'Confirm sample reviewed'}</Button>
                  <Button size="sm" onClick={() => void navigate({ to: '/debtors/runs' })}>Open run log</Button>
                </div>
              </Provenance>
            )}
          </Card>

          <Card title="Ageing by debtor class" extra="as at today">
            {tiles.isLoading || !ageing ? <Skeleton rows={5} /> : (
              <>
                <table className="dt">
                  <thead><tr><th>Class</th>{BUCKETS.map((b) => <th key={b} className="num">{b === 'current' ? 'Current' : b}</th>)}<th className="num">Total</th></tr></thead>
                  <tbody>
                    {Object.entries(ageing).filter(([, v]) => v.total > 0).map(([k, v]) => (
                      <tr key={k} className={cls === k ? 'sel clickable' : 'clickable'} onClick={() => setCls(k === cls ? '' : k)}>
                        <td style={{ whiteSpace: 'normal', fontWeight: 500 }}>{k}<span className="small muted" style={{ display: 'block', fontWeight: 400 }}>{CLASS_NOTE[k]}</span></td>
                        {BUCKETS.map((b) => <td key={b} className={`num ${b === '120+' && v[b] > 0 ? 'neg' : ''}`}>{v[b] ? <Money cents={v[b]} /> : '—'}</td>)}
                        <td className="num"><Money cents={v.total} /></td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--surface-3)', fontWeight: 600 }}>
                      <td>Total</td>
                      {BUCKETS.map((b) => <td key={b} className="num"><Money cents={Object.values(ageing).reduce((a, v) => a + v[b], 0)} /></td>)}
                      <td className="num"><Money cents={Object.values(ageing).reduce((a, v) => a + v.total, 0)} /></td>
                    </tr>
                  </tbody>
                </table>
                <p className="note" style={{ marginTop: 6 }}>RAF and COIDA carry expected-recovery factors and are never dunned as patient debt. A payment plan on schedule counts as current, with arrears shown separately.</p>
              </>
            )}
          </Card>

          <Card title={`Accounts${cls ? ` · ${cls}` : ''}`} extra={`${rows.length}`}>
            {accounts.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState>No open accounts in this class.</EmptyState> : (
              <div style={{ maxHeight: 340, overflow: 'auto' }}>
                <DataTable
                  rows={rows}
                  rowKey={(x) => x.id}
                  selectedKey={selected ?? undefined}
                  onRowClick={(x) => setSelected(x.id)}
                  columns={[
                    { key: 'acc', header: 'Account', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.debtorName ?? x.accountNo}<span className="small muted mono" style={{ display: 'block' }}>{x.accountNo}</span></div> },
                    { key: 'bal', header: 'Balance', num: true, render: (x) => <Money cents={x.balanceCents} /> },
                    { key: 'age', header: 'Age', num: true, render: (x) => <span className={x.ageDays > 90 ? 'neg mono' : 'mono'}>{x.ageDays} d</span> },
                    { key: 'why', header: 'Reason', render: (x) => <span className="small">{(x.liabilityReason ?? '—').replace(/_/g, ' ')}</span> },
                    { key: 'band', header: 'Propensity', render: (x) => x.propensityBand ? <Chip kind={x.propensityBand === 'high' ? 'done' : x.propensityBand === 'low' ? 'att' : 'neutral'}>{x.propensityBand}</Chip> : <span className="muted">—</span> },
                    { key: 'stage', header: 'Stage', render: (x) => x.dunningStage ?? '—' },
                    { key: 'flags', header: 'Flags', render: (x) => x.flags.length ? <>{x.flags.map((f) => <Chip key={f} kind={f === 'deceased' ? 'crit' : 'att'}>{f.replace(/_/g, ' ')}</Chip>)}</> : <span className="muted">—</span> },
                  ]}
                />
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="Approvals required" extra="outside the Hand leash">
            {approvals.length === 0 ? <EmptyState>Nothing is waiting for you.</EmptyState> : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {approvals.map((a, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', padding: '7px 0', borderBottom: i < approvals.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 12 }}>
                    <Chip kind={a.tone}>{a.kind}</Chip>
                    <span>{a.text}</span>
                    <Button size="sm" variant="primary" onClick={a.go}>{a.action}</Button>
                  </div>
                ))}
              </div>
            )}
            <p className="note" style={{ marginTop: 6 }}>The Collections Hand may never write off and may never discount. Handover is a reserved action approved by the practice manager.</p>
          </Card>

          {openDispute && (
            <Card title={`Dispute · ${openDispute.debtorName ?? 'Account'}`} extra="dunning paused">
              <div className="wa" style={{ padding: 8, marginBottom: 8 }}>
                <div className="m" style={{ maxWidth: '100%', fontSize: 12 }}>{openDispute.message ?? openDispute.reason}<div className="t">{openDispute.raisedVia} · <Chip kind="ai">intent-classifier · dispute</Chip></div></div>
              </div>
              {openDispute.evidence?.claimRef && (
                <div className="grid g2" style={{ fontSize: 12 }}>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 2, padding: 8 }}><b>Claim</b><br />{openDispute.evidence.claimRef}<br /><span className="muted">{openDispute.evidence.funder}</span></div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 2, padding: 8 }}><b>Scheme paid</b><br /><Money cents={openDispute.evidence.paidCents ?? 0} /><br /><span className="muted">{openDispute.evidence.reason ?? 'per the remittance'}</span></div>
                </div>
              )}
              <div className="row-flex" style={{ marginTop: 8 }}>
                <Button size="sm" variant="primary" disabled={resolveDispute.isPending} onClick={() => resolveDispute.mutate({ id: openDispute.id, outcome: 'upheld', writeOffCents: openDispute.amountCents })}>Honour the quote · write off <Money cents={openDispute.amountCents} /></Button>
                <Button size="sm" disabled={resolveDispute.isPending} onClick={() => resolveDispute.mutate({ id: openDispute.id, outcome: 'not_upheld', writeOffCents: 0 })}>Explain and hold</Button>
              </div>
              <p className="note">A dispute pauses dunning on the disputed lines until it is resolved. SLA ends <DateTime iso={openDispute.slaDueAt} time={false} />.</p>
            </Card>
          )}

          {livePlan && (
            <Card title={`Payment plan · ${livePlan.debtorName ?? 'Account'}`} extra={<Chip kind={livePlan.inArrears ? 'att' : 'done'}>{livePlan.inArrears ? 'In arrears' : 'On schedule'}</Chip>}>
              <KV items={[
                ['Balance', <span key="b"><Money cents={livePlan.totalCents} /> · {livePlan.instalmentCount} instalments, no interest</span>],
                ['Next due', livePlan.nextDue ? <span key="n">{livePlan.nextDue.dueDate} · <Money cents={livePlan.nextDue.amountCents} /></span> : <span key="n" className="muted">complete</span>],
              ]} />
              <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(6, livePlan.schedule.length)}, 1fr)`, gap: 4, margin: '8px 0' }}>
                {livePlan.schedule.map((s) => (
                  <div key={s.n} style={{ borderRadius: 2, padding: '4px 6px', fontSize: 11, background: 'var(--surface-3)', borderTop: `3px solid ${s.status === 'paid' ? 'var(--ok)' : s.status === 'missed' ? 'var(--crit)' : 'var(--ash-300)'}`, color: s.status === 'paid' ? 'var(--ok)' : 'var(--text-2)' }}>
                    <b style={{ display: 'block', fontSize: 12 }}>{s.n} of {livePlan.schedule.length}</b>{s.dueDate.slice(5)} · {s.status}
                  </div>
                ))}
              </div>
              <p className="note">In plan mode the Hand reminds three days before, thanks after payment, and escalates to you at seven days late. It never restarts dunning.</p>
            </Card>
          )}

          {selected && detail.data && <AccountPanel data={detail.data} onLink={() => payLink.mutate({ accountId: selected, amountCents: detail.data.account.balanceCents })} onPlan={() => makePlan.mutate(selected)} instalments={planInstalments} setInstalments={setPlanInstalments} busy={payLink.isPending || makePlan.isPending} />}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Debtors"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}

function AccountPanel({ data, onLink, onPlan, instalments, setInstalments, busy }: { data: any; onLink: () => void; onPlan: () => void; instalments: number; setInstalments: (n: number) => void; busy: boolean }) {
  const a = data.account;
  const ledger: Array<{ at: string; description: string; type: string; amountCents: number; arithmetic: any }> = data.ledger ?? [];
  const score = data.score;
  const exclusions: string[] = data.exclusions ?? [];
  const latest = [...ledger].reverse().find((x) => x.type === 'transfer' && x.arithmetic);
  return (
    <>
      <div className="spread"><h3>{a.debtorName ?? a.accountNo}</h3><StatusChip status={a.status} /></div>
      <div className="muted small">{data.patient?.name} · account <span className="mono">{a.accountNo}</span> · {(a.consentChannels ?? []).join(', ') || 'no digital channel'} · {a.language}</div>

      <Card title="Balance" extra={exclusions.length ? 'excluded from dunning' : 'in the sequence'}>
        {latest?.arithmetic ? (
          <div className="collect">
            <span className="lbl">{latest.arithmetic.lines?.[0]?.description ?? 'Service'}<br /><span className="small mono">{latest.arithmetic.lines?.[0]?.code ?? ''}</span></span><Money cents={latest.arithmetic.totalCents ?? 0} />
            <span className="lbl">Scheme paid</span><Money cents={-(latest.arithmetic.schemePaidCents ?? 0)} />
            <span className="lbl">Adjustments</span><Money cents={-(latest.arithmetic.adjustmentsCents ?? 0)} />
            <span className="lbl tot">Patient owes</span><span className="tot"><Money cents={a.balanceCents} /></span>
          </div>
        ) : <KV items={[['Balance', <Money key="b" cents={a.balanceCents} />], ['Ageing from', a.ageingStartAt?.slice(0, 10) ?? '—']]} />}
        {latest?.arithmetic?.reason && <div className="note" style={{ marginTop: 6 }}>Reason: {latest.arithmetic.reason}</div>}
        {exclusions.length > 0 && <div className="row-flex" style={{ marginTop: 6 }}>{exclusions.map((e) => <Chip key={e} kind="att">{e.replace(/_/g, ' ')}</Chip>)}</div>}
      </Card>

      {score && (
        <Provenance prov={{ modelId: score.modelId, modelVersion: score.modelVersion, confidence: score.score, outputClass: 4, demo: true }}>
          Propensity to pay: <b>{score.band}</b> · 30 days {Math.round(score.p30 * 100)} %, 60 days {Math.round(score.p60 * 100)} %, 90 days {Math.round(score.p90 * 100)} %. Next best action: {score.nextBestAction.replace(/_/g, ' ')}.
          <div className="note" style={{ marginTop: 4 }}>The score sets cadence and channel only. It never decides whether care is provided, and never uses race, language or location.</div>
        </Provenance>
      )}

      <Card title="Ledger" extra={`${ledger.length} entries`}>
        {ledger.length === 0 ? <EmptyState>No transactions on this account.</EmptyState> : (
          <Timeline items={ledger.slice(-9).map((x) => ({ time: new Date(x.at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }), text: <>{x.description} <span className="mono">{x.amountCents >= 0 ? '+' : ''}{(x.amountCents / 100).toFixed(2)}</span></>, kind: x.type === 'payment' ? 'ok' : x.type === 'write_off' ? 'crit' : 'neutral' }))} />
        )}
      </Card>

      {a.balanceCents > 0 && (
        <Card title="Act on this account">
          <div className="row-flex">
            <Button size="sm" variant="primary" disabled={busy} onClick={onLink}>Send a payment link</Button>
            <Field label="Instalments"><input type="number" min={1} max={6} value={instalments} onChange={(e) => setInstalments(Number(e.target.value))} style={{ width: 70 }} /></Field>
            <Button size="sm" disabled={busy} onClick={onPlan}>Offer a plan</Button>
          </div>
          <p className="note">Plans are interest free by policy, which keeps them inside the National Credit Act&apos;s incidental-credit rules.</p>
        </Card>
      )}
    </>
  );
}
