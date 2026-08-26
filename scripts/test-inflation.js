// test-inflation.js — unit tests for the pure inflation (CPI-U) math module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inflationValue,
  totalPercentChange,
  annualizedRate
} from '../src/engine/inflation.js';
import { inflationBlocks } from '../src/content/inflation-blocks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- inflationValue ----------------------------------------------------------
t('inflationValue: same CPI returns the amount unchanged', () =>
  approx(inflationValue(100, 200, 200), 100));
t('inflationValue: doubling the price level doubles the value', () =>
  approx(inflationValue(100, 100, 200), 200));
t('inflationValue: deflation reduces the value', () =>
  approx(inflationValue(100, 200, 100), 50));
t('inflationValue: accepts string input', () =>
  approx(inflationValue('50', '100', '150'), 75));
t('inflationValue: zero starting CPI is NaN (no divide-by-zero)', () =>
  assert.ok(Number.isNaN(inflationValue(100, 0, 200))));
t('inflationValue: bad amount is NaN', () =>
  assert.ok(Number.isNaN(inflationValue('abc', 100, 200))));

// --- totalPercentChange ------------------------------------------------------
t('totalPercentChange: 100 -> 125 is +25%', () =>
  approx(totalPercentChange(100, 125), 25));
t('totalPercentChange: 200 -> 100 is -50%', () =>
  approx(totalPercentChange(200, 100), -50));
t('totalPercentChange: zero start is NaN', () =>
  assert.ok(Number.isNaN(totalPercentChange(0, 100))));

// --- annualizedRate ----------------------------------------------------------
t('annualizedRate: doubling over 1 year is +100%', () =>
  approx(annualizedRate(100, 200, 1), 100));
t('annualizedRate: same year (0 years) is 0', () =>
  approx(annualizedRate(100, 200, 0), 0));
t('annualizedRate: compound check 100->121 over 2 years is ~10%/yr', () =>
  approx(annualizedRate(100, 121, 2), 10, 1e-6));
t('annualizedRate: negative years is NaN', () =>
  assert.ok(Number.isNaN(annualizedRate(100, 200, -3))));
t('annualizedRate: zero start CPI is NaN', () =>
  assert.ok(Number.isNaN(annualizedRate(0, 200, 5))));

// --- real-data sanity check against the bundled CPI table --------------------
const cpi = JSON.parse(
  await readFile(join(__dirname, '..', 'src', 'data', 'cpi-us.json'), 'utf8')
);

t('cpi-us.json: declares a BLS source and a throughYear', () => {
  assert.ok(/BLS|Bureau of Labor Statistics/i.test(cpi.source));
  assert.ok(Number.isInteger(cpi.throughYear));
});

t('cpi-us.json: throughYear is present in data and is the latest key', () => {
  const years = Object.keys(cpi.data).map(Number);
  assert.ok(cpi.data[String(cpi.throughYear)] > 0);
  assert.equal(Math.max(...years), cpi.throughYear);
});

t('cpi-us.json: every value is a positive finite number', () => {
  for (const [yr, v] of Object.entries(cpi.data)) {
    assert.ok(typeof v === 'number' && v > 0, `bad CPI for ${yr}: ${v}`);
  }
});

t('real data: $100 in 2000 is more than $150 by 2024', () => {
  const v = inflationValue(100, cpi.data['2000'], cpi.data['2024']);
  assert.ok(v > 150 && v < 250, `unexpected 2000->2024 value: ${v}`);
});

// --- the page's printed figures ----------------------------------------------
// The inflation page used to carry two hand-typed numbers in its prose ("$100 in
// 2000 is about $183 in 2024, prices up about 83%"). Against the shipped CPI
// table the true answers were $182.17 and 82.2%, and nothing in the build could
// tell, because a sentence is not an assertion. Every figure on that page now
// comes from inflationBlocks(); these tests re-derive them from the engine so a
// wrong one fails the build, and the last test stops a literal from creeping
// back into the template.
const blocks = inflationBlocks(cpi);
const inflationTpl = await readFile(
  join(__dirname, '..', 'src', 'templates', 'inflation-calculator.html'),
  'utf8'
);
const asMoney = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

