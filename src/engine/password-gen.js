// password-gen.js — pure password / passphrase generation logic.
// No DOM. The only browser dependency is a CSPRNG passed in as `rng` (a function
// that fills a Uint8Array in place, i.e. crypto.getRandomValues). Tests inject a
// deterministic rng so the character-selection and strength math are unit-tested
// without touching the real crypto. Runs identically in Node and the browser.

// Character classes. Look-alikes (O/0, l/1/I, etc.) are tagged so the optional
// "avoid ambiguous characters" mode can strip them from every set at once.
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
const AMBIGUOUS = new Set('O0oIl1|`\'":;.,{}[]()/\\'.split(''));

/** Draw a uniformly-distributed integer in [0, max) from a CSPRNG using
 *  rejection sampling, so there is no modulo bias. `rng` fills a Uint8Array
 *  in place (the crypto.getRandomValues contract). max must be in [1, 256]. */
export function randIndex(rng, max) {
  if (max < 1 || max > 256) throw new RangeError('max must be in [1, 256]');
  if (max === 1) return 0;
  // Largest multiple of `max` that fits in a byte; values at or above the
  // limit are rejected and redrawn so every index is equally likely.
  const limit = 256 - (256 % max);
  const buf = new Uint8Array(1);
  // Bounded loop: rejection probability < 0.5 per draw, so this terminates
  // quickly in practice; the cap is a hard safety stop for a broken rng.
  for (let i = 0; i < 10000; i++) {
    rng(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
  throw new Error('rng failed to produce an in-range value');
}

/** Build the active character pool from the requested classes. Returns a string
 *  of unique characters and the list of class strings actually used (for the
 *  "include at least one of each" guarantee). */
export function buildPool(opts) {
  const sets = [];
  if (opts.lowercase) sets.push(LOWER);
  if (opts.uppercase) sets.push(UPPER);
  if (opts.numbers) sets.push(DIGITS);
  if (opts.symbols) sets.push(SYMBOLS);

  const strip = (s) =>
    opts.avoidAmbiguous ? s.split('').filter((c) => !AMBIGUOUS.has(c)).join('') : s;

  const usedSets = sets.map(strip).filter((s) => s.length > 0);
  const pool = [...new Set(usedSets.join('').split(''))].join('');
  return { pool, usedSets };
}

/** Fisher-Yates shuffle of an array in place, using the injected rng. */
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randIndex(rng, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Generate a random character password.
 *
 * @param {object} opts
 * @param {number} opts.length            Desired length (clamped to [4, 128]).
 * @param {boolean} opts.lowercase        Include a-z.
 * @param {boolean} opts.uppercase        Include A-Z.
 * @param {boolean} opts.numbers          Include 0-9.
 * @param {boolean} opts.symbols          Include punctuation.
 * @param {boolean} [opts.avoidAmbiguous] Drop look-alike characters.
 * @param {function} rng                  CSPRNG filling a Uint8Array in place.
 * @returns {string} The generated password. Throws if no class is selected.
 */
export function generatePassword(opts, rng) {
  const length = Math.min(128, Math.max(4, Math.floor(Number(opts.length) || 0)));
  const { pool, usedSets } = buildPool(opts);
  if (pool.length === 0 || usedSets.length === 0) {
    throw new Error('Select at least one character type.');
  }

  const chars = [];
  // Guarantee at least one character from each selected class (when the length
  // allows it), then fill the rest from the full pool, then shuffle so the
  // guaranteed characters are not stuck at the front.
  const guaranteed = usedSets.slice(0, length);
  for (const set of guaranteed) chars.push(set[randIndex(rng, set.length)]);
  while (chars.length < length) chars.push(pool[randIndex(rng, pool.length)]);

  return shuffle(rng, chars).join('');
}

const WORDS = [
  'apple', 'river', 'maple', 'stone', 'cloud', 'ember', 'frost', 'grove',
  'haven', 'ivory', 'jolly', 'koala', 'lemon', 'mango', 'noble', 'ocean',
  'pearl', 'quilt', 'raven', 'solar', 'tiger', 'umbra', 'vivid', 'wheat',
  'xenon', 'yacht', 'zebra', 'amber', 'brave', 'coral', 'delta', 'eagle',
  'flint', 'glide', 'honey', 'inlet', 'jewel', 'kayak', 'lunar', 'meadow',
  'nectar', 'olive', 'piano', 'quartz', 'rapid', 'spark', 'tulip', 'unity',
  'velvet', 'willow', 'yodel', 'zenith', 'breeze', 'canyon', 'dragon', 'falcon'
];

/**
 * Generate a word-based passphrase (easier to type and remember than a random
 * character string, while staying strong through length).
 *
 * @param {object} opts
 * @param {number} opts.words        Number of words (clamped to [2, 12]).
 * @param {string} [opts.separator]  Word separator (default '-').
 * @param {boolean} [opts.capitalize] Capitalize the first letter of each word.
 * @param {boolean} [opts.number]    Append a random digit to one word.
 * @param {function} rng             CSPRNG filling a Uint8Array in place.
 * @returns {string} The generated passphrase.
 */
export function generatePassphrase(opts, rng) {
  const count = Math.min(12, Math.max(2, Math.floor(Number(opts.words) || 0)));
  const sep = typeof opts.separator === 'string' ? opts.separator : '-';
  const words = [];
  for (let i = 0; i < count; i++) {
    let w = WORDS[randIndex(rng, WORDS.length)];
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
    words.push(w);
  }
  if (opts.number) {
    const which = randIndex(rng, count);
    words[which] += String(randIndex(rng, 10));
  }
  return words.join(sep);
}

/** Size of the word list — exposed so callers can compute passphrase entropy. */
export const WORDLIST_SIZE = WORDS.length;

/**
 * Estimate password strength from entropy in bits. For a random string this is
 * length * log2(poolSize). Returns the bit count plus a coarse label/score that
 * the UI maps to a meter. Pass the realized pool size, not the theoretical one.
 */
export function estimateStrength(length, poolSize) {
  const bits = length > 0 && poolSize > 1 ? length * Math.log2(poolSize) : 0;
  let label, score; // score 0..4 for a 5-segment meter
  if (bits < 28) { label = 'Very weak'; score = 0; }
  else if (bits < 36) { label = 'Weak'; score = 1; }
  else if (bits < 60) { label = 'Fair'; score = 2; }
  else if (bits < 128) { label = 'Strong'; score = 3; }
  else { label = 'Very strong'; score = 4; }
  return { bits, label, score };
}
