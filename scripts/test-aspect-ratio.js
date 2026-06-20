// test-aspect-ratio.js — unit tests for the pure aspect-ratio module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { gcd, simplifyRatio, ratioString, solveDimension } from '../src/engine/aspect-ratio.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('gcd basics', () => {
  assert.equal(gcd(1920, 1080), 120);
  assert.equal(gcd(1080, 1920), 120);
  assert.equal(gcd(7, 13), 1);
  assert.equal(gcd(0, 5), 5);
});

t('simplifyRatio reduces common screen sizes', () => {
  assert.deepEqual(simplifyRatio(1920, 1080), { w: 16, h: 9 });
  assert.deepEqual(simplifyRatio(1280, 720), { w: 16, h: 9 });
  assert.deepEqual(simplifyRatio(1024, 768), { w: 4, h: 3 });
  assert.deepEqual(simplifyRatio(2560, 1080), { w: 64, h: 27 });
  assert.deepEqual(simplifyRatio(1080, 1080), { w: 1, h: 1 });
});

t('simplifyRatio handles decimals', () => {
  assert.deepEqual(simplifyRatio(1.5, 1), { w: 3, h: 2 });
  assert.deepEqual(simplifyRatio(2.35, 1), { w: 47, h: 20 });
});

t('simplifyRatio rejects bad input', () => {
  assert.throws(() => simplifyRatio(0, 9), RangeError);
  assert.throws(() => simplifyRatio(16, -1), RangeError);
  assert.throws(() => simplifyRatio('16', 9), RangeError);
  assert.throws(() => simplifyRatio(NaN, 9), RangeError);
});

t('ratioString formats simplified ratio', () => {
  assert.equal(ratioString(1920, 1080), '16:9');
  assert.equal(ratioString(800, 600), '4:3');
});

t('solveDimension finds missing height from width', () => {
  assert.deepEqual(solveDimension({ rw: 16, rh: 9, width: 1280 }), { width: 1280, height: 720 });
  assert.deepEqual(solveDimension({ rw: 4, rh: 3, width: 1024 }), { width: 1024, height: 768 });
});

t('solveDimension finds missing width from height', () => {
  assert.deepEqual(solveDimension({ rw: 16, rh: 9, height: 720 }), { width: 1280, height: 720 });
  assert.deepEqual(solveDimension({ rw: 21, rh: 9, height: 1080 }), { width: 2520, height: 1080 });
});

t('solveDimension rounds non-integer results', () => {
  const r = solveDimension({ rw: 16, rh: 9, width: 1000 });
  assert.equal(r.width, 1000);
  assert.equal(r.height, 562.5);
});

t('solveDimension rejects ambiguous / empty input', () => {
  assert.throws(() => solveDimension({ rw: 16, rh: 9, width: 100, height: 100 }));
  assert.throws(() => solveDimension({ rw: 16, rh: 9 }));
  assert.throws(() => solveDimension({ rw: 0, rh: 9, width: 100 }), RangeError);
});

console.log(`\n${pass} passing`);
