// compound-interest.js — pure, dependency-free compound-interest / savings math.
// Shared by the browser tool (compound-interest-calculator.js) and the unit tests.
// No deps, nothing uploaded.
//
// Money is in whatever currency the caller uses (no rounding inside the math —
// round at display time). Rates are an ANNUAL PERCENT, e.g. 5 means 5% per year.
//
// Model: a starting principal grows at a fixed annual rate, compounded n times a
// year, while an optional regular contribution is added each compounding period.
// Contributions can be made at the END of the period (ordinary annuity, the
// default) or at the START (annuity due).
//
// Invalid input (bad numbers, negative term, etc.) yields NaN-filled results so
// the UI can stay quiet (mirrors amortization.js / percentage-math.js).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Future value of a one-off principal compounded `compoundsPerYear` times a year
// for `years` years at `annualRatePct`.
//   P  * (1 + r/n)^(n*t)
export function futureValuePrincipal(principal, annualRatePct, years, compoundsPerYear) {
  const P = num(principal), apr = num(annualRatePct), t = num(years), n = num(compoundsPerYear);
  if (![P, apr, t, n].every(Number.isFinite)) return NaN;
  if (P < 0 || t < 0 || n < 1) return NaN;
  const r = apr / 100 / n;
  return P * Math.pow(1 + r, n * t);
}

// Future value of a regular contribution of `contribution`, added each
// compounding period, compounded `compoundsPerYear` times a year for `years`.
//   end-of-period (ordinary): C * ((1+r)^N - 1) / r
//   start-of-period (due):    that * (1 + r)
// Handles r == 0 as straight C * N.
export function futureValueContributions(contribution, annualRatePct, years, compoundsPerYear, atStart = false) {
  const C = num(contribution), apr = num(annualRatePct), t = num(years), n = num(compoundsPerYear);
  if (![C, apr, t, n].every(Number.isFinite)) return NaN;
  if (C < 0 || t < 0 || n < 1) return NaN;
  const r = apr / 100 / n;
  const N = n * t;
  if (r === 0) return C * N;
  let fv = C * (Math.pow(1 + r, N) - 1) / r;
  if (atStart) fv *= 1 + r;
  return fv;
}

// Full projection. `contribution` is the amount added EACH compounding period
// (so a $100/month deposit with monthly compounding is contribution=100,
// compoundsPerYear=12). Returns:
//   { futureValue, totalPrincipal, totalContributions, totalInterest, schedule }
// totalPrincipal     = the starting lump sum
// totalContributions = every regular deposit added over the term
// totalInterest      = futureValue - totalPrincipal - totalContributions
// schedule is one row PER YEAR: { year, balanceStart, contributions, interest, balanceEnd }.
export function project(principal, contribution, annualRatePct, years, compoundsPerYear, opts = {}) {
  const atStart = !!opts.atStart;
  const P = num(principal), C = num(contribution), apr = num(annualRatePct);
  const t = num(years), n = num(compoundsPerYear);
  const bad = {
    futureValue: NaN, totalPrincipal: NaN, totalContributions: NaN,
    totalInterest: NaN, schedule: []
  };
  if (![P, C, apr, t, n].every(Number.isFinite)) return bad;
  if (P < 0 || C < 0 || t < 0 || n < 1) return bad;

  const r = apr / 100 / n;
  const periods = Math.round(n * t);
  const perYear = Math.round(n);
  let balance = P;
  let totalContributions = 0;
  const schedule = [];
  let yearStartBalance = balance;
  let yearContrib = 0;
  let yearInterest = 0;

  for (let p = 1; p <= periods; p++) {
    let interest;
    if (atStart) {
      // contribution added first, then the whole balance earns interest
      balance += C;
      totalContributions += C;
      yearContrib += C;
      interest = balance * r;
      balance += interest;
    } else {
      // balance earns interest, then the contribution is added
      interest = balance * r;
      balance += interest;
      balance += C;
      totalContributions += C;
      yearContrib += C;
    }
    yearInterest += interest;

    // Close out a year-row whenever we cross a whole year (or hit the end).
    if (p % perYear === 0 || p === periods) {
      schedule.push({
        year: Math.ceil(p / perYear),
        balanceStart: yearStartBalance,
        contributions: yearContrib,
        interest: yearInterest,
        balanceEnd: balance
      });
      yearStartBalance = balance;
      yearContrib = 0;
      yearInterest = 0;
    }
  }

  const futureValue = balance;
  const totalPrincipal = P;
  const totalInterest = futureValue - totalPrincipal - totalContributions;
  return { futureValue, totalPrincipal, totalContributions, totalInterest, schedule };
}
