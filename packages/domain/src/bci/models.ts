import type { BciFinding, BciPriority, BciResult } from './result.js';

/**
 * Demo models for Bonakala Clinical Intelligence. Every model here is deterministic (seeded by the
 * accession hash) and labelled demo:true. They exist so that the pipeline, the gates and the
 * monitoring can be exercised end to end; they are not diagnostic models (docs/22 §5, docs/23).
 */
export interface DemoModelDef {
  id: string;
  name: string;
  version: string;
  task: BciResult['task'];
  outputClass: 1 | 2 | 3 | 4;
  modalities: string[];
  bodyParts?: string[];
  vendor: string;
  samdStatus: string;
  /** Where the model runs by default (docs/22 §8). */
  compute: string;
  overlaysDefault: 'on' | 'off';
  description: string;
  validation: { dataset: string; n: number; sensitivity?: number; specificity?: number; auc?: number; ece?: number; subgroupFloor?: number; lastValidatedAt: string; readerStudy?: string };
  limitations: string[];
}

export const DEMO_MODELS: DemoModelDef[] = [
  { id: 'cxr-qc', name: 'BCI-QC-POSITION', version: '4.2.0', task: 'qc', outputClass: 4, modalities: ['DX', 'CR'], vendor: 'bonakala', samdStatus: 'assessed_not_a_medical_device', compute: 'edge', overlaysDefault: 'off', description: 'Positioning, collimation, exposure index and laterality marker checks on projection radiographs; runs on the Edge Gateway within seconds.', validation: { dataset: 'SA DX QC set v3', n: 4200, sensitivity: 0.88, specificity: 0.96, lastValidatedAt: '2026-01-15' }, limitations: ['portable films under-represented', 'paediatric positioning not validated'] },
  { id: 'cxr-triage', name: 'BCI-CXR-TRIAGE', version: '2.3.1', task: 'triage', outputClass: 4, modalities: ['DX', 'CR'], bodyParts: ['chest'], vendor: 'bonakala', samdStatus: 'registered_samd_MD-2025-0413', compute: 'cf-container-cpu', overlaysDefault: 'on', description: 'Chest radiograph triage priority for pneumothorax, large effusion, consolidation and TB-suggestive patterns. Raises worklist position only.', validation: { dataset: 'SA CXR held-out (2 unseen sites)', n: 9800, sensitivity: 0.95, specificity: 0.9, auc: 0.96, ece: 0.03, subgroupFloor: 0.9, lastValidatedAt: '2026-03-12', readerStudy: '6 radiologists, no accuracy loss' }, limitations: ['paediatric thymic shadow false positives', 'validated on DR-5, DR-6 and CR plates only'] },
  { id: 'cxr-findings', name: 'BCI-CXR-FINDINGS', version: '3.1.0', task: 'findings', outputClass: 1, modalities: ['DX', 'CR'], bodyParts: ['chest'], vendor: 'bonakala', samdStatus: 'registered_samd_MD-2025-0418', compute: 'gpu-cell-jhb', overlaysDefault: 'on', description: 'Findings candidates with localisation on chest radiographs, cardiothoracic ratio and nodule candidates. Accepted candidates become report text only through the radiologist.', validation: { dataset: 'SA CXR held-out', n: 9800, sensitivity: 0.91, specificity: 0.93, auc: 0.95, ece: 0.04, subgroupFloor: 0.88, lastValidatedAt: '2026-05-04', readerStudy: 'time to report -14 %' }, limitations: ['nodules under 6 mm', 'lateral view not used'] },
  { id: 'ct-head', name: 'BCI-CTH-ICH', version: '1.8.2', task: 'triage', outputClass: 1, modalities: ['CT'], bodyParts: ['head'], vendor: 'bonakala', samdStatus: 'registered_samd_MD-2024-1102', compute: 'gpu-cell-jhb', overlaysDefault: 'on', description: 'Intracranial haemorrhage triage and candidates with subtype, volume estimate and midline shift on non-contrast CT head.', validation: { dataset: 'SA CT head held-out', n: 3100, sensitivity: 0.96, specificity: 0.94, auc: 0.98, ece: 0.02, subgroupFloor: 0.92, lastValidatedAt: '2026-02-20' }, limitations: ['post-operative heads', 'motion-degraded studies'] },
  { id: 'msk-fracture', name: 'BCI-MSK-FRAC-APP', version: '1.0.0-rc2', task: 'findings', outputClass: 1, modalities: ['DX', 'CR'], bodyParts: ['limb', 'hand', 'knee', 'pelvis'], vendor: 'vendor-x', samdStatus: 'registered_samd_vendor_ref', compute: 'gpu-cell-jhb', overlaysDefault: 'on', description: 'Appendicular fracture candidates with a box per suspected fracture. Emits "no candidate found", never "normal".', validation: { dataset: 'shadow evaluation, 4 sites', n: 512, sensitivity: 0.91, specificity: 0.94, subgroupFloor: 0.85, lastValidatedAt: '2026-09-01' }, limitations: ['scaphoid weak (sens 0.74)', 'paediatric elbow out of scope'] },
  { id: 'mg-detect', name: 'BCI-MG-LESION', version: '1.2.0', task: 'findings', outputClass: 1, modalities: ['MG'], bodyParts: ['breast'], vendor: 'bonakala', samdStatus: 'registered_samd_MD-2025-0711', compute: 'gpu-cell-jhb', overlaysDefault: 'off', description: 'Second-reader support for mammography: lesion candidates, density category. Overlays are off until the radiologist records the unaided read.', validation: { dataset: 'SA MG held-out', n: 6100, sensitivity: 0.89, specificity: 0.92, auc: 0.94, ece: 0.05, subgroupFloor: 0.85, lastValidatedAt: '2026-07-22' }, limitations: ['implant-displaced views', 'tomosynthesis stacks (2D only)'] },
  { id: 'us-qc', name: 'BCI-US-QC', version: '0.9.1', task: 'qc', outputClass: 4, modalities: ['US'], vendor: 'bonakala', samdStatus: 'assessed_not_a_medical_device', compute: 'edge', overlaysDefault: 'off', description: 'Plane recognition and missing standard views checklist for abdominal and obstetric ultrasound at the console.', validation: { dataset: 'SA US plane set', n: 2800, sensitivity: 0.84, specificity: 0.9, lastValidatedAt: '2026-06-10' }, limitations: ['obstetric third trimester', 'vendor Z presets'] },
  { id: 'consistency', name: 'BCI-CONSIST', version: '1.1.0', task: 'consistency', outputClass: 4, modalities: ['*'], vendor: 'bonakala', samdStatus: 'not_a_medical_device', compute: 'cf-container-cpu', overlaysDefault: 'off', description: 'Pre-sign consistency check: laterality words versus study, body part versus study, accepted candidates versus findings text, rejected candidates leaking into text. Warnings to the signing radiologist only.', validation: { dataset: 'rule pack, 1 200 signed reports', n: 1200, lastValidatedAt: '2026-08-02' }, limitations: ['English text only'] },
  { id: 'dose-outlier', name: 'BCI-DOSE-OUTLIER', version: '1.3.0', task: 'dose', outputClass: 4, modalities: ['CT', 'DX', 'CR', 'MG', 'DXA'], vendor: 'bonakala', samdStatus: 'not_a_medical_device', compute: 'cf-container-cpu', overlaysDefault: 'off', description: 'Dose outliers versus the DRL and the site distribution with a likely cause, to RAD, CMP and BIO.', validation: { dataset: 'dose records 12 months', n: 41000, lastValidatedAt: '2026-08-30' }, limitations: ['size class from weight only'] },
];

