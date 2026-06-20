// units.js — pure, dependency-free general-purpose unit conversions.
// Shared by the browser tool (unit-converter.js) and the unit tests.
//
// Each category (except temperature) is a factor table: every unit's value is
// how many BASE units it represents. To convert: value × from-factor ÷ to-factor.
// Temperature isn't a simple ratio (it has an offset), so it uses formulas via
// a common base of Celsius. Digital storage uses 1024-based (binary) steps.

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// --- Length: base unit = metre (m) -----------------------------------------
export const LENGTH = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  inch: 0.0254, // exact
  foot: 0.3048, // exact (12 inches)
  yard: 0.9144, // exact (3 feet)
  mile: 1609.344 // exact (1760 yards)
};

// --- Weight / mass: base unit = gram (g) -----------------------------------
export const WEIGHT = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  tonne: 1000000, // metric tonne
  ounce: 28.349523125, // exact (avoirdupois)
  pound: 453.59237, // exact
  stone: 6350.29318 // exact (14 pounds)
};

// --- Speed: base unit = metre per second (m/s) -----------------------------
export const SPEED = {
  'm/s': 1,
  'km/h': 1000 / 3600, // 0.2777…
  mph: 1609.344 / 3600, // 0.44704 exact
  knot: 1852 / 3600 // 1 nautical mile per hour
};

// --- Area: base unit = square metre (m²) -----------------------------------
export const AREA = {
  'sq meter': 1,
  'sq km': 1000000,
  'sq foot': 0.09290304, // exact (0.3048²)
  'sq mile': 2589988.110336, // exact (1609.344²)
  acre: 4046.8564224, // exact
  hectare: 10000
};

// --- Digital storage: base unit = byte (B), 1024-based (binary) -------------
export const DIGITAL = {
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4
};

// Human labels for the UI dropdowns (per category).
export const LABELS = {
  // length
  mm: 'millimetre (mm)',
  cm: 'centimetre (cm)',
  m: 'metre (m)',
  km: 'kilometre (km)',
  inch: 'inch',
  foot: 'foot',
  yard: 'yard',
  mile: 'mile',
  // weight (g/kg labels are distinct from length's m/km)
  mg: 'milligram (mg)',
  g: 'gram (g)',
  kg: 'kilogram (kg)',
  tonne: 'tonne (metric)',
  ounce: 'ounce (oz)',
  pound: 'pound (lb)',
  stone: 'stone',
  // temperature
  celsius: 'Celsius (°C)',
  fahrenheit: 'Fahrenheit (°F)',
  kelvin: 'Kelvin (K)',
  // speed
  'm/s': 'metres per second (m/s)',
  'km/h': 'kilometres per hour (km/h)',
  mph: 'miles per hour (mph)',
  knot: 'knot',
  // area
  'sq meter': 'square metre (m²)',
  'sq km': 'square kilometre (km²)',
  'sq foot': 'square foot (ft²)',
  'sq mile': 'square mile (mi²)',
  acre: 'acre',
  hectare: 'hectare',
  // digital (1024-based)
  KB: 'kilobyte (KB)',
  MB: 'megabyte (MB)',
  GB: 'gigabyte (GB)',
  TB: 'terabyte (TB)'
};

const FACTORS = {
  length: LENGTH,
  weight: WEIGHT,
  speed: SPEED,
  area: AREA,
  digital: DIGITAL
};

// Ordered unit lists per category, for building dropdowns predictably.
export const UNITS = {
  length: Object.keys(LENGTH),
  weight: Object.keys(WEIGHT),
  temperature: ['celsius', 'fahrenheit', 'kelvin'],
  speed: Object.keys(SPEED),
  area: Object.keys(AREA),
  digital: Object.keys(DIGITAL)
};

// --- Temperature ------------------------------------------------------------
// Convert any temperature unit to Celsius (common base), then back out.
function toCelsius(v, unit) {
  if (unit === 'celsius') return v;
  if (unit === 'fahrenheit') return ((v - 32) * 5) / 9;
  if (unit === 'kelvin') return v - 273.15;
  return NaN;
}

function fromCelsius(c, unit) {
  if (unit === 'celsius') return c;
  if (unit === 'fahrenheit') return (c * 9) / 5 + 32;
  if (unit === 'kelvin') return c + 273.15;
  return NaN;
}

function convertTemperature(value, fromUnit, toUnit) {
  const c = toCelsius(value, fromUnit);
  if (!Number.isFinite(c)) return NaN;
  return fromCelsius(c, toUnit);
}

// Convert `value` from `fromUnit` to `toUnit` within `category`.
// Returns NaN for bad input, unknown category, or unknown units — the UI hides NaN.
export function convert(category, fromUnit, toUnit, value) {
  const a = num(value);
  if (!Number.isFinite(a)) return NaN;

  if (category === 'temperature') {
    return convertTemperature(a, fromUnit, toUnit);
  }

  const table = FACTORS[category];
  if (!table) return NaN;
  const from = table[fromUnit];
  const to = table[toUnit];
  if (!Number.isFinite(from) || !Number.isFinite(to)) return NaN;
  return (a * from) / to;
}
