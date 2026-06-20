// tip-math.js — pure, dependency-free tip & bill-split calculations.
// Shared by the browser tool (tip-calculator.js) and the unit tests.
// Functions return numbers, or NaN for non-finite / invalid input
// (the UI is responsible for hiding NaN — keep these honest about bad input).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Tip amount for a bill at a given tip percent.
// e.g. tipAmount(50, 20) === 10
export function tipAmount(bill, tipPercent) {
  const b = num(bill), p = num(tipPercent);
  return (b * p) / 100;
}

// Compute the full split. Returns an object of finite numbers, or an object of
// NaN when inputs are invalid (bill not finite, people < 1, etc.).
// `roundUp` rounds each person's share up to the next whole currency unit, then
// recomputes the totals so they stay consistent with what people actually pay.
//
// e.g. splitBill({ bill: 50, tipPercent: 20, people: 2 })
//   -> { tip: 10, total: 60, perPerson: 30, perPersonTip: 5 }
// `tax` + `tipOnPreTax`: when tipOnPreTax is true, the tip is computed on the
// pre-tax subtotal (bill − tax) rather than the full bill (common US etiquette).
// The TOTAL still includes the full bill (you pay the tax) — only the tip basis
// changes. Defaults (tax 0, tipOnPreTax false) reproduce the original behavior.
export function splitBill({ bill, tipPercent, people, roundUp = false, tax = 0, tipOnPreTax = false } = {}) {
  const b = num(bill);
  const p = num(tipPercent);
  let n = num(people);
  // People must be a whole number >= 1; otherwise the split is undefined.
  n = Number.isFinite(n) ? Math.floor(n) : NaN;

  if (!Number.isFinite(b) || !Number.isFinite(p) || !Number.isFinite(n) || n < 1) {
    return { tip: NaN, total: NaN, perPerson: NaN, perPersonTip: NaN };
  }

  const t = num(tax);
  const taxVal = Number.isFinite(t) && t > 0 ? t : 0;
  const tipBase = tipOnPreTax ? Math.max(0, b - taxVal) : b;
  const tip = (tipBase * p) / 100;
  const total = b + tip;

  if (!roundUp) {
    const perPerson = total / n;
    return { tip, total, perPerson, perPersonTip: tip / n };
  }

  // Round each share up to the next whole unit. The collected total is then the
  // rounded share times the number of people (everyone pays the same amount).
  const perPerson = Math.ceil(total / n);
  const roundedTotal = perPerson * n;
  const roundedTip = roundedTotal - b;
  return {
    tip: roundedTip,
    total: roundedTotal,
    perPerson,
    perPersonTip: roundedTip / n
  };
}
