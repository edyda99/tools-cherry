// bonus-tax-wizard.js — the card-by-card flow on /bonus-tax-calculator/ AND on
// the 51 /{state}-bonus-tax-calculator/ pages. Shows what a bonus loses on
// payday (the flat 22% federal prepayment + the state's supplemental rate +
// FICA) beside what it really costs once the year is added up, and the refund or
// the amount still owed. All logic client-side; nothing uploaded.
//
// FIFTY-TWO URLS, ONE FILE. src/templates/bonus-tax-calculator.html (the hub,
// with a state picker) and src/templates/bonus-tax-calculator-state.html (the 51
// state pages, state fixed by window.__BONUS_STATE__) ship the SAME cards minus
// that one question, so their data-step numbers do not line up: the hub numbers
// bonus/state/income/filing/paytype/method/earlier/result 0..7 and a state page
// numbers the same list without `state` 0..6. Hard-coding either set would
// silently mis-drive the other, so the step numbers are read from each card's
// data-card key at load (STEP below) and every card, chip and flag is declared
// only if its key is actually on the page. Add a card to one template and the
// other keeps working; add it to both and it works on both.
//
// This file drives the FULL pages only. The /embed/ build keeps its
// single-column #bonusForm and is still served by bonus-tax-calculator.js,
// because a third party sizes that iframe once and a flow whose height changes
// per card would clip inside it. The two must stay independent, so nothing here
// reads or writes an id through anything but its own page's DOM.
//
// THE MATH is one engine call into the unchanged /assets/bonus-tax.js. It
// returns both columns — `withheld` (what the employer sends in now) and
// `trueLiability` (the bonus at the visitor's real marginal rate, from the
// graduated brackets, not a flat guess) — plus `delta`, the income-tax-only gap
// between them. FICA is identical in both columns on purpose: it is a real tax
// on the bonus, not a prepayment, and it is the one part that never comes back.
import { computeBonus } from '/assets/bonus-tax.js';
import { mountWizard, $, moneyOf, radioOf, selectOf, usd, pct } from '/assets/wizard-core.js';

const DATA = window.__BONUS_TAX__ || {};
const taxData = DATA.taxData || { federal: {}, states: {} };
const suppData = DATA.supp || { federal: {}, states: {} };
// Set on the 51 state pages, null on the hub. It is also what decides whether a
// state card exists at all, so it is read once and trusted everywhere below.
const FIXED_STATE = window.__BONUS_STATE__ || null;

const STAGE = 'bonusWizard';
const FILING_WORDS = {
  single: 'on my own',
  married: 'married, filing together',
  head_of_household: 'head of household'
};

// ---- Which cards this page actually ships -----------------------------------
// A module script is deferred by default, so the document is parsed by the time
// this runs and the DOM can be read here rather than on DOMContentLoaded. Keys
// come from data-card; a card with no key (or an unknown one) is still declared
// with a bare { step } so it can never become the one card the flow refuses to
// show — a declared-but-featureless card is a visible question, an undeclared
// one is an invisible one.
const STEP = {};
function cardEls() {
  const stage = document.getElementById(STAGE);
  return stage ? [...stage.querySelectorAll('.otw-card')] : [];
}
const has = (key) => STEP[key] !== undefined;

// ---- Reading the cards ------------------------------------------------------
// Every read is null-guarded by the shared helpers: the same function has to
// survive a page that ships no state select and a page that ships no California
// card, and a throw here takes the whole calculator down.
function read() {
  return {
    bonus: moneyOf('bonus'),
    state: FIXED_STATE || selectOf('state'),
    regIncome: moneyOf('regIncome'),
    filing: radioOf('filingStatus', 'single'),
    paymentType: radioOf('paymentType', 'bonus'),
    method: radioOf('method', 'flat'),
    ytdSupp: moneyOf('ytdSupp')
  };
}

