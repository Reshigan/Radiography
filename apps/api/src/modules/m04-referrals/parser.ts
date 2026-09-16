import { parseSaId } from '@bonakala/domain';
import type { ParsedReferral } from '@bonakala/db';
import { matchProcedure, type ProcedureDef } from './catalogue.js';

export const REFERRAL_MODEL = { modelId: 'referral-extract', modelVersion: '2.4.1' };

export interface ReferrerLike { id: string; name: string; hpcsaNo: string | null; bhfPracticeNo: string | null; status: string }

const MODALITY_CUES: Array<[RegExp, ProcedureDef['modality']]> = [
  [/\b(mri|magnetic resonance)\b/i, 'MR'],
  [/\bMR\b/, 'MR'],
  [/\b(ct|cat scan|computed tomography|ctpa|ct angio\w*)\b/i, 'CT'],
  [/\b(x-?rays?|xr|radiograph\w*|cxr|plain films?)\b/i, 'XR'],
  [/\b(ultrasound|u\/s|sonar|sonograph\w*|doppler|scan of the (?:tummy|abdomen|pelvis))\b/i, 'US'],
  [/\bUS\b/, 'US'],
  [/\b(mammogram|mammography|mmg|tomosynthesis)\b/i, 'MG'],
  [/\b(dexa|dxa|bone density|densitometry)\b/i, 'DXA'],
];

