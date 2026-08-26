// inflation-blocks.js — every figure the inflation calculator page prints in
// prose, computed at build time from src/data/cpi-us.json through the same
// engine the browser tool uses.
//
// Why this file exists: the page used to carry hand-typed example numbers
// ("$100 in 2000 is about $183 in 2024, prices up about 83%"). Both were wrong
// against the shipped CPI table — the real answers are $182.17 and 82.2% — and
// nothing in the build could notice, because a sentence is not a test. Every
// number on that page now comes from here, so a CPI refresh moves the prose
// with the data and scripts/test-inflation.js can re-derive the lot.
//
// Nothing in here is page markup for its own sake: the two callers are build.js
// (placeholder map) and the unit tests (re-derivation), and the export is a
// plain object of strings so both see identical values.
import {
  inflationValue,
  totalPercentChange,
  annualizedRate
} from '../engine/inflation.js';

// Same formatters as src/assets/inflation-calculator.js. The pre-rendered
// result block in the template has to be byte-identical to what the browser
// writes over it on load, otherwise the first paint visibly twitches.
const money = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const pct = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
const signedPct = (n) => (n > 0 ? '+' : '') + pct(n);
// Prose and table percentages are never overwritten by the browser, so they get
// a fixed decimal place instead: without it a column of "82.2% / 140% / 43.9%"
// reads as three different precisions. The live-result strings above must stay
// on `pct` exactly, since the asset rewrites them on load.
const fixedPct = (n) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

// The anchor years for the "by year" table. Decade starts plus the first year
// of the series, filtered against the data so a shorter table can never print a
// row with a blank in it.
const ANCHOR_YEARS = [1913, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

// The amount every worked example on the page starts from. One constant so the
// lede, the table heading, the table body and the FAQ schema cannot disagree.
const EXAMPLE_AMOUNT = 100;

export function inflationBlocks(cpi) {
  const data = (cpi && cpi.data) || {};
  const years = Object.keys(data).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!years.length) throw new Error('inflationBlocks: cpi-us.json has no usable years');

  const firstYear = years[0];
  const latestYear = years[years.length - 1];
  if (cpi.throughYear != null && Number(cpi.throughYear) !== latestYear) {
    // A throughYear that disagrees with the data is exactly the drift this file
    // exists to catch, and it would silently mislabel every heading below.
    throw new Error(`inflationBlocks: throughYear ${cpi.throughYear} is not the latest data year ${latestYear}`);
  }

  const cpiOf = (y) => data[String(y)];
  const latestCpi = cpiOf(latestYear);

  // The calculator's own opening state, computed here rather than in the
  // browser so the answer is in the HTML a crawler reads without running JS.
  // The template stamps these two years onto the selects as data-default and
  // the asset reads them back, so there is one source for "which years does
  // this page open on" instead of two implementations that drift.
  const defaultFrom = Math.max(firstYear, latestYear - 25);
  const defaultTo = latestYear;
  const defaultValue = inflationValue(EXAMPLE_AMOUNT, cpiOf(defaultFrom), cpiOf(defaultTo));
  const defaultChange = totalPercentChange(cpiOf(defaultFrom), cpiOf(defaultTo));
  const defaultRate = annualizedRate(cpiOf(defaultFrom), cpiOf(defaultTo), defaultTo - defaultFrom);
  const defaultMult = cpiOf(defaultTo) / cpiOf(defaultFrom);

  const row = (y) => {
    const value = inflationValue(EXAMPLE_AMOUNT, cpiOf(y), latestCpi);
    const change = totalPercentChange(cpiOf(y), latestCpi);
    const rate = annualizedRate(cpiOf(y), latestCpi, latestYear - y);
    return { year: y, value, change, rate };
  };

  const rows = ANCHOR_YEARS.filter((y) => cpiOf(y) != null && y < latestYear).map(row);

  const tableRows = rows
    .map(
      (r) =>
        `<tr><td>${r.year}</td><td class="num">${money(r.value)}</td>` +
        `<td class="num">${fixedPct(r.change)}</td><td class="num">${fixedPct(r.rate)}</td></tr>`
    )
    .join('\n');

  // The two worked examples the prose leans on. 2000 is the round anchor most
  // people reach for; the reverse direction answers the other half of the
  // question ("what would today's money have bought back then").
  const anchor = rows.find((r) => r.year === 2000) || rows[rows.length - 1];
  const anchorBack = inflationValue(EXAMPLE_AMOUNT, latestCpi, cpiOf(anchor.year));

  // The year <option>s, pre-rendered. The asset rebuilds this exact list on load,
  // but shipping it in the HTML means the two selects arrive at their final width
  // instead of expanding from empty under the answer, and a reader (or a crawler)
  // without the module can still see which years the page covers.
  const options = (selected) =>
    years
      .map((y) => `<option value="${y}"${y === selected ? ' selected' : ''}>${y}</option>`)
      .join('');

  return {
    // --- raw values, for the tests and for callers that want to do their own maths
    firstYear,
    latestYear,
    defaultFrom,
    defaultTo,
    exampleAmount: EXAMPLE_AMOUNT,
    defaultValue,
    defaultChange,
    defaultRate,
    anchorYear: anchor.year,
    anchorValue: anchor.value,
    anchorChange: anchor.change,
    anchorBackValue: anchorBack,
    rows,

    // --- formatted strings, exactly as they appear on the page
    CPI_FIRST_YEAR: String(firstYear),
    CPI_LATEST_YEAR: String(latestYear),
    CPI_RANGE: `${firstYear}–${latestYear}`,
    CPI_DEFAULT_FROM: String(defaultFrom),
    CPI_DEFAULT_TO: String(defaultTo),
    CPI_DEFAULT_AMOUNT: String(EXAMPLE_AMOUNT),
    CPI_DEFAULT_AMOUNT_MONEY: money(EXAMPLE_AMOUNT),
    CPI_DEFAULT_BIG: money(defaultValue),
    CPI_DEFAULT_SUB:
      `${money(EXAMPLE_AMOUNT)} in ${defaultFrom} has the same buying power as ` +
      `${money(defaultValue)} in ${defaultTo}`,
    CPI_DEFAULT_CHANGE_LABEL: `Total price change ${defaultFrom}→${defaultTo}`,
    CPI_DEFAULT_CHANGE: signedPct(defaultChange),
    CPI_DEFAULT_RATE: signedPct(defaultRate),
    // Unsigned twins of the two above, for the sentence over the calculator: a
    // "+" belongs in a result row, not mid-prose ("US prices rose +88.3%").
    CPI_DEFAULT_CHANGE_TEXT: pct(defaultChange),
    CPI_DEFAULT_RATE_TEXT: pct(defaultRate),
    CPI_DEFAULT_MULT: defaultMult.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '×',
    CPI_ANCHOR_YEAR: String(anchor.year),
    CPI_ANCHOR_VALUE: money(anchor.value),
    CPI_ANCHOR_CHANGE: fixedPct(anchor.change),
    CPI_ANCHOR_RATE: fixedPct(anchor.rate),
    CPI_ANCHOR_BACK: money(anchorBack),
    CPI_YEAR_ROWS: tableRows,
    CPI_FROM_OPTIONS: options(defaultFrom),
    CPI_TO_OPTIONS: options(defaultTo)
  };
}
