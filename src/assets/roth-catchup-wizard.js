// roth-catchup-wizard.js — the card-by-card flow on /roth-catchup-calculator/.
// Answers the SECURE 2.0 §603 question ("does the mandatory Roth catch-up rule
// hit me, what does it cost this year, and is that actually a loss?") one plain
// question at a time. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form (#rothForm, a plain #year select, a #planRoth checkbox) and is still
// served by roth-catchup-calculator.js; the two must stay independent, so
// nothing here reads or writes an id the embed also ships except through its own
// page's DOM.
//
// Everything about "how a card flow behaves" — stepping, dots, focus, the 350 ms
// flag debounce, the polite status line, the example label, Start over, data-js
// last — lives in wizard-core.js. What is left here is only what makes this the
// Roth catch-up calculator: the statute's own gate order expressed as when()
// predicates, one engine call, and the answer written out as a story.
//
// THE MATH is one engine call. estimateRothCatchUp() decides the three gates in
// statutory order, caps the catch-up at the band maximum for the year, prices
// the forgone deduction, and returns the Roth-vs-pre-tax future-value delta. No
// statutory number and no gate is re-derived here: every threshold, band and
// dollar maximum in the copy below is read back off the engine's own result or
// off the shipped parameters, so a data change moves the page with it.
import { estimateRothCatchUp } from '/assets/roth-catchup.js';
import { mountWizard, moneyOf, numOf, radioOf, selectOf, usd, count } from '/assets/wizard-core.js';

const RC = window.__ROTHCATCHUP__;

// data-step on each card. RESULT is the last card and is never skipped.
const YEAR = 0, AGE = 1, WAGES = 2, PLAN = 3, CATCHUP = 4, RATENOW = 5, FUTURE = 6, RESULT = 7;
const ASK_STEPS = [YEAR, AGE, WAGES, PLAN, CATCHUP, RATENOW, FUTURE];

// Whole-percent bracket labels. Deliberately NOT wizard-core's pct(), which
// keeps one decimal: every rate on this page comes from a <select> of whole
// percentages, so "24.0%" names a precision the visitor was never offered and
// reads as a computed figure rather than the band they picked.
const bp = (n) => Math.round(Math.max(0, n || 0) * 100) + '%';
// Signed, for the one figure on the page that can legitimately be negative.
const usdSigned = (n) => {
  const v = Math.round(n || 0);
  if (v === 0) return '$0';
  return (v < 0 ? '−$' : '+$') + Math.abs(v).toLocaleString('en-US');
};

// A <select> whose value may be the empty "I would rather not guess" option.
// Returns null rather than 0 for it: the engine treats a null retirement rate as
// "no long-run comparison asked for", and 0 would mean "I expect to pay no tax",
// which is a different and much louder claim.
function rateOf(id, fallback) {
  const v = parseFloat(selectOf(id));
  return Number.isFinite(v) ? v : fallback;
}

// ---- Reading the cards ------------------------------------------------------
function read() {
  return {
    year: parseInt(radioOf('year', '2026'), 10) || 2026,
    age: numOf('age'),
    wages: moneyOf('wages'),
    planRoth: radioOf('planRoth', 'yes') !== 'no',
    catchUp: moneyOf('catchUp'),
    rateNow: rateOf('rateNow', 0.24),
    rateRetire: rateOf('rateRetire', null),
    years: numOf('years'),
    growth: numOf('growth') / 100
  };
}

const compute = (s) => estimateRothCatchUp({
  taxYear: s.year,
  age: s.age,
  priorYearFicaWages: s.wages,
  planOffersRoth: s.planRoth,
  catchUpAmount: s.catchUp,
  currentMarginalRate: s.rateNow,
  retirementMarginalRate: s.rateRetire,
  yearsToRetirement: s.years,
  growthRate: s.growth,
  params: RC
});

