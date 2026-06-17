// test-percent.js — unit tests for the pure percentage math (no DOM needed).
import assert from 'node:assert/strict';
import { percentOf, percentIsWhatOf, percentChange, roundTo } from '../src/engine/percent-math.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };

t('percentOf: basic cases', () => {
  assert.equal(percentOf(20, 50), 10);
  assert.equal(percentOf(0, 999), 0);
  assert.equal(percentOf(100, 42), 42);
  assert.equal(percentOf(150, 80), 120);
});

t('percentOf: handles negatives and fractions', () => {
  assert.equal(percentOf(50, -40), -20);
  assert.equal(percentOf(12.5, 200), 25);
});

t('percentOf: non-finite input returns NaN', () => {
  assert.ok(Number.isNaN(percentOf(NaN, 50)));
  assert.ok(Number.isNaN(percentOf(20, undefined)));
  assert.ok(Number.isNaN(percentOf('abc', 50)));
  assert.ok(Number.isNaN(percentOf(Infinity, 50)));
});

t('percentIsWhatOf: basic cases', () => {
  assert.equal(percentIsWhatOf(10, 50), 20);
  assert.equal(percentIsWhatOf(50, 200), 25);
  assert.equal(percentIsWhatOf(3, 4), 75);
});

t('percentIsWhatOf: zero whole returns NaN (no divide-by-zero)', () => {
  assert.ok(Number.isNaN(percentIsWhatOf(10, 0)));
});

t('percentIsWhatOf: negatives', () => {
  assert.equal(percentIsWhatOf(-25, 100), -25);
});

t('percentChange: increase and decrease', () => {
  assert.equal(percentChange(50, 75), 50);
  assert.equal(roundTo(percentChange(75, 50)), -33.33);
  assert.equal(percentChange(100, 100), 0);
  assert.equal(percentChange(10, 20), 100);
});

t('percentChange: negative starting value uses absolute base', () => {
  // from -50 to -25 is a +50% change relative to |−50|
  assert.equal(percentChange(-50, -25), 50);
});

t('percentChange: zero from returns NaN', () => {
  assert.ok(Number.isNaN(percentChange(0, 10)));
});

t('roundTo: avoids float drift, default 2 decimals', () => {
  assert.equal(roundTo(1.005), 1.01);
  assert.equal(roundTo(0.1 + 0.2), 0.3);
  assert.equal(roundTo(33.33333), 33.33);
  assert.equal(roundTo(-2.675), -2.68);
});

t('roundTo: custom decimal places', () => {
  assert.equal(roundTo(3.14159, 4), 3.1416);
  assert.equal(roundTo(1234.5678, 0), 1235);
});

console.log(`\n${pass} passing`);
