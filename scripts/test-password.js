// test-password.js — unit tests for the pure password engine.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  POOLS,
  AMBIGUOUS,
  buildCharset,
  buildPools,
  generateFromPools,
  generatePassword,
  passwordStrength,
  entropyBits
} from '../src/engine/password.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

// --- buildCharset: each toggle contributes its pool --------------------------
t('buildCharset: uppercase only is the uppercase pool', () =>
  assert.equal(buildCharset({ uppercase: true }), POOLS.uppercase));

t('buildCharset: lowercase only is the lowercase pool', () =>
  assert.equal(buildCharset({ lowercase: true }), POOLS.lowercase));

t('buildCharset: numbers only is the numbers pool', () =>
  assert.equal(buildCharset({ numbers: true }), POOLS.numbers));

t('buildCharset: symbols only is the symbols pool', () =>
  assert.equal(buildCharset({ symbols: true }), POOLS.symbols));

t('buildCharset: all toggles concatenate every pool', () => {
  const cs = buildCharset({ uppercase: true, lowercase: true, numbers: true, symbols: true });
  for (const c of POOLS.uppercase + POOLS.lowercase + POOLS.numbers + POOLS.symbols) {
    assert.ok(cs.includes(c), `missing ${c}`);
  }
});

t('buildCharset: nothing selected is empty string', () =>
  assert.equal(buildCharset({}), ''));

// --- ambiguous exclusion -----------------------------------------------------
t('buildCharset: excludeAmbiguous drops 0 O o 1 l I', () => {
  const cs = buildCharset({
    uppercase: true, lowercase: true, numbers: true, excludeAmbiguous: true
  });
  for (const c of AMBIGUOUS) assert.ok(!cs.includes(c), `should not contain ${c}`);
  // a non-ambiguous char is still present
  assert.ok(cs.includes('A'));
  assert.ok(cs.includes('2'));
});

t('buildCharset: without excludeAmbiguous, ambiguous chars remain', () => {
  const cs = buildCharset({ numbers: true, uppercase: true, lowercase: true });
  assert.ok(cs.includes('0'));
  assert.ok(cs.includes('1'));
  assert.ok(cs.includes('O'));
});

// --- generatePassword respects length + allowed chars ------------------------
// Deterministic injected RNG: a simple LCG so tests are repeatable.
function seededRandomInt(seed) {
  let state = seed >>> 0;
  return (maxExclusive) => {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state % maxExclusive;
  };
}

t('generatePassword: result length equals requested length', () => {
  const cs = buildCharset({ lowercase: true, numbers: true });
  const pw = generatePassword(cs, 16, seededRandomInt(12345));
  assert.equal(pw.length, 16);
});

t('generatePassword: every char comes from the charset', () => {
  const cs = buildCharset({ uppercase: true, numbers: true, symbols: true });
  const pw = generatePassword(cs, 64, seededRandomInt(999));
  for (const c of pw) assert.ok(cs.includes(c), `${c} not in charset`);
});

t('generatePassword: respects excludeAmbiguous in output', () => {
  const cs = buildCharset({
    lowercase: true, uppercase: true, numbers: true, excludeAmbiguous: true
  });
  const pw = generatePassword(cs, 64, seededRandomInt(7));
  for (const c of AMBIGUOUS) assert.ok(!pw.includes(c), `output contains ambiguous ${c}`);
});

t('generatePassword: same seed is deterministic', () => {
  const cs = buildCharset({ lowercase: true });
  const a = generatePassword(cs, 20, seededRandomInt(42));
  const b = generatePassword(cs, 20, seededRandomInt(42));
  assert.equal(a, b);
});

t('generatePassword: empty charset yields empty string', () =>
  assert.equal(generatePassword('', 16, seededRandomInt(1)), ''));

t('generatePassword: non-positive length yields empty string', () =>
  assert.equal(generatePassword('abc', 0, seededRandomInt(1)), ''));

