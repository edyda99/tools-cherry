// dependent-care-fsa-vs-credit-calculator.js — the DCFSA-vs-CDCTC decision under
// OBBBA §70404 (TY2026): a Dependent Care FSA (§129, $7,500 / $3,750 MFS,
// pre-tax → saves income tax AND FICA) vs the Child & Dependent Care Credit
// (§21, nonrefundable, 50%→20% AGI-tiered, $3,000/$6,000 expense caps). All
// logic client-side, reusing the paycheck engine's bracket + FICA math.
//
// KEY FRAMING (per the sourced spec): there is NO "optimal split." §129 erodes
// the §21 cap dollar-for-dollar, so the answer is a CORNER — max the FSA or skip
// it and take the credit. Since $7,500 > the $6,000 two-child cap, maxing the FSA
// ALWAYS zeroes the credit. And the credit is NONREFUNDABLE, so at low income it
// can be worth far less than its headline rate while the FSA's FICA saving is not
// liability-limited. MFS filers get $0 credit (§21(e)(2)) — FSA only.
import { dependentCareComparison } from '/assets/dependent-care.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const DC = window.__DC__;
const FED = window.__FED__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "28,000" to 28.
function num(id) {
  const el = $(id);
  if (!el) return 0;
  return moneyValue(el);
}

