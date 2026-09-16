import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Button, Banner, Field, Input, Select, TextArea, Skeleton, KV, DateTime, Chip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/r/urgent')({ component: Urgent });

function Urgent() {
  const [patientId, setPatientId] = useState('');
  const [code, setCode] = useState('');
  const [clinical, setClinical] = useState('');
  const [siteId, setSiteId] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: () => api.get<{ procedures: Array<{ code: string; description: string; modality: string }> }>('/referrals/catalogue') });
  const patients = useQuery({ queryKey: ['ref-patients-urgent'], queryFn: () => api.get<{ patients: Array<{ id: string; firstName: string; lastName: string; dateOfBirth: string | null }> }>('/patients?limit=50') });
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Array<{ id: string; name: string; phone: string | null }> }>('/org/sites') });

  const stat = useMutation({
    mutationFn: async () => {
      const order = await api.post<{ order: { id: string } }>('/referrals/orders', { patientId, procedures: [{ code }], priority: 'stat', clinicalInfo: clinical, channel: 'phone' });
      return api.post<{ appointment: any; displaced: number }>('/scheduling/stat', { orderId: order.order.id, siteId });
    },
    onSuccess: (r) => { setResult(r); setError(null); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="page">
      <PageHeader title="Urgent" subtitle="Call a radiologist, or send a STAT request that goes straight onto a room list" />
      <div className="split">
        <Card title="Call a radiologist now">
          {sites.isLoading ? <Skeleton rows={3} /> : (
            <>
              <p className="note">The on-call radiologist answers within the call-back target of 5 minutes. For a critical finding on a study we have already reported, the radiologist phones you.</p>
              <KV items={(sites.data?.sites ?? []).map((s) => [s.name, <span key={s.id} className="mono">{s.phone ?? '0800 000 000'}</span>])} />
            </>
          )}
        </Card>

        <Card title="STAT request" extra={<Chip kind="crit">immediate</Chip>}>
          {error && <Banner kind="crit">{error}</Banner>}
          {result && (
            <Banner kind="ok">
              STAT slot created at <DateTime iso={result.appointment.startsAt} />, {result.appointment.procedureDescription}. {result.displaced > 0 ? `${result.displaced} booking(s) will be moved and those patients are being contacted.` : 'No other booking was displaced.'}
            </Banner>
          )}
          <Field label="Patient">
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">Choose a patient</option>
              {patients.data?.patients.map((p) => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName} · {p.dateOfBirth ?? ''}</option>)}
            </Select>
          </Field>
          <Field label="Procedure">
            <Select value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">Choose a procedure</option>
              {(catalogue.data?.procedures ?? []).map((p) => <option key={p.code} value={p.code}>{p.modality} · {p.description}</option>)}
            </Select>
          </Field>
          <Field label="Site">
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Choose a site</option>
              {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Clinical question" hint="What must be answered now?">
            <TextArea rows={3} value={clinical} onChange={(e) => setClinical(e.target.value)} placeholder="Acute neurological deficit, thrombolysis window" />
          </Field>
          <Input type="hidden" value="stat" readOnly />
          <Button variant="danger" disabled={!patientId || !code || !siteId || clinical.length < 5 || stat.isPending} onClick={() => stat.mutate()}>
            {stat.isPending ? 'Creating…' : 'Send STAT request'}
          </Button>
          <p className="note">A STAT request bypasses slot search and goes onto the least-disruptive room list, subject to the safety checks at the modality. Radiation justification is recorded against your name.</p>
        </Card>
      </div>
    </div>
  );
}
