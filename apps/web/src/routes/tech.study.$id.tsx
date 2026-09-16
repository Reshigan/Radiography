import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Check, Chip, DateTime, EmptyState, Field, Input, KV, PageHeader, Provenance, Select, Skeleton, StatusChip, TextArea } from '@bonakala/bdl';
import { formatSast } from '@bonakala/domain';
import { api } from '../lib/api';

export const Route = createFileRoute('/tech/study/$id')({ component: Workspace });

interface Detail {
  item: {
    id: string; practiceId: string; siteId: string; roomId: string; patientId: string; modalityType: string; procedureCode: string; procedureDescription: string | null; bodyPart: string | null; laterality: string | null; contrast: boolean;
    priority: string; indication: string | null; scheduledAt: string; status: string; protocolId: string | null; protocolSource: string | null;
    protocolProvenance: { modelId: string; modelVersion: string; confidence: number; reasons: string[]; acceptedBy?: string; acceptedAt?: string } | null;
    safetyGate: { allowed: boolean; reason: string; pregnancy?: string; egfr?: number | null; allergies?: string; metformin?: string; reconfirmedAt?: string } | null;
    identityCheck: { identifiers: string[]; wristbandScanned: boolean; checkedAt: string; witness?: string } | null;
    studyId: string | null; accession: string | null; technologistNote: string | null; arrivedAt: string | null; startedAt: string | null; completedAt: string | null;
  };
  patient: { firstName: string; lastName: string; sex: string | null; dateOfBirth: string | null; idNumberMasked: string | null; flags: string[] | null } | null;
  protocol: { id: string; name: string; code: string; parameters: Record<string, string | number>; expectedSeries: string[]; drlQuantity: string | null; drlValue: number | null; requiresRgt: boolean; standingRule: string | null; contrastRule: { agent: string; concentration: string; mlPerKg: number; maxMl: number; rateMlS: number; egfrMin: number } | null } | null;
  referrer: { name: string; discipline: string | null } | null;
  study: { id: string; accession: string; status: string; seriesCount: number; instanceCount: number } | null;
  series: Array<{ id: string; description: string; instanceCount: number; rejected: boolean }>;
  instances: Array<{ id: string; number: number; view: string | null }>;
  qc: Array<{ id: string; modelId: string; modelVersion: string; latencyMs: number; compute: string; result: any }>;
  dose: { value?: number; quantity: string; valueX1000: number; drlValueX1000: number | null; ratioPct: number | null; outlier: boolean; ctdiVolX1000: number | null; effectiveMsvX1000: number | null; likelyCause: string | null } | null;
  repeats: Array<{ id: string; reasonCode: string; kind: string; createdAt: string }>;
  contrast: Array<{ id: string; agent: string; volumeDeliveredMl: number | null; batchNo: string | null; status: string; reaction: unknown }>;
  priors: Array<{ id: string; accession: string; procedureDescription: string | null; receivedAt: string }>;
  gate: { allowed: boolean; reason: string; source: string } | null;
  reasons: string[];
}

function Workspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tech-study', id], queryFn: () => api.get<Detail>(`/acquisition/worklist/${id}`), refetchInterval: 20_000 });
  const [identifiers, setIdentifiers] = useState<string[]>(['full_name', 'date_of_birth']);
  const [wristband, setWristband] = useState(true);
  const [pregnancy, setPregnancy] = useState('no');
  const [egfr, setEgfr] = useState('');
  const [allergies, setAllergies] = useState('none');
  const [weight, setWeight] = useState('70');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [calc, setCalc] = useState<{ formula: string; volumeMl: number; rateMlS: number; agent: string; concentration: string; egfrMin: number; blocked: string | null; warnings: string[] } | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['tech-study', id] });
  const fail = (e: any) => setError(e.message ?? String(e));
  const arrive = useMutation({ mutationFn: () => api.post(`/acquisition/worklist/${id}/arrive`), onSuccess: refresh, onError: fail });
  const identity = useMutation({ mutationFn: () => api.post(`/acquisition/worklist/${id}/identity`, { identifiers, wristbandScanned: wristband, witness: wristband ? undefined : 'Sister L. Mokoena' }), onSuccess: refresh, onError: fail });
  const safety = useMutation({ mutationFn: () => api.post(`/acquisition/worklist/${id}/safety`, { pregnancy, egfr: egfr ? Number(egfr) : null, allergies, metformin: 'no' }), onSuccess: refresh, onError: fail });
  const suggest = useMutation({ mutationFn: () => api.post(`/acquisition/worklist/${id}/protocol/suggest`), onSuccess: refresh, onError: fail });
  const setProtocol = useMutation({ mutationFn: (pid: string) => api.post(`/acquisition/worklist/${id}/protocol`, { protocolId: pid, source: 'rad' }), onSuccess: refresh, onError: fail });
  const contrastCalc = useMutation({ mutationFn: () => api.post(`/acquisition/worklist/${id}/contrast-calc`, { weightKg: Number(weight), egfr: egfr ? Number(egfr) : null }), onSuccess: (r: any) => setCalc(r.calc), onError: fail });
  const start = useMutation({ mutationFn: () => api.post(`/acquisition/worklist/${id}/start`, {}), onSuccess: refresh, onError: fail });
  const acquire = useMutation({
    mutationFn: (d: Detail) => api.post('/sim/modality/send', { siteId: d.item.siteId, roomId: d.item.roomId, procedureCode: d.item.procedureCode, patientId: d.item.patientId, worklistItemId: d.item.id, autoComplete: false }),
    onSuccess: refresh, onError: fail,
  });
  const complete = useMutation({ mutationFn: () => api.post(`/acquisition/worklist/${id}/complete`, { note: note || undefined, overrideIncomplete: undefined }), onSuccess: refresh, onError: fail });
  const repeat = useMutation({ mutationFn: (reason: string) => api.post(`/acquisition/worklist/${id}/repeat`, { reasonCode: reason, reasonText: reason === 'other' ? 'Documented by the radiographer' : undefined, qcSuggested: true }), onSuccess: refresh, onError: fail });

  if (q.isLoading) return <div className="page"><Skeleton rows={8} /></div>;
  if (q.isError || !q.data) return <div className="page"><Banner kind="crit">This worklist entry could not be opened. {(q.error as Error)?.message}</Banner></div>;
  const d = q.data;
  const p = d.patient;
  const ageY = p?.dateOfBirth ? Math.floor((Date.now() - new Date(p.dateOfBirth).getTime()) / (365.25 * 86400_000)) : null;
  const qcResult = d.qc[0]?.result;
  const dose = d.dose ? { value: d.dose.valueX1000 / 1000, drl: d.dose.drlValueX1000 ? d.dose.drlValueX1000 / 1000 : null, ratio: d.dose.ratioPct, ctdi: d.dose.ctdiVolX1000 ? d.dose.ctdiVolX1000 / 1000 : null, eff: d.dose.effectiveMsvX1000 ? d.dose.effectiveMsvX1000 / 1000 : null } : null;
  const stepDone = { identity: !!d.item.identityCheck, safety: !!d.item.safetyGate?.reconfirmedAt, protocol: !!d.item.protocolId, started: !!d.item.startedAt, images: !!d.item.studyId, completed: d.item.status === 'completed' };

  return (
    <div className="page">
      <PageHeader
        title={p ? `${p.lastName}, ${p.firstName}` : 'Unknown patient'}
        subtitle={<>{ageY ?? '—'} {p?.sex ?? ''} · ID {p?.idNumberMasked ?? '—'} · {d.item.procedureDescription}{d.item.laterality ? ` · ${d.item.laterality}` : ''} {d.item.accession && <span className="mono">· {d.item.accession}</span>}</>}
        actions={<><StatusChip status={d.item.status} />{d.item.priority === 'stat' && <Chip kind="crit">STAT</Chip>}<Button onClick={() => void navigate({ to: '/tech' })}>Back to worklist</Button></>}
      />
      {error && <Banner kind="crit" action={<Button size="sm" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Banner>}
      {d.gate && !d.gate.allowed && <Banner kind="crit">Safety gate: {d.gate.reason}. The study cannot start until this is resolved.</Banner>}
      {(p?.flags ?? []).includes('contrast_reaction') && <Banner kind="warn">This patient has a documented previous contrast reaction. Contrast is blocked until a radiologist decides.</Banner>}

      <div className="facts">
        <div><span>Indication</span><b>{d.item.indication ?? '—'}</b></div>
        <div><span>Referrer</span><b>{d.referrer?.name ?? '—'}</b></div>
        <div><span>Slot</span><b>{formatSast(d.item.scheduledAt, { date: false })}</b></div>
        <div><span>Priors</span><b>{d.priors.length}</b></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 1. Protocol */}
          <Card title="1 · Protocol card" extra={d.item.protocolSource ? `source: ${d.item.protocolSource}` : 'not assigned'}>
            {d.item.protocolProvenance ? (
              <Provenance
                prov={{ modelId: d.item.protocolProvenance.modelId, modelVersion: d.item.protocolProvenance.modelVersion, confidence: d.item.protocolProvenance.confidence, outputClass: 4, demo: true }}
                accepted={!!d.item.protocolId}
                onAccept={!d.item.protocolId && d.protocol ? () => setProtocol.mutate(d.protocol!.id) : undefined}
              >
                <div><b>{d.protocol?.name ?? 'Awaiting radiologist protocolling'}</b></div>
                <div className="muted small">{d.item.protocolProvenance.reasons.join(' · ')}</div>
                {d.protocol && <div className="small mono">{Object.entries(d.protocol.parameters).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>}
                {d.protocol?.standingRule && <div className="muted small">Standing rule {d.protocol.standingRule} applied (radiologist-approved).</div>}
              </Provenance>
            ) : (
              <>
                <EmptyState action={<Button size="sm" onClick={() => suggest.mutate()}>Ask the Protocol Hand</Button>}>No protocol suggestion yet.</EmptyState>
              </>
            )}
            {d.protocol?.requiresRgt && !d.item.protocolSource && <Banner kind="warn">This modality is protocolled by a radiologist (A1). The suggestion is in the radiologist queue.</Banner>}
            {d.protocol?.drlValue && <div className="note">Diagnostic reference level for this protocol: {d.protocol.drlValue / 1000} {d.protocol.drlQuantity}. A DRL is a review trigger, not a dose limit.</div>}
          </Card>

          {/* 2. Identity */}
          <Card title="2 · Identity check" extra={stepDone.identity ? 'recorded' : 'required before any exposure'}>
            {stepDone.identity ? (
              <KV items={[
                ['Identifiers confirmed', d.item.identityCheck!.identifiers.join(', ').replace(/_/g, ' ')],
                ['Wristband', d.item.identityCheck!.wristbandScanned ? 'scanned, matches the order' : `manual match, witness ${d.item.identityCheck!.witness ?? '—'}`],
                ['Checked', <DateTime key="c" iso={d.item.identityCheck!.checkedAt} />],
              ]} />
            ) : (
              <>
                <div className="row-flex">
                  {['full_name', 'date_of_birth', 'id_number', 'mobile'].map((x) => (
                    <Check key={x} checked={identifiers.includes(x)} onChange={(v) => setIdentifiers(v ? [...identifiers, x] : identifiers.filter((y) => y !== x))} label={x.replace(/_/g, ' ')} />
                  ))}
                  <Check checked={wristband} onChange={setWristband} label="wristband scanned" />
                </div>
                <div className="row-flex" style={{ marginTop: 8 }}>
                  <Button variant="primary" onClick={() => identity.mutate()} disabled={identifiers.length < 2}>Record identity check</Button>
                  <span className="muted small">Two identifiers are required; a manual match also needs a named witness.</span>
                </div>
              </>
            )}
          </Card>

          {/* 3. Safety */}
          <Card title="3 · Safety re-confirmation" extra={d.item.safetyGate?.reconfirmedAt ? 'cleared' : 'from the registration questionnaire'}>
            {stepDone.safety ? (
              <KV items={[
                ['Pregnancy', d.item.safetyGate?.pregnancy ?? 'n/a'],
                ['eGFR', d.item.safetyGate?.egfr ? `${d.item.safetyGate.egfr} mL/min/1.73 m²` : 'not required'],
                ['Allergies', d.item.safetyGate?.allergies ?? 'none'],
                ['Metformin', d.item.safetyGate?.metformin ?? 'n/a'],
                ['Gate', d.item.safetyGate?.allowed ? 'cleared' : d.item.safetyGate?.reason ?? 'blocked'],
              ]} />
            ) : (
              <>
                <div className="row-flex">
                  <Field label="Pregnancy"><Select value={pregnancy} onChange={(e) => setPregnancy(e.target.value)}><option value="n/a">Not applicable</option><option value="no">No</option><option value="not_sure">Not sure</option><option value="yes">Yes</option></Select></Field>
                  <Field label="eGFR"><Input value={egfr} onChange={(e) => setEgfr(e.target.value)} placeholder="mL/min/1.73 m²" /></Field>
                  <Field label="Allergies"><Input value={allergies} onChange={(e) => setAllergies(e.target.value)} /></Field>
                </div>
                <Button variant="primary" onClick={() => safety.mutate()}>Re-confirm safety answers</Button>
                <div className="note">A &ldquo;yes&rdquo; or &ldquo;not sure&rdquo; pregnancy answer on an ionising study routes to the pregnancy protocol and needs a radiologist justification.</div>
              </>
            )}
          </Card>

          {/* 4. Contrast */}
          {d.item.contrast && (
            <Card title="4 · Contrast calculator" extra={d.contrast[0] ? `administered · batch ${d.contrast[0].batchNo ?? 'manual'}` : 'standby'}>
              {d.contrast[0] ? (
                <KV items={[['Agent', d.contrast[0].agent], ['Delivered', `${d.contrast[0].volumeDeliveredMl ?? 0} mL`], ['Batch', d.contrast[0].batchNo ?? 'manual reason recorded'], ['Status', d.contrast[0].status]]} />
              ) : (
                <>
                  <div className="row-flex">
                    <Field label="Weight (kg)"><Input value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
                    <Field label="eGFR"><Input value={egfr} onChange={(e) => setEgfr(e.target.value)} placeholder="from the safety answers" /></Field>
                    <Button onClick={() => contrastCalc.mutate()}>Calculate</Button>
                  </div>
                  {calc && (
                    <div className={calc.blocked ? 'banner crit' : 'note'} style={{ marginTop: 8 }}>
                      {calc.blocked ? <span>Contrast blocked: {calc.blocked}</span> : <span className="mono">{calc.formula} · {calc.agent} {calc.concentration} at {calc.rateMlS} mL/s · eGFR gate {calc.egfrMin}</span>}
                      {calc.warnings.map((w) => <div key={w} className="muted small">{w}</div>)}
                    </div>
                  )}
                  <div className="note">The nurse records the administration with a vial batch scan, or a documented manual reason, on the nurse console.</div>
                </>
              )}
            </Card>
          )}

          {/* 5. Acquisition */}
          <Card title="5 · Acquisition" extra={d.study ? `${d.study.seriesCount} series · ${d.study.instanceCount} images` : 'not started'}>
            {!stepDone.started ? (
              <div className="row-flex">
                {d.item.status === 'scheduled' && <Button onClick={() => arrive.mutate()}>Mark arrived</Button>}
                <Button variant="primary" onClick={() => start.mutate()} disabled={!stepDone.identity}>Start study (MPPS in progress)</Button>
                {!stepDone.identity && <span className="muted small">The identity check must be recorded first.</span>}
              </div>
            ) : (
              <>
                <KV items={[
                  ['Started', <DateTime key="s" iso={d.item.startedAt} />],
                  ['Series', d.series.length ? d.series.map((sx) => `${sx.description}${sx.rejected ? ' (rejected)' : ''}`).join(', ') : 'none received'],
                  ['Expected', d.protocol?.expectedSeries.join(', ') ?? '—'],
                ]} />
                <div className="row-flex" style={{ marginTop: 8 }}>
                  {!d.item.studyId && <Button variant="primary" onClick={() => acquire.mutate(d)}>Acquire (modality simulator)</Button>}
                  {d.item.studyId && d.item.status !== 'completed' && <Button variant="primary" onClick={() => complete.mutate()}>Send study (MPPS completed)</Button>}
                  <Select defaultValue="" onChange={(e) => { if (e.target.value) repeat.mutate(e.target.value); }} aria-label="Repeat with reason">
                    <option value="">Repeat with reason…</option>
                    {d.reasons.map((rr) => <option key={rr} value={rr}>{rr.replace(/_/g, ' ')}</option>)}
                  </Select>
                </div>
              </>
            )}
            {d.item.status === 'completed' && <Banner kind="ok">Study sent. The archive, the reading worklist, the dose register and charge capture were all driven by one event.</Banner>}
          </Card>

          {/* 6. QC */}
          {qcResult && (
            <Card title="6 · Quality checks" extra={`${d.qc[0]!.modelId} ${d.qc[0]!.modelVersion} · ${d.qc[0]!.compute} · ${(d.qc[0]!.latencyMs / 1000).toFixed(1)} s`}>
              <Provenance prov={{ modelId: d.qc[0]!.modelId, modelVersion: d.qc[0]!.modelVersion, outputClass: 4, demo: true }}>
                <div className="qc" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
                  {(qcResult.findings ?? []).map((f: any) => (
                    <div key={f.code} style={{ padding: '5px 8px', background: 'var(--surface-3)', borderRadius: 2, fontSize: 12 }}>
                      <b>{f.display}</b>{f.measurements?.length ? ` · ${f.measurements.map((m: any) => `${m.name.replace(/_/g, ' ')} ${m.value}`).join(', ')}` : ''}
                      <div className="muted">{f.flag ? 'review suggested' : 'within tolerance'} · score {f.score.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
                {qcResult.quality?.issues?.length > 0 && <div className="muted small" style={{ marginTop: 6 }}>Issues: {qcResult.quality.issues.join(', ').replace(/_/g, ' ')}</div>}
              </Provenance>
              <div className="note">Quality checks are advisory and never block acquisition. The repeat decision is the radiographer&rsquo;s and always carries a reason code.</div>
            </Card>
          )}

          <Card title="Note to the radiologist">
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={d.item.technologistNote ?? 'For example: patient could not raise arms; streak artefact at L1.'} style={{ width: '100%' }} />
            <Button onClick={() => void api.post(`/acquisition/worklist/${id}/note`, { text: note }).then(refresh)}>Save note</Button>
          </Card>
        </div>

        {/* Right column: dose, repeats, priors */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card title="Dose · this study">
            {dose ? (
              <>
                <div style={{ font: '600 26px var(--display)', color: 'var(--heading)' }}>{dose.value} <span className="muted small mono">{d.dose!.quantity}</span></div>
                <KV items={[
                  ['DRL', dose.drl ? `${dose.drl} ${d.dose!.quantity}` : '—'],
                  ['Ratio', dose.ratio !== null ? `${dose.ratio} % of the reference level` : '—'],
                  ['CTDIvol', dose.ctdi ? `${dose.ctdi} mGy` : '—'],
                  ['Effective (estimate)', dose.eff ? `${dose.eff} mSv` : '—'],
                ]} />
                {d.dose!.outlier && <Banner kind="warn">Above the reference level: {d.dose!.likelyCause}. Add a note; the radiation protection officer reviews it.</Banner>}
              </>
            ) : <EmptyState>No dose record yet.</EmptyState>}
          </Card>
          <Card title="Repeat and reject" extra="reason codes are mandatory">
            {d.repeats.length === 0 ? <EmptyState>No repeats on this study.</EmptyState> : (
              <KV items={d.repeats.map((rr) => [rr.reasonCode.replace(/_/g, ' '), <DateTime key={rr.id} iso={rr.createdAt} date={false} />] as [string, React.ReactNode])} />
            )}
            <div className="note">Rejected images are retained for quality review, excluded from reading and distribution, and can never be deleted.</div>
          </Card>
          <Card title="Priors">
            {d.priors.length === 0 ? <EmptyState>No previous imaging at this practice.</EmptyState> : (
              <KV items={d.priors.map((pr) => [pr.receivedAt.slice(0, 10), <span key={pr.id}>{pr.procedureDescription} <span className="muted mono small">{pr.accession}</span></span>] as [string, React.ReactNode])} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
