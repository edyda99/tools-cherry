// qr.js — client-side QR generator (URL / WiFi / vCard) with PNG + SVG export.
// Uses the vendored qrcode-generator lib (global `qrcode`). No network.

const $ = (id) => document.getElementById(id);
let modules = null; // last rendered module matrix (2D bool) for SVG export
const QUIET = 4;     // quiet-zone modules each side

// Escape per the WiFi QR spec: \ ; , : " are special.
function wifiEscape(s) {
  return String(s || '').replace(/([\\;,:"])/g, '\\$1');
}

function vcardEscape(s) {
  return String(s || '').replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
}

function buildPayload() {
  const type = $('qrType').value;
  if (type === 'wifi') {
    const auth = $('wifiAuth').value;
    const ssid = wifiEscape($('wifiSsid').value);
    const hidden = $('wifiHidden').value === 'true' ? 'true' : 'false';
    if (auth === 'nopass') return `WIFI:T:nopass;S:${ssid};H:${hidden};;`;
    return `WIFI:T:${auth};S:${ssid};P:${wifiEscape($('wifiPass').value)};H:${hidden};;`;
  }
  if (type === 'vcard') {
    const first = $('vcFirst').value, last = $('vcLast').value;
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
      `FN:${vcardEscape((first + ' ' + last).trim())}`
    ];
    if ($('vcOrg').value) lines.push(`ORG:${vcardEscape($('vcOrg').value)}`);
    if ($('vcTitle').value) lines.push(`TITLE:${vcardEscape($('vcTitle').value)}`);
    if ($('vcPhone').value) lines.push(`TEL;TYPE=CELL:${vcardEscape($('vcPhone').value)}`);
    if ($('vcEmail').value) lines.push(`EMAIL:${vcardEscape($('vcEmail').value)}`);
    if ($('vcUrl').value) lines.push(`URL:${vcardEscape($('vcUrl').value)}`);
    lines.push('END:VCARD');
    return lines.join('\n');
  }
  return $('urlText').value || '';
}

function render() {
  const data = buildPayload();
  const status = $('qrStatus');
  const canvas = $('qrCanvas');
  if (!data) { status.textContent = 'Enter some content to generate a QR code.'; return; }

  let qr;
  try {
    qr = qrcode(0, $('qrEcc').value); // type 0 = auto-fit
    qr.addData(data);
    qr.make();
  } catch (e) {
    status.textContent = 'Content is too long for a single QR code — shorten it.';
    return;
  }

  const count = qr.getModuleCount();
  modules = [];
  for (let r = 0; r < count; r++) {
    const row = [];
    for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
    modules.push(row);
  }

  // render to canvas at requested pixel size
  const px = Math.max(128, Math.min(2048, parseInt($('qrSize').value, 10) || 512));
  const total = count + QUIET * 2;
  const scale = Math.floor(px / total) || 1;
  const dim = scale * total;
  canvas.width = dim;
  canvas.height = dim;
  canvas.style.width = canvas.style.height = '256px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (modules[r][c]) ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
    }
  }
  status.textContent = `${count}×${count} modules · ${dim}px PNG`;
}

function svgString() {
  if (!modules) return '';
  const count = modules.length;
  const total = count + QUIET * 2;
  let rects = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (modules[r][c]) rects += `<rect x="${c + QUIET}" y="${r + QUIET}" width="1" height="1"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileBase() {
  return 'qr-' + $('qrType').value;
}

function downloadPng() {
  if (!modules) return;
  $('qrCanvas').toBlob((blob) => { if (blob) downloadBlob(blob, fileBase() + '.png'); }, 'image/png');
}

function downloadSvg() {
  const svg = svgString();
  if (!svg) return;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
}

function syncGroups() {
  const type = $('qrType').value;
  document.querySelectorAll('[data-group]').forEach((g) => {
    g.hidden = g.getAttribute('data-group') !== type;
  });
}

function init() {
  $('qrType').addEventListener('change', () => { syncGroups(); render(); });
  document.querySelectorAll('#qrForm input, #qrForm select').forEach((el) =>
    el.addEventListener('input', render)
  );
  $('dlPng').addEventListener('click', downloadPng);
  $('dlSvg').addEventListener('click', downloadSvg);
  syncGroups();
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
