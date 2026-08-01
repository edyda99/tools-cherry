// 1099-threshold-wizard.js — the card-by-card flow on /1099-threshold-checker/.
// Answers one question: which 1099, if any, should you expect from this payer?
// All logic client-side; nothing uploaded.
//
// This file drives the MAIN page only. The /embed/ build keeps its single-column
// form and is still served by 1099-threshold-checker.js; the two must stay
// independent, so nothing here reads or writes an id the embed also ships except
// through its own page's DOM. The two form ids differ on purpose (#f1099WizForm
// here, #f1099Form there) so the structural pins can tell the builds apart.
//
// WHAT CHANGED FROM THE OLD PAGE. The old script hid three fields by hand
// (updateFieldVisibility() set style.display off #payerType) and a fourth sat
// behind a yes/no. That is exactly what a path predicate does properly, so those
// four are cards with a when() now, and the tool script no longer owns any
// visibility. The derivation panel is gone: what it held was the only real
// content on the page, so it is the story on the answer card instead.
//
// THE MATH is one engine call into the shared form-1099-checker, unchanged. The
// three rules it applies are genuinely different from each other, which is why
// the flow branches rather than asking everything of everybody:
//   payment app   dollars AND payment count, both strictly exceeded
//   card          no minimum at all, ever
//   direct        one dollar floor, reached or passed, and it moves by year
import { check1099 } from '/assets/form-1099-checker.js';
import { mountWizard, $, moneyOf, numOf, radioOf, selectOf, usd, count } from '/assets/wizard-core.js';

const DATA = window.__FORM1099__;
const STATES = window.__FORM1099_STATES__ || [];
// Null-guarded because a missing injection must reach check1099() and throw
// there, inside mountWizard's try, rather than at module scope where the shared
// "this calculator failed to load" banner would never get the chance to run.
const NET = (DATA && DATA.form1099K && DATA.form1099K.network) || {};
const OVERRIDES = (DATA && DATA.stateOverrides1099K) || {};
const GROSS = NET.grossThreshold || 0;
const TXNS = NET.txnThreshold || 0;

// data-step on each card. RESULT is the last card and is never skipped.
const PAYER = 0, NATURE = 1, AMOUNT = 2, TXN = 3, PURPOSE = 4, YEAR = 5, STATE = 6, RESULT = 7;

const STATE_NAME = {};
STATES.forEach((s) => { STATE_NAME[s.abbr] = s.name; });

// ---- Reading the cards ------------------------------------------------------
function read() {
  return {
    payerType: radioOf('payerType', 'network'),
    paymentNature: radioOf('paymentNature', 'business'),
    paymentPurpose: radioOf('paymentPurpose', 'services'),
    taxYear: parseInt(radioOf('taxYear', '2026'), 10) || 2026,
    amount: moneyOf('amount'),
    transactions: numOf('transactions'),
    state: selectOf('state')
  };
}

// ---- The path ---------------------------------------------------------------
// Four routes through the same seven questions. The predicates are written
// against the state object rather than the DOM so the core can re-evaluate them
// on every keystroke: choosing "a friend paying me back" has to drop the rest of
// the flow on that click, not on the next Next.
const isNetwork = (s) => s.payerType === 'network';
const isDirect = (s) => s.payerType === 'direct';
const isPersonal = (s) => isNetwork(s) && s.paymentNature === 'personal';
// Personal money is not income at any amount, so every question after it is
// dead: nothing typed into them can change "no form is due".
const asksAmount = (s) => !isPersonal(s);
const asksTxns = (s) => isNetwork(s) && !isPersonal(s);
// The year moves only the direct-payment floor ($600 for 2025, $2,000 from
// 2026). The app rule is the same in 2025 and 2026 and the card rule has never
// had a figure at all, so asking those two visitors the year is asking for
// something we then ignore.
const asksYear = (s) => isDirect(s);
// States layer their own, lower limits onto the 1099-K only. A business paying
// you directly follows the federal floor alone, so the state card is not on that
// path and no state note renders there.
const asksState = (s) => !isDirect(s) && !isPersonal(s);

