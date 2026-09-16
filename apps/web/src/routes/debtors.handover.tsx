import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, StatusChip, Sheet, KV, Check } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/debtors/handover')({ component: Page });

interface Handover {
  id: string; accountId: string; debtorName: string | null; accountNo: string | null; amountCents: number; clean: boolean; failing: string[]; collector: string; status: string;
  checklist: Record<string, boolean>; prescriptionDate: string | null; ageDays: number | null; proposedBy: string; approvedBy: string | null; releasedAt: string | null;
}
const LABELS: Record<string, string> = {
  statementDelivered: 'Statement delivered', finalNoticeDelivered: 'Final notice delivered on a verified channel', noOpenDispute: 'No open dispute or complaint',
  notVulnerable: 'Patient not flagged vulnerable, deceased or a minor without guardian rules', notPracticeError: 'Not a practice-error balance', notLongCycle: 'Not RAF or COIDA',
  aboveMinimum: 'Above the minimum handover amount', notPrescribed: 'Debt has not prescribed', sequenceComplete: 'Full dunning sequence completed',
};

function Page() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const data = useQuery({ queryKey: ['handover'], queryFn: () => api.get<{ handovers: Handover[]; minimumCents: number; prescriptionYears: number }>('/billing/debtors/handover') });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['handover'] }); void qc.invalidateQueries({ queryKey: ['debtors-tiles'] }); };
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/billing/debtors/handover/${id}/approve`, { confirm: 'Confirm' }), onSuccess: () => { setToast('Approved. The file can now be released to the registered collector under the data-sharing agreement.'); setConfirmed(false); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const release = useMutation({ mutationFn: (id: string) => api.post(`/billing/debtors/handover/${id}/release`, {}), onSuccess: () => { setToast('File released through the secure share. Only the fields the collector needs are included.'); refresh(); }, onError: (e: Error) => setToast(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => api.post(`/billing/debtors/handover/${id}/remove`, { reason: 'Removed by the controller before approval' }), onSuccess: () => { setToast('Removed from the handover list.'); refresh(); }, onError: (e: Error) => setToast(e.message) });

  const rows = data.data?.handovers ?? [];
  const proposed = rows.filter((x) => x.status === 'proposed');
  const clean = proposed.filter((x) => x.clean);
  const current = rows.find((x) => x.id === selected) ?? null;

  return (
    <div className="page">
      <PageHeader title="Handover" subtitle="Approval list with the checklist as a gate and prescription checks" />
      {data.isError && <Banner kind="crit">The handover list could not be loaded.</Banner>}
      <Banner kind="info">Handover is a last resort and a reserved action. A balance that fails any check cannot be added to the file, and the practice manager approves every release.</Banner>

      <div className="grid g4">
        <Tile label="Proposed" value={proposed.length} delta={<Money cents={proposed.reduce((a, x) => a + x.amountCents, 0)} />} />
        <Tile label="Checklist clean" value={clean.length} tone="up" delta={<Money cents={clean.reduce((a, x) => a + x.amountCents, 0)} />} />
        <Tile label="Blocked by a check" value={proposed.length - clean.length} tone={proposed.length - clean.length ? 'down' : undefined} delta="cannot be handed over" />
        <Tile label="Minimum amount" value={<Money cents={data.data?.minimumCents ?? 0} />} delta={`prescription tracked over ${data.data?.prescriptionYears ?? 3} years`} />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
        <Card title="Handover proposals" extra={`${rows.length}`}>
          {data.isLoading ? <Skeleton rows={5} /> : rows.length === 0 ? <EmptyState>Nothing is proposed for handover.</EmptyState> : (
            <DataTable
              rows={rows}
              rowKey={(x) => x.id}
              selectedKey={selected ?? undefined}
              onRowClick={(x) => { setSelected(x.id); setConfirmed(false); }}
              columns={[
                { key: 'who', header: 'Account', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.debtorName ?? '—'}<span className="small muted mono" style={{ display: 'block' }}>{x.accountNo}</span></div> },
                { key: 'amt', header: 'Balance', num: true, render: (x) => <Money cents={x.amountCents} /> },
                { key: 'age', header: 'Age', num: true, render: (x) => x.ageDays === null ? '—' : <span className="mono">{x.ageDays} d</span> },
                { key: 'chk', header: 'Checklist', render: (x) => x.clean ? <Chip kind="done">clean</Chip> : <Chip kind="att">{x.failing.map((f) => LABELS[f] ?? f).join('; ')}</Chip> },
                { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!current ? <Card title="Checklist"><EmptyState>Select a proposal to see its checklist.</EmptyState></Card> : (
            <>
              <div className="spread"><h3>{current.debtorName ?? current.accountNo}</h3><StatusChip status={current.status} /></div>
              <Card title="Checklist" extra={current.clean ? 'clean' : `${current.failing.length} failing`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(current.checklist).map(([k, v]) => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <Chip kind={v ? 'done' : 'crit'}>{v ? 'pass' : 'fail'}</Chip>
                      <span className={v ? '' : 'neg'}>{LABELS[k] ?? k}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Details">
                <KV items={[
                  ['Balance', <Money key="b" cents={current.amountCents} />],
                  ['Collector', current.collector],
                  ['Prescription date', <span key="p" className="mono">{current.prescriptionDate ?? '—'}</span>],
                  ['Proposed by', current.proposedBy],
                  ['Approved by', current.approvedBy ? 'the practice manager' : 'not yet'],
                ]} />
              </Card>
              {current.status === 'proposed' && (
                <Card title="Approve">
                  {!current.clean ? <Banner kind="crit">This balance fails {current.failing.map((f) => LABELS[f] ?? f).join(', ')}. It cannot be handed over.</Banner> : (
                    <>
                      <Check checked={confirmed} onChange={setConfirmed} label="I confirm the checklist and the data-sharing basis for this handover" />
                      <div className="row-flex" style={{ marginTop: 8 }}>
                        <Button variant="primary" disabled={!confirmed || approve.isPending} onClick={() => approve.mutate(current.id)}>{approve.isPending ? 'Approving…' : 'Approve handover'}</Button>
                        <Button onClick={() => remove.mutate(current.id)}>Remove from the list</Button>
                      </div>
                      <p className="note">Only the fields the collector needs are shared: name, identity number, contact details, balance, statement and proof of delivery.</p>
                    </>
                  )}
                </Card>
              )}
              {current.status === 'approved' && (
                <Card title="Release the file">
                  <Button variant="primary" disabled={release.isPending} onClick={() => release.mutate(current.id)}>{release.isPending ? 'Releasing…' : 'Release to the collector'}</Button>
                  <p className="note">The file goes through the secure share, never as an email attachment. Collector payments post to the ledger net of commission.</p>
                </Card>
              )}
              {current.status === 'released' && <Banner kind="ok">Released. Time remaining before prescription is tracked on the balance.</Banner>}
            </>
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Handover"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
