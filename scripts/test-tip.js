// test-tip.js — unit tests for the pure tip-math module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { tipAmount, splitBill } from '../src/engine/tip-math.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('tipAmount: 20% of $50 is $10', () => approx(tipAmount(50, 20), 10));
t('tipAmount: 0% is $0', () => approx(tipAmount(99, 0), 0));
t('tipAmount: accepts string input', () => approx(tipAmount('100', '15'), 15));

t('splitBill: $50 + 20% split 2 ways', () => {
  const r = splitBill({ bill: 50, tipPercent: 20, people: 2 });
  approx(r.tip, 10);
  approx(r.total, 60);
  approx(r.perPerson, 30);
  approx(r.perPersonTip, 5);
});

t('splitBill: 1 person gets the whole total', () => {
  const r = splitBill({ bill: 80, tipPercent: 25, people: 1 });
  approx(r.total, 100);
  approx(r.perPerson, 100);
});

t('splitBill: round up raises each share to whole units and keeps totals consistent', () => {
  // $50 + 18% = $59 / 3 = $19.666… -> rounds up to $20 each
  const r = splitBill({ bill: 50, tipPercent: 18, people: 3, roundUp: true });
  approx(r.perPerson, 20);
  approx(r.total, 60); // 20 * 3
  approx(r.tip, 10); // 60 - 50
  approx(r.perPerson * 3, r.total);
});

t('splitBill: round up is a no-op when shares are already whole', () => {
  const r = splitBill({ bill: 50, tipPercent: 20, people: 2, roundUp: true });
  approx(r.perPerson, 30);
  approx(r.total, 60);
  approx(r.tip, 10);
});

t('splitBill: zero people is NaN, not a divide-by-zero', () => {
  const r = splitBill({ bill: 50, tipPercent: 20, people: 0 });
  assert.ok(Number.isNaN(r.perPerson));
  assert.ok(Number.isNaN(r.total));
});

t('splitBill: fractional people count floors to a whole number', () => {
  const r = splitBill({ bill: 60, tipPercent: 0, people: 2.9 });
  approx(r.perPerson, 30); // floored to 2 people
});

t('splitBill: bad bill input yields NaN, not a wrong number', () => {
  const r = splitBill({ bill: 'abc', tipPercent: 20, people: 2 });
  assert.ok(Number.isNaN(r.total));
});

t('splitBill: empty bill (blank) is NaN', () => {
  const r = splitBill({ bill: '', tipPercent: 20, people: 2 });
  assert.ok(Number.isNaN(r.total));
});

// --- pre-tax tipping ---------------------------------------------------------
t('tipOnPreTax: tips on (bill - tax); total still includes full bill', () => {
  // bill 108 includes 8 tax -> tip on 100 @ 20% = 20; total = 108 + 20 = 128
  const r = splitBill({ bill: 108, tipPercent: 20, people: 1, tax: 8, tipOnPreTax: true });
  approx(r.tip, 20);
  approx(r.total, 128);
  approx(r.perPerson, 128);
});

t('tipOnPreTax false (default) tips on full bill', () => {
  const r = splitBill({ bill: 108, tipPercent: 20, people: 1, tax: 8 });
  approx(r.tip, 21.6); // 20% of 108
  approx(r.total, 129.6);
});

t('tipOnPreTax with tax=0 equals tipping on full bill', () => {
  const a = splitBill({ bill: 50, tipPercent: 18, people: 2, tipOnPreTax: true });
  const b = splitBill({ bill: 50, tipPercent: 18, people: 2 });
  approx(a.tip, b.tip);
  approx(a.total, b.total);
});

t('tipOnPreTax clamps when tax >= bill (no negative base)', () => {
  const r = splitBill({ bill: 10, tipPercent: 20, people: 1, tax: 50, tipOnPreTax: true });
  approx(r.tip, 0);       // base clamped to 0
  approx(r.total, 10);    // still pay the bill
});

t('omitting tax/tipOnPreTax reproduces original result', () => {
  const r = splitBill({ bill: 50, tipPercent: 20, people: 2 });
  approx(r.tip, 10); approx(r.total, 60); approx(r.perPerson, 30);
});

console.log(`\n${pass} passing`);
