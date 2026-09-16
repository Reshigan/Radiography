import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DateTime, EmptyState, Field, Input, KV, PageHeader, Queue, Select, Skeleton, TextArea } from '@bonakala/bdl';
import { api } from '../lib/api';
import { type NurseItem } from './nurse.index';

export const Route = createFileRoute('/nurse/reactions')({ component: Reactions });

function Reactions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['nurse-today'], queryFn: () => api.get<{ items: NurseItem[] }>('/acquisition/contrast') });
  const [selected, setSelected] = useState<string | null>(null);
  const [severity, setSeverity] = useState('mild');
  const [symptoms, setSymptoms] = useState('');
  const [treatment, setTreatment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: (adminId: string) => api.post(`/acquisition/contrast/${adminId}/reaction`, { severity, symptoms, treatment, radiologistCalled: true }),
    onSuccess: (r: any) => { setDone(r.incidentId); setSymptoms(''); setTreatment(''); setSelected(null); void qc.invalidateQueries({ queryKey: ['nurse-today'] }); },
    onError: (e: any) => setError(e.message),
  });

  const administered = (q.data?.items ?? []).filter((x) => x.administration?.status === 'administered');
  const withReaction = administered.filter((x) => x.administration?.reaction);

  return (
    <div className="page">
      <PageHeader title="Reactions and incidents" subtitle="Recording a reaction opens a quality incident, adds an allergy flag to the patient record and feeds the nurse metrics." />
      {error && <Banner kind="crit" action={<Button size="sm" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Banner>}
      {done && <Banner kind="ok">Reaction recorded. Incident <span className="mono">{done}</span> opened and the patient record flagged.</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (
        <div className="split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card title="Record a reaction">
              {administered.length === 0 ? <EmptyState>No contrast has been administered today.</EmptyState> : (
                <>
                  <Field label="Patient">
                    <Select value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)}>
                      <option value="">Select a patient</option>
                      {administered.filter((x) => !x.administration?.reaction).map((x) => <option key={x.administration!.id} value={x.administration!.id}>{x.patient?.lastName}, {x.patient?.firstName} · {x.procedureDescription}</option>)}
                    </Select>
                  </Field>
                  <Field label="Severity"><Select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></Select></Field>
                  <Field label="Symptoms"><Input value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="Urticaria over the trunk, no airway involvement" /></Field>
                  <Field label="Treatment given"><TextArea rows={2} value={treatment} onChange={(e) => setTreatment(e.target.value)} placeholder="Antihistamine per protocol; observed 30 minutes; radiologist attended" style={{ width: '100%' }} /></Field>
                  <Button variant="primary" onClick={() => selected && record.mutate(selected)} disabled={!selected || symptoms.length < 3 || treatment.length < 3}>Record reaction and open an incident</Button>
                </>
              )}
            </Card>
            <Card title="Reaction protocol">
              <KV items={[
                ['Mild', 'Urticaria, limited nausea: observe 30 minutes, antihistamine per protocol.'],
                ['Moderate', 'Bronchospasm, facial oedema: oxygen, salbutamol, call the radiologist.'],
                ['Severe', 'Anaphylaxis: emergency trolley, adrenaline per protocol, resuscitation team.'],
                ['Extravasation', 'Record the volume and the site; elevate and apply cold compresses; review before discharge.'],
              ]} />
            </Card>
          </div>
          <Card title="Reactions recorded" extra={`${withReaction.length} today`}>
            {withReaction.length === 0 ? <EmptyState>No reactions today.</EmptyState> : (
              <Queue
                rows={withReaction}
                rowKey={(x) => x.administration!.id}
                render={(x) => ({
                  lead: <Chip kind={x.administration!.reaction!.severity === 'severe' ? 'crit' : 'att'}>{x.administration!.reaction!.severity}</Chip>,
                  title: x.patient ? `${x.patient.lastName}, ${x.patient.firstName}` : 'Unknown',
                  sub: <>{x.administration!.reaction!.symptoms}</>,
                  aux: <span className="muted small">{x.administration!.agent} · {x.administration!.volumeDeliveredMl ?? 0} mL</span>,
                })}
              />
            )}
            <div className="note" style={{ marginTop: 8 }}>Every reaction opens a quality incident for the compliance register and adds a contrast-reaction flag that blocks future contrast until a radiologist decides. Last refreshed <DateTime iso={new Date().toISOString()} date={false} />.</div>
          </Card>
        </div>
      )}
    </div>
  );
}
