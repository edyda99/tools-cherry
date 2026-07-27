// app.js — wires the form to the engine and renders results live.
// Each generated state page injects window.__TAX_DATA__ (federal + that state)
// and window.__STATE_SLUG__ before this module loads.
import { computePaycheck, PAY_PERIODS, federalBracketBreakdown } from '/assets/paycheck-engine.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
const taxData = window.__TAX_DATA__;
const stateSlug = window.__STATE_SLUG__;

const usd = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n * 100).toFixed(1) + '%';
const ratePct = (n) => (+(n * 100).toFixed(3)).toString() + '%'; // 0.10 -> "10%", 0.00432 -> "0.432%"
const escLbl = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// What the three rate figures say while the pay field is empty. The honest
// behaviour is to decline to answer — a rate computed from no pay is not zero,
// it is unknown — but the previous placeholder said "n/a", an abbreviation
// aimed at a reader who already knows the convention, on pages whose whole
// premise is plain language. This says the same thing in words, and echoes the
// wording already under the headline figure ("Enter your pay above to see your
// take-home") so the panel speaks with one voice. All three rows share it, so
// they cannot drift apart.
const NO_PAY_YET = 'enter your pay';

const $ = (id) => document.getElementById(id);
// Comma-safe: the advanced-mode deduction fields carry live thousands
// separators, so read them through moneyValue rather than a raw parseFloat,
// which would silently truncate "2,000" to 2.
const num = (id) => moneyValue($(id)) || 0;

// Same grouping style as money-input.js writes into the money fields, so a
// value we set programmatically keeps the separators the visitor sees.
const fmtAmount = (n, dp) => n.toLocaleString('en-US', { maximumFractionDigits: dp });

// True until the visitor edits the form, i.e. while the figure on screen is
// still the page's own worked example rather than the visitor's own numbers.
let exampleLive = true;

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'simple';
}

function currentView() {
  const checked = document.querySelector('input[name="view"]:checked');
  return checked ? checked.value : 'period';
}

function readForm() {
  const wageType = $('wageType').value; // 'salary' | 'hourly'
  const amount = moneyValue($('amount')) || 0;
  const hoursPerWeek = parseFloat($('hours').value) || 40;
  const input = {
    wage: { type: wageType, amount, hoursPerWeek },
    filingStatus: $('filingStatus').value,
    payFrequency: $('payFrequency').value,
    stateSlug
  };
  if (currentMode() === 'advanced') {
    input.adv = {
      retirement401k: num('retirement401k'),
      cafeteria125: num('cafeteria125'),
      dependentsCredit: num('dependentsCredit'),
      extraWithholding: num('extraWithholding'),
      postTax: num('postTax')
    };
  }
  return input;
}

const PERIOD_LABEL = {
  weekly: 'per week', biweekly: 'per 2 weeks', semimonthly: 'twice a month',
  monthly: 'per month', annual: 'per year'
};

// Caption for the headline figure, so a number and the assumptions behind it are
// provably computed from the same inputs. build.js pre-renders the default-input
// version of this exact sentence (stateNetLabel), so the first render overwrites
// it with an identical string and nothing visibly changes on load.
const PAID_LABEL = {
  weekly: 'paid every week', biweekly: 'paid every 2 weeks', semimonthly: 'paid twice a month',
  monthly: 'paid monthly', annual: 'paid once a year'
};
const FILING_LABEL = {
  single: 'single filer', married: 'married filing jointly', head_of_household: 'head of household'
};

function netLabelText(input) {
  const name = taxData.states[stateSlug]?.name;
  if (!name) return '';
  const filing = FILING_LABEL[input.filingStatus] || FILING_LABEL.single;
  const paid = PAID_LABEL[input.payFrequency] || PAID_LABEL.biweekly;
  const basis = input.wage.type === 'hourly'
    ? `${usd2(input.wage.amount)} an hour over ${input.wage.hoursPerWeek} hours a week`
    : `a ${usd(input.wage.amount)} salary`;
  return `Based on ${basis} in ${name}, ${filing}, ${paid}`;
}

function renderBreakdown(r) {
  const g = r.annual.gross;
  if (g <= 0) { $('breakdown').style.display = 'none'; return; }
  $('breakdown').style.display = '';
  const taxes = r.annual.totalTax;
  const ded = r.annual.preTax + r.annual.postTax + (r.annual.statePrograms || 0);
  const net = r.annual.net;
  const w = (v) => (v / g * 100).toFixed(2) + '%';
  $('segNet').style.width = w(net);
  $('segTax').style.width = w(taxes);
  $('segDed').style.width = w(ded);
  $('lgNet').textContent = pct(net / g);
  $('lgTax').textContent = pct(taxes / g);
  $('lgDed').textContent = pct(ded / g);
  $('lgDedWrap').style.display = ded > 0 ? '' : 'none';
}