export function getDemoModel(id: string): DemoModelDef | undefined {
  return DEMO_MODELS.find((m) => m.id === id);
}

/** Routing rules (docs/22 §4.1): which models run for a study, in order. */
export function routeModels(modality: string, bodyPart: string): string[] {
  const out: string[] = [];
  for (const m of DEMO_MODELS) {
    if (m.task === 'consistency' || m.task === 'dose') continue;
    if (!m.modalities.includes(modality) && !m.modalities.includes('*')) continue;
    if (m.bodyParts && !m.bodyParts.includes(bodyPart)) continue;
    out.push(m.id);
  }
  return out;
}

/* ---------- deterministic helpers ---------- */
/** FNV-1a 32-bit hash; stable across runtimes. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export function seededRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DemoModelInput {
  studyUid: string;
  accession: string;
  modality: string;
  bodyPart: string;
  procedureCode: string;
  laterality?: string | null;
  ageYears?: number | null;
  sex?: string | null;
  seriesUids: string[];
  instanceCount?: number;
  orderPriority?: string | null;
  createdAt?: string;
}

function base(m: DemoModelDef, input: DemoModelInput, rng: () => number): BciResult {
  return {
    schema: 'bci.result.v1',
    study_uid: input.studyUid,
    series_uids: input.seriesUids,
    input_hash: `sha256:${hashString(input.accession + '|' + input.studyUid).toString(16).padStart(8, '0')}${hashString(m.id + input.accession).toString(16).padStart(8, '0')}`,
    model: { id: m.id, version: m.version, vendor: m.vendor, samd_status: m.samdStatus },
    output_class: m.outputClass,
    task: m.task,
    findings: [],
    limitations: m.limitations,
    latency_ms: Math.round(m.compute === 'edge' ? 800 + rng() * 2500 : m.compute === 'gpu-cell-jhb' ? 4000 + rng() * 9000 : 1500 + rng() * 4000),
    compute: m.compute,
    created_at: input.createdAt ?? new Date().toISOString(),
    demo: true,
  };
}

function finding(code: string, display: string, score: number, threshold: number, extra: Partial<BciFinding> = {}): BciFinding {
  return { code, display, score: r2(score), calibrated_probability: r2(Math.min(1, Math.max(0, score * 0.96))), threshold, flag: score >= threshold, ...extra };
}
function bbox(rng: () => number, region: [number, number, number, number]): BciFinding['localisation'] {
  const [x, y, w, h] = region;
  return { type: 'bbox', bbox: [r2(x + rng() * 0.04), r2(y + rng() * 0.04), r2(w), r2(h)], ref: 0 };
}

/**
 * Run a demo model. The same accession always produces the same output; the population is varied
 * (some P1 pneumothorax and ICH cases) so worklists and monitoring look real.
 */
