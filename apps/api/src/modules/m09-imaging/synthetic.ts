import { hashString, seededRng } from '@bonakala/domain/bci';

export interface SyntheticImageSpec {
  modality: string;
  bodyPart: string;
  view?: string | null;
  laterality?: string | null;
  accession: string;
  instanceNumber: number;
  seriesDescription: string;
  patientLabel: string; // e.g. NAIDOO^P · F · 1997 (synthetic)
  /** Optional overlay hint: draws a subtle abnormality so demo overlays sit on something. */
  hint?: { code: string; bbox?: [number, number, number, number] } | null;
}

/**
 * Synthetic, clearly labelled demo images. They are SVG (512×512) so they render anywhere without
 * pixel pipelines; overlays are never burned in (M11-R-310): the viewer draws candidates separately.
 */
export function renderSyntheticImage(spec: SyntheticImageSpec): string {
  const rng = seededRng(hashString(`${spec.accession}|${spec.seriesDescription}|${spec.instanceNumber}`));
  const seed = Math.floor(rng() * 1000);
  const body = pickBody(spec, rng);
  const hint = spec.hint?.bbox ? `<rect x="${spec.hint.bbox[0] * 512}" y="${spec.hint.bbox[1] * 512}" width="${spec.hint.bbox[2] * 512}" height="${spec.hint.bbox[3] * 512}" fill="rgba(255,255,255,0.10)" rx="12"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.18"/></feComponentTransfer></filter>
<filter id="b"><feGaussianBlur stdDeviation="6"/></filter>
<radialGradient id="bg" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a2d30"/><stop offset="1" stop-color="#000"/></radialGradient>
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
${body}
${hint}
<rect width="512" height="512" filter="url(#n)" opacity="0.9"/>
<g font-family="IBM Plex Mono, monospace" font-size="11" fill="#cfd6d3" opacity="0.75">
<text x="256" y="500" text-anchor="middle">DEMO · synthetic image · not for diagnostic use</text>
<text x="486" y="270" text-anchor="middle" font-size="22" font-weight="600">${spec.laterality === 'L' ? 'L' : spec.laterality === 'R' ? 'R' : ''}</text>
</g>
</svg>`;
}

function pickBody(spec: SyntheticImageSpec, rng: () => number): string {
  const j = (n: number) => (rng() - 0.5) * n;
  switch (spec.modality) {
    case 'DX':
    case 'CR':
      if (spec.bodyPart === 'chest') return chest(rng, spec.view === 'LAT');
      if (spec.bodyPart === 'abdomen') return abdomenXr(rng);
      if (spec.bodyPart === 'spine') return spineXr(rng, spec.view === 'LAT');
      return limbXr(rng, spec.bodyPart);
    case 'CT':
      if (spec.bodyPart === 'head') return ctHead(rng, spec.instanceNumber);
      if (spec.bodyPart === 'spine') return ctSpine(rng);
      return ctBody(rng, spec.bodyPart === 'chest');
    case 'MR':
      if (spec.bodyPart === 'head') return `<g transform="translate(${j(6)} ${j(6)})">${ctHead(rng, spec.instanceNumber, true)}</g>`;
      if (spec.bodyPart === 'spine') return mrSpine(rng);
      return mrKnee(rng);
    case 'MG':
      return mammo(rng, spec.laterality === 'L', spec.view === 'MLO');
    case 'US':
      return ultrasound(rng);
    case 'DXA':
      return spineXr(rng, false);
    default:
      return chest(rng, false);
  }
}

