// lorem.js — pure, dependency-free Lorem Ipsum placeholder-text generator.
// Shared by the browser tool (lorem-ipsum-generator.js) and the unit tests.
//
// Generates classic "Lorem ipsum" filler text in three units: words, sentences,
// or paragraphs. Output is deterministic given the same inputs (a small seeded
// PRNG drives word/sentence-length variation), so the same request always yields
// the same text — handy for tests and for reproducible mock-ups.
//
// All randomness is local; nothing is fetched and nothing leaves the browser.

// The classic Lorem Ipsum word pool (lowercase, no punctuation).
export const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
  'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'eu', 'fugiat', 'nulla', 'pariatur', 'excepteur',
  'sint', 'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui',
  'officia', 'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'at', 'vero',
  'eos', 'accusamus', 'iusto', 'odio', 'dignissimos', 'ducimus', 'blanditiis',
  'praesentium', 'voluptatum', 'deleniti', 'atque', 'corrupti', 'quos', 'dolores',
  'quas', 'molestias', 'excepturi', 'obcaecati', 'cupiditate', 'similique',
  'mollitia', 'animi', 'dolorem', 'fuga', 'harum', 'quidem', 'rerum', 'facilis',
  'expedita', 'distinctio', 'nam', 'libero', 'tempore', 'cum', 'soluta', 'nobis',
  'eligendi', 'optio', 'cumque', 'nihil', 'impedit', 'quo', 'porro', 'quisquam'
];

const CLASSIC_OPENER = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];

const num = (n, dflt = 0) => {
  const v = typeof n === 'number' ? n : parseInt(n, 10);
  return Number.isFinite(v) ? v : dflt;
};

// Small deterministic PRNG (mulberry32). Seeded so output is reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer in [min, max] inclusive, drawn from the rng.
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// Build one sentence of `n` words. `pool` is the word list; `rng` the generator.
// `useOpener` seeds the very first sentence with the canonical opening words.
// A comma is sprinkled into longer sentences; the sentence ends with a period.
function buildSentence(rng, n, useOpener) {
  const count = Math.max(1, n);
  const words = [];
  for (let i = 0; i < count; i++) {
    if (useOpener && i < CLASSIC_OPENER.length) words.push(CLASSIC_OPENER[i]);
    else words.push(WORDS[randInt(rng, 0, WORDS.length - 1)]);
  }
  // Optional comma somewhere in the middle of a longer sentence.
  if (count >= 5 && rng() < 0.6) {
    const at = randInt(rng, 1, count - 2);
    words[at] = words[at] + ',';
  }
  let s = words.join(' ');
  s = cap(s);
  return s + '.';
}

// Generate placeholder text.
//   input: { count, unit, startWithLorem, seed }
//   - count:          how many words / sentences / paragraphs (default 5)
//   - unit:           'words' | 'sentences' | 'paragraphs' (default 'paragraphs')
//   - startWithLorem: begin with the classic "Lorem ipsum dolor sit amet…" (default true)
//   - seed:           PRNG seed for reproducible output (default 1)
// Returns:
//   { text, paragraphs (array), unit, count, words (total word count) }
export function generate(input = {}) {
  const unit = ['words', 'sentences', 'paragraphs'].includes(input.unit)
    ? input.unit
    : 'paragraphs';
  const count = Math.max(0, num(input.count, 5));
  const startWithLorem = input.startWithLorem !== false;
  const rng = makeRng(num(input.seed, 1) || 1);

  let paragraphs = [];

  if (unit === 'words') {
    const words = [];
    for (let i = 0; i < count; i++) {
      if (startWithLorem && i < CLASSIC_OPENER.length) words.push(CLASSIC_OPENER[i]);
      else words.push(WORDS[randInt(rng, 0, WORDS.length - 1)]);
    }
    if (words.length) {
      words[0] = cap(words[0]);
      paragraphs = [words.join(' ') + '.'];
    }
  } else if (unit === 'sentences') {
    const sentences = [];
    for (let i = 0; i < count; i++) {
      sentences.push(buildSentence(rng, randInt(rng, 8, 16), startWithLorem && i === 0));
    }
    if (sentences.length) paragraphs = [sentences.join(' ')];
  } else {
    for (let p = 0; p < count; p++) {
      const sentenceCount = randInt(rng, 3, 6);
      const sentences = [];
      for (let i = 0; i < sentenceCount; i++) {
        sentences.push(buildSentence(rng, randInt(rng, 8, 16), startWithLorem && p === 0 && i === 0));
      }
      paragraphs.push(sentences.join(' '));
    }
  }

  const text = paragraphs.join('\n\n');
  const totalWords = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;

  return { text, paragraphs, unit, count, words: totalWords };
}
