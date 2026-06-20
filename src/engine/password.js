// password.js — pure, dependency-free helpers for the password generator.
// Shared by the browser tool (password-generator.js) and the unit tests.
//
// The actual randomness lives in the browser (crypto.getRandomValues). Here we
// keep the *deterministic* parts so they can be unit-tested: building the
// character set from the toggles, scoring password strength, and a generator
// that takes an injected random function (the browser passes in a CSPRNG-backed
// one; the tests pass in a seeded one).

// Character pools, kept separate so toggles compose cleanly.
export const POOLS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/'
};

// Characters that are easy to confuse with one another. Removed when the
// "exclude ambiguous characters" toggle is on.
export const AMBIGUOUS = '0Oo1lI';

// Build the allowed character set (as a string of unique chars) from the option
// toggles. Returns '' when no pool is selected — the caller must guard on that.
//   opts = { uppercase, lowercase, numbers, symbols, excludeAmbiguous }
export function buildCharset(opts = {}) {
  let chars = '';
  if (opts.uppercase) chars += POOLS.uppercase;
  if (opts.lowercase) chars += POOLS.lowercase;
  if (opts.numbers) chars += POOLS.numbers;
  if (opts.symbols) chars += POOLS.symbols;

  if (opts.excludeAmbiguous) {
    const drop = new Set(AMBIGUOUS);
    chars = [...chars].filter((c) => !drop.has(c)).join('');
  }
  return chars;
}

// Build the selected character pools as an ARRAY of per-class strings (after
// ambiguous filtering), so the generator can guarantee at least one character
// from each chosen class. Empty pools (e.g. a class fully removed by ambiguous
// filtering) are dropped. opts shape matches buildCharset.
export function buildPools(opts = {}) {
  const drop = opts.excludeAmbiguous ? new Set(AMBIGUOUS) : null;
  const filt = (s) => (drop ? [...s].filter((c) => !drop.has(c)).join('') : s);
  const pools = [];
  if (opts.uppercase) pools.push(filt(POOLS.uppercase));
  if (opts.lowercase) pools.push(filt(POOLS.lowercase));
  if (opts.numbers) pools.push(filt(POOLS.numbers));
  if (opts.symbols) pools.push(filt(POOLS.symbols));
  return pools.filter((p) => p.length);
}

// Generate a password that is GUARANTEED to contain at least one character from
// each selected pool (when the length allows), then fills the rest from the
// combined set and shuffles (Fisher–Yates) so the seeded chars aren't front-loaded.
// Fixes the defect where a plain random draw can omit a required class and get
// rejected by sites that require e.g. a symbol. `randomInt(maxExclusive)` as elsewhere.
export function generateFromPools(pools, length, randomInt) {
  const clean = (pools || []).filter((p) => p && p.length);
  const n = Math.floor(Number(length));
  if (!clean.length || !Number.isFinite(n) || n <= 0) return '';
  const combined = clean.join('');
  const chars = [];
  const guaranteed = Math.min(clean.length, n); // can't seed more classes than the length
  for (let i = 0; i < guaranteed; i++) chars.push(clean[i][randomInt(clean[i].length)]);
  for (let i = guaranteed; i < n; i++) chars.push(combined[randomInt(combined.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = chars[i]; chars[i] = chars[j]; chars[j] = t;
  }
  return chars.join('');
}

// Shannon entropy in bits for a password drawn uniformly from a charset of
// `charsetSize` over `length` positions: length * log2(charsetSize).
export function entropyBits(charsetSize, length) {
  const c = Number(charsetSize), n = Math.floor(Number(length));
  if (!(c > 1) || !(n > 0)) return 0;
  return n * Math.log2(c);
}

// Generate a password of `length` from `charset`, drawing indices from the
// injected `randomInt(maxExclusive)` function. `randomInt` must return an
// integer in [0, maxExclusive). The browser supplies a crypto-backed,
// rejection-sampled implementation; tests supply a deterministic one.
//
// Returns '' for a non-positive length or an empty charset.
export function generatePassword(charset, length, randomInt) {
  const n = Math.floor(Number(length));
  if (!charset || !Number.isFinite(n) || n <= 0) return '';
  let out = '';
  for (let i = 0; i < n; i++) {
    const idx = randomInt(charset.length);
    out += charset[idx];
  }
  return out;
}

// Score a password's strength from its length and character variety.
// Returns { score: 0..4, label } where label is one of
// 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong'.
//
// Deliberately simple and explainable (not entropy-exact): variety is how many
// of the four character classes appear; length tiers stack with variety so a
// long, varied password scores highest.
export function passwordStrength(pw) {
  const s = typeof pw === 'string' ? pw : '';
  const len = s.length;
  if (len === 0) return { score: 0, label: 'Very weak' };

  let variety = 0;
  if (/[a-z]/.test(s)) variety++;
  if (/[A-Z]/.test(s)) variety++;
  if (/[0-9]/.test(s)) variety++;
  if (/[^a-zA-Z0-9]/.test(s)) variety++;

  // Length points: short=0, decent=1, long=2, very long=3.
  let lenPts = 0;
  if (len >= 8) lenPts = 1;
  if (len >= 12) lenPts = 2;
  if (len >= 16) lenPts = 3;

  // Combine length and variety, then map onto a 0..4 score.
  const raw = lenPts + variety; // 0..7

  let score;
  if (len < 8 || raw <= 2) score = 1;       // Weak
  else if (raw <= 3) score = 2;             // Fair
  else if (raw <= 5) score = 3;             // Strong
  else score = 4;                           // Very strong

  // A truly tiny password is "Very weak" regardless of variety.
  if (len < 6) score = 0;

  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  return { score, label: labels[score] };
}
