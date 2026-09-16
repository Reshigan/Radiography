import type { ProcedureDef } from '../m04-referrals/catalogue.js';

export type SafetySet = 'ionising' | 'mri' | 'contrast' | 'sedation';

export interface Question {
  key: string;
  label: string;
  type: 'yes_no_unsure' | 'yes_no' | 'date' | 'number' | 'text';
  blockingWhen?: Array<string | number>;
  reviewWhen?: Array<string | number>;
  conditionOn?: { key: string; equals: string };
  hint?: string;
  optional?: boolean;
}

export const QUESTION_SETS: Record<SafetySet, { version: string; title: string; questions: Question[] }> = {
  ionising: {
    version: '2026.1', title: 'Radiation safety',
    questions: [
      { key: 'pregnancy_possible', label: 'Could you be pregnant?', type: 'yes_no_unsure', blockingWhen: ['yes'], reviewWhen: ['unsure'], hint: 'A radiographer checks with you before the scan if you are not sure.' },
      { key: 'lmp_date', label: 'Date of your last menstrual period', type: 'date', optional: true, conditionOn: { key: 'pregnancy_possible', equals: 'unsure' } },
      { key: 'recent_same_region', label: 'Have you had a scan of the same area in the last 30 days?', type: 'yes_no_unsure', reviewWhen: ['yes'] },
    ],
  },
  mri: {
    version: '2026.1', title: 'MRI safety',
    questions: [
      { key: 'pacemaker', label: 'Do you have a pacemaker or defibrillator?', type: 'yes_no_unsure', blockingWhen: ['yes'], reviewWhen: ['unsure'] },
      { key: 'implant', label: 'Any other implant: cochlear implant, neurostimulator, aneurysm clip, stent or valve?', type: 'yes_no_unsure', reviewWhen: ['yes', 'unsure'] },
      { key: 'metal_fragments', label: 'Any metal fragments in your eyes, or metalworking without goggles?', type: 'yes_no_unsure', blockingWhen: ['yes'], reviewWhen: ['unsure'] },
      { key: 'surgery_implants', label: 'Any orthopaedic implants, plates, screws or joint replacements?', type: 'yes_no_unsure', reviewWhen: ['yes'] },
      { key: 'patches', label: 'Are you wearing a medicine patch?', type: 'yes_no', reviewWhen: ['yes'] },
      { key: 'claustrophobia', label: 'Do enclosed spaces worry you?', type: 'yes_no_unsure', reviewWhen: ['yes'] },
      { key: 'pregnancy_possible', label: 'Could you be pregnant?', type: 'yes_no_unsure', reviewWhen: ['yes', 'unsure'] },
    ],
  },
  contrast: {
    version: '2026.1', title: 'Contrast safety',
    questions: [
      { key: 'previous_reaction', label: 'Have you ever reacted to contrast dye?', type: 'yes_no_unsure', blockingWhen: ['yes'], reviewWhen: ['unsure'] },
      { key: 'allergies', label: 'Any allergies to medicines or iodine?', type: 'yes_no_unsure', reviewWhen: ['yes', 'unsure'] },
      { key: 'kidney_problems', label: 'Any kidney problems, dialysis or one kidney?', type: 'yes_no_unsure', reviewWhen: ['yes', 'unsure'] },
      { key: 'egfr_value', label: 'Your most recent eGFR result', type: 'number', optional: true, hint: 'If you do not know it, a nurse arranges a test at the practice.' },
      { key: 'egfr_date', label: 'Date of that result', type: 'date', optional: true },
      { key: 'diabetes_metformin', label: 'Do you take metformin for diabetes?', type: 'yes_no_unsure', reviewWhen: ['yes'] },
      { key: 'asthma', label: 'Do you have asthma?', type: 'yes_no', reviewWhen: ['yes'] },
    ],
  },
  sedation: {
    version: '2026.1', title: 'Sedation',
    questions: [
      { key: 'fasting', label: 'Have you had nothing to eat for 6 hours?', type: 'yes_no', blockingWhen: ['no'] },
      { key: 'escort', label: 'Is someone coming with you to take you home?', type: 'yes_no', blockingWhen: ['no'] },
      { key: 'airway_history', label: 'Any breathing, heart or airway problems?', type: 'yes_no_unsure', reviewWhen: ['yes', 'unsure'] },
    ],
  },
};

