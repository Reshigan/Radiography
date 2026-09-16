import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, Provenance, Timeline, KV, Bars, StatusChip, DateTime, Sheet, Field } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/billing/')({ component: Page });

interface Exception {
  id: string; kind: 'claim' | 'charge'; ref: string; patientId: string; patient: string; funderId: string; funder: string; procedure: string;
  family: string; reason: string; code: string; suggestion: string; level: string; path: string; ageHours: number; totalCents: number; status: string;
  staleDate: string | null; escalatedTo: string | null;
  provenance: { modelId?: string; modelVersion?: string; confidence?: number; outputClass?: number; demo?: boolean } | null;
}
interface Tiles {
  tiles: {
    unbilled: { count: number; valueCents: number; oldestDays: number };
    ready: { count: number; valueCents: number };
    inFlight: { count: number; valueCents: number; realtimeFunders: number };
    rejected: { count: number; valueCents: number; topFunder: { funderId: string; name: string; sharePct: number } | null };
    held: { count: number; valueCents: number };
    firstPass: { pct: number; pct7d: number };
    remittancesOpen: number; signedYesterday: number;
  };
  waves: Array<{ id: string; funderId: string; reasonCode: string; claimCount: number; atRiskCents: number; startedAt: string; probableCause: string; pausedRule: string | null; rulePackVersion: string | null }>;
}

