import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Button, Banner, Chip, DataTable, Field, Input, Select, Skeleton, EmptyState, KV, StatusChip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/desk/patients')({ component: Patients });

interface Patient { id: string; epid: string; firstName: string; lastName: string; dateOfBirth: string | null; sex: string | null; mobile: string | null; schemeName: string | null; schemeOption: string | null; idNumberMasked: string; idVerifiedAt: string | null; status: string; language: string }

function Patients() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', idType: 'sa_id', idNumber: '', mobile: '', schemeName: '', memberNo: '', language: 'en' });
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ firstName: string; lastName: string; id: string } | null>(null);

  const list = useQuery({ queryKey: ['patients', q], queryFn: () => api.get<{ patients: Patient[] }>(`/patients?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const detail = useQuery({ queryKey: ['patient', selected], queryFn: () => api.get<{ patient: Patient }>(`/patients/${selected}`), enabled: !!selected });
  const dupes = useQuery({ queryKey: ['patient-dupes', selected], queryFn: () => api.get<{ candidates: Array<Patient & { score: number }> }>(`/patients/${selected}/duplicates`), enabled: !!selected });
  const orders = useQuery({ queryKey: ['patient-orders', selected], queryFn: () => api.get<{ orders: Array<{ id: string; orderNo: string; status: string; procedures: Array<{ description: string }>; createdAt: string }> }>(`/referrals/orders?patientId=${selected}&limit=20`), enabled: !!selected });

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/patients', { firstName: form.firstName, lastName: form.lastName, idType: form.idType as 'sa_id', idNumber: form.idNumber || undefined, mobile: form.mobile || undefined, schemeName: form.schemeName || undefined, memberNo: form.memberNo || undefined, language: form.language }),
    onSuccess: (r) => { setError(null); setDuplicate(null); setSelected(r.id); void qc.invalidateQueries({ queryKey: ['patients'] }); setForm({ firstName: '', lastName: '', idType: 'sa_id', idNumber: '', mobile: '', schemeName: '', memberNo: '', language: 'en' }); },
    onError: (e: any) => { setError(e.message); setDuplicate(e.details?.existing ?? null); },
  });
  const verify = useMutation({ mutationFn: () => api.post(`/patients/${selected}/verify-id`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['patient', selected] }) });
  const merge = useMutation({ mutationFn: (intoId: string) => api.post(`/patients/${selected}/merge`, { intoId }), onSuccess: () => { void qc.invalidateQueries(); } });

  return (
    <div className="page">
      <PageHeader title="Patients" subtitle="Search the master index, create with ID validation, resolve duplicates" actions={<Button variant="primary" onClick={() => void navigate({ to: '/desk' })}>Back to today</Button>} />
      <div className="split">
        <Card title="Search" extra={`${list.data?.patients.length ?? 0} shown`}>
          <Field label="Surname, first name, ID number, mobile or enterprise id">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dlamini" />
          </Field>
          {list.isLoading ? <Skeleton rows={6} /> : list.isError ? <Banner kind="crit">Patients could not be loaded.</Banner> : (
            <DataTable
              rows={list.data?.patients ?? []}
              rowKey={(p) => p.id}
              selectedKey={selected ?? undefined}
              onRowClick={(p) => setSelected(p.id)}
              empty="No patient matches that search."
              columns={[
                { key: 'name', header: 'Patient', render: (p) => <>{p.lastName}, {p.firstName}</> },
                { key: 'dob', header: 'Date of birth', render: (p) => <span className="mono">{p.dateOfBirth ?? '—'}</span> },
                { key: 'id', header: 'ID', render: (p) => <span className="mono">{p.idNumberMasked}</span> },
                { key: 'scheme', header: 'Scheme', render: (p) => p.schemeName ?? 'Cash' },
                { key: 'verified', header: 'Identity', render: (p) => <Chip kind={p.idVerifiedAt ? 'done' : 'att'}>{p.idVerifiedAt ? 'verified' : 'documented'}</Chip> },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Create a patient">
            <div className="grid g2">
              <Field label="First name"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
              <Field label="Surname"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
              <Field label="Identity type">
                <Select value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })}>
                  <option value="sa_id">SA ID number</option>
                  <option value="passport">Passport</option>
                  <option value="none">None recorded</option>
                </Select>
              </Field>
              <Field label="Identity number" hint="SA ID numbers are checked for date, sex digits and checksum"><Input value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} /></Field>
              <Field label="Mobile"><Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="082 000 0000" /></Field>
              <Field label="Language"><Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} /></Field>
              <Field label="Medical scheme"><Input value={form.schemeName} onChange={(e) => setForm({ ...form, schemeName: e.target.value })} /></Field>
              <Field label="Member number"><Input value={form.memberNo} onChange={(e) => setForm({ ...form, memberNo: e.target.value })} /></Field>
            </div>
            {error && <Banner kind={duplicate ? 'warn' : 'crit'}>{error}{duplicate ? `: ${duplicate.lastName}, ${duplicate.firstName} already exists.` : ''}</Banner>}
            <div className="row-flex" style={{ marginTop: 8 }}>
              <Button variant="primary" disabled={!form.firstName || !form.lastName || create.isPending} onClick={() => create.mutate()}>Create patient</Button>
              {duplicate && <Button onClick={() => setSelected(duplicate.id)}>Open the existing record</Button>}
            </div>
          </Card>

          {selected && (
            <Card title={detail.data ? `${detail.data.patient.firstName} ${detail.data.patient.lastName}` : 'Patient'} extra={<StatusChip status={detail.data?.patient.status} />}>
              {detail.isLoading ? <Skeleton rows={4} /> : detail.data && (
                <>
                  <KV items={[
                    ['Enterprise id', <span key="e" className="mono">{detail.data.patient.epid}</span>],
                    ['Date of birth', detail.data.patient.dateOfBirth ?? '—'],
                    ['Identity', `${detail.data.patient.idNumberMasked} · ${detail.data.patient.idVerifiedAt ? 'verified' : 'not verified'}`],
                    ['Scheme', `${detail.data.patient.schemeName ?? 'Cash'}${detail.data.patient.schemeOption ? ` · ${detail.data.patient.schemeOption}` : ''}`],
                    ['Mobile', detail.data.patient.mobile ?? '—'],
                  ]} />
                  <div className="row-flex" style={{ marginTop: 8 }}>
                    <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending || !!detail.data.patient.idVerifiedAt}>Verify identity</Button>
                  </div>
                  {verify.isError && <Banner kind="crit">Identity could not be verified: {(verify.error as Error).message}</Banner>}
                  <hr className="hr" />
                  <h4>Possible duplicates</h4>
                  {dupes.isLoading ? <Skeleton rows={2} /> : (dupes.data?.candidates.length ?? 0) === 0 ? <p className="note">No duplicate candidates.</p> : (
                    <DataTable
                      rows={dupes.data!.candidates}
                      rowKey={(p) => p.id}
                      columns={[
                        { key: 'name', header: 'Candidate', render: (p) => <>{p.lastName}, {p.firstName}</> },
                        { key: 'dob', header: 'Date of birth', render: (p) => <span className="mono">{p.dateOfBirth ?? '—'}</span> },
                        { key: 'score', header: 'Score', num: true, render: (p) => p.score.toFixed(2) },
                        { key: 'act', header: '', render: (p) => <Button size="sm" onClick={() => merge.mutate(p.id)}>Merge into this</Button> },
                      ]}
                    />
                  )}
                  <hr className="hr" />
                  <h4>Recent orders</h4>
                  {orders.isLoading ? <Skeleton rows={2} /> : (orders.data?.orders.length ?? 0) === 0 ? <EmptyState>No orders for this patient.</EmptyState> : (
                    <DataTable
                      rows={orders.data!.orders}
                      rowKey={(o) => o.id}
                      columns={[
                        { key: 'no', header: 'Order', render: (o) => <span className="mono">{o.orderNo}</span> },
                        { key: 'proc', header: 'Procedure', render: (o) => o.procedures[0]?.description ?? '—' },
                        { key: 'status', header: 'Status', render: (o) => <StatusChip status={o.status} /> },
                      ]}
                    />
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