// --- passwordStrength thresholds ---------------------------------------------
t('passwordStrength: empty is Very weak (0)', () => {
  const r = passwordStrength('');
  assert.equal(r.score, 0);
  assert.equal(r.label, 'Very weak');
});

t('passwordStrength: tiny short password is Very weak', () =>
  assert.equal(passwordStrength('ab1').score, 0));

t('passwordStrength: short low-variety is Weak', () => {
  const r = passwordStrength('abcdefg'); // 7 lowercase
  assert.equal(r.label, 'Weak');
  assert.equal(r.score, 1);
});

t('passwordStrength: medium mixed is Fair or better', () => {
  const r = passwordStrength('Abcdefg1'); // 8 chars, 3 classes
  assert.ok(r.score >= 2, `expected >=2 got ${r.score}`);
});

t('passwordStrength: long varied is Strong', () => {
  const r = passwordStrength('Abcdef12gh34'); // 12 chars, 3 classes
  assert.ok(r.score >= 3, `expected >=3 got ${r.score}`);
});

t('passwordStrength: long all-classes is Very strong', () => {
  const r = passwordStrength('Abcdef12!@gh34XY'); // 16 chars, 4 classes
  assert.equal(r.score, 4);
  assert.equal(r.label, 'Very strong');
});

// --- buildPools + guaranteed inclusion ---------------------------------------
t('buildPools: one string per selected class, ambiguous filtered', () => {
  const pools = buildPools({ uppercase: true, numbers: true, excludeAmbiguous: true });
  assert.equal(pools.length, 2);
  assert.ok(!pools.join('').includes('0'));
  assert.ok(!pools.join('').includes('O'));
});

t('generateFromPools: contains at least one char from EVERY selected class', () => {
  const pools = buildPools({ uppercase: true, lowercase: true, numbers: true, symbols: true });
  // try many seeds to be confident the guarantee holds regardless of RNG
  for (let seed = 1; seed <= 50; seed++) {
    const pw = generateFromPools(pools, 8, seededRandomInt(seed));
    assert.equal(pw.length, 8);
    assert.ok(/[A-Z]/.test(pw), `seed ${seed}: no uppercase in ${pw}`);
    assert.ok(/[a-z]/.test(pw), `seed ${seed}: no lowercase in ${pw}`);
    assert.ok(/[0-9]/.test(pw), `seed ${seed}: no number in ${pw}`);
    assert.ok(/[^A-Za-z0-9]/.test(pw), `seed ${seed}: no symbol in ${pw}`);
  }
});

t('generateFromPools: length below class count still fills exactly length', () => {
  const pools = buildPools({ uppercase: true, lowercase: true, numbers: true, symbols: true });
  const pw = generateFromPools(pools, 2, seededRandomInt(3));
  assert.equal(pw.length, 2); // can't fit all 4 classes; just length 2
});

t('generateFromPools: empty pools / non-positive length -> empty', () => {
  assert.equal(generateFromPools([], 16, seededRandomInt(1)), '');
  assert.equal(generateFromPools(['abc'], 0, seededRandomInt(1)), '');
});

t('generateFromPools: deterministic for a fixed seed', () => {
  const pools = buildPools({ lowercase: true, numbers: true });
  assert.equal(
    generateFromPools(pools, 20, seededRandomInt(42)),
    generateFromPools(pools, 20, seededRandomInt(42))
  );
});

// --- entropyBits -------------------------------------------------------------
t('entropyBits: 16 chars over 26-char set ≈ 75.2 bits', () => {
  const b = entropyBits(26, 16);
  assert.ok(Math.abs(b - 16 * Math.log2(26)) < 1e-9);
  assert.ok(b > 75 && b < 76);
});

t('entropyBits: degenerate inputs are 0', () => {
  assert.equal(entropyBits(1, 16), 0);
  assert.equal(entropyBits(90, 0), 0);
});

console.log(`\n${pass} passing`);
