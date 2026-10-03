// test-fuel-cost.js — unit tests for the pure fuel-cost module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuelCost, tripCost, toMpg, fuelPrice } from '../src/engine/fuel-cost.js';
import { gasCostBlocks } from '../src/content/gas-cost-blocks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('300 mi @ 30 mpg @ $3.50 -> 10 gal, $35.00', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5 });
  approx(r.gallons, 10);
  approx(r.totalCost, 35);
  approx(r.perPerson, 35);
});

t('cost per mile is total / miles', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5 });
  approx(r.costPerMile, 35 / 300);
});

t('round-trip doubles gallons and total cost', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, roundTrip: true });
  approx(r.gallons, 20);
  approx(r.totalCost, 70);
  approx(r.costPerMile, 35 / 300); // per-mile is unchanged by round-trip
});

t('split by 2 halves per-person cost', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, people: 2 });
  approx(r.totalCost, 35);
  approx(r.perPerson, 17.5);
});

t('accepts string inputs', () => {
  const r = fuelCost({ distance: '300', mpg: '30', pricePerGallon: '3.5' });
  approx(r.gallons, 10);
  approx(r.totalCost, 35);
});

t('people < 1 falls back to 1 (no divide-by-zero)', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, people: 0 });
  approx(r.perPerson, 35);
});

t('people is floored to a whole number', () => {
  const r = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5, people: 2.9 });
  approx(r.perPerson, 17.5);
});

t('mpg of zero yields NaN gallons, not Infinity', () => {
  const r = fuelCost({ distance: 300, mpg: 0, pricePerGallon: 3.5 });
  assert.ok(Number.isNaN(r.gallons));
  assert.ok(Number.isNaN(r.totalCost));
});

t('bad input yields NaN, not a wrong number', () => {
  const r = fuelCost({ distance: 'abc', mpg: 30, pricePerGallon: 3.5 });
  assert.ok(Number.isNaN(r.gallons));
});

// --- Metric units (tripCost / toMpg) and the fill-up price (fuelPrice).
// Expected values are worked by hand here, not through the engine, so a wrong
// conversion constant cannot pass by agreeing with itself.

t('toMpg: 10 L/100km is 235.2145.../10 US MPG', () => {
  approx(toMpg(10, 'l100km'), (100 * 3.785411784) / 1.609344 / 10);
  approx(toMpg(30, 'mpg'), 30);
  approx(toMpg(12.5, 'kmPerL'), (12.5 * 3.785411784) / 1.609344);
});

t('toMpg: zero, negative, junk and an unknown unit are NaN', () => {
  assert.ok(Number.isNaN(toMpg(0, 'l100km')));
  assert.ok(Number.isNaN(toMpg(-5, 'mpg')));
  assert.ok(Number.isNaN(toMpg('abc', 'mpg')));
  assert.ok(Number.isNaN(toMpg(30, 'mpgUk')));
});

t('tripCost in US units matches fuelCost exactly', () => {
  const a = tripCost({ distance: 300, economy: 30, price: 3.5 });
  const b = fuelCost({ distance: 300, mpg: 30, pricePerGallon: 3.5 });
  approx(a.gallons, b.gallons);
  approx(a.totalCost, b.totalCost);
  approx(a.costPerMile, b.costPerMile);
});

t('tripCost all-metric: 500 km at 8 L/100km at 1.80/L -> 40 L, 72.00, 0.144/km', () => {
  const r = tripCost({
    distance: 500, distUnit: 'km', economy: 8, economyUnit: 'l100km', price: 1.8, priceUnit: 'l'
  });
  approx(r.litres, 40);
  approx(r.totalCost, 72);
  approx(r.costPerKm, 0.144);
  approx(r.l100km, 8);
  approx(r.kmPerL, 12.5);
});

t('tripCost km/L: 400 km at 12.5 km/L at 2.00/L -> 32 L, 64.00', () => {
  const r = tripCost({
    distance: 400, distUnit: 'km', economy: 12.5, economyUnit: 'kmPerL', price: 2, priceUnit: 'l'
  });
  approx(r.litres, 32);
  approx(r.totalCost, 64);
});

t('tripCost mixed: miles, L/100km and a per-gallon price', () => {
  // 100 miles is 160.9344 km; at 10 L/100km that is 16.09344 L = 4.2514... US gal.
  const r = tripCost({ distance: 100, economy: 10, economyUnit: 'l100km', price: 3.5 });
  approx(r.litres, 16.09344);
  approx(r.gallons, 16.09344 / 3.785411784);
  approx(r.totalCost, (16.09344 / 3.785411784) * 3.5);
});

t('tripCost round trip and split carry through the unit conversion', () => {
  const r = tripCost({
    distance: 250, distUnit: 'km', economy: 8, economyUnit: 'l100km', price: 1.8, priceUnit: 'l',
    roundTrip: true, people: 3
  });
  approx(r.litres, 40);
  approx(r.totalCost, 72);
  approx(r.perPerson, 24);
});