const suppOf = (slug) => (suppData.states ? suppData.states[slug] : null) || null;
const stateNameOf = (slug) => { const s = suppOf(slug); return s && s.name ? s.name : ''; };
const isCalifornia = (s) => s.state === 'california';

function compute(s) {
  if (!suppOf(s.state)) return null;   // no state chosen yet: there is no answer
  return computeBonus(
    {
      bonus: s.bonus,
      regIncome: s.regIncome,
      filingStatus: s.filing,
      stateSlug: s.state,
      ytdSupp: s.ytdSupp,
      method: s.method,
      paymentType: s.paymentType
    },
    taxData,
    suppData
  );
}

// ---- The one cross-check these answers allow --------------------------------
// "Added onto a regular paycheck" and "no regular pay at all" cannot both be
// true: there is no paycheck to add it to. It is the only pair of inputs on this
// page that can contradict each other — a bonus larger than the yearly salary is
// perfectly possible (signing bonuses, equity), and earlier bonuses larger than
// the salary are exactly the case the $1,000,000 rule exists for, so neither is
// flagged. Never blocking: the answer still computes underneath, the doubt just
// travels with it, and it travels to BOTH places — the card that asks for the
// second of the two (the method card, which comes after the pay card) and the
// answer, because a visitor who presses Next may never come back to the card.
function methodWarning(s) {
  if (s.method !== 'aggregate') return '';
  if (s.bonus <= 0 || s.regIncome > 0) return '';
  return `Check these numbers: you said this ${usd(s.bonus)} bonus was added onto a regular paycheck, but you entered ` +
    `$0 as the pay you earn in a year apart from it. If the bonus arrived on its own, pick the first answer; ` +
    `if you do have regular pay, go back a card and enter it.`;
}

// ---- The state picker (hub only) --------------------------------------------
// Filled before wizard-core snapshots the defaults, so Start over restores the
// option the page shipped with rather than whichever state was chosen since.
// California is pre-selected because it was the old form's default and it is the
// state most of this page's visitors arrive from; it is also why an untouched
// state counts as one of OUR example figures below.
function fillStates() {
  const sel = $('state');
  if (!sel || !suppData.states) return;
  Object.entries(suppData.states)
    .map(([slug, s]) => ({ slug, name: (s && s.name) || slug }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ slug, name }) => {
      const o = document.createElement('option');
      o.value = slug; o.textContent = name;
      sel.appendChild(o);
    });
  if (suppData.states.california) sel.value = 'california';
}

// ---- Prior-year figures ------------------------------------------------------
// A state whose brackets are still last year's has to say so wherever those
// figures are shown. The 51 state pages get this server-rendered by
// figureYearBanner() in build.js and sitting outside the answer, so this returns
// '' there and rebuilds the same notice only for the hub, from the same two
// fields the server reads: the state's figureYear against the data's taxYear. No
// slug list on either side, so a state stops being labelled the moment its
// current tables land and starts being labelled the moment it falls behind.
function figureYearNote(slug, stateName) {
  if (FIXED_STATE) return '';
  const st = taxData.states && taxData.states[slug];
  const fy = st && Number(st.figureYear);
  const yr = Number(taxData.taxYear);
  if (!fy || !yr || fy === yr) return '';
  return `<p class="year-fallback" role="note"><strong>${fy} rates (${yr} pending).</strong> ` +
    `These use ${stateName}'s official ${fy} state tax figures. ` +
    `${fy < yr ? `The state has not published ${yr} brackets yet` : `Figures are from ${fy}`}, ` +
    `and we update this once it does.</p>`;
}

