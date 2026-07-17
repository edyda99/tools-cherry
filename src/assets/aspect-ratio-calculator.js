// aspect-ratio-calculator.js — aspect-ratio calculator UI.
// Pure logic via the shared aspect-ratio module. No deps, nothing uploaded.
//
// Two panels:
//  1) Simplify a width x height into its lowest-terms ratio (e.g. 1920x1080 -> 16:9).
//  2) Resize: lock a ratio (preset or custom), change width OR height, and the
//     other side recalculates to preserve the ratio.
import { simplifyRatio, ratioString, solveDimension } from '/assets/aspect-ratio.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const numOrNull = (v) => {
  const n = Number(String(v).trim());
  return String(v).trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

// --- Panel 1: simplify width x height -> ratio --------------------------------
function updateSimplify() {
  const w = numOrNull($('simW').value);
  const h = numOrNull($('simH').value);
  const out = $('simOut');
  const sub = $('simSub');
  if (w === null || h === null) {
    out.textContent = '—';
    sub.textContent = 'Enter a width and height to see the ratio.';
    return;
  }
  try {
    const ratio = ratioString(w, h);
    const r = simplifyRatio(w, h);
    out.textContent = ratio;
    const dec = (w / h).toFixed(3).replace(/\.?0+$/, '');
    sub.textContent = `${w} × ${h} simplifies to ${ratio} (${dec} : 1).`;
    sub.dataset.ratioW = r.w;
    sub.dataset.ratioH = r.h;
  } catch (e) {
    out.textContent = '—';
    sub.textContent = e.message;
  }
}

// --- Panel 2: resize while preserving a chosen ratio --------------------------
// Reads the current ratio from the preset select (or the two custom inputs).
function currentRatio() {
  const preset = $('ratioPreset').value;
  if (preset === 'custom') {
    return { rw: numOrNull($('ratioW').value), rh: numOrNull($('ratioH').value) };
  }
  const [rw, rh] = preset.split(':').map(Number);
  return { rw, rh };
}

// Recalculate the partner dimension. `driver` is 'w' or 'h' — the field the
// user just edited, which we keep fixed while solving for the other.
function recalc(driver) {
  const { rw, rh } = currentRatio();
  const err = $('resizeError');
  if (!rw || !rh) {
    err.textContent = 'Enter a valid custom ratio.';
    updateResizeOut();
    return;
  }
  err.textContent = '';
  try {
    if (driver === 'w') {
      const width = numOrNull($('outW').value);
      if (width === null) return;
      const { height } = solveDimension({ rw, rh, width });
      $('outH').value = height;
    } else {
      const height = numOrNull($('outH').value);
      if (height === null) return;
      const { width } = solveDimension({ rw, rh, height });
      $('outW').value = width;
    }
  } catch (e) {
    err.textContent = e.message;
  } finally {
    updateResizeOut();
  }
}

// Render the resolved width x height as the prominent answer for panel 2,
// mirroring panel 1's .net-big treatment. Display only — reads the values
// recalc() already solved, no new math.
function updateResizeOut() {
  const out = $('resizeOut');
  const sub = $('resizeSub');
  const w = $('outW').value;
  const h = $('outH').value;
  if (!w || !h) {
    out.textContent = '—';
    sub.textContent = '';
    return;
  }
  const { rw, rh } = currentRatio();
  out.textContent = `${w} × ${h} px`;
  sub.textContent = rw && rh ? `at a ${rw}:${rh} ratio` : '';
}

function onPresetChange() {
  const isCustom = $('ratioPreset').value === 'custom';
  $('customRatio').hidden = !isCustom;
  // Re-derive height from the current width whenever the ratio changes.
  recalc('w');
}

function init() {
  ['simW', 'simH'].forEach((id) => $(id).addEventListener('input', updateSimplify));
  $('ratioPreset').addEventListener('change', onPresetChange);
  ['ratioW', 'ratioH'].forEach((id) => $(id).addEventListener('input', () => recalc('w')));
  $('outW').addEventListener('input', () => recalc('w'));
  $('outH').addEventListener('input', () => recalc('h'));

  updateSimplify();
  onPresetChange();
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
