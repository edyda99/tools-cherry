// cooking-units.js — pure, dependency-free kitchen measurement conversions.
// Shared by the browser tool (cooking-converter.js) and the unit tests.
//
// Volume↔volume and weight↔weight are EXACT (factors relative to a base unit
// per category). Oven temperature uses the F↔C formulas. We never convert
// volume→weight automatically — that needs an ingredient density, which is
// approximate; the density helper below is clearly labelled as such.

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// --- Volume: base unit = millilitre (mL) -----------------------------------
// US customary volume units (the ones home cooks search for).
export const VOLUME = {
  teaspoon: 4.92892159375,
  tablespoon: 14.78676478125, // = 3 teaspoons exactly
  'fluid-ounce': 29.5735295625,
  cup: 236.5882365, // US legal/customary cup
  pint: 473.176473,
  quart: 946.352946,
  gallon: 3785.411784,
  millilitre: 1,
  litre: 1000
};

// --- Weight: base unit = gram (g) ------------------------------------------
export const WEIGHT = {
  ounce: 28.349523125,
  pound: 453.59237,
  gram: 1,
  kilogram: 1000
};

// Human labels for the UI (singular noun, plural shown by the UI as needed).
export const LABELS = {
  teaspoon: 'teaspoon',
  tablespoon: 'tablespoon',
  cup: 'cup',
  'fluid-ounce': 'fluid ounce',
  pint: 'pint',
  quart: 'quart',
  gallon: 'gallon',
  millilitre: 'millilitre (ml)',
  litre: 'litre (l)',
  ounce: 'ounce',
  pound: 'pound',
  gram: 'gram',
  kilogram: 'kilogram'
};

const FACTORS = { volume: VOLUME, weight: WEIGHT };

// Convert an amount between two units of the SAME category (volume or weight).
// Returns NaN for bad input or unknown units — the UI hides NaN.
export function convert(amount, fromUnit, toUnit, category) {
  const table = FACTORS[category];
  if (!table) return NaN;
  const a = num(amount);
  const from = table[fromUnit];
  const to = table[toUnit];
  if (!Number.isFinite(a) || !from || !to) return NaN;
  return (a * from) / to;
}

// Oven temperature -----------------------------------------------------------
// Exact linear formulas; no rounding here (the UI rounds for display).
export function fahrenheitToCelsius(f) {
  const v = num(f);
  return ((v - 32) * 5) / 9;
}

export function celsiusToFahrenheit(c) {
  const v = num(c);
  return (v * 9) / 5 + 32;
}

// Approximate gas mark for a given Celsius oven temperature, or '' if it's
// outside the common gas-mark range. Used for prose/helper only.
const GAS_MARKS = [
  { mark: '1/4', c: 120 },
  { mark: '1/2', c: 130 },
  { mark: '1', c: 140 },
  { mark: '2', c: 150 },
  { mark: '3', c: 170 },
  { mark: '4', c: 180 },
  { mark: '5', c: 190 },
  { mark: '6', c: 200 },
  { mark: '7', c: 220 },
  { mark: '8', c: 230 },
  { mark: '9', c: 240 }
];

export function gasMarkForCelsius(c) {
  const v = num(c);
  if (!Number.isFinite(v)) return '';
  // Nearest gas mark within 8°C, else blank (don't pretend precision).
  let best = null;
  let bestDiff = Infinity;
  for (const g of GAS_MARKS) {
    const d = Math.abs(g.c - v);
    if (d < bestDiff) {
      bestDiff = d;
      best = g.mark;
    }
  }
  return bestDiff <= 8 ? best : '';
}

// Recipe scaler --------------------------------------------------------------
// Scale an amount by a multiplier (e.g. 0.5, 2, 3) or by a servings ratio.
export function scaleAmount(amount, multiplier) {
  const a = num(amount);
  const m = num(multiplier);
  return a * m;
}

// Multiplier from desired servings ÷ original servings. NaN if original is 0.
export function servingsMultiplier(originalServings, desiredServings) {
  const o = num(originalServings);
  const d = num(desiredServings);
  if (o === 0) return NaN;
  return d / o;
}

// --- Approximate ingredient density helper (volume → weight) ---------------
// Grams per ONE US cup for common dry/wet ingredients. APPROXIMATE — real
// weight varies with how the ingredient is packed, humidity, and brand. The UI
// must label any volume→weight result as approximate.
export const DENSITY_G_PER_CUP = {
  water: 236.6,
  'all-purpose flour': 120,
  'granulated sugar': 200,
  butter: 227,
  milk: 244,
  'brown sugar (packed)': 220,
  honey: 340
};

// Approximate grams for a volume (in any volume unit) of a known ingredient.
// Returns NaN for unknown ingredient or bad input.
export function volumeToGramsApprox(amount, volumeUnit, ingredient) {
  const cups = convert(amount, volumeUnit, 'cup', 'volume');
  const gPerCup = DENSITY_G_PER_CUP[ingredient];
  if (!Number.isFinite(cups) || !Number.isFinite(gPerCup)) return NaN;
  return cups * gPerCup;
}
