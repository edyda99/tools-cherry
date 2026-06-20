// fraction.js — pure, dependency-free fraction arithmetic.
// Shared by the browser tool (fraction-calculator.js) and the unit tests.
//
// Adds, subtracts, multiplies, or divides two fractions, each of which may
// include a whole-number part (a mixed number like 1 1/2). Every result is
// returned in lowest terms together with its mixed-number and decimal forms,
// so the UI can show all three without re-deriving them.
//
// Everything is integer math on numerators/denominators — no floating-point
// drift in the core result. The decimal form is the only floating value, and
// it is derived last, purely for display.

const toInt = (n) => {
  const v = typeof n === 'number' ? n : parseInt(n, 10);
  return Number.isFinite(v) ? Math.trunc(v) : 0;
};

// Greatest common divisor (Euclid), always non-negative.
export function gcd(a, b) {
  a = Math.abs(toInt(a));
  b = Math.abs(toInt(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

// Reduce a fraction to lowest terms, normalising the sign onto the numerator
// (denominator is always positive). 0/n becomes 0/1.
export function simplify(numer, denom) {
  let n = toInt(numer);
  let d = toInt(denom);
  if (d === 0) return null; // undefined — caller handles
  if (d < 0) {
    n = -n;
    d = -d;
  }
  if (n === 0) return { numer: 0, denom: 1 };
  const g = gcd(n, d) || 1;
  return { numer: n / g, denom: d / g };
}

// Turn an optional whole part + fraction into a single improper fraction.
// whole, numer, denom are plain integers (numer/denom default to 0/1).
// The whole part's sign is applied to the whole quantity, matching how people
// read "-2 1/3" as -(2 + 1/3).
export function toImproper({ whole = 0, numer = 0, denom = 1 } = {}) {
  const w = toInt(whole);
  const n = toInt(numer);
  let d = toInt(denom);
  if (d === 0) return null;
  const sign = d < 0 ? -1 : 1;
  d = Math.abs(d);
  const mag = Math.abs(w) * d + n; // n is assumed non-negative magnitude
  const wholeSign = w < 0 ? -1 : 1;
  return { numer: wholeSign * sign * mag, denom: d };
}

// Split an improper fraction into a mixed number { sign, whole, numer, denom }.
// whole/numer are non-negative; sign is -1 or 1. A whole value yields numer 0.
export function toMixed(numer, denom) {
  const s = simplify(numer, denom);
  if (!s) return null;
  const sign = s.numer < 0 ? -1 : 1;
  const n = Math.abs(s.numer);
  const d = s.denom;
  return { sign, whole: Math.trunc(n / d), numer: n % d, denom: d };
}

const OPS = {
  '+': (a, b) => ({ numer: a.numer * b.denom + b.numer * a.denom, denom: a.denom * b.denom }),
  '-': (a, b) => ({ numer: a.numer * b.denom - b.numer * a.denom, denom: a.denom * b.denom }),
  '*': (a, b) => ({ numer: a.numer * b.numer, denom: a.denom * b.denom }),
  '/': (a, b) => ({ numer: a.numer * b.denom, denom: a.denom * b.numer })
};
export const OPERATORS = ['+', '-', '*', '/'];

// Core calculation.
//   input: { a, op, b }
//     a, b: { whole, numer, denom } operands (mixed numbers allowed)
//     op:   one of '+', '-', '*', '/'
// Returns:
//   { numer, denom,                  // result in lowest terms
//     mixed: { sign, whole, numer, denom },
//     decimal,                       // Number, for display
//     improper: { numer, denom } }   // un-reduced improper form
//   or { error } when the operation is undefined (e.g. ÷0, or a 0 denominator).
export function calcFraction({ a, op, b } = {}) {
  if (!OPERATORS.includes(op)) return { error: 'Choose an operation.' };
  const fa = toImproper(a);
  const fb = toImproper(b);
  if (!fa || !fb) return { error: 'Denominators cannot be zero.' };

  if (op === '/' && fb.numer === 0) {
    return { error: 'Cannot divide by zero.' };
  }

  const raw = OPS[op](fa, fb);
  const reduced = simplify(raw.numer, raw.denom);
  if (!reduced) return { error: 'Result is undefined.' };

  const mixed = toMixed(reduced.numer, reduced.denom);
  const decimal = reduced.numer / reduced.denom;

  return {
    numer: reduced.numer,
    denom: reduced.denom,
    mixed,
    decimal,
    improper: { numer: raw.numer, denom: raw.denom }
  };
}
