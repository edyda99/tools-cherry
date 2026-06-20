// sales-tax.js — pure, dependency-free sales-tax calculations.
// Shared by the browser tool (sales-tax-calculator.js) and the unit tests.
// Each function returns an object of numbers, or NaN fields when an input is
// not a finite number (the UI is responsible for hiding NaN).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Add tax: given a pre-tax price and a tax rate (as a percent, e.g. 8.25),
// return the tax amount and the tax-included total.
// e.g. addTax(100, 8.25) -> { price: 100, tax: 8.25, total: 108.25 }
export function addTax(price, ratePct) {
  const p = num(price), r = num(ratePct);
  const tax = (p * r) / 100;
  return { price: p, tax, total: p + tax };
}

// Remove tax: given a tax-included total and the tax rate (as a percent),
// back out the original pre-tax price and the tax amount.
// e.g. removeTax(108.25, 8.25) -> { price: 100, tax: 8.25, total: 108.25 }
// A rate of -100% (divisor of zero) is undefined — return NaN fields.
export function removeTax(total, ratePct) {
  const t = num(total), r = num(ratePct);
  const denom = 1 + r / 100;
  if (denom === 0) return { price: NaN, tax: NaN, total: t };
  const price = t / denom;
  return { price, tax: t - price, total: t };
}