// ---- The path ---------------------------------------------------------------
// The statute's gate order, and it is a real branch rather than a tidy-up: the
// moment one gate rules a visitor out, nothing asked after it can change the
// answer, so continuing to ask is asking for a number in order to ignore it.
// Every predicate reads the shipped parameters rather than a literal, so the
// flow follows a data change the same way the answer does.
const yearParams = (s) => (RC && RC.byYear && (RC.byYear[s.year] || RC.byYear[String(s.year)])) || null;
const enforcedYear = (s) => s.year >= (RC ? RC.firstEnforcedYear : 2026);
const oldEnough = (s) => s.age >= (RC ? RC.catchUpMinAge : 50);
// Strict "exceed", the same test the engine makes: exactly the threshold is not
// over the line.
const overTheLine = (s) => { const y = yearParams(s); return !!y && s.wages > y.threshold; };

const asksWages = (s) => oldEnough(s) && enforcedYear(s);
const asksPlan = (s) => asksWages(s) && overTheLine(s);
const canBite = (s) => asksPlan(s) && s.planRoth;

// ---- The one thing these answers can contradict -----------------------------
// Not "impossible" the way tips above your whole year's pay is, but the same
// shape: a figure the visitor typed that the law will not accept, checked
// against the limit rather than against "did anything come out". It lives on the
// catch-up card, which is where the number is typed, and it is rendered a second
// time above the answer because a visitor who presses Next may never come back
// to that card. Never blocking: the answer still computes underneath, on the
// capped figure, and says so.
function capWarning(s) {
  const r = compute(s);
  if (!r || !r.applies || r.effect !== 'must_be_roth') return '';
  if (r.maxCatchUp == null) return '';
  const enteredR = Math.round(r.catchUpAmount || 0);
  const maxR = Math.round(r.maxCatchUp);
  if (enteredR <= maxR) return '';
  // Derived by subtraction from the two already-rounded figures, so the three
  // numbers in the sentence reconcile.
  const overR = enteredR - maxR;
  return `Check this figure: you entered ${usd(enteredR)}, but the most anyone your age can add on top of the normal ` +
    `limit for ${s.year} is ${usd(maxR)}. The answer uses ${usd(maxR)}, and the other ${usd(overR)} cannot go into the ` +
    `plan as a catch-up at all.`;
}

// ---- Why the rule does not reach you, in plain words ------------------------
// One sentence per engine reason, and each names the numbers its own reason
// turns on — "you are not affected" over a filled-in form names the wrong
// problem if it does not say which of the three gates let the visitor out.
function reasonPlain(s, r) {
  const yr = usd(r.threshold != null ? r.threshold : 0);
  switch (r.reason) {
    case 'under_50_no_catchup':
      return `You will be ${count(s.age)} at the end of ${s.year}, and the extra amount this rule is about only becomes ` +
        `available at 50. There is nothing yet for it to change.`;
    case 'pending_irs_guidance':
      return `The IRS has not published the ${s.year} figures yet, so there is no ${s.year} answer to give. The yearly ` +
        `notice usually comes out in October.`;
    case 'no_prior_year_fica_wages':
      return `You told us the employer that runs your plan paid you nothing last year, so there is no wage figure to ` +
        `test. That is the normal position for a partner or a sole proprietor whose earnings are all self-employment ` +
        `income, and it means the rule does not reach you: your extra contribution can still come out of your pay ` +
        `before tax.`;
    case 'wages_at_or_below_threshold':
      return `The ${usd(r.wages)} that employer paid you last year does not go over the ${yr} line for ${s.year}, so ` +
        `you are not a high earner under this rule and your extra contribution can still come out of your pay before ` +
        `tax. The test is "more than", so exactly ${yr} is not over the line either.`;
    case 'plan_no_roth_cannot_catchup':
      return `Your ${usd(r.wages)} does go over the ${yr} line, so anything extra you added would have to go in after ` +
        `tax. But you told us your plan has no after-tax option, and a plan in that position is not made to add one — ` +
        `it is allowed to stop high earners adding anything extra at all instead. So your extra room is $0 until it ` +
        `does add one. Ask whoever runs the plan whether that is coming.`;
    default:
      if (r.reason && r.reason.indexOf('transition_relief') === 0) {
        return `For ${s.year} the rule was not enforced: the IRS gave everyone a pass up to the end of 2025. Your extra ` +
          `contribution could still come out of your pay before tax that year. It starts to bite for 2026.`;
      }
      if (r.applies && r.effect === 'must_be_roth') {
        return `Your ${usd(r.wages)} does go over the ${yr} line, so anything extra you add has to go in after tax. ` +
          `You told us you are not planning to add anything extra, so there is nothing to convert and nothing to pay.`;
      }
      return `With these answers the rule does not reach you, and your extra contribution can still come out of your ` +
        `pay before tax.`;
  }
}

