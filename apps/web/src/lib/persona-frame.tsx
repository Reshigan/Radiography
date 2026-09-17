import { type ReactNode } from 'react';
import { useNavigate, useRouterState, Outlet } from '@tanstack/react-router';
import { AppFrame, Icon, type RailItem } from '@bonakala/bdl';
import { PERSONA_LENS, PERSONA_HOME, PERSONA_LABEL, formatSast, type Persona } from '@bonakala/domain';
import { useAuth, initials } from './auth';

export interface RailSpec { id: string; label: string; icon: keyof typeof Icon; path: string }

/** Rail per persona (docs/25 §2.2). Module builders extend by adding pages at these paths. */
export const RAILS: Record<Persona, RailSpec[]> = {
  PAT: [],
  REF: [
    { id: 'refer', label: 'Refer', icon: 'doc', path: '/r' }, { id: 'patients', label: 'Patients', icon: 'people', path: '/r/patients' },
    { id: 'results', label: 'Results', icon: 'image', path: '/r/results' }, { id: 'urgent', label: 'Urgent', icon: 'alert', path: '/r/urgent' }, { id: 'analytics', label: 'Analytics', icon: 'chart', path: '/r/analytics' },
  ],
  FDK: [
    { id: 'today', label: 'Today', icon: 'calendar', path: '/desk' }, { id: 'patients', label: 'Patients', icon: 'people', path: '/desk/patients' },
    { id: 'payments', label: 'Payments', icon: 'card', path: '/desk/payments' }, { id: 'queue', label: 'Queue display', icon: 'grid', path: '/desk/queue' },
  ],
  BKG: [
    { id: 'inbox', label: 'Inbox', icon: 'inbox', path: '/booking' }, { id: 'calendar', label: 'Calendar', icon: 'calendar', path: '/booking/calendar' },
    { id: 'waitlist', label: 'Waitlist', icon: 'list', path: '/booking/waitlist' }, { id: 'referrers', label: 'Referrers', icon: 'people', path: '/booking/referrers' }, { id: 'analytics', label: 'Analytics', icon: 'chart', path: '/booking/analytics' },
  ],
  RAD: [
    { id: 'worklist', label: 'Room worklist', icon: 'list', path: '/tech' }, { id: 'protocols', label: 'Protocols', icon: 'doc', path: '/tech/protocols' },
    { id: 'dose', label: 'Dose', icon: 'gauge', path: '/tech/dose' }, { id: 'qa', label: 'QA schedule', icon: 'check', path: '/tech/qa' }, { id: 'stock', label: 'Stock', icon: 'flask', path: '/tech/stock' },
  ],
  NUR: [
    { id: 'today', label: 'Patients today', icon: 'people', path: '/nurse' }, { id: 'contrast', label: 'Contrast', icon: 'flask', path: '/nurse/contrast' }, { id: 'reactions', label: 'Reactions', icon: 'alert', path: '/nurse/reactions' },
  ],
  RGT: [
    { id: 'worklist', label: 'Worklist', icon: 'list', path: '/read' }, { id: 'patients', label: 'Patients', icon: 'people', path: '/read/patients' },
    { id: 'peer', label: 'Peer review', icon: 'check', path: '/read/peer-review' }, { id: 'analytics', label: 'Analytics', icon: 'chart', path: '/read/analytics' }, { id: 'fees', label: 'Reading fees', icon: 'money', path: '/read/fees' },
  ],
  BIL: [
    { id: 'exceptions', label: 'Exceptions', icon: 'alert', path: '/billing' }, { id: 'claims', label: 'Claims', icon: 'card', path: '/billing/claims' },
    { id: 'coding', label: 'Coding', icon: 'doc', path: '/billing/coding' }, { id: 'remittances', label: 'Remittances', icon: 'money', path: '/billing/remittances' },
    { id: 'fees', label: 'Fee schedules', icon: 'list', path: '/billing/fee-schedules' }, { id: 'monthend', label: 'Month-end', icon: 'calendar', path: '/billing/month-end' },
  ],
  DEB: [
    { id: 'ageing', label: 'Ageing', icon: 'chart', path: '/debtors' }, { id: 'runs', label: 'Runs', icon: 'sparkle', path: '/debtors/runs' },
    { id: 'disputes', label: 'Disputes', icon: 'alert', path: '/debtors/disputes' }, { id: 'plans', label: 'Plans', icon: 'calendar', path: '/debtors/plans' }, { id: 'handover', label: 'Handover', icon: 'doc', path: '/debtors/handover' },
  ],
  PRM: [
    { id: 'tower', label: 'Control tower', icon: 'grid', path: '/practice' }, { id: 'schedule', label: 'Schedule', icon: 'calendar', path: '/practice/schedule' },
    { id: 'staff', label: 'Staff', icon: 'users', path: '/practice/staff' }, { id: 'equipment', label: 'Equipment', icon: 'wrench', path: '/practice/equipment' },
    { id: 'quality', label: 'Quality', icon: 'shield', path: '/practice/quality' }, { id: 'money', label: 'Money', icon: 'money', path: '/practice/money' }, { id: 'approvals', label: 'Approvals', icon: 'check', path: '/practice/approvals' },
  ],
  EXE: [
    { id: 'group', label: 'Group', icon: 'chart', path: '/group' }, { id: 'practices', label: 'Practices', icon: 'grid', path: '/group/practices' },
    { id: 'money', label: 'Money', icon: 'money', path: '/group/money' }, { id: 'network', label: 'Network', icon: 'people', path: '/group/network' },
    { id: 'automation', label: 'Automation', icon: 'sparkle', path: '/group/automation' },
    { id: 'acq', label: 'Acquisitions', icon: 'inbox', path: '/group/acquisitions' }, { id: 'board', label: 'Board pack', icon: 'doc', path: '/group/board-pack' },
  ],
  SHR: [
    { id: 'practice', label: 'My practice', icon: 'chart', path: '/shareholder' }, { id: 'dist', label: 'Distributions', icon: 'money', path: '/shareholder/distributions' },
    { id: 'docs', label: 'Documents', icon: 'doc', path: '/shareholder/documents' }, { id: 'votes', label: 'Votes', icon: 'check', path: '/shareholder/votes' },
  ],
  CMP: [
    { id: 'board', label: 'Board', icon: 'grid', path: '/compliance' }, { id: 'register', label: 'Register', icon: 'list', path: '/compliance/register' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', path: '/compliance/calendar' }, { id: 'incidents', label: 'Incidents', icon: 'alert', path: '/compliance/incidents' },
    { id: 'complaints', label: 'Complaints', icon: 'inbox', path: '/compliance/complaints' }, { id: 'requests', label: 'Requests', icon: 'doc', path: '/compliance/requests' }, { id: 'audits', label: 'Audits', icon: 'shield', path: '/compliance/audits' },
  ],
  AIO: [
    { id: 'models', label: 'Models', icon: 'sparkle', path: '/bci' }, { id: 'monitoring', label: 'Monitoring', icon: 'chart', path: '/bci/monitoring' },
    { id: 'shadow', label: 'Shadow', icon: 'flask', path: '/bci/shadow' }, { id: 'incidents', label: 'Incidents', icon: 'alert', path: '/bci/incidents' }, { id: 'change', label: 'Change control', icon: 'check', path: '/bci/change-control' },
  ],
  BIO: [
    { id: 'fleet', label: 'Fleet', icon: 'grid', path: '/engineering' }, { id: 'devices', label: 'Devices', icon: 'wrench', path: '/engineering/devices' },
    { id: 'integrations', label: 'Integrations', icon: 'list', path: '/engineering/integrations' }, { id: 'work', label: 'Work orders', icon: 'doc', path: '/engineering/work-orders' }, { id: 'access', label: 'Access', icon: 'shield', path: '/engineering/access' },
  ],
  PAY: [{ id: 'claims', label: 'Claims', icon: 'card', path: '/funder' }],
  SUP: [
    { id: 'tenants', label: 'Tenants', icon: 'grid', path: '/support' }, { id: 'incidents', label: 'Incidents', icon: 'alert', path: '/support/incidents' },
    { id: 'onboarding', label: 'Onboarding', icon: 'check', path: '/support/onboarding' }, { id: 'admin', label: 'Admin', icon: 'settings', path: '/admin' },
  ],
};

export function PersonaFrame({ persona, inspector, statusLine, right, children }: { persona: Persona; inspector?: ReactNode; statusLine?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  const { me, signOut, selectPractice } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const user = me?.user;
  if (!user) { window.location.href = '/'; return null; }
  const rail: RailItem[] = RAILS[persona].map((r) => ({ id: r.id, label: r.label, icon: Icon[r.icon], href: r.path, active: r.path === PERSONA_HOME[persona] ? pathname === r.path : pathname.startsWith(r.path) }));
  const practiceName = me.practices.find((p) => p.id === me.practiceId)?.name ?? (me.practiceId ? me.practiceId : 'Group');
  const canSwitch = !user.practiceId && me.practices.length > 1;
  return (
    <AppFrame
      lens={PERSONA_LENS[persona]}
      rail={rail}
      navigate={(href) => void navigate({ to: href })}
      context={<>
        <span>{railTitle(persona)}</span><span className="sep">/</span>
        {canSwitch ? (
          <select value={me.practiceId ?? ''} onChange={(e) => void selectPractice(e.target.value || null)} aria-label="Practice" style={{ background: 'transparent', border: 0, font: 'inherit', color: 'var(--text)' }}>
            <option value="">Group (all practices)</option>
            {me.practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : <span>{practiceName}</span>}
        <span className="sep">/</span><span className="mono">{formatSast(new Date())}</span>
      </>}
      userInitials={initials(user.name)}
      userName={user.name}
      userRole={PERSONA_LABEL[persona]}
      userEmail={user.email}
      right={<>{me.demo && <span className="chip"><i />DEMO · synthetic data</span>}{right}</>}
      inspector={inspector}
      statusLine={statusLine}
      onSignOut={() => void signOut()}
      onSearch={(q) => void navigate({ to: `${PERSONA_HOME[persona]}/patients` as any, search: { q } as any })}
    >
      {children ?? <Outlet />}
    </AppFrame>
  );
}

function railTitle(p: Persona) {
  return ({ REF: 'Referrer Space', FDK: 'Front Desk', BKG: 'Central Booking', RAD: 'Technologist Console', NUR: 'Nurse Console', RGT: 'Reading Room', BIL: 'Revenue Cycle', DEB: 'Debtors', PRM: 'Control Tower', EXE: 'Group Console', SHR: 'Shareholder Portal', CMP: 'Compliance', AIO: 'BCI Console', BIO: 'Engineering', SUP: 'Platform Support', PAY: 'Funder', PAT: 'Patient Space' } as Record<Persona, string>)[p];
}

/** Guard: redirect to sign-in when not the expected persona (group personas may open any console read-only). */
export function useRequirePersona(allowed: Persona[]) {
  const { me } = useAuth();
  const user = me?.user;
  if (!user) return null;
  if (!allowed.includes(user.persona) && !['EXE', 'SUP'].includes(user.persona)) return null;
  return user;
}