// ---- What this state does to a bonus ----------------------------------------
// Hub only: the visitor chose a state one card ago, so wizard-core opens this
// helper the first time each state renders and leaves it alone after that. The
// state pages ship no #otwStateNote and no #state, so renderStateNote bails on
// its own there — the whole page is that state's answer already.
function methodLabel(m) {
  if (m === 'none') return 'takes no state income tax at all';
  if (m === 'regular') return 'has no separate bonus rate, so it holds back as if the bonus were ordinary wages';
  if (m === 'special') return 'uses a formula of its own';
  return 'holds back its own flat rate on a bonus';
}
// "A formula of its own" on its own tells a reader nothing, so the three states
// that have one say which. Keyed on the data's `special` field, never on a slug,
// so a fourth one starts explaining itself the day it is added.
function methodDetail(supp) {
  if (!supp) return '';
  if (supp.method === 'flat' && supp.rate) return ` (${pct(supp.rate)})`;
  if (supp.special === 'ca_dual') return ' — 10.23% on bonuses and stock options, 6.6% on every other kind of extra pay';
  if (supp.special === 'pct_of_federal') return ' — 30% of the federal amount held back, not of the bonus';
  if (supp.special === 'wi_banded') return ' — a graduated rate set by your yearly pay';
  return '';
}
function stateParts(slug) {
  const supp = suppOf(slug);
  if (!supp) return null;
  const name = supp.name || slug;
  const head = supp.method === 'none'
    ? `What ${name} takes from a bonus: nothing`
    : `What ${name} takes from a bonus`;
  const body = supp.method === 'none'
    ? `<strong>${name}</strong> has no state income tax, so only the federal prepayment and Social Security and Medicare come out of a bonus here.`
    : `<strong>${name}</strong> ${methodLabel(supp.method)}${methodDetail(supp)}.`;
  return {
    summary: head,
    body: body + (supp.note ? `<p class="otw-note">${supp.note}</p>` : '')
  };
}

