// morse.js — pure, dependency-free Morse code translation.
// Shared by the browser tool (morse-code-translator.js) and the unit tests.
//
// Encoding rules used here (International Morse):
//   - letters within a word are separated by a single space
//   - words are separated by " / "
// Decoding accepts either " / " or a bare "/" as the word separator and is
// tolerant of extra whitespace.

export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.',
  H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.',
  O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-',
  V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.'
};

// Reverse lookup: code -> character.
const FROM_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

// Convert plain text to Morse. Unknown characters are dropped. Returns ''.
export function textToMorse(text) {
  if (typeof text !== 'string') return '';
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  return words
    .map((word) =>
      [...word]
        .map((ch) => MORSE[ch] || '')
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(' / ');
}

// Convert Morse to plain text. Unknown codes become '?'. Returns ''.
export function morseToText(morse) {
  if (typeof morse !== 'string') return '';
  const trimmed = morse.trim();
  if (!trimmed) return '';
  // Split into words on "/" (with optional surrounding spaces).
  const words = trimmed.split(/\s*\/\s*/);
  return words
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((code) => FROM_MORSE[code] || '?')
        .join('')
    )
    .join(' ')
    .trim();
}
