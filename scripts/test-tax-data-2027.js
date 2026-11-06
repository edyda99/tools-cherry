// test-tax-data-2027.js: the 2027 tables and the switch that turns them on.
//
// Federal figures must equal the official block the 2027 pages render, every state
// still pending must equal its 2026 entry plus its statutory override, and no
// calculator may reach 2027 tables before 1 January 2027.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { computePaycheck } from '../src/engine/paycheck-engine.js';
import { taxYearFor, pickTaxData, taxYearNote } from '../src/engine/tax-year.js';
import { state2027 } from '../src/engine/january-paycheck.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../src/data/${p}`, import.meta.url), 'utf8'));
const t26 = load('tax-data-2026.json');
const t27 = load('tax-data-2027.json');
const proj = load('projections-2027.json');
const jp = load('january-paycheck-2027.json');
let n = 0;
const is = (name, a, b) => { assert.deepEqual(a, b, name); n++; };
const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, strip(x)]));
  return v;
};
const STATUSES = ['single', 'married', 'head_of_household'];

// ---- federal ----
is('tax year', t27.taxYear, 2027);
is('filing statuses match 2026', t27.filingStatuses, t26.filingStatuses);
is('same top-level shape as 2026', Object.keys(t27).sort(), Object.keys(t26).sort());
for (const st of STATUSES) {
  is(`${st}: standard deduction equals official2027`, t27.federal.standardDeduction[st], proj.official2027.federal.standardDeduction[st]);
  is(`${st}: brackets equal official2027`, t27.federal.brackets[st], proj.official2027.federal.brackets[st]);
  is(`${st}: seven brackets, top open`, [t27.federal.brackets[st].length, t27.federal.brackets[st][6].upTo], [7, null]);
}
is('Rev. Proc. name', t27._meta.revenueProcedure.name, proj.official2027.revenueProcedure.name);
const wb = proj.ssaFactSheet2027.rows.find((r) => r.key === 'wageBase');
is('wage base is SSA 2027', t27.federal.fica.socialSecurity.wageBase, wb.after);
is('wage base literal', t27.federal.fica.socialSecurity.wageBase, 192300);
is('Social Security rate unchanged', t27.federal.fica.socialSecurity.rate, t26.federal.fica.socialSecurity.rate);
is('Medicare unchanged', t27.federal.fica.medicare, t26.federal.fica.medicare);
is('Additional Medicare unchanged', strip(t27.federal.fica.additionalMedicare), strip(t26.federal.fica.additionalMedicare));

// ---- states ----
is('same 51 states', Object.keys(t27.states).sort(), Object.keys(t26.states).sort());
const overrides = jp.stateOverrides2027;
for (const [slug, s] of Object.entries(t27.states)) {
  const old = t26.states[slug];
  if (old.hasIncomeTax || (old.employeePrograms || []).length)
    assert.ok(s._pending2027, `${slug} carries 2026 values, so it must name them as pending`), n++;
  if (!s._pending2027) { is(`${slug}: final state is unchanged no-tax entry`, strip(s).hasIncomeTax, false); continue; }
  const r = state2027({ slug, state2026: old, taxData2027States: t27.states, overrides });
  const { yearNoteLabel, ...rest } = strip(s);
  // The 2027 file carries the 2026 reader text with its dashes turned into commas.
  is(`${slug}: pending state equals 2026 plus its override`, rest, JSON.parse(JSON.stringify(strip(r.state)).replaceAll(' \u2014 ', ', ')));
  is(`${slug}: label only where there is an override`, !!yearNoteLabel, !!overrides[slug]);
}
for (const slug of ['colorado', 'north-dakota', 'montana', 'iowa'])
  is(`${slug}: starts from federal taxable income, so the deduction is federal`,
    strip(t27.states[slug].tax.standardDeduction), strip(t27.federal.standardDeduction));
assert.ok(!JSON.stringify(t27).includes('—'), 'no em dashes'); n++;

// ---- the switch, both sides of the boundary ----
const lastOf2026 = new Date(2026, 11, 31, 23, 59, 59, 999);
const firstOf2027 = new Date(2027, 0, 1, 0, 0, 0, 0);
is('today-style date is 2026', taxYearFor(new Date(2026, 10, 6)), 2026);
is('31 December 2026 23:59:59 is 2026', taxYearFor(lastOf2026), 2026);
is('1 January 2027 00:00:00 is 2027', taxYearFor(firstOf2027), 2027);
is('later in 2027 is 2027', taxYearFor(new Date(2027, 5, 30)), 2027);
is('an unreadable date stays on 2026', taxYearFor(new Date('nonsense')), 2026);
is('picks 2026 tables on the last day', pickTaxData(t26, t27, lastOf2026).taxYear, 2026);
is('picks 2027 tables on the first day', pickTaxData(t26, t27, firstOf2027).taxYear, 2027);
is('falls back to 2026 with no 2027 copy', pickTaxData(t26, undefined, firstOf2027).taxYear, 2026);

// The same paycheck on each side of midnight, worked by hand from the Rev. Procs.
const pay = (d) => computePaycheck({ wage: { type: 'salary', amount: 250000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: 'texas' }, pickTaxData(t26, t27, d)).annual;
is('2026 Social Security on $250,000', pay(lastOf2026).socialSecurity, 184500 * 0.062);
is('2027 Social Security on $250,000', pay(firstOf2027).socialSecurity, 192300 * 0.062);
const fed = (d) => Math.round(pay(d).federal * 100) / 100;
// 2026: 250,000 - 16,100 = 233,900, Rev. Proc. 2025-32 single table.
is('2026 federal tax on $250,000', fed(lastOf2026), 51304);
// 2027: 250,000 - 16,600 = 233,400; Table 3: $42,357 plus 32% over $208,325.
is('2027 federal tax on $250,000', fed(firstOf2027), 50381);

// ---- what a reader sees ----
is('no 2027 note on 2026 tables', taxYearNote(t26, 'georgia'), '');
assert.match(taxYearNote(t27, 'texas'), /official 2027 figures\.$/); n++;
assert.match(taxYearNote(t27, 'georgia'), /Georgia's state tax uses its 2026 figures until the state publishes 2027\.$/); n++;
assert.match(taxYearNote(t27, 'washington'), /We also use Washington's 2027 paid leave premium\.$/); n++;
assert.match(taxYearNote(t27, 'north-carolina'), /We also use North Carolina's 2027 income tax rate\./); n++;

console.log(`test-tax-data-2027: ${n} checks passed`);
