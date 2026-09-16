import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DateTime, EmptyState, Field, Input, KV, PageHeader, Queue, Skeleton } from '@bonakala/bdl';
import { formatSast } from '@bonakala/domain';
import { api } from '../lib/api';
import { nurseAge, type NurseItem } from './nurse.index';

export const Route = createFileRoute('/nurse/contrast')({ component: ContrastRecord });

function ContrastRecord() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['nurse-today'], queryFn: () => api.get<{ items: NurseItem[] }>('/acquisition/contrast') });
  const [selected, setSelected] = useState<string | null>(null);
  const [weight, setWeight] = useState('70');
  const [egfr, setEgfr] = useState('');
  const [batch, setBatch] = useState('');
  const [manual, setManual] = useState('');
  const [calc, setCalc] = useState<{ formula: string; volumeMl: number; rateMlS: number; agent: string; concentration: string; blocked: string | null; warnings: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const item = (q.data?.items ?? []).find((x) => x.id === selected) ?? null;
  const calculate = useMutation({
    mutationFn: (wlId: string) => api.post(`/acquisition/worklist/${wlId}/contrast-calc`, { weightKg: Number(weight), egfr: egfr ? Number(egfr) : null }),
    onSuccess: (r: any) => { setCalc(r.calc); setError(null); },
    onError: (e: any) => setError(e.message),
  });
  const administer = useMutation({
    mutationFn: (wlId: string) => api.post(`/acquisition/contrast/${wlId}/administer`, { agent: calc?.agent ?? 'Iohexol 350 (demo)', concentration: calc?.concentration, weightKg: Number(weight), egfr: egfr ? Number(egfr) : null, volumePlannedMl: calc?.volumeMl ?? 100, rateMlS: calc?.rateMlS ?? 3, batchNo: batch || undefined, manualReason: batch ? undefined : manual || undefined }),
    onSuccess: () => { setError(null); setCalc(null); setBatch(''); setManual(''); void qc.invalidateQueries({ queryKey: ['nurse-today'] }); },
    onError: (e: any) => setError(e.message),
  });

  const cases = (q.data?.items ?? []).filter((x) => x.contrast);
  return (
    <div className="page">
      <PageHeader title="Contrast administration" subtitle="Weight-based dose within the protocol ceiling, the eGFR gate, allergies and metformin, and the batch scan that records the vial against the study." />
      {error && <Banner kind="crit" action={<Button size="sm" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (cases.length === 0 ? <EmptyState>No contrast cases are booked today.</EmptyState> : (
        <div className="split">
          <Card title="Contrast cases today">
            <Queue
              rows={cases}
              rowKey={(x) => x.id}
              selectedKey={selected ?? undefined}
              onSelect={(x) => { setSelected(x.id); setEgfr(String(x.safetyGate?.egfr ?? '')); setCalc(null); }}
              render={(x) => ({
                lead: <span className="mono small">{formatSast(x.scheduledAt, { date: false })}</span>,
                title: x.patient ? `${x.patient.lastName}, ${x.patient.firstName}` : 'Unknown',
                sub: <>{x.procedureDescription} · {nurseAge(x.patient?.dateOfBirth) ?? '—'} {x.patient?.sex ?? ''}</>,
                aux: x.administration ? <Chip kind="done">given</Chip> : <Chip>awaiting</Chip>,
              })}
            />
          </Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!item ? <EmptyState>Select a patient to record the administration.</EmptyState> : item.administration ? (
              <Card title="Administration record" extra="already recorded">
                <KV items={[
                  ['Agent', item.administration.agent],
                  ['Volume', `${item.administration.volumeDeliveredMl ?? 0} mL`],
                  ['Batch', item.administration.batchNo ?? 'manual reason recorded'],
                  ['Status', item.administration.status],
                  ['Reaction', item.administration.reaction ? `${item.administration.reaction.severity}: ${item.administration.reaction.symptoms}` : 'none recorded'],
                ]} />
                {!item.administration.reaction && <Banner kind="info">A reaction is recorded on the Reactions page; it opens an incident and flags the patient record.</Banner>}
              </Card>
            ) : (
              <Card title={`Prepare contrast · ${item.patient?.lastName ?? ''}`}>
                <KV items={[
                  ['Study', item.procedureDescription ?? '—'],
                  ['Pregnancy', item.safetyGate?.pregnancy ?? 'n/a'],
                  ['Allergies', item.safetyGate?.allergies ?? 'none recorded'],
                  ['Metformin', item.safetyGate?.metformin ?? 'n/a'],
                  ['Patient flags', (item.patient?.flags ?? []).join(', ') || 'none'],
                ]} />
                <div className="row-flex">
                  <Field label="Weight (kg)"><Input value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
                  <Field label="eGFR"><Input value={egfr} onChange={(e) => setEgfr(e.target.value)} placeholder="mL/min/1.73 m²" /></Field>
                  <Button onClick={() => calculate.mutate(item.id)}>Calculate dose</Button>
                </div>
                {calc && (
                  calc.blocked
                    ? <Banner kind="crit">Contrast blocked: {calc.blocked}. A radiologist decides whether to proceed, substitute or defer.</Banner>
                    : (
                      <div className="ai">
                        <div className="prov"><span>calculator <b>protocol rule</b></span><span>agent <b>{calc.agent}</b></span><span>rate <b>{calc.rateMlS} mL/s</b></span></div>
                        <div className="mono">{calc.formula}</div>
                        {calc.warnings.map((w) => <div key={w} className="muted small">{w}</div>)}
                      </div>
                    )
                )}
                <div className="row-flex">
                  <Field label="Vial batch (scan)"><Input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="LOT-202609-441" /></Field>
                  {!batch && <Field label="Manual reason (if the batch cannot be scanned)"><Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Barcode damaged; lot recorded from the box" /></Field>}
                </div>
                <Button variant="primary" onClick={() => administer.mutate(item.id)} disabled={!calc || !!calc.blocked || (!batch && manual.length < 3)}>Record administration</Button>
                <div className="note">Contrast cannot be marked administered without a batch scan or a documented manual reason.</div>
              </Card>
            )}
            <Card title="Reaction protocol on screen">
              <KV items={[
                ['Mild', 'Urticaria, limited nausea: observe 30 minutes, antihistamine per protocol, record vital signs.'],
                ['Moderate', 'Bronchospasm, facial oedema: oxygen, salbutamol, call the radiologist, observe.'],
                ['Severe', 'Anaphylaxis, hypotension: emergency trolley, adrenaline per protocol, resuscitation team, radiologist attends.'],
                ['Always', 'Record what happened on the Reactions page: it opens an incident and adds an allergy flag to the patient record.'],
              ]} />
            </Card>
            <div className="muted small">Last refreshed <DateTime iso={new Date().toISOString()} date={false} />.</div>
          </div>
        </div>
      ))}
    </div>
  );
}