// ---- Normalising for the engine ---------------------------------------------
// The DOM keeps whatever the visitor chose on a card that has since left their
// path — pick "personal" on the app branch, switch to card, and #paymentNature
// still reads personal. Passing that through would suppress the card branch's
// state overlay for a reason the visitor cannot see, so every off-path answer is
// normalised back to its default here, exactly as the old script did.
const compute = (s) => check1099({
  taxYear: s.taxYear,
  payerType: s.payerType,
  amount: asksAmount(s) ? s.amount : 0,
  transactions: asksTxns(s) ? s.transactions : 0,
  paymentNature: isNetwork(s) ? s.paymentNature : 'business',
  paymentPurpose: isDirect(s) ? s.paymentPurpose : 'services',
  state: asksState(s) ? s.state : '',
  data: DATA
});

const PAYER_WORD = {
  network: 'this payment app',
  card: 'this card processor',
  direct: 'this business'
};
const PAYER_CHIP = {
  network: 'paid through an app',
  card: 'paid by card',
  direct: 'paid by a business'
};
const NATURE_CHIP = { business: 'for work or sales', personal: 'personal money' };
const PURPOSE_CHIP = { services: 'for work I did', rent_other: 'for rent or other income' };

// ---- The one cross-check these answers allow --------------------------------
// Dollars and a payment count describe the same pile of money, so a count of
// nothing beside a real total (or the reverse) is not an unusual answer, it is
// an impossible one — and it is the expensive kind, because a zero count fails
// the 200-payment test on its own and the answer then reads "no 1099-K" however
// large the dollars are. Never blocking: the answer still computes underneath,
// the doubt just travels with it, and it travels to BOTH places — the card that
// asks for the second of the two numbers, and the answer, because a visitor who
// presses Next may never come back to the card.
function txnWarning(s) {
  if (!asksTxns(s)) return '';
  if (s.amount > 0 && s.transactions <= 0) {
    return `Check these numbers: you entered ${usd(s.amount)} in payments but no payment count at all. ` +
      `A 1099-K needs more than ${count(TXNS)} separate payments as well as more than ${usd(GROSS)}, so a count of zero ` +
      `makes the answer read "no 1099-K" however big the dollars are. Put in roughly how many payments made up that ${usd(s.amount)}.`;
  }
  if (s.transactions > 0 && s.amount <= 0) {
    return `Check these numbers: you entered ${count(s.transactions)} separate payments but ${usd(0)} in total, ` +
      `and that many payments cannot add up to nothing. Put in what those payments came to over the year.`;
  }
  return '';
}

