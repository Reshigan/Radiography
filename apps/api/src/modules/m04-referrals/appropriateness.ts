import type { AppropriatenessResult } from '@bonakala/db';
import { hasRedFlags } from './parser.js';
import type { ProcedureDef } from './catalogue.js';

export const GUIDELINE_PACK = 'Practice referral guidelines 2026.1';

interface Rule {
  id: string;
  modality?: string[];
  bodyPart?: RegExp;
  clinical: RegExp;
  unlessRedFlags?: boolean;
  patient?: (p: { age?: number; sex?: string }) => boolean;
  band: AppropriatenessResult['band'];
  guidance: string;
  alternative?: string;
}

/** Rule table: advisory, never blocks, recorded with the referrer's decision (docs/processes/01 §7.5). */
export const RULES: Rule[] = [
  { id: 'LBP-MR', modality: ['MR'], bodyPart: /lumbar/i, clinical: /low(?:er)? back pain|lumbago|lbp/i, unlessRedFlags: true, band: 'usually_not_appropriate', guidance: 'For low back pain without red flags, MRI within 6 weeks is not recommended; consider X-ray or wait. Red flags: weakness, bladder or bowel change, fever, cancer history.', alternative: 'XR-LSPINE' },
  { id: 'LBP-XR', modality: ['XR'], bodyPart: /lumbar/i, clinical: /low(?:er)? back pain|lumbago|lbp/i, unlessRedFlags: true, band: 'may_be_appropriate', guidance: 'Plain films add little for uncomplicated low back pain under 6 weeks; consider conservative care first.' },
  { id: 'LBP-MR-RF', modality: ['MR'], bodyPart: /lumbar/i, clinical: /low(?:er)? back pain|lumbago|lbp|sciatica|radiculopathy/i, band: 'usually_appropriate', guidance: 'MRI lumbar spine is appropriate where red flags or radicular symptoms are present.' },
  { id: 'HA-CT', modality: ['CT'], bodyPart: /head|brain/i, clinical: /headache|migraine/i, unlessRedFlags: true, band: 'may_be_appropriate', guidance: 'Uncomplicated headache with a normal neurological examination rarely needs CT; consider red flags (thunderclap, new neurological deficit, fever, trauma, anticoagulation).', alternative: 'MR-BRAIN' },
  { id: 'HA-CT-TRAUMA', modality: ['CT'], bodyPart: /head|brain/i, clinical: /trauma|fall|head injury|anticoagul|confusion|thunderclap|weakness|stroke|cva/i, band: 'usually_appropriate', guidance: 'CT head is appropriate for head injury with risk factors, acute neurological deficit or anticoagulation.' },
  { id: 'SINUS-CT', modality: ['CT'], bodyPart: /sinus/i, clinical: /acute sinusitis|sinusitis/i, unlessRedFlags: true, band: 'usually_not_appropriate', guidance: 'Uncomplicated acute sinusitis under 4 weeks is a clinical diagnosis; CT is reserved for chronic or complicated disease.' },
  { id: 'KNEE-XR', modality: ['XR'], bodyPart: /knee/i, clinical: /trauma|fall|injur|twist|unable to (?:bear )?weight|fracture/i, band: 'usually_appropriate', guidance: 'Knee radiographs are appropriate after trauma when Ottawa knee rule criteria are met.' },
  { id: 'KNEE-XR-NT', modality: ['XR'], bodyPart: /knee/i, clinical: /knee pain/i, band: 'may_be_appropriate', guidance: 'Non-traumatic knee pain in adults: radiographs are reasonable for suspected osteoarthritis; MRI is not first line.' },
  { id: 'KNEE-MR', modality: ['MR'], bodyPart: /knee/i, clinical: /locking|giving way|meniscal|ligament|acl|effusion|knee pain/i, band: 'usually_appropriate', guidance: 'MRI knee is appropriate for suspected internal derangement after radiographs.' },
  { id: 'CTPA', modality: ['CT'], bodyPart: /pulmonary/i, clinical: /pulmonary embol|\bpe\b|dyspn|chest pain/i, band: 'may_be_appropriate', guidance: 'Use a validated pre-test probability score (Wells) and D-dimer where low probability before CTPA.' },
  { id: 'PREG-CT', modality: ['CT', 'XR'], clinical: /pregnan/i, band: 'usually_not_appropriate', guidance: 'Ionising imaging in known pregnancy needs radiologist justification; ultrasound or MRI without contrast is preferred where it answers the question.', alternative: 'US-ABDO' },
  { id: 'RENAL-CT', modality: ['CT'], bodyPart: /kub|urinary/i, clinical: /renal colic|kidney stone|flank pain|ureteric/i, band: 'usually_appropriate', guidance: 'Low-dose non-contrast CT KUB is the study of choice for suspected renal colic.' },
  { id: 'RUQ-US', modality: ['US'], bodyPart: /abdo/i, clinical: /ruq|gallstone|cholecyst|jaundice|abdominal pain/i, band: 'usually_appropriate', guidance: 'Ultrasound is first line for right upper quadrant pain and suspected gallstones.' },
  { id: 'MG-YOUNG', modality: ['MG'], clinical: /lump|mass|pain/i, patient: (p) => (p.age ?? 99) < 30, band: 'usually_not_appropriate', guidance: 'Under 30, breast ultrasound is the first investigation for a palpable lump; mammography adds little in dense tissue.', alternative: 'US-BREAST' },
  { id: 'MG-SCREEN', modality: ['MG'], clinical: /screening|routine|family history/i, patient: (p) => (p.age ?? 0) >= 40, band: 'usually_appropriate', guidance: 'Screening mammography from 40 at one- to two-year intervals is consistent with the adopted guideline.' },
  { id: 'CXR-COUGH', modality: ['XR'], bodyPart: /chest/i, clinical: /cough|tb|tuberculosis|pneumonia|haemoptysis|weight loss|dyspn/i, band: 'usually_appropriate', guidance: 'Chest radiograph is appropriate for cough over 3 weeks, suspected TB, pneumonia or haemoptysis.' },
  { id: 'DXA-YOUNG', modality: ['DXA'], clinical: /./, patient: (p) => (p.age ?? 99) < 50, band: 'may_be_appropriate', guidance: 'Bone densitometry under 50 is reserved for patients with risk factors (steroids, early menopause, fragility fracture).' },
  { id: 'CSPINE-MR', modality: ['MR'], bodyPart: /cervical/i, clinical: /neck pain/i, unlessRedFlags: true, band: 'may_be_appropriate', guidance: 'Neck pain without radiculopathy or red flags rarely needs MRI within 6 weeks.' },
  { id: 'CAROTID-US', modality: ['US'], bodyPart: /carotid/i, clinical: /tia|stroke|amaurosis|bruit|transient/i, band: 'usually_appropriate', guidance: 'Carotid Doppler is appropriate after TIA or minor stroke to assess for surgical candidacy.' },
  { id: 'DVT-US', modality: ['US'], bodyPart: /venous|leg/i, clinical: /dvt|swollen|calf|thrombo/i, band: 'usually_appropriate', guidance: 'Compression ultrasound is the investigation of choice for suspected DVT.' },
  { id: 'ANKLE-XR', modality: ['XR'], bodyPart: /ankle|foot/i, clinical: /sprain|twist|inversion/i, band: 'may_be_appropriate', guidance: 'Ankle radiographs only when Ottawa ankle rule criteria (bony tenderness or inability to weight-bear) are met.' },
];

export function evaluateAppropriateness(procedure: ProcedureDef, clinicalInfo: string | null | undefined, patient: { age?: number; sex?: string } = {}): AppropriatenessResult {
  const text = clinicalInfo ?? '';
  const redFlags = hasRedFlags(text);
  for (const r of RULES) {
    if (r.modality && !r.modality.includes(procedure.modality)) continue;
    if (r.bodyPart && !r.bodyPart.test(`${procedure.bodyPart} ${procedure.description}`)) continue;
    if (!r.clinical.test(text)) continue;
    if (r.unlessRedFlags && redFlags) continue;
    if (r.patient && !r.patient(patient)) continue;
    return { band: r.band, ruleId: r.id, guidance: r.guidance, alternative: r.alternative, guidelinePack: GUIDELINE_PACK };
  }
  return { band: 'usually_appropriate', ruleId: 'DEFAULT', guidance: `No specific guideline entry matched for ${procedure.description}; the request is treated as usually appropriate and recorded for review.`, guidelinePack: GUIDELINE_PACK };
}

export function ageFrom(dob: string | null | undefined, now = new Date()): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
