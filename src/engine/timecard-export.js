// timecard-export.js — pure serializer: a time card -> tab-separated plain text
// for the clipboard. All math comes from timecard.js; this file only decides
// what gets written and what is deliberately left blank.
//
// Standing rule for every line below: a label must describe the number actually
// used, and no two figures in the file may let a reader derive two different
// answers without being told why. This file is pasted into a spreadsheet and
// handed to a payroll clerk, so a line that quietly contradicts its neighbour is
// worse than a line that is missing.
import {
  parseTime, shiftMinutes, totalMinutes, breakMinutes,
  minutesToDecimal, minutesToHhmm, formatDecimal,
  grossPay, overtimeSplit, grossPayOvertime
} from './timecard.js';

const TAB = '\t';
const HEADER = ['Day', 'Start', 'End', 'Break (min)', 'Hours (decimal)', 'Hours (h:mm)'];
const PAGE_URL = 'https://tools-berry.com/hours-calculator/';

// Excel and Google Sheets read a cell that opens with one of these as a formula:
// a day labelled "=1+1" pastes as 2, "-Monday" as #NAME?. Nobody is attacking
// anyone here, the visitor typed their own label and pastes into their own
// sheet, but the Day column would then show a value they never wrote, which is
// the one thing this file must not do.
const FORMULA_LEAD = /^[=+\-@]/;

// One leading space is enough for both spreadsheets to treat the cell as text.
// Chosen over the usual apostrophe because this text is pasted into a plain
// email or a chat as often as into a sheet, and there an apostrophe is a visible
// wart on the label while a space is not. Applied only to labels that actually
// open with a trigger, so an ordinary "Monday" is passed through untouched.
const cleanLabel = (s) => {
  const flat = String(s == null ? '' : s).replace(/[\t\r\n]/g, ' ').trim();
  return FORMULA_LEAD.test(flat) ? ' ' + flat : flat;
};

const num = (n) => String(Number(n));                       // 40 -> "40", 1.5 -> "1.5"
const money = (n) => (Number.isFinite(n) ? n.toFixed(2) : '');

// The rate is an input, not a payment, so it is printed as it was applied rather
// than rounded to cents. Rounding it made the pay block contradict itself:
// 20.555/h over 10.00 h printed "20.55" beside a gross of "205.55", and 0.005/h
// printed "0.01" beside "0.05". The alternative, recomputing the pay from a
// rate rounded to cents, would print a gross the tool never calculated and would
// disagree with the figure on screen, so the input keeps its digits and only the
// money is rounded, once, at the end.
// Two decimals whenever that is exact, more only when the extra digits are real.
const rateText = (n) => {
  if (!Number.isFinite(n)) return '';
  const two = n.toFixed(2);
  return Number(two) === n ? two : String(n);
};

// The engine falls back silently when a setting is out of range: overtimeSplit
// keeps a threshold only when it is a finite number >= 0, grossPayOvertime keeps
// a multiplier only when it is a finite number > 0. Both rules are mirrored here
// and the result is fed back into those functions, so the value in the label is
// provably the value that produced the figure beside it. Without this, a
// multiplier field of -2 printed "Overtime pay (-2x rate)" next to pay computed
// at 1.5, and a threshold of -10 printed "first -10 h/week" next to 40.00, a
// line that contradicts itself.
export function effectiveThreshold(v) {
  const t = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(t) && t >= 0 ? t : 40;
}

export function effectiveMultiplier(v) {
  return Number.isFinite(v) && v > 0 ? v : 1.5;
}

// model = { rows:[{label,start,end,breakMin}], show:{otHours,pay,otPay},
//           otOn, otThreshold, otMult, rate, today }
export function buildTimecardText(model) {
  const rows = Array.isArray(model.rows) ? model.rows : [];
  const show = model.show || {};
  const thr = effectiveThreshold(model.otThreshold);
  const mult = effectiveMultiplier(model.otMult);
  const lines = [HEADER.join(TAB)];

  for (const r of rows) {
    const m = shiftMinutes(r.start, r.end, r.breakMin);
    const ok = Number.isFinite(m);
    const overnight = ok && parseTime(r.end) <= parseTime(r.start);
    lines.push([
      cleanLabel(r.label),
      r.start || '',
      overnight ? `${r.end} (+1 day)` : (r.end || ''),
      ok ? num(breakMinutes(r.breakMin)) : String(r.breakMin == null ? '' : r.breakMin),
      ok ? formatDecimal(minutesToDecimal(m)) : '',
      ok ? minutesToHhmm(m) : ''
    ].join(TAB));
  }

  const totMin = totalMinutes(
    rows.map((r) => ({ start: r.start, end: r.end, breakMin: r.breakMin }))
  );
  const totHours = minutesToDecimal(totMin);

  lines.push('');
  lines.push('Total hours (decimal)' + TAB + formatDecimal(totHours));
  lines.push('Total hours (h:mm)' + TAB + minutesToHhmm(totMin));

  if (show.otHours) {
    const split = overtimeSplit(totHours, thr);
    lines.push(`Regular hours (first ${num(thr)} h/week)` + TAB + formatDecimal(split.regular));
    lines.push('Overtime hours' + TAB + formatDecimal(split.overtime));
  }

  if (show.pay) {
    lines.push('Hourly rate (USD)' + TAB + rateText(model.rate));
    const otPay = grossPayOvertime(totHours, model.rate, { thresholdHours: thr, multiplier: mult });
    if (show.otPay) {
      lines.push('Regular pay' + TAB + money(otPay.regularPay));
      lines.push(`Overtime pay (${num(mult)}x rate)` + TAB + money(otPay.overtimePay));
      lines.push('Estimated gross pay' + TAB + money(otPay.total));
    } else {
      // Mirror render(): the OT branch is used whenever the toggle is on, even
      // when no overtime accrued, so the file can never disagree with the page.
      const total = model.otOn ? otPay.total : grossPay(totHours, model.rate);
      lines.push('Estimated gross pay' + TAB + money(total));
    }
  }

  lines.push('');
  // Name the rounding rule instead of leaving the reader to find it.
  // The per-day decimal stays at 2 places because that is exactly what the page
  // shows on screen, and the file is not allowed to disagree with the page; the
  // totals stay computed from exact minutes for the same reason. Those two
  // constraints together mean the column cannot always add up to the total,
  // five 25-minute days print 0.42 each and add to 2.10 under a true 2.08. A
  // clerk who pastes this in and sums the column will hit that, so the file says
  // so, and points at the h:mm column, which is exact, as the one to reconcile
  // against. Stated unconditionally rather than only when a discrepancy exists,
  // so the shape of the file never depends on a floating-point comparison and a
  // reader never has to wonder whether the absence of the line means anything.
  const rounding = [];
  if (rows.length) {
    rounding.push(
      'Day hours are shown to 2 decimals, so adding that column can differ ' +
      'slightly from the totals, which come from exact minutes. The h:mm ' +
      'column is exact.'
    );
  }
  if (show.pay) rounding.push('Pay is rounded to the cent.');
  if (rounding.length) lines.push(rounding.join(' '));

  lines.push('Estimate only, not an official payroll record.');
  lines.push(`Generated by the Tools Berry hours calculator on ${model.today}`);
  lines.push(PAGE_URL);

  return lines.join('\n');
}
