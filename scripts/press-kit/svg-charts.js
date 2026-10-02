// svg-charts.js: the three press-kit charts as standalone SVG strings.
//
// Pure string building, no dependencies, so the same SVG is what ships as the
// .svg download AND what headless Chrome rasterises into the .png. Every number
// drawn here arrives already computed by build-press-kit.js (which runs the
// site's own engines); this file only positions it.
//
// Design rules (from the dataviz method, applied to static press images):
//   - the title states the takeaway, the subtitle states what is measured
//     and whether a figure is OFFICIAL / ESTIMATE / PROJECTED;
//   - one hue for a single series (slot 1 blue), no legend box for one series;
//   - bars <= 24px thick, 4px rounded data end, square at the baseline;
//   - dots r=5 with a 2px surface ring; hairline solid gridlines;
//   - text always wears ink tokens, never the series colour;
//   - selective direct labels; every value is also in the CSV (table view);
//   - source line and the tools-berry.com credit are baked into the image.
// Palette validated with the dataviz validator against the #ffffff surface
// (slot 1 #2a78d6 only; all checks pass). Light only: these are print/press
// images, there is no theme to follow.

export const C = {
  surface: '#ffffff',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  base: '#c3c2b7',
  guide: '#f0efec',
  series1: '#2a78d6',
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const W = 1200;          // design width; PNGs render at 2x = 2400px
const PAD = 48;

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

// Rough advance-width estimate for the system sans. Only used to wrap long
// lines and to keep labels clear of each other, so it errs wide.
function textWidth(s, size, weight = 400) {
  let w = 0;
  for (const ch of String(s)) {
    if ('il.,:;|!\'1 '.includes(ch)) w += 0.30;
    else if ('ftjr()-'.includes(ch)) w += 0.40;
    else if ('mwMW%'.includes(ch)) w += 0.86;
    else if (ch >= 'A' && ch <= 'Z') w += 0.66;
    else w += 0.56;
  }
  return w * size * (weight >= 600 ? 1.06 : 1);
}

function wrap(s, size, weight, maxW) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && textWidth(next, size, weight) > maxW) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Wrap into the same number of lines greedy wrapping needs, but as evenly as
// possible, so a title never ends on a one-word orphan.
function balancedWrap(s, size, weight, maxW) {
  const n = wrap(s, size, weight, maxW).length;
  if (n <= 1) return wrap(s, size, weight, maxW);
  let lo = maxW / n, hi = maxW;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(s, size, weight, mid).length > n) lo = mid; else hi = mid;
  }
  return wrap(s, size, weight, hi);
}