function render() {
  const filing = $('filing').value;
  const agi = num('agi');
  const numDependents = parseInt($('kids').value, 10) || 1;
  const careExpenses = num('expenses');
  const employerFsaMax = num('employerFsa');

  const r = dependentCareComparison({
    filingStatus: filing, agi, numDependents, careExpenses,
    employerFsaMax, dc: DC, fed: FED
  });

  const A = r.strategyA, B = r.strategyB;
  const winA = r.recommended === 'skip_fsa';
  const winB = r.recommended === 'max_fsa';

  // ---- Answer-first summary (stat card) --------------------------------
  // A CORNER decision — one or the other, so the verdict is short text plus
  // the dollar margin, never a blended split.
  let statValue, statSub, isZero;
  if (!r.hasEmployerPlan) {
    statValue = 'Take the credit';
    statSub = 'Your employer offers no Dependent Care FSA (you set the max to $0), so the credit is your only lever.';
    isZero = true;
  } else if (winB) {
    statValue = `FSA wins by ${usd(r.delta)}`;
    statSub = `Max it at ${usd(B.fsa)} — it nets about ${usd(r.delta)} more than taking the credit. There's no in-between to split — it's one or the other.`;
    isZero = false;
  } else if (winA) {
    statValue = `Credit wins by ${usd(r.delta)}`;
    statSub = `Skip the FSA and claim the Child & Dependent Care Credit — it nets about ${usd(r.delta)} more than maxing the FSA. There's no in-between to split — it's one or the other.`;
    isZero = false;
  } else {
    statValue = "It's a toss-up";
    statSub = 'Both strategies net about the same here. Pick either — but you still can\'t blend them on the same dollars.';
    isZero = true;
  }
  if (r.mfsIneligible) {
    statSub = `Married filing separately can't claim the credit at all (you'd have to file jointly), so the FSA — capped at ${usd(r.fsaCap)} — is your only option.`;
  }
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Dependent Care FSA vs. Child &amp; Dependent Care Credit</p>` +
      `<p class="stat-value${isZero ? ' is-zero' : ''}">${statValue}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- One benefit per option, side by side (decorative, so aria-hidden) --
  const barMax = Math.max(A.benefit, B.benefit, 1);
  const aPct = Math.min(100, (A.benefit / barMax) * 100).toFixed(1);
  const bPct = Math.min(100, (B.benefit / barMax) * 100).toFixed(1);
  const compareBars = r.hasEmployerPlan
    ? `<div class="compare-bars" aria-hidden="true">` +
        `<div class="cb-row"><span>Credit ${usd(A.benefit)}</span><span class="cb-track"><span class="cb-fill${winB ? ' cb-over' : ''}" style="width:${aPct}%"></span></span></div>` +
        `<div class="cb-row"><span>FSA ${usd(B.benefit)}</span><span class="cb-track"><span class="cb-fill${winA ? ' cb-over' : ''}" style="width:${bPct}%"></span></span></div>` +
      `</div>`
    : '';

  // ---- One headline caveat shown OUTSIDE the details ---------------------
  const headlineCaveat = (r.hasEmployerPlan && r.notes.includes('max_fsa_zeroes_credit'))
    ? `<div class="obbba-note phaseout-flag">Heads up: the ${usd(r.fsaCap)} FSA limit is at or above the ${usd(r.cap)} credit cap, so maxing the FSA always zeroes the credit — there's no partial split (see the breakdown).</div>`
    : '';

  // --- Side-by-side corners, moved into the derivation panel ------------------
  const colA =
    `<p><strong>Skip the FSA, take the credit${winA ? ' — wins' : ''}</strong></p>` +
    `<div class="line"><span>Credit rate at ${usd(A.agi)} AGI</span><span class="num">${r.mfsIneligible ? 'n/a' : pct(A.applicablePercent)}</span></div>` +
    `<div class="line"><span>Creditable expenses (cap ${usd(r.cap)})</span><span class="num">${usd(A.creditableExpenses)}</span></div>` +
    `<div class="line"><span>Child &amp; Dependent Care Credit</span><span class="num">${usd(A.credit)}</span></div>` +
    (A.creditClampedByLiability ? `<div class="obbba-note phaseout-flag">Nonrefundable: the credit is capped at your federal income-tax bill, so it's worth less than its headline rate here.</div>` : '') +
    (r.mfsIneligible ? `<div class="obbba-note ineligible-flag">Married filing separately can't take this credit (§21(e)(2)) — it's $0.</div>` : '') +
    `<div class="line big"><span>Total benefit</span><span class="num">${usd(A.benefit)}</span></div>` +
    `<div class="obbba-note">Income-tax reduction only. A nonrefundable credit never touches Social Security or Medicare.</div>`;

  const colB =
    `<p><strong>Max the FSA${winB ? ' — wins' : ''}</strong></p>` +
    `<div class="line"><span>FSA election (pre-tax)</span><span class="num">${usd(B.fsa)}</span></div>` +
    `<div class="line"><span>Income tax saved</span><span class="num">${usd(B.fsaIncomeTaxSaved)}</span></div>` +
    `<div class="line"><span>FICA (Social Security + Medicare) saved</span><span class="num">${usd(B.fsaFicaSaved)}</span></div>` +
    `<div class="line"><span>Residual credit (after FSA)</span><span class="num">${usd(B.credit)}</span></div>` +
    (B.zeroesCredit ? `<div class="obbba-note phaseout-flag">Your ${usd(B.fsa)} FSA is at or above the ${usd(r.cap)} credit cap, so it zeroes the credit — you can't use both on the same dollars.</div>` : '') +
    `<div class="line big"><span>Total benefit</span><span class="num">${usd(B.benefit)}</span></div>` +
    `<div class="obbba-note">FSA dollars are pre-tax salary, so they cut income tax <strong>and</strong> FICA — the FICA saving lands regardless of your tax bill.</div>`;

  // --- Break-even framing -----------------------------------------------------
  const be = r.breakEven;
  const breakEven = r.mfsIneligible
    ? `<div class="obbba-note">Your FSA saves about <strong>${pct(be.fsaRate)}</strong> per dollar (your ${pct(be.marginalIncomeRate)} tax bracket + ${pct(be.marginalFicaRate)} FICA). The credit is off the table for married filing separately, so the FSA wins by default.</div>`
    : `<div class="obbba-note">Your FSA saves about <strong>${pct(be.fsaRate)}</strong> per dollar (your ${pct(be.marginalIncomeRate)} tax bracket + ${pct(be.marginalFicaRate)} FICA). Your credit rate is <strong>${pct(be.creditRate)}</strong>. Whichever is higher wins — but the calculator settles it exactly above, because the $7,500-vs-$${(r.cap).toLocaleString('en-US')} cap gap and the nonrefundable limit bend that simple rule.</div>`;

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      colA +
      colB +
      `<div class="line big"><span>Difference between the two</span><span class="num">${usd(r.delta)}</span></div>` +
      breakEven +
    `</details>`;

  const out = $('out');
  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    compareBars +
    headlineCaveat +
    derivation +
    `<div class="takeaway">In plain terms: this is an <strong>all-or-nothing</strong> call you make at open enrollment. Route your care dollars through the FSA <em>or</em> keep them for the credit — every dollar you put in the FSA is a dollar the credit can no longer count.</div>`;

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function init() {
  initMoneyInputs();
  ['filing', 'agi', 'kids', 'expenses', 'employerFsa'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
}

function __bootInit() {
  try {
    init();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState !== 'loading') __bootInit();
else document.addEventListener('DOMContentLoaded', __bootInit);
