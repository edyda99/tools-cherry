// debt-avalanche.js — pure, dependency-free debt-avalanche payoff math.
// Shared by the browser tool (debt-avalanche-calculator.js) and unit tests.
// No deps, nothing uploaded. No DOM, no Date.now() — the caller passes in
// every value and turns the returned month count into a date itself.
//
// The AVALANCHE method: every month, interest accrues on each balance at its
// monthly rate (APR / 12), every debt's minimum payment is applied, and then a
// single pooled "extra" — the user's extra payment PLUS the freed-up minimums of
// any debts already cleared — is thrown entirely at the debt with the HIGHEST
// APR. As each debt clears, its minimum rolls into that pool, so payments
// snowball onto the next-highest-rate debt. This minimises total interest.
//
// Money is in whatever currency unit the caller uses (no rounding inside the
// math — round at display time). APR is a PERCENT per year (e.g. 19.99), the
// way it appears on a statement; it is converted to a monthly fraction here.
//
// All exported functions are pure and return plain objects/arrays. Invalid or
// empty input yields an empty, NaN-free result so the UI can stay quiet.

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Hard ceiling so a debt that can never be paid off (minimum < monthly interest,
// with no extra reaching it) can't spin forever. 1200 months = 100 years.
const MAX_MONTHS = 1200;
// Treat anything below a tenth of a cent as paid, to absorb float drift.
const EPS = 0.005;

// Normalize one raw debt row into a clean record, or null if unusable.
// A usable debt needs a positive balance; APR and minimum default to 0.
// `id` is preserved so the UI can map results back to its rows.
function cleanDebt(d, index) {
  if (!d || typeof d !== 'object') return null;
  const balance = num(d.balance);
  if (!Number.isFinite(balance) || balance <= 0) return null;
  let apr = num(d.apr);
  if (!Number.isFinite(apr) || apr < 0) apr = 0;
  let minPayment = num(d.minPayment);
  if (!Number.isFinite(minPayment) || minPayment < 0) minPayment = 0;
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : `Debt ${index + 1}`;
  const id = d.id != null ? d.id : index;
  return { id, name, balance, apr, minPayment, monthlyRate: apr / 100 / 12 };
}

// Parse + filter a raw list down to usable debts (positive balance).
export function cleanDebts(debts) {
  if (!Array.isArray(debts)) return [];
  const out = [];
  for (let i = 0; i < debts.length; i++) {
    const c = cleanDebt(debts[i], i);
    if (c) out.push(c);
  }
  return out;
}

// The avalanche payoff ORDER: highest APR first. Ties broken by smaller balance
// first (clears a slot sooner), then by original input order for stability.
// Returns shallow copies with an added `order` (1-based) field.
export function payoffOrder(debts) {
  const clean = cleanDebts(debts);
  const sorted = clean
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      if (b.d.apr !== a.d.apr) return b.d.apr - a.d.apr;       // higher APR first
      if (a.d.balance !== b.d.balance) return a.d.balance - b.d.balance; // smaller balance first
      return a.i - b.i;                                        // stable
    })
    .map((x, idx) => ({ ...x.d, order: idx + 1 }));
  return sorted;
}

// Flag debts whose minimum payment can't even cover the first month's interest.
// At the minimum ALONE such a debt never shrinks — it's only ever cleared
// because the avalanche pool eventually reaches it. Returns the subset, each
// with `monthlyInterest` (first-month interest) attached.
export function neverPayoffAtMinimum(debts) {
  return cleanDebts(debts)
    .filter((d) => d.minPayment < d.balance * d.monthlyRate - EPS && d.monthlyRate > 0)
    .map((d) => ({ ...d, monthlyInterest: d.balance * d.monthlyRate }));
}

// Sum of every minimum payment across usable debts.
export function totalMinimums(debts) {
  return cleanDebts(debts).reduce((s, d) => s + d.minPayment, 0);
}

