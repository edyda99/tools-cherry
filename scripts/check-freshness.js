// check-freshness.js — fails the test suite when the tax data is stale, so a
// past-year dataset can never ship silently. This is the primary safeguard:
// it runs on every `npm test` and every deploy (build runs a warn-only copy).
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'tax-data-2026.json'), 'utf8'));

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const taxYear = data.taxYear;
const sourcedStr = data._meta && data._meta.lastSourced;
const sourced = sourcedStr ? new Date(sourcedStr) : null;
const monthsSince = sourced ? (now - sourced) / (1000 * 60 * 60 * 24 * 30.44) : Infinity;

const warns = [];
let fail = null;

if (year > taxYear) {
  fail = `tax data is for ${taxYear} but it is now ${year}. ` +
    `Source ${year} federal + state figures (IRS Rev. Proc. + each state DOR), ` +
    `create tax-data-${year}.json, bump taxYear, and re-verify before deploying.`;
} else {
  if (year === taxYear && month >= 11) {
    warns.push(`Next-year (${taxYear + 1}) IRS/SSA figures are typically published by November — start the ${taxYear + 1} refresh.`);
  }
  if (monthsSince > 13) {
    warns.push(`Figures last sourced ${sourcedStr} (~${Math.round(monthsSince)} months ago) — re-verify against official sources.`);
  }
}

warns.forEach((w) => console.warn('⚠ FRESHNESS WARN: ' + w));
if (fail) {
  console.error('✖ FRESHNESS FAIL: ' + fail);
  process.exit(1);
}
console.log(`ok  - freshness: tax year ${taxYear}, figures sourced ${sourcedStr || 'unknown'}`);
