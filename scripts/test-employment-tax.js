// test-employment-tax.js — unit tests for the 1099-vs-W2 estimate module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  TAX_YEAR, federalIncomeTax, w2Estimate, se1099Estimate, compare
} from '../src/engine/employment-tax.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };
const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

t('tax year is current', () => {
  assert.equal(TAX_YEAR, 2026);
});

t('federalIncomeTax: progressive brackets (single)', () => {
  // First bracket: 10% up to 12,400.
  close(federalIncomeTax(10000, 'single'), 1000);
  // Straddle two brackets: 12,400@10% + (20,000-12,400)@12%.
  close(federalIncomeTax(20000, 'single'), 12400 * 0.10 + (20000 - 12400) * 0.12);
  // Zero/negative taxable income -> 0.
  close(federalIncomeTax(0, 'single'), 0);
  close(federalIncomeTax(-500, 'single'), 0);
});

t('w2Estimate: FICA is 7.65% below the SS wage base', () => {
  const r = w2Estimate(80000, 'single');
  close(r.fica, 80000 * 0.0765);
  assert.ok(r.takeHome < r.gross);
  // take-home = gross - fica - federalTax
  close(r.takeHome, r.gross - r.fica - r.federalTax);
});

t('w2Estimate: SS portion caps at the wage base, Medicare does not', () => {
  const r = w2Estimate(300000, 'single');
  const expectedFica = 184500 * 0.062 + 300000 * 0.0145;
  close(r.fica, expectedFica);
});

t('se1099Estimate: SE tax on 92.35% of net, half deductible', () => {
  const net = 100000;
  const r = se1099Estimate(net, 'single');
  const base = net * 0.9235;
  const expectedSe = base * 0.124 + base * 0.029; // both below wage base
  close(r.seTax, expectedSe);
  close(r.seTaxDeduction, expectedSe / 2);
  close(r.takeHome, net - r.seTax - r.federalTax);
});

t('compare: at equal headline income, 1099 keeps less (self-employment tax)', () => {
  const c = compare(100000, 100000, 'single');
  assert.ok(c.w2.takeHome > c.se.takeHome, 'W-2 should keep more at equal gross');
  close(c.takeHomeGap, c.w2.takeHome - c.se.takeHome);
  assert.equal(c.taxYear, 2026);
});

t('estimates handle invalid input gracefully', () => {
  assert.ok(Number.isNaN(w2Estimate('x').takeHome));
  assert.ok(Number.isNaN(se1099Estimate(-5).takeHome));
});

console.log(`\n${pass} employment-tax test(s) passed.`);
