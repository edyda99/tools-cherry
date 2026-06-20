// test-text-diff.js — unit tests for the pure text-diff module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { splitLines, diffLines, diffStats } from '../src/engine/text-diff.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const types = (rows) => rows.map((r) => r.type);
const lines = (rows) => rows.map((r) => r.line);

t('splitLines normalizes newline styles and drops one trailing newline', () => {
  assert.deepEqual(splitLines('a\nb\nc'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines('a\r\nb\rc'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines(null), []);
  // a blank line in the middle is preserved
  assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b']);
});

t('identical text yields all-equal rows', () => {
  const rows = diffLines('one\ntwo\nthree', 'one\ntwo\nthree');
  assert.deepEqual(types(rows), ['equal', 'equal', 'equal']);
  assert.deepEqual(lines(rows), ['one', 'two', 'three']);
});

t('a single changed line shows as remove then add', () => {
  const rows = diffLines('one\ntwo\nthree', 'one\nTWO\nthree');
  assert.deepEqual(types(rows), ['equal', 'remove', 'add', 'equal']);
  const removed = rows.find((r) => r.type === 'remove');
  const added = rows.find((r) => r.type === 'add');
  assert.equal(removed.line, 'two');
  assert.equal(added.line, 'TWO');
});

t('inserted lines are adds, deleted lines are removes', () => {
  const add = diffLines('a\nc', 'a\nb\nc');
  assert.deepEqual(types(add), ['equal', 'add', 'equal']);
  assert.equal(add.find((r) => r.type === 'add').line, 'b');

  const del = diffLines('a\nb\nc', 'a\nc');
  assert.deepEqual(types(del), ['equal', 'remove', 'equal']);
  assert.equal(del.find((r) => r.type === 'remove').line, 'b');
});

t('empty vs text is all adds; text vs empty is all removes', () => {
  assert.deepEqual(types(diffLines('', 'x\ny')), ['add', 'add']);
  assert.deepEqual(types(diffLines('x\ny', '')), ['remove', 'remove']);
});

t('ignoreCase treats case-only differences as equal', () => {
  const sensitive = diffLines('Hello', 'hello');
  assert.deepEqual(types(sensitive), ['remove', 'add']);
  const insensitive = diffLines('Hello', 'hello', { ignoreCase: true });
  assert.deepEqual(types(insensitive), ['equal']);
  // the displayed line keeps the A-side original
  assert.equal(insensitive[0].line, 'Hello');
});

t('ignoreWhitespace collapses spacing differences', () => {
  const sensitive = diffLines('a  b', 'a b');
  assert.deepEqual(types(sensitive), ['remove', 'add']);
  const insensitive = diffLines('  a  b  ', 'a b', { ignoreWhitespace: true });
  assert.deepEqual(types(insensitive), ['equal']);
});

t('diffStats tallies add / remove / unchanged', () => {
  const rows = diffLines('a\nb\nc', 'a\nB\nc\nd');
  const s = diffStats(rows);
  assert.equal(s.added, 2);   // B and d
  assert.equal(s.removed, 1); // b
  assert.equal(s.unchanged, 2); // a and c
});

console.log(`\n${pass} passing`);
