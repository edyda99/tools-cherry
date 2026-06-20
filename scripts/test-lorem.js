// test-lorem.js — unit tests for the pure lorem module. Run via `npm test`.
import assert from 'node:assert/strict';
import { generate, WORDS } from '../src/engine/lorem.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('default: 5 paragraphs, starts with Lorem ipsum', () => {
  const r = generate();
  assert.equal(r.unit, 'paragraphs');
  assert.equal(r.count, 5);
  assert.equal(r.paragraphs.length, 5);
  assert.ok(r.text.startsWith('Lorem ipsum dolor sit amet'));
});

t('words unit: exact word count', () => {
  const r = generate({ unit: 'words', count: 10 });
  assert.equal(r.unit, 'words');
  assert.equal(r.words, 10);
  assert.equal(r.paragraphs.length, 1);
  assert.ok(r.text.startsWith('Lorem ipsum'));
});

t('words unit: single paragraph, no blank-line breaks', () => {
  const r = generate({ unit: 'words', count: 20 });
  assert.ok(!r.text.includes('\n\n'));
});

t('sentences unit: count sentences via period split', () => {
  const r = generate({ unit: 'sentences', count: 4 });
  assert.equal(r.unit, 'sentences');
  const periods = (r.text.match(/\./g) || []).length;
  assert.equal(periods, 4);
});

t('paragraphs joined by blank line', () => {
  const r = generate({ unit: 'paragraphs', count: 3 });
  assert.equal(r.paragraphs.length, 3);
  assert.equal(r.text.split('\n\n').length, 3);
});

t('startWithLorem:false does not force the classic opener', () => {
  const r = generate({ unit: 'words', count: 8, startWithLorem: false, seed: 7 });
  // First word is capitalized but need not be "Lorem"
  assert.ok(/^[A-Z]/.test(r.text));
  assert.ok(!r.text.startsWith('Lorem ipsum dolor sit amet consectetur adipiscing elit'));
});

t('deterministic: same seed yields identical text', () => {
  const a = generate({ unit: 'paragraphs', count: 4, seed: 42 });
  const b = generate({ unit: 'paragraphs', count: 4, seed: 42 });
  assert.equal(a.text, b.text);
});

t('different seeds yield different text', () => {
  const a = generate({ unit: 'paragraphs', count: 4, seed: 1, startWithLorem: false });
  const b = generate({ unit: 'paragraphs', count: 4, seed: 2, startWithLorem: false });
  assert.notEqual(a.text, b.text);
});

t('count 0 yields empty text, never NaN', () => {
  const r = generate({ unit: 'paragraphs', count: 0 });
  assert.equal(r.text, '');
  assert.equal(r.words, 0);
  assert.equal(r.paragraphs.length, 0);
});

t('invalid count falls back to default 5', () => {
  const r = generate({ unit: 'paragraphs', count: 'abc' });
  assert.equal(r.count, 5);
  assert.equal(r.paragraphs.length, 5);
});

t('invalid unit falls back to paragraphs', () => {
  const r = generate({ unit: 'bogus', count: 2 });
  assert.equal(r.unit, 'paragraphs');
  assert.equal(r.paragraphs.length, 2);
});

t('every output word is from the known pool', () => {
  const r = generate({ unit: 'words', count: 30, startWithLorem: false, seed: 99 });
  const set = new Set(WORDS);
  const tokens = r.text.replace(/[.,]/g, '').toLowerCase().split(/\s+/);
  for (const w of tokens) assert.ok(set.has(w), `unexpected word: ${w}`);
});

t('sentences end with a period and start capitalized', () => {
  const r = generate({ unit: 'sentences', count: 3 });
  assert.ok(r.text.endsWith('.'));
  assert.ok(/^[A-Z]/.test(r.text));
});

console.log(`\n${pass} passing`);
