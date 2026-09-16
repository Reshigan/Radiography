/**
 * Illustrative procedure catalogue used by the acquisition, imaging and BCI modules and the seeds.
 * Codes are illustrative tariff-style codes (docs/00 §5.6): the Platform stores them as reference data.
 */
export type ModalityType = 'DX' | 'CT' | 'MR' | 'US' | 'MG' | 'DXA';
export type BodyPart = 'chest' | 'abdomen' | 'head' | 'spine' | 'limb' | 'pelvis' | 'breast' | 'neck' | 'hand' | 'knee' | 'obstetric';

export interface ProcedureDef {
  code: string;
  description: string;
  modality: ModalityType;
  roomType: string; // XR | CT | MR | US | MG | DXA
  bodyPart: BodyPart;
  laterality?: boolean;
  contrast?: boolean;
  /** Typical series and instance counts used by the modality simulator. */
  series: Array<{ description: string; instances: number; view?: string }>;
  /** Dose quantity produced (none for MR/US). */
  doseQuantity?: 'DLP' | 'DAP' | 'AGD';
  /** Typical dose value (median) in the quantity's unit; the simulator spreads around it. */
  doseTypical?: number;
  /** Diagnostic reference level (illustrative, per docs/processes/05 §10.2). */
  drl?: number;
  rvu: number;
}