function render() {
  const input = readForm();
  // hourly fields visibility
  $('hoursField').style.display = input.wage.type === 'hourly' ? '' : 'none';

  const r = computePaycheck(input, taxData);
  const annualView = currentView() === 'annual';
  const p = annualView ? r.annual : r.perPaycheck;

  $('netBig').textContent = usd2(p.net);
  $('netSub').textContent = annualView
    ? `take-home per year · ${usd2(r.perPaycheck.net)} ${PERIOD_LABEL[r.payFrequency]}`
    : `take-home ${PERIOD_LABEL[r.payFrequency]} · ${usd(r.annual.net)}/yr`;

  // Only the state paycheck pages carry the caption; guard so shared consumers
  // of this module are unaffected.
  const lbl = $('netLabel');
  if (lbl) lbl.textContent = netLabelText(input);

  $('rGross').textContent = usd2(p.gross);
  $('rFederal').textContent = '−' + usd2(p.federal);
  $('rSS').textContent = '−' + usd2(p.socialSecurity);
  $('rMedicare').textContent = '−' + usd2(p.medicare);
  $('rState').textContent = '−' + usd2(p.state);
  $('rNet').textContent = usd2(p.net);

  $('rEff').textContent = isZero ? NO_PAY_YET : pct(r.annual.effectiveRate);
  // Guarded like its two neighbours: with no pay entered there is no take-home
  // share to report, and "0.0%" would claim the visitor keeps none of their pay.
  $('rTake').textContent = isZero ? NO_PAY_YET : pct(r.annual.takeHomeRate);

  // federal bracket-by-bracket breakdown + marginal rate (reuses the engine's brackets)
  const preTax = input.adv ? (input.adv.retirement401k || 0) + (input.adv.cafeteria125 || 0) : 0;
  const bb = federalBracketBreakdown(r.annual.gross, input.filingStatus, taxData.federal, preTax);
  $('rMarginal').textContent = isZero ? NO_PAY_YET : ratePct(bb.marginalRate);
  renderBrackets(bb);

  // hide state row when the state has no income tax
  $('stateLine').style.display = taxData.states[stateSlug]?.hasIncomeTax ? '' : 'none';

  // state disability / paid-leave employee contributions — one labeled line each,
  // e.g. "CA SDI (1.3%)". Rebuilt from the current view (per-period vs annual).
  const progHost = $('programLines');
  if (progHost) {
    const progs = p.programs || [];
    progHost.innerHTML = progs.map((pr) =>
      `<div class="line"><span class="lbl">${escLbl(pr.label)} (${ratePct(pr.rate)})</span><span>−${usd2(pr.amount)}</span></div>`
    ).join('');
  }

  // deduction rows: only show when non-zero (style.display, since .line { display:flex }
  // overrides the [hidden] attribute via specificity)
  if (p.preTax > 0) { $('preTaxLine').style.display = ''; $('rPreTax').textContent = '−' + usd2(p.preTax); }
  else $('preTaxLine').style.display = 'none';
  if (p.postTax > 0) { $('postTaxLine').style.display = ''; $('rPostTax').textContent = '−' + usd2(p.postTax); }
  else $('postTaxLine').style.display = 'none';

  renderBreakdown(r);
  renderCompare();
  announceResult();
}

// --- screen-reader status ---------------------------------------------------
// The results block is no longer aria-live (it would read the whole table on
// every keystroke). Instead one debounced sentence goes to #outStatus, and only
// for renders the visitor caused, never the boot render.
let booted = false;
let statusTimer = null;

function announceResult() {
  const out = $('outStatus');
  if (!out || !booted) return;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    const sub = $('netSub').textContent.replace(/ · /g, ', ').replace(/\/yr/g, ' per year');
    out.textContent = $('netBig').classList.contains('is-zero')
      ? sub
      : `Take-home ${$('netBig').textContent}, ${sub}`;
  }, 500);
}

// --- pay type switch --------------------------------------------------------
// Switching salary <-> hourly used to leave the old number in place, so an
// annual salary was read as an hourly rate. Convert the visitor's own figure
// instead; no tax figure is involved.
let prevWageType = null;

function convertOnWageTypeSwitch() {
  const now = $('wageType').value;
  const from = prevWageType;
  if (from === null || from === now) { prevWageType = now; return; }
  prevWageType = now;

  const amountEl = $('amount');
  const current = moneyValue(amountEl);
  if (!Number.isFinite(current) || current <= 0) return;
  const hoursPerYear = (parseFloat($('hours').value) || 40) * 52;
  if (!(hoursPerYear > 0)) return;

  if (from === 'salary' && now === 'hourly') {
    amountEl.value = fmtAmount(Math.round((current / hoursPerYear) * 100) / 100, 2);
  } else if (from === 'hourly' && now === 'salary') {
    amountEl.value = fmtAmount(Math.round(current * hoursPerYear), 0);
  }
}

// --- compare with another state (fetches the published full tax data on demand) ---
let fullData = null;

async function ensureFullData() {
  if (fullData) return fullData;
  try { fullData = await fetch('/data/tax-data-2026.json').then((r) => r.json()); }
  catch (e) { fullData = null; }
  return fullData;
}

