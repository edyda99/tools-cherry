// fuel-economy.js — pure, dependency-free fuel-economy math.
// Shared by the browser tool (fuel-economy-calculator.js) and the unit tests.
// Computes how efficient a vehicle is FROM a measured distance + fuel used
// (this is distinct from the gas-cost trip planner, which takes MPG as input).
// Functions return finite numbers, or NaN when an input is not a usable
// positive value (the UI is responsible for hiding NaN).

const pos = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

// Exact unit constants.
const KM_PER_MILE = 1.609344;       // 1 mile = 1.609344 km
const LITRES_PER_US_GALLON = 3.785411784;
const LITRES_PER_UK_GALLON = 4.54609;

// Compute fuel economy from a measured distance and the fuel used to cover it.
//   distance — distance travelled (in `distUnit`)
//   fuel     — fuel consumed (in `fuelUnit`)
//   distUnit — 'mi' | 'km'         (default 'mi')
//   fuelUnit — 'us' | 'uk' | 'l'   US gallons / UK gallons / litres (default 'us')
//
// Returns an object of equivalent figures, every field NaN on bad input:
//   mpgUs     — US miles per gallon
//   mpgUk     — UK (imperial) miles per gallon
//   kmPerL    — kilometres per litre
//   l100km    — litres per 100 km (lower is better)
//
// e.g. fuelEconomy({ distance: 300, fuel: 10, distUnit: 'mi', fuelUnit: 'us' })
//        -> mpgUs 30, l100km ≈ 7.84
export function fuelEconomy({ distance, fuel, distUnit = 'mi', fuelUnit = 'us' } = {}) {
  const d = pos(distance);
  const f = pos(fuel);
  const nan = { mpgUs: NaN, mpgUk: NaN, kmPerL: NaN, l100km: NaN };
  if (Number.isNaN(d) || Number.isNaN(f)) return nan;

  // Normalise to a common base: miles and US gallons.
  const miles = distUnit === 'km' ? d / KM_PER_MILE : d;
  let usGal;
  if (fuelUnit === 'l') usGal = f / LITRES_PER_US_GALLON;
  else if (fuelUnit === 'uk') usGal = (f * LITRES_PER_UK_GALLON) / LITRES_PER_US_GALLON;
  else usGal = f; // 'us'

  const km = miles * KM_PER_MILE;
  const litres = usGal * LITRES_PER_US_GALLON;

  const mpgUs = miles / usGal;
  const mpgUk = miles / (litres / LITRES_PER_UK_GALLON);
  const kmPerL = km / litres;
  const l100km = (litres / km) * 100;

  return { mpgUs, mpgUk, kmPerL, l100km };
}

// Convert a single economy figure between the common units. Useful for the
// "convert MPG ↔ L/100km" mode (no trip measurement, just a unit swap).
//   value — the number to convert
//   from  — 'mpgUs' | 'mpgUk' | 'kmPerL' | 'l100km'
// Returns the same { mpgUs, mpgUk, kmPerL, l100km } shape.
export function convertEconomy(value, from = 'mpgUs') {
  const v = pos(value);
  const nan = { mpgUs: NaN, mpgUk: NaN, kmPerL: NaN, l100km: NaN };
  if (Number.isNaN(v)) return nan;

  // Reduce everything to a canonical km-per-litre, then re-expand.
  let kmPerL;
  if (from === 'mpgUs') {
    kmPerL = (v * KM_PER_MILE) / LITRES_PER_US_GALLON;
  } else if (from === 'mpgUk') {
    kmPerL = (v * KM_PER_MILE) / LITRES_PER_UK_GALLON;
  } else if (from === 'kmPerL') {
    kmPerL = v;
  } else if (from === 'l100km') {
    kmPerL = 100 / v; // litres per 100km -> km per litre
  } else {
    return nan;
  }

  const mpgUs = (kmPerL * LITRES_PER_US_GALLON) / KM_PER_MILE;
  const mpgUk = (kmPerL * LITRES_PER_UK_GALLON) / KM_PER_MILE;
  const l100km = 100 / kmPerL;
  return { mpgUs, mpgUk, kmPerL, l100km };
}
