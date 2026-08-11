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

// --- The published salary-ladder dataset. It is a citable artefact: other people
// are invited to download it and quote it, so a truncated, short-of-a-state or
// quietly-wrong file is worse than no file. Three things are checked, and the
// third is the one that matters:
//   1. it exists and parses as a rectangle with the expected header;
//   2. it covers exactly LADDER_JURISDICTIONS jurisdictions, each carrying the
//      identical set of salary rungs (a state missing one rung, or one state
//      short, means the generator silently dropped rows);
//   3. EVERY row is RE-COMPUTED here from the engine and the tax data,
//      independently of build.js, and must match the published figures to the
//      dollar. A CSV whose numbers came from a stale build, a hand edit or a
//      different filing status passes checks 1 and 2 without complaint. This was
//      a spread-out sample of six rows; it is now all 459, because a sample lets
//      a one-row corruption through and the full pass measures under a second.
const LADDER_CSV = 'take-home-pay-ladder-2026.csv';
const LADDER_HUB_CSV = 'take-home-pay-ladder-by-state-2026.csv';
const LADDER_HEADER = 'State,Abbr,Gross salary,Federal income tax,FICA,State income tax,' +
  'State payroll programs,Annual take-home,Total effective tax rate,Page';
// The hub header's money columns carry a formatted salary ("Take-home at $30,000"),
// so the cells are comma-quoted and the header must be parsed, not string-matched.
const LADDER_HUB_HEADER_CELLS = [/^State$/, /^Abbr$/, /^Take-home at \$[\d,]+$/,
  /^Effective rate at \$[\d,]+$/, /^Take-home at \$[\d,]+$/, /^Effective rate at \$[\d,]+$/,
  /^Extra take-home over the climb$/, /^Share of the extra gross kept$/, /^Hub page$/];
const LADDER_JURISDICTIONS = 51;
// Cap on how many individual mismatches are listed before the failure message is
// truncated. Every row is still checked; this only bounds the output.
const LADDER_MAX_REPORTED = 12;

// --- The 2027 seasonal pages. Two of them publish a position about data that
// does not exist yet, which is a different kind of risk from a wrong number: the
// failure mode is a page that quietly stops saying "projected" or starts showing
// dollar amounts it has no inputs for. Neither would look broken. Both are
// checked here, against the same data file the build reads, so this gate is
// independent of whatever build.js believed at the time.
//
// PROJECTED_PAGE must carry the label everywhere a reader could land, and must
// carry NO dollar figure in its projection region while any window month is
// unpublished. COLA_PAGE must carry a working calculator, because the calculator
// is the entire reason that page is publishable before the data exists.
const PROJECTED_PAGE = '2027-tax-brackets';
const COLA_PAGE = '2027-social-security-cola';
const WAGEBOX_PAGE = 'w2-box-1-vs-box-3-vs-box-5';
// Any US dollar amount on the page. Every match is then filtered by SIZE: the
// page legitimately quotes the statutory rounding increments ($25 and $50) and
// the additional-Medicare threshold, which are rules rather than projections,
// while every figure a projection would produce — a bracket threshold, a
// standard deduction — is in the thousands. So anything at or above
// PROJECTION_FLOOR is treated as a projected amount and fails. Deliberately
// crude in that direction: a false positive costs a build, a miss ships a
// fabricated tax figure.
const DOLLAR_FIGURE = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const PROJECTION_FLOOR = 1000;

/**
 * Gate the 2027 seasonal pages.
 * @param {string} DIST dist directory
 * @param {string} ROOT repo root (holds src/data and src/engine)
 * @returns {Promise<string[]>} failures, empty when good
 */
