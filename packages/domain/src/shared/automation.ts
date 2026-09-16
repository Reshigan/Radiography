/** Automation levels from docs/00-conventions §6. */
export type AutomationLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
/** AI output classes from docs/12. Class 1 can never be published without a radiologist's acceptance. */
export type OutputClass = 1 | 2 | 3 | 4;

export interface Provenance {
  modelId: string;
  modelVersion: string;
  confidence?: number;
  outputClass: OutputClass;
  inputHash?: string;
  createdAt: string;
  compute?: string;
  demo?: boolean;
}
