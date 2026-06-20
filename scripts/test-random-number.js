// test-random-number.js — unit tests for the pure random-number module. Run via `npm test`.
import assert from 'node:assert/strict';
import {
  normalizeRange,
  rangeSize,
  randomInt,
  randomInts
} from '../src/engine/random-number.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

// A tiny deterministic RNG (mulberry32) so tests are reproducible.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

t('normalizeRange: orders bounds', () => {
  assert.deepEqual(normalizeRange(10, 1), { min: 1, max: 10, ok: true });
  assert.deepEqual(normalizeRange(1, 10), { min: 1, max: 10, ok: true });
});
t('normalizeRange: truncates to integers', () => {
  assert.deepEqual(normalizeRange(1.9, 5.9), { min: 1, max: 5, ok: true });
});
t('normalizeRange: accepts string input', () => {
  assert.deepEqual(normalizeRange('3', '7'), { min: 3, max: 7, ok: true });
});
t('normalizeRange: bad input not ok', () => {
  assert.equal(normalizeRange('abc', 5).ok, false);
  assert.equal(normalizeRange(1, Infinity).ok, false);
});

t('rangeSize: inclusive count', () => {
  assert.equal(rangeSize(1, 6), 6);
  assert.equal(rangeSize(5, 5), 1);
  assert.equal(rangeSize(-3, 3), 7);
});
t('rangeSize: invalid is 0', () => assert.equal(rangeSize('x', 3), 0));

t('randomInt: stays within range over many draws', () => {
  const rnd = seeded(42);
  for (let i = 0; i < 5000; i++) {
    const v = randomInt(1, 6, rnd);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 6, `out of range: ${v}`);
  }
});
t('randomInt: single-value range returns that value', () =>
  assert.equal(randomInt(4, 4, seeded(1)), 4));
t('randomInt: covers both endpoints', () => {
  const rnd = seeded(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(randomInt(0, 1, rnd));
  assert.ok(seen.has(0) && seen.has(1));
});
t('randomInt: invalid range is NaN', () =>
  assert.ok(Number.isNaN(randomInt('a', 5))));

t('randomInts: returns requested count (repeats allowed)', () => {
  const out = randomInts(1, 3, 10, { randomFn: seeded(3) });
  assert.equal(out.length, 10);
  out.forEach((v) => assert.ok(v >= 1 && v <= 3));
});
t('randomInts: unique draws are distinct', () => {
  const out = randomInts(1, 50, 10, { unique: true, randomFn: seeded(9) });
  assert.equal(out.length, 10);
  assert.equal(new Set(out).size, 10);
  out.forEach((v) => assert.ok(v >= 1 && v <= 50));
});
t('randomInts: unique count clamped to range size', () => {
  const out = randomInts(1, 5, 100, { unique: true, randomFn: seeded(11) });
  assert.equal(out.length, 5);
  assert.deepEqual([...out].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});
t('randomInts: zero/negative count is empty', () => {
  assert.deepEqual(randomInts(1, 9, 0, { randomFn: seeded(1) }), []);
  assert.deepEqual(randomInts(1, 9, -2, { randomFn: seeded(1) }), []);
});
t('randomInts: invalid range is empty', () =>
  assert.deepEqual(randomInts('a', 9, 3, { randomFn: seeded(1) }), []));

console.log(`\n${pass} passing`);