async function verifySeasonal2027(DIST, ROOT) {
  const fails = [];
  const readPage = async (slug) => {
    try { return await readFile(join(DIST, slug, 'index.html'), 'utf8'); } catch { return null; }
  };

  let proj;
  try {
    proj = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'projections-2027.json'), 'utf8'));
  } catch (e) {
    fails.push(`cannot read src/data/projections-2027.json (${e.message}) — the 2027 pages have no inputs.`);
    return fails;
  }
  // Re-derive completeness here rather than trusting the page. Every non-null
  // month must also carry its citation, which is the standing rule that no
  // number reaches a page without a sourceUrl and a publishedDate.
  const months = proj.ccpiu.months;
  const keys = Object.keys(months).sort();
  const missing = keys.filter((k) => months[k] === null);
  for (const k of keys) {
    const m = months[k];
    if (m === null) continue;
    if (!Number.isFinite(m.value) || !m.sourceUrl || !m.publishedDate)
      fails.push(`projections-2027.json: month ${k} has a value without a complete citation ` +
        '(sourceUrl + publishedDate). Source fields are user-facing; an uncited figure must not ship.');
  }
  const windowComplete = missing.length === 0;

  // --- the projected brackets page
  const p27 = await readPage(PROJECTED_PAGE);
  if (!p27) {
    fails.push(`/${PROJECTED_PAGE}/ was not written.`);
  } else {
    const title = (/<title>([\s\S]*?)<\/title>/.exec(p27) || [])[1] || '';
    const h1 = (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(p27) || [])[1] || '';
    const desc = (/<meta name="description" content="([^"]*)"/.exec(p27) || [])[1] || '';
    if (!/PROJECTED/i.test(title)) fails.push(`/${PROJECTED_PAGE}/: <title> does not say PROJECTED.`);
    if (!/projected/i.test(h1)) fails.push(`/${PROJECTED_PAGE}/: <h1> does not say projected.`);
    if (!/projected/i.test(desc)) fails.push(`/${PROJECTED_PAGE}/: meta description does not say projected.`);
    if (!p27.includes('PROJECTED')) fails.push(`/${PROJECTED_PAGE}/: the PROJECTED status banner is gone.`);
    // Structured data must not assert authority. The site injects its own
    // Organization / WebSite / BreadcrumbList nodes on every page and those are
    // fine; what must never appear here is a type that presents unofficial
    // projections as answered questions or as a published dataset.
    const BANNED_LD = new Set(['FAQPage', 'HowTo', 'Dataset', 'QAPage', 'Table']);
    const ldTypes = [];
    for (const m of p27.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let node;
      try { node = JSON.parse(m[1]); } catch { fails.push(`/${PROJECTED_PAGE}/: unparseable JSON-LD.`); continue; }
      const collect = (n) => {
        if (Array.isArray(n)) return n.forEach(collect);
        if (!n || typeof n !== 'object') return;
        if (n['@type']) ldTypes.push(...[].concat(n['@type']));
        if (n['@graph']) collect(n['@graph']);
      };
      collect(node);
    }
    const banned = ldTypes.filter((t) => BANNED_LD.has(t));
    if (banned.length)
      fails.push(`/${PROJECTED_PAGE}/: JSON-LD declares ${[...new Set(banned)].join(', ')}. A page of ` +
        'figures that are not official must not emit structured data that presents them as answers or data.');
    if (!ldTypes.includes('Article'))
      fails.push(`/${PROJECTED_PAGE}/: no Article JSON-LD node; the page must describe itself as an article, ` +
        'not as authoritative tax data.');
    if (!windowComplete) {
      // The load-bearing check. Everything above the sources/related/footer
      // furniture is the page's own body; no dollar amount may appear in it.
      const body = p27.split('<section class="sources">')[0].split('<footer class="site">')[0];
      const found = [...new Set(body.match(DOLLAR_FIGURE) || [])]
        .filter((s) => Number(s.replace(/[$,\s]/g, '')) >= PROJECTION_FLOOR);
      if (found.length)
        fails.push(`/${PROJECTED_PAGE}/ shows ${found.length} dollar figure(s) while ${missing.length} of ` +
          `${keys.length} required month(s) are unpublished (${missing.join(', ')}): ` +
          list(found) + '\n    A dollar amount on this page right now can only have come from a guess.');
      if (!/not publishing projected dollar figures yet/i.test(p27))
        fails.push(`/${PROJECTED_PAGE}/: partial-data mode is active but the page does not say so in ` +
          'the words a reader would recognise ("not publishing projected dollar figures yet").');
      for (const k of missing)
        if (!p27.includes(k.slice(0, 4)))
          fails.push(`/${PROJECTED_PAGE}/: unpublished month ${k} is not named on the page.`);
    }
  }

  // --- the COLA page: the calculator is what makes it publishable today
  const cola = await readPage(COLA_PAGE);
  if (!cola) {
    fails.push(`/${COLA_PAGE}/ was not written.`);
  } else {
    if (!/ESTIMATE/.test(cola)) fails.push(`/${COLA_PAGE}/: the ESTIMATE banner is gone.`);
    if (!/id="benefit"/.test(cola) || !/id="colaPct"/.test(cola))
      fails.push(`/${COLA_PAGE}/: the benefit calculator inputs are missing — that calculator is the ` +
        'only part of this page that works before the data exists, so without it the page is a stub.');
    // The asset filename is content-hashed at build time, so match the stem.
    if (!/\/assets\/2027-social-security-cola\.[\w.]*js/.test(cola))
      fails.push(`/${COLA_PAGE}/: the calculator script is not loaded, so the inputs do nothing.`);
    for (const id of ['newMonthly', 'monthlyUp', 'annualUp', 'newAnnual'])
      if (!cola.includes(`id="${id}"`))
        fails.push(`/${COLA_PAGE}/: calculator output element #${id} is missing; the script writes to it.`);
    // Third-party figures must never read as ours.
    for (const e of proj.cpiw.thirdPartyEstimates) {
      if (!cola.includes(e.publisher))
        fails.push(`/${COLA_PAGE}/: the ${e.figure}% estimate is shown without naming ${e.publisher}. ` +
          'Somebody else\'s forecast must always carry their name.');
      if (!cola.includes(e.sourceUrl))
        fails.push(`/${COLA_PAGE}/: no link to the source of ${e.publisher}'s estimate.`);
    }
  }

  // --- the wage-box page: it must actually be about Box 3 and Box 5, i.e. it
  // must not have collapsed into a duplicate of the existing Box 12 decoder.
  const wb = await readPage(WAGEBOX_PAGE);
  if (!wb) {
    fails.push(`/${WAGEBOX_PAGE}/ was not written.`);
  } else {
    for (const needle of ['Box 3', 'Box 5', 'id="gross"', 'id="r401k"', 'id="s125"'])
      if (!wb.includes(needle))
        fails.push(`/${WAGEBOX_PAGE}/: missing "${needle}" — the page is not the reconciliation tool.`);
    if (!wb.includes('/w2-box-decoder/'))
      fails.push(`/${WAGEBOX_PAGE}/: does not link to /w2-box-decoder/; the two W-2 pages must ` +
        'cross-link or they read as duplicates of each other.');
    const decoder = await readPage('w2-box-decoder');
    if (decoder && !decoder.includes(`/${WAGEBOX_PAGE}/`))
      fails.push(`/w2-box-decoder/: does not link back to /${WAGEBOX_PAGE}/.`);
  }

  return fails;
}

