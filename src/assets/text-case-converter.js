import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
// text-case-converter.js — convert text between cases (UPPER, lower, Title,
// Sentence, camelCase, etc.). All logic runs in the browser; nothing uploaded.

const $ = (id) => document.getElementById(id);

// Small set of words kept lowercase in Title Case (unless first/last word).
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of',
  'on', 'or', 'per', 'so', 'the', 'to', 'up', 'via', 'vs', 'yet'
]);

const upper = (s) => s.toUpperCase();
const lower = (s) => s.toLowerCase();

// Capitalize the first letter of each word; lowercase the rest.
function capitalizeEach(s) {
  return s.replace(/\b([a-zA-Z])([a-zA-Z']*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase());
}

// Title Case: capitalize each significant word; keep minor words lowercase,
// except the first and last word of the whole string.
function titleCase(s) {
  const tokens = s.split(/(\s+)/); // keep whitespace tokens so spacing is preserved
  const wordIdx = [];
  tokens.forEach((t, i) => { if (t.trim()) wordIdx.push(i); });
  const firstWord = wordIdx[0];
  const lastWord = wordIdx[wordIdx.length - 1];
  return tokens
    .map((tok, i) => {
      if (!tok.trim()) return tok;
      const lc = tok.toLowerCase();
      const isEdge = i === firstWord || i === lastWord;
      if (!isEdge && MINOR_WORDS.has(lc.replace(/[^a-z']/g, ''))) return lc;
      return lc.replace(/^([a-z])/, (m) => m.toUpperCase());
    })
    .join('');
}

// Sentence case: lowercase everything, then capitalize the first letter of each
// sentence (start of string and after . ! ?).
function sentenceCase(s) {
  const lc = s.toLowerCase();
  return lc.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (m) => m.toUpperCase());
}

// Split text into word-pieces for programmer cases. Treats spaces, underscores,
// hyphens, and camelCase boundaries as separators.
function words(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/[_\-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function camelCase(s) {
  const w = words(s);
  return w
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

function pascalCase(s) {
  return words(s).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
}

const snakeCase = (s) => words(s).map((w) => w.toLowerCase()).join('_');
const kebabCase = (s) => words(s).map((w) => w.toLowerCase()).join('-');

// Alternating case: a-B-c-D... (skips non-letters for the toggle).
function alternatingCase(s) {
  let i = 0;
  return s.replace(/[a-zA-Z]/g, (c) => {
    const out = i % 2 === 0 ? c.toLowerCase() : c.toUpperCase();
    i++;
    return out;
  });
}

// Invert the case of each letter.
const invertCase = (s) => s.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));

const TRANSFORMS = {
  upper, lower,
  capitalize: capitalizeEach,
  title: titleCase,
  sentence: sentenceCase,
  camel: camelCase,
  pascal: pascalCase,
  snake: snakeCase,
  kebab: kebabCase,
  alternating: alternatingCase,
  invert: invertCase
};

// Programmer naming styles render best in a monospace font; every other case
// (upper/lower/title/sentence/alternating/invert) is plain prose.
const CODE_STYLE_CASES = new Set(['camel', 'pascal', 'snake', 'kebab']);

let current = '';

function apply(kind) {
  const fn = TRANSFORMS[kind];
  if (!fn) return;
  const text = $('text').value;
  current = fn(text);
  $('out').value = current;
  $('out').classList.toggle('code-out', CODE_STYLE_CASES.has(kind));
  $('out').focus();
}

function counts() {
  const text = $('text').value;
  const trimmed = text.trim();
  const w = trimmed ? trimmed.split(/\s+/).length : 0;
  $('charCount').textContent = text.length.toLocaleString('en-US');
  $('wordCount').textContent = w.toLocaleString('en-US');
}

async function copyOut() {
  const val = $('out').value;
  if (!val) return;
  const btn = $('copyBtn');
  try {
    await navigator.clipboard.writeText(val);
  } catch {
    $('out').select();
    document.execCommand('copy');
  }
  const label = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = label; }, 1400);
}

function init() {
  document.querySelectorAll('[data-case]').forEach((b) => {
    b.addEventListener('click', () => apply(b.dataset.case));
  });
  $('text').addEventListener('input', counts);
  $('copyBtn').addEventListener('click', copyOut);
  $('clearBtn').addEventListener('click', () => {
    $('text').value = '';
    $('out').value = '';
    current = '';
    counts();
    $('text').focus();
  });
  counts();
}

function __bootInit() {
  try {
    init();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState !== 'loading') __bootInit();
else document.addEventListener('DOMContentLoaded', __bootInit);