// ---- State conformity -------------------------------------------------------
function fillStates() {
  const sel = $('state');
  if (!sel) return;
  STATES.slice()
    .filter((s) => s && s.abbr && s.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((s) => {
      const o = document.createElement('option');
      o.value = s.abbr; o.textContent = s.name;
      sel.appendChild(o);
    });
}

const STATE_CAVEAT = 'State reporting rules change most years and sources disagree on a few of them. ' +
  'Treat this as a heads-up rather than a ruling, and check with your own state\'s tax agency.';

// The core opens this helper the first time each state renders, because the
// visitor asked the question out loud on the card before it. Returning null
// hides it, which is what an unanswered — or no longer relevant — state card
// should look like.
function stateParts(abbr) {
  if (!abbr) return null;
  const s = read();
  if (!asksState(s)) return null;          // the card is off this visitor's path
  const name = STATE_NAME[abbr] || abbr;
  const entry = OVERRIDES[abbr];
  if (!entry) {
    return {
      summary: `What about my state? ${name} sets no lower limit of its own`,
      body: `<strong>${name}:</strong> we hold no separate state 1099-K limit for ${name}, so the federal answer above is ` +
        `the whole story.<div class="otw-note">${STATE_CAVEAT}</div>`
    };
  }
  const isObj = entry != null && typeof entry === 'object';
  const stateAmt = isObj ? entry.amount : entry;
  const stateTxns = isObj && entry.txns != null ? entry.txns : null;
  const cond = isObj && entry.condition ? ` (${entry.condition})` : '';
  const alsoTxns = stateTxns != null ? ` and ${count(stateTxns)} payments together` : '';
  // One state (Illinois) pairs a dollar figure with a payment count, so the
  // visitor's side of that comparison has to carry both numbers too. Only ever
  // used on the TRIGGERED sentence, where both legs are known to have passed and
  // therefore a real payment count was in play: the card branch feeds the engine
  // a count of zero, so a two-part rule can never trigger there and this can
  // never print "across 0 payments".
  const yours = stateTxns != null
    ? `${usd(s.amount)} across ${count(s.transactions)} payments`
    : usd(s.amount);
  const r = compute(s);
  // Both numbers, always: the state's line and the visitor's own figure. A
  // sentence naming only the state's line leaves a reader guessing which side of
  // it they are on, which is the whole question they came with. The
  // not-triggered wording for a two-part state rule deliberately does NOT claim
  // the visitor is under the dollar line: with a count condition attached, the
  // leg that failed may have been the count, and "your $8,000 is under the
  // $1,000 line" would be a false sentence on that path.
  const phrase = r.stateOverlay
    ? (r.willIssue
      ? `${name} also asks for a 1099-K from ${usd(stateAmt)}${alsoTxns}${cond}, and your ${yours} is past that, ` +
        `so a state copy may arrive alongside the federal one.`
      : `Even with no federal 1099-K, ${name} asks for one from ${usd(stateAmt)}${alsoTxns}${cond}, and your ${yours} ` +
        `is past that, so you may still get one.`)
    : stateTxns != null && !asksTxns(s)
      // A two-part state rule on a branch we never asked the payment count on.
      // Saying "your figures do not clear it" would read as a claim about the
      // dollars, which may well be past the state's line — the leg we cannot
      // test is the count. So the note says what it cannot answer instead.
      ? `${name} pairs its ${usd(stateAmt)} limit with a count of ${count(stateTxns)} payments${cond}, and we only ask for a ` +
        `payment count on the payment-app branch. So this one is a question for ${name} rather than for us.`
      : stateTxns != null
        ? `${name} asks for a 1099-K from ${usd(stateAmt)}${alsoTxns}${cond}, well under the federal ${usd(GROSS)}. ` +
          `Your ${usd(s.amount)} across ${count(s.transactions)} payments does not clear both, so it changes nothing here.`
        : `${name} asks for a 1099-K from ${usd(stateAmt)}${cond}, which is lower than the federal ${usd(GROSS)}. ` +
          `Your ${usd(s.amount)} is under the ${name} line too, so it changes nothing here.`;
  return {
    summary: `What about my state? ${name} sets a lower limit of its own`,
    body: `<strong>${name}:</strong> ${phrase}<div class="otw-note">${STATE_CAVEAT}</div>`
  };
}

// ---- The answer -------------------------------------------------------------
const MYTH = (r) => (r && r.mythBust) ||
  'A 1099 is paperwork, not a new tax. Whether or not you get one, taxable income is still taxable and must be reported. No form does not mean no tax.';

function formName(s, r) {
  if (r.form) return r.form;
  if (isDirect(s)) return s.paymentPurpose === 'rent_other' ? '1099-MISC' : '1099-NEC';
  return '1099-K';
}

function renderResult({ state: s, result: r }) {
  const warning = txnWarning(s);
  const warnBox = warning ? `<div class="ot-input-warning">${warning}</div>` : '';

  const personal = r.reason === 'personal_transfer';
  const name = formName(s, r);
  const payer = PAYER_WORD[s.payerType] || 'this payer';
  const amtR = Math.round(Math.max(0, s.amount));
  const txnR = Math.round(Math.max(0, s.transactions));
  const noFigures = !personal && amtR <= 0;

  const big = personal ? 'No form' : r.willIssue ? `A ${name}` : 'No 1099';
  const head =
    `<p class="otw-kick">What ${payer} sends you in January</p>` +
    `<p class="otw-big${r.willIssue ? '' : ' otw-zero'}">${big}</p>`;

  // ---- The story ------------------------------------------------------------
  // Suppressed entirely when there is nothing to tell: personal money is not
  // measured against anything, and an empty amount has no figures to lay beside
  // a limit. The plain box below carries the reason in both cases, so leaving
  // the lead in would print an introduction to rows that are not there.
  let lead = '';
  let rows = '';
  let why = '';
  let flag = '';

  if (personal) {
    why = `Personal money is not income, so no form is due on it however much of it there is. ` +
      `If the app tagged it as goods and services by mistake you could still get a 1099-K anyway; fix the tag with the app, ` +
      `or reconcile it on your return. If part of what the app paid you really was for work or for something you sold, ` +
      `go back and answer that question the other way, because that part is taxable whether a form arrives or not.`;
  } else if (noFigures) {
    // Names the reason the screen is empty, and names the RIGHT one: "no 1099"
    // over a form nobody has filled in is a verdict on nothing.
    why = `You have not put an amount in yet. Add what ${payer} paid you over the whole calendar year `;
    why += isNetwork(s)
      ? `and we will measure it against the ${usd(GROSS)} and ${count(TXNS)}-payment lines.`
      : s.payerType === 'card'
        ? `and we will tell you what it means. A card processor reports every dollar it puts through, so any amount at all comes on a 1099-K.`
        : `and we will measure it against the ${usd(Math.round(r.floor || 0))} where a ${name} starts for ${s.taxYear}.`;
  } else if (isNetwork(s)) {
    // Two independent tests, so the rows carry the visitor's figure and the line
    // it is measured against side by side, and the closing row counts how many
    // of the two are past their line. It is DERIVED from the two rows above it
    // rather than restated, so it always reconciles with them; it carries
    // otw-after because it is a count of the rows, not another figure to add in.
    const passed = (r.dollarsExceeded ? 1 : 0) + (r.txnsExceeded ? 1 : 0);
    lead = `<p class="otw-lead">A payment app applies two tests, and it only sends a form when your figures are past both:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>What this app paid you, against the ${usd(GROSS)} line</span>` +
        `<span class="otw-amt">${usd(amtR)}</span></li>` +
      `<li><span>How many separate payments, against the ${count(TXNS)} line</span>` +
        `<span class="otw-amt">${count(txnR)}</span></li>` +
      // Muted, not accented: otw-free means "money the government skips tax on"
      // and nothing on this page is money being freed or taxed. Colouring a
      // count of passed tests with it would borrow a meaning the palette does
      // not have here, and "2 of 2" is not good news anyway — it means a form.
      `<li class="otw-after"><span>Lines you are past, and a 1099-K needs both</span>` +
        `<span class="otw-amt otw-taxed">${passed} of 2</span></li>` +
      `</ul>`;

    // Both numbers on both sides of each test, and the shortfalls are derived by
    // subtraction from the rounded figures already on screen so a reader who
    // does the arithmetic themselves gets the same answer we printed.
    const dollarShort = Math.max(0, GROSS - amtR);
    const txnShort = Math.max(0, TXNS - txnR);
    if (r.dollarsExceeded && r.txnsExceeded) {
      why = `Your ${usd(amtR)} is past the ${usd(GROSS)} line and your ${count(txnR)} payments are past the ${count(TXNS)} line, ` +
        `so the app has to send you a 1099-K and a copy of it to the IRS.`;
    } else if (r.dollarsExceeded) {
      why = `Your ${usd(amtR)} is past the ${usd(GROSS)} line, but ${count(txnR)} payments is short of the ${count(TXNS)} line ` +
        `by ${count(txnShort)}, and the app needs both. So no 1099-K, on the dollars alone.`;
    } else if (r.txnsExceeded) {
      why = `Your ${count(txnR)} payments are past the ${count(TXNS)} line, but ${usd(amtR)} is short of the ${usd(GROSS)} line ` +
        `by ${usd(dollarShort)}, and the app needs both. So no 1099-K, on the payment count alone.`;
    } else {
      why = `Your ${usd(amtR)} is ${usd(dollarShort)} short of the ${usd(GROSS)} line and your ${count(txnR)} payments are ` +
        `${count(txnShort)} short of the ${count(TXNS)} line, so no 1099-K from this app.`;
    }
    // Only where it can still change somebody's answer. Said over a visitor who
    // is already past both lines it is a non-sequitur, and the sentence exists to
    // stop a near-miss being read as a hit.
    if (passed < 2) {
      why += ` Both lines have to be passed, not just reached: exactly ${usd(GROSS)} and exactly ${count(TXNS)} payments sends nothing.`;
    }

    if (passed === 1) {
      flag = `<p class="otw-flag">Heads up: you are past one line and short of the other, which is the trap this rule sets. ` +
        `Clearing ${usd(GROSS)} by a mile still sends nothing while the payment count stays under ${count(TXNS)}, and the same ` +
        `holds the other way round.</p>`;
    }
  } else if (s.payerType === 'card') {
    lead = `<p class="otw-lead">A card processor has no limit to measure you against at all:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>What this card processor put through for you</span><span class="otw-amt">${usd(amtR)}</span></li>` +
      `<li class="otw-after"><span>The most it is allowed to leave off a 1099-K</span><span class="otw-amt">${usd(0)}</span></li>` +
      `</ul>`;
    why = `Every card payment is reportable, so your ${usd(amtR)} is on a 1099-K from the processor whatever its size.`;
    flag = `<p class="otw-flag">Heads up: this is a separate rule from the ${usd(GROSS)}-and-${count(TXNS)}-payments one that ` +
      `payment apps follow, not a smaller version of it. "Stripe won't send anything under ${usd(GROSS)}" is the most common ` +
      `mix-up on this page, and it is backwards.</p>`;
  } else {
    const floorR = Math.round(Math.max(0, r.floor || 0));
    // Derived by subtraction from the two rounded figures above it, never
    // rounded on its own, so the gap the reader can work out from the rows is
    // the gap we print.
    const gap = Math.abs(floorR - amtR);
    lead = `<p class="otw-lead">A business paying you directly is measured against one figure for the year:</p>`;
    rows =
      `<ul class="otw-story">` +
      `<li><span>What this business paid you in ${s.taxYear}</span><span class="otw-amt">${usd(amtR)}</span></li>` +
      `<li><span>Where a ${name} starts in ${s.taxYear}${r.indexed ? ', estimated' : ''}</span>` +
        `<span class="otw-amt">${usd(floorR)}</span></li>` +
      `<li class="otw-after"><span>${r.willIssue ? (gap === 0 ? 'You are exactly on the line' : 'How far past that you are') : 'Still to go before one is sent'}</span>` +
        `<span class="otw-amt otw-taxed">${usd(gap)}</span></li>` +
      `</ul>`;
    why = r.willIssue
      ? `Your ${usd(amtR)} has reached the ${usd(floorR)} where a ${name} starts for ${s.taxYear}, so the business should send ` +
        `you one. This limit is "or more", so landing exactly on ${usd(floorR)} still gets a form.`
      : `Your ${usd(amtR)} is under the ${usd(floorR)} where a ${name} starts for ${s.taxYear}, so this business is not ` +
        `required to send one. Another ${usd(gap)} from the same business this year and it would be.`;
    if (r.indexed) {
      flag = `<p class="otw-flag">Heads up: the ${s.taxYear} figure has not been published. We are showing ${usd(floorR)}, ` +
        `the 2026 limit carried forward, as an estimate — the real ${s.taxYear} number is that plus an inflation adjustment, ` +
        `and the IRS has not said yet what it is.</p>`;
    }
  }

  // ---- The plain box --------------------------------------------------------
  // This tool is not a deduction, so the deduction family's "it arrives as a
  // bigger refund and FICA is still owed" note does not apply and is not pasted
  // here. What a reader has to leave with instead is the myth-bust: the form is
  // a copy of a payment record, and it neither creates tax nor excuses it. Both
  // benchmark misreads of this page ("no 1099, so it's tax-free" and "a 1099-K
  // means I owe tax I didn't before") are answered by that one paragraph, so it
  // rides beside the verdict rather than behind a tap.
  const plain = personal
    ? `<div class="otw-plain">${why}</div>`
    : `<div class="otw-plain">${why} ${MYTH(r)}</div>`;

  return warnBox + head + lead + rows + flag + plain;
}

// ---- The flow ---------------------------------------------------------------
mountWizard({
  stage: 'f1099Wizard',
  read,
  compute,
  renderResult,

  cards: [
    { step: PAYER, radios: 'payerType' },
    { step: NATURE, radios: 'paymentNature', when: isNetwork },
    { step: AMOUNT, fields: ['amount'], when: asksAmount },
    {
      step: TXN,
      fields: ['transactions'],
      when: asksTxns,
      // On the payment-count card rather than the amount card: it is the second
      // of the two numbers, so it is the one being typed when the contradiction
      // can first exist.
      flags: [{ id: 'otwTxnFlag', text: txnWarning }]
    },
    { step: PURPOSE, radios: 'paymentPurpose', when: isDirect },
    { step: YEAR, radios: 'taxYear', when: asksYear },
    { step: STATE, fields: ['state'], when: asksState, skipClears: ['state'] },
    { step: RESULT, result: true }
  ],

  stateNote: { box: 'otwStateNote', select: 'state', render: stateParts },

  // The page loads with two numbers nobody typed — $8,000 paid across 60
  // payments — and both are ordinary enough to be somebody's real year, so the
  // answer stays labelled an example until the visitor has supplied both.
  //
  // Deliberately NOT narrowed to the current branch. The core REMOVES the note
  // element the first time this returns an empty list and only puts it back on
  // Start over, so a branch-dependent list would drop the label for good the
  // moment someone walked a path that does not use one of the two figures, and
  // then present our number as theirs when they walked back. Naming a figure the
  // current branch happens not to use is the smaller error of the two.
  //
  // The four radio groups are not listed: each has a real default that is true
  // for a lot of visitors, and none of them invents a figure.
  exampleMissing: (s, touched) => {
    const missing = [];
    if (!touched.has('amount')) missing.push('what you were paid');
    if (!touched.has('transactions')) missing.push('how many payments that was');
    return missing;
  },

  // Only the cards this visitor's path actually contains: a chip pointing at a
  // question they were never asked would hand them to whichever card the core
  // normalises to instead, which is a different question than the chip named.
  chips: (s) => {
    const out = [{ step: PAYER, label: PAYER_CHIP[s.payerType] || s.payerType }];
    if (isNetwork(s)) out.push({ step: NATURE, label: NATURE_CHIP[s.paymentNature] || s.paymentNature });
    if (asksAmount(s)) out.push({ step: AMOUNT, label: usd(s.amount) });
    if (asksTxns(s)) out.push({ step: TXN, label: `${count(s.transactions)} payments` });
    if (isDirect(s)) out.push({ step: PURPOSE, label: PURPOSE_CHIP[s.paymentPurpose] || s.paymentPurpose });
    if (asksYear(s)) out.push({ step: YEAR, label: String(s.taxYear) });
    if (asksState(s)) out.push({ step: STATE, label: s.state ? (STATE_NAME[s.state] || s.state) : 'no state' });
    return out;
  },

  announce: (s, r) => {
    const name = formName(s, r);
    const verdict = r.reason === 'personal_transfer'
      ? 'No form: personal money is not income.'
      : r.willIssue
        ? `Expect a ${name} from ${PAYER_WORD[s.payerType] || 'this payer'}.`
        : `No 1099 expected from ${PAYER_WORD[s.payerType] || 'this payer'}.`;
    const overlay = r.stateOverlay ? ' Your state sets a lower limit of its own, see the note under the answer.' : '';
    return `${verdict} A 1099 is paperwork, not a new tax.${overlay}` +
      (txnWarning(s) ? ' Check your numbers, there is a warning above the answer.' : '');
  },

  // Before the snapshot so Start over restores the empty option this page ships
  // with, not whichever state was chosen since.
  onBeforeSnapshot: fillStates
});