export function runDemoModel(modelId: string, input: DemoModelInput): BciResult {
  const m = getDemoModel(modelId);
  if (!m) throw new Error(`Unknown demo model ${modelId}`);
  const rng = seededRng(hashString(`${modelId}|${input.accession}`));
  const res = base(m, input, rng);
  const roll = rng();
  const side = (input.laterality === 'L' || input.laterality === 'R' ? input.laterality : rng() < 0.5 ? 'R' : 'L') as 'L' | 'R';
  const stat = input.orderPriority === 'stat';

  switch (modelId) {
    case 'cxr-qc': {
      const issues: string[] = [];
      const f: BciFinding[] = [];
      const rot = rng();
      f.push(finding('rotation', 'Rotation', rot < 0.12 ? 0.7 + rng() * 0.25 : rng() * 0.3, 0.6, { candidate_text: 'Patient rotated to the right; consider repeat if clinically limiting.' }));
      f.push(finding('exposure_index', 'Exposure index deviation', rng() < 0.15 ? 0.65 + rng() * 0.3 : rng() * 0.4, 0.6, { measurements: [{ name: 'exposure_index', value: Math.round(260 + rng() * 120) }, { name: 'target_index', value: 300 }] }));
      f.push(finding('motion', 'Motion blur', rng() < 0.06 ? 0.75 + rng() * 0.2 : rng() * 0.2, 0.6));
      f.push(finding('clipped_anatomy', 'Costophrenic angles clipped', rng() < 0.08 ? 0.7 + rng() * 0.25 : rng() * 0.25, 0.6));
      const markerOk = rng() > 0.05;
      f.push(finding('laterality_marker', 'Laterality marker present', markerOk ? 0.92 + rng() * 0.07 : 0.2 + rng() * 0.2, 0.6, { laterality: side }));
      for (const x of f) if (x.flag && x.code !== 'laterality_marker') issues.push(x.code);
      if (!markerOk) issues.push('laterality_marker_missing');
      const usable = !issues.includes('motion') && !issues.includes('clipped_anatomy');
      res.findings = f;
      res.quality = { usable, issues };
      res.consistency = [{ check: 'laterality_marker_vs_tag', status: markerOk ? 'pass' : 'warn', detail: markerOk ? `${side} marker detected, matches order` : 'No laterality marker detected; confirm before release' }];
      res.triage = usable ? undefined : { priority: 'P4', reason: issues };
      break;
    }
    case 'cxr-triage': {
      const f: BciFinding[] = [];
      let priority: BciPriority = 'P3';
      const reasons: string[] = [];
      const ptx = roll < 0.06 ? 0.82 + rng() * 0.16 : rng() * 0.3;
      const eff = rng() < 0.09 ? 0.7 + rng() * 0.25 : rng() * 0.35;
      const cons = rng() < 0.13 ? 0.65 + rng() * 0.3 : rng() * 0.4;
      const tb = rng() < 0.08 ? 0.62 + rng() * 0.3 : rng() * 0.35;
      f.push(finding('pneumothorax', 'Pneumothorax', ptx, 0.6, { laterality: side, severity_hint: ptx >= 0.6 ? (ptx > 0.9 ? 'moderate' : 'small') : null, localisation: ptx >= 0.6 ? bbox(rng, side === 'R' ? [0.28, 0.18, 0.15, 0.17] : [0.57, 0.18, 0.15, 0.17]) : undefined, measurements: ptx >= 0.6 ? [{ name: 'apical_lung_distance_mm', value: Math.round(12 + rng() * 25), unit: 'mm' }] : undefined }));
      f.push(finding('pleural_effusion', 'Pleural effusion', eff, 0.6, { laterality: side, severity_hint: eff >= 0.6 ? (eff > 0.85 ? 'large' : 'moderate') : null, localisation: eff >= 0.6 ? bbox(rng, side === 'R' ? [0.24, 0.62, 0.2, 0.14] : [0.56, 0.62, 0.2, 0.14]) : undefined }));
      f.push(finding('consolidation', 'Consolidation', cons, 0.6, { laterality: side, localisation: cons >= 0.6 ? bbox(rng, side === 'R' ? [0.27, 0.42, 0.18, 0.18] : [0.55, 0.42, 0.18, 0.18]) : undefined }));
      f.push(finding('tb_pattern', 'TB-suggestive pattern (upper-lobe fibro-nodular change)', tb, 0.6, { laterality: 'B', localisation: tb >= 0.6 ? bbox(rng, [0.3, 0.16, 0.4, 0.2]) : undefined }));
      if (ptx >= 0.6) { priority = 'P1'; reasons.push('pneumothorax'); }
      if (eff >= 0.85) { priority = priority === 'P1' ? 'P1' : 'P2'; reasons.push('large_effusion'); }
      else if (eff >= 0.6) { if (priority === 'P3') priority = 'P2'; reasons.push('pleural_effusion'); }
      if (cons >= 0.6) { if (priority === 'P3') priority = 'P2'; reasons.push('consolidation'); }
      if (tb >= 0.6) { if (priority === 'P3') priority = 'P2'; reasons.push('tb_pattern'); }
      if (stat) priority = 'P1';
      res.findings = f;
      res.triage = { priority, reason: reasons.length ? reasons : ['no_critical_candidate'] };
      break;
    }
    case 'cxr-findings': {
      // Reuse the triage draw so findings and triage agree for the same study.
      const tri = runDemoModel('cxr-triage', input);
      const f: BciFinding[] = tri.findings.map((x) => ({ ...x, candidate_text: candidateText(x, side) }));
      const ctr = r2(0.38 + rng() * 0.18);
      f.push(finding('cardiomegaly', 'Cardiomegaly', ctr > 0.5 ? 0.6 + (ctr - 0.5) * 3 : ctr * 0.6, 0.6, { measurements: [{ name: 'cardiothoracic_ratio', value: ctr }], candidate_text: ctr > 0.5 ? `Cardiomegaly with a cardiothoracic ratio of ${ctr.toFixed(2)}.` : `Cardiothoracic ratio ${ctr.toFixed(2)}, within normal limits.` }));
      const nod = rng() < 0.07 ? 0.62 + rng() * 0.3 : rng() * 0.3;
      f.push(finding('nodule', 'Pulmonary nodule', nod, 0.6, { laterality: side, localisation: nod >= 0.6 ? bbox(rng, side === 'R' ? [0.33, 0.35, 0.07, 0.07] : [0.6, 0.35, 0.07, 0.07]) : undefined, measurements: nod >= 0.6 ? [{ name: 'longest_diameter_mm', value: Math.round(6 + rng() * 12), unit: 'mm' }] : undefined, candidate_text: nod >= 0.6 ? `${side === 'R' ? 'Right' : 'Left'} mid-zone pulmonary nodule candidate; CT correlation may be considered.` : undefined }));
      res.findings = f;
      res.triage = tri.triage;
      break;
    }
    case 'ct-head': {
      const ich = roll < 0.07 ? 0.8 + rng() * 0.19 : rng() * 0.25;
      const subtype = ['subdural', 'intraparenchymal', 'subarachnoid', 'extradural'][Math.floor(rng() * 4)]!;
      const vol = Math.round(8 + rng() * 45);
      const shift = ich >= 0.6 ? r2(rng() * 9) : 0;
      res.findings = [
        finding('intracranial_haemorrhage', 'Intracranial haemorrhage', ich, 0.6, { laterality: side, severity_hint: ich >= 0.6 ? (vol > 30 ? 'large' : 'moderate') : null, localisation: ich >= 0.6 ? bbox(rng, side === 'R' ? [0.3, 0.35, 0.16, 0.18] : [0.54, 0.35, 0.16, 0.18]) : undefined, measurements: ich >= 0.6 ? [{ name: 'haemorrhage_volume_ml', value: vol, unit: 'ml' }, { name: 'midline_shift_mm', value: shift, unit: 'mm' }] : undefined, candidate_text: ich >= 0.6 ? `${side === 'R' ? 'Right' : 'Left'}-sided ${subtype} haemorrhage candidate, estimated volume ${vol} ml, midline shift ${shift} mm.` : undefined }),
        finding('skull_fracture', 'Skull fracture', rng() < 0.05 ? 0.7 + rng() * 0.2 : rng() * 0.2, 0.6),
        finding('hydrocephalus', 'Hydrocephalus hint', rng() < 0.03 ? 0.65 + rng() * 0.2 : rng() * 0.2, 0.6),
      ];
      const priority: BciPriority = ich >= 0.6 || stat ? 'P1' : res.findings.some((x) => x.flag) ? 'P2' : 'P3';
      res.triage = { priority, reason: res.findings.filter((x) => x.flag).map((x) => x.code).concat(priority === 'P3' ? ['no_critical_candidate'] : []) };
      break;
    }
    case 'msk-fracture': {
      const fr = roll < 0.24 ? 0.66 + rng() * 0.3 : rng() * 0.4;
      res.findings = [finding('fracture', 'Fracture candidate', fr, 0.55, { laterality: side, localisation: fr >= 0.55 ? bbox(rng, [0.4, 0.4, 0.14, 0.12]) : undefined, candidate_text: fr >= 0.55 ? `Cortical discontinuity in keeping with a fracture candidate (${side === 'R' ? 'right' : 'left'} ${input.bodyPart}).` : undefined })];
      res.triage = { priority: fr >= 0.55 ? 'P2' : 'P3', reason: fr >= 0.55 ? ['fracture'] : ['no_candidate_found'] };
      break;
    }
    case 'mg-detect': {
      const les = roll < 0.1 ? 0.62 + rng() * 0.3 : rng() * 0.35;
      const density = ['a', 'b', 'c', 'd'][Math.floor(rng() * 4)]!;
      res.findings = [
        finding('mass', 'Mass candidate', les, 0.6, { laterality: side, localisation: les >= 0.6 ? bbox(rng, [0.45, 0.38, 0.1, 0.1]) : undefined, measurements: les >= 0.6 ? [{ name: 'longest_diameter_mm', value: Math.round(6 + rng() * 14), unit: 'mm' }] : undefined, candidate_text: les >= 0.6 ? `${side === 'R' ? 'Right' : 'Left'} breast mass candidate, upper outer quadrant.` : undefined }),
        finding('calcification_cluster', 'Calcification cluster', rng() < 0.06 ? 0.65 + rng() * 0.25 : rng() * 0.3, 0.6, { laterality: side }),
        finding('density', `Density category ${density}`, 0.9, 0.5, { candidate_text: `Breast density category ${density}.` }),
      ];
      res.triage = { priority: les >= 0.6 ? 'P2' : 'P3', reason: les >= 0.6 ? ['mass'] : ['no_candidate_found'] };
      break;
    }
    case 'us-qc': {
      const missing = rng() < 0.18 ? ['right kidney long axis'] : [];
      if (rng() < 0.08) missing.push('spleen');
      res.findings = [finding('missing_views', 'Missing standard views', missing.length ? 0.8 : 0.1, 0.6, { candidate_text: missing.length ? `Missing standard views: ${missing.join(', ')}.` : undefined })];
      res.quality = { usable: true, issues: missing.map((x) => `missing:${x}`) };
      res.triage = { priority: missing.length ? 'P4' : 'P3', reason: missing.length ? ['missing_views'] : ['complete'] };
      break;
    }
    default:
      throw new Error(`Model ${modelId} is not run per study`);
  }
  return res;
}

