import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.5 14.8A8.5 8.5 0 119.2 3.5a7 7 0 0011.3 11.3z" /></svg>,
  logout: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>,
};

const THEME_KEY = 'bdl.theme';
type ThemeOverride = 'light' | 'dark' | '';
type ResolvedTheme = 'light' | 'dark';

/** Dark/light is a per-viewer preference, decoupled from the persona lens (which drives density and
 *  the palette's *default*, e.g. the clinical reading room defaults dark). An explicit choice here
 *  persists (localStorage) and wins over every lens until reset. Survives a missing/blocked storage
 *  API by falling back to in-memory state only (private browsing, storage quota, disabled cookies). */
export function useTheme(lens: Lens) {
  const [override, setOverride] = useState<ThemeOverride>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : '';
    } catch { return ''; }
  });
  const lensDefault: ResolvedTheme = lens === 'clinical' ? 'dark' : 'light';
  const resolved: ResolvedTheme = override || lensDefault;
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);
  function setTheme(v: ThemeOverride) {
    setOverride(v);
    try { if (v) localStorage.setItem(THEME_KEY, v); else localStorage.removeItem(THEME_KEY); } catch { /* ignore: storage unavailable, preference just won't persist */ }
  }
  return { resolved, override, lensDefault, setTheme, toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark'), reset: () => setTheme('') };
}
export type ThemeState = ReturnType<typeof useTheme>;

export function ThemeSwitch({ theme, compact }: { theme: ThemeState; compact?: boolean }) {
  return (
    <div className="theme-switch" role="group" aria-label="Appearance">
      <button type="button" title="Light" aria-label="Light" aria-pressed={theme.resolved === 'light'} className={theme.resolved === 'light' ? 'on' : ''} onClick={() => theme.setTheme('light')}>{Icon.sun}{!compact && ' Light'}</button>
      <button type="button" title="Dark" aria-label="Dark" aria-pressed={theme.resolved === 'dark'} className={theme.resolved === 'dark' ? 'on' : ''} onClick={() => theme.setTheme('dark')}>{Icon.moon}{!compact && ' Dark'}</button>
    </div>
  );
}

/** Rendered via portal, deliberately: the rail and cards carry `backdrop-filter` for the glass
 *  look, and `backdrop-filter` creates a new stacking context — any z-index inside it is trapped
 *  there and can never paint above unrelated siblings like the main content column. Escaping to
 *  document.body with fixed positioning computed from the trigger's rect is the only reliable fix. */
function ProfileMenu({ name, initials, role, email, theme, onSignOut }: { name: string; initials: string; role?: string; email?: string; theme: ThemeState; onSignOut?: () => void }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ bottom: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ bottom: window.innerHeight - r.bottom, left: r.right + 8 });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return; // the button's own onClick owns the toggle
      if (menuRef.current && !menuRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onViewportChange = () => setOpen(false); // resize/reflow invalidates the computed anchor; closing beats a misplaced popover
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" className="avatar" title={`${name} · account`} aria-haspopup="menu" aria-expanded={open} onClick={() => (open ? setOpen(false) : openMenu())}>{initials}</button>
      {open && coords && createPortal(
        <div ref={menuRef} className="profile-menu" role="menu" style={{ bottom: coords.bottom, left: coords.left }}>
          <div className="profile-menu-hd">
            <b>{name}</b>
            {role && <span className="muted small">{role}</span>}
            {email && <span className="muted small">{email}</span>}
          </div>
          <div className="profile-menu-section">
            <span className="small muted">Appearance</span>
            <ThemeSwitch theme={theme} />
            {theme.override && <button type="button" className="link small" onClick={theme.reset}>Use this role's default ({theme.lensDefault})</button>}
          </div>
          <button type="button" className="profile-menu-signout" role="menuitem" onClick={() => { setOpen(false); onSignOut?.(); }}>{Icon.logout} Sign out</button>
        </div>,
        document.body,
      )}
    </>
  );
}

export interface FrameProps {
  lens: Lens;
  rail: RailItem[];
  context: ReactNode; // breadcrumb
  userInitials: string;
  userName: string;
  userRole?: string;
  userEmail?: string;
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
  const theme = useTheme(p.lens);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-lens', p.lens);
    if (level) root.setAttribute('data-level', level); else root.removeAttribute('data-level');
    try { if (level) localStorage.setItem('bdl.level', level); else localStorage.removeItem('bdl.level'); } catch { /* ignore */ }
  }, [p.lens, level]);
  return (
    <div className={`app ${p.inspector ? 'with-inspector' : ''}`}>
      <nav className="rail" aria-label="Modules">
        <div className="rail-glass" aria-hidden="true" />
        <span className="mark" style={{ color: 'var(--heading)' }}><Mark size={28} /></span>
        {p.rail.map((it) => (
          <a key={it.id} className={`item ${it.active ? 'active' : ''}`} href={it.href} title={it.label} onClick={(e) => { e.preventDefault(); p.navigate(it.href); }}>
            {it.icon}
            <span className="tip">{it.label}</span>
          </a>
        ))}
        <span className="spacer" />
        <ProfileMenu name={p.userName} initials={p.userInitials} role={p.userRole} email={p.userEmail} theme={theme} onSignOut={p.onSignOut} />
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

/** Portaled to document.body: a caller rendering `<Sheet>` inside a glass `.card` (or any other
 *  backdrop-filter surface) would otherwise get a modal clipped to that ancestor's box instead of
 *  covering the viewport — backdrop-filter establishes a containing block for fixed descendants,
 *  same trap as ProfileMenu's, so every full-screen overlay in this file portals past it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="spread"><h3>{title}</h3><button className="link" onClick={onClose} aria-label="Close">Close</button></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
