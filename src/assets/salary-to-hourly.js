// salary-to-hourly.js — convert between annual salary and hourly wage, with
// weekly / biweekly / monthly / daily equivalents. Live results, GROSS (pre-tax).
// Pure math via the shared wage module. No deps, nothing uploaded.
import {
  salaryToHourly,
  hourlyToSalary,
  breakdown,
  weeksWorked
} from '/assets/wage.js';

const $ = (id) => document.getElementById(id);

function money(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });
}

const isBlank = (id) => $(id).value.trim() === '';

// Show the right input label/placeholder for the selected mode.
function showMode(mode) {
  const salaryMode = mode === 'salaryToHourly';
  $('amountLabel').textContent = salaryMode
    ? 'Annual salary ($ per year)'
    : 'Hourly wage ($ per hour)';
  $('amount').placeholder = salaryMode ? '52000' : '25';
  calc();
}

function calc() {
  const mode = $('mode').value;
  const big = $('resultBig');
  const sub = $('resultSub');
  const rows = ['rHourly', 'rDaily', 'rWeekly', 'rBiweekly', 'rMonthly', 'rAnnual'];

  // reset
  big.textContent = '—';
  sub.textContent = '';
  rows.forEach((id) => { $(id).textContent = '—'; });

  if (isBlank('amount')) {
    sub.textContent = mode === 'salaryToHourly'
      ? 'Enter your annual salary to see the hourly rate.'
      : 'Enter your hourly wage to see the annual salary.';
    return;
  }

  const hoursPerWeek = isBlank('hours') ? 40 : parseFloat($('hours').value);
  const weeks = weeksWorked($('vacation').value);

  if (!Number.isFinite(weeks)) {
    sub.textContent = 'Unpaid vacation must be fewer than 52 weeks.';
    return;
  }
  if (!(hoursPerWeek > 0)) {
    sub.textContent = 'Enter hours per week greater than zero.';
    return;
  }

  // Always derive the annual salary first, then a single breakdown drives all rows.
  let annual;
  if (mode === 'salaryToHourly') {
    annual = parseFloat($('amount').value);
  } else {
    annual = hourlyToSalary($('amount').value, hoursPerWeek, weeks);
  }
  if (!Number.isFinite(annual) || annual <= 0) {
    sub.textContent = 'Enter an amount greater than zero.';
    return;
  }

  const b = breakdown(annual, hoursPerWeek, weeks);

  if (mode === 'salaryToHourly') {
    const hr = salaryToHourly(annual, hoursPerWeek, weeks);
    big.textContent = money(hr) + ' / hour';
    sub.textContent = `Based on ${fmt(hoursPerWeek)} hours/week over ${fmt(weeks)} weeks/year (gross, before tax).`;
  } else {
    big.textContent = money(b.annual) + ' / year';
    sub.textContent = `Based on ${fmt(hoursPerWeek)} hours/week over ${fmt(weeks)} weeks/year (gross, before tax).`;
  }

  $('rHourly').textContent = money(b.hourly);
  $('rDaily').textContent = money(b.daily);
  $('rWeekly').textContent = money(b.weekly);
  $('rBiweekly').textContent = money(b.biweekly);
  $('rMonthly').textContent = money(b.monthly);
  $('rAnnual').textContent = money(b.annual);
}

function fmt(n) {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function init() {
  $('mode').addEventListener('change', () => showMode($('mode').value));
  document.querySelectorAll('#wageForm input').forEach((el) =>
    el.addEventListener('input', calc)
  );
  showMode($('mode').value);
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
