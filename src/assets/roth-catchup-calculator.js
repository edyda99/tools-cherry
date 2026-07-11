// roth-catchup-calculator.js — SECURE 2.0 §603 mandatory Roth catch-up tool.
// Tells a 50+ earner whether the rule hits them, how much the forced-Roth
// treatment costs this year, and the Roth-vs-pre-tax break-even. All logic runs
// client-side; nothing is uploaded.
import { estimateRothCatchUp } from '/assets/roth-catchup.js';

const $ = (id) => document.getElementById(id);
const RC = window.__ROTHCATCHUP__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const usdSigned = (n) => (n < 0 ? '−$' : '+$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const pct = (n) => Math.round(Math.max(0, n || 0) * 100) + '%';

function num(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : 0;
}

// Plain-English "why not subject / what happens" line, keyed by the engine reason.
function reasonLine(r, year) {
  switch (r.reason) {
    case 'under_50_no_catchup':
      return `You’re under 50, so catch-up contributions don’t apply to you yet — this rule only affects people 50 and older. Nothing here changes your ${year} taxes.`;
    case 'no_prior_year_fica_wages':
      return `You had no Social Security (Box 3) wages from this employer last year, so there’s nothing to test against — you’re not subject, and your catch-up can still go in pre-tax. (This is the case for a partner or sole proprietor whose only earnings are self-employment income.)`;
    case 'wages_at_or_below_threshold':
      return `Your last-year Social Security (Box 3) wages of ${usd(r.wages)} do <strong>not exceed</strong> the ${usd(r.threshold)} threshold, so you’re not a high earner under this rule — your catch-up can still go in <strong>pre-tax</strong>. (Exactly ${usd(r.threshold)} is not over the line.)`;
    case 'pending_irs_guidance':
      return `The IRS hasn’t published the ${year} contribution limits yet, so this tool can’t give a ${year} figure. The annual cost-of-living notice usually comes out in October — check back then.`;
    default:
      if (r.reason && r.reason.startsWith('transition_relief')) {
        return `For ${year} the mandate isn’t enforced — IRS transition relief ran through the end of 2025 — so your catch-up can still go in <strong>pre-tax</strong> this year. It kicks in for 2026 contributions.`;
      }
      return `With these inputs the mandatory-Roth rule doesn’t apply to you.`;
  }
}

function bandLabel(band) {
  if (band === 'super') return 'Ages 60–63 “super” catch-up';
  if (band === 'standard') return 'Standard age-50+ catch-up';
  return 'No catch-up (under 50)';
}

function render() {
  const year = parseInt($('year').value, 10);
  const age = num('age');
  const wages = num('wages');
  const catchUp = num('catchUp');
  const rateNow = parseFloat($('rateNow').value);
  const rateRetire = parseFloat($('rateRetire').value);
  const years = num('years');
  const growth = num('growth') / 100;
  const planOffersRoth = $('planRoth').checked;

  const r = estimateRothCatchUp({
    taxYear: year, age, priorYearFicaWages: wages, planOffersRoth,
    catchUpAmount: catchUp, currentMarginalRate: rateNow, retirementMarginalRate: rateRetire,
    yearsToRetirement: years, growthRate: growth, params: RC
  });

  // --- NOT subject (or n/a) branch -----------------------------------------
  if (!r.subject) {
    const maxLine = r.band !== 'none' && r.maxCatchUp != null
      ? `<div class="line"><span>Your ${year} catch-up band</span><span class="num">${bandLabel(r.band)} — up to ${usd(r.maxCatchUp)}</span></div>`
      : '';
    $('out').innerHTML =
      `<div class="line big"><span>Subject to the mandatory-Roth rule?</span><span class="num ok-flag">No</span></div>` +
      maxLine +
      `<div class="obbba-note">${reasonLine(r, year)}</div>` +
      `<div class="takeaway">Bottom line: you keep your full catch-up room and, with these inputs, you can still make it <strong>pre-tax</strong> — the forced-Roth rule doesn’t touch you here.</div>`;
    return;
  }

  // --- Subject: no-Roth-plan branch ----------------------------------------
  if (r.effect === 'plan_no_roth_cannot_catchup') {
    $('out').innerHTML =
      `<div class="line big"><span>Subject to the mandatory-Roth rule?</span><span class="num warn-flag">Yes</span></div>` +
      `<div class="line"><span>Your ${year} catch-up band</span><span class="num">${bandLabel(r.band)} — normally up to ${usd(r.maxCatchUp)}</span></div>` +
      `<div class="line"><span>Catch-up you can actually make</span><span class="num warn-flag">$0</span></div>` +
      `<div class="obbba-note warn-flag">You’re a high earner subject to the rule, but you told us your plan has <strong>no Roth option</strong>. When that’s the case the plan can simply bar high earners from catch-up contributions altogether — it is <em>not</em> forced to add Roth. So your catch-up capacity is $0 until the plan adds a Roth feature (most large plans are adding one).</div>` +
      `<div class="takeaway">You’re not losing money to tax here — there’s just no catch-up to make in a no-Roth plan. Ask your plan administrator whether a Roth option is coming.</div>`;
    return;
  }

  // --- Subject: must be Roth, but no catch-up elected (n/a path) ------------
  if (!r.mandateBites) {
    $('out').innerHTML =
      `<div class="line big"><span>Subject to the mandatory-Roth rule?</span><span class="num warn-flag">Yes</span></div>` +
      `<div class="line"><span>Your ${year} catch-up band</span><span class="num">${bandLabel(r.band)} — up to ${usd(r.maxCatchUp)}</span></div>` +
      `<div class="line"><span>Catch-up you plan to contribute</span><span class="num">$0</span></div>` +
      `<div class="obbba-note">You’re over the threshold, but with no catch-up contribution there’s nothing to convert — the mandate doesn’t affect you this year. If you do decide to make a catch-up, it will have to go in as Roth.</div>` +
      `<div class="takeaway">Nothing to do: no catch-up means no forced-Roth cost. Enter a catch-up amount above to see what the Roth treatment would cost.</div>`;
    return;
  }

  // --- Subject: mandate bites (the main path) ------------------------------
  const capNote = r.effectiveCatchUp < r.catchUpAmount
    ? `<div class="obbba-note phaseout-flag">You entered ${usd(r.catchUpAmount)}, but the ${year} maximum for your age band is ${usd(r.maxCatchUp)} — figures below use the ${usd(r.maxCatchUp)} cap.</div>`
    : '';

  // Future-value / break-even block (only when both rates are supplied).
  let fvBlock = '';
  if (r.rothAdvantage != null) {
    const wins = r.rothAdvantage >= 0;
    const verdict = wins
      ? `<span class="ok-flag">forced-Roth leaves you about ${usdSigned(r.rothAdvantage)} ahead</span>`
      : `<span class="warn-flag">forced-Roth costs you about ${usdSigned(r.rothAdvantage)}</span>`;
    const why = rateRetire === rateNow
      ? `Your retirement rate equals your current rate, so it’s essentially a wash.`
      : (wins
          ? `Because you expect a <strong>higher</strong> tax rate in retirement (${pct(rateRetire)}) than now (${pct(rateNow)}), paying the tax now at the lower rate comes out ahead.`
          : `Because you expect a <strong>lower</strong> tax rate in retirement (${pct(rateRetire)}) than now (${pct(rateNow)}), you’d have preferred the pre-tax deduction now.`);
    fvBlock =
      `<div class="line"><span>Roth vs. pre-tax at retirement (${years} yr, ${pct(growth)}/yr)</span><span class="num">${verdict}</span></div>` +
      `<div class="obbba-note">${why} Break-even is when your retirement rate equals your current ${pct(rateNow)} — at or above that, forced-Roth is even or better.</div>` +
      `<div class="obbba-note muted-small">Estimate only. It assumes the pre-tax route would have reinvested its upfront tax saving at the same growth, and it doesn’t model state tax, RMD differences, or IRMAA. A Roth also gives you tax-rate diversification and has no required minimum distributions.</div>`;
  } else {
    fvBlock = `<div class="obbba-note muted-small">Add your expected retirement tax rate and years to retirement above to see the Roth-vs-pre-tax break-even.</div>`;
  }

  $('out').innerHTML =
    `<div class="line big"><span>Subject to the mandatory-Roth rule?</span><span class="num warn-flag">Yes</span></div>` +
    `<div class="line"><span>Your ${year} catch-up band</span><span class="num">${bandLabel(r.band)} — up to ${usd(r.maxCatchUp)}</span></div>` +
    `<div class="line"><span>Catch-up that must be Roth (after-tax)</span><span class="num">${usd(r.effectiveCatchUp)}</span></div>` +
    capNote +
    `<div class="line big"><span>Extra federal tax this year</span><span class="num warn-flag">${usd(r.extraTaxThisYear)}</span></div>` +
    `<div class="obbba-note">That’s the upfront deduction you give up on the catch-up: ${usd(r.effectiveCatchUp)} × ${pct(rateNow)} = ${usd(r.extraTaxThisYear)}. You still contribute the full ${usd(r.effectiveCatchUp)} — it just goes in after-tax, then grows and comes out tax-free.</div>` +
    fvBlock +
    `<div class="takeaway">In plain terms: you do <strong>not</strong> lose your catch-up. You keep every dollar of it — the only change is that ${usd(r.effectiveCatchUp)} now goes in as Roth instead of pre-tax, costing you about ${usd(r.extraTaxThisYear)} in this year’s deduction in exchange for tax-free growth later.</div>`;
}

function init() {
  ['year', 'age', 'wages', 'catchUp', 'rateNow', 'rateRetire', 'years', 'growth', 'planRoth'].forEach((id) => {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
