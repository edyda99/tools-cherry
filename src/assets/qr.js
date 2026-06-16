// qr.js — client-side QR generator (URL / WiFi / vCard / email / SMS / phone / text)
// with PNG + SVG export and an adjustable quiet-zone margin.
// Uses the vendored qrcode-generator lib (global `qrcode`). No network.

const $ = (id) => document.getElementById(id);
let modules = null; // last rendered module matrix (2D bool) for SVG export

// Quiet-zone (margin) modules each side. The QR spec recommends 4; a narrower
// or zero margin lets the code sit tighter when embedding, at some scan-reliability
// cost. Read from the selector, clamped to a sane range, default 4.
function quietZone() {
  const el = $('qrMargin');
  const v = el ? parseInt(el.value, 10) : 4;
  return Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 4;
}

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
  if (type === 'email') {
    const to = String($('emTo').value || '').trim();
    const params = [];
    if ($('emSubject').value) params.push('subject=' + encodeURIComponent($('emSubject').value));
    if ($('emBody').value) params.push('body=' + encodeURIComponent($('emBody').value));
    return 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') + (params.length ? '?' + params.join('&') : '');
  }
  if (type === 'sms') {
    // SMSTO:<number>:<message> — widely supported by phone cameras.
    const num = String($('smsTo').value || '').replace(/[^\d+]/g, '');
    const body = String($('smsBody').value || '');
    return body ? `SMSTO:${num}:${body}` : `SMSTO:${num}:`;
  }
  if (type === 'phone') {
    const num = String($('phoneNum').value || '').replace(/[^\d+]/g, '');
    return num ? 'tel:' + num : '';
  }
  if (type === 'text') {
    return $('textBody').value || '';
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
  const quiet = quietZone();
  const px = Math.max(128, Math.min(2048, parseInt($('qrSize').value, 10) || 512));
  const total = count + quiet * 2;
  const scale = Math.floor(px / total) || 1;
  const dim = scale * total;
  canvas.width = dim;
  canvas.height = dim;
  canvas.style.width = canvas.style.height = '256px';
  const fg = $('qrFg').value || '#000000';
  const bg = $('qrBg').value || '#ffffff';
  const ctx = canvas.getContext('2d');
  $('qrHolder').style.background = bg;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = fg;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
  status.textContent = `${count}×${count} modules · ${dim}px PNG`;
}

function svgString() {
  if (!modules) return '';
  const count = modules.length;
  const quiet = quietZone();
  const total = count + quiet * 2;
  let rects = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (modules[r][c]) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
    }
  }
  const fg = $('qrFg').value || '#000000';
  const bg = $('qrBg').value || '#ffffff';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/><g fill="${fg}">${rects}</g></svg>`;
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
  document.querySelectorAll('#qrForm input, #qrForm select, #qrForm textarea').forEach((el) =>
    el.addEventListener('input', render)
  );
  $('dlPng').addEventListener('click', downloadPng);
  $('dlSvg').addEventListener('click', downloadSvg);
  syncGroups();
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
