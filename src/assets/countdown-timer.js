// countdown-timer.js — a set-a-duration timer (kitchen / study / workout).
// Drift-free: instead of decrementing a counter each tick (which drifts when the
// tab is throttled), we record an absolute deadline timestamp and always compute
// remaining = endAt - Date.now(). The interval is only a refresh trigger.
// Pure helpers live in /assets/duration.js. Nothing is uploaded.
import { parseDuration, formatDuration } from '/assets/duration.js';

const $ = (id) => document.getElementById(id);

// --- timer state -------------------------------------------------------------
let endAt = 0;        // absolute deadline (ms epoch) while running
let remaining = 0;    // ms left while paused / before start
let running = false;
let finished = false;
let started = false;  // true once the timer has been Started at least once (since last reset/finish)
let ticker = null;
let muted = false;
let audioCtx = null;  // created lazily on the first Start (a user gesture)

const baseTitle = document.title;

// --- audio (gesture-gated) ---------------------------------------------------
// The AudioContext is created only inside startTimer(), i.e. after a click, so we
// never autoplay on page load. A short, gentle three-pulse beep on zero.
function ensureAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
}

function beep() {
  if (muted || !audioCtx) return;
  // Resume in case the context started suspended (some browsers).
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  // Three short, soft pulses — pleasant, not alarming.
  for (let i = 0; i < 3; i++) {
    const t0 = now + i * 0.28;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02); // gentle attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22); // quick decay
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.24);
  }
}

// --- rendering ---------------------------------------------------------------
function render(ms) {
  const text = formatDuration(ms);
  $('cdReadout').textContent = text;
  // Live tab title so the timer is visible from another tab.
  document.title = running && ms > 0 ? `${text} — Timer` : baseTitle;
}

function setRunningUi(state) {
  $('startBtn').textContent = state ? 'Pause' : (started && remaining > 0 && !finished ? 'Resume' : 'Start');
  $('cdReadout').classList.toggle('running', state);
}

function showDone(done) {
  finished = done;
  $('cdTimer').classList.toggle('done', done);
  $('cdStatus').textContent = done ? "Time's up!" : '';
}

// --- core loop ---------------------------------------------------------------
function tick() {
  const left = Math.max(0, endAt - Date.now());
  remaining = left;
  render(left);
  if (left <= 0) {
    finishTimer();
  }
}

function startTimer() {
  // If nothing is loaded yet, read the form fields into `remaining`.
  if (remaining <= 0 && !running) {
    remaining = parseDuration($('inpH').value, $('inpM').value, $('inpS').value);
  }
  if (remaining <= 0) {
    $('cdStatus').textContent = 'Set a time above first.';
    return;
  }
  ensureAudio(); // first gesture → audio is now allowed
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  showDone(false);
  running = true;
  started = true; // we've now been started at least once → a later pause shows "Resume"
  endAt = Date.now() + remaining;
  setRunningUi(true);
  clearInterval(ticker);
  // 250ms refresh keeps the seconds digit responsive without busy-looping;
  // accuracy comes from the absolute deadline, not the interval.
  ticker = setInterval(tick, 250);
  tick();
}

function pauseTimer() {
  if (!running) return;
  remaining = Math.max(0, endAt - Date.now());
  running = false;
  clearInterval(ticker);
  setRunningUi(false);
  render(remaining);
}

function resetTimer() {
  running = false;
  finished = false;
  started = false;
  clearInterval(ticker);
  remaining = 0;
  endAt = 0;
  showDone(false);
  setRunningUi(false);
  $('cdStatus').textContent = '';
  render(0);
  document.title = baseTitle;
}

function finishTimer() {
  running = false;
  started = false; // a finished timer starts fresh, not "Resume"
  clearInterval(ticker);
  remaining = 0;
  render(0);
  showDone(true);
  setRunningUi(false);
  document.title = "Time's up! — Timer";
  beep();
}

function toggleStart() {
  if (running) pauseTimer();
  else startTimer();
}

// Quick presets set the inputs AND load the duration, ready to Start.
function applyPreset(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  $('inpH').value = h ? String(h) : '';
  $('inpM').value = m ? String(m) : '';
  $('inpS').value = s ? String(s) : '';
  // Stop any current run and load the new duration without auto-starting.
  running = false;
  finished = false;
  started = false; // a freshly loaded preset hasn't been started → "Start", not "Resume"
  clearInterval(ticker);
  showDone(false);
  remaining = parseDuration(h, m, s);
  endAt = 0;
  setRunningUi(false);
  $('cdStatus').textContent = '';
  render(remaining);
  document.title = baseTitle;
}

function onInputChange() {
  if (running) return; // editing while running has no effect until reset
  remaining = parseDuration($('inpH').value, $('inpM').value, $('inpS').value);
  finished = false;
  started = false; // editing the duration before starting → "Start", not "Resume"
  showDone(false);
  setRunningUi(false);
  render(remaining);
}

function toggleMute() {
  muted = !muted;
  const btn = $('muteBtn');
  btn.setAttribute('aria-pressed', String(muted));
  btn.textContent = muted ? '🔇 Sound off' : '🔔 Sound on';
}

function init() {
  $('startBtn').addEventListener('click', toggleStart);
  $('resetBtn').addEventListener('click', resetTimer);
  $('muteBtn').addEventListener('click', toggleMute);

  document.querySelectorAll('.preset').forEach((b) =>
    b.addEventListener('click', () => applyPreset(Number(b.dataset.seconds)))
  );

  ['inpH', 'inpM', 'inpS'].forEach((id) =>
    $(id).addEventListener('input', onInputChange)
  );

  // Space toggles start/pause when focus isn't in a text field.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      toggleStart();
    }
  });

  // Default to the 5-minute preset so the readout is never empty.
  applyPreset(5 * 60);
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
