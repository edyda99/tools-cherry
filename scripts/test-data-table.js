// test-data-table.js — unit tests for the pure helpers behind the /data/
// reference-table filter + sort UI. Run via `npm test`.
import assert from 'node:assert/strict';
import { rowMatchesQuery, compareValues } from '../src/assets/data-table.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('rowMatchesQuery: blank query matches everything', () => {
  assert.equal(rowMatchesQuery('Bartenders 101', ''), true);
  assert.equal(rowMatchesQuery('anything', '   '), true);
  assert.equal(rowMatchesQuery('anything', null), true);
});

t('rowMatchesQuery: case-insensitive substring', () => {
  assert.equal(rowMatchesQuery('101 Bartenders mixologist', 'bar'), true);
  assert.equal(rowMatchesQuery('101 Bartenders mixologist', 'BARTENDER'), true);
  assert.equal(rowMatchesQuery('101 Bartenders mixologist', 'plumber'), false);
});

t('rowMatchesQuery: all terms must match (AND)', () => {
  assert.equal(rowMatchesQuery('New York flat 11.7%', 'york flat'), true);
  assert.equal(rowMatchesQuery('New York flat 11.7%', 'york regular'), false);
});

t('compareValues: text ascending / descending', () => {
  assert.ok(compareValues('Alabama', 'Wyoming', 'text', 1) < 0);
  assert.ok(compareValues('Alabama', 'Wyoming', 'text', -1) > 0);
  assert.equal(compareValues('Ohio', 'Ohio', 'text', 1), 0);
});

t('compareValues: numeric strips $, %, commas', () => {
  assert.ok(compareValues('$40,000', '$100,000', 'num', 1) < 0);
  assert.ok(compareValues('10.23%', '6.6%', 'num', 1) > 0);
  assert.ok(compareValues('$200,000', '$50,000', 'num', -1) < 0);
});

t('compareValues: non-numeric cells sort below numbers in num mode', () => {
  // "n/a" has no number -> treated as -Infinity, sorts first ascending
  assert.ok(compareValues('n/a', '5%', 'num', 1) < 0);
});

t('compareValues: dir normalises any sign', () => {
  assert.ok(compareValues('101', '110', 'num', 5) < 0);   // any positive => asc
  assert.ok(compareValues('101', '110', 'num', -3) > 0);  // any negative => desc
});

console.log(`\n${pass} passing`);
