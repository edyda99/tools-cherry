// able-account-calculator.js — ABLE Account Contribution Limit Calculator UI
// (TY 2026). Arithmetic-first: how much can be contributed this year — never a
// medical/benefits determination (the only eligibility question is the
// statutory onset-before-46 age, SECURE 2.0 §124). All logic runs client-side;
// nothing uploaded. The 51-state dropdown maps internally to the 3 FPL buckets
// (48+DC / AK / HI) — users never need to know the bucket.
import { ableContribution } from '/assets/able-contribution.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
const $ = (id) => document.getElementById(id);
const LIMITS = window.__ABLE_LIMITS__ || {};
const STATES = window.__ABLE_STATES__ || [];

const usd = (n) => '$' + Math.max(0, Math.round(n || 0)).toLocaleString('en-US');

// Comma-safe: money fields carry live thousands separators, so read them
// through moneyValue (strips separators) rather than a raw parseFloat, which
// would silently truncate "28,000" to 28.
function num(id) {
  const el = $(id);
  if (!el) return 0;
  return moneyValue(el);
}

function populateStates() {
  const sel = $('state');
  if (!sel || sel.options.length > 0) return;
  STATES.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.abbr;
    opt.textContent = s.name;
    sel.appendChild(opt);
  });
  sel.value = 'CA';
}

function updateVisibility() {
  const eligible = $('onsetGate').value === 'before46';
  $('calcFields').style.display = eligible ? '' : 'none';
  const employed = $('employed').value === 'yes';
  $('employedFields').style.display = eligible && employed ? '' : 'none';
}

function poolBar(label, used, cap) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const over = used > cap;
  return (
    `<div class="pool-row">` +
    `<div class="pool-label"><span>${label}</span><span class="num">${usd(used)} of ${usd(cap)}</span></div>` +
    `<div class="pool-bar"><div class="pool-fill${over ? ' pool-over' : ''}" style="width:${pct}%"></div></div>` +
    `</div>`
  );
}

