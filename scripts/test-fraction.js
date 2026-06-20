// test-fraction.js — unit tests for the pure fraction module. Run via `npm test`.
import assert from 'node:assert/strict';
import { gcd, simplify, toImproper, toMixed, calcFraction } from '../src/engine/fraction.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('gcd: basic and order-independent', () => {
  assert.equal(gcd(12, 8), 4);
  assert.equal(gcd(8, 12), 4);
  assert.equal(gcd(7, 13), 1);
  assert.equal(gcd(0, 5), 5);
  assert.equal(gcd(-12, 8), 4);
});

t('simplify: reduces to lowest terms', () => {
  assert.deepEqual(simplify(4, 8), { numer: 1, denom: 2 });
  assert.deepEqual(simplify(6, 3), { numer: 2, denom: 1 });
  assert.deepEqual(simplify(0, 5), { numer: 0, denom: 1 });
});

t('simplify: sign normalised onto numerator', () => {
  assert.deepEqual(simplify(1, -2), { numer: -1, denom: 2 });
  assert.deepEqual(simplify(-1, -2), { numer: 1, denom: 2 });
});

t('simplify: zero denominator -> null', () => {
  assert.equal(simplify(1, 0), null);
});

t('toImproper: mixed number to improper', () => {
  assert.deepEqual(toImproper({ whole: 1, numer: 1, denom: 2 }), { numer: 3, denom: 2 });
  assert.deepEqual(toImproper({ whole: 0, numer: 3, denom: 4 }), { numer: 3, denom: 4 });
  assert.deepEqual(toImproper({ whole: 2, numer: 0, denom: 1 }), { numer: 2, denom: 1 });
});

t('toImproper: negative whole applies to whole quantity', () => {
  // -2 1/3 = -(2 + 1/3) = -7/3
  assert.deepEqual(toImproper({ whole: -2, numer: 1, denom: 3 }), { numer: -7, denom: 3 });
});

t('toMixed: improper to mixed number', () => {
  assert.deepEqual(toMixed(7, 2), { sign: 1, whole: 3, numer: 1, denom: 2 });
  assert.deepEqual(toMixed(4, 2), { sign: 1, whole: 2, numer: 0, denom: 1 });
  assert.deepEqual(toMixed(-7, 3), { sign: -1, whole: 2, numer: 1, denom: 3 });
  assert.deepEqual(toMixed(1, 2), { sign: 1, whole: 0, numer: 1, denom: 2 });
});

t('calcFraction: addition 1/2 + 1/3 = 5/6', () => {
  const r = calcFraction({ a: { numer: 1, denom: 2 }, op: '+', b: { numer: 1, denom: 3 } });
  assert.equal(r.numer, 5);
  assert.equal(r.denom, 6);
  assert.ok(Math.abs(r.decimal - 0.8333333) < 1e-6);
});

t('calcFraction: subtraction reduces 3/4 - 1/4 = 1/2', () => {
  const r = calcFraction({ a: { numer: 3, denom: 4 }, op: '-', b: { numer: 1, denom: 4 } });
  assert.equal(r.numer, 1);
  assert.equal(r.denom, 2);
});

t('calcFraction: multiplication 2/3 * 3/4 = 1/2', () => {
  const r = calcFraction({ a: { numer: 2, denom: 3 }, op: '*', b: { numer: 3, denom: 4 } });
  assert.equal(r.numer, 1);
  assert.equal(r.denom, 2);
});

t('calcFraction: division 1/2 ÷ 1/4 = 2 (2/1)', () => {
  const r = calcFraction({ a: { numer: 1, denom: 2 }, op: '/', b: { numer: 1, denom: 4 } });
  assert.equal(r.numer, 2);
  assert.equal(r.denom, 1);
  assert.deepEqual(r.mixed, { sign: 1, whole: 2, numer: 0, denom: 1 });
});

t('calcFraction: mixed numbers 1 1/2 + 2 1/3 = 23/6', () => {
  const r = calcFraction({
    a: { whole: 1, numer: 1, denom: 2 },
    op: '+',
    b: { whole: 2, numer: 1, denom: 3 }
  });
  assert.equal(r.numer, 23);
  assert.equal(r.denom, 6);
  assert.deepEqual(r.mixed, { sign: 1, whole: 3, numer: 5, denom: 6 });
});

t('calcFraction: divide by zero -> error', () => {
  const r = calcFraction({ a: { numer: 1, denom: 2 }, op: '/', b: { numer: 0, denom: 5 } });
  assert.ok(r.error);
});

t('calcFraction: zero denominator -> error', () => {
  const r = calcFraction({ a: { numer: 1, denom: 0 }, op: '+', b: { numer: 1, denom: 2 } });
  assert.ok(r.error);
});

t('calcFraction: unknown operator -> error', () => {
  const r = calcFraction({ a: { numer: 1, denom: 2 }, op: '^', b: { numer: 1, denom: 2 } });
  assert.ok(r.error);
});

t('calcFraction: negative result keeps sign on numerator', () => {
  const r = calcFraction({ a: { numer: 1, denom: 4 }, op: '-', b: { numer: 1, denom: 2 } });
  assert.equal(r.numer, -1);
  assert.equal(r.denom, 4);
  assert.equal(r.mixed.sign, -1);
});

console.log(`\n${pass} passing`);
