// fuel-cost.js — pure gas / fuel trip-cost math (its only import is the unit
// conversion in fuel-economy.js, so the two pages convert identically).
// Shared by the browser tool (gas-cost-calculator.js), the build-time copy
// (src/content/gas-cost-blocks.js) and the unit tests.
// fuelCost() returns finite numbers, or NaN fields when an input is not a
// usable finite number (the UI is responsible for hiding NaN).
import { convertEconomy } from './fuel-economy.js';

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

// Exact unit constants (NIST Handbook 44, Appendix C), the same ones
// fuel-economy.js uses.
export const KM_PER_MILE = 1.609344;
export const LITRES_PER_US_GALLON = 3.785411784;

// Plan the fuel cost of a trip.
//   distance        — one-way trip distance in miles
//   mpg             — vehicle fuel efficiency in miles per gallon (> 0)
//   pricePerGallon  — gas price in dollars per gallon
//   roundTrip       — if true, distance is doubled
//   people          — split the total cost between this many people (>= 1)
//
// Returns:
//   gallons      — gallons of fuel used over the (possibly round-trip) distance
//   totalCost    — total fuel cost in dollars
//   costPerMile  — fuel cost per mile driven
//   perPerson    — each person's share of the total cost
//
// e.g. fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5 })
//        -> { gallons: 10, totalCost: 35, costPerMile: 0.1166…, perPerson: 35 }
export function fuelCost({ distance, mpg, pricePerGallon, roundTrip = false, people = 1 } = {}) {
  const d = num(distance);
  const m = num(mpg);
  const price = num(pricePerGallon);
  let p = num(people);
  // people defaults to a single person; fractional/zero/negative is meaningless.
  if (!Number.isFinite(p) || p < 1) p = 1;
  p = Math.floor(p);

  const miles = roundTrip ? d * 2 : d;

  // MPG must be positive — dividing by zero or a bad value yields NaN gallons.
  const gallons = m > 0 ? miles / m : NaN;
  const totalCost = gallons * price;
  const costPerMile = miles > 0 ? totalCost / miles : NaN;
  const perPerson = totalCost / p;

  return { gallons, totalCost, costPerMile, perPerson };
}

// Map this page's efficiency units onto convertEconomy()'s names.
const ECONOMY_FROM = { mpg: 'mpgUs', l100km: 'l100km', kmPerL: 'kmPerL' };

// Any supported fuel-efficiency figure as US miles per gallon.
//   unit — 'mpg' (US) | 'l100km' | 'kmPerL'
// e.g. toMpg(10, 'l100km') -> 23.52…  (NaN for a non-positive value or unknown unit)
export function toMpg(value, unit = 'mpg') {
  const from = ECONOMY_FROM[unit];
  if (!from) return NaN;
  return convertEconomy(value, from).mpgUs;
}

// The same trip, with metric units allowed on any of the three inputs. Every
// unit is converted to miles, US MPG and dollars per US gallon, then the trip is
// priced by fuelCost() above, so both paths share one formula.
//   distance    — one-way distance, in distUnit ('mi' | 'km')
//   economy     — fuel efficiency, in economyUnit ('mpg' | 'l100km' | 'kmPerL')
//   price       — fuel price, per priceUnit ('gal' = US gallon | 'l' = litre)
//   roundTrip, people — as fuelCost()
//
// Returns everything fuelCost() does, plus:
//   litres       — the same fuel in litres
//   costPerKm    — fuel cost per kilometre driven
//   mpg, l100km, kmPerL — the efficiency in all three units
//
// e.g. tripCost({ distance: 500, distUnit: 'km', economy: 8, economyUnit: 'l100km',
//                 price: 1.8, priceUnit: 'l' })  -> litres 40, totalCost 72
export function tripCost({
  distance,
  distUnit = 'mi',
  economy,
  economyUnit = 'mpg',
  price,
  priceUnit = 'gal',
  roundTrip = false,
  people = 1
} = {}) {
  const d = num(distance);
  const miles = distUnit === 'km' ? d / KM_PER_MILE : d;
  const mpg = toMpg(economy, economyUnit);
  const p = num(price);
  const pricePerGallon = priceUnit === 'l' ? p * LITRES_PER_US_GALLON : p;

  const r = fuelCost({ distance: miles, mpg, pricePerGallon, roundTrip, people });
  const eq = convertEconomy(mpg, 'mpgUs');
  return {
    ...r,
    litres: r.gallons * LITRES_PER_US_GALLON,
    costPerKm: r.costPerMile / KM_PER_MILE,
    mpg: eq.mpgUs,
    l100km: eq.l100km,
    kmPerL: eq.kmPerL
  };
}

// Price of a given amount of fuel: amount × price. The "how much is 25 gallons
// of gas" question. NaN unless both are usable, non-negative numbers.
export function fuelPrice(amount, price) {
  const a = num(amount);
  const p = num(price);
  if (!(a >= 0) || !(p >= 0)) return NaN;
  return a * p;
}
