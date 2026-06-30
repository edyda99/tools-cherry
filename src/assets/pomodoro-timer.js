// pomodoro-timer.js — a Pomodoro / focus timer phase machine.
// Phases cycle: work -> short break -> work -> ... and every Nth work block is
// followed by a long break instead. The countdown is anchored to an absolute
// performance.now() deadline (remaining = endAt - now) so it stays accurate even
// when the tab is throttled in the background. The end-of-phase chime is made
// with the Web Audio API (no audio file) and only after a user gesture, so the
// page never autoplays sound. Nothing is uploaded.

const $ = (id) => document.getElementById(id);

// --- config (minutes) --------------------------------------------------------
const cfg = { work: 25, short: 5, long: 15, rounds: 4 };

// --- phase state -------------------------------------------------------------
// phase: 'work' | 'short' | 'long'
let phase = 'work';
let completedWork = 0;  // how many work blocks have finished this cycle (resets after a long break)
let sessionCount = 0;   // total work blocks completed since reset (the "session" counter)
let running = false;
let endAt = 0;          // absolute deadline (performance.now() ms) while running
let remaining = 0;      // ms left while paused / before start
let ticker = null;
let autoStart = true;
let muted = false;
let audioCtx = null;

const baseTitle = document.title;

const LABELS = { work: 'Focus', short: 'Short break', long: 'Long break' };

function phaseMs(p) { return cfg[p] * 60 * 1000; }

// --- audio (gesture-gated) ---------------------------------------------------
function ensureAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
}

// Two short tones — a slightly higher pair to mark the end of a focus block,
// a lower pair to mark the end of a break (so you can tell them apart by ear).
function chime(high) {
  if (muted || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  const freq = high ? 880 : 587.33; // A5 vs D5
  for (let i = 0; i < 2; i++) {
    const t0 = now + i * 0.3;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.28);
  }
}

// --- rendering ---------------------------------------------------------------
function fmt(ms) {
  ms = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(ms / 60);
  const s = ms % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(m)}:${p2(s)}`;
}

function render(ms) {
  const text = fmt(ms);
  $('pomoReadout').textContent = text;
  $('pomoPhase').textContent = LABELS[phase];
  $('pomoSession').textContent = `Completed focus sessions: ${sessionCount}`;
  // Round x of N within the current long-break cycle.
  const roundNo = phase === 'work' ? completedWork + 1 : completedWork;
  $('pomoRound').textContent = `Round ${Math.min(roundNo, cfg.rounds)} of ${cfg.rounds}`;
  document.title = running ? `${text} ${LABELS[phase]} — Pomodoro` : baseTitle;
}

function setPhaseClass() {
  const box = $('pomoBox');
  box.classList.toggle('is-work', phase === 'work');
  box.classList.toggle('is-break', phase !== 'work');
}

function setRunningUi() {
  $('startBtn').textContent = running ? 'Pause' : (remaining > 0 && remaining < phaseMs(phase) ? 'Resume' : 'Start');
  $('pomoReadout').classList.toggle('running', running);
}

// --- core loop ---------------------------------------------------------------
function tick() {
  const left = Math.max(0, endAt - performance.now());
  remaining = left;
  render(left);
  if (left <= 0) phaseComplete();
}

function loadPhase(p, autoRun) {
  phase = p;
  remaining = phaseMs(p);
  endAt = 0;
  running = false;
  clearInterval(ticker);
  setPhaseClass();
  setRunningUi();
  render(remaining);
  if (autoRun) start();
}

function nextPhase() {
  if (phase === 'work') {
    completedWork += 1;
    sessionCount += 1;
    if (completedWork >= cfg.rounds) {
      return 'long';
    }
    return 'short';
  }
  // After any break we go back to work; a long break ends the cycle.
  if (phase === 'long') completedWork = 0;
  return 'work';
}

function phaseComplete() {
  running = false;
  clearInterval(ticker);
  chime(phase === 'work'); // higher tone after focus, lower after a break
  const wasWork = phase === 'work';
  const next = nextPhase();
  loadPhase(next, autoStart);
  $('pomoStatus').textContent = wasWork ? 'Focus done — time for a break.' : 'Break over — back to focus.';
}

function start() {
  if (running) return;
  if (remaining <= 0) remaining = phaseMs(phase);
  ensureAudio();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  running = true;
  endAt = performance.now() + remaining;
  setRunningUi();
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
  tick();
}

function pause() {
  if (!running) return;
  remaining = Math.max(0, endAt - performance.now());
  running = false;
  clearInterval(ticker);
  setRunningUi();
  render(remaining);
}

function toggle() {
  if (running) pause();
  else start();
}

function skip() {
  // Jump straight to the next phase without crediting/penalizing audio.
  running = false;
  clearInterval(ticker);
  const next = nextPhase();
  $('pomoStatus').textContent = '';
  loadPhase(next, false);
}

function reset() {
  running = false;
  clearInterval(ticker);
  phase = 'work';
  completedWork = 0;
  sessionCount = 0;
  $('pomoStatus').textContent = '';
  loadPhase('work', false);
  document.title = baseTitle;
}

// --- settings ----------------------------------------------------------------
function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function applySettings() {
  cfg.work = clampInt($('cfgWork').value, 1, 180, 25);
  cfg.short = clampInt($('cfgShort').value, 1, 60, 5);
  cfg.long = clampInt($('cfgLong').value, 1, 60, 15);
  cfg.rounds = clampInt($('cfgRounds').value, 1, 12, 4);
  $('cfgWork').value = cfg.work;
  $('cfgShort').value = cfg.short;
  $('cfgLong').value = cfg.long;
  $('cfgRounds').value = cfg.rounds;
  // Re-arm the current phase length only if not mid-run.
  if (!running) {
    remaining = phaseMs(phase);
    render(remaining);
    setRunningUi();
  }
}

function toggleAuto() {
  autoStart = $('autoStart').checked;
}

function toggleMute() {
  muted = !muted;
  const btn = $('muteBtn');
  btn.setAttribute('aria-pressed', String(muted));
  btn.textContent = muted ? '🔇 Sound off' : '🔔 Sound on';
}

// --- init --------------------------------------------------------------------
function init() {
  $('startBtn').addEventListener('click', toggle);
  $('skipBtn').addEventListener('click', skip);
  $('resetBtn').addEventListener('click', reset);
  $('muteBtn').addEventListener('click', toggleMute);
  $('autoStart').addEventListener('change', toggleAuto);

  ['cfgWork', 'cfgShort', 'cfgLong', 'cfgRounds'].forEach((id) =>
    $(id).addEventListener('change', applySettings)
  );

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
  });

  autoStart = $('autoStart').checked;
  loadPhase('work', false);
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
