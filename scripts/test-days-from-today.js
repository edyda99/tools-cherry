// test-days-from-today.js — gate for the fixed-interval date pages
// (/30-days-from-today/, /12-weeks-from-today/, /10-business-days-from-today/,
// /90-days-ago/ …).
//
// These pages are the one family on the site whose ANSWER is deliberately absent
// from the HTML: "30 days from today" is a different date every morning, so the
// date has to be computed in the reader's browser at load. That makes the usual
// "grep the built HTML for the number" check impossible and a silent failure
// invisible — a page whose script never runs looks fine in dist/ and shows an
// em-dash to every visitor.
//
// So this test EXECUTES the shipped module. It loads the real content-hashed
// bytes out of dist/assets/, rewrites their "/assets/…" import specifiers to
// file URLs (nothing else is touched), runs them against a minimal DOM stub
// carrying the same data-attributes the built page carries, and asserts that the
// answer element was populated with the date the pure engine independently says
// it should be. If the client-side computation breaks, this fails.
//
// It also pins the per-page metadata that makes the family worth having at all:
// unique titles, descriptions, H1s and canonicals, and no leaked template token.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DFT_PAGES } from '../src/content/days-from-today.js';
import { addToDate, addBusinessDays, toISODate } from '../src/engine/date-add.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

let pass = 0;
const t = async (name, fn) => {
  await fn();
  pass++;
  console.log('ok  - ' + name);
};

// Loudly skipped, never silently passed: `npm test` runs in trees that have
// never been built, and a missing dist/ is a gap in coverage, not a pass.
if (!existsSync(DIST)) {
  console.log('SKIPPED test-days-from-today: dist/ not built. Run `npm run build` first.');
  process.exit(0);
}

const pageHtml = new Map();
for (const p of DFT_PAGES) {
  const f = join(DIST, p.slug, 'index.html');
  assert.ok(existsSync(f), `dist/${p.slug}/index.html is missing — the build dropped a page`);
  pageHtml.set(p.slug, await readFile(f, 'utf8'));
}

const one = (html, re, what) => {
  const m = html.match(re);
  assert.ok(m, `missing ${what}`);
  return m[1].trim();
};

await t('every page ships a unique title, description, H1 and canonical', () => {
  const seen = { title: new Map(), desc: new Map(), h1: new Map(), canon: new Map() };
  for (const p of DFT_PAGES) {
    const html = pageHtml.get(p.slug);
    const vals = {
      title: one(html, /<title>([\s\S]*?)<\/title>/, 'title'),
      desc: one(html, /<meta name="description" content="([\s\S]*?)">/, 'description'),
      h1: one(html, /<h1>([\s\S]*?)<\/h1>/, 'h1'),
      canon: one(html, /<link rel="canonical" href="([^"]+)"/, 'canonical'),
    };
    for (const k of Object.keys(vals)) {
      const prev = seen[k].get(vals[k]);
      assert.ok(!prev, `${p.slug} shares its ${k} with ${prev}: ${vals[k]}`);
      seen[k].set(vals[k], p.slug);
    }
    assert.ok(vals.canon.endsWith(`/${p.slug}/`), `${p.slug} canonical points elsewhere: ${vals.canon}`);
  }
});

const hubHtml = await readFile(join(DIST, 'days-from-today', 'index.html'), 'utf8');

await t('no page leaks an unfilled template token, undefined or NaN', () => {
  for (const [slug, html] of [...pageHtml, ['days-from-today', hubHtml]]) {
    for (const bad of ['{{', 'undefined', 'NaN']) {
      assert.ok(!html.includes(bad), `${slug} contains "${bad}"`);
    }
  }
});

await t('the interval is in the markup and matches the slug', () => {
  for (const p of DFT_PAGES) {
    const html = pageHtml.get(p.slug);
    const amount = one(html, /id="dft"[^>]*data-amount="(\d+)"/, `${p.slug} data-amount`);
    const unit = one(html, /id="dft"[^>]*data-unit="([a-z]+)"/, `${p.slug} data-unit`);
    const dir = one(html, /id="dft"[^>]*data-dir="([a-z]+)"/, `${p.slug} data-dir`);
    assert.equal(Number(amount), p.amount, `${p.slug} data-amount`);
    assert.equal(unit, p.unit, `${p.slug} data-unit`);
    assert.equal(dir, p.dir === 'back' ? 'back' : 'fwd', `${p.slug} data-dir`);
    // The answer element must ship EMPTY (an em dash) — a baked date would be
    // wrong the morning after the deploy.
    assert.ok(/id="dftBig">(&mdash;|—)</.test(html), `${p.slug} ships a pre-filled answer`);
  }
});

await t('every JSON-LD block on every page parses', () => {
  for (const [slug, html] of [...pageHtml, ['days-from-today', hubHtml]]) {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length >= 1, `${slug} has no JSON-LD`);
    for (const b of blocks) JSON.parse(b[1]);
  }
});

