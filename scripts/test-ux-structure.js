// test-ux-structure.js, the structural CI guard for the calm tool-page layout.
//
// Why this exists when 70-odd engine tests already run: the changes it protects
// are position-only. No number, no sentence and no engine behaviour moves when
// the state select is lifted back out of a question, when #stateVerdict is
// re-parented below the result, or when a page's lede is moved under the
// calculator. Every other test in this repo therefore passes just as happily
// before the change as after it, and a later edit that quietly puts the old
// shape back would ship green. The only artifact that records the intent is the
// ORDER of a handful of strings in the built HTML, so that order is what this
// file pins.
//
// It asserts by string index only, never by parsing. This repo ships marked and
// esbuild and nothing else, so there is no DOM parser to reach for, and every
// pin below is a question about relative position that indexOf answers directly.
// It reads dist/ rather than src/templates/ because the shapes being pinned are
// assembled by build.js (placeholders, the question-flow injection, the asset
// hash rewrite), and a template that looks right can still build wrong.
//
// This file renders nothing and is never served.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

if (!fs.existsSync(DIST)) {
  // Loudly skipped, never silently passed. `npm test` runs in trees that have
  // never been built, and a missing dist/ is a gap in coverage, not a pass.
  console.log('test-ux-structure: SKIPPED, no built site at ' + DIST);
  console.log('  Run `npm run build` first. This leaves the tool-page structure unchecked.');
  process.exit(0);
}

// build.js content-hashes every /assets file, so the built pages reference
// /assets/question-flow.<hash>.js. Matching on the path without the extension is
// what makes this pin survive the hash rewrite.
const QUESTION_FLOW = '/assets/question-flow';

const at = (html, needle) => html.indexOf(needle);

// Each pin is [name, fn]; fn returns null when the pin holds, or the reason it
// did not. Keeping the reason in the pin means a failure names the actual gap
// rather than just the assertion that tripped.
const contains = (needle) => (html) =>
  at(html, needle) === -1 ? 'expected to find ' + needle + ', it is not on the page' : null;

const absent = (needle) => (html) =>
  at(html, needle) === -1 ? null : 'found ' + needle + ' at index ' + at(html, needle) + ', it must not be on the page';

// The control must sit in the form's own flow, not behind a question or after
// the form has closed.
const insideForm = (formId, needle) => (html) => {
  const open = at(html, formId);
  if (open === -1) return 'no ' + formId + ' on the page';
  const close = html.indexOf('</form>', open);
  if (close === -1) return formId + ' is never closed';
  const target = at(html, needle);
  if (target === -1) return 'no ' + needle + ' on the page';
  if (target < open || target > close)
    return needle + ' is at index ' + target + ', outside ' + formId + ' (' + open + ' to ' + close + ')';
  return null;
};

const before = (first, second) => (html) => {
  const a = at(html, first);
  const b = at(html, second);
  if (a === -1) return 'no ' + first + ' on the page';
  if (b === -1) return 'no ' + second + ' on the page';
  return a < b ? null : first + ' is at index ' + a + ', which is not before ' + second + ' at ' + b;
};

