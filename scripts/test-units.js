// test-units.js — unit tests for the pure units module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { convert, UNITS, LABELS } from '../src/engine/units.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- Length ----------------------------------------------------------------
t('1 mile = 1609.344 m', () => approx(convert('length', 'mile', 'm', 1), 1609.344));
t('1 m = 100 cm', () => approx(convert('length', 'm', 'cm', 1), 100));
t('1 inch = 2.54 cm', () => approx(convert('length', 'inch', 'cm', 1), 2.54));
t('1 foot = 12 inch', () => approx(convert('length', 'foot', 'inch', 1), 12));
t('1 yard = 3 foot', () => approx(convert('length', 'yard', 'foot', 1), 3));
t('1 km = 1000 m', () => approx(convert('length', 'km', 'm', 1), 1000));
t('length accepts string input', () => approx(convert('length', 'mile', 'm', '1'), 1609.344));

// --- Weight / mass ---------------------------------------------------------
t('1 kg = 2.20462 lb', () => approx(convert('weight', 'kg', 'pound', 1), 2.20462, 1e-4));
t('1 pound = 453.592 g', () => approx(convert('weight', 'pound', 'g', 1), 453.59237));
t('1 ounce = 28.3495 g', () => approx(convert('weight', 'ounce', 'g', 1), 28.3495));
t('1 stone = 14 pound', () => approx(convert('weight', 'stone', 'pound', 1), 14));
t('1 tonne = 1000 kg', () => approx(convert('weight', 'tonne', 'kg', 1), 1000));
t('1000 mg = 1 g', () => approx(convert('weight', 'mg', 'g', 1000), 1));

// --- Temperature -----------------------------------------------------------
t('100 C = 212 F', () => approx(convert('temperature', 'celsius', 'fahrenheit', 100), 212));
t('212 F = 100 C', () => approx(convert('temperature', 'fahrenheit', 'celsius', 212), 100));
t('0 C = 273.15 K', () => approx(convert('temperature', 'celsius', 'kelvin', 0), 273.15));
t('300 K = 26.85 C', () => approx(convert('temperature', 'kelvin', 'celsius', 300), 26.85));
t('32 F = 273.15 K', () => approx(convert('temperature', 'fahrenheit', 'kelvin', 32), 273.15));
t('same temp unit is identity', () => approx(convert('temperature', 'celsius', 'celsius', 37), 37));

// --- Speed -----------------------------------------------------------------
t('60 mph ~ 96.56 km/h', () => approx(convert('speed', 'mph', 'km/h', 60), 96.56, 0.01));
t('1 m/s = 3.6 km/h', () => approx(convert('speed', 'm/s', 'km/h', 1), 3.6));
t('1 knot ~ 1.852 km/h', () => approx(convert('speed', 'knot', 'km/h', 1), 1.852));

// --- Area ------------------------------------------------------------------
t('1 hectare = 10000 sq meter', () => approx(convert('area', 'hectare', 'sq meter', 1), 10000));
t('1 sq km = 1000000 sq meter', () => approx(convert('area', 'sq km', 'sq meter', 1), 1000000));
t('1 acre ~ 4046.86 sq meter', () => approx(convert('area', 'acre', 'sq meter', 1), 4046.8564, 1e-3));
t('1 sq mile = 640 acre', () => approx(convert('area', 'sq mile', 'acre', 1), 640, 1e-3));

// --- Digital storage (1024-based) ------------------------------------------
t('1 GB = 1024 MB', () => approx(convert('digital', 'GB', 'MB', 1), 1024));
t('1 MB = 1024 KB', () => approx(convert('digital', 'MB', 'KB', 1), 1024));
t('1 TB = 1024 GB', () => approx(convert('digital', 'TB', 'GB', 1), 1024));
t('1024 KB = 1 MB', () => approx(convert('digital', 'KB', 'MB', 1024), 1));

// --- Bad input / unknowns are NaN ------------------------------------------
t('unknown category is NaN', () => assert.ok(Number.isNaN(convert('mass', 'kg', 'g', 1))));
t('unknown unit is NaN', () => assert.ok(Number.isNaN(convert('length', 'parsec', 'm', 1))));
t('bad amount is NaN', () => assert.ok(Number.isNaN(convert('length', 'm', 'cm', 'abc'))));
t('cross-category unit is NaN', () => assert.ok(Number.isNaN(convert('length', 'm', 'kg', 1))));
t('unknown temp unit is NaN', () =>
  assert.ok(Number.isNaN(convert('temperature', 'celsius', 'rankine', 100))));

// --- Metadata sanity -------------------------------------------------------
t('every category has >= 2 units', () =>
  Object.values(UNITS).forEach((list) => assert.ok(list.length >= 2)));
t('every unit has a label', () =>
  Object.values(UNITS).flat().forEach((u) => assert.ok(typeof LABELS[u] === 'string')));

console.log(`\n${pass} passing`);