const ICD_HINTS: Array<[RegExp, string]> = [
  [/low(?:er)? back pain|lumbago|lbp/i, 'M54.5'], [/neck pain|cervicalgia/i, 'M54.2'], [/headache|cephalalgia/i, 'R51'],
  [/knee pain/i, 'M25.56'], [/shoulder pain/i, 'M25.51'], [/hip pain/i, 'M25.55'], [/ankle pain/i, 'M25.57'], [/wrist pain/i, 'M25.53'],
  [/chest pain/i, 'R07.4'], [/cough/i, 'R05'], [/short(?:ness)? of breath|dyspn/i, 'R06.0'], [/abdominal pain|tummy pain|epigastric/i, 'R10.4'],
  [/renal colic|kidney stone|ureteric/i, 'N23'], [/sinusitis/i, 'J01.9'], [/osteoporosis|bone density/i, 'M81.0'], [/breast lump|lump in .*breast/i, 'N63'],
  [/pregnan/i, 'Z34.9'], [/thyroid|goitre/i, 'E04.9'], [/dvt|deep vein|swollen (?:calf|leg)/i, 'I80.2'], [/pulmonary embol|\bpe\b/i, 'I26.9'],
  [/fracture|#/i, 'T14.2'], [/fall|trauma|injur|mva|accident/i, 'T14.9'], [/confusion|stroke|cva|weakness one side|hemipar/i, 'I63.9'],
  [/gallstone|cholecyst|ruq/i, 'K80.2'], [/screening/i, 'Z12.3'], [/tb|tuberculosis/i, 'A16.2'], [/pneumonia/i, 'J18.9'], [/carotid|tia|transient isch/i, 'G45.9'],
];

const RED_FLAGS = /(weakness|bladder|bowel|incontinen|fever|cancer|malignan|weight loss|night pain|trauma|steroid|osteoporosis|iv drug|hiv|immunocompromised|saddle)/i;

function conf(fields: ParsedReferral['fields'], key: string, value: unknown, confidence: number, source: 'rules' | 'llm' | 'human' = 'rules') {
  if (value === undefined || value === null || value === '') return;
  fields[key] = { value, confidence, source };
}

/** Deterministic extraction of a referral's structure from free text (OCR'd photo or typed). */
export function parseReferralText(text: string, catalogue: ProcedureDef[], referrers: ReferrerLike[]): ParsedReferral {
  const t = text.replace(/\r/g, '').trim();
  const fields: ParsedReferral['fields'] = {};
  const missing: string[] = [];

  let modality: ProcedureDef['modality'] | undefined;
  for (const [re, m] of MODALITY_CUES) if (re.test(t)) { modality = m; break; }
  if (modality) conf(fields, 'modality', modality, 0.96); else missing.push('modality');

  let contrast: boolean | undefined;
  if (/(without|no|non-?)\s*contrast|\bc-\b|non-?enhanced|plain\b/i.test(t)) contrast = false;
  else if (/with\s+(?:iv\s+)?contrast|\bc\+|contrast[- ]enhanced|\bcontrast\b|\biv\b.*\bcontrast/i.test(t)) contrast = true;
  if (contrast !== undefined) conf(fields, 'contrast', contrast, 0.9);

  let laterality: ParsedReferral['laterality'];
  if (/\b(bilateral|both|b\/l)\b/i.test(t)) laterality = 'bilateral';
  else if (/\b(left|lt|\(l\)|l\/)\b/i.test(t)) laterality = 'left';
  else if (/\b(right|rt|\(r\)|r\/)\b/i.test(t)) laterality = 'right';
  if (laterality) conf(fields, 'laterality', laterality, 0.92);

  const match = matchProcedure(catalogue, t, { modality, contrast });
  let procedure: ProcedureDef | undefined;
  if (match) {
    procedure = match.procedure;
    modality ??= procedure.modality;
    conf(fields, 'procedure', procedure.code, match.score);
    conf(fields, 'bodyPart', procedure.bodyPart, match.score);
    if (procedure.lateralityRequired && !laterality) missing.push('laterality');
    if (procedure.contrast === 'required' && contrast === undefined) contrast = true;
    if (procedure.contrast === 'none') contrast = false;
  } else missing.push('procedure');

  let urgency: ParsedReferral['urgency'] = 'routine';
  if (/\b(stat|emergency|immediate(?:ly)?|now)\b/i.test(t)) urgency = 'stat';
  else if (/\b(urgent|asap|today|within 24 ?h)/i.test(t)) urgency = 'urgent';
  else if (/\b(priority|this week|within 7 days|soon)\b/i.test(t)) urgency = 'priority';
  conf(fields, 'urgency', urgency, urgency === 'routine' ? 0.7 : 0.9);

  // Referrer: HPCSA number, practice number or "Dr Surname"
  const hpcsa = /\b(MP|DR|PS)\s?(\d{6,7})\b/i.exec(t);
  const prac = /\b(?:pr(?:actice)?(?:\s*(?:no|number|nr))?\.?\s*[:#]?\s*)(\d{7})\b/i.exec(t);
  const drName = /\bDr\.?\s+((?:[A-Z][\w'-]*\.?\s?){1,3})/.exec(t);
  let referrer: ReferrerLike | undefined;
  let referrerConf = 0;
  const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  if (hpcsa) {
    referrer = referrers.find((r) => r.hpcsaNo && norm(r.hpcsaNo) === norm(`${hpcsa[1]} ${hpcsa[2]}`));
    if (referrer) referrerConf = 0.99;
  }
  if (!referrer && prac) {
    referrer = referrers.find((r) => r.bhfPracticeNo === prac![1]);
    if (referrer) referrerConf = 0.95;
  }
  let referrerName = drName ? `Dr ${drName[1]!.trim().replace(/\s+$/, '')}` : undefined;
  if (!referrer && drName) {
    const surname = drName[1]!.trim().split(/\s+/).pop()!.replace(/\.$/, '').toLowerCase();
    const cands = referrers.filter((r) => r.name.toLowerCase().split(/\s+/).pop() === surname);
    if (cands.length === 1) { referrer = cands[0]; referrerConf = 0.85; }
    else if (cands.length > 1) { referrer = cands[0]; referrerConf = 0.55; }
  }
  if (referrer) { referrerName = referrer.name; conf(fields, 'referrer', referrer.id, referrerConf); }
  else if (referrerName) conf(fields, 'referrerName', referrerName, 0.6);
  else missing.push('referrer');

  // Patient cues
  const idm = /\b(\d{13})\b/.exec(t);
  let patientIdNumber: string | undefined;
  if (idm && parseSaId(idm[1]!).valid) { patientIdNumber = idm[1]; conf(fields, 'patientIdNumber', patientIdNumber, 0.97); }
  const mob = /(?:\+27|0)\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/.exec(t);
  const patientMobile = mob ? mob[0].replace(/[\s-]/g, '') : undefined;
  if (patientMobile) conf(fields, 'patientMobile', patientMobile, 0.9);
  const nm = /(?:patient|pt|name|re)\s*[:\-]\s*(?:(?:Mr|Mrs|Ms|Miss|Mnr|Mev)\.?\s+)?([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2})/.exec(t) ?? /\bfor\s+(?:Mr|Mrs|Ms|Miss)\.?\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)/.exec(t);
  const patientName = nm?.[1]?.trim();
  if (patientName) conf(fields, 'patientName', patientName, 0.8);
  if (!patientName && !patientIdNumber && !patientMobile) missing.push('patient');

  // Clinical information
  const cl = /(?:clinical(?:\s+(?:info(?:rmation)?|indication|history|question|details))?|indication|history|hx|dx|diagnosis|reason|query|\?)\s*[:\-]\s*([^\n]+)/i.exec(t);
  let clinicalInfo = cl?.[1]?.trim();
  if (!clinicalInfo) {
    const stripped = t.replace(/\b\d{13}\b/g, '').replace(/(?:\+27|0)\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, '').replace(/\bDr\.?\s+(?:[A-Z][\w'-]*\.?\s?){1,3}/g, '').replace(/\b(MP|PR)\s?\d{6,7}\b/gi, '');
    const sentence = stripped.split(/[\n.]/).map((s) => s.trim()).filter((s) => s.length > 12 && !/^(?:please|pls|kindly)?\s*(?:refer|request|book)/i.test(s));
    clinicalInfo = sentence.slice(0, 2).join('. ').slice(0, 240) || undefined;
  }
  if (clinicalInfo) conf(fields, 'clinicalInfo', clinicalInfo, 0.75); else missing.push('clinical');

  // ICD-10: explicit codes then hints
  const icd10 = new Set<string>();
  for (const m of t.matchAll(/\b([A-TV-Z]\d{2}(?:\.\d{1,2})?)\b/g)) icd10.add(m[1]!);
  for (const [re, code] of ICD_HINTS) if (re.test(t)) icd10.add(code);
  const icdList = [...icd10].slice(0, 4);
  if (icdList.length) conf(fields, 'icd10', icdList, /\b[A-TV-Z]\d{2}(?:\.\d{1,2})?\b/.test(t) ? 0.9 : 0.6);

  const weights: Array<[string, number]> = [['modality', 0.3], ['procedure', 0.25], ['referrer', 0.2], ['clinicalInfo', 0.15], ['urgency', 0.05], ['laterality', 0.05]];
  let confidence = 0;
  for (const [k, w] of weights) {
    const f = fields[k];
    if (f) confidence += w * f.confidence;
    else if (k === 'laterality' && !procedure?.lateralityRequired) confidence += w;
    else if (k === 'referrer' && fields['referrerName']) confidence += w * 0.5;
  }
  confidence = Math.round(confidence * 100) / 100;

  return {
    modality, bodyPart: procedure?.bodyPart, procedureCode: procedure?.code, procedureDescription: procedure?.description,
    laterality: laterality ?? (procedure && !procedure.lateralityRequired ? 'na' : undefined), contrast, urgency,
    referrerName, referrerHpcsa: hpcsa ? `${hpcsa[1]!.toUpperCase()} ${hpcsa[2]}` : referrer?.hpcsaNo ?? undefined, referrerPracticeNo: prac?.[1] ?? referrer?.bhfPracticeNo ?? undefined, referrerId: referrer?.id,
    patientName, patientIdNumber, patientMobile, clinicalInfo, icd10: icdList,
    fields, confidence, missing, ...REFERRAL_MODEL,
  };
}

export function hasRedFlags(clinical: string | undefined | null): boolean {
  return !!clinical && RED_FLAGS.test(clinical);
}
