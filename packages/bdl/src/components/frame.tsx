import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Lens } from '@bonakala/domain';

export interface RailItem {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
  active?: boolean;
}

export const Mark = ({ size = 28, dark }: { size?: number; dark?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
    <path fill={dark ? '#F5F1E9' : 'currentColor'} fillRule="evenodd" d="M 430.0 202.8 A 182 182 0 1 1 309.2 82.0 L 313.9 98.6 A 150 150 0 1 0 413.4 198.1 Z" />
    <circle cx="322" cy="190" r="30" fill="#12B5A5" />
  </svg>
);

/** Simple 24px icon set (original, 1.5px strokes). */
export const Icon = {
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  people: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 12l4 4L19 6" /></svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>,
  card: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg>,
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" /></svg>,
  alert: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l10 18H2z M12 10v4M12 17v1" /></svg>,
  doc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3h8l4 4v14H6z M14 3v4h4M9 12h6M9 16h6" /></svg>,
  image: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 8" /></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>,
  grid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></svg>,
  gauge: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 16a8 8 0 0116 0" /><path d="M12 16l4-5" /></svg>,
  flask: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" /></svg>,
  sparkle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2"><rect x="4" y="4" width="16" height="16" /></svg>,
  inbox: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 13l2-8h14l2 8v6H3z M3 13h5l2 3h4l2-3h5" /></svg>,
  money: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" /></svg>,
  wrench: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 4a5 5 0 016 6l-9 9-3-3 9-9M4 20l5-5" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 19c0-2 2-4 5-4" /></svg>,
};

export interface FrameProps {
  lens: Lens;
  rail: RailItem[];
  context: ReactNode; // breadcrumb
  userInitials: string;
  userName: string;
  right?: ReactNode;
  inspector?: ReactNode;
  statusLine?: ReactNode;
  onSearch?: (q: string) => void;
  onSignOut?: () => void;
  children: ReactNode;
  navigate: (href: string) => void;
}

const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;

export function AppFrame(p: FrameProps) {
  const [level, setLevel] = useState<string>(() => {
    try { return localStorage.getItem('bdl.level') ?? ''; } catch { return ''; }
  });
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-lens', p.lens);
    if (level) root.setAttribute('data-level', level); else root.removeAttribute('data-level');
    try { if (level) localStorage.setItem('bdl.level', level); else localStorage.removeItem('bdl.level'); } catch { /* ignore */ }
  }, [p.lens, level]);
  return (
    <div className={`app ${p.inspector ? 'with-inspector' : ''}`}>
      <nav className="rail" aria-label="Modules">
        <span className="mark" style={{ color: 'var(--heading)' }}><Mark size={28} /></span>
        {p.rail.map((it) => (
          <a key={it.id} className={`item ${it.active ? 'active' : ''}`} href={it.href} title={it.label} onClick={(e) => { e.preventDefault(); p.navigate(it.href); }}>
            {it.icon}
            <span className="tip">{it.label}</span>
          </a>
        ))}
        <span className="spacer" />
        <a className="item" href="#" title="Sign out" onClick={(e) => { e.preventDefault(); p.onSignOut?.(); }}>{Icon.settings}<span className="tip">Sign out</span></a>
        <span className="avatar" title={p.userName}>{p.userInitials}</span>
      </nav>
      <header className="topbar">
        <div className="ctx">{p.context}</div>
        <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); const q = (new FormData(e.currentTarget).get('q') as string) ?? ''; p.onSearch?.(q); }}>
          <input name="q" placeholder="Search patients, studies, claims…" style={{ background: 'transparent', border: 0, color: 'var(--text)', flex: 1, font: 'inherit', outline: 'none' }} />
          <kbd>⌘K</kbd>
        </form>
        <div className="right">
          {p.right}
          <label className="wl" title="Window / Level: interface density">
            Level
            <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Interface density" style={{ background: 'transparent', color: 'var(--text)', border: 0, font: 'inherit', fontSize: 12 }}>
              <option value="">Lens default</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
      </header>
      <main className={`content ${p.statusLine ? 'with-status' : ''}`}>{p.children}</main>
      {p.inspector && <aside className="inspector">{p.inspector}</aside>}
      {p.statusLine && <div className="status-line">{p.statusLine}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ph">
      <div className="title">
        <h1>{title}</h1>
        {subtitle && <span className="muted">{subtitle}</span>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="spread"><h3>{title}</h3><button className="link" onClick={onClose} aria-label="Close">Close</button></div>
        {children}
      </div>
    </div>
  );
}
