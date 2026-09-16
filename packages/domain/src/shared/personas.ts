export const PERSONAS = [
  'PAT', 'REF', 'FDK', 'BKG', 'RAD', 'RGT', 'NUR', 'BIL', 'DEB', 'PRM', 'EXE', 'SHR', 'CMP', 'BIO', 'AIO', 'PAY', 'SUP',
] as const;
export type Persona = (typeof PERSONAS)[number];

export type Lens = 'patient' | 'referrer' | 'clinical' | 'business' | 'governance';

export const PERSONA_LENS: Record<Persona, Lens> = {
  PAT: 'patient', REF: 'referrer', PAY: 'referrer',
  RAD: 'clinical', RGT: 'clinical', NUR: 'clinical', BIO: 'clinical', AIO: 'clinical',
  FDK: 'business', BKG: 'business', BIL: 'business', DEB: 'business', PRM: 'business', EXE: 'business', SHR: 'business',
  CMP: 'governance', SUP: 'governance',
};

/** Personas whose scope is the whole Group (cross-tenant) rather than one Practice. */
export const GROUP_PERSONAS: Persona[] = ['EXE', 'SUP', 'AIO', 'BIO', 'CMP'];

export const PERSONA_HOME: Record<Persona, string> = {
  PAT: '/p', REF: '/r', FDK: '/desk', BKG: '/booking', RAD: '/tech', RGT: '/read', NUR: '/nurse',
  BIL: '/billing', DEB: '/debtors', PRM: '/practice', EXE: '/group', SHR: '/shareholder',
  CMP: '/compliance', BIO: '/engineering', AIO: '/bci', PAY: '/funder', SUP: '/support',
};

export const PERSONA_LABEL: Record<Persona, string> = {
  PAT: 'Patient', REF: 'Referring clinician', FDK: 'Front desk', BKG: 'Central booking', RAD: 'Radiographer',
  RGT: 'Radiologist', NUR: 'Nurse', BIL: 'Billing', DEB: 'Debtors', PRM: 'Practice manager', EXE: 'Group executive',
  SHR: 'Shareholder', CMP: 'Compliance', BIO: 'Biomedical & IT', AIO: 'AI operations', PAY: 'Funder', SUP: 'Platform support',
};
