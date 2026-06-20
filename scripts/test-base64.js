// test-base64.js — unit tests for the pure Base64 encode/decode module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { encodeBase64, decodeBase64 } from '../src/engine/base64.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('encodes plain ASCII', () => {
  assert.equal(encodeBase64('Man'), 'TWFu');
  assert.equal(encodeBase64('Hello, World!'), 'SGVsbG8sIFdvcmxkIQ==');
  assert.equal(encodeBase64(''), '');
});

t('decodes plain ASCII', () => {
  assert.equal(decodeBase64('TWFu'), 'Man');
  assert.equal(decodeBase64('SGVsbG8sIFdvcmxkIQ=='), 'Hello, World!');
});

t('handles UTF-8: accents, Arabic, CJK, emoji', () => {
  for (const s of ['café', 'naïve', 'مرحبا', '你好世界', '🚀 to the moon 🌙']) {
    assert.equal(decodeBase64(encodeBase64(s)), s);
  }
});

t('tolerates whitespace/newlines in decode input', () => {
  assert.equal(decodeBase64('SGVs\nbG8s\n IFdv cmxk IQ=='), 'Hello, World!');
});

t('URL-safe round-trips and differs from standard where needed', () => {
  const s = '<<???>>'; // produces + and / in standard base64
  const std = encodeBase64(s);
  const url = encodeBase64(s, { urlSafe: true });
  assert.ok(!/[+/=]/.test(url));
  assert.equal(decodeBase64(url, { urlSafe: true }), s);
  assert.equal(decodeBase64(std), s);
});

t('rejects invalid Base64', () => {
  assert.throws(() => decodeBase64('not base64!!!'));
  assert.throws(() => decodeBase64('====')); // only padding
  assert.throws(() => decodeBase64('SGVsbG8-', {})); // - is not standard
  assert.throws(() => encodeBase64(42));
  assert.throws(() => decodeBase64(''));
});

t('rejects URL-safe input containing standard-only chars', () => {
  assert.throws(() => decodeBase64('SG+s', { urlSafe: true }));
});

console.log(`\n${pass} passing`);