// ---- The answer -------------------------------------------------------------
function renderResult({ state: s, result: r }) {
  const warning = methodWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';
  const kick = `<p class="otw-kick">Once your taxes are settled for the year</p>`;

  const supp = suppOf(s.state);
  if (!supp) {
    return warnBox + kick + `<p class="otw-big otw-zero">$0</p>` +
      `<div class="otw-plain">Choose the state your employer takes tax out for, and this fills in.</div>`;
  }
  const stateName = supp.name || s.state;
  const fyNote = figureYearNote(s.state, stateName);

  if (!r || r.bonus <= 0) {
    // The zero case names the RIGHT reason: the bonus is the only figure that
    // can be missing here, so say that and nothing else. No lead sentence,
    // because there are no rows for it to introduce.
    return warnBox + kick + `<p class="otw-big otw-zero">$0</p>` + fyNote +
      `<div class="otw-plain">Enter your bonus at the top and this fills in: what is held back on payday in ` +
      `${stateName}, and what the bonus really costs once the year is added up.</div>`;
  }

  const w = r.withheld, t = r.trueLiability;

  // ---- The story --------------------------------------------------------
  // ROUNDED ONCE, THEN DERIVED. The labels invite the reader to take the three
  // tax rows off the top row and land on "lands in your account", so those four
  // numbers have to agree exactly. Rounding each of them on its own does not
  // guarantee that; the total held back is therefore the SUM of the three
  // already-rounded parts and what lands is the bonus MINUS that sum. The same
  // discipline carries into the refund/owe row: it is the difference between the
  // rounded withheld income tax and the rounded true income tax, so "lands now +
  // refund" always equals the headline to the dollar.
  const bonusR = Math.round(r.bonus);
  const fedR = Math.round(w.federal);
  const stateR = Math.round(w.state);
  const ficaR = Math.round(w.fica);
  const heldR = fedR + stateR + ficaR;
  const nowR = bonusR - heldR;

  const tFedR = Math.round(t.federal);
  const tStateR = Math.round(t.state);
  const trueTotalR = tFedR + tStateR + ficaR;
  const keepFinalR = bonusR - trueTotalR;
  const deltaR = (fedR + stateR) - (tFedR + tStateR);   // + refund, − still owed

  const noStateTax = supp.method === 'none';

  // Does the $1,000,000 rule bite? Asked of the WITHHOLDING MECHANISM, never of
  // "is this a big bonus": the flat 22/37 split exists only on the flat method,
  // and a bonus added onto a paycheck runs through the graduated tables instead,
  // where there is no $1,000,000 step to announce.
  const fedSupp = suppData.federal || {};
  const thr = Number(fedSupp.highThreshold) || 0;
  const roomAt22 = Math.max(0, thr - s.ytdSupp);
  const at37 = s.method === 'flat' && thr > 0 ? Math.max(0, r.bonus - roomAt22) : 0;

  const fedLabel = at37 > 0
    ? 'Federal income tax held back (22%, then 37% over the yearly line)'
    : (s.method === 'aggregate'
      ? 'Federal income tax held back (taxed as part of the paycheck)'
      : 'Federal income tax held back (a flat 22%)');

  const lead = `<p class="otw-lead">Here is what happens to your ${usd(bonusR)} bonus in ${stateName}:</p>`;
  const rows =
    `<ul class="otw-story">` +
    `<li><span>Your bonus, before anything comes off</span><span class="otw-amt">${usd(bonusR)}</span></li>` +
    `<li><span>${fedLabel}</span><span class="otw-amt otw-taxed">${usd(fedR)}</span></li>` +
    `<li><span>${stateName} ${noStateTax ? 'state tax — it has none' : 'tax held back'}</span>` +
      `<span class="otw-amt otw-taxed">${usd(stateR)}</span></li>` +
    `<li><span>Social Security and Medicare</span><span class="otw-amt otw-taxed">${usd(ficaR)}</span></li>` +
    `<li><span>Lands in your account on payday</span><span class="otw-amt">${usd(nowR)}</span></li>` +
    // Not part of the split above, so it carries the heavier rule that stops a
    // reader adding it in: the rows above are the bonus itself being divided up,
    // this one is what happens months later when the year is added up.
    (deltaR > 0
      ? `<li class="otw-after"><span>Comes back as a refund when you file</span><span class="otw-amt otw-free">${usd(deltaR)}</span></li>`
      : deltaR < 0
        ? `<li class="otw-after"><span>Still owed on this bonus at tax time</span><span class="otw-amt otw-taxed">${usd(-deltaR)}</span></li>`
        : '') +
    `</ul>`;

  // ---- The limits, each naming BOTH numbers -------------------------------
  // The bonus and the part of it taken at 37% stop being the same number the
  // moment the yearly line is crossed, and a sentence naming only one of them is
  // how a screen ends up reading "37%" over a bonus that was mostly held back at
  // 22%. Same for the Social Security wage base, which is why a large earner's
  // FICA row looks too small.
  let limitFlag = '';
  if (at37 > 0) {
    limitFlag = s.ytdSupp > 0
      ? `<p class="otw-flag">Heads up: the ${usd(s.ytdSupp)} of bonuses you have already been paid plus this ` +
        `${usd(r.bonus)} one take your year past ${usd(thr)}, so ${usd(at37)} of this bonus is held back at 37% ` +
        `rather than 22%. Only the part above ${usd(thr)} takes the higher rate, and it is still a prepayment, not your final tax.</p>`
      : `<p class="otw-flag">Heads up: this ${usd(r.bonus)} bonus is over the ${usd(thr)} a year at which the federal ` +
        `rate changes, so ${usd(at37)} of it is held back at 37% and the first ${usd(thr)} at 22%. It is still a ` +
        `prepayment, not your final tax.</p>`;
  }

  const ss = taxData.federal && taxData.federal.fica && taxData.federal.fica.socialSecurity;
  const wageBase = ss ? Number(ss.wageBase) : 0;
  let ssNote = '';
  if (wageBase > 0 && s.regIncome >= wageBase) {
    ssNote = `<p class="otw-note">Your ${usd(s.regIncome)} of regular pay has already passed the ${usd(wageBase)} ` +
      `Social Security wage base for the year, so no Social Security comes out of this bonus — only Medicare does.</p>`;
  } else if (wageBase > 0 && s.regIncome > 0 && s.regIncome + r.bonus > wageBase) {
    ssNote = `<p class="otw-note">Only ${usd(wageBase - s.regIncome)} of this bonus still carries Social Security: the ` +
      `rest sits above the ${usd(wageBase)} wage base for the year, where only Medicare applies.</p>`;
  }

  // ---- What this actually is ----------------------------------------------
  // NOT a filing-time deduction, so this box does not carry the deduction
  // family's "it arrives as a bigger refund, FICA is still owed, your paycheck
  // does not change" note — that would be three sentences about a different kind
  // of tool. What a visitor to THIS page leaves believing without it is that a
  // bonus is taxed at a punitive rate, so the box says the opposite in plain
  // words, names the part that really is gone for good, and says when the rest
  // settles.
  const settleSentence = deltaR > 0
    ? `About ${usd(deltaR)} more was held back than the income tax this bonus really costs, so that much comes back as a ` +
      `bigger refund (or a smaller bill) when you file.`
    : deltaR < 0
      ? `What was held back is about ${usd(-deltaR)} short of the income tax this bonus really costs, so put that much ` +
        `aside for tax time.`
      : `What was held back is almost exactly the income tax this bonus really costs, so there is little to come back and little to pay.`;
  const plain = `<div class="otw-plain">There is no special bonus tax rate. The ${pct(w.pctOfBonus)} that vanished on ` +
    `payday is <strong>withholding</strong>, a prepayment: a bonus is ordinary income, taxed at your normal rate once ` +
    `the whole year runs through the brackets. ${settleSentence} The ${usd(ficaR)} of Social Security and Medicare is ` +
    `not a prepayment — it is a real tax on the bonus and it does not come back.</div>`;

  // The at-tax-time half, folded. wizard-core carries a <details>' open state
  // across re-renders, so a visitor who opens this keeps it open while they type.
  const costFold =
    `<details class="otw-help" id="otwCostNote">` +
    `<summary>What this bonus really costs once the year is added up</summary>` +
    `<ul class="otw-story">` +
    `<li><span>Federal income tax on the bonus</span><span class="otw-amt otw-taxed">${usd(tFedR)}</span></li>` +
    (noStateTax ? '' : `<li><span>${stateName} income tax on the bonus</span><span class="otw-amt otw-taxed">${usd(tStateR)}</span></li>`) +
    `<li><span>Social Security and Medicare — the same figure, a real tax</span><span class="otw-amt otw-taxed">${usd(ficaR)}</span></li>` +
    `<li><span>What the bonus really costs</span><span class="otw-amt otw-taxed">${usd(trueTotalR)}</span></li>` +
    `<li class="otw-after"><span>Yours in the end</span><span class="otw-amt otw-free">${usd(keepFinalR)}</span></li>` +
    `</ul>` +
    `<p class="otw-note">${stateName} ${methodLabel(supp.method)}${methodDetail(supp)}. ` +
    `Estimate only, not tax advice.</p>` +
    `</details>`;

  return warnBox + kick +
    `<p class="otw-big${keepFinalR > 0 ? '' : ' otw-zero'}">${usd(keepFinalR)}</p>` +
    fyNote + lead + rows + limitFlag + ssNote + plain + costFold;
}

