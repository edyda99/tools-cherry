// test-text-stats.js — unit tests for the pure text-stats module.
// Run via `npm test`. Asserts the rich analyze() API (countWords, analyze,
// topKeywordList, formatDuration, ...).
import assert from 'node:assert/strict';
import {
  analyze,
  countWords,
  countChars,
  countCharsNoSpaces,
  countSentences,
  countParagraphs,
  countLines,
  formatDuration,
  topKeywordList
} from '../src/engine/text-stats.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('empty string is all zeros', () => {
  const s = analyze('');
  assert.equal(s.words, 0);
  assert.equal(s.characters, 0);
  assert.equal(s.charactersNoSpaces, 0);
  assert.equal(s.sentences, 0);
  assert.equal(s.paragraphs, 0);
  assert.equal(s.lines, 0);
  approx(s.readingSeconds, 0);
  approx(s.speakingSeconds, 0);
  assert.equal(s.readingTime, '0s');
  assert.equal(s.speakingTime, '0s');
});

t('whitespace-only string is all zeros', () => {
  const s = analyze('   \n\n  \t ');
  assert.equal(s.words, 0);
  assert.equal(s.sentences, 0);
  assert.equal(s.paragraphs, 0);
});

t('non-string / null input is all zeros', () => {
  const s = analyze(null);
  assert.equal(s.words, 0);
  assert.equal(s.characters, 0);
  assert.equal(countWords(null), 0);
  assert.equal(countChars(undefined), 0);
});

t('"Hello world." -> 2 words, 12 chars, 11 no-space, 1 sentence', () => {
  const s = analyze('Hello world.');
  assert.equal(s.words, 2);
  assert.equal(s.characters, 12);
  assert.equal(s.charactersNoSpaces, 11);
  assert.equal(s.sentences, 1);
  assert.equal(s.paragraphs, 1);
});

t('collapses multiple spaces and newlines in word count', () => {
  assert.equal(countWords('one   two\t\tthree\nfour'), 4);
});

t('leading/trailing whitespace does not add words', () => {
  assert.equal(countWords('   hello world   '), 2);
});

t('contractions and hyphenated words count as one word', () => {
  assert.equal(countWords("don't well-known"), 2);
});

t('multiple sentence terminators', () => {
  assert.equal(countSentences('Hi! How are you? I am fine.'), 3);
});

t('repeated terminators count once', () => {
  assert.equal(countSentences('Wow!!! Really??'), 2);
});

t('text with no terminator is one sentence', () => {
  assert.equal(countSentences('just some words here'), 1);
});

t('trailing fragment after a terminator counts as a sentence', () => {
  assert.equal(countSentences('Done. And more'), 2);
});

t('multi-paragraph counts blocks split by blank lines', () => {
  assert.equal(
    countParagraphs('First paragraph here.\n\nSecond paragraph here.\n\n\nThird one.'),
    3
  );
});

t('single block with single newlines is one paragraph', () => {
  assert.equal(countParagraphs('line one\nline two\nline three'), 1);
});

t('line count includes the last line', () => {
  assert.equal(countLines('a\nb\nc'), 3);
  assert.equal(countLines('one line'), 1);
});

t('characters count code points (emoji = 1)', () => {
  assert.equal(countChars('a😀b'), 3);
  assert.equal(countCharsNoSpaces('a b\tc'), 3);
});

t('reading and speaking time scale with word count', () => {
  // 200 words -> 60s reading at 200 wpm; 200/130 min speaking
  const text = Array.from({ length: 200 }, () => 'word').join(' ');
  const s = analyze(text);
  assert.equal(s.words, 200);
  approx(s.readingSeconds, 60);
  approx(s.speakingSeconds, (200 / 130) * 60);
});

t('reading speed (wpm) option changes reading time', () => {
  const text = Array.from({ length: 400 }, () => 'word').join(' ');
  const s = analyze(text, { wpm: 400 });
  approx(s.readingSeconds, 60); // 400 words at 400 wpm = 1 min
});

t('formatDuration renders m/s', () => {
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(60), '1m');
  assert.equal(formatDuration(90), '1m 30s');
});

t('unicode words are counted', () => {
  assert.equal(countWords('café naïve résumé'), 3);
});

t('keyword density: case-insensitive, strips punctuation, sorts by frequency, has percent', () => {
  const s = analyze('Cat cat CAT dog dog bird.');
  const top = s.keywords[0];
  assert.equal(top.word, 'cat');
  assert.equal(top.count, 3);
  // 3 of 6 total words -> 50%
  approx(top.percent, 50, 0.05);
});

t('keyword density excludes common stop words', () => {
  const s = analyze('the the the cat cat');
  assert.ok(!s.keywords.some((k) => k.word === 'the'));
  assert.equal(s.keywords[0].word, 'cat');
});

t('topKeywordList respects the n cap', () => {
  const text = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
  assert.equal(topKeywordList(text, 5).length, 5);
  assert.equal(topKeywordList(text, 3).length, 3);
});

t('avgWordsPerSentence', () => {
  const s = analyze('one two three. four five six.');
  approx(s.avgWordsPerSentence, 3);
});

t('empty text: keywords empty', () => {
  const s = analyze('');
  assert.equal(s.keywords.length, 0);
  assert.equal(topKeywordList('').length, 0);
});

console.log(`\n${pass} passing`);
