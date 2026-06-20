// recipe-scale.js — pure, dependency-free recipe / ingredient scaling.
// Shared by the browser tool (recipe-scaler.js) and the unit tests.
//
// The job: take ingredient lines like "1 1/2 cups flour" and a scale factor
// (target servings ÷ original servings) and rewrite the quantity at the front
// of each line, leaving the unit + name untouched. Quantities are parsed from
// integers, decimals, vulgar fractions (½), and mixed numbers ("1 1/2"), and
// rendered back to friendly fractions so cooks get "3/4 cup", not "0.75 cup".

// Common vulgar-fraction glyphs → numeric value, so pasted recipes parse.
const VULGAR = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6
};

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Greatest common divisor (for reducing fractions).
function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

// Parse a leading quantity out of an ingredient string.
// Returns { value, rest } where `rest` is the remaining text (unit + name)
// with leading whitespace stripped, or null when no quantity is found.
// Handles: "2", "0.5", "1.5", "1/2", "1 1/2", "½", "1½", "1 ½".
export function parseQuantity(input) {
  if (typeof input !== 'string') return null;
  let s = input.replace(/^\s+/, '');

  // Leading vulgar glyph, optionally preceded by a whole number ("1½").
  const vulgarMatch = s.match(/^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])/);
  if (vulgarMatch) {
    const whole = vulgarMatch[1] ? parseInt(vulgarMatch[1], 10) : 0;
    const value = whole + VULGAR[vulgarMatch[2]];
    const rest = s.slice(vulgarMatch[0].length).replace(/^\s+/, '');
    return { value, rest };
  }

  // Mixed number or simple fraction: "1 1/2" or "3/4".
  const fracMatch = s.match(/^(\d+)\s+(\d+)\/(\d+)/) || s.match(/^()(\d+)\/(\d+)/);
  if (fracMatch) {
    const whole = fracMatch[1] ? parseInt(fracMatch[1], 10) : 0;
    const numr = parseInt(fracMatch[2], 10);
    const den = parseInt(fracMatch[3], 10);
    if (den === 0) return null;
    const rest = s.slice(fracMatch[0].length).replace(/^\s+/, '');
    return { value: whole + numr / den, rest };
  }

  // Plain integer or decimal.
  const numMatch = s.match(/^(\d+(?:\.\d+)?|\.\d+)/);
  if (numMatch) {
    const value = parseFloat(numMatch[1]);
    const rest = s.slice(numMatch[0].length).replace(/^\s+/, '');
    return { value, rest };
  }

  return null;
}

// Render a number as a cook-friendly string: a whole number, or a mixed number
// with the fraction snapped to a common kitchen denominator (halves, thirds,
// quarters, eighths) so 0.333… → "1/3" and 1.5 → "1 1/2".
export function formatQuantity(value) {
  if (!isFiniteNum(value) || value < 0) return '';
  if (value === 0) return '0';

  const whole = Math.floor(value);
  let frac = value - whole;

  // Snap to the nearest 1/24 — the LCM of 2, 3, 4, 6, 8 — then reduce. This
  // resolves repeating decimals (1/3, 2/3, 1/6) and the usual cup fractions
  // cleanly without dragging in odd denominators.
  const DEN = 24;
  let numr = Math.round(frac * DEN);

  if (numr === 0) return String(whole);
  if (numr === DEN) return String(whole + 1); // rounded up to the next whole

  const g = gcd(numr, DEN);
  numr /= g;
  const den = DEN / g;
  const fracStr = `${numr}/${den}`;
  return whole > 0 ? `${whole} ${fracStr}` : fracStr;
}

// Scale a single ingredient line by `factor`. If a leading quantity is found it
// is multiplied and re-rendered; otherwise the line is returned unchanged (so
// instructions like "a pinch of salt" survive). Returns the rewritten string.
export function scaleLine(line, factor) {
  if (typeof line !== 'string') return '';
  if (!isFiniteNum(factor) || factor <= 0) return line;
  const trimmed = line.trim();
  if (!trimmed) return '';

  const parsed = parseQuantity(trimmed);
  if (!parsed) return trimmed; // no quantity → leave as-is

  const scaled = parsed.value * factor;
  const qtyStr = formatQuantity(scaled);
  return parsed.rest ? `${qtyStr} ${parsed.rest}` : qtyStr;
}

// Scale a whole multi-line ingredient list. Blank lines are preserved so the
// layout the user pasted is kept. Returns the rewritten block as a string.
export function scaleRecipe(text, factor) {
  if (typeof text !== 'string') return '';
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : scaleLine(line, factor)))
    .join('\n');
}

// Scale factor from original → target servings. Returns NaN for invalid input
// (non-positive or non-finite), which the UI is responsible for hiding.
export function scaleFactor(fromServings, toServings) {
  const a = Number(fromServings);
  const b = Number(toServings);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return NaN;
  return b / a;
}
