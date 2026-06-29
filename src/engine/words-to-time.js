// words-to-time.js — pure, dependency-free speaking-time math for the
// Words to Minutes (Speech Time Calculator). Shared by the browser tool
// (words-to-minutes.js) and the unit tests. No DOM, no Date, nothing uploaded.
//
// The core idea is simple: time = words / words-per-minute. We express the
// result both in raw seconds and as a friendly minutes/seconds breakdown, and
// we expose a separate silent-reading estimate at the average adult reading
// speed of about 238 words per minute (a widely cited meta-analysis figure).
//
// All exported functions take their inputs as plain numbers/strings so the same
// code path runs in Node tests and in the browser. Invalid input (bad numbers,
// negatives, non-positive wpm) returns a NaN-filled / zeroed result so the UI
// can stay quiet rather than show NaN.

// Average adult silent reading speed, words per minute. Used for the reading
// estimate that sits alongside the spoken estimate. (~238 wpm is the commonly
// cited average for English prose.)
export const SILENT_READING_WPM = 238;

// Named speaking-pace presets, words per minute.
export const PACE_PRESETS = {
  slow: 110,        // deliberate, emphatic delivery
  average: 130,     // conversational / typical presentation
  fast: 160         // brisk, energetic delivery
};

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Count words in a block of text: runs of letters/digits, allowing internal
 * apostrophes and hyphens so "don't" and "well-known" each count as one word.
 * Unicode-aware so accented text and other scripts are handled sensibly.
 * Returns 0 for empty/whitespace-only input.
 */
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
export function countWords(text) {
  if (!text) return 0;
  const m = String(text).match(WORD_RE);
  return m ? m.length : 0;
}

/**
 * Seconds to speak (or read) `words` at `wpm` words per minute.
 * Returns NaN for invalid input (non-finite words, negative words, wpm <= 0).
 */
export function secondsFor(words, wpm) {
  const w = num(words), r = num(wpm);
  if (!Number.isFinite(w) || !Number.isFinite(r)) return NaN;
  if (w < 0 || r <= 0) return NaN;
  return (w / r) * 60;
}

/**
 * Format a number of seconds as a zero-padded clock string "m:ss"
 * (e.g. 90 -> "1:30", 5 -> "0:05"). Rounds to the nearest whole second.
 * Returns "0:00" for non-finite or negative input.
 */
export function formatClock(totalSeconds) {
  const s = num(totalSeconds);
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const whole = Math.round(s);
  const m = Math.floor(whole / 60);
  const rem = whole % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/**
 * A friendly, rounded "about X minutes" phrase for a number of seconds.
 * Picks the most natural unit: seconds under a minute, a half/whole minute for
 * short clips, and rounded minutes above that. Returns "0 seconds" for empty.
 */
export function friendlyDuration(totalSeconds) {
  const s = num(totalSeconds);
  if (!Number.isFinite(s) || s <= 0) return '0 seconds';
  if (s < 60) {
    const sec = Math.max(1, Math.round(s));
    return `about ${sec} second${sec === 1 ? '' : 's'}`;
  }
  const mins = s / 60;
  if (mins < 10) {
    // Round to the nearest half minute for short talks (reads naturally).
    const half = Math.round(mins * 2) / 2;
    if (Number.isInteger(half)) {
      return `about ${half} minute${half === 1 ? '' : 's'}`;
    }
    return `about ${half} minutes`;
  }
  const rounded = Math.round(mins);
  return `about ${rounded} minutes`;
}

/**
 * Full computation for the tool. Given a word count and a speaking pace (wpm),
 * returns the spoken-time figures plus a silent-reading estimate.
 *
 * @param {number|string} words  Word count (>= 0).
 * @param {number|string} wpm    Speaking pace in words per minute (> 0).
 * @param {object} [opts]
 * @param {number} [opts.readingWpm=SILENT_READING_WPM] Silent reading speed.
 * @returns {{
 *   words:number, wpm:number, readingWpm:number,
 *   speakingSeconds:number, speakingClock:string, speakingFriendly:string,
 *   speakingMinutes:number,
 *   readingSeconds:number, readingClock:string, readingFriendly:string,
 *   readingMinutes:number,
 *   valid:boolean
 * }}
 * On invalid input, numeric fields are 0/NaN, clocks are "0:00", and
 * `valid` is false so the caller can keep the readout blank.
 */
export function compute(words, wpm, opts = {}) {
  const w = num(words);
  const r = num(wpm);
  const readingWpm = num(opts.readingWpm);
  const rWpm = Number.isFinite(readingWpm) && readingWpm > 0 ? readingWpm : SILENT_READING_WPM;

  const bad = {
    words: 0, wpm: NaN, readingWpm: rWpm,
    speakingSeconds: NaN, speakingClock: '0:00', speakingFriendly: '0 seconds', speakingMinutes: NaN,
    readingSeconds: NaN, readingClock: '0:00', readingFriendly: '0 seconds', readingMinutes: NaN,
    valid: false
  };

  if (!Number.isFinite(w) || w < 0) return bad;
  if (!Number.isFinite(r) || r <= 0) return { ...bad, words: Math.max(0, w) };

  const speakingSeconds = (w / r) * 60;
  const readingSeconds = (w / rWpm) * 60;

  return {
    words: w,
    wpm: r,
    readingWpm: rWpm,
    speakingSeconds,
    speakingClock: formatClock(speakingSeconds),
    speakingFriendly: friendlyDuration(speakingSeconds),
    speakingMinutes: speakingSeconds / 60,
    readingSeconds,
    readingClock: formatClock(readingSeconds),
    readingFriendly: friendlyDuration(readingSeconds),
    readingMinutes: readingSeconds / 60,
    valid: w > 0
  };
}
