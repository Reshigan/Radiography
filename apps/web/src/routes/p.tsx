import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Mark, ThemeSwitch, useTheme } from '@bonakala/bdl';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/p')({ component: PatientLayout });

const NAV = [
  { id: 'home', label: 'Home', path: '/p' }, { id: 'book', label: 'Book', path: '/p/book' }, { id: 'prepare', label: 'Prepare', path: '/p/prepare' },
  { id: 'pay', label: 'Pay', path: '/p/pay' }, { id: 'results', label: 'Results', path: '/p/results' }, { id: 'profile', label: 'Profile', path: '/p/profile' },
];

function PatientLayout() {
  const { me, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const theme = useTheme('patient');
  useEffect(() => { document.documentElement.setAttribute('data-lens', 'patient'); }, []);
  if (!me?.user) { window.location.href = '/'; return null; }
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="ph-hd" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px 6px' }}>
        <span style={{ color: 'var(--heading)' }}><Mark size={26} /></span>
        <b style={{ fontFamily: 'var(--display)', color: 'var(--heading)' }}>Bonakala Imaging</b>
        <span className="spacer" style={{ flex: 1 }} />
        {me.demo && <span className="chip small"><i />DEMO</span>}
        <ThemeSwitch theme={theme} compact />
        <button className="link" onClick={() => void signOut()}>Sign out</button>
      </header>
      <main style={{ padding: '0 20px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        <Outlet />
      </main>
      <nav className="nav" style={{ display: 'flex', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', position: 'sticky', bottom: 0 }} aria-label="Patient navigation">
        {NAV.map((n) => (
          <a key={n.id} href={n.path} className={(n.path === '/p' ? pathname === '/p' : pathname.startsWith(n.path)) ? 'on' : ''} style={{ flex: 1, textAlign: 'center', padding: '10px 0 12px', fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }} onClick={(e) => { e.preventDefault(); void navigate({ to: n.path as any }); }}>
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