// ---- The story --------------------------------------------------------------
// THE ROWS RECONCILE. The two middle rows are the whole of the top row split in
// two, so they have to add up to it: the after-tax row is DERIVED by subtraction
// from the already-rounded figures above rather than rounded on its own. The
// rows below the heavier rule are NOT part of that split — one is what the split
// costs in tax this year, the other is a figure years away — so they carry
// .otw-after, which draws the rule that stops a reader adding them in.
function storyOf(s, r) {
  const maxR = r.maxCatchUp != null ? Math.round(r.maxCatchUp) : 0;
  const bite = !!r.mandateBites;
  const noRoth = r.effect === 'plan_no_roth_cannot_catchup';
  const electedNone = r.applies && r.effect === 'must_be_roth' && !bite;

  // Nothing to tell a story about: no catch-up exists at this age, or the year's
  // figures are not published. The plain box carries the reason instead, and the
  // lead sentence is suppressed so the card does not introduce rows that are not
  // there.
  if (maxR <= 0) return { lead: '', rows: '' };

  if (noRoth) {
    return {
      lead: `<p class="otw-lead">Here is what happens to the extra you were hoping to add for ${s.year}:</p>`,
      rows: `<ul class="otw-story">` +
        `<li><span>The most someone your age could normally add</span><span class="otw-amt">${usd(maxR)}</span></li>` +
        `<li class="otw-after"><span>What your plan will actually let you add</span><span class="otw-amt otw-taxed">$0</span></li>` +
        `<li class="otw-after"><span>Extra federal tax this year</span><span class="otw-amt">$0</span></li>` +
      `</ul>`
    };
  }

  if (electedNone) {
    return {
      lead: `<p class="otw-lead">Here is what happens to the extra you could add for ${s.year}:</p>`,
      rows: `<ul class="otw-story">` +
        `<li><span>The most you are allowed to add</span><span class="otw-amt">${usd(maxR)}</span></li>` +
        `<li class="otw-after"><span>What you told us you plan to add</span><span class="otw-amt otw-taxed">$0</span></li>` +
        `<li class="otw-after"><span>Extra federal tax this year</span><span class="otw-amt">$0</span></li>` +
      `</ul>`
    };
  }

  // The split. When the rule bites, the top row is the figure the visitor
  // actually typed, uncapped — quoting the capped figure back at somebody who
  // entered $20,000 makes the answer look like it agreed with them. The amount
  // the limit will not take becomes its own row instead, so the three rows below
  // the top one still add up to it. When the rule does NOT bite, the catch-up
  // card was never on this visitor's path, so the story is told about the amount
  // they are ALLOWED to add: quoting an untouched default back as "the amount
  // you plan to add" would put our invented figure in their mouth.
  const topR = bite ? Math.round(r.catchUpAmount || 0) : maxR;
  const fitsR = bite ? Math.round(r.effectiveCatchUp || 0) : maxR;
  const preR = bite ? 0 : fitsR;
  const rothR = fitsR - preR;               // derived, never rounded on its own
  const overR = topR - fitsR;               // derived, never rounded on its own
  const extraR = bite ? Math.round(r.extraTaxThisYear || 0) : 0;
  const topLabel = bite ? `The extra you plan to add for ${s.year}` : `The most you are allowed to add for ${s.year}`;
  const lead = bite
    ? `<p class="otw-lead">Here is what happens to the ${usd(topR)} you plan to add on top of the normal limit:</p>`
    : `<p class="otw-lead">Here is what happens to the ${usd(topR)} you are allowed to add on top of the normal limit:</p>`;

  let rows =
    `<ul class="otw-story">` +
    `<li><span>${topLabel}</span><span class="otw-amt">${usd(topR)}</span></li>` +
    `<li><span>Still allowed to come out of your pay before tax</span>` +
      `<span class="otw-amt${preR > 0 ? ' otw-free' : ''}">${usd(preR)}</span></li>` +
    `<li><span>Has to go in after tax, as Roth</span>` +
      `<span class="otw-amt${rothR > 0 ? ' otw-taxed' : ''}">${usd(rothR)}</span></li>` +
    (overR > 0
      ? `<li><span>Above the ${usd(fitsR)} your age allows, so it cannot go in as a catch-up at all</span>` +
        `<span class="otw-amt otw-taxed">${usd(overR)}</span></li>`
      : '') +
    `<li class="otw-after"><span>Extra federal tax this year${bite ? `, at your ${bp(s.rateNow)} rate` : ''}</span>` +
      `<span class="otw-amt${extraR > 0 ? ' otw-taxed' : ''}">${usd(extraR)}</span></li>`;

  // The long-run figure. Not part of the split and not even in the same year, so
  // it sits below the heavier rule too, and it is the one number on this page
  // that can be negative.
  if (bite && r.rothAdvantage != null) {
    const adv = Math.round(r.rothAdvantage);
    const horizon = s.years > 0
      ? `${count(s.years)} years out at ${count(s.growth * 100)}% a year`
      : 'the day you take it out';
    rows += `<li class="otw-after"><span>Roth against before tax, ${horizon}</span>` +
      `<span class="otw-amt${adv > 0 ? ' otw-free' : (adv < 0 ? ' otw-taxed' : '')}">${usdSigned(adv)}</span></li>`;
  }

  return { lead, rows: rows + `</ul>` };
}