function render() {
  updateVisibility();
  const out = $('out');

  if ($('onsetGate').value !== 'before46') {
    const r = ableContribution({ onsetBefore46: false, limits: LIMITS });
    out.innerHTML =
      `<div class="stat-card"><p class="stat-kicker">Maximum ABLE contribution this year</p>` +
      `<p class="stat-value is-zero">$0</p>` +
      `<p class="stat-sub">Not an eligible individual — disability onset at 46 or later means no ABLE account can be opened, so no contribution limit applies.</p></div>` +
      (r.notes || []).map((n) => `<div class="info-note">${n}</div>`).join('');
    return;
  }

  const employed = $('employed').value === 'yes';
  const r = ableContribution({
    onsetBefore46: true,
    state: $('state').value,
    employed,
    compensation: employed ? num('compensation') : 0,
    planContribution: employed && $('planContribution').value === 'yes',
    others: num('others'),
    own: num('own'),
    rollover529: num('rollover529'),
    limits: LIMITS
  });

  if (r.error) {
    out.innerHTML =
      `<div class="stat-card"><p class="stat-kicker">Maximum ABLE contribution this year</p>` +
      `<p class="stat-value is-zero">$0</p>` +
      `<p class="stat-sub">${(r.notes && r.notes[0]) || 'Could not load the limit data.'}</p></div>`;
    return;
  }

  let badgeText, badgeClass;
  if (r.excess > 0) {
    badgeText = `${usd(r.excess)} OVER the limit`;
    badgeClass = 'warn-flag';
  } else if (r.roomOwn + r.roomOthers <= 0) {
    badgeText = 'Exactly at the limit';
    badgeClass = 'ok-flag';
  } else {
    badgeText = 'Within the limit';
    badgeClass = 'ok-flag';
  }

  const stateName = (STATES.find((s) => s.abbr === $('state').value) || {}).name || 'your state';
  const bucketLabel = r.bucket === 'AK' ? 'the Alaska poverty-line figure'
    : r.bucket === 'HI' ? 'the Hawaii poverty-line figure'
    : 'the 48-contiguous-states + D.C. poverty-line figure';

  const headline =
    `<div class="obbba-note">For 2026, this beneficiary's maximum is <strong>${usd(r.combinedMax)}</strong>` +
    (r.bonusCap > 0
      ? ` — the ${usd(r.base)} base limit plus a personal ABLE-to-Work space of ${usd(r.bonusCap)} (${stateName} uses ${bucketLabel})`
      : ` — the ${usd(r.base)} base limit, with no ABLE-to-Work bonus${employed ? '' : ' (the beneficiary isn’t employed)'}`) +
    `. With the contributions entered, the limit that actually applies is <strong>${usd(r.totalLimit)}</strong> (only the beneficiary's own money can use bonus space).</div>`;

  const lines = [
    ['Base limit (everyone’s money + 529 rollovers)', usd(r.base)],
    ['ABLE-to-Work space (beneficiary’s own money only)', usd(r.bonusCap)],
    ['Combined maximum for this beneficiary', usd(r.combinedMax)],
    ['Total contributed so far', usd(r.totalContrib)],
    [r.excess > 0 ? 'Excess over the limit' : 'Remaining room — beneficiary’s own money', r.excess > 0 ? usd(r.excess) : usd(r.roomOwn)]
  ];
  if (r.excess <= 0) lines.push(['Remaining room — family / others / 529 rollover', usd(r.roomOthers)]);

  const lineHtml = lines.map(([label, val]) => `<div class="line"><span>${label}</span><span class="num">${val}</span></div>`).join('');

  // Base bar: pool usage plus any spill past the limit (bonusUsed is capped at
  // bonusCap by the engine, so all excess conceptually overflows the base pool).
  const bars =
    `<div class="pools">` +
    poolBar(`Base ${usd(r.base)} pool (others + rollover + beneficiary spillover)`, r.baseUsed + r.excess, r.base) +
    (r.bonusCap > 0 ? poolBar(`ABLE-to-Work ${usd(r.bonusCap)} space (beneficiary only)`, r.bonusUsed, r.bonusCap) : '') +
    `</div>`;

  // ---- Answer-first summary (stat card) --------------------------------
  // roomOwn and roomOthers are two alternate "if only this contributor adds
  // more" views of the SAME shared base pool (see the derivation) — they are
  // NOT additive. The true combined room left is the max minus what's
  // already in, floored at $0.
  const roomLeft = Math.max(0, r.combinedMax - r.totalContrib);
  const statSub = r.excess > 0
    ? `${usd(r.excess)} contributed over the limit — see the breakdown for the 6% excise rule.`
    : roomLeft > 0
      ? `That's ${usd(r.totalContrib)} contributed so far, with ${usd(roomLeft)} of room left this year.`
      : `The full ${usd(r.combinedMax)} has been contributed — no room left this year.`;
  const statCard =
    `<div class="stat-card">` +
      `<p class="stat-kicker">Maximum ABLE contribution this year</p>` +
      `<p class="stat-value">${usd(r.combinedMax)}</p>` +
      `<p class="stat-sub">${statSub}</p>` +
    `</div>`;

  // ---- One headline caveat (over the limit) shown OUTSIDE the details --
  const headlineCaveat = r.excess > 0
    ? `<div class="obbba-note ineligible-flag">Heads up: contributions entered are ${usd(r.excess)} over the limit — the 6% excise tax applies unless the excess is returned before the tax deadline (see the breakdown).</div>`
    : '';

  // ---- Full derivation, moved VERBATIM into a collapsed panel -----------
  const derivation =
    `<details class="derivation"><summary>See how this was calculated</summary>` +
      `<div class="line big"><span>Verdict</span><span class="num ${badgeClass}">${badgeText}</span></div>` +
      headline +
      lineHtml +
      bars +
    `</details>`;

  const prevDetails = out.querySelector('details.derivation');
  const wasOpen = prevDetails ? prevDetails.open : false;

  out.innerHTML =
    statCard +
    headlineCaveat +
    derivation +
    (r.notes || []).map((n) => `<div class="takeaway">${n}</div>`).join('');

  const newDetails = out.querySelector('details.derivation');
  if (newDetails) newDetails.open = wasOpen;
}

function init() {
  initMoneyInputs();
  populateStates();
  ['onsetGate', 'state', 'employed', 'compensation', 'planContribution', 'others', 'own', 'rollover529'].forEach((id) => {
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
