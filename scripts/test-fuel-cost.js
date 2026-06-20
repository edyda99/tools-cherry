// test-fuel-cost.js — unit tests for the pure fuel-cost module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { fuelCost } from '../src/engine/fuel-cost.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('300 mi @ 30 mpg @ $3.50 -> 10 gal, $35.00', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5 });
  approx(r.gallons, 10);
  approx(r.totalCost, 35);
  approx(r.perPerson, 35);
});

t('cost per mile is total / miles', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5 });
  approx(r.costPerMile, 35 / 300);
});

t('round-trip doubles gallons and total cost', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, roundTrip: true });
  approx(r.gallons, 20);
  approx(r.totalCost, 70);
  approx(r.costPerMile, 35 / 300); // per-mile is unchanged by round-trip
});

t('split by 2 halves per-person cost', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, people: 2 });
  approx(r.totalCost, 35);
  approx(r.perPerson, 17.5);
});

t('accepts string inputs', () => {
  const r = fuelCost({ distance: '300', mpg: '30', pricePerGallon: '3.5' });
  approx(r.gallons, 10);
  approx(r.totalCost, 35);
});

t('people < 1 falls back to 1 (no divide-by-zero)', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, people: 0 });
  approx(r.perPerson, 35);
});

t('people is floored to a whole number', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, people: 2.9 });
  approx(r.perPerson, 17.5);
});

t('mpg of zero yields NaN gallons, not Infinity', () => {
  const r = fuelCost({ distance: 300, mpg: 0, pricePerGallon: 3.5 });
  assert.ok(Number.isNaN(r.gallons));
  assert.ok(Number.isNaN(r.totalCost));
});

t('bad input yields NaN, not a wrong number', () => {
  const r = fuelCost({ distance: 'abc', mpg: 30, pricePerGallon: 3.5 });
  assert.ok(Number.isNaN(r.gallons));
});

console.log(`\n${pass} passing`);
