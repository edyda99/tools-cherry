// uuid.js — pure, dependency-free UUID (v4) generation, formatting and validation.
// Shared by the browser tool (uuid-generator.js) and the unit tests.
//
// uuidV4(rng?)            -> a random RFC 4122 version-4 UUID string
// generateMany(n, opts)   -> array of n formatted UUIDs
// formatUuid(uuid, opts)  -> apply uppercase / hyphenless / braces formatting
// isValidUuid(text)       -> true when text is a canonical 8-4-4-4-12 hex UUID
// NIL_UUID                -> the all-zero UUID
//
// Randomness: by default we use crypto.getRandomValues (browser + Node 19+).
// A custom rng (a function filling a Uint8Array) can be injected for testing.

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const HEX = '0123456789abcdef';
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Default randomness source: fills a Uint8Array with cryptographically strong bytes.
function defaultRng(bytes) {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
    return bytes;
  }
  throw new Error('No cryptographic RNG available (crypto.getRandomValues missing).');
}

function bytesToUuid(b) {
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += HEX[b[i] >> 4] + HEX[b[i] & 0x0f];
    if (i === 3 || i === 5 || i === 7 || i === 9) s += '-';
  }
  return s;
}

// Generate one RFC 4122 version-4 UUID (lowercase, canonical 8-4-4-4-12 form).
export function uuidV4(rng = defaultRng) {
  const b = new Uint8Array(16);
  rng(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 1 (RFC 4122)
  return bytesToUuid(b);
}

// True when text is a syntactically valid canonical UUID (any version).
export function isValidUuid(text) {
  return typeof text === 'string' && UUID_RE.test(text.trim());
}

// Apply display formatting to a canonical lowercase UUID.
//   opts.uppercase  -> A-F instead of a-f
//   opts.hyphens=false -> strip the dashes (32-char form)
//   opts.braces     -> wrap in { }
export function formatUuid(uuid, opts = {}) {
  let out = uuid;
  if (opts.hyphens === false) out = out.replace(/-/g, '');
  if (opts.uppercase) out = out.toUpperCase();
  if (opts.braces) out = '{' + out + '}';
  return out;
}

// Generate n formatted v4 UUIDs. n is clamped to [1, 1000].
export function generateMany(n, opts = {}, rng = defaultRng) {
  const count = Math.max(1, Math.min(1000, Math.floor(Number(n) || 1)));
  const out = [];
  for (let i = 0; i < count; i++) out.push(formatUuid(uuidV4(rng), opts));
  return out;
}
