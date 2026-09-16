/**
 * Procedure catalogue (reference_data kind 'procedure'). Tariff codes and prices are illustrative
 * demo data (docs/00 §5.6); the Platform stores them as configurable reference data.
 */
export interface ProcedureSeed {
  code: string;
  description: string;
  modality: 'XR' | 'CT' | 'MR' | 'US' | 'MG' | 'DXA';
  bodyPart: string;
  tariffCode: string;
  tariffCents: number;
  cashCents: number;
  durationMin: number;
  prep: string;
  contrast: 'none' | 'optional' | 'required';
  authFlag: boolean;
  ionising: boolean;
  lateralityRequired: boolean;
  keywords: string[];
  safetySets: string[];
}

const NOPREP = 'No preparation needed.';
const FAST4 = 'No food for 4 hours before. Drink water as usual.';
const FULLBLADDER = 'Drink 1 litre of water an hour before and do not empty your bladder.';

const xr = (code: string, description: string, bodyPart: string, tariff: string, cents: number, dur: number, lat: boolean, keywords: string[]): ProcedureSeed => ({ code, description, modality: 'XR', bodyPart, tariffCode: tariff, tariffCents: cents, cashCents: Math.round(cents * 0.85), durationMin: dur, prep: NOPREP, contrast: 'none', authFlag: false, ionising: true, lateralityRequired: lat, keywords, safetySets: ['ionising'] });
const ct = (code: string, description: string, bodyPart: string, tariff: string, cents: number, dur: number, contrast: ProcedureSeed['contrast'], lat: boolean, keywords: string[]): ProcedureSeed => ({ code, description, modality: 'CT', bodyPart, tariffCode: tariff, tariffCents: cents, cashCents: Math.round(cents * 0.8), durationMin: dur, prep: contrast === 'none' ? NOPREP : FAST4, contrast, authFlag: true, ionising: true, lateralityRequired: lat, keywords, safetySets: contrast === 'none' ? ['ionising'] : ['ionising', 'contrast'] });
const mr = (code: string, description: string, bodyPart: string, tariff: string, cents: number, dur: number, contrast: ProcedureSeed['contrast'], lat: boolean, keywords: string[]): ProcedureSeed => ({ code, description, modality: 'MR', bodyPart, tariffCode: tariff, tariffCents: cents, cashCents: Math.round(cents * 0.8), durationMin: dur, prep: 'Leave metal jewellery at home. Tell us about implants before you come.', contrast, authFlag: true, ionising: false, lateralityRequired: lat, keywords, safetySets: contrast === 'none' ? ['mri'] : ['mri', 'contrast'] });
const us = (code: string, description: string, bodyPart: string, tariff: string, cents: number, dur: number, prep: string, lat: boolean, keywords: string[]): ProcedureSeed => ({ code, description, modality: 'US', bodyPart, tariffCode: tariff, tariffCents: cents, cashCents: Math.round(cents * 0.85), durationMin: dur, prep, contrast: 'none', authFlag: false, ionising: false, lateralityRequired: lat, keywords, safetySets: [] });

