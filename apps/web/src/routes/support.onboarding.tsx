import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, Skeleton, EmptyState, Check, KV, Money } from '@bonakala/bdl';
import { api } from '../lib/api';
import type { Acquisition } from './group.index';

export const Route = createFileRoute('/support/onboarding')({ component: OnboardingPage });

const DAYS = [1, 2, 3, 4, 5];

function OnboardingPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const acqs = useQuery({ queryKey: ['acquisitions'], queryFn: () => api.get<{ acquisitions: Acquisition[] }>('/analytics/acquisitions') });
  const runHand = useMutation({
    mutationFn: (id: string) => api.post<{ task: { status: string; output: Record<string, unknown> | null; error: string | null } }>(`/analytics/acquisitions/${id}/onboarding-hand`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['acquisitions'] }),
  });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/analytics/acquisitions/${id}`, body), onSuccess: () => void qc.invalidateQueries({ queryKey: ['acquisitions'] }) });

  const rows = (acqs.data?.acquisitions ?? []).filter((a) => a.stage === 'onboarding' || a.stage === 'due_diligence' || a.stage === 'live');
  const current = rows.find((a) => a.id === selected) ?? rows.find((a) => a.stage === 'onboarding') ?? rows[0] ?? null;

  return (
    <div className="page">
      <PageHeader title="Onboarding" subtitle="New practice in five working days, tracked day by day" actions={<a className="btn" href="/group/acquisitions">Pipeline</a>} />

      {acqs.isError && <Banner kind="crit">Onboarding projects could not be loaded. Refresh, or retry with reference acquisitions.</Banner>}

      <div className="toolbar">
        {rows.map((a) => (
          <Button key={a.id} size="sm" variant={current?.id === a.id ? 'primary' : undefined} onClick={() => setSelected(a.id)}>{a.name}</Button>
        ))}
      </div>

      {acqs.isLoading ? <Skeleton rows={6} /> : !current ? <EmptyState>No practices onboarding.</EmptyState> : (
        <>
          <Card title={current.name} extra={<Chip kind={current.stage === 'live' ? 'done' : 'active'}>{current.stage.replace(/_/g, ' ')}</Chip>}>
            <KV items={[
              ['Sites', current.sites.join(', ')],
              ['Modalities', (current.modalities ?? []).join(', ') || '—'],
              ['Effective date', current.effectiveDate ?? '—'],
              ['JV split', current.jvSplit ?? '—'],
              ['Indicative EBITDA', current.indicativeEbitdaCents ? <Money cents={current.indicativeEbitdaCents} key="e" /> : '—'],
              ['Merger threshold', current.mergerThreshold?.assessed ? `${current.mergerThreshold.category ?? 'assessed'}${current.mergerThreshold.notifiable ? ' · notifiable' : ''}` : 'not assessed'],
            ]} />
          </Card>

          <div className="grid g3">
            {DAYS.map((day) => {
              const items = current.checklist.filter((c) => c.day === day);
              const done = items.filter((c) => c.done).length;
              return (
                <Card key={day} title={`Day ${day}`} extra={<span className="mono small">{done}/{items.length}</span>}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map((c) => {
                      const index = current.checklist.indexOf(c);
                      return (
                        <div key={c.item} className="spread" style={{ alignItems: 'flex-start', gap: 6 }}>
                          <Check checked={c.done} onChange={() => patch.mutate({ id: current.id, body: { checklistIndex: index, done: !c.done } })} label={<span className={`small ${c.done ? '' : 'muted'}`}>{c.item}</span>} />
                          {c.by === 'onboarding_hand' && <Chip kind="ai">Hand</Chip>}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>

          {runHand.data && (
            <Banner kind={runHand.data.task.status === 'done' ? 'ok' : 'warn'}>
              {runHand.data.task.status === 'done'
                ? `Staged: ${((runHand.data.task.output?.staged as string[]) ?? []).join('; ') || 'nothing left to stage'}.`
                : runHand.data.task.error ?? 'The Hand stopped.'}
            </Banner>
          )}

          <div className="row-flex">
            <Button variant="primary" disabled={current.stage !== 'onboarding' || runHand.isPending} onClick={() => runHand.mutate(current.id)}>Run the Onboarding Hand for the next day</Button>
            {current.stage === 'onboarding' && current.checklist.every((c) => c.done) && (
              <Button onClick={() => patch.mutate({ id: current.id, body: { stage: 'live' } })}>Mark live</Button>
            )}
          </div>
          <p className="note">Everything the Hand creates is staged. Clinical rights are provisioned only after HPCSA verification, and a fee schedule is activated by a person.</p>
        </>
      )}
    </div>
  );
}
