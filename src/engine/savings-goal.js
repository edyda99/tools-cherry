// savings-goal.js — pure, dependency-free "how much must I save" math.
// Shared by the browser tool (savings-goal-calculator.js) and the unit tests.
// No deps, nothing uploaded.
//
// This is the INVERSE of a forward savings projection: given a target amount,
// a starting balance, an annual interest rate and a number of years, it solves
// for the regular contribution (per period) needed to hit the goal — and, the
// other way around, the time needed to reach a goal at a fixed contribution.
//
// Money is in whatever currency the caller uses (round at display time). Rates
// are an ANNUAL PERCENT, e.g. 5 means 5% per year. Contributions are assumed
// at the END of each period (ordinary annuity).
//
// Invalid input yields NaN-filled results so the UI can stay quiet (mirrors
// compound-interest.js / amortization.js).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Future value of a starting principal `P` plus a regular per-period
// contribution `C`, over `periods` periods at a per-period rate `r`.
//   P*(1+r)^N + C*((1+r)^N - 1)/r      (r != 0)
//   P + C*N                            (r == 0)
function futureValue(P, C, r, periods) {
  if (r === 0) return P + C * periods;
  const growth = Math.pow(1 + r, periods);
  return P * growth + C * (growth - 1) / r;
}

// Required per-period contribution to reach `target` from `principal` over
// `years`, compounding/contributing `periodsPerYear` times a year at
// `annualRatePct`. Returns:
//   { contribution, periods, totalContributions, totalInterest, startingBalance, target }
// contribution is the amount per period (e.g. per month when periodsPerYear=12).
// If the starting balance alone already grows past the target, contribution is 0.
export function requiredContribution(target, principal, annualRatePct, years, periodsPerYear) {
  const T = num(target), P = num(principal), apr = num(annualRatePct);
  const t = num(years), n = num(periodsPerYear);
  const bad = {
    contribution: NaN, periods: NaN, totalContributions: NaN,
    totalInterest: NaN, startingBalance: NaN, target: NaN
  };
  if (![T, P, apr, t, n].every(Number.isFinite)) return bad;
  if (T < 0 || P < 0 || t <= 0 || n < 1) return bad;

  const r = apr / 100 / n;
  const periods = Math.round(n * t);
  if (periods < 1) return bad;

  const growth = r === 0 ? 1 : Math.pow(1 + r, periods);
  // Future value of the starting balance alone.
  const fvPrincipal = P * growth;
  // Remaining gap the contributions must cover.
  const gap = T - fvPrincipal;

  let contribution;
  if (gap <= 0) {
    contribution = 0; // the starting balance already gets there
  } else if (r === 0) {
    contribution = gap / periods;
  } else {
    // gap = C * ((1+r)^N - 1)/r  =>  C = gap * r / ((1+r)^N - 1)
    contribution = gap * r / (growth - 1);
  }

  const totalContributions = contribution * periods;
  const totalInterest = T - P - totalContributions;
  return {
    contribution,
    periods,
    totalContributions,
    totalInterest,
    startingBalance: P,
    target: T
  };
}

// Inverse the other way: how long (in whole periods) to reach `target` saving a
// fixed `contribution` per period from `principal` at `annualRatePct`,
// contributing `periodsPerYear` times a year. Returns:
//   { periods, years, months, totalContributions, totalInterest, finalBalance }
// finalBalance is the balance after the returned (whole) number of periods, which
// is the first period at or above the target. Returns NaN-filled when the goal
// can never be reached (e.g. no growth and no/insufficient contribution) or after
// a generous cap (1200 periods ~ 100 monthly years) to avoid runaway loops.
export function timeToGoal(target, principal, annualRatePct, contribution, periodsPerYear) {
  const T = num(target), P = num(principal), apr = num(annualRatePct);
  const C = num(contribution), n = num(periodsPerYear);
  const bad = {
    periods: NaN, years: NaN, months: NaN,
    totalContributions: NaN, totalInterest: NaN, finalBalance: NaN
  };
  if (![T, P, apr, C, n].every(Number.isFinite)) return bad;
  if (T < 0 || P < 0 || C < 0 || n < 1) return bad;

  const r = apr / 100 / n;
  if (P >= T) {
    return {
      periods: 0, years: 0, months: 0,
      totalContributions: 0, totalInterest: 0, finalBalance: P
    };
  }

  const CAP = 1200;
  for (let periods = 1; periods <= CAP; periods++) {
    const fv = futureValue(P, C, r, periods);
    if (fv >= T) {
      const totalContributions = C * periods;
      const totalInterest = fv - P - totalContributions;
      return {
        periods,
        years: Math.floor(periods / n),
        months: Math.round((periods / n - Math.floor(periods / n)) * 12),
        totalContributions,
        totalInterest,
        finalBalance: fv
      };
    }
  }
  return bad; // unreachable within the cap
}

export { futureValue };
