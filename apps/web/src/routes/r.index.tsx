import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Button, Banner, Chip, Provenance, Field, Input, Select, TextArea, Skeleton, EmptyState, RadioCards, Money, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/r/')({ component: Refer });

interface Procedure { code: string; description: string; modality: string; bodyPart: string; lateralityRequired: boolean; contrast: string; prep: string; durationMin: number; authFlag: boolean }
interface Patient { id: string; firstName: string; lastName: string; dateOfBirth: string | null; sex: string | null; idNumberMasked: string; schemeName: string | null; memberNo?: string | null }

function Refer() {
  // A referring clinician works into one practice at a time; pick the first until they switch.
  const { me, selectPractice } = useAuth();
  useEffect(() => {
    if (!me?.practiceId && me?.practices.length) void selectPractice(me.practices[0]!.id);
  }, [me, selectPractice]);
  const [patientId, setPatientId] = useState('');
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [laterality, setLaterality] = useState<'left' | 'right' | 'bilateral' | 'na'>('na');
  const [contrast, setContrast] = useState(false);
  const [priority, setPriority] = useState<'routine' | 'priority' | 'urgent'>('routine');
  const [clinical, setClinical] = useState('');
  const [icd, setIcd] = useState('');
  const [override, setOverride] = useState('');
  const [created, setCreated] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState('');

  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: () => api.get<{ procedures: Procedure[] }>('/referrals/catalogue') });
  const patients = useQuery({ queryKey: ['ref-patients', q], queryFn: () => api.get<{ patients: Patient[] }>(`/patients?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const proc = catalogue.data?.procedures.find((p) => p.code === code);

  const guidance = useQuery({
    queryKey: ['guidance', code, clinical, patientId],
    queryFn: () => api.post<{ result: { band: string; guidance: string; alternative?: string; ruleId: string }; alternative: { code: string; description: string } | null; provenance: any }>('/referrals/appropriateness', { procedureCode: code, clinicalInfo: clinical, patientId: patientId || undefined }),
    enabled: !!code && clinical.length > 5,
  });

  const submit = useMutation({
    mutationFn: () => api.post<{ order: any }>('/referrals/orders', {
      patientId, procedures: [{ code, laterality: proc?.lateralityRequired ? laterality : undefined, contrast }],
      priority, icd10: icd ? icd.split(',').map((x) => x.trim()) : [], clinicalInfo: clinical,
      appropriatenessOverrideReason: override || undefined,
    }),
    onSuccess: (r) => { setCreated(r.order); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  const sendPhoto = useMutation({
    mutationFn: () => api.post<{ referral: any; order: any }>('/referrals', { channel: 'paper_photo', photoText: photo, patientId: patientId || undefined }),
    onSuccess: (r) => { setCreated(r.order); setError(r.order ? null : 'The referral needs a person to check it; it is in the booking inbox.'); },
    onError: (e: Error) => setError(e.message),
  });

  const notAppropriate = guidance.data?.result.band === 'usually_not_appropriate';

  return (
    <div className="page">
      <PageHeader title="Refer" subtitle="A structured order, or a photo of your paper form" actions={<a className="btn" href="/r/urgent">Urgent or STAT</a>} />
      {!me?.practiceId && <Banner kind="info">Choose the practice you are referring to in the bar above.</Banner>}
      {error && <Banner kind="crit">{error}</Banner>}
      {created && (
        <Banner kind="ok" action={<a className="btn" href="/r/patients">See my patients</a>}>
          Referral sent. Order {created.order?.orderNo ?? created.orderNo}. We offer the patient three slots and confirm the price before the appointment.
        </Banner>
      )}

      <div className="split">
        <Card title="New referral">
          <Field label="Patient" hint="Search by surname, ID number or mobile">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dlamini" />
          </Field>
          {patients.isLoading ? <Skeleton rows={3} /> : (
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} aria-label="Patient">
              <option value="">Choose a patient</option>
              {patients.data?.patients.map((p) => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName} · {p.dateOfBirth ?? ''} · {p.schemeName ?? 'Cash'}</option>)}
            </Select>
          )}

          <Field label="Procedure">
            <Select value={code} onChange={(e) => { setCode(e.target.value); setLaterality('na'); setContrast(false); }}>
              <option value="">Choose a procedure</option>
              {(catalogue.data?.procedures ?? []).map((p) => <option key={p.code} value={p.code}>{p.modality} · {p.description}</option>)}
            </Select>
          </Field>

          <Field label="Clinical indication" hint="What question should the report answer?">
            <TextArea rows={3} value={clinical} onChange={(e) => setClinical(e.target.value)} placeholder="Low back pain, 3 weeks, no red flags" />
          </Field>

          {guidance.data && (
            <Provenance
              prov={{ modelId: 'guideline-rules', modelVersion: '2026.1', outputClass: 4, demo: true }}
              onAccept={guidance.data.alternative ? () => { setCode(guidance.data!.alternative!.code); setOverride(''); } : undefined}
            >
              <div className="note">rules-based · informs, never blocks · rule {guidance.data.result.ruleId}</div>
              <b>{guidance.data.result.band.replace(/_/g, ' ')}</b>
              <p style={{ margin: '4px 0 0' }}>{guidance.data.result.guidance}</p>
              {guidance.data.alternative && <p className="note">Suggested alternative: {guidance.data.alternative.description}</p>}
            </Provenance>
          )}
          {notAppropriate && (
            <Field label="Reason for proceeding (required when you keep this request)">
              <Input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Failed conservative care, surgical planning" />
            </Field>
          )}

          {proc?.lateralityRequired && (
            <Field label="Laterality (required for this procedure)">
              <RadioCards value={laterality} onChange={(v) => setLaterality(v as 'left')} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'bilateral', label: 'Both' }]} />
            </Field>
          )}
          {proc?.contrast === 'optional' && (
            <Field label="Contrast">
              <RadioCards value={contrast ? 'yes' : 'no'} onChange={(v) => setContrast(v === 'yes')} options={[{ value: 'no', label: 'None' }, { value: 'yes', label: 'With contrast' }]} />
            </Field>
          )}
          <Field label="Urgency">
            <RadioCards value={priority} onChange={(v) => setPriority(v as 'routine')} options={[{ value: 'routine', label: 'Routine' }, { value: 'priority', label: 'Within 7 days' }, { value: 'urgent', label: 'Within 24 hours' }]} />
          </Field>
          <Field label="ICD-10 codes" hint="Comma separated; billing confirms them after the report"><Input value={icd} onChange={(e) => setIcd(e.target.value)} placeholder="M54.5" /></Field>

          {proc && (
            <p className="note">
              {proc.description} · {proc.durationMin} minutes · {proc.prep}
              {proc.authFlag ? ' · most schemes need pre-authorisation, which we request for the patient.' : ''}
            </p>
          )}

          <div className="row-flex" style={{ marginTop: 8 }}>
            <Button variant="primary" disabled={!patientId || !code || clinical.length < 5 || (notAppropriate && override.length < 5) || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? 'Sending…' : 'Send referral and offer slots to the patient'}
            </Button>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Or photograph your paper referral">
            <p className="note">The Referral Hand reads every field with a confidence band for you to check. Unreadable fields stay empty and are flagged for a person.</p>
            <Field label="Words on the form">
              <TextArea rows={4} value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="MRI right knee, no contrast. Locking after rugby. Dr J. van Wyk MP 0123459" />
            </Field>
            <Button disabled={photo.length < 10 || sendPhoto.isPending} onClick={() => sendPhoto.mutate()}>{sendPhoto.isPending ? 'Reading…' : 'Send photo referral'}</Button>
          </Card>

          <Card title="Delivery preferences">
            <p className="note">Signed reports reach you in Referrer Space and by WhatsApp. Critical findings are phoned by the radiologist and need your acknowledgement.</p>
            <div className="row-flex">
              <Chip kind="done">Referrer Space</Chip>
              <Chip kind="done">WhatsApp: booked, reported, no-show</Chip>
              <Chip kind="neutral">FHIR to practice system: not connected</Chip>
            </div>
          </Card>

          {created && (
            <Card title="Order sent" extra={<StatusChip status={created.order?.status ?? created.status} />}>
              <p className="note">{created.order?.procedures?.[0]?.description ?? created.procedures?.[0]?.description}</p>
              {created.funding && <p className="note">Patient portion <Money cents={created.funding.patientPortionCents} /> · {created.funding.status.replace(/_/g, ' ')}</p>}
            </Card>
          )}
          {catalogue.isError && <Banner kind="crit">The procedure catalogue could not be loaded.</Banner>}
          {!catalogue.isLoading && (catalogue.data?.procedures.length ?? 0) === 0 && <EmptyState>No procedures are configured.</EmptyState>}
        </div>
      </div>
    </div>
  );
}
