// roman.js — pure, dependency-free Roman numeral conversion (both directions).
// Shared by the browser tool (roman-numeral-converter.js) and the unit tests.
//
// toRoman(n)   -> uppercase Roman numeral string for an integer 1..3999.
//                 Throws RangeError outside that range or for non-integers.
// fromRoman(s) -> the integer value of a valid Roman numeral (case-insensitive).
//                 Throws Error for malformed / non-standard numerals.
//
// Standard subtractive notation only (IV, IX, XL, XC, CD, CM); no overbar /
// vinculum, so the supported range is the classic 1..3999.

const NUMERALS = [
  ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
  ['C', 100], ['XC', 90], ['L', 50], ['XL', 40],
  ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]
];

export const ROMAN_MIN = 1;
export const ROMAN_MAX = 3999;

export function toRoman(n) {
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new RangeError('Enter a whole number.');
  }
  if (n < ROMAN_MIN || n > ROMAN_MAX) {
    throw new RangeError('Roman numerals cover 1 to 3999.');
  }
  let remaining = n;
  let out = '';
  for (const [sym, val] of NUMERALS) {
    while (remaining >= val) {
      out += sym;
      remaining -= val;
    }
  }
  return out;
}

export function fromRoman(s) {
  if (typeof s !== 'string') throw new Error('Enter a Roman numeral.');
  const str = s.trim().toUpperCase();
  if (!str) throw new Error('Enter a Roman numeral.');
  if (!/^[MDCLXVI]+$/.test(str)) {
    throw new Error('Use only the letters M, D, C, L, X, V and I.');
  }

  const value = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let total = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = value[str[i]];
    const next = value[str[i + 1]];
    if (next && cur < next) total -= cur;
    else total += cur;
  }

  // Validate by round-tripping: only well-formed, canonical numerals survive.
  // This rejects things like "IIII", "VV", "IC", "MMMM" (>3999), etc.
  if (total < ROMAN_MIN || total > ROMAN_MAX || toRoman(total) !== str) {
    throw new Error('That is not a valid Roman numeral.');
  }
  return total;
}
