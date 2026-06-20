// base64.js — pure, dependency-free Base64 encode/decode with full UTF-8 support.
// Shared by the browser tool (base64-converter.js) and the unit tests.
//
// encodeBase64(text, { urlSafe }) -> Base64 string for any Unicode text.
// decodeBase64(b64,  { urlSafe }) -> the original UTF-8 text.
//                                    Throws Error on malformed input.
//
// Standard btoa/atob only operate on Latin-1, so they break on emoji and most
// non-ASCII text. We round-trip through UTF-8 bytes (TextEncoder/TextDecoder)
// so any string — Arabic, Chinese, emoji — encodes and decodes correctly.
//
// Works in the browser (global btoa/atob, TextEncoder/TextDecoder) and in
// Node 18+ (same globals), so the same module powers the UI and the tests.

const STD_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;
const URLSAFE_ALPHABET = /^[A-Za-z0-9\-_]*={0,2}$/;

// Convert a byte array to a binary (Latin-1) string for btoa, in chunks so we
// never blow the argument limit on String.fromCharCode for large inputs.
function bytesToBinary(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return bin;
}

export function encodeBase64(text, opts = {}) {
  if (typeof text !== 'string') throw new Error('Enter some text to encode.');
  const bytes = new TextEncoder().encode(text);
  let b64 = btoa(bytesToBinary(bytes));
  if (opts.urlSafe) {
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return b64;
}

export function decodeBase64(b64, opts = {}) {
  if (typeof b64 !== 'string') throw new Error('Enter Base64 text to decode.');
  let str = b64.trim().replace(/\s+/g, '');
  if (!str) throw new Error('Enter Base64 text to decode.');

  if (opts.urlSafe) {
    if (!URLSAFE_ALPHABET.test(str)) {
      throw new Error('That is not valid URL-safe Base64.');
    }
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    // Restore the padding btoa would have produced.
    const pad = str.length % 4;
    if (pad) str += '='.repeat(4 - pad);
  } else if (!STD_ALPHABET.test(str)) {
    throw new Error('That is not valid Base64.');
  }

  let binary;
  try {
    binary = atob(str);
  } catch {
    throw new Error('That is not valid Base64.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  try {
    // fatal: reject byte sequences that aren't valid UTF-8.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Decoded data is not valid UTF-8 text.');
  }
}