// Minimal RFC-4180 line splitter — enough for this file, which quotes only on
// commas inside state names it does not currently have.
function csvSplit(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Structural + arithmetic check on the published ladder CSVs.
 * @param {string} DIST dist directory
 * @param {string} ROOT repo root (holds src/engine and src/data)
 * @returns {Promise<string[]>} failures, empty when good
 */
async function verifyLadderCsv(DIST, ROOT) {
  const fails = [];
  let text;
  try {
    text = await readFile(join(DIST, 'data', LADDER_CSV), 'utf8');
  } catch {
    fails.push(`/data/${LADDER_CSV} was not written — the linkable ladder dataset is missing, ` +
      'and the Dataset JSON-LD on /data/take-home-pay-by-state/ points at a 404.');
    return fails;
  }
  const lines = text.trim().split('\n');
  if (lines[0] !== LADDER_HEADER) {
    fails.push(`/data/${LADDER_CSV} header changed: expected "${LADDER_HEADER}", got "${lines[0]}". ` +
      'Anyone consuming the published file parses by column, so update this gate deliberately.');
    return fails;
  }
  const rows = lines.slice(1).map(csvSplit);
  const bad = rows.filter((r) => r.length !== 10).length;
  if (bad) fails.push(`/data/${LADDER_CSV} has ${bad} row(s) that are not 10 columns wide (truncated write).`);

  const byState = new Map();
  for (const r of rows) {
    if (!byState.has(r[0])) byState.set(r[0], []);
    byState.get(r[0]).push(Number(r[2]));
  }
  if (byState.size !== LADDER_JURISDICTIONS)
    fails.push(`/data/${LADDER_CSV} covers ${byState.size} jurisdictions, expected ${LADDER_JURISDICTIONS} ` +
      '(50 states plus the District of Columbia).');
  const rungs = [...(byState.values().next().value || [])].sort((a, b) => a - b);
  if (rungs.length < 5)
    fails.push(`/data/${LADDER_CSV} carries only ${rungs.length} salary rung(s) per state — the ladder did not build.`);
  const shortStates = [...byState].filter(([, s]) =>
    s.length !== rungs.length || [...s].sort((a, b) => a - b).join(',') !== rungs.join(','));
  if (shortStates.length)
    fails.push(`${shortStates.length} state(s) in /data/${LADDER_CSV} do not carry the same ${rungs.length} ` +
      `salary rungs as the rest:` + list(shortStates.map(([n, s]) => `${n} (${s.length} rows)`)));
  const expectedRows = LADDER_JURISDICTIONS * rungs.length;
  if (rows.length !== expectedRows && !shortStates.length && byState.size === LADDER_JURISDICTIONS)
    fails.push(`/data/${LADDER_CSV} has ${rows.length} data rows, expected ${expectedRows}.`);

  // --- Re-computation. Independent of build.js: this imports the engine and the
  // tax data itself and asks for the same paycheck the CSV row claims.
  if (!rows.length) return fails;
  let computePaycheck, taxData;
  try {
    ({ computePaycheck } = await import(pathToFileURL(join(ROOT, 'src', 'engine', 'paycheck-engine.js')).href));
    taxData = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'tax-data-2026.json'), 'utf8'));
  } catch (e) {
    fails.push(`cannot re-compute /data/${LADDER_CSV}: ${e.message}`);
    return fails;
  }
  const slugOf = new Map(Object.entries(taxData.states).map(([slug, s]) => [s.name, slug]));
  const mismatches = [];
  // EVERY row, not a sample. `checked` is reported so a gate that silently stopped
  // checking (an early return, an empty file) cannot look like a pass.
  let checked = 0;
  for (let i = 0; i < rows.length; i++) {
    if (mismatches.length >= LADDER_MAX_REPORTED) break;
    const r = rows[i];
    checked++;
    const slug = slugOf.get(r[0]);
    if (!slug) { mismatches.push(`row ${i + 2}: "${r[0]}" is not a state in tax-data-2026.json`); continue; }
    const a = computePaycheck({
      wage: { type: 'salary', amount: Number(r[2]) },
      filingStatus: 'single', payFrequency: 'annual', stateSlug: slug,
    }, taxData).annual;
    const want = {
      'federal income tax': Math.round(a.federal),
      FICA: Math.round(a.socialSecurity + a.medicare),
      'state income tax': Math.round(a.state),
      'state payroll programs': Math.round(a.statePrograms),
      'annual take-home': Math.round(a.net),
    };
    const got = [Number(r[3]), Number(r[4]), Number(r[5]), Number(r[6]), Number(r[7])];
    Object.entries(want).forEach(([label, v], k) => {
      if (v !== got[k])
        mismatches.push(`${r[0]} @ $${r[2]}: ${label} published ${got[k]}, engine computes ${v}`);
    });
    const rate = ((Number(r[2]) - a.net) / Number(r[2]) * 100).toFixed(2) + '%';
    if (rate !== r[8])
      mismatches.push(`${r[0]} @ $${r[2]}: effective rate published ${r[8]}, engine computes ${rate}`);
  }
  if (mismatches.length)
    fails.push(`/data/${LADDER_CSV} does not reproduce from the engine (${checked} of ${rows.length} rows ` +
      `checked) — the published dataset is wrong:` + list(mismatches));

  // --- The hub-level cut. Every one of its numbers is a restatement of two rung
  // rows, so it is checked by RE-DERIVING it from the rung rows above rather than
  // by counting its lines: a summary that disagrees with the detail file it
  // summarises is the failure worth catching, and a row count never sees it.
  // The rung rows are trustworthy at this point because they just reproduced from
  // the engine.
  let hubLines;
  try {
    hubLines = (await readFile(join(DIST, 'data', LADDER_HUB_CSV), 'utf8')).trim().split('\n');
  } catch {
    fails.push(`/data/${LADDER_HUB_CSV} was not written — the per-state ladder summary is missing.`);
    return fails;
  }
  const hubHead = csvSplit(hubLines[0]);
  const headBad = LADDER_HUB_HEADER_CELLS
    .map((re, i) => (re.test(hubHead[i] || '') ? null : `column ${i + 1}: "${hubHead[i] || ''}"`))
    .filter(Boolean);
  if (hubHead.length !== LADDER_HUB_HEADER_CELLS.length || headBad.length)
    fails.push(`/data/${LADDER_HUB_CSV} header changed (${hubHead.length} columns, expected ` +
      `${LADDER_HUB_HEADER_CELLS.length}). Anyone consuming the published file parses by column, so ` +
      'update this gate deliberately:' + list(headBad.length ? headBad : ['column count']));
  const hubRows = hubLines.slice(1).map(csvSplit);
  if (hubRows.length !== LADDER_JURISDICTIONS)
    fails.push(`/data/${LADDER_HUB_CSV} has ${hubRows.length} data rows, expected one per jurisdiction ` +
      `(${LADDER_JURISDICTIONS}).`);
  const lowAmt = rungs[0];
  const highAmt = rungs[rungs.length - 1];
  // state -> salary -> the rung row, for the two ends the summary restates.
  const rungAt = new Map();
  for (const r of rows) rungAt.set(`${r[0]}|${r[2]}`, r);
  const hubBad = [];
  for (const h of hubRows) {
    if (hubBad.length >= LADDER_MAX_REPORTED) break;
    const lo = rungAt.get(`${h[0]}|${lowAmt}`);
    const hi = rungAt.get(`${h[0]}|${highAmt}`);
    if (!lo || !hi) { hubBad.push(`${h[0]}: no matching rung rows in ${LADDER_CSV}`); continue; }
    const want = [lo[7], lo[8], hi[7], hi[8],
      String(Number(hi[7]) - Number(lo[7])),
      (((Number(hi[7]) - Number(lo[7])) / (highAmt - lowAmt)) * 100).toFixed(2) + '%'];
    const labels = [`take-home at $${lowAmt}`, `effective rate at $${lowAmt}`,
      `take-home at $${highAmt}`, `effective rate at $${highAmt}`,
      'extra take-home over the climb', 'share of the extra gross kept'];
    want.forEach((v, k) => {
      if (h[k + 2] !== v)
        hubBad.push(`${h[0]}: ${labels[k]} published ${h[k + 2]}, the rung rows give ${v}`);
    });
  }
  if (hubBad.length)
    fails.push(`/data/${LADDER_HUB_CSV} does not re-derive from /data/${LADDER_CSV} — the summary and the ` +
      'detail file disagree:' + list(hubBad));
  return fails;
}

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

  // The published, citable salary-ladder CSVs, re-derived from the engine.
  // ROOT is this script's repo, not the dist under test, because the engine and
  // the tax data are what the file is being checked AGAINST.
  failures.push(...await verifyLadderCsv(DIST, join(dirname(fileURLToPath(import.meta.url)), '..')));

  // The 2027 seasonal pages, checked against the data file rather than against
  // what the build thought it was doing.
  failures.push(...await verifySeasonal2027(DIST, join(dirname(fileURLToPath(import.meta.url)), '..')));

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