export const PROCEDURES: ProcedureSeed[] = [
  // Radiography
  xr('XR-CHEST', 'Chest X-ray, PA and lateral', 'chest', '30110', 42000, 10, false, ['chest', 'cxr', 'chest x-ray', 'lungs', 'chest radiograph']),
  xr('XR-LSPINE', 'X-ray lumbar spine', 'lumbar spine', '30140', 58000, 15, false, ['lumbar', 'lumbar spine', 'lower back', 'l-spine', 'lumbosacral']),
  xr('XR-CSPINE', 'X-ray cervical spine', 'cervical spine', '30130', 56000, 15, false, ['cervical', 'cervical spine', 'c-spine', 'neck']),
  xr('XR-TSPINE', 'X-ray thoracic spine', 'thoracic spine', 'T-30212', 56000, 15, false, ['thoracic spine', 't-spine']),
  xr('XR-PELVIS', 'X-ray pelvis', 'pelvis', 'T-30220', 52000, 10, false, ['pelvis', 'pelvic']),
  xr('XR-HIP', 'X-ray hip', 'hip', 'T-30221', 50000, 10, true, ['hip']),
  xr('XR-KNEE', 'X-ray knee', 'knee', '30150', 48000, 10, true, ['knee', 'patella']),
  xr('XR-ANKLE', 'X-ray ankle', 'ankle', 'T-30231', 46000, 10, true, ['ankle']),
  xr('XR-FOOT', 'X-ray foot', 'foot', 'T-30232', 44000, 10, true, ['foot', 'toe', 'metatarsal']),
  xr('XR-SHOULDER', 'X-ray shoulder', 'shoulder', 'T-30240', 48000, 10, true, ['shoulder', 'clavicle', 'acromio']),
  xr('XR-ELBOW', 'X-ray elbow', 'elbow', 'T-30241', 44000, 10, true, ['elbow']),
  xr('XR-WRIST', 'X-ray wrist', 'wrist', '30120', 44000, 10, true, ['wrist', 'scaphoid']),
  xr('XR-HAND', 'X-ray hand', 'hand', 'T-30243', 42000, 10, true, ['hand', 'finger', 'metacarpal']),
  xr('XR-SKULL', 'X-ray skull', 'skull', 'T-30110', 50000, 10, false, ['skull', 'head x-ray']),
  xr('XR-SINUS', 'X-ray sinuses', 'sinuses', 'T-30112', 46000, 10, false, ['sinus', 'sinuses', 'paranasal']),
  xr('XR-ABDO', 'X-ray abdomen, erect and supine', 'abdomen', '30160', 54000, 10, false, ['abdomen', 'abdominal x-ray', 'aXR', 'obstruction']),
  xr('XR-ODMWA', 'Chest X-ray, occupational (ODMWA format)', 'chest', 'T-30101', 45000, 10, false, ['occupational', 'odmwa', 'mine', 'pre-employment chest']),
  // CT
  ct('CT-BRAIN', 'CT brain without contrast', 'brain', '34100', 310000, 15, 'none', false, ['brain', 'head', 'ct head', 'ct brain', 'intracranial']),
  ct('CT-BRAIN-C', 'CT brain with contrast', 'brain', '34101', 418000, 20, 'required', false, ['brain with contrast', 'head with contrast', 'enhanced brain']),
  ct('CT-SINUS', 'CT sinuses', 'sinuses', 'T-30322', 285000, 10, 'none', false, ['sinus', 'sinuses', 'paranasal sinuses']),
  ct('CT-CSPINE', 'CT cervical spine', 'cervical spine', '34200', 330000, 15, 'none', false, ['cervical spine ct', 'c-spine ct', 'neck ct']),
  ct('CT-LSPINE', 'CT lumbar spine', 'lumbar spine', '34400', 335000, 15, 'none', false, ['lumbar spine ct', 'l-spine ct']),
  ct('CT-CHEST', 'CT chest without contrast', 'chest', 'T-30340', 360000, 15, 'none', false, ['chest ct', 'thorax', 'lung ct', 'hrct']),
  ct('CT-CHEST-C', 'CT chest with contrast', 'chest', '34300', 465000, 20, 'required', false, ['chest with contrast', 'thorax with contrast']),
  ct('CT-CTPA', 'CT pulmonary angiogram', 'pulmonary arteries', 'T-30345', 520000, 20, 'required', false, ['ctpa', 'pulmonary angiogram', 'pulmonary embolism', 'pe study']),
  ct('CT-ABDO-C', 'CT abdomen and pelvis with contrast', 'abdomen and pelvis', '34320', 540000, 25, 'required', false, ['abdomen and pelvis', 'abdo pelvis', 'ct abdomen', 'ct abdo']),
  ct('CT-ABDO', 'CT abdomen and pelvis without contrast', 'abdomen and pelvis', 'T-30351', 420000, 20, 'none', false, ['abdomen without contrast', 'non-contrast abdomen']),
  ct('CT-KUB', 'CT kidneys, ureters and bladder (low dose)', 'urinary tract', 'T-30355', 385000, 15, 'none', false, ['kub', 'renal colic', 'kidney stone', 'ureteric calculus', 'urinary tract']),
  ct('CT-ANGIO-CAROTID', 'CT angiogram carotids', 'carotid arteries', 'T-30360', 560000, 25, 'required', false, ['carotid angiogram', 'cta carotid', 'carotid ct']),
  ct('CT-KNEE', 'CT knee', 'knee', 'T-30370', 330000, 15, 'none', true, ['knee ct']),
  ct('CT-FACIAL', 'CT facial bones', 'facial bones', 'T-30323', 300000, 15, 'none', false, ['facial bones', 'orbit', 'mandible', 'zygoma']),
  // MRI
  mr('MR-BRAIN', 'MRI brain without contrast', 'brain', '35100', 720000, 30, 'none', false, ['mri brain', 'mri head', 'brain mri']),
  mr('MR-BRAIN-C', 'MRI brain with contrast', 'brain', 'T-30421', 880000, 45, 'required', false, ['mri brain with contrast', 'gadolinium brain']),
  mr('MR-LSPINE', 'MRI lumbar spine', 'lumbar spine', '35110', 760000, 30, 'none', false, ['mri lumbar', 'lumbar spine mri', 'l-spine mri', 'lumbar']),
  mr('MR-CSPINE', 'MRI cervical spine', 'cervical spine', 'T-30431', 760000, 30, 'none', false, ['mri cervical', 'cervical spine mri', 'c-spine mri']),
  mr('MR-KNEE', 'MRI knee', 'knee', '35120', 690000, 30, 'none', true, ['mri knee', 'knee mri', 'meniscus', 'cruciate']),
  mr('MR-SHOULDER', 'MRI shoulder', 'shoulder', 'T-30441', 690000, 30, 'none', true, ['mri shoulder', 'rotator cuff', 'shoulder mri']),
  mr('MR-ANKLE', 'MRI ankle', 'ankle', 'T-30442', 680000, 30, 'none', true, ['mri ankle', 'ankle mri', 'achilles']),
  mr('MR-HIP', 'MRI hip', 'hip', 'T-30443', 700000, 30, 'none', true, ['mri hip', 'hip mri', 'labral']),
  mr('MR-ABDO', 'MRI abdomen', 'abdomen', 'T-30450', 820000, 45, 'optional', false, ['mri abdomen', 'liver mri', 'mrcp']),
  mr('MR-PROSTATE', 'MRI prostate, multiparametric', 'prostate', 'T-30455', 890000, 45, 'optional', false, ['prostate mri', 'mpmri', 'prostate']),
  mr('MR-BREAST', 'MRI breast', 'breast', 'T-30460', 900000, 45, 'required', false, ['breast mri']),
  // Ultrasound
  us('US-ABDO', 'Ultrasound abdomen', 'abdomen', '33020', 180000, 20, FAST4, false, ['ultrasound abdomen', 'abdominal ultrasound', 'sonar abdomen', 'liver ultrasound', 'gallbladder', 'ruq']),
  us('US-PELVIS', 'Ultrasound pelvis', 'pelvis', '33030', 175000, 20, FULLBLADDER, false, ['pelvic ultrasound', 'ultrasound pelvis', 'uterus', 'ovary']),
  us('US-OBSTETRIC', 'Ultrasound obstetric', 'obstetric', '33040', 195000, 25, NOPREP, false, ['obstetric', 'pregnancy scan', 'foetal', 'fetal', 'antenatal']),
  us('US-RENAL', 'Ultrasound kidneys and bladder', 'urinary tract', 'T-30612', 175000, 20, FULLBLADDER, false, ['renal ultrasound', 'kidney ultrasound', 'bladder ultrasound']),
  us('US-THYROID', 'Ultrasound thyroid', 'thyroid', 'T-30620', 165000, 20, NOPREP, false, ['thyroid', 'neck lump ultrasound', 'goitre']),
  us('US-BREAST', 'Ultrasound breast', 'breast', 'T-30621', 185000, 20, NOPREP, false, ['breast ultrasound', 'breast lump']),
  us('US-DOPPLER-LEG', 'Ultrasound Doppler, lower limb veins', 'lower limb veins', 'T-30630', 235000, 30, NOPREP, true, ['doppler', 'dvt', 'venous', 'leg veins', 'deep vein']),
  us('US-DOPPLER-CAROTID', 'Ultrasound Doppler, carotids', 'carotid arteries', 'T-30631', 240000, 30, NOPREP, false, ['carotid doppler', 'carotid ultrasound']),
  us('US-SOFT-TISSUE', 'Ultrasound soft tissue', 'soft tissue', 'T-30640', 155000, 15, NOPREP, true, ['soft tissue ultrasound', 'lump ultrasound', 'ganglion']),
  us('US-SCROTUM', 'Ultrasound scrotum', 'scrotum', 'T-30613', 175000, 20, NOPREP, false, ['scrotal', 'testis', 'testicular']),
  // Mammography and DXA
  { code: 'MG-SCREEN', description: 'Screening mammogram, bilateral', modality: 'MG', bodyPart: 'breast', tariffCode: '39120', tariffCents: 265000, cashCents: 225000, durationMin: 20, prep: 'Do not use deodorant or talc on the day.', contrast: 'none', authFlag: false, ionising: true, lateralityRequired: false, keywords: ['screening mammogram', 'mammogram', 'mammography', 'routine mammogram'], safetySets: ['ionising'] },
  { code: 'MG-DIAG', description: 'Diagnostic mammogram with tomosynthesis', modality: 'MG', bodyPart: 'breast', tariffCode: 'T-30511', tariffCents: 320000, cashCents: 270000, durationMin: 30, prep: 'Do not use deodorant or talc on the day.', contrast: 'none', authFlag: true, ionising: true, lateralityRequired: false, keywords: ['diagnostic mammogram', 'tomosynthesis', 'breast lump mammogram'], safetySets: ['ionising'] },
  { code: 'DXA-SPINE-HIP', description: 'Bone densitometry, spine and hip', modality: 'DXA', bodyPart: 'spine and hip', tariffCode: '39200', tariffCents: 195000, cashCents: 165000, durationMin: 20, prep: 'No calcium supplements on the day.', contrast: 'none', authFlag: false, ionising: true, lateralityRequired: false, keywords: ['bone density', 'densitometry', 'dexa', 'dxa', 'osteoporosis'], safetySets: ['ionising'] },
  { code: 'DXA-BODY', description: 'Body composition, DXA', modality: 'DXA', bodyPart: 'whole body', tariffCode: 'T-30711', tariffCents: 165000, cashCents: 140000, durationMin: 20, prep: NOPREP, contrast: 'none', authFlag: false, ionising: true, lateralityRequired: false, keywords: ['body composition', 'whole body dxa'], safetySets: ['ionising'] },
];
