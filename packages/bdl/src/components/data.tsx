import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  num?: boolean;
  width?: number | string;
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, selectedKey, empty }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; selectedKey?: string; empty?: ReactNode }) {
  if (!rows.length) return <div className="empty">{empty ?? 'Nothing here yet.'}</div>;
  return (
    <table className="dt">
      <thead>
        <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''} style={{ width: c.width }}>{c.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const k = rowKey(r);
          return (
            <tr key={k} className={`${onRowClick ? 'clickable' : ''} ${selectedKey === k ? 'sel' : ''}`} onClick={() => onRowClick?.(r)}>
              {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Queue<T>({ rows, rowKey, render, selectedKey, onSelect }: { rows: T[]; rowKey: (r: T) => string; render: (r: T) => { lead: ReactNode; title: ReactNode; sub: ReactNode; aux?: ReactNode }; selectedKey?: string; onSelect?: (r: T) => void }) {
  if (!rows.length) return <div className="empty">Queue is empty.</div>;
  return (
    <div className="queue">
      {rows.map((r) => {
        const k = rowKey(r);
        const v = render(r);
        return (
          <div key={k} className={`row wrap ${selectedKey === k ? 'sel' : ''}`} onClick={() => onSelect?.(r)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
            <span>{v.lead}</span>
            <div><div className="t">{v.title}</div><div className="s">{v.sub}</div></div>
            {v.aux && <div className="aux">{v.aux}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** Tiny inline bar chart with direct labels (no legend); values in display order. */
export function Bars({ data, max, format }: { data: Array<{ label: string; value: number; tone?: 'crit' | 'warn' | 'ok' | 'info' }>; max?: number; format?: (v: number) => string }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  const color = (t?: string) => (t === 'crit' ? 'var(--crit)' : t === 'warn' ? 'var(--warn)' : t === 'info' ? 'var(--info)' : 'var(--ok)');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '4px 10px', alignItems: 'center', fontSize: 12 }}>
      {data.map((d) => (
        <BarRow key={d.label} label={d.label} pct={(d.value / m) * 100} color={color(d.tone)} text={format ? format(d.value) : String(d.value)} />
      ))}
    </div>
  );
}
function BarRow({ label, pct, color, text }: { label: string; pct: number; color: string; text: string }) {
  return (
    <>
      <span className="muted">{label}</span>
      <span style={{ height: 10, background: 'var(--surface-3)', borderRadius: 2 }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} /></span>
      <span className="mono">{text}</span>
    </>
  );
}

export function Sparkline({ values, width = 120, height = 28, tone }: { values: number[]; width?: number; height?: number; tone?: 'ok' | 'crit' | 'info' }) {
  if (!values.length) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1 || 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`).join(' ');
  const stroke = tone === 'crit' ? 'var(--crit)' : tone === 'info' ? 'var(--info)' : 'var(--ok)';
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
