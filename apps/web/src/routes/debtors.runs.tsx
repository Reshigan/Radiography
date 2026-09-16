import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, Bars, KV, DateTime, StatusChip, Sheet } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/debtors/runs')({ component: Page });

interface Run { id: string; startedAt: string; finishedAt: string | null; actions: number; byChannel: Record<string, number>; byStep: Record<string, number>; byBand: Record<string, number>; exclusions: Record<string, number>; insideWindow: number; needsHuman: number; policyVersion: string; sampleReviewedBy: string | null; sampleReviewedAt: string | null; status: string }
interface Action { id: string; account: string; debtorName: string | null; step: string; channel: string; template: string; language: string; amountCents: number; scheduledFor: string; sentAt: string | null; status: string; paylinkToken: string | null }
interface Policy { id: string; version: string; graceDays: number; maxContactsPerWeek: number; channelOrder: string[]; maxPlanCents: number; maxPlanInstalments: number; minHandoverCents: number; handoverAfterDays: number; prescriptionYears: number; steps: Array<{ id: string; day: number; action: string; channels: string[] }> }

function Page() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api.get<{ runs: Run[]; policy: Policy }>('/billing/debtors/runs') });
  const detail = useQuery({ queryKey: ['run', selected], enabled: !!selected, queryFn: () => api.get<{ run: Run; actions: Action[] }>(`/billing/debtors/runs/${selected}`) });

  const run = useMutation({ mutationFn: (dry: boolean) => api.post('/billing/debtors/run', { dryRun: dry }), onSuccess: (r: any) => { setToast(`${r.task?.output?.actions ?? 0} actions scheduled inside the contact window.`); void qc.invalidateQueries({ queryKey: ['runs'] }); }, onError: (e: Error) => setToast(e.message) });

  const rows = runs.data?.runs ?? [];
  const policy = runs.data?.policy;
  const current = detail.data;

  return (
    <div className="page">
      <PageHeader
        title="Dunning runs"
        subtitle="Batches, channel mix, exclusions and results"
        actions={<>
          <Button onClick={() => run.mutate(true)} disabled={run.isPending}>Dry run</Button>
          <Button variant="primary" onClick={() => run.mutate(false)} disabled={run.isPending}>Run now</Button>
        </>}
      />
      {runs.isError && <Banner kind="crit">Runs could not be loaded.</Banner>}

      {policy && (
        <Card title={`Dunning policy ${policy.id}`} extra={`version ${policy.version} · enforced by the M20 leash, not by prompts`}>
          <div className="grid g4">
            <KV items={[['Grace', `${policy.graceDays} days after the statement`], ['Frequency', `at most ${policy.maxContactsPerWeek} contacts per account per week`]]} />
            <KV items={[['Windows', '08:00 to 20:00 SAST, never on a Sunday'], ['Channel order', policy.channelOrder.join(' → ')]]} />
            <KV items={[['Plan leash', <Money key="p" cents={policy.maxPlanCents} />], ['Max instalments', `${policy.maxPlanInstalments}, interest free`]]} />
            <KV items={[['Handover minimum', <Money key="h" cents={policy.minHandoverCents} />], ['Prescription', `${policy.prescriptionYears} years, tracked per balance`]]} />
          </div>
          <div className="row-flex" style={{ marginTop: 8 }}>
            {policy.steps.map((s) => <Chip key={s.id}>day {s.day} · {s.action.replace(/_/g, ' ')}{s.channels.length ? ` · ${s.channels[0]}` : ''}</Chip>)}
          </div>
        </Card>
      )}

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
        <Card title="Runs" extra={`${rows.length}`}>
          {runs.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState action={<Button size="sm" variant="primary" onClick={() => run.mutate(false)}>Run now</Button>}>No collections run has been recorded.</EmptyState> : (
            <DataTable
              rows={rows}
              rowKey={(x) => x.id}
              selectedKey={selected ?? undefined}
              onRowClick={(x) => setSelected(x.id)}
              columns={[
                { key: 'when', header: 'Started', render: (x) => <DateTime iso={x.startedAt} /> },
                { key: 'n', header: 'Actions', num: true, render: (x) => x.actions },
                { key: 'win', header: 'In window', num: true, render: (x) => <span className={x.insideWindow === x.actions ? '' : 'neg'}>{x.insideWindow}/{x.actions}</span> },
                { key: 'excl', header: 'Excluded', num: true, render: (x) => Object.values(x.exclusions).reduce((a, b) => a + b, 0) },
                { key: 'need', header: 'Needs a human', num: true, render: (x) => x.needsHuman },
                { key: 'rev', header: 'Sample', render: (x) => x.sampleReviewedBy ? <Chip kind="done">reviewed</Chip> : <Chip kind="att">pending</Chip> },
                { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!current ? <Card title="Run detail"><EmptyState>Select a run to see its actions and exclusions.</EmptyState></Card> : (
            <>
              <div className="grid g3">
                <Tile label="Actions" value={current.run.actions} delta={`${current.run.insideWindow} inside the window`} />
                <Tile label="Excluded" value={Object.values(current.run.exclusions).reduce((a, b) => a + b, 0)} delta="never contacted" />
                <Tile label="Needs a human" value={current.run.needsHuman} delta="outside the leash" />
              </div>
              <Card title="Channel mix"><Bars data={Object.entries(current.run.byChannel).map(([k, v]) => ({ label: k, value: v, tone: 'info' }))} /></Card>
              <Card title="Sequence steps"><Bars data={Object.entries(current.run.byStep).map(([k, v]) => ({ label: k, value: v }))} /></Card>
              <Card title="Exclusions" extra="enforced by the runtime">
                <Bars data={Object.entries(current.run.exclusions).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v, tone: ['deceased', 'disputed', 'prescription_risk'].includes(k) ? 'crit' : 'warn' }))} />
                <p className="note" style={{ marginTop: 6 }}>Urgent care, open disputes, prescription risk, deceased flags, withdrawn consent and practice-error balances are never contacted.</p>
              </Card>
              <Card title="Actions" extra={`${current.actions.length}`}>
                {current.actions.length === 0 ? <EmptyState>This run recorded no messages.</EmptyState> : (
                  <div style={{ maxHeight: 320, overflow: 'auto' }}>
                    <DataTable
                      rows={current.actions}
                      rowKey={(x) => x.id}
                      columns={[
                        { key: 'acc', header: 'Account', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.debtorName ?? x.account}<span className="small muted mono" style={{ display: 'block' }}>{x.account}</span></div> },
                        { key: 'step', header: 'Step', render: (x) => x.step },
                        { key: 'ch', header: 'Channel', render: (x) => <Chip>{x.channel}</Chip> },
                        { key: 'lang', header: 'Language', render: (x) => x.language },
                        { key: 'amt', header: 'Balance', num: true, render: (x) => <Money cents={x.amountCents} /> },
                        { key: 'when', header: 'Scheduled', render: (x) => <DateTime iso={x.scheduledFor} /> },
                        { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                      ]}
                    />
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Collections"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
