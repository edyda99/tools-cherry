// test-sdi.js — regression guard for state disability / paid-leave employee
// contributions (SDI / TDI / PFML / FLI / FAMLI). Verifies the engine subtracts
// each program POST-TAX on gross wages, respects wage bases and annual/weekly
// caps across pay frequencies, keeps the programs OUT of income tax / FICA /
// annual.state, and leaves no-program states untouched. Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePaycheck, stateEmployeePrograms } from '../src/engine/paycheck-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tax = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'tax-data-2026.json'), 'utf8'));

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };
const approx = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);
const run = (slug, amount, payFrequency = 'annual', fs = 'single') =>
  computePaycheck({ wage: { type: 'salary', amount }, filingStatus: fs, payFrequency, stateSlug: slug }, tax);
const progOf = (r, label) => r.annual.programs.find((p) => p.label === label);

// --- (a) CA SDI: 1.3% uncapped, $30/biweekly, $780/yr, drops net by exactly that
t('CA SDI $60k biweekly = $30.00/check, $780.00/yr', () => {
  const r = run('california', 60000, 'biweekly');
  approx(r.annual.statePrograms, 780.0);
  approx(r.perPaycheck.statePrograms, 30.0);
  approx(progOf(r, 'CA SDI').amount, 780.0);
});
t('CA SDI reduces net by exactly the SDI amount, nothing else', () => {
  const withSdi = run('california', 60000, 'biweekly');
  const noPrograms = { ...tax, states: { ...tax.states, california: { ...tax.states.california, employeePrograms: [] } } };
  const without = computePaycheck({ wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'biweekly', stateSlug: 'california' }, noPrograms);
  approx(without.annual.net - withSdi.annual.net, 780.0);
  // federal / FICA / state income tax are untouched by the SDI deduction
  approx(withSdi.annual.federal, without.annual.federal);
  approx(withSdi.annual.socialSecurity, without.annual.socialSecurity);
  approx(withSdi.annual.medicare, without.annual.medicare);
  approx(withSdi.annual.state, without.annual.state);
});

// --- programs stay OUT of totalTax and annual.state --------------------------
t('SDI/PFML is not counted as tax (out of totalTax and annual.state)', () => {
  const r = run('california', 60000);
  // totalTax = federal + fica + state, with NO program dollars folded in
  approx(r.annual.totalTax, r.annual.federal + r.annual.socialSecurity + r.annual.medicare + r.annual.state);
  assert.ok(r.annual.statePrograms > 0, 'CA should have a program amount');
});

// --- (b) no-program state is completely unaffected ---------------------------
t('Texas (no program) is untouched: statePrograms 0, empty array, net unchanged', () => {
  const r = run('texas', 60000, 'biweekly');
  assert.equal(r.annual.statePrograms, 0);
  assert.deepEqual(r.annual.programs, []);
  approx(r.annual.net, 50390, 0.5); // same pinned Texas net as test-engine.js
});

// --- pre-tax deductions do NOT shrink the SDI base (SDI is on gross) ----------
t('CA SDI is on gross wages — 401(k) does not reduce it', () => {
  const plain = run('california', 60000);
  const with401k = computePaycheck({ wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'california', adv: { retirement401k: 10000 } }, tax);
  approx(with401k.annual.statePrograms, plain.annual.statePrograms); // both 1.3% of full 60k
  approx(with401k.annual.statePrograms, 780.0);
});

// --- (c) weekly-capped programs (NY DBL, HI TDI) -----------------------------
t('NY DBL weekly cap: $0.60/week = $31.20/yr (not 0.5% of wages)', () => {
  const r = run('new-york', 60000, 'weekly');
  approx(progOf(r, 'NY DBL').amount, 31.2);               // capped, NOT 60000*0.005=300
  approx(r.perPaycheck.programs.find((p) => p.label === 'NY DBL').amount, 0.6); // $0.60/week
});
t('HI TDI weekly cap binds only above the cap threshold', () => {
  approx(run('hawaii', 60000).annual.statePrograms, 300.0);  // 60000*0.005 under cap
  approx(run('hawaii', 100000).annual.statePrograms, 390.0); // capped at $7.50*52
});

// --- annual-max cap (NY PFL) -------------------------------------------------
t('NY PFL annual cap $411.91', () => {
  approx(progOf(run('new-york', 60000), 'NY PFL').amount, 259.2);   // 60000*0.00432 under cap
  approx(progOf(run('new-york', 150000), 'NY PFL').amount, 411.91); // capped
});

// --- wage-base cap (NJ TDI+FLI, RI) ------------------------------------------
t('NJ TDI+FLI respect the $171,100 worker wage base', () => {
  const r = run('new-jersey', 60000);
  approx(progOf(r, 'NJ TDI').amount, 60000 * 0.0019);
  approx(progOf(r, 'NJ FLI').amount, 60000 * 0.0023);
  const hi = run('new-jersey', 300000);
  approx(progOf(hi, 'NJ TDI').amount, 171100 * 0.0019); // 325.09 max
  approx(progOf(hi, 'NJ FLI').amount, 171100 * 0.0023); // 393.53 max
});
t('RI TDI/TCI wage base $100,000 → max $1,100', () => {
  approx(run('rhode-island', 300000).annual.statePrograms, 1100.0);
});

