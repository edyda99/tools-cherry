// w2-box-decoder.js (bootstrap) — the 2026 W-2 Box 12 TA/TP/TT decoder +
// Treasury Tipped Occupation Code lookup page. All logic runs client-side;
// nothing is uploaded. The load-bearing rule (never violated anywhere in this
// UI): only TA is excluded from Box 1 — TP/TT are flags on wages that are
// ALREADY fully taxed inside Box 1, never a subtraction from them.
import { decodeW2, searchOccupations } from '/assets/w2-box-engine.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const DATA = window.__TTOC__;

const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : 0;
}

function parse14b(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function codeCard(c) {
  if (!c.known) {
    return `<div class="code-card"><h3>Code ${escHtml(c.code)} <span class="code-badge">not decoded</span></h3>` +
      `<p>${escHtml(c.note)}</p></div>`;
  }
  const badge = c.excludedFromBox1
    ? '<span class="code-badge b-excluded">excluded from Box 1</span>'
    : '<span class="code-badge b-included">already inside Box 1 — fully taxed</span>';
  const fica = c.ficaNote ? `<p><strong>FICA:</strong> ${escHtml(c.ficaNote)}</p>` : '';
  return `<div class="code-card ${c.excludedFromBox1 ? 'excluded' : 'included'}">` +
    `<h3>Code ${c.code} — ${escHtml(c.name)}${c.amount ? ` · ${usd(c.amount)}` : ''} ${badge}</h3>` +
    `<p>${escHtml(c.plain)}</p>` +
    `<p><strong>Box 1:</strong> ${escHtml(c.box1Note)}</p>` +
    `<p><strong>What to do with it:</strong> ${escHtml(c.purpose)}</p>` +
    fica +
    `</div>`;
}

function box14bHtml(b) {
  const parts = [];
  for (const e of b.entries) {
    if (e.status === 'match') {
      const o = e.occupation;
      const added = o.addedInFinalRule
        ? ' <span class="info-flag">(added in the April 2026 final rule — not in the Sept 2025 proposed list)</span>'
        : '';
      parts.push(`<div class="code-card"><h3>Box 14b code ${o.code} — ${escHtml(o.title)}</h3>` +
        `<p><strong>Category:</strong> ${escHtml(o.category)}${added}</p>` +
        `<p>${escHtml(o.description)}.</p>` +
        `<p class="muted-small">Examples: ${escHtml(o.examples)} · Related SOC code: ${escHtml(o.soc)}</p>` +
        `<p class="ok-flag">This occupation is on the qualifying list — tips reported under it count toward the tips deduction.</p></div>`);
    } else if (e.status === 'nonqualifying') {
      parts.push(`<div class="code-card included"><h3>Box 14b code 000 — nonqualifying occupation flag</h3>` +
        `<p>${escHtml(e.explanation)}</p></div>`);
    } else {
      parts.push(`<div class="code-card included"><h3>Box 14b code ${escHtml(e.code)} — not recognized</h3>` +
        `<p>${escHtml(e.explanation)}</p></div>`);
    }
  }
  for (const n of b.notes) {
    parts.push(`<div class="obbba-note">${escHtml(n)}</div>`);
  }
  return parts.join('');
}

function render() {
  const box12 = [];
  const tp = num('amtTP'), tt = num('amtTT'), ta = num('amtTA');
  if (tp > 0) box12.push({ code: 'TP', amount: tp });
  if (tt > 0) box12.push({ code: 'TT', amount: tt });
  if (ta > 0) box12.push({ code: 'TA', amount: ta });
  const codes14b = parse14b($('codes14b') ? $('codes14b').value : '');

  if (!box12.length && !codes14b.length) {
    $('out').innerHTML = '<div class="obbba-note">Enter the amounts next to the codes on your W-2 (leave the ones you don\'t have blank) and any Box 14b code — the explanation appears here.</div>';
    return;
  }

  const r = decodeW2({ box12, box14b: codes14b, data: DATA });

  let summary = '';
  const inBox1 = [];
  if (r.flags.hasTP) inBox1.push(`${usd(r.totals.tpTips)} of tips (TP)`);
  if (r.flags.hasTT) inBox1.push(`${usd(r.totals.ttOvertime)} of overtime premium (TT)`);
  if (inBox1.length) {
    summary += `<div class="line big"><span>Already inside your Box 1 wages, fully taxed</span><span class="num">${inBox1.join(' + ')}</span></div>` +
      `<div class="obbba-note">No adjustment to make on the W-2 itself — these flags tell you what you can deduct on <strong>Schedule 1-A</strong> when you file.</div>`;
  }
  if (r.flags.hasTA) {
    summary += `<div class="line big"><span>Excluded from your Box 1 wages (never taxed as wages)</span><span class="num ok-flag">${usd(r.totals.taExcluded)} (TA)</span></div>` +
      `<div class="obbba-note">Your Box 1 is already lower by this amount — a Trump account contribution, not part of your taxable wages.</div>`;
  }

  $('out').innerHTML =
    summary +
    r.box12.map(codeCard).join('') +
    box14bHtml(r.box14b) +
    `<div class="takeaway">Rule of thumb: <strong>TA lowers your taxable wages up front; TP and TT don't</strong> — their deduction happens later, on Schedule 1-A. And FICA (Social Security + Medicare) applies to tips and overtime either way.</div>`;
}

function occHit(o) {
  const added = o.addedInFinalRule
    ? ' <span class="new-flag">added in the April 2026 final rule</span>'
    : '';
  return `<div class="ttoc-hit">` +
    `<div><span class="t-code">Code ${o.code}</span> — <strong>${escHtml(o.title)}</strong>${added}</div>` +
    `<div class="t-cat">${escHtml(o.category)}</div>` +
    `<div class="t-desc">${escHtml(o.description)}.</div>` +
    `<div class="t-ex">Examples: ${escHtml(o.examples)}</div>` +
    `</div>`;
}

function renderSearch() {
  const q = $('occQuery') ? $('occQuery').value.trim() : '';
  const out = $('occOut');
  if (!out) return;
  if (!q) {
    out.innerHTML = '<div class="obbba-note">Type your job — the everyday name works ("barista", "nail tech", "valet"). Or browse the full list below.</div>';
    return;
  }
  const r = searchOccupations(q, DATA, 6);
  // On the full page the browsable list lives in-page; inside the /embed/
  // iframe it doesn't, so link out to the tool page instead.
  const isEmbed = !!document.querySelector('.embed-wrap');
  const browseLink = isEmbed
    ? '<a href="/w2-box-decoder/#ttoc-browse" target="_blank" rel="noopener">full browsable list</a>'
    : '<a href="#ttoc-browse">full browsable list</a> below';
  if (r.notFound) {
    const dym = r.notFound.didYouMean && r.notFound.didYouMean.length
      ? `<p><strong>Did you mean:</strong></p>` + r.notFound.didYouMean.map(occHit).join('')
      : '';
    out.innerHTML = `<div class="ttoc-notfound"><strong>Not on the IRS list.</strong> ${escHtml(r.notFound.explanation)}</div>` + dym +
      `<div class="obbba-note">Double-check in the ${browseLink} — searches aren't perfect.</div>`;
    return;
  }
  if (!r.matches.length) {
    out.innerHTML = '<div class="obbba-note">Keep typing — or browse the full list below.</div>';
    return;
  }
  const top = r.matches[0];
  const rest = r.matches.slice(1, 4);
  out.innerHTML =
    `<div class="obbba-note ok-flag">Likely match — this occupation qualifies for the tips deduction. Its code is what belongs in W-2 Box 14b.</div>` +
    occHit(top) +
    (rest.length ? `<div class="obbba-note">Other possible matches:</div>` + rest.map(occHit).join('') : '');
}

function init() {
  ['amtTP', 'amtTT', 'amtTA', 'codes14b'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  const q = $('occQuery');
  if (q) {
    q.addEventListener('input', renderSearch);
    q.addEventListener('change', renderSearch);
  }
  render();
  renderSearch();
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
