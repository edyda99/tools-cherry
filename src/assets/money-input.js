// money-input.js — live thousands separators for money fields.
// Usage: <input type="text" inputmode="decimal" data-money>, then call
// initMoneyInputs() once, and read numeric values via moneyValue(el).
// Dependency-free. Reformats on each 'input' and restores the caret by
// counting the digits to the left of the caret, so typing feels natural.

// Format the integer part with en-US thousands separators, keeping at most
// one decimal point and whatever fractional digits the user has typed.
function formatMoney(raw) {
  // Keep digits and a single decimal point; drop everything else.
  let cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    // Remove any decimal points after the first one.
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  if (cleaned === '' || cleaned === '.') return cleaned;
  const [intPart, ...rest] = cleaned.split('.');
  const grouped = intPart === '' ? '' : Number(intPart).toLocaleString('en-US');
  return rest.length ? `${grouped}.${rest[0]}` : grouped;
}

function handleInput(el) {
  const before = el.value;
  const caret = el.selectionStart ?? before.length;
  // Count how many digits sit to the left of the caret before reformatting.
  const digitsLeft = before.slice(0, caret).replace(/[^0-9]/g, '').length;

  const formatted = formatMoney(before);
  if (formatted === before) return;
  el.value = formatted;

  // Walk the new string to the position just after the same number of digits.
  let seen = 0;
  let pos = formatted.length;
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9]/.test(formatted[i])) {
      seen++;
      if (seen === digitsLeft) { pos = i + 1; break; }
    }
  }
  if (digitsLeft === 0) pos = 0;
  try { el.setSelectionRange(pos, pos); } catch (_) { /* non-text inputs */ }
}

// A money field holds exactly one number, so the first tap into it should
// REPLACE what is there, not add to it. This is a correctness fix, not a
// nicety: on a phone, tapping the middle of a pre-filled "75,000" and typing
// 60000 produced "75,00060000", which formatMoney above then happily rendered
// as "$7,500,060,000", a silent 100,000x error the visitor has no reason to
// suspect, on pages whose entire output is a dollar figure.
//
// Why not the one-liner `el.addEventListener('focus', () => el.select())`:
// focus fires BEFORE mouseup (and before the tap's caret placement), and the
// browser then collapses the selection to the point that was clicked, undoing
// it. So the selection is made on focus (which is what keyboard Tab needs) and
// re-made on the first click after focus (which is what mouse and touch need).
//
// Three guards keep it from taking editing away from anyone who wants it:
//   - the re-select runs only for a pointer that ENTERS the field. pointerdown
//     fires before focus, so activeElement at that moment distinguishes "tapping
//     in" from "moving the caret inside a field I am already editing". A second
//     tap therefore places the caret exactly where it was tapped, which is what
//     someone correcting one digit expects;
//   - only when the selection came back COLLAPSED, so deliberately dragging
//     across part of the number is preserved;
//   - and it is one shot per entry, cleared on click and on blur.
// A browser without Pointer Events simply falls back to the focus-only
// behaviour, which is no worse than not having this at all.
function bindSelectOnFocus(el) {
  let enteringTap = false;
  const selectAll = () => {
    try { el.setSelectionRange(0, el.value.length); } catch (_) { /* non-text inputs */ }
  };
  el.addEventListener('pointerdown', () => { enteringTap = document.activeElement !== el; });
  el.addEventListener('focus', selectAll);
  el.addEventListener('click', () => {
    if (!enteringTap) return;
    enteringTap = false;
    if (el.selectionStart === el.selectionEnd) selectAll();
  });
  el.addEventListener('blur', () => { enteringTap = false; });
}

export function initMoneyInputs(root = document) {
  root.querySelectorAll('input[data-money]').forEach((el) => {
    if (el.dataset.moneyBound) return;
    el.dataset.moneyBound = '1';
    // Normalise any server-rendered default value on load. An empty field stays
    // empty: a placeholder="0" default must not become a typed-looking "0".
    if (el.value) el.value = formatMoney(el.value);
    el.addEventListener('input', () => handleInput(el));
    bindSelectOnFocus(el);
  });
}

export const moneyValue = (el) => {
  const v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
