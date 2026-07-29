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

// _meta.lastSourced is not a decoration: build.js renders it to every state and
// bonus page as "verified <date>", which is a factual claim to a reader about when
// a human last checked the figures. So the date is WRONG the moment the figures it
// describes change underneath it. The 13-month warn above cannot see that: on
// 2026-07-29 six states' brackets were rewritten while lastSourced still read
// 2026-06-16, a 43-day lie that this script passed silently.
//
// The precise invariant: if the last commit touching tax-data-2026.json is NEWER
// than _meta.lastSourced, the rendered date describes figures that no longer exist.
// Warn rather than fail, deliberately: the honest fix is to RE-VERIFY and then bump
// the date, which is a human or monthly-audit action, and a hard fail would only
// pressure someone into bumping the date without doing the verification, which is
// the exact overclaim this is meant to prevent.
if (sourcedStr) {
  try {
    const { execFileSync } = await import('node:child_process');
    const lastDataCommit = execFileSync(
      'git',
      ['log', '-1', '--format=%cs', '--', 'src/data/tax-data-2026.json'],
      { cwd: join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (lastDataCommit && lastDataCommit > sourcedStr) {
      const days = Math.round((new Date(lastDataCommit) - sourced) / 86400000);
      warns.push(
        `tax-data-2026.json was last changed ${lastDataCommit} but _meta.lastSourced still says ` +
        `${sourcedStr}, ${days} days earlier. Every state and bonus page is telling readers ` +
        `"verified ${sourcedStr}" about figures edited since. Re-verify, then set ` +
        `_meta.lastSourced to the date you actually checked. Do not bump it without checking.`,
      );
    }
  } catch {
    // Not a git checkout, or git unavailable. Silent: this guard is a bonus, and the
    // year and 13-month checks above still run.
  }
}

warns.forEach((w) => console.warn('⚠ FRESHNESS WARN: ' + w));
if (fail) {
  console.error('✖ FRESHNESS FAIL: ' + fail);
  process.exit(1);
}
console.log(`ok  - freshness: tax year ${taxYear}, figures sourced ${sourcedStr || 'unknown'}`);
