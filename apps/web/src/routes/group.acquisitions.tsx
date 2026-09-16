import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, Skeleton, EmptyState, Sheet, KV, Money, Check } from '@bonakala/bdl';
import { api } from '../lib/api';
import { AcquisitionKanban, type Acquisition } from './group.index';

export const Route = createFileRoute('/group/acquisitions')({ component: AcquisitionsPage });

function AcquisitionsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Acquisition | null>(null);
  const acqs = useQuery({ queryKey: ['acquisitions'], queryFn: () => api.get<{ acquisitions: Acquisition[]; stages: string[] }>('/analytics/acquisitions') });

  const runHand = useMutation({
    mutationFn: (id: string) => api.post<{ task: { status: string; output: Record<string, unknown> | null; error: string | null } }>(`/analytics/acquisitions/${id}/onboarding-hand`),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['acquisitions'] }); },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/analytics/acquisitions/${id}`, body),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['acquisitions'] }); },
  });

  const rows = acqs.data?.acquisitions ?? [];
  const current = open ? rows.find((a) => a.id === open.id) ?? open : null;
  const onboarding = rows.filter((a) => a.stage === 'onboarding');

  return (
    <div className="page">
      <PageHeader title="Acquisitions" subtitle="Pipeline, merger-threshold check and the five-day onboarding wizard" actions={<a className="btn" href="/group">Group tower</a>} />

      {onboarding.length > 0 && (
        <Banner kind="info">
          {onboarding.map((a) => `${a.name}: ${a.checklist.filter((c) => c.done).length} of ${a.checklist.length} onboarding steps done`).join(' · ')}.
          {' '}The Onboarding Hand stages configuration; a human activates fee schedules and clinical rights.
        </Banner>
      )}
      {acqs.isError && <Banner kind="crit">The pipeline could not be loaded. Refresh, or call platform support with reference acquisitions.</Banner>}

      <Card title="Pipeline">
        {acqs.isLoading ? <Skeleton rows={5} /> : !rows.length ? <EmptyState>No acquisitions in the pipeline.</EmptyState> : <AcquisitionKanban rows={rows} onOpen={setOpen} />}
      </Card>

      {current && (
        <Sheet open onClose={() => setOpen(null)} title={current.name}>
          <KV items={[
            ['Region', current.region ?? '—'],
            ['Sites', current.sites.join(', ')],
            ['Modalities', (current.modalities ?? []).join(', ') || '—'],
            ['Stage', <Chip key="s" kind={current.stage === 'live' ? 'done' : 'active'}>{current.stage.replace(/_/g, ' ')}</Chip>],
            ['Owner', current.owner ?? '—'],
            ['Indicative EBITDA', current.indicativeEbitdaCents ? <Money cents={current.indicativeEbitdaCents} key="e" /> : '—'],
            ['JV split', current.jvSplit ?? '—'],
            ['Effective date', current.effectiveDate ?? '—'],
            ['Merger threshold', current.mergerThreshold?.assessed
              ? <>{current.mergerThreshold.category ?? 'assessed'}{current.mergerThreshold.notifiable ? ' · notifiable' : ' · not notifiable'}{current.mergerThreshold.note ? <div className="small muted">{current.mergerThreshold.note}</div> : null}</>
              : <Chip kind="att">not assessed</Chip>],
          ]} />

          <Card title="Onboarding checklist · five working days">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {current.checklist.map((c, i) => (
                <div key={i} className="spread">
                  <Check
                    checked={c.done}
                    onChange={() => patch.mutate({ id: current.id, body: { checklistIndex: i, done: !c.done } })}
                    label={<span className={c.done ? '' : 'muted'}><span className="mono small">Day {c.day}</span> · {c.item}</span>}
                  />
                  {c.by === 'onboarding_hand' && <Chip kind="ai">Hand</Chip>}
                </div>
              ))}
            </div>
          </Card>

          {runHand.data && (
            <Banner kind={runHand.data.task.status === 'done' ? 'ok' : 'warn'}>
              {runHand.data.task.status === 'done'
                ? `Staged: ${((runHand.data.task.output?.staged as string[]) ?? []).join('; ') || 'nothing left to stage'}${((runHand.data.task.output?.humanOnly as string[]) ?? []).length ? `. Left for a human: ${((runHand.data.task.output!.humanOnly as string[]) ?? []).join('; ')}` : ''}`
                : runHand.data.task.error ?? 'The Hand stopped.'}
            </Banner>
          )}

          <div className="row-flex">
            <Button variant="primary" disabled={current.stage !== 'onboarding' || runHand.isPending} onClick={() => runHand.mutate(current.id)}>Run the Onboarding Hand for the next day</Button>
            {current.stage !== 'live' && (
              <Button onClick={() => patch.mutate({ id: current.id, body: { stage: current.stage === 'target' ? 'due_diligence' : current.stage === 'due_diligence' ? 'onboarding' : 'live' } })}>
                Advance to {current.stage === 'target' ? 'due diligence' : current.stage === 'due_diligence' ? 'onboarding' : 'live'}
              </Button>
            )}
          </div>
          {patch.isError && <Banner kind="crit">{(patch.error as Error).message}</Banner>}
          <p className="note">Go-live is blocked until every checklist item is done. The Hand never provisions clinical rights and never activates a fee schedule.</p>
        </Sheet>
      )}
    </div>
  );
}
