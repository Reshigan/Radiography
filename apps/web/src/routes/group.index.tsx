import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, Button, Chip, Skeleton, EmptyState, Bars, Money, Field, Input, Provenance, DataTable } from '@bonakala/bdl';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MetricTiles, DefinitionSheet, type MetricTile, type TilesResponse } from './practice.index';

export const Route = createFileRoute('/group/')({ component: GroupTower });

export interface SiteStatus { siteId: string; site: string; practice: string; practiceId: string; state: 'crit' | 'att' | 'ok'; note: string; studiesToday: number; tatMedianMin: number; gateway: { status: string; backlog: number; upsPct: number } | null }
export interface BenchmarkRow { practiceId: string; label: string; value: number | null; n: number; adjusted: number | null; suppressed?: boolean; reason?: 'no_data' | 'suppressed' | null }
export interface Acquisition {
  id: string; name: string; region: string | null; sites: string[]; modalities: string[] | null; stage: string; owner: string | null;
  indicativeEbitdaCents: number | null; jvSplit: string | null; effectiveDate: string | null; notes: string | null;
  mergerThreshold: { assessed: boolean; category?: string; notifiable?: boolean; note?: string } | null;
  checklist: Array<{ day: number; item: string; done: boolean; at?: string; by?: string }>;
}
export interface InsightAnswer {
  question: string; metricIds: string[];
  primary: { id: string; name: string; formula: string; grain: string; version: number; owner: string; target: string; direction: string; unit: string };
  alternatives: Array<{ id: string; name: string }>;
  filters: Record<string, unknown>;
  value: { value: number | null; source: string; note?: string };
  rows: Array<{ label: string; value: number | null; meets?: boolean }>;
  narrative: string;
  provenance: { modelId: string; modelVersion: string; confidence?: number };
  freshness: string; rowCount: number; suppressed: number;
}

/** Insight Hand question box: answer, definition, filters, freshness (M16-R-105). */
export function AskPanel() {
  const [q, setQ] = useState('Which sites are over 85 % CT utilisation?');
  const ask = useMutation({ mutationFn: (question: string) => api.post<{ answer: InsightAnswer | null; refused: string | null }>('/analytics/ask', { question }) });
  const a = ask.data?.answer;
  return (
    <Card title="Ask the semantic layer" extra={<Chip kind="ai">Insight Hand</Chip>}>
      <form onSubmit={(e) => { e.preventDefault(); ask.mutate(q); }}>
        <Field label="Question"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which referrers dropped more than 30 % this month?" /></Field>
        <Button size="sm" variant="primary" type="submit" disabled={ask.isPending}>{ask.isPending ? 'Answering…' : 'Ask'}</Button>
      </form>
      {ask.data?.refused && <Banner kind="warn">{ask.data.refused}</Banner>}
      {a && (
        <div style={{ marginTop: 10 }}>
          <Provenance prov={{ modelId: a.provenance.modelId, modelVersion: a.provenance.modelVersion, confidence: a.provenance.confidence, outputClass: 4, demo: true }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ font: '600 20px/1.1 var(--display)' }}>{a.value.value === null ? 'not available' : `${a.value.value}${a.primary.unit === 'pct' ? ' %' : ''}`}</span>
              <span className="muted small">{a.primary.name}</span>
            </div>
            <p className="small" style={{ marginTop: 6 }}>{a.narrative}</p>
            {a.rows.length > 0 && (
              <div className="small" style={{ marginTop: 6 }}>
                {a.rows.map((r) => <div key={r.label}>{r.label}: <span className="mono">{r.value ?? '—'}</span>{r.meets === true ? ' · meets the filter' : ''}</div>)}
              </div>
            )}
          </Provenance>
          <div className="note" style={{ marginTop: 8 }}>
            <b>Definition</b> · {a.primary.name} ({a.primary.id} v{a.primary.version}) = {a.primary.formula}. Grain {a.primary.grain}; target {a.primary.target}; owner {a.primary.owner}.
            {' '}Freshness {a.freshness}; {a.rowCount} row{a.rowCount === 1 ? '' : 's'}{a.suppressed ? `; ${a.suppressed} cells suppressed` : ''}.
            {a.alternatives.length > 0 && <> Other metrics considered: {a.alternatives.map((x) => x.name).join(', ')}.</>}
          </div>
        </div>
      )}
      {!a && !ask.data?.refused && <p className="note">Questions are answered from the semantic layer only, under your own row-level permissions. A metric that does not exist is refused, never improvised.</p>}
    </Card>
  );
}

