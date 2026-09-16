import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Bars, Card, Chip, DataTable, EmptyState, PageHeader, Skeleton, Sparkline, Tile } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/bci/monitoring')({ component: Monitoring });

interface Data {
  days: number; coveragePct: number; analysed: number; eligible: number; noModelApplies: number; agreement: number | null; overrideRatePct: number;
  decisions: { accepted: number; rejected: number; edited: number; decided: number };
  latencyP50: number; latencyP95: number;
  models: Array<{ modelId: string; name: string; n: number; latencyP50: number; latencyP95: number; positiveRatePct: number; modes: Record<string, number> }>;
  sites: Array<{ siteId: string; n: number; positiveRatePct: number; deltaVsGroupPct: number }>;
  daily: Array<{ date: string; n: number; positiveRate: number; latencyP95: number }>;
  slipCount: number; aiIncidents: number;
}

function Monitoring() {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ['bci-monitoring', days], queryFn: () => api.get<Data>(`/bci/monitoring?days=${days}`) });
  return (
    <div className="page">
      <PageHeader
        title="Monitoring"
        subtitle="Coverage, latency, agreement with signed reports, override rate and per-site positive rates. A site that diverges raises a drift alarm."
        actions={<select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window" style={{ height: 32 }}>{[7, 14, 30, 90].map((dv) => <option key={dv} value={dv}>Last {dv} days</option>)}</select>}
      />
      {q.isError && <Banner kind="crit">Monitoring could not be loaded. {(q.error as Error).message}</Banner>}
      {q.isLoading && <Skeleton rows={5} />}
      {q.data && (q.data.models.length === 0 ? <EmptyState>No inference results in this window.</EmptyState> : (
        <>
          {q.data.coveragePct < 95 && <Banner kind="warn">Coverage is {q.data.coveragePct} %, below the 95 % floor. Check the inference queue and the gateway links.</Banner>}
          <div className="grid g4">
            <Tile label="AI slips · class 1 and 2" value={q.data.slipCount} delta={q.data.slipCount ? 'content reached a record without its gate' : `none · ${q.data.aiIncidents} AI incident${q.data.aiIncidents === 1 ? '' : 's'} open for performance`} tone={q.data.slipCount ? 'down' : 'up'} />
            <Tile label="Coverage" value={`${q.data.coveragePct} %`} delta={`${q.data.analysed} of ${q.data.eligible} eligible · ${q.data.noModelApplies} with no model · floor 95 %`} />
            <Tile label="Latency P95" value={`${(q.data.latencyP95 / 1000).toFixed(1)} s`} delta={`P50 ${(q.data.latencyP50 / 1000).toFixed(1)} s`} />
            <Tile label="Agreement" value={q.data.agreement === null ? '—' : q.data.agreement.toFixed(2)} delta={`override rate ${q.data.overrideRatePct} %`} />
          </div>
          <div className="split">
            <Card title="Positive rate, daily" extra="all activated models">
              <Sparkline values={q.data.daily.map((dv) => dv.positiveRate)} width={320} height={40} />
              <div className="muted small">{q.data.daily[0]?.date} to {q.data.daily[q.data.daily.length - 1]?.date}</div>
            </Card>
            <Card title="Latency P95, daily" extra="milliseconds">
              <Sparkline values={q.data.daily.map((dv) => dv.latencyP95)} width={320} height={40} tone="info" />
              <div className="muted small">Time budget: QC 5 s at the edge, triage 180 s, findings 600 s.</div>
            </Card>
          </div>
          <Card title="Per model">
            <DataTable
              rows={q.data.models}
              rowKey={(x) => x.modelId}
              columns={[
                { key: 'm', header: 'Model', render: (x) => <span className="mono">{x.name}</span> },
                { key: 'n', header: 'Results', num: true, render: (x) => x.n },
                { key: 'p50', header: 'P50', num: true, render: (x) => <span className="mono">{(x.latencyP50 / 1000).toFixed(1)} s</span> },
                { key: 'p95', header: 'P95', num: true, render: (x) => <span className="mono">{(x.latencyP95 / 1000).toFixed(1)} s</span> },
                { key: 'pos', header: 'Positive rate', num: true, render: (x) => <span className="mono">{x.positiveRatePct} %</span> },
                { key: 'mode', header: 'Modes', render: (x) => <span className="row-flex">{Object.entries(x.modes).map(([k, v]) => <Chip key={k} kind={k === 'shadow' ? 'neutral' : 'done'}>{k} {v}</Chip>)}</span> },
              ]}
            />
          </Card>
          <div className="split">
            <Card title="Positive rate by site" extra="against the group mean">
              <Bars data={q.data.sites.map((sx) => ({ label: sx.siteId.replace('site_', '').toUpperCase(), value: sx.positiveRatePct, tone: Math.abs(sx.deltaVsGroupPct) > 5 ? 'warn' : 'ok' }))} format={(v) => `${v} %`} />
            </Card>
            <Card title="Candidate decisions" extra="feeds agreement and override monitoring">
              <Bars
                data={[
                  { label: 'accepted', value: q.data.decisions.accepted - q.data.decisions.edited, tone: 'ok' },
                  { label: 'edited', value: q.data.decisions.edited, tone: 'info' },
                  { label: 'rejected', value: q.data.decisions.rejected, tone: 'warn' },
                ]}
              />
              <div className="note">Agreement is accepted (including edited) divided by all decided candidates on signed reports. Rejected candidates never reach the report.</div>
            </Card>
          </div>
        </>
      ))}
    </div>
  );
}
