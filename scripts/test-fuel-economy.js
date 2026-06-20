// test-fuel-economy.js — unit tests for the pure fuel-economy module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { fuelEconomy, convertEconomy } from '../src/engine/fuel-economy.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-2) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// 300 miles on 10 US gallons = 30 mpg.
t('fuelEconomy: 300 mi / 10 US gal = 30 mpg', () => {
  const r = fuelEconomy({ distance: 300, fuel: 10, distUnit: 'mi', fuelUnit: 'us' });
  approx(r.mpgUs, 30);
  approx(r.l100km, 7.84, 0.02);    // 30 mpg(US) ≈ 7.84 L/100km
  approx(r.kmPerL, 12.75, 0.02);
  approx(r.mpgUk, 36.03, 0.05);    // US gal smaller than UK gal -> higher UK mpg
});

t('fuelEconomy: accepts string input', () => {
  const r = fuelEconomy({ distance: '300', fuel: '10' });
  approx(r.mpgUs, 30);
});

// 500 km on 40 L = 12.5 km/L = 8 L/100km.
t('fuelEconomy: 500 km / 40 L = 8 L/100km', () => {
  const r = fuelEconomy({ distance: 500, fuel: 40, distUnit: 'km', fuelUnit: 'l' });
  approx(r.l100km, 8, 0.001);
  approx(r.kmPerL, 12.5, 0.001);
});

// UK gallons: 300 mi on 10 UK gal = 30 mpg(UK), which is fewer US mpg.
t('fuelEconomy: UK gallons give lower US mpg', () => {
  const r = fuelEconomy({ distance: 300, fuel: 10, distUnit: 'mi', fuelUnit: 'uk' });
  approx(r.mpgUk, 30);
  approx(r.mpgUs, 24.98, 0.05);
});

t('fuelEconomy: bad input yields NaN, not a wrong number', () => {
  assert.ok(Number.isNaN(fuelEconomy({ distance: 'abc', fuel: 10 }).mpgUs));
  assert.ok(Number.isNaN(fuelEconomy({ distance: 300, fuel: 0 }).mpgUs));
  assert.ok(Number.isNaN(fuelEconomy({ distance: -5, fuel: 10 }).l100km));
});

// convertEconomy round-trips.
t('convertEconomy: 30 mpg(US) -> ≈7.84 L/100km', () => {
  const r = convertEconomy(30, 'mpgUs');
  approx(r.l100km, 7.84, 0.02);
  approx(r.mpgUs, 30, 0.001);
});

t('convertEconomy: 8 L/100km -> ≈29.4 mpg(US)', () => {
  const r = convertEconomy(8, 'l100km');
  approx(r.mpgUs, 29.4, 0.1);
  approx(r.l100km, 8, 0.001);
});

t('convertEconomy: round-trips mpgUs -> l100km -> mpgUs', () => {
  const a = convertEconomy(42, 'mpgUs');
  const b = convertEconomy(a.l100km, 'l100km');
  approx(b.mpgUs, 42, 0.001);
});

t('convertEconomy: bad input yields NaN', () => {
  assert.ok(Number.isNaN(convertEconomy('x', 'mpgUs').l100km));
  assert.ok(Number.isNaN(convertEconomy(0, 'l100km').mpgUs));
});

console.log(`\n${pass} passing`);