/** Second-modality what-if with editable assumptions. */
export function WhatIfPanel() {
  const [studies, setStudies] = useState(22);
  const [capexM, setCapexM] = useState(28.4);
  const run = useMutation({
    mutationFn: () => api.post<{ outputs: { paybackMonths: number | null; utilisationYear1Pct: number; irrPct: number | null; ebitdaYear2Cents: number; npv5yCents: number; assumptions: string[] }; provenance: { modelId: string; modelVersion: string } }>('/analytics/what-if', { name: 'Second modality', modality: 'MR', studiesPerDayYear1: studies, capexCents: Math.round(capexM * 1_000_000 * 100) }),
  });
  const o = run.data?.outputs;
  return (
    <Card title="What-if · second modality" extra={<Chip kind="ai">Insight Hand</Chip>}>
      <div className="row-flex" style={{ alignItems: 'flex-end' }}>
        <Field label="Studies per day at maturity"><Input type="number" value={studies} min={4} max={40} onChange={(e) => setStudies(Number(e.target.value))} /></Field>
        <Field label="Capex, R million"><Input type="number" step="0.1" value={capexM} onChange={(e) => setCapexM(Number(e.target.value))} /></Field>
        <Button size="sm" variant="primary" disabled={run.isPending} onClick={() => run.mutate()}>Run model</Button>
      </div>
      {o && (
        <Provenance prov={{ modelId: run.data!.provenance.modelId, modelVersion: run.data!.provenance.modelVersion, outputClass: 4, demo: true }}>
          <div className="grid g4">
            <div><span className="small muted">Payback</span><div><b>{o.paybackMonths === null ? 'beyond 5 years' : `${o.paybackMonths} months`}</b></div></div>
            <div><span className="small muted">Utilisation year 1</span><div><b>{o.utilisationYear1Pct} %</b></div></div>
            <div><span className="small muted">IRR</span><div><b>{o.irrPct === null ? '—' : `${o.irrPct} %`}</b></div></div>
            <div><span className="small muted">EBITDA year 2</span><div><b><Money cents={o.ebitdaYear2Cents} /></b></div></div>
          </div>
          <ul className="small" style={{ paddingLeft: 18, marginTop: 8 }}>{o.assumptions.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Provenance>
      )}
      {!o && <p className="note">Scenarios are saved objects with their inputs, assumptions and outputs. Nothing is written back to the ledgers.</p>}
    </Card>
  );
}

export function AcquisitionKanban({ rows, onOpen }: { rows: Acquisition[]; onOpen?: (a: Acquisition) => void }) {
  const stages: Array<[string, string]> = [['target', 'Target'], ['due_diligence', 'Due diligence'], ['onboarding', 'Onboarding'], ['live', 'Live']];
  return (
    <div className="kan">
      {stages.map(([id, label]) => {
        const items = rows.filter((a) => a.stage === id);
        return (
          <div className="col" key={id}>
            <h4>{label}<span className="pill">{items.length}</span></h4>
            {items.map((a) => {
              const done = a.checklist.filter((c) => c.done).length;
              return (
                <div className="k" key={a.id} onClick={() => onOpen?.(a)} style={{ cursor: onOpen ? 'pointer' : undefined }}>
                  <b>{a.name}</b>
                  <span className="muted">{(a.modalities ?? []).join(', ')}{a.indicativeEbitdaCents ? ` · indicative EBITDA ${(a.indicativeEbitdaCents / 100 / 1e6).toFixed(1)} m` : ''}</span>
                  {a.notes && <span className="muted">{a.notes}</span>}
                  {id === 'onboarding' && (
                    <>
                      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 2 }}><div style={{ height: '100%', width: `${(done / a.checklist.length) * 100}%`, background: 'var(--info)', borderRadius: 2 }} /></div>
                      <span className="mono small">{done} of {a.checklist.length} · Onboarding Hand</span>
                    </>
                  )}
                  <div className="row-flex" style={{ gap: 4 }}>
                    {a.owner && <Chip>Owner: {a.owner}</Chip>}
                    {a.mergerThreshold?.notifiable && <Chip kind="att">merger notification</Chip>}
                  </div>
                </div>
              );
            })}
            {!items.length && <span className="muted small">Nothing here.</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ============================== the page ============================== */
function GroupTower() {
  const { me, selectPractice } = useAuth();
  const [define, setDefine] = useState<MetricTile | null>(null);
  const [benchMetric, setBenchMetric] = useState('AST.UP');

  const tiles = useQuery({ queryKey: ['tiles', 'group'], queryFn: () => api.get<TilesResponse>('/analytics/tiles?scope=group'), refetchInterval: 120_000 });
  const slip = useQuery({ queryKey: ['ai-slip'], queryFn: () => api.get<{ slipCount?: number; slips?: number }>('/bci/monitoring').then((r) => r.slipCount ?? r.slips ?? 0).catch(() => 0) });
  const sites = useQuery({ queryKey: ['sites-status'], queryFn: () => api.get<{ sites: SiteStatus[] }>('/analytics/sites-status'), refetchInterval: 60_000 });
  const bench = useQuery({ queryKey: ['benchmark', benchMetric], queryFn: () => api.get<{ metric: { id: string; name: string; unit: string }; rows: BenchmarkRow[]; peerMedian: number | null; identified: boolean; caseMixNote: string; peerGroup: string }>(`/analytics/benchmark?metricId=${benchMetric}`) });
  const funder = useQuery({ queryKey: ['funder-mix'], queryFn: () => api.get<{ mix: Array<{ funderType: string; cents: number; sharePct: number }>; totalCents?: number; source: string | null; note?: string }>('/analytics/revenue-by-funder') });
  const acqs = useQuery({ queryKey: ['acquisitions'], queryFn: () => api.get<{ acquisitions: Acquisition[] }>('/analytics/acquisitions') });

  const critSites = (sites.data?.sites ?? []).filter((s) => s.state === 'crit');
  const metricOptions = [['AST.UP', 'Uptime'], ['OPS.TAT.SLA', 'TAT within SLA'], ['RCM.FPA', 'First-pass acceptance'], ['CMP.INC', 'Open incidents'], ['WFM.SPF', 'Studies per FTE']];

  return (
    <div className="page">
      <PageHeader
        title="Group control tower"
        subtitle={`${me?.practices.length ?? 0} practices · ${sites.data?.sites.length ?? 0} sites · reconciles to the ledger`}
        actions={
          <>
            <select value={me?.practiceId ?? ''} onChange={(e) => void selectPractice(e.target.value || null)} aria-label="Entity" className="btn">
              <option value="">Group (all practices)</option>
              {me?.practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <a className="btn" href="/group/practices">Practices</a>
            <a className="btn primary" href="/group/board-pack">Board pack</a>
          </>
        }
      />

      {critSites.length > 0 && <Banner kind="crit">{critSites.map((s) => `${s.site}: ${s.note}`).join(' · ')}</Banner>}
      {tiles.isError && <Banner kind="crit">Group metrics could not be loaded. Refresh, or call platform support with reference analytics-tiles.</Banner>}

      <MetricTiles
        tiles={[...(tiles.data?.tiles ?? []).filter((t) => t.id !== 'AIO.SLIP'), ...(tiles.data?.tiles ?? []).filter((t) => t.id === 'AIO.SLIP').map((t) => ({ ...t, value: slip.data ?? t.value ?? 0 }))]}
        loading={tiles.isLoading}
        onDefine={setDefine}
      />

      <div className="split">
        <Card
          title={`Benchmark · ${bench.data?.metric.name ?? ''}`}
          extra={
            <select value={benchMetric} onChange={(e) => setBenchMetric(e.target.value)} aria-label="Benchmark metric" className="btn sm">
              {metricOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          }
        >
          {bench.isLoading ? <Skeleton rows={4} /> : !bench.data?.rows.length ? <EmptyState>No practices to compare.</EmptyState> : (
            <>
              <Bars
                data={bench.data.rows.map((r) => ({
                  label: r.label,
                  value: r.value ?? 0,
                  tone: r.value === null ? 'info' : bench.data!.peerMedian !== null && r.value >= bench.data!.peerMedian ? 'ok' : 'warn',
                }))}
                format={(v) => (v === 0 ? '—' : String(v))}
              />
              <div className="small muted" style={{ marginTop: 8 }}>
                Peer median {bench.data.peerMedian ?? '—'} · peer group: {bench.data.peerGroup} · {bench.data.identified ? 'identified under the data-sharing agreement' : 'peers anonymised'}
                {bench.data.rows.some((r) => r.reason === 'suppressed') && ' · cells below the small-cell threshold are suppressed'}
                {bench.data.rows.some((r) => r.reason === 'no_data') && ' · practices with no rows for this metric show no value'}
              </div>
              <p className="note">{bench.data.caseMixNote}</p>
            </>
          )}
        </Card>

        <Card title="Revenue by funder" extra={funder.data?.note}>
          {funder.isLoading ? <Skeleton rows={4} /> : funder.data?.mix.length ? (
            <>
              <Bars data={funder.data.mix.map((m) => ({ label: `${m.funderType} ${m.sharePct} %`, value: Math.round(m.cents / 100) }))} format={(v) => `R ${(v / 1e6).toFixed(2)} m`} />
              {funder.data.totalCents ? <div className="small muted" style={{ marginTop: 8 }}>Total billed <Money cents={funder.data.totalCents} /></div> : null}
            </>
          ) : (
            <EmptyState>{funder.data?.note ?? 'Revenue by funder is not available yet.'}</EmptyState>
          )}
        </Card>
      </div>

      <div className="split">
        <Card title="Sites · status now" extra={sites.data ? `${sites.data.sites.filter((s) => s.state === 'ok').length} open · ${sites.data.sites.filter((s) => s.state !== 'ok').length} alerts` : undefined}>
          {sites.isLoading ? <Skeleton rows={6} /> : !sites.data?.sites.length ? <EmptyState>No sites.</EmptyState> : (
            <DataTable
              rows={sites.data.sites}
              rowKey={(s) => s.siteId}
              columns={[
                { key: 'state', header: '', width: 28, render: (s) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: `var(--${s.state === 'crit' ? 'crit' : s.state === 'att' ? 'warn' : 'ok'})` }} /> },
                { key: 'site', header: 'Site · practice', render: (s) => <><b>{s.site}</b><div className="small muted">{s.practice}</div></> },
                { key: 'note', header: 'Status', render: (s) => <span className="small">{s.note}</span> },
                { key: 'studies', header: 'Studies today', num: true, render: (s) => <span className="mono">{s.studiesToday || '—'}</span> },
                { key: 'tat', header: 'TAT', num: true, render: (s) => <span className="mono">{s.tatMedianMin ? `${Math.floor(s.tatMedianMin / 60)} h ${String(s.tatMedianMin % 60).padStart(2, '0')}` : '—'}</span> },
              ]}
            />
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AskPanel />
          <WhatIfPanel />
        </div>
      </div>

      <Card title="Acquisition pipeline" extra={<a className="link" href="/group/acquisitions">Open pipeline</a>}>
        {acqs.isLoading ? <Skeleton rows={4} /> : !acqs.data?.acquisitions.length ? <EmptyState>No acquisitions in the pipeline.</EmptyState> : <AcquisitionKanban rows={acqs.data.acquisitions} />}
        <p className="note">The Onboarding Hand touches only entities in onboarding status, and everything it creates is staged until a human activates it.</p>
      </Card>

      <DefinitionSheet tile={define} onClose={() => setDefine(null)} />
    </div>
  );
}
