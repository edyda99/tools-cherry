// qcd-vs-charitable-deduction-wizard.js — the card-by-card flow on
// /qcd-vs-charitable-deduction-calculator/.
//
// Compares two ways of giving IRA money to a charity: sending it straight from
// the IRA trustee (a Qualified Charitable Distribution, IRC §408(d)(8) — never
// includible in gross income) against taking the distribution as income and
// writing the gift off under the 2026 charitable rules. All logic client-side;
// nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form and is still served by qcd-vs-charitable-deduction-calculator.js; the two
// must stay independent, which is why the wizard's form is #qcdWizForm and the
// embed's is still #qcdForm, and why nothing here reads or writes an id through
// anything but its own page's DOM.
//
// Everything about "how a card flow behaves" — stepping, dots, focus, the 350 ms
// flag debounce, the polite status line, the example label, Start over, data-js
// last — lives in wizard-core.js. What is left here is only what makes this the
// QCD calculator: nine questions (three of them on a branch), one call into the
// shared qcd-comparison engine, and the answer written out as a story.
//
// IT NEVER OVERCLAIMS A TAX WIN. At or below the §170(p) non-itemizer cap
// ($1,000 single / $2,000 married filing jointly), taking the distribution and
// claiming that small deduction removes the SAME dollars from taxable income as
// the QCD excludes, so the two routes tie on federal income tax and the QCD wins
// only on AGI. The tie is decided from the two ROUNDED tax figures this card
// prints, not from the engine's sub-cent threshold, so the headline can never
// say "saves you $0" beside a sentence claiming a win — or the reverse.
import { qcdComparison } from '/assets/qcd-comparison.js';
import { mountWizard, moneyOf, numOf, radioOf, usd, count } from '/assets/wizard-core.js';

const OBBBA = window.__OBBBA__;
const FED = window.__FED__;
const QCD_PARAMS = (OBBBA && OBBBA.qcd) || {};

// Read from the tax-parameter store rather than typed in twice: 70½ is the
// eligibility age and 73 is the age you are first MADE to withdraw, and this
// tool exists largely because people conflate the two.
const AGE_ELIGIBLE = Number.isFinite(QCD_PARAMS.ageEligible) ? QCD_PARAMS.ageEligible : 70.5;
const RMD_AGE = Number.isFinite(QCD_PARAMS.rmdAge2023plus) ? QCD_PARAMS.rmdAge2023plus : 73;

// Mirrors qcd-comparison.js's own two sets. The card only offers 401k and
// roth_ira of these, but the sets stay complete so a later option added to the
// markup branches correctly without a second edit here.
const HARD_INELIGIBLE = new Set(['401k', '403b', '457', 'ongoing_sep_ira', 'ongoing_simple_ira']);
const STEER_AWAY = new Set(['roth_ira']);

// data-step on each card. RESULT is the last card and is never skipped.
const GIFT = 0, ACCOUNT = 1, AGE = 2, RMD = 3, OFFSET = 4, INCOME = 5,
  FILING = 6, SPOUSE = 7, OTHER = 8, RESULT = 9;

const FILING_WORDS = { single: 'on my own', married: 'married, one return', head_of_household: 'head of household' };
const ACCOUNT_WORDS = {
  traditional_ira: 'traditional IRA',
  inactive_sep_ira: 'inactive SEP IRA',
  inactive_simple_ira: 'inactive SIMPLE IRA',
  roth_ira: 'Roth IRA',
  '401k': '401(k) at work'
};

// ---- Reading the cards ------------------------------------------------------
function read() {
  return {
    donation: moneyOf('donation'),
    accountType: radioOf('accountType', 'traditional_ira'),
    age: numOf('age'),
    rmd: moneyOf('rmd'),
    offset: moneyOf('offset'),
    agi: moneyOf('agi'),
    filing: radioOf('filing', 'single'),
    spouse65: radioOf('spouse65', 'no'),
    other: moneyOf('other')
  };
}

const compute = (s) => qcdComparison({
  filingStatus: s.filing,
  age: s.age,
  spouseAlsoQualifies: s.spouse65 === 'yes',
  donation: s.donation,
  baseAgi: s.agi,
  otherItemized: s.other,
  accountType: s.accountType,
  rmdAmount: s.rmd,
  post70DeductibleContribs: s.offset,
  year: 2026,
  qcd: OBBBA.qcd, charitable: OBBBA.charitable, fed: FED
});

