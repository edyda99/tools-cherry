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

const $ = (id) => document.getElementById(id);
const DC = window.__DC__;
const FED = window.__FED__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
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

  // --- Recommendation banner (a CORNER — one or the other) --------------------
  let recLabel, recSub;
  if (!r.hasEmployerPlan) {
    recLabel = 'Take the Child &amp; Dependent Care Credit';
    recSub = 'Your employer offers no Dependent Care FSA (you set the max to $0), so the credit is your only lever.';
  } else if (winB) {
    recLabel = `Max your Dependent Care FSA at ${usd(B.fsa)}`;
    recSub = `It nets you about ${usd(r.delta)} more than taking the credit. There's no in-between to split — it's one or the other.`;
  } else if (winA) {
    recLabel = 'Skip the FSA and claim the Child &amp; Dependent Care Credit';
    recSub = `It nets you about ${usd(r.delta)} more than maxing the FSA. There's no in-between to split — it's one or the other.`;
  } else {
    recLabel = 'It\'s a toss-up';
    recSub = 'Both strategies net about the same here. Pick either — but you still can\'t blend them on the same dollars.';
  }
  if (r.mfsIneligible) {
    recSub = `Married filing separately can't claim the credit at all (you'd have to file jointly), so the FSA — capped at ${usd(r.fsaCap)} — is your only option.`;
  }

  const banner =
    `<div class="dc-rec ${winB ? 'rec-fsa' : 'rec-credit'}">` +
    `<div class="dc-rec-tag">Recommended</div>` +
    `<div class="dc-rec-head">${recLabel}</div>` +
    `<div class="dc-rec-sub">${recSub}</div>` +
    `</div>`;

  // --- Side-by-side corners ---------------------------------------------------
  const colA =
    `<div class="dc-col ${winA ? 'dc-win' : ''}">` +
    `<div class="dc-col-head">Skip the FSA, take the credit${winA ? ' <span class="dc-badge">Winner</span>' : ''}</div>` +
    `<div class="line"><span>Credit rate at ${usd(A.agi)} AGI</span><span class="num">${r.mfsIneligible ? 'n/a' : pct(A.applicablePercent)}</span></div>` +
    `<div class="line"><span>Creditable expenses (cap ${usd(r.cap)})</span><span class="num">${usd(A.creditableExpenses)}</span></div>` +
    `<div class="line"><span>Child &amp; Dependent Care Credit</span><span class="num">${usd(A.credit)}</span></div>` +
    (A.creditClampedByLiability ? `<div class="obbba-note phaseout-flag">Nonrefundable: the credit is capped at your federal income-tax bill, so it's worth less than its headline rate here.</div>` : '') +
    (r.mfsIneligible ? `<div class="obbba-note ineligible-flag">Married filing separately can't take this credit (§21(e)(2)) — it's $0.</div>` : '') +
    `<div class="line big"><span>Total benefit</span><span class="num">${usd(A.benefit)}</span></div>` +
    `<div class="obbba-note">Income-tax reduction only. A nonrefundable credit never touches Social Security or Medicare.</div>` +
    `</div>`;

  const colB =
    `<div class="dc-col ${winB ? 'dc-win' : ''}">` +
    `<div class="dc-col-head">Max the FSA${winB ? ' <span class="dc-badge">Winner</span>' : ''}</div>` +
    `<div class="line"><span>FSA election (pre-tax)</span><span class="num">${usd(B.fsa)}</span></div>` +
    `<div class="line"><span>Income tax saved</span><span class="num">${usd(B.fsaIncomeTaxSaved)}</span></div>` +
    `<div class="line"><span>FICA (Social Security + Medicare) saved</span><span class="num">${usd(B.fsaFicaSaved)}</span></div>` +
    `<div class="line"><span>Residual credit (after FSA)</span><span class="num">${usd(B.credit)}</span></div>` +
    (B.zeroesCredit ? `<div class="obbba-note phaseout-flag">Your ${usd(B.fsa)} FSA is at or above the ${usd(r.cap)} credit cap, so it zeroes the credit — you can't use both on the same dollars.</div>` : '') +
    `<div class="line big"><span>Total benefit</span><span class="num">${usd(B.benefit)}</span></div>` +
    `<div class="obbba-note">FSA dollars are pre-tax salary, so they cut income tax <strong>and</strong> FICA — the FICA saving lands regardless of your tax bill.</div>` +
    `</div>`;

  // --- Break-even framing -----------------------------------------------------
  const be = r.breakEven;
  const breakEven = r.mfsIneligible
    ? `<div class="dc-breakeven">Your FSA saves about <strong>${pct(be.fsaRate)}</strong> per dollar (your ${pct(be.marginalIncomeRate)} tax bracket + ${pct(be.marginalFicaRate)} FICA). The credit is off the table for married filing separately, so the FSA wins by default.</div>`
    : `<div class="dc-breakeven">Your FSA saves about <strong>${pct(be.fsaRate)}</strong> per dollar (your ${pct(be.marginalIncomeRate)} tax bracket + ${pct(be.marginalFicaRate)} FICA). Your credit rate is <strong>${pct(be.creditRate)}</strong>. Whichever is higher wins — but the calculator settles it exactly above, because the $7,500-vs-$${(r.cap).toLocaleString('en-US')} cap gap and the nonrefundable limit bend that simple rule.</div>`;

  $('out').innerHTML =
    banner +
    `<div class="dc-cols">${colA}${colB}</div>` +
    `<div class="line big dc-delta"><span>Difference between the two</span><span class="num">${usd(r.delta)}</span></div>` +
    breakEven +
    `<div class="takeaway">In plain terms: this is an <strong>all-or-nothing</strong> call you make at open enrollment. Route your care dollars through the FSA <em>or</em> keep them for the credit — every dollar you put in the FSA is a dollar the credit can no longer count.</div>`;
}

function init() {
  ['filing', 'agi', 'kids', 'expenses', 'employerFsa'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
