// tile.js — pure, dependency-free tile-quantity math.
// Shared by the browser tool (tile-calculator.js) and the unit tests.
//
// Estimates how many tiles (and boxes) you need to cover a floor or wall area.
// It computes the area to cover, divides by the area of one tile to get the raw
// tile count, adds a waste allowance for cuts and breakage, then rounds up to
// whole tiles and whole boxes.
//
// All inputs are plain numbers in the chosen unit system:
//   US:     room measured in feet, tiles measured in inches.
//   Metric: room measured in metres, tiles measured in centimetres.
// This matches how the products are actually labelled (a "12 x 12 in" tile in a
// room measured in feet; a "30 x 30 cm" tile in a room measured in metres).

export const SYSTEMS = {
  us: { lengthUnit: 'ft', tileUnit: 'in', areaUnit: 'sq ft', perUnit: 144 }, // 144 sq in per sq ft
  metric: { lengthUnit: 'm', tileUnit: 'cm', areaUnit: 'm²', perUnit: 10000 } // 10000 sq cm per m²
};

const num = (n) => {
  const v = typeof n === 'number' ? n : parseFloat(n);
  return Number.isFinite(v) ? v : 0;
};

// Floor/wall area of a rectangle, in the system's area unit (sq ft or m²).
// length and width are in the system's length unit (ft or m).
export function roomArea({ length, width } = {}) {
  const l = num(length);
  const w = num(width);
  if (l <= 0 || w <= 0) return 0;
  return l * w;
}

// Area of a single tile, converted into the room's area unit.
// tileW and tileH are in the system's tile unit (inches or centimetres);
// the result is in sq ft (US) or m² (metric) so it divides cleanly into area.
export function tileArea({ tileW, tileH, system = 'us' } = {}) {
  const cfg = SYSTEMS[system] || SYSTEMS.us;
  const w = num(tileW);
  const h = num(tileH);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / cfg.perUnit;
}

// Core estimate.
//   input: { length, width, tileW, tileH, waste, system }
//   - length, width: room dimensions (ft or m)
//   - tileW, tileH:  one tile's size (in or cm)
//   - waste:         extra percentage for cuts/breakage (default 10)
//   - perBox:        tiles per box (optional; enables box count)
// Returns:
//   { area, tileArea, baseTiles (raw, fractional), waste,
//     tilesNeeded (ceil, incl. waste), boxes (ceil or null),
//     areaUnit, lengthUnit, tileUnit }
export function estimateTiles(input = {}) {
  const system = input.system === 'metric' ? 'metric' : 'us';
  const cfg = SYSTEMS[system];

  const area = roomArea(input);
  const oneTile = tileArea({ tileW: input.tileW, tileH: input.tileH, system });

  const rawWaste = input.waste == null ? 10 : num(input.waste);
  const waste = Math.max(0, rawWaste);

  let baseTiles = 0;
  let tilesNeeded = 0;
  if (area > 0 && oneTile > 0) {
    baseTiles = area / oneTile;
    tilesNeeded = Math.ceil(round(baseTiles * (1 + waste / 100), 6));
  }

  let boxes = null;
  const perBox = num(input.perBox);
  if (tilesNeeded > 0 && perBox > 0) {
    boxes = Math.ceil(tilesNeeded / perBox);
  }

  return {
    area: round(area, 2),
    tileArea: round(oneTile, 4),
    baseTiles: round(baseTiles, 2),
    waste,
    tilesNeeded,
    boxes,
    areaUnit: cfg.areaUnit,
    lengthUnit: cfg.lengthUnit,
    tileUnit: cfg.tileUnit
  };
}

function round(n, places) {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
