// test-tax-data.js — regression guard for the 2026 tax-data table.
// Pins the federal figures (which drive every state page) and a sample of
// per-state results so a careless edit to tax-data-2026.json fails CI.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePaycheck } from '../src/engine/paycheck-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tax = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'tax-data-2026.json'), 'utf8'));

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };
const approx = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);
const stateTax = (slug, amount, fs = 'single') =>
  computePaycheck({ wage: { type: 'salary', amount }, filingStatus: fs, payFrequency: 'annual', stateSlug: slug }, tax).annual.state;

// --- federal figures (IRS Rev. Proc. 2025-32 + SSA 2026), drive ALL pages ----
t('federal standard deduction 2026', () => {
  assert.equal(tax.federal.standardDeduction.single, 16100);
  assert.equal(tax.federal.standardDeduction.married, 32200);
  assert.equal(tax.federal.standardDeduction.head_of_household, 24150);
});
t('federal single bracket thresholds 2026', () => {
  const b = tax.federal.brackets.single.map((x) => x.upTo);
  assert.deepEqual(b, [12400, 50400, 105700, 201775, 256225, 640600, null]);
});
t('federal Social Security wage base 2026 = 184500', () =>
  assert.equal(tax.federal.fica.socialSecurity.wageBase, 184500));

// --- coverage: all 50 states + DC present and structurally sound -------------
t('51 jurisdictions present', () => assert.equal(Object.keys(tax.states).length, 51));
t('every state: slug matches key, valid bracket shape, decimal rates', () => {
  for (const [slug, s] of Object.entries(tax.states)) {
    assert.equal(s.slug, slug, `${slug} slug mismatch`);
    assert.ok(s.name && s.abbr, `${slug} missing name/abbr`);
    if (s.hasIncomeTax && s.tax.type === 'bracket') {
      for (const fs of ['single', 'married', 'head_of_household']) {
        const bands = s.tax.brackets[fs];
        assert.ok(Array.isArray(bands) && bands.length, `${slug}.${fs} missing brackets`);
        let prev = -1;
        bands.forEach((x, i) => {
          assert.ok(x.rate >= 0 && x.rate < 1, `${slug}.${fs} rate ${x.rate} not a decimal`);
          if (i === bands.length - 1) assert.equal(x.upTo, null, `${slug}.${fs} last band must be null`);
          const up = x.upTo === null ? Infinity : x.upTo;
          assert.ok(up > prev, `${slug}.${fs} non-ascending threshold`);
          prev = up;
        });
      }
    }
    if (s.hasIncomeTax && s.tax.type === 'flat') assert.ok(s.tax.rate >= 0 && s.tax.rate < 1, `${slug} flat rate ${s.tax.rate}`);
  }
});

// --- pinned per-state results ($75k single, annual state tax) ----------------
t('New York $75k single ≈ $3,453', () => approx(stateTax('new-york', 75000), 3453, 1));
t('Delaware $75k single = $3,719.00', () => approx(stateTax('delaware', 75000), 3719.0));
t('New Mexico $75k single = $2,359.30', () => approx(stateTax('new-mexico', 75000), 2359.30, 0.05));
t('Utah $75k single = $2,650.50 (flat 4.5%)', () => approx(stateTax('utah', 75000), 2650.50, 0.05));
t('Texas has no state income tax', () => assert.equal(stateTax('texas', 75000), 0));

// --- prior-year fallback states are labeled (figureYear 2025, not 2026) ------
t('California/Nebraska/Oklahoma carry figureYear 2025 (fallback)', () => {
  for (const s of ['california', 'nebraska', 'oklahoma']) assert.equal(tax.states[s].figureYear, 2025, `${s} should be 2025-fallback`);
});

console.log(`\n${pass} passing`);
