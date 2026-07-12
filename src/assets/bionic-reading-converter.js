import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
// bionic-reading-converter.js — convert text to a bionic-style "fixation" format:
// bold the leading letters of each word so the eye can skim faster. Everything
// runs in the browser; nothing is uploaded.

const $ = (id) => document.getElementById(id);

// --- Unicode Mathematical Bold maps, for plain-text "bold" that survives a paste
// into places with no rich formatting (social bios, plain-text editors). -------
function boldChar(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x41 && c <= 0x5a) return String.fromCodePoint(0x1d400 + (c - 0x41)); // A-Z
  if (c >= 0x61 && c <= 0x7a) return String.fromCodePoint(0x1d41a + (c - 0x61)); // a-z
  if (c >= 0x30 && c <= 0x39) return String.fromCodePoint(0x1d7ce + (c - 0x30)); // 0-9
  return ch;
}

const ALNUM = /[\p{L}\p{N}]/u;

function escapeHTML(s) {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// How many leading (letters/digits) of a word to emphasize, given fixation
// fraction. Short words get their first letter; longer words scale with `pct`.
function fixationLen(wordLen, pct) {
  if (wordLen <= 1) return wordLen;
  if (wordLen <= 3) return 1;
  return Math.max(1, Math.round(wordLen * pct));
}

// Core: walk each whitespace-separated token, emphasize its first N alphanumeric
// characters. `emit(kind, chars)` receives 'bold' or 'plain' runs. Whitespace
// between tokens is preserved verbatim (the container uses white-space:pre-wrap).
function transform(text, pct, minLen, emit) {
  const tokens = text.split(/(\s+)/); // keep the whitespace tokens
  for (const tok of tokens) {
    if (tok === '' ) continue;
    if (/^\s+$/.test(tok)) { emit('plain', tok); continue; }
    const wordChars = (tok.match(/[\p{L}\p{N}]/gu) || []).length;
    if (wordChars < minLen) { emit('plain', tok); continue; }
    const k = fixationLen(wordChars, pct);
    let count = 0, boldRun = '', plainRun = '';
    for (const ch of tok) {
      if (ALNUM.test(ch) && count < k) {
        if (plainRun) { emit('plain', plainRun); plainRun = ''; }
        boldRun += ch; count++;
      } else {
        if (boldRun) { emit('bold', boldRun); boldRun = ''; }
        plainRun += ch;
      }
    }
    if (boldRun) emit('bold', boldRun);
    if (plainRun) emit('plain', plainRun);
  }
}

function toHTML(text, pct, minLen) {
  let out = '';
  transform(text, pct, minLen, (kind, chars) => {
    out += kind === 'bold' ? `<b>${escapeHTML(chars)}</b>` : escapeHTML(chars);
  });
  return out;
}

function toBoldUnicode(text, pct, minLen) {
  let out = '';
  transform(text, pct, minLen, (kind, chars) => {
    out += kind === 'bold' ? [...chars].map(boldChar).join('') : chars;
  });
  return out;
}

// --- UI state --------------------------------------------------------------
function opts() {
  const pct = Number($('strength').value) / 100;
  const minLen = $('skipShort').checked ? 4 : 1;
  return { pct, minLen };
}

function render() {
  const text = $('text').value;
  const { pct, minLen } = opts();
  $('out').innerHTML = text ? toHTML(text, pct, minLen) : '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  $('wordCount').textContent = words.toLocaleString('en-US');
  $('strengthVal').textContent = Math.round(pct * 100) + '%';
}

function flash(btn, msg) {
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = label; }, 1400);
}

// Copy the rendered result as rich text (HTML) so the bold survives a paste into
// a doc/email; falls back to selecting the node and execCommand.
async function copyRich() {
  const node = $('out');
  if (!node.textContent) return;
  const btn = $('copyRichBtn');
  const html = node.innerHTML;
  const plain = node.innerText;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
    ]);
    flash(btn, 'Copied!');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    try { document.execCommand('copy'); flash(btn, 'Copied!'); } catch { flash(btn, 'Press Ctrl+C'); }
    sel.removeAllRanges();
  }
}

// Copy as Unicode-bold plain text (for places that strip formatting).
async function copyBoldText() {
  const text = $('text').value;
  if (!text) return;
  const { pct, minLen } = opts();
  const btn = $('copyBoldBtn');
  try {
    await navigator.clipboard.writeText(toBoldUnicode(text, pct, minLen));
    flash(btn, 'Copied!');
  } catch {
    flash(btn, 'Copy failed');
  }
}

function init() {
  $('text').addEventListener('input', render);
  $('strength').addEventListener('input', render);
  $('skipShort').addEventListener('change', render);
  $('copyRichBtn').addEventListener('click', copyRich);
  $('copyBoldBtn').addEventListener('click', copyBoldText);
  $('clearBtn').addEventListener('click', () => {
    $('text').value = '';
    render();
    $('text').focus();
  });
  render();
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
