// amortization.js — pure, dependency-free loan amortization math.
// Shared by the browser tools (mortgage-calculator.js, and later auto-loan) and
// the unit tests. No deps, nothing uploaded.
//
// All money is in whatever currency the caller uses (no rounding inside the
// math — round at display time). Rates are given as an ANNUAL PERCENT, e.g. 6
// means 6% per year; the monthly rate is annualRatePct / 100 / 12.
//
// Functions return finite numbers for valid input. Invalid/negative principal
// or term yields NaN so the UI can stay quiet (mirrors percentage-math.js).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Fixed monthly payment (principal + interest) for a fully-amortizing loan.
//   principal     — amount borrowed
//   annualRatePct — annual interest rate as a percent (6 = 6%)
//   termMonths    — number of monthly payments
// Handles 0% interest as straight division (principal / termMonths) — no NaN.
export function monthlyPayment(principal, annualRatePct, termMonths) {
  const P = num(principal), apr = num(annualRatePct), n = num(termMonths);
  if (!Number.isFinite(P) || !Number.isFinite(apr) || !Number.isFinite(n)) return NaN;
  if (P < 0 || n <= 0) return NaN;
  const i = apr / 100 / 12; // monthly rate
  if (i === 0) return P / n; // 0% interest: equal principal slices
  const factor = Math.pow(1 + i, n);
  return (P * i * factor) / (factor - 1);
}

// Full amortization of a loan. Returns:
//   { monthlyPayment, totalPaid, totalInterest, schedule }
// schedule is an array of { month, payment, interest, principal, balance }.
// Pass { schedule: false } to skip building the (large) schedule array.
export function amortize(principal, annualRatePct, termMonths, opts = {}) {
  const buildSchedule = opts.schedule !== false;
  const P = num(principal), apr = num(annualRatePct), n = num(termMonths);
  const pay = monthlyPayment(P, apr, n);
  if (!Number.isFinite(pay)) {
    return { monthlyPayment: NaN, totalPaid: NaN, totalInterest: NaN, schedule: [] };
  }

  const i = apr / 100 / 12;
  const months = Math.round(n);
  let balance = P;
  let totalInterest = 0;
  const schedule = [];

  for (let m = 1; m <= months; m++) {
    const interest = balance * i;
    let principalPaid = pay - interest;
    // Last payment: settle any rounding drift so the balance lands on zero.
    if (m === months) principalPaid = balance;
    balance = Math.max(0, balance - principalPaid);
    totalInterest += interest;
    if (buildSchedule) {
      schedule.push({
        month: m,
        payment: interest + principalPaid,
        interest,
        principal: principalPaid,
        balance
      });
    }
  }

  const totalPaid = P + totalInterest;
  return { monthlyPayment: pay, totalPaid, totalInterest, schedule };
}

// How long it takes to clear a balance given a FIXED monthly payment.
// Used by the debt-payoff calculator's "by monthly payment" mode.
//   balance        — current amount owed
//   annualRatePct  — annual interest rate as a percent (20 = 20% APR)
//   monthlyPayment — the fixed amount paid each month
// Returns:
//   { months, totalInterest, totalPaid, neverPayoff: false }  on success
//   { neverPayoff: true, monthlyInterest, minPayment }        when the payment
//     can never reduce the balance (payment <= the first month's interest).
//     minPayment is the interest on the starting balance — pay strictly more
//     than this and the balance starts to fall.
// Invalid input (bad numbers, balance <= 0, payment <= 0) yields
//   { months: NaN, totalInterest: NaN, totalPaid: NaN, neverPayoff: false }.
export function monthsToPayoff(balance, annualRatePct, monthlyPayment) {
  const B = num(balance), apr = num(annualRatePct), pay = num(monthlyPayment);
  const bad = { months: NaN, totalInterest: NaN, totalPaid: NaN, neverPayoff: false };
  if (!Number.isFinite(B) || !Number.isFinite(apr) || !Number.isFinite(pay)) return bad;
  if (B <= 0 || pay <= 0 || apr < 0) return bad;

  const i = apr / 100 / 12; // monthly rate
  // 0% interest: balance just divides by the payment.
  if (i === 0) {
    const months = Math.ceil(B / pay);
    return { months, totalInterest: 0, totalPaid: B, neverPayoff: false };
  }

  const monthlyInterest = B * i; // interest accrued in the first month
  // Payment must exceed the first month's interest, or the balance never falls.
  if (pay <= monthlyInterest) {
    return { neverPayoff: true, monthlyInterest, minPayment: monthlyInterest,
             months: Infinity, totalInterest: Infinity, totalPaid: Infinity };
  }

  // Closed-form payoff length, rounded up to whole months.
  const months = Math.ceil(Math.log(pay / (pay - B * i)) / Math.log(1 + i));

  // Walk the schedule to get exact interest (last payment is partial).
  let bal = B;
  let totalInterest = 0;
  for (let m = 1; m <= months; m++) {
    const interest = bal * i;
    let principalPaid = pay - interest;
    if (principalPaid >= bal) principalPaid = bal; // final, partial payment
    bal = Math.max(0, bal - principalPaid);
    totalInterest += interest;
    if (bal <= 0) break;
  }

  return { months, totalInterest, totalPaid: B + totalInterest, neverPayoff: false };
}
