// test-morse.js — unit tests for the pure morse module. Run via `npm test`.
import assert from 'node:assert/strict';
import { textToMorse, morseToText, MORSE } from '../src/engine/morse.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('textToMorse: SOS', () => assert.equal(textToMorse('SOS'), '... --- ...'));
t('textToMorse: HELLO WORLD', () =>
  assert.equal(textToMorse('HELLO WORLD'), '.... . .-.. .-.. --- / .-- --- .-. .-.. -..'));
t('textToMorse: case-insensitive', () =>
  assert.equal(textToMorse('hello'), textToMorse('HELLO')));
t('textToMorse: digits and punctuation', () =>
  assert.equal(textToMorse('A1.'), '.- .---- .-.-.-'));
t('textToMorse: collapses extra whitespace', () =>
  assert.equal(textToMorse('  HI   YOU  '), '.... .. / -.-- --- ..-'));
t('textToMorse: drops unknown characters', () =>
  assert.equal(textToMorse('A©B'), '.- -...')); // © has no code
t('textToMorse: empty/invalid -> empty', () => {
  assert.equal(textToMorse(''), '');
  assert.equal(textToMorse('   '), '');
  assert.equal(textToMorse(null), '');
});

t('morseToText: SOS', () => assert.equal(morseToText('... --- ...'), 'SOS'));
t('morseToText: HELLO WORLD via slash', () =>
  assert.equal(morseToText('.... . .-.. .-.. --- / .-- --- .-. .-.. -..'), 'HELLO WORLD'));
t('morseToText: tolerant of bare slash and extra spaces', () =>
  assert.equal(morseToText('....  ../-.-- --- ..-'), 'HI YOU'));
t('morseToText: unknown code -> ?', () =>
  assert.equal(morseToText('... ........ ...'), 'S?S'));
t('morseToText: empty/invalid -> empty', () => {
  assert.equal(morseToText(''), '');
  assert.equal(morseToText('   '), '');
  assert.equal(morseToText(null), '');
});

t('round-trip: text -> morse -> text', () => {
  const text = 'THE QUICK BROWN FOX 123';
  assert.equal(morseToText(textToMorse(text)), text);
});

t('MORSE table has 26 letters + 10 digits', () => {
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].every((c) => MORSE[c]);
  const digits = [...'0123456789'].every((c) => MORSE[c]);
  assert.ok(letters && digits);
});

console.log(`\n${pass} passing`);
