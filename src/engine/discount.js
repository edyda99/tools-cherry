// discount.js — pure, dependency-free discount / sale-price calculations.
// Shared by the browser tool (discount-calculator.js) and the unit tests.
// Functions return numbers, or NaN for non-finite / invalid input
// (the UI is responsible for hiding NaN — keep these honest about bad input).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Sale price after a percent-off discount. e.g. salePrice(80, 25) === 60
export function salePrice(price, percentOff) {
  const p = num(price), d = num(percentOff);
  if (!Number.isFinite(p) || !Number.isFinite(d)) return NaN;
  return p * (1 - d / 100);
}

// Full breakdown for an item discounted by `percentOff`, with optional sales
// tax (applied to the discounted price) and an optional quantity.
//
// Returns an object of finite numbers, or an object of NaN when inputs are
// invalid (price not finite, percent not finite, quantity < 1, etc.).
//
// e.g. discountBreakdown({ price: 80, percentOff: 25 })
//   -> { saved: 20, sale: 60, taxAmount: 0, finalEach: 60, finalTotal: 60, quantity: 1 }
//
// `taxPercent` defaults to 0 (no tax). `quantity` defaults to 1. Tax is charged
// on the sale price, matching how stores ring up a discounted item.
export function discountBreakdown({ price, percentOff, taxPercent = 0, quantity = 1 } = {}) {
  const p = num(price);
  const d = num(percentOff);
  const tax = num(taxPercent);
  let q = num(quantity);
  q = Number.isFinite(q) ? Math.floor(q) : NaN;

  if (!Number.isFinite(p) || !Number.isFinite(d) || !Number.isFinite(tax) || !Number.isFinite(q) || q < 1) {
    return { saved: NaN, sale: NaN, taxAmount: NaN, finalEach: NaN, finalTotal: NaN, quantity: NaN };
  }

  const sale = p * (1 - d / 100);
  const savedEach = p - sale;
  const taxRate = tax > 0 ? tax : 0;
  const taxEach = sale * (taxRate / 100);
  const finalEach = sale + taxEach;

  return {
    saved: savedEach * q,
    sale: sale * q,
    taxAmount: taxEach * q,
    finalEach,
    finalTotal: finalEach * q,
    quantity: q
  };
}

// Reverse calc: what percent off turns `original` into `sale`?
// e.g. percentOffFromPrices(80, 60) === 25
export function percentOffFromPrices(original, sale) {
  const o = num(original), s = num(sale);
  if (!Number.isFinite(o) || !Number.isFinite(s) || o === 0) return NaN;
  return ((o - s) / o) * 100;
}
