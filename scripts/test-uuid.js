// test-uuid.js — unit tests for the pure UUID module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { uuidV4, isValidUuid, formatUuid, generateMany, NIL_UUID } from '../src/engine/uuid.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

// Deterministic RNG for repeatable tests: fills the buffer with a fixed pattern.
const fixedRng = (byte) => (b) => { for (let i = 0; i < b.length; i++) b[i] = byte; return b; };

t('uuidV4 produces a valid version-4 UUID', () => {
  const u = uuidV4();
  assert.ok(isValidUuid(u), 'should be a valid UUID: ' + u);
  assert.equal(u, u.toLowerCase());
  assert.equal(u[14], '4', 'version nibble must be 4');
  assert.ok('89ab'.includes(u[19]), 'variant nibble must be 8/9/a/b');
});

t('uuidV4 sets version and variant bits over fixed input', () => {
  // All 0xff bytes -> version forced to 4, variant forced to b.
  const u = uuidV4(fixedRng(0xff));
  assert.equal(u, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  // All 0x00 bytes -> version 4, variant 8.
  assert.equal(uuidV4(fixedRng(0x00)), '00000000-0000-4000-8000-000000000000');
});

t('uuidV4 values are unique across a batch', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(uuidV4());
  assert.equal(seen.size, 500);
});

t('isValidUuid accepts canonical forms and rejects junk', () => {
  assert.ok(isValidUuid(NIL_UUID));
  assert.ok(isValidUuid('  ffffffff-ffff-4fff-bfff-ffffffffffff  '));
  assert.ok(isValidUuid('FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF'));
  assert.ok(!isValidUuid(''));
  assert.ok(!isValidUuid('not-a-uuid'));
  assert.ok(!isValidUuid('ffffffff-ffff-4fff-bfff-fffffffffff')); // 11 in last group
  assert.ok(!isValidUuid('ffffffffffff4fffbfffffffffffffff'));   // no hyphens
  assert.ok(!isValidUuid('gggggggg-gggg-4ggg-bggg-gggggggggggg')); // non-hex
  assert.ok(!isValidUuid(42));
});

t('formatUuid applies uppercase, hyphenless and braces', () => {
  const u = '00000000-0000-4000-8000-000000000000';
  assert.equal(formatUuid(u), u);
  assert.equal(formatUuid(u, { uppercase: true }), '00000000-0000-4000-8000-000000000000'.toUpperCase());
  assert.equal(formatUuid(u, { hyphens: false }), '00000000000040008000000000000000');
  assert.equal(formatUuid(u, { braces: true }), '{00000000-0000-4000-8000-000000000000}');
  assert.equal(formatUuid(u, { hyphens: false, uppercase: true, braces: true }),
    '{00000000000040008000000000000000}'.toUpperCase());
});

t('generateMany returns the requested count, clamped to [1,1000]', () => {
  assert.equal(generateMany(5).length, 5);
  assert.equal(generateMany(0).length, 1);
  assert.equal(generateMany(-3).length, 1);
  assert.equal(generateMany(5000).length, 1000);
  generateMany(20).forEach((u) => assert.ok(isValidUuid(u)));
});

t('generateMany honors formatting options', () => {
  const out = generateMany(3, { uppercase: true, hyphens: false });
  out.forEach((u) => {
    assert.equal(u, u.toUpperCase());
    assert.ok(!u.includes('-'));
    assert.equal(u.length, 32);
  });
});

console.log(`\n${pass} passing`);
