// able-account-wizard.js — the card-by-card flow on /able-account-calculator/.
// Works out how much can go into one ABLE account (26 U.S.C. §529A) for tax
// year 2026: the $20,000 pool every contributor shares, the ABLE-to-Work room
// only an employed beneficiary's own pay unlocks, what has gone in already, and
// what is left or over. All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form (#ableForm, with #onsetGate / #employed / #planContribution as <select>s)
// and is still served by able-account-calculator.js; the two must stay
// independent, so nothing here reads or writes an id the embed also ships except
// through its own page's DOM.
//
// WHAT IS HERE AND WHAT IS IN THE CORE. Stepping, dots, focus, the 350 ms flag
// debounce, the polite status line, the example label, Start over and the
// data-js="on"-last handshake all live in wizard-core.js. What is left here is
// only what makes this the ABLE calculator: the three branches, one call into
// the shared §529A engine, and the answer written out as a story.
//
// THE THREE BRANCHES ARE THE POINT of this page being a card flow. They are
// when() predicates, so the core recomputes them on every keystroke and the dots
// shorten on the answer that shortened them, not on the next Next:
//   1. onset at 46 or older  — no ABLE account can exist, so EVERY other
//      question leaves the path and the flow is one question long.
//   2. no money from work    — pay, the workplace-plan question and the state
//      all leave the path: none of them can change a $20,000 answer.
//   3. workplace-plan money  — the bonus is blocked for the whole year, which
//      makes the state question moot, because state only ever picks which
//      poverty-line figure the bonus is capped at.
// The old page expressed 1 and 2 as style.display on #calcFields and
// #employedFields and 3 not at all: it asked every visitor for a state whether
// or not the answer could depend on it.
//
// THE MATH IS ONE ENGINE CALL, unchanged. ableContribution() caps the bonus at
// the lesser of the beneficiary's pay and the one-person federal poverty line
// for their state (Alaska and Hawaii differ), lets only the beneficiary's own
// money occupy that space, counts a 529 rollover against the base pool, and
// returns the excess the 6% excise tax would apply to.
import { ableContribution } from '/assets/able-contribution.js';
import { mountWizard, $, moneyOf, radioOf, selectOf, usd } from '/assets/wizard-core.js';

const LIMITS = window.__ABLE_LIMITS__ || {};
const STATES = Array.isArray(window.__ABLE_STATES__) ? window.__ABLE_STATES__ : [];

// data-step on each card. RESULT is the last card and is never skipped.
const ONSET = 0, WORK = 1, PAY = 2, PLAN = 3, STATE = 4, OTHERS = 5, OWN = 6, RESULT = 7;

// ---- Reading the cards ------------------------------------------------------
function read() {
  return {
    onset: radioOf('onset', 'before46'),
    employed: radioOf('employed', 'no'),
    planContribution: radioOf('planContribution', 'no'),
    compensation: moneyOf('compensation'),
    state: selectOf('state'),
    others: moneyOf('others'),
    own: moneyOf('own'),
    rollover529: moneyOf('rollover529')
  };
}

// The path predicates, named once so the cards, the chips and the answer all
// agree on who is being asked what.
const isEligible = (s) => s.onset !== 'age46plus';
const isWorking = (s) => isEligible(s) && s.employed === 'yes';
const hasBonusPath = (s) => isWorking(s) && s.planContribution !== 'yes';

// Pay and the workplace-plan answer are read only when the visitor is actually
// on that branch: a compensation figure typed and then reversed out of by
// answering "no money from work" must not keep feeding the limit from a card
// that is no longer on the path.
const compute = (s) => ableContribution({
  onsetBefore46: isEligible(s),
  state: s.state,
  employed: isWorking(s),
  compensation: isWorking(s) ? s.compensation : 0,
  planContribution: isWorking(s) && s.planContribution === 'yes',
  others: s.others,
  own: s.own,
  rollover529: s.rollover529,
  limits: LIMITS
});

// ---- The one cross-check these answers allow --------------------------------
// Most pairs of numbers on this page cannot contradict each other: the
// beneficiary's own money may exceed their pay (savings), family money may
// exceed the limit (that is an over-contribution, which the answer explains, not
// an impossible entry). The one real contradiction is saying money WAS earned from
// work and then entering nothing for it — the two answers cannot both be true,
// and the second of the pair is where the visitor is standing when it first can
// be. Never blocking: the answer still computes underneath, and the same
// sentence renders again above it because a visitor who pressed Next may never
// come back to the card.
function payWarning(s) {
  if (!isWorking(s)) return '';
  if (s.compensation > 0) return '';
  return 'Check these two answers: you said the beneficiary earned money from work in 2026, but the amount here is $0. ' +
    'The extra room stops at whatever they earned, so $0 of pay means no extra room at all. ' +
    'Either fill in their pay, or go back one question and answer "No".';
}

