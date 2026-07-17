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

export function initMoneyInputs(root = document) {
  root.querySelectorAll('input[data-money]').forEach((el) => {
    if (el.dataset.moneyBound) return;
    el.dataset.moneyBound = '1';
    // Normalise any server-rendered default value on load.
    if (el.value) el.value = formatMoney(el.value);
    el.addEventListener('input', () => handleInput(el));
  });
}

export const moneyValue = (el) => {
  const v = parseFloat(String(el.value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(v) ? v : 0;
};
