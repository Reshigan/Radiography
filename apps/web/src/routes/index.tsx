import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mark, Button, Icon, ThemeSwitch, useTheme } from '@bonakala/bdl';
import { PERSONA_LABEL, PERSONA_LENS, PERSONA_HOME, type Persona, type Lens } from '@bonakala/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/')({ component: SignIn });

/** One icon and one line of "what you'll see" per persona, so a presenter can pick the right
 *  account without guessing. Kept here (not in @bonakala/bdl) because the copy is demo-specific. */
const PERSONA_ICON: Record<Persona, keyof typeof Icon> = {
  PAT: 'home', REF: 'doc', FDK: 'calendar', BKG: 'inbox', RAD: 'gauge', RGT: 'image', NUR: 'flask',
  BIL: 'card', DEB: 'money', PRM: 'grid', EXE: 'chart', SHR: 'money', CMP: 'shield', BIO: 'wrench',
  AIO: 'sparkle', SUP: 'settings', PAY: 'card',
};
const PERSONA_HINT: Record<Persona, string> = {
  PAT: 'Book, prepare, pay and see results', REF: 'Refer, track patients, urgent line',
  FDK: 'Check-in, registration, Collect card', BKG: 'Omnichannel booking inbox and calendar',
  RAD: 'Room worklist, protocols, dose', RGT: 'Reading worklist, reports, sign-off',
  NUR: 'Contrast administration, reactions', BIL: 'Claims exceptions, coding, remittances',
  DEB: 'Ageing, collections runs, disputes', PRM: 'Site control tower, staff, equipment',
  EXE: 'Group financials, benchmarking', SHR: 'My practice P&L, distributions, votes',
  CMP: 'Regulatory board, incidents, audits', BIO: 'Equipment fleet, integrations, access',
  AIO: 'AI model registry, monitoring, drift', SUP: 'Tenant health, onboarding, admin',
  PAY: 'Funder claims portal',
};
const LENS_GROUP: Record<Lens, string> = {
  patient: 'Patient', referrer: 'Referrer', clinical: 'Clinical', business: 'Practice and Group', governance: 'Governance and platform',
};
const LENS_ORDER: Lens[] = ['patient', 'referrer', 'clinical', 'business', 'governance'];

interface DemoAccount { email: string; persona: Persona; name: string }

function SignIn() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('bonakala-demo');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const demo = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api.get<{ password: string; accounts: DemoAccount[] }>('/auth/demo-accounts').catch(() => null) });
  const theme = useTheme('governance');

  useEffect(() => {
    document.documentElement.setAttribute('data-lens', 'governance');
    if (me?.user) void navigate({ to: PERSONA_HOME[me.user.persona] as any });
  }, [me, navigate]);

  async function submit(e?: React.FormEvent, em = email, pw = password) {
    e?.preventDefault();
    setBusy(em);
    setError(null);
    try {
      const r = await api.post<{ home: string }>('/auth/login', { email: em, password: pw });
      await refresh();
      void navigate({ to: r.home as any });
    } catch (err) {
      setError((err as Error).message === 'Request failed (401)' ? 'Email or password is not right.' : (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const grouped = LENS_ORDER.map((lens) => ({
    lens,
    label: LENS_GROUP[lens],
    accounts: (demo.data?.accounts ?? []).filter((a) => PERSONA_LENS[a.persona] === lens),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="signin-wide">
      <div className="signin-hero dev">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <div className="brand" style={{ color: 'var(--heading)' }}><Mark size={32} /> bonakala</div>
          <ThemeSwitch theme={theme} compact />
        </div>
        <p className="muted" style={{ maxWidth: 320 }}>Everything, made visible. Sign in to the Bonakala Platform.</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <label className="field"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required /></label>
          <label className="field"><span>Password</span><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
          {error && <div className="banner">{error}</div>}
          <Button variant="primary" size="lg" type="submit" disabled={busy !== null}>{busy !== null && busy === email ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        {demo.data && (
          <p className="note" style={{ marginTop: 16 }}>
            Every card on the right is a live demo account on synthetic data. Password for all: <span className="mono">{demo.data.password}</span>. One click signs in.
          </p>
        )}
      </div>

      <div className="signin-personas">
        {demo.isLoading && <div className="muted">Loading demo accounts…</div>}
        {grouped.map((g) => (
          <section key={g.lens} className="persona-group" data-persona-lens={g.lens}>
            <h2>{g.label}</h2>
            <div className="persona-grid">
              {g.accounts.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  className="persona-card"
                  disabled={busy !== null}
                  aria-busy={busy === a.email}
                  onClick={() => void submit(undefined, a.email, demo.data!.password)}
                >
                  <span className="persona-icon">{Icon[PERSONA_ICON[a.persona]]}</span>
                  <span className="persona-body">
                    <b>{PERSONA_LABEL[a.persona]}</b>
                    <span className="persona-name">{a.name}</span>
                    <span className="persona-hint">{busy === a.email ? 'Signing in…' : PERSONA_HINT[a.persona]}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
