import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mark, Button } from '@bonakala/bdl';
import { PERSONA_LABEL, PERSONA_HOME, type Persona } from '@bonakala/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/')({ component: SignIn });

function SignIn() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('bonakala-demo');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api.get<{ password: string; accounts: Array<{ email: string; persona: Persona; name: string }> }>('/auth/demo-accounts').catch(() => null) });

  useEffect(() => {
    document.documentElement.setAttribute('data-lens', 'governance');
    if (me?.user) void navigate({ to: PERSONA_HOME[me.user.persona] as any });
  }, [me, navigate]);

  async function submit(e?: React.FormEvent, em = email, pw = password) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ home: string }>('/auth/login', { email: em, password: pw });
      await refresh();
      void navigate({ to: r.home as any });
    } catch (err) {
      setError((err as Error).message === 'Request failed (401)' ? 'Email or password is not right.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <form className="box dev" onSubmit={submit}>
        <div className="brand" style={{ color: 'var(--heading)' }}><Mark size={32} /> bonakala</div>
        <p className="muted">Everything, made visible. Sign in to the Bonakala Platform.</p>
        <label className="field"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required /></label>
        <label className="field"><span>Password</span><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
        {error && <div className="banner">{error}</div>}
        <Button variant="primary" size="lg" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        {demo.data && (
          <>
            <hr className="hr" />
            <div className="note">Demo accounts (synthetic data). Password for all: <span className="mono">{demo.data.password}</span></div>
            <div className="personas">
              {demo.data.accounts.map((a) => (
                <button key={a.email} type="button" onClick={() => void submit(undefined, a.email, demo.data!.password)}>
                  <b>{PERSONA_LABEL[a.persona]}</b><span>{a.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