t('blocks: the opening years are real years inside the data', () => {
  assert.ok(cpi.data[String(blocks.defaultFrom)] > 0, `no CPI for ${blocks.defaultFrom}`);
  assert.ok(cpi.data[String(blocks.defaultTo)] > 0, `no CPI for ${blocks.defaultTo}`);
  assert.equal(blocks.defaultTo, cpi.throughYear);
  assert.ok(blocks.defaultFrom < blocks.defaultTo);
});

t('blocks: the pre-rendered opening result re-derives from the engine', () => {
  const expected = inflationValue(
    blocks.exampleAmount,
    cpi.data[String(blocks.defaultFrom)],
    cpi.data[String(blocks.defaultTo)]
  );
  approx(blocks.defaultValue, expected);
  assert.equal(blocks.CPI_DEFAULT_BIG, asMoney(expected));
  // The sub-line is the sentence the browser writes over the pre-rendered one on
  // load. If the two ever differ the first paint visibly twitches, so pin the
  // exact string shape src/assets/inflation-calculator.js builds.
  assert.equal(
    blocks.CPI_DEFAULT_SUB,
    `${asMoney(blocks.exampleAmount)} in ${blocks.defaultFrom} has the same buying power as ` +
      `${asMoney(expected)} in ${blocks.defaultTo}`
  );
  // Same for the three detail rows, which the asset also rewrites. Its pct()
  // formats with maximumFractionDigits:1 and no minimum, and signs positives.
  const asPct = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
  const change = totalPercentChange(
    cpi.data[String(blocks.defaultFrom)], cpi.data[String(blocks.defaultTo)]
  );
  const rate = annualizedRate(
    cpi.data[String(blocks.defaultFrom)], cpi.data[String(blocks.defaultTo)],
    blocks.defaultTo - blocks.defaultFrom
  );
  assert.equal(blocks.CPI_DEFAULT_CHANGE, (change > 0 ? '+' : '') + asPct(change));
  assert.equal(blocks.CPI_DEFAULT_RATE, (rate > 0 ? '+' : '') + asPct(rate));
  assert.equal(blocks.CPI_DEFAULT_CHANGE_LABEL,
    `Total price change ${blocks.defaultFrom}→${blocks.defaultTo}`);
});

t('blocks: the worked example re-derives from the engine', () => {
  const from = cpi.data[String(blocks.anchorYear)];
  const to = cpi.data[String(blocks.latestYear)];
  approx(blocks.anchorValue, inflationValue(blocks.exampleAmount, from, to));
  approx(blocks.anchorChange, totalPercentChange(from, to));
  // The reverse direction the prose quotes ("$100 today is worth ... back then").
  approx(blocks.anchorBackValue, inflationValue(blocks.exampleAmount, to, from));
});

t('blocks: every by-year table row re-derives from the engine', () => {
  assert.ok(blocks.rows.length >= 8, `only ${blocks.rows.length} rows in the by-year table`);
  const latest = cpi.data[String(blocks.latestYear)];
  for (const r of blocks.rows) {
    const from = cpi.data[String(r.year)];
    assert.ok(from > 0, `by-year table row ${r.year} has no CPI value`);
    assert.ok(r.year < blocks.latestYear, `row ${r.year} is not before ${blocks.latestYear}`);
    approx(r.value, inflationValue(blocks.exampleAmount, from, latest));
    approx(r.change, totalPercentChange(from, latest));
    approx(r.rate, annualizedRate(from, latest, blocks.latestYear - r.year));
    assert.ok(blocks.CPI_YEAR_ROWS.includes(asMoney(r.value)), `${r.year} row is not in the HTML`);
  }
});

t('blocks: a CPI table whose throughYear disagrees with its data is rejected', () => {
  assert.throws(() => inflationBlocks({ throughYear: 1999, data: cpi.data }), /throughYear/);
});

t('template: prints no hand-typed dollar figure, only the example amount', () => {
  const literals = inflationTpl.match(/\$[\d][\d,]*(?:\.\d+)?/g) || [];
  const allowed = '$' + blocks.exampleAmount;
  const stray = [...new Set(literals)].filter((s) => s !== allowed);
  assert.deepEqual(
    stray,
    [],
    `hand-typed dollar figures in the inflation template: ${stray.join(', ')}. ` +
      `Every figure on this page must come from inflationBlocks() so a CPI refresh moves it.`
  );
});

console.log(`\n${pass} passing`);
