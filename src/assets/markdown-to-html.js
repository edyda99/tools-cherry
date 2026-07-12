import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
// markdown-to-html.js — live Markdown -> HTML converter. Two panes: a markdown
// input and a rendered preview, plus a copyable HTML source view and a download.
// Uses the locally-vendored `marked` library (global `marked`, loaded before us).
// 100% client-side. Nothing typed is ever uploaded.

const $ = (id) => document.getElementById(id);

// marked is loaded via a classic <script> before this module, so the global is
// available. Configure it conservatively for untrusted input.
const md = (window.marked && window.marked.marked) ? window.marked.marked : window.marked;

// marked v4+ does NOT execute scripts and escapes raw HTML attributes poorly only
// if you ask it to keep raw HTML. We render with the defaults (GitHub-flavored,
// line breaks off) but then sanitize the OUTPUT to strip script/style/event
// handlers, so pasting hostile markdown can't run code in the preview.
function configure() {
  if (md && typeof md.setOptions === 'function') {
    md.setOptions({ gfm: true, breaks: false, headerIds: false, mangle: false });
  }
}

// Defense-in-depth: parse marked's HTML output in a detached document and remove
// anything executable before we show it. The preview is same-origin, so this
// keeps pasted markdown from running scripts or loading tracking pixels we don't
// want. (We are not rendering arbitrary third-party content, but treating input
// as untrusted is the right default.)
function sanitize(html) {
  const doc = document.implementation.createHTMLDocument('preview');
  doc.body.innerHTML = html;
  // Drop dangerous elements outright.
  doc.body.querySelectorAll('script, style, iframe, object, embed, link, meta')
    .forEach((el) => el.remove());
  // Strip event handlers and javascript: URLs from everything that remains.
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

function render() {
  const src = $('mdInput').value;
  let html = '';
  try {
    html = md ? md.parse(src) : '';
  } catch (_) {
    html = '';
  }
  const clean = sanitize(html);
  $('preview').innerHTML = clean;
  $('htmlSource').value = clean.trim();
  $('copyStatus').textContent = '';
}

async function copySource() {
  const text = $('htmlSource').value;
  const btn = $('copyBtn');
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    // Fallback: select the textarea so the user can copy manually.
    $('htmlSource').focus();
    $('htmlSource').select();
  }
  btn.classList.add('copied');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'Copy HTML source'; }, 1400);
}

function downloadHtml() {
  const body = $('htmlSource').value;
  const doc =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>Converted document</title>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
  const blob = new Blob([doc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'document.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function init() {
  configure();
  $('mdInput').addEventListener('input', render);
  $('copyBtn').addEventListener('click', copySource);
  $('dlBtn').addEventListener('click', downloadHtml);
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
