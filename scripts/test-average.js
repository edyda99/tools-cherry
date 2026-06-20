// test-average.js — unit tests for the pure average/statistics module. Run via `npm test`.
import assert from 'node:assert/strict';
import {
  parseNumbers, mean, sum, median, mode, range, variance, stdDev, summarize
} from '../src/engine/average.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('parseNumbers: splits on commas, spaces, and newlines', () => {
  const { numbers, invalid } = parseNumbers('1, 2 3\n4');
  assert.deepEqual(numbers, [1, 2, 3, 4]);
  assert.deepEqual(invalid, []);
});
t('parseNumbers: keeps negatives, decimals, exponents', () => {
  const { numbers } = parseNumbers('-3 4.5 1e3 +2');
  assert.deepEqual(numbers, [-3, 4.5, 1000, 2]);
});
t('parseNumbers: collects invalid tokens, drops blanks', () => {
  const { numbers, invalid } = parseNumbers('1,,abc, 2 , 1.2.3');
  assert.deepEqual(numbers, [1, 2]);
  assert.deepEqual(invalid, ['abc', '1.2.3']);
});
t('parseNumbers: empty string yields empty arrays', () => {
  const { numbers, invalid } = parseNumbers('   ');
  assert.deepEqual(numbers, []);
  assert.deepEqual(invalid, []);
});

t('sum: adds values', () => assert.equal(sum([1, 2, 3, 4]), 10));
t('mean: arithmetic average', () => approx(mean([1, 2, 3, 4]), 2.5));
t('mean: empty -> null', () => assert.equal(mean([]), null));

t('median: odd count is the middle value', () => assert.equal(median([3, 1, 2]), 2));
t('median: even count averages the two middle values', () => assert.equal(median([1, 2, 3, 4]), 2.5));
t('median: empty -> null', () => assert.equal(median([]), null));

t('mode: single most-frequent value', () => assert.deepEqual(mode([1, 2, 2, 3]), [2]));
t('mode: multi-modal returns all, sorted', () => assert.deepEqual(mode([4, 4, 1, 1, 2]), [1, 4]));
t('mode: all-unique -> no mode (empty)', () => assert.deepEqual(mode([1, 2, 3]), []));
t('mode: empty -> empty', () => assert.deepEqual(mode([]), []));

t('range: max minus min', () => assert.equal(range([5, 1, 9, 3]), 8));
t('range: empty -> null', () => assert.equal(range([]), null));

t('variance/stdDev: population', () => {
  // data [2,4,4,4,5,5,7,9]: mean 5, population variance 4, stddev 2
  const d = [2, 4, 4, 4, 5, 5, 7, 9];
  approx(variance(d, true), 4);
  approx(stdDev(d, true), 2);
});
t('variance/stdDev: sample divides by N-1', () => {
  const d = [2, 4, 4, 4, 5, 5, 7, 9]; // ss = 32; sample var = 32/7
  approx(variance(d, false), 32 / 7);
  approx(stdDev(d, false), Math.sqrt(32 / 7));
});
t('sample variance of single value -> null', () => {
  assert.equal(variance([5], false), null);
  assert.equal(stdDev([5], false), null);
});

t('summarize: full result for a normal set', () => {
  const r = summarize('1, 2, 2, 3, 4');
  assert.equal(r.count, 5);
  assert.equal(r.sum, 12);
  approx(r.mean, 2.4);
  assert.equal(r.median, 2);
  assert.deepEqual(r.mode, [2]);
  assert.equal(r.min, 1);
  assert.equal(r.max, 4);
  assert.equal(r.range, 3);
  assert.deepEqual(r.invalid, []);
});
t('summarize: empty input -> nulls, not NaN', () => {
  const r = summarize('');
  assert.equal(r.count, 0);
  assert.equal(r.mean, null);
  assert.equal(r.median, null);
  assert.deepEqual(r.mode, []);
  assert.equal(r.range, null);
  assert.equal(r.stdDevSample, null);
});
t('summarize: surfaces invalid tokens', () => {
  const r = summarize('10 20 oops 30');
  assert.equal(r.count, 3);
  assert.equal(r.mean, 20);
  assert.deepEqual(r.invalid, ['oops']);
});

console.log(`\n${pass} passing`);