// ---- THE BRANCH -------------------------------------------------------------
// The account and the age together decide whether the direct route exists at
// all. When it does not, the two IRA-side follow-ups can no longer move a single
// number on the answer — the required-withdrawal line is only ever printed for a
// QCD that satisfies it, and the post-70½ offset only ever reduces a QCD — so
// asking either one would be asking a question whose answer is already known to
// be irrelevant. They leave the path on the keystroke that closed the route.
const directRouteOpen = (s) =>
  !HARD_INELIGIBLE.has(s.accountType) && !STEER_AWAY.has(s.accountType) && s.age >= AGE_ELIGIBLE;

// ---- The two cross-checks these answers allow -------------------------------
// Neither blocks: the answer still computes underneath, the doubt just travels
// with it, and it travels to BOTH places — the card where the second of the two
// numbers is typed, and the answer, because a visitor who reaches the answer by
// pressing Next may never come back to the card.

// The 70-vs-70½ trap, which the page's own mythbusting section calls the single
// most common mistake here. Only fires in the near-miss band: someone who enters
// 62 has not made this mistake, they are simply not eligible yet, and the answer
// card says so in full.
function ageWarning(s) {
  if (s.age >= AGE_ELIGIBLE || s.age < 70) return '';
  return `Check this: you entered ${count(s.age)}. Paying a charity straight from an IRA needs you to be 70½ on the ` +
    `day the money leaves the account — half a year after your 70th birthday, not the year you turn 70. ` +
    `If you have already passed that date, enter 70.5.`;
}

// Other write-offs bigger than the whole income they would come off. The income
// on that side is your other income PLUS the gift you take out, and both of
// those are numbers this flow asked for, so this really is a contradiction
// between two of the visitor's own answers rather than merely a large figure.
function otherWarning(s) {
  const incomeThatSide = s.agi + s.donation;
  if (s.other <= 0 || incomeThatSide <= 0 || s.other <= incomeThatSide) return '';
  return `Check these numbers: the ${usd(s.other)} you entered as other write-offs is more than the ` +
    `${usd(incomeThatSide)} you would have as income after taking this gift out of the IRA. That leaves nothing ` +
    `for the write-offs to come off, so the comparison stops telling you anything. One of the two needs another look.`;
}

// ---- The answer -------------------------------------------------------------
const row = (label, amount, cls) =>
  `<li><span>${label}</span><span class="otw-amt${cls ? ' ' + cls : ''}">${amount}</span></li>`;
const afterRow = (label, amount) =>
  `<li class="otw-after"><span>${label}</span><span class="otw-amt">${amount}</span></li>`;

// The take-and-deduct side of the story, used both as one half of the comparison
// and, alone, when the direct route is closed. Rows are ROUNDED ONCE: the labels
// invite the reader to add the gift rows up, so the "still taxed" row is DERIVED
// by subtraction from the two rounded figures rather than rounded on its own.
function takeAndDeductRows(donR, dedR, taxBR) {
  const restR = donR - dedR;
  return `<ul class="otw-story">` +
    row('Comes off the income you are taxed on', usd(dedR), dedR > 0 ? 'otw-free' : '') +
    (restR > 0 ? row('The rest of the gift — taxed as ordinary income', usd(restR), 'otw-taxed') : '') +
    afterRow('Federal income tax you would pay', usd(taxBR)) +
    `</ul>`;
}

// Why only part of the gift can be written off on the take-and-deduct side.
// Names BOTH numbers every time — "your gift" and "the deductible amount" stop
// being the same figure the moment any of these three limits binds, and a
// sentence naming only one of them is how a screen ends up reading "$1,000, the
// gift you made" over a $10,000 gift.
function deductionLimitNote(r, donR, dedR) {
  if (donR <= 0 || dedR >= donR) return '';
  const b = r.resB;
  if (!b.itemize) {
    return `<p class="otw-flag">On that route only ${usd(dedR)} of your ${usd(donR)} gift can be written off. ` +
      `You take the flat deduction rather than listing your expenses one by one, and for people who do that the ` +
      `write-off for giving stops at ${usd(b.nonItemizerCap)} a year.</p>`;
  }
  if (b.floorLost > 0) {
    return `<p class="otw-flag">On that route only ${usd(dedR)} of your ${usd(donR)} gift can be written off. ` +
      `You do list your expenses one by one, and a 2026 rule takes the first half a percent of your income — ` +
      `${usd(b.floorLost)} here — off any gift before you may write it off.</p>`;
  }
  return `<p class="otw-flag">On that route only ${usd(dedR)} of your ${usd(donR)} gift can be written off.</p>`;
}

