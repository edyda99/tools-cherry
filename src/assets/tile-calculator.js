// tile-calculator.js — tile calculator UI with US/metric unit toggle.
// Live results, graceful empty/invalid handling (never shows NaN).
// Pure math via the shared tile engine module. No deps, nothing uploaded.
import { estimateTiles, SYSTEMS } from '/assets/tile.js';

const $ = (id) => document.getElementById(id);

function fmtInt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmt(n, dp = 2) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp
  });
}

const val = (id) => ($(id) ? $(id).value.trim() : '');
const numOrBlank = (id) => (val(id) === '' ? null : parseFloat(val(id)));

function syncUnitLabels(system) {
  const cfg = SYSTEMS[system] || SYSTEMS.us;
  document.querySelectorAll('.len-unit').forEach((el) => (el.textContent = cfg.lengthUnit));
  document.querySelectorAll('.tile-unit').forEach((el) => (el.textContent = cfg.tileUnit));
}

function reset(out, sub, detail, msg) {
  out.textContent = '—';
  sub.textContent = msg || 'Enter the room size and tile size to estimate tiles.';
  detail.innerHTML = '';
}

function row(label, value) {
  return `<li><span class="lbl">${label}</span><span>${value}</span></li>`;
}

function calc() {
  const system = val('system') === 'metric' ? 'metric' : 'us';
  syncUnitLabels(system);

  const out = $('out');
  const sub = $('sub');
  const detail = $('detail');

  const length = numOrBlank('length');
  const width = numOrBlank('width');
  const tileW = numOrBlank('tileW');
  const tileH = numOrBlank('tileH');

  if (
    !(length > 0) ||
    !(width > 0) ||
    !(tileW > 0) ||
    !(tileH > 0)
  ) {
    return reset(out, sub, detail);
  }

  const wasteRaw = numOrBlank('waste');
  const waste = wasteRaw == null ? 10 : wasteRaw;
  const perBox = numOrBlank('perBox');

  const r = estimateTiles({
    length,
    width,
    tileW,
    tileH,
    waste,
    perBox: perBox == null ? undefined : perBox,
    system
  });

  if (!(r.tilesNeeded > 0)) return reset(out, sub, detail);

  out.textContent = `${fmtInt(r.tilesNeeded)} tiles`;
  sub.textContent =
    r.boxes != null
      ? `Buy about ${fmtInt(r.boxes)} box${r.boxes === 1 ? '' : 'es'} (${r.waste}% waste included)`
      : `Includes a ${r.waste}% allowance for cuts and breakage`;

  const detailRows = [
    row('Area to cover', `${fmt(r.area)} ${r.areaUnit}`),
    row('One tile', `${fmt(r.tileArea, 3)} ${r.areaUnit}`),
    row('Tiles before waste', fmtInt(Math.ceil(r.baseTiles))),
    row('Waste allowance', `${r.waste}%`),
    row('Tiles to buy', `${fmtInt(r.tilesNeeded)}`)
  ];
  if (r.boxes != null) detailRows.push(row('Boxes to buy', fmtInt(r.boxes)));
  detail.innerHTML = detailRows.join('');
}

function init() {
  document.querySelectorAll('#tileForm input, #tileForm select').forEach((el) =>
    el.addEventListener('input', calc)
  );
  calc();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
