// test-ss-maxout.js — unit tests for the Social Security wage-base max-out
// date engine (docs/ss-wage-base-calculator-spec.md). Run:
// node scripts/test-ss-maxout.js
//
// All 10 fixtures are from the sourced spec's §4 fixture table. Constants
// (2026): wageBase = $184,500, ssRate = 0.062, maxSS = $11,439.00.
import { projectMaxOut, nextPayDates, excessFica, formatISODate } from '../src/engine/ss-maxout-engine.js';

let pass = 0, fail = 0;
function is(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function ok(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL ${name}`); }
}

const PARAMS = { 2026: { wageBase: 184500, ssRate: 0.062 } };
const MAX_SS = 11439.00;

// --- nextPayDates: the new calendar scheduler (spec §3.9) -----------------------
is('weekly period2 = +7 days', formatISODate(nextPayDates('2026-01-02', 'weekly', 2)[1]), '2026-01-09');
is('biweekly period2 = +14 days', formatISODate(nextPayDates('2026-08-07', 'biweekly', 2)[1]), '2026-08-21');
is('monthly Jan31 +1mo clamps to Feb28 (2026 not a leap year)', formatISODate(nextPayDates('2026-01-31', 'monthly', 2)[1]), '2026-02-28');
is('monthly Jul31 +4mo = Nov30 (clamped)', formatISODate(nextPayDates('2026-07-31', 'monthly', 5)[4]), '2026-11-30');
is('semimonthly 15th -> last day of same month', formatISODate(nextPayDates('2026-12-15', 'semimonthly', 2)[1]), '2026-12-31');
is('semimonthly last-day -> 15th of next month (year rollover)', formatISODate(nextPayDates('2026-12-15', 'semimonthly', 3)[2]), '2027-01-15');

// --- F1: exact boundary (biweekly) -----------------------------------------------
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 174900, payFrequency: 'biweekly',
    nextPayDate: '2026-11-06', perPeriodSSWages: 9600, params: PARAMS
  });
  is('F1 alreadyMaxed', r.alreadyMaxed, false);
  is('F1 willNotMaxOutThisYear', r.willNotMaxOutThisYear, false);
  is('F1 capReachedPeriod (k*=1)', r.capReachedPeriod, 1);
  is('F1 capReachedDate', r.capReachedDate, '2026-11-06');
  is('F1 ssOnCrossing = full $595.20', r.ssOnCrossing, 595.20);
  is('F1 firstZeroSSDate', r.firstZeroSSDate, '2026-11-20');
  is('F1 bumpAmount = +$595.20', r.bumpAmount, 595.20);
  is('F1 rolledIntoNextYear', r.rolledIntoNextYear, false);
  is('F1 totalSSForYear = $11,439.00', r.totalSSForYear, MAX_SS);
}

// --- F2: crossing mid-period, partial withholding (biweekly) --------------------
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 160000, payFrequency: 'biweekly',
    nextPayDate: '2026-08-07', perPeriodSSWages: 7000, params: PARAMS
  });
  is('F2 capReachedPeriod (k*=4)', r.capReachedPeriod, 4);
  is('F2 capReachedDate', r.capReachedDate, '2026-09-18');
  is('F2 ssOnCrossing = partial $217.00', r.ssOnCrossing, 217.00);
  is('F2 firstZeroSSDate', r.firstZeroSSDate, '2026-10-02');
  is('F2 bumpAmount = full $434.00', r.bumpAmount, 434.00);
  is('F2 totalSSForYear = $11,439.00', r.totalSSForYear, MAX_SS);
}

// --- F3: mid-year job start — per-employer reset, does NOT max out (monthly) ----
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 0, payFrequency: 'monthly',
    nextPayDate: '2026-08-31', perPeriodSSWages: 18000, params: PARAMS
  });
  is('F3 willNotMaxOutThisYear', r.willNotMaxOutThisYear, true);
  is('F3 alreadyMaxed', r.alreadyMaxed, false);
  is('F3 capReachedDate is null', r.capReachedDate, null);
  is('F3 totalSSForYear = 90,000 x 6.2% = $5,580.00', r.totalSSForYear, 5580.00);
  ok('F3 note explains per-employer reset', /employer/i.test(r.notes.join(' ')));
}

// --- F4: uneven pay — mid-year raise (two-phase, biweekly) ----------------------
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 150000, payFrequency: 'biweekly',
    nextPayDate: '2026-08-28', perPeriodSSWages: 6000,
    payRaise: { effectiveOnPeriod: 3, newPerPeriodSSWages: 9000 },
    params: PARAMS
  });
  is('F4 capReachedPeriod (k*=5)', r.capReachedPeriod, 5);
  is('F4 capReachedDate', r.capReachedDate, '2026-10-23');
  is('F4 ssOnCrossing = partial $279.00', r.ssOnCrossing, 279.00);
  is('F4 firstZeroSSDate', r.firstZeroSSDate, '2026-11-06');
  is('F4 bumpAmount = +$558.00 (post-raise level)', r.bumpAmount, 558.00);
}

// --- F5: should never max out — low income (weekly, full year) -----------------
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 0, payFrequency: 'weekly',
    nextPayDate: '2026-01-02', perPeriodSSWages: 1200, params: PARAMS
  });
  is('F5 willNotMaxOutThisYear', r.willNotMaxOutThisYear, true);
  is('F5 totalSSForYear = 62,400 x 6.2% = $3,868.80', r.totalSSForYear, 3868.80);
}

// --- F6: already maxed out ---------------------------------------------------
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 190000, payFrequency: 'biweekly',
    nextPayDate: '2026-11-06', perPeriodSSWages: 9600, params: PARAMS
  });
  is('F6 alreadyMaxed', r.alreadyMaxed, true);
  is('F6 capReachedDate is null (no future date)', r.capReachedDate, null);
  is('F6 totalSSForYear capped at $11,439.00 (not 190,000 x 6.2%)', r.totalSSForYear, MAX_SS);
}

// --- F7: exact boundary on the LAST pay date of the year -> rollover (semimonthly)
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 178300, payFrequency: 'semimonthly',
    nextPayDate: '2026-12-15', perPeriodSSWages: 3100, params: PARAMS
  });
  is('F7 capReachedPeriod (k*=2)', r.capReachedPeriod, 2);
  is('F7 capReachedDate = last SS check of the year', r.capReachedDate, '2026-12-31');
  is('F7 ssOnCrossing = full $192.20', r.ssOnCrossing, 192.20);
  is('F7 firstZeroSSDate rolls into next year', r.firstZeroSSDate, '2027-01-15');
  is('F7 rolledIntoNextYear', r.rolledIntoNextYear, true);
  is('F7 totalSSForYear = $11,439.00 (it DID max out, just at year-end)', r.totalSSForYear, MAX_SS);
  ok('F7 note explains no visible in-year bump', /reset|January 1|resets/i.test(r.notes.join(' ')));
}

// --- F8: excess-FICA, multi-employer -> claimable on Schedule 3 -----------------
{
  const r = excessFica({ ssWithheldByEmployer: [7440.00, 6820.00], numEmployers: 2, maxSS: MAX_SS });
  is('F8 totalSSWithheld', r.totalSSWithheld, 14260.00);
  is('F8 excess', r.excess, 2821.00);
  is('F8 claimableOn1040', r.claimableOn1040, true);
  ok('F8 remedy points to Schedule 3', /Schedule 3/i.test(r.remedy));
}

// --- F9: single-employer over-withholding — NOT claimable (the wrinkle) --------
{
  const r = excessFica({ ssWithheldByEmployer: [11780.00], numEmployers: 1, maxSS: MAX_SS });
  is('F9 totalSSWithheld', r.totalSSWithheld, 11780.00);
  is('F9 excess exists', r.excess, 341.00);
  is('F9 claimableOn1040 is FALSE (the correction)', r.claimableOn1040, false);
  ok('F9 remedy says employer/Form 843, NOT "claim it"', /Form 843/i.test(r.remedy) && !/Schedule 3/i.test(r.remedy));
}

// --- F10: mid-year crossing, clean in-year bump (monthly) -----------------------
{
  const r = projectMaxOut({
    taxYear: 2026, ytdSSWages: 100000, payFrequency: 'monthly',
    nextPayDate: '2026-07-31', perPeriodSSWages: 20000, params: PARAMS
  });
  is('F10 capReachedPeriod (k*=5)', r.capReachedPeriod, 5);
  is('F10 capReachedDate', r.capReachedDate, '2026-11-30');
  is('F10 ssOnCrossing = partial $279.00', r.ssOnCrossing, 279.00);
  is('F10 firstZeroSSDate', r.firstZeroSSDate, '2026-12-31');
  is('F10 bumpAmount = +$1,240.00', r.bumpAmount, 1240.00);
  is('F10 rolledIntoNextYear', r.rolledIntoNextYear, false);
}

// --- structure / correction guards ----------------------------------------------
{
  const invalid = projectMaxOut({
    taxYear: 2026, ytdSSWages: 100000, payFrequency: 'monthly',
    nextPayDate: '2026-07-31', perPeriodSSWages: 0, params: PARAMS
  });
  is('guard: perPeriodSSWages <= 0 cannot project', invalid.error, 'invalid_per_period');
}
{
  const unsupported = projectMaxOut({
    taxYear: 2027, ytdSSWages: 0, payFrequency: 'monthly',
    nextPayDate: '2027-07-31', perPeriodSSWages: 1000, params: PARAMS
  });
  is('guard: 2027 not in params -> unsupported_tax_year (2027 wage base not yet published)', unsupported.error, 'unsupported_tax_year');
}
ok('excessFica numEmployers defaults to array length when omitted',
  excessFica({ ssWithheldByEmployer: [7440.00, 6820.00], maxSS: MAX_SS }).claimableOn1040);

console.log(`\nSS wage-base max-out engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
