// random-number.js — pure, dependency-free helpers for the random number generator.
// Shared by the browser tool (random-number-generator.js) and the unit tests.
//
// The actual entropy lives in the browser (crypto.getRandomValues). Here we keep
// the *deterministic* parts so they can be unit-tested: validating/normalizing the
// range, unbiased integer selection in a range (rejection sampling), and drawing
// a set of unique numbers. Every generator takes an injected random function —
// the browser passes a CSPRNG-backed one, the tests pass a seeded/deterministic
// one — so behaviour is fully testable without real randomness.

// A randomFn must return a float in [0, 1). Math.random has this shape; the
// browser tool wraps crypto.getRandomValues to match it.

// Normalize a min/max pair: coerce to integers, and swap so min <= max.
// Returns { min, max, ok }. ok is false when either bound is not a finite number.
export function normalizeRange(min, max) {
  const a = toInt(min);
  const b = toInt(max);
  if (a === null || b === null) return { min: NaN, max: NaN, ok: false };
  return a <= b ? { min: a, max: b, ok: true } : { min: b, max: a, ok: true };
}

function toInt(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

// Count of distinct integers in an inclusive [min, max] range.
export function rangeSize(min, max) {
  const r = normalizeRange(min, max);
  if (!r.ok) return 0;
  return r.max - r.min + 1;
}

// One unbiased integer in the inclusive range [min, max], using rejection
// sampling so every value is equally likely (avoids the modulo bias you'd get
// from a naive floor(rand * size) when the RNG buckets unevenly). randomFn must
// return a float in [0, 1). Returns NaN for an invalid range.
export function randomInt(min, max, randomFn = Math.random) {
  const r = normalizeRange(min, max);
  if (!r.ok) return NaN;
  const size = r.max - r.min + 1;
  if (size <= 1) return r.min;
  // Rejection: reample the rare case where randomFn returns exactly 1-epsilon
  // edge that would round to size. floor keeps it in [0, size-1] for [0,1).
  let pick;
  do {
    pick = Math.floor(randomFn() * size);
  } while (pick >= size);
  return r.min + pick;
}

// `count` integers in [min, max]. When unique is true the draws are distinct
// (a partial Fisher–Yates over the range, so it's unbiased and never loops
// forever); count is clamped to the range size. When unique is false the draws
// are independent (repeats allowed). Returns an array (possibly empty).
export function randomInts(min, max, count, { unique = false, randomFn = Math.random } = {}) {
  const r = normalizeRange(min, max);
  const n = toInt(count);
  if (!r.ok || n === null || n <= 0) return [];

  if (!unique) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(randomInt(r.min, r.max, randomFn));
    return out;
  }

  const size = r.max - r.min + 1;
  const k = Math.min(n, size);
  // Partial Fisher–Yates: build the pool lazily via a swap map so we don't
  // allocate the whole range when it's huge and k is small.
  const swap = new Map();
  const at = (i) => (swap.has(i) ? swap.get(i) : i);
  const out = [];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(randomFn() * (size - i));
    out.push(r.min + at(j));
    swap.set(j, at(i));
  }
  return out;
}
