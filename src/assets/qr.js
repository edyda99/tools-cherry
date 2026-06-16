// qr.js — client-side QR generator (URL / WiFi / vCard / email / SMS / phone / text)
// with PNG + SVG export, an adjustable quiet-zone margin, a contrast/scannability
// warning, and an optional center logo overlay (forces High ECC; embedded in both
// the canvas render and the SVG export). Uses the vendored qrcode-generator lib
// (global `qrcode`). No network — logos stay client-side via FileReader.

const $ = (id) => document.getElementById(id);
let modules = null; // last rendered module matrix (2D bool) for SVG export

// Optional center logo: its data URL (for SVG embed) and a decoded HTMLImageElement
// (for canvas draw). When present we force High error correction so the code still
// scans despite the modules it covers, and draw a small white padding box behind it.
let logoDataUrl = null;
let logoImg = null;
const LOGO_FRACTION = 0.2; // logo size as a fraction of the QR area (~18-22%)
const LOGO_PAD = 0.14; // white padding box = logo size * (1 + LOGO_PAD*2)

// Quiet-zone (margin) modules each side. The QR spec recommends 4; a narrower
// or zero margin lets the code sit tighter when embedding, at some scan-reliability
// cost. Read from the selector, clamped to a sane range, default 4.
function quietZone() {
  const el = $('qrMargin');
  const v = el ? parseInt(el.value, 10) : 4;
  return Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 4;
}

// --- Scannability guard: contrast between foreground and background ---------
// QR scanners distinguish modules by reflectance difference (ISO/IEC 18004).
// We use the WCAG relative-luminance contrast ratio (1:1 .. 21:1) as a proxy:
// black-on-white is 21:1; ~4:1 is the practical floor for reliable phone scans.
// We also flag the inverted case (light foreground on a darker background),
// which many scanners refuse outright.
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const s = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
  const n = parseInt(s, 16);
  if (!Number.isFinite(n) || s.length !== 6) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Returns { ratio, fgLum, bgLum } or null if either colour can't be parsed.
function contrastInfo(fgHex, bgHex) {
  const fg = hexToRgb(fgHex), bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const lf = relLuminance(fg), lb = relLuminance(bg);
  const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
  return { ratio, fgLum: lf, bgLum: lb };
}

const MIN_CONTRAST = 4; // practical floor for reliable smartphone scanning

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

  // A center logo covers modules, so force High error correction when one is set.
  const ecc = logoImg ? 'H' : $('qrEcc').value;

  let qr;
  try {
    qr = qrcode(0, ecc); // type 0 = auto-fit
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
  drawLogo(ctx, dim, bg);
  status.textContent =
    `${count}×${count} modules · ${dim}px PNG` + (logoImg ? ' · logo (ECC: High)' : '');
  updateContrastWarning(fg, bg);
}

// Draw the center logo onto the canvas with a white (bg-coloured) padding box behind
// it so the modules under the logo are visually cleared. Sized to LOGO_FRACTION of
// the full QR dimension, preserving the logo's aspect ratio inside that box.
function drawLogo(ctx, dim, bg) {
  if (!logoImg) return;
  const box = dim * LOGO_FRACTION; // max logo edge
  const pad = dim * LOGO_FRACTION * LOGO_PAD;
  const iw = logoImg.naturalWidth || logoImg.width;
  const ih = logoImg.naturalHeight || logoImg.height;
  if (!iw || !ih) return;
  const ratio = Math.min(box / iw, box / ih);
  const w = iw * ratio, h = ih * ratio;
  const cx = dim / 2, cy = dim / 2;
  // padding box (white / background colour) centred on the QR
  const padW = w + pad * 2, padH = h + pad * 2;
  ctx.fillStyle = bg;
  ctx.fillRect(cx - padW / 2, cy - padH / 2, padW, padH);
  ctx.drawImage(logoImg, cx - w / 2, cy - h / 2, w, h);
}

// Show or clear a scannability warning based on fg/bg contrast.
function updateContrastWarning(fg, bg) {
  const el = $('qrWarn');
  if (!el) return;
  const info = contrastInfo(fg, bg);
  if (!info) { el.hidden = true; el.textContent = ''; return; }
  const r = info.ratio.toFixed(1);
  if (info.fgLum > info.bgLum) {
    // Light foreground on a darker background — many scanners reject this.
    el.hidden = false;
    el.textContent =
      `Warning: your foreground colour is lighter than the background. Most scanners expect dark modules on a light background — swap the colours so the code scans reliably.`;
  } else if (info.ratio < MIN_CONTRAST) {
    el.hidden = false;
    el.textContent =
      `Warning: low contrast (${r}:1). The foreground and background colours are too close — aim for at least 4:1 (black on white is 21:1) so phones can scan it reliably.`;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
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
  let logo = '';
  if (logoDataUrl && logoImg) {
    // Match the canvas geometry in viewBox (module) units.
    const iw = logoImg.naturalWidth || logoImg.width;
    const ih = logoImg.naturalHeight || logoImg.height;
    if (iw && ih) {
      const box = total * LOGO_FRACTION;
      const pad = total * LOGO_FRACTION * LOGO_PAD;
      const ratio = Math.min(box / iw, box / ih);
      const w = iw * ratio, h = ih * ratio;
      const cx = total / 2, cy = total / 2;
      const padW = w + pad * 2, padH = h + pad * 2;
      logo =
        `<rect x="${cx - padW / 2}" y="${cy - padH / 2}" width="${padW}" height="${padH}" fill="${bg}"/>` +
        `<image x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" ` +
        `preserveAspectRatio="xMidYMid meet" href="${logoDataUrl}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/><g fill="${fg}">${rects}</g>${logo}</svg>`;
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

// Load (or clear) the center logo from the file input. Stays fully client-side:
// FileReader -> data URL -> decoded Image; nothing is uploaded.
function onLogoChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      logoDataUrl = reader.result;
      logoImg = img;
      reflectLogoState();
      render();
    };
    img.onerror = () => { clearLogo(); };
    img.src = reader.result;
  };
  reader.onerror = () => { clearLogo(); };
  reader.readAsDataURL(file);
}

function clearLogo() {
  logoDataUrl = null;
  logoImg = null;
  const input = $('qrLogo');
  if (input) input.value = '';
  reflectLogoState();
  render();
}

// When a logo is present, lock the ECC selector to High (visually) and reveal the
// remove button; otherwise restore normal control.
function reflectLogoState() {
  const ecc = $('qrEcc');
  const clearBtn = $('qrLogoClear');
  const has = !!logoImg;
  if (ecc) {
    ecc.disabled = has;
    if (has) ecc.value = 'H';
  }
  if (clearBtn) clearBtn.hidden = !has;
}

function init() {
  $('qrType').addEventListener('change', () => { syncGroups(); render(); });
  document.querySelectorAll('#qrForm input, #qrForm select, #qrForm textarea').forEach((el) =>
    el.addEventListener('input', render)
  );
  const logo = $('qrLogo');
  if (logo) logo.addEventListener('change', onLogoChange);
  const clearBtn = $('qrLogoClear');
  if (clearBtn) clearBtn.addEventListener('click', clearLogo);
  $('dlPng').addEventListener('click', downloadPng);
  $('dlSvg').addEventListener('click', downloadSvg);
  syncGroups();
  render();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
