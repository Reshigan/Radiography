import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Tile, Input, Select, Chip } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/group/automation')({ component: Page });

interface HandFunction {
  handId: string; label: string; module: string | null; mandate: string | null;
  role: 'BKG' | 'FDK' | 'BIL' | 'DEB'; roleLabel: string;
  totalRuns: number; touchlessRuns: number; needsApprovalRuns: number; touchlessPct: number | null;
}
interface RoleRollup {
  role: 'BKG' | 'FDK' | 'BIL' | 'DEB'; roleLabel: string;
  headcount: number; fte: number; monthlyCostCents: number;
  touchlessRuns: number; totalRuns: number; touchlessPct: number | null;
}
interface Report { windowDays: number; functions: HandFunction[]; roles: RoleRollup[]; note: string }

/** Starting assumption per role: touchless transactions one FTE could absorb in a month if that
 *  were their whole job. Editable — this is a judgement call per practice, not a platform fact. */
const DEFAULT_TXN_PER_FTE: Record<RoleRollup['role'], number> = { BKG: 700, FDK: 600, BIL: 900, DEB: 800 };

function Page() {
  const [days, setDays] = useState('30');
  const [txnPerFte, setTxnPerFte] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['back-office-automation', days], queryFn: () => api.get<Report>(`/analytics/back-office-automation?days=${days}`) });

  if (q.isLoading) return <div className="page"><PageHeader title="Back-office automation" /><Skeleton rows={8} /></div>;
  if (q.isError || !q.data) return <div className="page"><PageHeader title="Back-office automation" /><Banner kind="crit">This report could not be loaded.</Banner></div>;

  const d = q.data;
  const assumption = (role: string) => Number(txnPerFte[role] ?? DEFAULT_TXN_PER_FTE[role as RoleRollup['role']]);

  const totalMonthlyCostCents = d.roles.reduce((a, r) => a + r.monthlyCostCents, 0);
  const rows = d.roles.map((r) => {
    const perFte = assumption(r.role);
    const fteFreed = perFte > 0 ? r.touchlessRuns / perFte : 0;
    const costPerFte = r.fte > 0 ? r.monthlyCostCents / r.fte : 0;
    const valueCents = fteFreed * costPerFte;
    return { ...r, perFte, fteFreed, costPerFte, valueCents };
  });
  const totalFteFreed = rows.reduce((a, r) => a + r.fteFreed, 0);
  const totalValueCents = rows.reduce((a, r) => a + r.valueCents, 0);

  return (
    <div className="page">
      <PageHeader
        title="Back-office automation"
        subtitle="What the Hands actually processed touchless, against real headcount and cost — not a projection"
        actions={
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Window">
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        }
      />

      <div className="grid g4">
        <Tile label="Touchless transactions" value={d.functions.reduce((a, f) => a + f.touchlessRuns, 0).toLocaleString('en-ZA')} delta={`of ${d.functions.reduce((a, f) => a + f.totalRuns, 0).toLocaleString('en-ZA')} Hand runs`} />
        <Tile label="Current back-office cost" value={<Money cents={totalMonthlyCostCents} />} delta="per month, 4 roles" />
        <Tile label="Estimated FTE-equivalent freed" value={totalFteFreed.toFixed(1)} delta="at the assumptions below" tone="up" />
        <Tile label="Estimated monthly value" value={<Money cents={Math.round(totalValueCents)} />} delta={`${totalMonthlyCostCents ? Math.round((totalValueCents / totalMonthlyCostCents) * 100) : 0} % of current cost`} tone="up" />
      </div>

      <Card title="By role" extra="headcount and cost are real; FTE-equivalent freed and its value use the assumption you set per role">
        <table className="dt">
          <thead>
            <tr>
              <th>Role</th><th className="num">Headcount</th><th className="num">FTE</th><th className="num">Monthly cost</th>
              <th className="num">Touchless</th><th className="num">Touchless %</th>
              <th>Touchless txns / FTE / month</th><th className="num">FTE-equivalent freed</th><th className="num">Estimated monthly value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.role}>
                <td><b>{r.roleLabel}</b><div className="small muted mono">{r.role}</div></td>
                <td className="num">{r.headcount}</td>
                <td className="num">{r.fte}</td>
                <td className="num"><Money cents={r.monthlyCostCents} /></td>
                <td className="num">{r.touchlessRuns.toLocaleString('en-ZA')} / {r.totalRuns.toLocaleString('en-ZA')}</td>
                <td className="num">{r.touchlessPct ?? '—'} %</td>
                <td style={{ maxWidth: 140 }}>
                  <Input type="number" min={1} value={String(r.perFte)} onChange={(e) => setTxnPerFte({ ...txnPerFte, [r.role]: e.target.value })} aria-label={`Touchless transactions per FTE per month for ${r.roleLabel}`} />
                </td>
                <td className="num">{r.fteFreed.toFixed(2)}</td>
                <td className="num"><Money cents={Math.round(r.valueCents)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note" style={{ marginTop: 8 }}>{d.note}</p>
      </Card>

      <Card title="By Hand" extra={`trailing ${d.windowDays} days`}>
        {!d.functions.length ? <EmptyState>No Hand runs recorded in this window.</EmptyState> : (
          <DataTable
            rows={d.functions}
            rowKey={(f) => f.handId}
            columns={[
              { key: 'hand', header: 'Hand', render: (f) => <><b>{f.label}</b><div className="small muted">{f.module ?? '—'} · feeds {f.roleLabel}</div></> },
              { key: 'mandate', header: 'Mandate', width: 320, render: (f) => <span className="small">{f.mandate && f.mandate.length > 110 ? `${f.mandate.slice(0, 109)}…` : f.mandate ?? '—'}</span> },
              { key: 'total', header: 'Runs', num: true, render: (f) => f.totalRuns.toLocaleString('en-ZA') },
              { key: 'touchless', header: 'Touchless', num: true, render: (f) => f.touchlessRuns.toLocaleString('en-ZA') },
              { key: 'needs', header: 'Needed a human', num: true, render: (f) => f.needsApprovalRuns.toLocaleString('en-ZA') },
              { key: 'pct', header: 'Touchless %', render: (f) => <Chip kind={f.touchlessPct === null ? 'neutral' : f.touchlessPct >= 85 ? 'done' : f.touchlessPct >= 60 ? 'active' : 'att'}>{f.touchlessPct === null ? '—' : `${f.touchlessPct} %`}</Chip> },
            ]}
          />
        )}
        <p className="note" style={{ marginTop: 8 }}>Touchless = the Hand's run finished with no human approval step, per its own leash and approval policy (Admin → Hands and leashes). A run that needed a human is the Hand working correctly, not a failure — every Hand has hard limits it refuses to cross alone.</p>
      </Card>
    </div>
  );
}
