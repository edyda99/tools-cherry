// 1099-vs-w2-calculator.js — the card-by-card flow on /1099-vs-w2-calculator/.
// Compares estimated take-home pay from a W-2 salary against a 1099 contract at
// the same filing status. Federal income tax plus FICA or self-employment tax
// only — NO state tax. An ESTIMATE. All client-side; nothing uploaded.
//
// REWRITTEN IN PLACE, 2026-08-01, onto wizard-core.js. This tool has no /embed/
// twin, so there is no second build of the old single-column form to keep
// working and no second asset: this file replaces the old one outright.
//
// WHAT MOVED. The answer used to be assembled from four blocks in three places:
// a headline panel inside the calculator, then — a full ad slot and a scroll
// later — two comparison cards, a benefits note and a summary box. All four are
// now one answer card that leads with which offer keeps more and then writes
// both sides out as rows that add up. Everything about "how a card flow behaves"
// (stepping, dots, focus, the flag debounce, the polite status line, the example
// label, Start over, data-js last) lives in the core; what is left here is only
// what makes this the 1099-vs-W-2 comparison.
//
// THE MATH IS THE ENGINE'S, UNCHANGED. compare() is called once per render.
// Every rate and threshold this file quotes back is DERIVED from that same
// engine at load (see FICA_SLOPE / SE_SLOPE / SS_BASE below) rather than written
// down a second time, because a copied constant is a second place to update
// every autumn and it is the one that gets forgotten.
import { compare, w2Estimate, se1099Estimate, TAX_YEAR } from '/assets/employment-tax.js';
import { mountWizard, $, moneyOf, radioOf, usd } from '/assets/wizard-core.js';

// data-step on each card. RESULT is the last card and is never skipped.
const W2 = 0, NET = 1, STATUS = 2, RESULT = 3;

const STATUS_WORDS = { single: 'on my own', married: 'married, filing together' };

