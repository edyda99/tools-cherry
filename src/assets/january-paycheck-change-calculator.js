// january-paycheck-change-calculator.js — the calculator on
// /january-paycheck-change-calculator/. Runs the visitor's pay through the
// December 2026 and January 2027 paychecks (january-paycheck.js, which reuses
// paycheck-engine.js, ss-maxout-engine.js and pay-frequency.js) and lists what
// changed, biggest first. window.__JANPAY__ is written by build.js: both years'
// federal blocks, every state's 2026 entry, the 2027 state entries that differ,
// and whether the 2027 federal tables are official or projected. Nothing is
// uploaded.
import { compareDecJan, describeCause, headline, signedUsd } from '/assets/january-paycheck.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
import { initMoneyInputs, moneyValue } from '/assets/money-input.js';

const $ = (id) => document.getElementById(id);
const CFG = (typeof window !== 'undefined' && window.__JANPAY__) || {};

const usd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function pct(id) {
  const el = $(id);
  const raw = el ? String(el.value || '').replace(/[%\s,]/g, '') : '';
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}
function money(id) {
  const el = $(id);
  if (!el || String(el.value || '').trim() === '') return null;
  const n = moneyValue(el);
  return Number.isFinite(n) ? n : null;
}

const ROWS = [
  ['gross', 'Pay before anything comes out'],
  ['retirement', '401(k) savings'],
  ['premium', 'Health insurance'],
  ['federal', 'Federal income tax'],
  ['socialSecurity', 'Social Security tax'],
  ['medicare', 'Medicare tax'],
  ['state', 'State income tax'],
  ['statePrograms', 'State disability or leave programs'],
];

function render() {
  const out = $('jpOut');
  if (!out) return;
  const slug = $('stateSlug').value;
  const st26 = CFG.states2026 && CFG.states2026[slug];
  const st27Entry = (CFG.states2027 && CFG.states2027[slug]) || null;
  const input = {
    salary: money('salary') || 0,
    payFrequency: $('payFrequency').value,
    filingStatus: $('filingStatus').value,
    stateSlug: slug,
    k401Pct2026: pct('k401_2026'),
    k401Pct2027: pct('k401_2027'),
    premium2026: money('prem2026') || 0,
    premium2027: money('prem2027') || 0,
    ytd2026: money('ytd2026'),
  };
  if (!(input.salary > 0) || !st26) {
    out.innerHTML = '<p>Put in your yearly salary to compare your two paychecks.</p>';
    return;
  }
  const r = compareDecJan(input, {
    federal2026: CFG.federal2026,
    federal2027: CFG.federal2027,
    state2026: st26,
    state2027: st27Entry ? st27Entry.state : st26,
    taxDataShell: CFG.shell,
  });
  const info = {
    input,
    fedMode: CFG.fedMode,
    stateName: st26.name,
    stateHasIncomeTax: st26.hasIncomeTax !== false,
    stateBasis: st27Entry ? st27Entry.basis : 'tables2026',
    stateOverrideWhat: st27Entry ? st27Entry.what : '',
  };
  const items = r.causes.map((c) => describeCause(c, info));
  const moved = items.filter((i) => i.changed);
  const same = items.filter((i) => !i.changed);

  const list = moved.length
    ? '<ol class="jp-causes">' + moved.map((i) =>
      `<li><strong>${esc(i.title)}: <span class="jp-amt">${esc(i.amount)}</span></strong>. ${esc(i.text)}</li>`).join('') + '</ol>'
    : '<p>Nothing on the list changed for your pay.</p>';
  const sameList = same.length
    ? '<p class="jp-same"><strong>Did not change your take-home pay:</strong></p><ul class="jp-same">' +
      same.map((i) => `<li>${esc(i.title)}. ${esc(i.text)}</li>`).join('') + '</ul>'
    : '';

  const rows = ROWS.filter(([k]) => k !== 'statePrograms' || r.dec[k] || r.jan[k]).map(([k, label]) => {
    const d = Math.round((r.jan[k] - r.dec[k]) * 100) / 100;
    return `<tr${d ? ' class="jp-moved"' : ''}><th scope="row">${label}</th><td class="jp-n">${usd(r.dec[k])}</td>` +
      `<td class="jp-n">${usd(r.jan[k])}</td><td class="jp-n">${d ? esc(signedUsd(d)) : '$0.00'}</td></tr>`;
  }).join('');
  const table = '<div class="jp-wrap"><table class="jp-table"><caption class="sr-only">December 2026 and January 2027 paychecks, line by line</caption>' +
    '<thead><tr><th scope="col">Line</th><th scope="col" class="jp-n">December 2026</th><th scope="col" class="jp-n">January 2027</th><th scope="col" class="jp-n">Change</th></tr></thead>' +
    `<tbody>${rows}<tr class="jp-net"><th scope="row">Take-home pay</th><td class="jp-n">${usd(r.dec.net)}</td><td class="jp-n">${usd(r.jan.net)}</td>` +
    `<td class="jp-n">${r.change ? esc(signedUsd(r.change)) : '$0.00'}</td></tr></tbody></table></div>`;

  const ytdNote = r.ytdAssumed
    ? `<p class="muted-small">We assumed you earned ${usd(r.ytd)} at this job in 2026 before your last December paycheck: a full year at this salary. Change it above if you started partway through the year.</p>`
    : '';
  const fedNote = CFG.fedMode === 'projected'
    ? '<p class="muted-small">January\'s federal tax is an <strong>estimate</strong> from projected 2027 tables. The IRS has not published the official ones yet.</p>'
    : '';

  out.innerHTML =
    `<p class="jp-headline">${esc(headline(r.change))}</p>` +
    '<div class="jp-pair">' +
    `<div class="jp-cell"><span class="jp-k">Last December 2026 paycheck</span><span class="jp-v">${usd(r.dec.net)}</span></div>` +
    `<div class="jp-cell"><span class="jp-k">First January 2027 paycheck</span><span class="jp-v">${usd(r.jan.net)}</span></div>` +
    `<div class="jp-cell"><span class="jp-k">Change</span><span class="jp-v">${r.change ? esc(signedUsd(r.change)) : '$0.00'}</span></div>` +
    '</div>' +
    '<h2 style="font-size:1.05rem;margin:14px 0 4px">What changed, biggest first</h2>' + list + sameList + table + ytdNote + fedNote;
}

function init() {
  initMoneyInputs();
  ['salary', 'payFrequency', 'stateSlug', 'filingStatus', 'k401_2026', 'k401_2027', 'prem2026', 'prem2027', 'ytd2026']
    .forEach((id) => {
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
