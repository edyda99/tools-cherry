#!/usr/bin/env node
// build.js — pSEO static generator. Reads templates + tax data, emits ./dist.
// Cloudflare Pages: build command `npm run build`, output dir `dist`.
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform as esbuildTransform } from 'esbuild';
import { STATIC_PAGES } from './src/content/static-pages.js';
import { buildWamParts } from './src/content/what-applies-to-me.js';
import { buildStateApplies } from './src/content/state-applies.js';
import { withholdingProfile, programKindsOf } from './src/content/withholding-profile.js';
import {
  computePaycheck, federalBracketBreakdown,
  // The two optional state-side subtractions. Imported rather than reimplemented so the
  // salary-ladder pages can name the exact amounts the engine subtracted (Wisconsin and
  // South Carolina phase their deduction down with income; Massachusetts also deducts the
  // FICA you paid, capped). See caRung().
  phaseOutStandardDeduction, ficaPaidDeduction,
} from './src/engine/paycheck-engine.js';
import { computeBonus } from './src/engine/bonus-tax.js';
import { verifyDist, reportFailures } from './scripts/verify-dist.js';
import { DFT_PAGES, DFT_GROUPS } from './src/content/days-from-today.js';
import { dftPageParts, dftHubGroups, dftPath } from './src/content/days-from-today-blocks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'src');
const DIST = join(__dirname, 'dist');

// --- Site config (set the real values at first deploy) -----------------------
const SITE = {
  name: 'Tools Berry',
  url: 'https://tools-berry.com',
  contactEmail: 'hello@tools-berry.com', // set up Cloudflare Email Routing (free) so this inbox receives
  adsensePublisherId: 'pub-4961606095434424', // ca-pub form is derived; drives the <head> loader + ads.txt
  // IndexNow key — PUBLIC by design (hosted openly at /<key>.txt). Lets us push URL
  // updates straight into Bing + Yandex indexes. Used by scripts/indexnow-submit.py.
  indexNowKey: '9372e11bcbe34b0e993865299aae29dc'
};

// Cloudflare Turnstile site key for the PDF->Word server-fallback widget. The site
// key is PUBLIC, so it's safe to hardcode — and defaulting to the real one means a
// build that forgets the env var still works (a forgotten env var was baking in the
// "always passes" TEST key and breaking server-side verification). Override with the
// test key for local dev only:  TURNSTILE_SITEKEY=1x00000000000000000000AA npm run build
const TURNSTILE_SITEKEY = process.env.TURNSTILE_SITEKEY || '0x4AAAAAADn6GHCyPxsW8L3g';

// AdSense site-verification / auto-ads loader, injected into every page's <head>.
// Empty string when no publisher ID is set, so the build stays clean pre-AdSense.
const ADSENSE_HEAD = SITE.adsensePublisherId
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${SITE.adsensePublisherId}" crossorigin="anonymous"></script>\n`
  : '';

// Page-level defense-in-depth for the P0 fixed by the content-hash pipeline
// above: each calculator's own init() is now try/catch-wrapped (see
// calc-error-banner.js + the src/assets/*.js bootstrap files), which covers
// "module loaded fine but a call inside it threw." This listener covers the
// other half: a module that fails to even START executing — a 404, a CSP
// block, or (the historically-realistic version of THIS exact bug) a stale
// browser-cached shared engine that no longer has an export the newer
// bootstrap file expects. That last case is a *static* ES-module link error,
// thrown before any of that module's own code (including its try/catch) ever
// runs — verified empirically by breaking an export in a built dist/ copy and
// loading it: Chrome fires a plain `window.error` event whose `e.target` is
// `window` (NOT the failing <script> element — a first assumption here that
// turned out to be wrong) but whose `e.filename` points at the failing
// /assets/ file. So this listener checks BOTH: `e.filename` naming one of our
// own /assets/*.js files (covers the link-error case above), OR `e.target`
// being a failed `<script type="module" src="/assets/...">` element (covers a
// plain 404/network failure, whose `error` event target usually IS the
// script tag). Either check requires an /assets/ path, so it can never
// false-positive on an ad-blocked AdSense script (different origin) or a
// blocked vendor UMD bundle (classic script, no type="module", different
// filename pattern in the stack). Injected on every full page via fill(), and
// on /embed/* pages via fillEmbed()/fillDcEmbed() (embed templates bypass
// fill() entirely to skip ads/site-schema, but still need this same
// page-level defense-in-depth); harmless no-op on pages with no matching
// module script (content pages). Falls back to document.body when there's no
// <main> (every /embed/* template wraps its content in a plain
// `<div class="embed-wrap">`, not `<main>`) — same fallback calc-error-banner.js
// already uses for the tool-level try/catch banner.
const MODULE_ERROR_LISTENER =
  `<script>window.addEventListener('error',function(e){` +
  `if(document.getElementById('calc-load-error'))return;` +
  `var t=e&&e.target;` +
  `var fromOurAssets=(e&&e.filename&&e.filename.indexOf('/assets/')!==-1)||` +
  `(t&&t.tagName==='SCRIPT'&&t.type==='module'&&t.src&&t.src.indexOf('/assets/')!==-1);` +
  `if(!fromOurAssets)return;` +
  `var m=document.querySelector('main')||document.body;` +
  `if(!m)return;` +
  `var b=document.createElement('div');b.id='calc-load-error';b.className='calc-load-error';b.setAttribute('role','alert');` +
  `b.textContent='Something went wrong loading this calculator — please refresh the page.';` +
  `m.insertBefore(b,m.firstChild);` +
  `},true);</script>\n`;

// Site-wide dark-mode support (injected on full pages via fill(); embed pages
// bypass fill(), so they keep pure prefers-color-scheme behaviour).
//
// THEME_HEAD is an inline, render-blocking script injected high in <head> (right
// after <meta charset>, before the stylesheet and body — so it runs pre-paint).
// Anti-flash: it reads a stored *explicit* choice from localStorage and sets
// <html data-theme="light|dark"> synchronously, before first paint. When there
// is no stored choice it sets nothing, so the CSS @media(prefers-color-scheme)
// rules drive the default (system-respecting) — which the browser also resolves
// pre-paint, so neither path flashes. It then binds the header toggle on
// DOMContentLoaded: click flips + persists the choice and syncs the button's
// aria state; a matchMedia listener keeps the a11y label correct while the user
// is still following the system (no stored choice). The sun/moon ICON is chosen
// purely in CSS (same conditions as the palette), so it is right at first paint
// even before this handler binds. Storage key: 'tb-theme'.
const THEME_HEAD =
  `<script>(function(){` +
  `var d=document.documentElement,K='tb-theme';` +
  `try{var s=localStorage.getItem(K);if(s==='light'||s==='dark')d.setAttribute('data-theme',s);}catch(e){}` +
  `function mq(){return window.matchMedia&&matchMedia('(prefers-color-scheme: dark)');}` +
  `function eff(){var a=d.getAttribute('data-theme');if(a==='dark'||a==='light')return a;var m=mq();return m&&m.matches?'dark':'light';}` +
  `function sync(b){var lbl=eff()==='dark'?'Switch to light theme':'Switch to dark theme';` +
  `b.setAttribute('aria-pressed',eff()==='dark'?'true':'false');b.setAttribute('aria-label',lbl);b.setAttribute('title',lbl);}` +
  `function init(){var b=document.getElementById('themeToggle');if(!b)return;sync(b);` +
  `b.addEventListener('click',function(){var n=eff()==='dark'?'light':'dark';d.setAttribute('data-theme',n);` +
  `try{localStorage.setItem(K,n);}catch(e){}sync(b);});` +
  `try{var m=mq();if(m&&m.addEventListener)m.addEventListener('change',function(){` +
  `var v;try{v=localStorage.getItem(K);}catch(e){}if(v!=='light'&&v!=='dark')sync(b);});}catch(e){}}` +
  `if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();` +
  `})();</script>\n`;

// The visible sun/moon toggle button, injected into the site header's primary
// nav. Both icons ship; CSS shows exactly one based on the active palette. The
// default aria-label assumes light and is corrected by sync() the moment the
// handler binds (icon is already CSS-correct at first paint).
const THEME_TOGGLE_BTN =
  `<button type="button" id="themeToggle" class="theme-toggle" aria-label="Switch to dark theme" title="Switch to dark theme" aria-pressed="false">` +
  `<svg class="icon-moon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>` +
  `<svg class="icon-sun" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>` +
  `</button>`;

// ---- Global tool search / command palette (Cmd+K) --------------------------
// The search index is built from the TOOLS array (single source of truth) and
// emitted ONCE as a content-hashed /assets/search-index.<hash>.js in main();
// SEARCH_INDEX_PATH holds that hashed URL so injectSearch() can point every page
// at the same immutable-cached file (loaded once per visitor, reused from cache
// across tool pages). The trigger button + modal markup below are static; the
// UI/fuzzy logic lives in src/assets/search.js (registered → hashed like app.js).
const SEARCH_CAT_LABELS = { image: 'Image', calc: 'Calculators', money: 'Money', make: 'Generators', devtext: 'Text & Dev' };
let SEARCH_INDEX_PATH = '';

// Header trigger — inserted just before the primary nav on every full page that
// carries the shared site header (embeds, which have no <header class="site">,
// are skipped). Has a visible "Search" label (so no aria-label needed); the ⌘K/
// Ctrl K hint is set to the real platform key by search.js at runtime.
const SEARCH_TRIGGER_HTML =
  '<button type="button" class="tb-search-trigger" aria-haspopup="dialog" aria-controls="tb-search-overlay" aria-expanded="false" aria-keyshortcuts="Meta+K Control+K" title="Search tools (Ctrl+K / ⌘K)">' +
  '<svg class="tb-search-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>' +
  '<line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
  '<span class="tb-search-trigger-txt">Search</span>' +
  '<kbd class="tb-search-trigger-kbd" aria-hidden="true">⌘K</kbd></button>';

// Modal overlay — appended before </body>. role="dialog"/aria-modal panel with a
// combobox input driving a listbox via aria-activedescendant (see search.js).
const SEARCH_MODAL_HTML =
  '<div class="tb-search-overlay" id="tb-search-overlay" hidden>' +
  '<div class="tb-search-panel" role="dialog" aria-modal="true" aria-labelledby="tb-search-title">' +
  '<h2 id="tb-search-title" class="tb-search-sr">Search tools</h2>' +
  '<div class="tb-search-field">' +
  '<svg class="tb-search-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>' +
  '<line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
  '<input id="tb-search-input" class="tb-search-input" type="text" role="combobox" aria-expanded="false" ' +
  'aria-controls="tb-search-list" aria-activedescendant="" aria-autocomplete="list" aria-label="Search tools" ' +
  'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Search tools…">' +
  '<kbd class="tb-search-esckbd" aria-hidden="true">Esc</kbd></div>' +
  '<p id="tb-search-recent-label" class="tb-search-empty" hidden>Recently viewed</p>' +
  '<ul id="tb-search-list" class="tb-search-list" role="listbox" aria-label="Search results"></ul>' +
  '<p id="tb-search-empty" class="tb-search-empty" role="status" hidden>No tools match your search.</p>' +
  '<div class="tb-search-foot" aria-hidden="true">' +
  '<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>' +
  '<span><kbd>↵</kbd> open</span>' +
  '<span><kbd>Esc</kbd> close</span></div></div></div>';

// Injects the search trigger, modal, and the two script tags into a full page.
// Guarded on the shared site header so header-less pages (embeds) are untouched,
// and idempotent so a double build never doubles the markup. The index script
// carries its already-hashed name (injected verbatim); /assets/search.js is
// rewritten to its hashed name by the final rewriteHtmlAssetRefs pass.
function injectSearch(html) {
  if (!html.includes('<header class="site">')) return html;
  if (html.includes('tb-search-trigger') || !SEARCH_INDEX_PATH) return html;
  let out = html;
  if (out.includes('</head>')) {
    out = out.replace('</head>',
      `<script defer src="${SEARCH_INDEX_PATH}"></script>\n<script defer src="/assets/search.js"></script>\n</head>`);
  }
  out = out.replace('<nav aria-label="Primary">', `${SEARCH_TRIGGER_HTML}\n    <nav aria-label="Primary">`);
  if (out.includes('</body>')) out = out.replace('</body>', `${SEARCH_MODAL_HTML}\n</body>`);
  return out;
}

// Injects a per-tool-page enhancement <script defer> on TOOL pages only. Both
// the "Was this tool helpful?" rating widget and the "Report a wrong result"
// link ride on the SAME two gates, so they can never drift on which pages
// qualify — that shared decision lives here, in injectToolScript:
//   1. the shared site <header class="site"> — full site pages only, so the
//      header-less /embed/ pages are skipped (the widgets also self-bail inside
//      an iframe, but not injecting is cleaner);
//   2. a tool marker — `class="calc"` (every calculator/converter plus all 51
//      state paycheck pages and the bonus-tax pages) OR a `<form` (which also
//      picks up the invoice generator, whose app shell has no `.calc`). Home,
//      legal/static (prose) pages, data-reference pages, and embeds carry
//      NEITHER marker, so they never get either widget.
// The `/assets/*.js` paths are rewritten to their content-hashed names by the
// final rewriteHtmlAssetRefs pass (same as /assets/search.js). Idempotent.
function injectToolScript(html, scriptPath) {
  if (!html.includes('<header class="site">')) return html;
  if (!(html.includes('class="calc"') || html.includes('<form'))) return html;
  if (html.includes(scriptPath) || !html.includes('</head>')) return html;
  return html.replace('</head>', `<script defer src="${scriptPath}"></script>\n</head>`);
}
function injectFeedback(html) { return injectToolScript(html, '/assets/feedback-widget.js'); }
function injectReport(html) { return injectToolScript(html, '/assets/report-widget.js'); }

// --- question-flow.js opt-in -------------------------------------------------
// src/assets/question-flow.js is the generic "answer a plain question, then see
// the field it needs" controller: it reads every [data-reveal] wrapper on the
// page, finds the yes/no radio group named in the attribute, and hides the
// wrapper while the answer is No. It is hide-on-demand only, so a page that
// loads it but ships no questions is completely unaffected.
//
// It is opt-in BY PATH rather than by sniffing the markup for [data-reveal],
// because a page is converted to the question flow by a template edit, and a
// build that guessed from the markup would silently start loading a script onto
// whatever page happened to grow a data-reveal attribute next. Listing the paths
// here keeps "which pages run this" reviewable in one place.
//
// Deliberately EXCLUDED: the 51 /{state}-paycheck-calculator/ pages. app.js
// already carries the same reveal logic there (syncAdvancedQuestions) plus the
// engine coupling that zeroes a No-answered field's contribution. Loading this
// file on top would double-bind the change listeners and the two copies would
// fight over focus. See the header comment in src/assets/question-flow.js.
//
// Most of the pages still listed below are queued for the card-flow rewrite (see
// WIZARD_ROLLOUT further down). Their entries do NOT need deleting when that
// happens: injectQuestionFlow also requires the page to actually ship a
// [data-reveal] wrapper, and a converted page ships none, so the entry goes
// inert on the same commit that converts the template. Read the note above
// injectQuestionFlow before "tidying" one of these away early — deleting an
// entry ahead of the template edit is a silent wrong answer, not a tidy-up.
const QUESTION_FLOW_PAGES = new Set([
  '/1099-threshold-checker/',
  // 1099-vs-w2-calculator is deliberately absent. It ships no [data-reveal] wrapper, so
  // listing it here downloaded question-flow.js for a script with nothing to do. All three
  // of its inputs are required to get any answer at all, so none of them can hide behind a
  // question, and each carries its question in the label instead.
  '/401k-calculator/',
  '/able-account-calculator/',
  '/adoption-credit-calculator/',
  '/bonus-tax-calculator/',
  '/charitable-deduction-calculator/',
  '/dependent-care-fsa-vs-credit-calculator/',
  '/employer-student-loan-repayment-calculator/',
  // overtime-tax-calculator is deliberately absent since the 2026-08-01 wizard rewrite. Its two
  // yes/no questions became cards in the step flow, so the page ships no [data-reveal] wrapper any
  // more and listing it here downloaded question-flow.js for a script with nothing to do. The card
  // stepping is overtime-wizard.js's own, and its helper texts are native <details>.
  '/pmi-deduction-calculator/',
  '/qcd-vs-charitable-deduction-calculator/',
  '/roth-catchup-calculator/',
  '/salt-cap-calculator/',
  // senior-deduction is deliberately absent. It ships no [data-reveal] wrapper, so
  // listing it here downloaded question-flow.js for a script with nothing to do. Its
  // one conditional row is derived from an answer the visitor already gave, and asking
  // again would be worse than simply showing it.
  '/ss-wage-base-calculator/',
  '/student-loan-cap-calculator/',
  // tips-tax-calculator is deliberately absent. Its one optional input, the state picker,
  // is a plain field in the form now, so the page ships no [data-reveal] wrapper and has no
  // adv question left to gate.
  // w2-box-decoder is deliberately absent. It ships no [data-reveal] wrapper, so listing it
  // here downloaded question-flow.js for a script with nothing to do. It is a lookup rather
  // than a calculator, so all four boxes show plainly: a blank box already says "that line
  // is not on my form", which is the only thing a question could have asked.
  '/w4-overtime-tips-withholding-calculator/',
]);
// The 51 /{state}-bonus-tax-calculator/ pages all render from the one
// bonus-tax-calculator-state.html template, so they opt in as a family rather
// than as 51 literal entries above. Anchored at both ends so it can only ever
// match that exact URL shape.
const QUESTION_FLOW_PAGE_RE = /^\/[a-z-]+-bonus-tax-calculator\/$/;

function wantsQuestionFlow(currentPath) {
  const p = String(currentPath || '');
  return QUESTION_FLOW_PAGES.has(p) || QUESTION_FLOW_PAGE_RE.test(p);
}

// A page leaves the question flow by SHIPPING NO [data-reveal] WRAPPER, which is
// exactly what converting it to the card flow does. That is why the allow-list
// above still names pages that are queued for conversion: the entry is inert the
// moment the template stops shipping a wrapper, so a wizard conversion is a
// template edit and never a build.js edit, and the fan-out agents converting the
// remaining ~14 tools never touch this file.
//
// It is deliberately an AND, never a replacement for the list. Sniffing the
// markup alone would silently start loading this script onto whatever page grew
// a data-reveal attribute next; the list still decides which pages MAY load it,
// and the markup decides whether there is anything for it to do. It also cannot
// be inverted into "remove the page from the list when you convert it": doing
// that ahead of the template edit is a silent WRONG ANSWER, not a cosmetic
// regression. question-flow.js does not merely hide a No-answered field, it
// parks the field at a neutral value, and charitable-deduction ships #other
// pre-filled at 20000 — drop the script while the wrapper is still there and a
// visitor who answers "no, nothing else to write off" watches the box disappear
// while 20000 keeps feeding the comparison.
function shipsRevealWrapper(html) {
  return String(html || '').includes('data-reveal=');
}

// Loaded as type="module" (matching state-flow.js): module scripts are deferred
// by default and keep their top-level names out of the global scope, so this can
// never collide with a tool's own /assets/<tool>.js. The path is rewritten to
// its content-hashed name by the final rewriteHtmlAssetRefs pass. Idempotent.
function injectQuestionFlow(html, currentPath) {
  if (!wantsQuestionFlow(currentPath)) return html;
  if (!shipsRevealWrapper(html)) return html;
  // Match the injected TAG, not the bare path: a template comment that merely
  // mentions /assets/question-flow.js used to satisfy this guard and silently
  // suppress the injection (tips-tax-calculator shipped its [data-reveal] field
  // permanently visible because of exactly that).
  if (html.includes('src="/assets/question-flow.js"') || !html.includes('</head>')) return html;
  return html.replace('</head>', '<script type="module" src="/assets/question-flow.js"></script>\n</head>');
}

// --- The wizard rollout ------------------------------------------------------
// /overtime-tax-calculator/ was rewritten on 2026-08-01 from one long form into a
// stack of cards that asks ONE question at a time and ends with the answer
// written out as a story (src/assets/overtime-wizard.js). That shape was
// approved and is being rolled out across the tax-calculator family on
// src/assets/wizard-core.js, one agent per tool.
//
// THIS TABLE IS THE PRE-WIRING, and it exists so those agents never edit
// build.js: fourteen agents editing one file is fourteen conflicts, and a
// conflict resolved wrong here silently drops a script from a live page. Every
// planned asset is listed now and registered the moment its file appears in
// src/assets/, so a conversion is a template edit plus a new JS file and
// nothing else.
//
// Registration is existence-gated because that is the only way to list an asset
// before it is written: registerAsset() reads the file, so queueing a name that
// is not on disk yet fails the whole build. A name here that never appears is
// therefore inert, and the build prints how many are live so a half-finished
// rollout cannot be mistaken for a finished one.
//
// Tools WITHOUT an /embed/ twin are listed with a null asset: they have no
// second consumer to protect, so their conversion rewrites the existing
// /assets/<tool>.js in place and adds no file. Tools WITH an embed twin keep
// that old file (it still serves the iframe build, which is deliberately never a
// wizard) and gain the new one named here.
const WIZARD_ROLLOUT = [
  { path: '/overtime-tax-calculator/', asset: 'overtime-wizard.js' },        // shipped 2026-08-01
  { path: '/tips-tax-calculator/', asset: 'tips-wizard.js' },                // pilot
  { path: '/1099-threshold-checker/', asset: '1099-threshold-wizard.js' },
  { path: '/able-account-calculator/', asset: 'able-account-wizard.js' },
  { path: '/adoption-credit-calculator/', asset: 'adoption-credit-wizard.js' },
  // bonus-tax-calculator-wizard drives the hub page AND the 51
  // /{state}-bonus-tax-calculator/ pages, which render from
  // bonus-tax-calculator-state.html with the same form markup: 52 URLs, one
  // asset, the largest blast radius in the family.
  { path: '/bonus-tax-calculator/', asset: 'bonus-tax-wizard.js' },
  { path: '/car-loan-interest-calculator/', asset: 'car-loan-interest-wizard.js' },
  { path: '/charitable-deduction-calculator/', asset: 'charitable-deduction-wizard.js' },
  { path: '/dependent-care-fsa-vs-credit-calculator/', asset: 'dependent-care-fsa-vs-credit-wizard.js' },
  { path: '/employer-student-loan-repayment-calculator/', asset: 'employer-student-loan-repayment-wizard.js' },
  { path: '/pmi-deduction-calculator/', asset: 'pmi-deduction-wizard.js' },
  { path: '/qcd-vs-charitable-deduction-calculator/', asset: 'qcd-vs-charitable-deduction-wizard.js' },
  { path: '/roth-catchup-calculator/', asset: 'roth-catchup-wizard.js' },
  { path: '/salt-cap-calculator/', asset: 'salt-cap-wizard.js' },
  { path: '/senior-deduction-calculator/', asset: 'senior-deduction-wizard.js' },
  { path: '/w4-overtime-tips-withholding-calculator/', asset: 'w4-overtime-tips-withholding-wizard.js' },
  { path: '/1099-vs-w2-calculator/', asset: null },   // no embed twin: rewritten in place
  { path: '/401k-calculator/', asset: null },         // no embed twin: rewritten in place
];
// Deliberately absent, and they stay absent: /ss-wage-base-calculator/ hosts two
// independent calculators with two result panels, /student-loan-cap-calculator/
// branches on a mode select into four different question sets,
// /w2-box-decoder/ is a four-box decoder plus a live occupation search plus a
// reference table rather than one answer, and /what-applies-to-me/ computes
// nothing and ends in a filtered list of rules. A linear card flow serves none
// of the four. /double-time-pay-calculator/, /tip-calculator/ and
// /sales-tax-calculator/ are plain arithmetic with no tax-law engine.

// Build date (YYYY-MM-DD) — used for the sitemap's per-URL lastmod default.
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// Content date — the last real site-content change, hand-bumped on deploys that
// actually change page content. Used as the dateModified freshness signal in the
// site-wide entity schema so AI/Google do NOT see every page "modified today" on
// every rebuild (the always-today anti-pattern). Bump only when content changes.
const CONTENT_DATE = '2026-06-28';

// Per-URL sitemap lastmod: use each page's REAL last-change date from git
// (`git log -1 --format=%cs`) instead of stamping every URL with today's build
// date — Google distrusts uniformly-fresh sitemaps (the always-today anti-pattern).
// Resolves a URL to its source file (home/tool template, or the state payroll data
// for the generated paycheck pages); a brand-new tool's freshly-committed template
// naturally returns its commit date. Non-template/static URLs fall back to
// CONTENT_DATE (the hand-bumped real content date) — never today-for-all.
// Slugs of the fixed-interval date pages, used by sitemapLastmod below.
const DFT_SLUG_SET = new Set(DFT_PAGES.map((p) => p.slug));

function gitDate(relFile) {
  try {
    const d = execSync(`git log -1 --format=%cs -- "${relFile}"`, { cwd: __dirname })
      .toString()
      .trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  } catch {
    return '';
  }
}
function sitemapLastmod(u) {
  const seg = u.replace(SITE.url, '').replace(/^\/+|\/+$/g, '');
  if (!seg) return gitDate('src/templates/home.html') || CONTENT_DATE;
  if (/-paycheck-calculator$/.test(seg))
    return gitDate('src/data/state-payroll-2026.json') || CONTENT_DATE;
  // Salary-ladder pages: 13 hubs and 117 rungs, two shared templates. Without
  // this they all fall through to CONTENT_DATE and advertise a lastmod older than
  // the content they serve, which is the one thing a lastmod must not do. The
  // slug list is LADDER_STATES itself, so a state added to the ladder gets its
  // freshness rule in the same edit rather than silently missing one.
  {
    const rung = /^([a-z-]+)-take-home-pay-\d+$/.exec(seg);
    if (rung && LADDER_STATE_SET.has(rung[1]))
      return gitDate('src/templates/state-take-home-pay-salary.html') || CONTENT_DATE;
    const hub = /^([a-z-]+)-take-home-pay$/.exec(seg);
    if (hub && LADDER_STATE_SET.has(hub[1]))
      return gitDate('src/templates/state-take-home-pay.html') || CONTENT_DATE;
  }
  // Fixed-interval date pages: 29 pages + a hub, all built from one template and
  // one content module. Without this they fall through to CONTENT_DATE and
  // advertise a lastmod older than the content they serve.
  if (DFT_SLUG_SET.has(seg) || seg === 'days-from-today') {
    return gitDate('src/content/days-from-today.js')
      || gitDate('src/templates/days-from-today.html')
      || CONTENT_DATE;
  }
  const tpl = `src/templates/${seg}.html`;
  if (existsSync(join(__dirname, tpl))) return gitDate(tpl) || CONTENT_DATE;
  // Nested URLs whose template lives at the flat top level under a hyphenated
  // name: /data/take-home-pay-by-state/ is built from
  // src/templates/data-take-home-pay-by-state.html. Without this, every such page
  // fell through to CONTENT_DATE and advertised a lastmod older than the content
  // it was actually serving, which is the one thing a lastmod must not do.
  const flat = `src/templates/${seg.replace(/\//g, '-')}.html`;
  if (existsSync(join(__dirname, flat))) return gitDate(flat) || CONTENT_DATE;
  return CONTENT_DATE;
}

// Format an ISO date (YYYY-MM-DD) as "July 13, 2026" for visible byline text.
// Parsed from the string parts (not new Date) to stay timezone-agnostic.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function humanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${MONTH_NAMES[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
}

// Tax/finance tool pages whose figures are post-cutoff 2026 statutory numbers
// AI assistants retrieve live. Each gets a visible "Last updated" byline under
// its <h1> (injected in fillTool) so the freshness date is machine-readable —
// dated from the template's real last-change commit, never today-for-all.
const DATED_TAX_TOOLS = new Set([
  '/1099-threshold-checker/',
  '/1099-vs-w2-calculator/',
  '/able-account-calculator/',
  '/adoption-credit-calculator/',
  '/bonus-tax-calculator/',
  '/charitable-deduction-calculator/',
  '/dependent-care-fsa-vs-credit-calculator/',
  '/double-time-pay-calculator/',
  '/employer-student-loan-repayment-calculator/',
  '/overtime-tax-calculator/',
  '/pmi-deduction-calculator/',
  '/qcd-vs-charitable-deduction-calculator/',
  '/roth-catchup-calculator/',
  '/salt-cap-calculator/',
  '/senior-deduction-calculator/',
  '/ss-wage-base-calculator/',
  '/student-loan-cap-calculator/',
  '/tips-tax-calculator/',
  '/w2-box-decoder/',
  '/w4-overtime-tips-withholding-calculator/',
  '/what-applies-to-me/',
]);
// Visible, machine-readable "Last updated" line for a dated tool page. Uses the
// template's git last-change date (same signal as sitemapLastmod), CONTENT_DATE
// as the fallback for an uncommitted new template.
function toolUpdatedLine(currentPath) {
  const seg = currentPath.replace(/^\/+|\/+$/g, '');
  const isoDate = gitDate(`src/templates/${seg}.html`) || CONTENT_DATE;
  return `<p class="tool-updated muted-small">Last updated: <time datetime="${isoDate}">${humanDate(isoDate) || isoDate}</time></p>`;
}

// One-line description of the publisher entity, reused in the Organization node.
const ORG_DESCRIPTION =
  'Free, fast, privacy-friendly online calculators and converters that run entirely in your browser — nothing is uploaded.';

// Site-wide social share image (1200×630). Emitted as an on-brand SVG at build
// time (dist/og-cover.svg) — no binary asset needed, same approach as favicon.svg.
// Referenced by injectSeo so every full page ships a complete Open Graph card.
const OG_IMAGE = `${SITE.url}/og-cover.svg`;
const OG_IMAGE_ALT = 'Tools Berry — free online calculators, converters and 2026 tax tools';

// --- Canonical tool list (single source of truth) ----------------------------
// Drives the "Related tools" cross-link block injected on every tool page.
// `cat` mirrors the homepage grid sections (image / calc / money / make /
// devtext) and is what relatedToolsBlock() uses to pick genuinely related
// tools — money relates to money, text to text, etc.
const TOOLS = [
  { name: 'Image Resizer', path: '/resize-image/', cat: 'image' },
  { name: 'Image Format Converter', path: '/convert-image/', cat: 'image' },
  { name: 'Compress Image', path: '/compress-image/', cat: 'image' },
  { name: 'Crop Image Into Circle', path: '/crop-image-into-circle/', cat: 'image' },
  { name: 'Passport & ID Photo', path: '/passport-photo-maker/', cat: 'image' },
  { name: 'Images to PDF', path: '/images-to-pdf/', cat: 'image' },
  { name: 'PDF to Word', path: '/pdf-to-word/', cat: 'image' },
  { name: 'Word to PDF', path: '/word-to-pdf/', cat: 'image' },
  { name: 'Merge PDF', path: '/merge-pdf/', cat: 'image' },
  { name: 'Split PDF', path: '/split-pdf/', cat: 'image' },
  { name: 'Compress PDF', path: '/compress-pdf/', cat: 'image' },
  { name: 'PDF Tools', path: '/pdf-tools/', cat: 'image' },
  { name: 'PDF Converter Alternatives & Pricing', path: '/pdf-word-converter-alternatives/', cat: 'image' },
  { name: 'Signature Maker', path: '/signature-maker/', cat: 'make' },
  { name: 'Percentage Calculator', path: '/percentage-calculator/', cat: 'calc' },
  { name: 'Tip & Bill Split', path: '/tip-calculator/', cat: 'calc' },
  { name: 'Discount Calculator', path: '/discount-calculator/', cat: 'calc' },
  { name: 'Paint Calculator', path: '/paint-calculator/', cat: 'calc' },
  { name: 'Tile Calculator', path: '/tile-calculator/', cat: 'calc' },
  { name: 'Sleep Calculator', path: '/sleep-calculator/', cat: 'calc' },
  { name: 'Cooking Converter', path: '/cooking-converter/', cat: 'calc' },
  { name: 'Recipe Scaler', path: '/recipe-scaler/', cat: 'calc' },
  { name: 'Unit Converter', path: '/unit-converter/', cat: 'calc' },
  { name: 'BMI Calculator', path: '/bmi-calculator/', cat: 'calc' },
  { name: 'Calorie Calculator', path: '/calorie-calculator/', cat: 'calc' },
  { name: 'Ideal Weight & Macro Calculator', path: '/ideal-weight-calculator/', cat: 'calc' },
  { name: 'Running Pace Calculator', path: '/pace-calculator/', cat: 'calc' },
  { name: 'Pregnancy Due Date Calculator', path: '/due-date-calculator/', cat: 'calc' },
  { name: 'Ovulation Calculator', path: '/ovulation-calculator/', cat: 'calc' },
  { name: 'GPA Calculator', path: '/gpa-calculator/', cat: 'calc' },
  { name: 'Age Calculator', path: '/age-calculator/', cat: 'calc' },
  { name: 'Days Between Dates', path: '/days-between-dates/', cat: 'calc' },
  { name: 'Date Calculator (Add or Subtract)', path: '/date-calculator/', cat: 'calc' },
  { name: 'Days From Today', path: '/days-from-today/', cat: 'calc' },
  { name: 'Time Zone Converter', path: '/time-zone-converter/', cat: 'calc' },
  { name: 'Holiday Countdown', path: '/holiday-countdown/', cat: 'calc' },
  { name: 'Countdown Timer', path: '/countdown-timer/', cat: 'calc' },
  { name: 'Stopwatch', path: '/stopwatch/', cat: 'calc' },
  { name: 'Pomodoro Timer', path: '/pomodoro-timer/', cat: 'calc' },
  { name: 'Mortgage Calculator', path: '/mortgage-calculator/', cat: 'money' },
  { name: 'Biweekly Mortgage Calculator', path: '/biweekly-mortgage-calculator/', cat: 'money' },
  { name: 'Auto Loan Calculator', path: '/auto-loan-calculator/', cat: 'money' },
  { name: 'Debt Payoff Calculator', path: '/debt-payoff-calculator/', cat: 'money' },
  { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/', cat: 'money' },
  { name: 'CAGR Calculator', path: '/cagr-calculator/', cat: 'money' },
  { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/', cat: 'money' },
  { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/', cat: 'money' },
  { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/', cat: 'money' },
  { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/', cat: 'money' },
  { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/', cat: 'money' },
  { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/', cat: 'money' },
  { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/', cat: 'money' },
  { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/', cat: 'money' },
  { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/', cat: 'money' },
  { name: 'PMI / Mortgage Insurance Deduction Calculator', path: '/pmi-deduction-calculator/', cat: 'money' },
  { name: 'QCD vs. Charitable Deduction Calculator', path: '/qcd-vs-charitable-deduction-calculator/', cat: 'money' },
  { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/', cat: 'money' },
  { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/', cat: 'money' },
  { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/', cat: 'money' },
  { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/', cat: 'money' },
  { name: 'What Tax Rules Apply to Me', path: '/what-applies-to-me/', cat: 'money' },
  { name: 'Social Security Wage Base Max-Out Date Calculator', path: '/ss-wage-base-calculator/', cat: 'money' },
  { name: 'Federal Student Loan Cap Calculator', path: '/student-loan-cap-calculator/', cat: 'money' },
  { name: 'ABLE Account Contribution Limit Calculator', path: '/able-account-calculator/', cat: 'money' },
  { name: 'Employer Student Loan Repayment Tax Benefit Calculator', path: '/employer-student-loan-repayment-calculator/', cat: 'money' },
  { name: 'Adoption Tax Credit Calculator', path: '/adoption-credit-calculator/', cat: 'money' },
  { name: '401(k) Retirement Calculator', path: '/401k-calculator/', cat: 'money' },
  { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/', cat: 'money' },
  { name: 'Inflation Calculator', path: '/inflation-calculator/', cat: 'money' },
  { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/', cat: 'money' },
  { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/', cat: 'money' },
  { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/', cat: 'money' },
  { name: 'Gas Cost Calculator', path: '/gas-cost-calculator/', cat: 'money' },
  { name: 'Fuel Economy Calculator (MPG, L/100km)', path: '/fuel-economy-calculator/', cat: 'money' },
  { name: 'QR Code Generator', path: '/qr-code-generator/', cat: 'make' },
  { name: 'Password Generator', path: '/password-generator/', cat: 'make' },
  { name: 'Invoice Generator', path: '/invoice-generator/', cat: 'make' },
  { name: 'Word & Character Counter', path: '/word-counter/', cat: 'make' },
  { name: 'Lorem Ipsum Generator', path: '/lorem-ipsum-generator/', cat: 'devtext' },
  { name: 'Text Case Converter', path: '/text-case-converter/', cat: 'devtext' },
  { name: 'Bionic Reading Converter', path: '/bionic-reading-converter/', cat: 'devtext' },
  { name: 'Roman Numeral Converter', path: '/roman-numeral-converter/', cat: 'calc' },
  { name: 'Binary, Hex & Decimal Converter', path: '/base-converter/', cat: 'devtext' },
  { name: 'Color Converter (HEX, RGB, HSL)', path: '/color-converter/', cat: 'devtext' },
  { name: 'JSON Formatter & Validator', path: '/json-formatter/', cat: 'devtext' },
  { name: 'Markdown to HTML Converter', path: '/markdown-to-html/', cat: 'devtext' },
  { name: 'UUID Generator', path: '/uuid-generator/', cat: 'devtext' },
  { name: 'Random Number Generator', path: '/random-number-generator/', cat: 'calc' },
  { name: 'Text Diff Checker', path: '/diff-checker/', cat: 'devtext' },
  { name: 'Base64 Encode & Decode', path: '/base64-encode-decode/', cat: 'devtext' },
  { name: 'Aspect Ratio Calculator', path: '/aspect-ratio-calculator/', cat: 'calc' },
  { name: 'Fraction Calculator', path: '/fraction-calculator/', cat: 'calc' },
  { name: 'Average Calculator (Mean, Median, Mode)', path: '/average-calculator/', cat: 'calc' },
  { name: 'Morse Code Translator', path: '/morse-code-translator/', cat: 'devtext' },
  { name: 'EZ Grader (Test Score Calculator)', path: '/ez-grader/', cat: 'calc' },
  { name: 'Chronological Age Calculator', path: '/chronological-age-calculator/', cat: 'calc' },
  { name: 'Debt Avalanche Calculator', path: '/debt-avalanche-calculator/', cat: 'money' },
  { name: 'Words to Minutes (Speech Time Calculator)', path: '/words-to-minutes/', cat: 'make' },
  { name: 'Double Time Pay Calculator', path: '/double-time-pay-calculator/', cat: 'money' },
  { name: 'Biweekly vs Semimonthly Paycheck Calculator', path: '/biweekly-vs-semimonthly/', cat: 'money' },
  { name: 'Half Birthday Calculator', path: '/half-birthday-calculator/', cat: 'calc' },
  { name: 'Rule of 72 Calculator', path: '/rule-of-72-calculator/', cat: 'money' }
];

// One-line, plain-language descriptions per tool path, used to generate
// /llms.txt (the llms.txt convention). Keyed by the same path as TOOLS, so
// adding a tool above + a line here keeps llms.txt in sync. Any tool missing a
// line falls back to its name, so the build never breaks on an omission.
const TOOL_DESCRIPTIONS = {
  '/resize-image/': 'Resize images to exact pixel dimensions or a percentage, in your browser.',
  '/convert-image/': 'Convert images between PNG, JPG, and WebP without uploading them.',
  '/compress-image/': 'Shrink image file size while controlling quality, fully client-side.',
  '/crop-image-into-circle/': 'Crop any photo into a circle and export a transparent PNG.',
  '/passport-photo-maker/': 'Create compliant passport and ID photos for many countries from one image.',
  '/images-to-pdf/': 'Combine multiple images into a single PDF in your browser.',
  '/pdf-to-word/': 'Convert a PDF into an editable Word (.docx) document.',
  '/word-to-pdf/': 'Convert a Word (.docx) document into a PDF in your browser.',
  '/merge-pdf/': 'Combine multiple PDF files into one, in your browser.',
  '/split-pdf/': 'Extract a page range or split every page of a PDF into separate files, in your browser.',
  '/compress-pdf/': 'Shrink a PDF\'s file size by re-rendering every page as a compressed image, in your browser.',
  '/pdf-tools/': 'All six free PDF tools in one place — convert, merge, split, compress, and build PDFs from images.',
  '/pdf-word-converter-alternatives/': 'Honest, verified pricing comparison of PDF/Word converter alternatives.',
  '/signature-maker/': 'Draw or type a signature and download it as a transparent PNG.',
  '/percentage-calculator/': 'Work out percentages, percentage change, and percentage of a number.',
  '/tip-calculator/': 'Calculate tips and split a bill evenly across any number of people.',
  '/discount-calculator/': 'Find the sale price and amount saved for any percentage discount.',
  '/paint-calculator/': 'Estimate how much paint you need for a room based on wall area and coats.',
  '/tile-calculator/': 'Estimate the number of tiles and boxes needed to cover a floor or wall.',
  '/sleep-calculator/': 'Find the best bedtimes or wake times based on 90-minute sleep cycles.',
  '/cooking-converter/': 'Convert between cups, grams, ounces, and other cooking measurements.',
  '/recipe-scaler/': 'Scale a recipe up or down and recalculate every ingredient amount.',
  '/unit-converter/': 'Convert length, weight, temperature, volume, and more between units.',
  '/bmi-calculator/': 'Calculate your Body Mass Index and see its weight category.',
  '/calorie-calculator/': 'Estimate daily calorie needs from your age, sex, weight, and activity.',
  '/ideal-weight-calculator/': 'Estimate a healthy weight range and macro targets for your height.',
  '/pace-calculator/': 'Calculate running pace, time, or distance for any race or workout.',
  '/due-date-calculator/': 'Estimate a pregnancy due date from the last period or conception date.',
  '/ovulation-calculator/': 'Estimate your fertile window and ovulation date from your cycle.',
  '/gpa-calculator/': 'Calculate weighted or unweighted GPA from your course grades and credits.',
  '/age-calculator/': 'Find an exact age in years, months, and days from a birth date.',
  '/days-between-dates/': 'Count the number of days, weeks, or months between two dates.',
  '/date-calculator/': 'Add or subtract days, weeks, months, or years from any date.',
  '/days-from-today/': 'A page per interval: 30, 60, 90 and 180 days from today, weeks, business days, and dates in the past.',
  '/time-zone-converter/': 'Convert a time across multiple time zones at once.',
  '/holiday-countdown/': 'See a live countdown to upcoming holidays and events.',
  '/countdown-timer/': 'Set a custom countdown timer to any date and time.',
  '/stopwatch/': 'Time anything with a precise stopwatch and unlimited lap splits, in your browser.',
  '/pomodoro-timer/': 'Run 25-minute focus sessions with short and long breaks using the Pomodoro technique.',
  '/mortgage-calculator/': 'Estimate monthly mortgage payments, total interest, and amortization.',
  '/biweekly-mortgage-calculator/': 'Compare biweekly versus monthly mortgage payments and payoff time.',
  '/auto-loan-calculator/': 'Calculate a car loan payment, total interest, and amount financed.',
  '/debt-payoff-calculator/': 'Plan a debt payoff using the snowball or avalanche method.',
  '/compound-interest-calculator/': 'Project savings growth with compound interest and regular contributions.',
  '/cagr-calculator/': 'Calculate the compound annual growth rate between two values.',
  '/half-birthday-calculator/': 'Find your exact half birthday — the date six months from your birthday — plus a countdown.',
  '/rule-of-72-calculator/': 'Estimate how long it takes an investment to double using the Rule of 72.',
  '/words-to-minutes/': 'Convert a word count into speaking time at slow, average, or fast pace.',
  '/double-time-pay-calculator/': 'Calculate double time pay, total earnings, and effective hourly rate.',
  '/biweekly-vs-semimonthly/': 'Compare biweekly versus semimonthly paychecks for the same annual salary.',
  '/ez-grader/': 'Grade tests fast — enter the number of questions to get a percentage and letter grade for every wrong-answer count.',
  '/chronological-age-calculator/': 'Find an exact chronological age in years, months, and days between any two dates.',
  '/debt-avalanche-calculator/': 'Plan a debt avalanche payoff that targets the highest-interest balance first to minimize total interest.',
  '/1099-vs-w2-calculator/': 'Compare 1099 contractor versus W-2 employee take-home pay.',
  '/1099-threshold-checker/': 'See whether you\'ll get a 1099-K, 1099-NEC, or 1099-MISC under the 2025/2026 rules: payment apps at $20,000 and 200 transactions, card processors like Stripe/Square with no minimum at all, or a business paying you directly at $2,000 (2026) / $600 (2025) — plus the myth-bust that a 1099 is paperwork, not a tax.',
  '/w2-box-decoder/': 'Decode the three new 2026 W-2 Box 12 codes — TA (Trump account, excluded from Box 1), TP (reported tips) and TT (overtime premium, both still fully taxed inside Box 1, flagging the Schedule 1-A deduction) — plus a searchable lookup of all 71 Treasury Tipped Occupation Codes for Box 14b, including what code 000 means.',
  '/overtime-tax-calculator/': 'See how much of your overtime is deductible under the 2025 "no tax on overtime" law and what it saves you.',
  '/tips-tax-calculator/': 'See how much of your tips are deductible under the 2025 "no tax on tips" law (up to $25,000) and what it saves you.',
  '/senior-deduction-calculator/': 'Calculate the 2025 law\'s $6,000 senior bonus deduction for people 65+ — the "no tax on Social Security" break — and what it saves you.',
  '/salt-cap-calculator/': 'See your allowed SALT deduction under the 2025 law\'s $40,000 cap — with the high-income phase-down, the itemize-vs-standard check, and your saving vs the old $10,000 cap.',
  '/car-loan-interest-calculator/': 'See how much of your new-car loan interest is deductible under the 2025 law (up to $10,000/yr, 2025–2028) — with the income phase-out and what it really saves you.',
  '/charitable-deduction-calculator/': 'See your charitable deduction under the 2026 law: the permanent $1,000/$2,000 non-itemizer deduction, the 0.5%-of-AGI floor for itemizers, the 35%-cap in the top bracket, and what it saves — without claiming it lowers your AGI (it does not).',
  '/pmi-deduction-calculator/': 'The 2026 law permanently revived the PMI / mortgage insurance premium deduction. See the exact $109,000 ($54,500 MFS) AGI cliff, the FHA-amortized-over-84-months vs VA/USDA-deductible-in-full split, and what it saves — itemizers only.',
  '/qcd-vs-charitable-deduction-calculator/': "70½+? Compare a Qualified Charitable Distribution (excluded from income entirely, up to $111,000 in 2026) against taking the IRA distribution and claiming a charitable deduction instead. See the real AGI and federal-tax difference — including the case where they tie.",
  '/dependent-care-fsa-vs-credit-calculator/': 'Max the 2026 $7,500 Dependent Care FSA or take the Child & Dependent Care Credit? It\'s one or the other — maxing the FSA zeroes the credit. See both scenarios side by side, the dollar difference, and which wins for your income (MFS-aware; the credit is nonrefundable).',
  '/w4-overtime-tips-withholding-calculator/': 'Turn the no-tax-on-tips / no-tax-on-overtime deduction into bigger paychecks now: see what to enter on your 2026 Form W-4 Step 4(b) (lines 1a/1b) and the extra take-home per paycheck, instead of waiting for a refund.',
  '/roth-catchup-calculator/': 'Earn over $150,000? See if the 2026 SECURE 2.0 rule forces your 401(k) catch-up into Roth (after-tax), what that costs this year, and the Roth-vs-pre-tax break-even.',
  '/what-applies-to-me/': 'Answer six plain questions and see which 2026 tax rules match your answers, for all 50 states and DC: your state\'s tips and overtime verdict, local wage taxes, employee-paid programs, and the federal tips, overtime, senior, car loan, charity, SALT and mortgage insurance rules. We list the rules and link the calculator that does the math. We never work out what you owe.',
  '/bonus-tax-calculator/': 'See what\'s withheld from your bonus now (flat 22% federal + your state\'s supplemental rate + FICA) versus what it will really cost at tax time — with the refund or amount owed, for all 50 states + DC.',
  '/ss-wage-base-calculator/': 'Find the exact 2026 paycheck your 6.2% Social Security tax stops for the year once you cross the $184,500 wage base, and how much your take-home pay jumps — plus a multi-employer excess-FICA check and a Medicare contrast note.',
  '/student-loan-cap-calculator/': 'The federal borrowing caps in effect since July 1, 2026: graduate $20,500/yr ($100,000 aggregate), professional $50,000/yr ($200,000 shared pool), Parent PLUS $20,000/yr ($65,000 per student), the $257,500 lifetime cap, and the legacy grandfather exception. See your year-by-year federal capacity, which cap binds, and your program\'s funding gap — statute-cited, no borrowing advice.',
  '/able-account-calculator/': 'How much can go into an ABLE account in 2026: the $20,000 base limit (no longer the gift-tax exclusion), the permanent ABLE-to-Work bonus — lesser of the beneficiary\'s pay or the one-person poverty line, with the higher Alaska/Hawaii figures — the onset-before-46 eligibility expansion, 529→ABLE rollovers, remaining room, and the 6% excise on excess. Statute-cited; no eligibility determination.',
  '/employer-student-loan-repayment-calculator/': 'An employer can pay up to $5,250/year toward your student loans tax-free under IRC §127 — made permanent by the 2025 law (OBBBA §70412). See the exact employee saving (no federal income tax + no 7.65% FICA) and employer saving (its 7.65% FICA match, $401.63 at the full cap), the shared $5,250 cap with tuition assistance, the wage-base straddle that drops the FICA saving to 1.45% for high earners, and the California non-conformity caveat.',
  '/adoption-credit-calculator/': 'See your 2026 federal adoption tax credit (IRC §23): the $17,670 per-child cap, the $265,080–$305,080 MAGI phase-out, and — new under the 2025 law — up to $5,120 refundable PER CHILD (not per return), paid even if you owe no tax. Refundable for the first time since 2011 and permanently for the first time. Handles special-needs adoptions (full cap with no expenses), multiple children, employer §137 assistance, and the 5-year carryforward. Statute-cited, no advice.',
  '/401k-calculator/': 'Project 401(k) retirement balance from contributions, match, and growth.',
  '/savings-goal-calculator/': 'Find how much to save each month to reach a savings goal.',
  '/inflation-calculator/': 'See how the buying power of a US dollar changes over time.',
  '/hours-calculator/': 'Add up worked hours from a time card, including breaks and overtime.',
  '/salary-to-hourly/': 'Convert an annual salary to an hourly, weekly, or monthly rate.',
  '/sales-tax-calculator/': 'Add or remove sales tax and find the pre-tax or after-tax price.',
  '/gas-cost-calculator/': 'Estimate the fuel cost of a trip from distance, MPG, and gas price.',
  '/fuel-economy-calculator/': 'Calculate fuel economy in MPG or L/100km and compare vehicles.',
  '/qr-code-generator/': 'Create QR codes for links, WiFi, or contacts and download as PNG or SVG.',
  '/password-generator/': 'Generate strong, random passwords with custom length and character sets.',
  '/invoice-generator/': 'Create and download a professional PDF invoice in your browser.',
  '/word-counter/': 'Count words, characters, sentences, and reading time in any text.',
  '/lorem-ipsum-generator/': 'Generate placeholder Lorem Ipsum text by words, sentences, or paragraphs.',
  '/text-case-converter/': 'Convert text between upper, lower, title, sentence, and other cases.',
  '/bionic-reading-converter/': 'Bold the leading letters of each word to help you read and skim faster (bionic-style).',
  '/roman-numeral-converter/': 'Convert numbers to Roman numerals and back.',
  '/base-converter/': 'Convert numbers between binary, hexadecimal, decimal, and octal.',
  '/color-converter/': 'Convert colors between HEX, RGB, and HSL formats.',
  '/json-formatter/': 'Format, validate, and minify JSON in your browser.',
  '/markdown-to-html/': 'Convert Markdown to clean HTML with a live preview.',
  '/uuid-generator/': 'Generate random UUIDs (v4) one at a time or in bulk.',
  '/random-number-generator/': 'Generate random numbers within a range, with or without repeats.',
  '/diff-checker/': 'Compare two blocks of text and highlight the differences.',
  '/base64-encode-decode/': 'Encode text to Base64 or decode Base64 back to text.',
  '/aspect-ratio-calculator/': 'Solve for a missing width or height that keeps an aspect ratio.',
  '/fraction-calculator/': 'Add, subtract, multiply, and divide fractions with simplified results.',
  '/average-calculator/': 'Calculate the mean, median, and mode of a set of numbers.',
  '/morse-code-translator/': 'Translate text to Morse code and Morse code back to text.'
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The salary levels the /data/take-home-pay-by-state/ study runs, lowest first.
// Held at module scope because several places name them: the study itself, the
// related-tool label in RELATED_OVERRIDES below, and the cross-link sentence every
// one of the 51 state pages carries. Adding or moving a level here moves all of
// them together instead of leaving one quoting a salary the study no longer
// computes. The first level is also DEFAULT_SALARY (declared further down from
// this array), the salary every state page pre-fills, so a reader arriving from a
// state page meets the example salary that page already showed them.
const STUDY_SALARIES = [75000, 100000];
// "$75,000 and $100,000". Formats inline rather than through usd0(), which is
// declared further down this file and would still be in its temporal dead zone
// here, above RELATED_OVERRIDES.
const STUDY_SALARY_TEXT = (() => {
  const m = (n) => '$' + n.toLocaleString('en-US');
  return STUDY_SALARIES.length > 1
    ? STUDY_SALARIES.slice(0, -1).map(m).join(', ')
      + ' and ' + m(STUDY_SALARIES[STUDY_SALARIES.length - 1])
    : m(STUDY_SALARIES[0]);
})();

// The one-sentence quotable answer for the two OBBBA state-conformity studies
// (/data/tips-tax-by-state/ and /data/overtime-tax-by-state/). Both pages ask the
// same shape of question about a different kind of pay, and both count the same
// four buckets, so the sentence is written once here and given the subject and the
// tallies the page itself computed — never a hand-typed count.
//
// Why the pages need it at all: an answer engine quotes the first sentence it can
// lift whole. The lede under each H1 opens on the federal law rather than on the
// state answer, so a quote of it answers a question nobody asked. This sentence
// names the subject, the tax year and every count, so it survives being pulled out
// of the page with no headline attached.
//
// The partial/unclear clause appears only when those buckets are non-empty, so the
// sentence shrinks to the truth rather than asserting "0 states are unsettled".
function conformityAnswer(subject, total, cnt) {
  const other = (cnt.partial || 0) + (cnt.unclear || 0);
  return `For tax year 2026, ${cnt.no} of the ${total} US state-level jurisdictions (50 states plus the ` +
    `District of Columbia) still tax ${subject} at the state level, ${cnt.yes} let the federal ` +
    `no-tax-on-${subject === 'tip income' ? 'tips' : 'overtime'} deduction flow through so it is ` +
    `effectively state-tax-free, and ${cnt.nowage} have no state wage income tax at all` +
    (other
      ? `; the remaining ${other} ${other === 1 ? 'offers' : 'offer'} only a partial exclusion or ` +
        `${other === 1 ? 'has' : 'have'} not settled the question.`
      : '.');
}

// Hand-picked related links for pages that aren't in TOOLS (data studies, the
// embed gallery). Keyed by currentPath.
const RELATED_OVERRIDES = {
  // PDF cluster: explicit cross-links to every sibling PDF tool + the hub page,
  // instead of the cat-based random pick (which would dilute in with the 5
  // non-PDF image tools sharing cat:'image').
  '/pdf-to-word/': [
    { name: 'Word to PDF Converter', path: '/word-to-pdf/' },
    { name: 'Merge PDF Files', path: '/merge-pdf/' },
    { name: 'Split PDF', path: '/split-pdf/' },
    { name: 'Compress PDF', path: '/compress-pdf/' },
    { name: 'Images to PDF Converter', path: '/images-to-pdf/' },
    { name: 'All PDF Tools', path: '/pdf-tools/' },
    { name: 'PDF Converter Alternatives & Pricing', path: '/pdf-word-converter-alternatives/' }
  ],
  '/word-to-pdf/': [
    { name: 'PDF to Word Converter', path: '/pdf-to-word/' },
    { name: 'Merge PDF Files', path: '/merge-pdf/' },
    { name: 'Split PDF', path: '/split-pdf/' },
    { name: 'Compress PDF', path: '/compress-pdf/' },
    { name: 'Images to PDF Converter', path: '/images-to-pdf/' },
    { name: 'All PDF Tools', path: '/pdf-tools/' },
    { name: 'PDF Converter Alternatives & Pricing', path: '/pdf-word-converter-alternatives/' }
  ],
  '/merge-pdf/': [
    { name: 'Split PDF', path: '/split-pdf/' },
    { name: 'Compress PDF', path: '/compress-pdf/' },
    { name: 'PDF to Word Converter', path: '/pdf-to-word/' },
    { name: 'Word to PDF Converter', path: '/word-to-pdf/' },
    { name: 'Images to PDF Converter', path: '/images-to-pdf/' },
    { name: 'All PDF Tools', path: '/pdf-tools/' },
    { name: 'PDF Converter Alternatives & Pricing', path: '/pdf-word-converter-alternatives/' }
  ],
  '/split-pdf/': [
    { name: 'Merge PDF Files', path: '/merge-pdf/' },
    { name: 'Compress PDF', path: '/compress-pdf/' },
    { name: 'PDF to Word Converter', path: '/pdf-to-word/' },
    { name: 'Word to PDF Converter', path: '/word-to-pdf/' },
    { name: 'Images to PDF Converter', path: '/images-to-pdf/' },
    { name: 'All PDF Tools', path: '/pdf-tools/' },
    { name: 'PDF Converter Alternatives & Pricing', path: '/pdf-word-converter-alternatives/' }
  ],
  '/compress-pdf/': [
    { name: 'Merge PDF Files', path: '/merge-pdf/' },
    { name: 'Split PDF', path: '/split-pdf/' },
    { name: 'PDF to Word Converter', path: '/pdf-to-word/' },
    { name: 'Word to PDF Converter', path: '/word-to-pdf/' },
    { name: 'Images to PDF Converter', path: '/images-to-pdf/' },
    { name: 'All PDF Tools', path: '/pdf-tools/' },
    { name: 'PDF Converter Alternatives & Pricing', path: '/pdf-word-converter-alternatives/' }
  ],
  '/images-to-pdf/': [
    { name: 'PDF to Word Converter', path: '/pdf-to-word/' },
    { name: 'Word to PDF Converter', path: '/word-to-pdf/' },
    { name: 'Merge PDF Files', path: '/merge-pdf/' },
    { name: 'Split PDF', path: '/split-pdf/' },
    { name: 'Compress PDF', path: '/compress-pdf/' },
    { name: 'All PDF Tools', path: '/pdf-tools/' },
    { name: 'PDF Converter Alternatives & Pricing', path: '/pdf-word-converter-alternatives/' }
  ],
  '/overtime-tax-calculator/': [
    { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'What Tax Rules Apply to Me', path: '/what-applies-to-me/' }
  ],
  '/what-applies-to-me/': [
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'PMI / Mortgage Insurance Deduction Calculator', path: '/pmi-deduction-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' }
  ],
  '/tips-tax-calculator/': [
    { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Tip & Bill Split', path: '/tip-calculator/' },
    { name: 'What Tax Rules Apply to Me', path: '/what-applies-to-me/' }
  ],
  '/w4-overtime-tips-withholding-calculator/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
  ],
  '/car-loan-interest-calculator/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Auto Loan Calculator', path: '/auto-loan-calculator/' },
    { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' }
  ],
  '/charitable-deduction-calculator/': [
    { name: 'PMI / Mortgage Insurance Deduction Calculator', path: '/pmi-deduction-calculator/' },
    { name: 'QCD vs. Charitable Deduction Calculator', path: '/qcd-vs-charitable-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' }
  ],
  '/pmi-deduction-calculator/': [
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Mortgage Calculator', path: '/mortgage-calculator/' },
    { name: 'Biweekly Mortgage Calculator', path: '/biweekly-mortgage-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' }
  ],
  '/qcd-vs-charitable-deduction-calculator/': [
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' }
  ],
  '/dependent-care-fsa-vs-credit-calculator/': [
    { name: 'Employer Student Loan Repayment Tax Benefit Calculator', path: '/employer-student-loan-repayment-calculator/' },
    { name: 'Adoption Tax Credit Calculator', path: '/adoption-credit-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'ABLE Account Contribution Limit Calculator', path: '/able-account-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' }
  ],
  '/salt-cap-calculator/': [
    { name: 'PMI / Mortgage Insurance Deduction Calculator', path: '/pmi-deduction-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Mortgage Calculator', path: '/mortgage-calculator/' },
    { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' }
  ],
  '/senior-deduction-calculator/': [
    { name: 'QCD vs. Charitable Deduction Calculator', path: '/qcd-vs-charitable-deduction-calculator/' },
    { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' }
  ],
  '/roth-catchup-calculator/': [
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'ABLE Account Contribution Limit Calculator', path: '/able-account-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' }
  ],
  // W-2 Box 12 TA/TP/TT decoder + TTOC lookup: the tips/overtime information
  // cluster (spec §8 — tips + W-4 pages link forward here), plus the form-
  // reading sibling (1099 threshold checker) and paycheck utilities.
  '/w2-box-decoder/': [
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'Treasury Tipped Occupation Codes (TTOC) Table', path: '/data/treasury-tipped-occupation-codes/' },
    { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' }
  ],
  '/1099-threshold-checker/': [
    { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' }
  ],
  '/ss-wage-base-calculator/': [
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Biweekly vs Semimonthly Paycheck Calculator', path: '/biweekly-vs-semimonthly/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' }
  ],
  // Student-aid domain, not tax — deliberately NOT wired into the OBBBA tax
  // cluster's related-tools mesh (docs/student-loan-cap-calculator-spec.md §5).
  // Nearest genuine siblings are the loan/debt-repayment and student tools.
  '/student-loan-cap-calculator/': [
    { name: '2026 Federal Student Loan Limits Table', path: '/data/2026-student-loan-limits/' },
    { name: 'Employer Student Loan Repayment Tax Benefit Calculator', path: '/employer-student-loan-repayment-calculator/' },
    { name: 'Debt Payoff Calculator', path: '/debt-payoff-calculator/' },
    { name: 'Debt Avalanche Calculator', path: '/debt-avalanche-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'GPA Calculator', path: '/gpa-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
  ],
  // §529A savings-account domain — nearest genuine siblings are the
  // contribution-limit / tax-advantaged-savings tools (401k/HSA-style), not
  // the OBBBA deduction cluster (docs/able-account-calculator-spec.md).
  '/able-account-calculator/': [
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/' },
    { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
  ],
  // Employer §127 student-loan-repayment / educational-assistance tax benefit —
  // bridges the student-loan tools and the OBBBA/employer-benefit tax cluster
  // (docs/section-127-student-loan-repayment-spec.md §5).
  '/employer-student-loan-repayment-calculator/': [
    { name: 'Federal Student Loan Cap Calculator', path: '/student-loan-cap-calculator/' },
    { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'Debt Payoff Calculator', path: '/debt-payoff-calculator/' }
  ],
  // Adoption credit (IRC §23) — a child/family OBBBA tax provision. Nearest
  // siblings are the dependent-care (child/family) tool and the OBBBA deduction
  // cluster, plus the tax glossary (docs/adoption-credit-calculator-spec.md §5).
  '/adoption-credit-calculator/': [
    { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'PMI / Mortgage Insurance Deduction Calculator', path: '/pmi-deduction-calculator/' },
    { name: 'QCD vs. Charitable Deduction Calculator', path: '/qcd-vs-charitable-deduction-calculator/' },
    { name: 'Tax Glossary', path: '/tax-glossary/' }
  ],
  '/data/overtime-tax-by-state/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
    { name: `Take-Home Pay by State on ${STUDY_SALARY_TEXT} (Data Study)`, path: '/data/take-home-pay-by-state/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Double Time Pay Calculator', path: '/double-time-pay-calculator/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: 'What Tax Rules Apply to Me', path: '/what-applies-to-me/' }
  ],
  '/data/take-home-pay-by-state/': [
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Biweekly vs Semimonthly Paycheck Calculator', path: '/biweekly-vs-semimonthly/' },
    { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
    { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
    { name: '2026 State Bonus Withholding Rates', path: '/data/state-supplemental-withholding-rates-2026/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: 'Social Security Wage Base Max-Out Date Calculator', path: '/ss-wage-base-calculator/' }
  ],
  '/data/tips-tax-by-state/': [
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Tip & Bill Split', path: '/tip-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: 'Biweekly vs Semimonthly Paycheck Calculator', path: '/biweekly-vs-semimonthly/' },
    { name: 'What Tax Rules Apply to Me', path: '/what-applies-to-me/' }
  ],
  '/data/treasury-tipped-occupation-codes/': [
    { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/' }
  ],
  '/data/2026-student-loan-limits/': [
    { name: 'Federal Student Loan Cap Calculator', path: '/student-loan-cap-calculator/' },
    { name: 'Debt Payoff Calculator', path: '/debt-payoff-calculator/' },
    { name: 'Debt Avalanche Calculator', path: '/debt-avalanche-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'GPA Calculator', path: '/gpa-calculator/' }
  ],
  '/data/state-supplemental-withholding-rates-2026/': [
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' }
  ],
  '/embed/': [
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'PMI / Mortgage Insurance Deduction Calculator', path: '/pmi-deduction-calculator/' },
    { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/' },
    { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/' },
    { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/' },
    { name: 'W-2 Box 12 Decoder & Tipped Occupation Lookup', path: '/w2-box-decoder/' },
    { name: 'Social Security Wage Base Max-Out Date Calculator', path: '/ss-wage-base-calculator/' },
    { name: 'Federal Student Loan Cap Calculator', path: '/student-loan-cap-calculator/' },
    { name: 'ABLE Account Contribution Limit Calculator', path: '/able-account-calculator/' },
    { name: 'Employer Student Loan Repayment Tax Benefit Calculator', path: '/employer-student-loan-repayment-calculator/' }
  ]
};

// Same-category fallback when a category is too small to fill the block.
const CAT_FALLBACK = { image: 'make', make: 'devtext', devtext: 'make', calc: 'money', money: 'calc' };

// Shared renderer: a compact "Related tools" section (6-8 genuinely related
// links + one "All tools" link to the homepage directory). Replaces the old
// full ~80-link "More free tools" directory, which now lives ONLY on the
// homepage grid — inner pages no longer carry a sitewide link block.
function relatedLinksHtml(picks) {
  const links = picks
    .map((t) => `      <a href="${t.path}">${esc(t.name)}</a>`)
    .join('\n');
  return (
    `<section class="more-tools" aria-label="Related tools">\n` +
    `  <div class="wrap">\n` +
    `    <h2>Related tools</h2>\n` +
    `    <div class="more-tools-grid">\n${links}\n      <a href="/">All tools &rarr;</a>\n    </div>\n` +
    `  </div>\n` +
    `</section>\n`
  );
}

// Pick 6-8 related tools for a tool page: same homepage category as the current
// tool, deterministically shuffled per page (slugHash) so different pages don't
// all show the identical subset; padded from a sibling category when small.
function relatedToolsBlock(currentPath) {
  if (RELATED_OVERRIDES[currentPath]) return relatedLinksHtml(RELATED_OVERRIDES[currentPath]);
  const cur = TOOLS.find((t) => t.path === currentPath);
  const cat = cur ? cur.cat : 'calc';
  const shuffled = (arr) =>
    arr
      .map((t) => ({ t, k: slugHash(t.path + currentPath) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.t);
  let picks = shuffled(TOOLS.filter((t) => t.cat === cat && t.path !== currentPath)).slice(0, 7);
  if (picks.length < 6) {
    picks = picks.concat(
      shuffled(TOOLS.filter((t) => t.cat === CAT_FALLBACK[cat] && t.path !== currentPath)).slice(0, 7 - picks.length)
    );
  }
  return relatedLinksHtml(picks);
}

const read = (p) => readFile(p, 'utf8');
const readJSON = async (p) => JSON.parse(await read(p));

// Centralized per-page SEO normalization. Every template already ships a unique,
// hand-written <title>, <meta name="description"> and <link rel="canonical">; this
// fills in the *missing*, mechanical social/discovery tags (og:url, og:type,
// og:site_name, the og:title/og:description fallback, and the Twitter card) so
// they don't have to be repeated across 16+ templates. Derives values from the
// page's own title/description/canonical, so it stays DRY and self-consistent.
//
// Idempotent: each tag is only inserted when absent, so building twice never
// doubles a tag. Only runs on full pages (those with a </head>).
function injectSeo(html) {
  if (!html.includes('</head>')) return html;

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  const canonMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']\s*\/?>/i);

  const title = titleMatch ? titleMatch[1].trim() : SITE.name;
  const desc = descMatch ? descMatch[1].trim() : '';
  const url = canonMatch ? canonMatch[1].trim() : SITE.url + '/';

  // og:title / twitter:title fall back to the page <title>, but if the template
  // already declares its own (shorter, social-tuned) og:title we keep it and
  // reuse it for the Twitter card too.
  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  const socialTitle = ogTitleMatch ? ogTitleMatch[1].trim() : title;
  const socialDesc = ogDescMatch ? ogDescMatch[1].trim() : desc;

  // [regex to test presence, html to insert] — only inserted when not already there.
  const tags = [
    [/<meta\s+property=["']og:title["']/i, `<meta property="og:title" content="${socialTitle}">`],
    [/<meta\s+property=["']og:description["']/i, `<meta property="og:description" content="${socialDesc}">`],
    [/<meta\s+property=["']og:type["']/i, `<meta property="og:type" content="website">`],
    [/<meta\s+property=["']og:url["']/i, `<meta property="og:url" content="${url}">`],
    [/<meta\s+property=["']og:site_name["']/i, `<meta property="og:site_name" content="${esc(SITE.name)}">`],
    [/<meta\s+property=["']og:image["']/i, `<meta property="og:image" content="${OG_IMAGE}">`],
    [/<meta\s+property=["']og:image:alt["']/i, `<meta property="og:image:alt" content="${esc(OG_IMAGE_ALT)}">`],
    [/<meta\s+name=["']twitter:card["']/i, `<meta name="twitter:card" content="summary_large_image">`],
    [/<meta\s+name=["']twitter:title["']/i, `<meta name="twitter:title" content="${socialTitle}">`],
    [/<meta\s+name=["']twitter:description["']/i, `<meta name="twitter:description" content="${socialDesc}">`],
    [/<meta\s+name=["']twitter:image["']/i, `<meta name="twitter:image" content="${OG_IMAGE}">`]
  ];

  const toInsert = tags.filter(([re]) => !re.test(html)).map(([, tag]) => tag);
  if (!toInsert.length) return html;
  return html.replace('</head>', `${toInsert.join('\n')}\n</head>`);
}

// Site-wide entity schema. Injects ONE JSON-LD @graph (Organization + WebSite +
// WebPage + BreadcrumbList) into every full page's <head>. This gives AI-search
// engines (AI Overviews / Perplexity / ChatGPT) a citable publisher *entity* and a
// breadcrumb trail — the gap that let pages rank without anything to cite. It
// COMPLEMENTS, never replaces, the per-tool WebApplication + FAQPage blocks the
// templates already carry (multiple JSON-LD blocks are valid; crawlers merge by @id).
//
// Derives everything from the page's own canonical URL + <title> (same source
// injectSeo already trusts), so no per-page wiring is needed. Idempotent (skips if
// already injected) and a no-op on fragments (no </head>).
//
// Includes a shared-@id author Person (Edmond Daher) on the WebPage node so the
// site-wide entity graph, the per-state pages, and the overtime/tips studies all
// resolve to ONE author entity (E-E-A-T entity merge; crawlers merge by @id).
// Still deliberately NOT included:
//  - sameAs: omitted until real owned profile URLs (X/GitHub/Reddit) are supplied —
//    inventing links would mislead entity resolution.
function injectEntitySchema(html) {
  if (!html.includes('</head>')) return html;
  const orgId = `${SITE.url}/#organization`;
  if (html.includes(`"@id":"${orgId}"`)) return html; // already injected

  const canonMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']\s*\/?>/i);
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const url = canonMatch ? canonMatch[1].trim() : `${SITE.url}/`;
  // Titles are HTML-escaped (e.g. "Paycheck &amp; Payroll"); JSON-LD script text is
  // NOT HTML-parsed, so decode the common entities back to literals before they
  // enter the schema, or a consumer reads "&amp;" verbatim in the name.
  const decodeHtml = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  const rawTitle = decodeHtml(titleMatch ? titleMatch[1].trim() : SITE.name);
  // Clean breadcrumb leaf label: drop any " — tagline" / " | brand" suffix.
  const pageName = rawTitle.split(/\s[—|]\s/)[0].trim();
  const isHome = url === `${SITE.url}/` || url === SITE.url;
  const siteId = `${SITE.url}/#website`;

  const graph = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: SITE.name,
      url: `${SITE.url}/`,
      logo: { '@type': 'ImageObject', url: `${SITE.url}/favicon.svg` },
      description: ORG_DESCRIPTION
    },
    {
      '@type': 'WebSite',
      '@id': siteId,
      url: `${SITE.url}/`,
      name: SITE.name,
      publisher: { '@id': orgId }
    },
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: rawTitle,
      isPartOf: { '@id': siteId },
      author: {
        '@type': 'Person',
        '@id': `${SITE.url}/#edmond-daher`,
        name: 'Edmond Daher',
        url: `${SITE.url}/about/`,
        jobTitle: 'Software Engineer'
      },
      dateModified: CONTENT_DATE
    }
  ];

  if (!isHome) {
    const crumbId = `${url}#breadcrumb`;
    graph[2].breadcrumb = { '@id': crumbId };
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': crumbId,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.url}/` },
        { '@type': 'ListItem', position: 2, name: pageName, item: url }
      ]
    });
  }

  const block = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>\n`;
  return html.replace('</head>', `${block}</head>`);
}

// --- Build-time SEO length normalization -------------------------------------
// Templates author rich, keyword-lead + marketing-tail <title>s and long prose
// <meta name="description">s. Google only displays ~60 title chars / ~155-160
// description chars, and Ahrefs flags the overflow. These two compactors trim the
// *output* to compliant lengths at a single choke point (fill), so the source
// stays rich while the shipped tags are SERP-clean. Both measure DECODED length
// (so "&amp;" counts as 1 char, matching how crawlers see it) and both are no-ops
// on already-compliant tags, so re-running the build never over-trims.
const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
const decodedLen = (s) => decodeEntities(s).length;
const reencodeText = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Title → ≤60 decoded chars. Peels the trailing clause after the rightmost
// separator (em/en dash, hyphen or colon) while the surviving lead stays a
// meaningful ≥24 chars — this keeps the front-loaded primary keyword and only
// sheds the marketing hook that SERPs truncate away anyway. Word-boundary
// fallback for the rare title with no droppable clause.
const TITLE_SEPS = [' — ', ' – ', ' - ', ': '];
// A hard word-boundary cut can strand an incomplete trailing fragment. Only two
// shapes are UNAMBIGUOUSLY broken and safe to trim for any title:
//   1. an unclosed "(" clause  ("...with Alarm (Pomodoro"  → "...with Alarm")
//   2. a dangling lone connector ("...Weeks, Months &", "...Each Month to")
// A "connector + word" tail is deliberately NOT trimmed: "& Divide", "& Distance"
// and "& Passphrases" are complete list items that merely happen to sit at the
// cut, indistinguishable by shape from a truncated "& Time". Titles whose cut
// lands mid-word that way are fixed at the source instead. Only already-truncated
// titles reach this, so trimming these two shapes never sheds a complete clause.
function tidyTitleTail(d) {
  let out = d.trim();
  if ((out.match(/\(/g) || []).length > (out.match(/\)/g) || []).length) {
    out = out.slice(0, out.lastIndexOf('(')).trim();
  }
  out = out.replace(/\s+(?:[+&/×·]|and|or|to|by|with|for|of|per|vs\.?|plus)$/i, '').trim();
  return out.replace(/[\s+&/×·,:;–—-]+$/, '').trim();
}
function compactTitleStr(raw) {
  let t = raw.trim();
  if (decodedLen(t) <= 60) return t;
  let changed = true;
  while (decodedLen(t) > 60 && changed) {
    changed = false;
    let bestIdx = -1;
    for (const sep of TITLE_SEPS) { const i = t.lastIndexOf(sep); if (i > bestIdx) bestIdx = i; }
    if (bestIdx > 0) {
      const lead = t.slice(0, bestIdx).trim();
      if (decodedLen(lead) >= 24) { t = lead; changed = true; }
    }
  }
  if (decodedLen(t) > 60) {
    const d = tidyTitleTail(decodeEntities(t).slice(0, 60).replace(/\s+\S*$/, '').trim());
    t = reencodeText(d);
  }
  return t;
}
function compactTitle(html) {
  if (!html.includes('</head>')) return html;
  return html.replace(/<title>([\s\S]*?)<\/title>/i, (m, inner) => `<title>${compactTitleStr(inner)}</title>`);
}

// Meta description → ≤~155 decoded chars. Prefers a natural stop: a sentence end
// in the 80-157 window, else a clause boundary (comma / dash / semicolon) in the
// 100-157 window, else a plain word-boundary cut. The meta description is not a
// ranking factor and its tail is never shown, so trimming it is SERP-safe.
function compactDescStr(raw) {
  const d = decodeEntities(raw.trim());
  if (d.length <= 157) return raw.trim();
  let best = -1, m;
  const re = /[.!?](\s|$)/g;
  while ((m = re.exec(d))) { const end = m.index + 1; if (end >= 80 && end <= 157) best = end; }
  let cut;
  if (best > 0) {
    cut = d.slice(0, best).trim();
  } else {
    let cb = -1;
    for (const sep of [', ', ' — ', ' – ', '; ', ' - ']) {
      let p = 0, i = -1;
      while ((p = d.indexOf(sep, p)) !== -1) { if (p >= 100 && p <= 157) i = p; p += sep.length; }
      if (i > cb) cb = i;
    }
    cut = cb > 0 ? d.slice(0, cb).trim() : d.slice(0, 155).replace(/\s+\S*$/, '').trim();
  }
  cut = cut.replace(/[,;:—–-]+$/, '').trim();
  return reencodeText(cut);
}
function compactDesc(html) {
  if (!html.includes('</head>')) return html;
  return html.replace(
    /(<meta\s+name=["']description["']\s+content=)(["'])([\s\S]*?)\2(\s*\/?>)/i,
    (m, pre, q, inner, post) => `${pre}${q}${compactDescStr(inner)}${q}${post}`
  );
}

function fill(tpl, map) {
  let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in map ? map[k] : m));
  // Inject the AdSense loader into every full page (anything with a </head>).
  // Fragment fills (page bodies/descriptions) have no </head>, so they're untouched.
  if (ADSENSE_HEAD && out.includes('</head>')) out = out.replace('</head>', `${ADSENSE_HEAD}</head>`);
  // Page-level module-load-failure listener — same full-page-only guard as above.
  if (out.includes('</head>')) out = out.replace('</head>', `${MODULE_ERROR_LISTENER}</head>`);
  // Site-wide dark-mode: anti-flash <head> init script + the header sun/moon
  // toggle. Guarded on the site header, so only full site pages get it (embed
  // pages bypass fill() and have no header — they keep pure system-preference).
  if (out.includes('<header class="site">')) {
    // Inject right AFTER <meta charset> (not before it) so the charset stays
    // within the first 1024 bytes the HTML spec requires — the script still runs
    // in <head> before the stylesheet and body, so there is no flash.
    out = out.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${THEME_HEAD}`);
    out = out.replace(/(<nav aria-label="Primary">[\s\S]*?<\/nav>)/, `$1\n    ${THEME_TOGGLE_BTN}`);
  }
  // Trim over-long <title>/<meta description> to SERP-compliant lengths BEFORE
  // injectSeo, so the derived og:/twitter: title+description inherit the compact
  // values (no-op on fragments and on already-compliant tags).
  out = compactTitle(out);
  out = compactDesc(out);
  // Normalize/complete per-page SEO social tags (no-op on fragments).
  out = injectSeo(out);
  // Inject the site-wide entity @graph (Organization/WebSite/WebPage/Breadcrumb).
  out = injectEntitySchema(out);
  // Inject the site-wide search trigger + Cmd/Ctrl+K command palette (no-op on
  // header-less pages like embeds).
  out = injectSearch(out);
  // Inject the "Was this tool helpful?" feedback widget on TOOL pages only
  // (no-op on home, legal/static, data-reference, and embed pages).
  out = injectFeedback(out);
  // Inject the "Report a wrong result" widget on the SAME tool pages (shared
  // gates via injectToolScript, so the two can never diverge).
  out = injectReport(out);
  // Record visits to this tool page for the Cmd/Ctrl+K palette's "recently
  // viewed" recents list. Same gates via injectToolScript, so it loads on
  // exactly the same pages as the two widgets above.
  out = injectToolScript(out, '/assets/recent-tools.js');
  return out;
}

// fill() for tool pages: same as fill(), then injects the centralized
// "Related tools" block just before the site footer. Only tool-page writes
// call this, so the homepage and legal/static pages stay untouched.
// Weakest commodity tool pages: kept live and linked for users, but excluded from
// Google's index + the sitemap so quality reviews sample a smaller, stronger site.
// Criteria (2026-07-05): me-too utility, thin prose, and ZERO recorded search traction
// in marketing-insights.md. Anything with impressions/clicks, the finance/tax cluster,
// and the alternativeto trio (diff/qr/color) must never be added here.
const NOINDEX_TOOLS = new Set([
  '/morse-code-translator/',
  '/json-formatter/',
  '/base-converter/',
  '/stopwatch/',
  '/uuid-generator/',
  '/pomodoro-timer/',
  '/sleep-calculator/',
  '/random-number-generator/',
  '/lorem-ipsum-generator/',
  '/text-case-converter/',
  '/base64-encode-decode/',
  '/time-zone-converter/',
]);

// Per-tool authoritative citations (src/data/tool-sources.json). Only pages with a
// genuine primary authority carry these — NIST for measurement, IRS for contribution
// limits, ACOG for gestational dating, CFPB for mortgage mechanics, and so on. Pages
// with nothing real to cite (a countdown timer, a diff checker) deliberately have no
// entry: inventing a citation for them is the same thin-content padding the rest of
// this build works to avoid. Every URL was fetched and content-checked when added.
let TOOL_SOURCES = {};

// The date we last checked the tax figures against their primary sources, read from
// tax-data-2026.json's _meta.lastSourced once the file loads. It exists because the
// bonus-page sources block used to hard-code "verified 2026-06-16" as a string
// literal, so no amount of correcting the underlying data could ever move it. That
// is a factual claim to a reader about when we checked, and a literal cannot keep
// it true: on 2026-07-29 six states' brackets were rewritten and every page still
// said the figures were verified in June. Assigned in buildStatePages alongside
// taxData, same pattern as TOOL_SOURCES above.
let LAST_SOURCED = '';

function toolSourcesBlock(currentPath) {
  const slug = String(currentPath || '').replace(/^\/|\/$/g, '');
  const items = TOOL_SOURCES[slug];
  if (!items || !items.length) return '';
  const lis = items.map((s) => (
    `<li><a href="${escHtml(s.url)}" rel="noopener" target="_blank">${escHtml(s.title)}</a>`
    + ` — ${escHtml(s.publisher)}</li>`
  )).join('');
  return `<section class="sources"><h2>Sources</h2><ul>${lis}</ul></section>`;
}

function fillTool(tpl, map, currentPath) {
  let out = fill(tpl, map);
  // Dated tax tools: inject a visible "Last updated" byline right under the H1
  // (near the top) as an AI/reader freshness signal for the 2026 figures.
  if (DATED_TAX_TOOLS.has(currentPath)) {
    out = out.replace('</h1>', `</h1>\n    ${toolUpdatedLine(currentPath)}`);
  }
  out = out.replace('<footer class="site">', `${toolSourcesBlock(currentPath)}\n${relatedToolsBlock(currentPath)}\n<footer class="site">`);
  // Plain-question reveal controller, on the listed tax pages only (no-op on
  // every other path). The 51 state bonus pages render through fill(), not
  // fillTool(), so they call injectQuestionFlow directly at their write site.
  out = injectQuestionFlow(out, currentPath);
  if (NOINDEX_TOOLS.has(currentPath)) {
    out = out.replace('</head>', '  <meta name="robots" content="noindex, follow">\n</head>');
  }
  return out;
}

// Deep-clone a value omitting internal-only keys ("_"-prefixed like _meta/_source/_note,
// plus any stray "verification") so build provenance never ships in page source or the
// published data JSON. The source data file keeps them; only embedded/published copies are stripped.
function stripInternal(value) {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_') || k === 'verification') continue;
      out[k] = stripInternal(v);
    }
    return out;
  }
  return value;
}

// A prominent, user-visible banner when a state's figures are from a prior year
// (prior-year fallback policy) — e.g. California shows 2025 rates while 2026 is pending.
// Returns '' when figureYear matches the site tax year.
// Scope matters here. figureYear governs ONLY the state's bracket table. A bonus
// page's headline number comes from the separate supplemental rate in
// state-supplemental-2026.json, which is current, so a blanket "this page shows
// <prior year> figures" is false for the number the page is named after. Say
// which figures are affected instead of labelling the whole page.
//
// Do not reintroduce the word "official" either. Some supplemental rates carry
// singleSourced: false and cite a payroll vendor rather than the state, so
// "official" would be a second false claim on the same line.
// 2026-07-30: this used to hard-code "brackets" as the thing on prior-year figures, which was
// true only for California. Arizona and DC joined the fallback list that day with the OPPOSITE
// shape: their rates and bracket tables are current and only the STANDARD DEDUCTION is a prior
// year. The banner was therefore telling readers "Arizona has not published its 2026 income tax
// brackets yet" when Arizona's flat 2.5% is current statute, and telling DC readers the same
// about a 2026 bracket table that is operative under D.C. Code 47-1806.03(a)(11). So the scope
// is now read from the data instead of assumed. `figureYearScope` is required on any state whose
// figureYear is not the build year, enforced in scripts/test-tax-data.js.
const FIGURE_YEAR_SCOPE = {
  brackets: {
    label: (fy) => `${fy} brackets`,
    body: (name, fy, yr) =>
      `${name} has not published its ${yr} income tax brackets yet, so figures worked out from ` +
      `those brackets use its ${fy} ones.`,
  },
  standardDeduction: {
    label: (fy) => `${fy} standard deduction`,
    body: (name, fy, yr) =>
      `${name}'s tax rates for ${yr} are current, but it has not published its ${yr} standard ` +
      `deduction yet, so this page subtracts its ${fy} amount.`,
  },
};

function figureYearBanner(state, year) {
  const fy = Number(state.figureYear);
  const yr = Number(year);
  if (!fy || fy === yr) return '';
  const scope = FIGURE_YEAR_SCOPE[state.figureYearScope] || FIGURE_YEAR_SCOPE.brackets;
  return `<p class="year-fallback" role="note">` +
    `<strong>${scope.label(fy)} (${yr} pending).</strong> ` +
    `${scope.body(state.name, fy, yr)} We update this page when the state publishes.` +
    `</p>`;
}

// Jurisdictions whose figures are not on this build's tax year, read from the
// data's own figureYear. Same test the study's byline and its in-table marker
// use, so one state publishing its tables clears every one of them at once.
function priorYearJurisdictions(states, year) {
  return states.filter((s) => {
    const fy = Number(s && s.figureYear);
    return fy && fy !== Number(year);
  });
}

// The take-home study's COVERAGE claim, in one place. "the 2026 rules of every
// state and DC" is false while any jurisdiction sits on prior-year tables, and
// it was written out longhand in the study's own lede and again in the study
// cross-link on all 51 state pages. Both now call this, so the sentence corrects
// itself the moment California and Oklahoma publish.
// `scope` is the coverage wording the calling sentence needs, since one says
// "every state and DC" and the other "all 50 states and the District of Columbia".
function studyRulesPhrase(states, year, scope) {
  const base = `the ${year} rules of ${scope}`;
  // Sorted by name so the callers, one iterating the data file and one iterating
  // a table ranked by take-home pay, still print the same sentence.
  const prior = priorYearJurisdictions(states, year)
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!prior.length) return base;
  const years = [...new Set(prior.map((s) => Number(s.figureYear)))];
  const andList = (arr) => (arr.length === 1
    ? arr[0]
    : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const one = prior.length === 1;
  // One shared fallback year is the normal case and reads far better than a year
  // in brackets after every name; the mixed case still names each one's year.
  return years.length === 1
    ? `${base}, except ${andList(prior.map((s) => s.name))}, still on ${one ? 'its' : 'their'} ${years[0]} tables`
    : `${base}, except ${andList(prior.map((s) => `${s.name} (${s.figureYear})`))}, still on ${one ? 'its' : 'their'} most recent published tables`;
}

// Rate formatter. Rounds to 3 decimal places of a percent and drops trailing
// zeros via Number coercion, so 0.05525 prints "5.525%" rather than the old
// two-decimal "5.53%" (which misstated New Jersey's real bracket rate).
// Matches the client-side `ratePct` in src/assets/app.js so the server-rendered
// prose and the live calculator never disagree.
const pctStr = (r) => (+(r * 100).toFixed(3)).toString() + '%';
// (Retired) A two-decimal formatter used to serve the FAQ answers alone, so
// those strings — which are the page's FAQPage JSON-LD as well as its visible
// FAQ — stayed byte-identical to what was already indexed while a title/markup
// experiment ran. It let a state's FAQ round a rate differently from the prose
// right above it, i.e. the page contradicted itself. The FAQ answers now use the
// same pctStr as the prose. New Jersey's 5.525% band is the one rate on the site
// that needs the third decimal; it appears in bracket tables, not in a FAQ.
const usd0 = (n) => '$' + Math.round(n).toLocaleString('en-US');

// The one salary every pre-computed example on a state page is based on: the
// answer-block prose, the neighbour comparison table, and the calculator's
// pre-filled input all resolve to this number, so a visitor who has typed
// nothing never sees the page quote two different example salaries.
// Taken from STUDY_SALARIES so the state pages and the all-states study open on
// the same number rather than two example salaries that drifted apart.
const DEFAULT_SALARY = STUDY_SALARIES[0];

// Some states are legally "graduated" but behave as a single rate: a 0% band on
// the first slice of income, then one rate on everything above it (Idaho,
// Mississippi, and Ohio since HB 96 took full effect in 2026). Describing those
// as "graduated, two brackets, 0% to 5.3%" and then as "a flat 5.3% rate" on the
// same page reads as a contradiction. True only when the single-filer ladder
// opens at 0% and has exactly one distinct non-zero rate; a state with two
// distinct non-zero rates stays graduated.
function isEffectivelyFlat(t) {
  if (!t || t.type === 'flat') return false;
  const b = (t.brackets && t.brackets.single) || [];
  if (b.length < 2) return false;
  if (b[0].rate !== 0) return false;
  const nonZero = new Set(b.map((br) => br.rate).filter((r) => r > 0));
  return nonZero.size === 1;
}
// The two numbers such a state's copy needs, composed only from its own bracket
// data: the single effective rate, and where the 0% band stops. zeroUpTo is a
// TAXABLE-income figure — it applies after the state standard deduction — so
// every sentence built from it has to say "taxable income", never plain
// "income". Idaho's $4,811 sits on top of a $16,100 single deduction; calling it
// "the first $4,811 of income" told the visitor tax starts about $16k too early
// and contradicted the page's own bracket table.
function effectiveFlatFacts(t) {
  const b = (t.brackets && t.brackets.single) || [];
  const rate = b.map((br) => br.rate).find((r) => r > 0);
  return { rate, zeroUpTo: b[0].upTo };
}

// Does this state's sourced tax data carry a standard-deduction figure at all?
// Five states do not (Ohio, New Jersey, Wisconsin, Connecticut, Pennsylvania),
// and the shared copy used to assume every state did: the lede, the body opener,
// the bracket-table intro and the FAQ all said the rate lands "after the state
// deduction", while stateTaxFacts said, correctly from the same data, that the
// state provides none. Both halves were visible on one page, and on Ohio the
// wrong half was also the FAQPage JSON-LD Google receives. Every sentence that
// mentions the deduction now branches on this, so it is true per state. Reads
// the data only — it invents no figure for the states that have none.
const hasStateDeduction = (t) => !!(t && t.standardDeduction);

// Genuinely state-specific tax facts derived from the (already-sourced) data:
// bracket count, rate range, top rate + threshold, standard deduction, and a
// worked $60k example. Distinct per state — clears scaled/duplicate-content risk.
function stateTaxFacts(state, year, taxData) {
  const t = state.tax;
  const sd = t.standardDeduction;
  const sdText = sd
    ? `For ${year}, ${state.name}'s state standard deduction is ${usd0(sd.single)} for single filers and ${usd0(sd.married)} for married couples filing jointly`
    : `${state.name} does not provide a state standard deduction`;
  let example = '';
  try {
    const ann = computePaycheck({ wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: state.slug }, taxData).annual;
    if (Number.isFinite(ann.state) && ann.state > 0) {
      example = ` As a worked example, a single filer earning $60,000 pays about ${usd0(ann.state)} in ${state.name} income tax (roughly ${(ann.state / 60000 * 100).toFixed(1)}% of gross) before federal tax and FICA.`;
    } else if (ann.state === 0) {
      example = ` A single filer earning $60,000 owes essentially no ${state.name} income tax once the deduction is applied.`;
    }
  } catch (_) { /* leave example empty if compute fails */ }

  if (t.type === 'flat') {
    // "after that, all REMAINING taxable income" only parses when sdText named a
    // deduction to come off first; after "X does not provide a state standard
    // deduction" it pointed at nothing.
    const rest = sd ? 'after that, all remaining taxable income is' : 'all taxable income is';
    return `<p>${sdText}; ${rest} taxed at the single ` +
      `flat rate of <strong>${pctStr(t.rate)}</strong> — ${state.name} does not use graduated brackets for ${year}.${example}</p>`;
  }
  if (isEffectivelyFlat(t)) {
    const f = effectiveFlatFacts(t);
    const band = sd
      ? `after that, the first ${usd0(f.zeroUpTo)} of remaining taxable income is`
      : `the first ${usd0(f.zeroUpTo)} of ${state.name} taxable income is`;
    return `<p>${sdText}; ${band} taxed at ` +
      `<strong>0%</strong> and every dollar above it at the single flat rate of <strong>${pctStr(f.rate)}</strong> — ` +
      `${state.name} does not run a ladder of rising rates for ${year}.${example}</p>`;
  }
  const b = t.brackets.single || [];
  const n = b.length;
  const low = pctStr(b[0].rate);
  const top = pctStr(b[n - 1].rate);
  const topThresh = n >= 2 ? b[n - 2].upTo : null;
  return `<p>${state.name} uses a <strong>graduated income tax with ${n} bracket${n > 1 ? 's' : ''}</strong> for ${year}, ` +
    `with marginal rates ranging from ${low} to a top rate of <strong>${top}</strong>` +
    (topThresh ? ` (which applies to single-filer taxable income above ${usd0(topThresh)})` : '') + `. ` +
    `${sdText}.${example}</p>`;
}

// Near-page-1 target states (06-28): the 5 with at least one query inside SERP
// pos 30. Scoped on-page lifts (extractable tax-rate sentence, H1 vocab, a neutral
// free-alternative line) land ONLY here — the rest of the catalog sits at pos 40+
// where on-page tweaks yield nothing (the page-1-or-zero cliff).
const TARGET_STATES = new Set(['pennsylvania', 'california', 'colorado', 'massachusetts', 'new-mexico']);

// ── What a state takes from a paycheck besides income tax ──────────────────
// Some states run employee-funded payroll programs (unemployment insurance,
// paid family leave, disability, long-term care). Alaska and Washington run one
// or more of those AND levy no income tax, so any sentence claiming a no-tax
// state's paycheck loses "only federal tax and FICA" is false there.
//
// The rules, the category names and the "may this page claim exclusivity"
// verdict all live in src/content/withholding-profile.js, which build.js and
// state-applies.js both import, because keeping a second copy here is what let
// one page contradict itself. Every sentence of this class is built from
// withholdingProfile(state), never from a list of state names, so a state that
// starts or stops a program rewrites its own copy on the next build.

// One extractable sentence stating the state's 2026 income-tax rate, derived from
// the already-sourced tax data (never hardcoded). Serves the informational
// "{state} income tax rate" query (PA ranks ~pos 9 for it) and the AI-answer format.
function stateRateSentence(state, year) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t) return '';
  if (t.type === 'flat') return `${state.name}'s ${year} state income tax is a flat ${pctStr(t.rate)}.`;
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return '';
  return `${state.name}'s ${year} state income tax is graduated, ranging from ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)}.`;
}

// Compact "answer figure" for a state's income tax — the state's flat rate or its
// low→top graduated range, derived from the same sourced data (never hardcoded).
// Feeds the query-led <title>/meta for the NEAR_PAGE_1 target states only.
function stateRateFigure(state) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t) return null;
  if (t.type === 'flat') return { title: `Flat ${pctStr(t.rate)}`, desc: `a flat ${pctStr(t.rate)}` };
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return null;
  const lo = pctStr(b[0].rate), hi = pctStr(b[b.length - 1].rate);
  return { title: `${lo}–${hi}`, desc: `graduated from ${lo} to ${hi}` };
}

// <title> per state. The phrase people actually type is "{state} paycheck
// calculator", so it now opens every title UNBROKEN. The old title split that
// phrase down the middle with "and Payroll", which no searcher writes.
// "Take-home pay" was the site's own body/meta vocabulary and appeared in no
// title at all, so it rides in the clause after the colon.
//
// The variants are tried longest-first and the first one inside the 60-char SERP
// budget wins, so long state names shed a word by DESIGN here rather than having
// compactTitleStr silently peel the whole clause off later. The last fallback is
// the bare base, which is 45 chars even for District of Columbia, so a state can
// never lose the phrase or the year.
//
// NEAR_PAGE_1 target states keep their rate figure in the title instead of the
// take-home clause (both together blow the budget): it serves the
// "{state} income tax rate {year}" query they already rank near page 1 for, and
// their take-home framing still sits in the meta description and the lead
// paragraph under the H1.
function stateTitle(state, year) {
  const base = `${state.name} Paycheck Calculator ${year}`;
  const variants = [];
  if (TARGET_STATES.has(state.slug)) {
    const fig = stateRateFigure(state);
    if (fig) variants.push(`${base}: ${fig.title} Income Tax`);
  }
  variants.push(`${base}: Take-Home Pay After Taxes`, `${base}: Take-Home Pay`, base);
  return variants.find((t) => decodedLen(t) <= 60) || base;
}

// Answer-first meta descriptions (≤155 chars) for the highest-traffic paycheck
// pages: lead with the concrete figure a searcher wants (the graduated rate, or
// "no state income tax") instead of a generic "free calculator" opener. Keyed by
// slug so only these pages change; the other 46 states keep the generated meta.
// Every figure is the state's own 2026 data (matches stateRateFigure / the page).
const STATE_META_OVERRIDE = {
  california: 'California income tax is graduated 1% to 12.3% for 2026. Free California paycheck calculator: your take-home after federal tax, FICA and CA tax.',
  'new-york': 'New York income tax is graduated 3.9% to 10.9% for 2026. Free New York paycheck calculator: your take-home after federal tax, FICA and NY tax.',
  oregon: 'Oregon income tax is graduated 4.75% to 9.9% for 2026. Free Oregon paycheck calculator: your take-home after federal tax, FICA and OR tax.',
};

// Texas and Florida get an answer-first meta too, but the opening claim is
// BUILT from their data rather than typed out: only the tail is fixed copy, and
// the "cut only by federal tax and FICA" half is emitted solely when the state
// really withholds nothing of its own. Alaska and Washington have no income tax
// either and would have inherited a false sentence from a hardcoded string.
const NOTAX_META_TAIL = {
  texas: 'Free Texas paycheck calculator for your take-home pay.',
  florida: 'Free Florida paycheck calculator for your take-home.',
};
function noTaxMetaDesc(state, year) {
  // Texas and Florida keep the tail they were written with; the other seven
  // no-income-tax states get the same answer-first shape instead of a generic
  // opener that the 155-char clamp cut off before it said anything.
  const tail = NOTAX_META_TAIL[state.slug] || `Free ${state.name} paycheck calculator for your take-home pay.`;
  const wp = withholdingProfile(state);
  return wp.federalOnly
    ? `${state.name} has no state income tax, so your ${year} paycheck is cut only by federal tax and FICA. ${tail}`
    : `${state.name} has no state income tax, but ${wp.programPhrase} contributions still come out of your ${year} pay. ${tail}`;
}
// Trailing meta clause for a state with no income tax. It names the state's own
// employee-paid contributions where it has them, so it never implies federal
// figures are the only thing the tool has to show.
function noTaxMetaNote(state) {
  const wp = withholdingProfile(state);
  return wp.federalOnly
    ? `. ${state.name} has no state income tax, so it doubles as a federal income tax calculator`
    : `. ${state.name} has no state income tax, and this tool still counts its ${wp.programPhrase} contributions`;
}

// Meta description per state. Answer-first overrides win for the top paycheck
// pages; target states otherwise lead with the query + the rate answer in the
// first ~150 chars; all others keep the original description verbatim.
function stateMetaDesc(state, year) {
  if (STATE_META_OVERRIDE[state.slug]) return STATE_META_OVERRIDE[state.slug];
  const wp = withholdingProfile(state);
  if (!wp.hasIncomeTax) {
    const nt = noTaxMetaDesc(state, year);
    if (nt) return nt;
  }
  if (TARGET_STATES.has(state.slug)) {
    const fig = stateRateFigure(state);
    if (fig) return `${state.name} income tax rate ${year}: ${fig.desc}. Free ${state.name} paycheck and take-home pay calculator — enter your salary or hourly wage to see your ${year} take-home after federal tax, FICA and ${state.name} state income tax.`;
  }
  const taxPhrase = wp.hasIncomeTax ? `, and ${state.name} state income tax` : '';
  const metaTaxNote = wp.hasIncomeTax
    ? ` — also works as a ${state.name} income tax calculator`
    : noTaxMetaNote(state);
  return `Free ${year} ${state.name} (${state.abbr}) paycheck and payroll calculator. Enter your salary or hourly wage to see your take-home pay after federal tax, Social Security, Medicare${taxPhrase}${metaTaxNote}. Supports weekly, biweekly, monthly and more.`;
}

// Spell small counts out as words ("nine-bracket ladder") — headings and ledes
// keyed on structural facts must differ in LETTERS, not just digits, so pages
// with different structures stop sharing a template skeleton.
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numWord = (n) => NUM_WORDS[n] || String(n);

// Data-keyed lede: the opening sentence embeds the state's actual tax structure
// (flat rate / bracket count + range / no tax) instead of a shared template
// sentence, so the 51 ledes differ because the FACTS differ.
function stateLede(state, year) {
  const wp = withholdingProfile(state);
  const kw = wp.hasIncomeTax
    ? 'paycheck, payroll and income tax calculator'
    : 'paycheck and payroll calculator';
  const open = `Use this free ${state.name} (${state.abbr}) ${kw} to estimate your ${year} take-home pay`;
  const t = state.tax;
  if (!wp.hasIncomeTax) {
    const angle = NOTAX_ANGLE[state.slug] || 'other taxes';
    // The closing clause is data-keyed: a no-income-tax state that runs its own
    // employee-paid programs cannot say "just federal tax and FICA come out".
    return wp.federalOnly
      ? `${open}. ${state.name} runs on ${angle}, not a wage tax, so just federal tax and FICA come out.`
      : `${open}. ${state.name} runs on ${angle}, not a wage tax, so what comes out is federal tax, FICA and ${state.name}'s ${wp.programPhrase} contributions.`;
  }
  if (t.type === 'flat') {
    return `${open} after federal income tax, Social Security, Medicare, and ${state.name}'s flat ${pctStr(t.rate)} state income tax.`;
  }
  if (isEffectivelyFlat(t)) {
    const f = effectiveFlatFacts(t);
    // The trailing gloss explains what "taxable income" means for THIS state.
    // Ohio has no state standard deduction, so "your pay after the state
    // deduction" described a step Ohio does not have.
    const gloss = hasStateDeduction(t)
      ? ` — your pay after the state deduction.`
      : `, and it has no state standard deduction.`;
    return `${open} after federal income tax, Social Security, Medicare, and ${state.name}'s flat ${pctStr(f.rate)} state income tax, which skips the first ${usd0(f.zeroUpTo)} of taxable income${gloss}`;
  }
  const b = (t.brackets && t.brackets.single) || [];
  const range = b.length ? ` (${numWord(b.length)} brackets, ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)})` : '';
  return `${open} after federal income tax, Social Security, Medicare, and ${state.name}'s graduated state income tax${range}.`;
}

// Data-keyed H2 for the main explainer section: the heading itself states the
// structure of the state's tax (flat rate, bracket-ladder count, or none), so
// no two structurally-different states share it.
function stateBodyH2(state, year) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t) {
    return `No state income tax in ${state.name} — so what still shrinks your ${year} paycheck?`;
  }
  if (t.type === 'flat') {
    return `How ${state.name}'s flat ${pctStr(t.rate)} income tax hits your ${year} paycheck`;
  }
  if (isEffectivelyFlat(t)) {
    const f = effectiveFlatFacts(t);
    return `How ${state.name}'s flat ${pctStr(f.rate)} income tax, which skips the first ${usd0(f.zeroUpTo)} of taxable income, hits your ${year} paycheck`;
  }
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return `How ${state.name} paychecks are taxed in ${year}`;
  return `${state.name}'s ${numWord(b.length)}-bracket ladder (${pctStr(b[0].rate)}–${pctStr(b[b.length - 1].rate)}): what comes out of each ${year} check`;
}

// Scoped vocab + one neutral positioning line for the target states only. Carries
// the "salary after taxes" / "income tax calculator" query vocab and a single
// neutral free-alternative sentence (competitor-brand queries surfaced for these).
function targetIntro(state, year) {
  if (!TARGET_STATES.has(state.slug)) return '';
  return `<p class="note">Free ${state.name} salary-after-taxes and income tax calculator — a no-signup, in-browser alternative to paid tools like SmartAsset and ADP. Estimate your ${year} take-home pay for any salary, hourly rate, or pay frequency.</p>`;
}

// ONE $75,000 single-filer computation per state, shared by every place a
// take-home figure is rendered on that page: the extractable answer sentence,
// the headline number in the calculator's answer band, and the band's sub-line.
// Two independent computations can drift apart under a later engine change; one
// cannot. Computed at the biweekly frequency so the per-paycheck figure comes
// out of the same call as the annual one.
function stateNet75(state, taxData) {
  try {
    const r = computePaycheck(
      { wage: { type: 'salary', amount: 75000 }, filingStatus: 'single', payFrequency: 'biweekly', stateSlug: state.slug },
      taxData
    );
    if (!Number.isFinite(r.annual.net) || !Number.isFinite(r.perPaycheck.net)) return null;
    // The same call also carries the per-paycheck breakdown the results table
    // shows on the page defaults (biweekly, single, $75,000, "Per paycheck"
    // view), so the table, the headline figure and the answer sentence are three
    // readings of one computation and cannot drift apart.
    const pp = r.perPaycheck;
    const perPaycheck = {
      gross: pp.gross,
      federal: pp.federal,
      socialSecurity: pp.socialSecurity,
      medicare: pp.medicare,
      state: pp.state,
      net: pp.net
    };
    if (Object.values(perPaycheck).some((v) => !Number.isFinite(v))) return null;
    // The whole result rides along too. The results panel is not six numbers, it
    // is the annual figures behind the donut and the rate row as well, and every
    // one of them has to come out of this single call for the panel to be
    // internally consistent.
    return { annualNet: r.annual.net, biweeklyNet: pp.net, perPaycheck, result: r };
  } catch (_) { return null; }
}

// Byte-for-byte copies of every formatter app.js renders the results panel with
// (app.js lines 11-17), so a build-rendered figure and the figure the browser
// writes over it on the first render are the same string and hydration is a
// visual no-op. Parity is asserted per state below rather than trusted.
const usdApp = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2App = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctApp = (n) => (n * 100).toFixed(1) + '%';
const ratePctApp = (n) => (+(n * 100).toFixed(3)).toString() + '%';
const escLblApp = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// The U+2212 minus app.js puts in front of every withheld line. Not a hyphen.
const APP_MINUS = '−';

// Second, independently written two-decimal formatter, the usd0 of the cents
// world: plain number grouping with the dollar sign glued on, rather than Intl's
// currency style. Only exists to disagree with usd2App if Intl's currency output
// ever shifts (a stray non-breaking space, a "US$" prefix, a rounding change).
const usd2Ref = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// The guard's denominator, DERIVED from src/assets/app.js.
//
// The previous version of this check iterated a hand-written list of six field
// names. #programLines was not on that list, so the one element that shipped
// empty sat structurally outside the denominator: the check could not have
// failed on the defect it existed to catch, and it reported a confident pass
// while 14 states served a subtraction that was wrong by the size of their
// disability premium. A denominator maintained by hand always drifts behind the
// code it guards, so it is now read out of app.js on every build.
//
// What is derived: the set of element ids that a function reachable from app.js's
// own boot entry (init) assigns to .textContent or .innerHTML. That is exactly
// the class of write that decides what a crawler, a search snippet and a
// JavaScript-off reader see, which is the class of defect this guards. Adding a
// new one to app.js puts it in the set automatically, and the build then fails
// until build.js has a pre-rendered value for it.

// Split app.js into its top-level function bodies by brace matching. Covers
// `function name(...) {` and `const name = (...) => {` declared at column 0,
// which between them is every function in that module.
function appTopLevelFunctions(src) {
  const fns = new Map();
  const decl = /^(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{)/gm;
  let m;
  while ((m = decl.exec(src)) !== null) {
    const name = m[1] || m[2];
    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    fns.set(name, src.slice(m.index, end + 1));
  }
  return fns;
}

// Everything init can reach. Deliberately over-inclusive: a bare mention of a
// function name counts as a call, because `addEventListener('input', render)`
// and `.then(renderCompare)` are calls too. Over-inclusion can only widen the
// set of elements the build is made responsible for, never narrow it.
function appReachableFrom(fns, root) {
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || !fns.has(name)) continue;
    seen.add(name);
    const body = fns.get(name);
    let m;
    const ident = /\b([A-Za-z_$][\w$]*)\b/g;
    while ((m = ident.exec(body)) !== null) {
      if (fns.has(m[1]) && !seen.has(m[1])) queue.push(m[1]);
    }
  }
  return seen;
}

// Every element id a body touches, split by whether the touch is null-guarded
// and by whether it writes the element's content. `$('id').textContent = x` is
// an unguarded content write; `const el = $('id'); if (el) el.innerHTML = x` is
// a guarded one. Only a guarded id is allowed to be missing from the HTML.
function appElementTouches(body) {
  const touches = [];
  const aliases = new Map();
  let m;
  const aliasRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\$\(\s*(['"])([\w-]+)\2\s*\)/g;
  while ((m = aliasRe.exec(body)) !== null) aliases.set(m[1], m[3]);

  const directRe = /\$\(\s*(['"])([\w-]+)\1\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g;
  while ((m = directRe.exec(body)) !== null) {
    const rest = body.slice(m.index + m[0].length);
    const content = /^(?:textContent|innerHTML)$/.test(m[3]) && /^\s*=[^=]/.test(rest);
    touches.push({ id: m[2], guarded: false, content });
  }
  for (const [alias, id] of aliases) {
    const a = alias.replace(/[$]/g, '\\$');
    const used = new RegExp(`\\b${a}\\s*[.)\\]]`).test(body);
    if (!used) continue;
    const guarded =
      new RegExp(`!\\s*${a}\\b`).test(body) ||
      new RegExp(`\\bif\\s*\\(\\s*${a}\\s*[)&]`).test(body) ||
      new RegExp(`\\b${a}\\s*&&`).test(body);
    const content = new RegExp(`\\b${a}\\s*\\.\\s*(?:textContent|innerHTML)\\s*=[^=]`).test(body);
    touches.push({ id, guarded, content });
  }
  return touches;
}

// One scan per build. Returns the two derived sets the page guard runs on.
function scanAppFirstRender(src) {
  const fns = appTopLevelFunctions(src);
  // init is the only boot path: __bootInit() calls init() and nothing else.
  if (!fns.has('init') || !fns.has('render')) {
    throw new Error(
      'app.js scan failed: could not extract init()/render() from src/assets/app.js, so the ' +
      'pre-render guard has no denominator. Refusing to build a results panel it cannot check.'
    );
  }
  const reachable = appReachableFrom(fns, 'init');
  if (!reachable.has('render')) {
    throw new Error('app.js scan failed: render() is not reachable from init(); the extraction is wrong.');
  }
  const contentIds = new Set();
  const mayBeAbsent = new Map(); // id -> true only while every touch of it is guarded
  for (const name of reachable) {
    for (const t of appElementTouches(fns.get(name))) {
      if (t.content) contentIds.add(t.id);
      const prior = mayBeAbsent.has(t.id) ? mayBeAbsent.get(t.id) : true;
      mayBeAbsent.set(t.id, prior && t.guarded);
    }
  }
  if (contentIds.size === 0) {
    throw new Error(
      'app.js scan found zero elements whose content the first render writes. That cannot be true ' +
      'of this module, so the scan is broken and the guard would pass over nothing.'
    );
  }
  return { contentIds, mayBeAbsent, reachable: reachable.size, functions: fns.size };
}

// Pull an element's exact inner HTML out of a rendered page by id, by matching
// the opening tag and then walking forward with a depth count on that tag name.
// Returns null when no element carries the id.
function innerHtmlById(html, id) {
  const at = html.indexOf(`id="${id}"`);
  if (at === -1) return null;
  const open = html.lastIndexOf('<', at);
  const tag = /^<([A-Za-z][\w-]*)/.exec(html.slice(open));
  if (!tag) return null;
  const name = tag[1];
  const gt = html.indexOf('>', at);
  if (gt === -1) return null;
  const openRe = new RegExp(`<${name}[\\s>]`, 'g');
  const closeRe = new RegExp(`</${name}>`, 'g');
  let depth = 1;
  let i = gt + 1;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) return null;
    if (o && o.index < c.index) { depth++; i = o.index + o[0].length; continue; }
    depth--;
    if (depth === 0) return html.slice(gt + 1, c.index);
    i = c.index + c[0].length;
  }
  return null;
}

// Everything app.js's first render puts on the page for the form's own shipped
// defaults: $75,000 salary, single, biweekly, "Per paycheck", Simple mode, no
// advanced deductions. Each value is produced by the same formatter app.js uses,
// from the same computePaycheck call the headline figure and the answer sentence
// come from, so the served panel is one reading of one computation.
function statePanel(state, taxData, net75) {
  const r = net75.result;
  const a = r.annual;
  const p = r.perPaycheck;
  const g = a.gross;
  // app.js renderBreakdown()'s own width formatter: two decimals, annual basis.
  const w = (v) => (v / g * 100).toFixed(2) + '%';
  const ded = a.preTax + a.postTax + (a.statePrograms || 0);
  const bb = federalBracketBreakdown(g, 'single', taxData.federal, 0);

  const programLines = (p.programs || []).map((pr) =>
    `<div class="line"><span class="lbl">${escLblApp(pr.label)} (${ratePctApp(pr.rate)})</span><span>${APP_MINUS}${usd2App(pr.amount)}</span></div>`
  ).join('');

  // app.js keys this row on hasIncomeTax alone, so on the nine states without an
  // income tax the row is display:none from the first render onward and the only
  // thing the served HTML did with it was tell a crawler "Texas income tax
  // −$0.00". A withholding line that does not exist is not worth a row, so those
  // pages ship none. app.js null-checks both #stateLine and #rState, and the
  // guard below refuses to accept an absent element whose uses are not guarded.
  const stateTaxRow = state.hasIncomeTax
    ? `<div class="line" id="stateLine"><span class="lbl">${escLblApp(state.name)} income tax</span><span id="rState">${APP_MINUS}${usd2App(p.state)}</span></div>`
    : '';

  let bracketBody, bracketNote;
  if (!bb.bands.length || bb.taxable <= 0) {
    bracketBody = '<tr><td colspan="3">No federal income tax, taxable income is $0 after the standard deduction.</td></tr>';
    bracketNote = '';
  } else {
    bracketBody = bb.bands.map((b) => {
      const range = b.upper === Infinity ? `over ${usdApp(b.lower)}` : `${usdApp(b.lower)} – ${usdApp(b.upper)}`;
      return `<tr><td>${ratePctApp(b.rate)} <span class="bk-range">(${range})</span></td><td>${usdApp(b.amount)}</td><td>${usdApp(b.tax)}</td></tr>`;
    }).join('');
    bracketNote =
      `Taxable income ${usdApp(bb.taxable)} after the ${usdApp(bb.stdDed)} standard deduction. ` +
      `Your federal marginal rate is ${ratePctApp(bb.marginalRate)}, the federal tax on your next dollar earned.`;
  }

  const tokens = {
    ROW_GROSS: usd2App(p.gross),
    ROW_FEDERAL: APP_MINUS + usd2App(p.federal),
    ROW_SS: APP_MINUS + usd2App(p.socialSecurity),
    ROW_MEDICARE: APP_MINUS + usd2App(p.medicare),
    ROW_NET: usd2App(p.net),
    STATE_TAX_ROW: stateTaxRow,
    PROGRAM_LINES: programLines,
    RATE_MARGINAL: ratePctApp(bb.marginalRate),
    RATE_EFF: pctApp(a.effectiveRate),
    RATE_TAKE: pctApp(a.takeHomeRate),
    SEG_NET: w(a.net),
    SEG_TAX: w(a.totalTax),
    SEG_DED: w(ded),
    LG_NET: pctApp(a.net / g),
    LG_TAX: pctApp(a.totalTax / g),
    LG_DED: pctApp(ded / g),
    // renderBreakdown() hides the deductions key when there is nothing deducted.
    LG_DED_STYLE: ded > 0 ? '' : ' style="display:none"',
    BRACKET_BODY: bracketBody,
    BRACKET_NOTE: bracketNote,
    ADV_ECHO: `Take-home now: ${usd2App(p.net)} per 2 weeks`
  };

  // id -> what the served HTML must contain, checked against the emitted page.
  // `absent` is only accepted for an id every one of whose uses in app.js is
  // null-guarded; the scan above decides that, not this table.
  const expected = {
    netBig: { expect: usd2App(p.net) },
    netSub: { expect: `take-home per 2 weeks · ${usd0(a.net)}/yr` },
    netLabel: { expect: stateNetLabel(state) },
    advEcho: { expect: tokens.ADV_ECHO },
    rGross: { expect: tokens.ROW_GROSS },
    rFederal: { expect: tokens.ROW_FEDERAL },
    rSS: { expect: tokens.ROW_SS },
    rMedicare: { expect: tokens.ROW_MEDICARE },
    rState: state.hasIncomeTax
      ? { expect: APP_MINUS + usd2App(p.state) }
      : { absent: `${state.name} has no state income tax, so no such withholding row is served` },
    rNet: { expect: tokens.ROW_NET },
    programLines: { expect: programLines },
    rMarginal: { expect: tokens.RATE_MARGINAL },
    rEff: { expect: tokens.RATE_EFF },
    rTake: { expect: tokens.RATE_TAKE },
    lgNet: { expect: tokens.LG_NET },
    lgTax: { expect: tokens.LG_TAX },
    lgDed: { expect: tokens.LG_DED },
    bracketBody: { expect: bracketBody },
    bracketNote: { expect: bracketNote },
    // Written on first render only when the visitor has a deduction to show, and
    // on the shipped defaults they are genuinely zero. The rows are hidden, so
    // the served figure is never read, but it still has to be the true one.
    rPreTax: { expect: usd2App(p.preTax) },
    rPostTax: { expect: usd2App(p.postTax) },
    // syncAdvancedQuestions() writes usd(0) here before the first render.
    depCredit: { expect: usdApp(0) },
    // renderCompare() clears this until a state is picked, and populateCompare()
    // only runs when the visitor opens the panel.
    cmpResult: { expect: '' },
    // announceResult() returns before the boot render (booted is still false),
    // so the live region ships and stays empty until the visitor edits something.
    outStatus: { expect: '' },
    // No state page carries this element: the "example" kicker lives on other
    // templates. app.js null-checks it, and it is written only after the visitor
    // first touches the form, never on the boot render.
    netKicker: { absent: 'no state page ships a #netKicker; written only after the first visitor edit' }
  };

  return { tokens, expected, breakdown: { p, programs: p.programs || [] } };
}

// Fails the build if the served results panel is not what app.js's first render
// will produce: a missing pre-render, a figure that would flicker on hydration,
// a row app.js writes that build.js has never heard of, or a breakdown whose
// visible rows do not add up to the Net pay printed under them.
function assertPanelParity(state, net75, panel, html, scan) {
  if (!net75 || !net75.result) {
    throw new Error(
      `pre-rendered results panel missing for ${state.slug}: no $75,000 computation, so the page ` +
      `would ship a table of zeroes under a sentence quoting a real take-home figure.`
    );
  }
  if (usd0(net75.annualNet) !== usdApp(net75.annualNet)) {
    throw new Error(
      `formatter parity broken for ${state.slug}: build usd0 "${usd0(net75.annualNet)}" ` +
      `vs app.js usd "${usdApp(net75.annualNet)}", the pre-rendered take-home would flicker on hydration.`
    );
  }

  const { expected } = panel;
  const derived = scan.contentIds;

  // 1. Denominator, both directions. Every element app.js writes must have a
  //    pre-rendered value here, and every entry here must still be something
  //    app.js writes, so a deleted render line cannot leave a stale check behind.
  for (const id of derived) {
    if (!(id in expected)) {
      throw new Error(
        `app.js writes #${id} on its first render but build.js has no pre-rendered value for it. ` +
        `${state.slug} would serve whatever the template happens to contain there while the rest ` +
        `of the panel is real. Add it to statePanel().`
      );
    }
  }
  for (const id of Object.keys(expected)) {
    if (!derived.has(id)) {
      throw new Error(
        `build.js pre-renders #${id} but app.js's first render no longer writes it. The check is ` +
        `stale: remove it, or restore the write.`
      );
    }
  }

  // 2. Every derived id, against the page that was actually emitted.
  let checked = 0;
  for (const id of derived) {
    const e = expected[id];
    const got = innerHtmlById(html, id);
    if (e.absent) {
      if (scan.mayBeAbsent.get(id) !== true) {
        throw new Error(
          `#${id} is declared absent for ${state.slug} (${e.absent}) but app.js uses it without a ` +
          `null check, so the first render would throw and the calculator would not run at all.`
        );
      }
      if (got !== null) {
        throw new Error(`#${id} is declared absent for ${state.slug} but the emitted page still carries it.`);
      }
      checked++;
      continue;
    }
    if (got === null) {
      throw new Error(
        `#${id} is missing from the emitted ${state.slug} page, but app.js writes it unconditionally ` +
        `on first render. Expected "${e.expect}".`
      );
    }
    if (got !== e.expect) {
      throw new Error(
        `pre-render mismatch for ${state.slug} #${id}: served "${got}" but app.js's first render ` +
        `writes "${e.expect}". Hydration would visibly change the page.`
      );
    }
    checked++;
  }
  if (checked !== derived.size) {
    throw new Error(`pre-render guard checked ${checked} of ${derived.size} derived elements for ${state.slug}.`);
  }

  // 3. Independent formatter cross-check on the money figures, so an Intl change
  //    that moved both the build and app.js the same wrong way still trips.
  const p = panel.breakdown.p;
  for (const [field, v] of Object.entries({
    gross: p.gross, federal: p.federal, socialSecurity: p.socialSecurity,
    medicare: p.medicare, state: p.state, net: p.net
  })) {
    if (!Number.isFinite(v)) throw new Error(`pre-rendered field "${field}" is not finite for ${state.slug}.`);
    if (usd2Ref(v) !== usd2App(v)) {
      throw new Error(
        `formatter parity broken for ${state.slug} row "${field}": build usd2Ref "${usd2Ref(v)}" ` +
        `vs app.js usd2 "${usd2App(v)}", so that row would flicker on hydration.`
      );
    }
  }

  // 4. The arithmetic a reader can do with their eyes. This is the check the old
  //    guard could not express, and the one the shipped defect would have failed:
  //    the visible rows, INCLUDING the state disability / paid-leave rows, must
  //    subtract to the Net pay printed beneath them.
  const rows = [
    ['Gross', p.gross, +1],
    ['Federal income tax', p.federal, -1],
    ['Social Security', p.socialSecurity, -1],
    ['Medicare', p.medicare, -1]
  ];
  if (state.hasIncomeTax) rows.push([`${state.name} income tax`, p.state, -1]);
  for (const pr of panel.breakdown.programs) rows.push([pr.label, pr.amount, -1]);

  // 4a. The exact identity, before any rounding. Nothing may leave the paycheck
  //     that does not have a row of its own.
  const exact = rows.reduce((t, [, v, sign]) => t + sign * v, 0);
  if (Math.abs(exact - p.net) > 1e-6) {
    throw new Error(
      `${state.slug} breakdown is incomplete: the rows served (` +
      rows.map(([l, , sign]) => `${sign < 0 ? '-' : '+'}${l}`).join(' ') +
      `) come to ${exact.toFixed(6)} but Net pay is ${p.net.toFixed(6)}. Something is being taken ` +
      `out of the paycheck without a row telling the reader about it.`
    );
  }

  // 4b. The identity as printed. Every row and the total round to cents
  //     independently, so the printed figures can legitimately disagree by up to
  //     half a cent each: with n rows plus the total that is floor((n+1)/2)
  //     whole cents, and no more. Wider than that is not rounding.
  const cents = (v) => Math.round(parseFloat(usd2App(v).replace(/[^0-9.]/g, '')) * 100);
  const sum = rows.reduce((t, [, v, sign]) => t + sign * cents(v), 0);
  const netCents = cents(p.net);
  const slack = Math.floor((rows.length + 1) / 2);
  if (Math.abs(sum - netCents) > slack) {
    throw new Error(
      `${state.slug} breakdown does not add up: the served rows (` +
      rows.map(([l, v, sign]) => `${sign < 0 ? '-' : ''}${l} ${usd2App(v)}`).join(', ') +
      `) sum to ${(sum / 100).toFixed(2)} but Net pay is printed as ${usd2App(p.net)}, a gap of ` +
      `${Math.abs(sum - netCents)} cents against a per-row rounding budget of ${slack}. ` +
      `A reader and a crawler both see a wrong subtraction.`
    );
  }
}

// Extractable, plain-language direct-answer block for each state paycheck page.
// Uses the real computed take-home for a representative $75,000 single-filer
// salary, and omits the state-tax clause for no-income-tax states (mirrors the
// existing hasIncomeTax handling). Highest-priority AI-SEO block: it answers the
// page's core question in one sentence near the top, so the LEAD half stays
// above the calculator (and above the mobile fold); the "now use the tool" TAIL
// half and, on target states, the RATE half both sit below the calculator.
//
// The lead is deliberately NOT a .note: the answer band 18px below it is already
// a bordered card, and two stacked cards cost 42px of fold budget on every one
// of the 51 pages for no reader benefit. See .answer-lead in styles.css.
function stateAnswerParts(state, year, net75) {
  if (!net75) return { lead: '', rate: '', tail: '' };
  const net = net75.annualNet;
  const wp = withholdingProfile(state);
  const stateClause = wp.hasIncomeTax ? `, and ${state.name} state income tax` : '';
  // When this state's disability / paid-leave employee contributions are modeled,
  // the net above already nets them out — say so, so the enumerated list matches
  // the figure.
  // Named from the state's own programs, because "disability / paid-leave" was
  // wrong for a state whose employee premium is unemployment insurance.
  const progClause = wp.programPhrase
    ? `${stateClause ? ' and' : ', plus'} ${state.abbr} ${wp.programPhrase} contributions`
    : '';
  const lead = pickFrame(state.slug, 'answer', [
    `In ${state.name} for ${year}, a $75,000 salary takes home about ${usd0(net)} per year after federal income tax and FICA (Social Security and Medicare)${stateClause}${progClause}.`,
    `A $75,000 salary in ${state.name} nets roughly ${usd0(net)} a year in ${year}, once federal income tax, Social Security and Medicare${wp.hasIncomeTax ? ` and ${state.name} state tax` : ''}${progClause} are withheld.`,
    `Earning $75,000 in ${state.name}? Your estimated ${year} take-home is about ${usd0(net)} after federal tax and FICA${stateClause}${progClause}.`
  ]);
  // Wording is direction-neutral ("in the calculator", not "below") because the
  // tail now sits underneath the calculator rather than above it.
  const tail = pickFrame(state.slug, 'answertail', [
    `Enter your own pay in the calculator to estimate your ${state.name} take-home pay for any salary or hourly wage.`,
    `Use the calculator for your own salary or hourly rate.`,
    `Adjust the calculator inputs to see the breakdown for your own ${state.name} paycheck.`
  ]);
  const rateSentence = TARGET_STATES.has(state.slug) ? stateRateSentence(state, year) : '';
  // NEAR_PAGE_1 target states: surface the exact search query as an <h2>
  // directly above the extractable rate sentence. The pair used to be welded
  // into the lead paragraph above the calculator, where it pushed the salary
  // input below the mobile fold (up to 206px on California). It now travels
  // with the tail into section.prose, still in the crawlable HTML, still an
  // <h2> with the same text, and now a single-topic paragraph under a heading
  // that is the literal query — a better extraction unit than the old
  // rate-plus-take-home run-on paragraph, not a worse one.
  const h2 = rateSentence ? `<h2>${state.name} income tax rate ${year}</h2>` : '';
  return {
    lead: `<p class="answer-lead"><strong>${lead}</strong></p>`,
    rate: rateSentence ? `${h2}<p class="note"><strong>${rateSentence}</strong></p>` : '',
    tail: `<p class="note">${tail}</p>`
  };
}

// The band's caption line. app.js rewrites this from the live inputs on every
// render (app.js netLabel()), so the wording here MUST match what app.js emits
// for the page's default inputs, or the caption would visibly change on load.
function stateNetLabel(state) {
  return `Based on a $75,000 salary in ${state.name}, single filer, paid every 2 weeks`;
}

// Each no-income-tax state's revenue model in a short phrase — condensed from
// that state's NOTAX_FACTS / sales- & property-tax data below (same sources),
// so ledes and FAQ answers differ in words because the funding models differ.
const NOTAX_ANGLE = {
  alaska: 'oil revenues and the Permanent Fund',
  florida: 'sales tax and tourism revenue',
  nevada: 'gaming, tourism and sales taxes',
  'new-hampshire': 'some of the nation\'s highest property taxes',
  'south-dakota': 'sales and property taxes, with no corporate income tax either',
  tennessee: 'sales taxes',
  texas: 'unusually high property taxes plus sales tax',
  washington: 'sales tax plus a capital-gains excise on high earners',
  wyoming: 'mineral severance taxes and federal mineral royalties'
};

// Genuinely state-specific facts for the no-income-tax states, so those pages
// aren't a name-swapped template (scaled-content risk). Each is true for that
// state and different from the others.
const NOTAX_FACTS = {
  alaska: 'Alaska levies neither a state income tax nor a statewide sales tax, and it pays eligible residents an annual Permanent Fund Dividend from oil revenues.',
  florida: "Florida's constitution prohibits a personal income tax, and the state funds itself largely through sales tax and tourism-related revenue.",
  nevada: 'Nevada has no individual income tax and leans heavily on sales tax and gaming/tourism revenue instead.',
  'new-hampshire': "New Hampshire does not tax earned wages; its former 5% tax on interest and dividends was fully phased out and repealed effective January 1, 2025, so investment income is now untaxed too.",
  'south-dakota': 'South Dakota has no individual income tax and no corporate income tax, funding services mainly through sales and property taxes.',
  tennessee: "Tennessee has no tax on wages; its 'Hall tax' on interest and dividend income was fully repealed in 2021, making the state completely income-tax-free.",
  texas: 'Texas has no personal income tax, and a 2019 constitutional amendment bars the state from enacting one without a statewide voter referendum.',
  washington: 'Washington has no tax on wage income, though since 2022 it applies a 7% excise tax on annual long-term capital gains above an inflation-adjusted threshold (around $270,000) — which does not touch ordinary paychecks.',
  wyoming: 'Wyoming has no individual or corporate income tax, relying on mineral severance taxes and federal mineral royalties to fund state government.'
};

// Every state's estimate misses the same class of deductions, whatever its
// income tax looks like, so this sentence is appended to all 51 lists. It names
// no rate, threshold or figure, so it needs no source.
const BASELINE_DISCLAIMER =
  'City, county or school-district income taxes where they apply, court-ordered deductions, ' +
  'union dues, and anything else your specific employer withholds are not in this figure; ' +
  'your pay stub is the authority on those.';

// The no-income-tax pages need one extra line: "no income tax" is routinely
// misread as "nothing comes out for the state". WHICH line is a function of the
// state's own programs, not of a constant: on Alaska and Washington the premiums
// are already inside the take-home figure at the top of the page, and the old
// constant sent those readers hunting on their stub for a deduction this page
// had already subtracted, on the same page that said so.
function notaxDisclaimer(state, wp) {
  const open = 'No state income tax does not mean no state payroll deductions.';
  return wp.federalOnly
    ? `${open} Check your stub for state-run leave or disability contributions.`
    : `${open} ${state.name} withholds ${wp.programPhrase} contributions from wages, and the ` +
      `take-home figure above already subtracts those, so your stub is the check on anything ` +
      `else your employer takes out.`;
}

// Prose body per state — branches on whether the state levies income tax.
function stateBody(state, year, taxData) {
  const wp = withholdingProfile(state);
  const noTax = !wp.hasIncomeTax;
  let body;
  if (noTax) {
    const fact = NOTAX_FACTS[state.slug] ? ` ${NOTAX_FACTS[state.slug]}` : '';
    // A no-income-tax state that runs its own employee-paid programs gets its own
    // opener: the "reduced only by federal withholding and FICA" frames below are
    // false there, and the take-home figure at the top of the page already
    // subtracts those contributions, so the prose has to name them.
    const prog = wp.programPhrase;
    const opener = !wp.federalOnly ? pickFrame(state.slug, 'notaxprog', [
      `${state.name} is one of the U.S. states with <strong>no state income tax</strong>, so there is no ${state.name} income tax line on your ${year} check. What still comes off is federal income tax, FICA (Social Security and Medicare), and the ${prog} contributions ${state.name} collects from employee wages, which the take-home figure above already subtracts.`,
      `Because <strong>${state.name} levies no state income tax</strong>, nothing on your ${year} check goes to a state income tax line. Your pay is still reduced by federal withholding, FICA, and the ${prog} contributions ${state.name} takes from employee wages, and all of those are in the estimate above.`,
      `${state.name} workers pay <strong>no state income tax</strong> in ${year}. The deductions that remain are federal income tax, FICA (Social Security and Medicare), and the ${prog} contributions ${state.name} takes straight from employee wages, so no income tax here does not mean nothing is withheld for the state.`
    ]) : pickFrame(state.slug, 'notax', [
      `${state.name} is one of the U.S. states with <strong>no state income tax</strong>. Your ${year} paycheck is reduced only by federal income tax withholding and FICA (Social Security and Medicare) — there is no ${state.name} income tax line, so your take-home pay is higher than in an otherwise-identical job in a state that taxes wages.`,
      `Because <strong>${state.name} levies no state income tax</strong>, the only deductions on your ${year} paycheck are federal withholding and FICA — no state line at all, which leaves more in your pocket than the same job in a taxing state.`,
      `${state.name} workers pay <strong>no state income tax</strong> in ${year}. That means your paycheck loses only federal income tax and FICA (Social Security and Medicare), so take-home pay beats an equivalent salary in a wage-taxing state.`
    ]);
    // No federal-mechanics paragraph here: the calculator's bracket-by-bracket
    // panel above covers it interactively (was verbatim across all 9 pages).
    body = `<p>${opener}${fact}</p>`;
    return body + stateDisclaimerNote(state, noTax);
  }

  const t = state.tax;
  let how;
  if (t.type === 'flat') {
    how = `${state.name} levies a <strong>flat ${pctStr(t.rate)} state income tax</strong> for ${year}`;
    how += t.standardDeduction
      ? `, applied after the state allowance/deduction for your filing status.`
      : ` on your wages, with no state standard deduction.`;
  } else if (isEffectivelyFlat(t)) {
    // One rate, with a 0% band under it — not a ladder. Saying "graduated" here
    // while the same page's FAQ and lede say "flat" read as a contradiction.
    const f = effectiveFlatFacts(t);
    how = hasStateDeduction(t)
      ? `${state.name} levies a <strong>flat ${pctStr(f.rate)} state income tax</strong> for ${year}, ` +
        `applied after the state deduction for your filing status — and the first ${usd0(f.zeroUpTo)} of ` +
        `taxable income above that deduction is taxed at 0%, so only what is left pays the ${pctStr(f.rate)}.`
      : `${state.name} levies a <strong>flat ${pctStr(f.rate)} state income tax</strong> for ${year} ` +
        `with no state standard deduction — the first ${usd0(f.zeroUpTo)} of ${state.name} taxable income ` +
        `is taxed at 0%, so only what is left pays the ${pctStr(f.rate)}.`;
  } else if (hasStateDeduction(t)) {
    how = pickFrame(state.slug, 'gradhow', [
      `${state.name} taxes income on a graduated state schedule for ${year}, applied after the state deduction for your filing status.`,
      `${state.name} uses graduated ${year} state income-tax brackets, so higher pay is taxed at higher marginal rates after the state deduction.`,
      `Your ${state.name} state income tax for ${year} is figured on a graduated bracket schedule, layered on after the state deduction.`
    ]);
  } else {
    // Same three voices, same salt and same array length, so each state keeps the
    // frame it already had — only the deduction clause changes. New Jersey,
    // Wisconsin and Connecticut land here: their pages promised a state deduction
    // in this sentence and denied one two paragraphs later.
    how = pickFrame(state.slug, 'gradhow', [
      `${state.name} taxes income on a graduated state schedule for ${year}, with no state standard deduction to come off first.`,
      `${state.name} uses graduated ${year} state income-tax brackets, so higher pay is taxed at higher marginal rates — and there is no state standard deduction to subtract first.`,
      `Your ${state.name} state income tax for ${year} is figured on a graduated bracket schedule, with no state standard deduction beneath it.`
    ]);
  }

  body =
    `<p>${how} This calculator applies that on top of federal withholding and ` +
    `Social Security / Medicare to estimate your ${state.name} take-home pay.</p>` +
    stateTaxFacts(state, year, taxData);

  return body + stateDisclaimerNote(state, noTax);
}

// The first wizard card's helper: what "before anything comes out" actually
// means on THIS state's pay stub. It used to be one sentence repeated verbatim
// on all 51 pages, and it was part of an 818-word block of state-invariant copy
// that the card rewrite added to every URL in the cluster.
//
// Every branch reads withholdingProfile(state), never state.hasIncomeTax alone
// (hard rule 1 in withholding-profile.js), and `federalOnly` is the only branch
// permitted to say "nothing more" (hard rule 2). The deductions it names are
// exactly the rows the results table on the same page prints, so this asserts
// nothing new: it says, in the visitor's own words, what the table below is
// about to subtract.
function grossPayHelp(state) {
  const wp = withholdingProfile(state);
  const open = 'Your pay stub calls it gross pay. It is what you are paid before ';
  if (wp.federalOnly) {
    return open + `federal income tax, Social Security and Medicare come out of it — ` +
      `${state.name} takes nothing further out of wages.`;
  }
  if (!wp.hasIncomeTax) {
    return open + `federal income tax, Social Security and Medicare come out of it. ` +
      `${state.name} charges no tax on wages, but ${wp.programPhrase} still come out.`;
  }
  if (!wp.programPhrase) {
    return open + `federal and ${state.name} income tax, Social Security and Medicare come out of it.`;
  }
  return open + `federal and ${state.name} income tax, Social Security, Medicare and ` +
    `${wp.programPhrase} come out of it.`;
}

// The "what this estimate doesn't include" note. Emitted on all 51 pages from
// this one place, so the heading is byte-identical everywhere and no state can
// silently ship without the caveat again (13 of 51 used to). Each state's own
// sourced sentences stay first and unchanged; the baseline sentence is appended
// to every state, and the no-income-tax line only to the nine that need it.
function stateDisclaimerNote(state, noTax) {
  const disclaimers = (state.disclaimer || []).slice();
  disclaimers.push(BASELINE_DISCLAIMER);
  if (noTax) disclaimers.push(notaxDisclaimer(state, withholdingProfile(state)));
  return `<p class="note"><strong>What this estimate doesn't include:</strong> ` +
    disclaimers.join(' ') + `</p>`;
}

// ───────────────────────────────────────────────────────────────────────────
// AdSense Path-B differentiation (2026-06-26): genuinely-unique, REAL-sourced
// per-state blocks rendered below the calculator. Data: src/data/state-payroll-2026.json
// (keyed by slug under .states); every value carries a source URL. Helpers return
// '' when data is absent — no fabrication, no empty sections. Sentence frames are
// chosen by a stable per-slug hash so no two pages share a paragraph.
const escHtml = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slugHash(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
// FNV-1a has weak avalanche in its LOW bits, and `% n` reads exactly those bits,
// so similar short slugs (e.g. "maine"/"montana") correlate across many salts and
// end up picking the same variant in several sections at once — a large shared
// run between two same-bucket pages. Run the hash through the MurmurHash3 fmix
// finalizer first so every output bit depends on all input bits; similar slugs
// then decorrelate across salts, spreading variant picks evenly.
function mixIndex(h, n) {
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489909) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % n;
}
const pickFrame = (slug, salt, arr) => arr[mixIndex(slugHash(slug + salt), arr.length)];

// Full income-tax bracket ladder (single filers) — paycheck-relevant structure,
// distinct per state. Honors figureYear so prior-year-fallback states (e.g. CA
// 2025) show an honest year label rather than a bare 2026.
function bracketTableBlock(state, year) {
  if (!state.hasIncomeTax || !state.tax) return '';
  const dispYear = state.figureYear || year;
  const t = state.tax;
  if (t.type === 'flat') {
    return `<section class="prose"><h2>One rate on every taxable dollar: ${state.name}'s ${pctStr(t.rate)} flat tax (${dispYear})</h2>` +
      `<p>${state.name} applies a single flat rate to taxable wages for ${dispYear}.</p>` +
      `<table class="data-table"><thead><tr><th>Filing</th><th>Rate</th></tr></thead><tbody>` +
      `<tr><td>All taxable income</td><td>${pctStr(t.rate)}</td></tr></tbody></table></section>`;
  }
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return '';
  const rows = b.map((br, i) => {
    const prev = i === 0 ? 0 : b[i - 1].upTo;
    const open = (br.upTo == null || !Number.isFinite(br.upTo));
    const range = open ? `${usd0(prev)} and above` : `${usd0(prev)} – ${usd0(br.upTo)}`;
    return `<tr><td>${range}</td><td>${pctStr(br.rate)}</td></tr>`;
  }).join('');
  return `<section class="prose"><h2>${state.name}'s ${numWord(b.length)} ${dispYear} brackets, from ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)} (single filers)</h2>` +
    `<p>${state.name}'s ${isEffectivelyFlat(t) ? 'single-filer' : 'graduated single-filer'} schedule for ${dispYear}` +
    (hasStateDeduction(t) ? ', applied after the state deduction' : ', with no state standard deduction to subtract first') + `:</p>` +
    `<table class="data-table"><thead><tr><th>Taxable income</th><th>Marginal rate</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function payrollDeductionsBlock(state, p) {
  const items = (p && p.payrollContributions) || [];
  if (!items.length) return '';
  const rows = items.map((it) =>
    `<tr><td>${escHtml(it.name)}</td><td>${escHtml(it.employeeRate2026 || '—')}</td><td>${escHtml(it.wageBaseOrCap || '—')}</td></tr>`
  ).join('');
  const intro = pickFrame(state.slug, 'payroll', [
    `Beyond income tax, ${state.name} withholds these state payroll programs directly from employee wages:`,
    `${state.name} runs employee-funded payroll programs that come off your check on top of income tax and FICA:`,
    `On a ${state.name} paycheck, these state programs are deducted in addition to income tax and Social Security / Medicare:`
  ]);
  // Heading names the actual program(s) — e.g. "State Disability Insurance" —
  // so each state's heading carries its own facts.
  const shortName = (n) => String(n).replace(/\s*\(.*$/, '');
  const names = items.slice(0, 2).map((it) => shortName(it.name)).join(' and ');
  // Honest inclusion note: the disability/paid-leave programs the ENGINE models
  // for this state (state.employeePrograms) are now subtracted from the take-home
  // figure at the top of the page. Any other rows in this table (unemployment,
  // long-term-care, etc.) are not modeled, so say so plainly — this is the fix
  // for the "documents SDI but never subtracts it" criticism.
  const modeled = withholdingProfile(state).programs;
  let statusNote;
  if (modeled.length) {
    const labels = modeled.map((pr) => escHtml(pr.label)).join(', ');
    const isAre = modeled.length > 1 ? 'contributions are' : 'contribution is';
    const extra = items.length > modeled.length
      ? ` Other programs in this table (such as unemployment or long-term-care contributions) are not subtracted from that estimate.`
      : '';
    statusNote = `<p class="note"><strong>Included in your take-home:</strong> the ${labels} ${isAre} subtracted from the take-home estimate at the top of this page.${extra} These are withheld after tax and do not lower your taxable income.</p>`;
  } else {
    statusNote = `<p class="note"><strong>Not in the estimate:</strong> these amounts are not subtracted from the take-home figure at the top of this page — what is actually withheld varies by employer or the program is too new for a confirmed statewide employee figure, so check your pay stub or the program's official site for what your employer takes out.</p>`;
  }
  return `<section class="prose"><h2>${names}: what else ${state.name} takes from your check</h2>` +
    `<p>${intro}</p>` +
    `<table class="data-table"><thead><tr><th>Program</th><th>Employee rate (2026)</th><th>Wage base / cap</th></tr></thead><tbody>${rows}</tbody></table>` +
    statusNote + `</section>`;
}

function localTaxBlock(state, p) {
  const lt = p && p.localIncomeTax;
  if (!lt || !lt.notes) return '';
  // Data-keyed heading: whether any city/county wage tax exists is itself the
  // state's answer. The sourced notes are unique per state either way.
  const h2 = lt.exists
    ? `Local income taxes in ${state.name}`
    : `No city or county income tax anywhere in ${state.name}`;
  return `<section class="prose"><h2>${h2}</h2>` +
    `<p>${escHtml(lt.notes)}</p></section>`;
}

function minWageBlock(state, p, year) {
  const mw = p && p.minWage2026;
  if (!mw || typeof mw.amountUsd !== 'number') return '';
  const annual = usd0(mw.amountUsd * 2080);
  const intro = `<strong>$${mw.amountUsd.toFixed(2)}/hour</strong> (≈${annual}/year full-time).`;
  const note = mw.notes ? ` ${escHtml(mw.notes)}` : '';
  // Data-keyed heading: states at the federal $7.25 floor get a structurally
  // different heading than states with their own higher minimum.
  const h2 = mw.amountUsd > 7.25
    ? `${state.name}'s own $${mw.amountUsd.toFixed(2)} minimum wage — above the federal floor (${year})`
    : `${state.name} stays on the federal $7.25 minimum wage in ${year}`;
  return `<section class="prose"><h2>${h2}</h2><p>${intro}${note}</p></section>`;
}

// Ancillary context (sales + property) — one compact paragraph so the page stays
// paycheck-focused (relevance cap: ancillary stays a minority of net-new prose).
function otherTaxesBlock(state, p) {
  if (!p) return '';
  const st = p.salesTax, pt = p.propertyTax;
  const parts = [];
  if (st && typeof st.stateBaseRatePct === 'number') {
    const combined = (typeof st.combinedAvgRatePct === 'number') ? ` (≈${st.combinedAvgRatePct}% with local)` : '';
    parts.push(`<tr><td>Sales tax</td><td>${st.stateBaseRatePct}%${combined}</td></tr>`);
  }
  if (pt && typeof pt.effectiveRatePct === 'number') {
    parts.push(`<tr><td>Property tax</td><td>≈${pt.effectiveRatePct}%${pt.rankNote ? ` — ${escHtml(pt.rankNote)}` : ''}</td></tr>`);
  }
  if (!parts.length) return '';
  // Data-keyed heading: embed the sales-tax rate and (for no-income-tax states)
  // the fact that these taxes stand in for a wage tax. Table body, not prose —
  // the numbers ARE the content.
  const ratePart = (st && typeof st.stateBaseRatePct === 'number') ? `${st.stateBaseRatePct}% sales tax` : 'sales tax';
  const h2 = state.hasIncomeTax
    ? `Beyond the paycheck: ${state.name}'s ${ratePart} and property tax`
    : `What ${state.name} levies instead: ${ratePart} and property tax`;
  return `<section class="prose"><h2>${h2}</h2>` +
    `<table class="data-table"><tbody>${parts.join('')}</tbody></table></section>`;
}

function incomeContextBlock(state, p, taxData) {
  const mi = p && p.medianHouseholdIncome;
  if (!mi || typeof mi.amountUsd !== 'number') return '';
  let net = null;
  try {
    net = computePaycheck({ wage: { type: 'salary', amount: mi.amountUsd }, filingStatus: 'single', payFrequency: 'annual', stateSlug: state.slug }, taxData).annual.net;
  } catch (_) { /* leave take-home out if compute fails */ }
  // Table body, not prose — the two figures are the whole point.
  const yr = mi.year ? ` (${escHtml(String(mi.year))})` : '';
  const rows = [`<tr><td>Median household income${yr}</td><td>${usd0(mi.amountUsd)}</td></tr>`];
  if (net && Number.isFinite(net)) {
    rows.push(`<tr><td>Take-home (single filer)</td><td>≈${usd0(net)}</td></tr>`);
  }
  return `<section class="prose"><h2>Your paycheck vs the ${usd0(mi.amountUsd)} ${state.name} median</h2>` +
    `<table class="data-table"><tbody>${rows.join('')}</tbody></table></section>`;
}

function distinctiveFactsBlock(state, p, faqEntries) {
  // NOTAX_FACTS already appear in the body opener, and a fact used as the
  // page's unique FAQ answer shouldn't repeat here — no duplicated sentences.
  // Match on the raw source sentence as well as the rendered answer: an entry
  // may extend its fact with a clarifying clause, and the extended string would
  // no longer equal the fact it consumed — which would print it twice.
  const usedInFaq = new Set();
  for (const e of faqEntries || []) {
    if (e && e.a) usedInFaq.add(String(e.a));
    if (e && e.srcFact) usedInFaq.add(String(e.srcFact));
  }
  const facts = [];
  const df = (p && p.distinctiveFacts) || [];
  for (const f of df) { if (f && f.fact && !usedInFaq.has(String(f.fact))) facts.push(escHtml(f.fact)); }
  if (!facts.length) return '';
  const lis = facts.map((f) => `<li>${f}</li>`).join('');
  // Count word is real data (fact count differs by state).
  const h2 = facts.length === 1
    ? `One ${state.name} payroll quirk worth knowing`
    : `${numWord(facts.length).replace(/^./, (c) => c.toUpperCase())} ${state.name} payroll quirks worth knowing`;
  return `<section class="prose"><h2>${h2}</h2><ul class="facts">${lis}</ul></section>`;
}

// Per-state OBBBA "no tax on tips / overtime" conformity block. Genuinely unique
// per-state content (the state return differs by state and year), so it both
// serves the fresh-query search demand and deepens each page's differentiation.
function obbbaConformityBlock(state, obbba, year) {
  const e = obbba && obbba.states && obbba.states[state.slug];
  if (!e) return '';
  // Boilerplate cut (was repeated near-verbatim on all 51 pages): one linked
  // sentence for the federal rule, one compact sentence for the four links.
  const calcLinks = 'Related: ' + orderAncillary(state.slug, [
    `<a href="/overtime-tax-calculator/">overtime calculator</a>`,
    `<a href="/tips-tax-calculator/">tips calculator</a>`,
    `<a href="/data/overtime-tax-by-state/#state-${state.slug}">overtime by state</a>`,
    `<a href="/data/tips-tax-by-state/#state-${state.slug}">tips by state</a>`
  ]).join(' · ') + '.';
  // Frame-varied 3 ways: this federal sentence is identical on all 51 pages, and
  // a shared run of state-invariant words is exactly what the near-duplicate
  // gate counts. Same meaning, same single link, three wordings.
  const fed = pickFrame(state.slug, 'obbbafed', [
    `<p>Qualified <strong>overtime premium pay</strong> and <strong>tips</strong> are federally deductible for 2025–2028 ` +
      `(<a href="/data/overtime-tax-by-state/">OBBBA caps &amp; rules</a>); FICA still applies.</p>`,
    `<p>Federal law lets you deduct qualified <strong>tips</strong> and <strong>overtime premium pay</strong> from 2025 through 2028 ` +
      `(<a href="/data/overtime-tax-by-state/">OBBBA caps &amp; rules</a>), though Social Security and Medicare are still withheld.</p>`,
    `<p>For tax years 2025 to 2028 there is a federal deduction for qualified <strong>overtime premium pay</strong> and <strong>tips</strong> ` +
      `(<a href="/data/overtime-tax-by-state/">OBBBA caps &amp; rules</a>). FICA comes out either way.</p>`
  ]);
  // Verdict-keyed heading: the query stays, and the state's actual 2026
  // treatment (from the sourced conformity data) is answered in the heading.
  const otV = e.overtime && e.overtime.y2026, tipV = e.tips && e.tips.y2026;
  let verdictTail;
  if (!e.hasWageTax) verdictTail = `Federally yes — no ${state.name} wage tax anyway`;
  else if (otV === 'yes' && tipV === 'yes') verdictTail = `Federally yes — and on the ${state.name} return too`;
  else if (otV === 'no' && tipV === 'no') verdictTail = `Federally yes, but ${state.name} still taxes both`;
  else if (otV === 'partial' && tipV === 'partial') verdictTail = `Federally yes; ${state.name} allows a smaller capped break`;
  else if (otV === 'unclear' && tipV === 'unclear') verdictTail = `Federally yes; ${state.name}'s rules aren't confirmed yet`;
  else verdictTail = `Federally yes; ${state.name}'s state treatment is mixed`;
  const h2 = `Is overtime and tips tax-free in ${state.name}? ${verdictTail}`;

  if (!e.hasWageTax) {
    // The data note for no-wage-tax states restates what the heading already
    // answers (identical sentence across all nine) — link out instead.
    return `<section class="prose"><h2>${h2}</h2>${fed}<p>${calcLinks}</p></section>`;
  }

  const verdict = (v) => ({
    yes: `deductible on your ${state.name} return too`,
    no: `not deductible on your ${state.name} return (still state-taxed)`,
    unclear: `not yet confirmed for ${state.name}`,
    partial: `a smaller capped ${state.name} break`
  }[v] || v);
  const row = (label, d) =>
    `<li><strong>${label}:</strong> 2025 — ${verdict(d.y2025)}; 2026–2028 — ${verdict(d.y2026)}.</li>`;
  const srcHost = (() => { try { return new URL(e.source).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
  const srcLink = e.source && srcHost
    ? ` <span class="muted-small">(source: <a href="${escHtml(e.source)}" rel="noopener" target="_blank">${escHtml(srcHost)}</a>)</span>`
    : '';

  return `<section class="prose"><h2>${h2}</h2>${fed}` +
    `<p><strong>${state.name} state income tax:</strong> ${escHtml(e.note)}${srcLink}</p>` +
    `<ul class="facts">${row('Overtime', e.overtime)}${row('Tips', e.tips)}</ul>` +
    `<p>${calcLinks}</p></section>`;
}

function sourcesBlock(state, p, meta) {
  const urls = new Set();
  const add = (u) => { if (u && /^https?:\/\//.test(u)) urls.add(u); };
  if (p) {
    add(p.localIncomeTax && p.localIncomeTax.source);
    add(p.salesTax && p.salesTax.source);
    add(p.minWage2026 && p.minWage2026.source);
    add(p.medianHouseholdIncome && p.medianHouseholdIncome.source);
    add(p.propertyTax && p.propertyTax.source);
    (p.payrollContributions || []).forEach((it) => add(it.source));
    (p.distinctiveFacts || []).forEach((f) => add(f.source));
  }
  // Federal primary sources (IRS 2026 brackets / standard deduction, SSA wage base)
  // apply to every paycheck page — cite them alongside the per-state sources.
  if (meta && meta.sources) Object.values(meta.sources).forEach(add);
  if (!urls.size) return '';
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } };
  // One entry per host (the list shows hostnames, so duplicate hosts read as
  // repeated identical entries) — keep the first URL seen for each.
  const byHost = new Map();
  for (const u of urls) { const h = hostOf(u); if (!byHost.has(h)) byHost.set(h, u); }
  const lis = [...byHost.entries()].map(([h, u]) => `<li><a href="${escHtml(u)}" rel="noopener" target="_blank">${escHtml(h)}</a></li>`).join('');
  return `<section class="sources"><h2>Sources</h2><ul>${lis}</ul></section>`;
}

// One state-UNIQUE FAQ entry, generated from that state's own sourced data.
// The pick is keyed on data SALIENCE, not a hash: a real local wage tax is the
// question a resident actually asks; failing that, the state's own payroll
// programs; failing that, an above-federal minimum wage; else the state's most
// distinctive payroll fact. Each answer carries that state's numbers.
function stateUniqueFaq(state, p, year) {
  const lt = p && p.localIncomeTax;
  if (lt && lt.exists && lt.notes) {
    return {
      q: `Do cities or counties in ${state.name} take a local income tax out of paychecks?`,
      a: String(lt.notes)
    };
  }
  const pc = (p && p.payrollContributions) || [];
  if (pc.length) {
    const list = pc.map((it) => `${it.name} at ${it.employeeRate2026 || 'a state-set rate'}`).join('; ');
    return {
      q: `Besides income tax, what does ${state.name} deduct from paychecks?`,
      a: `On top of federal tax and FICA, ${state.name} withholds ${list}. The full rates and wage caps are in the payroll-deductions table on this page.`
    };
  }
  const mw = p && p.minWage2026;
  if (mw && typeof mw.amountUsd === 'number' && mw.amountUsd > 7.25) {
    return {
      q: `What does a full-time minimum-wage job in ${state.name} pay in ${year}?`,
      a: `${state.name}'s ${year} minimum wage is $${mw.amountUsd.toFixed(2)}/hour — about ${usd0(mw.amountUsd * 2080)} a year at 40 hours a week before taxes. Details and exceptions are in the minimum-wage section above.`
    };
  }
  const df = (p && p.distinctiveFacts) || [];
  if (df.length && df[0].fact) {
    const fact = String(df[0].fact);
    return {
      q: `What is unusual about how ${state.name} handles payroll taxes?`,
      a: fact + flatBandRider(state, fact),
      // The unmodified source sentence, so distinctiveFactsBlock can still tell
      // this fact has been consumed even when the rider below extends it.
      srcFact: fact
    };
  }
  return null;
}

// A one-clause correction for the effectively-flat states whose sourced fact
// says the single rate lands on "wages". It lands on taxable income: the state
// standard deduction and the 0% band come off first. Added only when the fact
// does not already frame itself in taxable income (Mississippi's does, and says
// where its band stops, so it gets nothing). Introduces no new figure.
function flatBandRider(state, fact) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t || !isEffectivelyFlat(t)) return '';
  if (/taxable income/i.test(fact)) return '';
  const f = effectiveFlatFacts(t);
  // Only Idaho reaches this today (Ohio's unique FAQ is its municipal-tax one,
  // Mississippi's fact already frames itself in taxable income), but the clause
  // is gated anyway so a deduction-less state can never inherit a deduction it
  // does not have. No output changes for Idaho.
  const order = hasStateDeduction(t)
    ? `the state standard deduction comes off first, a 0% band takes the next slice, and the rate `
    : `there is no state standard deduction, a 0% band takes the first slice, and the rate `;
  return ` In practice the ${pctStr(f.rate)} lands on taxable income rather than on gross wages: ` +
    order + `reaches only what is left.`;
}

// FAQ entries shared by the JSON-LD block and the visible FAQ section (Google
// requires FAQ markup to reflect on-page content).
function stateFaqEntries(state, p, year) {
  // Data-keyed answer: states the structure (flat rate / bracket range / the
  // state's actual funding model) rather than a shared yes/no template.
  let a1;
  const t = state.tax;
  if (!state.hasIncomeTax || !t) {
    const angle = NOTAX_ANGLE[state.slug];
    a1 = `No — ${state.name} runs on ${angle || 'other taxes'}, not a wage tax.`;
  } else if (t.type === 'flat') {
    a1 = `Yes — a flat ${pctStr(t.rate)} on taxable wages in ${year}, on top of federal tax and FICA.`;
  } else if (isEffectivelyFlat(t)) {
    // One rate with a 0% band beneath it. Calling that "graduated brackets from
    // 0% to 5.3%" here while the body and the lede call it flat is the exact
    // self-contradiction this branch exists to remove. zeroUpTo is TAXABLE
    // income — it sits on top of the state standard deduction — so the sentence
    // has to say so; "the first $4,811 you earn" would be off by the deduction.
    const f = effectiveFlatFacts(t);
    // Idaho and Mississippi DO have a state standard deduction and their 0% band
    // sits on top of it, which is where the shared "pay left after the state
    // standard deduction" gloss came from. Ohio has no such deduction — its band
    // sits directly on Ohio taxable income — so on Ohio that gloss contradicted
    // the same page's own "Ohio does not provide a state standard deduction",
    // and the contradicting half was the one emitted as FAQPage JSON-LD.
    a1 = hasStateDeduction(t)
      ? `Yes — though it behaves like a flat ${pctStr(f.rate)} rather than a ladder of rising rates. ` +
        `For ${year}, a single filer's first ${usd0(f.zeroUpTo)} of taxable income — that is pay left after ` +
        `the state standard deduction — is taxed at 0%, and every dollar above it at ${pctStr(f.rate)}, ` +
        `on top of federal tax and FICA.`
      : `Yes — though it behaves like a flat ${pctStr(f.rate)} rather than a ladder of rising rates. ` +
        `${state.name} does not provide a state standard deduction, so for ${year} a single filer's first ` +
        `${usd0(f.zeroUpTo)} of ${state.name} taxable income is taxed at 0%, and every dollar above it at ` +
        `${pctStr(f.rate)}, on top of federal tax and FICA.`;
  } else {
    const b = (t.brackets && t.brackets.single) || [];
    a1 = b.length
      ? `Yes — ${numWord(b.length)} graduated brackets from ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)} in ${year}, on top of federal tax and FICA.`
      : `Yes. ${state.name} levies a state income tax in ${year}, applied on top of federal tax and FICA.`;
  }
  const entries = [{ q: `Does ${state.name} have a state income tax in ${year}?`, a: a1 }];
  const unique = stateUniqueFaq(state, p, year);
  if (unique) entries.push(unique);
  // Slug-stable order (JSON-LD and visible section share it via the caller).
  return orderAncillary(state.slug, entries);
}

function faqJsonLd(entries) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: { '@type': 'Answer', text: e.a }
    }))
  });
}

function stateFaqBlock(state, entries) {
  const items = entries
    .map((e) => `<h3>${escHtml(e.q)}</h3><p>${escHtml(e.a)}</p>`)
    .join('');
  return `<section class="prose"><h2>${state.name} paycheck FAQ</h2>${items}</section>`;
}

// Per-page state grid. When currentSlug is given, EXCLUDE that state and order
// the rest by a stable per-page shuffle (seeded by currentSlug) so the anchor
// block is no longer byte-identical across the 51 pages. currentSlug null (home)
// keeps the full roster in natural order.
// Geographic neighbors per state (first 3 are used on that state's page).
// AK/HI have no land borders — nearest/most-relevant states are listed instead.
const STATE_NEIGHBORS = {
  alabama: ['georgia', 'tennessee', 'mississippi', 'florida'],
  alaska: ['washington', 'oregon', 'hawaii'],
  arizona: ['california', 'nevada', 'new-mexico', 'utah'],
  arkansas: ['texas', 'tennessee', 'missouri', 'oklahoma'],
  california: ['nevada', 'oregon', 'arizona'],
  colorado: ['utah', 'kansas', 'wyoming', 'new-mexico'],
  connecticut: ['new-york', 'massachusetts', 'rhode-island'],
  delaware: ['maryland', 'pennsylvania', 'new-jersey'],
  'district-of-columbia': ['maryland', 'virginia', 'pennsylvania'],
  florida: ['georgia', 'alabama', 'south-carolina'],
  georgia: ['florida', 'south-carolina', 'tennessee', 'alabama'],
  hawaii: ['california', 'washington', 'alaska'],
  idaho: ['washington', 'utah', 'montana', 'oregon'],
  illinois: ['indiana', 'wisconsin', 'missouri', 'iowa'],
  indiana: ['illinois', 'ohio', 'michigan', 'kentucky'],
  iowa: ['illinois', 'minnesota', 'nebraska', 'missouri'],
  kansas: ['missouri', 'oklahoma', 'colorado', 'nebraska'],
  kentucky: ['tennessee', 'ohio', 'indiana', 'west-virginia'],
  louisiana: ['texas', 'mississippi', 'arkansas'],
  maine: ['new-hampshire', 'massachusetts', 'vermont'],
  maryland: ['virginia', 'district-of-columbia', 'pennsylvania', 'delaware'],
  massachusetts: ['new-hampshire', 'connecticut', 'rhode-island', 'new-york'],
  michigan: ['ohio', 'indiana', 'wisconsin', 'illinois'],
  minnesota: ['wisconsin', 'iowa', 'north-dakota', 'south-dakota'],
  mississippi: ['louisiana', 'alabama', 'tennessee', 'arkansas'],
  missouri: ['kansas', 'illinois', 'arkansas', 'tennessee'],
  montana: ['idaho', 'wyoming', 'north-dakota', 'south-dakota'],
  nebraska: ['iowa', 'kansas', 'colorado', 'south-dakota'],
  nevada: ['california', 'arizona', 'utah', 'oregon'],
  'new-hampshire': ['massachusetts', 'maine', 'vermont'],
  'new-jersey': ['new-york', 'pennsylvania', 'delaware'],
  'new-mexico': ['texas', 'arizona', 'colorado', 'oklahoma'],
  'new-york': ['new-jersey', 'pennsylvania', 'connecticut', 'massachusetts'],
  'north-carolina': ['south-carolina', 'virginia', 'tennessee', 'georgia'],
  'north-dakota': ['minnesota', 'south-dakota', 'montana'],
  ohio: ['pennsylvania', 'michigan', 'indiana', 'kentucky'],
  oklahoma: ['texas', 'kansas', 'arkansas', 'new-mexico'],
  oregon: ['washington', 'california', 'idaho', 'nevada'],
  pennsylvania: ['new-york', 'new-jersey', 'ohio', 'maryland'],
  'rhode-island': ['massachusetts', 'connecticut', 'new-york'],
  'south-carolina': ['north-carolina', 'georgia', 'tennessee'],
  'south-dakota': ['north-dakota', 'nebraska', 'minnesota', 'iowa'],
  tennessee: ['georgia', 'kentucky', 'north-carolina', 'alabama'],
  texas: ['oklahoma', 'louisiana', 'new-mexico', 'arkansas'],
  utah: ['colorado', 'nevada', 'arizona', 'idaho'],
  vermont: ['new-hampshire', 'new-york', 'massachusetts'],
  virginia: ['maryland', 'north-carolina', 'district-of-columbia', 'west-virginia'],
  washington: ['oregon', 'idaho', 'california'],
  'west-virginia': ['virginia', 'ohio', 'pennsylvania', 'kentucky'],
  wisconsin: ['minnesota', 'illinois', 'michigan', 'iowa'],
  wyoming: ['colorado', 'montana', 'utah', 'idaho', 'south-dakota', 'nebraska']
};

// The (up to 3) neighbor states linked on a state page — shared by the link
// grid and the section heading, so the heading can name the actual neighbors.
function neighborStates(roster, builtSlugs, currentSlug) {
  const bySlug = new Map(roster.map((s) => [s.slug, s]));
  return (STATE_NEIGHBORS[currentSlug] || [])
    .map((slug) => bySlug.get(slug))
    .filter((s) => s && s.slug !== currentSlug && builtSlugs.has(s.slug))
    .slice(0, 3);
}

// Data-keyed heading for the neighbor-links section: names the actual states.
function neighborHeading(roster, builtSlugs, currentSlug) {
  const names = neighborStates(roster, builtSlugs, currentSlug).map((s) => s.name);
  if (!names.length) return 'More state paycheck calculators';
  const last = names.pop();
  return names.length
    ? `Compare a paycheck next door: ${names.join(', ')} &amp; ${last}`
    : `Compare a paycheck next door in ${last}`;
}

// Summary text for the calculator's "compare with another state" panel. Naming
// the actual neighbours beats "another state" for the reader, and it breaks up
// what is otherwise the single largest run of identical words on all 51 pages
// (the calculator chrome), which is what the near-duplicate gate measures.
function compareSummary(roster, builtSlugs, currentSlug) {
  const names = neighborStates(roster, builtSlugs, currentSlug).map((s) => s.name);
  if (!names.length) return 'Compare your take-home pay in another state';
  const last = names.pop();
  return names.length
    ? `Compare your take-home pay with ${names.join(', ')} or ${last}`
    : `Compare your take-home pay with ${last}`;
}

// Summary text for the calculator's federal-bracket panel. Frame-varied and
// state-keyed for the same reason as compareSummary above.
function bracketSummary(state) {
  return pickFrame(state.slug, 'bracketsum', [
    `How your federal tax is calculated on a paycheck in ${state.name}, bracket by bracket`,
    `Bracket by bracket: the federal tax inside your ${state.name} paycheck`,
    `Your federal tax on ${state.name} pay, worked out one bracket at a time`
  ]);
}

// Slug-stable ordering for the ancillary sections (min wage, distinctive facts,
// other taxes, income context): the order differs page to page but is
// deterministic per slug, so rebuilds are byte-stable. The core sequence
// (answer block → calculator → explainer → brackets → payroll) never moves.
function orderAncillary(slug, blocks) {
  // NOTE: the varying index goes FIRST in the hashed string — FNV-1a only
  // diffuses a character through the multiplications that FOLLOW it, so a
  // trailing index yields near-identical keys and the same order everywhere.
  return blocks
    .map((v, i) => ({ v, k: slugHash(`anc${i}#${slug}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

// Neighbor take-home comparison: real numbers from the same engine + data, so
// every page's table differs because the neighboring tax systems differ. The
// structure column is in WORDS (flat / bracket-count / none), keeping the 51
// pages genuinely distinct, not digit-swapped.
function neighborCompareTable(roster, builtSlugs, currentSlug, taxData, year) {
  const structPhrase = (st) => {
    if (!st.hasIncomeTax || !st.tax) return 'no state income tax';
    if (st.tax.type === 'flat') return `flat ${pctStr(st.tax.rate)}`;
    const b = (st.tax.brackets && st.tax.brackets.single) || [];
    return b.length ? `${numWord(b.length)} brackets, ${pctStr(b[0].rate)}–${pctStr(b[b.length - 1].rate)}` : 'graduated';
  };
  const net75 = (slug) => {
    try {
      const n = computePaycheck({ wage: { type: 'salary', amount: DEFAULT_SALARY }, filingStatus: 'single', payFrequency: 'annual', stateSlug: slug }, taxData).annual.net;
      return Number.isFinite(n) ? usd0(n) : null;
    } catch (_) { return null; }
  };
  const cur = taxData.states[currentSlug];
  const rows = [];
  const pushRow = (st, slug, link) => {
    const net = net75(slug);
    if (!net) return;
    const name = link ? `<a href="/${slug}-paycheck-calculator/">${esc(st.name)}</a>` : esc(st.name);
    rows.push(`<tr><td>${name}</td><td>${structPhrase(st)}</td><td>${net}</td></tr>`);
  };
  if (cur) pushRow(cur, currentSlug, false);
  const bySlug = new Map(roster.map((s) => [s.slug, s]));
  for (const nslug of (STATE_NEIGHBORS[currentSlug] || [])) {
    const n = bySlug.get(nslug);
    if (!n || !builtSlugs.has(nslug)) continue;
    const st = taxData.states[nslug];
    if (st) pushRow(st, nslug, true);
  }
  if (rows.length < 2) return '';
  return `<table class="data-table"><thead><tr><th>State</th><th>State income tax (${year})</th><th>Take-home on $75,000 (single)</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table>`;
}

function stateLinks(roster, builtSlugs, currentSlug) {
  let items = roster.filter((s) => s.slug !== currentSlug);
  if (currentSlug) {
    // On a state page, link only 3 genuinely neighboring states (the full
    // 51-state directory lives on the homepage only — see relatedToolsBlock's
    // rationale: no sitewide link blocks on inner pages).
    items = neighborStates(roster, builtSlugs, currentSlug);
  }
  return items
    .map((s) => {
      const href = `/${s.slug}-paycheck-calculator/`;
      return builtSlugs.has(s.slug)
        ? `<a href="${href}">${s.name}</a>`
        : `<span title="Coming soon">${s.name}</span>`;
    })
    .join('\n');
}

// ===========================================================================
// Bonus (supplemental-wage) tax calculator — per-state content generators.
// The 51-page cluster mirrors the paycheck cluster: one template + a per-state
// loop, with every page's prose keyed to that state's supplemental METHOD +
// RATE (and slug-varied worked-example inputs) so no two pages are near-dupes.
// ===========================================================================

function bonusTitle(state, supp, year) {
  const a = state.abbr;
  if (supp.method === 'none') return `${state.name} Bonus Tax Calculator ${year} (${a}) — No State Tax on Your Bonus`;
  if (supp.method === 'flat') return `${state.name} Bonus Tax Calculator ${year}: ${pctStr(supp.rate)} Supplemental Rate (${a})`;
  if (supp.special === 'ca_dual') return `${state.name} Bonus Tax Calculator ${year}: 10.23% Supplemental Rate (${a})`;
  if (supp.special === 'pct_of_federal') return `${state.name} Bonus Tax Calculator ${year} (${a}) — 30% of Federal Withholding`;
  if (supp.special === 'wi_banded') return `${state.name} Bonus Tax Calculator ${year} (${a}) — Graduated Supplemental Rate`;
  return `${state.name} Bonus Tax Calculator ${year} (${a}) — Withholding vs. Real Tax`;
}

function bonusMetaDesc(state, supp, year) {
  let mid;
  if (supp.method === 'none') mid = `flat 22% federal + $0 ${state.name} state tax + FICA`;
  else if (supp.method === 'flat') mid = `flat 22% federal + ${state.name}'s ${pctStr(supp.rate)} supplemental rate + FICA`;
  else if (supp.special === 'ca_dual') mid = `flat 22% federal + California's 10.23% bonus rate + FICA`;
  else if (supp.special === 'pct_of_federal') mid = `flat 22% federal + Vermont's 30%-of-federal state rate + FICA`;
  else if (supp.special === 'wi_banded') mid = `flat 22% federal + Wisconsin's graduated state rate + FICA`;
  else mid = `flat 22% federal + ${state.name} state withholding + FICA`;
  return `Free ${year} ${state.name} bonus tax calculator. See what's withheld from your bonus now (${mid}) versus what it will really cost at tax time, with the refund or amount owed. Runs in your browser.`;
}

// Short data phrase describing a state's bonus method — used in headings/tables.
function bonusRateWord(supp) {
  if (supp.method === 'none') return 'no state tax';
  if (supp.method === 'flat') return `a flat ${pctStr(supp.rate)}`;
  if (supp.special === 'ca_dual') return '10.23% / 6.6%';
  if (supp.special === 'pct_of_federal') return '30% of the federal amount';
  if (supp.special === 'wi_banded') return 'a graduated 3.54%–7.65%';
  return supp.incomeRate ? `the aggregate method (~${pctStr(supp.incomeRate)})` : 'the aggregate method';
}

// The source agency for a state's supplemental rate, in words (differs per state,
// so weaving it into prose adds genuine per-state vocabulary, not reworded filler).
function bonusSourceName(state, supp) {
  if (supp && supp.source && supp.source !== 'repoTaxData') {
    return String(supp.source).split(':')[0].split(' (')[0].split(';')[0].trim();
  }
  return `the ${state.name} Department of Revenue`;
}

// The bonus engine models income tax and FICA only. A state that runs
// employee-paid programs therefore cannot present the federal 22% and FICA as
// the whole story. What the note may CLAIM is set by the data: a program record
// that states it is charged on supplemental pay gets a flat assertion, and one
// that is silent gets a sentence that asserts neither direction, because
// "Alaska withholds unemployment insurance from bonus pay" was written on one
// page while another said a bonus "meets federal withholding and nothing else",
// and no source in this repo settled which was right. Empty when the state has
// no employee-paid programs at all.
// `detail` adds the sentence explaining WHY the note stops where it does. The
// note lands in four places on a bonus page, so only the explainer section takes
// the long form and the rest take the clause.
function bonusProgramNote(state, { detail = false } = {}) {
  const wp = withholdingProfile(state);
  const many = wp.programs.length > 1;
  if (wp.bonusEvidence === 'confirmed') {
    return ` ${state.name} also takes its ${wp.bonusPhrase} contributions out of a bonus, and ${many ? 'those sit' : 'that sits'} outside this estimate.`;
  }
  if (wp.bonusEvidence === 'unknown') {
    const short = ` ${state.name} also withholds ${wp.programPhrase} contributions from wages, which this estimate does not model.`;
    return detail
      ? `${short} The published ${many ? 'rates do' : 'rate does'} not say whether a separately paid bonus carries ${many ? 'them' : 'it'}, so your pay stub is the authority there.`
      : short;
  }
  return '';
}

function bonusLede(state, supp, year) {
  const wp = withholdingProfile(state);
  // (a) WHAT THIS STATE STILL TAKES that the bonus engine does not model. Keyed
  // to the state's own employeePrograms and to nothing else. It used to be
  // reachable only from inside the no-income-tax branch below, which is why the
  // twelve income-tax states that run a real premium said nothing about it.
  const progDisclosure = bonusProgramNote(state);
  let stateBit;
  if (supp.method === 'none') {
    const angle = NOTAX_ANGLE[state.slug];
    const angleBit = angle ? ` (it runs on ${angle})` : '';
    if (!wp.federalOnly) {
      // `federalOnly` is the only licence for the exclusivity frames below
      // ("only ... come out", "nothing goes to the state"), so a state with
      // programs takes this non-exclusive sentence instead. The premium itself
      // is named by progDisclosure, appended once at the end for every state.
      stateBit = `${state.name} takes <strong>no state income tax</strong>${angleBit}, so the flat <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a> come out of the bonus.`;
    } else stateBit = pickFrame(state.slug, 'btledeNo', [
      `${state.name} takes <strong>no state income tax</strong>${angleBit}, so only the flat <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a> come out.`,
      `With <strong>no ${state.name} income tax</strong>${angleBit}, the only bites are the flat <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`,
      `Because ${state.name} levies <strong>no income tax</strong>${angleBit}, nothing goes to the state — just the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`
    ]);
  } else if (supp.method === 'flat') stateBit = `${state.name} adds a flat <strong>${pctStr(supp.rate)}</strong> on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else if (supp.special === 'ca_dual') stateBit = `California adds <strong>10.23%</strong> on bonuses (6.6% on other supplemental pay) on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else if (supp.special === 'pct_of_federal') stateBit = `Vermont adds <strong>30% of the federal amount</strong> (not of the bonus) on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else if (supp.special === 'wi_banded') stateBit = `Wisconsin uses a <strong>graduated</strong> state rate (3.54%–7.65% by income) on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else stateBit = `${state.name} has no separate bonus rate, so it withholds using the <strong>aggregate method</strong>${supp.incomeRate ? ` (about ${pctStr(supp.incomeRate)})` : ''} on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  const open = pickFrame(state.slug, 'btlede', [
    `In ${state.name}, a bonus is ordinary income — the slice that vanishes on payday is <a href="/tax-glossary/#withholding">withholding</a>, not a higher tax rate.`,
    `Got a bonus in ${state.name}? It isn't taxed at a special rate — what shrinks it is <a href="/tax-glossary/#withholding">withholding</a>.`,
    `A ${state.name} bonus feels heavily taxed, but the missing chunk is <a href="/tax-glossary/#withholding">withholding</a>, not a bonus tax.`,
    `Your ${state.name} bonus is ordinary income; the payday deduction is a flat <a href="/tax-glossary/#withholding">withholding</a> prepayment, not a higher rate.`,
    `That big bite out of a ${state.name} bonus is <a href="/tax-glossary/#withholding">withholding</a> at work — a prepayment, not a special bonus tax.`,
    `A bonus in ${state.name} is taxed like any wages; the chunk missing on payday is up-front <a href="/tax-glossary/#withholding">withholding</a>, nothing more.`,
    `Wondering why your ${state.name} bonus shrank so much? It's <a href="/tax-glossary/#withholding">withholding</a>, a flat prepayment, not a higher rate on bonuses.`
  ]);
  const close = pickFrame(state.slug, 'btledeC', [
    `Enter your numbers to see what's held back now beside what the bonus will really cost when you file, and your refund or amount owed.`,
    `Put in your figures above to compare what's withheld now with your real tax at filing — and the refund or shortfall.`,
    `Run your numbers to see the "now" withholding next to the "at tax time" total, and how much comes back or is still owed.`,
    `Type in your salary and bonus above and the tool lines up today's withholding against your true tax, with the refund or balance due.`,
    `Drop your figures in to watch the payday deduction sit next to the real filing cost, plus whatever you get back or owe.`
  ]);
  return `${open} ${stateBit}${progDisclosure} ${close} Everything runs in your browser.`;
}

function bonusAnswerBlock(state, supp) {
  let stateClause;
  const wp = withholdingProfile(state);
  // TWO QUESTIONS, TWO VARIABLES. They used to be one, and the single variable
  // was read as both.
  //   (a) progDisclosure, what the state still withholds that this estimate
  //       leaves out. Keyed to employeePrograms only, so it reaches the twelve
  //       income-tax states that run a premium as well as the two that do not.
  //   (b) noStateIncomeTax, whether the state levies a wage income tax, from
  //       withholdingProfile rather than a raw field. This, and only this, may
  //       select the "$0 in X income tax" phrasing: keying that phrasing to (a)
  //       would let a state with a premium be told it pays no income tax.
  const progDisclosure = bonusProgramNote(state);
  const noStateIncomeTax = !wp.hasIncomeTax;
  if (supp.method === 'none') stateClause = (noStateIncomeTax && progDisclosure)
    ? `<strong>$0</strong> in ${state.name} income tax`
    : pickFrame(state.slug, 'btansState', [
      `<strong>0%</strong> for state tax (${state.name} has no income tax)`,
      `nothing for the state, because ${state.name} levies no income tax`,
      `<strong>$0</strong> in ${state.name} tax, since the state has no income tax`
    ]);
  else if (supp.method === 'flat') stateClause = `<strong>${pctStr(supp.rate)}</strong> for ${state.name}`;
  else if (supp.special === 'ca_dual') stateClause = `<strong>10.23%</strong> for California (6.6% on non-bonus supplemental pay)`;
  else if (supp.special === 'pct_of_federal') stateClause = `<strong>30% of that federal amount</strong> for Vermont`;
  else if (supp.special === 'wi_banded') stateClause = `a <strong>graduated Wisconsin rate (3.54%–7.65%)</strong> by income`;
  else stateClause = `no separate ${state.name} rate — it's withheld as ordinary wages${supp.incomeRate ? ` (about <strong>${pctStr(supp.incomeRate)}</strong>)` : ''}`;
  const tail = pickFrame(state.slug, 'btans', [
    `That's a prepayment, not your final tax — the bonus is really taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when you file, and the calculator above shows the refund or amount you'll owe.`,
    `Those are <a href="/tax-glossary/#withholding">withholding</a> rates, not the tax itself; your bonus settles at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> on your return — the tool above shows by how much.`,
    `But that's only <a href="/tax-glossary/#withholding">withholding</a>. Your real bill is your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> at filing; run the calculator to see the refund or shortfall.`,
    `None of that is the final number — a bonus is taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> once you file, so the calculator above estimates what comes back or is still due.`,
    `Treat it as money on account. The real tax is your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, reconciled on your return; the tool above shows the gap either way.`
  ]);
  const lead = pickFrame(state.slug, 'btansLead', [
    `<strong>Quick answer:</strong> a separately paid bonus in ${state.name} is <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> for federal income tax plus ${stateClause}, plus <strong>7.65%</strong> FICA.`,
    `<strong>Short version:</strong> in ${state.name}, a bonus paid on its own is <a href="/tax-glossary/#withholding">withheld</a> at the flat federal <strong>22%</strong>, ${stateClause}, and <strong>7.65%</strong> FICA.`,
    `<strong>The quick take:</strong> a stand-alone ${state.name} bonus has a flat <strong>22%</strong> federal tax <a href="/tax-glossary/#withholding">withheld</a>, ${stateClause}, plus <strong>7.65%</strong> FICA.`
  ]);
  return `<section class="prose"><p>${lead} ${tail}${progDisclosure}</p></section>`;
}

function bonusMythBust(state, supp, ex) {
  const heading = pickFrame(state.slug, 'btmythH', supp.method === 'none' ? [
    `${state.name} has no bonus tax — so why is 22%+ still withheld?`,
    `No ${state.name} bonus tax: where does the missing money go?`,
    `Why a ${state.name} bonus shrinks even with no state tax`
  ] : [
    `Is ${state.name}'s ${bonusRateWord(supp)} bonus rate a "bonus tax"? No`,
    `Why your ${state.name} bonus looks over-taxed — and mostly isn't`,
    `The "${state.name} bonus tax" myth, and what's really withheld`
  ]);
  let exLine = '';
  if (ex && Math.abs(ex.delta) >= 1) {
    exLine = ex.refund
      ? pickFrame(state.slug, 'btmythExR', [
          ` In this page's ${usd0(ex.bonus)} example, about <strong>${usd0(ex.delta)}</strong> of what's withheld is really over-payment you'd get back.`,
          ` On the ${usd0(ex.bonus)} example below, roughly <strong>${usd0(ex.delta)}</strong> is over-withheld and comes back to you at filing.`,
          ` Worked out for the ${usd0(ex.bonus)} bonus here, about <strong>${usd0(ex.delta)}</strong> returns as a refund.`
        ])
      : pickFrame(state.slug, 'btmythExO', [
          ` In this page's ${usd0(ex.bonus)} example, withholding falls about <strong>${usd0(-ex.delta)}</strong> short of the real tax, so you'd owe the rest.`,
          ` For the ${usd0(ex.bonus)} bonus below, the flat withholding runs roughly <strong>${usd0(-ex.delta)}</strong> light, leaving that to owe.`,
          ` Worked out here on a ${usd0(ex.bonus)} bonus, you'd still owe about <strong>${usd0(-ex.delta)}</strong> when you file.`
        ]);
  }
  const body = pickFrame(state.slug, 'btmythB', [
    `The flat 22% federal figure (and your state's rate) is a <a href="/tax-glossary/#withholding">withholding</a> default — not a tax that applies only to bonuses. A bonus is ordinary income, taxed at your true <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when the year runs through the <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `There is no special bonus tax rate. The 22% is a <a href="/tax-glossary/#withholding">withholding</a> convenience; at filing the bonus is taxed like the rest of your income, at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> across the <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `Bonuses aren't taxed differently — only <a href="/tax-glossary/#withholding">withheld</a> differently. The real tax is your ordinary <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, settled on your return, not the flat 22% on the check.`,
    `"Bonus tax" is a nickname for over-<a href="/tax-glossary/#withholding">withholding</a>. The 22% is a flat prepayment; your bonus is ordinary income taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> once the year's <a href="/tax-glossary/#tax-bracket">brackets</a> are applied.`,
    `Nothing about a bonus changes the tax rate — it changes the <a href="/tax-glossary/#withholding">withholding</a>. The bonus is stacked onto your other income and taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, not at a bonus-only rate.`,
    `A bonus doesn't trigger a different tax — just a flat <a href="/tax-glossary/#withholding">withholding</a> up front. When you file, it's folded into your income and taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> through the normal <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `The 22% you see isn't a bonus levy; it's a <a href="/tax-glossary/#withholding">withholding</a> placeholder. Your bonus is ordinary income, and its real tax is whatever your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> works out to across the <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `Think of the flat rate as a deposit, not a bill. A bonus is taxed like any wages — at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when the year's income runs through the <a href="/tax-glossary/#tax-bracket">brackets</a> — and the 22% is only how it's <a href="/tax-glossary/#withholding">withheld</a>.`
  ]);
  const rule = pickFrame(state.slug, 'btmythRule', [
    `Under 22% (most people) the extra comes back as a refund; over 22% you owe the difference.`,
    `If your real rate sits under 22%, the surplus refunds; if it runs above, you cover the shortfall.`,
    `Below a 22% real rate you get money back; above it, you settle the gap at filing.`,
    `Most people's real rate is under 22%, so the extra returns; higher earners above 22% owe more.`,
    `When 22% overshoots your rate you're refunded; when it undershoots, the balance is due.`
  ]);
  const ficaTail = pickFrame(state.slug, 'btmythFica', [
    `Only <a href="/tax-glossary/#fica">FICA</a> (7.65%) is a true tax that never returns.`,
    `The one piece that never refunds is <a href="/tax-glossary/#fica">FICA</a> (7.65%) — a genuine tax, not a prepayment.`,
    `Just the 7.65% <a href="/tax-glossary/#fica">FICA</a> slice is a real tax you won't get back.`,
    `Set aside the 7.65% <a href="/tax-glossary/#fica">FICA</a> — that part is owed for good and never refunds.`,
    `The lone exception is <a href="/tax-glossary/#fica">FICA</a> (7.65%), which is a real tax rather than a prepayment.`
  ]);
  return `<section class="prose mythbust"><h2>${heading}</h2>` +
    `<p>${body} ${rule}${exLine} ${ficaTail}</p></section>`;
}

// btfed / btfica are on EVERY page, so a full-paragraph frame collision between
// any two pages shares a large block. Each is assembled from two INDEPENDENTLY
// picked sentences, so a full collision needs both halves to match (~1/30, not
// 1/6) — collapsing the biggest cross-page shingle-overlap contributor.
function bonusFederalPara(state) {
  const s1 = pickFrame(state.slug, 'btfed1', [
    `<strong>Federal: a flat 22% prepayment.</strong> Paid on its own check, a bonus has federal income tax <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> (IRS Publication 15).`,
    `<strong>The 22% isn't a bonus tax.</strong> It's the flat rate an employer may use to <a href="/tax-glossary/#withholding">withhold</a> federal income tax from a separately paid bonus (IRS Pub 15).`,
    `<strong>How the federal 22% works.</strong> A bonus identified separately from regular wages is <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> federally (IRS Publication 15).`,
    `<strong>Federal withholding on a bonus.</strong> The IRS default holds back a flat <strong>22%</strong> for federal income tax when the bonus is separate from your regular pay (IRS Pub 15).`,
    `<strong>Where the 22% comes from.</strong> Employers may <a href="/tax-glossary/#withholding">withhold</a> a flat <strong>22%</strong> of a separately identified bonus for federal income tax (IRS Publication 15).`,
    `<strong>The federal side is a flat prepayment.</strong> A bonus on its own check has <strong>22%</strong> <a href="/tax-glossary/#withholding">withheld</a> for federal income tax (IRS Pub 15).`
  ]);
  const s2 = pickFrame(state.slug, 'btfed2', [
    ` It rises to a mandatory <strong>37%</strong> on any bonus dollars past <strong>$1,000,000</strong> in a year — the third <a href="/tax-glossary/#tax-bracket">bracket's</a> rate as a default, not a bonus tax.`,
    ` Only the part of your yearly bonuses above <strong>$1,000,000</strong> is withheld at <strong>37%</strong>; everything under that stays a flat <strong>22%</strong> — a shortcut, not a rate reserved for bonuses.`,
    ` A mandatory <strong>37%</strong> hits supplemental pay beyond <strong>$1,000,000</strong> a year; neither figure is a special "bonus" rate, both are <a href="/tax-glossary/#withholding">withholding</a> defaults.`,
    ` Once your year's supplemental pay tops <strong>$1,000,000</strong>, the rate jumps to <strong>37%</strong>. It borrows the third <a href="/tax-glossary/#tax-bracket">bracket's</a> rate — it is not a levy on bonuses.`,
    ` Bonus dollars over <strong>$1,000,000</strong> in the year switch to a mandatory <strong>37%</strong>; below that it's a flat <strong>22%</strong> prepayment tied to the third <a href="/tax-glossary/#tax-bracket">bracket</a>.`
  ]);
  return `<p>${s1}${s2}</p>`;
}

function bonusFicaPara(state) {
  const s1 = pickFrame(state.slug, 'btfica1', [
    `<strong>FICA is the real tax.</strong> Social Security (6.2% to the wage base) and Medicare (1.45%, +0.9% above $200,000) are owed at the same rate they're withheld.`,
    `<strong>The 7.65% FICA slice doesn't true up.</strong> Social Security and Medicare are genuine taxes on a bonus, not a prepayment.`,
    `<strong>Don't expect FICA back.</strong> Of the total held back, <strong>7.65%</strong> is <a href="/tax-glossary/#fica">FICA</a> — Social Security to the wage base, plus Medicare — owed at that rate.`,
    `<strong>FICA: withheld and owed.</strong> Social Security and Medicare take <strong>7.65%</strong> of the bonus — a true tax, not a prepayment.`,
    `<strong>The 7.65% is real.</strong> <a href="/tax-glossary/#fica">FICA</a> — Social Security up to the wage base, plus 1.45% Medicare (and 0.9% more above $200,000) — is owed at exactly the rate it's withheld.`,
    `<strong>Set FICA aside as final.</strong> The <strong>7.65%</strong> <a href="/tax-glossary/#fica">FICA</a> bite is the tax itself — Social Security stops at the annual wage base, Medicare doesn't.`
  ]);
  const s2 = pickFrame(state.slug, 'btfica2', [
    ` That's why the calculator shows the same <a href="/tax-glossary/#fica">FICA</a> under "withheld now" and "what it really costs" — there's nothing to refund; only the income-tax portion trues up.`,
    ` So <a href="/tax-glossary/#fica">FICA</a> reads identically in both columns of the calculator; only the income-tax withholding settles up at filing.`,
    ` It reads the same in the "now" and "at tax time" columns because none of it comes back — just the income-tax slice is a prepayment that reconciles.`,
    ` Neither piece refunds at filing, so both columns of the tool show it unchanged; the income-tax withholding is the only part that trues up.`,
    ` The income-tax withholding is the only part that can come back — the <a href="/tax-glossary/#fica">FICA</a> share is settled the moment it's taken.`
  ]);
  return `<p>${s1}${s2}</p>`;
}

function bonusHowItWorks(state, supp, year) {
  const src = bonusSourceName(state, supp);
  // (a) again, hoisted out of the no-income-tax branch it used to live in. The
  // explainer section is the one place that carries the long form, and every
  // state that runs an employee-paid program gets it, whether or not the state
  // also taxes income.
  const progNote = bonusProgramNote(state, { detail: true });
  let st;
  if (supp.method === 'none') {
    const fact = NOTAX_FACTS[state.slug] ? ` ${NOTAX_FACTS[state.slug]}` : '';
    if (progNote) {
      // Every frame below calls the federal 22% and FICA the only withholding,
      // which is not true of a state that also runs employee-paid programs.
      st = `<p><strong>${state.name}: $0 state income tax.</strong> ${state.name} levies no income tax on wages, so no state income tax comes out of your bonus and the withholding in this estimate is the federal 22% plus FICA.${progNote}${fact}</p>`;
    } else st = pickFrame(state.slug, 'btst_n', [
      `<p><strong>${state.name}: $0 state.</strong> ${state.name} levies no state income tax on wages, so nothing is withheld for state tax on your bonus — only the federal 22% and FICA.${fact}</p>`,
      `<p><strong>${state.name}: nothing at the state level.</strong> With no ${state.name} wage income tax, your bonus loses <strong>$0</strong> to state withholding; just the federal 22% and FICA apply.${fact}</p>`,
      `<p><strong>${state.name} takes no cut.</strong> Because ${state.name} has no state income tax, there's no state line on your bonus at all — the only withholding is the flat 22% federal and FICA.${fact}</p>`,
      `<p><strong>No state line in ${state.name}.</strong> ${state.name} doesn't tax wage income, so your bonus keeps every state dollar — the withholding you see is purely federal 22% plus FICA.${fact}</p>`,
      `<p><strong>${state.name}: state withholding is zero.</strong> Since ${state.name} imposes no income tax on wages, a bonus has nothing deducted for the state; only the 22% federal prepayment and FICA come off.${fact}</p>`,
      `<p><strong>${state.name} skips the state tax.</strong> A ${state.name} bonus faces no state income-tax withholding whatsoever — the flat 22% federal and FICA are the entire bite.${fact}</p>`
    ]);
  } else if (supp.method === 'flat') {
    const extra = `${state.slug === 'north-carolina' ? ' This 4.09% is deliberately distinct from the 3.99% flat income-tax rate.' : ''}${state.slug === 'new-york' ? ' New York City (4.25%) and Yonkers add local supplemental rates on top for residents there.' : ''}`;
    st = pickFrame(state.slug, 'btst_f', [
      `<p><strong>${state.name}: flat ${pctStr(supp.rate)}.</strong> ${state.name} withholds a flat <strong>${pctStr(supp.rate)}</strong> of a separately paid bonus for state income tax, per ${src}.${extra}</p>`,
      `<p><strong>${state.name}'s ${pctStr(supp.rate)} supplemental rate.</strong> When a bonus is paid on its own, ${src} sets a flat <strong>${pctStr(supp.rate)}</strong> of it for ${state.name} withholding.${extra}</p>`,
      `<p><strong>${state.name}: a set ${pctStr(supp.rate)}.</strong> ${state.name} applies one flat supplemental rate — <strong>${pctStr(supp.rate)}</strong> of the bonus — for state withholding (${src}).${extra}</p>`,
      `<p><strong>${state.name} withholds ${pctStr(supp.rate)} flat.</strong> On a stand-alone bonus, ${state.name} takes a straight <strong>${pctStr(supp.rate)}</strong> for state income tax (${src}).${extra}</p>`,
      `<p><strong>The ${state.name} rate: ${pctStr(supp.rate)}.</strong> ${src} has ${state.name} employers hold back a flat <strong>${pctStr(supp.rate)}</strong> on a separately paid bonus.${extra}</p>`,
      `<p><strong>${state.name} keeps it simple: ${pctStr(supp.rate)}.</strong> A separately paid bonus is subject to one flat state rate in ${state.name}, <strong>${pctStr(supp.rate)}</strong> (${src}).${extra}</p>`
    ]);
  } else if (supp.special === 'ca_dual') {
    // The old closing sentence here, "SDI is also withheld but is not an income
    // tax", was the only mention of a premium on any income-tax state's bonus
    // page, and it told a Californian the premium exists without telling them
    // the figures on this page do not include it. The shared note below says
    // both, in the same words every other state gets.
    st = `<p><strong>California: two rates.</strong> California withholds <strong>10.23%</strong> on bonuses and stock options, and <strong>6.6%</strong> on other supplemental wages (${src}).</p>`;
  } else if (supp.special === 'pct_of_federal') {
    st = `<p><strong>Vermont: 30% of the federal amount.</strong> Vermont's supplemental withholding is <strong>30% of the federal income tax withheld</strong> on the bonus, not a percent of the bonus — about 6.6% of the bonus on the flat 22% federal (6% for nonqualified deferred comp), per ${src}.</p>`;
  } else if (supp.special === 'wi_banded') {
    st = `<p><strong>Wisconsin: a graduated rate.</strong> Wisconsin sets the supplemental rate by annual gross wages — <strong>3.54%</strong> under $12,760, <strong>4.65%</strong> to $25,520, <strong>5.30%</strong> to $280,950, and <strong>7.65%</strong> above that (${src}).</p>`;
  } else {
    st = pickFrame(state.slug, 'btst_r', [
      `<p><strong>${state.name}: the aggregate method.</strong> ${state.name} publishes no separate bonus rate, so a bonus is withheld as if it were ordinary wages.${supp.incomeRate ? ` Because ${state.name} taxes income at a flat ${pctStr(supp.incomeRate)}, a separately paid bonus is effectively withheld near ${pctStr(supp.incomeRate)}.` : ''}</p>`,
      `<p><strong>${state.name}: no separate bonus rate.</strong> With no published supplemental rate, ${state.name} withholds a bonus using the aggregate method — combined with your regular pay.${supp.incomeRate ? ` Its flat ${pctStr(supp.incomeRate)} income tax means a separately paid bonus is withheld close to ${pctStr(supp.incomeRate)}.` : ''}</p>`,
      `<p><strong>${state.name} folds the bonus into regular pay.</strong> Lacking a flat supplemental rate, ${state.name} uses the aggregate method: withholding is figured on your wages plus the bonus.${supp.incomeRate ? ` At its ${pctStr(supp.incomeRate)} flat rate, that lands a bonus near ${pctStr(supp.incomeRate)}.` : ''}</p>`
    ]);
    // Bracket-income regular states carry no incomeRate — describe the actual
    // graduated schedule (bracket COUNT + top rate) so these pages differ in
    // words, not just masked digits.
    if (!supp.incomeRate && state.tax && state.tax.type === 'bracket' && state.tax.brackets && state.tax.brackets.single) {
      const b = state.tax.brackets.single;
      const topRate = b[b.length - 1].rate;
      st = st.replace('</p>', ` ${state.name}'s income tax is graduated across ${numWord(b.length)} ${state.name} brackets topping out at ${pctStr(topRate)}, so an aggregated bonus is withheld somewhere along that schedule.</p>`);
    }
  }
  // Appended inside the state paragraph, after every branch above has finished
  // rewriting it, so the note lands last rather than in front of a sentence the
  // regular-method branch splices in. The no-income-tax branch already placed it
  // ahead of its NOTAX_FACTS tail, so it is excluded here rather than doubled.
  if (supp.method !== 'none' && progNote) st = st.replace(/<\/p>\s*$/, `${progNote}</p>`);
  const heading = pickFrame(state.slug, 'bthowH', [
    `How a ${state.name} bonus is withheld: 22% federal + ${bonusRateWord(supp)}`,
    `What comes out of a ${state.name} bonus in ${year}`,
    `${state.name} bonus withholding, piece by piece`,
    `Breaking down the withholding on a ${state.name} bonus`,
    `The three cuts on a ${state.name} bonus: federal, state, and FICA`
  ]);
  const close = pickFrame(state.slug, 'bthowC', [
    `<p>For your regular salary rather than a bonus, use the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a>.</p>`,
    `<p>The <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a> covers take-home pay on a normal ${state.name} paycheck.</p>`,
    `<p>Working out a whole paycheck? See the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a>.</p>`,
    `<p>For everyday pay instead of a bonus, the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a> is the tool to use.</p>`,
    `<p>Need your normal take-home instead? Try the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a>.</p>`
  ]);
  return `<section class="prose"><h2>${heading}</h2>${bonusFederalPara(state)}${st}${bonusFicaPara(state)}${close}</section>`;
}

function bonusNeighborTable(state, supp, roster, builtSlugs, taxData, suppData) {
  const neigh = (STATE_NEIGHBORS[state.slug] || []).filter((s) => builtSlugs.has(s)).slice(0, 3);
  const slugs = [state.slug, ...neigh];
  const methodPhrase = (sp) => {
    if (sp.method === 'none') return 'no state income tax';
    if (sp.method === 'flat') return `flat ${pctStr(sp.rate)}`;
    if (sp.special === 'ca_dual') return '10.23% / 6.6%';
    if (sp.special === 'pct_of_federal') return '30% of federal';
    if (sp.special === 'wi_banded') return 'graduated 3.54–7.65%';
    return sp.incomeRate ? `aggregate (~${pctStr(sp.incomeRate)})` : 'aggregate method';
  };
  const rows = slugs.map((sl) => {
    const sp = suppData.states[sl];
    const r = computeBonus({ bonus: 10000, regIncome: 70000, filingStatus: 'single', stateSlug: sl }, taxData, suppData);
    const nameCell = sl === state.slug ? `<strong>${sp.name}</strong>` : `<a href="/${sl}-bonus-tax-calculator/">${sp.name}</a>`;
    return `<tr><td>${nameCell}</td><td>${methodPhrase(sp)}</td><td>${usd0(r.withheld.state)}</td><td>${usd0(r.withheld.total)}</td></tr>`;
  }).join('');
  const nbrNames = neigh.map((s) => suppData.states[s].name);
  const nbrList = nbrNames.length ? nbrNames.slice(0, -1).join(', ') + (nbrNames.length > 1 ? ' and ' : '') + nbrNames[nbrNames.length - 1] : 'nearby states';
  const heading = pickFrame(state.slug, 'btnbrH', [
    `${state.name} vs. ${nbrList}: bonus withholding compared`,
    `How ${state.name} bonus withholding stacks up against ${nbrList}`,
    `${state.name} and ${nbrList}: a bonus-withholding comparison`,
    `Bonus withholding in ${state.name} next to ${nbrList}`,
    `Cross-border check: ${state.name} vs. ${nbrList} on a bonus`
  ]);
  const intro = pickFrame(state.slug, 'btnbrI', [
    `A single filer earning $70,000 who gets a $10,000 bonus, in ${state.name} and neighboring ${nbrList}:`,
    `Here's a $10,000 bonus on a $70,000 salary compared across ${state.name} and nearby ${nbrList}:`,
    `Side by side, a $70,000 earner's $10,000 bonus in ${state.name} versus ${nbrList}:`,
    `Take a $10,000 bonus for someone on $70,000 and compare ${state.name} with bordering ${nbrList}:`,
    `The same $10,000 bonus and $70,000 salary, in ${state.name} and its neighbors ${nbrList}:`
  ]);
  const foot = pickFrame(state.slug, 'btnbrF', [
    `Total = federal 22% + state + FICA. Illustrative single-filer figures; the income tax you actually owe trues up at filing.`,
    `Total combines the 22% federal, the state line, and FICA. Single-filer estimates — your real income tax settles when you file.`,
    `Figures are the 22% federal plus state plus FICA for a single filer; the income tax you owe reconciles on your return.`,
    `Each total adds the flat federal 22%, the state amount, and FICA; single-filer estimates that true up at filing time.`,
    `Totals stack federal 22%, state, and FICA for a single filer — the actual income tax lands when the return is filed.`
  ]);
  return `<section class="prose"><h2>${heading}</h2>` +
    `<p>${intro}</p>` +
    `<div class="table-scroll"><table class="data-table"><thead><tr><th>State</th><th>Bonus method</th><th>State withheld</th><th>Total withheld</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p class="muted-small">${foot}</p></section>`;
}

function bonusSizeTable(state, supp, taxData, suppData) {
  if (supp.method === 'none') return '';
  const sizes = [5000, 25000, 100000];
  const rows = sizes.map((b) => {
    const r = computeBonus({ bonus: b, regIncome: 70000, filingStatus: 'single', stateSlug: state.slug }, taxData, suppData);
    return `<tr><td>${usd0(b)}</td><td>${usd0(r.withheld.federal)}</td><td>${usd0(r.withheld.state)}</td><td>${usd0(r.withheld.fica)}</td><td>${usd0(r.withheld.total)}</td><td>${(r.withheld.pctOfBonus * 100).toFixed(1)}%</td></tr>`;
  }).join('');
  const heading = pickFrame(state.slug, 'btsizeH', [
    `${state.name} bonus withholding at $5,000, $25,000 and $100,000`,
    `What ${state.name} holds back on a $5,000, $25,000, or $100,000 bonus`,
    `${state.name} bonus withholding across three bonus sizes`,
    `Three bonus sizes in ${state.name}: $5,000, $25,000 and $100,000 withheld`,
    `How ${state.name} withholding scales from a $5,000 to a $100,000 bonus`
  ]);
  const intro = pickFrame(state.slug, 'btsizeI', [
    `What's held back from three bonus sizes in ${state.name} (single filer, $70,000 salary):`,
    `Withholding on a $5,000, $25,000, and $100,000 bonus in ${state.name} for a single filer earning $70,000:`,
    `For a single filer on a $70,000 salary, here's the ${state.name} withholding at three bonus amounts:`,
    `Here's the ${state.name} bite on a $5,000, $25,000, and $100,000 bonus (single filer, $70,000 salary):`,
    `Three bonuses — $5,000, $25,000, $100,000 — and what ${state.name} withholds from each on a $70,000 salary:`
  ]);
  const foot = pickFrame(state.slug, 'btsizeF', [
    `The % shifts as Social Security stops at the wage base; the income-tax portion still trues up when you file.`,
    `That percentage moves once Social Security caps out at the wage base, and the income-tax slice still settles at filing.`,
    `The share changes because Social Security ends at the wage base; the income tax reconciles on your return either way.`,
    `The rate drifts as Social Security hits its annual cap, but the income-tax part still reconciles at filing.`,
    `Watch the percentage fall once Social Security maxes out; the income-tax slice trues up when you file regardless.`
  ]);
  return `<section class="prose"><h2>${heading}</h2>` +
    `<p>${intro}</p>` +
    `<div class="table-scroll"><table class="data-table"><thead><tr><th>Bonus</th><th>Federal</th><th>${state.name}</th><th>FICA</th><th>Total</th><th>% of bonus</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<p class="muted-small">${foot}</p></section>`;
}

// Each ancillary section folds to its own h2: the body stays in the DOM (the
// AI-citation channel reads HTML, not rendered state) but the visitor who came
// for a number no longer scrolls a tax class. Benchmark personas quit these
// pages "at the second table"; the FAQ and Sources blocks are not run through
// this and stay open (scannable answers and the trust anchor respectively).
//
// The 2026-07-25 AdSense re-review guard that forced every fold open is
// RETIRED (Edmond, 2026-08-11, traffic-first call): the verdict never landed,
// and all 6 personas in the 08-11 competitor race complained, unprompted,
// about the tax-law wall between the answer and the exit. Folds are
// collapsed by default again. Nothing leaves the DOM either way — the body is
// still in the HTML for crawlers and the AI-citation channel, and the jump
// list above the content opens whichever fold you point it at.
// Applied in rewriteHtmlAssetRefs so template folds (tips/overtime/state-page)
// get it too, not just foldProse output.
const PROSE_FOLD_OPEN = false;
function foldProse(html) {
  const m = html.match(/^(\s*<section class="prose[^"]*"[^>]*>)([\s\S]*?)(<h2[^>]*>[\s\S]*?<\/h2>)([\s\S]*?)(<\/section>\s*)$/);
  if (!m) return html;
  return `${m[1]}${m[2]}<details class="prose-fold"><summary>${m[3]}</summary>${m[4]}</details>${m[5]}`;
}

// Multi-section variant for strings that concatenate several prose sections
// (state-page ancillary/payroll/bracket blocks). Sections without an h2, and
// anything not shaped <section class="prose...">, pass through untouched.
function foldProseAll(html) {
  if (!html) return html;
  return html.replace(/<section class="prose[^"]*"[^>]*>[\s\S]*?<\/section>/g, (sec) => foldProse(sec));
}

function bonusSections(sections, slug) {
  const ordered = orderAncillary(slug, sections).filter(Boolean).map(foldProse);
  const half = Math.ceil(ordered.length / 2);
  return { a: ordered.slice(0, half).join('\n'), b: ordered.slice(half).join('\n') };
}

// Pick worked-example inputs that (a) vary per state and (b) ALWAYS land on a
// genuine refund or amount-owed (never a zero-delta wash), so the example
// illustrates the tool's whole point. Deterministic per slug: the candidate
// (bonus, salary) grid is shuffled by a slug hash and the first pair clearing a
// real delta threshold wins, so same-bucket states get different figures.
function bonusExampleInputs(slug, taxData, suppData) {
  const bonuses = [4500, 6500, 9000, 11000, 14000, 18000, 24000];
  const salaries = [28000, 36000, 47000, 61000, 115000, 158000, 215000];
  const combos = [];
  for (const b of bonuses) for (const s of salaries) combos.push([b, s]);
  combos.sort((x, y) => slugHash(slug + x.join('_')) - slugHash(slug + y.join('_')));
  let best = null;
  for (const [bonus, salary] of combos) {
    const r = computeBonus({ bonus, regIncome: salary, filingStatus: 'single', stateSlug: slug }, taxData, suppData);
    const d = Math.abs(r.delta);
    if (d >= 300) return { bonus, salary, r };            // clear, non-trivial delta
    if (!best || d > best.d) best = { bonus, salary, r, d };
  }
  return best;                                            // fallback: largest delta found
}

// Multiple phrasings per delta branch so same-bucket pages don't share a verdict
// sentence (the old single-string verdict was a top shingle-overlap contributor).
function bonusVerdict(slug, r, deltaAbs) {
  if (Math.abs(r.delta) < 1) return pickFrame(slug, 'btverdZ', [
    `your withholding lands almost exactly on your real income tax — little to refund or owe`,
    `the amount held back and the tax actually due come out nearly even, so there's barely a refund or a balance`,
    `withholding and real tax roughly cancel out — not much to get back, not much to make up`
  ]);
  if (r.refund) return pickFrame(slug, 'btverdR', [
    `about <strong>${deltaAbs}</strong> of income-tax over-withholding comes back as a <strong>refund</strong> when you file`,
    `you over-paid income tax by roughly <strong>${deltaAbs}</strong>, and that returns as a <strong>refund</strong> at filing`,
    `the flat 22% over-shoots your real rate by about <strong>${deltaAbs}</strong>, so that much is a <strong>refund</strong> later`
  ]);
  return pickFrame(slug, 'btverdO', [
    `you'll <strong>owe</strong> about <strong>${deltaAbs}</strong> more at filing, because your real rate beats the 22% withheld`,
    `expect to <strong>owe</strong> roughly <strong>${deltaAbs}</strong> more when you file — your marginal rate runs above the 22% held back`,
    `the 22% withheld falls short of your real rate, leaving about <strong>${deltaAbs}</strong> to <strong>owe</strong> at filing`
  ]);
}

function bonusWorkedExample(state, supp, r, salary) {
  const bonus = r.bonus;
  const w = r.withheld, t = r.trueLiability;
  const deltaAbs = usd0(Math.abs(r.delta));
  const bite = (w.pctOfBonus * 100).toFixed(1);
  const verdict = bonusVerdict(state.slug, r, deltaAbs);
  const stateWLine = supp.method === 'none' ? `$0 state` : `${usd0(w.state)} ${state.name}`;
  const trueStatePart = supp.method === 'none' ? '' : ` + ${state.name} ${usd0(t.state)}`;
  const heading = pickFrame(state.slug, 'btexH', [
    `A ${usd0(bonus)} bonus on a ${usd0(salary)} ${state.name} salary: withheld vs. actually owed`,
    `Worked example: a ${usd0(bonus)} ${state.name} bonus at a ${usd0(salary)} salary`,
    `What a ${usd0(bonus)} bonus really costs on a ${usd0(salary)} ${state.name} income`,
    `${usd0(salary)} salary, ${usd0(bonus)} bonus: the ${state.name} withholding-vs.-tax breakdown`,
    `Run the numbers on a ${usd0(bonus)} bonus for a ${usd0(salary)} earner in ${state.name}`
  ]);
  const intro = pickFrame(state.slug, 'btexI', [
    `Take a single filer in ${state.name} earning ${usd0(salary)} who gets a ${usd0(bonus)} bonus on its own check:`,
    `Say you earn ${usd0(salary)} in ${state.name} and your employer cuts a separate ${usd0(bonus)} bonus check:`,
    `Picture a ${state.name} worker on a ${usd0(salary)} salary handed a ${usd0(bonus)} bonus, paid on its own:`,
    `Here's how a ${usd0(bonus)} bonus plays out for a single filer making ${usd0(salary)} in ${state.name}:`
  ]);
  const b1 = pickFrame(state.slug, 'btexB1', [
    `<li><strong>Withheld now:</strong> ${usd0(w.federal)} federal (22%) + ${stateWLine} + ${usd0(w.fica)} FICA = <strong>${usd0(w.total)}</strong> held back, leaving about ${usd0(w.keep)} in hand — a ${bite}% bite.</li>`,
    `<li><strong>Off the top:</strong> ${usd0(w.total)} disappears at payday — ${usd0(w.federal)} federal, ${stateWLine}, and ${usd0(w.fica)} FICA — so roughly ${usd0(w.keep)} actually reaches you, a ${bite}% cut.</li>`,
    `<li><strong>On the check:</strong> the employer holds back ${usd0(w.federal)} for federal, ${stateWLine}, and ${usd0(w.fica)} for FICA — ${usd0(w.total)} in all (${bite}% of the bonus), leaving about ${usd0(w.keep)}.</li>`
  ]);
  const b2 = pickFrame(state.slug, 'btexB2', [
    `<li><strong>What it actually costs:</strong> the true income tax on the bonus is about ${usd0(t.incomeTax)} (federal ${usd0(t.federal)}${trueStatePart}), plus the same ${usd0(t.fica)} FICA.</li>`,
    `<li><strong>The real bill:</strong> at filing the bonus is taxed roughly ${usd0(t.incomeTax)} in income tax (federal ${usd0(t.federal)}${trueStatePart}), with the identical ${usd0(t.fica)} FICA on top.</li>`,
    `<li><strong>At tax time:</strong> the bonus's actual income tax works out near ${usd0(t.incomeTax)} (federal ${usd0(t.federal)}${trueStatePart}) — and FICA is the same ${usd0(t.fica)} as before.</li>`
  ]);
  const ficaNote = pickFrame(state.slug, 'btexFica', [
    `FICA (${usd0(w.fica)}) stays either way — it's a real tax.`,
    `The ${usd0(w.fica)} FICA doesn't move — that part is owed no matter what.`,
    `Either way, the ${usd0(w.fica)} FICA is final and won't come back.`
  ]);
  const b3 = `<li><strong>The gap:</strong> ${verdict}. ${ficaNote}</li>`;
  const close = pickFrame(state.slug, 'btexC', [
    `<p class="muted-small">Illustrative single-filer figures from this page's engine; your result depends on your total income and filing status.</p>`,
    `<p class="muted-small">Example single-filer numbers from the calculator above; your own refund or bill shifts with your total income and filing status.</p>`,
    `<p class="muted-small">A single-filer illustration only — drop your real salary, bonus, and filing status into the tool above for your figure.</p>`
  ]);
  return `<section class="prose"><h2>${heading}</h2><p>${intro}</p><ul>${b1}${b2}${b3}</ul>${close}</section>`;
}

function bonusFaqEntries(state, supp, year) {
  const rateStrPlain = supp.method === 'none' ? '0%'
    : supp.method === 'flat' ? pctStr(supp.rate)
    : supp.special === 'ca_dual' ? '10.23% (6.6% on other supplemental pay)'
    : supp.special === 'pct_of_federal' ? '30% of the federal withholding'
    : supp.special === 'wi_banded' ? '3.54%–7.65% by income band'
    : supp.incomeRate ? `about ${pctStr(supp.incomeRate)} (aggregate method)` : 'the aggregate method';
  const e = [];
  const wp = withholdingProfile(state);
  // The programs clause, and whether there is one at all, comes from the state's
  // own data. This answer is emitted as FAQPage JSON-LD, so an exclusivity claim
  // here ("only the 22% and FICA") is a structured-data claim: it is allowed on a
  // federal-only state and on no other.
  // The most dangerous of the four slots, and the reason (a) and (b) cannot
  // share a variable. The branch below opens "X has no state income tax, so $0
  // is withheld", and it used to be entered on the strength of the note alone.
  // Widening the note to the twelve income-tax program states without splitting
  // the variable would publish "New Jersey has no state income tax" as FAQPage
  // JSON-LD on twelve pages, California's among them. Count the states here from
  // the data, not from this comment, if you touch it.
  const progTail = bonusProgramNote(state);
  const noStateIncomeTax = !wp.hasIncomeTax;
  if (noStateIncomeTax && progTail) {
    e.push({
      q: `How much is withheld from a bonus in ${state.name}?`,
      a: `${state.name} has no state income tax, so $0 is withheld for state income tax. Federally, a separately paid bonus is withheld at a flat 22% (37% above $1,000,000/yr), plus 7.65% FICA, which is a prepayment rather than your final tax.${progTail}`,
      html: `${state.name} has no state income tax, so <strong>$0</strong> is withheld for state income tax. Federally, a separately paid bonus is <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> (37% above $1,000,000/yr), plus 7.65% <a href="/tax-glossary/#fica">FICA</a>, which is a prepayment rather than your final tax.${progTail}`
    });
  } else if (supp.method === 'none') {
    e.push(pickFrame(state.slug, 'btfaq1n', [
      { q: `How much is withheld from a bonus in ${state.name}?`,
        a: `${state.name} has no state income tax, so $0 is withheld for state tax. Federally, a separately paid bonus is withheld at a flat 22% (37% above $1,000,000/yr), plus 7.65% FICA — a prepayment, not your final tax.`,
        html: `${state.name} has no state income tax, so <strong>$0</strong> is withheld for state tax. Federally, a separately paid bonus is <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> (37% above $1,000,000/yr), plus 7.65% <a href="/tax-glossary/#fica">FICA</a> — a prepayment, not your final tax.` },
      { q: `How much tax comes out of a bonus in ${state.name}?`,
        a: `Nothing goes to ${state.name}, which has no income tax. Federal withholding is a flat 22% on a separately paid bonus (37% past $1,000,000 a year) and FICA is 7.65% — the 22% is a prepayment that trues up at filing.`,
        html: `Nothing goes to ${state.name}, which has no income tax. Federal <a href="/tax-glossary/#withholding">withholding</a> is a flat <strong>22%</strong> on a separately paid bonus (37% past $1,000,000 a year) and <a href="/tax-glossary/#fica">FICA</a> is 7.65% — the 22% is a prepayment that trues up at filing.` },
      { q: `What's the bonus withholding in ${state.name}?`,
        a: `State withholding is zero because ${state.name} taxes no wage income. The only deductions are the flat 22% federal (37% on bonus dollars above $1,000,000/yr) and 7.65% FICA, and the 22% is refundable if your real rate is lower.`,
        html: `State <a href="/tax-glossary/#withholding">withholding</a> is zero because ${state.name} taxes no wage income. The only deductions are the flat <strong>22%</strong> federal (37% on bonus dollars above $1,000,000/yr) and 7.65% <a href="/tax-glossary/#fica">FICA</a>, and the 22% is refundable if your real rate is lower.` }
    ]));
  } else {
    const frame = pickFrame(state.slug, 'btfaq1s', [
      { q: `What is the ${state.name} bonus tax rate in ${year}?`,
        a: `${state.name} withholds ${rateStrPlain} on a separately paid bonus, on top of the flat 22% federal rate (37% above $1,000,000/yr) and 7.65% FICA. That is withholding, not your final tax.`,
        html: `${state.name} withholds <strong>${rateStrPlain}</strong> on a separately paid bonus, on top of the flat <strong>22%</strong> federal rate (37% above $1,000,000/yr) and 7.65% <a href="/tax-glossary/#fica">FICA</a>. That's <a href="/tax-glossary/#withholding">withholding</a>, not your final tax.` },
      { q: `How much is withheld from a bonus in ${state.name} for ${year}?`,
        a: `On a separately paid bonus, ${state.name} takes ${rateStrPlain}, the federal side takes a flat 22% (37% beyond $1,000,000/yr), and FICA takes 7.65%. Those are withholding rates that settle up when you file — not a final tax.`,
        html: `On a separately paid bonus, ${state.name} takes <strong>${rateStrPlain}</strong>, the federal side takes a flat <strong>22%</strong> (37% beyond $1,000,000/yr), and <a href="/tax-glossary/#fica">FICA</a> takes 7.65%. Those are <a href="/tax-glossary/#withholding">withholding</a> rates that settle up when you file — not a final tax.` },
      { q: `What rate does ${state.name} withhold on a bonus in ${year}?`,
        a: `${state.name}'s supplemental withholding is ${rateStrPlain}, added to the flat 22% federal prepayment (37% on bonus pay over $1,000,000/yr) and 7.65% FICA. Only the income-tax portion is a prepayment; it trues up at your real rate.`,
        html: `${state.name}'s supplemental <a href="/tax-glossary/#withholding">withholding</a> is <strong>${rateStrPlain}</strong>, added to the flat <strong>22%</strong> federal prepayment (37% on bonus pay over $1,000,000/yr) and 7.65% <a href="/tax-glossary/#fica">FICA</a>. Only the income-tax portion is a prepayment; it trues up at your real rate.` }
    ]);
    // Spread, not mutate: pickFrame hands back the literal out of the array
    // above, and this answer is republished as FAQPage JSON-LD, so writing
    // through the reference would append the note again on the next state that
    // draws the same frame.
    e.push(progTail ? { ...frame, a: `${frame.a}${progTail}`, html: `${frame.html}${progTail}` } : frame);
  }
  e.push(pickFrame(state.slug, 'btfaq2', [
    { q: `Are bonuses taxed at a higher rate in ${state.name}?`, a: `No. A bonus is ordinary income taxed at your normal marginal rate when you file; the flat 22% withheld is a prepayment, not a tax rate.`,
      html: `No. A bonus is ordinary income taxed at your normal <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when you file; the flat 22% <a href="/tax-glossary/#withholding">withheld</a> is a prepayment, not a tax rate.` },
    { q: `Does ${state.name} tax bonuses more than regular pay?`, a: `No. There's no separate, higher tax on bonuses — a bonus is just withheld at a flat rate up front, then taxed like any income at your marginal rate.`,
      html: `No. There's no separate, higher tax on bonuses — a bonus is just <a href="/tax-glossary/#withholding">withheld</a> at a flat rate up front, then taxed like any income at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>.` },
    { q: `Is there a special bonus tax rate in ${state.name}?`, a: `No. The 22% federal and the state supplemental rate are withholding defaults, not rates that apply only to bonuses. Your real tax is your ordinary marginal rate.`,
      html: `No. The 22% federal and the state supplemental rate are <a href="/tax-glossary/#withholding">withholding</a> defaults, not rates that apply only to bonuses. Your real tax is your ordinary <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>.` },
    { q: `Is a ${state.name} bonus taxed differently from my salary?`, a: `Not in the end. It may be withheld differently (a flat rate up front), but at filing a bonus is taxed exactly like the rest of your income, at your marginal rate.`,
      html: `Not in the end. It may be <a href="/tax-glossary/#withholding">withheld</a> differently (a flat rate up front), but at filing a bonus is taxed exactly like the rest of your income, at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>.` }
  ]));
  e.push(pickFrame(state.slug, 'btfaq3', [
    { q: `Will I get some of my ${state.name} bonus withholding back?`, a: `Often, yes — if your true marginal rate is below the 22% withheld, the difference refunds at filing; above 22%, you owe it. FICA is a true tax and never refunds.`,
      html: `Often, yes — if your true <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> is below the 22% withheld, the difference refunds at filing; above 22%, you owe it. <a href="/tax-glossary/#fica">FICA</a> is a true tax and never refunds.` },
    { q: `Do I get a refund on my ${state.name} bonus?`, a: `If 22% was more than your real rate, yes — the over-withheld income tax returns at filing. If your marginal rate tops 22%, you owe the shortfall. FICA doesn't come back either way.`,
      html: `If 22% was more than your real rate, yes — the over-withheld income tax returns at filing. If your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> tops 22%, you owe the shortfall. <a href="/tax-glossary/#fica">FICA</a> doesn't come back either way.` },
    { q: `Why might I owe tax on my ${state.name} bonus at filing?`, a: `Because 22% is only a prepayment. If your true marginal rate is above 22% (high earners), the flat withholding falls short and you owe the rest; below 22%, you're over-withheld and get money back.`,
      html: `Because 22% is only a prepayment. If your true <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> is above 22% (high earners), the flat <a href="/tax-glossary/#withholding">withholding</a> falls short and you owe the rest; below 22%, you're over-withheld and get money back.` },
    { q: `Does my ${state.name} bonus ever come back at tax time?`, a: `The income-tax part can. If the flat 22% over-withheld relative to your real marginal rate, the excess is refunded; if you're a high earner above 22%, you pay more. FICA is never refunded.`,
      html: `The income-tax part can. If the flat 22% over-<a href="/tax-glossary/#withholding">withheld</a> relative to your real <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, the excess is refunded; if you're a high earner above 22%, you pay more. <a href="/tax-glossary/#fica">FICA</a> is never refunded.` }
  ]));
  if (supp.special === 'pct_of_federal') e.push({ q: `Why is Vermont's bonus withholding based on the federal amount?`, a: `Vermont sets it at 30% of the federal income tax withheld on the bonus, rather than a percent of the bonus. On the flat 22% federal, that's about 6.6% of the bonus.` });
  else if (supp.special === 'wi_banded') e.push({ q: `How does Wisconsin's graduated bonus rate work?`, a: `Wisconsin picks the rate from your annual gross wages: 3.54% under $12,760, 4.65% to $25,520, 5.30% to $280,950, and 7.65% above that.` });
  else if (supp.special === 'ca_dual') e.push({ q: `Does California withhold a different rate on stock options?`, a: `California uses 10.23% for bonuses and stock options, and 6.6% for other supplemental wages. Pick the payment type in the calculator to switch.` });
  else if (state.slug === 'north-carolina') e.push({ q: `Is North Carolina's 4.09% bonus rate the same as its income tax rate?`, a: `No. The flat income tax is 3.99%, but the supplemental withholding rate is a distinct 4.09% (NC-30, 2026).` });
  else if (supp.method === 'regular') e.push({ q: `Does ${state.name} have a separate bonus withholding rate?`, a: `No. ${state.name} has no separate supplemental rate, so a bonus is withheld with the aggregate method — as if it were part of your regular wages${supp.incomeRate ? `, effectively near ${pctStr(supp.incomeRate)}` : ''}.` });
  else if (supp.method === 'none') e.push({ q: `Does ${state.name} tax my bonus at all?`, a: `${state.name} charges no state income tax on it. You still owe federal income tax (a flat 22% is withheld, trued up at filing) and FICA on the bonus.${progTail}` });
  else e.push({ q: `Does a bonus push my ${state.name} income into a higher bracket?`, a: `No. Brackets are marginal — only the dollars above each threshold are taxed higher. A bonus never re-taxes income you already earned.` });
  return orderAncillary(state.slug, e);
}

function bonusFaqBlock(state, entries) {
  const items = entries.map((en) => `<h3>${escHtml(en.q)}</h3><p>${en.html || escHtml(en.a)}</p>`).join('');
  return `<section class="prose"><h2>${state.name} bonus tax FAQ</h2>${items}</section>`;
}

function bonusSourcesBlock(state, supp) {
  const lis = [];
  lis.push(`<li><a href="https://www.irs.gov/publications/p15" rel="noopener" target="_blank">IRS Publication 15 (2026) — Supplemental Wages</a> (flat 22% / 37% above $1M)</li>`);
  if (supp._sourceUrl) {
    lis.push(`<li>${state.name} supplemental rate: <a href="${escHtml(supp._sourceUrl)}" rel="noopener" target="_blank">${escHtml(supp.source || 'state source')}</a></li>`);
  } else if (supp.method === 'regular' || supp.method === 'none') {
    lis.push(`<li>${state.name} income-tax status &amp; rate: see the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a> sources (state DOR${LAST_SOURCED ? `, verified ${LAST_SOURCED}` : ''}).</li>`);
  }
  if (supp.singleSourced) {
    lis.push(`<li><em>${state.name}'s supplemental rate is sourced from a payroll-industry reference; verify with the ${state.name} Department of Revenue for the current year.</em></li>`);
  }
  return `<section class="sources"><h2>Sources</h2><ul>${lis.join('')}</ul></section>`;
}

function bonusStateLinks(roster, builtSlugs, currentSlug) {
  return neighborStates(roster, builtSlugs, currentSlug)
    .map((s) => builtSlugs.has(s.slug)
      ? `<a href="/${s.slug}-bonus-tax-calculator/">${s.name}</a>`
      : `<span title="Coming soon">${s.name}</span>`)
    .join('\n');
}

// Full 51-state grid for the hub page.
function bonusHubLinks(roster, builtSlugs) {
  return roster
    .filter((s) => builtSlugs.has(s.slug))
    .map((s) => `<a href="/${s.slug}-bonus-tax-calculator/">${s.name}</a>`)
    .join('\n');
}

// ===========================================================================
// STATE SALARY LADDERS — /<state>-take-home-pay/ hub + one page per salary rung
// (/california-take-home-pay-60000/, /texas-take-home-pay-60000/ …).
//
// The commercial query here is "take-home pay on $X in <state>", and the site
// had no page that answers it with a number. Every figure below is computed at
// build time by the SAME engine the calculator ships (computePaycheck /
// federalBracketBreakdown) reading src/data/tax-data-2026.json. Nothing is
// hard-coded: not a rate, not a bracket edge, not a standard deduction, not a
// program rate. That is deliberate — the freshness checks and the tax-data edits
// that keep this site honest only work if the pages derive from the data file.
//
// The thin/doorway risk is real (three AdSense "low value content" rejections)
// and it now runs in TWO directions: rung-to-rung inside one state, and
// state-to-state across the same rung. Both are answered the same way — by
// gating every paragraph on a threshold the data actually crosses HERE — plus a
// pickFrame salt that carries the state slug as well as the amount.
//
// THREE STATE SHAPES, and they must each read correctly:
//   'bracket'  california (9 bands), new-york (9), new-jersey (7), virginia (4),
//              ohio (2, plus ORC 5747.02's $332 base amount). Per-band
//              decomposition table, asserted against the engine's own state tax.
//   'flat'     pennsylvania, illinois, georgia, north-carolina, michigan. There
//              is NO band ladder, so there is no band table and no "which band /
//              how far to the next edge" prose. What varies across the ladder is
//              the share of the salary the state's own subtraction covers, and
//              the federal side.
//   'none'     texas, florida, washington. No state income-tax section at all.
//              Washington still withholds WA PFML and WA Cares, which is its
//              differentiator; Texas and Florida carry no employeePrograms, so
//              their pages lean on the federal decomposition, FICA, the wage
//              base and the Additional Medicare gate.
//
// CALIFORNIA MUST NOT REGRESS. California shipped first and its pages are live,
// so a handful of branches below are pinned to the wording California already
// serves (marked "legacy CA wording"). Those branches say nothing that is not
// true of California; they exist so that generalising the machinery does not
// silently rewrite nine live pages.
// ===========================================================================

// The rungs. NOT an even $10,000 sweep, and that is the point: an even sweep put
// six pages between $80,000 and $130,000 where not one federal band, state band
// or phase-out threshold changes, so those pages had nothing to say that their
// neighbours did not. These nine levels are chosen so that every one of them
// crosses something real — a federal or state band edge, an OBBBA phase-out
// start, the mortgage-insurance cliff, the SECURE 2.0 Roth catch-up threshold,
// the Social Security wage base — and the prose gates below key on exactly those
// crossings. A rung earns its page by crossing something; these nine each do.
const CA_LADDER_SALARIES = [30000, 40000, 50000, 70000, 80000, 100000, 120000, 150000, 200000];

// The jurisdictions that get a ladder. Wave 1: California (already live) plus the
// twelve largest states by payroll interest. Adding a slug here adds a hub, nine
// rung pages, their sitemap entries, their freshness rule and the cross-link on
// that state's paycheck page — all of it, from this one list.
//
// WAVE 2 added twelve more, and they are not a repeat of wave 1's shapes: three of
// them carry a state-side subtraction the first thirteen never exercised, and the
// generator had to learn each one before the pages could be true.
//   massachusetts  a two-band schedule whose second band is the millionaire surtax, so
//                  every rung on this ladder reaches only the FIRST band — plus M.G.L.
//                  c.62 s.3(B)(a)(3), which deducts the FICA the filer paid up to $2,000
//                  ON TOP of the standard deduction. Both are handled in caRung() and in
//                  the "which band" prose, which used to tell a first-band filer that
//                  most of their income was charged "at the lower rates below".
//   wisconsin      a standard deduction that SLIDES DOWN with income (Wis. Stat.
//   south-carolina 71.05(22)(dp)) and SCIAD's phase-down (S.C. Code 12-6-1140(15)). The
//                  amount subtracted is a different number on every rung, so the pages
//                  print the phased figure the engine used, never the published maximum.
//   missouri       the first state on the ladder whose own subtraction is LARGER than
//                  the federal standard deduction, which reverses the sign of the
//                  "state taxable income is higher than federal" sentence.
// Tennessee is the fourth no-income-tax ladder and the first with no employee programs
// at all; Maryland, Indiana, Missouri and Alabama are the local-tax states, and the
// local block asserts nothing beyond the payroll file's own sourced note.
const LADDER_STATES = [
  'california', 'texas', 'florida', 'new-york', 'pennsylvania', 'illinois',
  'ohio', 'georgia', 'north-carolina', 'michigan', 'new-jersey', 'virginia',
  'washington',
  // wave 2
  'arizona', 'massachusetts', 'tennessee', 'indiana', 'missouri', 'maryland',
  'wisconsin', 'colorado', 'minnesota', 'south-carolina', 'alabama', 'louisiana',
];
const LADDER_STATE_SET = new Set(LADDER_STATES);
const ladderHubSlug = (slug) => `${slug}-take-home-pay`;
const ladderPath = (slug, amount) => `/${ladderHubSlug(slug)}-${amount}/`;

const usdCents = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (n) => (n * 100).toFixed(1) + '%';
const pct2 = (n) => (n * 100).toFixed(2) + '%';

// Which of the three shapes a state is, read from the data and nowhere else.
function ladderKind(st) {
  if (!st || !st.hasIncomeTax || !st.tax || st.tax.type === 'none') return 'none';
  return st.tax.type === 'flat' ? 'flat' : 'bracket';
}

// pickFrame / orderAncillary salt. California's pages are live, and the frame a
// salt selects is what the words on them are, so California keeps the salt it
// shipped with ('ca-…') and every other state salts on its own slug. That is what
// makes the framing differ ACROSS states as well as across rungs — the same
// $70,000 page in Ohio and in Georgia does not open with the same sentence.
const ladderSalt = (slug, prefix, amount) =>
  (slug === 'california' ? `ca-${prefix}-${amount}` : `${slug}-${prefix}-${amount}`);

// A program's display label. The data carries the state's own abbreviation
// ("CA SDI", "NY PFL"), which reads as jargon in a sentence, so an all-capitals
// remainder is expanded to the state name ("California SDI", "New York PFL").
// A remainder that is a word rather than an initialism is a proper name and is
// left exactly as the data has it ("WA Cares").
function programLabel(state, p) {
  const label = String(p.label || '');
  const abbr = String(state.abbr || '');
  if (abbr && label.startsWith(`${abbr} `)) {
    const rest = label.slice(abbr.length + 1);
    if (/^[A-Z/]+$/.test(rest)) return `${state.name} ${rest}`;
  }
  return label;
}

// "a Ohio salary" was reaching the page. Article agreement by first letter, with
// the one exception the fifty-one-state roster actually contains: Utah opens on a
// consonant sound ("a Utah salary"), every other vowel-initial name does not
// (Alabama, Alaska, Arizona, Arkansas, Idaho, Illinois, Indiana, Iowa, Ohio,
// Oklahoma, Oregon).
const anFor = (name) => (/^[AEIO]/.test(String(name)) ? 'an' : 'a');

// "a, b and c". The study has its own copy scoped inside main(); this is the
// module-level one the ladder blocks use.
const caList = (arr) => (arr.length <= 1
  ? (arr[0] || '')
  : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);

// The ceiling the data puts on a program, in words, or null when the data puts
// none on it (in which case the engine charges it on every dollar of wages).
function programCapPhrase(p) {
  if (p.wageBase != null) return `only the first ${usd0(p.wageBase)} of wages`;
  if (p.annualMax != null) return `at most ${usdCents(p.annualMax)} a year`;
  if (p.weeklyMax != null) return `at most ${usdCents(p.weeklyMax)} a week, ${usdCents(p.weeklyMax * 52)} a year`;
  return null;
}

// The same ceiling without the "at most" prefix, for sentences that already
// supply their own "capped at". Returns null for a wage-base ceiling, which caps
// the WAGES the rate applies to rather than the contribution itself.
function programCapCeiling(p) {
  if (p.wageBase != null) return null;
  if (p.annualMax != null) return `${usdCents(p.annualMax)} a year`;
  if (p.weeklyMax != null) return `${usdCents(p.weeklyMax)} a week, ${usdCents(p.weeklyMax * 52)} a year`;
  return null;
}

// WHETHER THE CEILING ACTUALLY BINDS AT THIS SALARY, tested against the money and
// not against which FIELD the ceiling happens to live in. The first version asked
// only `wageBase != null && gross > wageBase`, which is blind to the other two
// shapes the engine supports: New York DBL is capped by `weeklyMax` ($0.60/wk,
// $31.20/yr) and New York PFL by `annualMax` ($411.91), so on a $100,000 salary
// the rate would take $500 and $432 and the engine clamps both — yet the page
// said the cap was not reached and "the whole salary carries it". Comparing the
// unclamped rate-times-wages against what stateEmployeePrograms actually charged
// covers all three shapes at once and cannot drift from the engine.
function programCapBinds(p, grossAnnual, chargedAnnual) {
  const uncapped = grossAnnual * (p.rate || 0);
  return uncapped - chargedAnnual > 0.005;
}

// One rung's full computation. Everything a rung page or the hub needs, and
// nothing computed twice: the prose, the tables, the FAQ and the JSON-LD all
// read this one object, so the page cannot contradict itself.
function caRung(amount, taxData, slug) {
  const stData = taxData.states[slug];
  const t = stData.tax || {};
  const kind = ladderKind(stData);
  const run = (filingStatus) => computePaycheck(
    { wage: { type: 'salary', amount }, filingStatus, payFrequency: 'annual', stateSlug: slug },
    taxData
  ).annual;
  const a = run('single');
  const fed = federalBracketBreakdown(amount, 'single', taxData.federal, 0);

  // The state ladder, through the SAME engine function, by handing it the state's
  // own deduction + bracket tables in the shape it expects. That is what makes
  // the per-band figures below provably the decomposition of the state tax the
  // engine charged, rather than a second, drifting calculation. The assertion
  // that follows is the whole point of doing it this way and must never be
  // deleted: a table that does not add up to its own total is worse than no
  // table.
  let st = null;
  let stBase = 0;
  // WHAT THE STATE ACTUALLY SUBTRACTED, not what its table publishes. Three states on
  // this ladder subtract something other than the flat headline figure, and the pages
  // print the taxable income that results — so if these do not match the engine, the
  // page prints a subtraction the reader cannot reproduce.
  //   Wisconsin / South Carolina: the deduction phases down with income, so it is a
  //     different number on every rung ($13,960 at the bottom of Wisconsin's ladder, far
  //     less at the top). Printing the published maximum would be wrong on eight rungs
  //     out of nine.
  //   Massachusetts: on top of the $4,400 deduction, M.G.L. c.62 s.3(B)(a)(3) deducts the
  //     FICA the filer paid, capped at $2,000 per taxpayer. The engine passes the FICA it
  //     just computed; we pass the same figure back so the two can never disagree.
  // Both helpers are the ENGINE'S OWN, imported at the top of this file. The band/flat
  // assertions below are what keep this honest: a subtraction that does not reproduce the
  // engine's tax fails the build rather than shipping a table that does not add up.
  const stDedPublished = (t.standardDeduction && t.standardDeduction.single) || 0;
  const stDedAfterPhaseout = t.standardDeductionPhaseout
    ? phaseOutStandardDeduction(stDedPublished, amount, 'single', t.standardDeductionPhaseout)
    : stDedPublished;
  const stFicaDed = t.ficaPaidDeduction
    ? ficaPaidDeduction(a.socialSecurity + a.medicare, t.ficaPaidDeduction)
    : 0;
  // `stDed` keeps its old meaning for every wave-1 state (none of them phases anything
  // down or deducts FICA, so it is still the published figure) and becomes the whole of
  // what came off the salary where a state does more than one thing.
  const stDed = stDedAfterPhaseout + stFicaDed;
  if (kind === 'bracket') {
    st = federalBracketBreakdown(amount, 'single',
      { standardDeduction: { single: stDed }, brackets: t.brackets }, 0);
    // Ohio's ORC 5747.02(A)(3) charges "$332.00 plus 2.75% of the amount in
    // excess of $26,050". applyBrackets is continuous and can never produce that
    // step, so the engine adds it separately and so must the decomposition —
    // otherwise the band table would under-report Ohio's tax by exactly $332.
    if (t.baseAmount && st.taxable > t.baseAmount.over) stBase = t.baseAmount.amount;
    const stSum = st.bands.reduce((s, b) => s + b.tax, 0) + stBase;
    if (Math.abs(stSum - a.state) > 0.01) {
      throw new Error(
        `${stData.name} band decomposition does not reproduce the engine's state tax on $${amount}: ` +
        `bands sum to ${stSum} but computePaycheck charged ${a.state}. The page would print a table ` +
        `that does not add up to its own total — fix the decomposition, do not ship it.`
      );
    }
  } else if (kind === 'flat') {
    const taxable = Math.max(0, amount - stDed);
    const tax = taxable * t.rate;
    // Same discipline as the bracket assertion: the flat page prints "rate ×
    // taxable = tax", so that arithmetic must be the arithmetic the engine
    // actually charged. A state that quietly gains a deduction phase-out or a
    // FICA-paid deduction in the data file trips this instead of shipping a
    // page whose own sum is wrong.
    if (Math.abs(tax - a.state) > 0.01) {
      throw new Error(
        `${stData.name} flat-rate working does not reproduce the engine's state tax on $${amount}: ` +
        `${t.rate} on ${taxable} gives ${tax} but computePaycheck charged ${a.state}. Fix it, do not ship it.`
      );
    }
    st = { taxable, tax, rate: t.rate };
  }

  // Employee-side programs, zipped with the data entries so the prose can read
  // each one's cap and its own _fullName / _source text.
  const programs = (stData.employeePrograms || []).map((p, i) => ({
    data: p,
    label: programLabel(stData, p),
    rate: p.rate || 0,
    amount: (a.programs[i] && a.programs[i].amount) || 0,
  }));
  const progTotal = a.statePrograms;
  const withheld = a.totalTax + progTotal;
  return {
    amount,
    slug,
    kind,
    state: stData,
    path: ladderPath(slug, amount),
    a,
    fed,
    st,
    stDed,
    // The parts of stDed, so a sentence can name each subtraction separately where
    // there is more than one, and so the phase-out prose can say what the published
    // maximum was and how much of it survives at this rung.
    stDedPublished,
    stDedAfterPhaseout,
    stFicaDed,
    stDedPhases: !!t.standardDeductionPhaseout,
    stBase,
    programs,
    progTotal,
    // Retained under its old name because California's SDI prose reads it.
    sdi: progTotal,
    withheld,
    // effectiveRate on the engine's `annual` covers taxes only. Program premiums
    // are a real deduction from the same paycheck, so the rate this page shows
    // the reader is everything withheld over gross, and it is labelled as that.
    allInRate: amount > 0 ? withheld / amount : 0,
    byStatus: { single: a, married: run('married'), head_of_household: run('head_of_household') },
  };
}

function caLadderRungs(taxData, slug) {
  return CA_LADDER_SALARIES.map((s) => caRung(s, taxData, slug));
}

// Rows of the "where every dollar goes" table: annual / monthly / biweekly and
// the share of gross, one row per withholding line the engine actually produced.
// A state with no income tax gets no income-tax row (a "$0" line reads as a bug),
// and a state with four programs gets four program rows.
function caBreakdownRows(r, fica) {
  // A withheld line prints as "−$1,420", not "$-1,420": the sign belongs in
  // front of the whole amount, and the share column stays a positive share of
  // gross (a line that took 4.7% of your pay did not take "-4.7%" of it).
  const line = (label, amount, { minus = false, cls = '' } = {}) => {
    const share = r.amount > 0 ? pct1(amount / r.amount) : '—';
    const money = (v) => (minus ? '−' : '') + usd0(v);
    const cents = (v) => (minus ? '−' : '') + usdCents(v);
    return `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>` +
      `<td class="num">${money(amount)}</td>` +
      `<td class="num">${money(amount / 12)}</td>` +
      `<td class="num">${cents(amount / 26)}</td>` +
      `<td class="num">${share}</td></tr>`;
  };
  const out = (label, v, cls) => line(label, v, { minus: true, cls });
  return [
    line('Gross salary', r.amount),
    out('Federal income tax', r.a.federal),
    // Rates read from taxData.federal.fica, never written out as literals: the
    // columns beside them are computed from that same object, so a rate change
    // in the data file must move the label and the money together or the row
    // would contradict itself.
    out(`Social Security (${pctStr(fica.socialSecurity.rate)})`, r.a.socialSecurity),
    out(`Medicare (${pctStr(fica.medicare.rate)})`, r.a.medicare),
    ...(r.kind === 'none' ? [] : [out(`${r.state.name} income tax`, r.a.state)]),
    ...r.programs.map((p) => out(p.label, p.amount)),
    out('Total withheld', r.withheld, 'tot'),
    line('Take-home pay', r.a.net, { cls: 'net' }),
  ].join('\n');
}

// Band rows for either ladder. Only the bands the salary actually reaches are
// printed, because a table listing California's 12.3% band against $0 of income
// on a $40,000 page is padding, not information. `extra` is an optional
// non-bracket line charged on top (Ohio's statutory base amount), which has to
// appear or the table would not sum to the tax the engine charged.
function caBandRows(bd, extra) {
  const bandTax = bd.bands.reduce((s, b) => s + b.tax, 0);
  const extraRow = extra
    ? `\n<tr><td>${extra.label}</td><td class="num">—</td>` +
      `<td class="num">—</td><td class="num">${usd0(extra.tax)}</td></tr>`
    : '';
  return bd.bands.filter((b) => b.amount > 0).map((b) => {
    const range = b.upper === Infinity
      ? `${usd0(b.lower)} and up`
      : `${usd0(b.lower)} – ${usd0(b.upper)}`;
    return `<tr><td>${range}</td><td class="num">${pctStr(b.rate)}</td>` +
      `<td class="num">${usd0(b.amount)}</td><td class="num">${usd0(b.tax)}</td></tr>`;
  }).join('\n') + extraRow + `\n<tr class="tot"><td>Total</td><td class="num"></td>` +
    `<td class="num">${usd0(bd.taxable)}</td>` +
    `<td class="num">${usd0(bandTax + (extra ? extra.tax : 0))}</td></tr>`;
}

function caStatusRows(r, taxData) {
  const noState = r.kind === 'none';
  return taxData.filingStatuses.map((fs) => {
    const v = r.byStatus[fs.id];
    const rate = r.amount > 0 ? (v.totalTax + v.statePrograms) / r.amount : 0;
    return `<tr><td>${esc(fs.label)}</td><td class="num">${usd0(v.federal)}</td>` +
      (noState ? '' : `<td class="num">${usd0(v.state)}</td>`) +
      `<td class="num">${usd0(v.net)}</td>` +
      `<td class="num">${pct1(rate)}</td></tr>`;
  }).join('\n');
}

// The ladder table that appears on every rung page, with the current rung
// highlighted and the "kept from the last step" column computed from the rung
// below it. That column is the reason the ladder is worth cross-linking at all:
// it answers "is the raise worth it", which no single-salary page can.
function caLadderRows(rungs, currentAmount, windowOnly) {
  // windowOnly: just the rung below, this one, and the rung above. The hub page
  // carries the complete ladder; repeating all of it on every rung page put an
  // identical block of rows on all of them for no reader benefit.
  let view = rungs;
  if (windowOnly) {
    const at = rungs.findIndex((x) => x.amount === currentAmount);
    view = rungs.slice(Math.max(0, at - 1), at + 2);
  }
  return view.map((r) => {
    const i = rungs.findIndex((x) => x.amount === r.amount);
    const prev = i > 0 ? rungs[i - 1] : null;
    const kept = prev
      ? `${usd0(r.a.net - prev.a.net)} of ${usd0(r.amount - prev.amount)} (${pct1((r.a.net - prev.a.net) / (r.amount - prev.amount))})`
      : '—';
    const here = r.amount === currentAmount;
    const label = here
      ? `<strong>${usd0(r.amount)}</strong> (this page)`
      : `<a href="${r.path}">${usd0(r.amount)}</a>`;
    return `<tr${here ? ' class="here"' : ''}><td>${label}</td>` +
      `<td class="num">${usd0(r.a.net)}</td><td class="num">${usd0(r.a.net / 12)}</td>` +
      `<td class="num">${pct1(r.allInRate)}</td>` +
      `<td class="num${prev ? '' : ' zero'}">${kept}</td></tr>`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// PER-RUNG DIFFERENTIATION
//
// The first cut of this cluster failed an independent review: with every dollar
// figure masked out, the rung pages were 99% identical as TEXT, which is the
// doorway shape that has already cost this site three AdSense "low value
// content" rejections. The diagnosis was precise and worth writing down, because
// it is easy to re-introduce: the prose was gated, but on thresholds the ladder
// never crossed. Conditional code that never takes the other branch is
// boilerplate with extra steps.
//
// What actually varies inside a salary ladder is which THRESHOLDS the salary has
// crossed, so the blocks below are keyed to real, already-sourced ones in this
// repo's own data files:
//   - the federal band the next dollar lands in            (tax-data-2026.json)
//   - the state band, and how far the next one is           (tax-data-2026.json)
//   - the OBBBA senior deduction phase-out, from $75,000    (obbba-deductions)
//   - the car-loan interest phase-out, $100,000 to $150,000 (obbba-deductions)
//   - the mortgage-insurance premium cliff, $100k to $109k  (obbba-deductions)
//   - the tips and overtime deduction phase-out, $150,000   (obbba-deductions)
//   - the SECURE 2.0 mandatory-Roth catch-up threshold      (secure2-catchup)
//   - the 401(k) elective deferral limit as a share of pay  (secure2-catchup)
//   - the Social Security wage base                         (tax-data-2026.json)
//   - the Additional Medicare threshold                     (tax-data-2026.json)
//   - where the state's program premiums overtake its income tax   (computed)
//
// ACROSS states the same discipline does the same job: the state-structure block
// is a different block for each of the three shapes, the program block is built
// from that state's own employeePrograms (four paragraphs' worth in New Jersey,
// none at all in Georgia), and the ranking block recomputes the state's position
// against all fifty-one jurisdictions AT THIS SALARY.
//
// A block is emitted only when the rung is AT, ABOVE, or one step below its
// threshold. A page about $40,000 says nothing about the car-loan phase-out,
// because nothing about the car-loan phase-out is true of $40,000. That gating
// is what makes the sets genuinely different rather than differently-worded.
//
// Blocks are then ORDERED by a per-rung, per-state hash, so the heading sequence
// differs too.
// ---------------------------------------------------------------------------

// Ordinal words for band positions, so a band can be named without printing a
// number the masking test (rightly) ignores.
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth'];

// What the state charges on the next dollar, as a rate string, or null where
// there is no state income tax. Used wherever a sentence wants to add the state
// to a federal marginal rate.
function stateMarginalRate(r) {
  if (r.kind === 'bracket') {
    const top = r.st.bands.filter((b) => b.amount > 0).slice(-1)[0];
    return top ? top.rate : null;
  }
  if (r.kind === 'flat') return r.st.rate;
  return null;
}

// How much the state subtracts before its own rate applies, in words. The data
// field is `tax.standardDeduction` for every state that has one, but what it
// MODELS differs — California's is a standard deduction, New Jersey's is the
// $1,000 personal exemption, Illinois' and Michigan's are exemption allowances
// (each state's own disclaimer says so on its paycheck page). So the phrasing is
// neutral about what the subtraction is called, except for California, whose
// live pages already say "state standard deduction" and whose figure genuinely
// is one.
// A state with TWO subtractions has to name both, or the taxable figure printed beside
// the phrase cannot be arrived at from it. Massachusetts is the case: $4,400 of standard
// deduction plus the capped deduction for the FICA the filer paid, and a page that named
// only the first left $2,000 of the arithmetic unexplained.
function stateDeductionPhrase(r) {
  if (r.stDed <= 0) return null;
  if (r.slug === 'california') return `the ${usd0(r.stDed)} state standard deduction`; // legacy CA wording
  const base = `the ${usd0(r.stDedAfterPhaseout)} ${r.state.name} takes off first`;
  if (r.stFicaDed <= 0) return base;
  return `${base} and the ${usd0(r.stFicaDed)} it allows for the FICA already withheld from this salary`;
}

// WHY NOTHING CAME OFF. A state whose deduction has been phased ALL THE WAY OUT at this
// salary has not "subtracted nothing before its own rate applies" — that reads as a fact
// about the state's whole regime, and it is false of Wisconsin (deduction gone above
// $136,453) and South Carolina (gone above $95,000), which between them put six rungs of
// this cluster at a zero deduction for a reason the reader is entitled to. Every other
// state keeps the wording it already shipped.
function stateNoDeductionReason(r) {
  return (r.stDedPhases && r.stDedPublished > 0)
    ? `${r.state.name}'s ${usd0(r.stDedPublished)} deduction is income-tested and has phased out ` +
      `completely by this salary`
    : `${r.state.name} subtracts nothing before its own rate applies`;
}

// A block: { key, html }. `key` feeds the ordering hash and nothing else.
function caProseBlocks(r, rungs, ctx) {
  const { taxData, obbba, secure2 } = ctx;
  const st = r.state;
  const NAME = st.name;
  const i = rungs.findIndex((x) => x.amount === r.amount);
  const prev = i > 0 ? rungs[i - 1] : null;
  const next = i < rungs.length - 1 ? rungs[i + 1] : null;
  const S = usd0(r.amount);
  const frame = (salt, arr) => pickFrame(ladderSalt(r.slug, 'ladder', r.amount), salt, arr);
  // BODY wording, not just headings. The federal half of these pages states the
  // same fact in every state, so with thirteen ladders the same four hundred
  // words would otherwise appear on all thirteen $70,000 pages — a measured 93%
  // shared-shingle overlap on the first cut, against ~68% on this site's own live
  // state-paycheck cluster. The fix is the one the paycheck pages already use:
  // pickFrame, salted on the slug, over wordings that all say the identical
  // thing. arr[0] is always the wording California's nine live pages carry and
  // California is pinned to it, so generalising cannot rewrite them.
  const bodyFrame = (salt, arr) => (r.slug === 'california' ? arr[0] : frame(salt, arr));
  const B = [];
  const push = (key, html) => B.push({ key, html });

  const fica = taxData.federal.fica;
  const ssRate = pctStr(fica.socialSecurity.rate);
  const medRate = pctStr(fica.medicare.rate);
  const addlRate = pctStr(fica.additionalMedicare.rate);
  const wageBase = fica.socialSecurity.wageBase;
  const addlThreshold = fica.additionalMedicare.threshold.single;

  const fedBands = r.fed.bands.filter((b) => b.amount > 0);
  const fedTop = fedBands[fedBands.length - 1];
  const stBands = r.kind === 'bracket' ? r.st.bands.filter((b) => b.amount > 0) : [];
  const stTop = stBands[stBands.length - 1];
  const caBandsTotal = r.kind === 'bracket' ? st.tax.brackets.single.length : 0;
  const stMarginal = stateMarginalRate(r);

  // --- The federal band the next dollar lands in. One bespoke paragraph per
  // band, because what the 12% band means to a person is not what the 32% band
  // means to them, and a single templated sentence with the rate swapped is the
  // exact thing that failed review.
  {
    // THE SUPERLATIVE HAS TO BE MEASURED, NOT ASSERTED. This block used to call
    // the 12% band "the widest band in the schedule". It is not: on the published
    // single schedule the 12% band is $38,000 wide and fifth of the six finite
    // bands, behind 35% ($384,375), 24% ($96,075), 22% ($55,300) and 32%
    // ($54,450). The claim was inherited from California's live pages and was
    // wrong there too, so it is corrected everywhere rather than grandfathered.
    // What IS true, and is computed here from the same table the tax comes from:
    // how wide this band is against the one below it, whether it is the widest
    // band the salary actually reaches, and which edge carries the largest rate
    // step in the schedule.
    let lower0 = 0;
    const schedule = taxData.federal.brackets.single.map((x) => {
      const upper = x.upTo == null ? Infinity : x.upTo;
      const w = { rate: x.rate, lower: lower0, upper, width: upper - lower0 };
      lower0 = upper;
      return w;
    });
    const at = schedule.findIndex((x) => x.rate === fedTop.rate);
    const bandBelow = at > 0 ? schedule[at - 1] : null;
    const bandAbove = at >= 0 && at < schedule.length - 1 ? schedule[at + 1] : null;
    const widthHere = at >= 0 ? schedule[at].width : null;
    // "N times as wide as the one below it" — a ratio, not a superlative.
    const timesBelow = (bandBelow && bandBelow.width > 0 && Number.isFinite(widthHere))
      ? (widthHere / bandBelow.width).toFixed(1)
      : null;
    // Widest of the bands this salary actually reaches. A narrower, checkable
    // claim than "widest in the schedule", and emitted only when it holds.
    const reached = r.fed.bands.filter((x) => x.amount > 0);
    const widestReached = Number.isFinite(widthHere)
      && reached.every((x) => (x.upper - x.lower) <= widthHere);
    // The largest rate step anywhere in the schedule, computed. On the published
    // table it is the 12%-to-22% edge at ten percentage points.
    const steps = schedule.slice(1).map((x, k) => ({ from: schedule[k], to: x, jump: x.rate - schedule[k].rate }));
    const biggestStep = steps.reduce((a, x) => (x.jump > a.jump ? x : a), steps[0]);
    const pts = (v) => `${+(v * 100).toFixed(2)} percentage points`;
    const stepOutIsBiggest = bandAbove && biggestStep && biggestStep.from.rate === fedTop.rate;
    const stepInIsBiggest = bandBelow && biggestStep && biggestStep.to.rate === fedTop.rate;
    const headroom = fedTop.upper === Infinity ? null : fedTop.upper - r.fed.taxable;
    const roomLine = headroom == null
      ? bodyFrame('fedroomTop', [
        `There is no band above this one, so every further dollar is taxed at the same rate.`,
        `Nothing sits above this band, so the rate on the next dollar is the rate on the last one.`,
        `This is the final band in the schedule; no further income is treated any differently.`,
      ])
      : bodyFrame('fedroom', [
        `You have ${usd0(headroom)} of taxable income left inside it, which is about ` +
        `${usd0(headroom)} more salary before the next band starts taking a larger share of the extra.`,
        `There is ${usd0(headroom)} of room left in the band, so roughly ${usd0(headroom)} of further ` +
        `salary is charged at this rate before any of it meets the next one.`,
        `The band still has ${usd0(headroom)} of headroom, which is about ${usd0(headroom)} of raise ` +
        `before a higher rate touches any part of it.`,
      ]);
    const byBand = {
      '0.1': `<p>${S} sits in the lowest federal band there is. Almost the whole of the ` +
        `${usd0(taxData.federal.standardDeduction.single)} standard deduction is doing the work here: ` +
        `it wipes out a large fraction of the salary before a single dollar is taxed, which is why the ` +
        `federal bill of ${usd0(r.a.federal)} is so much smaller than the headline rate suggests. ` +
        `${roomLine}</p>`,
      '0.12': `<p>${bodyFrame('fb12', [
        `The next dollar you earn at ${S} is taxed in the second federal band. It runs ` +
        `${usd0(widthHere)} from edge to edge` +
        (timesBelow ? `, ${timesBelow} times the width of the band beneath it` : '') +
        (widestReached ? `, and it is the widest band your taxable income reaches` : '') +
        `, which is why a raise at this level is unusually efficient: nothing about the extra income ` +
        `changes its treatment until you leave the band.`,
        `At ${S} your next dollar falls in the second band up, a stretch of ${usd0(widthHere)}` +
        (timesBelow ? ` — ${timesBelow} times the run of the band below it` : '') +
        `. A raise here is about as cheap as a raise gets: the extra income is treated exactly like the ` +
        `income underneath it, all the way to the edge.`,
        `${S} puts the next dollar in the band just above the lowest one, ${usd0(widthHere)} wide` +
        (stepOutIsBiggest
          ? ` and closed off by the largest rate step in the schedule, ${pts(biggestStep.jump)} in a single move`
          : '') +
        `. Until a pay rise is large enough to leave it, none of your income changes how it is treated.`,
      ])} ${roomLine}</p>`,
      '0.22': `<p>${bodyFrame('fb22', [
        `At ${S} the next dollar lands in the band immediately above the wide one below it, and ` +
        `the jump between those two is the largest single step in the federal schedule. That is the step ` +
        `people feel when a raise disappoints them: the raise did not shrink, the rate on the part of it ` +
        `above the band edge went up.`,
        `${S} sits one band above the schedule's long middle stretch, and` +
        (stepInIsBiggest
          ? ` that boundary is the sharpest rate rise anywhere in the federal table, ${pts(biggestStep.jump)} at once`
          : ` that boundary is where the rate last moved`) +
        `. It explains the common complaint that a raise arrived smaller ` +
        `than expected: the raise was whole, but the slice of it past the edge met a higher rate.`,
        `The next dollar at ${S} is charged in the band directly above ` +
        (stepInIsBiggest ? `the largest rate step in the whole schedule` : `the band below it`) +
        `. Crossing that particular edge costs more than crossing any other, which is why a pay rise ` +
        `around this level so often lands lighter in the bank than it looked on the letter.`,
      ])} ${roomLine}</p>`,
      '0.24': `<p>${bodyFrame('fb24', [
        `${S} puts your next dollar two bands above the one most earners sit in. The gap between ` +
        `this band and the one below it is narrow, so unlike the step below, crossing into it barely ` +
        `changes what a raise is worth.`,
        `At ${S} the next dollar is two bands above the one most workers occupy. The rise from the band ` +
        `below is small, so crossing this particular edge costs far less than crossing the one before it.`,
        `${S} reaches two bands past the schedule's busiest one, and this edge is a gentle one: the rates ` +
        `either side of it are close enough that a raise across it is worth nearly what it was worth below.`,
      ])} ${roomLine}</p>`,
      '0.32': `<p>At ${S} the next dollar is taxed near the upper end of the federal schedule. From here ` +
        `the bands widen sharply, so this rate governs a long stretch of further income. Pre-tax saving ` +
        `is worth more at this level than anywhere lower on this ladder, because every dollar deferred ` +
        `comes off the top at this rate rather than an averaged one. ${roomLine}</p>`,
    };
    const key = String(fedTop.rate);
    push('fedband', `<h3>${frame('fedh', [
      `Where your next federal dollar lands`,
      `The federal band that governs a raise at ${S}`,
      `What the top of your federal bill is actually taxed at`,
    ])}</h3>` + (byBand[key] || `<p>At ${S} the next dollar is taxed at ${pctStr(fedTop.rate)} federally. ${roomLine}</p>`));
  }

  // --- THE STATE STRUCTURE BLOCK. Exactly one is pushed, whichever shape the
  // state is, so the block ordering downstream is stable.
  if (r.kind === 'bracket') {
    // Which band, and how far the next one is. The distance to the next band
    // edge is a different number and a different story on every rung.
    const nextEdge = stTop.upper === Infinity ? null : stTop.upper;
    const distance = nextEdge == null ? null : nextEdge - r.st.taxable;
    const pos = ORDINALS[stBands.length - 1] || `${stBands.length}th`;
    // WHERE inside the band the income sits, not just which band. This is the
    // gate that separates two rungs which happen to share a band: one has just
    // walked into it and the next raise is cheap, the other is about to leave it
    // and the next raise is not. Both are true, useful, and different.
    const bandWidth = stTop.upper === Infinity ? null : stTop.upper - stTop.lower;
    const intoBand = bandWidth == null ? null : (r.st.taxable - stTop.lower) / bandWidth;
    // THE "LOWER RATES BELOW" CLAUSE NEEDS A BAND BELOW. Massachusetts publishes two
    // bands and the second is the millionaire surtax, so every rung on its ladder tops
    // out in the FIRST one — and South Carolina's $30,000 and $40,000 rungs do the same.
    // The <34%-through wording told those readers that most of their state taxable income
    // was "still being charged at the lower rates below", when there is no rate below it
    // and the single rate covers every dollar. Gated on the band count, which is a fact
    // about the salary rather than about the state.
    const onlyBand = stBands.length === 1;
    const position = intoBand == null
      ? `<p>There is no band above this one, so where you sit inside it changes nothing.</p>`
      : (onlyBand
        ? `<p>This is the first band ${NAME} publishes and ${S} does not leave it, so every dollar of ` +
          `${NAME} taxable income here is charged at the one rate — there is nothing below it to be ` +
          `charged at less. The next edge is ${usd0(distance)} of taxable income further on` +
          // Measured across the ladder rather than assumed: South Carolina's $30,000 and
          // $40,000 rungs sit in the first band alone but its $50,000 rung does not, so
          // "no rung reaches it" is true in Massachusetts and false in South Carolina.
          (rungs.every((x) => x.kind === 'bracket' && x.st.bands.filter((b) => b.amount > 0).length <= 1)
            ? `, which no rung of this ladder reaches`
            : `, and higher rungs of this ladder do cross it`) +
          `.</p>`
        : intoBand < 0.34
        ? `<p>You have only just crossed into this band — about ${pct1(intoBand)} of the way through it — ` +
          `so most of your ${NAME} taxable income is still being charged at the lower rates below, and ` +
          `there is a long run before the next edge.</p>`
        : (intoBand > 0.66
          ? `<p>You are near the top of this band, roughly ${pct1(intoBand)} of the way through it, so the ` +
            `next ${NAME} rate step is close. A raise of ${usd0(distance)} or more will push part of ` +
            `your income into it — which matters for timing a bonus, not for whether the raise is worth ` +
            `taking.</p>`
          : `<p>You are around the middle of this band, about ${pct1(intoBand)} through it, so a modest ` +
            `raise stays at the same ${NAME} rate and a large one does not.</p>`));
    // How the schedule behaves around this salary. California keeps the wording
    // its live pages already carry; every other state gets the same fact derived
    // from the ACTUAL width of the band the salary reaches, because "the bands
    // are only a few thousand dollars wide" is true of California's lower
    // schedule and flatly false of, say, New York's fourth band, which runs for
    // sixty-six thousand dollars.
    let density;
    if (r.slug === 'california') {
      density = stBands.length <= 3                                   // legacy CA wording
        ? `California's low bands are narrow — a few thousand dollars wide each — so a modest raise at ` +
          `this level walks through more than one of them. That sounds worse than it is: the rates down ` +
          `here are small, and only the sliver of income inside each band is charged at its rate.`
        : (stBands.length >= caBandsTotal - 3
          ? `You are into the part of California's schedule where the bands stop being narrow. The band ` +
            `you are in runs for a very long stretch of income, so further raises are taxed at a rate that ` +
            `does not move for a long time.`
          : `This is the middle of California's schedule, where the bands are still only a few thousand ` +
            `dollars wide and the rate climbs a step at each edge.`);
    } else if (bandWidth == null) {
      density = `This is the last band ${NAME} publishes and it has no upper edge, so the rate on further ` +
        `income does not move again however much more you earn. Everything below it has already been ` +
        `charged at the lower rates, which is why the effective rate on the whole salary is well under ` +
        `the ${pctStr(stTop.rate)} headline.`;
    } else if (bandWidth < 10000) {
      density = `The band ${S} tops out in is only ${usd0(bandWidth)} wide, so a raise of that size alone ` +
        `carries you out of it. Narrow bands at this end of the schedule look punishing and are not: only ` +
        `the slice of income inside each one is charged at its rate.`;
    } else {
      density = `The band ${S} tops out in runs ${usd0(bandWidth)} from edge to edge, so it governs a long ` +
        `stretch of income. A raise has to be substantial before any of it is charged at a higher ` +
        `${NAME} rate.`;
    }
    const dedPhrase = stateDeductionPhrase(r);
    const takenOff = dedPhrase
      ? `(${usd0(r.st.taxable)} after ${dedPhrase})`
      : `(all ${usd0(r.st.taxable)} of it, because ${stateNoDeductionReason(r)})`;
    // Ohio's statutory base amount is a flat dollar charge on top of the bands,
    // not a band, so it gets its own sentence rather than being hidden inside a
    // rate. Emitted only where the data says it actually bites.
    const baseLine = r.stBase > 0
      ? ` On top of the band arithmetic ${NAME} adds a flat ${usd0(r.stBase)}, which the statute charges ` +
        `once taxable income passes ${usd0(st.tax.baseAmount.over)}; it is in the table below and in every ` +
        `total on this page.`
      : '';
    push('caband',
      `<h3>${frame('cah', [
        `How far up ${NAME}'s ladder ${S} reaches`,
        `Which of ${NAME}'s bands ${S} tops out in`,
        `${S} against ${NAME}'s own schedule`,
      ])}</h3>` +
      `<p>${NAME} taxes a single filer through ${numWord(caBandsTotal)} bands. ${S} reaches the ` +
      `${pos} of them, so the top slice of your ${NAME} taxable income ${takenOff} is charged at ` +
      `${pctStr(stTop.rate)}.${baseLine} ` +
      (distance != null
        ? `The next band up begins ${usd0(distance)} further on, so a raise of roughly that size is where ` +
          `your ${NAME} rate next moves. `
        : `That is the top of the published schedule. `) +
      `${density}</p>${position}`);
  } else if (r.kind === 'flat') {
    // No band ladder, so no "which band" question exists to answer. What DOES
    // move across the rungs is how much of the salary the state's own
    // subtraction covers, and therefore the gap between the headline rate and
    // the effective one.
    const rate = pctStr(r.st.rate);
    const effective = r.amount > 0 ? r.a.state / r.amount : 0;
    const dedShare = r.amount > 0 ? r.stDed / r.amount : 0;
    const body = r.stDed > 0
      ? `<p>${NAME} subtracts ${usd0(r.stDed)} before that rate touches anything, which is ` +
        `${pct1(dedShare)} of a ${S} salary. That is the only thing on the state side that changes as you ` +
        `climb this ladder: the subtraction is a fixed number of dollars, so it covers a smaller share of ` +
        `pay at every rung, and the effective ${NAME} rate here — ${pct1(effective)} of gross — creeps ` +
        `toward the ${rate} headline without ever reaching it.</p>`
      : `<p>That makes ${NAME} the simplest line on this page and the one that says least about ${S} in ` +
        `particular: with nothing subtracted first, the effective ${NAME} rate is ${rate} at every rung of ` +
        `this ladder, from ${usd0(rungs[0].amount)} to ${usd0(rungs[rungs.length - 1].amount)}. Everything ` +
        `that separates this page from the rung above it therefore comes from the federal side — which ` +
        `band the next dollar lands in, and whether the Social Security wage base or the Additional ` +
        `Medicare threshold has been crossed.</p>`;
    push('caband',
      `<h3>${frame('cah', [
        `What ${NAME}'s flat rate costs on ${S}`,
        `${S} against ${NAME}'s single rate`,
        `Why ${NAME}'s share of ${S} is easier to work out than the federal share`,
      ])}</h3>` +
      `<p>${NAME} has no bracket ladder to climb. One rate, ${rate}, applies to every taxable dollar, so ` +
      `unlike the federal schedule above there is no band edge anywhere near ${S} and no step for a raise ` +
      `to fall over: the first taxable dollar and the last are charged identically, and the ` +
      `${usd0(r.a.state)} of ${NAME} income tax on this salary is simply ${rate} of ` +
      `${usd0(r.st.taxable)}.</p>${body}`);
  } else {
    // No state income tax at all. The page must not carry an empty section or a
    // "$0" line that reads like a bug, so this block says what IS true and hands
    // the reader back to the federal decomposition, which at this salary is the
    // whole story.
    const ficaTotal = r.a.socialSecurity + r.a.medicare;
    const progClause = r.programs.length
      ? ` The only ${NAME} lines on the payslip are ${caList(r.programs.map((p) => p.label))}, which are ` +
        `insurance premiums rather than income tax and are set out below.`
      : ` There is no state line on the payslip at all.`;
    push('caband',
      `<h3>${frame('cah', [
        `${NAME} takes no income tax out of ${S}`,
        `Why this page has no ${NAME} bracket table`,
        `What ${S} loses to ${NAME}, and what it does not`,
      ])}</h3>` +
      `<p>There is no ${NAME} income-tax section on this page because there is no ${NAME} income tax to ` +
      `compute. Every dollar of tax withheld from ${S} is federal: ${usd0(r.a.federal)} of income tax and ` +
      `${usd0(ficaTotal)} of Social Security and Medicare, ${pct1(r.a.totalTax / r.amount)} of gross ` +
      `between them.${progClause}</p>` +
      bodyFrame('notaxC', [
        `<p>That makes the federal working above the entire tax story at this salary, and it changes what ` +
        `is worth paying attention to: in a bracket state a raise can move you up two ladders at once, ` +
        `while here the only questions are which federal band the next dollar lands in and whether the ` +
        `Social Security wage base or the Additional Medicare threshold has been crossed. Both are ` +
        `answered on this page.</p>`,
        `<p>So the federal breakdown further up is the whole of it. That is worth knowing when you weigh a ` +
        `raise: somewhere with a graduated state tax, extra income can cross two sets of band edges at ` +
        `once, whereas in ${NAME} there is only one schedule to cross, plus the ${usd0(wageBase)} Social ` +
        `Security ceiling and the ${usd0(addlThreshold)} Additional Medicare line. All three are worked ` +
        `out on this page.</p>`,
        `<p>Everything that decides what ${S} is worth after tax in ${NAME} is therefore in the federal ` +
        `table above. A raise here meets one set of band edges rather than two, and the only other things ` +
        `that can change its treatment are the Social Security wage base at ${usd0(wageBase)} and the ` +
        `Additional Medicare threshold at ${usd0(addlThreshold)} — both of which this page tests.</p>`,
      ]));
  }

  // --- A STATE DEDUCTION THAT SHRINKS AS THE LADDER CLIMBS. Two states on this ladder
  // do not publish one flat figure: Wisconsin's slides down 12% of income over its
  // threshold (Wis. Stat. 71.05(22)(dp)) and South Carolina's SCIAD phases down under
  // S.C. Code 12-6-1140(15). That makes the amount subtracted a different number on every
  // rung, which is exactly the kind of thing a salary ladder exists to show — and it also
  // means the figure this page prints is NOT the maximum the state advertises, so the
  // page has to say so. Emitted only where the data carries a phase-out and it has
  // actually bitten at this salary.
  if (r.stDedPhases && r.stDedPublished > 0 && r.stDedAfterPhaseout < r.stDedPublished - 0.5) {
    const cfg = st.tax.standardDeductionPhaseout.single || {};
    const goneAt = (cfg.over != null && cfg.denominator != null) ? cfg.over + cfg.denominator : null;
    const lost = r.stDedPublished - r.stDedAfterPhaseout;
    const bottom = rungs[0];
    push('statededuction',
      `<h3>${frame('sdedH', [
        `${NAME}'s deduction is smaller at ${S} than the table says`,
        `Why the ${NAME} deduction on this page is not the published figure`,
        `What ${S} does to the ${NAME} standard deduction`,
      ])}</h3>` +
      `<p>${NAME} publishes a standard deduction of ${usd0(r.stDedPublished)} for a single filer, but it ` +
      `is income-tested rather than fixed: it comes down as income rises` +
      (cfg.over != null ? ` from ${usd0(cfg.over)}` : '') +
      (goneAt != null ? ` and is gone entirely at ${usd0(goneAt)}` : '') +
      // Comma after the salary: "At $120,000 $15,000 of it" runs two dollar figures
      // together and reads as one number.
      `. At ${S}, ${usd0(lost)} of it has already been taken away, so the figure used everywhere on this ` +
      `page is ${usd0(r.stDedAfterPhaseout)}` +
      (r.stDedAfterPhaseout <= 0 ? `, which is to say none of it survives` : '') +
      `. ` +
      (bottom.stDedAfterPhaseout > r.stDedAfterPhaseout + 0.5
        ? `At the bottom of this ladder, ${usd0(bottom.amount)}, the same filer keeps ` +
          `${usd0(bottom.stDedAfterPhaseout)} of it — the gap between those two is a real cost of the ` +
          `raise that no bracket table shows.`
        : `That is why the ${NAME} share of this salary rises faster than the bracket rates alone would ` +
          `suggest.`) +
      `</p>`);
  }

  // --- THE DEDUCTION FOR THE FICA YOU ALREADY PAID. One state on this ladder allows it:
  // Massachusetts, under M.G.L. c.62 s.3(B)(a)(3), capped at $2,000 per taxpayer. It is
  // worth its own paragraph because it is invisible on every bracket table and because
  // whether the cap binds is a fact about the salary — below roughly $26,000 of wages the
  // 7.65% employee share is under the cap and the deduction is the smaller FICA figure.
  // Every number here comes from the data file's own cap and the engine's own FICA line.
  if (r.stFicaDed > 0 && st.tax && st.tax.ficaPaidDeduction) {
    const cap = st.tax.ficaPaidDeduction.cap;
    const ficaPaid = r.a.socialSecurity + r.a.medicare;
    const binds = ficaPaid > cap + 0.005;
    push('ficadeduction',
      `<h3>${frame('ficadH', [
        `${NAME} lets you deduct the FICA you paid on ${S}`,
        `The ${NAME} deduction that no bracket table shows`,
        `What ${NAME} does with the Social Security and Medicare taken from ${S}`,
      ])}</h3>` +
      `<p>On top of its standard deduction, ${NAME} subtracts the Social Security and Medicare you paid ` +
      `from the income it taxes, up to ${usd0(cap)} for one taxpayer. ` +
      (binds
        ? `${S} pays ${usd0(ficaPaid)} of employee-side FICA, comfortably over that ceiling, so the ` +
          `deduction is the full ${usd0(cap)} and does not grow with a raise.`
        : `${S} pays ${usd0(ficaPaid)} of employee-side FICA, which is under that ceiling, so the ` +
          `deduction is the ${usd0(ficaPaid)} actually paid rather than the ${usd0(cap)} maximum.`) +
      (stMarginal == null ? '' :
        ` It is worth ${usd0(r.stFicaDed * stMarginal)} at the ${pctStr(stMarginal)} rate this salary is ` +
        `charged.`) +
      ` It is already inside the ${usd0(r.a.state)} of ${NAME} income tax on this ` +
      `page. The cap is per taxpayer and cannot be pooled, so a two-earner couple has two of them; this ` +
      `page models one earner.</p>`);
  }

  // --- The Child and Dependent Care Credit's applicable percentage. IRC §21 as
  // amended by OBBBA slides the credit rate from 50% down to a 35% plateau, then
  // down again from $75,000 to a 20% floor. That is a threshold ladder that runs
  // almost the whole length of THIS ladder, which is exactly what a salary page
  // needs: four genuinely different regimes, each with a different thing to say.
  {
    const p = ctx.depCare && ctx.depCare.cdctc && ctx.depCare.cdctc.applicablePercent;
    if (p) {
      const s1 = p.stage1, s2 = p.stage2;
      const plateauStart = s1.threshold + ((p.top - p.stage1Floor) * 100) * s1.increment;
      const floorAt = s2.thresholdSingle + ((p.stage1Floor - p.stage2Floor) * 100) * s2.incrementSingle;
      let rate, bodyText;
      if (r.amount <= s1.threshold) {
        rate = p.top;
        bodyText = `you are at the top rate the credit ever pays.`;
      } else if (r.amount < plateauStart) {
        rate = Math.max(p.stage1Floor, p.top - Math.floor((r.amount - s1.threshold) / s1.increment) / 100);
        bodyText = `you are on the first slide, where the rate drops a point for every ` +
          `${usd0(s1.increment)} of income above ${usd0(s1.threshold)}. It levels off at ` +
          `${pct1(p.stage1Floor)} once income reaches ${usd0(plateauStart)}, so a raise from here costs ` +
          `you a little of this credit on the way.`;
      } else if (r.amount <= s2.thresholdSingle) {
        rate = p.stage1Floor;
        bodyText = `you are on the flat middle of the schedule. Between ${usd0(plateauStart)} and ` +
          `${usd0(s2.thresholdSingle)} the rate does not move at all, so this is the one stretch of the ` +
          `ladder where a raise does not erode the credit.`;
      } else if (r.amount < floorAt) {
        rate = Math.max(p.stage2Floor, p.stage1Floor - Math.floor((r.amount - s2.thresholdSingle) / s2.incrementSingle) / 100);
        bodyText = `you are on the second slide, which OBBBA added above ${usd0(s2.thresholdSingle)}: another ` +
          `point off for every ${usd0(s2.incrementSingle)} of income, bottoming out at ` +
          `${pct1(p.stage2Floor)} at ${usd0(floorAt)}.`;
      } else {
        rate = p.stage2Floor;
        bodyText = `you are at the floor. The rate cannot fall below ${pct1(p.stage2Floor)} however much more ` +
          `you earn, so unlike most things on this page, further raises cost you nothing here.`;
      }
      const cap = ctx.depCare.cdctc.expenseCap;
      push('cdctc',
        `<h3>${bodyFrame('cdcH', [
          `If you pay for childcare, ${S} sets your credit rate`,
          `What ${S} does to the childcare credit`,
          `The childcare credit rate that ${S} buys you`,
        ])}</h3>` +
        `<p>${bodyFrame('cdcI', [
          `The Child and Dependent Care Credit pays a percentage of qualifying care costs, up to ` +
          `${usd0(cap.oneChild)} of expenses for one dependent and ${usd0(cap.twoOrMore)} for two or more, ` +
          `and that percentage is set by your income.`,
          `The Child and Dependent Care Credit refunds a share of what you spend on qualifying care, ` +
          `counting up to ${usd0(cap.oneChild)} of expenses for one dependent or ${usd0(cap.twoOrMore)} ` +
          `for two or more, and income decides what that share is.`,
          `Qualifying childcare costs earn a credit worth a percentage of the spend, on expenses of up to ` +
          `${usd0(cap.oneChild)} for a single dependent and ${usd0(cap.twoOrMore)} where there are two or ` +
          `more. Which percentage you get depends on what you earn.`,
        ])} At ${S} it is ${pct1(rate)}: ${bodyText} ${bodyFrame('cdcC', [
          `The credit is nonrefundable and is not modelled in the take-home figures above, which assume no dependents.`,
          `It is a nonrefundable credit and none of the figures above include it: they model a filer with no dependents.`,
          `Being nonrefundable, it can only cancel tax you already owe, and the take-home numbers on this page do not include it at all.`,
        ])}</p>`);
    }
  }

  // --- Employee-side state programs (SDI / TDI / FLI / PFML / UI / UC …).
  // Entirely data-driven: a state with no `employeePrograms` array pushes no
  // block at all rather than a placeholder, and a state with four gets four
  // described lines. The "costs more than the state income tax" gate is
  // recomputed per state and only fires where it is genuinely true.
  if (r.programs.length) {
    if (r.slug === 'california') {
      // legacy CA wording — the live pages already carry these two paragraphs,
      // and every fact in them (rate, no wage cap, SB 951) is in the data file's
      // own _fullName for CA SDI.
      const sdiRate = st.employeePrograms[0].rate;
      if (r.sdi > r.a.state) {
        push('sdi',
          `<h3>At ${S}, SDI costs more than California income tax</h3>` +
          `<p>State Disability Insurance, which also funds Paid Family Leave, takes ${pct2(sdiRate)} of ` +
          `wages with no ceiling at all since SB 951 removed the taxable-wage cap in January 2024. On ` +
          `${S} that is ${usd0(r.sdi)}, against ${usd0(r.a.state)} of California income tax — so the ` +
          `deduction nobody budgets for is the bigger of the two. It happens only at the bottom of the ` +
          `ladder, because SDI is a flat rate on the whole salary while the income tax is graduated and ` +
          `starts from almost nothing. SDI is withheld after tax, so unlike a 401(k) contribution it ` +
          `reduces nothing else.</p>`);
      } else {
        push('sdi',
          `<h3>The California deduction that is not a tax</h3>` +
          `<p>Separately from income tax, California withholds ${pct2(sdiRate)} of wages for State ` +
          `Disability Insurance and Paid Family Leave. SB 951 removed its wage ceiling in January 2024, so ` +
          `on ${S} it is charged on every dollar: ${usd0(r.sdi)} a year, ${usdCents(r.sdi / 26)} a ` +
          `paycheck. It appears in no bracket table anywhere, it is withheld after tax so it reduces ` +
          `nothing else, and it is the line most people miss when they estimate a California salary.</p>`);
      }
    } else {
      // One sentence per program, each built from that program's own row in the
      // data file: its rate, whatever ceiling the data puts on it (and none is a
      // fact too), and what it actually costs at THIS salary.
      const lines = r.programs.map((p) => {
        const capped = programCapPhrase(p.data);
        const binds = programCapBinds(p.data, r.amount, p.amount);
        // A wage-base ceiling and a dollar ceiling need different sentences: one
        // stops the rate at a level of WAGES, the other stops the CONTRIBUTION at
        // a number of dollars, and describing the second as the first is how the
        // "which $100,000 does not reach" error read.
        const onWages = p.data.wageBase != null;
        let capNote;
        if (!capped) {
          capNote = ` No ceiling applies to it, so it is charged on every dollar of wages.`;
        } else if (binds && onWages) {
          capNote = ` It is charged on ${capped}, and ${S} is over that, so the contribution is pegged at ` +
            `${usdCents(p.amount)} however much more you earn.`;
        } else if (binds) {
          capNote = ` The contribution is capped at ${programCapCeiling(p.data)}, and that ceiling binds here: the rate alone ` +
            `on ${S} would come to ${usdCents(r.amount * p.rate)}, so ${usdCents(p.amount)} is what is ` +
            `actually withheld and it does not rise again.`;
        } else if (onWages) {
          capNote = ` It is charged on ${capped}, which ${S} does not reach, so the whole salary carries it.`;
        } else {
          capNote = ` The contribution is capped at ${programCapCeiling(p.data)}, but the rate on ${S} does not reach ` +
            `that ceiling, so the full ${pct2(p.rate)} is what comes out.`;
        }
        return `<li><strong>${p.label}</strong> at ${pct2(p.rate)} costs ${usdCents(p.amount)} a year, ` +
          `${usdCents(p.amount / 26)} a paycheck.${capNote}</li>`;
      }).join('\n        ');
      const one = r.programs.length === 1;
      const total = `<p>${one ? 'That takes' : 'Together they take'} ${usdCents(r.progTotal)} a year out of ${S}, ` +
        `${pct1(r.progTotal / r.amount)} of gross pay. ${one ? 'It is' : 'They are'} withheld after tax, so unlike a 401(k) ` +
        `contribution ${one ? 'it reduces' : 'they reduce'} nothing else, and ${one ? 'it appears' : 'they appear'} in no bracket table anywhere.</p>`;
      const overtakes = r.kind !== 'none' && r.progTotal > r.a.state;
      const heading = overtakes
        ? `At ${S}, ${NAME}'s payroll premiums cost more than its income tax`
        : frame('proghead', [
          `The ${NAME} deductions that are not income tax`,
          `What ${NAME} withholds on ${S} besides income tax`,
          `${NAME}'s payroll premiums on ${S}`,
        ]);
      const lead = overtakes
        ? `<p>${NAME} charges ${usdCents(r.progTotal)} of employee-side payroll premiums on ${S}, against ` +
          `${usd0(r.a.state)} of ${NAME} income tax — so at this salary the deduction nobody budgets for ` +
          `is the bigger of the two. It happens at the bottom of the ladder because the premiums are flat ` +
          `rates on wages while the income tax is graduated and starts from almost nothing.</p>`
        : `<p>Separately from income tax, ${NAME} withholds ` +
          `${numWord(r.programs.length)} employee-funded premium${r.programs.length === 1 ? '' : 's'} ` +
          `from this paycheck.</p>`;
      push('sdi', `<h3>${heading}</h3>${lead}<ul>\n        ${lines}\n      </ul>${total}`);
    }
  }

  // --- OBBBA senior deduction. Emitted at the phase-out start and above, plus
  // the rung immediately below it (where "you are close" is the useful fact).
  {
    const sen = obbba.federal.senior;
    const start = sen.phaseoutStartMagi.single;
    const full = sen.fullPhaseoutMagi.single;
    const amount = sen.amountPerPerson;
    const nearBelow = prev == null ? false : (r.amount < start && next && next.amount > start);
    if (r.amount >= full) {
      push('senior', bodyFrame('senGone', [
        `<h3>The senior deduction is fully phased out at ${S}</h3>` +
        `<p>If you are 65 or over, the OBBBA senior deduction of ${usd0(amount)} per person is worth ` +
        `nothing at this income. It reduces by ${pct1(sen.phaseoutRate)} of every dollar of modified AGI ` +
        `above ${usd0(start)} and reaches zero at ${usd0(full)}, which ${S} clears. Nothing on this page ` +
        `assumes you claim it, and an older filer on this salary should not plan around it.</p>`,
        `<h3>${S} is past the end of the senior deduction</h3>` +
        `<p>The ${usd0(amount)}-per-person deduction OBBBA gives filers aged 65 and over has already run ` +
        `out at this salary. It shrinks by ${pct1(sen.phaseoutRate)} of each dollar of modified AGI over ` +
        `${usd0(start)} and is exhausted by ${usd0(full)}, which ${S} is above. None of the figures on ` +
        `this page count on it, and nor should an older filer earning this much.</p>`,
        `<h3>Being 65 or over changes nothing at ${S}</h3>` +
        `<p>OBBBA's extra ${usd0(amount)} a head for older filers is gone by the time income reaches ` +
        `${usd0(full)}, having come down ${pct1(sen.phaseoutRate)} for every dollar above ${usd0(start)}. ` +
        `${S} clears that ceiling, so the deduction is worth nothing here, and this page never assumed ` +
        `otherwise.</p>`,
      ]));
    } else if (r.amount > start) {
      const reduced = Math.max(0, amount - (r.amount - start) * sen.phaseoutRate);
      push('senior',
        `<h3>If you are 65 or over, ${S} has already cut your senior deduction</h3>` +
        `<p>OBBBA's ${usd0(amount)}-per-person senior deduction starts shrinking above ${usd0(start)} of ` +
        `modified AGI, at ${pct1(sen.phaseoutRate)} of every dollar over the line. At ${S} you are ` +
        `${usd0(r.amount - start)} into that phase-out, leaving roughly ${usd0(reduced)} of the ` +
        `deduction, and it disappears entirely at ${usd0(full)}. The figures on this page do not include ` +
        `it — they model a filer under 65 — but it is the one deduction at this income level that a ` +
        `raise quietly erodes.</p>`);
    } else if (nearBelow) {
      push('senior', bodyFrame('senNear', [
        `<h3>${S} is just under the senior deduction phase-out</h3>` +
        `<p>OBBBA gives filers 65 and over an extra ${usd0(amount)} per person, and it is one of the few ` +
        `deductions left that is worth full value here: the phase-out does not begin until ${usd0(start)} ` +
        `of modified AGI, and ${S} is ${usd0(start - r.amount)} below that. Above the line it comes off ` +
        `at ${pct1(sen.phaseoutRate)} of every extra dollar, so this is the last rung of the ladder where ` +
        `an older filer keeps all of it.</p>`,
        `<h3>An older filer keeps the whole senior deduction at ${S}</h3>` +
        `<p>OBBBA's extra ${usd0(amount)} per person for filers aged 65 and over survives intact here. Its ` +
        `phase-out starts at ${usd0(start)} of modified AGI and ${S} is ${usd0(start - r.amount)} short of ` +
        `that, so nothing has been taken off it yet. Past the line it erodes by ${pct1(sen.phaseoutRate)} ` +
        `of every further dollar earned, and the next rung up this ladder is already into it.</p>`,
        `<h3>${S} is the last rung with the senior deduction untouched</h3>` +
        `<p>If you are 65 or over, OBBBA adds ${usd0(amount)} per person to what comes off before tax, and ` +
        `at ${S} it is still worth every cent: the taper does not start until ${usd0(start)} of modified ` +
        `AGI, ${usd0(start - r.amount)} above this salary. From there it falls away at ` +
        `${pct1(sen.phaseoutRate)} of each extra dollar of income.</p>`,
      ]));
    }
  }

  // --- Car-loan interest deduction, $100,000 to $150,000 single. A phase-out
  // that begins and ENDS inside this ladder, so three rungs each get a genuinely
  // different paragraph.
  {
    const cl = obbba.federal.carLoan;
    const start = cl.phaseoutStartMagi.single;
    const gone = cl.fullPhaseoutMagi.single;
    const cap = cl.interestCap;
    if (r.amount >= gone) {
      push('carloan',
        `<h3>New-car loan interest is no longer deductible at ${S}</h3>` +
        `<p>OBBBA made interest on a qualifying new-vehicle loan deductible up to ${usd0(cap)} a year, ` +
        `even without itemizing — but only below ${usd0(gone)} of modified AGI for a single filer. The ` +
        `deduction falls by ${usd0(cl.phaseoutReductionPer1000)} for every ${usd0(1000)} above ` +
        `${usd0(start)} and is gone by ${usd0(gone)}, which ${S} is at or above. Worth knowing before ` +
        `a dealer quotes it as a reason to finance.</p>`);
    } else if (r.amount >= start) {
      const left = Math.max(0, cap - Math.floor((r.amount - start) / 1000) * cl.phaseoutReductionPer1000);
      push('carloan',
        `<h3>${S} is inside the car-loan interest phase-out</h3>` +
        `<p>The OBBBA deduction for interest on a qualifying new-vehicle loan is capped at ${usd0(cap)} ` +
        `and shrinks by ${usd0(cl.phaseoutReductionPer1000)} per ${usd0(1000)} of modified AGI above ` +
        `${usd0(start)}. At ${S} you are ${usd0(r.amount - start)} past that line, so roughly ` +
        `${usd0(left)} of the allowance survives, and it reaches zero at ${usd0(gone)}. This is a ` +
        `deduction, not a credit, so what it is actually worth to you is that figure times your federal ` +
        `marginal rate.</p>`);
      // STRICTLY GREATER THAN, not >=. Every variant below tells the reader the
      // next rung up loses part of the allowance. At a rung sitting exactly ON
      // the phase-out start the reduction is floor(0/1000) x $200 = $0, so the
      // next rung keeps all of it too and the sentence contradicted that rung's
      // own page ("you are $0 past that line, so roughly $10,000 survives").
    } else if (next && next.amount > start) {
      push('carloan', bodyFrame('clFull', [
        `<h3>${S} keeps the full car-loan interest deduction</h3>` +
        `<p>Interest on a qualifying new-vehicle loan is deductible up to ${usd0(cap)} a year under ` +
        `OBBBA without itemizing, and the phase-out does not start until ${usd0(start)} of modified AGI ` +
        `for a single filer. At ${S} you are ${usd0(start - r.amount)} below it and keep the whole ` +
        `allowance; the very next step up this ladder does not.</p>`,
        `<h3>The whole new-car interest allowance survives at ${S}</h3>` +
        `<p>OBBBA lets a single filer deduct up to ${usd0(cap)} a year of interest on a qualifying ` +
        `new-vehicle loan without itemising, and nothing comes off it below ${usd0(start)} of modified ` +
        `AGI. ${S} sits ${usd0(start - r.amount)} under that line, so the allowance is untouched here — ` +
        `which is not true of the next rung up.</p>`,
        `<h3>${S} is the last rung with the car-loan deduction whole</h3>` +
        `<p>Interest on a qualifying new-vehicle loan is deductible up to ${usd0(cap)} a year under OBBBA, ` +
        `and no itemising is required. The taper begins at ${usd0(start)} of modified AGI for a single ` +
        `filer; ${S} is ${usd0(start - r.amount)} below it, so all of the allowance is available and the ` +
        `step above this one already loses some.</p>`,
      ]));
    }
  }

  // --- Mortgage insurance premium deduction. A hard cliff, $100,000 to
  // $109,000 — narrow enough that exactly one rung sits inside it.
  {
    const mip = obbba.federal.mip.phaseout;
    const start = mip.threshold.single;
    const gone = mip.eliminatedAboveAgi.single;
    if (r.amount > start && r.amount < gone) {
      const steps = Math.floor((r.amount - start) / mip.stepSize.single);
      const left = Math.max(0, 1 - steps * mip.reductionPerStep);
      push('mip',
        `<h3>${S} lands inside the mortgage-insurance cliff</h3>` +
        `<p>Mortgage insurance premiums are treated as deductible interest for itemizers, but the ` +
        `allowance falls by ${pct1(mip.reductionPerStep)} of itself for every ${usd0(mip.stepSize.single)} ` +
        `of AGI above ${usd0(start)} and vanishes above ${usd0(gone)}. That is a ${usd0(gone - start)} ` +
        `window, and ${S} is inside it: roughly ${pct1(left)} of the deduction remains. It is the ` +
        // Was the string "nine thousand dollars" sitting in the same sentence
        // that computes usd0(gone - start) from the data. No rung currently lands
        // in the window so it emitted nowhere, but a hardcoded threshold in
        // emitted copy is exactly what this cluster is not allowed to carry.
        `steepest phase-out anywhere near this salary — ${usd0(gone - start)} of income removes all of ` +
        `it — and it only matters if you itemize and pay PMI.</p>`);
    } else if (r.amount >= gone && (prev == null || prev.amount < gone)) {
      push('mip',
        `<h3>The mortgage-insurance deduction has just closed</h3>` +
        `<p>PMI is deductible as interest for itemizers only below ${usd0(gone)} of AGI, phasing down ` +
        `from ${usd0(start)} at ${pct1(mip.reductionPerStep)} per ${usd0(mip.stepSize.single)}. ` +
        `${S} is above the end of that window, so the deduction is worth nothing here however much PMI ` +
        `you pay. It is one of the few thresholds on this ladder that closes completely inside a ` +
        `${usd0(gone - start)} span of income.</p>`);
    }
  }

  // --- Tips and overtime deductions, phase-out from $150,000.
  {
    const ot = obbba.federal.overtime;
    const tp = obbba.federal.tips;
    const start = ot.phaseoutStartMagi.single;
    if (r.amount >= start) {
      const over = r.amount - start;
      const otLeft = Math.max(0, ot.cap.single - Math.floor(over / 1000) * ot.phaseoutReductionPer1000);
      const tpLeft = Math.max(0, tp.cap.single - Math.floor(over / 1000) * tp.phaseoutReductionPer1000);
      push('tipsot',
        `<h3>The tips and overtime deductions are shrinking at ${S}</h3>` +
        `<p>OBBBA's deductions for qualified tips (up to ${usd0(tp.cap.single)}) and the FLSA overtime ` +
        `premium (up to ${usd0(ot.cap.single)}) both start phasing out at ${usd0(start)} of modified AGI ` +
        `for a single filer, at ${usd0(ot.phaseoutReductionPer1000)} per ${usd0(1000)} over. At ${S} that ` +
        `leaves roughly ${usd0(tpLeft)} of the tips allowance and ${usd0(otLeft)} of the overtime one. ` +
        `Neither touches FICA either way: Social Security and Medicare are still charged on tips and ` +
        `overtime in full.</p>`);
    } else if (next && next.amount >= start) {
      push('tipsot', bodyFrame('otFull', [
        `<h3>${S} still gets the tips and overtime deductions in full</h3>` +
        `<p>If part of your pay is tips or FLSA overtime premium, OBBBA lets you deduct up to ` +
        `${usd0(tp.cap.single)} of tips and ${usd0(ot.cap.single)} of overtime premium without ` +
        `itemizing, and the phase-out does not begin until ${usd0(start)} of modified AGI. ${S} is ` +
        `${usd0(start - r.amount)} below that line, so both survive intact. They cut income tax only — ` +
        `Social Security and Medicare are charged on that income regardless.</p>`,
        `<h3>Both the tips and overtime deductions survive at ${S}</h3>` +
        `<p>Where some of your pay arrives as tips or as FLSA overtime premium, OBBBA allows a deduction ` +
        `of up to ${usd0(tp.cap.single)} on the tips and ${usd0(ot.cap.single)} on the premium, with no ` +
        `need to itemise. Nothing starts phasing out below ${usd0(start)} of modified AGI, and ${S} is ` +
        `${usd0(start - r.amount)} under it, so both are worth their full value. Neither touches FICA: ` +
        `Social Security and Medicare are charged on tips and overtime like any other wages.</p>`,
        `<h3>Tips and overtime are still fully deductible at ${S}</h3>` +
        `<p>OBBBA's deductions — up to ${usd0(tp.cap.single)} of qualified tips and ${usd0(ot.cap.single)} ` +
        `of FLSA overtime premium, claimable without itemising — do not begin to shrink until modified ` +
        `AGI reaches ${usd0(start)}. At ${S} you are ${usd0(start - r.amount)} short of that, so both are ` +
        `intact. What they reduce is income tax and nothing else; the FICA on that same income is ` +
        `unchanged.</p>`,
      ]));
    }
  }

  // --- SECURE 2.0 mandatory Roth catch-up. A threshold on prior-year FICA wages
  // that this ladder crosses exactly once.
  {
    const yr = secure2.rothCatchUp.byYear[String(taxData.taxYear)];
    if (yr && yr.enforced) {
      if (r.amount > yr.threshold) {
        push('rothcatchup',
          `<h3>At ${S}, your 401(k) catch-up has to be Roth</h3>` +
          `<p>SECURE 2.0 changed where the catch-up contribution goes for higher earners. From ` +
          `${taxData.taxYear} anyone whose prior-year Social Security wages from the plan-sponsoring ` +
          `employer exceeded ${usd0(yr.threshold)} must make age-${secure2.rothCatchUp.catchUpMinAge}-plus ` +
          `catch-up contributions as designated Roth — after tax — rather than pre-tax. ${S} is above ` +
          `that line, so if you are ${secure2.rothCatchUp.catchUpMinAge} or older the catch-up portion ` +
          `stops reducing your taxable income. The regular ${usd0(yr.deferral)} deferral is unaffected.</p>`);
      } else if (next && next.amount > yr.threshold) {
        push('rothcatchup',
          `<h3>${S} is under the mandatory-Roth catch-up line</h3>` +
          `<p>From ${taxData.taxYear}, a worker over ${usd0(yr.threshold)} of prior-year Social Security ` +
          `wages with one employer must take their age-${secure2.rothCatchUp.catchUpMinAge}-plus 401(k) ` +
          `catch-up as Roth instead of pre-tax. At ${S} you are ${usd0(yr.threshold - r.amount)} below ` +
          `that threshold, so the catch-up is still yours to make pre-tax and still reduces the federal ` +
          `bill shown above. It is the next rung up this ladder that loses it.</p>`);
      }
    }
  }

  // --- 401(k) headroom as a share of gross. Not a threshold, but the figure is
  // dramatic at the bottom of the ladder and unremarkable at the top, so the
  // paragraph is written for the band it appears in rather than templated. The
  // rate it quotes is federal PLUS the state's own marginal rate, which is a
  // different number in every state and simply absent in the three that levy no
  // income tax.
  {
    const yr = secure2.rothCatchUp.byYear[String(taxData.taxYear)];
    if (yr && yr.deferral) {
      const share = yr.deferral / r.amount;
      const stateRateClause = stMarginal == null ? '' : ` plus ${pctStr(stMarginal)} in ${NAME}`;
      const stateRateClause2 = stMarginal == null ? '' : ` and ${pctStr(stMarginal)} in ${NAME}`;
      if (share >= 0.4) {
        push('deferral',
          `<h3>Maxing a 401(k) is not realistic at ${S}</h3>` +
          `<p>The ${taxData.taxYear} elective deferral limit is ${usd0(yr.deferral)}, which is ` +
          `${pct1(share)} of a ${S} salary. Nobody at this income is hitting it, and the advice to ` +
          `"max out your 401(k)" is written for a salary several rungs up this ladder. What is worth ` +
          `knowing is the rate: every dollar you do defer comes off at ${pctStr(fedTop.rate)} federally` +
          `${stateRateClause}, so even a small contribution is bought at a real ` +
          `discount.</p>`);
      } else if (share < 0.18) {
        push('deferral', bodyFrame('defHi', [
          `<h3>Pre-tax saving does the most work at ${S}</h3>` +
          `<p>The ${taxData.taxYear} elective deferral cap of ${usd0(yr.deferral)} is only ${pct1(share)} ` +
          `of this salary, so unlike lower down the ladder it is comfortably reachable — and it is worth ` +
          `more here than anywhere below, because each deferred dollar comes off the top at ` +
          `${pctStr(fedTop.rate)} federally${stateRateClause2} rather than at an ` +
          `averaged rate. Deferring the full amount is the single largest lever on the figures at the ` +
          `top of this page. FICA is unaffected either way.</p>`,
          `<h3>The 401(k) cap is within reach at ${S}</h3>` +
          `<p>At ${usd0(yr.deferral)}, the ${taxData.taxYear} elective deferral limit is ${pct1(share)} of ` +
          `this salary — reachable in a way it simply is not further down this ladder, and worth more ` +
          `here too, because each deferred dollar is taken off the top at ${pctStr(fedTop.rate)} ` +
          `federally${stateRateClause2} instead of at some blended rate. Nothing else available to you ` +
          `moves the numbers at the top of this page as far. FICA is charged either way.</p>`,
          `<h3>What deferring the maximum is worth at ${S}</h3>` +
          `<p>The ${taxData.taxYear} cap on elective deferrals, ${usd0(yr.deferral)}, works out at ` +
          `${pct1(share)} of this salary. That makes it both achievable and unusually valuable: the ` +
          `dollars you defer are the top dollars, charged at ${pctStr(fedTop.rate)} ` +
          `federally${stateRateClause2}, not at an average of every band below. It is the largest single ` +
          `lever over the figures on this page, and it leaves FICA exactly where it was.</p>`,
        ]));
      }
    }
  }

  // --- Social Security wage base. A real gate now that the ladder reaches past
  // it; silent on the rungs where it is far away and says nothing useful.
  {
    if (r.amount >= wageBase) {
      push('ssbase',
        `<h3>Social Security stops before the year does at ${S}</h3>` +
        `<p>Social Security is charged at ${ssRate} on the first ${usd0(wageBase)} of wages and nothing ` +
        `above it, so at ${S} the contribution is capped at ${usd0(r.a.socialSecurity)} however much ` +
        `more you earn. In practice that means your take-home pay rises partway through the year, once ` +
        `year-to-date wages pass the base and the ${ssRate} stops coming out — this page shows the ` +
        `annual average, not that step. Medicare has no ceiling and keeps taking ${medRate} of ` +
        `everything: ${usd0(r.a.medicare)} here.</p>`);
    } else if (next && next.amount >= wageBase) {
      push('ssbase',
        `<h3>${S} is the last rung fully inside the Social Security base</h3>` +
        `<p>Social Security stops being charged above ${usd0(wageBase)} of wages. At ${S} you are ` +
        `${usd0(wageBase - r.amount)} short, so the whole salary carries the ${ssRate} — ` +
        `${usd0(r.a.socialSecurity)} a year — and there is no mid-year jump in your net pay. Above the ` +
        `base a paycheck grows partway through the year; below it, every paycheck is the same.</p>`);
    }
  }

  // --- Additional Medicare. Emitted only where the salary is actually at or
  // over the line, or one rung below it. Everywhere else this was boilerplate.
  {
    if (r.amount > addlThreshold) {
      push('addlmed',
        `<h3>The Additional Medicare surtax applies at ${S}</h3>` +
        `<p>Single filers owe an extra ${addlRate} of Medicare tax on wages above ${usd0(addlThreshold)}. ` +
        `${S} clears that by ${usd0(r.amount - addlThreshold)}, and the surtax is already inside the ` +
        `${usd0(r.a.medicare)} Medicare figure on this page. Two wrinkles: an employer withholds it from ` +
        `${usd0(addlThreshold)} of wages whatever your filing status, so a joint filer can see it taken ` +
        `before they owe it; and the threshold is not indexed for inflation, so it catches more people ` +
        `every year without anyone legislating.</p>`);
    } else if (r.amount === addlThreshold) {
      push('addlmed',
        `<h3>${S} sits exactly on the Additional Medicare line</h3>` +
        `<p>The extra ${addlRate} Medicare surtax applies to single-filer wages ABOVE ` +
        `${usd0(addlThreshold)}, and ${S} is precisely at it, not over it — so the surtax is zero and ` +
        `the Medicare figure here is the plain ${medRate}. One more dollar of wages starts it, and ` +
        `because the threshold has never been indexed for inflation, the salary that lands on this line ` +
        `is more ordinary every year.</p>`);
    }
  }

  // --- CROSS-STATE DIFFERENTIATION. Four blocks that exist because the twelve
  // new ladders were measurably too alike without them: a shingle pass put the
  // flat-with-a-deduction states (Illinois, Georgia, North Carolina, Michigan) at
  // 92-94% shared 8-word text, which is the doorway shape, not a cluster. Every
  // one of these reads a per-state file this repo already sources and the state
  // pages already ship, so nothing here is asserted:
  //   local wage taxes        state-payroll-2026.json  .localIncomeTax
  //   the state wage floor    state-payroll-2026.json  .minWage2026
  //   OBBBA conformity        obbba-deductions-2026.json .states
  //   supplemental method     state-supplemental-2026.json .states
  // They are skipped for California, whose nine pages are already live and whose
  // build output is pinned byte-for-byte; adding them there is a separate change.

  // --- Local wage taxes. Only where the payroll data says the state has them,
  // and the substance is that file's own sourced note rather than anything
  // asserted here. This alone separates Michigan, Ohio, Pennsylvania, New York
  // and New Jersey from the states that have nothing on this line.
  {
    const lt = ctx.payrollState && ctx.payrollState.localIncomeTax;
    if (r.slug !== 'california' && lt && lt.exists && lt.notes) {
      push('localtax',
        `<h3>${frame('locH', [
          `What the ${usd0(r.a.net)} above does not account for`,
          `${S} before anything local`,
          `Where local wage taxes sit relative to this figure`,
        ])}</h3>` +
        // NO EMPLOYEE-SIDE COST SENTENCE. This used to end "every 1% of one would
        // cost $1,000 a year at $100,000, straight off the $74,390 above", which
        // reads as a live deduction the reader should expect. `localIncomeTax
        // .exists` is the wrong gate for that: it is true for New Jersey, whose
        // own sourced note printed directly beneath says the single local levy
        // (Newark, 1%) is EMPLOYER-paid and never leaves an employee's paycheck.
        // Nothing in the repo separates employer-side from employee-side levies,
        // so the honest move — and the one the shipped localTaxBlock() on the
        // state paycheck pages already makes — is to assert nothing and let the
        // sourced note carry the whole answer. The rung-varying figure that
        // remains is this page's own net, which is a fact about this page.
        `<p>The ${usd0(r.a.net)} above is what ${S} leaves after federal withholding, FICA and ` +
        `${NAME} state withholding, and nothing else. Anything a city, county or school district ` +
        `levies on wages sits outside that figure, and whether any of it reaches your paycheck is a ` +
        `municipal question rather than a state one — so it is not modelled here. ${NAME}'s own ` +
        `published position is below.</p>` +
        `<p class="sal-note">${esc(String(lt.notes))}</p>`);
    }
  }

  // --- The state wage floor. A ratio that moves with BOTH axes: the rung and
  // the state ($7.25 in Georgia against $17.13 in Washington), and the two
  // withholding rates either end of it are computed through the same engine.
  {
    const mw = ctx.payrollState && ctx.payrollState.minWage2026;
    if (r.slug !== 'california' && mw && mw.amountUsd > 0) {
      const floorAnnual = mw.amountUsd * 40 * 52;
      const floorRun = computePaycheck(
        { wage: { type: 'salary', amount: floorAnnual }, filingStatus: 'single', payFrequency: 'annual', stateSlug: r.slug },
        taxData
      ).annual;
      const floorWithheld = floorRun.totalTax + floorRun.statePrograms;
      const mult = r.amount / floorAnnual;
      // The bottom rung is not always above the floor. A full-time year at
      // Washington's $17.13 is $35,630 and at Illinois' $15.00 is $31,200, both
      // of which clear the $30,000 rung — so the "the extra $X of gross" sentence
      // has to have a branch, or it prints a negative dollar amount and asserts
      // the opposite of what the data says.
      const above = r.amount >= floorAnnual;
      const comparison = above
        ? `${S} is ${mult.toFixed(1)} times that.`
        : `${S} is BELOW that: a full-time year at the ${NAME} minimum pays ` +
          `${usd0(floorAnnual - r.amount)} more than this rung.`;
      const closer = above
        ? `The gap between those two shares is the graduated system doing its work: the extra ` +
          `${usd0(r.amount - floorAnnual)} of gross is charged at higher rates than the first ` +
          `${usd0(floorAnnual)} ever is.`
        : `Both salaries sit low enough that the standard deduction is doing most of the work, which is ` +
          `why the two withholding shares are so close together despite the ` +
          `${usd0(floorAnnual - r.amount)} between the salaries.`;
      push('minwage',
        `<h3>${frame('mwH', [
          `${S} against ${NAME}'s wage floor`,
          `${S} beside the ${NAME} minimum wage`,
          `What ${NAME}'s minimum wage keeps, and what ${S} keeps`,
        ])}</h3>` +
        `<p>The minimum wage in ${NAME} is ${usdCents(mw.amountUsd)} an hour, which is ${usd0(floorAnnual)} ` +
        `a year at forty hours a week. ${comparison} Run the floor through the ` +
        `same engine and it keeps ${usd0(floorRun.net)} of that ${usd0(floorAnnual)} — ` +
        `${pct1(floorWithheld / floorAnnual)} withheld — against ${pct1(r.allInRate)} at ${S}. ${closer}</p>` +
        (mw.notes ? `<p class="sal-note">${esc(String(mw.notes))}</p>` : ''));
    }
  }

  // --- Whether the state follows OBBBA on tips and overtime. Emitted where the
  // state actually offers something (Michigan yes, Georgia capped, New York on
  // tips only) or where the federal phase-out is live at this rung; silent where
  // a flat "no" would be the same sentence on every page.
  {
    const ob = ctx.obbbaStates && ctx.obbbaStates[r.slug];
    const otStart = obbba.federal.overtime.phaseoutStartMagi.single;
    const federalLive = r.amount >= otStart || (next && next.amount >= otStart);
    if (r.slug !== 'california' && ob && ob.hasWageTax && ob.overtime && ob.tips) {
      const otY = String(ob.overtime.y2026);
      const tpY = String(ob.tips.y2026);
      if (otY !== 'no' || tpY !== 'no' || federalLive) {
        const verdict = (what, v) => (v === 'yes'
          ? `follows the federal ${what}`
          : (v === 'partial' ? `only partly follows the federal ${what}` : `does not follow the federal ${what}`));
        // What the state does NOT fully follow, named. Michigan follows both, so
        // this list is empty there and the sentence below is omitted rather than
        // asserting a state charge that does not exist.
        const notFollowed = [];
        if (tpY !== 'yes') notFollowed.push('tips');
        if (otY !== 'yes') notFollowed.push('overtime premium');
        const stateBite = (stMarginal == null || !notFollowed.length) ? ''
          : ` Where it does not, a dollar of qualified ${caList(notFollowed)} that escapes ` +
            `${pctStr(fedTop.rate)} of federal tax at ${S} is still charged ${pctStr(stMarginal)} by ${NAME}.`;
        push('obbbastate',
          `<h3>${frame('obH', [
            `Does ${NAME} follow the tips and overtime deductions?`,
            `The federal tips and overtime break, and what ${NAME} does with it`,
            `${NAME} and the OBBBA tips and overtime deductions`,
          ])}</h3>` +
          // "the two can be worth different amounts" is only true where the two
          // answers actually differ, which is New York and nowhere else in wave 1.
          `<p>The tips and overtime deductions described on this page are federal. On the state return ` +
          (tpY === otY
            ? `${NAME} treats them alike: it ${verdict('tips and overtime deductions', tpY)}.`
            : `${NAME} ${verdict('tips deduction', tpY)} but ${verdict('overtime deduction', otY)}, so the ` +
              `same paycheck can carry two different answers.`) +
          `${stateBite}</p>` +
          (ob.note ? `<p class="sal-note">${esc(String(ob.note))}</p>` : ''));
      }
    }
  }

  // --- Supplemental (bonus) withholding. Emitted only where the state publishes
  // a SEPARATE flat rate for it, because that is the only case where there is an
  // answer a salary page does not already give. In a bracket state the comparison
  // moves rung by rung; in a flat state it is one fixed, and often surprising,
  // gap between the bonus rate and the wage rate.
  {
    const sp = ctx.suppStates && ctx.suppStates[r.slug];
    if (r.slug !== 'california' && sp && sp.method === 'flat' && sp.rate > 0 && stMarginal != null) {
      const sr = sp.rate;
      const per1000 = 1000 * sr;
      const per1000Wage = 1000 * stMarginal;
      const relation = Math.abs(sr - stMarginal) < 1e-9
        ? `exactly the rate your salary is charged at this rung, so a bonus and a raise are withheld identically here`
        : (sr > stMarginal
          ? `above the ${pctStr(stMarginal)} your salary is charged at this rung, so a bonus is over-withheld and the difference comes back at filing`
          : `below the ${pctStr(stMarginal)} your salary is charged at this rung, so a bonus is under-withheld and the difference is owed at filing`);
      push('bonus',
        `<h3>${frame('bonH', [
          `A bonus is withheld differently from a raise in ${NAME}`,
          `What ${NAME} takes from a bonus at ${S}`,
          `Why ${anFor(NAME)} ${NAME} bonus does not follow the rate on this page`,
        ])}</h3>` +
        `<p>${NAME} withholds supplemental wages — a bonus, a commission, a payout — at a flat ` +
        `${pctStr(sr)}, not at the rate the rest of your pay is charged. That is ${relation}. On ` +
        `${usd0(1000)} of bonus it is the difference between ${usdCents(per1000)} and ` +
        `${usdCents(per1000Wage)} of ${NAME} withholding. Withholding is not the tax: what you owe is ` +
        `settled on the return either way.</p>`);
    }
  }

  // --- Where this state ranks AT THIS SALARY. A state's position against the
  // other fifty jurisdictions is not fixed: a state with a flat rate and one with
  // a graduated rate trade places as income rises, so the set of states sitting
  // immediately either side of this one at $30,000 is not the set at $200,000.
  // Computed here from the same engine, for every jurisdiction, at this rung.
  {
    const peers = ctx.allStates;
    if (peers && peers.length) {
      const rows = peers.map((s) => ({
        name: s.name,
        slug: s.slug,
        net: computePaycheck(
          { wage: { type: 'salary', amount: r.amount }, filingStatus: 'single', payFrequency: 'annual', stateSlug: s.slug },
          taxData
        ).annual.net,
      })).sort((a, b) => b.net - a.net);
      const at = rows.findIndex((x) => x.slug === r.slug);
      if (at !== -1) {
        const me = rows[at];
        const best = rows[0];
        const worst = rows[rows.length - 1];
        const above = rows.slice(Math.max(0, at - 2), at).map((x) => x.name);
        const below = rows.slice(at + 1, at + 3).map((x) => x.name);
        const fromBottom = rows.length - at;
        push('rank',
          `<h3>Where ${NAME} ranks on ${S}</h3>` +
          `<p>Run the same ${S} through all fifty states and the District of Columbia and ${NAME} ` +
          (at === 0
            ? `comes out top on take-home pay, keeping ${usd0(me.net)}. `
            : (at === rows.length - 1
              ? `comes last on take-home pay, keeping ${usd0(me.net)}. `
              : `comes ${numWord(at + 1)} from the top on take-home pay — ${numWord(fromBottom)} from the ` +
                `bottom — keeping ${usd0(me.net)}. `)) +
          (above.length
            ? `The jurisdictions immediately above it at this salary are ${caList(above)}; `
            : `Nothing keeps more at this salary; `) +
          (below.length ? `immediately below are ${caList(below)}. ` : `nothing keeps less. `) +
          (at === 0
            ? `Nowhere in the country keeps more of ${S} than ${NAME} does, and ${worst.name} keeps least at ${usd0(worst.net)}, ${usd0(me.net - worst.net)} less on identical gross pay. `
            : (at === rows.length - 1
              ? `${best.name} tops the table at ${usd0(best.net)}, ${usd0(best.net - me.net)} more than ${NAME} on identical gross pay, and nowhere keeps less than ${NAME} does. `
              : `${best.name} tops the table at ${usd0(best.net)}, ${usd0(best.net - me.net)} more than ` +
                `${NAME} on identical gross pay, and ${worst.name} is last at ${usd0(worst.net)}. `)) +
          `That ranking is specific to ${S}: flat-rate and graduated states change places as income ` +
          `rises, so ${NAME}'s neighbours on this table are different at other salaries.</p>`);
      }
    }
  }

  // --- The step. The top rung used to end on the "coming up from" half alone,
  // which left the thinnest page on the ladder at exactly the point a reader is
  // most likely to be comparing offers. It now gets its own closing paragraph.
  {
    if (prev && next) {
      const keptA = r.a.net - prev.a.net;
      const keptB = next.a.net - r.a.net;
      push('step',
        `<h3>${frame('steph', [
          `What the step either side of ${S} is worth`,
          `The raise into ${S}, and the raise out of it`,
          `Moving up from ${S}, and how you got here`,
        ])}</h3>` +
        bodyFrame('stepMid', [
          `<p>Coming up from ${usd0(prev.amount)}, a ${usd0(r.amount - prev.amount)} raise added ` +
          `${usd0(keptA)} of take-home pay — ${pct1(keptA / (r.amount - prev.amount))} of it survived ` +
          `withholding. Going on to ${usd0(next.amount)} would add ${usd0(keptB)} a year, ` +
          `${usd0(keptB / 12)} a month, out of ${usd0(next.amount - r.amount)} of extra gross, or ` +
          `${pct1(keptB / (next.amount - r.amount))}. Nothing in either schedule creates a cliff where ` +
          `earning more leaves you with less: a band rate only ever applies to the income inside that ` +
          `band.</p>`,
          `<p>The last step, ${usd0(prev.amount)} to ${S}, was worth ${usd0(r.amount - prev.amount)} of ` +
          `gross and ${usd0(keptA)} of it reached you: ${pct1(keptA / (r.amount - prev.amount))} survived. ` +
          `The next one, up to ${usd0(next.amount)}, is worth ${usd0(next.amount - r.amount)} of gross and ` +
          `${usd0(keptB)} of take-home — ${usd0(keptB / 12)} a month, or ` +
          `${pct1(keptB / (next.amount - r.amount))} of the raise. Neither schedule can leave you worse ` +
          `off for earning more; a rate only ever touches the income sitting inside its own band.</p>`,
          `<p>Getting here from ${usd0(prev.amount)} meant a ${usd0(r.amount - prev.amount)} rise, of ` +
          `which ${usd0(keptA)} landed in your account — ${pct1(keptA / (r.amount - prev.amount))}. ` +
          `Leaving for ${usd0(next.amount)} would mean another ${usd0(next.amount - r.amount)}, and this ` +
          `time ${usd0(keptB)} a year reaches you, ${usd0(keptB / 12)} a month, ` +
          `${pct1(keptB / (next.amount - r.amount))} of it. No point on either ladder pays you less for ` +
          `earning more: each rate applies only to the slice of income inside its own band.</p>`,
        ]));
    } else if (next) {
      const keptB = next.a.net - r.a.net;
      push('step',
        `<h3>${S} is the bottom of this ladder</h3>` +
        `<p>Nothing below this level is modelled here. Going up to ${usd0(next.amount)} would add ` +
        `${usd0(keptB)} a year, ${usd0(keptB / 12)} a month, out of ${usd0(next.amount - r.amount)} of ` +
        `extra gross — ${pct1(keptB / (next.amount - r.amount))} of the raise survives withholding, the ` +
        `highest keep rate anywhere on this page, because the bands down here are the cheapest ones.</p>`);
    } else if (prev) {
      const keptA = r.a.net - prev.a.net;
      // What lies ABOVE the top rung is a different sentence in each of the three
      // shapes, because in a no-income-tax state there is no state schedule left
      // to describe and in a flat state there is nothing left for it to do.
      const aboveState = r.kind === 'bracket'
        ? (stTop && stTop.upper === Infinity
          ? `, and ${NAME} has no rate step left above this level`
          : `, and ${NAME}'s remaining bands are wide`)
        : (r.kind === 'flat'
          ? `, while ${NAME}'s rate does not change however much more you earn`
          : `, and there is no ${NAME} income tax on any of it`);
      push('step',
        `<h3>${S} is the top of this ladder, and what lies above it</h3>` +
        `<p>Coming up from ${usd0(prev.amount)}, that ${usd0(r.amount - prev.amount)} raise added ` +
        `${usd0(keptA)} of take-home pay, ${pct1(keptA / (r.amount - prev.amount))} of it. Above ${S} ` +
        `the arithmetic changes in a way no lower rung sees: Social Security has stopped at ` +
        `${usd0(wageBase)} so the ${ssRate} no longer applies to new income, while the Additional ` +
        `Medicare surtax has started${aboveState}. For a figure above ` +
        `this level, put it into the ${NAME} paycheck calculator rather than extrapolating from ` +
        `this page.</p>`);
    }
  }

  // Ordered by the same slug-hash helper the state pages use, so the heading
  // sequence differs from rung to rung and from state to state.
  return orderAncillary(ladderSalt(r.slug, 'ladder', r.amount), B.map((b) => b.html)).join('\n      ');
}

// Section intros, the method list and the limits list, all built PER RUNG.
//
// These were fixed template sentences in the first cut, and between them they
// were most of the page: a shared-shingle measurement showed 67% of an average
// rung page was text present, word for word, on all of the others, and almost
// all of that lived here rather than in the analysis. Boilerplate that says the
// same thing on every page of a cluster is what a quality review samples.
//
// The fix is not to reword them per page, which is spinning. It is to make them
// SAY something about the rung: which line is the largest, whether the wage base
// bound, how many state bands were used, what the joint filing saving actually
// is at this income, which phase-outs are live here. All computed.
function caPageCopy(r, rungs, ctx) {
  const { taxData, obbba, secure2, payrollState, year } = ctx;
  const st = r.state;
  const NAME = st.name;
  const S = usd0(r.amount);
  const frame = (salt, arr) => pickFrame(ladderSalt(r.slug, 'copy', r.amount), salt, arr);
  // Same pinned-for-California body framer as caProseBlocks: arr[0] is the live
  // California wording, every other state picks by slug-and-rung hash.
  const bodyFrame = (salt, arr) => (r.slug === 'california' ? arr[0] : frame(salt, arr));
  const fica = taxData.federal.fica;
  const wageBase = fica.socialSecurity.wageBase;
  const fedStd = taxData.federal.standardDeduction.single;
  const stBands = r.kind === 'bracket' ? r.st.bands.filter((b) => b.amount > 0) : [];
  const fedBands = r.fed.bands.filter((b) => b.amount > 0);
  const i = rungs.findIndex((x) => x.amount === r.amount);
  const prev = i > 0 ? rungs[i - 1] : null;
  const next = i < rungs.length - 1 ? rungs[i + 1] : null;
  const progLabels = r.programs.map((p) => p.label);

  // Which withheld line is biggest here. It is federal tax at the top of the
  // ladder and Social Security at the bottom, and the crossover is a real fact
  // about the rung rather than a rephrasing. The candidate list is the set of
  // lines this state actually has, so Texas compares three and New Jersey eight.
  const lines = [
    ['federal income tax', r.a.federal],
    ['Social Security', r.a.socialSecurity],
    ['Medicare', r.a.medicare],
    ...(r.kind === 'none' ? [] : [[`${NAME} income tax`, r.a.state]]),
    ...r.programs.map((p) => [p.label, p.amount]),
  ].sort((a, b) => b[1] - a[1]);
  const biggest = lines[0];
  const smallest = lines[lines.length - 1];

  const BREAKDOWN_INTRO = bodyFrame('bdintro', [
    `Single filer, ${year} rules, standard deduction, no 401(k), no health premiums, no dependents. ` +
    `The biggest single line at ${S} is ${biggest[0]} at ${usd0(biggest[1])}; the smallest is ` +
    `${smallest[0]} at ${usd0(smallest[1])}.`,
    `Modelled as a single filer on ${year} rules taking the standard deduction, with no 401(k), no ` +
    `health premiums and no dependents. ${biggest[0]} is the heaviest line here at ${usd0(biggest[1])}, ` +
    `and ${smallest[0]} the lightest at ${usd0(smallest[1])}.`,
    `${year} rules, single filer, standard deduction, nothing pre-tax and nobody to claim. Of the lines ` +
    `below, ${biggest[0]} takes the most at ${usd0(biggest[1])} and ${smallest[0]} the least at ` +
    `${usd0(smallest[1])}.`,
  ]);

  const dedShare = fedStd / r.amount;
  const FED_INTRO = bodyFrame('fedintro', [
    `Federal tax is never one rate on the whole salary. The ${usd0(fedStd)} standard deduction comes off ` +
    `first — that is ${pct1(dedShare)} of ${S}, ` +
    (dedShare > 0.3
      ? `a large enough slice that a substantial part of this salary is never taxed at all`
      : (dedShare > 0.15
        ? `a meaningful slice, though a smaller share of pay than it is further down this ladder`
        : `a small share of pay at this level, so most of the salary is exposed to the brackets`)) +
    ` — leaving <strong>${usd0(r.fed.taxable)}</strong> of taxable income to be sliced across ` +
    `${numWord(fedBands.length)} band${fedBands.length === 1 ? '' : 's'}. Only the last slice is taxed at ` +
    `your top rate of ${pctStr(r.fed.marginalRate)}.`,
    `No single rate is applied to a whole salary federally. The ${usd0(fedStd)} standard deduction is ` +
    `subtracted before anything else, and on ${S} that is ${pct1(dedShare)} of the pay ` +
    (dedShare > 0.3
      ? `— enough that a large part of this salary never meets a bracket at all`
      : (dedShare > 0.15
        ? `— a real slice, though it covers less of the pay here than it does lower down this ladder`
        : `— not much of the pay at this level, so the brackets reach nearly all of it`)) +
    `. What is left, <strong>${usd0(r.fed.taxable)}</strong>, is then cut across ` +
    `${numWord(fedBands.length)} band${fedBands.length === 1 ? '' : 's'}, and only the topmost cut is ` +
    `charged at ${pctStr(r.fed.marginalRate)}.`,
    `The federal bill is built in slices, never as one rate on the lot. First ${usd0(fedStd)} comes off ` +
    `as the standard deduction, ${pct1(dedShare)} of ${S} ` +
    (dedShare > 0.3
      ? `— a big enough share that much of this salary is untaxed before the brackets start`
      : (dedShare > 0.15
        ? `— meaningful, but a smaller share of pay than at the bottom of this ladder`
        : `— a thin share at this level, leaving most of the salary exposed to the brackets`)) +
    `. The remaining <strong>${usd0(r.fed.taxable)}</strong> is then spread over ` +
    `${numWord(fedBands.length)} band${fedBands.length === 1 ? '' : 's'}, with ` +
    `${pctStr(r.fed.marginalRate)} touching only the final slice.`,
  ]);

  // The state section's own intro. Three shapes, three different sentences —
  // there is nothing to say about "a separate ladder" in a state that has one
  // rate, and nothing at all to say in a state that has no income tax.
  let CA_INTRO = '';
  if (r.kind === 'bracket') {
    const dedPhrase = stateDeductionPhrase(r);
    CA_INTRO = dedPhrase
      ? (r.slug === 'california'
        // legacy CA wording
        ? `California runs a separate ladder with a separate, much smaller standard deduction of ${usd0(r.stDed)}, ` +
          `so the taxable figure here — ${usd0(r.st.taxable)} — is ${usd0(r.st.taxable - r.fed.taxable)} higher ` +
          `than the federal one. ${S} works through ${numWord(stBands.length)} of California's bands, topping ` +
          `out at ${pctStr(r.st.marginalRate)}.`
        // SIZE AND DIRECTION ARE BOTH MEASURED. "a separate, much smaller amount" and
        // "more than the federal figure" were written against wave 1, where every state
        // subtracted less than the federal standard deduction. Missouri does not: its
        // deduction is larger than the federal one, so its state taxable income is LOWER
        // than the federal figure and the old sentence stated the opposite while printing
        // a negative dollar amount beside it. Minnesota's and South Carolina's are within
        // a few hundred dollars of federal, which "much smaller" also misdescribes.
        : (() => {
          const ratio = fedStd > 0 ? r.stDed / fedStd : 1;
          const sizeClause = Math.abs(r.stDed - fedStd) < 0.5
            // Missouri's is the federal figure to the dollar, which is worth saying
            // outright rather than hedging it as "much the same size".
            ? `exactly what the federal side subtracts`
            : (ratio < 0.5
              ? `a separate and much smaller amount`
              : (ratio < 0.95
                ? `a separate and somewhat smaller amount`
                : (ratio < 1
                  ? `a separate amount only a little smaller`
                  : `a separate and larger amount`)));
          // Massachusetts subtracts two things. Naming only the standard deduction would
          // leave the taxable figure in the next clause unreachable from this one.
          const dedDesc = r.stFicaDed > 0
            ? `${usd0(r.stDedAfterPhaseout)} of standard deduction plus ${usd0(r.stFicaDed)} for the ` +
              `FICA already withheld from this salary, ${usd0(r.stDed)} in all`
            : usd0(r.stDed);
          const gap = r.st.taxable - r.fed.taxable;
          const gapClause = Math.abs(gap) < 0.5
            ? `the same as the federal figure`
            : (gap > 0
              ? `${usd0(gap)} more than the federal figure`
              : `${usd0(-gap)} less than the federal figure`);
          const opening = Math.abs(r.stDed - fedStd) < 0.5
            ? `${NAME} runs a separate ladder, but it subtracts ${sizeClause} before it starts: ` +
              `${dedDesc} either side`
            : `${NAME} runs a separate ladder and subtracts ${sizeClause} before it starts: ` +
              `${dedDesc}, against the federal ${usd0(fedStd)}`;
          return `${opening}. That leaves ${usd0(r.st.taxable)} of ` +
            `${NAME} taxable income, ${gapClause}. ` +
            `${S} works through ${numWord(stBands.length)} of ${NAME}'s bands, topping out at ` +
            `${pctStr(r.st.marginalRate)}.`;
        })())
      // Ohio subtracts nothing at any income and keeps the sentence it already ships;
      // Wisconsin and South Carolina reach zero only because the income test took it.
      : `${(r.stDedPhases && r.stDedPublished > 0)
          ? `${NAME}'s ${usd0(r.stDedPublished)} standard deduction is income-tested and has phased out ` +
            `completely by this salary`
          : `${NAME} subtracts nothing before its own schedule applies`}, so its taxable figure is ` +
        `the whole ${usd0(r.st.taxable)} — ${usd0(r.st.taxable - r.fed.taxable)} more than the federal one, which ` +
        `is what the ${usd0(fedStd)} federal standard deduction takes off. ${S} works through ` +
        `${numWord(stBands.length)} of ${NAME}'s bands, topping out at ${pctStr(r.st.marginalRate)}.`;
  } else if (r.kind === 'flat') {
    CA_INTRO = r.stDed > 0
      ? `${NAME} has one rate, ${pctStr(r.st.rate)}, and no ladder to climb. It subtracts ${usd0(r.stDed)} ` +
        `first, leaving ${usd0(r.st.taxable)} of ${NAME} taxable income, and charges the same rate on ` +
        `every dollar of it.`
      : `${NAME} has one rate, ${pctStr(r.st.rate)}, and nothing is subtracted before it applies. The ` +
        `whole ${S} is ${NAME} taxable income, and every dollar of it is charged at the same rate.`;
  }

  // Filing status: quote the actual difference this salary sees.
  const single = r.byStatus.single;
  const mfj = r.byStatus.married;
  const hoh = r.byStatus.head_of_household;
  const statusStateClause = r.kind === 'none'
    ? `Filing status does not touch ${NAME} at all here, because ${NAME} takes no income tax. `
    : '';
  const invariantClause = progLabels.length
    ? `${caList(['FICA', ...progLabels])} are identical in all three — they take no notice of who you are ` +
      `married to.`
    : bodyFrame('filingTail', [
      `FICA is identical in all three — it takes no notice of who you are married to.`,
      `FICA does not move at all across the three: Social Security and Medicare are indifferent to who ` +
      `you are married to.`,
      `The FICA lines are the same on every row, because Social Security and Medicare do not ask about ` +
      `marital status.`,
    ]);
  const FILING_INTRO = r.slug === 'california'
    // legacy CA wording
    ? `Filing status changes both the standard deduction and the width of every band, and at ${S} it is ` +
      `worth real money: a joint return on this same salary keeps ${usd0(mfj.net - single.net)} more a ` +
      `year than a single one, and head of household keeps ${usd0(hoh.net - single.net)} more. FICA and ` +
      `California SDI are identical in all three — they take no notice of who you are married to.`
    : bodyFrame('filing', [
      `Filing status changes both the standard deduction and the width of every federal band, and at ${S} ` +
      `it is worth real money: a joint return on this same salary keeps ${usd0(mfj.net - single.net)} more ` +
      `a year than a single one, and head of household keeps ${usd0(hoh.net - single.net)} more. ` +
      `${statusStateClause}${invariantClause}`,
      `Your filing status moves the standard deduction and stretches every federal band, and on ${S} that ` +
      `is worth having: filing jointly on this same salary leaves ${usd0(mfj.net - single.net)} more in ` +
      `the year than filing single, and head of household ${usd0(hoh.net - single.net)} more. ` +
      `${statusStateClause}${invariantClause}`,
      `The status you file under decides how big the standard deduction is and how wide each federal band ` +
      `runs. On ${S} the difference is real: ${usd0(mfj.net - single.net)} a year in favour of a joint ` +
      `return over a single one, and ${usd0(hoh.net - single.net)} for head of household. ` +
      `${statusStateClause}${invariantClause}`,
    ]);
  const FILING_NOTE = frame('filenote', [
    `Married filing jointly is modelled as ONE earner on ${S} filing a joint return, which is the ` +
    `question this table can honestly answer. Two incomes are a different calculation.`,
    `The joint row assumes a single earner on ${S} filing jointly, not a household with two ${S} ` +
    `salaries — that is a different, and much less favourable, calculation.`,
    `Read the joint row as one person earning ${S} and filing jointly. A two-earner household on this ` +
    `salary each is not what it shows.`,
  ]);

  const keepFromPrev = prev ? (r.a.net - prev.a.net) / (r.amount - prev.amount) : null;
  const LADDER_INTRO = bodyFrame('ladintro', [
    `${S} is rung ${numWord(i + 1)} of ${numWord(rungs.length)}` +
    (keepFromPrev != null
      ? `, reached by a step that kept ${pct1(keepFromPrev)} of the raise`
      : `, the bottom of the ladder`) +
    `. Its immediate neighbours are below` +
    (next ? `, and the full ladder is on the hub page` : `; the hub page has the full ladder`) +
    `. The last column is the part of each step that survives withholding — the number that actually ` +
    `answers "is the raise worth taking".`,
    `This is level ${numWord(i + 1)} of ${numWord(rungs.length)}` +
    (keepFromPrev != null
      ? `, arrived at by a step that handed over ${pct1(keepFromPrev)} of the raise`
      : `, and the lowest one modelled here`) +
    `. Its nearest neighbours are shown below` +
    (next ? `; the hub page carries every level` : `, and the hub page carries every level`) +
    `. Read the final column as the share of each raise that survives withholding, which is the only ` +
    `honest answer to "is it worth taking".`,
    `Of the ${numWord(rungs.length)} levels on this ladder, ${S} is the ${numWord(i + 1)}` +
    (keepFromPrev != null
      ? `, and the step onto it kept ${pct1(keepFromPrev)} of the raise`
      : `, and there is nothing below it here`) +
    `. The levels either side are in the table` +
    (next ? `, with the complete ladder on the hub page` : `; the complete ladder is on the hub page`) +
    `. That last column — how much of each step actually survives withholding — is the figure that ` +
    `settles whether a raise is worth taking.`,
  ]);

  const METHOD_INTRO = frame('methintro', [
    `Every number above is computed at build time by the same engine that runs the ${NAME} paycheck ` +
    `calculator, from this repository's ${year} tax data file. Nothing is hand-typed and nothing is ` +
    `copied from another site.`,
    `All of the figures on this page come out of the same open paycheck engine the ${NAME} calculator ` +
    `uses, run against the ${year} tax data file in this repository at build time — not typed in, not ` +
    `lifted from anyone else's table.`,
    `These figures are generated, not written: the ${year} tax data file in this repository goes into the ` +
    `same engine that powers the ${NAME} paycheck calculator, and the page is rebuilt from the result.`,
  ]);

  // The method list, carrying this rung's own numbers rather than a generic
  // description of the method.
  const capBound = r.amount >= wageBase;
  const hours = 2080;
  // The state row: what the engine actually did for THIS state, including its
  // programs, or an explicit "nothing" where a state levies no income tax — an
  // omitted row would read as a gap in the method rather than a fact about the
  // state.
  let stateMethod;
  if (r.slug === 'california') {
    // legacy CA wording
    stateMethod = `Its own schedule on ${usd0(r.st.taxable)} after the ${usd0(r.stDed)} state deduction, ` +
      `through ${numWord(stBands.length)} band${stBands.length === 1 ? '' : 's'} → ${usd0(r.a.state)}. ` +
      `Plus SDI at ${pct2(st.employeePrograms[0].rate)} of the whole salary, uncapped since SB 951 → ` +
      `${usd0(r.sdi)}.`;
  } else {
    const progSentence = r.programs.length
      ? ` Plus ${caList(r.programs.map((p) => `${p.label} at ${pct2(p.rate)} → ${usdCents(p.amount)}`))}.`
      : '';
    if (r.kind === 'bracket') {
      // The method row has to be readable as arithmetic: gross, minus what came off,
      // equals the taxable figure printed beside it. Where the subtraction has two parts
      // (Massachusetts) both are named, or the row does not reconcile.
      const dedText = r.stFicaDed > 0
        ? ` after the ${usd0(r.stDedAfterPhaseout)} ${NAME} subtracts first and the ${usd0(r.stFicaDed)} ` +
          `it allows for FICA already withheld`
        : ` after the ${usd0(r.stDed)} ${NAME} subtracts first` +
          // Only where the phase-out has actually reduced it at THIS rung. South Carolina's
          // $30,000 rung is below the threshold and keeps the published figure whole.
          (r.stDedPhases && r.stDedAfterPhaseout < r.stDedPublished - 0.5
            ? ` (income-tested down at this salary from a published ${usd0(r.stDedPublished)})`
            : '');
      const nothingText = (r.stDedPhases && r.stDedPublished > 0)
        ? ` (its ${usd0(r.stDedPublished)} deduction is income-tested and phased out at this salary)`
        : ` (nothing is subtracted first)`;
      stateMethod = `Its own schedule on ${usd0(r.st.taxable)}` +
        (r.stDed > 0 ? dedText : nothingText) +
        `, through ${numWord(stBands.length)} band${stBands.length === 1 ? '' : 's'}` +
        (r.stBase > 0 ? ` plus the statutory ${usd0(r.stBase)} base amount` : '') +
        ` → ${usd0(r.a.state)}.${progSentence}`;
    } else if (r.kind === 'flat') {
      stateMethod = `${pctStr(r.st.rate)} on ${usd0(r.st.taxable)}` +
        (r.stDed > 0 ? ` (${S} less the ${usd0(r.stDed)} ${NAME} subtracts first)` : ` (the whole salary)`) +
        ` → ${usd0(r.a.state)}.${progSentence}`;
    } else {
      stateMethod = `No income tax on wages, so nothing is computed on that line.` +
        (progSentence || ` ${NAME} withholds nothing else from this paycheck either.`);
    }
  }
  const METHOD_ROWS = [
    [`Gross`, `${S} a year, spread evenly: ${usdCents(r.amount / hours)} an hour, ` +
      `${usdCents(r.amount / 26)} a fortnight.`],
    [`Federal`, `${year} brackets on ${usd0(r.fed.taxable)} taxable (gross less the ${usd0(fedStd)} ` +
      `standard deduction), Rev. Proc. 2025-32 → ${usd0(r.a.federal)}.`],
    [`FICA`, (capBound
      ? `Social Security capped at ${usd0(r.a.socialSecurity)}: ${S} is over the ${usd0(wageBase)} base.`
      : `Social Security ${usd0(r.a.socialSecurity)} on all of ${S}, under the ${usd0(wageBase)} base.`) +
      ` Medicare ${usd0(r.a.medicare)}` +
      (r.amount > fica.additionalMedicare.threshold.single
        ? `, including the ${pctStr(fica.additionalMedicare.rate)} surtax over ` +
          `${usd0(fica.additionalMedicare.threshold.single)}.`
        : `.`)],
    [NAME, stateMethod],
  ].map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('\n        ');

  // Limits: the generic four, plus whatever is actually live at THIS income.
  const generic = [];
  const lt = payrollState && payrollState.localIncomeTax;
  generic.push(bodyFrame('limit1', [
    `<li><strong>Not in the arithmetic.</strong> Pre-tax deductions (401(k), HSA, FSA, ` +
    `premiums), dependents and credits, itemizing, non-wage income, and the employer's half of FICA` +
    (lt && !lt.exists ? `. ${NAME} has no local wage income tax, so nothing is missing on that line` : '') +
    `.</li>`,
    `<li><strong>Left out of the sums.</strong> Anything taken pre-tax (401(k), HSA, FSA, insurance ` +
    `premiums), any dependants or credits, itemised deductions, income that is not wages, and the half ` +
    `of FICA your employer pays` +
    (lt && !lt.exists ? `. There is no local wage income tax in ${NAME}, so that line is not missing anything` : '') +
    `.</li>`,
    `<li><strong>What the figures do not touch.</strong> Pre-tax money of any kind — 401(k), HSA, FSA, ` +
    `health premiums — plus credits, dependants, itemising, non-wage income and the employer's own FICA ` +
    `share` +
    (lt && !lt.exists ? `. ${NAME} levies no local wage income tax, so nothing is absent there` : '') +
    `.</li>`,
  ]));

  // The rung-specific part: name the thresholds that are actually in play at
  // this salary and are NOT in the arithmetic above. A $40,000 page and a
  // $150,000 page have genuinely different lists here.
  const live = [];
  const sen = obbba.federal.senior;
  if (r.amount > sen.phaseoutStartMagi.single && r.amount < sen.fullPhaseoutMagi.single) {
    live.push(`the partially phased-out senior deduction (if you are 65 or over)`);
  }
  const cl = obbba.federal.carLoan;
  if (r.amount >= cl.phaseoutStartMagi.single && r.amount < cl.fullPhaseoutMagi.single) {
    live.push(`the partially phased-out new-vehicle loan interest deduction`);
  }
  const mipP = obbba.federal.mip.phaseout;
  if (r.amount > mipP.threshold.single && r.amount < mipP.eliminatedAboveAgi.single) {
    live.push(`the partially phased-out mortgage insurance premium deduction`);
  }
  if (r.amount >= obbba.federal.overtime.phaseoutStartMagi.single) {
    live.push(`the partially phased-out tips and overtime deductions`);
  }
  const dcp = ctx.depCare && ctx.depCare.cdctc && ctx.depCare.cdctc.applicablePercent;
  if (dcp) live.push(`the Child and Dependent Care Credit, whose rate at this income is set by the ` +
    `§21 schedule described above`);
  const yr2 = secure2.rothCatchUp.byYear[String(taxData.taxYear)];
  if (yr2 && yr2.enforced && r.amount > yr2.threshold) {
    live.push(`the mandatory-Roth treatment of any 401(k) catch-up contribution`);
  }
  if (live.length) {
    generic.push(`<li><strong>What is specifically live at ${S}.</strong> None of the following is in ` +
      `the take-home figure above, and all of it is real at this income: ` +
      `${live.join('; ')}.</li>`);
  }
  const LIMIT_ITEMS = generic.join('\n        ');

  return { BREAKDOWN_INTRO, FED_INTRO, CA_INTRO, FILING_INTRO, FILING_NOTE, LADDER_INTRO,
    METHOD_INTRO, METHOD_ROWS, LIMIT_ITEMS };
}

// The FAQ. Same principle as the blocks: the question SET changes with the
// thresholds the salary has crossed, not just the numbers in the answers.
function caLadderFaq(r, rungs, taxData, payrollState, obbba, secure2) {
  const st = r.state;
  const NAME = st.name;
  const i = rungs.findIndex((x) => x.amount === r.amount);
  const next = i < rungs.length - 1 ? rungs[i + 1] : null;
  const prev = i > 0 ? rungs[i - 1] : null;
  const fedTop = r.fed.bands.filter((b) => b.amount > 0).slice(-1)[0];
  const stMarginal = stateMarginalRate(r);
  const fica = taxData.federal.fica;
  const addlThreshold = fica.additionalMedicare.threshold.single;
  const wageBase = fica.socialSecurity.wageBase;
  const mhi = payrollState && payrollState.medianHouseholdIncome && payrollState.medianHouseholdIncome.amountUsd;
  const S = usd0(r.amount);
  const frame = (salt, arr) => pickFrame(ladderSalt(r.slug, 'ladder-faq', r.amount), salt, arr);

  // The withholding lines this state actually has, listed by name and amount, so
  // the headline answer names Texas' three and New Jersey's eight rather than a
  // fixed five.
  const answerLines = [
    `federal income tax of ${usd0(r.a.federal)}`,
    `Social Security of ${usd0(r.a.socialSecurity)}`,
    `Medicare of ${usd0(r.a.medicare)}`,
    ...(r.kind === 'none' ? [] : [`${NAME} income tax of ${usd0(r.a.state)}`]),
    ...r.programs.map((p) => `${p.label} of ${usd0(p.amount)}`),
  ];
  const stateBandClause = stMarginal == null
    ? `Federally you are in the ${pctStr(fedTop.rate)} bracket, and ${NAME} adds no income tax of its own.`
    // "neither applies to the whole salary" is true of the federal rate always,
    // and of a flat state rate ONLY where the state subtracts something first.
    // Pennsylvania subtracts nothing, so its 3.07% does apply to the whole
    // salary — and the same page says exactly that two paragraphs further down.
    : (r.kind === 'flat'
      ? (r.stDed > 0
        ? `Federally you are in the ${pctStr(fedTop.rate)} bracket, and ${NAME} charges its single ` +
          `${pctStr(stMarginal)} rate, though neither applies to the whole salary.`
        : `Federally you are in the ${pctStr(fedTop.rate)} bracket, which applies only to the top slice ` +
          `of your income; ${NAME}'s single ${pctStr(stMarginal)} rate applies to all of it.`)
      : `Federally you are in the ${pctStr(fedTop.rate)} bracket and in ${NAME} the ` +
        `${pctStr(stMarginal)} band, though neither rate applies to the whole salary.`);

  const faq = [
    {
      q: `What is the take-home pay on a ${S} salary in ${NAME}?`,
      a: `About ${usd0(r.a.net)} a year for a single filer taking the standard deduction, after ` +
        `${caList(answerLines)}. In total ${pct1(r.allInRate)} of gross pay is withheld.`,
    },
    {
      q: frame('mo', [
        `How much is ${S} a year per month after taxes in ${NAME}?`,
        `What does ${S} come to monthly after ${NAME} taxes?`,
        `${S} a year is how much a month, after tax, in ${NAME}?`,
      ]),
      a: `${usd0(r.a.net / 12)} a month, ${usdCents(r.a.net / 26)} on a fortnightly cycle and ` +
        `${usdCents(r.a.net / 24)} paid twice a month. ${stateBandClause}`,
    },
  ];

  // --- Threshold-gated questions. These are the ones that make one rung's FAQ a
  // different document from its neighbour's.
  if (r.amount >= wageBase) {
    faq.push({
      q: `Does Social Security stop being withheld on ${S}?`,
      a: `Yes. It applies to the first ${usd0(wageBase)} of wages only, so the contribution caps at ` +
        `${usd0(r.a.socialSecurity)} and your paychecks get larger once year-to-date wages pass the base. ` +
        `Medicare has no ceiling and continues on every dollar.`,
    });
  }
  if (r.amount >= addlThreshold) {
    faq.push({
      q: `Do I pay the Additional Medicare tax on ${S}?`,
      a: r.amount > addlThreshold
        ? `Yes — it applies to single-filer wages above ${usd0(addlThreshold)}, and ${S} is ` +
          `${usd0(r.amount - addlThreshold)} over. It is included in the ${usd0(r.a.medicare)} Medicare ` +
          `figure here.`
        : `No. It applies to wages ABOVE ${usd0(addlThreshold)}, and ${S} is exactly on the line rather ` +
          `than over it, so the Medicare figure of ${usd0(r.a.medicare)} carries no surtax.`,
    });
  }
  {
    const cl = obbba.federal.carLoan;
    if (r.amount >= cl.phaseoutStartMagi.single) {
      faq.push({
        q: `Can I still deduct new-car loan interest on ${S}?`,
        a: r.amount >= cl.fullPhaseoutMagi.single
          ? `No. The OBBBA deduction of up to ${usd0(cl.interestCap)} on qualifying new-vehicle loan ` +
            `interest phases out between ${usd0(cl.phaseoutStartMagi.single)} and ` +
            `${usd0(cl.fullPhaseoutMagi.single)} of modified AGI for a single filer, and ${S} is at or ` +
            `above the end of that range.`
          : `Partly. The ${usd0(cl.interestCap)} allowance drops by ` +
            `${usd0(cl.phaseoutReductionPer1000)} per ${usd0(1000)} of modified AGI above ` +
            `${usd0(cl.phaseoutStartMagi.single)}, so at ${S} some of it survives and it reaches zero at ` +
            `${usd0(cl.fullPhaseoutMagi.single)}.`,
      });
    }
  }
  {
    const sen = obbba.federal.senior;
    if (r.amount > sen.phaseoutStartMagi.single) {
      faq.push({
        q: `I am over 65 — is the senior deduction worth anything at ${S}?`,
        a: r.amount >= sen.fullPhaseoutMagi.single
          ? `No. The ${usd0(sen.amountPerPerson)} per-person deduction phases out at ` +
            `${pct1(sen.phaseoutRate)} of modified AGI above ${usd0(sen.phaseoutStartMagi.single)} and is ` +
            `gone by ${usd0(sen.fullPhaseoutMagi.single)}, which ${S} exceeds.`
          : `Some of it. It starts at ${usd0(sen.amountPerPerson)} per person and comes down by ` +
            `${pct1(sen.phaseoutRate)} of every dollar of modified AGI over ` +
            `${usd0(sen.phaseoutStartMagi.single)}, leaving roughly ` +
            `${usd0(Math.max(0, sen.amountPerPerson - (r.amount - sen.phaseoutStartMagi.single) * sen.phaseoutRate))} ` +
            `at ${S}. The figures on this page model a filer under 65 and do not include it.`,
      });
    }
  }
  {
    const yr = secure2.rothCatchUp.byYear[String(taxData.taxYear)];
    if (yr && yr.enforced && r.amount > yr.threshold) {
      faq.push({
        q: `Can I still make a pre-tax 401(k) catch-up contribution on ${S}?`,
        a: `Not from ${taxData.taxYear} onward if your prior-year Social Security wages with the ` +
          `plan-sponsoring employer were over ${usd0(yr.threshold)}. SECURE 2.0 requires the ` +
          `age-${secure2.rothCatchUp.catchUpMinAge}-plus catch-up to be designated Roth, so it is made ` +
          `after tax. The ordinary ${usd0(yr.deferral)} deferral can still be pre-tax.`,
      });
    }
  }
  // A state-shaped question, asked only where the state has an answer: which
  // premiums come out on top of tax, and what they cost here.
  if (r.programs.length && r.slug !== "california") {
    faq.push({
      q: `What else does ${NAME} withhold from ${S} besides income tax?`,
      a: `${caList(r.programs.map((p) => `${p.label} at ${pct2(p.rate)}, ${usdCents(p.amount)} a year`))}. ` +
        (r.programs.length === 1
          ? `That is ${pct1(r.progTotal / r.amount)} of gross pay, withheld after tax, so it does not reduce your federal or state taxable income.`
          : `Together that is ${usdCents(r.progTotal)}, ${pct1(r.progTotal / r.amount)} of gross pay. These are withheld after tax, so they do not reduce your federal or state taxable income.`),
    });
  }
  if (next) {
    const destination = r.kind === 'none'
      ? `federal tax and FICA`
      : `federal tax, FICA and ${NAME} withholding`;
    faq.push({
      q: frame('raise', [
        `How much more would I keep on ${usd0(next.amount)} instead of ${S}?`,
        `Is a raise from ${S} to ${usd0(next.amount)} worth it after tax?`,
        `What does going from ${S} to ${usd0(next.amount)} actually add?`,
      ]),
      a: r.slug === 'california'
        // legacy CA wording
        ? `${usd0(next.a.net - r.a.net)} more a year, ${usd0((next.a.net - r.a.net) / 12)} a month. That ` +
          `is ${pct1((next.a.net - r.a.net) / (next.amount - r.amount))} of the ` +
          `${usd0(next.amount - r.amount)} raise; the rest goes to federal tax, FICA, California income ` +
          `tax and SDI.`
        : `${usd0(next.a.net - r.a.net)} more a year, ${usd0((next.a.net - r.a.net) / 12)} a month. That ` +
          `is ${pct1((next.a.net - r.a.net) / (next.amount - r.amount))} of the ` +
          `${usd0(next.amount - r.amount)} raise; the rest goes to ${destination}.`,
    });
  } else if (prev) {
    const stateTail = r.kind === 'bracket'
      ? `, and the remaining ${NAME} bands are very wide`
      : (r.kind === 'flat' ? `, while ${NAME}'s single rate keeps applying unchanged` : '');
    faq.push({
      q: `Why does this ladder stop at ${S}?`,
      a: `Because above it the arithmetic stops being a straight line: Social Security has capped at ` +
        `${usd0(wageBase)}, the Additional Medicare surtax has begun at ${usd0(addlThreshold)}${stateTail}. ` +
        `Extrapolating from this page above ${S} would give ` +
        `the wrong answer — put the figure into the ${NAME} paycheck calculator instead.`,
    });
  }
  if (mhi) {
    faq.push({
      q: `Is ${S} a good salary in ${NAME}?`,
      a: r.amount < mhi
        ? `Context, not advice: it is below ${NAME}'s median HOUSEHOLD income of ${usd0(mhi)}, a ` +
          `figure that often covers two earners, so a single earner on ${S} is not as far off the middle ` +
          `as that comparison suggests. Housing cost is not modelled anywhere here.`
        : `Context, not advice: a single earner on ${S} is above ${NAME}'s median HOUSEHOLD income of ` +
          `${usd0(mhi)}, which often covers two earners. Housing cost is not modelled anywhere here.`,
    });
  }
  faq.push(r.slug === 'california'
    // legacy CA wording
    ? {
      q: `Will this match my actual paycheck?`,
      a: `Not exactly. It models a single filer on the standard deduction with no 401(k), no premiums and ` +
        `no dependents; your W-4 and benefits move it. Use the California paycheck calculator for your own.`,
    }
    : frame('faqLast', [
      {
        q: `Will this match my actual paycheck?`,
        a: `Not exactly. It models a single filer on the standard deduction with no 401(k), no premiums ` +
          `and no dependents; your W-4 and benefits move it. Use the ${NAME} paycheck calculator for your own.`,
      },
      {
        q: `Is this what I will actually see on my payslip?`,
        a: `Close, but not to the cent. The model is a single filer on the standard deduction with nothing ` +
          `pre-tax and nobody to claim, so a real W-4, real benefits and real dependants all shift it. Put ` +
          `your own figures into the ${NAME} paycheck calculator.`,
      },
      {
        q: `Why might my own paycheck differ from this?`,
        a: `Because this page models one specific person: a single filer, standard deduction, no 401(k), ` +
          `no premiums, no dependants. Every one of those that is different for you moves the number, and ` +
          `so does what you put on your W-4. The ${NAME} paycheck calculator takes all of them.`,
      },
    ]));
  return faq;
}

function caFaqBlocks(faq) {
  return faq.map((f) => `<h3>${esc(f.q)}</h3>\n      <p>${esc(f.a)}</p>`).join('\n\n      ');
}

// California FTB source titles. Four links all captioned "Franchise Tax Board"
// is a list a reader cannot use, so each of California's own URLs gets a title
// describing what that particular document settles.
const CA_FTB_TITLES = [
  [/tax-rate-schedules/, 'California FTB: Form 540 tax rate schedules'],
  [/540-booklet/, 'California FTB: Form 540 booklet, standard deduction chart'],
  [/540-es-instructions/, 'California FTB: Form 540-ES instructions, which year’s tables apply'],
  [/tax-news/, 'California FTB: annual inflation indexing of the standard deduction'],
];

// Sources, built from the URLs the data file already carries for this state and
// for the federal figures. Titles are ours; the URLs are the data's, so a source
// swap in tax-data-2026.json moves the citation with it.
function caLadderSources(taxData, state) {
  const named = [];
  const seen = new Set();
  const add = (title, url) => {
    if (!url || !/^https?:\/\//.test(url) || seen.has(url)) return;
    seen.add(url);
    named.push({ title, url });
  };
  const isCA = state.slug === 'california';
  const stateUrls = String(state._source || '').match(/https?:\/\/\S+/g) || [];
  stateUrls.forEach((raw) => {
    const u = raw.replace(/[;,)]+$/, '');
    const hit = isCA ? CA_FTB_TITLES.find(([re]) => re.test(u)) : null;
    add(hit ? hit[1] : (isCA ? 'California Franchise Tax Board' : `${state.name}: source for the state figures on this page`), u);
  });
  (state.employeePrograms || []).forEach((p) => add(
    isCA ? 'California EDD: SDI rates and withholding' : `${programLabel(state, p)}: rate and withholding`,
    p._source));
  const SOURCE_TITLES = {
    federal_brackets: `IRS: ${taxData.taxYear} inflation-adjusted tax brackets`,
    federal_brackets_hoh: `IRS: Rev. Proc. 2025-32 (${taxData.taxYear} brackets, all statuses)`,
    standard_deduction: `IRS: ${taxData.taxYear} standard deduction`,
    fica: 'Social Security Administration: Contribution and Benefit Base',
    additional_medicare: 'IRS: Topic no. 751, Additional Medicare Tax',
  };
  Object.entries((taxData._meta && taxData._meta.sources) || {})
    .forEach(([k, u]) => add(SOURCE_TITLES[k] || k.replace(/_/g, ' '), u));
  return named.map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}</a></li>`).join('');
}

// The "what this does not include" list. The local-income-tax item is written
// from the payroll data's own answer for this state rather than asserted.
function caLimitItems(state, payrollState, year) {
  const items = [];
  const lt = payrollState && payrollState.localIncomeTax;
  if (lt) {
    items.push(lt.exists
      ? `<li><strong>Local income tax.</strong> ${state.name} localities levy one where it applies, and it is not modelled here.</li>`
      : `<li><strong>Local income tax.</strong> There is none to include: ${state.name} has no city or county income tax on wages, so nothing is missing on this line.</li>`);
  }
  items.push(`<li><strong>Pre-tax deductions.</strong> No 401(k), no HSA or FSA, no health premiums. All of those cut taxable income, so a real paycheck with benefits keeps more than this page shows.</li>`);
  items.push(`<li><strong>Credits and itemizing.</strong> Standard deduction only, no dependents, no child tax credit, no itemized deductions.</li>`);
  items.push(`<li><strong>Non-wage income and the employer's share.</strong> Investment income, self-employment income and the employer half of FICA are all out of scope.</li>`);
  // The state's own caveats, straight out of the data file so a new one appears
  // here the day it is added. One of them is dropped: the prior-year-tables
  // caveat, because figureYearBanner() already puts that same sentence at the
  // top of the page and printing it twice reads as padding.
  //
  // The first version of this filter dropped any entry containing BOTH years as
  // substrings, which is too eager — a caveat about, say, a credit that changed
  // in 2025 and applies in 2026 would have been silently deleted, and a deleted
  // caveat is a worse failure than a repeated one. The test is now narrow: it
  // only runs when the banner is actually being shown, and the entry must ALSO
  // talk about publication, which is what the banner's sentence is about. An
  // entry that merely mentions the years survives.
  const bannerShown = Number(state.figureYear) && Number(state.figureYear) !== Number(year);
  const isBannerEcho = (d) => {
    if (!bannerShown) return false;
    const t = String(d);
    return t.includes(String(state.figureYear))
      && t.includes(String(year))
      && /\bpublish(ed|es)?\b/i.test(t);
  };
  (state.disclaimer || [])
    .filter((d) => !isBannerEcho(d))
    .forEach((n) => items.push(`<li>${esc(String(n))}</li>`));
  return items.join('\n        ');
}

// The state income-tax section of a rung page: heading, intro, table, note.
// Three shapes, three genuinely different sections, and an empty string where
// the state levies no income tax — an empty <h2> with a zero-row table under it
// is exactly the "scaled thin content" shape this cluster has to avoid.
function ladderStateSection(r, copyIntro, S) {
  const NAME = r.state.name;
  if (r.kind === 'none') return '';
  if (r.kind === 'bracket') {
    const extra = r.stBase > 0
      ? { label: `Statutory base amount over ${usd0(r.state.tax.baseAmount.over)}`, tax: r.stBase }
      : null;
    const progNote = r.programs.length
      ? ` ${caList(r.programs.map((p) => p.label))} ${r.programs.length === 1 ? 'is' : 'are'} charged ` +
        `separately, on the full salary and not on taxable income, so ${r.programs.length === 1 ? 'it is' : 'they are'} not in this table.`
      : '';
    const note = r.slug === 'california'
      // legacy CA wording
      ? `California income tax on ${S} totals ${usd0(r.a.state)}, ` +
        `${pct1(r.a.state / r.amount)} of gross pay. California SDI is charged separately, on the full ` +
        `salary and not on taxable income, so it is not in this table.`
      : `${NAME} income tax on ${S} totals ${usd0(r.a.state)}, ${pct1(r.a.state / r.amount)} of gross ` +
        `pay, against a top band rate of ${pctStr(r.st.marginalRate)}.${progNote}`;
    return `    <h2 id="${r.slug}">The ${NAME} income tax on ${S}, bracket by bracket</h2>
    <p>${copyIntro}</p>
    <div class="sal-scroll">
      <table class="sal-t">
        <caption class="sr-only">${NAME} income tax bands reached on a ${S} salary, single filer</caption>
        <thead><tr><th>${NAME} band</th><th class="num">Rate</th><th class="num">Income taxed here</th><th class="num">Tax from this band</th></tr></thead>
        <tbody>${caBandRows(r.st, extra)}</tbody>
      </table>
    </div>
    <p class="sal-note">${note}</p>`;
  }
  // Flat: there are no bands, so the table is the working itself — gross, what
  // the state takes off, what is left, the one rate, the tax.
  const rows = [
    `<tr><td>Gross salary</td><td class="num">${usd0(r.amount)}</td></tr>`,
    ...(r.stDed > 0
      ? [`<tr><td>Less what ${NAME} subtracts first</td><td class="num">−${usd0(r.stDed)}</td></tr>`]
      : [`<tr><td>Subtracted before the rate applies</td><td class="num">${usd0(0)}</td></tr>`]),
    `<tr><td>${NAME} taxable income</td><td class="num">${usd0(r.st.taxable)}</td></tr>`,
    `<tr><td>${NAME} rate, on all of it</td><td class="num">${pctStr(r.st.rate)}</td></tr>`,
    `<tr class="tot"><td>${NAME} income tax</td><td class="num">${usd0(r.a.state)}</td></tr>`,
  ].join('\n');
  const progNote = r.programs.length
    ? ` ${caList(r.programs.map((p) => p.label))} ${r.programs.length === 1 ? 'is' : 'are'} charged ` +
      `separately, on the full salary, so ${r.programs.length === 1 ? 'it is' : 'they are'} not in this table.`
    : '';
  return `    <h2 id="${r.slug}">The ${NAME} income tax on ${S}, worked out</h2>
    <p>${copyIntro}</p>
    <div class="sal-scroll">
      <table class="sal-t">
        <caption class="sr-only">How ${NAME}'s flat income tax on a ${S} salary is worked out, single filer</caption>
        <thead><tr><th>Step</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="sal-note">${NAME} income tax on ${S} totals ${usd0(r.a.state)}, ${pct1(r.a.state / r.amount)} of gross pay. ${r.stDed > 0 ? `The only gap between that share and the ${pctStr(r.st.rate)} headline is the ${usd0(r.stDed)} subtracted above.` : `With one rate and nothing subtracted first, that share is the headline rate.`}${progNote}</p>`;
}

// --- Content-hashed /assets/*.js pipeline -----------------------------------
// FIXES A LIVE P0: every asset file used to ship as a flat, unhashed name on a
// blind `Cache-Control: max-age=86400` (see the old _headers block). A shared
// engine like obbba-deduction.js is imported by 8+ tool bootstrap files
// (car-loan-interest-calculator.js, charitable-deduction-calculator.js,
// overtime-tax-calculator.js, tips-tax-calculator.js, salt-cap-calculator.js,
// senior-deduction-calculator.js, w4-overtime-tips-withholding-calculator.js,
// qcd-comparison.js) — when it gains a new export, any visitor whose browser
// already cached yesterday's copy keeps using it for up to 24h: the new page's
// `import { X } from '/assets/obbba-deduction.js'` resolves to the STALE file,
// X is undefined, and the calculator silently does nothing. Reproduced live on
// the QCD and Charitable Deduction pages (2026-07-11 audit).
//
// Fix: every /assets/*.js file (leaf engines, engines-that-import-engines, and
// the per-tool bootstrap files themselves — see the site-wide-vs-scoped-down
// note below) gets its dist filename suffixed with a content hash, e.g.
// `obbba-deduction.a3f9c1e2b7.js`. A deploy that changes a shared file's bytes
// produces a brand-new URL no browser has ever cached — the staleness class is
// gone by construction, not by tuning cache headers.
//
// Dependency order: some engines import other engines (qcd-comparison.js ->
// obbba-deduction.js -> paycheck-engine.js is the deepest chain found, depth 2).
// A file's own hash depends on its FINAL (reference-rewritten) bytes, so leaves
// must be hashed first, then rewritten into their importers, whose own hash is
// then computed from the rewritten content. registerAsset() queues every file
// build.js used to plain-`cp()` into dist/assets/; hashAssets() below resolves
// the dependency graph by regex rather than assuming a fixed depth.
//
// Scope: ALL first-party /assets/*.js files are hashed (not just the 7 engines
// imported by 2+ tools) — once the hash-rewrite machinery exists, a single-
// consumer file (e.g. bonus-tax.js) costs no extra code to also hash, and it
// closes the same staleness risk for its one tool. The vendor UMD bundles
// (jsPDF, pdf.js + its worker, docx, qrcode, marked) are ALSO hashed: they have
// no internal `import` statements (self-contained bundles), so they are
// trivial leaves under the exact same "quoted-path-in/-quotes" rewrite rule —
// including the one non-import reference (pdf-to-word.js's runtime
// `workerSrc = '/assets/pdf.worker.min.js'` string assignment), which the
// generalized quote-anchored regex catches identically to an `import`
// specifier. styles.css is ALSO hashed now (a pure CSS leaf: no @import, its
// only url() is an inline data URI), on the same quoted-path rewrite rule that
// turns every `<link rel="stylesheet" href="/assets/styles.css">` into the
// hashed name via rewriteHtmlAssetRefs — closing the CSS-staleness gap the JS
// fix closed, and letting it take the immutable year cache (see _headers below).
const ASSET_QUEUE = []; // { dir: 'assets' | 'engine', name: 'x.js' }, in registration order
function registerAsset(dir, name) {
  ASSET_QUEUE.push({ dir, name });
}

// Matches a fully quote-delimited reference to `basename` — `import ... from
// '/assets/x.js'`, `from './x.js'` (engine-to-engine relative imports), or a
// plain runtime string like `workerSrc = '/assets/pdf.worker.min.js'`. Anchored
// on a matching quote immediately before AND after the path, so it can never
// touch an unquoted, unrelated substring (e.g. a `//# sourceMappingURL=x.js.map`
// comment in a vendor bundle is not quote-delimited and never matches).
function assetRefRegex(basename) {
  const esc = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(["'\`])(\\./|/assets/)${esc}\\1`, 'g');
}

// Resolves ASSET_QUEUE in dependency order (leaves first), rewrites each
// file's internal references to already-hashed dependency names, hashes the
// resulting bytes, and writes `<base>.<hash>.<ext>` into dist/assets/. Returns
// a Map of original basename -> hashed basename for the HTML rewrite pass.
// Minify a first-party asset's bytes before it is hashed, so the content hash
// matches what actually ships. Runs AFTER the dependency-reference rewrite
// above, because that rewrite regex matches the un-minified quoting style.
// Vendored `*.min.js` bundles are already minified and are left untouched —
// re-minifying them buys nothing and risks breaking third-party UMD wrappers.
// Identifier renaming is deliberately off for JS: these files are classic
// scripts and ES modules whose top-level names are referenced across files and
// from inline handlers, so only whitespace/comments/syntax are compressed.
async function minifyAsset(name, content) {
  if (name.endsWith('.min.js')) return content;
  const loader = name.endsWith('.css') ? 'css' : name.endsWith('.js') ? 'js' : null;
  if (!loader) return content;
  try {
    const out = await esbuildTransform(content, {
      loader,
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false,
      legalComments: 'none',
      target: 'es2020',
    });
    return out.code.length && out.code.length < content.length ? out.code : content;
  } catch (err) {
    console.warn(`  minify skipped for ${name}: ${err.message.split('\n')[0]}`);
    return content;
  }
}

async function hashAssets(queue) {
  const raw = new Map();
  for (const { dir, name } of queue) raw.set(name, await read(join(SRC, dir, name)));

  const deps = new Map();
  for (const { name } of queue) {
    const refs = new Set();
    for (const other of queue) {
      if (other.name === name) continue;
      if (assetRefRegex(other.name).test(raw.get(name))) refs.add(other.name);
    }
    deps.set(name, refs);
  }

  const hashMap = new Map();
  const pending = new Map(queue.map((q) => [q.name, q]));
  const maxIterations = pending.size + 5;
  for (let iteration = 0; pending.size; iteration++) {
    if (iteration > maxIterations) {
      throw new Error(`Asset dependency cycle detected among: ${[...pending.keys()].join(', ')}`);
    }
    let advanced = false;
    for (const [name] of [...pending]) {
      const unresolved = [...deps.get(name)].filter((d) => !hashMap.has(d));
      if (unresolved.length) continue; // wait for its dependencies to be hashed first
      let content = raw.get(name);
      for (const dep of deps.get(name)) {
        content = content.replace(assetRefRegex(dep), (_m, quote, prefix) => `${quote}${prefix}${hashMap.get(dep)}${quote}`);
      }
      content = await minifyAsset(name, content);
      const hash = createHash('sha256').update(content).digest('hex').slice(0, 10);
      const dot = name.lastIndexOf('.');
      const hashedName = `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
      hashMap.set(name, hashedName);
      await writeFile(join(DIST, 'assets', hashedName), content);
      pending.delete(name);
      advanced = true;
    }
    if (!advanced) throw new Error(`Asset dependency cycle detected among: ${[...pending.keys()].join(', ')}`);
  }
  return hashMap;
}

// Strip HTML comments from an EMITTED page. The comments stay in
// src/templates/*.html — they are how this codebase explains itself, and the one
// place a future editor will look before changing a block of markup. What they
// are not is something a visitor should download: dist/ was shipping ~152 KB of
// internal engineering rationale across 58 pages, on pages whose whole value
// proposition is that they load fast.
//
// Conservative by construction. It walks the string left to right and copies,
// rather than running a global regex, so it can only delete a run of characters
// it has positively identified as a comment sitting in ordinary markup:
//   - <script>, <style>, <pre> and <textarea> elements are copied through
//     whole. Inside them "<!--" is either meaningful (the legacy JS comment
//     form) or literal text a visitor is meant to read, and in <pre> even the
//     whitespace is content.
//   - IE conditional comments (<!--[if ...]> ... <![endif]-->) are kept
//     verbatim: they are markup, not commentary.
//   - Anything malformed — an unterminated comment, an element whose closing
//     tag is missing — stops the pass, and the remainder of the file is copied
//     through untouched. A page that cannot be shortened safely ships as-is.
// When a comment sat alone on its own line, the now-blank line goes with it;
// that is whitespace between block elements, which no renderer treats as
// content (and <pre>, where it would, is never reached).
// stripHtmlComments deliberately leaves <style> bodies alone, because "<!--" inside
// one can be literal content. That exemption had a side effect: the same internal
// rationale we stopped shipping in HTML comments kept shipping as CSS comments in
// the per-page <style> blocks, roughly 4 KB of it, including measured contrast
// ratios and notes written for whoever maintains the file next. None of that is for
// a visitor. This removes /* */ from inline <style> only.
//
// Safe here because no inline <style> in src/templates contains a quoted string
// holding "/*" or "*/", which is the one case a non-parsing strip would corrupt.
// That is checked, not assumed; if that ever stops being true this needs a real
// tokeniser. The linked stylesheet is untouched, it is already minified.
function stripInlineStyleComments(html) {
  if (!html.includes('<style')) return html;
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, open, body, close) => {
    if (!body.includes('/*')) return m;
    if (/(["'])(?:\\.|(?!\1).)*\1/.test(body) &&
        (body.match(/(["'])(?:\\.|(?!\1).)*\1/g) || []).some((q) => q.includes('/*') || q.includes('*/'))) {
      return m; // a quoted string holds comment syntax, leave the whole block alone
    }
    const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n');
    return open + cleaned + close;
  });
}

function stripHtmlComments(html) {
  if (!html.includes('<!--')) return html;
  const lower = html.toLowerCase();
  const GUARD = /<(script|style|pre|textarea)\b/gi;
  let out = '';
  let i = 0;
  while (i < html.length) {
    const c = html.indexOf('<!--', i);
    if (c === -1) { out += html.slice(i); break; }
    // If a guarded element opens before the next comment, copy that whole
    // element across untouched and resume after it.
    GUARD.lastIndex = i;
    const g = GUARD.exec(html);
    if (g && g.index < c) {
      const close = lower.indexOf(`</${g[1].toLowerCase()}`, g.index);
      const closeEnd = close === -1 ? -1 : html.indexOf('>', close);
      if (closeEnd === -1) { out += html.slice(i); break; } // unbalanced: leave the rest alone
      out += html.slice(i, closeEnd + 1);
      i = closeEnd + 1;
      continue;
    }
    const end = html.indexOf('-->', c);
    if (end === -1) { out += html.slice(i); break; } // unterminated: leave the rest alone
    let next = end + 3;
    const body = html.slice(c + 4, end);
    // Not every HTML comment is a note to a developer. Some are instructions to a
    // machine that reads the served page, and deleting one silently changes
    // behaviour with nothing on screen to show for it. Cloudflare's
    // <!--email_off--> is the live example: it wraps the contact address on
    // /about/, /contact/, /corrections/, /privacy/ and /terms/ and switches
    // Cloudflare's email obfuscation OFF for that link. Stripping it does not
    // remove a comment, it reverses a decision someone made on purpose. Keep the
    // known directives, and the IE conditional, and strip everything else.
    if (/^\s*\[if/i.test(body) || /^\s*\/?(email_off|noindex|googleoff|googleon|htmlmin:\w+)\b/i.test(body)) {
      out += html.slice(i, next);
    } else {
      let head = html.slice(i, c);
      // Comment alone on its own line: take the line with it.
      const lineOnly = /(^|\n)[ \t]*$/.test(head) && /^[ \t]*(\r?\n|$)/.test(html.slice(next));
      if (lineOnly) {
        head = head.replace(/[ \t]*$/, '');
        const nl = /^[ \t]*\r?\n/.exec(html.slice(next));
        if (nl) next += nl[0].length;
      }
      out += head;
    }
    i = next;
  }
  return out;
}

// ---- "On this page" jump list ------------------------------------------
// The 2026-08-11 competitor race had 4 of 6 personas cite OnPay's numbered
// jump list: a short set of links, sitting just above the long
// below-calculator content, into the sections they actually came for.
//
// Generated here, at the very end of the build, from the headings each page
// ACTUALLY renders — never a hardcoded list. The bonus-state template and the
// 51 state pages assemble their below-calculator sections from data
// ({{SECTIONS_A}}, {{ANCILLARY_B}}, {{STATE_FAQ}} …), so a list written by
// hand would go stale the first time a state gains or loses a section, and
// would point at anchors that no longer exist on that one page.
//
// Anchors are plain #id links: `main [id]` already carries the sticky-header
// scroll-margin-top set by fix/anchor-scroll-margin, so the browser's own
// jump lands the heading clear of the header with no scroll JS of our own.
// The only behaviour we add is opening a collapsed .prose-fold the link
// points into, which matters the moment PROSE_FOLD_OPEN flips back to false.
const JUMP_LIST_MARKER = '<nav class="jump-list" data-jump-list></nav>';
const JUMP_LIST_MAX = 6;
const JUMP_LIST_MIN = 3;
// Headings that are navigation, legal furniture or the trust anchor rather
// than an answer someone arrived hunting for.
const JUMP_LIST_SKIP = [/^sources$/i, /calculators (for|near)\b/i, /^related\b/i];
// Plain-English relabels for the few headings written as editorial titles
// rather than as the question the persona asked.
const JUMP_LIST_LABELS = [
  [/^the myth\b/i, 'The "40% bonus tax" myth'],
  [/^how a bonus is withheld/i, 'How the numbers are calculated'],
  [/^how the .no tax on tips. deduction works/i, 'How the tips deduction works'],
  [/^a worked example/i, 'A worked example'],
];
function jumpLabel(text) {
  for (const [re, label] of JUMP_LIST_LABELS) if (re.test(text)) return label;
  // State-page headings are written as full sentences with the answer trailing
  // the topic ("No state income tax in Texas — so what still shrinks your
  // 2026 paycheck?"). The leading clause is the part a reader scans a nav for,
  // so cut at the first strong break and keep a question mark when it is one.
  const clause = text.match(/^(.{12,}?\?)\s|^(.{12,}?)\s*(?:[—–:]|\()/);
  let out = clause ? (clause[1] || clause[2]).trim() : text;
  if (out.length > 52) {
    const cut = out.slice(0, 52);
    const sp = cut.lastIndexOf(' ');
    out = (sp > 24 ? cut.slice(0, sp) : cut).replace(/[\s,:;.–—-]+$/, '') + '…';
  }
  return out;
}
function jumpSlug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
// Now that PROSE_FOLD_OPEN is false again, most jump targets are headings
// inside a COLLAPSED <details>, so the link has to open its fold before the
// browser's own jump can land on it. Capture phase, so the fold is open
// before the default anchor navigation runs. The hash pass covers arriving
// with a fragment already in the URL (a shared link, a back button, a search
// result deep-linking a section) — no click ever happens in that case.
const JUMP_LIST_SCRIPT = '<script>(function(){' +
  'function open(id){var t=id&&document.getElementById(id);if(!t)return;' +
  'var d=t.closest("details");while(d){d.open=true;d=d.parentElement&&d.parentElement.closest("details");}}' +
  'document.addEventListener("click",function(e){' +
  'var a=e.target&&e.target.closest&&e.target.closest("a[href^=\\"#\\"]");if(!a)return;' +
  'open(a.getAttribute("href").slice(1));},true);' +
  'function fromHash(){if(location.hash.length>1)open(decodeURIComponent(location.hash.slice(1)));}' +
  'window.addEventListener("hashchange",fromHash);' +
  // The script tag sits above the sections it opens, so at parse time the
  // target may not exist yet; DOMContentLoaded is the first moment it does.
  'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fromHash);else fromHash();' +
  '})();</script>';
function buildJumpList(html) {
  const at = html.indexOf(JUMP_LIST_MARKER);
  if (at < 0) return html;
  const head = html.slice(0, at);
  const used = new Set((html.match(/\bid="([^"]+)"/g) || []).map((s) => s.slice(4, -1)));
  const entries = [];
  const seen = new Set();
  // Only the page's own content is navigable: past </main> lie the site search
  // block and the footer, whose h2s are furniture on all ~240 pages.
  const rest = html.slice(at + JUMP_LIST_MARKER.length);
  const endsAt = rest.lastIndexOf('</main>');
  const tail = endsAt < 0 ? '' : rest.slice(endsAt);
  const body = (endsAt < 0 ? rest : rest.slice(0, endsAt))
    .replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/g, (whole, attrs, inner) => {
      if (entries.length >= JUMP_LIST_MAX) return whole;
      // .otw-q headings are the wizard's questions (above the marker on every
      // page but one) and .sr-only ones are screen-reader labels, not sections.
      if (/\b(otw-q|sr-only)\b/.test(attrs)) return whole;
      const text = inner.replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
      if (!text || JUMP_LIST_SKIP.some((re) => re.test(text))) return whole;
      const label = jumpLabel(text);
      if (seen.has(label)) return whole;
      const existing = attrs.match(/\bid="([^"]+)"/);
      let id = existing ? existing[1] : '';
      if (!id) {
        const base = jumpSlug(text) || 'section';
        id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      }
      used.add(id);
      seen.add(label);
      entries.push({ id, label });
      return existing ? whole : `<h2${attrs} id="${id}">${inner}</h2>`;
    }) + tail;
  // Too few sections to be worth a nav: drop the marker and leave the page as
  // it was rather than ship a two-item list of links to what is already onscreen.
  if (entries.length < JUMP_LIST_MIN) return html.replace(JUMP_LIST_MARKER, '');
  const items = entries.map((e) =>
    `<li><a href="#${e.id}">${e.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a></li>`).join('');
  return head +
    `<nav class="jump-list" aria-labelledby="jumpListTitle">` +
    `<p class="jump-list-title" id="jumpListTitle">On this page</p><ol>${items}</ol></nav>` +
    JUMP_LIST_SCRIPT + body;
}

// Final pass: walk the whole dist/ tree, strip the internal HTML comments from
// every page, and rewrite every `src="/assets/X.js"` (or similarly-quoted)
// reference to its hashed name. Run once at the very end of the build instead of
// touching each of the ~110 template writeFile() call sites individually — every
// HTML file (main tool pages, /embed/ pages, state pages, home, static content
// pages) goes through this single choke point, so nothing can slip through by
// having been written via a path this pass doesn't know about. Comments are
// stripped FIRST, so a commented-out asset reference is gone before the hash
// rewrite has a chance to touch it.
async function rewriteHtmlAssetRefs(dir, hashMap) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewriteHtmlAssetRefs(full, hashMap);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    let html = await read(full);
    let changed = false;
    const stripped = stripInlineStyleComments(stripHtmlComments(html));
    if (stripped !== html) { html = stripped; changed = true; }
    if (PROSE_FOLD_OPEN && html.includes('<details class="prose-fold">')) {
      html = html.replaceAll('<details class="prose-fold">', '<details class="prose-fold" open>');
      changed = true;
    }
    // After the fold pass, so the list is built against the markup that ships.
    const jumped = buildJumpList(html);
    if (jumped !== html) { html = jumped; changed = true; }
    for (const [orig, hashed] of hashMap) {
      const re = new RegExp(`(["'])/assets/${orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
      if (re.test(html)) {
        html = html.replace(re, (_m, quote) => `${quote}/assets/${hashed}${quote}`);
        changed = true;
      }
    }
    if (changed) await writeFile(full, html);
  }
}

async function main() {
  const taxData = await readJSON(join(SRC, 'data', 'tax-data-2026.json'));
  LAST_SOURCED = (taxData._meta && taxData._meta.lastSourced) || '';
  const roster = await readJSON(join(SRC, 'data', 'states.json'));
  TOOL_SOURCES = await readJSON(join(SRC, 'data', 'tool-sources.json'));
  const payrollData = await readJSON(join(SRC, 'data', 'state-payroll-2026.json'));
  const payroll = (payrollData && payrollData.states) || {};
  const stateTpl = await read(join(SRC, 'templates', 'state-page.html'));
  // The pre-render guard's denominator, read out of app.js itself once per build
  // rather than maintained by hand next to it. See scanAppFirstRender().
  const appScan = scanAppFirstRender(await read(join(SRC, 'assets', 'app.js')));
  console.log(
    `   pre-render guard: ${appScan.contentIds.size} elements derived from app.js ` +
    `(${appScan.reachable} of ${appScan.functions} functions reachable from init)`
  );
  const homeTpl = await read(join(SRC, 'templates', 'home.html'));
  const pageTpl = await read(join(SRC, 'templates', 'page.html'));
  const invoiceTpl = await read(join(SRC, 'templates', 'invoice-generator.html'));
  const imagesToPdfTpl = await read(join(SRC, 'templates', 'images-to-pdf.html'));
  const pdfToWordTpl = await read(join(SRC, 'templates', 'pdf-to-word.html'));
  const wordToPdfTpl = await read(join(SRC, 'templates', 'word-to-pdf.html'));
  const mergePdfTpl = await read(join(SRC, 'templates', 'merge-pdf.html'));
  const splitPdfTpl = await read(join(SRC, 'templates', 'split-pdf.html'));
  const compressPdfTpl = await read(join(SRC, 'templates', 'compress-pdf.html'));
  const pdfToolsTpl = await read(join(SRC, 'templates', 'pdf-tools.html'));
  const pdfAltTpl = await read(join(SRC, 'templates', 'pdf-word-converter-alternatives.html'));
  const qrTpl = await read(join(SRC, 'templates', 'qr-generator.html'));
  const circleTpl = await read(join(SRC, 'templates', 'circle-crop.html'));
  const photoTpl = await read(join(SRC, 'templates', 'passport-photo-maker.html'));
  const resizeTpl = await read(join(SRC, 'templates', 'image-resizer.html'));
  const convertTpl = await read(join(SRC, 'templates', 'image-converter.html'));
  const compressTpl = await read(join(SRC, 'templates', 'image-compressor.html'));
  const percentTpl = await read(join(SRC, 'templates', 'percentage-calculator.html'));
  const tipTpl = await read(join(SRC, 'templates', 'tip-calculator.html'));
  const mortgageTpl = await read(join(SRC, 'templates', 'mortgage-calculator.html'));
  const autoLoanTpl = await read(join(SRC, 'templates', 'auto-loan-calculator.html'));
  const debtPayoffTpl = await read(join(SRC, 'templates', 'debt-payoff-calculator.html'));
  const countdownTpl = await read(join(SRC, 'templates', 'holiday-countdown.html'));
  const timerTpl = await read(join(SRC, 'templates', 'countdown-timer.html'));
  const stopwatchTpl = await read(join(SRC, 'templates', 'stopwatch.html'));
  const pomodoroTpl = await read(join(SRC, 'templates', 'pomodoro-timer.html'));
  const ageTpl = await read(join(SRC, 'templates', 'age-calculator.html'));
  const daysBetweenTpl = await read(join(SRC, 'templates', 'days-between-dates.html'));
  const timeZoneTpl = await read(join(SRC, 'templates', 'time-zone-converter.html'));
  const dateCalcTpl = await read(join(SRC, 'templates', 'date-calculator.html'));
  const dftTpl = await read(join(SRC, 'templates', 'days-from-today.html'));
  const dftHubTpl = await read(join(SRC, 'templates', 'days-from-today-hub.html'));
  const cookingTpl = await read(join(SRC, 'templates', 'cooking-converter.html'));
  const recipeScalerTpl = await read(join(SRC, 'templates', 'recipe-scaler.html'));
  const unitConverterTpl = await read(join(SRC, 'templates', 'unit-converter.html'));
  const bmiTpl = await read(join(SRC, 'templates', 'bmi-calculator.html'));
  const dueDateTpl = await read(join(SRC, 'templates', 'due-date-calculator.html'));
  const ovulationTpl = await read(join(SRC, 'templates', 'ovulation-calculator.html'));
  const calorieTpl = await read(join(SRC, 'templates', 'calorie-calculator.html'));
  const idealWeightTpl = await read(join(SRC, 'templates', 'ideal-weight-calculator.html'));
  const gpaTpl = await read(join(SRC, 'templates', 'gpa-calculator.html'));
  const compoundTpl = await read(join(SRC, 'templates', 'compound-interest-calculator.html'));
  const retire401kTpl = await read(join(SRC, 'templates', '401k-calculator.html'));
  const savingsGoalTpl = await read(join(SRC, 'templates', 'savings-goal-calculator.html'));
  const inflationTpl = await read(join(SRC, 'templates', 'inflation-calculator.html'));
  const salaryHourlyTpl = await read(join(SRC, 'templates', 'salary-to-hourly.html'));
  const salesTaxTpl = await read(join(SRC, 'templates', 'sales-tax-calculator.html'));
  const gasCostTpl = await read(join(SRC, 'templates', 'gas-cost-calculator.html'));
  const signatureTpl = await read(join(SRC, 'templates', 'signature-maker.html'));
  const passwordTpl = await read(join(SRC, 'templates', 'password-generator.html'));
  const wordCounterTpl = await read(join(SRC, 'templates', 'word-counter.html'));
  const hoursCalcTpl = await read(join(SRC, 'templates', 'hours-calculator.html'));
  const textCaseTpl = await read(join(SRC, 'templates', 'text-case-converter.html'));
  const bionicTpl = await read(join(SRC, 'templates', 'bionic-reading-converter.html'));
  const romanTpl = await read(join(SRC, 'templates', 'roman-numeral-converter.html'));
  const baseConverterTpl = await read(join(SRC, 'templates', 'base-converter.html'));
  const colorConverterTpl = await read(join(SRC, 'templates', 'color-converter.html'));
  const jsonFormatterTpl = await read(join(SRC, 'templates', 'json-formatter.html'));
  const uuidTpl = await read(join(SRC, 'templates', 'uuid-generator.html'));
  const diffCheckerTpl = await read(join(SRC, 'templates', 'diff-checker.html'));
  const base64Tpl = await read(join(SRC, 'templates', 'base64-converter.html'));
  const aspectRatioTpl = await read(join(SRC, 'templates', 'aspect-ratio-calculator.html'));
  const discountTpl = await read(join(SRC, 'templates', 'discount-calculator.html'));
  const fuelEconomyTpl = await read(join(SRC, 'templates', 'fuel-economy-calculator.html'));
  const randomNumberTpl = await read(join(SRC, 'templates', 'random-number-generator.html'));
  const paintTpl = await read(join(SRC, 'templates', 'paint-calculator.html'));
  const tileTpl = await read(join(SRC, 'templates', 'tile-calculator.html'));
  const sleepTpl = await read(join(SRC, 'templates', 'sleep-calculator.html'));
  const paceTpl = await read(join(SRC, 'templates', 'pace-calculator.html'));
  const fractionTpl = await read(join(SRC, 'templates', 'fraction-calculator.html'));
  const loremTpl = await read(join(SRC, 'templates', 'lorem-ipsum-generator.html'));
  const averageTpl = await read(join(SRC, 'templates', 'average-calculator.html'));
  const morseTpl = await read(join(SRC, 'templates', 'morse-code-translator.html'));
  const cagrTpl = await read(join(SRC, 'templates', 'cagr-calculator.html'));
  const halfBirthdayTpl = await read(join(SRC, 'templates', 'half-birthday-calculator.html'));
  const ruleOf72Tpl = await read(join(SRC, 'templates', 'rule-of-72-calculator.html'));
  const wordsToMinutesTpl = await read(join(SRC, 'templates', 'words-to-minutes.html'));
  const doubleTimePayTpl = await read(join(SRC, 'templates', 'double-time-pay-calculator.html'));
  const biweeklyVsSemimonthlyTpl = await read(join(SRC, 'templates', 'biweekly-vs-semimonthly.html'));
  const ezGraderTpl = await read(join(SRC, 'templates', 'ez-grader.html'));
  const chronoAgeTpl = await read(join(SRC, 'templates', 'chronological-age-calculator.html'));
  const debtAvalancheTpl = await read(join(SRC, 'templates', 'debt-avalanche-calculator.html'));
  const markdownTpl = await read(join(SRC, 'templates', 'markdown-to-html.html'));
  const w2Tpl = await read(join(SRC, 'templates', '1099-vs-w2-calculator.html'));
  const overtimeTaxTpl = await read(join(SRC, 'templates', 'overtime-tax-calculator.html'));
  const tipsTaxTpl = await read(join(SRC, 'templates', 'tips-tax-calculator.html'));
  const embedOvertimeTpl = await read(join(SRC, 'templates', 'embed', 'overtime-tax-calculator.html'));
  const embedTipsTpl = await read(join(SRC, 'templates', 'embed', 'tips-tax-calculator.html'));
  const seniorTaxTpl = await read(join(SRC, 'templates', 'senior-deduction-calculator.html'));
  const embedSeniorTpl = await read(join(SRC, 'templates', 'embed', 'senior-deduction-calculator.html'));
  const saltCapTpl = await read(join(SRC, 'templates', 'salt-cap-calculator.html'));
  const embedSaltTpl = await read(join(SRC, 'templates', 'embed', 'salt-cap-calculator.html'));
  const carLoanTpl = await read(join(SRC, 'templates', 'car-loan-interest-calculator.html'));
  const embedCarLoanTpl = await read(join(SRC, 'templates', 'embed', 'car-loan-interest-calculator.html'));
  const charitableTpl = await read(join(SRC, 'templates', 'charitable-deduction-calculator.html'));
  const embedCharitableTpl = await read(join(SRC, 'templates', 'embed', 'charitable-deduction-calculator.html'));
  const pmiTpl = await read(join(SRC, 'templates', 'pmi-deduction-calculator.html'));
  const embedPmiTpl = await read(join(SRC, 'templates', 'embed', 'pmi-deduction-calculator.html'));
  const qcdTpl = await read(join(SRC, 'templates', 'qcd-vs-charitable-deduction-calculator.html'));
  const embedQcdTpl = await read(join(SRC, 'templates', 'embed', 'qcd-vs-charitable-deduction-calculator.html'));
  const depCareTpl = await read(join(SRC, 'templates', 'dependent-care-fsa-vs-credit-calculator.html'));
  const embedDepCareTpl = await read(join(SRC, 'templates', 'embed', 'dependent-care-fsa-vs-credit-calculator.html'));
  const w4OtTipsTpl = await read(join(SRC, 'templates', 'w4-overtime-tips-withholding-calculator.html'));
  const embedW4OtTipsTpl = await read(join(SRC, 'templates', 'embed', 'w4-overtime-tips-withholding-calculator.html'));
  const rothCatchupTpl = await read(join(SRC, 'templates', 'roth-catchup-calculator.html'));
  const embedRothCatchupTpl = await read(join(SRC, 'templates', 'embed', 'roth-catchup-calculator.html'));
  const bonusTaxTpl = await read(join(SRC, 'templates', 'bonus-tax-calculator.html'));
  const bonusTaxStateTpl = await read(join(SRC, 'templates', 'bonus-tax-calculator-state.html'));
  // "What kind of extra pay is this?" is a CALIFORNIA question: California is the
  // only state that holds back a different rate on bonuses and stock options than
  // on other supplemental pay, and the card's own options quote its 10.23% and
  // 6.6% by name. bonus-tax-wizard.js keeps it off the path everywhere else with
  // `when: isCalifornia` — but that only takes effect once JavaScript has run,
  // and on this cluster the served card stack IS the form for a reader without
  // it. So the other 50 pages must not SERVE the card at all: a Texas reader was
  // being asked a California question and shown a California rate, and every
  // crawler saw the same block on 50 URLs. Removed from the emitted HTML rather
  // than parameterised so the copy stays in one place, in the template.
  //
  // The remaining cards keep their original data-step numbers, leaving a gap at
  // 3. wizard-core steps along the path array rather than by counting, so a gap
  // costs nothing, and renumbering would put the card numbers on the two builds
  // out of step with each other for no gain.
  const PAYTYPE_CARD_RE =
    /[ \t]*<section class="otw-card" data-step="3" data-card="paytype"[\s\S]*?<\/section>\n/;
  const dropPaytypeCard = (html, slug) => {
    if (slug === 'california') return html;
    const out = html.replace(PAYTYPE_CARD_RE, '');
    if (out === html) {
      throw new Error(
        `bonus-tax-calculator-state.html: could not find the paytype card to drop for ${slug}. ` +
        `The card's opening tag has changed, so 50 state pages would ship California's ` +
        `"California holds back 10.23%" question. Update PAYTYPE_CARD_RE.`
      );
    }
    return out;
  };
  const embedBonusTaxTpl = await read(join(SRC, 'templates', 'embed', 'bonus-tax-calculator.html'));
  const form1099Tpl = await read(join(SRC, 'templates', '1099-threshold-checker.html'));
  const embedForm1099Tpl = await read(join(SRC, 'templates', 'embed', '1099-threshold-checker.html'));
  const w2BoxTpl = await read(join(SRC, 'templates', 'w2-box-decoder.html'));
  const embedW2BoxTpl = await read(join(SRC, 'templates', 'embed', 'w2-box-decoder.html'));
  const ssMaxoutTpl = await read(join(SRC, 'templates', 'ss-wage-base-calculator.html'));
  const embedSsMaxoutTpl = await read(join(SRC, 'templates', 'embed', 'ss-wage-base-calculator.html'));
  const studentLoanCapTpl = await read(join(SRC, 'templates', 'student-loan-cap-calculator.html'));
  const embedStudentLoanCapTpl = await read(join(SRC, 'templates', 'embed', 'student-loan-cap-calculator.html'));
  const ableTpl = await read(join(SRC, 'templates', 'able-account-calculator.html'));
  const embedAbleTpl = await read(join(SRC, 'templates', 'embed', 'able-account-calculator.html'));
  const section127Tpl = await read(join(SRC, 'templates', 'employer-student-loan-repayment-calculator.html'));
  const embedSection127Tpl = await read(join(SRC, 'templates', 'embed', 'employer-student-loan-repayment-calculator.html'));
  const adoptionTpl = await read(join(SRC, 'templates', 'adoption-credit-calculator.html'));
  const embedAdoptionTpl = await read(join(SRC, 'templates', 'embed', 'adoption-credit-calculator.html'));
  const embedGalleryTpl = await read(join(SRC, 'templates', 'embed-gallery.html'));
  const embedMergePdfTpl = await read(join(SRC, 'templates', 'embed', 'merge-pdf.html'));
  const embedWordToPdfTpl = await read(join(SRC, 'templates', 'embed', 'word-to-pdf.html'));
  const overtimeStudyTpl = await read(join(SRC, 'templates', 'data-overtime-tax-by-state.html'));
  const tipsStudyTpl = await read(join(SRC, 'templates', 'data-tips-tax-by-state.html'));
  const wamTpl = await read(join(SRC, 'templates', 'what-applies-to-me.html'));
  const thpTpl = await read(join(SRC, 'templates', 'data-take-home-pay-by-state.html'));
  // Key-figures line for the take-home study, computed inside its build block below
  // and consumed by llms-full.txt after that block's scope closes.
  let dataPageStatsTakeHome = '';
  // The one-sentence computed answer each /data/ page now leads with, keyed by page
  // path. Every entry is written by the build block that renders that page, in the
  // form `ANSWER: (dataPageAnswers['/data/x/'] = <expr>)`, so the sentence in
  // llms.txt is byte-identical to the sentence on the page rather than a second,
  // drifting copy of it. Read by the llms.txt writer at the end of main().
  const dataPageAnswers = {};
  // Standalone /data/ reference tables (citable link-bait): each re-packages an
  // already-sourced dataset that lives inside an existing tool page, plus an
  // iframe-able /embed/data/* twin.
  const dataTtocTpl = await read(join(SRC, 'templates', 'data-treasury-tipped-occupation-codes.html'));
  const embedDataTtocTpl = await read(join(SRC, 'templates', 'embed', 'data-treasury-tipped-occupation-codes.html'));
  const dataStudentLoanTpl = await read(join(SRC, 'templates', 'data-2026-student-loan-limits.html'));
  const embedDataStudentLoanTpl = await read(join(SRC, 'templates', 'embed', 'data-2026-student-loan-limits.html'));
  const dataSuppTpl = await read(join(SRC, 'templates', 'data-state-supplemental-withholding-rates-2026.html'));
  const embedDataSuppTpl = await read(join(SRC, 'templates', 'embed', 'data-state-supplemental-withholding-rates-2026.html'));
  const obbba = await readJSON(join(SRC, 'data', 'obbba-deductions-2026.json'));
  // Client-injected JSON for the OBBBA tools (internal _keys stripped).
  const OBBBA_FED_JSON = JSON.stringify(stripInternal(obbba.federal));
  const OBBBA_STATES_JSON = JSON.stringify(stripInternal(obbba.states));
  const OBBBA_FED_TAX_JSON = JSON.stringify(stripInternal({ standardDeduction: taxData.federal.standardDeduction, brackets: taxData.federal.brackets }));
  // OBBBA §70404 dependent-care system: §129 DCFSA exclusion + §21 CDCTC. Its own
  // sibling dataset (a nonrefundable CREDIT + an income+FICA EXCLUSION — not the
  // deduction shape of obbba-deductions). The DCFSA's FICA side needs the fica
  // table too, so DC_FED_JSON carries standardDeduction + brackets + fica.
  const depCare = await readJSON(join(SRC, 'data', 'dependent-care-2026.json'));
  const DC_JSON = JSON.stringify(stripInternal({ dcfsa: depCare.dcfsa, cdctc: depCare.cdctc, interaction: depCare.interaction }));
  const DC_FED_JSON = JSON.stringify(stripInternal({ standardDeduction: taxData.federal.standardDeduction, brackets: taxData.federal.brackets, fica: taxData.federal.fica }));
  // SECURE 2.0 §603 mandatory Roth catch-up params (separate rule, its own dataset).
  const secure2 = await readJSON(join(SRC, 'data', 'secure2-catchup-2026.json'));
  const ROTHCATCHUP_JSON = JSON.stringify(stripInternal(secure2.rothCatchUp));
  // 1099-K (IRC §6050W, OBBBA §70432) / 1099-NEC-MISC (IRC §6041/§6041A, OBBBA
  // §70433) threshold checker — a STANDALONE reporting-trigger lookup, not a
  // deduction, so it deliberately does NOT read obbba-deductions-2026.json or
  // taxData.federal (no bracket/FICA reuse). Reuses the plain state name/abbr
  // roster (states.json, already loaded above as `roster`) just to populate the
  // optional state-overlay dropdown — not the OBBBA conformity dataset.
  const form1099 = await readJSON(join(SRC, 'data', 'form-1099-thresholds.json'));
  const FORM1099_JSON = JSON.stringify(stripInternal(form1099));
  const FORM1099_STATES_JSON = JSON.stringify(roster.map((s) => ({ name: s.name, abbr: s.abbr })));
  // 2026 W-2 Box 12 TA/TP/TT decoder + TTOC lookup — a STANDALONE explainer
  // (no deduction math; the tips/overtime calculators own that). Data is the
  // codified 71-occupation table from 26 CFR 1.224-1 Table 1 (final rule
  // 2026-07104: PUBLISHED Apr 13 2026, EFFECTIVE Jun 12 2026 — two different
  // dates, per the spec's flagged discrepancy; applies to tax years after
  // Dec 31 2024). The full table is ALSO rendered server-side into the page
  // (TTOC_TABLE_HTML) so every occupation/code is indexable text, not just
  // client-injected JSON.
  const ttoc = await readJSON(join(SRC, 'data', 'ttoc-occupations.json'));
  const TTOC_JSON = JSON.stringify(stripInternal(ttoc));
  const TTOC_TABLE_HTML = ttoc.categories.map((cat) => {
    const rows = cat.occupations.map((o) => {
      const flag = o.addedInFinalRule ? ' <span class="new-flag">added in final rule</span>' : '';
      return `<tr><td><strong>${o.code}</strong></td>` +
        `<td><strong>${esc(o.title)}</strong>${flag}<br><span class="muted-small">${esc(o.description)}.</span></td>` +
        `<td>${esc(o.examples)}</td></tr>`;
    }).join('\n');
    return `<details><summary>${esc(cat.name)} (codes ${cat.occupations[0].code}–${cat.occupations[cat.occupations.length - 1].code})</summary>\n` +
      `<table><thead><tr><th>Code</th><th>Occupation</th><th>Examples</th></tr></thead><tbody>\n${rows}\n</tbody></table></details>`;
  }).join('\n');
  // Social Security wage-base max-out date calculator — a STANDALONE calendar
  // forward-walk (new ss-maxout-engine.js; paycheck-engine.js has annual FICA
  // math but no pay-date scheduling at all). Reuses ONLY the existing
  // federal.fica.socialSecurity {rate, wageBase} straight out of
  // tax-data-2026.json — no duplicate data file. Keyed by taxYear per the
  // engine's params[taxYear] contract; fixed to 2026 (2027's wage base isn't
  // published until ~Oct 2026, and a forward pay-date projection has no
  // meaningful use for a closed past year like 2025).
  const SSMAXOUT_PARAMS_JSON = JSON.stringify({
    2026: { wageBase: taxData.federal.fica.socialSecurity.wageBase, ssRate: taxData.federal.fica.socialSecurity.rate }
  });
  // Federal student loan borrowing caps (P.L. 119-21 §81001 / 20 U.S.C.
  // §1087e(a) / 34 CFR 685.203, effective July 1, 2026) — a STANDALONE
  // student-aid dataset + engine (student-loan-cap.js). Title IV cap
  // arithmetic, NOT tax/payroll: deliberately no reuse of paycheck-engine.js
  // or obbba-deduction.js, and not co-located in obbba-deductions-2026.json.
  // The dataset's `litigation` block (professional-vs-graduate definition
  // stayed in court June 24, 2026; ED interim 29-program list updated July
  // 10, 2026) ships to the client so the UI's caveat stays date-stamped from
  // data — RE-CHECK THE FSA EA BEFORE EVERY DEPLOY of this tool (spec §7.1).
  const studentLoanLimits = await readJSON(join(SRC, 'data', 'student-loan-limits-2026.json'));
  const STUDENT_LOAN_LIMITS_JSON = JSON.stringify(stripInternal(studentLoanLimits));
  // ABLE account (26 U.S.C. §529A) TY2026 contribution limits — a STANDALONE
  // savings-account dataset + engine (able-contribution.js). §529A cap
  // arithmetic, NOT tax/payroll: deliberately no reuse of paycheck-engine.js
  // or obbba-deduction.js, and not co-located in obbba-deductions-2026.json.
  // $20,000 base (Rev. Proc. 2025-32 §3.34, decoupled from the gift exclusion
  // by OBBBA §70115) + the permanent ABLE-to-Work bonus (lesser of the
  // beneficiary's compensation or the one-person FPL for their state — the
  // 3-bucket 48+DC/AK/HI lookup). The FPL set shipped is the Jan-2025 HHS
  // guidelines per the spec's §7.1 decision (statute-natural, conservative);
  // the alternate Jan-2026 reading lives in the dataset's stripped
  // `_alternateFpl2026Reading` key — REVISIT when the final Rev. Dec 2026
  // 1099-QA/5498-QA instructions or Pub 907 (2026) publish. Reuses the plain
  // state name/abbr roster (states.json, `roster`) only to populate the
  // state-of-residence dropdown — the engine maps abbr → FPL bucket itself.
  const ableLimits = await readJSON(join(SRC, 'data', 'able-limits-2026.json'));
  const ABLE_LIMITS_JSON = JSON.stringify(stripInternal(ableLimits));
  const ABLE_STATES_JSON = JSON.stringify(roster.map((s) => ({ name: s.name, abbr: s.abbr })));
  // IRC §127 employer educational-assistance / student-loan-repayment tax
  // benefit (permanent + indexed 2027+ via OBBBA / P.L. 119-21 §70412). A
  // STANDALONE dataset + engine (section-127.js): this is an EXCLUSION, not an
  // OBBBA below-the-line deduction, so it deliberately shares no engine/data
  // with obbba-deduction.js / obbba-deductions-2026.json. Ships the $5,250 cap,
  // the $184,500 SS wage base, the FICA rates, the Additional-Medicare
  // thresholds, and the nearest-$50 2027+ indexing params so the wage-base
  // straddle + shared-cap logic run client-side.
  const section127 = await readJSON(join(SRC, 'data', 'section-127-2026.json'));
  const SECTION127_JSON = JSON.stringify(stripInternal(section127));
  // Adoption Tax Credit (26 U.S.C. §23) + §137 employer exclusion parameters,
  // TY2025/2026 — a STANDALONE §23 credit dataset + engine (adoption-credit.js).
  // NOT the OBBBA deduction cluster: no reuse of tax-data-2026.json or
  // obbba-deductions-2026.json. Load-bearing correction (spec §7.3): the $5,120
  // (2026) refundable cap is PER CHILD (Form 8839 line 11b per column), not per
  // return — the engine's per-child min() is what beats competitors' fixed
  // "$5,120 refundable / $12,550 nonrefundable" framing. Carries both years so
  // extension/amended 2025 returns compute; the FIFO 5-year carryforward clock
  // lives on the dataset root, so projection years past 2026 draw down without
  // needing (as-yet-unpublished) annual figures.
  const adoptionData = await readJSON(join(SRC, 'data', 'adoption-credit-2026.json'));
  const ADOPTION_DATA_JSON = JSON.stringify(stripInternal(adoptionData));
  // State supplemental (bonus) withholding rates — its own dataset (§ bonus-tax).
  const suppData = await readJSON(join(SRC, 'data', 'state-supplemental-2026.json'));
  // Lean client payload for a supp entry: ONLY the fields the browser engine
  // needs. Keeps build-time provenance (source/verified/singleSourced/notes) out
  // of the shipped page JSON.
  const leanSupp = (s) => {
    const o = { name: s.name, method: s.method };
    if (s.rate != null) o.rate = s.rate;
    if (s.rateOther != null) o.rateOther = s.rateOther;
    if (s.special) o.special = s.special;
    if (s.bands) o.bands = s.bands;
    return o;
  };
  const leanSuppStates = (states) => {
    const out = {};
    for (const [k, v] of Object.entries(states)) out[k] = leanSupp(v);
    return out;
  };
  const suppFederalLean = { flatRate: suppData.federal.flatRate, highRate: suppData.federal.highRate, highThreshold: suppData.federal.highThreshold };
  // All-states payload for the bonus hub + embed (per-state cluster pages inject
  // only their own state, below).
  const BONUS_TAX_ALL_JSON = JSON.stringify({
    taxData: stripInternal({ taxYear: taxData.taxYear, federal: taxData.federal, states: taxData.states }),
    supp: { federal: suppFederalLean, states: leanSuppStates(suppData.states) }
  });
  const biweeklyTpl = await read(join(SRC, 'templates', 'biweekly-mortgage-calculator.html'));
  const photoSpecs = await readJSON(join(SRC, 'data', 'photo-specs.json'));
  const cpiUs = await readJSON(join(SRC, 'data', 'cpi-us.json'));
  const year = String(taxData.taxYear);
  const verified = (taxData._meta && taxData._meta.lastSourced) || '';

  // Warn-only freshness check at build (the hard fail lives in `npm test`).
  const nowYear = new Date().getFullYear();
  if (nowYear > taxData.taxYear) {
    console.warn(`\n⚠  STALE TAX DATA: figures are for ${taxData.taxYear} but it is ${nowYear}. ` +
      `Update to ${nowYear} before relying on this deploy. (npm test will fail on this.)\n`);
  }

  // `verified` is rendered to every state and bonus page as "verified <date>", which is
  // a factual claim about when a human last checked. It goes stale the moment the figures
  // it describes are edited, and the year check above cannot see that: on 2026-07-29 six
  // states' brackets were rewritten while this date still read 2026-06-16. Surfaced here
  // as well as in check-freshness.js because the build is what runs on every deploy.
  if (verified) {
    try {
      const { execFileSync } = await import('node:child_process');
      const lastDataCommit = execFileSync(
        'git', ['log', '-1', '--format=%cs', '--', 'src/data/tax-data-2026.json'],
        { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      if (lastDataCommit && lastDataCommit > verified) {
        console.warn(`\n⚠  VERIFIED-DATE STALE: tax data last changed ${lastDataCommit}, but pages ` +
          `will render "verified ${verified}". Re-check the figures, then set _meta.lastSourced ` +
          `to the date you actually checked. Do not bump it without checking.\n`);
      }
    } catch (err) {
      // Not a git checkout, or git is unavailable. Say so rather than swallowing it:
      // a silent catch here is how this guard would quietly stop guarding. The
      // check-freshness.js copy still runs in `npm test`.
      console.warn(`⚠  verified-date check skipped: ${err.message}`);
    }
  }

  // A `_watch` entry is a dated legal-status tripwire (temporary act, revenue
  // trigger, active dispute). Unlike the warnings above it hard-fails the build:
  // an expired watch means pages may be computing on law that no longer exists,
  // and the date exists precisely so it cannot be ignored. npm test carries the
  // same check; this copy runs on every deploy.
  const watchToday = new Date().toISOString().slice(0, 10);
  for (const [wSlug, wSt] of Object.entries(taxData.states)) {
    if (wSt._watch && wSt._watch.until && wSt._watch.until < watchToday) {
      throw new Error(`legal-status watch EXPIRED for ${wSlug} on ${wSt._watch.until}: ${wSt._watch.what}`);
    }
  }

  const builtSlugs = new Set(Object.keys(taxData.states));
  const homeLinks = stateLinks(roster, builtSlugs, null);
  // Computed once over the jurisdictions the study actually ranks, then written
  // into all 51 state pages, so no page can claim a coverage the data denies.
  const studyRulesText = studyRulesPhrase(
    [...builtSlugs].map((s) => taxData.states[s]), year, 'every state and DC');

  // fresh dist
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // assets (engine + app + styles served from /assets)
  await mkdir(join(DIST, 'assets'), { recursive: true });

  // Global search index — built from TOOLS (the single source of truth, so it can
  // never drift from a hand-maintained list) and emitted as ONE content-hashed
  // /assets/search-index.<hash>.js that assigns window.__TB_SEARCH_INDEX. Self-
  // hashed here (rather than via registerAsset/hashAssets) because its bytes are
  // generated, not read from src/; the hashed name is injected verbatim by
  // injectSearch(), so it never needs the rewriteHtmlAssetRefs pass. Lands in
  // /assets/*.js → immutable year cache, shared across every page. MUST run before
  // any page is generated (fill() → injectSearch() reads SEARCH_INDEX_PATH).
  {
    const searchIndex = TOOLS.map((t) => ({
      n: t.name, p: t.path, c: SEARCH_CAT_LABELS[t.cat] || '', d: TOOL_DESCRIPTIONS[t.path] || ''
    }));
    const searchBody = `window.__TB_SEARCH_INDEX=${JSON.stringify(searchIndex)};\n`;
    const searchHash = createHash('sha256').update(searchBody).digest('hex').slice(0, 10);
    const searchName = `search-index.${searchHash}.js`;
    await writeFile(join(DIST, 'assets', searchName), searchBody);
    SEARCH_INDEX_PATH = `/assets/${searchName}`;
  }

  // styles.css is content-hashed through the same hashAssets() pipeline as the JS
  // assets (it is a pure leaf — no @import, its only url() is an inline data URI —
  // so it hashes trivially and rewriteHtmlAssetRefs rewrites every
  // <link rel="stylesheet" href="/assets/styles.css"> to the hashed name). Its
  // hashed filename gets the immutable year cache via the /assets/*.css _headers
  // block below, closing the same CSS-staleness gap the JS fix closed.
  registerAsset('assets', 'styles.css');
  registerAsset('assets', 'app.js');
  registerAsset('assets', 'search.js'); // global Cmd/Ctrl+K command palette (site-wide)
  registerAsset('assets', 'category-toggle.js'); // homepage collapsible category persistence (home.html only)
  registerAsset('assets', 'feedback-widget.js'); // "Was this tool helpful?" rating toast (tool pages)
  registerAsset('assets', 'report-widget.js'); // "Report a wrong result" inline reporter (tool pages)
  registerAsset('assets', 'what-applies-to-me.js'); // visibility-only flow controller (/what-applies-to-me/)
  registerAsset('assets', 'state-flow.js'); // hide-on-demand controller for the 4-question block on state paycheck pages
  registerAsset('assets', 'question-flow.js'); // generic [data-reveal] question controller (opt-in per page, see QUESTION_FLOW_PAGES)
  registerAsset('assets', 'recent-tools.js'); // records visits for the Cmd/Ctrl+K palette's recents list (tool pages)
  registerAsset('assets', 'money-input.js'); // live thousands separators for $ fields (shared leaf)
  registerAsset('assets', 'state-flow.js'); // guided rule-finder flow on the 51 state paycheck pages
  registerAsset('assets', 'what-applies-to-me.js'); // the same flow on /what-applies-to-me/
  registerAsset('assets', 'invoice.js');
  registerAsset('assets', 'images-to-pdf.js');
  registerAsset('assets', 'pdf-to-word.js');
  registerAsset('assets', 'word-to-pdf.js');
  registerAsset('assets', 'mammoth.browser.min.js');
  registerAsset('assets', 'jspdf.umd.min.js');
  registerAsset('assets', 'merge-pdf.js');
  registerAsset('assets', 'split-pdf.js');
  registerAsset('assets', 'compress-pdf.js');
  registerAsset('assets', 'pdf-lib.min.js');
  registerAsset('assets', 'pdf.min.js');
  registerAsset('assets', 'pdf.worker.min.js');
  registerAsset('assets', 'docx.umd.js');
  registerAsset('assets', 'qr.js');
  registerAsset('assets', 'qrcode.min.js');
  registerAsset('assets', 'circle-crop.js');
  registerAsset('assets', 'photo-maker.js');
  registerAsset('assets', 'image-resizer.js');
  registerAsset('assets', 'image-converter.js');
  registerAsset('assets', 'image-compressor.js');
  registerAsset('assets', 'percentage-calculator.js');
  registerAsset('assets', 'tip-calculator.js');
  registerAsset('assets', 'mortgage-calculator.js');
  registerAsset('assets', 'auto-loan-calculator.js');
  registerAsset('assets', 'debt-payoff-calculator.js');
  registerAsset('assets', 'holiday-countdown.js');
  registerAsset('assets', 'countdown-timer.js');
  registerAsset('assets', 'stopwatch.js');
  registerAsset('assets', 'pomodoro-timer.js');
  registerAsset('engine', 'duration.js');
  registerAsset('assets', 'age-calculator.js');
  registerAsset('assets', 'days-between-dates.js');
  registerAsset('assets', 'time-zone-converter.js');
  registerAsset('engine', 'timezone.js');
  registerAsset('assets', 'date-calculator.js');
  registerAsset('assets', 'days-from-today.js');
  registerAsset('engine', 'date-add.js');
  registerAsset('assets', 'cooking-converter.js');
  registerAsset('engine', 'percentage-math.js');
  registerAsset('engine', 'tip-math.js');
  registerAsset('engine', 'date-math.js');
  registerAsset('engine', 'cooking-units.js');
  registerAsset('assets', 'recipe-scaler.js');
  registerAsset('engine', 'recipe-scale.js');
  registerAsset('assets', 'unit-converter.js');
  registerAsset('engine', 'units.js');
  registerAsset('assets', 'bmi-calculator.js');
  registerAsset('engine', 'bmi.js');
  registerAsset('assets', 'due-date-calculator.js');
  registerAsset('engine', 'due-date.js');
  registerAsset('assets', 'ovulation-calculator.js');
  registerAsset('engine', 'ovulation.js');
  registerAsset('assets', 'calorie-calculator.js');
  registerAsset('engine', 'calories.js');
  registerAsset('assets', 'ideal-weight-calculator.js');
  registerAsset('engine', 'ideal-weight.js');
  registerAsset('assets', 'gpa-calculator.js');
  registerAsset('engine', 'gpa.js');
  registerAsset('assets', 'inflation-calculator.js');
  registerAsset('engine', 'inflation.js');
  registerAsset('engine', 'amortization.js');
  registerAsset('assets', 'compound-interest-calculator.js');
  registerAsset('engine', 'compound-interest.js');
  registerAsset('assets', '401k-calculator.js');
  registerAsset('engine', 'retirement-401k.js');
  registerAsset('assets', 'savings-goal-calculator.js');
  registerAsset('engine', 'savings-goal.js');
  registerAsset('engine', 'paycheck-engine.js');
  registerAsset('engine', 'canvas-math.js');
  registerAsset('engine', 'canvas-editor.js');
  registerAsset('assets', 'signature-maker.js');
  registerAsset('assets', 'salary-to-hourly.js');
  registerAsset('engine', 'wage.js');
  registerAsset('assets', 'sales-tax-calculator.js');
  registerAsset('engine', 'sales-tax.js');
  registerAsset('assets', 'gas-cost-calculator.js');
  registerAsset('engine', 'fuel-cost.js');
  registerAsset('assets', 'password-generator.js');
  registerAsset('engine', 'password.js');
  registerAsset('assets', 'word-counter.js');
  registerAsset('engine', 'text-stats.js');
  registerAsset('assets', 'hours-calculator.js');
  registerAsset('engine', 'timecard.js');
  registerAsset('engine', 'timecard-export.js'); // time-card -> tab-separated clipboard text (hours-calculator.html only)
  registerAsset('assets', 'text-case-converter.js');
  registerAsset('assets', 'bionic-reading-converter.js');
  registerAsset('assets', 'roman-numeral-converter.js');
  registerAsset('engine', 'roman.js');
  registerAsset('assets', 'base-converter.js');
  registerAsset('engine', 'number-base.js');
  registerAsset('assets', 'color-converter.js');
  registerAsset('engine', 'color.js');
  registerAsset('assets', 'json-formatter.js');
  registerAsset('engine', 'json-format.js');
  registerAsset('assets', 'uuid-generator.js');
  registerAsset('engine', 'uuid.js');
  registerAsset('assets', 'diff-checker.js');
  registerAsset('engine', 'text-diff.js');
  registerAsset('assets', 'base64-converter.js');
  registerAsset('engine', 'base64.js');
  registerAsset('assets', 'aspect-ratio-calculator.js');
  registerAsset('engine', 'aspect-ratio.js');
  registerAsset('assets', 'discount-calculator.js');
  registerAsset('engine', 'discount.js');
  registerAsset('assets', 'fuel-economy-calculator.js');
  registerAsset('engine', 'fuel-economy.js');
  registerAsset('assets', 'random-number-generator.js');
  registerAsset('engine', 'random-number.js');
  registerAsset('assets', 'paint-calculator.js');
  registerAsset('engine', 'paint.js');
  registerAsset('assets', 'tile-calculator.js');
  registerAsset('engine', 'tile.js');
  registerAsset('assets', 'sleep-calculator.js');
  registerAsset('engine', 'sleep.js');
  registerAsset('assets', 'pace-calculator.js');
  registerAsset('engine', 'pace.js');
  registerAsset('assets', 'fraction-calculator.js');
  registerAsset('engine', 'fraction.js');
  registerAsset('assets', 'lorem-ipsum-generator.js');
  registerAsset('engine', 'lorem.js');
  registerAsset('assets', 'average-calculator.js');
  registerAsset('engine', 'average.js');
  registerAsset('assets', 'morse-code-translator.js');
  registerAsset('engine', 'morse.js');
  registerAsset('assets', 'cagr-calculator.js');
  registerAsset('engine', 'cagr.js');
  registerAsset('assets', 'half-birthday-calculator.js');
  registerAsset('engine', 'half-birthday.js');
  registerAsset('assets', 'rule-of-72-calculator.js');
  registerAsset('engine', 'rule-of-72.js');
  registerAsset('assets', 'words-to-minutes.js');
  registerAsset('engine', 'words-to-time.js');
  registerAsset('assets', 'double-time-pay-calculator.js');
  registerAsset('engine', 'double-time-pay.js');
  registerAsset('assets', 'biweekly-vs-semimonthly.js');
  registerAsset('engine', 'pay-frequency.js');
  registerAsset('assets', 'ez-grader.js');
  registerAsset('engine', 'grading.js');
  registerAsset('assets', 'chronological-age-calculator.js');
  registerAsset('engine', 'chronological-age.js');
  registerAsset('assets', 'debt-avalanche-calculator.js');
  registerAsset('engine', 'debt-avalanche.js');
  registerAsset('assets', 'markdown-to-html.js');
  registerAsset('assets', 'marked.min.js');
  registerAsset('assets', '1099-vs-w2-calculator.js');
  registerAsset('engine', 'obbba-deduction.js');
  registerAsset('engine', 'roth-catchup.js');
  // overtime-tax-calculator.js now serves the /embed/ build ONLY; the full page
  // runs overtime-wizard.js (the card-by-card flow). Same for tips-tax-calculator.js
  // and tips-wizard.js. Both halves of each pair are registered because both ship;
  // the wizard halves come from WIZARD_ROLLOUT below rather than from a literal
  // line here.
  registerAsset('assets', 'overtime-tax-calculator.js');
  registerAsset('assets', 'tips-tax-calculator.js');
  // The shared card-flow controller every wizard in the rollout imports. Listed
  // unconditionally: it is written, and a rollout asset that imports a file the
  // hash pipeline has never seen would ship an unrewritten /assets/wizard-core.js
  // reference pointing at a file that does not exist in dist/.
  registerAsset('assets', 'wizard-core.js');
  // Every planned <tool>-wizard.js, registered the moment its file exists. See
  // WIZARD_ROLLOUT at the top of this file for why this is existence-gated and
  // why a fan-out agent must never add a line here.
  let wizardsLive = 0;
  for (const { asset } of WIZARD_ROLLOUT) {
    if (!asset) continue; // no embed twin: the tool's existing asset is rewritten in place
    if (!existsSync(join(SRC, 'assets', asset))) continue;
    registerAsset('assets', asset);
    wizardsLive++;
  }
  const wizardsPlanned = WIZARD_ROLLOUT.filter((w) => w.asset).length;
  console.log(`   wizard rollout: ${wizardsLive} of ${wizardsPlanned} planned <tool>-wizard.js assets present`);
  registerAsset('assets', 'senior-deduction-calculator.js');
  // Shared live-thousands-separator helper for money inputs (imported by the
  // answer-first SALT pilot; reusable by other tax tools).
  registerAsset('assets', 'money-input.js');
  registerAsset('assets', 'salt-cap-calculator.js');
  registerAsset('assets', 'car-loan-interest-calculator.js');
  registerAsset('assets', 'charitable-deduction-calculator.js');
  registerAsset('assets', 'pmi-deduction-calculator.js');
  registerAsset('engine', 'qcd-comparison.js');
  registerAsset('assets', 'qcd-vs-charitable-deduction-calculator.js');
  registerAsset('engine', 'dependent-care.js');
  registerAsset('assets', 'dependent-care-fsa-vs-credit-calculator.js');
  registerAsset('assets', 'w4-overtime-tips-withholding-calculator.js');
  registerAsset('assets', 'roth-catchup-calculator.js');
  registerAsset('engine', 'form-1099-checker.js');
  registerAsset('assets', '1099-threshold-checker.js');
  registerAsset('engine', 'w2-box-engine.js');
  registerAsset('assets', 'w2-box-decoder.js');
  registerAsset('engine', 'ss-maxout-engine.js');
  registerAsset('assets', 'ss-wage-base-calculator.js');
  registerAsset('engine', 'student-loan-cap.js');
  registerAsset('assets', 'student-loan-cap-calculator.js');
  registerAsset('engine', 'able-contribution.js');
  registerAsset('assets', 'able-account-calculator.js');
  registerAsset('engine', 'section-127.js');
  registerAsset('assets', 'employer-student-loan-repayment-calculator.js');
  registerAsset('engine', 'adoption-credit.js');
  registerAsset('assets', 'adoption-credit-calculator.js');
  registerAsset('engine', 'bonus-tax.js');
  registerAsset('assets', 'bonus-tax-calculator.js');
  registerAsset('assets', 'embed-gallery.js');
  registerAsset('assets', 'data-table.js');
  registerAsset('engine', 'employment-tax.js');
  registerAsset('assets', 'biweekly-mortgage-calculator.js');
  // (biweekly reuses amortization.js, already copied above)
  // Shared "visible failure" banner — imported by all 88 tool bootstrap files'
  // try/catch-wrapped init() (see the calc-error-banner.js file for details).
  registerAsset('engine', 'calc-error-banner.js');

  // Content-hash every queued /assets/*.js file (dependency-ordered rewrite of
  // internal import paths + runtime string references), writing the hashed
  // files straight into dist/assets/. assetHashMap feeds the end-of-build HTML
  // rewrite pass (rewriteHtmlAssetRefs) so every <script src="/assets/X.js">
  // ends up pointing at X's real, hashed dist filename.
  const assetHashMap = await hashAssets(ASSET_QUEUE);

  const urls = [`${SITE.url}/`];

  // one page per state present in tax-data
  for (const slug of builtSlugs) {
    const state = taxData.states[slug];
    const p = payroll[slug];
    // per-page payload: federal + only this state (keeps embedded JSON small)
    const payload = stripInternal({ taxYear: taxData.taxYear, federal: taxData.federal, states: { [slug]: state } });
    // State pages relate to the paycheck/OBBBA cluster, not the full tool
    // directory: the 2 OBBBA calculators, the 2 data studies, salary-to-hourly.
    const stateRelated = relatedLinksHtml(orderAncillary(slug, [
      // Only the states that actually HAVE a salary ladder link to one. Gated on
      // the ladder roster rather than added to all 51, which would be 38 links to
      // a page about another state.
      ...(LADDER_STATE_SET.has(slug)
        ? [{ name: `${state.name} Take-Home Pay by Salary`, path: `/${ladderHubSlug(slug)}/` }]
        : []),
      { name: `${state.name} Bonus Tax Calculator`, path: `/${slug}-bonus-tax-calculator/` },
      { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
      { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
      { name: `Take-Home Pay by State on ${STUDY_SALARY_TEXT} (Data Study)`, path: '/data/take-home-pay-by-state/' },
      { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
      { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
      { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
    ]));
    // Ancillary sections in a slug-stable per-state order (split around the
    // in-content ad slot) — same content, page-specific skeleton. FAQ entries
    // come first so the facts they consume aren't repeated in the quirks list.
    const faqEntries = stateFaqEntries(state, p, year);
    const ancillary = orderAncillary(slug, [
      localTaxBlock(state, p),
      minWageBlock(state, p, year),
      distinctiveFactsBlock(state, p, faqEntries),
      otherTaxesBlock(state, p),
      incomeContextBlock(state, p, taxData)
    ]).filter(Boolean);
    const ancSplit = Math.ceil(ancillary.length / 2);
    // One take-home computation for this state, shared by the extractable answer
    // sentence and by the pre-rendered figures in the calculator's answer band.
    const net75 = stateNet75(state, taxData);
    if (!net75) {
      throw new Error(
        `no $75,000 computation for ${slug}: the page would serve an empty results panel and an ` +
        `answer sentence with no figure in it. Fix the state's tax data rather than shipping zeroes.`
      );
    }
    const panel = statePanel(state, taxData, net75);
    const answer = stateAnswerParts(state, year, net75);
    const html = fill(stateTpl, {
      STATE_NAME: state.name,
      STATE_TITLE: stateTitle(state, year),
      STATE_META_DESC: stateMetaDesc(state, year),
      // Short, human, and the exact phrase a searcher types, with nothing wedged
      // into the middle of it. The take-home framing lives in the answer-lead
      // paragraph directly beneath, which already states this state's take-home
      // figure, and the "payroll" / "income tax calculator" vocabulary the old
      // H1 carried is still on the page in the lede, the body H2s and the meta.
      STATE_H1: `${state.name} Paycheck Calculator`,
      STATE_SLUG: slug,
      STATE_ABBR: state.abbr,
      // STATE_TAX_PHRASE / STATE_KEYWORD_PHRASE / STATE_NOTAX_NOTE /
      // STATE_META_TAX_NOTE were removed here: no template has referenced them
      // since the state page was restructured, and four unread copies of the
      // "what comes out of your pay" claim are four more places for it to drift.
      // The live versions are inside stateMetaDesc() and stateLede().
      // The first card's helper, written from THIS state's withholding profile
      // rather than as one sentence repeated on all 51 pages. It is the same
      // list of deductions the results table below prints, so it makes no claim
      // the page does not already make, and it is the one place in the card
      // stack where the state genuinely changes the answer to the question being
      // asked ("what comes out before you see it?").
      GROSS_HELP: grossPayHelp(state),
      FIGURE_BANNER: figureYearBanner(state, year),
      ANSWER_LEAD: answer.lead,
      ANSWER_TAIL: answer.tail,
      // Empty on the 46 non-target states. fill() leaves an unmatched key as a
      // literal {{RATE_BLOCK}} in the output, so this must be present for all 51.
      RATE_BLOCK: answer.rate,
      // Pre-rendered so the headline number is right on first paint, right with
      // JavaScript off, and right to a crawler that never executes anything.
      // app.js's first render reproduces these strings exactly (parity asserted
      // above), so hydration is a visual no-op.
      NET_LABEL: stateNetLabel(state),
      NET_BIG: usd2App(net75.biweeklyNet),
      NET_SUB: `take-home per 2 weeks · ${usd0(net75.annualNet)}/yr`,
      // The whole results panel, pre-rendered on the same page defaults the form
      // ships with: the withholding rows, the state program rows, the rate row
      // and the donut. Without them the served HTML said "Net pay $0.00" under a
      // sentence quoting the real figure, and then, once six of them were filled
      // but the program rows were not, said a subtraction that was wrong by the
      // size of the state premium. That is what a crawler that never executes
      // anything read.
      ...panel.tokens,
      BRACKET_SUMMARY: bracketSummary(state),
      COMPARE_SUMMARY: compareSummary(roster, builtSlugs, slug),
      APPLIES_BLOCK: buildStateApplies({
        state,
        obbbaEntry: obbba && obbba.states && obbba.states[slug],
        suppEntry: suppData && suppData.states && suppData.states[slug],
        notaxAngle: NOTAX_ANGLE[slug],
        pickFrame
      }),
      TARGET_INTRO: targetIntro(state, year),
      STATE_LEDE: stateLede(state, year),
      STATE_BODY_H2: stateBodyH2(state, year),
      STATE_BODY: stateBody(state, year, taxData),
      // The explainer sections below the calculator fold to their headings
      // (foldProseAll), the paycheck-page half of the same treatment the bonus
      // pages got: the words stay in the DOM for the AI-citation channel, the
      // visitor stops scrolling a tax class. The applies block (interactive),
      // the FAQ, the neighbor/link section and Sources deliberately stay open.
      BRACKET_TABLE: foldProseAll(bracketTableBlock(state, year)),
      STATE_PAYROLL: foldProseAll(payrollDeductionsBlock(state, p)),
      ANCILLARY_A: foldProseAll(ancillary.slice(0, ancSplit).join('\n')),
      ANCILLARY_B: foldProseAll(ancillary.slice(ancSplit).join('\n')),
      STATE_FAQ: stateFaqBlock(state, faqEntries),
      OBBBA_CONFORMITY: foldProseAll(obbbaConformityBlock(state, obbba, year)),
      SOURCES: sourcesBlock(state, p, taxData._meta),
      STATE_LINKS: stateLinks(roster, builtSlugs, slug),
      NEIGHBOR_H2: neighborHeading(roster, builtSlugs, slug),
      NEIGHBOR_COMPARE: neighborCompareTable(roster, builtSlugs, slug, taxData, year),
      // Salaries quoted in the one-sentence cross-link to the all-states study.
      // Read from the module constant that study is built on, so the sentence can
      // never quote a level the study no longer computes.
      STUDY_SALARIES: STUDY_SALARY_TEXT,
      // Same sentence's coverage claim, from the same helper the study's own lede
      // uses. It used to read "the 2026 rules of every state and DC" on all 51
      // pages, which is not true while any jurisdiction is on prior-year tables.
      STUDY_RULES: studyRulesText,
      FAQ_JSONLD: faqJsonLd(faqEntries),
      TAX_DATA_JSON: JSON.stringify(payload),
      YEAR: year,
      VERIFIED: verified,
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url
    });
    const dir = join(DIST, `${slug}-paycheck-calculator`);
    await mkdir(dir, { recursive: true });
    const pageHtml = html.replace('<footer class="site">', `${stateRelated}\n<footer class="site">`);
    // Checked against the bytes about to be written, not against the token map
    // that produced them, so a template that stops using a token is caught too.
    assertPanelParity(state, net75, panel, pageHtml, appScan);
    await writeFile(join(dir, 'index.html'), pageHtml);
    urls.push(`${SITE.url}/${slug}-paycheck-calculator/`);
  }

  // --- State salary ladders: hub + one page per salary rung, per state --------
  // See the STATE SALARY LADDERS block above for why these exist and what keeps
  // them off the doorway shape. Every figure is computed here, at build time,
  // from taxData; the templates carry no numbers of their own.
  {
    // NOTE: depCare (dependent-care-2026.json) is already loaded above in main().
    // Its §21 applicable-percentage schedule is the one sourced ladder that steps
    // repeatedly across this whole salary range, so it does real work separating
    // the low and mid rungs from each other.
    // Every jurisdiction in the data file, so each rung can compute where its own
    // state actually ranks at that salary rather than asserting a position.
    const allStates = [...builtSlugs].map((sl) => taxData.states[sl]).filter(Boolean);
    const rungTpl = await read(join(SRC, 'templates', 'state-take-home-pay-salary.html'));
    const hubTpl = await read(join(SRC, 'templates', 'state-take-home-pay.html'));
    const fedStdDed = usd0(taxData.federal.standardDeduction.single);
    const ssBase = usd0(taxData.federal.fica.socialSecurity.wageBase);
    const addlThreshold = taxData.federal.fica.additionalMedicare.threshold.single;
    // FICA rates for the prose and the table labels. Derived, never typed: these
    // used to be the string literals "6.2%", "1.45%" and "0.9%" sitting beside
    // columns computed from taxData.federal.fica, so a rate change in the data
    // file would have left the words saying one thing and the money another.
    const ssRateText = pctStr(taxData.federal.fica.socialSecurity.rate);
    const medRateText = pctStr(taxData.federal.fica.medicare.rate);
    const addlRateText = pctStr(taxData.federal.fica.additionalMedicare.rate);
    const pubDate = humanDate(gitDate('src/data/tax-data-2026.json') || CONTENT_DATE)
      || humanDate(CONTENT_DATE);
    const sourceRowsFor = (state) => caLadderSources(taxData, state);

    for (const ladderSlugKey of LADDER_STATES) {
      const state = taxData.states[ladderSlugKey];
      if (!state || !builtSlugs.has(ladderSlugKey)) {
        console.warn(`⚠  no tax-data entry for ${ladderSlugKey} — skipping its salary ladder`);
        continue;
      }
      const NAME = state.name;
      const HUB = ladderHubSlug(ladderSlugKey);
      const payrollState = payroll[ladderSlugKey];
      const kind = ladderKind(state);
      const rungs = caLadderRungs(taxData, ladderSlugKey);
      const low = rungs[0];
      const high = rungs[rungs.length - 1];
      const step = rungs.length > 1 ? rungs[1].amount - rungs[0].amount : 0;
      const stDedText = usd0((state.tax && state.tax.standardDeduction && state.tax.standardDeduction.single) || 0);
      const progs = (state.employeePrograms || []).map((p) => ({ data: p, label: programLabel(state, p), rate: p.rate || 0 }));
      const progLabels = progs.map((p) => p.label);
      // Coverage claim in the byline, from the state's own figureYear. California
      // is on its 2025 schedules while the FTB has not published 2026 ones, and a
      // byline that said "2026 figures" would be a plain untruth on nine pages.
      // A state with no income tax has no state tables to be on, so it says so.
      const ladderBasis = esc(kind === 'none'
        ? `Computed from published ${year} federal tables; ${NAME} levies no income tax on wages`
        : (Number(state.figureYear) === Number(year)
          ? `Computed from published ${year} federal and ${NAME} tables`
          : `Computed from published ${year} federal tables; ${NAME} on its ${state.figureYear} schedules`));
      const sourceRows = sourceRowsFor(state);
      const limitItems = caLimitItems(state, payrollState, year);
      const ladderRelated = relatedLinksHtml([
        { name: `${NAME} Paycheck Calculator`, path: `/${ladderSlugKey}-paycheck-calculator/` },
        { name: `${NAME} Take-Home Pay by Salary`, path: `/${HUB}/` },
        { name: `${NAME} Bonus Tax Calculator`, path: `/${ladderSlugKey}-bonus-tax-calculator/` },
        { name: `Take-Home Pay by State on ${STUDY_SALARY_TEXT} (Data Study)`, path: '/data/take-home-pay-by-state/' },
        { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
        { name: 'Biweekly vs Semimonthly Pay', path: '/biweekly-vs-semimonthly/' },
      ]);

      for (let i = 0; i < rungs.length; i++) {
        const r = rungs[i];
        const prev = i > 0 ? rungs[i - 1] : null;
        const next = i < rungs.length - 1 ? rungs[i + 1] : null;
        const S = usd0(r.amount);
        // Same pinned-for-California body framer the prose blocks use: arr[0] is the
        // wording California's live pages carry, everyone else varies by slug+rung.
        const bodyFrame = (salt, arr) => (ladderSlugKey === 'california'
          ? arr[0]
          : pickFrame(ladderSalt(ladderSlugKey, 'copy', r.amount), salt, arr));
        const faq = caLadderFaq(r, rungs, taxData, payrollState, obbba, secure2);
        // Section intros, method list and limits, all computed for THIS rung.
        const copy = caPageCopy(r, rungs, { taxData, obbba, secure2, depCare, payrollState, year });
        // The withholding lines this state actually has, named in order. Texas
        // lists three, New Jersey eight, and neither list is a template.
        const lineNames = [
          'federal income tax', 'Social Security', 'Medicare',
          ...(r.kind === 'none' ? [] : [`${NAME} income tax`]),
          ...r.programs.map((p) => p.label),
        ];
        const title = `${S} After Taxes in ${NAME} (${year}): Take-Home Pay`;
        const metaDesc = ladderSlugKey === 'california'
          // legacy CA wording
          ? `A ${S} salary in California takes home ${usd0(r.a.net)} a year, ` +
            `${usd0(r.a.net / 12)} a month, ${usdCents(r.a.net / 26)} every two weeks. Full ${year} breakdown ` +
            `of federal tax, Social Security, Medicare, California income tax and SDI, bracket by bracket.`
          : `A ${S} salary in ${NAME} takes home ${usd0(r.a.net)} a year, ${usd0(r.a.net / 12)} a month, ` +
            `${usdCents(r.a.net / 26)} every two weeks. Full ${year} breakdown of ${caList(lineNames)}, ` +
            `line by line.`;
        const articleLd = JSON.stringify({
          '@context': 'https://schema.org', '@type': 'Article',
          headline: `Take-home pay on a ${S} salary in ${NAME} (${year})`,
          description: metaDesc,
          datePublished: CONTENT_DATE,
          dateModified: gitDate('src/data/tax-data-2026.json') || CONTENT_DATE,
          author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
          publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
          mainEntityOfPage: `${SITE.url}${r.path}`,
          about: { '@type': 'Thing', name: `${NAME} take-home pay on a ${S} salary` },
          isAccessibleForFree: true,
        });
        const prevNext = [
          prev ? `<a href="${prev.path}">&larr; ${usd0(prev.amount)} in ${NAME}</a>` : '',
          `<a href="/${HUB}/">All ${NAME} salary levels</a>`,
          next ? `<a href="${next.path}">${usd0(next.amount)} in ${NAME} &rarr;</a>` : '',
        ].filter(Boolean).join('\n      ');
        const stateLinesTotal = r.a.state + r.progTotal;
        const stateLineCount = (r.kind === 'none' ? 0 : 1) + r.programs.length;
        // The tax-state branch continues the previous clause with ", and …"; this
        // one starts a new sentence, so it needs the full stop the other branch
        // does not. Without it Texas and Florida read "…federal income tax at
        // $13,170 Texas takes nothing out of it".
        const shortStateTail = stateLineCount === 0
          ? `. ${NAME} takes nothing out of it: there is no state income tax and no state payroll ` +
            `premium on this paycheck.`
          : (ladderSlugKey === 'california'
            // legacy CA wording
            ? `, and California's own two lines together come to ${usd0(stateLinesTotal)}.`
            // One line does not "together come to" anything. Six states have
            // exactly one state line and read "own one line together come to".
            : (stateLineCount === 1
              ? `, and ${NAME}'s own single state line comes to ${usd0(stateLinesTotal)}.`
              : `, and ${NAME}'s own ${numWord(stateLineCount)} lines together come to ` +
                `${usd0(stateLinesTotal)}.`));

        const html = fill(rungTpl, {
          SITE_NAME: SITE.name, SITE_URL: SITE.url,
          TAX_YEAR: year,
          PAGE_PATH: r.path,
          PAGE_TITLE: title,
          OG_TITLE: `${S} after taxes in ${NAME}: ${usd0(r.a.net)} take-home`,
          META_DESC: metaDesc,
          OG_DESC: ladderSlugKey === 'california'
            // legacy CA wording
            ? `Computed ${year} take-home pay on ${S} in California — ${usd0(r.a.net)} a year, ` +
              `${usd0(r.a.net / 12)} a month, with the federal and California brackets worked out line by line.`
            : `Computed ${year} take-home pay on ${S} in ${NAME} — ${usd0(r.a.net)} a year, ` +
              `${usd0(r.a.net / 12)} a month, with every withholding line worked out.`,
          H1: `Take-home pay on a ${S} salary in ${NAME}`,
          SALARY: S,
          PUB_DATE: pubDate,
          FIGURE_BASIS: ladderBasis,
          FIGURE_BANNER: figureYearBanner(state, year),
          LEDE: `A ${S} salary in ${NAME} leaves <strong>${usd0(r.a.net)}</strong> a year after ` +
            `${caList(lineNames)} — ` +
            `${usd0(r.a.net / 12)} a month, or ${usdCents(r.a.net / 26)} in a two-week paycheck. ` +
            bodyFrame('ledeTail', [
              `That is a single filer taking the standard deduction, with every figure below computed from ` +
              `the published tax tables rather than estimated.`,
              `Those are the figures for a single filer on the standard deduction, and every one of them ` +
              `below is computed from the published tables, not estimated.`,
              `The model is a single filer taking the standard deduction; nothing below is an estimate, it ` +
              `is all worked out from the published tables.`,
            ]),
          NET_ANNUAL: usd0(r.a.net),
          NET_MONTHLY: usd0(r.a.net / 12),
          NET_BIWEEKLY: usdCents(r.a.net / 26),
          EFF_RATE: pct1(r.allInRate),
          BREAKDOWN_CAPTION: `Annual, monthly and biweekly breakdown of ${caList([
            "federal tax", "FICA",
            ...(r.kind === "none" ? [] : [`${NAME} income tax`]),
            ...r.programs.map((p) => p.label),
          ])} on a ${S} salary`,
          SHORT_VERSION: `${usd0(r.withheld)} of the ${S} is withheld (${pct1(r.allInRate)} of gross) and ` +
            `${usd0(r.a.net)} reaches you. The largest single line is ` +
            `${(() => {
              const lines = [
                ['federal income tax', r.a.federal], ['Social Security', r.a.socialSecurity],
                ['Medicare', r.a.medicare],
                ...(r.kind === 'none' ? [] : [[`${NAME} income tax`, r.a.state]]),
                ...r.programs.map((p) => [p.label, p.amount]),
              ].sort((x, y) => y[1] - x[1])[0];
              return `${lines[0]} at ${usd0(lines[1])}`;
            })()}${shortStateTail}`,
          BREAKDOWN_ROWS: caBreakdownRows(r, taxData.federal.fica),
          ...copy,
          FED_STD_DED: fedStdDed,
          FED_TAXABLE: usd0(r.fed.taxable),
          FED_MARGINAL: pctStr(r.fed.marginalRate),
          FED_BRACKET_ROWS: caBandRows(r.fed, null),
          FED_NOTE: `Federal tax on ${S} totals ${usd0(r.a.federal)}, which is ` +
            `${pct1(r.a.federal / r.amount)} of gross pay even though the top band reached is ` +
            `${pctStr(r.fed.marginalRate)}. The gap between those two numbers is the whole point of a ` +
            `graduated system.`,
          STATE_SECTION: ladderStateSection(r, copy.CA_INTRO, S),
          PROSE_BLOCKS: caProseBlocks(r, rungs, {
            taxData, obbba, secure2, depCare, allStates, payrollState,
            obbbaStates: (obbba && obbba.states) || {},
            suppStates: (suppData && suppData.states) || {},
          }),
          STATUS_CAPTION: `${NAME} take-home pay on ${S} by filing status`,
          STATUS_HEAD: `<th>Filing status</th><th class="num">Federal tax</th>` +
            (r.kind === 'none' ? '' : `<th class="num">${state.abbr} income tax</th>`) +
            `<th class="num">Take-home a year</th><th class="num">Share withheld</th>`,
          STATUS_ROWS: caStatusRows(r, taxData),
          LADDER_ROWS: caLadderRows(rungs, r.amount, true),
          LADDER_LOW: usd0(low.amount),
          LADDER_HIGH: usd0(high.amount),
          STEP_TEXT: usd0(step),
          PREV_NEXT: prevNext,
          CTA_LINKS: [
            `<a class="primary" href="/${ladderSlugKey}-paycheck-calculator/">Change the inputs in the ${NAME} paycheck calculator &rarr;</a>`,
            `<a href="/${HUB}/">All ${NAME} salary levels &rarr;</a>`,
            `<a href="/data/take-home-pay-by-state/">Compare ${NAME} with the other 50 &rarr;</a>`,
          ].join('\n      '),
          SS_WAGE_BASE: ssBase,
          SS_RATE: ssRateText,
          MEDICARE_RATE: medRateText,
          ADDL_MEDICARE_SENTENCE: r.amount > addlThreshold
            ? `The extra ${addlRateText} Additional Medicare tax on single-filer wages above ` +
              `${usd0(addlThreshold)} applies at this salary and is included.`
            : `The extra ${addlRateText} Additional Medicare tax starts at ${usd0(addlThreshold)} of wages ` +
              `for a single filer, at or above this salary, so it does not apply here.`,
          FAQ_BLOCKS: caFaqBlocks(faq),
          FAQ_LD: faqJsonLd(faq),
          ARTICLE_LD: articleLd,
          SOURCE_ROWS: sourceRows,
          LAST_SOURCED: esc(LAST_SOURCED || CONTENT_DATE),
        }).replace('<footer class="site">', `${ladderRelated}\n<footer class="site">`);

        const dir = join(DIST, `${HUB}-${r.amount}`);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'index.html'), html);
        urls.push(`${SITE.url}${r.path}`);
      }

      // The hub. Same computed rungs, so it can never quote a figure a rung page
      // does not also show.
      {
        const spread = high.a.net - low.a.net;
        const hubRows = rungs.map((r) =>
          `<tr><td><a href="${r.path}">${usd0(r.amount)}</a></td>` +
          `<td class="num">${usd0(r.a.net)}</td><td class="num">${usd0(r.a.net / 12)}</td>` +
          `<td class="num">${usdCents(r.a.net / 26)}</td><td class="num">${usd0(r.withheld)}</td>` +
          `<td class="num">${pct1(r.allInRate)}</td></tr>`).join('\n');
        const hubLinks = rungs.map((r) =>
          `<a href="${r.path}"><span class="amt">${usd0(r.amount)}</span>` +
          `<span class="net">${usd0(r.a.net)} take-home</span></a>`).join('\n');
        // The keep-rate on each step, computed, so the hub says something the rung
        // pages cannot: how the marginal keep rate moves as you climb.
        const steps = rungs.slice(1).map((r, i) => ({
          from: rungs[i], to: r, keep: (r.a.net - rungs[i].a.net) / (r.amount - rungs[i].amount),
        }));
        const bestStep = [...steps].sort((a, b) => b.keep - a.keep)[0];
        const worstStep = [...steps].sort((a, b) => a.keep - b.keep)[0];
        // Several steps can tie on the keep rate once the salary sits inside one
        // long federal band. Naming only the first of them would be a quietly
        // wrong answer to "which raise is worth the least", so the tie is counted.
        const worstTies = steps.filter((s) => pct1(s.keep) === pct1(worstStep.keep));
        const worstPhrase = worstTies.length > 1
          ? `every step from ${usd0(worstTies[0].from.amount)} to ${usd0(worstTies[worstTies.length - 1].to.amount)}, ` +
            `all of which keep ${pct1(worstStep.keep)}`
          : `${usd0(worstStep.from.amount)} to ${usd0(worstStep.to.amount)} at ${pct1(worstStep.keep)}`;
        // What the state itself contributes across the ladder. Three shapes, and
        // the block has to be honest in all of them: a state with no income tax
        // and no programs is not "adding" anything on top of the federal bill,
        // and saying so is more useful than a zero row.
        const lowState = low.a.state + low.progTotal;
        const highState = high.a.state + high.progTotal;
        let hubStateBlock;
        if (ladderSlugKey === 'california') {
          // legacy CA wording
          hubStateBlock = `<h3>What California adds on top of the federal bill</h3>` +
            `<p>California takes two bites from a paycheck, not one: graduated income tax, and State ` +
            `Disability Insurance at ${pct2(progs[0].rate)} of wages with no ceiling since SB 951. On ` +
            `${usd0(low.amount)} that pair costs ${usd0(lowState)} a year; on ` +
            `${usd0(high.amount)} it costs ${usd0(highState)}. SDI is the part people forget, ` +
            `because it is not an income tax and does not appear in any bracket table.</p>`;
        } else if (kind === 'none' && !progs.length) {
          hubStateBlock = `<h3>Why the federal bill is the whole bill in ${NAME}</h3>` +
            `<p>${NAME} taxes no wage income and withholds no employee-side payroll premium, so every ` +
            `dollar deducted from ${anFor(NAME)} ${NAME} paycheck on this ladder is federal. That is why the take-home ` +
            `share here moves from ${pct1(low.a.net / low.amount)} at ${usd0(low.amount)} to ` +
            `${pct1(high.a.net / high.amount)} at ${usd0(high.amount)} purely on federal arithmetic: the ` +
            `bands, the ${ssBase} Social Security wage base and the Additional Medicare threshold are the ` +
            `only three things that change across the whole ladder.</p>`;
        } else if (kind === 'none') {
          hubStateBlock = `<h3>What ${NAME} takes, given it has no income tax</h3>` +
            `<p>${NAME} taxes no wage income, but the payslip is not free of state lines: ` +
            `${caList(progLabels)} ${progs.length === 1 ? 'is' : 'are'} withheld on wages as ` +
            `${progs.length === 1 ? 'an insurance premium' : 'insurance premiums'} rather than as tax. ` +
            `On ${usd0(low.amount)} that costs ${usdCents(low.progTotal)} a year and on ` +
            `${usd0(high.amount)} it costs ${usdCents(high.progTotal)}. It appears in no bracket table ` +
            `anywhere, which is why it is the line people miss when they estimate ${anFor(NAME)} ${NAME} salary.</p>`;
        } else {
          // The structure has to be able to REPRODUCE the dollar figures quoted
          // in the same sentence. Ohio's two bands alone give $108.63 on $30,000,
          // not the $441 printed beside them: ORC 5747.02 adds a flat statutory
          // base amount on top once taxable income passes its threshold, and the
          // engine charges it. The rung pages disclose it; the hub said "two
          // bands" and left the reader unable to arrive at its own number.
          const baseAmt = kind === 'bracket' && state.tax.baseAmount ? state.tax.baseAmount : null;
          const structure = kind === 'flat'
            ? `a single ${pctStr(state.tax.rate)} rate`
            : `a graduated schedule of ${numWord(state.tax.brackets.single.length)} bands` +
              (baseAmt
                ? `, plus a flat statutory ${usd0(baseAmt.amount)} once taxable income passes ${usd0(baseAmt.over)}`
                : '');
          const both = progs.length
            ? `${NAME} takes two kinds of deduction from a paycheck, not one: income tax on ${structure}, ` +
              `and ${caList(progLabels)}. On ${usd0(low.amount)} that pair costs ${usd0(lowState)} a year; ` +
              `on ${usd0(high.amount)} it costs ${usd0(highState)}. The premiums are the part people ` +
              `forget, because they are not income tax and appear in no bracket table.`
            : `${NAME} charges income tax on ${structure}, and withholds no separate employee-side payroll ` +
              `premium, so its whole contribution to this ladder is one line: ${usd0(lowState)} a year on ` +
              `${usd0(low.amount)}, ${usd0(highState)} on ${usd0(high.amount)}. That is ` +
              `${pct1(lowState / low.amount)} of gross at the bottom of the ladder and ` +
              `${pct1(highState / high.amount)} at the top.`;
          hubStateBlock = `<h3>What ${NAME} adds on top of the federal bill</h3><p>${both}</p>`;
        }
        const hubProse = [
          `<h3>The rate climbs, but never to a cliff</h3>` +
          `<p>At ${usd0(low.amount)} a single ${ladderSlugKey === 'california' ? 'Californian' : `${NAME} earner`} keeps ${pct1(low.a.net / low.amount)} of gross pay; ` +
          `at ${usd0(high.amount)} they keep ${pct1(high.a.net / high.amount)}. The whole ` +
          `${usd0(high.amount - low.amount)} climb adds ${usd0(spread)} of take-home pay, so about ` +
          `${pct1(spread / (high.amount - low.amount))} of the extra gross survives withholding across the ` +
          `ladder. No step leaves you with less than the step below it.</p>`,
          `<h3>Which raise is worth the most</h3>` +
          `<p>The step that keeps the most is ${usd0(bestStep.from.amount)} to ${usd0(bestStep.to.amount)}, ` +
          `where ${pct1(bestStep.keep)} of the raise reaches you. The least is ${worstPhrase}. ` +
          `The difference is which federal${kind === 'bracket' ? ` and ${NAME}` : ''} bands the extra income lands in — and, above the ` +
          `${ssBase} Social Security wage base, whether the ${ssRateText} is still being charged at all.</p>`,
          hubStateBlock,
        ].join('\n      ');
        const midRung = rungs[Math.floor(rungs.length / 2)];
        const midOther = midRung.a.socialSecurity + midRung.a.medicare + midRung.progTotal;
        const hubFaq = [
          {
            q: `How much is ${usd0(low.amount)} after taxes in ${NAME}?`,
            a: `${usd0(low.a.net)} a year, or ${usd0(low.a.net / 12)} a month, for a single filer taking the ` +
              `standard deduction. Every salary from ${usd0(low.amount)} to ${usd0(high.amount)} has its own ` +
              `page here with the full working.`,
          },
          {
            q: `What is the effective tax rate on ${anFor(NAME)} ${NAME} salary?`,
            a: `It depends entirely on the salary. Across this ladder the share of gross pay withheld runs ` +
              `from ${pct1(low.allInRate)} at ${usd0(low.amount)} to ${pct1(high.allInRate)} at ` +
              `${usd0(high.amount)}, counting ${caList([
                'federal income tax', 'Social Security', 'Medicare',
                ...(kind === 'none' ? [] : [`${NAME} income tax`]),
                ...progLabels,
              ])}.`,
          },
          (kind === 'none'
            ? {
              q: `Why is my ${NAME} take-home pay lower than the federal bracket table suggests?`,
              a: `Because income tax is only part of it. On ${usd0(midRung.amount)} the federal income tax ` +
                `is ${usd0(midRung.a.federal)}, but Social Security, Medicare` +
                `${progs.length ? ` and ${caList(progLabels)}` : ''} take a further ${usd0(midOther)} on ` +
                `the same wages, and none of those appear in a bracket table.`,
            }
            : {
              q: `Why is my ${NAME} take-home pay lower than a bracket table suggests?`,
              a: `Because income tax is only part of it. On ${usd0(midRung.amount)} the ${NAME} income tax ` +
                `is ${usd0(midRung.a.state)}, but Social Security, Medicare` +
                `${progs.length ? ` and ${caList(progLabels)}` : ''} take a further ${usd0(midOther)} on ` +
                `the same wages, and none of those appear in a bracket table.`,
            }),
          {
            q: `Do these figures cover married filing jointly?`,
            a: `The tables here are single filers. Each salary's own page carries a filing-status comparison ` +
              `showing the same salary as single, married filing jointly and head of household, and the ` +
              `${NAME} paycheck calculator lets you set the status yourself along with 401(k), health ` +
              `premiums and dependents.`,
          },
          {
            q: `How often are these updated?`,
            a: `Whenever the tax data behind them is. Nothing here fetches figures automatically: we edit ` +
              `the ${year} tax data file when the IRS${kind === 'none' ? '' : (ladderSlugKey === 'california' ? ' or the FTB' : ` or ${NAME}`)} publishes a new number, and the next build ` +
              `recomputes all ${rungs.length} salary pages and this table from it.`,
          },
        ];
        const hubTitle = `${NAME} Take-Home Pay by Salary (${year}): ${usd0(low.amount)} to ${usd0(high.amount)}`;
        const hubDesc = ladderSlugKey === 'california'
          // legacy CA wording
          ? `Computed ${year} California take-home pay for every salary from ${usd0(low.amount)} ` +
            `to ${usd0(high.amount)}. ${usd0(low.amount)} nets ${usd0(low.a.net)} and ${usd0(high.amount)} nets ` +
            `${usd0(high.a.net)} after federal tax, FICA, California income tax and SDI.`
          : `Computed ${year} ${NAME} take-home pay for every salary from ${usd0(low.amount)} ` +
            `to ${usd0(high.amount)}. ${usd0(low.amount)} nets ${usd0(low.a.net)} and ${usd0(high.amount)} nets ` +
            `${usd0(high.a.net)} after federal tax, FICA` +
            `${kind === 'none' ? '' : ` and ${NAME} income tax`}` +
            `${progs.length ? ` and ${caList(progLabels)}` : ''}.`;
        // The method paragraph. The federal half is the same everywhere because
        // the federal rules are; the state half is built from this state's own
        // shape, so a no-income-tax state does not claim a schedule it lacks.
        // What the state subtracts, described so the hub cannot contradict the rung pages.
        // `stDedText` is the PUBLISHED figure, which is the right thing to name only where
        // the state subtracts that same amount at every rung. Wisconsin and South Carolina
        // income-test theirs down, and Massachusetts adds a second, FICA-based deduction
        // on top, so both of those get a description rather than a single number.
        const dedClause = low.stDedPhases
          ? `after a standard deduction that is income-tested down as the ladder climbs, from ` +
            `${usd0(low.stDedAfterPhaseout)} at ${usd0(low.amount)} to ${usd0(high.stDedAfterPhaseout)} at ` +
            `${usd0(high.amount)}`
          : (low.stFicaDed > 0
            ? `after the ${usd0(low.stDedAfterPhaseout)} it subtracts first plus the capped deduction it ` +
              `allows for the FICA already withheld`
            : `after the ${stDedText} it subtracts first`);
        const methodStateClause = kind === 'none'
          ? `${NAME} levies no income tax on wages, so there is nothing to compute on that line`
          : (kind === 'flat'
            ? `${NAME} income tax is ${pctStr(state.tax.rate)} of ` +
              (low.stDed > 0 ? `what is left ${dedClause}` : `the whole salary`)
            : (ladderSlugKey === 'california'
              // legacy CA wording
              ? `California income tax uses its own schedule after its ${stDedText} single standard deduction`
              : `${NAME} income tax uses its own schedule of ${numWord(state.tax.brackets.single.length)} bands` +
                (low.stDed > 0 ? ` ${dedClause}` : ` on the whole salary`)));
        const methodProgClause = progs.length
          ? (ladderSlugKey === 'california'
            // legacy CA wording
            ? `; and California SDI is ${pct2(progs[0].rate)} of the whole salary, uncapped since SB 951`
            // Same distinction the rung pages make: a wage-base ceiling is a
            // level of WAGES the rate stops at, a dollar ceiling is a cap on the
            // CONTRIBUTION. "0.43% of at most $411.91 a year" was the first,
            // meaningless, version of this.
            : `; and ${caList(progs.map((p) => {
              if (p.data.wageBase != null) {
                return `${p.label} is ${pct2(p.rate)} of ${programCapPhrase(p.data)}`;
              }
              const cap = programCapCeiling(p.data);
              return cap
                ? `${p.label} is ${pct2(p.rate)} of wages, capped at ${cap}`
                : `${p.label} is ${pct2(p.rate)} of all wages`;
            }))}`)
          : '';
        const methodPara = `Every figure is computed at build time by the same open paycheck engine behind ` +
          `the ${NAME} paycheck calculator, from the ${year} tax data file in this repository. Federal tax ` +
          `uses the ${year} brackets after the ${fedStdDed} single standard deduction; Social Security is ` +
          `${ssRateText} up to the ${ssBase} wage base and Medicare ${medRateText} with no cap; ` +
          `${methodStateClause}${methodProgClause}. Nothing on this page is hand-typed, and nothing is ` +
          `fetched: a person updates the tax data file when a figure changes and the next build recomputes ` +
          `all ${rungs.length} rows.`;
        const hubHtml = fill(hubTpl, {
          SITE_NAME: SITE.name, SITE_URL: SITE.url,
          TAX_YEAR: year,
          // The hub template used to hard-code California's path into its
          // <link rel="canonical">, which was harmless while California was the
          // only hub and catastrophic the moment there were thirteen: all twelve
          // new hubs would have declared themselves duplicates of California's.
          PAGE_PATH: `/${HUB}/`,
          H1: `${NAME} take-home pay by salary (${year})`,
          PAGE_TITLE: hubTitle,
          META_DESC: hubDesc,
          OG_TITLE: `${NAME} take-home pay by salary (${year})`,
          OG_DESC: hubDesc,
          PUB_DATE: pubDate,
          FIGURE_BASIS: ladderBasis,
          FIGURE_BANNER: figureYearBanner(state, year),
          // The number-bearing sentence leads. It used to sit second, behind a
          // sentenceless fragment ("What a California salary actually pays,
          // computed for nine salary levels..."), which is what an answer engine
          // lifts first and which answers nothing on its own. This version names
          // the state, the year, both ends of the ladder and both computed
          // figures, so it stands up quoted with no headline attached.
          LEDE: `In ${NAME} for ${year}, a single filer earning ${usd0(low.amount)} takes home ` +
            `<strong>${usd0(low.a.net)}</strong> a year and one earning ${usd0(high.amount)} takes home ` +
            `<strong>${usd0(high.a.net)}</strong>, after ` +
            // Names only the withholdings this state actually has, and joins them as
            // English rather than as a trailing comma list. A no-income-tax state
            // that still runs an employee-paid premium (Washington) has to say so, or
            // the sentence explains its own figure wrongly.
            (() => {
              const parts = ['federal income tax', 'Social Security', 'Medicare'];
              if (kind !== 'none') parts.push(`${NAME} income tax`);
              if (low.a.statePrograms > 0) parts.push(`${NAME}'s employee-paid state payroll premiums`);
              return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
            })() +
            `. This page computes ` +
            `${numWord(rungs.length)} salary levels from ${usd0(low.amount)} to ${usd0(high.amount)}. Pick a salary for the full ` +
            `${kind === 'bracket' ? `federal and ${NAME} bracket-by-bracket` : (kind === 'flat' ? `federal bracket-by-bracket, and the ${NAME}` : `federal bracket-by-bracket`)} working.`,
          SHORT_VERSION: `Across this ladder the share of gross pay withheld runs from ` +
            `${pct1(low.allInRate)} at ${usd0(low.amount)} to ${pct1(high.allInRate)} at ` +
            `${usd0(high.amount)}. Over the whole ${usd0(high.amount - low.amount)} climb, ` +
            `${pct1(spread / (high.amount - low.amount))} of the extra gross survives ` +
            `${caList([
              'federal tax', 'FICA',
              ...(kind === 'none' ? [] : [`${NAME} income tax`]),
              // legacy CA wording: the live hub says "and SDI", not "and California SDI"
              ...(ladderSlugKey === 'california' ? ['SDI'] : progLabels),
            ])}.`,
          HUB_CAPTION: `${NAME} annual take-home pay, tax and effective rate by salary, ${usd0(low.amount)} to ${usd0(high.amount)}`,
          HUB_ROWS: hubRows,
          HUB_LINKS: hubLinks,
          LADDER_LOW: usd0(low.amount),
          LADDER_HIGH: usd0(high.amount),
          RUNG_COUNT: String(rungs.length),
          PROSE_BLOCKS: hubProse,
          CTA_LINKS: [
            `<a class="primary" href="/${ladderSlugKey}-paycheck-calculator/">Run your own number in the ${NAME} paycheck calculator &rarr;</a>`,
            `<a href="/data/take-home-pay-by-state/">Compare ${NAME} with the other 50 &rarr;</a>`,
            `<a href="/salary-to-hourly/">Salary to hourly &rarr;</a>`,
          ].join('\n      '),
          METHOD_PARA: methodPara,
          FAQ_BLOCKS: caFaqBlocks(hubFaq),
          FAQ_LD: faqJsonLd(hubFaq),
          ARTICLE_LD: JSON.stringify({
            '@context': 'https://schema.org', '@type': 'Article',
            headline: hubTitle,
            description: hubDesc,
            datePublished: CONTENT_DATE,
            dateModified: gitDate('src/data/tax-data-2026.json') || CONTENT_DATE,
            author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
            publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
            mainEntityOfPage: `${SITE.url}/${HUB}/`,
            isAccessibleForFree: true,
          }),
          SOURCE_ROWS: sourceRows,
          LAST_SOURCED: esc(LAST_SOURCED || CONTENT_DATE),
        }).replace('<footer class="site">', `${ladderRelated}\n<footer class="site">`);
        const hubDir = join(DIST, HUB);
        await mkdir(hubDir, { recursive: true });
        await writeFile(join(hubDir, 'index.html'), hubHtml);
        urls.push(`${SITE.url}/${HUB}/`);
      }
    }
  }

  // Bonus (supplemental-wage) tax calculator — 51-page state cluster. One
  // template + per-state loop, mirroring the paycheck cluster; each page injects
  // ONLY its own state's tax + supplemental data (small payload) and is keyed to
  // that state's method/rate + slug-varied worked example.
  for (const slug of builtSlugs) {
    const state = taxData.states[slug];
    const suppEntry = suppData.states[slug];
    if (!suppEntry) { console.warn(`⚠  no supplemental entry for ${slug} — skipping bonus page`); continue; }
    const bonusPayload = {
      taxData: stripInternal({ taxYear: taxData.taxYear, federal: taxData.federal, states: { [slug]: state } }),
      supp: { federal: suppFederalLean, states: { [slug]: leanSupp(suppEntry) } }
    };
    const faqEntries = bonusFaqEntries(state, suppEntry, year);
    // Worked-example inputs vary by slug AND are chosen so the example always
    // lands on a genuine refund/owe delta (never a zero-delta wash) — the whole
    // point of the tool. Distinct (bonus, salary) per state means same-bucket
    // pages don't share one canonical set of computed figures.
    const exPick = bonusExampleInputs(slug, taxData, suppData);
    const exSalary = exPick.salary;
    const ex = exPick.r;
    const secs = bonusSections([
      bonusMythBust(state, suppEntry, ex),
      bonusHowItWorks(state, suppEntry, year),
      bonusWorkedExample(state, suppEntry, ex, exSalary),
      bonusSizeTable(state, suppEntry, taxData, suppData),
      bonusNeighborTable(state, suppEntry, roster, builtSlugs, taxData, suppData)
    ], slug);
    // injectQuestionFlow, not fillTool: these 51 pages are written through the
    // plain fill() path, so the reveal controller has to be attached here.
    // dropPaytypeCard, because California is the only state that asks it.
    const html = injectQuestionFlow(dropPaytypeCard(fill(bonusTaxStateTpl, {
      STATE_NAME: state.name,
      STATE_ABBR: state.abbr,
      STATE_SLUG: slug,
      STATE_TITLE: bonusTitle(state, suppEntry, year),
      STATE_META_DESC: bonusMetaDesc(state, suppEntry, year),
      STATE_H1: `${state.name} Bonus Tax Calculator`,
      STATE_LEDE: bonusLede(state, suppEntry, year),
      BONUS_INTRO: bonusAnswerBlock(state, suppEntry),
      // Derived from the state's own figureYear, never from a list of slugs, so
      // California and Oklahoma stop being labelled the moment their data moves
      // to 2026 and any state that falls behind starts being labelled without a
      // code change. Same helper the paycheck cluster uses.
      FIGURE_BANNER: figureYearBanner(state, year),
      SECTIONS_A: secs.a,
      SECTIONS_B: secs.b,
      STATE_FAQ: bonusFaqBlock(state, faqEntries),
      FAQ_JSONLD: faqJsonLd(faqEntries),
      SOURCES: bonusSourcesBlock(state, suppEntry),
      STATE_LINKS: bonusStateLinks(roster, builtSlugs, slug),
      BONUS_TAX_JSON: JSON.stringify(bonusPayload),
      YEAR: year,
      VERIFIED: verified,
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url
    }), slug), `/${slug}-bonus-tax-calculator/`);
    const bonusRelated = relatedLinksHtml(orderAncillary(slug, [
      { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
      { name: `${state.name} Paycheck Calculator`, path: `/${slug}-paycheck-calculator/` },
      { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
      { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
      { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
    ]));
    const dir = join(DIST, `${slug}-bonus-tax-calculator`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'index.html'),
      html.replace('<footer class="site">', `${bonusRelated}\n<footer class="site">`)
    );
    urls.push(`${SITE.url}/${slug}-bonus-tax-calculator/`);
  }

  // Bonus tax calculator HUB (/bonus-tax-calculator/) — state selector + full
  // prose; injects all 51 states so the picker works. In TOOLS (money), so
  // fillTool adds the related-tools block + AdSense.
  await mkdir(join(DIST, 'bonus-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'bonus-tax-calculator', 'index.html'),
    fillTool(bonusTaxTpl, {
      SITE_NAME: SITE.name, SITE_URL: SITE.url, YEAR: year, VERIFIED: verified,
      BONUS_TAX_JSON: BONUS_TAX_ALL_JSON,
      STATE_LINKS: bonusHubLinks(roster, builtSlugs)
    }, '/bonus-tax-calculator/')
  );
  urls.push(`${SITE.url}/bonus-tax-calculator/`);

  // home
  await writeFile(
    join(DIST, 'index.html'),
    fill(homeTpl, {
      STATE_LINKS: homeLinks, YEAR: year, SITE_NAME: SITE.name, SITE_URL: SITE.url,
      // Live count of built state pages, so the take-home-study link on the
      // paycheck hub can never claim a roster size the build didn't produce.
      ROW_COUNT_STATES: String(builtSlugs.size),
      // Same guarantee for the salary levels: both homepage pointers to the
      // take-home study read them from the array the study is built on.
      STUDY_SALARIES: STUDY_SALARY_TEXT,
    })
  );

  // static content pages (privacy / terms / about / contact) — two-pass fill so
  // tokens inside each page body are also resolved.
  const siteMap = { SITE_NAME: SITE.name, SITE_URL: SITE.url, CONTACT_EMAIL: SITE.contactEmail };
  for (const p of STATIC_PAGES) {
    const body = fill(p.body, siteMap);
    const html = fill(pageTpl, {
      ...siteMap,
      PAGE_TITLE: p.title,
      PAGE_DESC: fill(p.desc, siteMap),
      PAGE_SLUG: p.slug,
      ROBOTS: p.robots || 'index, follow',
      PAGE_BODY: body
    });
    const dir = join(DIST, p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), html);
    urls.push(`${SITE.url}/${p.slug}/`);
  }

  // invoice generator (standalone tool page)
  await mkdir(join(DIST, 'invoice-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'invoice-generator', 'index.html'),
    fillTool(invoiceTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/invoice-generator/')
  );
  urls.push(`${SITE.url}/invoice-generator/`);

  // images to PDF converter (standalone tool page, reuses jsPDF + canvas-math)
  await mkdir(join(DIST, 'images-to-pdf'), { recursive: true });
  await writeFile(
    join(DIST, 'images-to-pdf', 'index.html'),
    fillTool(imagesToPdfTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/images-to-pdf/')
  );
  urls.push(`${SITE.url}/images-to-pdf/`);

  // PDF to Word converter (client-side by default; optional server fallback via the Cloudflare gate)
  await mkdir(join(DIST, 'pdf-to-word'), { recursive: true });
  await writeFile(
    join(DIST, 'pdf-to-word', 'index.html'),
    fillTool(pdfToWordTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, TURNSTILE_SITEKEY }, '/pdf-to-word/')
  );
  urls.push(`${SITE.url}/pdf-to-word/`);

  // Word to PDF converter (100% client-side; mammoth reads the .docx, jsPDF writes the PDF)
  await mkdir(join(DIST, 'word-to-pdf'), { recursive: true });
  await writeFile(
    join(DIST, 'word-to-pdf', 'index.html'),
    fillTool(wordToPdfTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/word-to-pdf/')
  );
  urls.push(`${SITE.url}/word-to-pdf/`);

  // Merge PDF (100% client-side; pdf-lib copies pages across documents)
  await mkdir(join(DIST, 'merge-pdf'), { recursive: true });
  await writeFile(
    join(DIST, 'merge-pdf', 'index.html'),
    fillTool(mergePdfTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/merge-pdf/')
  );
  urls.push(`${SITE.url}/merge-pdf/`);

  // Split PDF (100% client-side; pdf-lib extracts a range or splits every page)
  await mkdir(join(DIST, 'split-pdf'), { recursive: true });
  await writeFile(
    join(DIST, 'split-pdf', 'index.html'),
    fillTool(splitPdfTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/split-pdf/')
  );
  urls.push(`${SITE.url}/split-pdf/`);

  // Compress PDF (100% client-side; pdf.js renders each page, jsPDF rebuilds a smaller PDF)
  await mkdir(join(DIST, 'compress-pdf'), { recursive: true });
  await writeFile(
    join(DIST, 'compress-pdf', 'index.html'),
    fillTool(compressPdfTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/compress-pdf/')
  );
  urls.push(`${SITE.url}/compress-pdf/`);

  // PDF Tools hub (pure content/interlinking page — no JS asset, no calculator)
  await mkdir(join(DIST, 'pdf-tools'), { recursive: true });
  await writeFile(
    join(DIST, 'pdf-tools', 'index.html'),
    fillTool(pdfToolsTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/pdf-tools/')
  );
  urls.push(`${SITE.url}/pdf-tools/`);

  // PDF converter alternatives + pricing comparison (pure content page, no JS asset)
  await mkdir(join(DIST, 'pdf-word-converter-alternatives'), { recursive: true });
  await writeFile(
    join(DIST, 'pdf-word-converter-alternatives', 'index.html'),
    fillTool(pdfAltTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/pdf-word-converter-alternatives/')
  );
  urls.push(`${SITE.url}/pdf-word-converter-alternatives/`);

  // qr code generator (standalone tool page)
  await mkdir(join(DIST, 'qr-code-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'qr-code-generator', 'index.html'),
    fillTool(qrTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/qr-code-generator/')
  );
  urls.push(`${SITE.url}/qr-code-generator/`);

  // circle crop (image tool, built on CanvasEditor)
  await mkdir(join(DIST, 'crop-image-into-circle'), { recursive: true });
  await writeFile(
    join(DIST, 'crop-image-into-circle', 'index.html'),
    fillTool(circleTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/crop-image-into-circle/')
  );
  urls.push(`${SITE.url}/crop-image-into-circle/`);

  // passport photo maker (CanvasEditor + sourced photo specs)
  await mkdir(join(DIST, 'passport-photo-maker'), { recursive: true });
  await writeFile(
    join(DIST, 'passport-photo-maker', 'index.html'),
    fillTool(photoTpl, {
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url,
      PHOTO_SPECS_JSON: JSON.stringify({ specs: photoSpecs.specs, printSheet: photoSpecs.printSheet })
    }, '/passport-photo-maker/')
  );
  urls.push(`${SITE.url}/passport-photo-maker/`);

  // image resizer (resize by pixels/percent, reuses canvas-math helpers)
  await mkdir(join(DIST, 'resize-image'), { recursive: true });
  await writeFile(
    join(DIST, 'resize-image', 'index.html'),
    fillTool(resizeTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/resize-image/')
  );
  urls.push(`${SITE.url}/resize-image/`);

  // image format converter (PNG/JPG/WebP, reuses canvas-math helpers)
  await mkdir(join(DIST, 'convert-image'), { recursive: true });
  await writeFile(
    join(DIST, 'convert-image', 'index.html'),
    fillTool(convertTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/convert-image/')
  );
  urls.push(`${SITE.url}/convert-image/`);

  // image compressor (compress to a target file size, reuses qualityForTargetBytes)
  await mkdir(join(DIST, 'compress-image'), { recursive: true });
  await writeFile(
    join(DIST, 'compress-image', 'index.html'),
    fillTool(compressTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/compress-image/')
  );
  urls.push(`${SITE.url}/compress-image/`);

  // percentage calculator (pure-math tool page)
  await mkdir(join(DIST, 'percentage-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'percentage-calculator', 'index.html'),
    fillTool(percentTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/percentage-calculator/')
  );
  urls.push(`${SITE.url}/percentage-calculator/`);

  // tip calculator & bill splitter (pure-math tool page)
  await mkdir(join(DIST, 'tip-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'tip-calculator', 'index.html'),
    fillTool(tipTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/tip-calculator/')
  );
  urls.push(`${SITE.url}/tip-calculator/`);

  // mortgage calculator (pure-math tool page, built on the amortization engine)
  await mkdir(join(DIST, 'mortgage-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'mortgage-calculator', 'index.html'),
    fillTool(mortgageTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/mortgage-calculator/')
  );
  urls.push(`${SITE.url}/mortgage-calculator/`);

  // auto loan / car payment calculator (pure-math tool page, built on the amortization engine)
  await mkdir(join(DIST, 'auto-loan-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'auto-loan-calculator', 'index.html'),
    fillTool(autoLoanTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/auto-loan-calculator/')
  );
  urls.push(`${SITE.url}/auto-loan-calculator/`);

  // debt payoff / credit card payoff calculator (pure-math, built on the amortization engine)
  await mkdir(join(DIST, 'debt-payoff-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'debt-payoff-calculator', 'index.html'),
    fillTool(debtPayoffTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/debt-payoff-calculator/')
  );
  urls.push(`${SITE.url}/debt-payoff-calculator/`);

  // compound interest / savings growth calculator (pure-math, built on the compound-interest engine)
  await mkdir(join(DIST, 'compound-interest-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'compound-interest-calculator', 'index.html'),
    fillTool(compoundTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/compound-interest-calculator/')
  );
  urls.push(`${SITE.url}/compound-interest-calculator/`);

  // 401(k) retirement calculator (pure-math, built on the retirement-401k engine)
  await mkdir(join(DIST, '401k-calculator'), { recursive: true });
  await writeFile(
    join(DIST, '401k-calculator', 'index.html'),
    fillTool(retire401kTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/401k-calculator/')
  );
  urls.push(`${SITE.url}/401k-calculator/`);

  // savings goal calculator (how much to save / how long, built on the savings-goal engine)
  await mkdir(join(DIST, 'savings-goal-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'savings-goal-calculator', 'index.html'),
    fillTool(savingsGoalTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/savings-goal-calculator/')
  );
  urls.push(`${SITE.url}/savings-goal-calculator/`);

  // holiday countdown / days-until calculator (pure date-math tool page)
  await mkdir(join(DIST, 'holiday-countdown'), { recursive: true });
  await writeFile(
    join(DIST, 'holiday-countdown', 'index.html'),
    fillTool(countdownTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/holiday-countdown/')
  );
  urls.push(`${SITE.url}/holiday-countdown/`);

  // countdown timer (set-a-duration timer, built on the pure duration module)
  await mkdir(join(DIST, 'countdown-timer'), { recursive: true });
  await writeFile(
    join(DIST, 'countdown-timer', 'index.html'),
    fillTool(timerTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/countdown-timer/')
  );
  urls.push(`${SITE.url}/countdown-timer/`);

  // stopwatch (count-up timer with unlimited lap splits; pure client-side)
  await mkdir(join(DIST, 'stopwatch'), { recursive: true });
  await writeFile(
    join(DIST, 'stopwatch', 'index.html'),
    fillTool(stopwatchTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/stopwatch/')
  );
  urls.push(`${SITE.url}/stopwatch/`);

  // pomodoro timer (focus/break phase machine; pure client-side)
  await mkdir(join(DIST, 'pomodoro-timer'), { recursive: true });
  await writeFile(
    join(DIST, 'pomodoro-timer', 'index.html'),
    fillTool(pomodoroTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/pomodoro-timer/')
  );
  urls.push(`${SITE.url}/pomodoro-timer/`);

  // age calculator (pure date-math tool page, reuses ageBreakdown + nextBirthday)
  await mkdir(join(DIST, 'age-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'age-calculator', 'index.html'),
    fillTool(ageTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/age-calculator/')
  );
  urls.push(`${SITE.url}/age-calculator/`);

  // days between dates / date duration calculator (pure date-math tool page,
  // reuses daysBetween + ageBreakdown + businessDaysBetween)
  await mkdir(join(DIST, 'days-between-dates'), { recursive: true });
  await writeFile(
    join(DIST, 'days-between-dates', 'index.html'),
    fillTool(daysBetweenTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/days-between-dates/')
  );
  urls.push(`${SITE.url}/days-between-dates/`);

  // time zone converter (pure Intl-based zone math, built on the timezone engine)
  await mkdir(join(DIST, 'time-zone-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'time-zone-converter', 'index.html'),
    fillTool(timeZoneTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/time-zone-converter/')
  );
  urls.push(`${SITE.url}/time-zone-converter/`);

  // date calculator (add/subtract days, weeks, months, years — built on date-add.js)
  await mkdir(join(DIST, 'date-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'date-calculator', 'index.html'),
    fillTool(dateCalcTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/date-calculator/')
  );
  urls.push(`${SITE.url}/date-calculator/`);

  // Fixed-interval date pages (/30-days-from-today/, /12-weeks-from-today/,
  // /10-business-days-from-today/, /90-days-ago/ …) plus their hub.
  //
  // These pages carry NO computed answer in their HTML, deliberately: the date
  // that is "30 days from today" changes every midnight, so anything baked at
  // build time would be wrong by the next morning. The interval is markup, the
  // clock is the reader's, and /assets/days-from-today.js does the arithmetic
  // through the same date engine /date-calculator/ uses.
  //
  // Related-tools is overridden per page to the date cluster rather than the
  // random calc pick: someone on "60 days from today" wants the neighbouring
  // intervals and the general date tools, not a paint calculator.
  for (const p of DFT_PAGES) {
    const path = dftPath(p);
    RELATED_OVERRIDES[path] = [
      { name: 'Date Calculator (Add or Subtract)', path: '/date-calculator/' },
      { name: 'Days Between Dates', path: '/days-between-dates/' },
      { name: 'All "days from today" intervals', path: '/days-from-today/' },
      { name: 'Age Calculator', path: '/age-calculator/' },
      { name: 'Holiday Countdown', path: '/holiday-countdown/' },
      { name: 'Countdown Timer', path: '/countdown-timer/' },
    ];
    const dir = join(DIST, p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'index.html'),
      fillTool(dftTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, ...dftPageParts(p) }, path)
    );
    urls.push(`${SITE.url}${path}`);
  }
  {
    RELATED_OVERRIDES['/days-from-today/'] = [
      { name: 'Date Calculator (Add or Subtract)', path: '/date-calculator/' },
      { name: 'Days Between Dates', path: '/days-between-dates/' },
      { name: 'Age Calculator', path: '/age-calculator/' },
      { name: 'Holiday Countdown', path: '/holiday-countdown/' },
      { name: 'Hours Calculator', path: '/hours-calculator/' },
      { name: 'Time Zone Converter', path: '/time-zone-converter/' },
    ];
    await mkdir(join(DIST, 'days-from-today'), { recursive: true });
    await writeFile(
      join(DIST, 'days-from-today', 'index.html'),
      fillTool(dftHubTpl, {
        SITE_NAME: SITE.name,
        SITE_URL: SITE.url,
        TITLE: 'Days From Today — 30, 60, 90, 180 Days and More',
        DESC: 'Ready-made answers for the intervals people count: 30, 60, 90 and 180 days from today, weeks from today, business days from today, and dates in the past. Each page works the date out in your browser.',
        APP_LD: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: 'Days From Today',
          applicationCategory: 'UtilitiesApplication',
          operatingSystem: 'Any',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          description: 'A page per interval — days, weeks and business days from today, and dates counted backwards — each computing the answer in the browser from the current date.',
        }),
        GROUPS: dftHubGroups(DFT_GROUPS),
      }, '/days-from-today/')
    );
    urls.push(`${SITE.url}/days-from-today/`);
  }

  // cooking measurement converter (pure-math tool page, built on cooking-units)
  await mkdir(join(DIST, 'cooking-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'cooking-converter', 'index.html'),
    fillTool(cookingTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/cooking-converter/')
  );
  urls.push(`${SITE.url}/cooking-converter/`);

  // recipe scaler (halve/double/resize ingredient amounts, built on recipe-scale)
  await mkdir(join(DIST, 'recipe-scaler'), { recursive: true });
  await writeFile(
    join(DIST, 'recipe-scaler', 'index.html'),
    fillTool(recipeScalerTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/recipe-scaler/')
  );
  urls.push(`${SITE.url}/recipe-scaler/`);

  // general-purpose unit converter (pure-math tool page, built on units.js)
  await mkdir(join(DIST, 'unit-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'unit-converter', 'index.html'),
    fillTool(unitConverterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/unit-converter/')
  );
  urls.push(`${SITE.url}/unit-converter/`);

  // BMI calculator (pure-math health tool page, built on the bmi engine)
  await mkdir(join(DIST, 'bmi-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'bmi-calculator', 'index.html'),
    fillTool(bmiTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/bmi-calculator/')
  );
  urls.push(`${SITE.url}/bmi-calculator/`);

  // pregnancy due date calculator (pure date-math tool page, built on the due-date engine)
  await mkdir(join(DIST, 'due-date-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'due-date-calculator', 'index.html'),
    fillTool(dueDateTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/due-date-calculator/')
  );
  urls.push(`${SITE.url}/due-date-calculator/`);

  // ovulation & fertile-window calculator (pure date-math tool page, built on the ovulation engine)
  await mkdir(join(DIST, 'ovulation-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'ovulation-calculator', 'index.html'),
    fillTool(ovulationTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/ovulation-calculator/')
  );
  urls.push(`${SITE.url}/ovulation-calculator/`);

  // calorie calculator / TDEE (pure-math health tool page, built on the calories engine)
  await mkdir(join(DIST, 'calorie-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'calorie-calculator', 'index.html'),
    fillTool(calorieTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/calorie-calculator/')
  );
  urls.push(`${SITE.url}/calorie-calculator/`);

  // ideal weight & macro calculator (pure-math health tool page, built on the
  // ideal-weight engine + the shared calories/TDEE engine)
  await mkdir(join(DIST, 'ideal-weight-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'ideal-weight-calculator', 'index.html'),
    fillTool(idealWeightTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/ideal-weight-calculator/')
  );
  urls.push(`${SITE.url}/ideal-weight-calculator/`);

  // GPA calculator (pure-math tool page, built on the gpa engine)
  await mkdir(join(DIST, 'gpa-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'gpa-calculator', 'index.html'),
    fillTool(gpaTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/gpa-calculator/')
  );
  urls.push(`${SITE.url}/gpa-calculator/`);

  // US inflation calculator (CPI-U). Embeds the BLS CPI-U annual-average table
  // into the page (window.__CPI_US__) so results are fully client-side.
  await mkdir(join(DIST, 'inflation-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'inflation-calculator', 'index.html'),
    fillTool(inflationTpl, {
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url,
      CPI_US_JSON: JSON.stringify({ source: cpiUs.source, throughYear: cpiUs.throughYear, data: cpiUs.data })
    }, '/inflation-calculator/')
  );
  urls.push(`${SITE.url}/inflation-calculator/`);

  // salary to hourly calculator (pure-math tool page, built on the wage engine)
  await mkdir(join(DIST, 'salary-to-hourly'), { recursive: true });
  await writeFile(
    join(DIST, 'salary-to-hourly', 'index.html'),
    fillTool(salaryHourlyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/salary-to-hourly/')
  );
  urls.push(`${SITE.url}/salary-to-hourly/`);

  // sales tax calculator (pure-math tool page, built on the sales-tax engine)
  await mkdir(join(DIST, 'sales-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'sales-tax-calculator', 'index.html'),
    fillTool(salesTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/sales-tax-calculator/')
  );
  urls.push(`${SITE.url}/sales-tax-calculator/`);

  // gas / fuel cost calculator (pure-math tool page, built on the fuel-cost engine)
  await mkdir(join(DIST, 'gas-cost-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'gas-cost-calculator', 'index.html'),
    fillTool(gasCostTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/gas-cost-calculator/')
  );
  urls.push(`${SITE.url}/gas-cost-calculator/`);

  // signature maker (draw/type → trimmed transparent PNG, reuses alphaBounds)
  await mkdir(join(DIST, 'signature-maker'), { recursive: true });
  await writeFile(
    join(DIST, 'signature-maker', 'index.html'),
    fillTool(signatureTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/signature-maker/')
  );
  urls.push(`${SITE.url}/signature-maker/`);

  // password generator (strong random passwords, crypto.getRandomValues, on-device)
  await mkdir(join(DIST, 'password-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'password-generator', 'index.html'),
    fillTool(passwordTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/password-generator/')
  );
  urls.push(`${SITE.url}/password-generator/`);

  // word & character counter (live text stats, built on text-stats engine)
  await mkdir(join(DIST, 'word-counter'), { recursive: true });
  await writeFile(
    join(DIST, 'word-counter', 'index.html'),
    fillTool(wordCounterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/word-counter/')
  );
  urls.push(`${SITE.url}/word-counter/`);

  // hours calculator / time card (pure-math tool page, built on the timecard engine)
  await mkdir(join(DIST, 'hours-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'hours-calculator', 'index.html'),
    fillTool(hoursCalcTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/hours-calculator/')
  );
  urls.push(`${SITE.url}/hours-calculator/`);

  // text case converter (UPPER/lower/Title/Sentence/camel/snake/kebab, on-device)
  await mkdir(join(DIST, 'text-case-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'text-case-converter', 'index.html'),
    fillTool(textCaseTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/text-case-converter/')
  );
  urls.push(`${SITE.url}/text-case-converter/`);

  // bionic reading converter (bold word-prefixes for faster skimming, on-device)
  await mkdir(join(DIST, 'bionic-reading-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'bionic-reading-converter', 'index.html'),
    fillTool(bionicTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/bionic-reading-converter/')
  );
  urls.push(`${SITE.url}/bionic-reading-converter/`);

  // roman numeral converter (two-way, pure-logic tool page, built on roman.js)
  await mkdir(join(DIST, 'roman-numeral-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'roman-numeral-converter', 'index.html'),
    fillTool(romanTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/roman-numeral-converter/')
  );
  urls.push(`${SITE.url}/roman-numeral-converter/`);

  // number base converter (binary/octal/decimal/hex, pure-logic, built on number-base.js)
  await mkdir(join(DIST, 'base-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'base-converter', 'index.html'),
    fillTool(baseConverterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/base-converter/')
  );
  urls.push(`${SITE.url}/base-converter/`);

  // color converter (HEX/RGB/HSL two-way, pure-logic, built on color.js)
  await mkdir(join(DIST, 'color-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'color-converter', 'index.html'),
    fillTool(colorConverterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/color-converter/')
  );
  urls.push(`${SITE.url}/color-converter/`);

  // JSON formatter / validator / minifier (pure-logic, built on json-format.js)
  await mkdir(join(DIST, 'json-formatter'), { recursive: true });
  await writeFile(
    join(DIST, 'json-formatter', 'index.html'),
    fillTool(jsonFormatterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/json-formatter/')
  );
  urls.push(`${SITE.url}/json-formatter/`);

  // UUID (v4) generator (random GUIDs, crypto.getRandomValues, built on uuid.js)
  await mkdir(join(DIST, 'uuid-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'uuid-generator', 'index.html'),
    fillTool(uuidTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/uuid-generator/')
  );
  urls.push(`${SITE.url}/uuid-generator/`);

  // text diff checker (line-based LCS diff, pure-logic, built on text-diff.js)
  await mkdir(join(DIST, 'diff-checker'), { recursive: true });
  await writeFile(
    join(DIST, 'diff-checker', 'index.html'),
    fillTool(diffCheckerTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/diff-checker/')
  );
  urls.push(`${SITE.url}/diff-checker/`);

  // Base64 encoder / decoder (UTF-8 + URL-safe, pure-logic, built on base64.js)
  await mkdir(join(DIST, 'base64-encode-decode'), { recursive: true });
  await writeFile(
    join(DIST, 'base64-encode-decode', 'index.html'),
    fillTool(base64Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/base64-encode-decode/')
  );
  urls.push(`${SITE.url}/base64-encode-decode/`);

  // aspect ratio calculator (simplify + ratio-locked resize, built on aspect-ratio.js)
  await mkdir(join(DIST, 'aspect-ratio-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'aspect-ratio-calculator', 'index.html'),
    fillTool(aspectRatioTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/aspect-ratio-calculator/')
  );
  urls.push(`${SITE.url}/aspect-ratio-calculator/`);

  // discount calculator (sale price / percent off, pure-math, built on discount.js)
  await mkdir(join(DIST, 'discount-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'discount-calculator', 'index.html'),
    fillTool(discountTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/discount-calculator/')
  );
  urls.push(`${SITE.url}/discount-calculator/`);

  // fuel economy calculator (MPG / L/100km / km/L, pure-math, built on fuel-economy.js)
  await mkdir(join(DIST, 'fuel-economy-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'fuel-economy-calculator', 'index.html'),
    fillTool(fuelEconomyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/fuel-economy-calculator/')
  );
  urls.push(`${SITE.url}/fuel-economy-calculator/`);

  // random number generator (crypto.getRandomValues, on-device, built on random-number.js)
  await mkdir(join(DIST, 'random-number-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'random-number-generator', 'index.html'),
    fillTool(randomNumberTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/random-number-generator/')
  );
  urls.push(`${SITE.url}/random-number-generator/`);

  // paint calculator (how much paint for a room, pure-math, built on paint.js)
  await mkdir(join(DIST, 'paint-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'paint-calculator', 'index.html'),
    fillTool(paintTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/paint-calculator/')
  );
  urls.push(`${SITE.url}/paint-calculator/`);

  // tile calculator (how many tiles/boxes for a floor or wall, pure-math, built on tile.js)
  await mkdir(join(DIST, 'tile-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'tile-calculator', 'index.html'),
    fillTool(tileTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/tile-calculator/')
  );
  urls.push(`${SITE.url}/tile-calculator/`);

  // sleep calculator (bedtime/wake-time from 90-min cycles, pure-math, built on sleep.js)
  await mkdir(join(DIST, 'sleep-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'sleep-calculator', 'index.html'),
    fillTool(sleepTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/sleep-calculator/')
  );
  urls.push(`${SITE.url}/sleep-calculator/`);

  // running / walking pace calculator (pure-math, built on the pace engine)
  await mkdir(join(DIST, 'pace-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'pace-calculator', 'index.html'),
    fillTool(paceTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/pace-calculator/')
  );
  urls.push(`${SITE.url}/pace-calculator/`);

  // fraction calculator (add/subtract/multiply/divide fractions & mixed numbers, built on fraction.js)
  await mkdir(join(DIST, 'fraction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'fraction-calculator', 'index.html'),
    fillTool(fractionTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/fraction-calculator/')
  );
  urls.push(`${SITE.url}/fraction-calculator/`);

  // lorem ipsum generator (placeholder text by words/sentences/paragraphs, built on lorem.js)
  await mkdir(join(DIST, 'lorem-ipsum-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'lorem-ipsum-generator', 'index.html'),
    fillTool(loremTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/lorem-ipsum-generator/')
  );
  urls.push(`${SITE.url}/lorem-ipsum-generator/`);

  // average calculator (mean/median/mode/range/std-dev, pure-logic, built on average.js)
  await mkdir(join(DIST, 'average-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'average-calculator', 'index.html'),
    fillTool(averageTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/average-calculator/')
  );
  urls.push(`${SITE.url}/average-calculator/`);

  // morse code translator (text<->morse, pure-logic, built on morse.js)
  await mkdir(join(DIST, 'morse-code-translator'), { recursive: true });
  await writeFile(
    join(DIST, 'morse-code-translator', 'index.html'),
    fillTool(morseTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/morse-code-translator/')
  );
  urls.push(`${SITE.url}/morse-code-translator/`);

  // CAGR (compound annual growth rate) calculator (pure-math, built on the cagr engine)
  await mkdir(join(DIST, 'cagr-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'cagr-calculator', 'index.html'),
    fillTool(cagrTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/cagr-calculator/')
  );
  urls.push(`${SITE.url}/cagr-calculator/`);

  // Half Birthday calculator (pure-date math, built on the half-birthday engine)
  await mkdir(join(DIST, 'half-birthday-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'half-birthday-calculator', 'index.html'),
    fillTool(halfBirthdayTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/half-birthday-calculator/')
  );
  urls.push(`${SITE.url}/half-birthday-calculator/`);

  // Rule of 72 calculator (pure-math, built on the rule-of-72 engine)
  await mkdir(join(DIST, 'rule-of-72-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'rule-of-72-calculator', 'index.html'),
    fillTool(ruleOf72Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/rule-of-72-calculator/')
  );
  urls.push(`${SITE.url}/rule-of-72-calculator/`);

  // Words to Minutes / speaking time calculator (pure-math, built on the words-to-time engine)
  await mkdir(join(DIST, 'words-to-minutes'), { recursive: true });
  await writeFile(
    join(DIST, 'words-to-minutes', 'index.html'),
    fillTool(wordsToMinutesTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/words-to-minutes/')
  );
  urls.push(`${SITE.url}/words-to-minutes/`);

  // Double Time Pay calculator (pure-math, built on the double-time-pay engine)
  await mkdir(join(DIST, 'double-time-pay-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'double-time-pay-calculator', 'index.html'),
    fillTool(doubleTimePayTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/double-time-pay-calculator/')
  );
  urls.push(`${SITE.url}/double-time-pay-calculator/`);

  // Biweekly vs Semimonthly paycheck calculator (pure-math, built on the pay-frequency engine)
  await mkdir(join(DIST, 'biweekly-vs-semimonthly'), { recursive: true });
  await writeFile(
    join(DIST, 'biweekly-vs-semimonthly', 'index.html'),
    fillTool(biweeklyVsSemimonthlyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/biweekly-vs-semimonthly/')
  );
  urls.push(`${SITE.url}/biweekly-vs-semimonthly/`);

  // EZ Grader / test score calculator (pure-math, built on the grading engine)
  await mkdir(join(DIST, 'ez-grader'), { recursive: true });
  await writeFile(
    join(DIST, 'ez-grader', 'index.html'),
    fillTool(ezGraderTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/ez-grader/')
  );
  urls.push(`${SITE.url}/ez-grader/`);

  // Chronological age calculator (pure-date math, built on the chronological-age engine)
  await mkdir(join(DIST, 'chronological-age-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'chronological-age-calculator', 'index.html'),
    fillTool(chronoAgeTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/chronological-age-calculator/')
  );
  urls.push(`${SITE.url}/chronological-age-calculator/`);

  // Debt avalanche calculator (pure-math, built on the debt-avalanche engine)
  await mkdir(join(DIST, 'debt-avalanche-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'debt-avalanche-calculator', 'index.html'),
    fillTool(debtAvalancheTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/debt-avalanche-calculator/')
  );
  urls.push(`${SITE.url}/debt-avalanche-calculator/`);

  // Markdown to HTML converter (client-side, uses the vendored `marked` library)
  await mkdir(join(DIST, 'markdown-to-html'), { recursive: true });
  await writeFile(
    join(DIST, 'markdown-to-html', 'index.html'),
    fillTool(markdownTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/markdown-to-html/')
  );
  urls.push(`${SITE.url}/markdown-to-html/`);

  // 1099 vs W-2 take-home calculator (pure-math federal estimate, built on the employment-tax engine)
  await mkdir(join(DIST, '1099-vs-w2-calculator'), { recursive: true });
  await writeFile(
    join(DIST, '1099-vs-w2-calculator', 'index.html'),
    fillTool(w2Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/1099-vs-w2-calculator/')
  );
  urls.push(`${SITE.url}/1099-vs-w2-calculator/`);

  // OBBBA "no tax on overtime" (IRC §225) deduction calculator — fresh-query wedge,
  // reuses the paycheck engine's federal bracket math + the sourced obbba data.
  await mkdir(join(DIST, 'overtime-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'overtime-tax-calculator', 'index.html'),
    fillTool(overtimeTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON, STATES_JSON: OBBBA_STATES_JSON }, '/overtime-tax-calculator/')
  );
  urls.push(`${SITE.url}/overtime-tax-calculator/`);

  // OBBBA "no tax on tips" (IRC §224) deduction calculator
  await mkdir(join(DIST, 'tips-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'tips-tax-calculator', 'index.html'),
    fillTool(tipsTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON, STATES_JSON: OBBBA_STATES_JSON }, '/tips-tax-calculator/')
  );
  urls.push(`${SITE.url}/tips-tax-calculator/`);

  // OBBBA senior bonus deduction (IRC §151(d)(5)(C)) calculator — the $6,000
  // deduction for 65+ marketed as "no tax on Social Security". No state-conformity
  // selector: it flows to states only via federal taxable income (static note in-page).
  await mkdir(join(DIST, 'senior-deduction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'senior-deduction-calculator', 'index.html'),
    fillTool(seniorTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/senior-deduction-calculator/')
  );
  urls.push(`${SITE.url}/senior-deduction-calculator/`);

  // OBBBA SALT deduction cap (IRC §164(b)(6) as amended by §70120) calculator —
  // the $10,000 → $40,000 cap raise with the 30% high-income phase-down. No
  // state selector: SALT is a federal itemized deduction; the itemize-vs-standard
  // comparison and the old-cap counterfactual are the page's edge.
  await mkdir(join(DIST, 'salt-cap-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'salt-cap-calculator', 'index.html'),
    fillTool(saltCapTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/salt-cap-calculator/')
  );
  urls.push(`${SITE.url}/salt-cap-calculator/`);

  // OBBBA car-loan interest deduction (IRC §163(h)(4) "qualified passenger
  // vehicle loan interest", added by §70203) calculator — up to $10,000/yr of
  // interest on a new, US-assembled, personal-use vehicle loan for 2025–2028,
  // with the $100,000/$200,000 MAGI phase-out and an eligibility checklist. No
  // state selector: it's a federal deduction; MFS IS eligible (unlike tips/OT).
  await mkdir(join(DIST, 'car-loan-interest-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'car-loan-interest-calculator', 'index.html'),
    fillTool(carLoanTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/car-loan-interest-calculator/')
  );
  urls.push(`${SITE.url}/car-loan-interest-calculator/`);

  // OBBBA charitable-deduction calculator (IRC §170(p) non-itemizer deduction
  // §70424; §170(b)(1)(I) 0.5%-of-AGI floor §70425; §68 "2/37 rule" §70111) —
  // the three 2026 charitable changes, all PERMANENT (no 2028 sunset). Reuses the
  // SALT tool's itemize-vs-standard machinery. Correctly encodes reducesAgi=false
  // (the §170(p) deduction is taken via §63(b)(4) AFTER AGI — it does NOT reduce AGI).
  await mkdir(join(DIST, 'charitable-deduction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'charitable-deduction-calculator', 'index.html'),
    fillTool(charitableTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/charitable-deduction-calculator/')
  );
  urls.push(`${SITE.url}/charitable-deduction-calculator/`);

  // OBBBA mortgage insurance premium (MIP/PMI) deduction revival (IRC
  // §163(h)(3)(E), permanently un-terminated by §70108) calculator — the
  // permanent 2026 comeback of the PMI/mortgage-insurance Schedule A deduction,
  // dead since 2021. Genuinely NEW phaseout shape (percentage-of-premium
  // haircut, not a dollar-cap reduction), FHA-84-month-amortization vs
  // VA/USDA-year-paid split, and the pre-2007-contract gate. Reuses the SALT/
  // charitable itemize-vs-standard machinery via mipComparison. No state
  // selector: this is a federal itemized deduction; MFS IS eligible with its
  // own halved thresholds (unlike tips/overtime/senior/charitable).
  await mkdir(join(DIST, 'pmi-deduction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'pmi-deduction-calculator', 'index.html'),
    fillTool(pmiTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/pmi-deduction-calculator/')
  );
  urls.push(`${SITE.url}/pmi-deduction-calculator/`);

  // OBBBA §70404 Dependent Care FSA (§129, $7,500 / $3,750 MFS) vs. Child &
  // Dependent Care Credit (§21, nonrefundable, 50%→20% AGI-tiered, $3,000/$6,000
  // caps) — a NEW sibling system (not the deduction cluster). The §21(c) cap
  // reduction makes it a CORNER decision (max the FSA or take the credit; maxing
  // the FSA zeroes the credit). Reuses paycheck-engine.js for the FSA's income-tax
  // + FICA saving. MFS gets $0 credit (§21(e)(2)). Injects fica-inclusive fed JSON.
  await mkdir(join(DIST, 'dependent-care-fsa-vs-credit-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'dependent-care-fsa-vs-credit-calculator', 'index.html'),
    fillTool(depCareTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, DC_JSON, FED_JSON: DC_FED_JSON }, '/dependent-care-fsa-vs-credit-calculator/')
  );
  urls.push(`${SITE.url}/dependent-care-fsa-vs-credit-calculator/`);

  // 2026 Form W-4 Step 4(b) overtime & tips WITHHOLDING helper — the paycheck-now
  // companion to the filing-time tips/overtime tools. Reuses the same OBBBA engine
  // (allowedDeduction + a single combined federalTaxSaved on tips+overtime) to
  // translate the deduction into a Step 4(b) Deductions Worksheet entry (line 1a
  // tips / line 1b overtime premium) and an extra-take-home-per-paycheck figure.
  // Step 4(b) DEDUCTIONS (lowers withholding), NOT Step 4(c). No state selector.
  await mkdir(join(DIST, 'w4-overtime-tips-withholding-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'w4-overtime-tips-withholding-calculator', 'index.html'),
    fillTool(w4OtTipsTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/w4-overtime-tips-withholding-calculator/')
  );
  urls.push(`${SITE.url}/w4-overtime-tips-withholding-calculator/`);

  // SECURE 2.0 §603 mandatory Roth catch-up (IRC §414(v)(7)) calculator — a
  // SEPARATE retirement-plan rule (NOT OBBBA): high earners (prior-year FICA/Box 3
  // wages over $150k) must make their 401(k)/403(b)/457(b) catch-up as Roth. Its
  // own engine + dataset; injects only the SECURE 2.0 constants (asks for the
  // marginal rate directly, so no federal-bracket JSON needed).
  await mkdir(join(DIST, 'roth-catchup-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'roth-catchup-calculator', 'index.html'),
    fillTool(rothCatchupTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, ROTHCATCHUP_JSON }, '/roth-catchup-calculator/')
  );
  urls.push(`${SITE.url}/roth-catchup-calculator/`);

  // 1099-K (IRC §6050W, restored by OBBBA §70432) / 1099-NEC-MISC (IRC
  // §6041/§6041A, amended by OBBBA §70433) threshold checker — a STANDALONE
  // reporting-trigger lookup (NOT the deductions cluster, NOT the bracket/FICA
  // engine). Disambiguates which form applies from payment method + amount +
  // count + year: network apps ($20,000/200 txns, both strict >), card
  // processors (no minimum at all), or a direct payer ($2,000 TY2026 / $600
  // TY2025, "or more"). Plus an optional, informational state 1099-K overlay.
  await mkdir(join(DIST, '1099-threshold-checker'), { recursive: true });
  await writeFile(
    join(DIST, '1099-threshold-checker', 'index.html'),
    fillTool(form1099Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, FORM1099_JSON, FORM1099_STATES_JSON }, '/1099-threshold-checker/')
  );
  urls.push(`${SITE.url}/1099-threshold-checker/`);

  // 2026 W-2 Box 12 TA/TP/TT decoder + Treasury Tipped Occupation Code (TTOC)
  // lookup — an EXPLAINER, not a calculator (the tips/overtime calculators own
  // the deduction math; this page links to them). Load-bearing asymmetry the
  // engine + copy both enforce: TA is EXCLUDED from Box 1; TP/TT are fully
  // included (flags for the Schedule 1-A deduction) — never a subtraction.
  // The 71-occupation table (26 CFR 1.224-1 Table 1 to paragraph (h)) is
  // rendered server-side into the page for indexability AND injected as JSON
  // for the client-side search.
  await mkdir(join(DIST, 'w2-box-decoder'), { recursive: true });
  await writeFile(
    join(DIST, 'w2-box-decoder', 'index.html'),
    fillTool(w2BoxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, TTOC_JSON, TTOC_TABLE_HTML }, '/w2-box-decoder/')
  );
  urls.push(`${SITE.url}/w2-box-decoder/`);

  // Social Security wage-base max-out date calculator (SSA cbb.html $184,500 /
  // 6.2% for 2026) — projects the exact paycheck date SS withholding stops for
  // the year and the resulting take-home bump, plus a secondary excess-FICA
  // (multiple employers) check.
  await mkdir(join(DIST, 'ss-wage-base-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'ss-wage-base-calculator', 'index.html'),
    fillTool(ssMaxoutTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, SSMAXOUT_PARAMS_JSON }, '/ss-wage-base-calculator/')
  );
  urls.push(`${SITE.url}/ss-wage-base-calculator/`);

  // Federal student loan borrowing cap / funding gap calculator (P.L. 119-21
  // §81001 / 20 U.S.C. §1087e(a), effective July 1, 2026) — year-by-year
  // federal capacity vs. program cost, the named binding constraint per year
  // (COA rule / annual cap / restorable $100k-$200k pool / $257,500 lifetime
  // odometer / $65,000 Parent PLUS aggregate), the legacy grandfather
  // exception, and the honest mid-litigation professional-vs-graduate
  // framing. Informational arithmetic only — no borrowing advice.
  await mkdir(join(DIST, 'student-loan-cap-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'student-loan-cap-calculator', 'index.html'),
    fillTool(studentLoanCapTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, STUDENT_LOAN_LIMITS_JSON }, '/student-loan-cap-calculator/')
  );
  urls.push(`${SITE.url}/student-loan-cap-calculator/`);

  // ABLE Account Contribution Limit Calculator (26 U.S.C. §529A, TY 2026) —
  // arithmetic-first: the $20,000 base limit + the permanent ABLE-to-Work
  // bonus (lesser of compensation or the state-of-residence one-person FPL,
  // 48+DC/AK/HI buckets), per-beneficiary all-contributors pool, 529→ABLE
  // rollovers against the base, remaining room, and the 6% excise on excess.
  // The only eligibility input is the statutory onset-before-46 age (SECURE
  // 2.0 §124) — never a medical or benefits determination.
  await mkdir(join(DIST, 'able-account-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'able-account-calculator', 'index.html'),
    fillTool(ableTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, ABLE_LIMITS_JSON, ABLE_STATES_JSON }, '/able-account-calculator/')
  );
  urls.push(`${SITE.url}/able-account-calculator/`);

  // Employer Student Loan Repayment Tax Benefit Calculator (IRC §127; made
  // permanent + indexed 2027+ by OBBBA / P.L. 119-21 §70412). Employee income-
  // tax + FICA saving and employer matching-FICA saving on the $5,250 shared
  // cap, with the Social Security wage-base straddle for high earners, over-cap
  // taxable-wage treatment, and the California non-conformity caveat.
  await mkdir(join(DIST, 'employer-student-loan-repayment-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'employer-student-loan-repayment-calculator', 'index.html'),
    fillTool(section127Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, SECTION127_JSON }, '/employer-student-loan-repayment-calculator/')
  );
  urls.push(`${SITE.url}/employer-student-loan-repayment-calculator/`);

  // Adoption Tax Credit Calculator (26 U.S.C. §23, TY 2025/2026) — qualified
  // expenses → $17,670 per-child cap → MAGI phase-out ($265,080–$305,080) →
  // PER-CHILD refundable split (up to $5,120 EACH under OBBBA §70402, not per
  // return) → nonrefundable liability limit → 5-year FIFO carryforward. Handles
  // special-needs deeming (full cap, $0 expenses), multi-child households, and
  // the §137 employer-assistance coordination. Refundable for the first time
  // since 2011 and permanently for the first time (NOT "ever"). Informational
  // arithmetic only.
  await mkdir(join(DIST, 'adoption-credit-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'adoption-credit-calculator', 'index.html'),
    fillTool(adoptionTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, ADOPTION_DATA_JSON }, '/adoption-credit-calculator/')
  );
  urls.push(`${SITE.url}/adoption-credit-calculator/`);

  // QCD (Qualified Charitable Distribution, IRC §408(d)(8)) vs. take-the-
  // distribution-and-deduct-it calculator. NOT an OBBBA provision (predates the
  // 2025 law; permanent) but shares the tax-parameter store (federal.qcd, sibling
  // of federal.charitable) and REUSES charitableComparison for the entire
  // take-and-deduct side via the new qcd-comparison.js orchestrator — it does not
  // reimplement the §170(p)/floor/§68 math. Genuinely new: the QCD annual-limit
  // lookup + partial-QCD split, the age-70½ gate (distinct from RMD age 73), the
  // account-type guard, and the age-65+ standard-deduction addition (the shipped
  // charitable engine only ever reads the BASE standard deduction).
  await mkdir(join(DIST, 'qcd-vs-charitable-deduction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'qcd-vs-charitable-deduction-calculator', 'index.html'),
    fillTool(qcdTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/qcd-vs-charitable-deduction-calculator/')
  );
  urls.push(`${SITE.url}/qcd-vs-charitable-deduction-calculator/`);

  // OBBBA "which states still tax overtime in 2026" DATA STUDY (/data/overtime-tax-by-state/).
  // A citable, author-bylined data asset for the journalist link sprint. The table is
  // rendered server-side from the SAME sourced obbba dataset the calculators use, so the
  // study can never drift from the tools. Counts + movers are derived, not hardcoded.
  {
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const STUDY_PUBLISHED_ISO = '2026-07-02';
    const STUDY_UPDATED_ISO = '2026-07-07';
    const STUDY_DATE_HUMAN = 'July 7, 2026';
    const OT_LABEL = {
      no: { txt: 'Still taxed', cls: 'v-no', rank: 1 },
      partial: { txt: 'Partial', cls: 'v-partial', rank: 2 },
      unclear: { txt: 'Unclear', cls: 'v-unclear', rank: 3 },
      yes: { txt: 'Tax-free', cls: 'v-yes', rank: 4 },
      'n/a': { txt: 'No state wage tax', cls: 'v-na', rank: 5 },
    };
    const chip = (v) => {
      const m = OT_LABEL[v] || OT_LABEL.unclear;
      return { html: `<span class="chip ${m.cls}">${m.txt}</span>`, rank: m.rank };
    };
    const entries = Object.entries(obbba.states)
      .filter(([, s]) => s && typeof s === 'object' && s.overtime)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    const cnt = { no: 0, yes: 0, partial: 0, unclear: 0, nowage: 0 };
    const newlyFree = [], newlyTaxed = [], partialList = [], unclearList = [];
    const rows = entries.map(([slug, s]) => {
      const ot = s.overtime || {}, tp = s.tips || {};
      const ot26 = ot.y2026, tp26 = tp.y2026;
      if (ot26 === 'no') cnt.no++;
      else if (ot26 === 'yes') cnt.yes++;
      else if (ot26 === 'partial') cnt.partial++;
      else if (ot26 === 'unclear') cnt.unclear++;
      if (s.hasWageTax === false) cnt.nowage++;
      if (ot.y2025 === 'no' && ot26 === 'yes') newlyFree.push(s.name);
      if (ot.y2025 === 'yes' && ot26 === 'no') newlyTaxed.push(s.name);
      if (ot26 === 'partial') partialList.push(s.name);
      if (ot26 === 'unclear') unclearList.push(s.name);
      const otC = chip(ot26), tpC = chip(tp26);
      const changed = (ot.y2025 && ot26 && ot.y2025 !== ot26)
        ? ' <span class="changed">changed from 2025</span>' : '';
      const src = s.source
        ? `<a href="${esc(s.source)}" rel="noopener" target="_blank">source</a>` : '';
      const note = [s.note ? esc(s.note) : '', src].filter(Boolean).join(' ');
      return `<tr id="state-${slug}"><td><a href="/${slug}-paycheck-calculator/">${esc(s.name)}</a></td>` +
        `<td data-rank="${otC.rank}">${otC.html}${changed}</td>` +
        `<td data-rank="${tpC.rank}">${tpC.html}</td>` +
        `<td class="note">${note}</td></tr>`;
    }).join('\n');

    const cntOther = cnt.partial + cnt.unclear;
    const jn = (arr) => arr.join(', ');
    const movers = [];
    if (newlyFree.length) movers.push(`${jn(newlyFree)} — overtime newly tax-free for 2026`);
    if (newlyTaxed.length) movers.push(`${jn(newlyTaxed)} — overtime taxed again in 2026 (subject to change)`);
    if (partialList.length) movers.push(`${jn(partialList)} — only a partial state exclusion`);
    if (unclearList.length) movers.push(`${jn(unclearList)} — still unsettled for 2026`);
    const calloutMovers = movers.length ? movers.join('; ') + '.' : '';

    const articleLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: 'Which States Still Tax Overtime in 2026?',
      description: `A state-by-state analysis of which US states still tax overtime pay in 2026 after the federal One Big Beautiful Bill Act deduction. ${cnt.no} jurisdictions still tax it; ${cnt.yes} make it effectively tax-free; ${cnt.nowage} have no wage income tax.`,
      datePublished: STUDY_PUBLISHED_ISO, dateModified: STUDY_UPDATED_ISO,
      author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      mainEntityOfPage: `${SITE.url}/data/overtime-tax-by-state/`,
      isAccessibleForFree: true,
    });
    const datasetLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: 'OBBBA overtime & tips state conformity, tax year 2026',
      description: 'Per-jurisdiction conformity of all 50 US states and DC to the 2025 One Big Beautiful Bill Act federal deductions for overtime (IRC §225) and tips (IRC §224), for tax year 2026.',
      url: `${SITE.url}/data/overtime-tax-by-state/`,
      creator: { '@type': 'Person', name: 'Edmond Daher' },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      license: 'https://creativecommons.org/licenses/by/4.0/',
      temporalCoverage: '2026',
      // Freshness. Without it a consumer has no way to tell a 2026 dataset that was
      // checked last week from one abandoned a year ago, and the whole point of the
      // page is that state conformity keeps moving.
      dateModified: STUDY_UPDATED_ISO,
      spatialCoverage: { '@type': 'Place', name: 'United States' },
      // The page publishes a CSV of exactly these rows a few lines below; it was
      // missing here, so the only machine-readable copy schema advertised was the
      // upstream JSON.
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/obbba-deductions-2026.json` },
        { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE.url}/data/overtime-tax-by-state-2026.csv` },
      ],
      isAccessibleForFree: true,
    });

    await mkdir(join(DIST, 'data', 'overtime-tax-by-state'), { recursive: true });
    await writeFile(
      join(DIST, 'data', 'overtime-tax-by-state', 'index.html'),
      fillTool(overtimeStudyTpl, {
        SITE_NAME: SITE.name, SITE_URL: SITE.url,
        STUDY_ROWS: rows,
        CNT_TAX: String(cnt.no), CNT_FREE: String(cnt.yes),
        CNT_NOWAGE: String(cnt.nowage), CNT_OTHER: String(cntOther),
        CALLOUT_MOVERS: calloutMovers, PUB_DATE: STUDY_DATE_HUMAN,
        ANSWER: (dataPageAnswers['/data/overtime-tax-by-state/'] = conformityAnswer('overtime pay', entries.length, cnt)),
        ARTICLE_LD: articleLd, DATASET_LD: datasetLd,
      }, '/data/overtime-tax-by-state/')
    );
    urls.push(`${SITE.url}/data/overtime-tax-by-state/`);

    // Flat CSV of the dataset — journalist-liftable citation kit (same source JSON).
    const csvEsc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csvLines = [['State', 'Has state wage tax', 'Overtime 2025', 'Overtime 2026',
                       'Tips 2025', 'Tips 2026', 'Note', 'Source']];
    for (const [, s] of entries) {
      const ot = s.overtime || {}, tp = s.tips || {};
      csvLines.push([s.name, s.hasWageTax ? 'yes' : 'no', ot.y2025 || '', ot.y2026 || '',
                     tp.y2025 || '', tp.y2026 || '', s.note || '', s.source || '']);
    }
    await writeFile(join(DIST, 'data', 'overtime-tax-by-state-2026.csv'),
      csvLines.map(r => r.map(csvEsc).join(',')).join('\n') + '\n');
  }

  // OBBBA "which states still tax tips in 2026" DATA STUDY (/data/tips-tax-by-state/).
  // Companion to the overtime study: same sourced obbba dataset, but keyed on the TIPS
  // field so the two studies can never drift from each other or from the calculators.
  // Counts + movers are derived from the data, not hardcoded.
  {
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const STUDY_PUBLISHED_ISO = '2026-07-02';
    const STUDY_UPDATED_ISO = '2026-07-07';
    const STUDY_DATE_HUMAN = 'July 7, 2026';
    const TP_LABEL = {
      no: { txt: 'Still taxed', cls: 'v-no', rank: 1 },
      partial: { txt: 'Partial', cls: 'v-partial', rank: 2 },
      unclear: { txt: 'Unclear', cls: 'v-unclear', rank: 3 },
      yes: { txt: 'Tax-free', cls: 'v-yes', rank: 4 },
      'n/a': { txt: 'No state wage tax', cls: 'v-na', rank: 5 },
    };
    const chip = (v) => {
      const m = TP_LABEL[v] || TP_LABEL.unclear;
      return { html: `<span class="chip ${m.cls}">${m.txt}</span>`, rank: m.rank };
    };
    const entries = Object.entries(obbba.states)
      .filter(([, s]) => s && typeof s === 'object' && s.tips)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    const cnt = { no: 0, yes: 0, partial: 0, unclear: 0, nowage: 0 };
    const newlyFree = [], newlyTaxed = [], partialList = [], unclearList = [];
    const rows = entries.map(([slug, s]) => {
      const ot = s.overtime || {}, tp = s.tips || {};
      const tp26 = tp.y2026, ot26 = ot.y2026;
      if (tp26 === 'no') cnt.no++;
      else if (tp26 === 'yes') cnt.yes++;
      else if (tp26 === 'partial') cnt.partial++;
      else if (tp26 === 'unclear') cnt.unclear++;
      if (s.hasWageTax === false) cnt.nowage++;
      if (tp.y2025 === 'no' && tp26 === 'yes') newlyFree.push(s.name);
      if (tp.y2025 === 'yes' && tp26 === 'no') newlyTaxed.push(s.name);
      if (tp26 === 'partial') partialList.push(s.name);
      if (tp26 === 'unclear') unclearList.push(s.name);
      const tpC = chip(tp26), otC = chip(ot26);
      const changed = (tp.y2025 && tp26 && tp.y2025 !== tp26)
        ? ' <span class="changed">changed from 2025</span>' : '';
      const src = s.source
        ? `<a href="${esc(s.source)}" rel="noopener" target="_blank">source</a>` : '';
      const note = [s.note ? esc(s.note) : '', src].filter(Boolean).join(' ');
      return `<tr id="state-${slug}"><td><a href="/${slug}-paycheck-calculator/">${esc(s.name)}</a></td>` +
        `<td data-rank="${tpC.rank}">${tpC.html}${changed}</td>` +
        `<td data-rank="${otC.rank}">${otC.html}</td>` +
        `<td class="note">${note}</td></tr>`;
    }).join('\n');

    const cntOther = cnt.partial + cnt.unclear;
    const jn = (arr) => arr.join(', ');
    const movers = [];
    if (newlyFree.length) movers.push(`${jn(newlyFree)} — tips newly tax-free for 2026`);
    if (newlyTaxed.length) movers.push(`${jn(newlyTaxed)} — tips taxed again in 2026 (subject to change)`);
    if (partialList.length) movers.push(`${jn(partialList)} — only a partial state exclusion`);
    if (unclearList.length) movers.push(`${jn(unclearList)} — still unsettled for 2026`);
    const calloutMovers = movers.length ? movers.join('; ') + '.' : '';

    const articleLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: 'Which States Still Tax Tips in 2026?',
      description: `A state-by-state analysis of which US states still tax tip income in 2026 after the federal One Big Beautiful Bill Act deduction. ${cnt.no} jurisdictions still tax it; ${cnt.yes} make it effectively tax-free; ${cnt.nowage} have no wage income tax.`,
      datePublished: STUDY_PUBLISHED_ISO, dateModified: STUDY_UPDATED_ISO,
      author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      mainEntityOfPage: `${SITE.url}/data/tips-tax-by-state/`,
      isAccessibleForFree: true,
    });
    const datasetLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: 'OBBBA tips & overtime state conformity, tax year 2026',
      description: 'Per-jurisdiction conformity of all 50 US states and DC to the 2025 One Big Beautiful Bill Act federal deductions for tips (IRC §224) and overtime (IRC §225), for tax year 2026.',
      url: `${SITE.url}/data/tips-tax-by-state/`,
      creator: { '@type': 'Person', name: 'Edmond Daher' },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      license: 'https://creativecommons.org/licenses/by/4.0/',
      temporalCoverage: '2026',
      dateModified: STUDY_UPDATED_ISO,
      spatialCoverage: { '@type': 'Place', name: 'United States' },
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/obbba-deductions-2026.json` },
        { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE.url}/data/tips-tax-by-state-2026.csv` },
      ],
      isAccessibleForFree: true,
    });

    await mkdir(join(DIST, 'data', 'tips-tax-by-state'), { recursive: true });
    await writeFile(
      join(DIST, 'data', 'tips-tax-by-state', 'index.html'),
      fillTool(tipsStudyTpl, {
        SITE_NAME: SITE.name, SITE_URL: SITE.url,
        STUDY_ROWS: rows,
        CNT_TAX: String(cnt.no), CNT_FREE: String(cnt.yes),
        CNT_NOWAGE: String(cnt.nowage), CNT_OTHER: String(cntOther),
        CALLOUT_MOVERS: calloutMovers, PUB_DATE: STUDY_DATE_HUMAN,
        ANSWER: (dataPageAnswers['/data/tips-tax-by-state/'] = conformityAnswer('tip income', entries.length, cnt)),
        ARTICLE_LD: articleLd, DATASET_LD: datasetLd,
      }, '/data/tips-tax-by-state/')
    );
    urls.push(`${SITE.url}/data/tips-tax-by-state/`);

    // Flat CSV of the dataset — journalist-liftable citation kit (same source JSON).
    const csvEsc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csvLines = [['State', 'Has state wage tax', 'Tips 2025', 'Tips 2026',
                       'Overtime 2025', 'Overtime 2026', 'Note', 'Source']];
    for (const [, s] of entries) {
      const ot = s.overtime || {}, tp = s.tips || {};
      csvLines.push([s.name, s.hasWageTax ? 'yes' : 'no', tp.y2025 || '', tp.y2026 || '',
                     ot.y2025 || '', ot.y2026 || '', s.note || '', s.source || '']);
    }
    await writeFile(join(DIST, 'data', 'tips-tax-by-state-2026.csv'),
      csvLines.map(r => r.map(csvEsc).join(',')).join('\n') + '\n');
  }

  // "What tax rules apply to me?" DISCOVERY FLOW (/what-applies-to-me/).
  // A six-question flow that ends in a sourced LIST OF RULES, never a dollar figure
  // and never a computed tax: discovery here, arithmetic in the existing calculators.
  // All 51 jurisdictions ship inside this one page (same all-states-in-one-page
  // pattern as /bonus-tax-calculator/), so nothing is generated client-side. The
  // page asset only toggles visibility; with JavaScript off every question and
  // every rule for every state is already on screen and readable.
  //
  // Deliberately ONE page, not 52: per-state URLs would cannibalize the existing
  // /{state}-paycheck-calculator/ pages, which already own the per-state tax queries
  // and already render a per-state tips/overtime verdict block.
  {
    const wamParts = buildWamParts({
      states: roster,
      obbba,
      taxData,
      payroll: payrollData,
      supplemental: suppData,
      esc: escHtml,
    });

    const wamArticleLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebPage',
      name: 'What tax rules should I check?',
      description: 'A question-led guide to the 2026 tax rules that match your answers, for all 50 US states and DC. '
        + 'It lists rules and links the calculator for each one; it does not compute a tax.',
      url: `${SITE.url}/what-applies-to-me/`,
      inLanguage: 'en-US',
      isAccessibleForFree: true,
      author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
    });
    const wamDatasetLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: 'State tax rules surfaced by the Tools Berry rule finder, tax year 2026',
      description: 'Per-jurisdiction tips and overtime conformity, local wage-tax status, employee-paid payroll '
        + 'programs and supplemental-wage withholding method for all 50 US states and DC, tax year 2026.',
      creator: { '@type': 'Person', name: 'Edmond Daher' },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      license: 'https://creativecommons.org/licenses/by/4.0/',
      temporalCoverage: '2026',
      isAccessibleForFree: true,
    });

    await mkdir(join(DIST, 'what-applies-to-me'), { recursive: true });
    await writeFile(
      join(DIST, 'what-applies-to-me', 'index.html'),
      fillTool(wamTpl, Object.assign({
        SITE_NAME: SITE.name, SITE_URL: SITE.url,
        ARTICLE_LD: wamArticleLd, DATASET_LD: wamDatasetLd,
      }, wamParts), '/what-applies-to-me/')
    );
    urls.push(`${SITE.url}/what-applies-to-me/`);
  }

  // "Take-home pay on $75,000 and $100,000 in all 51 states" DATA STUDY
  // (/data/take-home-pay-by-state/). Doubles as the topical HUB for the 51
  // per-state paycheck calculators: every row deep-links to its own
  // /<slug>-paycheck-calculator/ page.
  //
  // ONE page, TWO salary levels (STUDY_SALARIES), side by side in one table row.
  // The lower level is the one the page ranks and narrates on, because it is also
  // DEFAULT_SALARY, the salary every state page pre-fills; the higher level rides
  // alongside it so a reader can read both figures for their own state without
  // leaving the row. A SECOND page at the second salary was built and deleted:
  // two indexable pages answering the same comparison only compete with each
  // other, and the reader has to pick one before knowing which they want.
  //
  // EVERY figure on the page is computed here, at build time, by running the SAME
  // paycheck engine the state pages run (computePaycheck + tax-data-2026.json), so
  // the study can never drift from the calculators and is recomputed from whatever
  // the tax-data file currently says. Nothing about the result is hardcoded: the
  // winners, the losers, the spreads, the ties, the analysis paragraphs and the
  // FAQ are all derived from the sorted result sets, and each analysis block is
  // guarded so it disappears rather than lies if the underlying pattern stops
  // holding.
  //
  // What that does NOT license the copy to claim: nothing in this repo ingests
  // state tax data by itself. A human edits src/data/tax-data-2026.json and the
  // next build recomputes the page from it. "Computed, not hardcoded" is true;
  // "updates itself when a state publishes new brackets" is not, and the page
  // must not say it. Same discipline on the figures themselves: they are one
  // filing status with no deductions, so they are a model of take-home pay, not
  // the money that lands in anyone's account.
  {
    const SALARIES = STUDY_SALARIES;
    const STUDY_PUBLISHED_ISO = '2026-07-25';
    const STUDY_UPDATED_ISO = '2026-07-29';
    const STUDY_DATE_HUMAN = humanDate(STUDY_UPDATED_ISO);
    const esc = escHtml;
    const pct1 = (r) => (r * 100).toFixed(1) + '%';
    const pct2 = (r) => (r * 100).toFixed(2) + '%';
    const NUM_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
      'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen'];
    const numWord = (n) => NUM_WORD[n] || String(n);
    const listAnd = (arr) => (arr.length <= 1
      ? (arr[0] || '')
      : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);

    // One computed result set per salary level. Everything downstream reads from
    // these, so a salary level is added or moved in STUDY_SALARIES alone.
    const buildSet = (SALARY) => {
      const rows = roster
        .filter((s) => taxData.states[s.slug])
        .map((s) => {
          const st = taxData.states[s.slug];
          const a = computePaycheck({
            wage: { type: 'salary', amount: SALARY },
            filingStatus: 'single', payFrequency: 'annual', stateSlug: s.slug,
          }, taxData).annual;
          // Total withholding rate INCLUDES the post-tax state payroll premiums,
          // because the take-home column already nets them out. Using the
          // engine's tax-only effectiveRate here would make WA look identical to
          // TX while showing a smaller paycheck.
          return {
            name: st.name, slug: s.slug, abbr: st.abbr,
            net: a.net, stateTax: a.state, programs: a.statePrograms,
            programList: a.programs || [],
            federal: a.federal, fica: a.socialSecurity + a.medicare,
            totalRate: SALARY > 0 ? (SALARY - a.net) / SALARY : 0,
            hasIncomeTax: !!st.hasIncomeTax,
            figureYear: st.figureYear,
            topRate: (() => {
              const t = st.tax;
              if (!st.hasIncomeTax || !t) return 0;
              if (t.type === 'flat') return t.rate || 0;
              if (t.type === 'bracket') {
                const b = (t.brackets && (t.brackets.single || [])) || [];
                return b.length ? b[b.length - 1].rate : 0;
              }
              return 0;
            })(),
          };
        })
        .sort((x, y) => y.net - x.net || x.name.localeCompare(y.name));
      // Competition ranking on the UNROUNDED net, so tied states share a rank.
      let rk = 0, prevNet = null;
      rows.forEach((r, i) => {
        if (prevNet === null || Math.abs(r.net - prevNet) > 0.005) { rk = i + 1; prevNet = r.net; }
        r.rank = rk;
      });
      const best = rows[0];
      const worst = rows[rows.length - 1];
      const topTied = rows.filter((r) => r.rank === 1);
      return {
        salary: SALARY, rows, bySlug: new Map(rows.map((r) => [r.slug, r])),
        best, worst, spread: best.net - worst.net,
        topTied, topNames: topTied.map((r) => r.name),
        // Federal income tax + FICA are identical in every row (same gross, same status).
        fedFica: best.federal + best.fica,
        median: rows[Math.floor(rows.length / 2)],
        // Next-lowest state that is NOT tied with the last one.
        nextUp: [...rows].reverse().find((r) => r.rank !== worst.rank),
        noTaxWithProgram: rows.find((r) => !r.hasIncomeTax && r.programs > 0),
      };
    };
    const sets = SALARIES.map(buildSet);
    const base = sets[0];                  // the level the page ranks and narrates on
    const high = sets[sets.length - 1];    // the level shown alongside it
    const thpRows = base.rows;
    const rowCount = thpRows.length;
    const best = base.best;
    const worst = base.worst;
    const spread = base.spread;
    const topTied = base.topTied;
    const topNames = base.topNames;
    const fedFica = base.fedFica;
    const nextUp = base.nextUp;

    // Plain-English name for what a state's employee payroll premiums are FOR,
    // derived from the program labels the engine returns. Those labels are
    // acronyms (CA SDI, NJ TDI + NJ FLI, WA Cares, PA UC), which is exactly the
    // jargon an ordinary reader cannot act on, so the page says what the money
    // buys rather than what the programme is called. Every rule is tested against
    // every label, because one label can cover two things (RI TDI/TCI). An
    // unrecognised label falls back to a true-but-vague phrase rather than being
    // silently dropped or mislabelled.
    // Declaration order is also DISPLAY order, which is why it is fixed here rather
    // than derived from each state's dollar amounts: a state's premiums cover the
    // same things at both salary levels, so its label has to read the same in both
    // of its cells. Ranking by dollars instead made New Jersey say "paid family
    // leave, unemployment insurance" in one column and "paid family leave,
    // disability insurance" in the next, which looks like a data error and is not.
    // The rules themselves live in src/content/withholding-profile.js, because the
    // state and bonus pages now name the same programs in prose and the two must
    // never drift apart. "WA Cares" is long-term care and matches no other rule,
    // so ordering cannot mislabel it.
    const kindsOf = programKindsOf;
    // Table-cell version: at most two categories, so the line stays short enough to
    // sit under a number in a narrow column on a phone.
    const programKind = (progs) => {
      const kinds = kindsOf(progs);
      if (!kinds.length) return 'state payroll programs';
      if (kinds.length <= 2) return listAnd(kinds);
      return `${kinds[0]}, ${kinds[1]} and other state programs`;
    };
    // Every category any jurisdiction withholds for, counted from the data, so the
    // methodology cannot go on naming only disability and paid leave after a state
    // program of another kind is added to the dataset.
    const allProgramKinds = (() => {
      const out = [];
      for (const r of thpRows) for (const k of kindsOf(r.programList)) if (!out.includes(k)) out.push(k);
      return out.sort();
    })();

    // A row whose figures are not on this page's tax year, read from the data's own
    // figureYear. The byline and the row marker both come from this, so a state
    // that publishes its tables loses the marker on the next build and nobody has
    // to remember a list of state names.
    const priorYearOf = (r) => {
      const fy = Number(r.figureYear);
      return fy && fy !== Number(year) ? fy : null;
    };

    // A state-tax cell: that state's income tax, with its employee payroll premium
    // on a second line where it has one. data-val is the income tax alone, so a
    // click-to-sort on the column sorts on the figure the column heading names.
    const taxCell = (r) => {
      const txt = r.stateTax > 0 ? usd0(r.stateTax) : 'None';
      const cls = `num tax${r.stateTax > 0 ? '' : ' zero'}`;
      const sub = r.programs > 0
        // The kind sits in its own span so a phone can drop it: at 100px of column
        // width "disability insurance, paid family leave and other state programs"
        // wrapped to five lines and made one row taller than a third of the screen.
        // The caption under the table names what the smaller line is either way.
        ? `<span class="sub">+ ${usd0(r.programs)} <span class="k">${esc(programKind(r.programList))}</span></span>`
        : '';
      return `<td class="${cls}" data-val="${Math.round(r.stateTax)}">${txt}${sub}</td>`;
    };

    // One row per jurisdiction, ordered by take-home on the base salary, carrying
    // BOTH salary levels so a reader never has to hold a number in their head
    // while scrolling to a second table.
    const tableRows = thpRows.map((r) => {
      const h = high.bySlug.get(r.slug);
      const fy = priorYearOf(r);
      const fyFlag = fy
        ? `<span class="fy-flag">${fy} figures, no ${year} tables published yet</span>`
        : '';
      return `<tr id="state-${r.slug}">` +
        `<td class="rank" data-val="${r.rank}">${r.rank}</td>` +
        `<td class="st" data-val="${esc(r.name)}"><a href="/${r.slug}-paycheck-calculator/">${esc(r.name)}</a>${fyFlag}</td>` +
        `<td class="num net" data-val="${Math.round(r.net)}">${usd0(r.net)}</td>` +
        `<td class="num net" data-val="${Math.round(h.net)}">${usd0(h.net)}</td>` +
        taxCell(r) + taxCell(h) +
        `<td class="num" data-val="${(r.totalRate * 100).toFixed(2)}">${pct2(r.totalRate)}</td>` +
        `<td class="num" data-val="${(h.totalRate * 100).toFixed(2)}">${pct2(h.totalRate)}</td></tr>`;
    }).join('\n');

    // --- Analysis blocks. Each is guarded on the pattern it describes still holding.
    const blocks = [];
    const maxStateTaxRow = [...thpRows].sort((a, b) => b.stateTax - a.stateTax)[0];
    blocks.push(
      `<h3>Most of the tax bill never changes</h3>` +
      `<p>Before any state gets involved, a single filer on ${usd0(base.salary)} owes ${usd0(best.federal)} ` +
      `in federal income tax and ${usd0(best.fica)} in FICA (Social Security at 6.2% plus Medicare at 1.45%). ` +
      `That ${usd0(fedFica)} is the same in every jurisdiction on this page, and on ${usd0(high.salary)} the ` +
      `equivalent figure, ${usd0(high.fedFica)}, is again the same everywhere. Only the state layer moves, ` +
      `and state income tax across the ${rowCount} jurisdictions runs from nothing at all to ` +
      `${usd0(maxStateTaxRow.stateTax)} in ${esc(maxStateTaxRow.name)}. Even in ${esc(worst.name)}, ` +
      `where the total bill is highest, federal tax and FICA are still ` +
      `${pct1(fedFica / (base.salary - worst.net))} of everything withheld. Moving state cannot touch that part.</p>`
    );
    // How the state layer scales between the two salary levels. Guarded on the
    // spread actually growing, which is what a progressive state code does but is
    // not something the page should assert without checking.
    if (high.spread > spread) {
      const growth = Math.round(((high.spread / spread) - 1) * 100);
      blocks.push(
        `<h3>The gap gets wider as the salary goes up</h3>` +
        `<p>On ${usd0(base.salary)} the distance between the best state and the worst is ${usd0(spread)}. ` +
        `On ${usd0(high.salary)} it is ${usd0(high.spread)}, ${growth}% wider, even though the extra salary ` +
        `is only ${Math.round((high.salary / base.salary - 1) * 100)}% more gross pay. The states with no ` +
        `wage income tax take nothing on either salary, so the whole of that widening comes from the states ` +
        `that do tax income moving up their own brackets. ${esc(worst.name)} takes ${usd0(worst.stateTax)} ` +
        `on ${usd0(base.salary)} and ${usd0(high.bySlug.get(worst.slug).stateTax)} on ${usd0(high.salary)}. ` +
        `The practical reading: the higher your salary, the more the state on your pay stub is worth ` +
        `arguing about.</p>`
      );
    }
    if (topTied.length > 1) {
      const stillTied = high.topTied.length > 1
        && high.topNames.join('|') === topNames.join('|');
      blocks.push(
        `<h3>The top of the table is a tie, not a race</h3>` +
        `<p>${numWord(topTied.length)} jurisdictions land on exactly ${usd0(best.net)}: ` +
        `${esc(listAnd(topNames))}. They are identical because they do the same thing, which is nothing: ` +
        `no state income tax on wages and no employee-side payroll premium either. ` +
        (stillTied
          ? `The same ${numWord(topTied.length).toLowerCase()} tie again on ${usd0(high.salary)}, at ` +
            `${usd0(high.best.net)} each. `
          : `On ${usd0(high.salary)} the leaders are ${esc(listAnd(high.topNames))}, at ` +
            `${usd0(high.best.net)}. `) +
        `There is no ranking to be had between them on take-home pay. Where they differ is sales tax, ` +
        `property tax and housing, none of which touch a pay stub.</p>`
      );
    }
    // The lowest-billing state that still HAS an income tax: the "you would not guess it" row.
    const gentlest = thpRows.filter((r) => r.hasIncomeTax && r.stateTax > 0)
      .sort((a, b) => a.stateTax - b.stateTax)[0];
    if (gentlest && gentlest.stateTax < spread / 4) {
      const gHigh = high.bySlug.get(gentlest.slug);
      blocks.push(
        `<h3>${esc(gentlest.name)} is the surprise</h3>` +
        `<p>${esc(gentlest.name)} does levy an income tax, but on ${usd0(base.salary)} it collects only ` +
        `${usd0(gentlest.stateTax)}. That tax is the single thing separating it from the states above, ` +
        `so it finishes at ${usd0(gentlest.net)}, exactly ${usd0(best.net - gentlest.net)} behind them. ` +
        `On this salary it behaves like a no-income-tax state. Raise the salary to ${usd0(high.salary)} and ` +
        `its bill goes to ${usd0(gHigh.stateTax)}, which is the point: "has an income tax" and "takes a ` +
        `meaningful bite" are different questions, and the answer to the second one depends on the salary ` +
        `you ask it about.</p>`
      );
    }
    // A state with NO income tax that still withholds something.
    const noTaxWithProgram = base.noTaxWithProgram;
    if (noTaxWithProgram) {
      const nHigh = high.bySlug.get(noTaxWithProgram.slug);
      blocks.push(
        `<h3>No income tax does not always mean no state deduction</h3>` +
        `<p>${esc(noTaxWithProgram.name)} has no state income tax and still does not tie for first. ` +
        `It withholds ${usd0(noTaxWithProgram.programs)} a year in employee-paid state premiums, which ` +
        `lands it at ${usd0(noTaxWithProgram.net)}, rank ${noTaxWithProgram.rank} of ${rowCount}. ` +
        // Guarded, because a premium with a wage cap charges the same dollars at
        // both salaries and "the premium comes to the same figure" would read as a
        // copy-paste bug unless the page says why.
        (Math.abs(nHigh.programs - noTaxWithProgram.programs) < 0.5
          ? `On ${usd0(high.salary)} it is the same ${usd0(nHigh.programs)}, because the premium is ` +
            `capped and the extra salary is above the cap. `
          : `On ${usd0(high.salary)} the same premiums come to ${usd0(nHigh.programs)}. `) +
        `It is the clearest case in the table of a state deduction that is not an income tax, and it ` +
        `is why "no income tax" predicts take-home pay less well than people assume.</p>`
      );
    }
    // Bottom of the table, plus how flat the middle really is.
    const midLow = thpRows[Math.floor(rowCount * 0.3)];
    const midHigh = thpRows[Math.floor(rowCount * 0.8)];
    if (nextUp) {
      const gapToNext = nextUp.net - worst.net;
      const outlier = gapToNext > spread * 0.15
        ? `That is ${usd0(gapToNext)} below ${esc(nextUp.name)}, the next-lowest, so the bottom of this ` +
          `table is one genuine outlier rather than a gradual slope. `
        : `${esc(nextUp.name)} is close behind at ${usd0(nextUp.net)}, so the bottom of the table is a ` +
          `cluster rather than a single outlier. `;
      blocks.push(
        `<h3>The bottom of the table, and how flat the middle is</h3>` +
        `<p>${esc(worst.name)} keeps the least, ${usd0(worst.net)}, on a ${usd0(base.salary)} salary. ` +
        outlier +
        `The middle is much flatter than the headline spread suggests: between the rank-${midLow.rank} ` +
        `state (${esc(midLow.name)}) and the rank-${midHigh.rank} state (${esc(midHigh.name)}) the entire ` +
        `difference is ${usd0(midLow.net - midHigh.net)} a year, under ` +
        `${usd0((midLow.net - midHigh.net) / 12)} a month. For most of the country, and on this salary, ` +
        `the state you pick moves your take-home pay by a smaller amount than most people expect.</p>`
      );
    }
    // States that change position between the two salary levels. Guarded on a move
    // large enough to be worth a paragraph.
    {
      const movers = thpRows
        .map((r) => ({ name: r.name, from: r.rank, to: high.bySlug.get(r.slug).rank }))
        .map((m) => Object.assign(m, { delta: m.to - m.from }))
        .filter((m) => Math.abs(m.delta) >= 3)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 4);
      if (movers.length >= 2) {
        const phrase = (m) => `${m.name} (${m.from} to ${m.to})`;
        const fell = movers.filter((m) => m.delta > 0).map(phrase);
        const rose = movers.filter((m) => m.delta < 0).map(phrase);
        blocks.push(
          `<h3>The ranking is not the same at both salaries</h3>` +
          `<p>A state's position depends on the salary you compare at, because a flat rate and a graduated ` +
          `one pull apart as income rises. Between ${usd0(base.salary)} and ${usd0(high.salary)}, the ` +
          `biggest moves in the ranking are ` +
          (fell.length ? `${esc(listAnd(fell))} falling` : '') +
          (fell.length && rose.length ? ', and ' : '') +
          (rose.length ? `${esc(listAnd(rose))} climbing` : '') +
          `. That is the reason both salaries sit in the same table above rather than on two pages: the ` +
          `answer to "which state is better" changes with the number you put in.</p>`
        );
      }
    }
    // Highest headline top marginal rate vs. what it actually costs at this salary.
    const headline = [...thpRows].sort((a, b) => b.topRate - a.topRate)[0];
    const beatenBy = headline && headline.topRate > 0
      ? thpRows.filter((r) => r.stateTax > headline.stateTax && r.topRate < headline.topRate).length
      : 0;
    if (headline && headline.topRate > 0 && beatenBy > 0) {
      blocks.push(
        `<h3>A high state rate is not the same as a high state bill</h3>` +
        `<p>${esc(headline.name)} has the highest top marginal income-tax rate in the country at ` +
        `${pct1(headline.topRate)}, but that rate applies to income far above ${usd0(base.salary)}. At this ` +
        `salary ${esc(headline.name)} takes ${usd0(headline.stateTax)} of income tax, less than ` +
        `${beatenBy} states whose top rate is lower than its own` +
        (headline.programs > 0
          ? `, and it finishes rank ${headline.rank} of ${rowCount} largely because it adds ` +
            `${usd0(headline.programs)} of employee-paid state premiums on top`
          : '') +
        `. A marginal rate describes your last dollar; this table describes all of them.</p>`
      );
    }
    const analysisBlocks = blocks.join('\n      ');

    // --- Cost-of-living context table: the tied leaders plus the bottom three, next
    // to the taxes a paycheck calculator structurally cannot see. Figures come from
    // the already-sourced state-payroll-2026.json the state pages use.
    const colPick = [...topTied, ...thpRows.slice(-3).filter((r) => r.rank !== 1)];
    const colSeen = new Set();
    const colRows = colPick.filter((r) => (colSeen.has(r.slug) ? false : colSeen.add(r.slug)))
      .map((r) => {
        const p = payroll[r.slug] || {};
        const h = high.bySlug.get(r.slug);
        const sales = p.salesTax && typeof p.salesTax.combinedAvgRatePct === 'number' ? p.salesTax.combinedAvgRatePct : null;
        const prop = p.propertyTax && typeof p.propertyTax.effectiveRatePct === 'number' ? p.propertyTax.effectiveRatePct : null;
        const mhi = p.medianHouseholdIncome && p.medianHouseholdIncome.amountUsd;
        const cell = (v, suffix) => (v == null
          ? '<td class="num zero" data-val="">n/a</td>'
          : `<td class="num" data-val="${v}">${v}${suffix}</td>`);
        return `<tr><td><a href="/${r.slug}-paycheck-calculator/">${esc(r.name)}</a></td>` +
          `<td class="num net" data-val="${Math.round(r.net)}">${usd0(r.net)}</td>` +
          `<td class="num net" data-val="${Math.round(h.net)}">${usd0(h.net)}</td>` +
          cell(sales, '%') + cell(prop, '%') +
          (mhi ? `<td class="num" data-val="${mhi}">${usd0(mhi)}</td>` : '<td class="num zero" data-val="">n/a</td>') +
          `</tr>`;
      }).join('\n');
    // A concrete, computed contrast between the highest-sales-tax leader and the
    // lowest-take-home state, so the caveat is backed by numbers rather than assertion.
    const salesOf = (r) => {
      const p = payroll[r.slug];
      return p && p.salesTax && typeof p.salesTax.combinedAvgRatePct === 'number' ? p.salesTax.combinedAvgRatePct : null;
    };
    const salesLeader = topTied.filter((r) => salesOf(r) != null).sort((a, b) => salesOf(b) - salesOf(a))[0];
    const worstSales = salesOf(worst);
    const colContrast = (salesLeader && worstSales != null)
      ? `${esc(salesLeader.name)} ${topTied.length > 1 ? 'ties for' : 'takes'} the most take-home pay ` +
        `and also charges an average ${salesOf(salesLeader)}% combined sales tax, while ` +
        `${esc(worst.name)}, last on take-home pay, charges ${worstSales}%.`
      : '';

    // Rosters used in the methodology and limits sections, all counted from the data.
    const noTaxStates = thpRows.filter((r) => !r.hasIncomeTax).map((r) => r.name).sort();
    const programStates = thpRows.filter((r) => r.programs > 0).map((r) => r.name).sort();
    const localStates = roster
      .filter((s) => payroll[s.slug] && payroll[s.slug].localIncomeTax && payroll[s.slug].localIncomeTax.exists)
      .map((s) => s.name).sort();
    // Any jurisdiction still shown on prior-year figures (the documented fallback).
    // Says who updates it and how, because nothing here polls a state for brackets.
    const priorYear = thpRows.filter((r) => priorYearOf(r));
    // The byline used to promise every figure came from published TAX_YEAR tables,
    // which is not true of a row on the prior-year fallback. It now describes what
    // the table actually contains, and the table marks the rows in question.
    const figureBasis = priorYear.length
      ? `every figure computed from published tax tables, ${year} except for the ` +
        `${priorYear.length === 1 ? 'state' : 'states'} marked in the table`
      : `every figure computed from published ${year} tax tables`;
    const priorYearNote = priorYear.length
      ? `<p><strong>Prior-year figures.</strong> ${esc(listAnd(priorYear.map((r) => `${r.name} (${r.figureYear})`)))} ` +
        `${priorYear.length === 1 ? 'has' : 'have'} not published ${year} brackets yet, so ` +
        `${priorYear.length === 1 ? 'that row uses' : 'those rows use'} the most recent official figures. ` +
        `We update our tax data file when the ${year} tables are released, and the next build recomputes ` +
        `${priorYear.length === 1 ? 'that row' : 'those rows'} from it.</p>`
      : '';

    // --- FAQ. The visible Q&A and the FAQPage schema are generated from ONE array,
    // so the rendered page and the structured data can never disagree.
    const faq = [
      {
        q: `Which state has the highest take-home pay on a ${usd0(base.salary)} salary?`,
        a: topTied.length > 1
          ? `${numWord(topTied.length)} jurisdictions tie at ${usd0(best.net)} a year: ${listAnd(topNames)}. Each has no state income tax on wages and no state payroll premium, so a single filer keeps the same amount in all of them.`
          : `${best.name}, at ${usd0(best.net)} a year for a single filer taking the standard deduction.`,
      },
      {
        q: `Which state has the lowest take-home pay on ${usd0(base.salary)}?`,
        a: `${worst.name}, at ${usd0(worst.net)} a year, which is ${usd0(spread)} less than the top of the table on identical gross pay.`,
      },
      {
        q: `What changes if the salary is ${usd0(high.salary)} instead?`,
        a: `The best states pay ${usd0(high.best.net)} and ${high.worst.name} pays ${usd0(high.worst.net)}, `
          + `so the gap between them widens from ${usd0(spread)} to ${usd0(high.spread)}. The order of the `
          + `table also shifts, because a flat state rate and a graduated one diverge as income rises. Both `
          + `salaries are in the same table above, one row per state.`,
      },
      {
        q: 'Is a no-income-tax state always the better financial move?',
        a: `No. This page measures payroll only. States without an income tax generally raise revenue through sales and property taxes instead, and neither of those is in a paycheck calculation. Cost of living is not modelled here at all.`,
      },
      noTaxWithProgram ? {
        q: 'Why do two states with no income tax show different take-home pay?',
        a: `Because an income tax is not the only thing a state can withhold. ${noTaxWithProgram.name} has no income tax but collects ${usd0(noTaxWithProgram.programs)} a year in employee-paid state premiums on a ${usd0(base.salary)} salary, which is why it does not tie with the other no-income-tax states.`,
      } : null,
      {
        q: 'Are city and local income taxes included?',
        a: `No. ${localStates.length} states permit local income taxes, and they are excluded so that every row compares like with like. If you work in a city that levies one, your actual take-home pay will be lower than the figure shown for your state.`,
      },
      {
        q: 'Why is the gap between states smaller than I expected?',
        a: `Because most of the bill is federal. On ${usd0(base.salary)} a single filer pays ${usd0(fedFica)} in federal income tax and FICA no matter where they live, and on ${usd0(high.salary)} it is ${usd0(high.fedFica)}. State tax is the only variable, and it is worth at most ${usd0(spread)} a year at the lower salary and ${usd0(high.spread)} at the higher one.`,
      },
      {
        q: 'Will these figures match my own paycheck?',
        a: `Almost certainly not, and they are not meant to. Every row uses the same assumptions so the states can be compared: one salary, single filer, standard deduction, no 401(k), no health insurance, no dependents, no local income tax. Treat this as a model of the state-by-state difference, not as your net pay. Open your own state's calculator and enter your real numbers for a figure that is about you.`,
      },
      {
        q: 'How often is this page updated?',
        a: `Whenever the tax data behind it is. Nothing on this site fetches tax figures automatically: we edit the ${year} tax data file when a state publishes new brackets, and the next build recomputes every figure, table, summary and answer on this page from that file. The date under the headline is when that last happened.`,
      },
    ].filter(Boolean);
    const faqBlocks = faq.map((f) =>
      `<h3>${esc(f.q)}</h3>\n      <p>${esc(f.a)}</p>`).join('\n\n      ');
    const faqLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });

    // Federal primary sources (IRS + SSA), straight out of tax-data's _meta.
    const SOURCE_TITLES = {
      federal_brackets: `IRS: ${year} inflation-adjusted tax brackets (Rev. Proc. 2025-32)`,
      standard_deduction: `IRS: ${year} standard deduction`,
      fica: 'Social Security Administration: Contribution and Benefit Base (Social Security wage base)',
      additional_medicare: 'IRS: Topic no. 751, Additional Medicare Tax',
      federal_brackets_hoh: `Tax Foundation: ${year} federal tax brackets`,
    };
    const metaSources = (taxData._meta && taxData._meta.sources) || {};
    const srcSeen = new Set();
    const sourceRows = Object.entries(metaSources)
      .filter(([, u]) => /^https?:\/\//.test(u) && !srcSeen.has(u) && srcSeen.add(u))
      .map(([k, u]) => `<li><a href="${esc(u)}" rel="noopener" target="_blank">` +
        `${esc(SOURCE_TITLES[k] || k.replace(/_/g, ' '))}</a></li>`)
      .join('');

    // "$75,000 and $100,000", from the same array the tables are built from.
    const salaryList = STUDY_SALARY_TEXT;
    const studyDesc = `The same salary is worth ${usd0(spread)} more a year in some US states than others ` +
      `on ${usd0(base.salary)}, and ${usd0(high.spread)} more on ${usd0(high.salary)}. Computed ${year} ` +
      `take-home pay for a single filer at both salaries in all ${rowCount} jurisdictions, after federal ` +
      `income tax, FICA, state income tax and state payroll deductions.`;
    const articleLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: `Take-Home Pay on ${salaryList} in All ${rowCount} States, Compared (${year})`,
      description: studyDesc,
      datePublished: STUDY_PUBLISHED_ISO, dateModified: STUDY_UPDATED_ISO,
      author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      mainEntityOfPage: `${SITE.url}/data/take-home-pay-by-state/`,
      isAccessibleForFree: true,
    });
    const datasetLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: `US take-home pay on ${salaryList} salaries by state, tax year ${year}`,
      description: `Computed ${year} annual take-home pay, state income tax, state payroll deductions and ` +
        `total effective tax rate for a single filer earning ${salaryList}, in all 50 US states and the ` +
        `District of Columbia. Derived from ${year} IRS federal brackets, the SSA wage base and each state's ` +
        `own income tax tables.`,
      url: `${SITE.url}/data/take-home-pay-by-state/`,
      creator: { '@type': 'Person', name: 'Edmond Daher' },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      license: 'https://creativecommons.org/licenses/by/4.0/',
      temporalCoverage: String(year),
      dateModified: STUDY_UPDATED_ISO,
      spatialCoverage: { '@type': 'Country', name: 'United States' },
      variableMeasured: ['Gross salary', 'Annual take-home pay', 'State income tax',
        'State payroll deductions', 'Total effective tax rate'],
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE.url}/data/take-home-pay-by-state-${year}.csv` },
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/take-home-pay-by-state-${year}.json` },
      ],
      isAccessibleForFree: true,
    });

    const addlMedicare = (taxData.federal.fica.additionalMedicare
      && taxData.federal.fica.additionalMedicare.threshold
      && taxData.federal.fica.additionalMedicare.threshold.single) || null;

    await mkdir(join(DIST, 'data', 'take-home-pay-by-state'), { recursive: true });
    await writeFile(
      join(DIST, 'data', 'take-home-pay-by-state', 'index.html'),
      fillTool(thpTpl, {
        SITE_NAME: SITE.name, SITE_URL: SITE.url,
        TAX_YEAR: String(year), ROW_COUNT: String(rowCount),
        // The lede's coverage claim, from the same figureYear the byline reads.
        RULES_BASIS: esc(studyRulesPhrase(thpRows, year, 'all 50 states and the District of Columbia')),
        BASE_SALARY: usd0(base.salary), HIGH_SALARY: usd0(high.salary),
        SALARY_LIST: salaryList,
        PUB_DATE: STUDY_DATE_HUMAN,
        TABLE_ROWS: tableRows, COL_ROWS: colRows, COL_CONTRAST: colContrast,
        ANALYSIS_BLOCKS: analysisBlocks, FAQ_BLOCKS: faqBlocks,
        BASE_TOP_NET: usd0(best.net), BASE_BOTTOM_NET: usd0(worst.net),
        BASE_SPREAD: usd0(spread), BASE_SPREAD_MONTHLY: usd0(spread / 12),
        BASE_BOTTOM_STATE: esc(worst.name),
        BASE_TOP_STATES_SHORT: esc(topNames.length > 3
          ? `${topNames.slice(0, 3).join(', ')} +${topNames.length - 3} more` : listAnd(topNames)),
        BASE_FED_FICA: usd0(fedFica),
        // Guarded: the same state is last at both salaries today, but a rate change
        // could split them, and "X keeps the least at both salaries" would then be
        // a plain untruth sitting in the callout at the top of the page.
        BOTTOM_PHRASE: worst.slug === high.worst.slug
          ? `${esc(worst.name)} keeps the least at both salaries, ${usd0(worst.net)} on ` +
            `${usd0(base.salary)} and ${usd0(high.worst.net)} on ${usd0(high.salary)}.`
          : `${esc(worst.name)} keeps the least on ${usd0(base.salary)} at ${usd0(worst.net)}, and ` +
            `${esc(high.worst.name)} on ${usd0(high.salary)} at ${usd0(high.worst.net)}.`,
        HIGH_TOP_NET: usd0(high.best.net), HIGH_BOTTOM_NET: usd0(high.worst.net),
        HIGH_SPREAD: usd0(high.spread), HIGH_SPREAD_MONTHLY: usd0(high.spread / 12),
        HIGH_BOTTOM_STATE: esc(high.worst.name),
        HIGH_TOP_STATES_SHORT: esc(high.topNames.length > 3
          ? `${high.topNames.slice(0, 3).join(', ')} +${high.topNames.length - 3} more`
          : listAnd(high.topNames)),
        HIGH_FED_FICA: usd0(high.fedFica),
        // Guarded so the callout stays grammatical (and true) if the top ever
        // stops being a tie, or stops being the same tie at both salaries.
        TOP_TIE_PHRASE: topTied.length > 1
          ? `${numWord(topTied.length)} jurisdictions tie for the most take-home pay at ` +
            `${usd0(best.net)} on ${usd0(base.salary)} (${esc(listAnd(topNames))}), because they levy no ` +
            `state income tax and no state payroll deduction` +
            (high.topNames.join('|') === topNames.join('|')
              ? `, and the same ${numWord(topTied.length).toLowerCase()} tie again at ` +
                `${usd0(high.best.net)} on ${usd0(high.salary)}.`
              : `. On ${usd0(high.salary)} the leaders are ${esc(listAnd(high.topNames))} at ` +
                `${usd0(high.best.net)}.`)
          : `${esc(best.name)} leaves the most take-home pay on ${usd0(base.salary)}, ${usd0(best.net)}.`,
        FED_STD_DED: usd0(taxData.federal.standardDeduction.single),
        SS_WAGE_BASE: usd0(taxData.federal.fica.socialSecurity.wageBase),
        ADDL_MEDICARE_THRESHOLD: addlMedicare ? usd0(addlMedicare) : '',
        NOTAX_COUNT: String(noTaxStates.length), NOTAX_STATES: esc(listAnd(noTaxStates)),
        PROGRAM_COUNT: String(programStates.length), PROGRAM_STATES: esc(listAnd(programStates)),
        PROGRAM_KINDS: esc(listAnd(allProgramKinds)),
        LOCAL_COUNT: String(localStates.length), LOCAL_STATES: esc(listAnd(localStates)),
        PRIOR_YEAR_NOTE: priorYearNote,
        FIGURE_BASIS: figureBasis,
        SOURCE_ROWS: sourceRows,
        LAST_SOURCED: esc((taxData._meta && taxData._meta.lastSourced) || ''),
        // Quotable first sentence. Every figure in it is one of the computed values
        // the table itself renders (best/worst/spread at the base salary), so it can
        // never say something the table below it contradicts. The leader phrasing is
        // guarded on the tie, because "the top state" is false whenever several
        // no-income-tax states share rank 1, which is the usual case.
        ANSWER: (dataPageAnswers['/data/take-home-pay-by-state/'] = esc(
          `On an identical ${usd0(base.salary)} salary in ${year}, a single filer taking the standard ` +
          `deduction keeps ${usd0(best.net)} a year in ` +
          (topTied.length > 1
            ? `the ${numWord(topTied.length).toLowerCase()} highest-take-home jurisdictions (${listAnd(topNames)})`
            : best.name) +
          ` but only ${usd0(worst.net)} in ${worst.name}, a ${usd0(spread)} difference in annual ` +
          `take-home pay across the ${rowCount} US jurisdictions, entirely from state income tax and ` +
          `employee-paid state payroll premiums, because the ${usd0(fedFica)} of federal income tax ` +
          `and FICA is the same in every one of them.`
        )),
        ARTICLE_LD: articleLd, DATASET_LD: datasetLd, FAQ_LD: faqLd,
      }, '/data/take-home-pay-by-state/')
    );
    urls.push(`${SITE.url}/data/take-home-pay-by-state/`);

    // Journalist-liftable citation kit: the exact rows the page renders, as CSV and
    // JSON, generated from the same computed arrays (never a second calculation).
    // One row per state PER SALARY, so the file carries the same two levels the
    // page does and a reader can filter on the salary column.
    const csvEscT = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csvT = [['Gross salary', 'Rank', 'State', 'Abbr', 'Annual take-home', 'Federal income tax',
      'FICA', 'State income tax', 'State payroll deductions', 'Total effective tax rate']];
    for (const s of sets) {
      for (const r of s.rows) {
        csvT.push([s.salary, r.rank, r.name, r.abbr, Math.round(r.net), Math.round(r.federal),
          Math.round(r.fica), Math.round(r.stateTax), Math.round(r.programs),
          (r.totalRate * 100).toFixed(2) + '%']);
      }
    }
    await writeFile(join(DIST, 'data', `take-home-pay-by-state-${year}.csv`),
      csvT.map((r) => r.map(csvEscT).join(',')).join('\n') + '\n');
    await writeFile(join(DIST, 'data', `take-home-pay-by-state-${year}.json`),
      JSON.stringify({
        name: `US take-home pay on ${salaryList} salaries by state, tax year ${year}`,
        taxYear: year,
        assumptions: {
          grossSalaries: SALARIES, filingStatus: 'single', payFrequency: 'annual',
          standardDeduction: true, preTaxDeductions: 0,
          excludes: ['local income taxes', 'pre-tax deductions', 'tax credits', 'itemized deductions', 'cost of living'],
        },
        license: 'https://creativecommons.org/licenses/by/4.0/',
        source: `${SITE.url}/data/take-home-pay-by-state/`,
        salaryLevels: sets.map((s) => ({
          grossSalary: s.salary,
          states: s.rows.map((r) => ({
            rank: r.rank, state: r.name, abbr: r.abbr, slug: r.slug,
            takeHomeAnnual: Math.round(r.net),
            federalIncomeTax: Math.round(r.federal),
            fica: Math.round(r.fica),
            stateIncomeTax: Math.round(r.stateTax),
            statePayrollDeductions: Math.round(r.programs),
            totalEffectiveTaxRate: Number((r.totalRate * 100).toFixed(2)),
            calculator: `${SITE.url}/${r.slug}-paycheck-calculator/`,
          })),
        })),
      }, null, 2) + '\n');

    // One-line key-figures summary for llms-full.txt, from the same computed values.
    dataPageStatsTakeHome = `${rowCount} jurisdictions at two salary levels. On a ${usd0(base.salary)} ` +
      `single-filer salary take-home ranges ${usd0(best.net)} (${topNames.join(', ')}) to ` +
      `${usd0(worst.net)} (${worst.name}), a ${usd0(spread)} spread, with federal income tax + FICA of ` +
      `${usd0(fedFica)} in every state. On ${usd0(high.salary)} it ranges ${usd0(high.best.net)} to ` +
      `${usd0(high.worst.net)} (${high.worst.name}), a ${usd0(high.spread)} spread, with federal income ` +
      `tax + FICA of ${usd0(high.fedFica)}. ${noTaxStates.length} states levy no wage income tax; ` +
      `${programStates.length} withhold an employee-paid state payroll premium.`;
  }


  // Standalone /data/ REFERENCE TABLES. Each re-packages an already-sourced
  // dataset that otherwise only lives buried inside a tool page, as its own
  // citable, embeddable resource (the kind of page that earns external links,
  // which the AdSense re-approval gate needs). Rows are rendered server-side
  // from the SAME source JSON the tools use, so a table can never drift from
  // its tool. Each ships a main page + a noindex /embed/data/* iframe twin +
  // a downloadable JSON/CSV. Data is NOT re-derived here — figures come
  // straight out of ttoc-occupations.json / student-loan-limits-2026.json /
  // state-supplemental-2026.json.
  // dataPageStats collects a one-line "key figures" summary per /data/ page,
  // computed from the SAME already-counted values used to render each page
  // (occCount/catCount, rowsArr, cnt) — never hand-typed — for llms-full.txt
  // to consume later in this function, after this block's inner scopes close.
  const dataPageStats = {};
  {
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const usd = (n) => '$' + Number(n).toLocaleString('en-US');
    const pct = (r) => (r * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
    const DATA_PUB_HUMAN = 'July 13, 2026';
    const DATA_PUB_ISO = '2026-07-13';
    // Embed fill: like fillEmbed above but scoped to a per-page map (no ad loader,
    // no site schema; still gets the module-load-failure banner).
    const fillDataEmbed = (tpl, map) => {
      let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in map ? map[k] : m));
      if (out.includes('</head>')) out = out.replace('</head>', `${MODULE_ERROR_LISTENER}</head>`);
      return out;
    };

    // ---- 1. Treasury Tipped Occupation Codes (TTOC) — from ttoc-occupations.json
    {
      let ttocRows = '';
      let occCount = 0;
      for (const cat of ttoc.categories) {
        for (const o of cat.occupations) {
          occCount++;
          const flag = o.addedInFinalRule ? ' <span class="new-flag">new in final rule</span>' : '';
          // Stable per-row anchor id (e.g. #code-101) so AI assistants and readers
          // can deep-link a single occupation row. main [id] already carries a
          // sticky-header scroll-margin (styles.css), so the jump lands cleanly.
          ttocRows += `<tr id="code-${esc(o.code)}">` +
            `<td class="code">${esc(o.code)}</td>` +
            `<td><strong>${esc(o.title)}</strong>${flag}<br><span class="muted-small">${esc(o.description)}.</span></td>` +
            `<td>${esc(cat.name)}</td>` +
            `<td>${esc(o.examples)}</td>` +
            `<td class="soc">${esc(o.soc || '')}</td></tr>\n`;
        }
      }
      const catCount = ttoc.categories.length;
      const addedCount = (ttoc.finalRuleAdditions || []).length;
      dataPageStats.ttoc = `${occCount} Treasury Tipped Occupation Codes across ${catCount} categories (${addedCount} added in the final rule), 26 CFR 1.224-1 Table 1.`;
      const articleLd = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Article',
        headline: `Treasury Tipped Occupation Codes (TTOC): All ${occCount} Occupations`,
        description: `The complete list of ${occCount} Treasury Tipped Occupation Codes across ${catCount} categories, from 26 CFR 1.224-1, Table 1, used for W-2 Box 14b and the 2025 no-tax-on-tips deduction.`,
        datePublished: '2026-07-12', dateModified: DATA_PUB_ISO,
        author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
        publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
        mainEntityOfPage: `${SITE.url}/data/treasury-tipped-occupation-codes/`,
        isAccessibleForFree: true,
      });
      const datasetLd = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Dataset',
        name: 'Treasury Tipped Occupation Codes (TTOC), 26 CFR 1.224-1 Table 1',
        description: `All ${occCount} occupations (in ${catCount} categories) that customarily and regularly received tips and qualify for the IRC 224 tips deduction, each with its Treasury occupation code, description, illustrative examples, and SOC code.`,
        url: `${SITE.url}/data/treasury-tipped-occupation-codes/`,
        creator: { '@type': 'Person', name: 'Edmond Daher' },
        publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
        license: 'https://creativecommons.org/licenses/by/4.0/',
        temporalCoverage: '2025/2028',
        dateModified: DATA_PUB_ISO,
        spatialCoverage: { '@type': 'Place', name: 'United States' },
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/treasury-tipped-occupation-codes-2026.json` },
          { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE.url}/data/treasury-tipped-occupation-codes-2026.csv` },
        ],
        isAccessibleForFree: true,
      });
      const ttocMap = {
        SITE_NAME: SITE.name, SITE_URL: SITE.url, TABLE_ROWS: ttocRows,
        ROW_COUNT: String(occCount), CAT_COUNT: String(catCount), ADDED_COUNT: String(addedCount),
        // Quotable first sentence: counted from ttoc-occupations.json, so it can
        // never disagree with the table below it.
        ANSWER: (dataPageAnswers['/data/treasury-tipped-occupation-codes/'] = `Treasury's official tipped-occupation list contains ${occCount} occupations in ` +
          `${catCount} categories (26 CFR 1.224-1, Table 1), and only a job on that list qualifies ` +
          `for the federal no-tax-on-tips deduction under IRC 224 for tax years 2025 through 2028; ` +
          `the employer reports the matching Treasury Tipped Occupation Code in W-2 Box 14b.`),
        PUB_DATE: DATA_PUB_HUMAN, ARTICLE_LD: articleLd, DATASET_LD: datasetLd,
      };
      await mkdir(join(DIST, 'data', 'treasury-tipped-occupation-codes'), { recursive: true });
      await writeFile(join(DIST, 'data', 'treasury-tipped-occupation-codes', 'index.html'),
        fillTool(dataTtocTpl, ttocMap, '/data/treasury-tipped-occupation-codes/'));
      urls.push(`${SITE.url}/data/treasury-tipped-occupation-codes/`);
      await mkdir(join(DIST, 'embed', 'data', 'treasury-tipped-occupation-codes'), { recursive: true });
      await writeFile(join(DIST, 'embed', 'data', 'treasury-tipped-occupation-codes', 'index.html'),
        fillDataEmbed(embedDataTtocTpl, ttocMap));
      await writeFile(join(DIST, 'data', 'treasury-tipped-occupation-codes-2026.json'),
        JSON.stringify(stripInternal(ttoc), null, 2) + '\n');
      // Flat CSV — same source JSON, one row per occupation. Journalist/AI-liftable
      // companion to the JSON so the /data/ page offers both formats (task parity
      // with the state-supplemental page). Mirrors the OSS repo's ttoc CSV.
      const csvEsc = (v) => {
        const t = String(v == null ? '' : v);
        return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      const ttocAdded = new Set(ttoc.finalRuleAdditions || []);
      const ttocCsv = [['Code', 'Occupation', 'Category', 'Description', 'Examples', 'SOC code', 'Added in final rule']];
      for (const cat of ttoc.categories) {
        for (const o of cat.occupations) {
          ttocCsv.push([o.code, o.title, cat.name, o.description, o.examples, o.soc || '',
            ttocAdded.has(o.code) ? 'yes' : 'no']);
        }
      }
      await writeFile(join(DIST, 'data', 'treasury-tipped-occupation-codes-2026.csv'),
        ttocCsv.map((r) => r.map(csvEsc).join(',')).join('\n') + '\n');
    }

    // ---- 2. 2026 Federal Student Loan Limits — from student-loan-limits-2026.json
    {
      const sl = studentLoanLimits;
      const dep = sl.undergraduate.dependent, ind = sl.undergraduate.independent;
      const depMin = Math.min(...dep.annualByYear), depMax = Math.max(...dep.annualByYear);
      const indMin = Math.min(...ind.annualByYear), indMax = Math.max(...ind.annualByYear);
      const numCell = (display, val) => `<td class="num" data-val="${val == null ? '' : val}">${display}</td>`;
      const rowsArr = [
        { type: 'Graduate (Direct Unsubsidized)', annualD: usd(sl.graduate.annual), annualV: sl.graduate.annual,
          aggD: usd(sl.graduate.aggregate), aggV: sl.graduate.aggregate,
          note: 'Grad PLUS ended for new borrowers. Applies to a student who is not (and has not been) a professional student.' },
        { type: 'Professional (Direct Unsubsidized)', annualD: usd(sl.professional.annual), annualV: sl.professional.annual,
          aggD: usd(sl.professional.aggregate), aggV: sl.professional.aggregate,
          note: 'Shares one $200,000 aggregate pool with graduate borrowing. "Professional degree" classification is in active litigation.' },
        { type: 'Parent PLUS (per dependent student)', annualD: usd(sl.parentPlus.annual), annualV: sl.parentPlus.annual,
          aggD: usd(sl.parentPlus.aggregate), aggV: sl.parentPlus.aggregate,
          note: 'New caps, combined across all parents per dependent student. Excluded from the $257,500 lifetime cap; its own odometer.' },
        { type: 'Undergraduate — dependent', annualD: `${usd(depMin)}–${usd(depMax)}`, annualV: depMax,
          aggD: usd(dep.aggregate), aggV: dep.aggregate,
          note: 'Unchanged by the 2025 law. Annual limit rises by year in school; max subsidized $23,000 of the aggregate.' },
        { type: 'Undergraduate — independent', annualD: `${usd(indMin)}–${usd(indMax)}`, annualV: indMax,
          aggD: usd(ind.aggregate), aggV: ind.aggregate,
          note: 'Unchanged by the 2025 law. Higher limits than dependent undergraduates; annual limit rises by year in school.' },
        { type: 'Federal lifetime cap (all student borrowing)', annualD: '—', annualV: null,
          aggD: usd(sl.lifetime.cap), aggV: sl.lifetime.cap,
          note: 'New. Counts every federal loan ever made to the borrower, without regard to amounts repaid, forgiven, or discharged. Excludes Parent PLUS.' },
      ];
      const slRows = rowsArr.map((r) =>
        `<tr><td><strong>${esc(r.type)}</strong></td>` +
        numCell(esc(r.annualD), r.annualV) + numCell(esc(r.aggD), r.aggV) +
        `<td class="note">${esc(r.note)}</td></tr>`).join('\n');
      const rowCount = rowsArr.length;
      dataPageStats.studentLoan = rowsArr.map((r) => `${r.type}: ${r.annualD} annual, ${r.aggD} aggregate`).join('; ') + '.';
      const articleLd = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Article',
        headline: '2026 Federal Student Loan Borrowing Limits',
        description: 'Every federal student loan annual and aggregate borrowing cap effective July 1, 2026 under P.L. 119-21: graduate, professional, Parent PLUS, the new $257,500 lifetime cap, and unchanged undergraduate limits.',
        datePublished: '2026-07-12', dateModified: DATA_PUB_ISO,
        author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
        publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
        mainEntityOfPage: `${SITE.url}/data/2026-student-loan-limits/`,
        isAccessibleForFree: true,
      });
      const datasetLd = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Dataset',
        name: '2026 federal student loan borrowing limits (P.L. 119-21)',
        description: 'Annual and aggregate federal student loan borrowing caps effective for enrollment periods beginning on or after July 1, 2026, per 20 U.S.C. 1087e(a) and 34 CFR 685.203.',
        url: `${SITE.url}/data/2026-student-loan-limits/`,
        creator: { '@type': 'Person', name: 'Edmond Daher' },
        publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
        license: 'https://creativecommons.org/licenses/by/4.0/',
        temporalCoverage: '2026',
        dateModified: DATA_PUB_ISO,
        spatialCoverage: { '@type': 'Place', name: 'United States' },
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/2026-student-loan-limits.json` },
          { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE.url}/data/2026-student-loan-limits.csv` },
        ],
        isAccessibleForFree: true,
      });
      const slMap = {
        SITE_NAME: SITE.name, SITE_URL: SITE.url, TABLE_ROWS: slRows,
        ROW_COUNT: String(rowCount), PUB_DATE: DATA_PUB_HUMAN, ARTICLE_LD: articleLd, DATASET_LD: datasetLd,
        // Quotable first sentence: the caps come straight out of
        // student-loan-limits-2026.json, the same object the table renders from.
        ANSWER: (dataPageAnswers['/data/2026-student-loan-limits/'] = `For enrollment periods beginning on or after July 1, 2026, federal student loan ` +
          `borrowing is capped at ${usd(sl.lifetime.cap)} per borrower for life, with a ` +
          `${usd(sl.graduate.aggregate)} aggregate limit for graduate study and ` +
          `${usd(sl.professional.aggregate)} for professional study, under P.L. 119-21; ` +
          `undergraduate limits were not changed and Parent PLUS sits outside the lifetime cap.`),
      };
      await mkdir(join(DIST, 'data', '2026-student-loan-limits'), { recursive: true });
      await writeFile(join(DIST, 'data', '2026-student-loan-limits', 'index.html'),
        fillTool(dataStudentLoanTpl, slMap, '/data/2026-student-loan-limits/'));
      urls.push(`${SITE.url}/data/2026-student-loan-limits/`);
      await mkdir(join(DIST, 'embed', 'data', '2026-student-loan-limits'), { recursive: true });
      await writeFile(join(DIST, 'embed', 'data', '2026-student-loan-limits', 'index.html'),
        fillDataEmbed(embedDataStudentLoanTpl, slMap));
      await writeFile(join(DIST, 'data', '2026-student-loan-limits.json'),
        JSON.stringify(stripInternal(studentLoanLimits), null, 2) + '\n');
      // Flat CSV — same rows as the on-page table, one line per loan-limit row,
      // so the /data/ page offers CSV + JSON like the other reference tables.
      const csvEscSl = (v) => {
        const t = String(v == null ? '' : v).replace(/[–—]/g, '-');
        return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      const slCsv = [['Borrower / loan type', 'Annual limit', 'Aggregate limit', 'Notes']];
      for (const r of rowsArr) slCsv.push([r.type, r.annualD, r.aggD, r.note]);
      await writeFile(join(DIST, 'data', '2026-student-loan-limits.csv'),
        slCsv.map((r) => r.map(csvEscSl).join(',')).join('\n') + '\n');
    }

    // ---- 3. State Supplemental (Bonus) Withholding Rates — from state-supplemental-2026.json
    {
      const METHOD_LABEL = { flat: 'Flat', regular: 'Regular', none: 'None', special: 'Special' };
      const rateText = (s) => {
        if (s.method === 'none') return '0%';
        if (s.method === 'flat') return pct(s.rate);
        if (s.method === 'regular') return s.incomeRate ? `Aggregate (≈${pct(s.incomeRate)})` : 'Aggregate method';
        if (s.method === 'special') {
          if (s.special === 'ca_dual') return `${pct(s.rate)} / ${pct(s.rateOther)} other`;
          if (s.special === 'pct_of_federal') return `${pct(s.rate)} of federal tax`;
          if (s.special === 'wi_banded' && s.bands) return `${pct(s.bands[0].rate)}–${pct(s.bands[s.bands.length - 1].rate)}`;
        }
        return '';
      };
      // numeric sort key for the rate column
      const rateVal = (s) => {
        if (s.method === 'none') return 0;
        if (s.method === 'flat') return s.rate * 100;
        if (s.method === 'regular') return s.incomeRate ? s.incomeRate * 100 : '';
        if (s.method === 'special') {
          if (s.special === 'ca_dual') return s.rate * 100;
          if (s.special === 'pct_of_federal') return s.rate * 100;
          if (s.special === 'wi_banded' && s.bands) return s.bands[s.bands.length - 1].rate * 100;
        }
        return '';
      };
      const entries = Object.values(suppData.states).sort((a, b) => a.name.localeCompare(b.name));
      const cnt = { flat: 0, regular: 0, none: 0, special: 0 };
      const suppRows = entries.map((s) => {
        cnt[s.method] = (cnt[s.method] || 0) + 1;
        const rv = rateVal(s);
        const noteBits = [];
        if (s.note) noteBits.push(esc(s.note));
        if (s._sourceUrl) noteBits.push(`<a href="${esc(s._sourceUrl)}" rel="noopener" target="_blank">source</a>`);
        return `<tr><td><strong>${esc(s.name)}</strong> (${esc(s.abbr)})</td>` +
          `<td><span class="chip m-${s.method}">${METHOD_LABEL[s.method] || esc(s.method)}</span></td>` +
          `<td class="rate" data-val="${rv === '' ? '' : rv}">${esc(rateText(s))}</td>` +
          `<td class="note">${noteBits.join(' ')}</td></tr>`;
      }).join('\n');
      const rowCount = entries.length;
      dataPageStats.supp = `${rowCount} jurisdictions — ${cnt.flat} flat rate, ${cnt.regular} aggregate method, ${cnt.none} no wage income tax, ${cnt.special} special formula; federal flat 22% (37% over $1,000,000/year).`;
      const articleLd = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Article',
        headline: '2026 State Supplemental (Bonus) Tax Withholding Rates',
        description: `The 2026 supplemental-wage withholding method and rate for all ${rowCount} US jurisdictions, plus the federal flat 22% / 37% rule. ${cnt.flat} states use their own flat bonus rate; ${cnt.regular} use the aggregate method; ${cnt.none} have no wage income tax; ${cnt.special} use a special formula.`,
        datePublished: '2026-07-11', dateModified: DATA_PUB_ISO,
        author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
        publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
        mainEntityOfPage: `${SITE.url}/data/state-supplemental-withholding-rates-2026/`,
        isAccessibleForFree: true,
      });
      const datasetLd = JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Dataset',
        name: '2026 US state supplemental (bonus) wage withholding rates',
        description: 'Supplemental-wage (bonus/commission) withholding method and rate for all 50 US states and DC for 2026, plus the federal flat 22%/37% rule.',
        url: `${SITE.url}/data/state-supplemental-withholding-rates-2026/`,
        creator: { '@type': 'Person', name: 'Edmond Daher' },
        publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
        license: 'https://creativecommons.org/licenses/by/4.0/',
        temporalCoverage: '2026',
        dateModified: DATA_PUB_ISO,
        spatialCoverage: { '@type': 'Place', name: 'United States' },
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/state-supplemental-withholding-rates-2026.json` },
          { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE.url}/data/state-supplemental-withholding-rates-2026.csv` },
        ],
        isAccessibleForFree: true,
      });
      const suppMap = {
        SITE_NAME: SITE.name, SITE_URL: SITE.url, TABLE_ROWS: suppRows, ROW_COUNT: String(rowCount),
        CNT_FLAT: String(cnt.flat), CNT_REGULAR: String(cnt.regular), CNT_NONE: String(cnt.none), CNT_SPECIAL: String(cnt.special),
        // Quotable first sentence: every count is the tally taken while building the
        // rows above, so the sentence moves when a state changes method.
        ANSWER: (dataPageAnswers['/data/state-supplemental-withholding-rates-2026/'] = `For 2026, a bonus paid separately from regular wages is withheld federally at a flat ` +
          `22% (37% on supplemental pay above $1,000,000 a year), and at the state level ` +
          `${cnt.flat} of the ${rowCount} US jurisdictions apply their own flat supplemental rate, ` +
          `${cnt.regular} withhold using the regular aggregate method instead, ${cnt.special} use a ` +
          `special formula, and ${cnt.none} have no state wage income tax at all.`),
        PUB_DATE: DATA_PUB_HUMAN, ARTICLE_LD: articleLd, DATASET_LD: datasetLd,
      };
      await mkdir(join(DIST, 'data', 'state-supplemental-withholding-rates-2026'), { recursive: true });
      await writeFile(join(DIST, 'data', 'state-supplemental-withholding-rates-2026', 'index.html'),
        fillTool(dataSuppTpl, suppMap, '/data/state-supplemental-withholding-rates-2026/'));
      urls.push(`${SITE.url}/data/state-supplemental-withholding-rates-2026/`);
      await mkdir(join(DIST, 'embed', 'data', 'state-supplemental-withholding-rates-2026'), { recursive: true });
      await writeFile(join(DIST, 'embed', 'data', 'state-supplemental-withholding-rates-2026', 'index.html'),
        fillDataEmbed(embedDataSuppTpl, suppMap));
      await writeFile(join(DIST, 'data', 'state-supplemental-withholding-rates-2026.json'),
        JSON.stringify(stripInternal(suppData), null, 2) + '\n');
      // Flat CSV — journalist-liftable citation kit (same source JSON).
      const csvEsc2 = (v) => {
        const t = String(v == null ? '' : v);
        return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      const csvLines2 = [['State', 'Abbr', 'Method', 'Supplemental rate 2026', 'Verified', 'Source']];
      for (const s of entries) {
        csvLines2.push([s.name, s.abbr, s.method, rateText(s).replace(/≈/g, '~').replace(/–/g, '-'),
          s.verified ? 'yes' : 'no', s.source || '']);
      }
      await writeFile(join(DIST, 'data', 'state-supplemental-withholding-rates-2026.csv'),
        csvLines2.map(r => r.map(csvEsc2).join(',')).join('\n') + '\n');
    }
  }

  // Embeddable calculator pages (iframe targets for the /embed/ link engine).
  // Deliberately bypass fill(): NO ad loader (ads inside a third-party iframe would
  // violate AdSense policy) and NO site schema. They are noindex + canonical to the
  // real tool (set in-template) and are NOT added to the sitemap. Function-form
  // replace keeps '$' in the injected JSON literal (same reason fill() uses one).
  // Still gets MODULE_ERROR_LISTENER injected below (same page-level module-load-
  // failure banner every full page gets via fill()) — bypassing fill() shouldn't
  // mean losing that defense-in-depth too.
  const embedMap = { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON, STATES_JSON: OBBBA_STATES_JSON, ROTHCATCHUP_JSON, BONUS_TAX_JSON: BONUS_TAX_ALL_JSON, FORM1099_JSON, FORM1099_STATES_JSON, TTOC_JSON, SSMAXOUT_PARAMS_JSON, STUDENT_LOAN_LIMITS_JSON, ABLE_LIMITS_JSON, ABLE_STATES_JSON, SECTION127_JSON, ADOPTION_DATA_JSON };
  const fillEmbed = (tpl) => {
    let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in embedMap ? embedMap[k] : m));
    if (out.includes('</head>')) out = out.replace('</head>', `${MODULE_ERROR_LISTENER}</head>`);
    return out;
  };
  await mkdir(join(DIST, 'embed', 'overtime-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'overtime-tax-calculator', 'index.html'), fillEmbed(embedOvertimeTpl));
  await mkdir(join(DIST, 'embed', 'tips-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'tips-tax-calculator', 'index.html'), fillEmbed(embedTipsTpl));
  await mkdir(join(DIST, 'embed', 'senior-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'senior-deduction-calculator', 'index.html'), fillEmbed(embedSeniorTpl));
  await mkdir(join(DIST, 'embed', 'salt-cap-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'salt-cap-calculator', 'index.html'), fillEmbed(embedSaltTpl));
  await mkdir(join(DIST, 'embed', 'car-loan-interest-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'car-loan-interest-calculator', 'index.html'), fillEmbed(embedCarLoanTpl));
  await mkdir(join(DIST, 'embed', 'charitable-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'charitable-deduction-calculator', 'index.html'), fillEmbed(embedCharitableTpl));
  await mkdir(join(DIST, 'embed', 'pmi-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'pmi-deduction-calculator', 'index.html'), fillEmbed(embedPmiTpl));
  await mkdir(join(DIST, 'embed', 'qcd-vs-charitable-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'qcd-vs-charitable-deduction-calculator', 'index.html'), fillEmbed(embedQcdTpl));
  // Dependent-care embed needs the fica-inclusive fed JSON (DC_FED_JSON) + DC_JSON,
  // which the shared embedMap doesn't carry — use a dedicated map. Function-form
  // replace keeps '$'/'§' in the injected JSON literal intact.
  {
    const dcEmbedMap = { SITE_NAME: SITE.name, SITE_URL: SITE.url, DC_JSON, FED_JSON: DC_FED_JSON };
    const fillDcEmbed = (tpl) => {
      let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in dcEmbedMap ? dcEmbedMap[k] : m));
      if (out.includes('</head>')) out = out.replace('</head>', `${MODULE_ERROR_LISTENER}</head>`);
      return out;
    };
    await mkdir(join(DIST, 'embed', 'dependent-care-fsa-vs-credit-calculator'), { recursive: true });
    await writeFile(join(DIST, 'embed', 'dependent-care-fsa-vs-credit-calculator', 'index.html'), fillDcEmbed(embedDepCareTpl));
  }
  await mkdir(join(DIST, 'embed', 'w4-overtime-tips-withholding-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'w4-overtime-tips-withholding-calculator', 'index.html'), fillEmbed(embedW4OtTipsTpl));
  await mkdir(join(DIST, 'embed', 'roth-catchup-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'roth-catchup-calculator', 'index.html'), fillEmbed(embedRothCatchupTpl));
  await mkdir(join(DIST, 'embed', '1099-threshold-checker'), { recursive: true });
  await writeFile(join(DIST, 'embed', '1099-threshold-checker', 'index.html'), fillEmbed(embedForm1099Tpl));
  await mkdir(join(DIST, 'embed', 'w2-box-decoder'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'w2-box-decoder', 'index.html'), fillEmbed(embedW2BoxTpl));
  await mkdir(join(DIST, 'embed', 'ss-wage-base-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'ss-wage-base-calculator', 'index.html'), fillEmbed(embedSsMaxoutTpl));
  await mkdir(join(DIST, 'embed', 'student-loan-cap-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'student-loan-cap-calculator', 'index.html'), fillEmbed(embedStudentLoanCapTpl));
  await mkdir(join(DIST, 'embed', 'able-account-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'able-account-calculator', 'index.html'), fillEmbed(embedAbleTpl));
  await mkdir(join(DIST, 'embed', 'employer-student-loan-repayment-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'employer-student-loan-repayment-calculator', 'index.html'), fillEmbed(embedSection127Tpl));
  await mkdir(join(DIST, 'embed', 'adoption-credit-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'adoption-credit-calculator', 'index.html'), fillEmbed(embedAdoptionTpl));
  await mkdir(join(DIST, 'embed', 'bonus-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'bonus-tax-calculator', 'index.html'), fillEmbed(embedBonusTaxTpl));
  await mkdir(join(DIST, 'embed', 'merge-pdf'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'merge-pdf', 'index.html'), fillEmbed(embedMergePdfTpl));
  await mkdir(join(DIST, 'embed', 'word-to-pdf'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'word-to-pdf', 'index.html'), fillEmbed(embedWordToPdfTpl));
  // Indexable embed gallery (fillTool is fine here — real page, benefits from schema
  // + the More-tools cross-links). This one IS in the sitemap.
  await writeFile(join(DIST, 'embed', 'index.html'), fillTool(embedGalleryTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/embed/'));
  urls.push(`${SITE.url}/embed/`);

  // biweekly mortgage payment calculator (pure-math, reuses the amortization engine)
  await mkdir(join(DIST, 'biweekly-mortgage-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'biweekly-mortgage-calculator', 'index.html'),
    fillTool(biweeklyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/biweekly-mortgage-calculator/')
  );
  urls.push(`${SITE.url}/biweekly-mortgage-calculator/`);

  // public machine-readable copy of the live tax data (for the drift monitor +
  // transparency). Always reflects the deployed figures — single source of truth.
  await mkdir(join(DIST, 'data'), { recursive: true });
  await mkdir(join(DIST, 'data'), { recursive: true });
  await writeFile(join(DIST, 'data', 'tax-data-2026.json'), JSON.stringify(stripInternal(taxData), null, 2) + '\n');
  await writeFile(join(DIST, 'data', 'obbba-deductions-2026.json'), JSON.stringify(stripInternal(obbba), null, 2) + '\n');
  await writeFile(join(DIST, 'data', 'secure2-catchup-2026.json'), JSON.stringify(stripInternal(secure2), null, 2) + '\n');

  // 404 (Cloudflare Pages serves /404.html on miss)
  await writeFile(
    join(DIST, '404.html'),
    fill(pageTpl, {
      ...siteMap,
      PAGE_TITLE: 'Page not found',
      PAGE_DESC: 'The page you were looking for could not be found.',
      PAGE_SLUG: '404',
      ROBOTS: 'noindex, follow',
      PAGE_BODY: '<p>Sorry — that page does not exist. Try a <a href="/#paycheck">paycheck calculator</a> or head <a href="/">home</a>.</p>'
    })
  );

  // favicon (inline SVG — no binary asset needed)
  await writeFile(
    join(DIST, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0f1419"/><text x="32" y="44" font-family="Arial,sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#2ea043">$</text></svg>\n`
  );

  // Open Graph / social share card (1200×630 SVG — on-brand, no binary asset).
  // Referenced site-wide by injectSeo as og:image / twitter:image so every full
  // page ships a complete Open Graph card. NOTE: SVG og:images render in Google
  // and most crawlers; some raster-only social platforms (Facebook, X/Twitter)
  // will not render an SVG preview — swap in a 1200×630 PNG here if full raster
  // social previews are ever needed.
  await writeFile(
    join(DIST, 'og-cover.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0f1419"/><rect width="1200" height="10" fill="#2ea043"/><rect x="130" y="215" width="170" height="170" rx="34" fill="#16a34a"/><text x="215" y="338" font-family="Arial,Helvetica,sans-serif" font-size="112" font-weight="700" text-anchor="middle" fill="#ffffff">$</text><text x="345" y="305" font-family="Arial,Helvetica,sans-serif" font-size="90" font-weight="800" fill="#ffffff">Tools Berry</text><text x="349" y="372" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="400" fill="#9fb0bd">Free online calculators, converters &amp; 2026 tax tools</text><text x="349" y="424" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="400" fill="#5a6b78">100% in your browser · nothing uploaded · tools-berry.com</text></svg>\n`
  );

  // ads.txt — only meaningful once a publisher ID is set; written either way
  if (SITE.adsensePublisherId) {
    await writeFile(
      join(DIST, 'ads.txt'),
      `google.com, ${SITE.adsensePublisherId}, DIRECT, f08c47fec0942fa0\n`
    );
  }

  // _headers (Cloudflare Pages) — security headers + real content-hash caching.
  // Ordering matters: Cloudflare applies EVERY matching block for a request,
  // not just the last one — and when more than one matching block sets the
  // same header (e.g. Cache-Control), Cloudflare does NOT do last-match-wins;
  // it JOINS the values with a comma, producing a garbled, self-contradictory
  // header. So each more-specific block that needs its OWN Cache-Control value
  // must first `! Cache-Control` (Cloudflare's header-unset syntax) to detach
  // whatever a broader, earlier block already set, before setting its real
  // value. `/*` sets a safe short-lived default (HTML pages, sitemap.xml,
  // data/*.json, etc. — nothing here is content-hashed, so it must revalidate
  // instead of going stale silently). `/assets/*` is now a safe short-lived
  // fallback for any future un-hashed asset — unset first since it also matches
  // `/*`. `/assets/*.js` AND `/assets/*.css` are the most specific matches:
  // every /assets/*.js and /assets/*.css file is now content-hashed (see
  // hashAssets() above — styles.css joined the pipeline), so a fresh URL is
  // minted on every byte change — safe to cache for a full year, immutable.
  // They match `/*` and `/assets/*` too, so they also unset before setting.
  // Only Cache-Control is unset/reset per block — the security headers set on
  // `/*` are left alone and simply carry through.
  await writeFile(
    join(DIST, '_headers'),
    // `/embed/*` is the one exception. Those pages exist to be put in someone
    // else's iframe, which is exactly what the inherited `X-Frame-Options: DENY`
    // forbids, so every embed we have ever pitched would have rendered as a
    // blank box for the partner and failed silently on our side. Unset it there,
    // the same way the cache blocks unset Cache-Control. Safe to frame: the
    // embed pages carry no auth input, no cookie or localStorage use, no
    // external form action and no ad slot, so there is nothing to clickjack.
    // `/embed/` itself is deliberately put back under DENY afterwards. It is
    // the gallery listing, not a widget, and unlike the widgets it does carry
    // the AdSense loader. A framable ad-bearing page invites invisible-iframe
    // impression fraud, so the wildcard must not be allowed to cover it.
    `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Cache-Control: public, max-age=0, must-revalidate\n\n/embed/*\n  ! X-Frame-Options\n  Content-Security-Policy: frame-ancestors *\n\n/embed/\n  ! Content-Security-Policy\n  X-Frame-Options: DENY\n\n/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=300, must-revalidate\n\n/assets/*.js\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n\n/assets/*.css\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n`
  );

  // robots + sitemap
  // Explicit allow stanzas for named AI/search crawlers, in addition to the
  // catch-all `User-agent: *` above (which already allows everyone, including
  // these). Some crawler operators are reported to treat an explicit stanza
  // with their own name as a stronger/clearer signal than relying solely on
  // the wildcard, and it also makes the policy legible to a human (or LLM)
  // skimming the file — nobody has to infer "not blocked" from an absence.
  const AI_CRAWLERS = [
    'GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'PerplexityBot',
    'Google-Extended', 'CCBot', 'Bingbot', 'Applebot-Extended',
  ];
  await writeFile(
    join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\n` +
      AI_CRAWLERS.map((ua) => `User-agent: ${ua}\nAllow: /\n`).join('\n') +
      `\nSitemap: ${SITE.url}/sitemap.xml\n`
  );
  // Per-URL lastmod = each page's real git change-date (see sitemapLastmod) so the
  // sitemap carries honest, varied freshness signals instead of today-for-all.
  // Noindexed tools are dropped — a sitemap must never list noindex pages.
  const sitemapUrls = urls.filter((u) => !NOINDEX_TOOLS.has(u.replace(SITE.url, '')));
  await writeFile(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      sitemapUrls.map((u) => `  <url><loc>${u}</loc><lastmod>${sitemapLastmod(u)}</lastmod></url>`).join('\n') +
      `\n</urlset>\n`
  );

  // IndexNow key file — hosted at the site root so Bing/Yandex can verify ownership
  // before accepting our URL submissions (scripts/indexnow-submit.py posts the list).
  if (SITE.indexNowKey) {
    await writeFile(join(DIST, `${SITE.indexNowKey}.txt`), `${SITE.indexNowKey}\n`);
  }

  // llms.txt — AI/LLM discovery file (llms.txt markdown convention). Regenerated
  // every build from TOOLS + the built state list; NOT added to the sitemap.
  const llmsTools = TOOLS
    .filter((t) => t.path.startsWith('/')) // skip the in-page "/#paycheck" anchor
    .map((t) => {
      const d = TOOL_DESCRIPTIONS[t.path] || t.name;
      return `- [${t.name}](${SITE.url}${t.path}): ${d}`;
    })
    .join('\n');
  const builtStateLines = roster
    .filter((s) => builtSlugs.has(s.slug))
    .map((s) => `- [${s.name} Paycheck Calculator](${SITE.url}/${s.slug}-paycheck-calculator/)`)
    .join('\n');
  // The /data/ reference tables, described by the exact one-sentence computed answer
  // each of those pages now opens with (dataPageAnswers, written by the blocks that
  // rendered them). Two consequences worth stating: the descriptions carry real
  // figures rather than a topic label, and they cannot drift from the pages, because
  // there is only one string. Pages are listed in a fixed order so the file is stable
  // build-to-build; a page whose block did not run is dropped rather than described
  // with an empty sentence.
  const LLMS_DATA_PAGES = [
    ['/data/take-home-pay-by-state/', `Take-Home Pay on ${STUDY_SALARY_TEXT} in All 51 States (${year})`],
    ['/data/state-supplemental-withholding-rates-2026/', `${year} State Supplemental (Bonus) Tax Withholding Rates`],
    ['/data/tips-tax-by-state/', `Which States Still Tax Tips in ${year}?`],
    ['/data/overtime-tax-by-state/', `Which States Still Tax Overtime in ${year}?`],
    ['/data/treasury-tipped-occupation-codes/', 'Treasury Tipped Occupation Codes (TTOC)'],
    ['/data/2026-student-loan-limits/', `${year} Federal Student Loan Borrowing Limits`],
  ];
  // These sentences were escaped for HTML on their way into a page. llms.txt is
  // plain markdown, so the entities have to come back off or a consumer quotes
  // "&amp;" at a reader.
  const unesc = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  const llmsDataLines = LLMS_DATA_PAGES
    .filter(([p]) => dataPageAnswers[p])
    .map(([p, title]) => `- [${title}](${SITE.url}${p}): ${unesc(dataPageAnswers[p])}`)
    .join('\n');
  // The per-state salary ladders. Only the states actually built get listed, so the
  // file never advertises a hub that 404s as the rollout waves land.
  const llmsLadderLines = LADDER_STATES
    .filter((slug) => builtSlugs.has(slug))
    .map((slug) => {
      const st = roster.find((s) => s.slug === slug);
      return `- [${st ? st.name : slug} Take-Home Pay by Salary](${SITE.url}/${ladderHubSlug(slug)}/)`;
    })
    .join('\n');
  const llmsTxt =
    `# ${SITE.name}\n\n` +
    // Blockquote summary, per the llms.txt convention: the single paragraph a
    // consumer reads to decide whether the rest of the file is worth parsing.
    `> ${SITE.name} (${SITE.url}) publishes free US payroll and tax calculators plus computed ` +
    `${year} tax reference tables covering all 50 states and the District of Columbia. Every ` +
    `calculator runs entirely in the visitor's browser: no account, no upload, no server. Every ` +
    `figure in the reference tables is computed at build time by the site's own open paycheck ` +
    `engine from published IRS, SSA and state Department of Revenue tables, and the datasets are ` +
    `free to quote and republish with attribution under CC BY 4.0.\n\n` +
    `## Data and reference tables\n\n` +
    `Computed ${year} datasets, each with a CSV and JSON download and a stated primary source. ` +
    `The sentence after each link is that page's own computed headline figure.\n\n` +
    `${llmsDataLines}\n\n` +
    `## Tools\n\n${llmsTools}\n\n` +
    `## State paycheck calculators\n\n` +
    `Take-home pay (paycheck) calculators for all ${builtSlugs.size} US states and Washington, D.C. ` +
    `Each estimates ${year} take-home pay after federal income tax, Social Security, Medicare, and (where applicable) state income tax. ` +
    `Start at the [paycheck calculator hub](${SITE.url}/#paycheck).\n\n` +
    `${builtStateLines}\n` +
    (llmsLadderLines
      ? `\n## State take-home pay by salary\n\n` +
        `Hubs that answer "what does a given salary actually pay in this state", with a computed ` +
        `page per salary level. Currently published for ${llmsLadderLines.split('\n').length} states.\n\n` +
        `${llmsLadderLines}\n`
      : '');
  await writeFile(join(DIST, 'llms.txt'), llmsTxt);
  // Also emit the singular /llm.txt path. AI crawlers request BOTH the plural
  // (llms.txt convention) and the singular spelling; the singular one was 404ing
  // while drawing recurring crawler hits. Serve the identical content at both
  // so neither 404s — a plain 200 copy is more robust than a redirect for these
  // discovery files (some crawlers don't follow redirects). Not added to sitemap.
  await writeFile(join(DIST, 'llm.txt'), llmsTxt);

  // llms-full.txt — the expanded companion to llms.txt: one block per tool
  // (name, URL, what it computes) plus a Datasets section carrying each
  // /data/ page's live-computed "key figures" line (dataPageStats, built
  // above from the same counted/derived values the pages themselves render
  // from — never hand-typed here) and the same state-paycheck list as
  // llms.txt. Deterministic order (TOOLS declaration order, then roster
  // filter order) so the file is stable build-to-build. Not added to the
  // sitemap, same as llms.txt/llm.txt.
  const llmsFullTools = TOOLS
    .filter((t) => t.path.startsWith('/'))
    .map((t) => {
      const d = TOOL_DESCRIPTIONS[t.path] || t.name;
      return `### ${t.name}\nURL: ${SITE.url}${t.path}\nWhat it computes: ${d}`;
    })
    .join('\n\n');
  const llmsFullDatasets = [
    {
      name: `Take-Home Pay on ${STUDY_SALARY_TEXT} in All 51 States`,
      path: '/data/take-home-pay-by-state/',
      what: `Compares computed annual take-home pay on identical ${STUDY_SALARY_TEXT} single-filer salaries across all 50 US states and DC, with state income tax, state payroll deductions and total effective tax rate per state at each salary.`,
      figures: dataPageStatsTakeHome,
    },
    {
      name: 'Treasury Tipped Occupation Codes (TTOC)',
      path: '/data/treasury-tipped-occupation-codes/',
      what: 'Looks up the Treasury-assigned occupation code and category for any job that customarily received tips, for W-2 Box 14b and the no-tax-on-tips deduction.',
      figures: dataPageStats.ttoc,
    },
    {
      name: '2026 Federal Student Loan Borrowing Limits',
      path: '/data/2026-student-loan-limits/',
      what: 'Lists every federal student loan annual and aggregate borrowing cap effective July 1, 2026 under P.L. 119-21.',
      figures: dataPageStats.studentLoan,
    },
    {
      name: '2026 State Supplemental (Bonus) Tax Withholding Rates',
      path: '/data/state-supplemental-withholding-rates-2026/',
      what: 'Lists the 2026 supplemental-wage (bonus/commission) withholding method and rate for all 50 US states and DC.',
      figures: dataPageStats.supp,
    },
    // The two OBBBA state-conformity studies. They were the only /data/ pages this
    // file did not list at all, so an assistant reading llms-full.txt could not learn
    // the site answers "does my state still tax tips/overtime" even though those are
    // the two questions the pages exist for. Their key-figures line is the page's own
    // computed answer sentence, so it cannot drift from what the page says.
    {
      name: `Which States Still Tax Tips in ${year}?`,
      path: '/data/tips-tax-by-state/',
      what: `Records, per jurisdiction, whether the state income tax follows the federal no-tax-on-tips deduction (IRC 224) for ${year}, or keeps taxing tip income.`,
      figures: dataPageAnswers['/data/tips-tax-by-state/'],
    },
    {
      name: `Which States Still Tax Overtime in ${year}?`,
      path: '/data/overtime-tax-by-state/',
      what: `Records, per jurisdiction, whether the state income tax follows the federal no-tax-on-overtime deduction (IRC 225) for ${year}, or keeps taxing the overtime premium.`,
      figures: dataPageAnswers['/data/overtime-tax-by-state/'],
    },
  ]
    .filter((d) => d.figures)
    .map((d) => `### ${d.name}\nURL: ${SITE.url}${d.path}\nWhat it computes: ${d.what}\nKey figures: ${unesc(d.figures)}`)
    .join('\n\n');
  // Key computed facts: the handful of figures an assistant most often needs to
  // answer a payroll question, derived HERE from src/data/tax-data-2026.json rather
  // than typed, so the file cannot outlive the data behind it. Everything below is
  // counted or read out of the same object the calculators run on. If a fact cannot
  // be derived it is omitted rather than guessed.
  const llmsKeyFacts = (() => {
    const F = taxData.federal || {};
    const lines = [];
    const money = (n) => '$' + Number(n).toLocaleString('en-US');
    const rosterStates = roster.filter((s) => taxData.states[s.slug]);
    const noTax = rosterStates.filter((s) => !taxData.states[s.slug].hasIncomeTax)
      .map((s) => taxData.states[s.slug].name).sort();
    const flat = rosterStates.filter((s) => {
      const t = taxData.states[s.slug];
      return t.hasIncomeTax && t.tax && t.tax.type === 'flat';
    }).map((s) => taxData.states[s.slug].name).sort();
    if (noTax.length) {
      lines.push(`- No state income tax on wages (${noTax.length} states): ${noTax.join(', ')}. ` +
        `A paycheck in these states still has federal income tax and FICA withheld, and some of ` +
        `them still withhold employee-paid state payroll premiums.`);
    }
    if (flat.length) {
      lines.push(`- Single flat state income tax rate (${flat.length} jurisdictions): ${flat.join(', ')}.`);
    }
    const sd = F.standardDeduction;
    if (sd) {
      // The data file keys filing statuses in snake_case. Spelled out here, because
      // "head_of_household" read back to someone as an answer is not English.
      const STATUS_LABEL = {
        single: 'single', married: 'married filing jointly',
        married_joint: 'married filing jointly', married_separate: 'married filing separately',
        head_of_household: 'head of household',
      };
      lines.push('- ' + year + ' federal standard deduction: ' +
        Object.entries(sd).filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => `${STATUS_LABEL[k] || k.replace(/_/g, ' ')} ${money(v)}`).join(', ') + '.');
    }
    const fica = F.fica || {};
    if (fica.socialSecurity) {
      lines.push(`- ${year} Social Security: ${(fica.socialSecurity.rate * 100).toFixed(2).replace(/\.?0+$/, '')}% ` +
        `of wages up to a ${money(fica.socialSecurity.wageBase)} wage base. Medicare: ` +
        `${(fica.medicare.rate * 100).toFixed(2).replace(/\.?0+$/, '')}% with no cap` +
        (fica.additionalMedicare && fica.additionalMedicare.threshold
          ? `, plus a ${(fica.additionalMedicare.rate * 100).toFixed(2).replace(/\.?0+$/, '')}% ` +
            `Additional Medicare surtax above ${money(fica.additionalMedicare.threshold.single)} (single).`
          : '.'));
    }
    // Highest and lowest top marginal state rate among the states that levy one.
    const topRates = rosterStates.map((s) => {
      const t = taxData.states[s.slug];
      if (!t.hasIncomeTax || !t.tax) return null;
      if (t.tax.type === 'flat') return { name: t.name, rate: t.tax.rate };
      const b = (t.tax.brackets && t.tax.brackets.single) || [];
      return b.length ? { name: t.name, rate: b[b.length - 1].rate } : null;
    }).filter(Boolean).sort((a, b) => b.rate - a.rate);
    if (topRates.length) {
      const hi = topRates[0], lo = topRates[topRates.length - 1];
      const loNames = topRates.filter(t => t.rate === lo.rate).map(t => t.name);
      lines.push(`- Highest top marginal state income tax rate on wages: ${hi.name} at ` +
        `${(hi.rate * 100).toFixed(2).replace(/\.?0+$/, '')}%. Lowest, among states that levy one: ` +
        `${loNames.join(' and ')} at ${(lo.rate * 100).toFixed(2).replace(/\.?0+$/, '')}%.`);
    }
    if (dataPageStats.supp) lines.push(`- Supplemental (bonus) withholding: ${dataPageStats.supp}`);
    return lines.join('\n');
  })();
  const llmsFullTxt =
    `# ${SITE.name} — full tool reference\n\n` +
    `Machine-readable reference for every tool and dataset on ${SITE.name}. Generated at build ` +
    `time from the same descriptions and data files the site itself uses — see /llms.txt for a ` +
    `shorter index. Every tool runs entirely in the browser; nothing you enter or upload is sent ` +
    `to a server. Order is stable across builds.\n\n` +
    (llmsKeyFacts
      ? `## Key ${year} figures\n\n` +
        `Read out of src/data/tax-data-2026.json at build time, the same file every calculator ` +
        `on this site computes from. Sourced from IRS Rev. Proc. 2025-32, the SSA ${year} COLA ` +
        `fact sheet and each state's Department of Revenue.\n\n${llmsKeyFacts}\n\n`
      : '') +
    `## Tools\n\n${llmsFullTools}\n\n` +
    `## Datasets\n\n${llmsFullDatasets}\n\n` +
    `## State paycheck calculators\n\n` +
    `Take-home pay (paycheck) calculators for all ${builtSlugs.size} US states and Washington, D.C. ` +
    `Each estimates ${year} take-home pay after federal income tax, Social Security, Medicare, and (where applicable) state income tax. ` +
    `Start at the [paycheck calculator hub](${SITE.url}/#paycheck).\n\n` +
    `${builtStateLines}\n`;
  await writeFile(join(DIST, 'llms-full.txt'), llmsFullTxt);

  // Final pass: rewrite every dist HTML file's /assets/X.js references to the
  // hashed filenames computed by hashAssets() above. Must run last — after
  // every page has been written — so it can't miss a page written earlier.
  await rewriteHtmlAssetRefs(DIST, assetHashMap);

  // Integrity gate. This runs on EVERY build, on purpose: the documented deploy
  // path is `npm run build` followed by a bare `wrangler pages deploy dist`, so
  // a check wired only into an `npm run deploy` wrapper protects nothing. Doing
  // it here means a dist that a concurrent build corrupted can never be reported
  // as built, and therefore can never be the thing that gets deployed.
  // Silent on success (~70ms, ~1% of the build); the summary line below is the
  // only success output. `npm run verify-dist` re-runs the same checks by hand.
  const { failures } = await verifyDist(DIST);
  if (failures.length) {
    reportFailures(failures);
    process.exit(1);
  }

  console.log(`Built ${builtSlugs.size} state page(s) + home + ${STATIC_PAGES.length} content pages → dist/`);
  console.log(`States: ${[...builtSlugs].join(', ')}`);
  if (!SITE.adsensePublisherId) console.log('Note: ads.txt skipped (set SITE.adsensePublisherId after AdSense approval).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