// --- (d) WA PFML matches the official composite rate math --------------------
// Asserted per PROGRAM, not on annual.statePrograms: Washington withholds two
// separate employee premiums with different bases, so the state total is not the
// PFML figure and must never be used as a proxy for it.
t('WA PFML $60k = official 60000*1.13%*71.43%', () => {
  approx(progOf(run('washington', 60000), 'WA PFML').amount, 60000 * 0.0113 * 0.7143, 0.02);
});
t('WA PFML caps at the $184,500 SS wage base (~$1,489.21)', () => {
  approx(progOf(run('washington', 250000), 'WA PFML').amount, 1489.21, 0.02);
});

// --- uncapped programs: WA Cares, PA UC, CA SDI keep scaling past $184,500 ----
// WA Cares has no wage cap and explicitly no Social Security cap (RCW 50B.04.080),
// so it must NOT stop where PFML stops. Pinning both ends catches a stray wageBase.
t('WA Cares 0.58% is uncapped: scales past the PFML wage base', () => {
  approx(progOf(run('washington', 60000), 'WA Cares').amount, 60000 * 0.0058);
  approx(progOf(run('washington', 250000), 'WA Cares').amount, 250000 * 0.0058); // 1450, not capped
  approx(progOf(run('washington', 500000), 'WA Cares').amount, 2900.0);
});
t('WA total at $250k = capped PFML + uncapped WA Cares, not one merged rate', () => {
  const r = run('washington', 250000);
  approx(r.annual.statePrograms, 1489.21 + 1450.0, 0.02);
});
t('PA UC 0.07% is uncapped: applies to all gross wages', () => {
  approx(progOf(run('pennsylvania', 60000), 'PA UC').amount, 42.0);
  approx(progOf(run('pennsylvania', 500000), 'PA UC').amount, 350.0); // no wage base
});

// --- newly modelled employee-paid UI: AK, NJ --------------------------------
t('AK SUI 0.50% caps at the $54,200 wage base → $271.00 max', () => {
  approx(progOf(run('alaska', 40000), 'AK SUI (employee)').amount, 200.0);
  approx(progOf(run('alaska', 100000), 'AK SUI (employee)').amount, 271.0);
});
t('NJ is a TWO-cap state: UI+WF/SWF stop at $44,800, TDI+FLI at $171,100', () => {
  const r = run('new-jersey', 300000);
  approx(progOf(r, 'NJ UI').amount, 171.36);      // 44800 * 0.003825
  approx(progOf(r, 'NJ WF/SWF').amount, 19.04);   // 44800 * 0.000425
  approx(progOf(r, 'NJ TDI').amount, 325.09);     // 171100 * 0.0019
  approx(progOf(r, 'NJ FLI').amount, 393.53);     // 171100 * 0.0023
  approx(r.annual.statePrograms, 171.36 + 19.04 + 325.09 + 393.53);
  // the two bases really are different, or a single-cap bug would go unseen
  const mid = run('new-jersey', 100000);
  approx(progOf(mid, 'NJ UI').amount, 171.36);            // already capped
  approx(progOf(mid, 'NJ TDI').amount, 100000 * 0.0019);  // still scaling
});

// --- MN Paid Leave: employee half, capped at the SS wage base ----------------
t('MN Paid Leave 0.44% caps at $184,500 → $811.80 max', () => {
  approx(progOf(run('minnesota', 60000), 'MN Paid Leave').amount, 264.0);
  approx(progOf(run('minnesota', 250000), 'MN Paid Leave').amount, 811.8);
});

// --- per-frequency honesty: same annual total regardless of pay frequency ----
t('CA SDI annual total is frequency-invariant; per-period × periods = annual', () => {
  for (const fr of ['weekly', 'biweekly', 'semimonthly', 'monthly', 'annual']) {
    const r = run('california', 60000, fr);
    approx(r.annual.statePrograms, 780.0);
    approx(r.perPaycheck.statePrograms * r.periods, r.annual.statePrograms, 0.0001);
  }
});

// --- direct unit test of the pure helper -------------------------------------
t('stateEmployeePrograms: caps, wage base, and empty for no-program states', () => {
  assert.deepEqual(stateEmployeePrograms(60000, tax.states.texas), []);
  assert.deepEqual(stateEmployeePrograms(60000, undefined), []);
  const ca = stateEmployeePrograms(60000, tax.states.california);
  approx(ca[0].annual, 780.0);
});

// --- data-integrity: every modeled program has a rate + a valid cap shape ----
t('all employeePrograms carry decimal rate and at most one cap type', () => {
  for (const [slug, s] of Object.entries(tax.states)) {
    for (const pr of s.employeePrograms || []) {
      assert.ok(typeof pr.label === 'string' && pr.label, `${slug} program missing label`);
      assert.ok(pr.rate > 0 && pr.rate < 0.1, `${slug} ${pr.label} rate ${pr.rate} out of range`);
      const caps = ['wageBase', 'annualMax', 'weeklyMax'].filter((k) => pr[k] != null);
      assert.ok(caps.length <= 1, `${slug} ${pr.label} has multiple cap types: ${caps}`);
    }
  }
});

console.log(`\n${pass} passing`);
