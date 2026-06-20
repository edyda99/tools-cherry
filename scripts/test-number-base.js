// test-number-base.js — unit tests for the pure number-base module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { parseInBase, formatInBase, convertBase, BASES } from '../src/engine/number-base.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('parseInBase reads each base', () => {
  assert.equal(parseInBase('1010', 2), 10n);
  assert.equal(parseInBase('17', 8), 15n);
  assert.equal(parseInBase('255', 10), 255n);
  assert.equal(parseInBase('FF', 16), 255n);
  assert.equal(parseInBase('0', 2), 0n);
});

t('parseInBase is case-insensitive and trims/ignores whitespace', () => {
  assert.equal(parseInBase('  ff  ', 16), 255n);
  assert.equal(parseInBase('dead beef', 16), 0xDEADBEEFn);
  assert.equal(parseInBase('1010 1010', 2), 170n);
});

t('parseInBase strips a matching prefix only', () => {
  assert.equal(parseInBase('0xFF', 16), 255n);
  assert.equal(parseInBase('0b1010', 2), 10n);
  assert.equal(parseInBase('0o17', 8), 15n);
  // A 0x prefix is not valid in binary -> the x is an illegal digit.
  assert.throws(() => parseInBase('0x10', 2));
});

t('parseInBase rejects bad digits and empty input', () => {
  assert.throws(() => parseInBase('2', 2));   // 2 not a binary digit
  assert.throws(() => parseInBase('8', 8));   // 8 not an octal digit
  assert.throws(() => parseInBase('G', 16));  // G not a hex digit
  assert.throws(() => parseInBase('', 10));
  assert.throws(() => parseInBase('   ', 10));
  assert.throws(() => parseInBase(42, 10));   // not a string
});

t('formatInBase writes each base in uppercase', () => {
  assert.equal(formatInBase(10n, 2), '1010');
  assert.equal(formatInBase(15n, 8), '17');
  assert.equal(formatInBase(255n, 10), '255');
  assert.equal(formatInBase(255n, 16), 'FF');
  assert.equal(formatInBase(0n, 16), '0');
  assert.equal(formatInBase(255, 16), 'FF'); // accepts a plain number too
});

t('formatInBase rejects negatives', () => {
  assert.throws(() => formatInBase(-1n, 10));
});

t('invalid base is rejected on both sides', () => {
  assert.throws(() => parseInBase('1', 3));
  assert.throws(() => formatInBase(1n, 5));
});

t('convertBase end-to-end and large values', () => {
  assert.equal(convertBase('FF', 16, 2), '11111111');
  assert.equal(convertBase('1010', 2, 16), 'A');
  assert.equal(convertBase('255', 10, 8), '377');
  // Far beyond Number.MAX_SAFE_INTEGER — BigInt keeps it exact.
  assert.equal(convertBase('FFFFFFFFFFFFFFFF', 16, 10), '18446744073709551615');
});

t('round-trips across every base pair', () => {
  for (let n = 0; n <= 512; n++) {
    for (const from of BASES) {
      for (const to of BASES) {
        const s = formatInBase(BigInt(n), from);
        assert.equal(convertBase(s, from, to), formatInBase(BigInt(n), to));
      }
    }
  }
});

console.log(`\n${pass} passing`);