const text = (x, y, s, { size = 14, weight = 400, fill = C.ink, anchor = 'start', extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"` +
  `${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${extra}>${esc(s)}</text>`;

// A horizontal bar with a 4px rounded data end and a square baseline end.
function hbar(x0, x1, yMid, h, fill) {
  const y = yMid - h / 2;
  const r = Math.min(4, Math.abs(x1 - x0) / 2);
  if (x1 >= x0) {
    return `<path d="M${x0},${y} H${x1 - r} Q${x1},${y} ${x1},${y + r} V${y + h - r} ` +
      `Q${x1},${y + h} ${x1 - r},${y + h} H${x0} Z" fill="${fill}"/>`;
  }
  return `<path d="M${x0},${y} H${x1 + r} Q${x1},${y} ${x1},${y + r} V${y + h - r} ` +
    `Q${x1},${y + h} ${x1 + r},${y + h} H${x0} Z" fill="${fill}"/>`;
}

function niceStep(span, maxTicks) {
  const raw = span / Math.max(1, maxTicks);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

/**
 * The shared frame: badge, wrapped title and subtitle, the plot, notes, a
 * hairline, the wrapped source line and the credit. `plot(y)` draws the plot
 * starting at y and returns { svg, height }.
 */
function frame({ title, subtitle, badge, plot, notes = [], source, credit, ariaTitle, ariaDesc }) {
  const parts = [];
  let y = PAD;
  // Badge (status label), top right. Outlined in ink: it is a label, not a
  // status colour, so it survives greyscale print and never reads as a series.
  let badgeW = 0;
  if (badge) {
    badgeW = Math.ceil(textWidth(badge, 15, 700) + 15 * 0.12 * badge.length + 28);
    const bx = W - PAD - badgeW;
    parts.push(`<rect x="${bx}" y="${y - 4}" width="${badgeW}" height="32" rx="6" fill="none" ` +
      `stroke="${C.ink}" stroke-width="2"/>`);
    parts.push(text(bx + badgeW / 2, y + 17, badge, { size: 15, weight: 700, anchor: 'middle',
      extra: ' letter-spacing="0.12em"' }));
  }
  const titleLines = balancedWrap(title, 30, 650, W - 2 * PAD - (badgeW ? badgeW + 28 : 0));
  y += 24;
  for (const l of titleLines) { parts.push(text(PAD, y, l, { size: 30, weight: 650 })); y += 38; }
  y += 2;
  for (const l of wrap(subtitle, 17, 400, W - 2 * PAD)) {
    parts.push(text(PAD, y, l, { size: 17, fill: C.ink2 })); y += 25;
  }
  y += 22;
  const p = plot(y);
  parts.push(p.svg);
  y += p.height + 18;
  for (const n of notes) {
    for (const l of wrap(n, 13.5, 400, W - 2 * PAD)) {
      parts.push(text(PAD, y, l, { size: 13.5, fill: C.ink2 })); y += 19;
    }
    y += 2;
  }
  y += 10;
  parts.push(`<line x1="${PAD}" x2="${W - PAD}" y1="${y}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`);
  y += 24;
  const creditW = textWidth(credit, 15, 700) + 24;
  const srcLines = wrap(source, 13.5, 400, W - 2 * PAD - creditW);
  parts.push(text(W - PAD, y, credit, { size: 15, weight: 700, anchor: 'end' }));
  for (const l of srcLines) { parts.push(text(PAD, y, l, { size: 13.5, fill: C.muted })); y += 19; }
  const H = Math.ceil(y + PAD - 19 + 6);
  return {
    width: W,
    height: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
      `role="img" aria-labelledby="t d" font-family="${esc(FONT)}">` +
      `<title id="t">${esc(ariaTitle || title)}</title><desc id="d">${esc(ariaDesc || subtitle)}</desc>` +
      `<rect width="${W}" height="${H}" fill="${C.surface}"/>` +
      parts.join('') + '</svg>\n',
  };
}

/**
 * Chart 1: what the COLA does to three example monthly checks.
 * @param {{title,subtitle,badge,notes,source,credit, rows:Array<{benefit,newMonthly,monthlyIncrease,annualIncrease}>}} o
 */
export function colaChart(o) {
  const labelCol = 250;
  const x0 = PAD + labelCol;
  const xMax = W - PAD - 290;
  const maxV = Math.max(...o.rows.map((r) => r.monthlyIncrease), 1);
  const step = niceStep(maxV, 5);
  const top = Math.ceil(maxV / step) * step;
  const sx = (v) => x0 + (v / top) * (xMax - x0);
  const rowH = 78;
  return frame({
    ...o,
    plot: (y0) => {
      const s = [];
      const plotH = o.rows.length * rowH;
      for (let v = 0; v <= top + 1e-9; v += step) {
        const x = sx(v);
        s.push(`<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + plotH}" stroke="${v === 0 ? C.base : C.grid}" stroke-width="1"/>`);
        s.push(text(x, y0 + plotH + 22, usd(v), { size: 13, fill: C.muted, anchor: 'middle' }));
      }
      s.push(text(x0, y0 + plotH + 46, 'Increase in the monthly payment', { size: 13, fill: C.muted }));
      o.rows.forEach((r, i) => {
        const yc = y0 + i * rowH + rowH / 2;
        s.push(text(PAD, yc - 4, `${usd(r.benefit)} a month now`, { size: 18, weight: 600 }));
        s.push(text(PAD, yc + 18, `becomes ${usd(r.newMonthly)}`, { size: 15, fill: C.ink2 }));
        const x1 = sx(r.monthlyIncrease);
        s.push(hbar(x0, x1, yc, 24, C.series1));
        s.push(`<text x="${x1 + 12}" y="${yc + 6}" font-size="18" font-weight="650" fill="${C.ink}">` +
          `+${esc(usd(r.monthlyIncrease))} a month<tspan font-size="15" font-weight="400" fill="${C.ink2}">` +
          `  (${esc(usd(r.annualIncrease))} a year)</tspan></text>`);
      });
      return { svg: s.join(''), height: plotH + 52 };
    },
  });
}

/**
 * Chart 2: change in federal income tax, 2027 vs 2026, by filing status and wage.
 * @param {{groups:Array<{label, rows:Array<{wages,tax2026,tax2027,change}>}>, label2027:string}} o
 *   change = tax2026 - tax2027 (positive = less tax in 2027)
 */
export function federalChart(o) {
  const labelCol = 200;
  const x0Base = PAD + labelCol;
  const xMax = W - PAD - 470;
  const all = o.groups.flatMap((g) => g.rows.map((r) => r.change));
  const maxV = Math.max(0, ...all);
  const minV = Math.min(0, ...all);
  const step = niceStep(maxV - minV || 1, 6);
  const hi = Math.ceil(maxV / step) * step;
  const lo = Math.floor(minV / step) * step;
  const sx = (v) => x0Base + ((v - lo) / (hi - lo || 1)) * (xMax - x0Base);
  const rowH = 54;
  const groupH = 40;
  return frame({
    ...o,
    plot: (y0) => {
      const s = [];
      const plotH = o.groups.reduce((h, g) => h + groupH + g.rows.length * rowH, 0);
      for (let v = lo; v <= hi + 1e-9; v += step) {
        const x = sx(v);
        s.push(`<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + plotH}" stroke="${v === 0 ? C.base : C.grid}" stroke-width="1"/>`);
        s.push(text(x, y0 + plotH + 22, usd(Math.abs(v)), { size: 13, fill: C.muted, anchor: 'middle' }));
      }
      s.push(text(sx(0), y0 + plotH + 46, 'Less federal income tax in 2027 than in 2026, same pay', { size: 13, fill: C.muted }));
      let y = y0;
      for (const g of o.groups) {
        s.push(text(PAD, y + 26, g.label, { size: 17, weight: 700 }));
        y += groupH;
        for (const r of g.rows) {
          const yc = y + rowH / 2;
          s.push(text(PAD, yc + 6, `${usd(r.wages)} wages`, { size: 17, weight: 500 }));
          const xa = sx(0);
          const xb = sx(r.change);
          s.push(hbar(xa, xb, yc, 22, C.series1));
          const lx = Math.max(xa, xb) + 12;
          const word = r.change >= 0 ? 'less' : 'more';
          s.push(`<text x="${lx}" y="${yc + 6}" font-size="17" font-weight="650" fill="${C.ink}">` +
            `${esc(usd(Math.abs(r.change)))} ${word}<tspan font-size="14.5" font-weight="400" fill="${C.ink2}">` +
            `  ${esc(usd(r.tax2026))} in 2026, ${esc(usd(r.tax2027))} ${esc(o.label2027)}</tspan></text>`);
          y += rowH;
        }
      }
      return { svg: s.join(''), height: plotH + 52 };
    },
  });
}

/**
 * Chart 3: take-home pay in every state, two salary panels sharing one row
 * order (small multiples, so colour never has to encode salary).
 * @param {{panels:Array<{label, salary}>, rows:Array<{name, mark, values:number[], label?:Array<{text, side}|null>}>}} o
 *   rows already sorted; values[i] belongs to panels[i]; label[i] is an optional
 *   direct value label for that dot (used sparingly: the extremes only).
 */
export function takeHomeChart(o) {
  const nameCol = 190;
  const gap = 84;   // keeps the edge tick labels of neighbouring panels apart
  const right = 70;  // room for the end labels on the last panel
  const panelW = (W - 2 * PAD - nameCol - gap * (o.panels.length - 1) - right) / o.panels.length;
  const rowH = 19.5;
  const headH = 64;
  const scales = o.panels.map((p, i) => {
    const vals = o.rows.map((r) => r.values[i]);
    const step = niceStep(Math.max(...vals) - Math.min(...vals), 4);
    const lo = Math.floor(Math.min(...vals) / step) * step;
    const hi = Math.ceil(Math.max(...vals) / step) * step;
    const x0 = PAD + nameCol + i * (panelW + gap);
    return { lo, hi, step, x0, sx: (v) => x0 + ((v - lo) / (hi - lo)) * panelW };
  });
  return frame({
    ...o,
    plot: (y0) => {
      const s = [];
      const bodyTop = y0 + headH;
      const plotH = o.rows.length * rowH;
      scales.forEach((sc, i) => {
        s.push(text(sc.x0, y0 + 18, o.panels[i].label, { size: 17, weight: 700 }));
        for (let v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
          const x = sc.sx(v);
          s.push(`<line x1="${x}" x2="${x}" y1="${bodyTop - 8}" y2="${bodyTop + plotH}" stroke="${C.grid}" stroke-width="1"/>`);
          s.push(text(x, bodyTop - 16, usd(v), { size: 12.5, fill: C.muted, anchor: 'middle' }));
          s.push(text(x, bodyTop + plotH + 20, usd(v), { size: 12.5, fill: C.muted, anchor: 'middle' }));
        }
      });
      o.rows.forEach((r, ri) => {
        const yc = bodyTop + ri * rowH + rowH / 2;
        s.push(`<line x1="${PAD + nameCol}" x2="${W - PAD - right}" y1="${yc}" y2="${yc}" stroke="${C.guide}" stroke-width="1"/>`);
        s.push(text(PAD + nameCol - 14, yc + 4.5, r.name + (r.mark || ''), { size: 13.5, fill: C.ink, anchor: 'end' }));
        scales.forEach((sc, i) => {
          const cx = sc.sx(r.values[i]);
          s.push(`<circle cx="${cx}" cy="${yc}" r="5" fill="${C.series1}" stroke="${C.surface}" stroke-width="2"/>`);
          const L = r.label && r.label[i];
          if (L) {
            const left = L.side === 'left';
            s.push(text(left ? cx - 11 : cx + 11, yc + 4.5, L.text,
              { size: 13, weight: 650, anchor: left ? 'end' : 'start' }));
          }
        });
      });
      return { svg: s.join(''), height: headH + plotH + 28 };
    },
  });
}
