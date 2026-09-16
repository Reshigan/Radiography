import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, Bars, KV, Sheet, Field, Check } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/funder/')({ component: Page });

interface Summary {
  funderId: string; funder: string; total: number; totalCents: number; firstPassPct: number;
  byStatus: Record<string, { count: number; cents: number }>; byPractice: Record<string, { count: number; cents: number }>; byReason: Record<string, number>;
  topCodes: Array<{ code: string; description: string; count: number; cents: number }>;
  rulePack: { id: string; version: string; effectiveFrom: string; staleClaimDays: number; authRequiredCodes: string[]; notes?: string } | null;
}
interface Claim { id: string; claimRef: string; patient: string; procedure: string; icd10: string[]; totalCents: number; paidCents: number; status: string; serviceDate: string; submittedAt: string | null; channel: string }

function Page() {
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const summary = useQuery({ queryKey: ['funder-summary'], queryFn: () => api.get<Summary>('/billing/funder/summary') });
  const claims = useQuery({ queryKey: ['funder-claims'], queryFn: () => api.get<{ claims: Claim[] }>('/billing/claims?limit=200') });
  const audit = useMutation({
    mutationFn: () => api.post('/billing/funder/audit-request', { claimIds: selected, reason }),
    onSuccess: (r: any) => { setToast(`Request ${r.id} recorded for ${r.claims} claim(s). Compliance releases the pack with a lawful-basis record.`); setOpen(false); setSelected([]); setReason(''); },
    onError: (e: Error) => setToast(e.message),
  });

  const s = summary.data;
  const rows = claims.data?.claims ?? [];

  return (
    <div className="page">
      <PageHeader
        title={s ? `${s.funder} · claims portal` : 'Funder portal'}
        subtitle="Claims submitted to your scheme, the rule pack in force and audit requests"
        actions={<Button variant="primary" disabled={!selected.length} onClick={() => setOpen(true)}>Request an audit pack ({selected.length})</Button>}
      />
      {summary.isError && <Banner kind="crit">Your claims summary could not be loaded.</Banner>}
      <Banner kind="info">Patient identity is not shown in this portal. Claims are identified by member number, and any identified pack is released by the practice&apos;s compliance officer with a recorded lawful basis.</Banner>

      {summary.isLoading ? <Skeleton rows={3} /> : s && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
          <Tile label="Claims received" value={s.total} delta={<Money cents={s.totalCents} />} />
          <Tile label="Paid" value={s.byStatus.paid?.count ?? 0} tone="up" delta={<Money cents={s.byStatus.paid?.cents ?? 0} />} />
          <Tile label="Rejected" value={s.byStatus.rejected?.count ?? 0} tone="down" delta={<Money cents={s.byStatus.rejected?.cents ?? 0} />} />
          <Tile label="In flight" value={(s.byStatus.submitted?.count ?? 0) + (s.byStatus.accepted?.count ?? 0) + (s.byStatus.pended?.count ?? 0)} delta="awaiting adjudication or remittance" />
          <Tile label="First-pass acceptance" value={`${s.firstPassPct} %`} tone={s.firstPassPct >= 95 ? 'up' : 'down'} delta="of adjudicated claims" />
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <Card title="Claims" extra={`${rows.length} · select rows to request an audit pack`}>
          {claims.isLoading ? <Skeleton rows={8} /> : rows.length === 0 ? <EmptyState>No claims have been submitted to your scheme by this practice.</EmptyState> : (
            <div style={{ maxHeight: 460, overflow: 'auto' }}>
              <DataTable
                rows={rows}
                rowKey={(x) => x.id}
                onRowClick={(x) => setSelected(selected.includes(x.id) ? selected.filter((y) => y !== x.id) : [...selected, x.id])}
                columns={[
                  { key: 'sel', header: '', width: 34, render: (x) => <Chip kind={selected.includes(x.id) ? 'done' : 'neutral'}>{selected.includes(x.id) ? '✓' : ' '}</Chip> },
                  { key: 'ref', header: 'Claim', render: (x) => <span className="mono">{x.claimRef}</span> },
                  { key: 'm', header: 'Member', render: (x) => <span className="small muted">{x.patient}</span> },
                  { key: 'p', header: 'Procedure', render: (x) => x.procedure },
                  { key: 'icd', header: 'ICD-10', render: (x) => <span className="mono small">{x.icd10.join(', ')}</span> },
                  { key: 'd', header: 'Service date', render: (x) => <span className="mono">{x.serviceDate}</span> },
                  { key: 'ch', header: 'Channel', render: (x) => <Chip kind={x.channel === 'realtime' ? 'active' : 'neutral'}>{x.channel}</Chip> },
                  { key: 't', header: 'Claimed', num: true, render: (x) => <Money cents={x.totalCents} /> },
                  { key: 'pd', header: 'Paid', num: true, render: (x) => x.paidCents ? <Money cents={x.paidCents} /> : <span className="muted">—</span> },
                  { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                ]}
              />
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Card title="Rule pack in force" extra={s?.rulePack?.version}>
            {!s?.rulePack ? <EmptyState>No rule pack is published for your scheme.</EmptyState> : (
              <>
                <KV items={[
                  ['Version', <span key="v" className="mono">{s.rulePack.version}</span>],
                  ['Effective from', s.rulePack.effectiveFrom],
                  ['Submission window', `${s.rulePack.staleClaimDays} days from the service date`],
                  ['Authorisation required', <span key="a" className="mono small">{s.rulePack.authRequiredCodes.join(', ') || 'none'}</span>],
                ]} />
                {s.rulePack.notes && <p className="note" style={{ marginTop: 6 }}>{s.rulePack.notes}</p>}
              </>
            )}
          </Card>

          <Card title="Claim mix by tariff code" extra="top ten by value">
            {!s?.topCodes.length ? <EmptyState>No adjudicated claims yet.</EmptyState> : (
              <Bars data={s.topCodes.map((x) => ({ label: `${x.code} ${x.description}`, value: Math.round(x.cents / 100), tone: 'info' }))} format={(v) => `R ${v.toLocaleString('en-ZA')}`} />
            )}
          </Card>

          {s && Object.keys(s.byReason).length > 0 && (
            <Card title="Rejections by reason" extra="what your edits are catching">
              <Bars data={Object.entries(s.byReason).map(([k, v]) => ({ label: k.replace(/_/g, ' ').toLowerCase(), value: v, tone: 'crit' }))} />
            </Card>
          )}

          <Card title="By practice">
            {!s ? <Skeleton rows={3} /> : (
              <DataTable
                rows={Object.entries(s.byPractice).map(([practiceId, v]) => ({ practiceId, ...v }))}
                rowKey={(x) => x.practiceId}
                columns={[
                  { key: 'p', header: 'Practice', render: (x) => x.practiceId },
                  { key: 'n', header: 'Claims', num: true, render: (x) => x.count },
                  { key: 'c', header: 'Value', num: true, render: (x) => <Money cents={x.cents} /> },
                ]}
              />
            )}
          </Card>
        </div>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Request an audit pack">
        <p className="note">The pack is assembled from Platform evidence: referral, authorisation, registration and consent, acquisition timestamps, the study summary, the dose report, the signed report with its signature time, the contrast record, and the claim and remittance history.</p>
        <KV items={[['Claims selected', String(selected.length)]]} />
        <Field label="Reason for the request"><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Routine sample audit of contrast CT claims for the September cycle" /></Field>
        <Check checked label="I confirm this request is made under our provider agreement" onChange={() => undefined} />
        <div className="row-flex">
          <Button variant="primary" disabled={reason.length < 5 || audit.isPending} onClick={() => audit.mutate()}>{audit.isPending ? 'Sending…' : 'Send the request'}</Button>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </Sheet>
      <Sheet open={!!toast} onClose={() => setToast(null)} title="Funder portal"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
