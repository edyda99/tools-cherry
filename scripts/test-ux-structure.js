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

// after() is before() with the arguments read in the order a person says them:
// "#outStatus comes AFTER </form>". It exists because the two pins that need it
// are about an element being OUTSIDE the card stack, and writing that as
// before('</form>', 'id="outStatus"') reads as if </form> were the subject.
// Note it anchors on the FIRST </form> in the document, which is what makes it
// say "outside the cards" rather than "somewhere later on the page".
const after = (first, second) => (html) => {
  const a = at(html, first);
  const b = at(html, second);
  if (a === -1) return 'no ' + first + ' on the page';
  if (b === -1) return 'no ' + second + ' on the page';
  return b > a ? null : second + ' is at index ' + b + ', which is not after ' + first + ' at ' + a;
};

// An exact occurrence count. The one pin that needs it asserts a card COUNT,
// and every other helper here answers a question about position instead, so a
// card silently dropped from a 15-card flow would pass all of them.
const count = (needle, n) => (html) => {
  let seen = 0;
  for (let i = html.indexOf(needle); i !== -1; i = html.indexOf(needle, i + needle.length)) seen++;
  return seen === n ? null : 'expected ' + n + ' of ' + needle + ', found ' + seen;
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
      // ADDED, and the pin the relocation left owing. `state-select-is-a-plain-
      // field` used to live on THIS block and now lives on the embed block
      // below, so nothing here said anything about the shape it guarded. This
      // does, from the other side: the old single-column form is not merely
      // unpinned on the full page, it is gone from it.
      ['no-plain-form-left-on-the-full-page', absent('id="tipsForm"')],
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
  // ---------------------------------------------------------------------
  // The 2026-08-01 wizard fan-out: sixteen more tool pages converted from the
  // shared one-long-form layout onto wizard-core.js, plus the 51 state paycheck
  // pages. None of these pages had a block here before, so every pin below is a
  // strictly-stronger ADDITION (contract §8 move 2) rather than a rename — the
  // exceptions are the three bonus state blocks further down, which did have
  // pins, and which are renamed in place to the shape that now ships.
  //
  // The recurring shape: a card flow is exactly the failure mode this file
  // exists for. A card dropped from the path is STILL in the document, so the
  // page renders, the engine tests pass, and only "is this question inside the
  // form the visitor walks" records that it stopped being asked. That is what
  // the insideForm() pins say, one per field the answer is built from.
  //
  // Each converted page also pairs with its /embed/ twin, which is deliberately
  // NOT the wizard (a third party sizes the iframe once, and a flow whose height
  // changes per card would clip inside it). The embed keeps the old
  // single-column form, the old ids and the old /assets/<tool>.js. It gets its
  // own block because the full page above no longer ships that shape, so the one
  // build that still does would otherwise be completely unguarded.
  // ---------------------------------------------------------------------
  {
    // The four closed choices became real radio groups in the flow. They used to
    // be <select>s that JavaScript showed and hid by hand off #payerType, which
    // is the failure mode the no-JS rule exists to stop, so each is pinned as an
    // in-form question by NAME. The old form (#f1099Form) still exists, and the
    // old shape is still correct, on the /embed/ build pinned below.
    file: '1099-threshold-checker/index.html',
    pins: [
      ['payer-type-is-asked-outright', insideForm('id="f1099WizForm"', 'name="payerType"')],
      ['payment-nature-is-asked-outright', insideForm('id="f1099WizForm"', 'name="paymentNature"')],
      ['payment-purpose-is-asked-outright', insideForm('id="f1099WizForm"', 'name="paymentPurpose"')],
      ['tax-year-is-asked-outright', insideForm('id="f1099WizForm"', 'name="taxYear"')],
      // The two figures the answer is built from.
      ['amount-is-asked-outright', insideForm('id="f1099WizForm"', 'id="amount"')],
      ['payment-count-is-asked-outright', insideForm('id="f1099WizForm"', 'id="transactions"')],
      // The state picker is a step in the flow the visitor is already walking,
      // not a field behind a yes/no they have to answer first.
      ['state-select-is-a-step-in-the-flow', insideForm('id="f1099WizForm"', 'id="state"')],
      ['no-qState-question', absent('name="qState"')],
      ['answer-is-a-card-in-the-flow', insideForm('id="f1099WizForm"', 'data-tb-result')],
      ['verdict-follows-the-result', before('data-tb-result', 'id="otwStateNote"')],
      // The page ships no [data-reveal] wrapper now, so build.js's
      // injectQuestionFlow goes inert and the script is not downloaded. Its
      // QUESTION_FLOW_PAGES entry stays — do NOT delete it to "fix" this pin.
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/1099-threshold-wizard')],
      // The old single-column tool script must NOT also load here: two modules
      // binding the same #amount/#state would fight.
      ['not-the-old-tool-script', absent('/assets/1099-threshold-checker.')],
      ['calculator-precedes-the-lede', before('class="otw"', 'class="lede"')],
    ],
  },
  {
    file: 'embed/1099-threshold-checker/index.html',
    pins: [
      ['state-select-is-a-plain-field', insideForm('id="f1099Form"', 'id="state"')],
      ['old-tool-script-still-shipped', contains('/assets/1099-threshold-checker.')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/1099-threshold-wizard')],
    ],
  },
  {
    // No /embed/ twin, so 1099-vs-w2-calculator.js was rewritten in place onto
    // wizard-core.js rather than split into a -wizard.js asset, and the old
    // single-column form (#w2Form) survives nowhere. #w2Form is also the form id
    // on /w2-box-decoder/, which is why the wizard's form is #w2WizForm: reusing
    // the old id would have made a cross-page pin ambiguous.
    file: '1099-vs-w2-calculator/index.html',
    pins: [
      ['salary-is-asked-outright', insideForm('id="w2WizForm"', 'id="w2Gross"')],
      ['contract-net-is-asked-outright', insideForm('id="w2WizForm"', 'id="contractNet"')],
      ['filing-status-is-asked-outright', insideForm('id="w2WizForm"', 'name="status"')],
      // The answer is IN the flow now. It used to sit three blocks and a full ad
      // slot below the form, split across #compareWrap, .benefits-note and
      // #summaryBox, so a visitor read the headline and then scrolled past an
      // advert to find the numbers behind it.
      ['answer-is-inside-the-flow', insideForm('id="w2WizForm"', 'data-tb-result')],
      ['no-split-comparison-block', absent('id="compareWrap"')],
      ['no-detached-summary-box', absent('id="summaryBox"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['calculator-script-shipped', contains('/assets/1099-vs-w2-calculator')],
    ],
  },
  {
    // Also no /embed/ twin: 401k-calculator.js was rewritten in place.
    file: '401k-calculator/index.html',
    pins: [
      // The six figures the projection is built from.
      ['age-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="currentAge"')],
      ['retirement-age-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="retirementAge"')],
      ['balance-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="currentBalance"')],
      ['salary-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="annualSalary"')],
      ['contribution-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="employeeContrib"')],
      ['return-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="annualReturn"')],
      // These three used to ship inside [data-reveal] wrappers behind two Yes/No
      // questions; they must now be plain, always-present fields in the flow.
      ['employer-match-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="employerMatch"')],
      ['match-cap-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="matchCap"')],
      ['salary-growth-is-asked-outright', insideForm('id="retire401kWizForm"', 'id="salaryGrowth"')],
      // The two retired yes/no groups: the answer became the default, so the
      // question must not come back.
      ['no-qMatch-question', absent('name="qMatch"')],
      ['no-qGrowth-question', absent('name="qGrowth"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['no-reveal-wrapper', absent('data-reveal=')],
      ['wizard-precedes-the-lede', before('class="otw"', 'class="lede"')],
      // The page had NO explicit result anchor before this rewrite —
      // report-widget.js fell back to sniffing for an aria-live element and
      // would have picked the old .results div.
      ['result-anchor-shipped', contains('data-tb-result')],
      // One answer surface, not three. The old page strung a results column, a
      // standalone #summaryBox and a standalone #scheduleWrap down the page.
      ['no-standalone-summary-box', absent('id="summaryBox"')],
      ['no-standalone-schedule-block', absent('id="scheduleWrap"')],
      ['no-legacy-form-id', absent('id="retire401kForm"')],
    ],
  },
  {
    // Two of the three retired gates were <select>s rather than name="q…"
    // radios, so they are pinned by the absence of their old ids.
    file: 'able-account-calculator/index.html',
    pins: [
      ['onset-age-is-asked-outright', insideForm('id="ableWizForm"', 'name="onset"')],
      ['work-question-is-asked-outright', insideForm('id="ableWizForm"', 'name="employed"')],
      ['pay-is-asked-outright', insideForm('id="ableWizForm"', 'id="compensation"')],
      ['plan-question-is-asked-outright', insideForm('id="ableWizForm"', 'name="planContribution"')],
      ['others-are-asked-outright', insideForm('id="ableWizForm"', 'id="others"')],
      ['own-is-asked-outright', insideForm('id="ableWizForm"', 'id="own"')],
      ['state-select-is-a-step-in-the-flow', insideForm('id="ableWizForm"', 'id="state"')],
      // The 529 amount became an .otw-esc escape hatch on the "everyone else"
      // card, which is what retired the qRollover yes/no. A folded field is
      // reachable, a deleted one is not.
      ['rollover-is-still-in-the-form', insideForm('id="ableWizForm"', 'id="rollover529"')],
      ['no-qRollover-question', absent('name="qRollover"')],
      ['no-onsetGate-select', absent('id="onsetGate"')],
      ['no-employed-select', absent('id="employed"')],
      ['no-planContribution-select', absent('id="planContribution"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/able-account-wizard')],
    ],
  },
  {
    file: 'embed/able-account-calculator/index.html',
    pins: [
      ['onset-gate-is-a-plain-field', insideForm('id="ableForm"', 'id="onsetGate"')],
      ['state-select-is-a-plain-field', insideForm('id="ableForm"', 'id="state"')],
      ['employed-select-is-a-plain-field', insideForm('id="ableForm"', 'id="employed"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/able-account-wizard')],
    ],
  },
  {
    // The two that matter most are structural facts the old page got WRONG and
    // the card flow fixes: the per-child expense fields were built with
    // innerHTML from #children, so dist/ shipped no qae0 at all, and the two
    // rare questions sat behind [data-reveal] yes/no gates.
    file: 'adoption-credit-calculator/index.html',
    pins: [
      ['expenses-are-asked-outright', insideForm('id="adoptionWizForm"', 'id="qae0"')],
      ['income-is-asked-outright', insideForm('id="adoptionWizForm"', 'id="magi"')],
      ['tax-liability-is-asked-outright', insideForm('id="adoptionWizForm"', 'id="taxLiability"')],
      // The second and third child cards ship as real markup on every build, on
      // the path or not. A regression to runtime-generated children drops these.
      ['second-child-ships-in-the-form', insideForm('id="adoptionWizForm"', 'id="qae1"')],
      ['third-child-ships-in-the-form', insideForm('id="adoptionWizForm"', 'id="qae2"')],
      ['no-qEmployer-question', absent('name="qEmployer"')],
      ['no-qCarry-question', absent('name="qCarry"')],
      ['employer-help-is-asked-outright', insideForm('id="adoptionWizForm"', 'id="employerBenefits"')],
      ['carryforward-is-asked-outright', insideForm('id="adoptionWizForm"', 'id="cfAmount"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/adoption-credit-wizard')],
      ['calculator-precedes-the-lede', before('id="adoptionWizard"', 'class="lede"')],
    ],
  },
  {
    file: 'embed/adoption-credit-calculator/index.html',
    pins: [
      ['income-is-a-plain-field', insideForm('id="adoptForm"', 'id="magi"')],
      ['old-calculator-shipped', contains('/assets/adoption-credit-calculator')],
      ['not-the-wizard', absent('/assets/adoption-credit-wizard')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
    ],
  },
  {
    // The four eligibility conditions ARE the deduction — fail one and the
    // answer is $0 whatever else is entered — so each is pinned on its own. One
    // pin for "the checklist exists" would pass with three of the four dropped.
    file: 'car-loan-interest-calculator/index.html',
    pins: [
      ['loan-amount-is-asked-outright', insideForm('id="carLoanWizForm"', 'id="amount"')],
      ['rate-is-asked-outright', insideForm('id="carLoanWizForm"', 'id="apr"')],
      ['term-is-asked-outright', insideForm('id="carLoanWizForm"', 'id="term"')],
      ['income-is-asked-outright', insideForm('id="carLoanWizForm"', 'id="magi"')],
      ['new-vehicle-condition-is-asked', insideForm('id="carLoanWizForm"', 'id="e-new"')],
      ['us-assembly-condition-is-asked', insideForm('id="carLoanWizForm"', 'id="e-usa"')],
      ['loan-date-condition-is-asked', insideForm('id="carLoanWizForm"', 'id="e-origin"')],
      ['personal-use-condition-is-asked', insideForm('id="carLoanWizForm"', 'id="e-personal"')],
      // The tax year cannot change the answer (all four years it offers share
      // one cap and one threshold set) but it is still a real field in the flow.
      // This pin is what stops it being deleted as "the select that does nothing".
      ['tax-year-stays-in-the-flow', insideForm('id="carLoanWizForm"', 'id="year"')],
      ['filing-is-radios-not-a-select', contains('name="filing"')],
      ['filing-select-is-gone', absent('id="filing"')],
      ['answer-follows-the-questions', before('name="filing"', 'data-tb-result')],
      // This page shipped the opposite order (a hundred words of statute above
      // the first field) until the conversion, so this pin records a decision
      // rather than describing the status quo.
      ['calculator-precedes-the-lede', before('id="carLoanWizard"', 'class="lede"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/car-loan-interest-wizard')],
    ],
  },
  {
    file: 'embed/car-loan-interest-calculator/index.html',
    pins: [
      ['eligibility-is-a-plain-field', insideForm('id="carForm"', 'id="e-new"')],
      ['filing-is-a-plain-field', insideForm('id="carForm"', 'id="filing"')],
      ['result-follows-the-form', before('id="carForm"', 'id="out"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/car-loan-interest-wizard')],
    ],
  },
  {
    file: 'charitable-deduction-calculator/index.html',
    pins: [
      ['cash-gift-is-asked-outright', insideForm('id="charitableWizForm"', 'id="cashGift"')],
      ['non-cash-is-asked-outright', insideForm('id="charitableWizForm"', 'id="nonCash"')],
      ['income-is-asked-outright', insideForm('id="charitableWizForm"', 'id="agi"')],
      ['filing-is-asked-outright', insideForm('id="charitableWizForm"', 'name="filing"')],
      ['other-itemized-is-asked-outright', insideForm('id="charitableWizForm"', 'id="other"')],
      ['no-qGoods-question', absent('name="qGoods"')],
      ['no-qOther-question', absent('name="qOther"')],
      // THE ONE THAT IS NOT COSMETIC. #other ships pre-filled at 20,000 and
      // question-flow.js's No used to ZERO it, not merely hide it (a hidden
      // 20,000 kept feeding the comparison and flipped the headline verdict to
      // "itemising wins"). With the gate gone, the zero has to stay reachable,
      // and the quick chip is what carries it.
      ['nothing-else-chip-zeroes-other', contains('data-otw-fill="other" data-otw-value="0"')],
      ['answer-follows-the-questions', before('id="other"', 'data-tb-result')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/charitable-deduction-wizard')],
    ],
  },
  {
    file: 'embed/charitable-deduction-calculator/index.html',
    pins: [
      ['filing-is-a-plain-field', insideForm('id="charForm"', 'id="filing"')],
      ['other-itemized-is-a-plain-field', insideForm('id="charForm"', 'id="other"')],
      ['result-follows-the-form', before('id="charForm"', 'id="out"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/charitable-deduction-wizard')],
    ],
  },
  {
    file: 'dependent-care-fsa-vs-credit-calculator/index.html',
    pins: [
      ['care-bill-is-asked-outright', insideForm('id="dcWizForm"', 'id="expenses"')],
      ['income-is-asked-outright', insideForm('id="dcWizForm"', 'id="agi"')],
      // The FSA allowance used to live in a [data-reveal] wrapper behind qFsa.
      // Both halves are pinned because the failure that matters is the box
      // surviving while the question that zeroes it does not.
      ['fsa-allowance-is-a-step-in-the-flow', insideForm('id="dcWizForm"', 'id="employerFsa"')],
      ['no-qFsa-question', absent('name="qFsa"')],
      ['family-size-is-a-real-choice', insideForm('id="dcWizForm"', 'name="kids"')],
      ['filing-is-a-real-choice', insideForm('id="dcWizForm"', 'name="filing"')],
      ['fsa-question-is-a-real-choice', insideForm('id="dcWizForm"', 'name="hasFsa"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/dependent-care-fsa-vs-credit-wizard')],
      // The two builds share every field id; the form id is the only thing that
      // tells them apart.
      ['not-the-embed-form', absent('id="dcForm"')],
      ['result-anchor-is-explicit', contains('data-tb-result')],
    ],
  },
  {
    file: 'embed/dependent-care-fsa-vs-credit-calculator/index.html',
    pins: [
      ['fsa-allowance-is-a-plain-field', insideForm('id="dcForm"', 'id="employerFsa"')],
      ['filing-is-a-plain-field', insideForm('id="dcForm"', 'id="filing"')],
      ['result-follows-the-form', before('id="dcForm"', 'id="out"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/dependent-care-fsa-vs-credit-wizard')],
      ['still-the-old-asset', contains('/assets/dependent-care-fsa-vs-credit-calculator')],
    ],
  },
  {
    // The most gate-heavy page in the family: three stacked yes/no questions
    // hiding four fields, and nothing recorded that every field was reachable.
    file: 'employer-student-loan-repayment-calculator/index.html',
    pins: [
      ['benefit-is-asked-outright', insideForm('id="s127WizForm"', 'id="loanRepaymentBenefit"')],
      ['bracket-is-asked-outright', insideForm('id="s127WizForm"', 'id="marginalFedRate"')],
      // The three checkboxes that replaced the three yes/no gates. They are the
      // when() predicates for every card after them, so losing one silently
      // removes two cards from the flow.
      ['extras-tuition-is-offered', insideForm('id="s127WizForm"', 'id="hasTuition"')],
      ['extras-high-pay-is-offered', insideForm('id="s127WizForm"', 'id="hasHighPay"')],
      ['extras-state-tax-is-offered', insideForm('id="s127WizForm"', 'id="hasStateTax"')],
      ['tuition-used-is-asked-outright', insideForm('id="s127WizForm"', 'id="tuitionAssistanceUsed"')],
      ['other-pay-is-asked-outright', insideForm('id="s127WizForm"', 'id="wages"')],
      ['state-rate-is-asked-outright', insideForm('id="s127WizForm"', 'id="stateMarginalRate"')],
      ['filing-status-is-a-step-in-the-flow', insideForm('id="s127WizForm"', 'name="filingStatus"')],
      ['state-conformity-is-a-step-in-the-flow', insideForm('id="s127WizForm"', 'name="stateConforms"')],
      ['no-qTuition-question', absent('name="qTuition"')],
      ['no-qHighEarner-question', absent('name="qHighEarner"')],
      ['no-qState-question', absent('name="qState"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/employer-student-loan-repayment-wizard')],
      ['result-is-the-report-anchor', contains('data-tb-result')],
      ['answer-follows-the-questions', before('id="loanRepaymentBenefit"', 'data-tb-result')],
    ],
  },
  {
    file: 'embed/employer-student-loan-repayment-calculator/index.html',
    pins: [
      ['benefit-is-a-plain-field', insideForm('id="s127Form"', 'id="loanRepaymentBenefit"')],
      ['tuition-used-is-a-plain-field', insideForm('id="s127Form"', 'id="tuitionAssistanceUsed"')],
      ['state-conformity-is-a-plain-select', insideForm('id="s127Form"', 'id="stateConforms"')],
      ['filing-status-is-a-plain-select', insideForm('id="s127Form"', 'id="filingStatus"')],
      ['result-follows-the-form', before('id="s127Form"', 'id="out"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/employer-student-loan-repayment-wizard')],
    ],
  },
  {
    file: 'pmi-deduction-calculator/index.html',
    pins: [
      ['calculator-precedes-the-lede', before('id="pmiWizard"', 'class="lede"')],
      // #other in particular was gated behind name="qOther" and is the single
      // input that decides whether the answer is a number or a zero.
      ['premiums-are-asked-outright', insideForm('id="pmiWizForm"', 'id="recurring"')],
      ['agi-is-asked-outright', insideForm('id="pmiWizForm"', 'id="agi"')],
      ['other-itemized-is-asked-outright', insideForm('id="pmiWizForm"', 'id="other"')],
      ['upfront-is-asked-outright', insideForm('id="pmiWizForm"', 'id="upfront"')],
      ['closing-month-is-in-the-flow', insideForm('id="pmiWizForm"', 'id="closingMonth"')],
      ['loan-term-is-in-the-flow', insideForm('id="pmiWizForm"', 'id="termMonths"')],
      // The pre-2007 statutory gate moved into a collapsed .otw-esc escape on
      // the first card rather than onto a card of its own. It is the one input
      // that can zero the answer for a legal reason rather than an arithmetic
      // one, so this pin stops it being tidied away entirely.
      ['pre-2007-gate-still-shipped', insideForm('id="pmiWizForm"', 'id="contract2007"')],
      ['no-qUpfront-question', absent('name="qUpfront"')],
      ['no-qOther-question', absent('name="qOther"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/pmi-deduction-wizard')],
    ],
  },
  {
    file: 'embed/pmi-deduction-calculator/index.html',
    pins: [
      ['fields-are-plain-in-the-old-form', insideForm('id="mipForm"', 'id="other"')],
      ['upfront-is-plain-in-the-old-form', insideForm('id="mipForm"', 'id="upfront"')],
      // pmi-deduction-calculator.js rewrites #upfrontHint's text and toggles
      // #termField / #closingMonth's .field wrapper by display on every render.
      // Both ids only exist on this build now, so a rename here is a silent break.
      ['upfront-hint-anchor-kept', contains('id="upfrontHint"')],
      ['term-field-anchor-kept', contains('id="termField"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/pmi-deduction-wizard')],
    ],
  },
  {
    // Three of the nine money questions used to sit inside <fieldset class="adv">
    // behind their own yes/no radio gates (qOther / qRmd / qOffset).
    file: 'qcd-vs-charitable-deduction-calculator/index.html',
    pins: [
      ['gift-is-asked-outright', insideForm('id="qcdWizForm"', 'id="donation"')],
      ['account-is-asked-outright', insideForm('id="qcdWizForm"', 'name="accountType"')],
      ['age-is-asked-outright', insideForm('id="qcdWizForm"', 'id="age"')],
      ['income-is-asked-outright', insideForm('id="qcdWizForm"', 'id="agi"')],
      ['filing-is-asked-outright', insideForm('id="qcdWizForm"', 'name="filing"')],
      ['spouse-65-is-asked-outright', insideForm('id="qcdWizForm"', 'name="spouse65"')],
      ['other-itemized-is-asked-outright', insideForm('id="qcdWizForm"', 'id="other"')],
      ['rmd-is-asked-outright', insideForm('id="qcdWizForm"', 'id="rmd"')],
      ['offset-is-asked-outright', insideForm('id="qcdWizForm"', 'id="offset"')],
      ['no-qOther-question', absent('name="qOther"')],
      ['no-qRmd-question', absent('name="qRmd"')],
      ['no-qOffset-question', absent('name="qOffset"')],
      // Progressive enhancement: the flow ships whole. A truncated conversion
      // that dropped the branch cards would still render and still compute, and
      // only the card count records that it was not supposed to.
      ['every-card-ships-in-the-html', contains('data-step="9"')],
      ['the-answer-is-the-last-card', before('data-step="8"', 'data-step="9"')],
      ['result-anchor-survives', contains('data-tb-result')],
      // #outStatus must sit OUTSIDE the cards: inside one it is display:none on
      // every step but its own and the announcement never reaches a screen reader.
      ['status-line-is-outside-the-cards', after('</form>', 'id="outStatus"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/qcd-vs-charitable-deduction-wizard')],
      ['not-the-embed-form', absent('id="qcdForm"')],
    ],
  },
  {
    file: 'embed/qcd-vs-charitable-deduction-calculator/index.html',
    pins: [
      ['account-type-is-a-plain-field', insideForm('id="qcdForm"', 'id="accountType"')],
      ['spouse-65-is-a-plain-checkbox', insideForm('id="qcdForm"', 'id="spouseAge65"')],
      ['filing-is-a-plain-select', insideForm('id="qcdForm"', 'id="filing"')],
      ['result-follows-the-form', before('id="qcdForm"', 'id="out"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/qcd-vs-charitable-deduction-wizard')],
    ],
  },
  {
    // The old full-page form was #rothForm with a <select id="year">, an
    // <input type="checkbox" id="planRoth"> and a name="qFuture" yes/no gating a
    // [data-reveal] wrapper. All four still ship, unchanged, on the /embed/
    // build — which is why the absent() pins here are safe.
    file: 'roth-catchup-calculator/index.html',
    pins: [
      ['year-is-asked-outright', insideForm('id="rothWizForm"', 'name="year"')],
      ['age-is-asked-outright', insideForm('id="rothWizForm"', 'id="age"')],
      ['wages-are-asked-outright', insideForm('id="rothWizForm"', 'id="wages"')],
      ['roth-option-is-asked-outright', insideForm('id="rothWizForm"', 'name="planRoth"')],
      ['catchup-is-asked-outright', insideForm('id="rothWizForm"', 'id="catchUp"')],
      ['current-rate-is-asked-outright', insideForm('id="rothWizForm"', 'id="rateNow"')],
      // The long-run three are optional (their card carries a Skip) but they
      // must stay IN the form: a folded field is reachable, a deleted one is not.
      ['retirement-rate-is-still-in-the-form', insideForm('id="rothWizForm"', 'id="rateRetire"')],
      ['years-are-still-in-the-form', insideForm('id="rothWizForm"', 'id="years"')],
      ['growth-is-still-in-the-form', insideForm('id="rothWizForm"', 'id="growth"')],
      ['no-qFuture-question', absent('name="qFuture"')],
      ['no-year-select', absent('id="year"')],
      ['no-planRoth-checkbox', absent('id="planRoth"')],
      ['answer-follows-every-question', before('id="rateRetire"', 'data-tb-result')],
      ['status-line-is-outside-the-cards', after('</form>', 'id="outStatus"')],
      ['calculator-precedes-the-lede', before('id="rothWizard"', 'class="lede"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/roth-catchup-wizard')],
    ],
  },
  {
    file: 'embed/roth-catchup-calculator/index.html',
    pins: [
      ['year-select-is-a-plain-field', insideForm('id="rothForm"', 'id="year"')],
      ['plan-roth-is-a-plain-checkbox', insideForm('id="rothForm"', 'id="planRoth"')],
      ['retirement-rate-is-a-plain-field', insideForm('id="rothForm"', 'id="rateRetire"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/roth-catchup-wizard')],
    ],
  },
  {
    file: 'salt-cap-calculator/index.html',
    pins: [
      ['income-tax-is-asked-outright', insideForm('id="saltWizForm"', 'id="incomeTax"')],
      ['property-tax-is-asked-outright', insideForm('id="saltWizForm"', 'id="propTax"')],
      ['income-is-asked-outright', insideForm('id="saltWizForm"', 'id="magi"')],
      // #other used to live inside a [data-reveal] wrapper behind a yes/no. It
      // is a card of its own now, with a Skip that CLEARS it.
      ['other-writeoffs-are-asked-outright', insideForm('id="saltWizForm"', 'id="other"')],
      ['tax-year-is-a-step-in-the-flow', insideForm('id="saltWizForm"', 'name="year"')],
      ['filing-status-is-a-step-in-the-flow', insideForm('id="saltWizForm"', 'name="filing"')],
      ['no-qOther-question', absent('name="qOther"')],
      ['result-is-the-last-card', insideForm('id="saltWizForm"', 'data-tb-result')],
      ['optional-question-precedes-the-answer', before('id="other"', 'data-tb-result')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/salt-cap-wizard')],
    ],
  },
  {
    file: 'embed/salt-cap-calculator/index.html',
    pins: [
      ['other-is-a-plain-field', insideForm('id="saltForm"', 'id="other"')],
      ['year-is-a-plain-field', insideForm('id="saltForm"', 'id="year"')],
      ['filing-is-a-plain-field', insideForm('id="saltForm"', 'id="filing"')],
      // #torpedo is the embed's own box and salt-cap-calculator.js still writes
      // it. The full page renders the same warning inside #out instead.
      ['torpedo-box-follows-the-result', before('id="out"', 'id="torpedo"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/salt-cap-wizard')],
    ],
  },
  {
    file: 'senior-deduction-calculator/index.html',
    pins: [
      ['age-is-asked-outright', insideForm('id="seniorWizForm"', 'name="age65"')],
      ['filing-status-is-asked-outright', insideForm('id="seniorWizForm"', 'name="filing"')],
      ['income-is-asked-outright', insideForm('id="seniorWizForm"', 'id="magi"')],
      ['tax-year-is-asked-outright', insideForm('id="seniorWizForm"', 'id="year"')],
      // The strongest of the five. The spouse question used to live in a row the
      // JS set `hidden` on, so with scripting off it was on screen for everyone
      // including single filers. It is now a card the core simply does not put
      // on the path, and the question is unconditionally in the document.
      ['spouse-age-is-a-step-in-the-flow', insideForm('id="seniorWizForm"', 'name="spouseAge65"')],
      ['no-js-hidden-spouse-row', absent('id="spouseRow"')],
      ['calculator-precedes-the-lede', before('class="otw"', 'class="lede"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/senior-deduction-wizard')],
    ],
  },
  {
    // #spouseRow in particular: the embed's JS still addresses it by id and
    // would throw without it.
    file: 'embed/senior-deduction-calculator/index.html',
    pins: [
      ['income-is-a-plain-field', insideForm('id="seniorForm"', 'id="magi"')],
      ['spouse-row-still-derived', insideForm('id="seniorForm"', 'id="spouseRow"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/senior-deduction-wizard')],
    ],
  },
  {
    file: 'w4-overtime-tips-withholding-calculator/index.html',
    pins: [
      ['tips-are-asked-outright', insideForm('id="w4WizForm"', 'id="tips"')],
      ['overtime-rate-is-asked-outright', insideForm('id="w4WizForm"', 'id="otrate"')],
      ['overtime-hours-are-asked-outright', insideForm('id="w4WizForm"', 'id="othours"')],
      ['income-is-asked-outright', insideForm('id="w4WizForm"', 'id="income"')],
      ['filing-status-is-asked-outright', insideForm('id="w4WizForm"', 'name="filing"')],
      ['pay-frequency-is-asked-outright', insideForm('id="w4WizForm"', 'name="freq"')],
      // The two escapes stay INSIDE the form: the premium and the months box are
      // collapsed, not removed, and the no-JS build must still reach them.
      ['known-premium-stays-in-the-flow', insideForm('id="w4WizForm"', 'id="otpremium"')],
      ['months-stays-in-the-flow', insideForm('id="w4WizForm"', 'id="months"')],
      // The branch question comes first, because it is what drops the cards that
      // do not apply. If it ever ends up after the tips box, the flow asks
      // before it knows.
      ['pay-kind-branch-is-the-first-question', before('name="paid"', 'id="tips"')],
      ['no-qTips-question', absent('name="qTips"')],
      ['no-qOt-question', absent('name="qOt"')],
      ['no-qMidYear-question', absent('name="qMidYear"')],
      ['no-otmode-question', absent('name="otmode"')],
      ['calculator-precedes-the-lede', before('class="otw"', 'class="lede"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/w4-overtime-tips-withholding-wizard')],
      ['not-the-embed-form', absent('id="w4Form"')],
    ],
  },
  {
    file: 'embed/w4-overtime-tips-withholding-calculator/index.html',
    pins: [
      ['otmode-is-a-plain-field', insideForm('id="w4Form"', 'name="otmode"')],
      ['months-is-a-plain-field', insideForm('id="w4Form"', 'id="months"')],
      ['result-follows-the-form', before('id="w4Form"', 'id="out"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/w4-overtime-tips-withholding-wizard')],
    ],
  },
  {
    // The bonus hub was unpinned. Its calculator drives the same flow as the 51
    // state pages from the same asset, and the one question it has that they do
    // not (the state picker) is the one this family most needs guarded.
    file: 'bonus-tax-calculator/index.html',
    pins: [
      ['bonus-is-asked-outright', insideForm('id="bonusWizForm"', 'id="bonus"')],
      ['state-select-is-a-step-in-the-flow', insideForm('id="bonusWizForm"', 'id="state"')],
      ['yearly-pay-is-asked-outright', insideForm('id="bonusWizForm"', 'id="regIncome"')],
      ['filing-status-is-asked-outright', insideForm('id="bonusWizForm"', 'name="filingStatus"')],
      ['how-it-was-paid-is-asked-outright', insideForm('id="bonusWizForm"', 'name="method"')],
      ['earlier-bonuses-are-asked-outright', insideForm('id="bonusWizForm"', 'id="ytdSupp"')],
      ['no-qYtd-question', absent('name="qYtd"')],
      // Hub only: the 51 state pages ship no #otwStateNote, because the whole
      // page is that state's answer already.
      ['verdict-follows-the-result', before('data-tb-result', 'id="otwStateNote"')],
      // The hub's lede used to sit ABOVE the calculator; the 51 state pages
      // already put the calculator first. This records that the two halves of
      // one tool now agree.
      ['calculator-precedes-the-lede', before('class="otw"', 'class="lede"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/bonus-tax-wizard')],
    ],
  },
  {
    // #paymentTypeRow lives on here, which is where the literal old
    // `paymentTypeRow-kept` assertion is preserved — see the california block.
    file: 'embed/bonus-tax-calculator/index.html',
    pins: [
      ['state-select-is-a-plain-field', insideForm('id="bonusForm"', 'id="state"')],
      ['paymentTypeRow-kept', contains('id="paymentTypeRow"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['not-the-wizard', absent('/assets/bonus-tax-wizard')],
    ],
  },
  // The 51 state bonus pages all render from one template, so three of them
  // stand in for the family: a no-income-tax state, the one state with a second
  // rate, and an ordinary graduated state. All three blocks are REPINNED
  // 2026-08-01: `calculator-precedes-the-lede` keeps its name and its promise
  // (the calculator is above the explanatory lede), and only its needle moves,
  // because `class="calc"` became `class="otw"` when the form became a card
  // stack. Everything else in these three blocks is an addition.
  {
    file: 'texas-bonus-tax-calculator/index.html',
    pins: [
      ['calculator-precedes-the-lede', before('class="otw"', 'class="lede"')],
      ['bonus-is-asked-outright', insideForm('id="bonusWizForm"', 'id="bonus"')],
      ['yearly-pay-is-asked-outright', insideForm('id="bonusWizForm"', 'id="regIncome"')],
      ['filing-status-is-asked-outright', insideForm('id="bonusWizForm"', 'name="filingStatus"')],
      ['how-it-was-paid-is-asked-outright', insideForm('id="bonusWizForm"', 'name="method"')],
      // The strongest of the set. #ytdSupp used to sit inside a
      // [data-reveal="qYtd"] wrapper, inside a collapsed <details
      // class="adv-more">, behind a No-by-default yes/no. It is a card in the
      // flow now, and the only way to leave it unanswered is its own Skip.
      ['earlier-bonuses-are-asked-outright', insideForm('id="bonusWizForm"', 'id="ytdSupp"')],
      ['no-qYtd-question', absent('name="qYtd"')],
      // Only California asks which kind of extra pay this is, and the card's
      // own options quote California's 10.23% and 6.6% by name. The wizard kept
      // it off the path with `when: isCalifornia`, but that needs JavaScript,
      // and on this cluster the served card stack IS the form without it. So the
      // card must not be SERVED here at all.
      ['no-california-paytype-card', absent('name="paymentType"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/bonus-tax-wizard')],
    ],
  },
  {
    file: 'california-bonus-tax-calculator/index.html',
    pins: [
      ['calculator-precedes-the-lede', before('class="otw"', 'class="lede"')],
      ['bonus-is-asked-outright', insideForm('id="bonusWizForm"', 'id="bonus"')],
      ['yearly-pay-is-asked-outright', insideForm('id="bonusWizForm"', 'id="regIncome"')],
      ['filing-status-is-asked-outright', insideForm('id="bonusWizForm"', 'name="filingStatus"')],
      ['how-it-was-paid-is-asked-outright', insideForm('id="bonusWizForm"', 'name="method"')],
      ['earlier-bonuses-are-asked-outright', insideForm('id="bonusWizForm"', 'id="ytdSupp"')],
      ['no-qYtd-question', absent('name="qYtd"')],
      // STRICTLY STRONGER, same promise. California is the only state that asks
      // which kind of extra pay this is. The old pin was
      // `paymentTypeRow-kept: contains('id="paymentTypeRow"')`, which only said
      // a div existed somewhere on the page — and it shipped
      // style="display:none", so "kept" meant "present but invisible". The
      // question is now a real card, so the pin asserts the CONTROL is inside
      // the flow's own form. The literal old assertion is NOT deleted: it is
      // preserved verbatim, under its original name, on the /embed/ build above,
      // which is the one build where #paymentTypeRow still exists.
      ['payment-type-is-a-step-in-the-flow', insideForm('id="bonusWizForm"', 'name="paymentType"')],
      // ADDED, and the pin the relocation left owing. The literal
      // `paymentTypeRow-kept` assertion moved to the embed block, so nothing on
      // THIS page spoke about the old wrapper any more. This does, from the
      // other side: the display:none div is gone from the page it used to sit on.
      ['no-paymentTypeRow-wrapper', absent('id="paymentTypeRow"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/bonus-tax-wizard')],
    ],
  },
  {
    file: 'missouri-bonus-tax-calculator/index.html',
    pins: [
      ['calculator-precedes-the-lede', before('class="otw"', 'class="lede"')],
      ['bonus-is-asked-outright', insideForm('id="bonusWizForm"', 'id="bonus"')],
      ['yearly-pay-is-asked-outright', insideForm('id="bonusWizForm"', 'id="regIncome"')],
      ['filing-status-is-asked-outright', insideForm('id="bonusWizForm"', 'name="filingStatus"')],
      ['how-it-was-paid-is-asked-outright', insideForm('id="bonusWizForm"', 'name="method"')],
      ['earlier-bonuses-are-asked-outright', insideForm('id="bonusWizForm"', 'id="ytdSupp"')],
      ['no-qYtd-question', absent('name="qYtd"')],
      // Only California asks which kind of extra pay this is, and the card's
      // own options quote California's 10.23% and 6.6% by name. The wizard kept
      // it off the path with `when: isCalifornia`, but that needs JavaScript,
      // and on this cluster the served card stack IS the form without it. So the
      // card must not be SERVED here at all.
      ['no-california-paytype-card', absent('name="paymentType"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      ['wizard-script-shipped', contains('/assets/bonus-tax-wizard')],
    ],
  },
  // The 51 state paycheck pages. One template, 51 URLs, so a shape defect is a
  // 51-page defect. Three states, chosen for the three data shapes the template
  // branches on: a wage tax plus an employee premium (california), no wage tax
  // at all (alaska, where the whole #stateLine row is omitted from the HTML),
  // and a wage tax with no premium (alabama).
  ...['california', 'alaska', 'alabama'].map((slug) => ({
    file: `${slug}-paycheck-calculator/index.html`,
    pins: [
      // Every figure the flow asks for is a real field inside the one form. This
      // is the pin that fails if a card is ever dropped rather than hidden:
      // app.js's readForm() reads all of these unguarded on every keystroke.
      ['pay-is-asked-outright', insideForm('id="paycheckForm"', 'id="amount"')],
      ['pay-type-is-asked-outright', insideForm('id="paycheckForm"', 'id="wageType"')],
      ['hours-is-asked-outright', insideForm('id="paycheckForm"', 'id="hours"')],
      // The four rule questions compute now, so the figures they compute FROM
      // are fields in the same one form, on the same terms as everything above:
      // app.js reads all four on every keystroke and a card that was dropped
      // rather than hidden would take the answer with it.
      ['tips-are-asked-outright', insideForm('id="paycheckForm"', 'id="tipsYear"')],
      ['overtime-hours-are-asked-outright', insideForm('id="paycheckForm"', 'id="otHours"')],
      ['overtime-rate-is-asked-outright', insideForm('id="paycheckForm"', 'id="otRate"')],
      ['normal-rate-is-asked-outright', insideForm('id="paycheckForm"', 'id="regRate"')],
      ['bonus-is-asked-outright', insideForm('id="paycheckForm"', 'id="bonusAmount"')],
      ['retirement-is-asked-outright', insideForm('id="paycheckForm"', 'id="retirement401k"')],
      ['health-is-asked-outright', insideForm('id="paycheckForm"', 'id="cafeteria125"')],
      ['dependents-are-asked-outright', insideForm('id="paycheckForm"', 'id="depChildren"')],
      ['extra-is-asked-outright', insideForm('id="paycheckForm"', 'id="extraWithholding"')],
      ['post-tax-is-asked-outright', insideForm('id="paycheckForm"', 'id="postTax"')],

      // SAME PIN, NEW CONTROL (2026-08-01). This was 'pay-type-is-a-radio',
      // asserting contains('name="wageType"') back when the pay type was two
      // radios on a card of its own. It is now a three-option <select> on the
      // same card as the amount (yearly / monthly / hourly), so the promise the
      // pin keeps is unchanged and stated against what ships: the pay type is a
      // real named form control that is answerable before JavaScript runs, and
      // all three options are served. That is strictly more than the old pin
      // said, which was only that the name existed somewhere.
      ['pay-type-is-a-named-control', contains('name="wageType"')],
      ['pay-type-offers-yearly', contains('<option value="salary"')],
      ['pay-type-offers-monthly', contains('<option value="monthly"')],
      ['pay-type-offers-hourly', contains('<option value="hourly"')],
      ['frequency-is-a-radio', contains('name="payFrequency"')],
      ['filing-is-a-radio', contains('name="filingStatus"')],

      // HYDRATION PARITY FOR THE AMOUNT LABEL, and this pin is standing in for a
      // check build.js normally makes. app.js rewrites this label to follow the
      // select, and build.js's pre-render guard cannot see that write (it scans
      // for $('id').textContent writes, and this one is addressed by attribute
      // because statePanel() has no entry for it and build.js was out of scope
      // for the pass that added it). The served text must therefore be exactly
      // what app.js's first render writes for the shipped default, which is the
      // SALARY wording — or the label visibly changes on hydration. If this pin
      // fails, app.js's AMOUNT_LABEL.salary and this template have drifted.
      ['amount-label-matches-the-shipped-default',
        contains('data-otw-slot="amountLabel">How much is that a year, before anything comes out?</label>')],

      // The five deduction questions still ship, and still ship their money
      // field inside a wrapper that is VISIBLE in the HTML. answeredYes() treats
      // a MISSING qX group as "yes", so deleting one silently switches it on.
      ['retirement-question-ships', contains('name="qRetire"')],
      ['health-question-ships', contains('name="qHealth"')],
      ['dependents-question-ships', contains('name="qDeps"')],
      ['extra-question-ships', contains('name="qExtra"')],
      ['post-tax-question-ships', contains('name="qPost"')],

      // The four rule checks are asked in the flow AND still ship as the chips
      // state-flow.js pairs them with.
      ['tips-check-is-a-card', contains('name="qTips"')],
      ['overtime-check-is-a-card', contains('name="qOt"')],
      ['bonus-check-is-a-card', contains('name="qBonus"')],
      ['age-check-is-a-card', contains('name="qAge"')],
      ['rule-chips-still-ship', contains('id="h-tips"')],
      // NEW PIN (2026-08-02), strictly stronger than the one above it.
      // state-flow.js now hides this fieldset once the flow has been walked to
      // the answer with all four rule questions answered No, so that the answer
      // card stops re-asking four questions the visitor just answered. That is
      // hide-on-demand and it must stay that way: the fieldset has to SHIP, with
      // no hidden attribute and no inline style, so a crawler and a reader with
      // no JavaScript get the whole panel. If this fails, the hide moved from
      // the script into the build.
      ['rule-chip-fieldset-ships-visible', contains('<fieldset class="applies-chips">')],

      // The answer, and its order. The band leads the result card; the rule
      // pointers follow the computed table, not the other way round.
      ['answer-band-leads-the-result', before('class="answer-band"', 'data-tb-result')],
      ['rules-follow-the-result', before('data-tb-result', 'id="appliesLines"')],
      // SAME PIN, NEW STEP NUMBER (2026-08-01). The first two cards were merged
      // into one ("how are you paid" and the amount together), so every card
      // after it shifted down by one and the answer card is data-step="13" where
      // it was data-step="14". Identical promise: the rule pointers are ON the
      // answer card, not adrift somewhere below it.
      ['rules-are-on-the-answer-card', before('data-step="13"', 'id="appliesLines"')],
      ['deep-link-follows-the-rules', before('id="appliesLines"', 'id="appliesDeep"')],

      // The computed filing-time block: SHIPPED and SERVED EMPTY, both halves
      // asserted by the one string. Empty is the correct served state — all four
      // rule questions ship answered No, so app.js's first render writes the same
      // empty string and hydration changes nothing — and it is the substitute for
      // the build.js pre-render entry this element has no way to have. It sits
      // ABOVE the pointer lines, so the figures and the deep link that explains
      // them are read in that order.
      ['filing-block-ships-empty', contains('<div data-otw-slot="filing"></div>')],
      ['filing-block-precedes-the-rules', before('data-otw-slot="filing"', 'id="appliesLines"')],
      ['filing-block-follows-the-result', before('data-tb-result', 'data-otw-slot="filing"')],

      // The one deep link per computed rule, still server-rendered and still
      // visible: the computed block ADDS to these lines, it never replaces them,
      // and a crawler or a no-JS reader gets nothing but these.
      ['tips-pointer-link-kept', contains('/tips-tax-calculator/')],
      ['overtime-pointer-link-kept', contains('/overtime-tax-calculator/')],
      ['senior-pointer-link-kept', contains('/senior-deduction-calculator/')],
      ['bonus-pointer-link-kept', contains('-bonus-tax-calculator/')],
      ['what-applies-deep-link-kept', contains('/what-applies-to-me/?state=')],

      // The report/copy anchor. It has silently vanished site-wide once before.
      ['result-anchor-kept', contains('data-tb-result')],

      // Outside the cards, both of them, or the announcement is display:none on
      // every step but one and the running figure is stranded on one card.
      ['status-line-is-outside-the-cards', after('</form>', 'id="outStatus"')],
      ['running-echo-is-outside-the-cards', after('</form>', 'id="advEcho"')],

      // The wizard shipped, and the old shapes did not come back.
      ['no-mode-toggle', absent('name="mode"')],
      ['no-question-flow-script', absent(QUESTION_FLOW)],
      // SAME PIN, NEW COUNT (2026-08-01). This was 'fifteen-cards' at 15. The
      // amount card and the pay-type card became one, so the flow is fourteen
      // cards: thirteen questions and the answer. Same promise, same strictness
      // — an exact count is what catches a card silently DROPPED from the stack
      // rather than hidden by CSS, which every other pin here would pass.
      ['fourteen-cards', count('data-step="', 14)],
    ],
  })),
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
