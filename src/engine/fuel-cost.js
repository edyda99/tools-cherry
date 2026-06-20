// fuel-cost.js — pure, dependency-free gas / fuel trip-cost math.
// Shared by the browser tool (gas-cost-calculator.js) and the unit tests.
// fuelCost() returns finite numbers, or NaN fields when an input is not a
// usable finite number (the UI is responsible for hiding NaN).

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

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