// ---- The plain-terms box ----------------------------------------------------
// This tool is NOT a filing-time deduction, so it does not get the tips/overtime
// FICA-and-your-paycheck note: nothing here arrives as a refund and Social
// Security is not in the story at all. What a reader needs instead is that the
// AMOUNT is untouched (the myth the page exists to kill), which side of tax it
// moved to, and that their ordinary contributions are not affected.
function plainOf(s, r) {
  if (!r.mandateBites) return `<div class="otw-plain">${reasonPlain(s, r)}</div>`;

  const enteredR = Math.round(r.catchUpAmount || 0);
  const effR = Math.round(r.effectiveCatchUp || 0);
  const extraR = Math.round(r.extraTaxThisYear || 0);
  const y = yearParams(s);
  const deferral = y && y.deferral ? ` Your ordinary contributions, up to ${usd(y.deferral)} for ${s.year}, can still ` +
    `come out of your pay before tax; only this extra amount is affected.` : '';

  let longRun;
  if (r.rothAdvantage == null) {
    longRun = ` Whether that trade costs you in the end depends on the rate you will pay when you take the money out — ` +
      `go back and tell us what you expect and we will show you which side of the line you are on.`;
  } else if (Math.abs((s.rateRetire || 0) - (s.rateNow || 0)) < 1e-9) {
    longRun = ` The ${bp(s.rateRetire)} you expect in retirement is exactly the ${bp(s.rateNow)} you pay now, which is ` +
      `the break-even point: over the long run this is a wash either way.`;
  } else if (r.rothAdvantage > 0) {
    longRun = ` And it is the better side of the trade for you: because you expect a higher rate in retirement ` +
      `(${bp(s.rateRetire)}) than the ${bp(s.rateNow)} you pay now, paying the tax now leaves you about ` +
      `${usd(r.rothAdvantage)} ahead. It would only turn against you below the ${bp(s.rateNow)} you pay today.`;
  } else {
    longRun = ` It is the worse side of the trade for you, though: because you expect a lower rate in retirement ` +
      `(${bp(s.rateRetire)}) than the ${bp(s.rateNow)} you pay now, you end up about ${usd(-r.rothAdvantage)} behind. ` +
      `It breaks even when the rate you pay in retirement matches the ${bp(s.rateNow)} you pay today.`;
  }

  // The opening sentence is the myth this page exists to kill, so it has to stay
  // true when the limit binds: somebody who typed more than the law allows does
  // not lose catch-up room they ever had, but saying "the whole $20,000 still
  // goes into your plan" over a $8,000 figure would be a plain untruth.
  const kept = enteredR > effR
    ? `You do not lose the catch-up room itself: the ${usd(effR)} the law allows still goes into your plan, and it is ` +
      `only the ${usd(enteredR - effR)} above that limit that cannot go in as a catch-up at all.`
    : `You do not lose any of it: the whole ${usd(effR)} still goes into your plan.`;

  return `<div class="otw-plain">${kept} What ` +
    `changes is which side of tax it goes in on — no break on your ${s.year} tax return, which is the ${usd(extraR)} ` +
    `above, and then no tax at all on that money or on what it earns when you take it out.${deferral}${longRun}</div>`;
}

