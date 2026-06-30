// stopwatch.js — a drift-free stopwatch with unlimited lap timing.
// Accuracy comes from performance.now() deltas, never from counting frames, so
// the elapsed time stays correct even when the tab is blurred / throttled:
// elapsed = accumulated + (running ? performance.now() - startedAt : 0).
// requestAnimationFrame is only a repaint trigger while running. Nothing is uploaded.

const $ = (id) => document.getElementById(id);

// --- state -------------------------------------------------------------------
let running = false;
let startedAt = 0;     // performance.now() captured at the last Start/Resume
let accumulated = 0;   // ms banked from previous running stretches
let raf = null;
const laps = [];       // cumulative elapsed (ms) captured at each Lap press

const baseTitle = document.title;

// --- time math ---------------------------------------------------------------
function elapsed() {
  return accumulated + (running ? performance.now() - startedAt : 0);
}

// Format ms as HH:MM:SS.cc (centiseconds).
function fmt(ms) {
  ms = Math.max(0, Math.floor(ms));
  const cc = Math.floor((ms % 1000) / 10);
  const totalSec = Math.floor(ms / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}.${p2(cc)}`;
}

// --- rendering ---------------------------------------------------------------
function renderReadout() {
  const text = fmt(elapsed());
  $('swReadout').textContent = text;
  document.title = running ? `${text} — Stopwatch` : baseTitle;
}

function renderLaps() {
  const tbody = $('lapBody');
  const wrap = $('lapWrap');
  if (!laps.length) {
    wrap.hidden = true;
    tbody.innerHTML = '';
    return;
  }
  wrap.hidden = false;

  // Per-lap split = cumulative[i] - cumulative[i-1].
  const splits = laps.map((cum, i) => cum - (i ? laps[i - 1] : 0));
  // Best/worst only meaningful once there are at least two laps.
  let bestIdx = -1, worstIdx = -1;
  if (splits.length >= 2) {
    let min = Infinity, max = -Infinity;
    splits.forEach((sp, i) => {
      if (sp < min) { min = sp; bestIdx = i; }
      if (sp > max) { max = sp; worstIdx = i; }
    });
  }

  const rows = laps.map((cum, i) => {
    const cls = i === bestIdx ? ' class="lap-best"' : i === worstIdx ? ' class="lap-worst"' : '';
    const tag = i === bestIdx ? ' <span class="lap-tag">best</span>'
      : i === worstIdx ? ' <span class="lap-tag">worst</span>' : '';
    return `<tr${cls}><td>${i + 1}${tag}</td><td>${fmt(splits[i])}</td><td>${fmt(cum)}</td></tr>`;
  });
  tbody.innerHTML = rows.join('');
}

// --- controls ----------------------------------------------------------------
function start() {
  if (running) return;
  running = true;
  startedAt = performance.now();
  $('swReadout').classList.add('running');
  setStartUi();
  loop();
}

function loop() {
  renderReadout();
  if (running) raf = requestAnimationFrame(loop);
}

function stop() {
  if (!running) return;
  accumulated = elapsed();
  running = false;
  if (raf) cancelAnimationFrame(raf);
  $('swReadout').classList.remove('running');
  setStartUi();
  renderReadout();
}

function toggle() {
  if (running) stop();
  else start();
}

function reset() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  accumulated = 0;
  startedAt = 0;
  laps.length = 0;
  $('swReadout').classList.remove('running');
  setStartUi();
  renderLaps();
  renderReadout();
  document.title = baseTitle;
}

function lap() {
  // A lap before the stopwatch has started has nothing to record.
  if (!running && accumulated === 0) return;
  laps.push(elapsed());
  renderLaps();
}

function setStartUi() {
  const btn = $('startBtn');
  btn.textContent = running ? 'Stop' : (accumulated > 0 ? 'Resume' : 'Start');
  $('startBtn').setAttribute('aria-pressed', String(running));
}

// --- copy laps ---------------------------------------------------------------
function copyLaps() {
  if (!laps.length) return;
  const splits = laps.map((cum, i) => cum - (i ? laps[i - 1] : 0));
  const lines = ['Lap\tLap time\tTotal'];
  laps.forEach((cum, i) => lines.push(`${i + 1}\t${fmt(splits[i])}\t${fmt(cum)}`));
  const text = lines.join('\n');
  const btn = $('copyLapsBtn');
  const done = () => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy laps'; }, 1400); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

// --- init --------------------------------------------------------------------
function init() {
  $('startBtn').addEventListener('click', toggle);
  $('lapBtn').addEventListener('click', lap);
  $('resetBtn').addEventListener('click', reset);
  $('copyLapsBtn').addEventListener('click', copyLaps);

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); lap(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); reset(); }
  });

  renderReadout();
  renderLaps();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