await t('sibling and hub links point at pages that exist', () => {
  const known = new Set(DFT_PAGES.map((p) => p.slug));
  for (const [slug, html] of [...pageHtml, ['days-from-today', hubHtml]]) {
    for (const m of html.matchAll(/href="\/([a-z0-9-]+)\/"/g)) {
      if (/(days|weeks)-(from-today|ago)$/.test(m[1]) && m[1] !== 'days-from-today') {
        assert.ok(known.has(m[1]), `${slug} links to /${m[1]}/, which is not a built page`);
      }
    }
    assert.ok(!html.includes(`href="/${slug}/"`), `${slug} links to itself`);
  }
  for (const p of DFT_PAGES) {
    assert.ok(hubHtml.includes(`href="/${p.slug}/"`), `the hub does not link to /${p.slug}/`);
  }
});

// --- the part that matters: run the SHIPPED client-side code -----------------

// Minimal DOM stub. Only what days-from-today.js touches, so a script that
// starts reaching for something else fails loudly here rather than in a browser.
function makeDom(attrs) {
  const el = (id) => ({
    id,
    textContent: '',
    getAttribute: (n) => (attrs[n] === undefined ? null : String(attrs[n])),
  });
  const nodes = new Map();
  for (const id of ['dft', 'dftBig', 'dftSub', 'dftToday', 'dftDow', 'dftIso', 'dftCross']) {
    nodes.set(id, el(id));
  }
  return {
    readyState: 'complete',
    getElementById: (id) => nodes.get(id) || null,
    querySelector: () => null,
    body: null,
    createElement: () => ({ setAttribute() {} }),
    addEventListener() {},
    __nodes: nodes,
  };
}

// The shipped bytes, with their absolute "/assets/…" specifiers pointed at the
// files on disk. Only the specifier text changes; the logic under test does not.
const assetDir = join(DIST, 'assets');
const files = await readdir(assetDir);
const shipped = files.find((f) => /^days-from-today\.[0-9a-f]+\.js$/.test(f));
assert.ok(shipped, 'dist/assets/days-from-today.<hash>.js was not built');

// Copy the module and everything it imports into sibling __test-* files whose
// specifiers are file URLs. Copies, never in-place edits: dist/ is what ships
// and a test must not touch it.
const tmpNames = [];
async function loadShipped(name) {
  const tmp = join(assetDir, `__test-${name}`);
  if (tmpNames.includes(tmp)) return tmp;
  tmpNames.push(tmp);
  const src = await readFile(join(assetDir, name), 'utf8');
  const deps = [...src.matchAll(/["']\/assets\/([A-Za-z0-9._-]+\.js)["']/g)].map((m) => m[1]);
  for (const dep of deps) await loadShipped(dep);
  const rewritten = src.replace(
    /(["'])\/assets\/([A-Za-z0-9._-]+\.js)\1/g,
    (m, q, dep) => q + pathToFileURL(join(assetDir, `__test-${dep}`)).href + q
  );
  await writeFile(tmp, rewritten);
  return tmp;
}

await t('the shipped script computes the right date for every page', async () => {
  const tmp = await loadShipped(shipped);
  for (const p of DFT_PAGES) {
    const doc = makeDom({ 'data-amount': p.amount, 'data-unit': p.unit, 'data-dir': p.dir === 'back' ? 'back' : 'fwd' });
    globalThis.document = doc;
    // Fresh module instance per page: the module runs its boot on import, so the
    // cache is busted with a query string.
    await import(pathToFileURL(tmp).href + `?p=${p.slug}`);

    const today = new Date();
    const sign = p.dir === 'back' ? -1 : 1;
    const expected = p.unit === 'business'
      ? addBusinessDays(today, p.amount, sign)
      : addToDate(today, p.unit === 'week' ? { weeks: p.amount } : { days: p.amount }, sign);

    const big = doc.__nodes.get('dftBig').textContent;
    const iso = doc.__nodes.get('dftIso').textContent;
    assert.equal(iso, toISODate(expected), `${p.slug} rendered the wrong date`);
    assert.ok(big && big !== '—' && big.includes(String(expected.getFullYear())),
      `${p.slug} left the headline unpopulated (got ${JSON.stringify(big)})`);
    assert.ok(!/undefined|NaN/.test(big + iso), `${p.slug} rendered undefined/NaN`);

    // Every secondary line must be filled too — an empty one is a silent break.
    for (const id of ['dftSub', 'dftToday', 'dftDow', 'dftCross']) {
      const v = doc.__nodes.get(id).textContent;
      assert.ok(v && !/undefined|NaN/.test(v), `${p.slug} left #${id} empty or broken: ${JSON.stringify(v)}`);
    }
    // A business-day answer can never land on a weekend.
    if (p.unit === 'business') {
      assert.ok(expected.getDay() !== 0 && expected.getDay() !== 6, `${p.slug} landed on a weekend`);
    }
  }
  delete globalThis.document;
});

for (const f of tmpNames) await unlink(f);

console.log(`\n${pass} passing`);
