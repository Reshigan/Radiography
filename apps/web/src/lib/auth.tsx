import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Persona, Lens } from '@bonakala/domain';
import { api, setPracticeHeader } from './api';

export interface Me {
  user: { id: string; persona: Persona; name: string; email: string; practiceId: string | null; siteIds: string[] | null; patientId: string | null; referrerId: string | null } | null;
  practiceId: string | null;
  practices: Array<{ id: string; name: string | null }>;
  home?: string;
  lens?: Lens;
  demo?: boolean;
}

const Ctx = createContext<{ me: Me | undefined; refresh: () => Promise<unknown>; signOut: () => Promise<void>; selectPractice: (id: string | null) => Promise<void> } | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  if (q.data?.practiceId) setPracticeHeader(q.data.practiceId);
  const value = {
    me: q.data,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    signOut: async () => {
      await api.post('/auth/logout');
      setPracticeHeader(null);
      await qc.invalidateQueries();
      window.location.href = '/';
    },
    selectPractice: async (id: string | null) => {
      await api.post('/auth/select-practice', { practiceId: id });
      setPracticeHeader(id);
      await qc.invalidateQueries();
    },
  };
  if (q.isLoading) return <div className="signin"><div className="muted">Loading…</div></div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

export function initials(name: string) {
  return name.replace(/^(Dr|Sister|Mr|Ms)\s+/i, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
