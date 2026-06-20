// test-cooking-units.js — unit tests for the pure cooking-units module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  convert,
  fahrenheitToCelsius,
  celsiusToFahrenheit,
  gasMarkForCelsius,
  scaleAmount,
  servingsMultiplier,
  volumeToGramsApprox
} from '../src/engine/cooking-units.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

// --- Volume (exact) --------------------------------------------------------
t('1 cup = 236.588 ml', () => approx(convert(1, 'cup', 'millilitre', 'volume'), 236.588));
t('1 tablespoon = 3 teaspoons', () => approx(convert(1, 'tablespoon', 'teaspoon', 'volume'), 3));
t('2 cups = 1 pint', () => approx(convert(2, 'cup', 'pint', 'volume'), 1));
t('1 gallon = 4 quarts', () => approx(convert(1, 'gallon', 'quart', 'volume'), 4));
t('1 fluid ounce = 2 tablespoons', () => approx(convert(1, 'fluid-ounce', 'tablespoon', 'volume'), 2));
t('1000 ml = 1 litre', () => approx(convert(1000, 'millilitre', 'litre', 'volume'), 1));
t('volume accepts string input', () => approx(convert('1', 'cup', 'millilitre', 'volume'), 236.588));

// --- Weight (exact) --------------------------------------------------------
t('1 lb = 453.592 g', () => approx(convert(1, 'pound', 'gram', 'weight'), 453.592));
t('1 ounce = 28.3495 g', () => approx(convert(1, 'ounce', 'gram', 'weight'), 28.3495));
t('1 kilogram = 1000 g', () => approx(convert(1, 'kilogram', 'gram', 'weight'), 1000));
t('16 ounces = 1 pound', () => approx(convert(16, 'ounce', 'pound', 'weight'), 1));

// --- Cross-category and bad input are NaN ----------------------------------
t('unknown unit is NaN', () => assert.ok(Number.isNaN(convert(1, 'cup', 'gram', 'volume'))));
t('bad amount is NaN', () => assert.ok(Number.isNaN(convert('abc', 'cup', 'millilitre', 'volume'))));
t('unknown category is NaN', () => assert.ok(Number.isNaN(convert(1, 'cup', 'cup', 'length'))));

// --- Oven temperature ------------------------------------------------------
t('350F = 176.67C', () => approx(fahrenheitToCelsius(350), 176.6667, 1e-3));
t('176.6667C = 350F', () => approx(celsiusToFahrenheit(176.6667), 350, 1e-3));
t('0C = 32F', () => approx(celsiusToFahrenheit(0), 32));
t('100C = 212F', () => approx(celsiusToFahrenheit(100), 212));
t('gas mark for 180C is 4', () => assert.equal(gasMarkForCelsius(180), '4'));
t('gas mark far out of range is blank', () => assert.equal(gasMarkForCelsius(500), ''));

// --- Recipe scaler ---------------------------------------------------------
t('scaleAmount: 2 cups x 0.5 = 1', () => approx(scaleAmount(2, 0.5), 1));
t('scaleAmount: 1.5 x 3 = 4.5', () => approx(scaleAmount(1.5, 3), 4.5));
t('servingsMultiplier: 4 -> 6 is 1.5x', () => approx(servingsMultiplier(4, 6), 1.5));
t('servingsMultiplier: from zero is NaN', () =>
  assert.ok(Number.isNaN(servingsMultiplier(0, 6))));
t('scaleAmount bad input is NaN', () => assert.ok(Number.isNaN(scaleAmount('x', 2))));

// --- Approximate density helper --------------------------------------------
t('1 cup water ~ 236.6 g', () => approx(volumeToGramsApprox(1, 'cup', 'water'), 236.6, 0.1));
t('1 cup all-purpose flour ~ 120 g', () => approx(volumeToGramsApprox(1, 'cup', 'all-purpose flour'), 120, 0.1));
t('unknown ingredient is NaN', () =>
  assert.ok(Number.isNaN(volumeToGramsApprox(1, 'cup', 'unobtainium'))));

console.log(`\n${pass} passing`);
