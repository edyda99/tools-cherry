// test-roman.js — unit tests for the pure Roman numeral module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { toRoman, fromRoman, ROMAN_MIN, ROMAN_MAX } from '../src/engine/roman.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('toRoman basic values', () => {
  assert.equal(toRoman(1), 'I');
  assert.equal(toRoman(4), 'IV');
  assert.equal(toRoman(9), 'IX');
  assert.equal(toRoman(14), 'XIV');
  assert.equal(toRoman(40), 'XL');
  assert.equal(toRoman(90), 'XC');
  assert.equal(toRoman(400), 'CD');
  assert.equal(toRoman(900), 'CM');
});

t('toRoman compound and boundary values', () => {
  assert.equal(toRoman(2024), 'MMXXIV');
  assert.equal(toRoman(1994), 'MCMXCIV');
  assert.equal(toRoman(3888), 'MMMDCCCLXXXVIII');
  assert.equal(toRoman(ROMAN_MIN), 'I');
  assert.equal(toRoman(ROMAN_MAX), 'MMMCMXCIX');
});

t('toRoman rejects out-of-range and non-integers', () => {
  assert.throws(() => toRoman(0), RangeError);
  assert.throws(() => toRoman(4000), RangeError);
  assert.throws(() => toRoman(-5), RangeError);
  assert.throws(() => toRoman(3.5), RangeError);
  assert.throws(() => toRoman('10'), RangeError);
});

t('fromRoman basic values, case-insensitive', () => {
  assert.equal(fromRoman('I'), 1);
  assert.equal(fromRoman('iv'), 4);
  assert.equal(fromRoman('MCMXCIV'), 1994);
  assert.equal(fromRoman('  mmxxiv  '), 2024);
  assert.equal(fromRoman('MMMCMXCIX'), 3999);
});

t('fromRoman rejects invalid input', () => {
  assert.throws(() => fromRoman(''));
  assert.throws(() => fromRoman('ABC'));
  assert.throws(() => fromRoman('IIII')); // non-canonical
  assert.throws(() => fromRoman('VV'));   // non-canonical
  assert.throws(() => fromRoman('IC'));   // illegal subtraction
  assert.throws(() => fromRoman('MMMM')); // > 3999
  assert.throws(() => fromRoman(42));     // not a string
});

t('round-trips for the full range', () => {
  for (let n = ROMAN_MIN; n <= ROMAN_MAX; n++) {
    assert.equal(fromRoman(toRoman(n)), n);
  }
});

console.log(`\n${pass} passing`);
