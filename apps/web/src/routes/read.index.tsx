import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, EmptyState, PageHeader, Queue, Skeleton, SlaBar, Tile, KV, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/read/')({ component: Worklist });

interface Item {
  id: string; accession: string; studyId: string; priority: string; subspecialty: string | null; status: string;
  aiPriority: string | null; aiReasons: string[]; aiProvenance: Array<{ modelId: string; modelVersion: string; priority: string | null; confidence: number }>;
  ageMinutes: number; slaMinutes: number; slaPct: number; priorsReady: boolean; locked: boolean; lockedByMe: boolean; claimedBy: string | null; effectiveRank: number; raisedByAi: boolean;
  study: { modality: string; procedureDescription: string; bodyPart: string; siteId: string; completedAt: string | null; receivedAt: string } | null;
  patient: { firstName: string; lastName: string; sex: string | null; dateOfBirth: string | null } | null;
  practiceName: string | null; fromHub: boolean;
}

const SUBSPECIALTIES = ['', 'chest', 'neuro', 'msk', 'body', 'breast', 'obstetric'];

export function age(dob: string | null | undefined): string {
  if (!dob) return '—';
  return String(Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400_000)));
}
export function ageLabel(p: Item['patient']): string {
  if (!p) return 'Unknown patient';
  return `${p.lastName}, ${p.firstName[0]} · ${age(p.dateOfBirth)} ${p.sex ?? ''}`.trim();
}
export function relative(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}

function priorityChip(p: string) {
  return p === 'stat' ? <Chip kind="crit">STAT</Chip> : p === 'urgent' ? <Chip kind="att">Urgent</Chip> : <Chip>Routine</Chip>;
}

function Worklist() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'pool' | 'mine' | 'all' | 'hub'>('all');
  const [sub, setSub] = useState('');
  const q = useQuery({
    queryKey: ['read-worklist', scope, sub],
    queryFn: () => api.get<{ items: Item[]; counts: { stat: number; p1: number; raisedByAi: number; breached: number; total: number } }>(`/reporting/worklist?scope=${scope}${sub ? `&subspecialty=${sub}` : ''}&limit=80`),
    refetchInterval: 30_000,
  });
  const claim = useMutation({
    mutationFn: (id: string) => api.post(`/reporting/reports/${id}/claim`),
    onSuccess: (_d, id) => { void qc.invalidateQueries({ queryKey: ['read-worklist'] }); void navigate({ to: '/read/study/$id', params: { id } }); },
  });

  return (
    <div className="page">
      <PageHeader
        title="Reading worklist"
        subtitle="Priority first, then the AI triage class, then age. AI raises a study's position; it never lowers it and it never writes the report."
        actions={
          <>
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Scope" style={{ height: 32 }}>
              <option value="all">Pool and mine</option>
              <option value="pool">Pool (unclaimed)</option>
              <option value="mine">Assigned to me</option>
              <option value="hub">Reading hub (network-wide)</option>
            </select>
            <select value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Sub-specialty" style={{ height: 32 }}>
              {SUBSPECIALTIES.map((x) => <option key={x} value={x}>{x ? `Sub: ${x}` : 'All sub-specialties'}</option>)}
            </select>
          </>
        }
      />
      {q.isError && <Banner kind="crit">The worklist could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={6} />}
      {q.data && (
        <>
          {q.data.counts.stat > 0 && <Banner kind="crit">{q.data.counts.stat} STAT {q.data.counts.stat === 1 ? 'study is' : 'studies are'} waiting. Reading start target is 5 minutes.</Banner>}
          <div className="grid g4">
            <Tile label="Unreported" value={q.data.counts.total} />
            <Tile label="STAT" value={q.data.counts.stat} />
            <Tile label="AI priority P1" value={q.data.counts.p1} delta={`${q.data.counts.raisedByAi} raised by triage`} />
            <Tile label="SLA breached" value={q.data.counts.breached} tone={q.data.counts.breached ? 'down' : undefined} />
          </div>
          {q.data.items.length === 0 ? (
            <EmptyState>Nothing is waiting to be reported in this view.</EmptyState>
          ) : (
            <Queue
              rows={q.data.items}
              rowKey={(x) => x.id}
              onSelect={(x) => void navigate({ to: '/read/study/$id', params: { id: x.id } })}
              render={(x) => ({
                lead: x.aiPriority === 'P1' || x.priority === 'stat' ? <Chip kind="crit">{x.priority === 'stat' ? 'STAT' : 'P1'}</Chip> : x.aiPriority === 'P2' ? <Chip kind="att">P2</Chip> : x.aiPriority === 'P4' ? <Chip kind="att">P4</Chip> : x.aiPriority ? <Chip>{x.aiPriority}</Chip> : <Chip title="No AI result for this study">no AI</Chip>,
                title: <>{ageLabel(x.patient)} <span className="muted small mono">· {x.accession}</span></>,
                sub: <>{x.study?.procedureDescription ?? ''} · {x.study?.modality} · {x.subspecialty} {x.priorsReady && <span className="muted">· priors ready</span>} {x.fromHub && x.practiceName && <span className="muted">· {x.practiceName}</span>}</>,
                aux: (
                  <>
                    {x.aiReasons.length > 0 && (
                      <span className="chip ai" title={x.aiProvenance.map((p) => `${p.modelId} ${p.modelVersion}`).join(', ')}>
                        <i />{x.aiReasons.map((rr) => rr.replace(/_/g, ' ')).join(', ')}
                        {x.aiProvenance[0] ? ` · ${x.aiProvenance[0].confidence.toFixed(2)}` : ''}
                      </span>
                    )}
                    {priorityChip(x.priority)}
                    {x.fromHub && <Chip kind="att">hub</Chip>}
                    {x.raisedByAi && <Chip kind="ai">raised by triage</Chip>}
                    <span className="mono small">{relative(x.ageMinutes)}</span>
                    <span style={{ width: 64, display: 'inline-block' }}><SlaBar pct={x.slaPct} /></span>
                    {x.locked ? <Chip kind={x.lockedByMe ? 'active' : 'neutral'}>{x.lockedByMe ? 'Mine' : 'Locked'}</Chip> : <Button size="sm" onClick={(e) => { e.stopPropagation(); claim.mutate(x.id); }}>Claim</Button>}
                  </>
                ),
              })}
            />
          )}
          <Card title="How this queue is ordered">
            <KV items={[
              ['Order', 'Ordered priority (STAT, urgent, routine) first, then the BCI triage class within that band, then the age of the study.'],
              ['AI role', 'Triage models raise a study’s position and show their model id, version and confidence. They never write report text: findings candidates are accepted, edited or rejected by the radiologist in the study view.'],
              ['SLA', 'STAT 30 minutes, urgent 2 hours, routine 24 working hours from study completion. The bar turns amber at 80 % and red at 100 %.'],
              ['Locks', 'Claiming locks a study to you for 30 minutes; an unopened lock returns the study to the pool.'],
            ]} />
          </Card>
          <div className="muted small">
            Last refreshed <DateTime iso={new Date().toISOString()} date={false} />. The queue refreshes every 30 seconds.
          </div>
        </>
      )}
    </div>
  );
}
