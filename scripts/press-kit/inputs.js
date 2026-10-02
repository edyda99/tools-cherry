// inputs.js: what the 2027 press kit is computed from, in one place.
//
// Shared by scripts/press-kit/build-press-kit.js (which writes the kit) and by
// build.js (which ships it). The fingerprint is how build.js knows the
// committed charts still match the data files: the generator stamps it into
// manifest.json, build.js recomputes it, and a mismatch means somebody changed
// a tax or COLA input without re-running `npm run press-kit`.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Editorial choices, not data. Changing any of these changes the fingerprint.
export const PRESS_KIT_CONFIG = {
  // Example gross monthly Social Security payments for the COLA chart.
  colaExampleBenefits: [1200, 1900, 2600],
  // Annual wages for the 2027-vs-2026 federal income tax chart.
  federalWages: [50000, 100000, 200000],
  federalStatuses: [
    { id: 'single', label: 'Single filer' },
    { id: 'married', label: 'Married filing jointly' },
  ],
  // MUST equal STUDY_SALARIES in build.js, so the dot plot and
  // /data/take-home-pay-by-state/ show the same figures. build.js enforces it.
  takeHomeSalaries: [75000, 100000],
};

/** Read every data file the kit depends on. tax-data-2027.json is optional. */
export async function loadPressKitInputs(root) {
  const read = async (...p) => JSON.parse(await readFile(join(root, ...p), 'utf8'));
  const p27 = join(root, 'src', 'data', 'tax-data-2027.json');
  return {
    taxData: await read('src', 'data', 'tax-data-2026.json'),
    proj: await read('src', 'data', 'projections-2027.json'),
    roster: await read('src', 'data', 'states.json'),
    taxData2027: existsSync(p27) ? JSON.parse(await readFile(p27, 'utf8')) : null,
  };
}

// Drop "_"-prefixed provenance/prose keys, which do not move a number, but
// KEEP `_watch`: whether a legal-status watch has lapsed decides whether a
// jurisdiction is flagged on the dot plot.
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('_') && k !== '_watch') continue;
      out[k] = strip(x);
    }
    return out;
  }
  return v;
}

/** A short hash of exactly the inputs the kit's numbers depend on. */
export function inputsFingerprint({ taxData, proj, roster, taxData2027 }, config = PRESS_KIT_CONFIG) {
  const basis = {
    taxYear: taxData.taxYear,
    federal: strip(taxData.federal),
    states: strip(taxData.states),
    revProc2026: strip(taxData._meta && taxData._meta.revenueProcedure),
    cpiw: strip(proj.cpiw),
    thirdPartyProjections: strip(proj.thirdPartyProjections || null),
    official2027: strip(proj.official2027 || null),
    taxData2027: taxData2027
      ? { federal: strip(taxData2027.federal), rp: strip(taxData2027._meta && taxData2027._meta.revenueProcedure) }
      : null,
    roster,
    config,
  };
  return createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 16);
}
