// color-converter.js — two-way HEX / RGB / HSL color converter. All logic runs
// in the browser via the pure color engine; nothing is uploaded.

import { parseHex, rgbToHex, rgbToHsl, hslToRgb } from '/assets/color.js';

const $ = (id) => document.getElementById(id);

// Currently displayed color, kept as canonical RGB so every field derives from
// one source of truth and updates stay consistent.
let rgb = { r: 30, g: 144, b: 255 };

function setError(msg) {
  const el = $('error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

// Render every field + the swatch from the current `rgb`. `skip` is the id of
// the field the user is editing, so we don't overwrite what they're typing.
function render(skip) {
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  if (skip !== 'hex') $('hex').value = hex;
  if (skip !== 'rgb') {
    $('r').value = rgb.r;
    $('g').value = rgb.g;
    $('b').value = rgb.b;
  }
  if (skip !== 'hsl') {
    $('h').value = hsl.h;
    $('s').value = hsl.s;
    $('l').value = hsl.l;
  }

  $('swatch').style.background = hex;
  $('cssHex').textContent = hex;
  $('cssRgb').textContent = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  $('cssHsl').textContent = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  if ($('picker').value.toLowerCase() !== hex) $('picker').value = hex;
}

function fromHex() {
  try {
    rgb = parseHex($('hex').value);
    setError('');
    render('hex');
  } catch (e) {
    setError(e.message);
  }
}

function readByte(id) {
  const n = parseInt($(id).value, 10);
  if (Number.isNaN(n) || n < 0 || n > 255) throw new Error('RGB values must be whole numbers from 0 to 255.');
  return n;
}

function fromRgb() {
  try {
    rgb = { r: readByte('r'), g: readByte('g'), b: readByte('b') };
    setError('');
    render('rgb');
  } catch (e) {
    setError(e.message);
  }
}

function fromHsl() {
  try {
    const h = parseInt($('h').value, 10);
    const s = parseInt($('s').value, 10);
    const l = parseInt($('l').value, 10);
    if ([h, s, l].some(Number.isNaN)) throw new Error('Enter whole numbers for hue, saturation and lightness.');
    if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) {
      throw new Error('Hue is 0–360, saturation and lightness are 0–100.');
    }
    rgb = hslToRgb(h, s, l);
    setError('');
    render('hsl');
  } catch (e) {
    setError(e.message);
  }
}

function fromPicker() {
  rgb = parseHex($('picker').value);
  setError('');
  render('picker');
}

function copy(text, btn) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {});
  const label = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = label; }, 1200);
}

function init() {
  $('hex').addEventListener('input', fromHex);
  ['r', 'g', 'b'].forEach((id) => $(id).addEventListener('input', fromRgb));
  ['h', 's', 'l'].forEach((id) => $(id).addEventListener('input', fromHsl));
  $('picker').addEventListener('input', fromPicker);

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => copy($(btn.dataset.copy).textContent, btn));
  });

  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
