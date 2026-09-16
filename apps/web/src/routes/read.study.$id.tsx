import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DateTime, EmptyState, Field, KV, Money, PageHeader, Provenance, Select, Skeleton, StatusChip, TextArea, Timeline } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/read/study/$id')({ component: ReadingRoom });

interface Candidate { id: string; modelId: string; modelVersion: string; code: string; display: string; laterality?: string; score: number; flag: boolean; candidateText?: string; editedText?: string; localisation?: { type: string; bbox?: [number, number, number, number] }; decision: 'pending' | 'accepted' | 'edited' | 'rejected'; reason?: string; decidedAt?: string }
interface Sections { clinicalInfo: string; technique: string; comparison: string; findings: string; impression: string; recommendation: string }
interface Report { id: string; accession: string; status: string; studyId: string; sections: Sections; candidates: Candidate[]; structuredFindings: Array<{ code: string; display: string; text: string; provenance?: { modelId: string; modelVersion: string; confidence: number } }>; followups: Array<{ what: string; when: string; why: string; who: string; dueAt: string; source?: string }>; critical: boolean; criticalCategory: string | null; reportableCategories: string[]; consistencyWarnings: Array<{ check: string; status: string; detail: string }> | null; warningsAcknowledged: boolean; priority: string; subspecialty: string | null; signedAt: string | null; signedHpcsaNo: string | null; readingRvuX100: number | null; readingFeeCents: number | null; draftProvenance: { modelId: string; modelVersion: string; outputClass: number; llmUsed: boolean } | null; templateId: string | null }
interface Detail {
  report: Report;
  study: { id: string; accession: string; modality: string; procedureDescription: string; bodyPart: string; laterality: string | null; indication: string | null; receivedAt: string; completedAt: string | null; technologistNote: string | null; siteId: string; priority: string } | null;
  instances: Array<{ id: string; number: number; seriesId: string; view: string | null; laterality: string | null }>;
  series: Array<{ id: string; number: number; description: string; view: string | null; instanceCount: number }>;
  results: Array<{ id: string; modelId: string; modelVersion: string; task: string; priority: string | null; latencyMs: number; compute: string; result: any }>;
  priors: Array<{ id: string; accession: string; modality: string; procedureDescription: string | null; receivedAt: string; practiceId: string }>;
  priorReports: Array<{ id: string; studyId: string; sections: Sections; signedAt: string | null }>;
  patient: { firstName: string; lastName: string; sex: string | null; dateOfBirth: string | null; idNumberMasked: string | null } | null;
  referrer: { name: string; discipline: string | null } | null;
  dose: { value: number; quantity: string; drlValue: number | null; ratioPct: number | null; outlier: boolean } | null;
  template: { name: string; mandatoryFields: string[]; pickLists: Record<string, string[]> | null } | null;
  addenda: Array<{ id: string; kind: string; text: string; signedAt: string }>;
  critical: Array<{ id: string; category: string; status: string; attempts: Array<{ at: string; channel: string; outcome: string; to: string }>; escalationLevel: number; acknowledgedBy: string | null }>;
  overlayPolicy: Record<string, string>;
  reportableCategories: Array<{ code: string; label: string; statement: string; window: string; releaseWithheld: boolean }>;
  criticalCategories: ReadonlyArray<{ code: string; label: string; windowMinutes: number; examples: string }>;
}

