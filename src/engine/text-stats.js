// text-stats.js — pure text analysis for the Word & Character Counter.
// No DOM: callers pass a plain string and get back counts + estimates, so the
// same code path is unit-tested in Node and runs unchanged in the browser.
// Unicode-aware (uses \p{L}\p{N} word boundaries and code-point counting) so
// accented text, emoji, and CJK are handled sensibly.

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
// Sentence terminators: ., !, ?, … and their CJK equivalents 。！？
const SENTENCE_RE = /[^.!?…。！？]*[.!?…。！？]+(?:["'”’)\]]*)|[^.!?…。！？]+$/gu;

/** Count words: runs of letters/digits, allowing internal apostrophes/hyphens
 *  (so "don't" and "well-known" each count as one word). */
export function countWords(text) {
  if (!text) return 0;
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

/** Count user-perceived characters (code points, not UTF-16 units) so a single
 *  emoji or astral character counts as 1, not 2. */
export function countChars(text) {
  if (!text) return 0;
  // Spread iterates by code point.
  return [...text].length;
}

/** Characters excluding all Unicode whitespace. */
export function countCharsNoSpaces(text) {
  if (!text) return 0;
  return [...text.replace(/\s/gu, '')].length;
}

/** Sentences: non-empty runs ending in terminal punctuation, plus a trailing
 *  fragment with no terminator (treated as one sentence if it has content). */
export function countSentences(text) {
  if (!text || !text.trim()) return 0;
  const m = text.match(SENTENCE_RE);
  if (!m) return 0;
  return m.filter((s) => s.trim().length > 0).length;
}

/** Paragraphs: blocks of text separated by one or more blank lines. A single
 *  block of non-blank text is one paragraph. */
export function countParagraphs(text) {
  if (!text || !text.trim()) return 0;
  return text
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

/** Line count (1 per newline-separated line, including the last). 0 for empty. */
export function countLines(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

/**
 * Format a number of seconds as a compact "Xm Ys" / "Ys" string.
 * Always rounds up to whole seconds so a non-empty text never shows "0s".
 */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/**
 * Full analysis of a block of text.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.wpm=200]   Reading speed (words per minute).
 * @param {number} [opts.speakWpm=130]  Speaking speed (words per minute).
 * @param {number} [opts.topKeywords=5] How many top keywords to return.
 * @returns {{
 *   words, characters, charactersNoSpaces, sentences, paragraphs, lines,
 *   readingTime, speakingTime, readingSeconds, speakingSeconds,
 *   avgWordsPerSentence, keywords:Array<{word,count,percent}>
 * }}
 */
export function analyze(text, opts = {}) {
  const wpm = Number(opts.wpm) > 0 ? Number(opts.wpm) : 200;
  const speakWpm = Number(opts.speakWpm) > 0 ? Number(opts.speakWpm) : 130;
  const topKeywords = Number.isInteger(opts.topKeywords) && opts.topKeywords > 0 ? opts.topKeywords : 5;
  const src = text || '';

  const words = countWords(src);
  const sentences = countSentences(src);
  const readingSeconds = (words / wpm) * 60;
  const speakingSeconds = (words / speakWpm) * 60;

  return {
    words,
    characters: countChars(src),
    charactersNoSpaces: countCharsNoSpaces(src),
    sentences,
    paragraphs: countParagraphs(src),
    lines: countLines(src),
    readingSeconds,
    speakingSeconds,
    readingTime: words ? formatDuration(readingSeconds) : '0s',
    speakingTime: words ? formatDuration(speakingSeconds) : '0s',
    avgWordsPerSentence: sentences ? Math.round((words / sentences) * 10) / 10 : 0,
    keywords: topKeywordList(src, topKeywords)
  };
}

// Very common English stop words excluded from keyword density so the list
// surfaces meaningful terms rather than "the/and/of".
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
  'for', 'with', 'as', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
  'they', 'them', 'his', 'her', 'their', 'our', 'my', 'your', 'me', 'him', 'us',
  'not', 'no', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
  'can', 'could', 'should', 'from', 'so', 'than', 'then', 'there', 'here',
  'what', 'which', 'who', 'when', 'where', 'how', 'all', 'any', 'some', 'just'
]);

/** Top-N keywords by frequency, ignoring stop words and short tokens. */
export function topKeywordList(text, n = 5) {
  if (!text) return [];
  const totalWords = countWords(text);
  if (!totalWords) return [];
  const freq = new Map();
  const m = text.toLowerCase().match(WORD_RE);
  if (!m) return [];
  for (const w of m) {
    if (w.length < 3 || STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([word, count]) => ({
      word,
      count,
      percent: Math.round((count / totalWords) * 1000) / 10
    }));
}