// ---- States -----------------------------------------------------------------
// The page ships ONE option, whose empty value already means "the 48 contiguous
// states and D.C." — the figure every state but Alaska and Hawaii uses. So a
// visitor who presses Next without choosing has answered the question, and the
// select is filled in before the defaults are snapshotted so Start over restores
// that shipped option rather than whichever state was picked since.
function fillStates() {
  const sel = $('state');
  if (!sel || sel.options.length > 1) return;
  STATES.filter((s) => s && s.abbr && s.name)
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .forEach((s) => {
      const o = document.createElement('option');
      o.value = s.abbr;
      o.textContent = s.name;
      sel.appendChild(o);
    });
}

const stateName = (abbr) => {
  const hit = STATES.find((s) => s && s.abbr === abbr);
  return hit ? hit.name : '';
};

// Which place the poverty-line figure belongs to. Alaska and Hawaii have their
// own; everywhere else shares one, so naming the chosen state is still true and
// reads better than naming the bucket.
function placeLabel(s) {
  if (s.state === 'AK') return 'Alaska';
  if (s.state === 'HI') return 'Hawaii';
  return stateName(s.state) || 'the 48 contiguous states and D.C.';
}

// ---- The statute-cited detail ----------------------------------------------
// The engine's own notes, kept verbatim and folded. They are the depth this page
// is trusted for (the sole-responsibility quote, the employer-match trap, the
// rollover losing its rollover treatment) and they are far too long to sit in
// front of the number. The core preserves the open state across re-renders.
function rulesBox(r) {
  const notes = (r && r.notes) || [];
  if (!notes.length) return '';
  return '<details class="otw-help" id="ableRules"><summary>The rules behind this, with the statute</summary>' +
    notes.map((n) => `<p class="otw-note">${n}</p>`).join('') +
    '</details>';
}