function ReadingRoom() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['report', id], queryFn: () => api.get<Detail>(`/reporting/reports/${id}`) });
  const [sections, setSections] = useState<Sections | null>(null);
  const [instanceIdx, setInstanceIdx] = useState(0);
  const [overlays, setOverlays] = useState(true);
  const [mgRead, setMgRead] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [signError, setSignError] = useState<{ message: string; detail?: string[] } | null>(null);
  const [ackReason, setAckReason] = useState('');
  const [criticalCategory, setCriticalCategory] = useState<string>('');
  const [reportable, setReportable] = useState<string[]>([]);

  const d = q.data;
  useEffect(() => {
    if (d?.report && sections === null) {
      setSections(d.report.sections);
      setCriticalCategory(d.report.criticalCategory ?? '');
      setReportable(d.report.reportableCategories ?? []);
    }
  }, [d, sections]);

  const signed = d?.report.status === 'signed' || d?.report.status === 'amended';
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/reporting/reports/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', id] }),
  });
  const decide = useMutation({
    mutationFn: (v: { candidateId: string; decision: string; editedText?: string; reason?: string }) => api.post(`/reporting/reports/${id}/candidates/${encodeURIComponent(v.candidateId)}`, { decision: v.decision, editedText: v.editedText, reason: v.reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', id] }),
  });
  const draft = useMutation({
    mutationFn: () => api.post(`/reporting/reports/${id}/draft`, { transcript }),
    onSuccess: (res: any) => { setSections(res.report.sections); void qc.invalidateQueries({ queryKey: ['report', id] }); },
  });
  const check = useMutation({ mutationFn: () => api.post(`/reporting/reports/${id}/consistency`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', id] }) });
  const acknowledge = useMutation({ mutationFn: () => api.post(`/reporting/reports/${id}/acknowledge-warnings`, { reason: ackReason }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['report', id] }) });
  const sign = useMutation({
    mutationFn: async (mfa: boolean) => {
      if (sections) await api.patch(`/reporting/reports/${id}`, { sections, reportableCategories: reportable, critical: !!criticalCategory, criticalCategory: criticalCategory || null });
      return api.post(`/reporting/reports/${id}/sign`, { mfaConfirmed: mfa, criticalCategory: criticalCategory || undefined });
    },
    onSuccess: () => { setSignError(null); void qc.invalidateQueries({ queryKey: ['report', id] }); void qc.invalidateQueries({ queryKey: ['read-worklist'] }); },
    onError: (e: any) => setSignError({ message: e.message, detail: e.details }),
  });

  const activeInstance = d?.instances[instanceIdx];
  const boxes = useMemo(() => {
    if (!d || !overlays) return [];
    return d.report.candidates
      .filter((cand) => cand.flag && cand.decision !== 'rejected' && cand.localisation?.bbox)
      .filter((cand) => d.overlayPolicy[cand.modelId] !== 'off' || mgRead)
      .map((cand) => ({ ...cand, bbox: cand.localisation!.bbox! }));
  }, [d, overlays, mgRead]);
  const mgHidden = d ? d.report.candidates.some((cand) => d.overlayPolicy[cand.modelId] === 'off') && !mgRead : false;

  if (q.isLoading) return <div className="page"><Skeleton rows={8} /></div>;
  if (q.isError || !d) return <div className="page"><Banner kind="crit">This study could not be opened. {(q.error as Error)?.message}</Banner></div>;

  const warnings = (d.report.consistencyWarnings ?? []).filter((w) => w.status !== 'pass');
  const undecided = d.report.candidates.filter((cand) => cand.flag && cand.decision === 'pending');
  const patientLabel = d.patient ? `${d.patient.lastName}, ${d.patient.firstName}` : 'Unknown patient';

  return (
    <div className="page">
      {/* Accepted provenance keeps the monospace provenance line, without the annotated border. */}
      <style>{'.card > .prov{display:flex;gap:10px;flex-wrap:wrap;font-family:var(--mono);font-size:11px;color:var(--text-2);margin-bottom:6px}.card > .prov b{font-weight:500;color:var(--text)}'}</style>
      <PageHeader
        title={patientLabel}
        subtitle={<>{d.patient?.sex ?? ''} · ID {d.patient?.idNumberMasked ?? '—'} · <span className="mono">{d.report.accession}</span> · {d.study?.procedureDescription}</>}
        actions={
          <>
            <StatusChip status={d.report.status} />
            {d.report.priority === 'stat' && <Chip kind="crit">STAT</Chip>}
            <Button onClick={() => void navigate({ to: '/read' })}>Back to worklist</Button>
          </>
        }
      />
      {d.study?.priority === 'stat' && !signed && <Banner kind="crit">STAT study. Reading start target 5 minutes, signed report target 30 minutes from completion.</Banner>}
      {signed && <Banner kind="ok">Signed <DateTime iso={d.report.signedAt} /> · HPCSA {d.report.signedHpcsaNo} · reading fee <Money cents={d.report.readingFeeCents ?? 0} /> ({((d.report.readingRvuX100 ?? 0) / 100).toFixed(2)} RVU-equivalent)</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
        {/* Viewer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="vtools">
            <Button onClick={() => setOverlays((v) => !v)} variant={overlays ? 'primary' : undefined}>AI overlays: {overlays ? 'on' : 'off'}</Button>
            {mgHidden && <Button onClick={() => setMgRead(true)}>Record unaided read, then show mammography overlays</Button>}
            <Button onClick={() => setInstanceIdx((i) => Math.max(0, i - 1))}>Previous image</Button>
            <Button onClick={() => setInstanceIdx((i) => Math.min(d.instances.length - 1, i + 1))}>Next image</Button>
            <span className="muted small" style={{ alignSelf: 'center' }}>{d.instances.length ? `${instanceIdx + 1} of ${d.instances.length}` : 'no images'}</span>
          </div>
          <div className="viewer" role="img" aria-label={`${d.study?.modality} image with ${boxes.length} findings candidate overlays`}>
            {activeInstance ? (
              <>
                <img src={`/api/imaging/studies/${d.report.studyId}/instances/${activeInstance.id}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                <div className="ovl tl-">{patientLabel.toUpperCase()}<br />{d.report.accession}<br />{d.study?.modality} · {activeInstance.view ?? ''}</div>
                <div className="ovl tr-">{d.study?.bodyPart}{d.study?.laterality ? ` · ${d.study.laterality}` : ''}<br />{d.dose ? `${d.dose.quantity} ${d.dose.value}` : 'no ionising dose'}</div>
                <div className="ovl br-">{boxes.length ? `${boxes.map((b) => `${b.modelId} ${b.modelVersion}`).filter((v, i, a) => a.indexOf(v) === i).join(', ')} · overlay ${overlays ? 'ON' : 'OFF'}` : 'no overlay'}</div>
                <div className="ovl bl-">{d.priors.length ? `${d.priors.length} prior(s) ready` : 'no priors'}</div>
                {boxes.map((b) => (
                  <div key={b.id} className="box" style={{ left: `${b.bbox[0] * 100}%`, top: `${b.bbox[1] * 100}%`, width: `${b.bbox[2] * 100}%`, height: `${b.bbox[3] * 100}%` }}>
                    <span>{b.display.toLowerCase()}{b.laterality ? ` · ${b.laterality}` : ''} · {b.score.toFixed(2)}</span>
                  </div>
                ))}
              </>
            ) : (
              <EmptyState>No images have arrived for this study.</EmptyState>
            )}
          </div>
          <div className="thumbs">
            {d.instances.slice(0, 8).map((inst, i) => (
              <div key={inst.id} className={i === instanceIdx ? 'on' : ''} onClick={() => setInstanceIdx(i)} style={{ cursor: 'pointer', backgroundImage: `url(/api/imaging/studies/${d.report.studyId}/instances/${inst.id})`, backgroundSize: 'cover' }}>
                <span>{inst.view ?? `#${inst.number}`}</span>
              </div>
            ))}
          </div>
          <Card title="Study facts">
            <KV items={[
              ['Indication', d.study?.indication ?? '—'],
              ['Referrer', d.referrer ? `${d.referrer.name}${d.referrer.discipline ? ` (${d.referrer.discipline})` : ''}` : '—'],
              ['Acquired', <DateTime key="a" iso={d.study?.completedAt ?? d.study?.receivedAt ?? null} />],
              ['Series', `${d.series.length} · ${d.series.map((sx) => sx.description).join(', ')}`],
              ['Dose', d.dose ? <span key="d">{d.dose.value} {d.dose.quantity}{d.dose.drlValue ? ` · ${d.dose.ratioPct}% of DRL ${d.dose.drlValue}` : ''}{d.dose.outlier ? ' · above reference level' : ''}</span> : 'No ionising dose'],
              ['Technologist note', d.study?.technologistNote ?? '—'],
            ]} />
          </Card>
          {d.priors.length > 0 && (
            <Card title="Priors" extra={`${d.priors.length} found`}>
              <Timeline items={d.priors.map((p) => ({ time: p.receivedAt.slice(0, 7), kind: 'ok' as const, text: <>{p.procedureDescription ?? p.modality} · <span className="mono">{p.accession}</span>{d.priorReports.find((pr) => pr.studyId === p.id) ? ' · reported' : ' · unreported'}</> }))} />
              {d.priorReports[0] && <div className="note" style={{ marginTop: 8 }}>Most recent prior impression: {d.priorReports[0].sections.impression}</div>}
            </Card>
          )}
        </div>

        {/* Candidates and report */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card title="Findings candidates" extra={d.results.filter((x) => x.task === 'findings' || x.task === 'triage').map((x) => `${x.modelId} ${x.modelVersion}`).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}>
            {d.report.candidates.filter((cand) => cand.flag).length === 0 ? (
              <EmptyState>No findings candidates were flagged for this study. The models report &ldquo;no candidate found&rdquo;, never &ldquo;normal&rdquo;.</EmptyState>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.report.candidates.filter((cand) => cand.flag).map((cand) => (
                  <Provenance
                    key={cand.id}
                    prov={{ modelId: cand.modelId, modelVersion: cand.modelVersion, confidence: cand.score, outputClass: 1, demo: true }}
                    accepted={cand.decision === 'accepted' || cand.decision === 'edited'}
                    onAccept={signed || cand.decision !== 'pending' ? undefined : () => decide.mutate({ candidateId: cand.id, decision: 'accepted' })}
                    onEdit={signed || cand.decision !== 'pending' ? undefined : () => { const t = window.prompt('Edit the candidate sentence before accepting it', cand.candidateText ?? cand.display); if (t) decide.mutate({ candidateId: cand.id, decision: 'edited', editedText: t }); }}
                    onReject={signed || cand.decision !== 'pending' ? undefined : () => { const rr = window.prompt('Reason for rejecting this candidate (this feeds AI monitoring)'); if (rr) decide.mutate({ candidateId: cand.id, decision: 'rejected', reason: rr }); }}
                  >
                    <div><b>{cand.display}</b>{cand.laterality ? ` · ${cand.laterality}` : ''}</div>
                    <div>{cand.editedText ?? cand.candidateText ?? 'Candidate flagged above the operating point.'}</div>
                    {cand.decision === 'rejected' && <div className="muted small">Rejected · {cand.reason}. Rejected candidates never appear in the report.</div>}
                  </Provenance>
                ))}
              </div>
            )}
          </Card>

          <div className="report">
            <div className="spread">
              <h3>Report</h3>
              <div className="row-flex">
                <StatusChip status={d.report.status} />
                {d.report.draftProvenance && <Chip kind="ai">Drafting Hand · {d.report.draftProvenance.modelId} {d.report.draftProvenance.modelVersion} · class {d.report.draftProvenance.outputClass}</Chip>}
              </div>
            </div>
            {!signed && (
              <div className="row-flex">
                <input value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Dictation transcript (push-to-talk stands in as text in this demo)" style={{ flex: 1, height: 32 }} aria-label="Dictation transcript" />
                <Button onClick={() => draft.mutate()} disabled={draft.isPending}>{draft.isPending ? 'Drafting…' : 'Drafting Hand'}</Button>
              </div>
            )}
            {sections && (['clinicalInfo', 'technique', 'comparison', 'findings', 'impression', 'recommendation'] as const).map((key) => (
              <div key={key}>
                <h4>{({ clinicalInfo: 'Clinical information', technique: 'Technique', comparison: 'Comparison', findings: 'Findings', impression: 'Impression', recommendation: 'Recommendation' } as const)[key]}
                  {d.template?.mandatoryFields.includes(key) && <span className="muted"> · required</span>}
                </h4>
                {signed ? <p>{sections[key] || <span className="muted">—</span>}</p> : (
                  <TextArea
                    value={sections[key]}
                    onChange={(e) => setSections({ ...sections, [key]: e.target.value })}
                    onBlur={() => save.mutate({ sections })}
                    rows={key === 'findings' ? 5 : key === 'impression' ? 3 : 2}
                    style={{ width: '100%', background: 'var(--surface-3)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 2, padding: '6px 8px', font: 'inherit' }}
                    aria-label={key}
                  />
                )}
              </div>
            ))}

            {d.report.structuredFindings.length > 0 && (
              <div>
                <h4>Structured findings (accepted candidates carry their provenance)</h4>
                <KV items={d.report.structuredFindings.map((f) => [f.display, <span key={f.code}>{f.text} {f.provenance && <span className="muted small mono">· {f.provenance.modelId} {f.provenance.modelVersion} · {f.provenance.confidence.toFixed(2)}</span>}</span>] as [string, React.ReactNode])} />
              </div>
            )}

            {!signed && (
              <>
                <div className="row-flex">
                  <Field label="Reportable-result category">
                    <Select value={reportable[0] ?? ''} onChange={(e) => setReportable(e.target.value ? [e.target.value] : [])}>
                      <option value="">None selected</option>
                      {d.reportableCategories.map((cat) => <option key={cat.code} value={cat.code}>{cat.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Critical flag">
                    <Select value={criticalCategory} onChange={(e) => setCriticalCategory(e.target.value)}>
                      <option value="">Not flagged</option>
                      {d.criticalCategories.map((cat) => <option key={cat.code} value={cat.code}>{cat.label} · contact within {cat.windowMinutes} min</option>)}
                    </Select>
                  </Field>
                </div>
                {reportable[0] && <div className="note">{d.reportableCategories.find((x) => x.code === reportable[0])?.statement}</div>}
                {criticalCategory && <Banner kind="warn">Signing with a critical flag starts the Critical Results Hand: it works the contact chain and records every attempt. The radiologist conveys the finding on the call; the Hand never does.</Banner>}
              </>
            )}

            {warnings.length > 0 && !signed && (
              <Banner kind="warn" action={d.report.warningsAcknowledged ? <Chip kind="done">Acknowledged</Chip> : undefined}>
                <b>Consistency warnings</b>
                <ul style={{ margin: '4px 0 0 16px' }}>{warnings.map((w) => <li key={w.check}>{w.detail} <span className="muted small mono">({w.check} · {w.status})</span></li>)}</ul>
                {!d.report.warningsAcknowledged && (
                  <div className="row-flex" style={{ marginTop: 6 }}>
                    <input value={ackReason} onChange={(e) => setAckReason(e.target.value)} placeholder="Reason for signing with these warnings" style={{ flex: 1, height: 30 }} aria-label="Acknowledgement reason" />
                    <Button size="sm" onClick={() => acknowledge.mutate()} disabled={ackReason.length < 3}>Acknowledge</Button>
                  </div>
                )}
              </Banner>
            )}
            {undecided.length > 0 && !signed && <Banner kind="warn">{undecided.length} findings candidate{undecided.length === 1 ? '' : 's'} still need an accept, edit or reject decision before you can sign.</Banner>}
            {signError && <Banner kind="crit">{signError.message}</Banner>}

            {!signed ? (
              <div className="row-flex">
                <Button variant="primary" size="lg" onClick={() => sign.mutate(!!criticalCategory)} disabled={sign.isPending}>{sign.isPending ? 'Signing…' : criticalCategory ? 'Sign with re-authentication' : 'Sign report'}</Button>
                <Button onClick={() => check.mutate()} disabled={check.isPending}>Run consistency check</Button>
                <Button onClick={() => save.mutate({ sections })}>Save draft</Button>
              </div>
            ) : (
              <div className="row-flex">
                <Button onClick={() => window.open(`/api/results/${d.report.id}/render`, '_blank')}>Open the signed report</Button>
                <Button onClick={() => { const t = window.prompt('Addendum text'); const rr = t ? window.prompt('Reason for the addendum') : null; if (t && rr) void api.post(`/reporting/reports/${id}/addendum`, { text: t, reason: rr }).then(() => qc.invalidateQueries({ queryKey: ['report', id] })); }}>Add an addendum</Button>
              </div>
            )}
            <div className="note">
              Signing is the only route that publishes report text. The Drafting Hand holds no sign, distribute or notify tool; rejected candidates never reach the report; results endpoints return signed reports only.
            </div>
          </div>

          {d.report.followups.length > 0 && (
            <Card title="Follow-up recommendations">
              <KV items={d.report.followups.map((f) => [f.what, <span key={f.what}>{f.when} · {f.why} · owner: {f.who} {f.source && <span className="muted small">({f.source})</span>}</span>] as [string, React.ReactNode])} />
            </Card>
          )}
          {d.critical.length > 0 && (
            <Card title="Critical result communication">
              {d.critical.map((cr) => (
                <div key={cr.id}>
                  <div className="row-flex"><StatusChip status={cr.status} /><Chip kind="crit">{cr.category}</Chip><span className="muted small">escalation level {cr.escalationLevel}</span></div>
                  <Timeline items={cr.attempts.map((a) => ({ time: a.at.slice(11, 16), kind: a.outcome === 'answered' || a.outcome === 'acknowledged' ? 'ok' as const : 'crit' as const, text: `${a.channel} to ${a.to}: ${a.outcome.replace(/_/g, ' ')}` }))} />
                  {cr.acknowledgedBy && <div className="note">Acknowledged by {cr.acknowledgedBy}.</div>}
                </div>
              ))}
            </Card>
          )}
          {d.addenda.length > 0 && (
            <Card title="Addenda">
              {d.addenda.map((a) => <div key={a.id}><h4>{a.kind} · <DateTime iso={a.signedAt} /></h4><p>{a.text}</p></div>)}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