// ---- The flow ---------------------------------------------------------------
// Built from the DOM so the hub and the 51 state pages can number their cards
// independently. A key that is not on this page contributes no card, no chip and
// no flag, which is what makes the state question exist on one template and not
// on the other without a second copy of this file.
const CARD_SPECS = {
  bonus: () => ({ fields: ['bonus'] }),
  state: () => ({ fields: ['state'] }),
  income: () => ({ fields: ['regIncome'] }),
  filing: () => ({ radios: 'filingStatus' }),
  // Off the path unless the chosen state is California — the only state that
  // holds back two supplemental rates. Off the path, never out of the document:
  // the card still ships visible in the no-JS stack.
  paytype: () => ({ radios: 'paymentType', when: isCalifornia }),
  method: () => ({ radios: 'method', flags: [{ id: 'otwMethodFlag', text: methodWarning }] }),
  earlier: () => ({ fields: ['ytdSupp'], skipClears: ['ytdSupp'] }),
  result: () => ({ result: true })
};

function buildCards() {
  const out = [];
  for (const el of cardEls()) {
    const step = Number(el.dataset.step);
    if (!Number.isFinite(step)) continue;
    const key = el.dataset.card || '';
    if (key) STEP[key] = step;
    const make = CARD_SPECS[key];
    out.push(Object.assign({ step }, make ? make() : {}));
  }
  return out;
}