// ---- The answer -------------------------------------------------------------
function renderResult({ state: s, result: r }) {
  const bite = !!r.mandateBites;
  const extraR = bite ? Math.round(r.extraTaxThisYear || 0) : 0;

  const head =
    `<p class="otw-kick">Extra federal tax this year, because of the Roth catch-up rule</p>` +
    `<p class="otw-big${extraR > 0 ? '' : ' otw-zero'}">${usd(extraR)}</p>`;

  const { lead, rows } = storyOf(s, r);

  // The limit, named with BOTH numbers, and decided from the LIMIT rather than
  // from "did anything come out": a catch-up can be capped from $20,000 down to
  // $8,000 and still sit above a headline the visitor reads as agreeing with the
  // figure they typed.
  const warning = capWarning(s);
  const capFlag = warning ? `<p class="otw-flag">${warning}</p>` : '';

  return head + lead + rows + capFlag + plainOf(s, r);
}

// ---- Tool-specific chrome the core cannot know about ------------------------
// The last question is a different card on every path (2025 and under-50 end at
// the age card, a wage under the line ends at the wages card, a plan with no
// after-tax option ends at the plan card), so the button that leads to the
// answer is relabelled from the live path rather than hard-coded into one card.
// Without this, four of the five paths end on a card whose button says "Next"
// and then jumps straight to the result.
function relabelNav(wizard) {
  let last = null;
  try {
    const path = wizard.path() || [];
    for (const n of path) if (n !== RESULT) last = n;
  } catch (_) { last = null; }
  if (last == null) return;
  for (const stepNo of ASK_STEPS) {
    const card = document.querySelector(`#rothWizard .otw-card[data-step="${stepNo}"]`);
    const btn = card ? card.querySelector('.otw-next') : null;
    if (!btn) continue;
    const wanted = stepNo === last ? 'See my answer' : 'Next';
    if (btn.textContent !== wanted) btn.textContent = wanted;
  }
}

