// test-json-format.js — unit tests for the pure JSON format/validate module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { validateJson, formatJson, minifyJson } from '../src/engine/json-format.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('validateJson accepts well-formed JSON', () => {
  assert.deepEqual(validateJson('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(validateJson('[1,2,3]'), { ok: true, value: [1, 2, 3] });
  assert.deepEqual(validateJson('  true  '), { ok: true, value: true });
  assert.deepEqual(validateJson('"hi"'), { ok: true, value: 'hi' });
});

t('validateJson rejects empty / non-string input', () => {
  assert.equal(validateJson('').ok, false);
  assert.equal(validateJson('   ').ok, false);
  assert.equal(validateJson(null).ok, false);
});

t('validateJson reports a line/column on error', () => {
  const r = validateJson('{\n  "a": 1,\n  "b":\n}');
  assert.equal(r.ok, false);
  assert.ok(typeof r.message === 'string' && r.message.length > 0);
  assert.ok(r.line >= 1, 'line should be 1-based and positive');
  assert.ok(r.column >= 1, 'column should be 1-based and positive');
});

t('validateJson catches a classic single-line error', () => {
  const r = validateJson('{"a":}');
  assert.equal(r.ok, false);
  assert.equal(r.line, 1);
});

t('formatJson pretty-prints with a 2-space default', () => {
  assert.equal(formatJson('{"a":1,"b":[2,3]}'), '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
});

t('formatJson honors custom indent width and tabs', () => {
  assert.equal(formatJson('{"a":1}', 4), '{\n    "a": 1\n}');
  assert.equal(formatJson('{"a":1}', 'tab'), '{\n\t"a": 1\n}');
  assert.equal(formatJson('{"a":1}', 0), '{"a":1}');
});

t('formatJson throws with line/column metadata on invalid input', () => {
  let caught;
  try { formatJson('{bad}'); } catch (e) { caught = e; }
  assert.ok(caught instanceof Error);
  assert.ok(caught.line >= 1);
});

t('minifyJson strips all insignificant whitespace', () => {
  assert.equal(minifyJson('{\n  "a": 1,\n  "b": [ 2, 3 ]\n}'), '{"a":1,"b":[2,3]}');
});

t('minifyJson then formatJson round-trips structurally', () => {
  const src = '{ "name": "Ada", "tags": ["x","y"], "n": 42, "ok": true, "nil": null }';
  const min = minifyJson(src);
  assert.deepEqual(JSON.parse(formatJson(min)), JSON.parse(src));
});

console.log(`\n${pass} passing`);
