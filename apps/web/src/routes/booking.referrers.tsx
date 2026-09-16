import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Button, Banner, Chip, DataTable, Skeleton, EmptyState, Field, Input, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/booking/referrers')({ component: Referrers });

interface Referrer { id: string; name: string; hpcsaNo: string | null; bhfPracticeNo: string | null; discipline: string | null; practiceName: string | null; phone: string | null; email: string | null; status: string; hpcsaVerifiedAt: string | null; verificationStale: boolean; orders: number; deliveryPrefs: { whatsapp?: boolean; portal?: boolean; fhir?: boolean } | null }

function Referrers() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', hpcsaNo: '', bhfPracticeNo: '', discipline: '', practiceName: '', phone: '' });
  const list = useQuery({ queryKey: ['referrers'], queryFn: () => api.get<{ referrers: Referrer[] }>('/referrals/referrers') });
  const verify = useMutation({ mutationFn: (id: string) => api.post(`/referrals/referrers/${id}/verify`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['referrers'] }) });
  const create = useMutation({
    mutationFn: () => api.post('/referrals/referrers', { name: form.name, hpcsaNo: form.hpcsaNo || undefined, bhfPracticeNo: form.bhfPracticeNo || undefined, discipline: form.discipline || undefined, practiceName: form.practiceName || undefined, phone: form.phone || undefined }),
    onSuccess: () => { setForm({ name: '', hpcsaNo: '', bhfPracticeNo: '', discipline: '', practiceName: '', phone: '' }); void qc.invalidateQueries({ queryKey: ['referrers'] }); },
  });

  const current = list.data?.referrers.find((r) => r.id === selected) ?? null;

  return (
    <div className="page">
      <PageHeader title="Referrers" subtitle="Referrer master, registration status and delivery preferences" />
      {list.isError && <Banner kind="crit">The referrer master could not be loaded.</Banner>}
      <div className="split">
        <Card title="Referrer master" extra={`${list.data?.referrers.length ?? 0}`}>
          {list.isLoading ? <Skeleton rows={6} /> : (list.data?.referrers.length ?? 0) === 0 ? <EmptyState>No referrers on file.</EmptyState> : (
            <DataTable
              rows={list.data!.referrers}
              rowKey={(r) => r.id}
              selectedKey={selected ?? undefined}
              onRowClick={(r) => setSelected(r.id)}
              columns={[
                { key: 'name', header: 'Referrer', render: (r) => <>{r.name}<div className="note">{r.practiceName ?? ''}</div></> },
                { key: 'disc', header: 'Discipline', render: (r) => r.discipline ?? '—' },
                { key: 'hpcsa', header: 'HPCSA', render: (r) => <span className="mono">{r.hpcsaNo ?? '—'}</span> },
                { key: 'status', header: 'Registration', render: (r) => <Chip kind={r.status === 'active' && !r.verificationStale ? 'done' : r.status === 'unverified' ? 'crit' : 'att'}>{r.verificationStale && r.status === 'active' ? 'recheck due' : r.status}</Chip> },
                { key: 'orders', header: 'Orders', num: true, render: (r) => r.orders },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {current && (
            <Card title={current.name} extra={<Chip kind={current.hpcsaVerifiedAt ? 'done' : 'att'}>{current.hpcsaVerifiedAt ? 'verified' : 'not verified'}</Chip>}>
              <KV items={[
                ['Practice', current.practiceName ?? '—'],
                ['HPCSA number', current.hpcsaNo ?? '—'],
                ['Practice number', current.bhfPracticeNo ?? '—'],
                ['Phone', current.phone ?? '—'],
                ['Email', current.email ?? '—'],
                ['Delivery', [current.deliveryPrefs?.whatsapp ? 'WhatsApp' : null, current.deliveryPrefs?.portal ? 'Referrer Space' : null, current.deliveryPrefs?.fhir ? 'FHIR' : null].filter(Boolean).join(', ') || 'Not set'],
                ['Last verified', current.hpcsaVerifiedAt ? new Date(current.hpcsaVerifiedAt).toLocaleDateString('en-ZA') : 'Never'],
              ]} />
              <div className="row-flex" style={{ marginTop: 8 }}>
                <Button variant="primary" size="sm" onClick={() => verify.mutate(current.id)} disabled={verify.isPending}>Verify registration</Button>
              </div>
              {verify.isError && <Banner kind="crit">{(verify.error as Error).message}</Banner>}
              <p className="note">Verification is a human action recorded with a timestamp and the evidence. A Hand can never mark a referrer verified.</p>
            </Card>
          )}

          <Card title="Add a referrer">
            <div className="grid g2">
              <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dr A. Khumalo" /></Field>
              <Field label="Discipline"><Input value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })} placeholder="GP" /></Field>
              <Field label="HPCSA number"><Input value={form.hpcsaNo} onChange={(e) => setForm({ ...form, hpcsaNo: e.target.value })} placeholder="MP 0123456" /></Field>
              <Field label="Practice number" hint="7 digits"><Input value={form.bhfPracticeNo} onChange={(e) => setForm({ ...form, bhfPracticeNo: e.target.value })} placeholder="0223344" /></Field>
              <Field label="Practice name"><Input value={form.practiceName} onChange={(e) => setForm({ ...form, practiceName: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            </div>
            {create.isError && <Banner kind="crit">{(create.error as Error).message}</Banner>}
            <Button variant="primary" style={{ marginTop: 8 }} disabled={form.name.length < 3 || create.isPending} onClick={() => create.mutate()}>Add referrer</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
