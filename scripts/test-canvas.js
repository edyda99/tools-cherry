// test-canvas.js — unit tests for the pure canvas math (no DOM needed).
import assert from 'node:assert/strict';
import { coverScale, containScale, placement, qualityForTargetBytes, clamp, resizeDimensions, formatBytes, kbToBytes, pdfPagePlacement, alphaBounds } from '../src/engine/canvas-math.js';

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

t('resizeDimensions percent scales both sides', () => {
  const r = resizeDimensions(800, 600, { mode: 'percent', percent: 50 });
  assert.equal(r.width, 400);
  assert.equal(r.height, 300);
});

t('resizeDimensions locked width drives height by ratio', () => {
  const r = resizeDimensions(800, 600, { mode: 'pixels', w: 400, lock: true, edited: 'width' });
  assert.equal(r.width, 400);
  assert.equal(r.height, 300); // 400 / (800/600)
});

t('resizeDimensions locked height drives width by ratio', () => {
  const r = resizeDimensions(800, 600, { mode: 'pixels', h: 300, lock: true, edited: 'height' });
  assert.equal(r.width, 400);
  assert.equal(r.height, 300);
});

t('resizeDimensions unlocked keeps both sides independent', () => {
  const r = resizeDimensions(800, 600, { mode: 'pixels', w: 123, h: 456, lock: false });
  assert.equal(r.width, 123);
  assert.equal(r.height, 456);
});

t('resizeDimensions never returns below 1px', () => {
  const r = resizeDimensions(800, 600, { mode: 'percent', percent: 0 });
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
});

t('pdfPagePlacement auto picks landscape for wide images', () => {
  const p = pdfPagePlacement(2000, 1000, 595, 842, { orientation: 'auto', margin: 0 });
  assert.equal(p.orientation, 'landscape');
  assert.equal(p.pageW, 842); // long side becomes width
  assert.equal(p.pageH, 595);
});

t('pdfPagePlacement auto picks portrait for tall/square images', () => {
  const p = pdfPagePlacement(1000, 2000, 595, 842, { orientation: 'auto', margin: 0 });
  assert.equal(p.orientation, 'portrait');
  assert.equal(p.pageW, 595);
  assert.equal(p.pageH, 842);
});

t('pdfPagePlacement forced orientation overrides aspect', () => {
  const p = pdfPagePlacement(2000, 1000, 595, 842, { orientation: 'portrait', margin: 0 });
  assert.equal(p.orientation, 'portrait');
  assert.equal(p.pageW, 595);
});

t('pdfPagePlacement fits with margins and centers', () => {
  const p = pdfPagePlacement(500, 500, 100, 200, { orientation: 'portrait', margin: 10 });
  approx(p.w, 80);   // box 80x180 -> square fits to 80
  approx(p.h, 80);
  approx(p.x, 10);   // (100-80)/2
  approx(p.y, 60);   // (200-80)/2
});

t('pdfPagePlacement clamps oversized margins (no inverted box)', () => {
  const p = pdfPagePlacement(500, 500, 100, 100, { orientation: 'portrait', margin: 999 });
  assert.ok(p.w >= 1 && p.h >= 1);
});

t('formatBytes scales units and handles edge cases', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
});

t('kbToBytes converts and rejects bad input', () => {
  assert.equal(kbToBytes(100), 102400);
  assert.equal(kbToBytes('200'), 204800);
  assert.equal(kbToBytes(1.5), 1536);
  assert.equal(kbToBytes(0), 0);
  assert.equal(kbToBytes(-5), 0);
  assert.equal(kbToBytes(''), 0);
  assert.equal(kbToBytes('abc'), 0);
});

t('alphaBounds reports false for a fully transparent buffer', () => {
  const w = 4, h = 4;
  const data = new Uint8ClampedArray(w * h * 4); // all zero alpha
  const b = alphaBounds(data, w, h);
  assert.equal(b.found, false);
  assert.equal(b.width, 0);
  assert.equal(b.height, 0);
});

t('alphaBounds finds the tight box around inked pixels', () => {
  const w = 5, h = 5;
  const data = new Uint8ClampedArray(w * h * 4);
  const ink = (x, y) => { data[(y * w + x) * 4 + 3] = 255; };
  ink(1, 1); ink(3, 2); // box spans x[1..3], y[1..2]
  const b = alphaBounds(data, w, h);
  assert.equal(b.found, true);
  assert.equal(b.left, 1);
  assert.equal(b.top, 1);
  assert.equal(b.right, 3);
  assert.equal(b.bottom, 2);
  assert.equal(b.width, 3);
  assert.equal(b.height, 2);
});

t('alphaBounds honors the alpha threshold', () => {
  const w = 3, h = 1;
  const data = new Uint8ClampedArray(w * h * 4);
  data[0 * 4 + 3] = 10;  // faint
  data[2 * 4 + 3] = 200; // solid
  const b = alphaBounds(data, w, h, 50); // ignore alpha <= 50
  assert.equal(b.left, 2);
  assert.equal(b.right, 2);
  assert.equal(b.width, 1);
});

t('alphaBounds covers a single inked pixel as 1x1', () => {
  const w = 3, h = 3;
  const data = new Uint8ClampedArray(w * h * 4);
  data[(1 * w + 1) * 4 + 3] = 255;
  const b = alphaBounds(data, w, h);
  assert.equal(b.width, 1);
  assert.equal(b.height, 1);
  assert.equal(b.left, 1);
  assert.equal(b.top, 1);
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
