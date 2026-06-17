// test-text-stats.js — unit tests for the pure text-analysis engine (no DOM).
import assert from 'node:assert/strict';
import {
  countWords, countChars, countCharsNoSpaces, countSentences,
  countParagraphs, countLines, formatDuration, topKeywordList, analyze
} from '../src/engine/text-stats.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };

t('countWords: basic, contractions and hyphenates are one word each', () => {
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords("don't stop well-known facts"), 4);
  assert.equal(countWords('  spaced   out   text  '), 3);
  assert.equal(countWords(''), 0);
});

t('countWords: unicode letters and numbers count', () => {
  assert.equal(countWords('café déjà vu'), 3);
  assert.equal(countWords('I have 3 apples'), 4);
});

t('countChars: code points, emoji counts as one', () => {
  assert.equal(countChars('hello'), 5);
  assert.equal(countChars('a😀b'), 3); // astral emoji = 1 char, not 2
  assert.equal(countChars(''), 0);
});

t('countCharsNoSpaces: strips all whitespace', () => {
  assert.equal(countCharsNoSpaces('a b\tc\nd'), 4);
  assert.equal(countCharsNoSpaces('   '), 0);
});

t('countSentences: terminators and trailing fragment', () => {
  assert.equal(countSentences('Hello. How are you? Fine!'), 3);
  assert.equal(countSentences('No terminator here'), 1);
  assert.equal(countSentences('One... two!!'), 2); // grouped terminators
  assert.equal(countSentences('   '), 0);
});

t('countParagraphs: blank-line separated blocks', () => {
  assert.equal(countParagraphs('para one\n\npara two'), 2);
  assert.equal(countParagraphs('single block\nwith a soft line'), 1);
  assert.equal(countParagraphs('\n\n  \n\n'), 0);
});

t('countLines: newline separated', () => {
  assert.equal(countLines('a\nb\nc'), 3);
  assert.equal(countLines('one line'), 1);
  assert.equal(countLines(''), 0);
});

t('formatDuration: seconds and minutes', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(60), '1m');
  assert.equal(formatDuration(90), '1m 30s');
  assert.equal(formatDuration(59.4), '59s');
});

t('topKeywordList: ignores stop words and short tokens, ranks by frequency', () => {
  const text = 'The cat sat on the mat. The cat ran. Cats and a cat.';
  const kw = topKeywordList(text, 3);
  assert.equal(kw[0].word, 'cat');
  assert.equal(kw[0].count, 3);
  // 13 total words -> 3/13 ~= 23.1%
  assert.equal(kw[0].percent, 23.1);
  // stop words "the"/"on"/"and"/"a" excluded
  assert.ok(!kw.some((k) => k.word === 'the'));
});

t('analyze: aggregate counts and reading/speaking time', () => {
  const r = analyze('Hello world. This is a short test of the engine.');
  assert.equal(r.words, 10);
  assert.equal(r.sentences, 2);
  assert.equal(r.paragraphs, 1);
  assert.equal(r.charactersNoSpaces, countCharsNoSpaces('Hello world. This is a short test of the engine.'));
  assert.equal(r.avgWordsPerSentence, 5);
  assert.ok(typeof r.readingTime === 'string');
  assert.ok(typeof r.speakingTime === 'string');
});

t('analyze: empty text is all zeros and 0s times', () => {
  const r = analyze('');
  assert.equal(r.words, 0);
  assert.equal(r.characters, 0);
  assert.equal(r.sentences, 0);
  assert.equal(r.paragraphs, 0);
  assert.equal(r.readingTime, '0s');
  assert.equal(r.speakingTime, '0s');
  assert.deepEqual(r.keywords, []);
});

t('analyze: respects custom wpm', () => {
  // 400 words at 200 wpm = 2 min; at 100 wpm = 4 min
  const text = Array.from({ length: 400 }, () => 'word').join(' ');
  assert.equal(analyze(text, { wpm: 200 }).readingTime, '2m');
  assert.equal(analyze(text, { wpm: 100 }).readingTime, '4m');
});

console.log(`\n${pass} passing`);