const cards = buildCards();

function chips(s) {
  const out = [];
  const add = (key, label, field) => { if (has(key)) out.push({ step: STEP[key], label, field }); };
  add('bonus', `${usd(s.bonus)} bonus`);
  add('state', stateNameOf(s.state) || 'no state chosen');
  add('income', `${usd(s.regIncome)}/yr`);
  add('filing', FILING_WORDS[s.filing] || s.filing);
  if (isCalifornia(s)) add('paytype', s.paymentType === 'other' ? 'other extra pay' : 'bonus or stock');
  add('method', s.method === 'aggregate' ? 'paid on a paycheck' : 'paid on its own');
  if (s.ytdSupp > 0) add('earlier', `${usd(s.ytdSupp)} earlier bonuses`, 'ytdSupp');
  return out;
}

mountWizard({
  stage: STAGE,
  read,
  compute,
  renderResult,
  cards,

  // The state helper exists on the hub only. On a state page there is no
  // #otwStateNote and no #state, and wizard-core's renderStateNote returns
  // without touching anything when either is missing.
  stateNote: { box: 'otwStateNote', select: 'state', render: stateParts },

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until EVERY figure it is built from is the visitor's own — not until
  // the first edit, which presented an answer still made of our invented salary
  // as theirs. $10,000 on $70,000 a year is ordinary enough to be somebody's real
  // bonus. On the hub the state is listed too, because California is our guess
  // and it changes the amount held back more than either money figure does;
  // filing status and how the bonus was paid are not, because both have a
  // default that is true for most visitors and neither invents a figure.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('bonus')) missing.push('your bonus');
    if (!touched.has('regIncome')) missing.push('your yearly pay');
    if (has('state') && !touched.has('state')) missing.push('your state');
    return missing;
  },

  chips,

  announce: (s, r) => {
    if (!r || r.bonus <= 0) return '';
    const w = r.withheld, t = r.trueLiability;
    const fedR = Math.round(w.federal), stateR = Math.round(w.state), ficaR = Math.round(w.fica);
    const heldR = fedR + stateR + ficaR;
    const keepFinalR = Math.round(r.bonus) - (Math.round(t.federal) + Math.round(t.state) + ficaR);
    const deltaR = (fedR + stateR) - (Math.round(t.federal) + Math.round(t.state));
    const settle = deltaR > 0
      ? ` About ${usd(deltaR)} of that comes back when you file.`
      : deltaR < 0
        ? ` You will owe about ${usd(-deltaR)} more on it at tax time.`
        : '';
    return `You keep about ${usd(keepFinalR)} of your ${usd(r.bonus)} bonus. ${usd(heldR)} is held back on payday.${settle}` +
      (methodWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  },

  // Before the snapshot so Start over restores the state this page shipped with,
  // not whichever one was chosen since. A no-op on the 51 state pages.
  onBeforeSnapshot: fillStates
});
