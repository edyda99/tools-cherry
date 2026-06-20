// test-paint.js — unit tests for the pure paint-quantity module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import { wallArea, openingsArea, estimatePaint, COVERAGE, OPENINGS } from '../src/engine/paint.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('wallArea = perimeter * height', () => {
  // 12 x 10 room, 8 ft high: perimeter 44 * 8 = 352.
  assert.equal(wallArea({ length: 12, width: 10, height: 8 }), 352);
  assert.equal(wallArea({ length: 4, width: 3, height: 2.5 }), 35);
});

t('wallArea returns 0 on bad/zero input', () => {
  assert.equal(wallArea({ length: 0, width: 10, height: 8 }), 0);
  assert.equal(wallArea({ length: -1, width: 10, height: 8 }), 0);
  assert.equal(wallArea({}), 0);
});

t('openingsArea uses standard sizes', () => {
  assert.equal(openingsArea({ doors: 1, windows: 0, system: 'us' }), OPENINGS.us.door);
  assert.equal(openingsArea({ doors: 1, windows: 2, system: 'us' }), 21 + 30);
  assert.equal(openingsArea({ doors: 0, windows: 0, system: 'us' }), 0);
  assert.equal(openingsArea({ doors: -3, windows: 0, system: 'us' }), 0);
});

t('estimatePaint full US example', () => {
  // 12 x 10 x 8 room: wall 352. One door (21), two windows (30) -> openings 51.
  // paintable 301. Two coats -> 602 to cover. 350/gal -> 1.72 gal -> buy 2.
  const r = estimatePaint({ length: 12, width: 10, height: 8, doors: 1, windows: 2, coats: 2 });
  assert.equal(r.grossWallArea, 352);
  assert.equal(r.openingsArea, 51);
  assert.equal(r.paintableArea, 301);
  assert.equal(r.coats, 2);
  assert.equal(r.paintNeeded, 1.72);
  assert.equal(r.containers, 2);
  assert.equal(r.paintUnit, 'gallon');
  assert.equal(r.areaUnit, 'sq ft');
});

t('estimatePaint defaults to 2 coats and system coverage', () => {
  const r = estimatePaint({ length: 12, width: 10, height: 8 });
  assert.equal(r.coats, 2);
  assert.equal(r.coverage, COVERAGE.us.area);
});

t('estimatePaint metric example uses litres + m', () => {
  const r = estimatePaint({ length: 4, width: 3, height: 2.5, doors: 1, windows: 1, system: 'metric', coats: 1 });
  // wall 2*(7)*2.5 = 35. openings 1.9 + 1.4 = 3.3. paintable 31.7. 1 coat / 11 = 2.88 L -> buy 3.
  assert.equal(r.grossWallArea, 35);
  assert.equal(r.paintableArea, 31.7);
  assert.equal(r.paintUnit, 'litre');
  assert.equal(r.areaUnit, 'm²');
  assert.equal(r.containers, 3);
});

t('estimatePaint custom coverage overrides default', () => {
  const r = estimatePaint({ length: 10, width: 10, height: 10, coats: 1, coverage: 400 });
  // wall 2*20*10 = 400. /400 = 1 gallon exactly.
  assert.equal(r.paintNeeded, 1);
  assert.equal(r.containers, 1);
});

t('estimatePaint coats minimum 1', () => {
  const r = estimatePaint({ length: 10, width: 10, height: 10, coats: 0 });
  assert.equal(r.coats, 1);
});

t('estimatePaint zero when no dimensions', () => {
  const r = estimatePaint({});
  assert.equal(r.paintableArea, 0);
  assert.equal(r.paintNeeded, 0);
  assert.equal(r.containers, 0);
});

console.log(`\n${pass} passing`);
