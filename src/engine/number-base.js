// number-base.js — pure, dependency-free number-base conversion.
// Shared by the browser tool (base-converter.js) and the unit tests.
//
// parseInBase(str, base) -> BigInt value of a non-negative integer written in
//                           `base` (2, 8, 10 or 16). Case-insensitive, allows
//                           surrounding whitespace and a leading 0x/0b/0o prefix
//                           that matches the base. Throws Error on bad input.
// formatInBase(value, base) -> uppercase string for a BigInt/number in `base`.
//                              Throws Error for negatives or non-integers.
// convertBase(str, fromBase, toBase) -> convenience: parse then format.
//
// Uses BigInt internally so arbitrarily large integers convert exactly, with no
// floating-point rounding. Supports only non-negative integers (the common case
// for binary/hex/decimal/octal study and programming look-ups).

export const BASES = [2, 8, 10, 16];

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Per-base prefixes that are tolerated (and stripped) when parsing, e.g. "0xFF".
const PREFIX = { 2: '0B', 8: '0O', 10: '', 16: '0X' };

function assertBase(base) {
  if (!BASES.includes(base)) {
    throw new Error('Base must be 2, 8, 10 or 16.');
  }
}

export function parseInBase(str, base) {
  assertBase(base);
  if (typeof str !== 'string') throw new Error('Enter a number.');
  let s = str.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) throw new Error('Enter a number.');

  // Strip a leading base prefix only when it matches the chosen base.
  const pre = PREFIX[base];
  if (pre && s.startsWith(pre)) s = s.slice(pre.length);
  if (!s) throw new Error('Enter a number.');

  const valid = DIGITS.slice(0, base);
  const bigBase = BigInt(base);
  let value = 0n;
  for (const ch of s) {
    const d = valid.indexOf(ch);
    if (d === -1) {
      throw new Error(`"${ch}" is not a valid digit in base ${base}.`);
    }
    value = value * bigBase + BigInt(d);
  }
  return value;
}

export function formatInBase(value, base) {
  assertBase(base);
  let v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) throw new Error('Only non-negative integers are supported.');
  if (v === 0n) return '0';

  const bigBase = BigInt(base);
  let out = '';
  while (v > 0n) {
    out = DIGITS[Number(v % bigBase)] + out;
    v = v / bigBase;
  }
  return out;
}

export function convertBase(str, fromBase, toBase) {
  return formatInBase(parseInBase(str, fromBase), toBase);
}