function candidateText(x: BciFinding, side: 'L' | 'R'): string | undefined {
  if (!x.flag) return undefined;
  const s = side === 'R' ? 'right' : 'left';
  const m = x.measurements?.[0];
  switch (x.code) {
    case 'pneumothorax': return `${x.severity_hint === 'moderate' ? 'Moderate' : 'Small'} ${s} apical pneumothorax candidate${m ? `, apex-to-cupola distance approximately ${m.value} mm` : ''}. No tension features identified by the model.`;
    case 'pleural_effusion': return `${x.severity_hint === 'large' ? 'Large' : 'Moderate'} ${s} pleural effusion candidate.`;
    case 'consolidation': return `Air-space consolidation candidate in the ${s} lower zone.`;
    case 'tb_pattern': return 'Bilateral upper-lobe fibro-nodular change: features that may be associated with tuberculosis; clinical and microbiological correlation is required.';
    default: return `${x.display} candidate.`;
  }
}

/* ---------- consistency checker (Class 4 warnings to the signing radiologist) ---------- */
export interface ConsistencyInput {
  accession: string;
  studyUid: string;
  modality: string;
  bodyPart: string;
  laterality?: string | null;
  sex?: string | null;
  ageYears?: number | null;
  priorsCount: number;
  sections: Record<string, string>;
  candidates: Array<{ code: string; display: string; laterality?: string; decision: 'accepted' | 'edited' | 'rejected' | 'pending'; flag: boolean }>;
}
export function runConsistencyCheck(input: ConsistencyInput): BciResult {
  const m = getDemoModel('consistency')!;
  const rng = seededRng(hashString(`consistency|${input.accession}`));
  const res = base(m, { studyUid: input.studyUid, accession: input.accession, modality: input.modality, bodyPart: input.bodyPart, procedureCode: '', seriesUids: [] }, rng);
  const text = Object.values(input.sections).join('\n').toLowerCase();
  const findings = (input.sections.findings ?? '').toLowerCase() + ' ' + (input.sections.impression ?? '').toLowerCase();
  const checks: NonNullable<BciResult['consistency']> = [];
  // Laterality words versus study laterality
  if (input.laterality === 'L' || input.laterality === 'R') {
    const other = input.laterality === 'L' ? /\bright\b/ : /\bleft\b/;
    const same = input.laterality === 'L' ? /\bleft\b/ : /\bright\b/;
    if (other.test(findings) && !same.test(findings)) checks.push({ check: 'laterality_words_vs_study', status: 'fail', detail: `The study is labelled ${input.laterality === 'L' ? 'left' : 'right'} but the text only mentions the other side` });
    else checks.push({ check: 'laterality_words_vs_study', status: 'pass', detail: 'Laterality words match the study label' });
  }
  // Body part versus study
  const bp: Record<string, RegExp> = { chest: /chest|lung|pleura|cardio|thorac/, head: /brain|intracranial|skull|cerebr|ventric/, abdomen: /abdom|liver|kidney|bowel|renal|spleen/, spine: /spine|vertebr|disc|lumbar|cervical/, breast: /breast|mammo/, knee: /knee|menisc|ligament/, hand: /wrist|hand|carpal|scaphoid/, limb: /ankle|shoulder|femur|tibia|humer|fibula|limb/, pelvis: /pelvi|hip|femoral|acetab/, neck: /thyroid|neck/, obstetric: /fetal|foetal|gestation|placenta/ };
  const re = bp[input.bodyPart];
  if (re) checks.push(re.test(findings) ? { check: 'body_part_vs_study', status: 'pass', detail: `Text refers to the ${input.bodyPart}` } : { check: 'body_part_vs_study', status: 'warn', detail: `Findings do not mention the ${input.bodyPart}; confirm the correct study is open` });
  // Accepted candidates mentioned; rejected candidates absent
  for (const c of input.candidates) {
    const key = c.display.toLowerCase().split(' ')[0]!.replace(/[^a-z]/g, '');
    const mentioned = key.length > 3 && findings.includes(key);
    if ((c.decision === 'accepted' || c.decision === 'edited') && !mentioned) checks.push({ check: 'accepted_candidate_in_text', status: 'warn', detail: `Accepted candidate "${c.display}" is not mentioned in the findings` });
    if (c.decision === 'rejected' && mentioned && c.flag) checks.push({ check: 'rejected_candidate_in_text', status: 'warn', detail: `Rejected candidate "${c.display}" appears in the findings text` });
    if (c.decision === 'pending' && c.flag) checks.push({ check: 'undecided_candidate', status: 'fail', detail: `Candidate "${c.display}" has no accept, edit or reject decision` });
  }
  if (input.priorsCount > 0 && !/compar|prior|previous/.test(text)) checks.push({ check: 'comparison_when_prior_exists', status: 'warn', detail: `${input.priorsCount} prior study available but no comparison statement` });
  if (input.sex === 'M' && /pregnan|uter|ovar/.test(findings)) checks.push({ check: 'sex_vs_text', status: 'warn', detail: 'Text mentions female organs for a patient recorded as male' });
  if (!(input.sections.impression ?? '').trim()) checks.push({ check: 'impression_present', status: 'fail', detail: 'Impression section is empty' });
  if (!(input.sections.findings ?? '').trim()) checks.push({ check: 'findings_present', status: 'fail', detail: 'Findings section is empty' });
  res.consistency = checks;
  res.latency_ms = Math.round(120 + rng() * 300);
  return res;
}

