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

// --- AI-citability checks. Answer engines quote the first sentence they can lift
// whole and read /llms.txt to find out what a site holds, so both are load-bearing
// output, not decoration. They are generated, which is exactly why they need a gate:
// a placeholder that never got filled, or a section that silently emptied because
// its source array went away, produces a file that still looks fine and says nothing.
//
// Every /data/ page must open with one computed answer sentence. Checked for three
// things: the element exists, it is not an unsubstituted {{ANSWER}} placeholder, and
// it is long enough and ends in a full stop, i.e. it is a real sentence rather than a
// stub. It must also carry a digit — the whole point is that it answers with a figure.
const ANSWER_EL = /<p class="answer-first">([\s\S]*?)<\/p>/;
// The sections /llms.txt must carry. The blockquote summary is part of the llms.txt
// convention; the other three are the site's actual substance.
const LLMS_REQUIRED = ['\n> ', '## Data and reference tables', '## Tools', '## State paycheck calculators'];
const LLMS_FULL_REQUIRED = ['## Key ', '## Tools', '## Datasets'];

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
  const badAnswers = [];
  let dataPages = 0;
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

    // The quotable answer sentence, on the /data/ reference pages only (parts[0] is
    // 'data' and it is a page, not the CSV/JSON siblings). Their /embed/data/ twins
    // are bare tables with no headline and are correctly skipped by this path test.
    if (parts[0] === 'data' && parts.length === 3) {
      dataPages++;
      const m = html.match(ANSWER_EL);
      const text = m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
      if (!text) badAnswers.push(`${rel}: no <p class="answer-first"> element`);
      else if (text.includes('{{')) badAnswers.push(`${rel}: unsubstituted placeholder (${text.slice(0, 40)})`);
      else if (text.length < 80 || !text.endsWith('.')) badAnswers.push(`${rel}: not a complete sentence (${text.slice(0, 60)}…)`);
      else if (!/\d/.test(text)) badAnswers.push(`${rel}: answer carries no figure (${text.slice(0, 60)}…)`);
    }
  }

  // /llms.txt, /llm.txt and /llms-full.txt — the AI discovery files. Each must exist,
  // carry every required section, and contain no unsubstituted template placeholder.
  for (const [name, required] of [['llms.txt', LLMS_REQUIRED], ['llm.txt', LLMS_REQUIRED],
    ['llms-full.txt', LLMS_FULL_REQUIRED]]) {
    let txt;
    try {
      txt = await readFile(join(DIST, name), 'utf8');
    } catch {
      failures.push(`/${name} was not written — AI crawlers request it and would get a 404.`);
      continue;
    }
    const missing = required.filter((s) => !txt.includes(s));
    if (missing.length)
      failures.push(`/${name} is missing required section(s): ${missing.map((s) => s.trim()).join(', ')}`);
    if (txt.includes('{{'))
      failures.push(`/${name} contains an unsubstituted {{...}} placeholder.`);
    // A section heading with nothing under it is the failure mode a silently-emptied
    // source array produces, and it reads as a complete file.
    for (const h of required.filter((s) => s.startsWith('##'))) {
      const body = (txt.split(h)[1] || '').split('\n## ')[0].trim();
      if (body.length < 40) failures.push(`/${name}: section "${h}" is empty or near-empty.`);
    }
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
  if (badAnswers.length)
    failures.push(`${badAnswers.length} /data/ page(s) lack a usable one-sentence computed answer under the H1:` + list(badAnswers));
  if (!dataPages)
    failures.push('dist/ contains no /data/ reference pages at all — the citation kit did not build.');

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