function Page() {
  const qc = useQueryClient();
  const [family, setFamily] = useState<string>('');
  const [selected, setSelected] = useState<Exception | null>(null);
  const [editing, setEditing] = useState(false);
  const [authRef, setAuthRef] = useState('');
  const [icd10, setIcd10] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const tiles = useQuery({ queryKey: ['billing-tiles'], queryFn: () => api.get<Tiles>('/billing/tiles') });
  const exceptions = useQuery({ queryKey: ['billing-exceptions', family], queryFn: () => api.get<{ exceptions: Exception[]; total: number; families: Record<string, number> }>(`/billing/exceptions${family ? `?family=${encodeURIComponent(family)}` : ''}`) });
  const rejections = useQuery({ queryKey: ['billing-rejections'], queryFn: () => api.get<{ byReason: Record<string, { count: number; label: string; funders: Record<string, number> }>; total: number; deadlines: Array<{ claimRef: string; staleDate: string; daysLeft: number; totalCents: number }>; soonest: { claimRef: string; staleDate: string; daysLeft: number } | null; within30: number }>('/billing/rejections') });
  const detail = useQuery({
    queryKey: ['billing-exception-detail', selected?.kind, selected?.id],
    enabled: !!selected,
    queryFn: () => api.get<any>(selected!.kind === 'claim' ? `/billing/claims/${selected!.id}` : `/billing/charges/${selected!.id}`),
  });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['billing-tiles'] }); void qc.invalidateQueries({ queryKey: ['billing-exceptions'] }); void qc.invalidateQueries({ queryKey: ['billing-rejections'] }); void qc.invalidateQueries({ queryKey: ['billing-exception-detail'] }); };

  const accept = useMutation({
    mutationFn: async (vars: { row: Exception; authRef?: string; icd10?: string[] }) => {
      if (vars.row.kind === 'charge') return api.post(`/billing/charges/${vars.row.id}/accept`, { authRef: vars.authRef, icd10: vars.icd10 });
      return api.post(`/billing/claims/${vars.row.id}/resubmit`, { authRef: vars.authRef, icd10: vars.icd10, note: 'Accepted from the exception queue' });
    },
    onSuccess: (r: any) => { setToast(r?.ok === false ? 'The claim still fails the scrubber. Open it to see the blocking rule.' : 'Accepted and sent to the switch.'); setEditing(false); setAuthRef(''); setIcd10(''); refresh(); },
    onError: (e: Error) => setToast(e.message),
  });
  const escalate = useMutation({
    mutationFn: (row: Exception) => row.kind === 'charge' ? api.post(`/billing/charges/${row.id}/escalate`, { to: 'PRM', reason: 'Escalated from the exception queue' }) : api.post(`/billing/claims/${row.id}/reverse`, { reason: 'Escalated for review' }),
    onSuccess: () => { setToast('Escalated.'); refresh(); },
    onError: (e: Error) => setToast(e.message),
  });
  const submitBatch = useMutation({
    mutationFn: () => api.post('/billing/claims/submit', {}),
    onSuccess: (r: any) => { setToast(`Batch run: ${r.task?.output?.submitted ?? 0} submitted, ${r.task?.output?.held ?? 0} held.`); refresh(); },
    onError: (e: Error) => setToast(e.message),
  });

  const t = tiles.data?.tiles;
  const wave = tiles.data?.waves?.[0];
  const rows = exceptions.data?.exceptions ?? [];
  const families = exceptions.data?.families ?? {};
  const maxReason = useMemo(() => Math.max(1, ...Object.values(rejections.data?.byReason ?? {}).map((x) => x.count)), [rejections.data]);

  return (
    <div className="page">
      <PageHeader
        title="Claims and exceptions"
        subtitle={t ? `${t.signedYesterday} signed in the last day · ${t.ready.count} ready to submit · ${t.inFlight.count} in flight · ${t.rejected.count} rejected` : 'Loading the revenue cycle'}
        actions={<>
          <Button onClick={() => { window.location.href = '/billing/remittances'; }}>Remittances{t ? ` (${t.remittancesOpen})` : ''}</Button>
          <Button variant="primary" disabled={submitBatch.isPending || !t?.ready.count} onClick={() => submitBatch.mutate()}>{submitBatch.isPending ? 'Submitting…' : `Submit batch${t ? ` (${t.ready.count})` : ''}`}</Button>
        </>}
      />

      {tiles.isError && <Banner kind="crit">The billing console could not load. Refresh the page or contact support.</Banner>}

      {wave && (
        <Banner kind="crit" action={<Button size="sm" onClick={() => { setFamily('Funder rule'); }}>Show held claims</Button>}>
          <b>Rejection wave.</b> {wave.probableCause}{' '}
          {wave.claimCount} claims held, <Money cents={wave.atRiskCents} /> at risk, since <DateTime iso={wave.startedAt} date time={false} />.{' '}
          <Chip kind="ai">claims-hand · paused rule {wave.pausedRule ?? 'R21'}</Chip>
        </Banner>
      )}

      {tiles.isLoading ? <Skeleton rows={2} /> : t && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          <Tile label="Unbilled" value={t.unbilled.count} delta={<><Money cents={t.unbilled.valueCents} /> · oldest {t.unbilled.oldestDays} days</>} />
          <Tile label="Ready to submit" value={t.ready.count} delta={<>scrubbed clean · <Money cents={t.ready.valueCents} /></>} />
          <Tile label="In flight" value={t.inFlight.count} delta={<><Money cents={t.inFlight.valueCents} /> · {t.inFlight.realtimeFunders} real-time schemes</>} />
          <Tile label="Rejected" value={t.rejected.count} tone="down" delta={<><Money cents={t.rejected.valueCents} />{t.rejected.topFunder ? ` · ${t.rejected.topFunder.sharePct} % one scheme` : ''}</>} />
          <Tile label="First-pass acceptance" value={`${t.firstPass.pct7d} %`} tone={t.firstPass.pct7d >= t.firstPass.pct ? 'up' : 'down'} delta={`${t.firstPass.pct} % all time`} />
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="spread">
            <div className="row-flex">
              <h3>Exception queue</h3>
              <span className="pill">{exceptions.data?.total ?? 0}</span>
              <button className="link" onClick={() => setFamily('')}><Chip kind={family ? 'neutral' : 'active'}>All</Chip></button>
              {Object.entries(families).map(([f, n]) => (
                <button key={f} className="link" onClick={() => setFamily(f === family ? '' : f)}><Chip kind={f === family ? 'active' : 'neutral'}>{f} {n}</Chip></button>
              ))}
            </div>
            <span className="small muted">Sorted by age · 24 h then 48 h</span>
          </div>

          {exceptions.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? (
            <EmptyState>No exceptions. Everything signed has been coded, scrubbed and submitted.</EmptyState>
          ) : (
            <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
              <DataTable
                rows={rows}
                rowKey={(x) => x.id}
                selectedKey={selected?.id}
                onRowClick={(x) => { setSelected(x); setEditing(false); setAuthRef(''); setIcd10(''); }}
                columns={[
                  { key: 'ref', header: 'Claim', width: 84, render: (x) => <span className="mono small">{x.ref}</span> },
                  { key: 'patient', header: 'Patient · funder', width: 126, render: (x) => <div style={{ width: 116, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25 }}>{x.patient}<span className="small muted" style={{ display: 'block' }}>{x.funder}</span></div> },
                  { key: 'proc', header: 'Procedure', width: 108, render: (x) => <span title={x.procedure} style={{ display: 'block', width: 98, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.procedure}</span> },
                  { key: 'issue', header: 'Issue', width: 120, render: (x) => <div style={{ width: 110, fontSize: 12, lineHeight: 1.3, whiteSpace: 'normal' }}><b style={{ fontWeight: 500, display: 'block' }}>{x.family}</b><span className="muted">{x.reason}</span></div> },
                  { key: 'sug', header: 'Suggestion', width: 170, render: (x) => <div style={{ width: 160, whiteSpace: 'normal', lineHeight: 1.3, fontSize: 12, padding: '4px 0' }}>{x.provenance?.modelId && <Chip kind="ai">{x.provenance.modelId} · {x.provenance.confidence?.toFixed(2)}</Chip>} {x.suggestion}</div> },
                  { key: 'age', header: 'Age', width: 50, render: (x) => <><span className="mono small" style={{ display: 'block' }}>{x.ageHours < 72 ? `${x.ageHours} h` : `${Math.round(x.ageHours / 24)} d`}</span><span className={`sla ${x.ageHours >= 48 ? 'crit' : x.ageHours >= 24 ? 'warn' : ''}`}><i style={{ width: `${Math.min(100, (x.ageHours / 48) * 100)}%` }} /></span></> },
                  {
                    key: 'act', header: 'Actions', width: 150, render: (x) => (
                      <span style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="primary" disabled={accept.isPending} onClick={() => accept.mutate({ row: x })}>Accept</Button>{' '}
                        <Button size="sm" onClick={() => { setSelected(x); setEditing(true); }}>Edit</Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => escalate.mutate(x)}>Escalate</Button>
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          )}

          <div className="split">
            <Card title="Rejections by reason" extra={`last 14 days · n = ${rejections.data?.total ?? 0}`}>
              {rejections.isLoading ? <Skeleton rows={4} /> : Object.keys(rejections.data?.byReason ?? {}).length === 0 ? <EmptyState>No rejections in the last 14 days.</EmptyState> : (
                <Bars
                  max={maxReason}
                  data={Object.entries(rejections.data!.byReason).sort((a, b) => b[1].count - a[1].count).map(([code, v]) => ({ label: v.label, value: v.count, tone: code === 'AUTH_REQ' || code === 'ICD_INVALID' ? 'crit' : 'info' }))}
                />
              )}
            </Card>
            <Card title="Stale-claim deadlines" extra="four months from date of service">
              {rejections.data?.soonest ? (
                <>
                  <KV items={[
                    ['Earliest', <span key="e"><span className="mono">{rejections.data.soonest.claimRef}</span> · {rejections.data.soonest.staleDate} · {rejections.data.soonest.daysLeft} days left</span>],
                    ['Within 30 days', <b key="w">{rejections.data.within30}</b>],
                    ['Escalation', <span key="s">30, 14 and 7 days before the deadline</span>],
                  ]} />
                  {rejections.data.within30 > 0 && <Banner kind="warn">{rejections.data.within30} claims reach their stale date within 30 days. A claim never expires silently.</Banner>}
                </>
              ) : <EmptyState>No claim reaches its stale date soon.</EmptyState>}
            </Card>
          </div>
        </div>

        {/* Inspector column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!selected ? (
            <Card title="Detail"><EmptyState>Select an exception to see the arithmetic, the switch response and the audit trail.</EmptyState></Card>
          ) : detail.isLoading ? <Skeleton rows={8} /> : detail.isError ? <Banner kind="crit">This item could not be loaded.</Banner> : (
            <Detail row={selected} data={detail.data} editing={editing} authRef={authRef} icd10={icd10} setAuthRef={setAuthRef} setIcd10={setIcd10}
              onAccept={() => accept.mutate({ row: selected, authRef: authRef || undefined, icd10: icd10 ? icd10.split(',').map((x) => x.trim()) : undefined })}
              busy={accept.isPending} onCancel={() => setEditing(false)} />
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Revenue cycle">
        <p>{toast}</p>
        <Button variant="primary" onClick={() => setToast(null)}>Close</Button>
      </Sheet>
    </div>
  );
}

function Detail({ row, data, editing, authRef, icd10, setAuthRef, setIcd10, onAccept, onCancel, busy }: { row: Exception; data: any; editing: boolean; authRef: string; icd10: string; setAuthRef: (v: string) => void; setIcd10: (v: string) => void; onAccept: () => void; onCancel: () => void; busy: boolean }) {
  const claim = data?.claim ?? null;
  const charge = data?.charge ?? null;
  const subject = claim ?? charge;
  const lines: Array<{ code: string; description: string; quantity: number; exclCents: number; vatCents: number; inclCents: number; adjustmentReason?: string; kind: string }> = subject?.lines ?? [];
  const responses: Array<{ outcome: string; code: string | null; message: string | null; rule: string | null; receivedAt: string; switchRef: string | null }> = data?.responses ?? [];
  const last = responses[responses.length - 1];
  const timeline: Array<{ at: string; text: string; tone: string }> = data?.timeline ?? [];
  const patient = data?.patient;
  const coding = charge?.coding ?? null;

  return (
    <>
      <div>
        <div className="spread"><h3 className="mono" style={{ fontSize: 15 }}>{row.ref}</h3><StatusChip status={row.status} /></div>
        {patient && <div className="muted small">{patient.name} · {patient.sex ?? ''} {patient.idMasked ?? ''} · {patient.schemeName ?? row.funder}{patient.schemeOption ? ` · ${patient.schemeOption}` : ''}{patient.memberNo ? ` · member ····${String(patient.memberNo).slice(-4)}` : ''}</div>}
        <div className="muted small">{row.procedure} · service date {subject?.serviceDate}{data?.radiologist ? ` · signed ${data.radiologist.name}` : ''}{data?.site ? ` · ${data.site.name}` : ''}</div>
      </div>

      <Card title="Money explained" extra="VAT 15 % incl.">
        <div className="collect" style={{ fontSize: 13 }}>
          {lines.map((l, i) => (
            <FragmentLine key={i} label={<>{l.code} {l.description} × {l.quantity}{l.adjustmentReason ? <span className="small muted" style={{ display: 'block' }}>{l.adjustmentReason}</span> : null}</>} cents={l.exclCents} />
          ))}
          <span className="lbl">Subtotal excl. VAT</span><Money cents={subject?.subtotalExclCents ?? lines.reduce((a, l) => a + l.exclCents, 0)} />
          <span className="lbl">VAT 15 %</span><Money cents={subject?.vatCents ?? lines.reduce((a, l) => a + l.vatCents, 0)} />
          <span className="lbl tot">Claim total</span><span className="tot"><Money cents={subject?.totalCents ?? 0} /></span>
          <span className="lbl">Scheme portion</span><Money cents={subject?.expectedFunderCents ?? 0} />
          <span className="lbl">Patient portion</span><Money cents={subject?.expectedPatientCents ?? 0} />
        </div>
        {data?.accountBalanceCents > 0 && <div className="note" style={{ marginTop: 6 }}>Previous balance on this account: <Money cents={data.accountBalanceCents} />.</div>}
      </Card>

      {last && (
        <Card title="Switch response" extra={`${claim?.channel ?? 'batch'} · ${new Date(last.receivedAt).toLocaleString('en-ZA')}`}>
          <div className="mono" style={{ fontSize: 12, background: 'var(--surface-3)', borderRadius: 2, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>RSP {last.code ?? '—'} · <b style={{ color: 'var(--crit)' }}>{row.code}</b>{last.rule ? ` · rule ${last.rule}` : ''}</span>
            <span>REF {last.switchRef ?? '—'} · resubmissions used: {claim?.resubmitCount ?? 0}</span>
          </div>
          <p className="small" style={{ margin: '8px 0 0' }}>{last.message ?? row.reason}</p>
          {data?.rulePack?.notes && <p className="note" style={{ marginTop: 6 }}>Rule pack {data.rulePack.version}: {data.rulePack.notes}</p>}
        </Card>
      )}

      {(row.provenance?.modelId || coding) && (
        <Provenance
          prov={{ modelId: row.provenance?.modelId ?? coding?.modelId ?? 'coding-hand', modelVersion: row.provenance?.modelVersion ?? coding?.modelVersion ?? '2026.09.2', confidence: row.provenance?.confidence ?? coding?.confidence, outputClass: 2, demo: true }}
          onAccept={editing ? undefined : onAccept}
          onEdit={editing ? undefined : () => setIcd10((subject?.icd10 ?? []).join(', '))}
        >
          {row.suggestion}
          {coding?.evidence?.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12 }}>{coding.evidence.slice(0, 3).map((e: string, i: number) => <li key={i}>{e}</li>)}</ul> : null}
        </Provenance>
      )}

      {editing && (
        <Card title="Edit before accepting">
          <Field label="Authorisation number"><input value={authRef} onChange={(e) => setAuthRef(e.target.value)} placeholder="RA-B-3311" /></Field>
          <Field label="ICD-10 codes (primary first, comma separated)"><input value={icd10} onChange={(e) => setIcd10(e.target.value)} placeholder="K80.2, R10.4" /></Field>
          <div className="row-flex" style={{ marginTop: 8 }}>
            <Button variant="primary" disabled={busy} onClick={onAccept}>{busy ? 'Sending…' : 'Accept and resubmit'}</Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
          <p className="note">A radiologist is asked only for clinical clarification. Codes are never changed to suit a funder.</p>
        </Card>
      )}

      <Card title="Audit trail" extra={`${timeline.length} events`}>
        {timeline.length === 0 ? <EmptyState>No recorded events yet.</EmptyState> : (
          <Timeline items={timeline.slice(-10).map((x) => ({ time: new Date(x.at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), text: x.text, kind: (x.tone as 'ok' | 'crit' | 'ai' | 'neutral') }))} />
        )}
      </Card>
    </>
  );
}

function FragmentLine({ label, cents }: { label: React.ReactNode; cents: number }) {
  return <><span className="lbl">{label}</span><Money cents={cents} /></>;
}
