// test-tile.js — unit tests for the pure tile module. Run via `npm test`.
import assert from 'node:assert/strict';
import { roomArea, tileArea, estimateTiles } from '../src/engine/tile.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-2) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('roomArea: 12 x 10 ft = 120 sq ft', () => approx(roomArea({ length: 12, width: 10 }), 120));
t('roomArea: accepts string input', () => approx(roomArea({ length: '12', width: '10' }), 120));
t('roomArea: zero/invalid dimension yields 0', () => {
  assert.equal(roomArea({ length: 0, width: 10 }), 0);
  assert.equal(roomArea({ length: 'abc', width: 10 }), 0);
});

t('tileArea US: 12x12 in tile = 1 sq ft', () => approx(tileArea({ tileW: 12, tileH: 12, system: 'us' }), 1));
t('tileArea US: 6x6 in tile = 0.25 sq ft', () => approx(tileArea({ tileW: 6, tileH: 6, system: 'us' }), 0.25));
t('tileArea metric: 30x30 cm tile = 0.09 m²', () => approx(tileArea({ tileW: 30, tileH: 30, system: 'metric' }), 0.09));

t('estimateTiles US: 120 sq ft, 12x12 tiles, 10% waste -> 132 tiles', () => {
  const r = estimateTiles({ length: 12, width: 10, tileW: 12, tileH: 12, waste: 10, system: 'us' });
  approx(r.area, 120);
  approx(r.tileArea, 1);
  approx(r.baseTiles, 120);
  assert.equal(r.tilesNeeded, 132); // 120 * 1.10
});

t('estimateTiles: rounds up to whole tiles', () => {
  // 100 sq ft / 1 sq ft = 100 base; 5% waste = 105 exactly
  const r = estimateTiles({ length: 10, width: 10, tileW: 12, tileH: 12, waste: 5, system: 'us' });
  assert.equal(r.tilesNeeded, 105);
  // 0% waste with a fractional base must still ceil up
  const r2 = estimateTiles({ length: 10, width: 10, tileW: 18, tileH: 18, waste: 0, system: 'us' });
  // tile = 324/144 = 2.25 sq ft; 100/2.25 = 44.44 -> ceil 45
  assert.equal(r2.tilesNeeded, 45);
});

t('estimateTiles: box count rounds up', () => {
  const r = estimateTiles({ length: 12, width: 10, tileW: 12, tileH: 12, waste: 10, perBox: 10, system: 'us' });
  assert.equal(r.tilesNeeded, 132);
  assert.equal(r.boxes, 14); // ceil(132/10)
});

t('estimateTiles: no perBox -> boxes null', () => {
  const r = estimateTiles({ length: 12, width: 10, tileW: 12, tileH: 12 });
  assert.equal(r.boxes, null);
});

t('estimateTiles metric: 4x3 m, 30x30 cm tiles, 10% waste', () => {
  const r = estimateTiles({ length: 4, width: 3, tileW: 30, tileH: 30, waste: 10, system: 'metric' });
  approx(r.area, 12);
  approx(r.tileArea, 0.09);
  // 12 / 0.09 = 133.33 base; *1.10 = 146.67 -> ceil 147
  assert.equal(r.tilesNeeded, 147);
  assert.equal(r.areaUnit, 'm²');
});

t('estimateTiles: invalid inputs yield 0 tiles, not NaN', () => {
  const r = estimateTiles({ length: 0, width: 10, tileW: 12, tileH: 12 });
  assert.equal(r.tilesNeeded, 0);
  assert.equal(r.boxes, null);
  const r2 = estimateTiles({ length: 10, width: 10, tileW: 0, tileH: 12 });
  assert.equal(r2.tilesNeeded, 0);
});

t('estimateTiles: default waste is 10%', () => {
  const r = estimateTiles({ length: 10, width: 10, tileW: 12, tileH: 12, system: 'us' });
  assert.equal(r.waste, 10);
  assert.equal(r.tilesNeeded, 110);
});

console.log(`\n${pass} passing`);
