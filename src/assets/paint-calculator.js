// paint-calculator.js — paint-quantity calculator UI.
// Pure logic via the shared paint module. No deps, nothing uploaded.
//
// User enters room length, width, and wall height, plus how many doors and
// windows to subtract, the number of coats, and (optionally) a custom coverage
// figure. The tool reports the paintable wall area and how much paint to buy,
// switching between US (feet / gallons) and metric (metres / litres).
import { estimatePaint, COVERAGE } from '/assets/paint.js';

const $ = (id) => document.getElementById(id);
const numOrZero = (v) => {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
};

function currentSystem() {
  return $('system').value === 'metric' ? 'metric' : 'us';
}

// Re-label the dimension/coverage fields and the default coverage placeholder
// whenever the unit system changes.
function applyUnitLabels() {
  const system = currentSystem();
  const cfg = COVERAGE[system];
  document.querySelectorAll('.len-unit').forEach((el) => { el.textContent = cfg.lengthUnit; });
  $('coverage').placeholder = String(cfg.area);
  $('coverageUnit').textContent = `${cfg.areaUnit} per ${cfg.paintUnit}`;
}

function update() {
  const system = currentSystem();
  const r = estimatePaint({
    length: numOrZero($('length').value),
    width: numOrZero($('width').value),
    height: numOrZero($('height').value),
    doors: numOrZero($('doors').value),
    windows: numOrZero($('windows').value),
    coats: numOrZero($('coats').value) || 2,
    coverage: numOrZero($('coverage').value), // 0 -> engine uses system default
    system
  });

  const out = $('out');
  const sub = $('sub');
  const detail = $('detail');

  if (r.paintableArea <= 0) {
    out.textContent = '—';
    sub.textContent = 'Enter the room length, width, and wall height to estimate paint.';
    detail.innerHTML = '';
    return;
  }

  const unitWord = r.containers === 1 ? r.paintUnit : `${r.paintUnit}s`;
  out.textContent = `${r.containers} ${unitWord}`;
  sub.textContent = `You need about ${r.paintNeeded} ${r.paintNeeded === 1 ? r.paintUnit : r.paintUnit + 's'} of paint — buy ${r.containers} to be safe.`;

  detail.innerHTML =
    `<li>Wall area: <strong>${r.grossWallArea} ${r.areaUnit}</strong></li>` +
    `<li>Less doors &amp; windows: <strong>${r.openingsArea} ${r.areaUnit}</strong></li>` +
    `<li>Paintable area: <strong>${r.paintableArea} ${r.areaUnit}</strong></li>` +
    `<li>Coats: <strong>${r.coats}</strong> · Coverage: <strong>${r.coverage} ${r.areaUnit} / ${r.paintUnit}</strong></li>`;
}

function init() {
  $('system').addEventListener('change', () => { applyUnitLabels(); update(); });
  ['length', 'width', 'height', 'doors', 'windows', 'coats', 'coverage'].forEach((id) =>
    $(id).addEventListener('input', update)
  );
  applyUnitLabels();
  update();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
