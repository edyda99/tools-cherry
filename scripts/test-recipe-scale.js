// test-recipe-scale.js — unit tests for the pure recipe-scaling module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  parseQuantity,
  formatQuantity,
  scaleLine,
  scaleRecipe,
  scaleFactor
} from '../src/engine/recipe-scale.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

t('parseQuantity reads integers and decimals', () => {
  assert.deepEqual(parseQuantity('2 cups flour'), { value: 2, rest: 'cups flour' });
  assert.deepEqual(parseQuantity('0.5 tsp salt'), { value: 0.5, rest: 'tsp salt' });
  assert.deepEqual(parseQuantity('.25 cup oil'), { value: 0.25, rest: 'cup oil' });
});

t('parseQuantity reads simple and mixed fractions', () => {
  close(parseQuantity('3/4 cup sugar').value, 0.75);
  assert.equal(parseQuantity('3/4 cup sugar').rest, 'cup sugar');
  close(parseQuantity('1 1/2 cups milk').value, 1.5);
  assert.equal(parseQuantity('1 1/2 cups milk').rest, 'cups milk');
});

t('parseQuantity reads vulgar fractions, with or without a whole', () => {
  close(parseQuantity('½ tsp vanilla').value, 0.5);
  assert.equal(parseQuantity('½ tsp vanilla').rest, 'tsp vanilla');
  close(parseQuantity('1½ cups water').value, 1.5);
  close(parseQuantity('2 ⅓ cups oats').value, 2 + 1 / 3);
});

t('parseQuantity returns null when there is no leading number', () => {
  assert.equal(parseQuantity('a pinch of salt'), null);
  assert.equal(parseQuantity('salt to taste'), null);
});

t('formatQuantity renders friendly fractions', () => {
  assert.equal(formatQuantity(2), '2');
  assert.equal(formatQuantity(0.5), '1/2');
  assert.equal(formatQuantity(0.75), '3/4');
  assert.equal(formatQuantity(1.5), '1 1/2');
  assert.equal(formatQuantity(1 / 3), '1/3');
  assert.equal(formatQuantity(2 / 3), '2/3');
  assert.equal(formatQuantity(0.125), '1/8');
});

t('formatQuantity snaps near-whole values up', () => {
  assert.equal(formatQuantity(0), '0');
  assert.equal(formatQuantity(0.99), '1');
});

t('scaleLine doubles a quantity', () => {
  assert.equal(scaleLine('1 1/2 cups flour', 2), '3 cups flour');
  assert.equal(scaleLine('3/4 cup sugar', 2), '1 1/2 cup sugar');
});

t('scaleLine halves a quantity', () => {
  assert.equal(scaleLine('2 cups flour', 0.5), '1 cups flour');
  assert.equal(scaleLine('1/2 tsp salt', 0.5), '1/4 tsp salt');
});

t('scaleLine leaves lines without a quantity untouched', () => {
  assert.equal(scaleLine('a pinch of salt', 2), 'a pinch of salt');
  assert.equal(scaleLine('salt to taste', 3), 'salt to taste');
});

t('scaleLine returns the line unchanged for a bad factor', () => {
  assert.equal(scaleLine('2 cups flour', 0), '2 cups flour');
  assert.equal(scaleLine('2 cups flour', NaN), '2 cups flour');
});

t('scaleRecipe scales a multi-line block and preserves blanks', () => {
  const input = '2 cups flour\n1 tsp baking soda\n\na pinch of salt';
  const out = scaleRecipe(input, 1.5);
  assert.equal(out, '3 cups flour\n1 1/2 tsp baking soda\n\na pinch of salt');
});

t('scaleFactor computes target ÷ original', () => {
  close(scaleFactor(4, 8), 2);
  close(scaleFactor(8, 4), 0.5);
  close(scaleFactor(2, 3), 1.5);
});

t('scaleFactor returns NaN for invalid servings', () => {
  assert.ok(Number.isNaN(scaleFactor(0, 4)));
  assert.ok(Number.isNaN(scaleFactor(4, 0)));
  assert.ok(Number.isNaN(scaleFactor(-1, 4)));
  assert.ok(Number.isNaN(scaleFactor('x', 4)));
});

console.log(`\n${pass} passing`);