// ---- The answer -------------------------------------------------------------
function renderResult({ state: s, result: r }) {
  const warning = payWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  // Not an eligible individual. The zero case carries the REASON, and the reason
  // is the one this page exists to correct: it is the age the disability began,
  // not the age the person is now.
  if (r && r.eligible === false) {
    return warnBox +
      '<p class="otw-kick">The most that can go into an ABLE account for this person in 2026</p>' +
      '<p class="otw-big otw-zero">$0</p>' +
      '<div class="otw-plain">No ABLE account can be opened for someone whose blindness or disability began at 46 or older, ' +
      'so there is no yearly limit to work out. What counts is the age it <strong>began</strong>, not the age they are now: ' +
      'someone who is 58 today whose disability began at 30 does qualify, and 2026 is the first year that line moved from 26 to 46. ' +
      'If that describes them, go back to the first question and change the answer.</div>' +
      rulesBox(r);
  }

  if (!r || r.error) {
    return warnBox +
      '<p class="otw-kick">The most that can go into this ABLE account in 2026</p>' +
      '<p class="otw-big otw-zero">$0</p>' +
      '<div class="otw-plain">The 2026 limit figures did not load, so this cannot be worked out right now. ' +
      'Reloading the page usually fixes it; the same numbers are written out in "How the 2026 ABLE contribution limit works" below.</div>';
  }

  // ---- ROUNDED ONCE ---------------------------------------------------------
  // The labels invite the reader to add the first rows up to the headline, and
  // the last two up to it again, so both have to hold after rounding. Every
  // figure below the first two is DERIVED BY SUBTRACTION from already-rounded
  // numbers rather than rounded on its own, which is the only way
  // $20,000 + $15,650 cannot print over a headline of $35,649.
  const baseR = Math.round(r.base);
  const bonusR = Math.round(r.bonusCap);
  const maxR = baseR + bonusR;
  const contribR = Math.round(r.totalContrib);
  const limitR = Math.round(r.totalLimit);
  const excessR = Math.max(0, contribR - limitR);
  const roomR = Math.max(0, maxR - contribR);
  const roomOthersR = Math.min(roomR, Math.max(0, Math.round(r.roomOthers)));
  const roomOwnOnlyR = Math.max(0, roomR - roomOthersR);
  const ownR = Math.round(s.own);
  const ownSpillR = Math.max(0, ownR - bonusR);

  const head =
    '<p class="otw-kick">The most that can go into this ABLE account in 2026</p>' +
    `<p class="otw-big">${usd(maxR)}</p>`;

  const lead = `<p class="otw-lead">Here is how that ${usd(maxR)} is made up, and how much of it is still free:</p>`;

  const rows =
    '<ul class="otw-story">' +
    '<li><span>The pool everyone shares — family, friends, a trust, the beneficiary, and any 529 transfer</span>' +
      `<span class="otw-amt">${usd(baseR)}</span></li>` +
    (bonusR > 0
      ? '<li><span>Extra room, which only the beneficiary\'s own money can use</span>' +
        `<span class="otw-amt">${usd(bonusR)}</span></li>`
      : '') +
    // Not part of the split above: those rows are the limit, these two are what
    // has happened to it. The heavier rule stops a reader adding all four.
    `<li class="otw-after"><span>Put in so far this year</span><span class="otw-amt">${usd(contribR)}</span></li>` +
    (excessR > 0
      ? `<li><span>More than the limit this mix of money allows</span><span class="otw-amt">${usd(excessR)}</span></li>`
      : `<li><span>Room left this year</span><span class="otw-amt${roomR > 0 ? ' otw-free' : ''}">${usd(roomR)}</span></li>`) +
    '</ul>';

  // ---- Every binding limit, named with BOTH numbers --------------------------
  // The moment a limit binds, "what the beneficiary earned", "what they put in"
  // and "what actually counts" stop being the same figure, and a sentence
  // naming only one of them is how a screen ends up reading $15,650 over
  // $40,000 of pay with nothing to say why.
  const flags = [];

  if (isWorking(s) && s.planContribution === 'yes') {
    const wouldBe = Math.round(Math.min(s.compensation, r.fpl || 0));
    flags.push('<p class="otw-flag">Heads up: no extra room at all this year. Any money going into a 401(k), 403(b) or ' +
      '457(b) for the beneficiary switches it off for the whole year — including an employer match nobody asked for. ' +
      (wouldBe > 0
        ? `Without it they could have added up to ${usd(wouldBe)} of their own pay on top of the ${usd(baseR)} everyone shares.`
        : `The limit is the ${usd(baseR)} everyone shares, on its own.`) +
      '</p>');
  }

  if (bonusR > 0 && ownSpillR > 0) {
    flags.push(`<p class="otw-flag">Heads up: only ${usd(bonusR)} of the ${usd(ownR)} the beneficiary put in can use the ` +
      `extra room. The other ${usd(ownSpillR)} comes out of the ${usd(baseR)} everyone shares, alongside everybody else's money.</p>`);
  }

  if (excessR > 0) {
    flags.push(`<p class="otw-flag">Heads up: ${usd(contribR)} has gone in, but only ${usd(limitR)} of it fits. ` +
      (bonusR > 0
        ? `The ${usd(bonusR)} of extra room is reserved for the beneficiary's own pay, and everybody else's money can only ` +
          `ever use the ${usd(baseR)} shared pool, so ${usd(excessR)} is over. `
        : `The limit here is the ${usd(baseR)} shared pool, so ${usd(excessR)} is over. `) +
      `Ask the ABLE program to send that ${usd(excessR)} back before the beneficiary's tax return is due, extensions ` +
      'included, and it counts as never contributed. Leave it in and it is taxed 6% for every year it stays.</p>');
  }

  // Where the extra room came from, when there is any. Both numbers, always:
  // the cap is the smaller of two, and which one won is the whole story.
  const bonusNote = bonusR > 0
    ? `<p class="otw-note">That extra ${usd(bonusR)} is the smaller of two figures: the ${usd(Math.round(s.compensation))} ` +
      `the beneficiary earned from work, and the ${usd(Math.round(r.fpl || 0))} a year allowed in ${placeLabel(s)}.</p>`
    : '';

  // ---- The plain box ---------------------------------------------------------
  // This tool is NOT a filing-time deduction, so it says what it actually is
  // instead: a ceiling on savings going in, with a penalty nobody else is
  // checking for you. The room sentence names BOTH contributor figures, because
  // "$15,650 left" reads as "anyone may add $15,650" and for most of these cases
  // that is false.
  let plainBody;
  if (excessR > 0) {
    // Deliberately NOT "nothing more can go in". Where family money has
    // overflowed the shared pool, the beneficiary's own pay can still legally
    // fill the extra room without making the excess any bigger, so an absolute
    // sentence here would be false in exactly the case that produced it.
    plainBody = `${usd(excessR)} more has gone in than fits, and sorting that out is on whoever runs the account: ` +
      'ABLE programs do not check this, and do not undo it by themselves.';
  } else if (roomR > 0) {
    plainBody = `${usd(roomR)} can still go in this year` +
      (roomOwnOnlyR > 0
        ? `: ${usd(roomOthersR)} of it from anyone, and the last ${usd(roomOwnOnlyR)} only from the beneficiary's own money.`
        : ', from anyone.') +
      ' Nobody checks this for you, so going over is the beneficiary\'s problem rather than the program\'s.';
  } else {
    plainBody = `The full ${usd(maxR)} has gone in, so nothing more should go in until January.`;
  }
  const plain = '<div class="otw-plain">This is a ceiling on money going <em>into</em> the account for the year. ' +
    'It is not a tax refund and nothing here comes back to you. ' + plainBody + '</div>';

  return warnBox + head + lead + rows + flags.join('') + bonusNote + plain + rulesBox(r);
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'ableWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: ONSET, radios: 'onset' },
    { step: WORK, radios: 'employed', when: isEligible },
    {
      step: PAY,
      fields: ['compensation'],
      when: isWorking,
      // On the pay card rather than the work card: it is the second of the two
      // answers, so it is the one being given when the contradiction first exists.
      flags: [{ id: 'otwPayFlag', text: payWarning }]
    },
    { step: PLAN, radios: 'planContribution', when: isWorking },
    // State only ever picks which poverty-line figure the extra room is capped
    // at, so a visitor who cannot have extra room is never asked for it.
    { step: STATE, fields: ['state'], when: hasBonusPath },
    // The 529 rollover lives on this card as a collapsed escape hatch rather
    // than a card of its own: it draws on the same shared pool as everyone
    // else's money, and asking every visitor about a college savings plan they
    // do not have would cost more than it ever saves.
    { step: OTHERS, fields: ['others', 'rollover529'], when: isEligible },
    { step: OWN, fields: ['own'], when: isEligible },
    { step: RESULT, result: true }
  ],

  // The page loads with one figure nobody typed: $10,000 already in from other
  // people. Everything else ships at 0, which invents nothing — 0 is not a guess
  // about this visitor — and the two yes/no answers and the state all default to
  // the case that is true for most people. So the answer stays labelled an
  // example until the one invented figure is the visitor's own.
  exampleMissing: (s, touched) => (touched.has('others') ? [] : ['what everyone else has put in']),

  // Only the cards this visitor is actually being asked. A chip for a question
  // that left the path would jump them to a card the flow has dropped.
  chips: (s) => {
    const out = [{ step: ONSET, label: s.onset === 'age46plus' ? 'began at 46 or older' : 'began before 46' }];
    if (!isEligible(s)) return out;
    out.push({ step: WORK, label: isWorking(s) ? 'earns from work' : 'no pay from work' });
    if (isWorking(s)) {
      out.push({ step: PAY, label: `${usd(s.compensation)} earned` });
      out.push({ step: PLAN, label: s.planContribution === 'yes' ? 'workplace plan money going in' : 'no workplace plan money' });
    }
    if (hasBonusPath(s)) out.push({ step: STATE, label: stateName(s.state) || '48 states + D.C.' });
    out.push({ step: OTHERS, label: `${usd(s.others)} from everyone else` });
    // Always shown, including at zero: it is the only signpost to the 529 field,
    // which is folded away inside the "everyone else" card. The field name makes
    // the core open that fold and land in the input rather than the card's first.
    out.push({
      step: OTHERS,
      field: 'rollover529',
      label: s.rollover529 > 0 ? `${usd(s.rollover529)} moved from a 529` : 'no 529 transfer'
    });
    out.push({ step: OWN, label: `${usd(s.own)} of their own` });
    return out;
  },

  announce: (s, r) => {
    const warned = payWarning(s) ? ' Check your answers, there is a warning above.' : '';
    if (!r || r.eligible === false) {
      return 'No ABLE account can be opened when the disability began at 46 or older, so there is no contribution limit.' + warned;
    }
    if (r.error) return 'The 2026 limit figures did not load.' + warned;
    const baseR = Math.round(r.base);
    const maxR = baseR + Math.round(r.bonusCap);
    const contribR = Math.round(r.totalContrib);
    const excessR = Math.max(0, contribR - Math.round(r.totalLimit));
    const roomR = Math.max(0, maxR - contribR);
    const tail = excessR > 0
      ? ` ${usd(contribR)} has gone in, which is ${usd(excessR)} more than this mix of money allows.`
      : roomR > 0
        ? ` ${usd(roomR)} of that is still free.`
        : ' It is all used up.';
    return `The most that can go in for 2026 is ${usd(maxR)}.${tail}${warned}`;
  },

  // Before the snapshot so Start over restores the single option this page ships
  // with, not whichever of the 51 states was chosen since.
  onBeforeSnapshot: fillStates
});
