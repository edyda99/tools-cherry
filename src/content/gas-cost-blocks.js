// gas-cost-blocks.js — every figure the gas cost calculator page prints in
// prose, computed at build time through the same engine the browser tool uses.
//
// Same reason as inflation-blocks.js: a worked example typed into a template is
// not a test, so nothing can notice when it is wrong. Every number in the
// page's formula note, worked examples, cost-per-100-miles table and FAQ comes
// from here, and scripts/test-fuel-cost.js re-derives them from the engine.
//
// The prices below are round EXAMPLE inputs, not a claim about what gas costs
// today. The page says so wherever they appear, and states no current average.
import { fuelCost, tripCost, fuelPrice, toMpg } from '../engine/fuel-cost.js';

// Same formatters as src/assets/gas-cost-calculator.js, so a worked example and
// the live calculator print the same trip the same way.
const money = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const perUnit = (n) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  });
const qty = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const fixed = (n, dp) =>
  n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// The calculator's opening state. The template stamps these onto the inputs, so
// the formula note above the calculator describes exactly what it opens on.
export const GAS_DEFAULTS = { distance: 300, mpg: 30, price: 3.5 };

// Worked example 1: a one-way drive, US units.
const EX1 = { distance: 300, mpg: 25, price: 3.5 };
// Worked example 2: a round trip split between two people.
const EX2 = { distance: 120, mpg: 32, price: 3.2, people: 2 };
// Worked example 3: metric units throughout.
const EX3 = { distance: 500, economy: 8, price: 1.8 };
// "How much is N gallons of gas?"
const FILL_GALLONS = 25;
const FILL_PRICES = [3, 3.5, 4];
// "How much does it cost to drive 100 miles?"
const HUNDRED = { mpg: 25, price: 3.5 };
// "10 L/100km to MPG"
const L100_EXAMPLE = 10;
// The cost-per-100-miles grid.
const TABLE_MPG = [15, 20, 25, 30, 35, 40, 50];
const TABLE_PRICES = [3, 3.5, 4, 4.5, 5];

export function gasCostBlocks() {
  const def = fuelCost({ distance: GAS_DEFAULTS.distance, mpg: GAS_DEFAULTS.mpg, pricePerGallon: GAS_DEFAULTS.price });

  const ex1 = fuelCost({ distance: EX1.distance, mpg: EX1.mpg, pricePerGallon: EX1.price });
  const ex2 = fuelCost({ distance: EX2.distance, mpg: EX2.mpg, pricePerGallon: EX2.price, roundTrip: true, people: EX2.people });
  const ex3 = tripCost({
    distance: EX3.distance, distUnit: 'km',
    economy: EX3.economy, economyUnit: 'l100km',
    price: EX3.price, priceUnit: 'l'
  });
  const fills = FILL_PRICES.map((p) => ({ price: p, cost: fuelPrice(FILL_GALLONS, p) }));
  const hundred = fuelCost({ distance: 100, mpg: HUNDRED.mpg, pricePerGallon: HUNDRED.price });
  const l100Mpg = toMpg(L100_EXAMPLE, 'l100km');
  const defL100 = tripCost({ distance: 1, economy: GAS_DEFAULTS.mpg, price: 1 }).l100km;

  const rows = TABLE_MPG.map((mpg) => ({
    mpg,
    costs: TABLE_PRICES.map((p) => fuelCost({ distance: 100, mpg, pricePerGallon: p }).totalCost)
  }));
  const tableHead =
    `<tr><th scope="col">MPG</th>` +
    TABLE_PRICES.map((p) => `<th scope="col">${money(p)}</th>`).join('') +
    `</tr>`;
  const tableRows = rows
    .map(
      (r) =>
        `<tr><th scope="row">${r.mpg} MPG</th>` +
        r.costs.map((c) => `<td class="num">${money(c)}</td>`).join('') +
        `</tr>`
    )
    .join('\n');

  return {
    // --- raw values, for the tests
    defaults: GAS_DEFAULTS,
    def,
    ex1: { ...EX1, ...ex1 },
    ex2: { ...EX2, ...ex2 },
    ex3: { ...EX3, ...ex3 },
    fillGallons: FILL_GALLONS,
    fills,
    hundred: { ...HUNDRED, ...hundred },
    l100Example: L100_EXAMPLE,
    l100Mpg,
    defL100,
    tableMpg: TABLE_MPG,
    tablePrices: TABLE_PRICES,
    rows,

    // --- formatted strings, exactly as they appear on the page
    GAS_DEF_DISTANCE: String(GAS_DEFAULTS.distance),
    GAS_DEF_MPG: String(GAS_DEFAULTS.mpg),
    GAS_DEF_PRICE: fixed(GAS_DEFAULTS.price, 2),
    GAS_DEF_PRICE_MONEY: money(GAS_DEFAULTS.price),
    GAS_DEF_GALLONS: qty(def.gallons),
    GAS_DEF_COST: money(def.totalCost),
    GAS_DEF_PER_MILE: perUnit(def.costPerMile),
    GAS_DEF_L100: fixed(defL100, 2),

    GAS_EX1_DISTANCE: String(EX1.distance),
    GAS_EX1_MPG: String(EX1.mpg),
    GAS_EX1_PRICE: money(EX1.price),
    GAS_EX1_GALLONS: qty(ex1.gallons),
    GAS_EX1_COST: money(ex1.totalCost),
    GAS_EX1_PER_MILE: perUnit(ex1.costPerMile),

    GAS_EX2_DISTANCE: String(EX2.distance),
    GAS_EX2_MILES: String(EX2.distance * 2),
    GAS_EX2_MPG: String(EX2.mpg),
    GAS_EX2_PRICE: money(EX2.price),
    GAS_EX2_GALLONS: qty(ex2.gallons),
    GAS_EX2_COST: money(ex2.totalCost),
    GAS_EX2_PEOPLE: String(EX2.people),
    GAS_EX2_EACH: money(ex2.perPerson),

    GAS_EX3_DISTANCE: String(EX3.distance),
    GAS_EX3_L100: String(EX3.economy),
    GAS_EX3_PRICE: money(EX3.price),
    GAS_EX3_LITRES: qty(ex3.litres),
    GAS_EX3_COST: money(ex3.totalCost),
    GAS_EX3_PER_KM: perUnit(ex3.costPerKm),
    GAS_EX3_MPG: fixed(ex3.mpg, 1),

    GAS_FILL_GALLONS: String(FILL_GALLONS),
    GAS_FILL_PRICE_1: money(fills[0].price),
    GAS_FILL_COST_1: money(fills[0].cost),
    GAS_FILL_PRICE_2: money(fills[1].price),
    GAS_FILL_COST_2: money(fills[1].cost),
    GAS_FILL_PRICE_3: money(fills[2].price),
    GAS_FILL_COST_3: money(fills[2].cost),

    GAS_100_MPG: String(HUNDRED.mpg),
    GAS_100_PRICE: money(HUNDRED.price),
    GAS_100_GALLONS: qty(hundred.gallons),
    GAS_100_COST: money(hundred.totalCost),

    GAS_L100_EXAMPLE: String(L100_EXAMPLE),
    GAS_L100_MPG: fixed(l100Mpg, 1),

    GAS_TABLE_HEAD: tableHead,
    GAS_TABLE_ROWS: tableRows,
    GAS_TABLE_PRICE_MIN: money(TABLE_PRICES[0]),
    GAS_TABLE_PRICE_MAX: money(TABLE_PRICES[TABLE_PRICES.length - 1])
  };
}
