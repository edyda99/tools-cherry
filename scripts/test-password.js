// test-password.js — unit tests for the pure password-generation engine.
// A deterministic rng (a fixed byte sequence, cycled) replaces crypto so the
// selection logic and strength math are fully reproducible without the browser.
import assert from 'node:assert/strict';
import {
  randIndex, buildPool, generatePassword, generatePassphrase,
  estimateStrength, WORDLIST_SIZE
} from '../src/engine/password-gen.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };

// Deterministic rng: fills the buffer from a repeating byte sequence.
function seqRng(bytes) {
  let i = 0;
  return (buf) => { for (let k = 0; k < buf.length; k++) buf[k] = bytes[i++ % bytes.length]; };
}

t('randIndex: returns 0 when max is 1', () => {
  assert.equal(randIndex(seqRng([5]), 1), 0);
});

t('randIndex: maps in-range bytes by modulo', () => {
  // byte 7, max 5 -> 7 % 5 = 2
  assert.equal(randIndex(seqRng([7]), 5), 2);
});

t('randIndex: rejects bytes >= limit to avoid modulo bias', () => {
  // max 10 -> limit 250; byte 255 is rejected, next byte 3 -> 3
  assert.equal(randIndex(seqRng([255, 3]), 10), 3);
});

t('randIndex: rejects out-of-range max', () => {
  assert.throws(() => randIndex(seqRng([0]), 0));
  assert.throws(() => randIndex(seqRng([0]), 300));
});

t('buildPool: combines selected classes, dedups', () => {
  const { pool, usedSets } = buildPool({ lowercase: true, numbers: true });
  assert.equal(usedSets.length, 2);
  assert.ok(pool.includes('a') && pool.includes('5'));
  assert.ok(!pool.includes('A'));
  // unique chars only
  assert.equal(pool.length, new Set(pool.split('')).size);
});

t('buildPool: avoidAmbiguous strips look-alikes', () => {
  const { pool } = buildPool({ lowercase: true, uppercase: true, numbers: true, avoidAmbiguous: true });
  for (const c of ['O', '0', 'l', '1', 'I']) assert.ok(!pool.includes(c), `should drop ${c}`);
  assert.ok(pool.includes('a'));
});

t('generatePassword: respects requested length', () => {
  const pw = generatePassword({ length: 16, lowercase: true, uppercase: true, numbers: true }, seqRng([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(pw.length, 16);
});

t('generatePassword: clamps length to [4,128]', () => {
  const short = generatePassword({ length: 1, lowercase: true }, seqRng([1, 2, 3]));
  assert.equal(short.length, 4);
  const long = generatePassword({ length: 999, lowercase: true }, seqRng([1, 2, 3]));
  assert.equal(long.length, 128);
});

t('generatePassword: includes at least one of each selected class', () => {
  // Use the real crypto rng for a realistic multi-run guarantee check.
  const rng = (buf) => globalThis.crypto.getRandomValues(buf);
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword({ length: 8, lowercase: true, uppercase: true, numbers: true, symbols: true }, rng);
    assert.ok(/[a-z]/.test(pw), 'has lowercase');
    assert.ok(/[A-Z]/.test(pw), 'has uppercase');
    assert.ok(/[0-9]/.test(pw), 'has digit');
    assert.ok(/[^a-zA-Z0-9]/.test(pw), 'has symbol');
  }
});

t('generatePassword: only uses characters from the pool', () => {
  const { pool } = buildPool({ lowercase: true, numbers: true });
  const rng = (buf) => globalThis.crypto.getRandomValues(buf);
  const pw = generatePassword({ length: 40, lowercase: true, numbers: true }, rng);
  for (const c of pw) assert.ok(pool.includes(c), `${c} not in pool`);
});

t('generatePassword: throws when no class selected', () => {
  assert.throws(() => generatePassword({ length: 12 }, seqRng([1])));
});

t('generatePassphrase: word count, separator, capitalize, number', () => {
  const rng = (buf) => globalThis.crypto.getRandomValues(buf);
  const p = generatePassphrase({ words: 4, separator: '.', capitalize: true, number: true }, rng);
  const parts = p.split('.');
  assert.equal(parts.length, 4);
  for (const w of parts) assert.match(w, /^[A-Z]/); // capitalized
  assert.match(p, /[0-9]/); // a digit was appended somewhere
});

t('generatePassphrase: clamps word count to [2,12]', () => {
  const rng = (buf) => globalThis.crypto.getRandomValues(buf);
  assert.equal(generatePassphrase({ words: 1 }, rng).split('-').length, 2);
  assert.equal(generatePassphrase({ words: 50 }, rng).split('-').length, 12);
});

t('estimateStrength: entropy = length * log2(poolSize)', () => {
  const s = estimateStrength(16, 62); // ~95.3 bits
  assert.ok(Math.abs(s.bits - 16 * Math.log2(62)) < 1e-9);
  assert.equal(s.label, 'Strong');
  assert.equal(s.score, 3);
});

t('estimateStrength: coarse buckets', () => {
  assert.equal(estimateStrength(4, 10).label, 'Very weak'); // ~13 bits
  assert.equal(estimateStrength(20, 95).score, 4);          // >128 bits
  assert.equal(estimateStrength(0, 0).bits, 0);             // degenerate
});

t('WORDLIST_SIZE is exposed and sane', () => {
  assert.ok(WORDLIST_SIZE >= 32);
});

console.log(`\n${pass} passing`);
