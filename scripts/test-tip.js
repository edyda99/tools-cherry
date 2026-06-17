// test-tip.js — unit tests for the pure tip/bill math (no DOM needed).
import assert from 'node:assert/strict';
import { roundCents, computeTip } from '../src/engine/tip-math.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };

t('roundCents: handles float drift and half-up', () => {
  assert.equal(roundCents(0.1 + 0.2), 0.3);
  assert.equal(roundCents(2.675), 2.68); // EPSILON rescues the float-drift case
  assert.equal(roundCents(1.014), 1.01);
  assert.equal(roundCents(1.016), 1.02);
  assert.equal(roundCents(13.5), 13.5);
});

t('computeTip: basic 18% tip on a clean bill', () => {
  const r = computeTip({ bill: 75, tipPercent: 18 });
  assert.equal(r.tip, 13.5);
  assert.equal(r.total, 88.5);
  assert.equal(r.perPerson, 88.5);
  assert.equal(r.tipPerPerson, 13.5);
});

t('computeTip: 20% split between 2 people', () => {
  const r = computeTip({ bill: 82.4, tipPercent: 20, people: 2 });
  assert.equal(r.tip, 16.48);
  assert.equal(r.total, 98.88);
  assert.equal(r.perPerson, 49.44);
});

t('computeTip: split with non-even cents distributes per-person', () => {
  // $85 bill, 18% tip, 3 people -> total 100.30, per person ~33.43
  const r = computeTip({ bill: 85, tipPercent: 18, people: 3 });
  assert.equal(r.tip, 15.3);
  assert.equal(r.total, 100.3);
  assert.equal(r.perPerson, 33.43);
});

t('computeTip: tip on pre-tax subtotal excludes tax', () => {
  // $110 bill includes $10 tax; tip 20% on the $100 subtotal = $20
  const r = computeTip({ bill: 110, tax: 10, tipPercent: 20, tipOnPreTax: true });
  assert.equal(r.tip, 20);
  assert.equal(r.total, 130);
});

t('computeTip: tip on post-tax (default) uses the full bill', () => {
  const r = computeTip({ bill: 110, tax: 10, tipPercent: 20, tipOnPreTax: false });
  assert.equal(r.tip, 22);
  assert.equal(r.total, 132);
});

t('computeTip: round mode "total" rounds grand total up, tip absorbs gap', () => {
  // 88.50 -> 89.00; tip becomes 89 - 75 = 14.00
  const r = computeTip({ bill: 75, tipPercent: 18, round: 'total' });
  assert.equal(r.total, 89);
  assert.equal(r.tip, 14);
});

t('computeTip: round mode "tip" rounds the tip up', () => {
  // 13.50 -> 14.00; total = 75 + 14 = 89.00
  const r = computeTip({ bill: 75, tipPercent: 18, round: 'tip' });
  assert.equal(r.tip, 14);
  assert.equal(r.total, 89);
});

t('computeTip: zero bill is safe (no division blowups)', () => {
  const r = computeTip({ bill: 0, tipPercent: 20, people: 4 });
  assert.equal(r.tip, 0);
  assert.equal(r.total, 0);
  assert.equal(r.perPerson, 0);
  assert.equal(r.effectiveTipPercent, 0);
});

t('computeTip: clamps people to at least 1 and floors fractions', () => {
  const r = computeTip({ bill: 100, tipPercent: 10, people: 0 });
  assert.equal(r.perPerson, 110);
});

t('computeTip: effective tip percent reflects rounding', () => {
  const r = computeTip({ bill: 75, tipPercent: 18, round: 'total' });
  // tip 14 on 75 -> 18.666...%
  assert.ok(Math.abs(r.effectiveTipPercent - 18.6667) < 0.001);
});

console.log(`\n${pass} passing`);