export const EGFR_THRESHOLD = 30;
export const EGFR_WINDOW_DAYS = 90;

export interface Clearance { status: 'not_started' | 'answered' | 'needs_review' | 'cleared' | 'cleared_with_conditions' | 'blocked'; completeness: number; blockingItems: string[]; conditions: string[] }

/** Deterministic clearance from answers; CMP owns the content, the rule is code (docs/processes/04 §6.7). */
export function evaluateSet(set: SafetySet, answers: Record<string, string | number | boolean | null>, patient: { sex?: string | null; age?: number } = {}): Clearance {
  const def = QUESTION_SETS[set];
  const applicable = def.questions.filter((q) => {
    if (q.conditionOn) { const dep = answers[q.conditionOn.key]; if (dep !== q.conditionOn.equals) return false; }
    if (q.key === 'pregnancy_possible' && (patient.sex === 'M' || (patient.age !== undefined && (patient.age < 12 || patient.age > 55)))) return false;
    if (q.key === 'lmp_date' && (patient.sex === 'M' || (patient.age !== undefined && (patient.age < 12 || patient.age > 55)))) return false;
    return true;
  });
  const required = applicable.filter((q) => !q.optional);
  const answered = required.filter((q) => answers[q.key] !== undefined && answers[q.key] !== null && answers[q.key] !== '');
  const completeness = required.length ? Math.round((answered.length / required.length) * 100) : 100;
  const blockingItems: string[] = [];
  const conditions: string[] = [];
  for (const q of applicable) {
    const v = answers[q.key];
    if (v === undefined || v === null || v === '') continue;
    if (q.blockingWhen?.includes(v as string)) blockingItems.push(`${q.label}: ${v}`);
    else if (q.reviewWhen?.includes(v as string)) conditions.push(`${q.label}: ${v}`);
  }
  if (set === 'contrast') {
    const egfr = Number(answers['egfr_value'] ?? NaN);
    const date = answers['egfr_date'] as string | undefined;
    const stale = !date || Date.now() - new Date(date).getTime() > EGFR_WINDOW_DAYS * 86400_000;
    if (Number.isFinite(egfr) && egfr < EGFR_THRESHOLD) blockingItems.push(`eGFR ${egfr} below the practice threshold of ${EGFR_THRESHOLD}: radiologist decision required`);
    else if (!Number.isFinite(egfr) && (answers['kidney_problems'] === 'yes' || answers['kidney_problems'] === 'unsure')) blockingItems.push('Kidney problems declared and no eGFR on file: a test is needed before contrast');
    else if (Number.isFinite(egfr) && stale) conditions.push('eGFR older than 90 days: nurse confirms or repeats before contrast');
    if (answers['diabetes_metformin'] === 'yes') conditions.push('Metformin: follow the practice holding protocol after contrast');
  }
  if (completeness < 100) return { status: answered.length ? 'answered' : 'not_started', completeness, blockingItems, conditions };
  if (blockingItems.length) return { status: 'blocked', completeness, blockingItems, conditions };
  if (conditions.length) return { status: 'needs_review', completeness, blockingItems, conditions };
  return { status: 'cleared', completeness, blockingItems, conditions };
}

export function setsFor(procedures: ProcedureDef[]): SafetySet[] {
  const s = new Set<SafetySet>();
  for (const p of procedures) for (const x of p.safetySets) s.add(x as SafetySet);
  return [...s];
}

export function consentTypesFor(procedures: ProcedureDef[]): string[] {
  const types = ['imaging', 'popia'];
  if (procedures.some((p) => p.contrast === 'required')) types.push('contrast');
  if (procedures.some((p) => p.safetySets.includes('sedation'))) types.push('sedation');
  return types;
}
