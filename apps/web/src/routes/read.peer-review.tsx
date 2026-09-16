import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, Chip, DataTable, DateTime, EmptyState, Field, PageHeader, Select, Skeleton, StatusChip, TextArea, Bars } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/read/peer-review')({ component: PeerReview });

interface Review { id: string; reportId: string; studyId: string; status: string; score: string | null; category: string | null; notes: string | null; blindedImpression: string | null; sampledAt: string; scoredAt: string | null; reviewerUserId: string; originalRadiologistUserId: string; report: { id: string; accession: string; sections?: { impression: string }; signedAt?: string | null } | null }

const SCORES: Array<[string, string]> = [
  ['1', '1 · Concur'],
  ['2a', '2a · Minor discrepancy, unlikely clinical significance'],
  ['2b', '2b · Minor discrepancy, possible clinical significance'],
  ['3a', '3a · Major discrepancy, unlikely clinical significance'],
  ['3b', '3b · Major discrepancy, likely clinical significance'],
];
const CATEGORIES = ['perception', 'interpretation', 'communication', 'technical', 'followup'];

function PeerReview() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['peer-reviews'], queryFn: () => api.get<{ reviews: Review[]; distribution: Record<string, number> }>('/reporting/peer-reviews') });
  const [open, setOpen] = useState<string | null>(null);
  const [score, setScore] = useState('1');
  const [category, setCategory] = useState('perception');
  const [impression, setImpression] = useState('');
  const [notes, setNotes] = useState('');
  const submit = useMutation({
    mutationFn: (rid: string) => api.post(`/reporting/peer-reviews/${rid}/score`, { score, category: score === '1' ? undefined : category, notes, blindedImpression: impression }),
    onSuccess: () => { setOpen(null); setImpression(''); setNotes(''); void qc.invalidateQueries({ queryKey: ['peer-reviews'] }); },
  });

  return (
    <div className="page">
      <PageHeader title="Peer review" subtitle="Randomised, stratified sampling with a blinded read. The programme is for learning and system improvement, not performance management." />
      {q.isError && <Banner kind="crit">Peer reviews could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (
        <>
          <div className="split">
            <Card title="Score distribution" extra="all reviewers, anonymised">
              {Object.keys(q.data.distribution).length === 0 ? <EmptyState>No reviews have been scored yet.</EmptyState> : (
                <Bars data={SCORES.map(([code]) => ({ label: code, value: q.data!.distribution[code] ?? 0, tone: code.startsWith('3') ? 'crit' : code === '2b' ? 'warn' : 'ok' }))} />
              )}
            </Card>
            <Card title="How the programme works">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>The reviewer reads the study blinded to the original report, records an impression, then sees the original and scores agreement.</li>
                <li>Scores 2b and 3 route to the original radiologist for comment; 3b opens a quality review and considers an addendum.</li>
                <li>Discrepancies are compared with the BCI candidates for the same study and feed AI operations monitoring.</li>
                <li>Patient care is corrected first, the learning second. No league tables.</li>
              </ul>
            </Card>
          </div>

          {q.data.reviews.length === 0 ? (
            <EmptyState>No cases have been sampled for you.</EmptyState>
          ) : (
            <Card title="Sampled cases">
              <DataTable
                rows={q.data.reviews}
                rowKey={(x) => x.id}
                columns={[
                  { key: 'acc', header: 'Accession', render: (x) => <span className="mono">{x.report?.accession ?? '—'}</span> },
                  { key: 'sampled', header: 'Sampled', render: (x) => <DateTime iso={x.sampledAt} time={false} /> },
                  { key: 'status', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                  { key: 'score', header: 'Score', render: (x) => (x.score ? <Chip kind={x.score.startsWith('3') ? 'crit' : x.score === '2b' ? 'att' : 'done'}>{x.score}</Chip> : <span className="muted">—</span>) },
                  { key: 'cat', header: 'Category', render: (x) => x.category ?? <span className="muted">—</span> },
                  { key: 'act', header: '', render: (x) => (x.status === 'pending' ? <Button size="sm" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'Close' : 'Review'}</Button> : <span className="muted small">{x.notes ?? 'scored'}</span>) },
                ]}
              />
            </Card>
          )}

          {open && (
            <Card title="Blinded review">
              <Banner kind="info">The original report stays hidden until you submit your own impression.</Banner>
              <Field label="Your impression (blinded)"><TextArea rows={3} value={impression} onChange={(e) => setImpression(e.target.value)} style={{ width: '100%' }} /></Field>
              <div className="row-flex">
                <Field label="Agreement score"><Select value={score} onChange={(e) => setScore(e.target.value)}>{SCORES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                {score !== '1' && <Field label="Discrepancy category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((cx) => <option key={cx} value={cx}>{cx}</option>)}</Select></Field>}
              </div>
              <Field label="Learning note"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} /></Field>
              <div className="row-flex"><Button variant="primary" onClick={() => submit.mutate(open)} disabled={impression.length < 5 || submit.isPending}>Submit score</Button><Button onClick={() => setOpen(null)}>Cancel</Button></div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