const PAGES = [
  {
    // REPINNED 2026-08-01 to the wizard, the first conversion onto
    // wizard-core.js. This page's calculator was rewritten from the shared
    // one-long-form layout into a card-by-card flow, so two of the four names
    // below moved to different ids — the intent behind each pin is unchanged and
    // each is still asserted, against the shape that now ships. The old form
    // (#tipsForm) and the old #stateVerdict box still exist, and the old pins
    // still hold, on the /embed/ build; that build is pinned separately below.
    file: 'tips-tax-calculator/index.html',
    pins: [
      // Same pin, new form id: the state select sits in the flow the visitor is
      // already walking, not behind a yes/no they have to answer first.
      ['state-select-is-a-step-in-the-flow', insideForm('id="tipsWizForm"', 'id="state"')],
      ['no-qState-question', absent('name="qState"')],
      // Added, not moved: the two figures the answer is actually built from are
      // asked outright in the flow. Nothing pinned that before, and a card flow
      // is exactly the shape in which a question could quietly stop being asked.
      ['tips-are-asked-outright', insideForm('id="tipsWizForm"', 'id="tips"')],
      ['income-is-asked-outright', insideForm('id="tipsWizForm"', 'id="income"')],
      // Same pin, new id: the state answer renders after the result, never above
      // it. #stateVerdict became #otwStateNote when the result became a card.
      ['verdict-follows-the-result', before('data-tb-result', 'id="otwStateNote"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/tips-wizard')],
    ],
  },
  {
    // The embed is deliberately NOT the wizard (a third party sizes the iframe
    // once), so it keeps the old single-column form and the old ids. Pinned here
    // because three of the pins that used to cover that shape moved off the full
    // page above, and without this the shape would be unguarded on the one build
    // that still ships it.
    file: 'embed/tips-tax-calculator/index.html',
    pins: [
      ['state-select-is-a-plain-field', insideForm('id="tipsForm"', 'id="state"')],
      ['verdict-follows-the-result', before('id="out"', 'id="stateVerdict"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/tips-wizard')],
    ],
  },
  {
    // REPINNED 2026-08-01 to the wizard. This page's calculator was rewritten
    // from the shared one-long-form layout into a card-by-card flow, so four of
    // the five names below moved to different ids — the intent behind each pin is
    // unchanged and each is still asserted, against the shape that now ships.
    // The old form (#otForm) still exists, and these old pins still hold, on the
    // /embed/ build; that build is pinned separately below.
    file: 'overtime-tax-calculator/index.html',
    pins: [
      // Same pin as tips, new form id: the state select sits in the flow the
      // visitor is already walking, not behind a yes/no they have to answer.
      ['state-select-is-a-step-in-the-flow', insideForm('id="otwForm"', 'id="state"')],
      ['no-qState-question', absent('name="qState"')],
      // The qEstimate question is GONE because its answer became the default:
      // rate and hours are asked outright, as cards, rather than hidden behind
      // "do you want us to work it out for you". So the pin that guarded the
      // question now guards the two fields being in the main flow unconditionally,
      // which is the stronger form of the same promise.
      ['no-qEstimate-question', absent('name="qEstimate"')],
      ['rate-is-asked-outright', insideForm('id="otwForm"', 'id="regRate"')],
      ['hours-are-asked-outright', insideForm('id="otwForm"', 'id="otHours"')],
      // Same pin, new id: the state answer renders after the result, never above
      // it and never where the select that produced it can leave it stranded.
      // #stateVerdict became #otwStateNote when the result became a card.
      ['verdict-follows-the-result', before('data-tb-result', 'id="otwStateNote"')],
      // Inverted deliberately, matching build.js: the page is no longer in
      // QUESTION_FLOW_PAGES because it ships no [data-reveal] wrapper for
      // question-flow.js to act on. Listing it would download a script with
      // nothing to do. The stepping is overtime-wizard.js's own.
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/overtime-wizard')],
    ],
  },
  {
    // The embed is deliberately NOT the wizard (a third party sizes the iframe
    // once), so it keeps the old single-column form and the old ids. Pinned here
    // because the four pins that used to cover that shape moved off the full page
    // above, and without this the shape would be unguarded on the one build that
    // still ships it.
    file: 'embed/overtime-tax-calculator/index.html',
    pins: [
      ['state-select-is-a-plain-field', insideForm('id="otForm"', 'id="state"')],
      ['verdict-follows-the-result', before('id="out"', 'id="stateVerdict"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/overtime-wizard')],
    ],
  },
  // The 51 state bonus pages all render from one template, so three of them
  // stand in for the family: a no-income-tax state, the one state with a second
  // rate, and an ordinary graduated state.
  {
    file: 'texas-bonus-tax-calculator/index.html',
    pins: [['calculator-precedes-the-lede', before('class="calc"', 'class="lede"')]],
  },
  {
    file: 'california-bonus-tax-calculator/index.html',
    pins: [
      ['calculator-precedes-the-lede', before('class="calc"', 'class="lede"')],
      // California is the only state that asks which kind of extra pay this is,
      // and that row is addressed by id from bonus-tax-calculator.js.
      ['paymentTypeRow-kept', contains('id="paymentTypeRow"')],
    ],
  },
  {
    file: 'missouri-bonus-tax-calculator/index.html',
    pins: [['calculator-precedes-the-lede', before('class="calc"', 'class="lede"')]],
  },
];

let passed = 0;
const failures = [];

for (const page of PAGES) {
  const full = path.join(DIST, page.file);
  let html;
  try {
    html = fs.readFileSync(full, 'utf8');
  } catch (e) {
    // dist/ exists but this page does not, so the build dropped a page these
    // pins cover. That is a failure, not a skip.
    failures.push('  FAIL  ' + page.file + '  [unreadable]: ' + e.message);
    continue;
  }
  for (const [name, pin] of page.pins) {
    const reason = pin(html);
    if (reason) failures.push('  FAIL  ' + page.file + '  ' + name + ': ' + reason);
    else passed++;
  }
}

const total = PAGES.reduce((n, p) => n + p.pins.length, 0);
for (const f of failures) console.log(f);
console.log('test-ux-structure: ' + passed + '/' + total + ' passed');
process.exit(failures.length ? 1 : 0);