// Run a full month-by-month simulation.
//
//   strategy: 'avalanche' (extra+freed minimums to highest APR) or
//             'minimums'  (pay only each minimum, no extra, no rollover) —
//             the baseline used to measure what the avalanche saves.
//
// Returns:
//   {
//     payable: true,             // false if input was empty/unusable
//     months,                    // whole months until every balance is 0
//     totalInterest, totalPaid,  // summed across all debts
//     startingBalance,
//     order: [{id,name,apr,balance,minPayment,order}],  // avalanche order
//     schedule: [{ month, totalPaid, totalInterest, remaining,
//                  debts: [{ id, payment, interest, balance }] }],
//     perDebt: [{ id, name, apr, payoffMonth }],         // when each cleared
//     stalled: false             // true if MAX_MONTHS hit (minimums can't clear)
//   }
//
// `extra` is the user's additional monthly payment on top of all minimums.
// It is ignored for the 'minimums' baseline.
export function simulate(debts, extra = 0, strategy = 'avalanche') {
  const empty = {
    payable: false, months: 0, totalInterest: 0, totalPaid: 0,
    startingBalance: 0, order: [], schedule: [], perDebt: [], stalled: false
  };

  const order = payoffOrder(debts);
  if (order.length === 0) return empty;

  let extraPool = num(extra);
  if (!Number.isFinite(extraPool) || extraPool < 0) extraPool = 0;
  if (strategy === 'minimums') extraPool = 0;

  // Working state, kept in avalanche priority order (highest APR first).
  const state = order.map((d) => ({
    id: d.id, name: d.name, apr: d.apr, monthlyRate: d.monthlyRate,
    balance: d.balance, minPayment: d.minPayment, paidOff: false, payoffMonth: null
  }));

  const startingBalance = state.reduce((s, d) => s + d.balance, 0);
  const schedule = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  const remaining = () => state.reduce((s, d) => s + (d.paidOff ? 0 : d.balance), 0);

  while (remaining() > EPS && month < MAX_MONTHS) {
    month += 1;
    const monthDebts = [];
    let monthPaid = 0;
    let monthInterest = 0;

    // 1) Accrue interest on every still-open debt.
    for (const d of state) {
      if (d.paidOff) continue;
      const interest = d.balance * d.monthlyRate;
      d.balance += interest;
      d.interestThisMonth = interest;
      monthInterest += interest;
    }

    // 2) Build this month's spendable pool: the user's extra plus the freed-up
    //    minimums of debts that are already cleared (rollover). In the
    //    'minimums' baseline, extraPool is 0 and nothing rolls over.
    let pool = extraPool;
    if (strategy !== 'minimums') {
      for (const d of state) {
        if (d.paidOff) pool += d.minPayment;
      }
    }

    // 3) Pay each open debt its minimum (capped at its balance).
    const paidThisMonth = new Map();
    for (const d of state) {
      if (d.paidOff) continue;
      const pay = Math.min(d.minPayment, d.balance);
      d.balance -= pay;
      paidThisMonth.set(d.id, pay);
      monthPaid += pay;
    }

    // 4) Throw the whole pool at open debts in avalanche order (highest APR
    //    first); roll any leftover onto the next debt as each clears. The
    //    baseline ('minimums') skips this entirely.
    if (strategy !== 'minimums') {
      for (const d of state) {
        if (pool <= EPS) break;
        if (d.paidOff || d.balance <= EPS) continue;
        const pay = Math.min(pool, d.balance);
        d.balance -= pay;
        pool -= pay;
        paidThisMonth.set(d.id, (paidThisMonth.get(d.id) || 0) + pay);
        monthPaid += pay;
      }
    }

    // 5) Mark anything cleared this month.
    for (const d of state) {
      if (!d.paidOff && d.balance <= EPS) {
        d.balance = 0;
        d.paidOff = true;
        d.payoffMonth = month;
      }
    }

    // Record the month's per-debt snapshot in the original avalanche order.
    for (const d of state) {
      monthDebts.push({
        id: d.id,
        payment: paidThisMonth.get(d.id) || 0,
        interest: d.paidOff && d.payoffMonth < month ? 0 : (d.interestThisMonth || 0),
        balance: d.balance
      });
      d.interestThisMonth = 0;
    }

    totalInterest += monthInterest;
    totalPaid += monthPaid;
    schedule.push({
      month,
      totalPaid: monthPaid,
      totalInterest: monthInterest,
      remaining: remaining(),
      debts: monthDebts
    });

    // Safety: if a whole month passed with no balance reduction at all, the
    // minimums can't cover interest and nothing extra is reaching the debt —
    // it would loop to MAX_MONTHS. Bail and flag it.
    if (monthPaid <= EPS && monthInterest > EPS) break;
  }

  const stalled = remaining() > EPS;

  return {
    payable: true,
    months: month,
    totalInterest,
    totalPaid,
    startingBalance,
    order: order.map((d) => ({
      id: d.id, name: d.name, apr: d.apr,
      balance: d.balance, minPayment: d.minPayment, order: d.order
    })),
    schedule,
    perDebt: state.map((d) => ({ id: d.id, name: d.name, apr: d.apr, payoffMonth: d.payoffMonth })),
    stalled
  };
}

// Compare the avalanche plan against the minimum-only baseline.
// Returns both runs plus the interest and months the avalanche saves.
// `interestSaved` / `monthsSaved` are 0 (never negative) when the baseline
// can't be compared (e.g. it stalls forever on minimums alone).
export function compare(debts, extra = 0) {
  const avalanche = simulate(debts, extra, 'avalanche');
  const baseline = simulate(debts, 0, 'minimums');

  if (!avalanche.payable) {
    return {
      payable: false, avalanche, baseline,
      interestSaved: 0, monthsSaved: 0, baselineComparable: false
    };
  }

  // The baseline is only a fair comparison if minimums alone actually clear the
  // debt (didn't stall). If it stalled, the savings are effectively "infinite";
  // we report 0 and let the UI explain via the never-payoff warning instead.
  const baselineComparable = baseline.payable && !baseline.stalled;
  const interestSaved = baselineComparable
    ? Math.max(0, baseline.totalInterest - avalanche.totalInterest)
    : 0;
  const monthsSaved = baselineComparable
    ? Math.max(0, baseline.months - avalanche.months)
    : 0;

  return { payable: true, avalanche, baseline, interestSaved, monthsSaved, baselineComparable };
}
