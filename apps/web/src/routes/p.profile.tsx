import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Banner, Field, Input, Select, Check, Skeleton, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/p/profile')({ component: Profile });

const LANGUAGES = ['English', 'isiZulu', 'isiXhosa', 'Afrikaans', 'Sepedi', 'Setswana', 'Sesotho', 'Xitsonga', 'siSwati', 'Tshivenda', 'isiNdebele'];

interface Patient {
  id: string;
  firstName: string; lastName: string; dateOfBirth: string | null; sex: string | null;
  idNumberMasked: string; idType: string | null;
  language: string;
  mobile: string | null; email: string | null; address: string | null;
  schemeName: string | null; schemeOption: string | null; memberNo: string | null;
  consents: Record<string, { granted: boolean; at: string; channel?: string }> | null;
}

function Profile() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['p-me'], queryFn: () => api.get<{ patient: Patient }>('/patients/me') });
  const patient = q.data?.patient;

  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [language, setLanguage] = useState('English');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!patient) return;
    setMobile(patient.mobile ?? '');
    setEmail(patient.email ?? '');
    setAddress(patient.address ?? '');
    setLanguage(patient.language && LANGUAGES.includes(patient.language) ? patient.language : 'English');
  }, [patient]);

  const save = useMutation({
    mutationFn: () => api.patch(`/patients/${patient!.id}`, { mobile: mobile || undefined, email: email || undefined, address: address || undefined, language }),
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: ['p-me'] }); },
  });

  const consent = useMutation({
    mutationFn: (next: Record<string, boolean>) => api.post<{ consents: Patient['consents'] }>(`/patients/${patient!.id}/consents`, { consents: next, channel: 'patient_space' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['p-me'] }),
  });

  const [requestRef, setRequestRef] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: (type: 'access' | 'deletion') => api.post<{ ref: string }>('/compliance/requests', { type, channel: 'patient_space' }),
    onSuccess: (r) => { setRequestRef(r.ref); setRequestError(null); },
    onError: (e: Error) => setRequestError(e.message),
  });

  if (q.isLoading) return <div className="page"><h1 style={{ fontSize: 24 }}>Profile</h1><Skeleton rows={6} /></div>;
  if (q.isError || !patient) return <div className="page"><h1 style={{ fontSize: 24 }}>Profile</h1><Banner kind="crit">Your profile could not be loaded. Please try again.</Banner></div>;

  const granted = (key: string) => patient.consents?.[key]?.granted ?? false;

  return (
    <div className="page">
      <h1 style={{ fontSize: 24 }}>Profile</h1>
      <p className="muted">Your identity, scheme, contact details, language and consents.</p>

      <Card title="Identity" extra="Held by the practice · to change, visit the front desk with ID">
        <KV items={[
          ['Name', `${patient.firstName} ${patient.lastName}`],
          ['Date of birth', patient.dateOfBirth ?? '—'],
          ['Sex', patient.sex ?? '—'],
          ['ID number', patient.idNumberMasked],
        ]} />
      </Card>

      <Card title="Medical scheme" extra="Held by the practice · confirmed at your next visit">
        <KV items={[
          ['Scheme', patient.schemeName ?? 'Cash patient'],
          ['Option', patient.schemeOption ?? '—'],
          ['Member number', patient.memberNo ?? '—'],
        ]} />
      </Card>

      <Card title="Contact and language">
        {saved && !save.isPending && <Banner kind="ok">Saved.</Banner>}
        {save.isError && <Banner kind="crit">{(save.error as Error).message}</Banner>}
        <Field label="Mobile"><Input value={mobile} onChange={(e) => { setMobile(e.target.value); setSaved(false); }} placeholder="082 000 0000" /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} placeholder="you@example.com" /></Field>
        <Field label="Address"><Input value={address} onChange={(e) => { setAddress(e.target.value); setSaved(false); }} placeholder="Street, suburb, city" /></Field>
        <Field label="Preferred language">
          <Select value={language} onChange={(e) => { setLanguage(e.target.value); setSaved(false); }}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </Field>
        <div className="row-flex" style={{ marginTop: 8 }}>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </Card>

      <Card title="Consents" extra="You can change these at any time">
        <Check checked={granted('sms_whatsapp_reminders')} onChange={(v) => consent.mutate({ sms_whatsapp_reminders: v })} label="SMS and WhatsApp appointment reminders" />
        <Check checked={granted('service_updates')} onChange={(v) => consent.mutate({ service_updates: v })} label="Occasional service and health tips" />
        <p className="note" style={{ marginTop: 8 }}>Consent to imaging, contrast and POPIA processing is confirmed at each visit, alongside the specific procedure, and is not changed here.</p>
      </Card>

      <Card title="Your data" extra="POPIA">
        {requestRef && <Banner kind="ok">Request received. Reference {requestRef}. The practice has 30 days to respond.</Banner>}
        {requestError && <Banner kind="crit">{requestError}</Banner>}
        <p className="note">Ask for a copy of the personal information the practice holds about you, or ask for it to be deleted where the law allows.</p>
        <div className="row-flex" style={{ marginTop: 8 }}>
          <Button disabled={request.isPending} onClick={() => request.mutate('access')}>{request.isPending ? 'Sending…' : 'Request my data'}</Button>
          <Button disabled={request.isPending} onClick={() => request.mutate('deletion')}>Ask to delete my data</Button>
        </div>
      </Card>
    </div>
  );
}