// ---- Numbers taken back out of the engine -----------------------------------
// Everything below re-reads a figure the engine already knows rather than
// restating it. derive() exists so that a future engine change can only ever
// cost us a sentence, never the whole calculator: anything that does not come
// back finite falls through to a value that switches that sentence off.
function derive(fn, fallback) {
  try {
    const v = fn();
    return Number.isFinite(v) ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

// Payroll tax per dollar at a pay level well below any cap: 7.65% for an
// employee, 15.3%-of-92.35% for a contractor. Used only to notice that a cap
// HAS bitten (the tax came in under the straight-line figure), never to compute
// tax — the engine does that.
const FICA_SLOPE = derive(() => w2Estimate(10000).fica / 10000, 0);
const SE_SLOPE = derive(() => se1099Estimate(10000).seTax / 10000, 0);

// The Social Security wage base, re-derived from the engine. FICA as a function
// of pay is two straight lines with a kink at the base: below it the Social
// Security and Medicare shares are both charged, above it only Medicare. Take a
// slope from each side of the kink and intersect the two lines. The guard is
// what keeps a future engine change from printing a nonsense limit at a
// visitor: a result that is not a plausible, round wage base is treated as
// unknown, and the one sentence that names it is then simply not written.
const SS_BASE = derive(() => {
  const high = 10000000;
  const step = 10000;
  const slopeAbove = (w2Estimate(high).fica - w2Estimate(high - step).fica) / step;
  if (!(FICA_SLOPE > slopeAbove)) return 0;
  const base = (w2Estimate(high).fica - slopeAbove * high) / (FICA_SLOPE - slopeAbove);
  const rounded = Math.round(base / 100) * 100;
  return rounded > 50000 && rounded < 1000000 && Math.abs(base - rounded) < 5 ? rounded : 0;
}, 0);

// ---- Reading the cards ------------------------------------------------------
function read() {
  return {
    w2Gross: moneyOf('w2Gross'),
    contractNet: moneyOf('contractNet'),
    status: radioOf('status', 'single')
  };
}

const compute = (s) => compare(s.w2Gross, s.contractNet, s.status === 'married' ? 'married' : 'single');

// ---- The break-even contract -------------------------------------------------
// The question the page's own FAQ promises an answer to ("find the contract
// amount where take-home pay comes out even") and the one the old summary box
// only ever told the visitor to go and find by hand.
//
// Solved by bisection against the engine rather than by inverting it here.
// se1099Estimate is monotonic in net earnings — every extra dollar leaves
// something after tax — but it is piecewise: the Social Security base and every
// bracket edge puts a kink in it, so a closed-form inverse means copying the
// engine's constants into this file, which is exactly what the rest of it
// avoids. The residual check at the end is the honesty gate: if the search did
// not actually land on the target, this returns 0 and the sentence built from it
// is not written at all.
function breakEvenContract(targetTakeHome, status) {
  if (!Number.isFinite(targetTakeHome) || targetTakeHome <= 0) return 0;
  let lo = 0;
  let hi = Math.max(1000, targetTakeHome * 2);
  for (let i = 0; i < 40 && se1099Estimate(hi, status).takeHome < targetTakeHome; i++) hi *= 2;
  if (se1099Estimate(hi, status).takeHome < targetTakeHome) return 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (se1099Estimate(mid, status).takeHome < targetTakeHome) lo = mid;
    else hi = mid;
  }
  const guess = (lo + hi) / 2;
  const landed = se1099Estimate(guess, status).takeHome;
  return Number.isFinite(landed) && Math.abs(landed - targetTakeHome) < 1 ? guess : 0;
}

// ---- The figures the answer card is built from -------------------------------
// ROUNDED ONCE, IN ONE PLACE. The labels invite the reader to take the two
// taxes off the top row and land on "what you keep", and then to subtract one
// side's keep from the other and land on the headline — so all of that has to
// come out exactly. Each side's take-home is therefore DERIVED by subtraction
// from the already-rounded figures above it, and the headline gap is derived
// from those two derived numbers, rather than each being rounded on its own.
// Three independent Math.round()s do not add up, and on this page a reader who
// checks the arithmetic and finds it a dollar out has every reason to stop
// trusting the rest.
function figures(s, r) {
  const ready = s.w2Gross > 0 && s.contractNet > 0
    && Number.isFinite(r.w2.takeHome) && Number.isFinite(r.se.takeHome);
  const w2Gross = Math.round(Math.max(0, r.w2.gross || 0));
  const fica = Math.round(Math.max(0, r.w2.fica || 0));
  const w2Fed = Math.round(Math.max(0, r.w2.federalTax || 0));
  const w2Keep = w2Gross - fica - w2Fed;
  const net = Math.round(Math.max(0, r.se.net || 0));
  const seTax = Math.round(Math.max(0, r.se.seTax || 0));
  const seFed = Math.round(Math.max(0, r.se.federalTax || 0));
  const seKeep = net - seTax - seFed;
  return { ready, w2Gross, fica, w2Fed, w2Keep, net, seTax, seFed, seKeep, gap: w2Keep - seKeep };
}

const winnerWord = (gap) => (gap > 0 ? 'employee' : 'contract');

// ---- The one limit on this page, named with BOTH numbers ---------------------
// Social Security stops at the wage base. Above it the payroll rows stop being a
// flat percentage of the whole amount, so a reader checking 7.65% or 15.3% by
// hand gets a different figure from the one on screen, and the row looks wrong
// rather than capped. The sentence names the limit AND the pay it is being
// measured against, and it is decided from the tax the engine actually charged
// (it came in under the straight line) rather than from a threshold restated
// here.
function wageBaseNote(s, r) {
  if (!(SS_BASE > 0)) return '';
  const ficaCapped = s.w2Gross > 0 && FICA_SLOPE > 0 && r.w2.fica < FICA_SLOPE * s.w2Gross - 0.5;
  const seCapped = s.contractNet > 0 && SE_SLOPE > 0 && r.se.seTax < SE_SLOPE * s.contractNet - 0.5;
  if (!ficaCapped && !seCapped) return '';
  let over;
  if (ficaCapped && seCapped) over = `both the ${usd(s.w2Gross)} salary and the ${usd(s.contractNet)} contract are`;
  else if (ficaCapped) over = `the ${usd(s.w2Gross)} salary is`;
  else over = `the ${usd(s.contractNet)} contract is`;
  return `<p class="otw-flag">Heads up: Social Security is only charged on the first ${usd(SS_BASE)} you earn in a ` +
    `year, and ${over} over that line. Everything above it is charged the Medicare share alone, which is why the ` +
    `payroll rows below are less than a flat percentage of the whole amount.</p>`;
}

// ---- The answer -------------------------------------------------------------
function missingNote(s) {
  if (!(s.w2Gross > 0) && !(s.contractNet > 0)) {
    return 'Fill in the yearly salary and the contract amount to compare the two offers.';
  }
  if (!(s.w2Gross > 0)) return 'Fill in the yearly salary to compare it against the contract.';
  return 'Fill in the contract amount, after your business costs, to compare it against the salary.';
}

function renderResult({ state: s, result: r }) {
  const f = figures(s, r);

  if (!f.ready) {
    return `<p class="otw-kick">The difference between the two offers</p>` +
      `<p class="otw-big otw-zero">${usd(0)}</p>` +
      `<div class="otw-plain">${missingNote(s)}</div>`;
  }

  const kick = f.gap === 0
    ? 'The two offers come out the same, over a year'
    : `The ${winnerWord(f.gap)} job keeps more, over a year`;
  const head = `<p class="otw-kick">${kick}</p>` +
    `<p class="otw-big${f.gap === 0 ? ' otw-zero' : ''}">${usd(Math.abs(f.gap))}</p>`;

  const lead = `<p class="otw-lead">Here is where each offer goes over a year, at the same filing status:</p>`;

  // One list, not two: the heavier rule that .otw-after draws is what separates
  // the sides, and it is drawing it for its actual purpose — the row under it is
  // not part of the sum above it and must not be added in.
  const rows =
    `<ul class="otw-story">` +
    `<li><span>The salary</span><span class="otw-amt">${usd(f.w2Gross)}</span></li>` +
    `<li><span>Social Security and Medicare, your half</span><span class="otw-amt otw-taxed">${usd(f.fica)}</span></li>` +
    `<li><span>Federal income tax</span><span class="otw-amt otw-taxed">${usd(f.w2Fed)}</span></li>` +
    `<li><span>What you keep from the salary</span><span class="otw-amt otw-free">${usd(f.w2Keep)}</span></li>` +
    `<li class="otw-after"><span>The contract, after your business costs</span><span class="otw-amt">${usd(f.net)}</span></li>` +
    `<li><span>Self-employment tax, both halves</span><span class="otw-amt otw-taxed">${usd(f.seTax)}</span></li>` +
    `<li><span>Federal income tax</span><span class="otw-amt otw-taxed">${usd(f.seFed)}</span></li>` +
    `<li><span>What you keep from the contract</span><span class="otw-amt otw-free">${usd(f.seKeep)}</span></li>` +
    `<li class="otw-after"><span>${f.gap === 0 ? 'The difference between them' : `The difference, in the ${winnerWord(f.gap)} job's favour`}</span>` +
      `<span class="otw-amt">${usd(Math.abs(f.gap))}</span></li>` +
    `</ul>`;

  // This tool is not a filing-time deduction, so the plain box does not carry the
  // deduction family's FICA note — it would be answering a question nobody asked
  // here. It says what this answer actually is instead: a yearly, federal-only
  // comparison, the contract figure that would make the two even, and the two
  // things the contract side still has to pay for that the number above does not
  // price.
  const be = Math.round(breakEvenContract(r.w2.takeHome, s.status === 'married' ? 'married' : 'single') / 100) * 100;
  const evenLine = be > 0
    ? ` On tax alone, a contract of about ${usd(be)} a year would leave you with the same take-home as the ` +
      `${usd(f.w2Gross)} salary.`
    : '';
  const plain = `<div class="otw-plain">These are yearly figures and federal tax only — state or local income tax, ` +
    `if the place you live charges it, would take something off both sides.${evenLine} Tax is not the whole gap, ` +
    `though: the contract job also has to buy what the employer was providing, meaning health insurance, any ` +
    `retirement match and paid time off, and none of that is priced above. Nothing is withheld from contract work ` +
    `either, so you send that tax in yourself, four times a year.</div>`;

  return head + lead + wageBaseNote(s, r) + rows + plain;
}

// ---- The quick chips on the contract card -----------------------------------
// Priced off the salary on the card before, so they cannot be static values in
// the template: "25% more than the salary" is only a helpful guess once the
// salary exists. The core reads data-otw-value at click time, so rewriting the
// attribute on every render is all this needs. They are hidden rather than
// wrong when there is no salary yet to be a percentage of.
const UPLIFTS = [
  { mult: 1, word: 'The same as the salary' },
  { mult: 1.25, word: '25% more' },
  { mult: 1.4, word: '40% more' }
];

function paintUpliftChips(s) {
  const box = $('otwUpliftChips');
  if (!box) return;
  const buttons = box.querySelectorAll('button');
  buttons.forEach((btn, i) => {
    const u = UPLIFTS[i];
    if (!u) return;
    if (!(s.w2Gross > 0)) { btn.hidden = true; return; }
    const value = Math.round((s.w2Gross * u.mult) / 100) * 100;
    btn.hidden = false;
    btn.dataset.otwValue = String(value);
    btn.textContent = `${u.word} → ${value.toLocaleString('en-US')}`;
  });
}

// The dated-assumptions copy in the prose below carries a fallback year in the
// markup, so this only ever corrects it. Kept on the page, not in the card flow:
// two of the three [data-tax-year] spans are outside the wizard entirely.
function stampTaxYear() {
  document.querySelectorAll('[data-tax-year]').forEach((el) => { el.textContent = String(TAX_YEAR); });
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'w2Wizard',
  read,
  compute,
  renderResult,

  // No when() anywhere and no skipClears: all three answers feed the one
  // comparison and every one of them moves both sides of it, so there is no card
  // to route a visitor past and none they may usefully leave blank.
  //
  // NO FLAGS EITHER, and that is a finding rather than an omission: the two money
  // questions are two independent offers, so no pair of them is impossible. A
  // contract at half the salary or at triple it is a real thing to be comparing.
  // The page's one genuine trap — typing the headline contract figure without
  // taking business costs off it — is not detectable from the numbers at all
  // (the honest and the mistaken entry look identical), so it is carried by the
  // always-visible <summary> on the contract card instead of by a warning that
  // could only ever guess.
  cards: [
    { step: W2, fields: ['w2Gross'] },
    { step: NET, fields: ['contractNet'] },
    { step: STATUS, radios: 'status' },
    { step: RESULT, result: true }
  ],

  // Both money fields ship prefilled at $100,000, which is an ordinary enough
  // salary to be somebody's real offer, so the answer stays labelled an example
  // until BOTH are the visitor's own. Filing status is not listed: it has a real
  // default that is true for most visitors and it invents no figure.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('w2Gross')) missing.push('the salary');
    if (!touched.has('contractNet')) missing.push('the contract amount');
    return missing;
  },

  chips: (s) => [
    { step: W2, label: `${usd(s.w2Gross)} salary` },
    { step: NET, label: `${usd(s.contractNet)} contract` },
    { step: STATUS, label: STATUS_WORDS[s.status] || s.status }
  ],

  announce: (s, r) => {
    const f = figures(s, r);
    if (!f.ready) return missingNote(s);
    if (f.gap === 0) {
      return `The two offers come out the same: about ${usd(f.w2Keep)} a year either way, after federal income tax ` +
        `and payroll tax.`;
    }
    return `The ${winnerWord(f.gap)} job keeps ${usd(Math.abs(f.gap))} more a year: ${usd(f.w2Keep)} from the ` +
      `salary against ${usd(f.seKeep)} from the contract, after federal income tax and payroll tax.`;
  },

  onRender: ({ state }) => paintUpliftChips(state),

  // Before the snapshot rather than after: the year stamp rewrites page copy, and
  // doing it here means it has happened before the first render quotes anything.
  onBeforeSnapshot: stampTaxYear
});