export const PROCEDURES: ProcedureDef[] = [
  { code: '30110', description: 'Chest X-ray PA and lateral', modality: 'DX', roomType: 'XR', bodyPart: 'chest', series: [{ description: 'PA', instances: 1, view: 'PA' }, { description: 'Lateral', instances: 1, view: 'LAT' }], doseQuantity: 'DAP', doseTypical: 0.12, drl: 0.3, rvu: 0.4 },
  { code: '30111', description: 'Chest X-ray AP portable', modality: 'DX', roomType: 'XR', bodyPart: 'chest', series: [{ description: 'AP portable', instances: 1, view: 'AP' }], doseQuantity: 'DAP', doseTypical: 0.15, drl: 0.3, rvu: 0.4 },
  { code: '30210', description: 'Abdomen X-ray supine and erect', modality: 'DX', roomType: 'XR', bodyPart: 'abdomen', series: [{ description: 'Supine', instances: 1, view: 'AP' }, { description: 'Erect', instances: 1, view: 'AP' }], doseQuantity: 'DAP', doseTypical: 1.8, drl: 3.0, rvu: 0.5 },
  { code: '30310', description: 'Lumbar spine X-ray AP and lateral', modality: 'DX', roomType: 'XR', bodyPart: 'spine', series: [{ description: 'AP', instances: 1, view: 'AP' }, { description: 'Lateral', instances: 1, view: 'LAT' }], doseQuantity: 'DAP', doseTypical: 1.5, drl: 2.5, rvu: 0.5 },
  { code: '30320', description: 'Cervical spine X-ray', modality: 'DX', roomType: 'XR', bodyPart: 'spine', series: [{ description: 'AP', instances: 1, view: 'AP' }, { description: 'Lateral', instances: 1, view: 'LAT' }, { description: 'Odontoid', instances: 1, view: 'AP' }], doseQuantity: 'DAP', doseTypical: 0.3, drl: 0.6, rvu: 0.5 },
  { code: '30410', description: 'Wrist X-ray', modality: 'DX', roomType: 'XR', bodyPart: 'hand', laterality: true, series: [{ description: 'PA', instances: 1, view: 'PA' }, { description: 'Lateral', instances: 1, view: 'LAT' }], doseQuantity: 'DAP', doseTypical: 0.02, drl: 0.05, rvu: 0.35 },
  { code: '30420', description: 'Ankle X-ray', modality: 'DX', roomType: 'XR', bodyPart: 'limb', laterality: true, series: [{ description: 'AP', instances: 1, view: 'AP' }, { description: 'Mortise', instances: 1, view: 'AP' }, { description: 'Lateral', instances: 1, view: 'LAT' }], doseQuantity: 'DAP', doseTypical: 0.03, drl: 0.08, rvu: 0.35 },
  { code: '30430', description: 'Knee X-ray', modality: 'DX', roomType: 'XR', bodyPart: 'knee', laterality: true, series: [{ description: 'AP', instances: 1, view: 'AP' }, { description: 'Lateral', instances: 1, view: 'LAT' }], doseQuantity: 'DAP', doseTypical: 0.05, drl: 0.12, rvu: 0.35 },
  { code: '30440', description: 'Hip and pelvis X-ray', modality: 'DX', roomType: 'XR', bodyPart: 'pelvis', laterality: true, series: [{ description: 'AP pelvis', instances: 1, view: 'AP' }, { description: 'Lateral hip', instances: 1, view: 'LAT' }], doseQuantity: 'DAP', doseTypical: 1.6, drl: 3.0, rvu: 0.45 },
  { code: '30450', description: 'Shoulder X-ray', modality: 'DX', roomType: 'XR', bodyPart: 'limb', laterality: true, series: [{ description: 'AP', instances: 1, view: 'AP' }, { description: 'Axial', instances: 1, view: 'AX' }], doseQuantity: 'DAP', doseTypical: 0.1, drl: 0.25, rvu: 0.35 },
  { code: '30460', description: 'Hand X-ray (bone age)', modality: 'DX', roomType: 'XR', bodyPart: 'hand', laterality: true, series: [{ description: 'PA left hand', instances: 1, view: 'PA' }], doseQuantity: 'DAP', doseTypical: 0.01, drl: 0.03, rvu: 0.35 },
  { code: '31110', description: 'CT brain without contrast', modality: 'CT', roomType: 'CT', bodyPart: 'head', series: [{ description: 'Scout', instances: 2 }, { description: 'Axial 5 mm', instances: 32 }, { description: 'Thin 0.625 mm', instances: 160 }], doseQuantity: 'DLP', doseTypical: 640, drl: 900, rvu: 1.0 },
  { code: '31120', description: 'CT chest with contrast', modality: 'CT', roomType: 'CT', bodyPart: 'chest', contrast: true, series: [{ description: 'Scout', instances: 2 }, { description: 'Axial soft 2 mm', instances: 180 }, { description: 'Lung window', instances: 180 }], doseQuantity: 'DLP', doseTypical: 380, drl: 600, rvu: 1.4 },
  { code: '31125', description: 'CT pulmonary angiogram', modality: 'CT', roomType: 'CT', bodyPart: 'chest', contrast: true, series: [{ description: 'Scout', instances: 2 }, { description: 'CTPA 1 mm', instances: 300 }], doseQuantity: 'DLP', doseTypical: 420, drl: 650, rvu: 1.6 },
  { code: '31130', description: 'CT abdomen and pelvis with contrast', modality: 'CT', roomType: 'CT', bodyPart: 'abdomen', contrast: true, series: [{ description: 'Scout', instances: 2 }, { description: 'Portal venous 2 mm', instances: 260 }, { description: 'Delayed', instances: 120 }], doseQuantity: 'DLP', doseTypical: 720, drl: 1000, rvu: 1.6 },
  { code: '31135', description: 'CT KUB (non-contrast)', modality: 'CT', roomType: 'CT', bodyPart: 'abdomen', series: [{ description: 'Scout', instances: 2 }, { description: 'Axial 3 mm', instances: 200 }], doseQuantity: 'DLP', doseTypical: 450, drl: 700, rvu: 1.2 },
  { code: '31140', description: 'CT cervical spine', modality: 'CT', roomType: 'CT', bodyPart: 'spine', series: [{ description: 'Scout', instances: 2 }, { description: 'Axial bone', instances: 220 }, { description: 'Sagittal MPR', instances: 60 }], doseQuantity: 'DLP', doseTypical: 480, drl: 750, rvu: 1.2 },
  { code: '31150', description: 'CT sinuses', modality: 'CT', roomType: 'CT', bodyPart: 'head', series: [{ description: 'Scout', instances: 2 }, { description: 'Coronal bone', instances: 90 }], doseQuantity: 'DLP', doseTypical: 150, drl: 300, rvu: 0.9 },
  { code: '32110', description: 'MRI brain', modality: 'MR', roomType: 'MR', bodyPart: 'head', series: [{ description: 'T1 sagittal', instances: 24 }, { description: 'T2 axial', instances: 28 }, { description: 'FLAIR', instances: 28 }, { description: 'DWI', instances: 28 }], rvu: 1.8 },
  { code: '32120', description: 'MRI lumbar spine', modality: 'MR', roomType: 'MR', bodyPart: 'spine', series: [{ description: 'T1 sagittal', instances: 15 }, { description: 'T2 sagittal', instances: 15 }, { description: 'T2 axial', instances: 30 }], rvu: 1.7 },
  { code: '32130', description: 'MRI knee', modality: 'MR', roomType: 'MR', bodyPart: 'knee', laterality: true, series: [{ description: 'PD FS sagittal', instances: 26 }, { description: 'PD coronal', instances: 24 }, { description: 'T2 axial', instances: 24 }], rvu: 1.6 },
  { code: '33110', description: 'Ultrasound abdomen', modality: 'US', roomType: 'US', bodyPart: 'abdomen', series: [{ description: 'Abdomen stills', instances: 14 }], rvu: 0.7 },
  { code: '33120', description: 'Ultrasound obstetric (growth)', modality: 'US', roomType: 'US', bodyPart: 'obstetric', series: [{ description: 'Obstetric stills', instances: 18 }], rvu: 0.8 },
  { code: '33130', description: 'Ultrasound thyroid', modality: 'US', roomType: 'US', bodyPart: 'neck', series: [{ description: 'Thyroid stills', instances: 10 }], rvu: 0.6 },
  { code: '33140', description: 'Ultrasound Doppler lower limb', modality: 'US', roomType: 'US', bodyPart: 'limb', laterality: true, series: [{ description: 'Doppler stills', instances: 16 }], rvu: 0.8 },
  { code: '34110', description: 'Mammography screening bilateral', modality: 'MG', roomType: 'MG', bodyPart: 'breast', series: [{ description: 'R CC', instances: 1, view: 'CC' }, { description: 'L CC', instances: 1, view: 'CC' }, { description: 'R MLO', instances: 1, view: 'MLO' }, { description: 'L MLO', instances: 1, view: 'MLO' }], doseQuantity: 'AGD', doseTypical: 1.6, drl: 2.5, rvu: 0.9 },
  { code: '34120', description: 'Mammography diagnostic with spot views', modality: 'MG', roomType: 'MG', bodyPart: 'breast', laterality: true, series: [{ description: 'CC', instances: 1, view: 'CC' }, { description: 'MLO', instances: 1, view: 'MLO' }, { description: 'Spot compression', instances: 2, view: 'CC' }], doseQuantity: 'AGD', doseTypical: 2.1, drl: 3.0, rvu: 1.0 },
  { code: '35110', description: 'DXA bone density spine and hip', modality: 'DXA', roomType: 'DXA', bodyPart: 'spine', series: [{ description: 'Lumbar spine', instances: 1 }, { description: 'Hip', instances: 1 }], doseQuantity: 'DAP', doseTypical: 0.002, drl: 0.01, rvu: 0.5 },
];

export function findProcedure(code: string): ProcedureDef | undefined {
  return PROCEDURES.find((p) => p.code === code);
}
export function proceduresForRoomType(roomType: string): ProcedureDef[] {
  return PROCEDURES.filter((p) => p.roomType === roomType);
}
export const IONISING_MODALITIES = new Set(['DX', 'CR', 'CT', 'MG', 'RF', 'DXA', 'PX']);
export function doseUnit(q: 'DLP' | 'DAP' | 'AGD' | undefined): string {
  return q === 'DLP' ? 'mGy·cm' : q === 'DAP' ? 'Gy·cm²' : q === 'AGD' ? 'mGy' : '';
}