t('tripCost: a zero fuel economy is NaN, never Infinity', () => {
  const r = tripCost({ distance: 100, economy: 0, economyUnit: 'l100km', price: 3.5 });
  assert.ok(Number.isNaN(r.totalCost));
});

t('fuelPrice: 25 gallons at $3.50 is $87.50, bad input is NaN', () => {
  approx(fuelPrice(25, 3.5), 87.5);
  approx(fuelPrice('40', '1.8'), 72);
  approx(fuelPrice(0, 3.5), 0);
  assert.ok(Number.isNaN(fuelPrice(-1, 3.5)));
  assert.ok(Number.isNaN(fuelPrice(25, '')));
});

// --- The page's printed figures (src/content/gas-cost-blocks.js). Every number
// in the gas page's prose, table and FAQ comes from gasCostBlocks(); these
// re-derive each one by hand so a wrong figure fails the build, and the last two
// tests keep literals out of the template and the FAQ schema in step with the page.
const blocks = gasCostBlocks();
const gasTpl = await readFile(join(__dirname, '..', 'src', 'templates', 'gas-cost-calculator.html'), 'utf8');
const asMoney = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

t('blocks: the opening-state note matches 300 mi / 30 MPG / $3.50', () => {
  assert.equal(blocks.GAS_DEF_GALLONS, '10');
  assert.equal(blocks.GAS_DEF_COST, '$35.00');
  assert.equal(blocks.GAS_DEF_PER_MILE, '$0.117');
  assert.equal(blocks.GAS_DEF_PRICE, '3.50');
});

t('blocks: worked example 1 is 300 / 25 = 12 gal x $3.50 = $42.00', () => {
  assert.equal(blocks.GAS_EX1_GALLONS, String(300 / 25));
  assert.equal(blocks.GAS_EX1_COST, asMoney((300 / 25) * 3.5));
  assert.equal(blocks.GAS_EX1_COST, '$42.00');
  assert.equal(blocks.GAS_EX1_PER_MILE, '$0.14');
});

t('blocks: worked example 2 is 240 / 32 = 7.5 gal x $3.20 = $24.00, $12.00 each', () => {
  assert.equal(blocks.GAS_EX2_MILES, '240');
  assert.equal(blocks.GAS_EX2_GALLONS, '7.5');
  assert.equal(blocks.GAS_EX2_COST, '$24.00');
  assert.equal(blocks.GAS_EX2_EACH, '$12.00');
});

t('blocks: worked example 3 is 500 km at 8 L/100km = 40 L x $1.80 = $72.00', () => {
  assert.equal(blocks.GAS_EX3_LITRES, String((500 / 100) * 8));
  assert.equal(blocks.GAS_EX3_COST, '$72.00');
  assert.equal(blocks.GAS_EX3_PER_KM, '$0.144');
  assert.equal(blocks.GAS_EX3_MPG, (235.2145833 / 8).toFixed(1));
});

t('blocks: fill-up, 100-mile and L/100km answers re-derive by hand', () => {
  assert.equal(blocks.GAS_FILL_COST_1, asMoney(25 * 3));
  assert.equal(blocks.GAS_FILL_COST_2, asMoney(25 * 3.5));
  assert.equal(blocks.GAS_FILL_COST_3, asMoney(25 * 4));
  assert.equal(blocks.GAS_100_GALLONS, '4');
  assert.equal(blocks.GAS_100_COST, '$14.00');
  assert.equal(blocks.GAS_L100_MPG, (235.21 / 10).toFixed(1));
});

t('blocks: every cost-per-100-miles cell is 100 / MPG x price', () => {
  assert.ok(blocks.rows.length >= 5, `only ${blocks.rows.length} rows in the table`);
  for (const r of blocks.rows) {
    r.costs.forEach((c, i) => {
      const expected = (100 / r.mpg) * blocks.tablePrices[i];
      approx(c, expected);
      assert.ok(
        blocks.GAS_TABLE_ROWS.includes(`<td class="num">${asMoney(expected)}</td>`),
        `${r.mpg} MPG at ${asMoney(blocks.tablePrices[i])} is not in the table HTML`
      );
    });
  }
});

t('template: prints no hand-typed dollar figure', () => {
  const stray = [...new Set(gasTpl.match(/\$\d[\d,]*(?:\.\d+)?/g) || [])];
  assert.deepEqual(stray, [], `hand-typed dollar figures in the gas template: ${stray.join(', ')}`);
});

t('template: every FAQ schema answer is printed word for word on the page', () => {
  const fill = (str) => str.replace(/{{(GAS_\w+)}}/g, (m, k) => (k in blocks ? blocks[k] : m));
  const ld = [...gasTpl.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(fill(m[1])))
    .find((n) => n['@type'] === 'FAQPage');
  assert.ok(ld, 'no FAQPage structured data on the gas page');
  const body = fill(gasTpl.slice(gasTpl.indexOf('<main')))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ');
  for (const q of ld.mainEntity) {
    const text = `${q.name} ${q.acceptedAnswer.text}`;
    assert.ok(body.includes(text), `FAQ "${q.name}" in the schema does not match the visible answer`);
  }
});

console.log(`\n${pass} passing`);
