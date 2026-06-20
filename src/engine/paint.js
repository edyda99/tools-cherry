// paint.js — pure, dependency-free paint-quantity math.
// Shared by the browser tool (paint-calculator.js) and the unit tests.
//
// Estimates how much paint a room needs from its wall area, minus openings
// (doors and windows), times the number of coats, divided by the coverage of
// one unit of paint (gallon or litre). Returns the paintable area and the
// quantity of paint required, in the requested unit system.
//
// All inputs are plain numbers in the chosen unit system (US: feet + gallons,
// Metric: metres + litres). No rounding bias beyond the final ceil to whole
// containers; the raw fractional amount is returned alongside so callers can
// show "2.3 gallons (buy 3)".

// Default coverage per unit of paint, per coat:
//   US: 1 gallon covers ~350 sq ft.
//   Metric: 1 litre covers ~11 sq metres (~10–12 typical).
export const COVERAGE = {
  us: { area: 350, paintUnit: 'gallon', lengthUnit: 'ft', areaUnit: 'sq ft' },
  metric: { area: 11, paintUnit: 'litre', lengthUnit: 'm', areaUnit: 'm²' }
};

// Standard opening sizes (area each) used when the user gives a count rather
// than exact dimensions. US values in sq ft, metric in m².
export const OPENINGS = {
  us: { door: 21, window: 15 }, // ~3x7 ft door, ~3x5 ft window
  metric: { door: 1.9, window: 1.4 }
};

const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

// Wall area of a rectangular room: perimeter * height.
// perimeter = 2 * (length + width).
export function wallArea({ length, width, height }) {
  const l = num(length);
  const w = num(width);
  const h = num(height);
  if (l <= 0 || w <= 0 || h <= 0) return 0;
  return 2 * (l + w) * h;
}

// Total area of openings to subtract, from counts of standard doors/windows.
export function openingsArea({ doors = 0, windows = 0, system = 'us' }) {
  const o = OPENINGS[system] || OPENINGS.us;
  return Math.max(0, num(doors)) * o.door + Math.max(0, num(windows)) * o.window;
}

// Core estimate.
//   input: { length, width, height, doors, windows, coats, coverage, system }
//   - coverage: area covered by ONE unit of paint per coat (defaults per system)
//   - coats: number of coats (defaults 2)
// Returns:
//   { paintableArea, totalArea, coats, paintNeeded (raw, fractional),
//     containers (ceil to whole units), paintUnit, areaUnit }
export function estimatePaint(input = {}) {
  const system = input.system === 'metric' ? 'metric' : 'us';
  const cfg = COVERAGE[system];
  const rawCoats = input.coats == null ? 2 : num(input.coats);
  const coats = Math.max(1, Math.round(rawCoats));
  const coverage = num(input.coverage) > 0 ? num(input.coverage) : cfg.area;

  const gross = wallArea(input);
  const open = openingsArea({ doors: input.doors, windows: input.windows, system });
  const paintable = Math.max(0, gross - open);

  const totalToCover = paintable * coats;
  const paintNeeded = totalToCover / coverage;
  const containers = paintNeeded > 0 ? Math.ceil(round(paintNeeded, 4)) : 0;

  return {
    grossWallArea: round(gross, 2),
    openingsArea: round(open, 2),
    paintableArea: round(paintable, 2),
    coats,
    coverage,
    paintNeeded: round(paintNeeded, 2),
    containers,
    paintUnit: cfg.paintUnit,
    areaUnit: cfg.areaUnit,
    lengthUnit: cfg.lengthUnit
  };
}

function round(n, places) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