// The "the most I'm allowed" chip is a real statutory figure, and which figure
// it is depends on the year and the age band, so it is written from the engine
// result rather than frozen into the markup. The chips are display:none until
// data-js="on", so rewriting them here is a hide-on-demand change, never a
// show-on-demand one.
function syncMaxChip(r) {
  const btn = document.querySelector('#otwCatchUpChips button[data-otw-fill="catchUp"]');
  if (!btn) return;
  const max = r ? r.maxCatchUp : null;
  if (max == null || !(max > 0)) return;
  const maxR = Math.round(max);
  btn.dataset.otwValue = String(maxR);
  btn.textContent = `The most I'm allowed → ${maxR.toLocaleString('en-US')}`;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'rothWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: YEAR, radios: 'year' },
    { step: AGE, fields: ['age'] },
    { step: WAGES, fields: ['wages'], when: asksWages },
    { step: PLAN, radios: 'planRoth', when: asksPlan },
    {
      step: CATCHUP,
      fields: ['catchUp'],
      when: canBite,
      // On the catch-up card because that is where the number is typed, and the
      // limit it is checked against is the one this card's own question is
      // about.
      flags: [{ id: 'otwCatchUpFlag', text: capWarning }]
    },
    { step: RATENOW, fields: ['rateNow'], when: canBite },
    {
      step: FUTURE,
      fields: ['rateRetire', 'years', 'growth'],
      when: canBite,
      // Skip blanks the rate rather than leaving our 22% standing in for an
      // answer the visitor declined to give: the engine returns a null long-run
      // comparison for a null rate, and the answer says so out loud instead of
      // quoting a number built on a guess we made.
      skipClears: ['rateRetire']
    },
    { step: RESULT, result: true }
  ],

  // The page loads with numbers nobody typed, so the answer stays labelled an
  // example until every figure it is actually built from is the visitor's own —
  // and only the figures on THIS visitor's path are demanded, because a question
  // the flow never asked cannot be one they failed to answer. The year and the
  // plan's after-tax option are not listed: both ship on the answer that is true
  // for most visitors and neither invents a figure. The three long-run inputs
  // are not listed either: the answer quotes them back in the row's own label
  // ("10 years out at 6% a year"), so they are labelled where they are used.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('age')) missing.push('your age');
    if (asksWages(s) && !touched.has('wages')) missing.push('your pay last year');
    if (canBite(s) && !touched.has('catchUp')) missing.push('the extra you plan to add');
    if (canBite(s) && !touched.has('rateNow')) missing.push('your tax rate');
    return missing;
  },

  // One chip per question this visitor was actually asked. A chip for a card
  // that is off the path would jump to a question the flow has decided not to
  // ask, and the core would bounce them straight back out of it.
  chips: (s) => {
    const items = [
      { step: YEAR, label: String(s.year) },
      { step: AGE, label: `age ${count(s.age)}` }
    ];
    if (asksWages(s)) items.push({ step: WAGES, label: `${usd(s.wages)} last year` });
    if (asksPlan(s)) items.push({ step: PLAN, label: s.planRoth ? 'plan offers Roth' : 'no Roth in my plan' });
    if (canBite(s)) {
      items.push({ step: CATCHUP, label: `${usd(s.catchUp)} extra` });
      items.push({ step: RATENOW, label: `${bp(s.rateNow)} now` });
      items.push({
        step: FUTURE,
        label: s.rateRetire == null ? 'no long-run view' : `${bp(s.rateRetire)} retired`
      });
    }
    return items;
  },

  announce: (s, r) => {
    if (!r.mandateBites) {
      return `The mandatory Roth catch-up rule does not apply to you for ${s.year}. ` + stripTags(reasonPlain(s, r));
    }
    const capSpoken = capWarning(s) ? ` Check your catch-up figure, there is a warning with the answer.` : '';
    const longRun = r.rothAdvantage == null
      ? ''
      : (r.rothAdvantage > 0
        ? ` Over the long run that leaves you about ${usd(r.rothAdvantage)} ahead.`
        : (r.rothAdvantage < 0 ? ` Over the long run that leaves you about ${usd(-r.rothAdvantage)} behind.` : ''));
    return `Your ${s.year} catch-up of ${usd(r.effectiveCatchUp)} must go in after tax, which costs about ` +
      `${usd(r.extraTaxThisYear)} in extra federal tax this year.${longRun}${capSpoken}`;
  },

  onRender: ({ result, wizard }) => {
    relabelNav(wizard);
    syncMaxChip(result);
  }
});

// Defensive: #outStatus is read aloud, and reading a tag name out is worse than
// reading nothing. The reason sentences are plain text today, and this is what
// keeps that true if one of them ever grows a <strong> for the visible copy.
function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}