// The §68 "2/37" haircut. Separate from the note above because it does not shrink
// the gift figure at all — it trims every listed write-off, this one included,
// after the fact — so folding the two into one sentence would misstate both.
function topBracketNote(r) {
  if (!r.resB || !r.resB.topBracketCap) return '';
  return `<p class="otw-flag">You are in the top tax bracket, where a rule trims every expense you list one by one, ` +
    `this gift included, to roughly 35 cents on the dollar. It does not touch the direct route, because nothing is ` +
    `being written off there.</p>`;
}

function renderResult({ state: s, result: r }) {
  const warn = [ageWarning(s), otherWarning(s)]
    .filter(Boolean)
    .map((t) => `<div class="ot-input-warning">${t}</div>`)
    .join('');

  // ROUNDED ONCE, then everything else DERIVED from those figures by
  // subtraction. Three independent Math.round()s do not add up, and every number
  // on this card is one a reader is invited to check against another one:
  // the gift rows against the gift, the two incomes against the excluded
  // amount, and the two tax figures against the headline.
  const donR = Math.round(Math.max(0, s.donation));
  const agiBR = Math.round(r.agiB);
  const taxBR = Math.round(r.taxB);
  const dedR = Math.min(donR, Math.round((r.resB && r.resB.charitableDeductible) || 0));

  // ---- Nothing to compare yet ------------------------------------------------
  if (donR <= 0) {
    const alsoClosed = !r.eligible
      ? ' Whatever you put in, the direct route is not open with the account and age you have chosen — see below once there is an amount to compare.'
      : '';
    return warn +
      `<p class="otw-kick">The two ways of giving from your IRA</p>` +
      `<p class="otw-big otw-zero">Add an amount</p>` +
      `<div class="otw-plain">Fill in how much you want to give and this card will show what each route does to ` +
      `your income and to your federal tax.${alsoClosed}</div>`;
  }

  // ---- The direct route is closed --------------------------------------------
  // The reason has to be the RIGHT reason. An empty age field makes the engine
  // say "not 70½ yet", which over a form the visitor simply has not finished is
  // naming the wrong problem, so it is checked before the age rule.
  if (!r.eligible) {
    let big;
    let why;
    // The 70½ flag and the 70½ reason are the same sentence twice. The flag
    // exists so the doubt travels from the age card to the answer, but on this
    // branch the answer's own "why" already explains 70½ in full, three lines
    // below it. One of them stands down.
    let ageSaidBelow = false;
    if (!r.accountEligible) {
      big = 'Not allowed';
      why = `A 401(k), a 403(b) or a 457 at work cannot pay a charity directly — only an IRA can. If you want this ` +
        `route, move the money into a traditional IRA first and give from there.`;
    } else if (r.accountSteerAway) {
      big = 'Not worth it';
      why = `A Roth IRA is allowed to do this, but there is nothing to gain: money coming out of a Roth is already ` +
        `tax-free, so there is no income to keep off your return. Give from a traditional IRA instead and this ` +
        `route starts paying.`;
    } else if (s.age <= 0) {
      big = 'Add your age';
      why = `Fill in your age. Giving straight from an IRA is only allowed once you have reached 70½, so your age ` +
        `is what decides whether that route is open to you at all.`;
    } else {
      big = 'Not yet';
      ageSaidBelow = true;
      why = `You have to be 70½ on the day the money leaves the account, and you entered ${count(s.age)}. That is ` +
        `the rule for this route, and it is not the same as the age you are first made to take money out, which ` +
        `is ${RMD_AGE}.`;
    }

    const warnHere = ageSaidBelow
      ? [otherWarning(s)].filter(Boolean).map((t) => `<div class="ot-input-warning">${t}</div>`).join('')
      : warn;
    return warnHere +
      `<p class="otw-kick">Giving straight from this account</p>` +
      `<p class="otw-big otw-zero">${big}</p>` +
      `<p class="otw-lead">Taking the money out yourself and writing the gift off is the route open to you here. ` +
      `This is what it does to your ${usd(donR)} gift:</p>` +
      takeAndDeductRows(donR, dedR, taxBR) +
      deductionLimitNote(r, donR, dedR) +
      topBracketNote(r) +
      `<div class="otw-plain">${why} On the route above, the ${usd(donR)} you take out counts as income, which ` +
      `puts the income your tax is worked out on at ${usd(agiBR)}, and what you save shows up as a smaller tax ` +
      `bill or a bigger refund when you file — not as a change to anything paid during the year. Money coming out ` +
      `of a retirement account is not wages, so no Social Security or Medicare tax is charged on it either way.</div>`;
  }

  // ---- The comparison --------------------------------------------------------
  const qcdR = Math.min(donR, Math.round(r.qcdAmount));
  const overR = donR - qcdR;                 // derived, so the gift rows add up
  const taxAR = Math.round(r.taxA);
  const agiAR = agiBR - qcdR;                // derived, so the two incomes differ by exactly the excluded amount
  const savedR = Math.max(0, taxBR - taxAR); // derived, so the headline is exactly the gap between the two rows
  const tie = savedR === 0;

  // The part of the gift pushed out of the direct route by the annual limit, and
  // the part pushed out by the post-70½ offset, are two different causes with
  // two different sentences, and a gift can hit both at once.
  const limitR = Math.round(r.qcdLimit || 0);
  const overFromLimit = Math.max(0, donR - limitR);
  const overFromOffset = Math.max(0, overR - overFromLimit);

  const head = tie
    ? `<p class="otw-kick">Side by side, the two routes cost</p><p class="otw-big otw-zero">The same tax</p>`
    : `<p class="otw-kick">When you file your taxes next year, giving straight from your IRA saves you</p>` +
      `<p class="otw-big">${usd(savedR)}</p>`;

  const lead = `<p class="otw-lead">Here is the same ${usd(donR)} gift, both ways. The direct route is the one your ` +
    `IRA provider will call a qualified charitable distribution.</p>`;

  const directRows = `<p class="otw-lead">Sent straight from the IRA to the charity</p>` +
    `<ul class="otw-story">` +
    row('Never counts as your income at all', usd(qcdR), qcdR > 0 ? 'otw-free' : '') +
    // NOT "taxed as usual": the remainder is added to your income and then
    // follows the same write-off rules as the other route, which for an itemizer
    // takes most of it straight back off again. Calling it taxed would name a
    // worse outcome than the tax figure underneath it actually shows.
    (overR > 0 ? row('The rest, taken out as an ordinary withdrawal instead', usd(overR), 'otw-taxed') : '') +
    afterRow('Federal income tax you would pay', usd(taxAR)) +
    `</ul>`;

  const rmdLine = (r.isRmdAge && s.rmd > 0 && r.rmdSatisfiedByQcd > 0)
    ? `<p class="otw-note">This also covers ${usd(r.rmdSatisfiedByQcd)} of the ${usd(s.rmd)} you are made to take ` +
      `out this year — but only if you do it before any other withdrawal. Take anything else out first and that ` +
      `withdrawal uses the requirement up instead.</p>`
    : '';

  const takeRows = `<p class="otw-lead">Taken out by you, then written off</p>` +
    takeAndDeductRows(donR, dedR, taxBR);

  // ---- The limits, each naming BOTH numbers -----------------------------------
  let limitNotes = '';
  if (overFromLimit > 0) {
    limitNotes += `<p class="otw-flag">Only ${usd(limitR)} of your ${usd(donR)} gift can go straight from the IRA ` +
      `this year — that is the 2026 limit, and it is one limit per person, so on a joint return your husband or ` +
      `wife has their own from their own IRA. The other ${usd(overFromLimit)} comes out as an ordinary ` +
      `withdrawal, counts as your income, and can then be written off only as far as the rules on the other ` +
      `route allow.</p>`;
  }
  if (overFromOffset > 0) {
    limitNotes += `<p class="otw-flag">The ${usd(s.offset)} you have paid into a traditional IRA and written off ` +
      `since you turned 70½ comes off what you may send straight to the charity, dollar for dollar. So ` +
      `${usd(qcdR)} of your ${usd(donR)} gift goes the direct way and ${usd(overFromOffset)} has to be taken out ` +
      `as an ordinary withdrawal instead.</p>`;
  }
  limitNotes += deductionLimitNote(r, donR, dedR);
  limitNotes += topBracketNote(r);

  // ---- The plain-terms box ----------------------------------------------------
  // Not a filing-time deduction, so no FICA note is pasted here: money leaving an
  // IRA is not wages and no payroll tax is charged on it either way, which is
  // what this box says instead. What it must say, and what the take-and-deduct
  // stat card never did, is WHEN the money arrives, that nothing is held back on
  // the way to the charity, and — in the tie band — that the win is an income
  // win rather than a tax win.
  // Guarded on there actually being an excluded amount: when the post-70½ offset
  // has eaten the whole gift, agiA and agiB are the SAME figure, and a sentence
  // promising an income "kept lower at $70,000 instead of $70,000" is the exact
  // shape of claim this file exists to avoid.
  const agiSentence = qcdR > 0
    ? `It also keeps the income your tax is worked out on at ${usd(agiAR)} instead of ${usd(agiBR)}, which is worth ` +
      `having on its own: that figure is what your Medicare premium surcharge and the share of your Social Security ` +
      `that gets taxed are both measured against, and no write-off can move it. `
    : '';

  let plain;
  if (qcdR <= 0) {
    plain = `<div class="otw-plain">With these numbers there is nothing left to send the direct way, so both ` +
      `columns above are describing the same withdrawal and your federal income tax is ${usd(taxBR)} whichever you ` +
      `call it. The rule that took it away is named just above. Money coming out of an IRA is not wages, so no ` +
      `Social Security or Medicare tax is charged on it either way.</div>`;
  } else if (!tie) {
    plain = `<div class="otw-plain">Sending ${usd(qcdR)} straight from your IRA means it never appears on your tax ` +
      `return at all, so there is nothing to write off and nothing held back for tax — the whole amount reaches ` +
      `the charity. You see the ${usd(savedR)} as a smaller tax bill, or a bigger refund, when you file next year, ` +
      `not as a change to anything paid during this one. ${agiSentence}Money coming out of an IRA is not wages, ` +
      `so no Social Security or Medicare tax is charged on it either way.</div>`;
  } else if (taxBR === 0) {
    // The right reason for the $0, not the nearest one: there is no tax here to
    // save, which is a different thing from the §170(p) tie band below.
    plain = `<div class="otw-plain">With these numbers you owe no federal income tax on either route, so there is ` +
      `no tax for the direct route to save. ${agiSentence}It also reaches the charity with nothing held back, ` +
      `which a withdrawal you make yourself does not.</div>`;
  } else if (!r.resB.itemize && donR <= r.resB.nonItemizerCap) {
    plain = `<div class="otw-plain">Your ${usd(donR)} gift is at or below ${usd(r.resB.nonItemizerCap)}, the most ` +
      `anyone who takes the flat deduction may write off for giving, so both routes take the same dollars off the ` +
      `income you are taxed on and your federal tax comes out identical — ${usd(taxAR)} either way. The direct ` +
      `route is still the better one, just not for this year's tax bill. ${agiSentence}It also reaches the ` +
      `charity with nothing held back for tax, which a withdrawal you make yourself does not.</div>`;
  } else {
    plain = `<div class="otw-plain">With these numbers the two routes land on the same federal income tax, ` +
      `${usd(taxAR)} either way, so the saving this year is nothing. ${agiSentence}It also reaches the charity ` +
      `with nothing held back for tax, which a withdrawal you make yourself does not.</div>`;
  }

  return warn + head + lead + directRows + rmdLine + takeRows + limitNotes + plain;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'qcdWizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: GIFT, fields: ['donation'] },
    { step: ACCOUNT, radios: 'accountType' },
    {
      step: AGE,
      fields: ['age'],
      flags: [{ id: 'otwAgeFlag', text: ageWarning }]
    },
    // Two branch cards. Both leave the path the moment the direct route closes,
    // and the required-withdrawal question also leaves it below the age you are
    // first made to take money out, because until then there is no required
    // amount to name.
    { step: RMD, fields: ['rmd'], skipClears: ['rmd'], when: (s) => s.age >= RMD_AGE && directRouteOpen(s) },
    { step: OFFSET, fields: ['offset'], skipClears: ['offset'], when: directRouteOpen },
    { step: INCOME, fields: ['agi'] },
    { step: FILING, radios: 'filing' },
    { step: SPOUSE, radios: 'spouse65', when: (s) => s.filing === 'married' },
    {
      step: OTHER,
      fields: ['other'],
      skipClears: ['other'],
      // On the other-write-offs card rather than the income card: it is the
      // second of the two numbers, so it is the one being typed when the
      // contradiction first exists.
      flags: [{ id: 'otwOtherFlag', text: otherWarning }]
    },
    { step: RESULT, result: true }
  ],

  // The page loads with three numbers nobody typed, and all three change the
  // answer materially: the gift is the subject, the other income sets the
  // bracket, and the age decides whether the direct route exists at all — 75 is
  // ordinary enough to be somebody's real age, so a visitor of 68 who never
  // touched it would otherwise be shown an eligible answer as their own. The
  // closed choices are not listed: a traditional IRA, filing on your own and a
  // spouse under 65 are all real defaults that invent no figure, and the three
  // optional money boxes ship at 0, which is the true answer for most people.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('donation')) missing.push('the amount you want to give');
    if (!touched.has('age')) missing.push('your age');
    if (!touched.has('agi')) missing.push('your other income');
    return missing;
  },

  // Only for cards this visitor is actually on: a chip pointing at a card that
  // has left the path would hand them to whichever card the core normalises
  // forward to, which is a different question from the one on the chip.
  chips: (s) => {
    const open = directRouteOpen(s);
    const items = [
      { step: GIFT, label: `${usd(s.donation)} gift` },
      { step: ACCOUNT, label: ACCOUNT_WORDS[s.accountType] || s.accountType },
      { step: AGE, label: s.age > 0 ? `age ${count(s.age)}` : 'age not given' }
    ];
    if (s.age >= RMD_AGE && open) {
      items.push({ step: RMD, label: s.rmd > 0 ? `${usd(s.rmd)} must come out` : 'no set amount to take out' });
    }
    if (open) {
      items.push({ step: OFFSET, label: s.offset > 0 ? `${usd(s.offset)} paid in since 70½` : 'nothing paid in since 70½' });
    }
    items.push({ step: INCOME, label: `${usd(s.agi)} other income` });
    items.push({ step: FILING, label: FILING_WORDS[s.filing] || s.filing });
    if (s.filing === 'married') {
      items.push({ step: SPOUSE, label: s.spouse65 === 'yes' ? 'spouse 65 or older' : 'spouse under 65' });
    }
    items.push({ step: OTHER, label: s.other > 0 ? `${usd(s.other)} other write-offs` : 'no other write-offs' });
    return items;
  },

  announce: (s, r) => {
    const flagged = (ageWarning(s) || otherWarning(s))
      ? ' Check your numbers, there is a warning above the answer.'
      : '';
    if (s.donation <= 0) return `Add the amount you want to give to see the comparison.${flagged}`;
    if (!r.eligible) {
      const why = !r.accountEligible
        ? 'that account cannot pay a charity directly'
        : r.accountSteerAway
          ? 'a Roth IRA has no income to keep off your return'
          : s.age <= 0 ? 'your age is not filled in' : 'you are not 70½ yet';
      return `Giving straight from the IRA is not open to you here: ${why}. ` +
        `Taking the money out and writing the gift off leaves a federal income tax of ${usd(r.taxB)}.${flagged}`;
    }
    const taxAR = Math.round(r.taxA);
    const savedR = Math.max(0, Math.round(r.taxB) - taxAR);
    const excludedR = Math.min(Math.round(s.donation), Math.round(r.qcdAmount));
    // Same guard as the plain box: with nothing excluded there is no income win
    // to read out, and "keeps your income $0 lower" is a sentence that says
    // nothing while sounding like it says something.
    if (excludedR <= 0) {
      return `Nothing is left to send straight from the IRA with these numbers, so both routes come out at the ` +
        `same federal income tax, ${usd(taxAR)}.${flagged}`;
    }
    return savedR > 0
      ? `Giving straight from your IRA saves ${usd(savedR)} in federal income tax and keeps the income your tax is ` +
        `worked out on ${usd(excludedR)} lower.${flagged}`
      : `Both routes leave your federal income tax the same, at ${usd(taxAR)}. Giving straight from your IRA still ` +
        `keeps the income your tax is worked out on ${usd(excludedR)} lower.${flagged}`;
  }
});