/* ---------- dose outlier (Class 4, to RPO/CMP) ---------- */
export interface DoseOutlierInput { accession: string; studyUid: string; modality: string; protocolCode: string; value: number; drl: number; sizeClass?: string; repeats?: number }
export function runDoseOutlier(input: DoseOutlierInput): BciResult & { ratio: number; outlier: boolean; cause: string } {
  const m = getDemoModel('dose-outlier')!;
  const rng = seededRng(hashString(`dose|${input.accession}`));
  const res = base(m, { studyUid: input.studyUid, accession: input.accession, modality: input.modality, bodyPart: '', procedureCode: input.protocolCode, seriesUids: [] }, rng);
  const ratio = input.drl > 0 ? r2(input.value / input.drl) : 0;
  const outlier = ratio > 1;
  let cause = 'within reference';
  if (outlier) cause = (input.repeats ?? 0) > 0 ? 'repeat exposure' : input.sizeClass === 'large' ? 'large patient (size class)' : ratio > 1.6 ? 'extended scan range or wrong protocol' : 'above DRL; review technique';
  res.findings = [{ code: 'dose_outlier', display: 'Dose above reference level', score: Math.min(1, r2(ratio / 2)), threshold: 0.5, flag: outlier, measurements: [{ name: 'ratio_to_drl', value: ratio }], candidate_text: undefined }];
  res.latency_ms = Math.round(40 + rng() * 60);
  return { ...res, ratio, outlier, cause };
}
