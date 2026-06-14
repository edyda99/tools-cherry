// test-canvas.js — unit tests for the pure canvas math (no DOM needed).
import assert from 'node:assert/strict';
import { coverScale, containScale, placement, qualityForTargetBytes, clamp } from '../src/engine/canvas-math.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok  - ' + name); };
const approx = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} !~= ${b}`);

t('coverScale fills the box (max ratio)', () => {
  approx(coverScale(100, 50, 50, 50), 1);   // height-limited: 50/50=1 > 50/100=0.5
  approx(coverScale(100, 100, 50, 50), 0.5);
});

t('containScale fits inside (min ratio)', () => {
  approx(containScale(100, 50, 50, 50), 0.5); // width-limited
});

t('clamp bounds', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(0.3, 0, 1), 0.3);
});

t('placement at zoom 1 covers box exactly, no slack', () => {
  const p = placement(100, 100, 50, 50, 1, 0.5, 0.5);
  approx(p.dw, 50); approx(p.dh, 50);
  approx(p.slackX, 0); approx(p.slackY, 0);
  approx(p.offX, 0); approx(p.offY, 0);
});

t('placement at zoom 2 centers with slack', () => {
  const p = placement(100, 100, 50, 50, 2, 0.5, 0.5);
  approx(p.scaleAbs, 1);          // cover 0.5 * zoom 2
  approx(p.dw, 100); approx(p.dh, 100);
  approx(p.slackX, 50); approx(p.slackY, 50);
  approx(p.offX, -25); approx(p.offY, -25); // centered
});

t('placement pan extremes clamp to edges', () => {
  const left = placement(100, 100, 50, 50, 2, 0, 0.5);
  approx(left.offX, 0);           // panNX 0 -> left aligned
  const right = placement(100, 100, 50, 50, 2, 1, 0.5);
  approx(right.offX, -50);        // panNX 1 -> right aligned (offX = -slackX)
});

t('placement is resolution-independent (same transform scales)', () => {
  const small = placement(200, 200, 100, 100, 1.5, 0.5, 0.5);
  const big = placement(200, 200, 400, 400, 1.5, 0.5, 0.5);
  // offsets scale with box size; ratio offX/box equal
  approx(small.offX / 100, big.offX / 400);
});

t('qualityForTargetBytes finds size under target', async () => {
  // fake encoder: size grows linearly with quality, 0..1 -> 0..1000 bytes
  const measure = (q) => Math.round(q * 1000);
  const r = await qualityForTargetBytes(measure, 500, { min: 0.1, max: 0.95, steps: 10 });
  assert.ok(r.size <= 500, `size ${r.size} should be <= 500`);
  assert.ok(r.quality <= 0.5 + 1e-3, `quality ${r.quality} should be ~<=0.5`);
});

(async () => {
  // run the async test explicitly
  await (async () => {
    const measure = (q) => Math.round(q * 1000);
    const r = await qualityForTargetBytes(measure, 500, { steps: 12 });
    assert.ok(r.size <= 500);
  })();
  console.log(`\n${pass} passing`);
})();