async function populateCompare() {
  const sel = $('cmpState');
  if (!sel || sel.options.length > 1) return; // already populated
  const data = await ensureFullData();
  if (!data || !data.states) { sel.parentElement.insertAdjacentHTML('beforeend', '<p class="muted-small">Comparison data unavailable.</p>'); return; }
  Object.entries(data.states)
    .filter(([slug]) => slug !== stateSlug)
    .map(([slug, s]) => ({ slug, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((e) => { const o = document.createElement('option'); o.value = e.slug; o.textContent = e.name; sel.appendChild(o); });
}

function renderCompare() {
  const sel = $('cmpState'); const box = $('cmpResult');
  if (!sel || !box) return;
  const other = sel.value;
  if (!other || !fullData) { box.innerHTML = ''; return; }
  const input = readForm();
  const annualView = currentView() === 'annual';
  const netOf = (r) => (annualView ? r.annual.net : r.perPaycheck.net);
  const here = computePaycheck({ ...input, stateSlug }, fullData);
  const there = computePaycheck({ ...input, stateSlug: other }, fullData);
  const hereNet = netOf(here), thereNet = netOf(there);
  const diff = thereNet - hereNet;
  const hereName = fullData.states[stateSlug].name, otherName = fullData.states[other].name;
  const per = annualView ? '/yr' : ` ${PERIOD_LABEL[here.payFrequency]}`;
  const verb = diff === 0 ? 'the same as' : (diff > 0 ? 'more than' : 'less than');
  // Flag a state whose figures are a prior-year fallback (e.g. CA/NE/OK on 2025 rates)
  const fyTag = (slug) => {
    const fy = fullData.states[slug].figureYear;
    return fy && fy !== fullData.taxYear ? ` <span class="cmp-fy">(${fy} rates)</span>` : '';
  };
  box.innerHTML =
    `<div class="cmp-row"><span>${hereName}${fyTag(stateSlug)}</span><strong>${usd2(hereNet)}</strong></div>` +
    `<div class="cmp-row"><span>${otherName}${fyTag(other)}</span><strong>${usd2(thereNet)}</strong></div>` +
    (diff === 0
      ? `<p class="cmp-delta">Same take-home in both states for these inputs.</p>`
      : `<p class="cmp-delta">${otherName} take-home is <strong>${usd2(Math.abs(diff))}${per}</strong> ${verb} ${hereName}.</p>`);
}

function renderBrackets(bb) {
  const body = $('bracketBody');
  if (!body) return;
  if (!bb.bands.length || bb.taxable <= 0) {
    body.innerHTML = '<tr><td colspan="3">No federal income tax — taxable income is $0 after the standard deduction.</td></tr>';
    $('bracketNote').textContent = '';
    return;
  }
  body.innerHTML = bb.bands.map((b) => {
    const range = b.upper === Infinity ? `over ${usd(b.lower)}` : `${usd(b.lower)} – ${usd(b.upper)}`;
    return `<tr><td>${ratePct(b.rate)} <span class="bk-range">(${range})</span></td><td>${usd(b.amount)}</td><td>${usd(b.tax)}</td></tr>`;
  }).join('');
  $('bracketNote').textContent =
    `Taxable income ${usd(bb.taxable)} after the ${usd(bb.stdDed)} standard deduction. ` +
    `Your federal marginal rate is ${ratePct(bb.marginalRate)}, the federal tax on your next dollar earned.`;
}

function applyMode() {
  const adv = currentMode() === 'advanced';
  $('advancedFields').hidden = !adv;
  render();
}

function init() {
  initMoneyInputs();
  prevWageType = $('wageType').value;
  // Registered before the render listeners so the amount is already converted
  // by the time the render for this same event runs.
  ['change', 'input'].forEach((evt) =>
    $('wageType').addEventListener(evt, convertOnWageTypeSwitch));

  // The pre-filled figure is labelled as an example until the visitor touches
  // the form; after that the label must not claim to be an example any more.
  const form = $('paycheckForm');
  const dropExampleLabel = () => {
    exampleLive = false;
    const kicker = $('netKicker');
    if (kicker) kicker.textContent = 'Your estimated take-home pay';
  };
  if (form) {
    form.addEventListener('input', dropExampleLabel, { once: true });
    form.addEventListener('change', dropExampleLabel, { once: true });
  }

  ['wageType', 'amount', 'hours', 'filingStatus', 'payFrequency',
   'retirement401k', 'cafeteria125', 'dependentsCredit', 'extraWithholding', 'postTax']
    .forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('input', render);
    });
  document.querySelectorAll('input[name="mode"]').forEach((el) =>
    el.addEventListener('change', applyMode));
  document.querySelectorAll('input[name="view"]').forEach((el) =>
    el.addEventListener('change', render));
  const cmpPanel = $('comparePanel');
  if (cmpPanel) cmpPanel.addEventListener('toggle', () => { if (cmpPanel.open) populateCompare().then(renderCompare); });
  if ($('cmpState')) $('cmpState').addEventListener('change', renderCompare);
  applyMode();
  booted = true;
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
