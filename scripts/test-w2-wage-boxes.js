#!/usr/bin/env node
// test-w2-wage-boxes.js — W-2 Box 1 / Box 3 / Box 5 reconciliation.
//
// The load-bearing assertion in this file is the asymmetry: a traditional
// 401(k) deferral lowers Box 1 ONLY, while a Section 125 amount lowers all
// three. Getting that backwards is the single most common wrong answer on the
// open web about this question, so it is tested from both directions.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileWageBoxes } from '../src/engine/w2-wage-boxes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); failed++; } };
const near = (a, b, msg) => ok(Math.abs(a - b) < 0.005, `${msg} (got ${a}, want ${b})`);

const data = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'w2-wage-boxes.json'), 'utf8'));
const taxData = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tax-data-2026.json'), 'utf8'));

// --- the data file ---------------------------------------------------------
for (const [yr, y] of Object.entries(data.years)) {
  ok(/^\d{4}$/.test(yr), `year key ${yr} is a four-digit year`);
  ok(Number.isFinite(y.socialSecurityWageBase) && y.socialSecurityWageBase > 0, `${yr} has a wage base`);
  ok(/^https:\/\//.test(y.sourceUrl || ''), `${yr} wage base carries an https sourceUrl`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(y.publishedDate || ''), `${yr} wage base carries an ISO publishedDate`);
  ok(typeof y.source === 'string' && y.source.length > 20,
    `${yr} source reads as a citation, not an internal note — source fields render`);
}
ok(Object.keys(data.years).length >= 2,
  'at least two tax years are carried: a W-2 is read in January for the year that just ended');
// The one figure that exists in two files. If they ever disagree, the paycheck
// engine and this page are telling visitors different things about the same year.
ok(data.years[String(taxData.taxYear)].socialSecurityWageBase
  === taxData.federal.fica.socialSecurity.wageBase,
  `w2-wage-boxes.json and tax-data-${taxData.taxYear}.json disagree on the Social Security wage base`);

const y2026 = data.years['2026'];
const y2025 = data.years['2025'];

// --- the asymmetry ---------------------------------------------------------
{
  const r = reconcileWageBoxes({ gross: 80000, retirement401k: 10000 }, y2026);
  ok(r.box1 === 70000, `401(k) lowers Box 1 (got ${r.box1})`);
  ok(r.box3 === 80000, `401(k) does NOT lower Box 3 (got ${r.box3})`);
  ok(r.box5 === 80000, `401(k) does NOT lower Box 5 (got ${r.box5})`);
}
{
  const r = reconcileWageBoxes({ gross: 80000, section125: 6000 }, y2026);
  ok(r.box1 === 74000 && r.box3 === 74000 && r.box5 === 74000,
    `Section 125 lowers all three boxes (got ${r.box1}/${r.box3}/${r.box5})`);
}
{
  const r = reconcileWageBoxes({ gross: 80000, retirement401k: 10000, section125: 6000 }, y2026);
  ok(r.box1 === 64000, `both come out of Box 1 (got ${r.box1})`);
  ok(r.box3 === 74000 && r.box5 === 74000, `only Section 125 comes out of Box 3/5 (got ${r.box3}/${r.box5})`);
}

// --- the cap ---------------------------------------------------------------
{
  const r = reconcileWageBoxes({ gross: 250000 }, y2026);
  ok(r.box3 === y2026.socialSecurityWageBase, `Box 3 stops at the wage base (got ${r.box3})`);
  ok(r.box5 === 250000, `Box 5 has no cap (got ${r.box5})`);
  ok(r.cappedBy === 250000 - y2026.socialSecurityWageBase, 'the capped amount is reported');
  ok(r.flags.some((f) => /capped/i.test(f)), 'the cap is flagged in plain English');
  near(r.socialSecurityTax, y2026.socialSecurityWageBase * 0.062, 'Social Security tax stops at the cap');
  near(r.medicareTax, 250000 * 0.0145, 'Medicare tax does not stop');
  near(r.additionalMedicareTax, 50000 * 0.009, 'additional Medicare tax applies above $200,000');
}
{
  // Prior year, because January visitors are reconciling last year's W-2.
  const r = reconcileWageBoxes({ gross: 250000 }, y2025);
  ok(r.box3 === 176100, `the 2025 W-2 caps Box 3 at the 2025 wage base (got ${r.box3})`);
}

// --- boundaries and the "nothing is wrong" case ----------------------------
{
  const r = reconcileWageBoxes({ gross: 50000 }, y2026);
  ok(r.box1 === 50000 && r.box3 === 50000 && r.box5 === 50000, 'with no deductions all three match');
  ok(r.flags.some((f) => /All three boxes match/.test(f)), 'the matching case is explained, not left silent');
  ok(r.cappedBy === 0, 'nothing is capped below the wage base');
}
{
  const r = reconcileWageBoxes({ gross: 0 }, y2026);
  ok(r.box1 === 0 && r.box3 === 0 && r.box5 === 0, 'zero in, zero out');
}
{
  const r = reconcileWageBoxes({ gross: 'abc' }, y2026);
  ok(r.box1 === 0, 'junk input does not produce NaN on the page');
}
{
  const r = reconcileWageBoxes({ gross: 60000, retirement401k: 999999 }, y2026);
  ok(r.box1 === 0, 'a deferral larger than pay cannot drive Box 1 negative');
}
{
  const r = reconcileWageBoxes({ gross: 90000, imputedIncome: 500 }, y2026);
  ok(r.box1 === 90500 && r.box3 === 90500 && r.box5 === 90500,
    'taxable non-cash pay is ADDED to all three boxes');
}
{
  const r = reconcileWageBoxes({ gross: 90000, box1Only: 5000 }, y2026);
  ok(r.box1 === 95000 && r.box5 === 90000, 'a Box-1-only item makes Box 1 exceed Box 5');
  ok(r.flags.some((f) => /higher than Box 5/.test(f)), 'Box 1 > Box 5 is flagged as legitimate but worth checking');
}

// --- the breakdown ---------------------------------------------------------
{
  const r = reconcileWageBoxes({ gross: 80000, retirement401k: 10000, section125: 6000 }, y2026);
  ok(r.lines.length === 3, `only the lines the visitor entered are shown (got ${r.lines.length})`);
  const k = r.lines.find((l) => /401\(k\)/.test(l.label));
  ok(k && k.box1 === true && k.box3 === false && k.box5 === false,
    'the 401(k) line is marked as affecting Box 1 only');
  const s = r.lines.find((l) => /Section 125/.test(l.label));
  ok(s && s.box1 && s.box3 && s.box5, 'the Section 125 line is marked as affecting all three');
  ok(r.lines.every((l) => l.why && l.why.length > 30), 'every line explains itself in a sentence');
}

if (failed) {
  console.error(`\ntest-w2-wage-boxes: ${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('test-w2-wage-boxes: OK');
