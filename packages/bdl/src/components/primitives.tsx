import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { formatZAR, formatSast } from '@bonakala/domain';
import type { Provenance as ProvenanceT } from '@bonakala/domain';

export type StatusKind = 'neutral' | 'active' | 'done' | 'att' | 'crit' | 'ai';
const kindClass: Record<StatusKind, string> = { neutral: '', active: 'active', done: 'done', att: 'att', crit: 'crit', ai: 'ai' };

export function Chip({ kind = 'neutral', children, title }: { kind?: StatusKind; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${kindClass[kind]}`} title={title}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** Map common lifecycle words to chip kinds so every module renders states the same way. */
export function statusKind(status: string | null | undefined): StatusKind {
  const s = (status ?? '').toLowerCase();
  if (/(stat|critical|rejected|expired|overdue|down|error|fail|breach|slip)/.test(s)) return 'crit';
  if (/(auth|pending|attention|hold|warn|needs|await|exception|incomplete|unmatched|suspect|due)/.test(s)) return 'att';
  if (/(signed|paid|done|complete|closed|acknowledged|verified|active|resolved|accepted|granted|released|delivered|approved)/.test(s)) return 'done';
  if (/(arrived|in_room|in room|reading|submitted|in_progress|in progress|running|scheduled|booked|open|claimed|drafting|scanned|available)/.test(s)) return 'active';
  return 'neutral';
}
export function StatusChip({ status }: { status: string | null | undefined }) {
  return <Chip kind={statusKind(status)}>{(status ?? '').replace(/_/g, ' ')}</Chip>;
}

export function Pill({ kind, children }: { kind?: 'crit' | 'warn' | 'ok' | 'info'; children: ReactNode }) {
  return <span className={`pill ${kind ?? ''}`}>{children}</span>;
}

export function Button({ variant, size, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost'; size?: 'sm' | 'lg' }) {
  return (
    <button type="button" {...rest} className={`btn ${variant ?? ''} ${size ?? ''} ${rest.className ?? ''}`}>
      {children}
    </button>
  );
}

export function Money({ cents, sign }: { cents: number; sign?: boolean }) {
  return <span className={`money ${cents < 0 ? 'neg' : ''}`}>{formatZAR(cents, { sign })}</span>;
}
export function DateTime({ iso, date = true, time = true }: { iso: string | null | undefined; date?: boolean; time?: boolean }) {
  if (!iso) return <span className="muted">—</span>;
  return <time dateTime={iso} className="mono">{formatSast(iso, { date, time })}</time>;
}

/** AI-derived content: dashed border, mono provenance line, explicit acceptance actions (docs/06 §5.4). */
export function Provenance({ prov, children, onAccept, onEdit, onReject, accepted }: { prov: Partial<ProvenanceT> & { modelId: string; modelVersion: string }; children: ReactNode; onAccept?: () => void; onEdit?: () => void; onReject?: () => void; accepted?: boolean }) {
  return (
    <div className={accepted ? 'card' : 'ai'} data-ai="true">
      <div className="prov">
        <span>model <b>{prov.modelId}</b></span>
        <span>version <b>{prov.modelVersion}</b></span>
        {prov.confidence !== undefined && <span>confidence <b>{prov.confidence.toFixed(2)}</b></span>}
        {prov.outputClass !== undefined && <span>class <b>{prov.outputClass}</b></span>}
        {prov.demo && <span>DEMO</span>}
        {accepted && <span>accepted</span>}
      </div>
      <div>{children}</div>
      {!accepted && (onAccept || onEdit || onReject) && (
        <div className="acts">
          {onAccept && <Button size="sm" variant="primary" onClick={onAccept}>Accept</Button>}
          {onEdit && <Button size="sm" onClick={onEdit}>Edit</Button>}
          {onReject && <Button size="sm" onClick={onReject}>Reject</Button>}
        </div>
      )}
    </div>
  );
}

export function Tile({ label, value, delta, tone }: { label: string; value: ReactNode; delta?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className="tile">
      <span className="l">{label}</span>
      <span className="v">{value}</span>
      {delta && <span className={`d ${tone ?? ''}`}>{delta}</span>}
    </div>
  );
}

export function Banner({ kind, children, action }: { kind?: 'crit' | 'warn' | 'info' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner ${kind ?? ''}`} role={kind === 'crit' ? 'alert' : 'status'}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Card({ title, extra, children, className }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || extra) && (
        <div className="hd">
          {title && <h4>{title}</h4>}
          {extra && <span className="more">{extra}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div>{children}</div>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}
export function KV({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <FragmentRow key={k} k={k} v={v} />
      ))}
    </div>
  );
}
function FragmentRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <span>{k}</span>
      <div>{v}</div>
    </>
  );
}
export function Timeline({ items }: { items: Array<{ time: string; text: ReactNode; kind?: 'ok' | 'crit' | 'ai' | 'neutral' }> }) {
  return (
    <ul className="tl">
      {items.map((it, i) => (
        <li key={i}>
          <span className="tm">{it.time}</span>
          <span className={`dot ${it.kind ?? ''}`} />
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}
export function SlaBar({ pct }: { pct: number }) {
  const cls = pct >= 100 ? 'crit' : pct >= 80 ? 'warn' : '';
  return (
    <span className={`sla ${cls}`} aria-label={`SLA ${Math.round(pct)}%`}>
      <i style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  );
}
export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: string }>; active: string; onChange: (id: string) => void }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <a key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? 'on' : ''} onClick={() => onChange(t.id)} href={`#${t.id}`}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
