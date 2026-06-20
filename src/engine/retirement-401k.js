// retirement-401k.js — pure, dependency-free 401(k) retirement projection math.
// Shared by the browser tool (401k-calculator.js) and the unit tests.
// No deps, nothing uploaded.
//
// Money is in whatever currency the caller uses (no rounding inside the math —
// round at display time). Rates/percents are ANNUAL PERCENT, e.g. 7 means 7%.
//
// Model (standard annual compounding loop, contributions made through the year
// and earning a year of growth):
//   - The employee contributes `employeeContribPct`% of salary each year.
//   - The employer matches that contribution dollar-for-dollar (well, by the
//     stated match rate) but only on salary up to a cap: the match is
//     min(employeeContribPct, matchCapPct)% of salary × (employerMatchPct / 100).
//   - Salary can grow each year by `salaryGrowthPct`%.
//   - The whole balance (starting balance + that year's contributions + match)
//     earns `annualReturnPct`% for the year.
//
// Invalid input (bad numbers, retirement age <= current age, etc.) yields a
// NaN-filled result so the UI can stay quiet (mirrors compound-interest.js).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Employer match for a single year, given the salary that year.
//   matched salary fraction = min(employeeContribPct, matchCapPct) / 100
//   employer dollars        = salary × matched fraction × (employerMatchPct/100)
// employerMatchPct is the cents-on-the-dollar the employer matches (100 = full
// dollar-for-dollar); matchCapPct caps how much of salary qualifies.
export function employerMatchForYear(salary, employeeContribPct, employerMatchPct, matchCapPct) {
  const s = num(salary), ec = num(employeeContribPct);
  const em = num(employerMatchPct), cap = num(matchCapPct);
  if (![s, ec, em, cap].every(Number.isFinite)) return NaN;
  if (s < 0 || ec < 0 || em < 0 || cap < 0) return NaN;
  const matchedPct = Math.min(ec, cap);
  return s * (matchedPct / 100) * (em / 100);
}

// Full projection from `currentAge` to `retirementAge`.
//
// inputs:
//   currentAge, retirementAge        ages in whole years (retirementAge > currentAge)
//   currentBalance                   starting 401(k) balance
//   annualSalary                     salary in the first projected year
//   employeeContribPct               % of salary the employee defers
//   employerMatchPct                 employer match rate (100 = dollar-for-dollar)
//   matchCapPct                      employer matches only up to this % of salary
//   annualReturnPct                  expected annual investment return
//   opts.salaryGrowthPct             optional annual salary growth % (default 0)
//
// Returns:
//   { projectedBalance, totalEmployeeContributions, totalEmployerMatch,
//     totalGrowth, schedule }
// schedule is one row PER YEAR:
//   { age, salary, employeeContribution, employerMatch, growth, balanceEnd }
export function project(
  currentAge, retirementAge, currentBalance, annualSalary,
  employeeContribPct, employerMatchPct, matchCapPct, annualReturnPct, opts = {}
) {
  const a0 = num(currentAge), a1 = num(retirementAge);
  const bal0 = num(currentBalance), sal0 = num(annualSalary);
  const ec = num(employeeContribPct), em = num(employerMatchPct);
  const cap = num(matchCapPct), ret = num(annualReturnPct);
  const growth = num(opts.salaryGrowthPct ?? 0);

  const bad = {
    projectedBalance: NaN, totalEmployeeContributions: NaN,
    totalEmployerMatch: NaN, totalGrowth: NaN, schedule: []
  };

  if (![a0, a1, bal0, sal0, ec, em, cap, ret, growth].every(Number.isFinite)) return bad;
  if (a1 <= a0) return bad;
  if (bal0 < 0 || sal0 < 0 || ec < 0 || em < 0 || cap < 0) return bad;

  const years = Math.round(a1 - a0);
  const r = ret / 100;
  const g = growth / 100;

  let balance = bal0;
  let salary = sal0;
  let totalEmployeeContributions = 0;
  let totalEmployerMatch = 0;
  let totalGrowth = 0;
  const schedule = [];

  for (let y = 0; y < years; y++) {
    const employeeContribution = salary * (ec / 100);
    const employerMatch = employerMatchForYear(salary, ec, em, cap);
    // Contributions go in over the year, then the whole balance earns a year
    // of growth (return applied to start balance + the year's deposits).
    const base = balance + employeeContribution + employerMatch;
    const yearGrowth = base * r;
    balance = base + yearGrowth;

    totalEmployeeContributions += employeeContribution;
    totalEmployerMatch += employerMatch;
    totalGrowth += yearGrowth;

    schedule.push({
      age: Math.round(a0) + y + 1,
      salary,
      employeeContribution,
      employerMatch,
      growth: yearGrowth,
      balanceEnd: balance
    });

    salary *= 1 + g;
  }

  return {
    projectedBalance: balance,
    totalEmployeeContributions,
    totalEmployerMatch,
    totalGrowth,
    schedule
  };
}