function chest(rng: () => number, lateral: boolean): string {
  const r = (n: number) => (rng() - 0.5) * n;
  if (lateral) return `<ellipse cx="256" cy="280" rx="150" ry="190" fill="#23272a"/><rect x="330" y="80" width="26" height="380" rx="8" fill="#6b7073" opacity="0.7"/><ellipse cx="240" cy="290" rx="110" ry="150" fill="#101213" opacity="0.9" filter="url(#b)"/><ellipse cx="230" cy="330" rx="70" ry="60" fill="#3a3e41" opacity="0.8" filter="url(#b)"/>`;
  const ribs = Array.from({ length: 8 }, (_, i) => `<path d="M100 ${150 + i * 34} Q256 ${120 + i * 34 + r(6)} 412 ${150 + i * 34}" fill="none" stroke="#7d8286" stroke-width="5" opacity="0.45"/>`).join('');
  return `<ellipse cx="256" cy="300" rx="215" ry="235" fill="#2c3033"/>
<ellipse cx="170" cy="280" rx="88" ry="150" fill="#0b0d0e" opacity="0.92" filter="url(#b)"/>
<ellipse cx="342" cy="280" rx="88" ry="150" fill="#0b0d0e" opacity="0.92" filter="url(#b)"/>
${ribs}
<rect x="245" y="70" width="22" height="400" rx="6" fill="#8a8f92" opacity="0.6"/>
<ellipse cx="270" cy="330" rx="${72 + r(14)}" ry="72" fill="#4a4e51" opacity="0.85" filter="url(#b)"/>
<path d="M90 420 Q170 385 250 430" fill="none" stroke="#5c6164" stroke-width="10" opacity="0.7"/>
<path d="M262 430 Q340 380 420 420" fill="none" stroke="#5c6164" stroke-width="10" opacity="0.7"/>
<path d="M40 130 Q120 90 200 120" fill="none" stroke="#9a9fa2" stroke-width="12" opacity="0.6"/>
<path d="M312 120 Q392 90 472 130" fill="none" stroke="#9a9fa2" stroke-width="12" opacity="0.6"/>`;
}
function abdomenXr(rng: () => number): string {
  const loops = Array.from({ length: 6 }, (_, i) => `<ellipse cx="${160 + (i % 3) * 90}" cy="${190 + Math.floor(i / 3) * 100 + rng() * 20}" rx="${40 + rng() * 15}" ry="${30 + rng() * 12}" fill="#1a1d1f" opacity="0.8" filter="url(#b)"/>`).join('');
  return `<rect x="70" y="40" width="372" height="440" rx="120" fill="#33373a"/>${loops}<rect x="243" y="30" width="26" height="450" rx="8" fill="#8a8f92" opacity="0.55"/><path d="M110 440 Q256 380 402 440" fill="none" stroke="#9a9fa2" stroke-width="16" opacity="0.6"/>`;
}
function spineXr(rng: () => number, lateral: boolean): string {
  const bodies = Array.from({ length: 6 }, (_, i) => `<rect x="${lateral ? 200 : 214}" y="${70 + i * 66}" width="${lateral ? 100 : 84}" height="48" rx="8" fill="#a0a5a8" opacity="${0.75 + rng() * 0.2}"/><rect x="${lateral ? 200 : 214}" y="${118 + i * 66}" width="${lateral ? 100 : 84}" height="14" fill="#3a3e41" opacity="0.9"/>`).join('');
  return `<rect x="120" y="30" width="272" height="460" rx="80" fill="#26292c"/>${bodies}`;
}
function limbXr(rng: () => number, bodyPart: string): string {
  const w = bodyPart === 'hand' ? 26 : 44;
  const fingers = bodyPart === 'hand' ? Array.from({ length: 5 }, (_, i) => `<rect x="${140 + i * 52}" y="${80 + Math.abs(i - 2) * 30}" width="20" height="${180 - Math.abs(i - 2) * 30}" rx="10" fill="#c6cacd" opacity="0.85"/>`).join('') : '';
  return `<rect x="90" y="40" width="332" height="440" rx="120" fill="#202325"/>
<rect x="${256 - w / 2 - 30}" y="${bodyPart === 'hand' ? 250 : 60}" width="${w}" height="${bodyPart === 'hand' ? 230 : 190}" rx="20" fill="#c6cacd" opacity="0.9"/>
<rect x="${256 + 30 - w / 2}" y="${bodyPart === 'hand' ? 250 : 60}" width="${w * 0.7}" height="${bodyPart === 'hand' ? 230 : 190}" rx="18" fill="#c6cacd" opacity="0.8"/>
${bodyPart === 'hand' ? fingers : `<ellipse cx="256" cy="262" rx="70" ry="34" fill="#d5d9dc" opacity="0.9"/><rect x="210" y="270" width="46" height="200" rx="20" fill="#c6cacd" opacity="0.9"/><rect x="266" y="270" width="34" height="200" rx="16" fill="#c6cacd" opacity="0.8"/>`}
<ellipse cx="${256 + rng() * 20 - 10}" cy="${300 + rng() * 40}" rx="10" ry="4" fill="#0d0f10" opacity="0.6"/>`;
}
function ctHead(rng: () => number, n: number, mr = false): string {
  const level = 0.6 + 0.4 * Math.sin((n % 32) / 32 * Math.PI);
  const rx = 170 * level + 20;
  const ry = 205 * level + 20;
  const skull = mr ? '#3d4144' : '#e6e9eb';
  const brain = mr ? '#8a9095' : '#5d6266';
  const ventricles = mr ? '#1a1c1e' : '#2a2d30';
  return `<ellipse cx="256" cy="256" rx="${rx}" ry="${ry}" fill="${skull}"/>
<ellipse cx="256" cy="256" rx="${rx - 16}" ry="${ry - 16}" fill="${brain}"/>
<path d="M256 ${256 - ry + 30} V ${256 + ry - 40}" stroke="${ventricles}" stroke-width="3" opacity="0.7"/>
<ellipse cx="232" cy="250" rx="${22 * level}" ry="${48 * level}" fill="${ventricles}" opacity="0.85" transform="rotate(-12 232 250)"/>
<ellipse cx="280" cy="250" rx="${22 * level}" ry="${48 * level}" fill="${ventricles}" opacity="0.85" transform="rotate(12 280 250)"/>
${Array.from({ length: 6 }, (_, i) => `<path d="M${120 + i * 45} ${90 + rng() * 20} q 20 ${30 + rng() * 40} 0 ${80 + rng() * 40}" fill="none" stroke="${mr ? '#a8aeb2' : '#4b5054'}" stroke-width="6" opacity="0.5"/>`).join('')}`;
}
function ctSpine(rng: () => number): string {
  return `<ellipse cx="256" cy="256" rx="230" ry="180" fill="#3a3e41"/><circle cx="256" cy="300" r="42" fill="#d9dcdf"/><circle cx="256" cy="300" r="14" fill="#2a2d30"/><path d="M214 330 q 42 60 84 0" fill="none" stroke="#d9dcdf" stroke-width="16"/><ellipse cx="256" cy="180" rx="150" ry="70" fill="#1b1e20" opacity="0.8" filter="url(#b)"/><ellipse cx="${256 + rng() * 10}" cy="230" rx="40" ry="20" fill="#7a7f83" opacity="0.7"/>`;
}
function ctBody(rng: () => number, chest: boolean): string {
  return `<ellipse cx="256" cy="256" rx="235" ry="185" fill="#3c4043"/>
${chest ? `<ellipse cx="170" cy="250" rx="95" ry="130" fill="#0e1011" opacity="0.95"/><ellipse cx="342" cy="250" rx="95" ry="130" fill="#0e1011" opacity="0.95"/><ellipse cx="262" cy="280" rx="70" ry="60" fill="#8a8f92" opacity="0.9"/>` : `<ellipse cx="190" cy="240" rx="110" ry="95" fill="#8d9296" opacity="0.9"/><ellipse cx="330" cy="290" rx="60" ry="45" fill="#7a7f83" opacity="0.8"/><circle cx="${330 + rng() * 10}" cy="${200 + rng() * 10}" r="28" fill="#5f6468"/><circle cx="${175 + rng() * 10}" cy="330" r="26" fill="#5f6468"/>`}
<circle cx="256" cy="380" r="34" fill="#d9dcdf"/><circle cx="256" cy="380" r="10" fill="#2a2d30"/>
<rect x="30" y="80" width="452" height="350" rx="190" fill="none" stroke="#cfd3d6" stroke-width="7" opacity="0.6"/>`;
}
function mrSpine(rng: () => number): string {
  const bodies = Array.from({ length: 6 }, (_, i) => `<rect x="200" y="${60 + i * 70}" width="90" height="50" rx="8" fill="#b9bec2" opacity="0.9"/><rect x="200" y="${110 + i * 70}" width="90" height="18" rx="4" fill="${i === 3 ? '#4a4f53' : '#6d7276'}" opacity="0.9"/>`).join('');
  return `<rect x="60" y="30" width="392" height="460" rx="60" fill="#2b2e31"/><rect x="300" y="40" width="40" height="440" rx="10" fill="#e3e6e8" opacity="0.8"/>${bodies}<ellipse cx="${310 + rng() * 6}" cy="322" rx="14" ry="8" fill="#1b1e20"/>`;
}
function mrKnee(rng: () => number): string {
  return `<rect x="80" y="30" width="352" height="460" rx="120" fill="#2b2e31"/><rect x="190" y="40" width="130" height="200" rx="40" fill="#b9bec2"/><rect x="200" y="280" width="110" height="200" rx="40" fill="#b9bec2"/><ellipse cx="255" cy="260" rx="70" ry="22" fill="#4f5458"/><path d="M215 250 L 295 275" stroke="#dfe2e4" stroke-width="6" opacity="0.8"/><ellipse cx="${255 + rng() * 10}" cy="262" rx="26" ry="8" fill="#1b1e20" opacity="0.8"/>`;
}
function mammo(rng: () => number, left: boolean, mlo: boolean): string {
  const flip = left ? 'translate(512 0) scale(-1 1)' : '';
  const fibro = Array.from({ length: 24 }, () => `<path d="M${420 - rng() * 60} ${120 + rng() * 280} q ${-40 - rng() * 60} ${rng() * 40 - 20} ${-100 - rng() * 120} ${rng() * 30 - 15}" fill="none" stroke="#e2e5e7" stroke-width="${1 + rng() * 3}" opacity="${0.3 + rng() * 0.4}"/>`).join('');
  return `<g transform="${flip}"><path d="M470 60 Q ${mlo ? 150 : 120} 90 130 260 Q ${mlo ? 150 : 120} 430 470 470 Z" fill="#8e9397"/><path d="M470 100 Q 210 130 190 260 Q 210 400 470 430 Z" fill="#b5babd" opacity="0.8" filter="url(#b)"/>${fibro}${mlo ? '<path d="M470 40 L 300 200" stroke="#d7dadc" stroke-width="28" opacity="0.5"/>' : ''}</g>`;
}
function ultrasound(rng: () => number): string {
  const speck = Array.from({ length: 40 }, () => `<circle cx="${100 + rng() * 312}" cy="${120 + rng() * 300}" r="${1 + rng() * 2}" fill="#d6d9db" opacity="${0.2 + rng() * 0.5}"/>`).join('');
  return `<path d="M256 40 L 60 470 A 300 300 0 0 0 452 470 Z" fill="#3b3f42"/><path d="M256 40 L 60 470 A 300 300 0 0 0 452 470 Z" fill="url(#bg)" opacity="0.6"/>
<ellipse cx="${250 + rng() * 20}" cy="${270 + rng() * 20}" rx="${70 + rng() * 20}" ry="${45 + rng() * 15}" fill="#0f1112" opacity="0.9" filter="url(#b)"/>
<ellipse cx="200" cy="360" rx="60" ry="30" fill="#7c8184" opacity="0.7" filter="url(#b)"/>${speck}`;
}
