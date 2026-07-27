#!/usr/bin/env node
// verify-dist.js — the dist/ integrity gate. Refuses to let a corrupted dist/
// exist quietly.
//
// Why this exists: build.js starts by `rm -rf dist/` and then writes ~240 pages
// into it. Two sessions building in the same tree at once therefore interleave —
// one build's rm can delete pages the other has already written, and one build's
// asset-hash manifest can be replaced under the other's feet. The observed
// failure modes are pages whose /assets references point at files that are not
// on disk: either UNHASHED paths (/assets/styles.css) written before the final
// hash-rewrite pass, or a STALE HASH (/assets/styles.<oldhash>.css) left behind
// when a concurrent build replaced the asset files. Both render the page
// unstyled, trip the site's own "Something went wrong loading this calculator"
// handler, and still carry the AdSense loader. Shipping that during an ad review
// is the worst possible outcome, and nothing in the build itself noticed.
//
// This module is imported by build.js and runs at the END of every build, so the
// protection cannot be bypassed by the documented deploy path (`npm run build`
// followed by a bare `wrangler pages deploy dist`). It is also runnable directly
// (`npm run verify-dist`, optionally with a dist path) to re-check a dist/ that
// the current process did not build.
//
// The checks below are STRUCTURAL, not magic numbers, so they keep working as
// pages are added or removed. Every failure is fatal.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Built asset filenames are content-hashed (e.g. /assets/styles.4f2a91c8.css).
// An UNhashed reference means the page was written against a manifest that a
// concurrent build has since replaced, so the file it points at is not there.
const UNHASHED = /(?:href|src)="\/assets\/[A-Za-z0-9_-]+\.(?:js|css)"/g;
// Every local /assets reference, hashed or not, so each can be checked to exist.
const ASSET_REF = /(?:href|src)="(\/assets\/[^"]+)"/g;
const LOADER = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const MANUAL_AD = /<ins[^>]*class="[^"]*\badsbygoogle\b/;

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.name === 'index.html') out.push(p);
  }
  return out;
}

const list = (items, n = 12) =>
  '\n    ' + items.slice(0, n).join('\n    ') +
  (items.length > n ? `\n    ...and ${items.length - n} more` : '');

/**
 * Check a built dist/ for the corruption a concurrent build can cause.
 * Pure: reads the tree, prints nothing, never exits. Callers decide.
 * @param {string} distPath absolute path to the dist directory
 * @returns {Promise<{pages:number, withLoader:number, failures:string[]}>}
 *   `failures` is empty when the dist is good. A dist that cannot be read at
 *   all is itself reported as a failure rather than thrown.
 */
export async function verifyDist(distPath) {
  const DIST = resolve(distPath);
  const failures = [];

  let pages;
  try {
    pages = await walk(DIST);
  } catch (e) {
    return {
      pages: 0,
      withLoader: 0,
      failures: [`cannot read ${DIST} — did the build run? (${e.message})`],
    };
  }

  if (!pages.length) failures.push('dist/ contains no index.html at all.');

  const unhashed = [];
  const missingLoader = [];
  const embedWithLoader = [];
  const manualAds = [];
  const tiny = [];
  // asset path -> the pages that reference it, so a missing asset can name a victim.
  const assetRefs = new Map();
  let withLoader = 0;

  for (const p of pages) {
    const rel = relative(DIST, p);
    const parts = rel.split(sep);
    // dist/embed/<tool>/index.html are the bare iframe widgets that must NOT carry
    // the ad loader; dist/embed/index.html is the gallery landing page and must.
    const isEmbedWidget = parts[0] === 'embed' && parts.length > 2;
    const html = await readFile(p, 'utf8');
    const { size } = await stat(p);

    if (size < 1024) tiny.push(`${rel} (${size} bytes)`);
    const bad = html.match(UNHASHED);
    if (bad) unhashed.push(`${rel} -> ${[...new Set(bad)].join(', ')}`);
    for (const m of html.matchAll(ASSET_REF)) {
      if (!assetRefs.has(m[1])) assetRefs.set(m[1], []);
      assetRefs.get(m[1]).push(rel);
    }
    const hasLoader = html.includes(LOADER);
    if (hasLoader) withLoader++;
    if (isEmbedWidget && hasLoader) embedWithLoader.push(rel);
    if (!isEmbedWidget && !hasLoader) missingLoader.push(rel);
    if (MANUAL_AD.test(html)) manualAds.push(rel);
  }

  // Every referenced asset must actually be on disk. This is the check that
  // catches a STALE HASH: the reference looks perfectly well-formed, so the
  // UNHASHED pattern above never sees it, but the file is gone because a
  // concurrent build rewrote dist/assets/ with different content hashes.
  // Only the distinct asset paths are stat'ed (a few hundred), not one per page.
  const missingAssets = [];
  for (const [ref, referrers] of [...assetRefs].sort()) {
    const onDisk = join(DIST, ref.replace(/^\//, '').split('/').join(sep));
    try {
      await stat(onDisk);
    } catch {
      missingAssets.push(
        `${ref} (404) <- ${referrers.length} page(s), e.g. ${referrers.slice(0, 3).join(', ')}`
      );
    }
  }

  if (unhashed.length)
    failures.push(`${unhashed.length} page(s) reference unhashed /assets paths that will 404 (concurrent-build corruption):` + list(unhashed));
  if (missingAssets.length)
    failures.push(`${missingAssets.length} referenced /assets file(s) are not on disk (stale asset hash — a concurrent build replaced dist/assets/):` + list(missingAssets));
  if (tiny.length)
    failures.push(`${tiny.length} page(s) are implausibly small (truncated write):` + list(tiny));
  if (missingLoader.length)
    failures.push(`${missingLoader.length} non-embed page(s) are missing the AdSense loader:` + list(missingLoader));
  if (embedWithLoader.length)
    failures.push(`${embedWithLoader.length} iframe widget page(s) under dist/embed/ carry the AdSense loader and must not:` + list(embedWithLoader));
  if (manualAds.length)
    failures.push(`${manualAds.length} page(s) contain a manual <ins class="adsbygoogle"> unit; this site is Auto ads only:` + list(manualAds));

  return { pages: pages.length, withLoader, failures };
}

/**
 * Print the failure block every caller shows on a bad dist, to stderr.
 * Kept here so build.js and the CLI cannot drift apart on the wording.
 */
export function reportFailures(failures) {
  console.error('\nverify-dist FAILED — do not deploy:\n');
  for (const f of failures) console.error('  - ' + f);
  console.error('\nMost likely cause: another session ran `npm run build` in this tree at the same time.');
  console.error('Wait for the other build to finish, re-run `npm run build`, then try again.\n');
}

// CLI entry — only when this file is executed directly, not when build.js
// imports it. Standalone use is chatty on success (that is the whole output);
// the in-build call stays silent so a good build is not made noisy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  // Optional argument so the gate itself can be exercised against a fixture.
  const target = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'dist');
  const { pages, withLoader, failures } = await verifyDist(target);
  console.log(`verify-dist: ${pages} page(s), ${withLoader} with the AdSense loader, ${pages - withLoader} without (iframe widgets under dist/embed/).`);
  if (failures.length) {
    reportFailures(failures);
    process.exit(1);
  }
  console.log('verify-dist: OK.');
}
