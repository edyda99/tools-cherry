// test-wage.js — unit tests for the pure wage (salary <-> hourly) module.
// Run via `npm test`.
import assert from 'node:assert/strict';
import {
  salaryToHourly,
  hourlyToSalary,
  breakdown,
  weeksWorked
} from '../src/engine/wage.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

const approx = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

t('salaryToHourly: $52,000/yr at 40h x 52w is $25.00/hr', () =>
  approx(salaryToHourly(52000, 40, 52), 25));
t('salaryToHourly: $41,600/yr at 40h x 52w is $20.00/hr', () =>
  approx(salaryToHourly(41600, 40, 52), 20));
t('salaryToHourly: accepts string input', () =>
  approx(salaryToHourly('52000', '40', '52'), 25));
t('salaryToHourly: fewer weeks worked raises the hourly rate', () =>
  approx(salaryToHourly(50000, 40, 50), 25));

t('hourlyToSalary: $20/hr x 40 x 52 is $41,600/yr', () =>
  approx(hourlyToSalary(20, 40, 52), 41600));
t('hourlyToSalary: $25/hr x 40 x 52 is $52,000/yr', () =>
  approx(hourlyToSalary(25, 40, 52), 52000));
t('hourlyToSalary: round-trips with salaryToHourly', () =>
  approx(hourlyToSalary(salaryToHourly(60000, 37.5, 48), 37.5, 48), 60000));

t('breakdown: $52,000/yr at 40h x 52w', () => {
  const b = breakdown(52000, 40, 52);
  approx(b.hourly, 25);
  approx(b.weekly, 1000);
  approx(b.biweekly, 2000);
  approx(b.monthly, 52000 / 12);
  approx(b.daily, 200); // 1000 weekly / 5 workdays
  approx(b.annual, 52000);
});
t('breakdown: respects a custom days-per-week', () => {
  const b = breakdown(52000, 48, 52, 6);
  approx(b.weekly, 1000);
  approx(b.daily, 1000 / 6);
});

t('weeksWorked: 2 unpaid weeks leaves 50', () => approx(weeksWorked(2), 50));
t('weeksWorked: 0 unpaid weeks leaves 52', () => approx(weeksWorked(0), 52));
t('weeksWorked: blank/invalid treated as 0 -> 52', () =>
  approx(weeksWorked(''), 52));
t('weeksWorked: subtracting all 52 weeks is NaN', () =>
  assert.ok(Number.isNaN(weeksWorked(52))));

t('bad input yields NaN, not a wrong number', () => {
  assert.ok(Number.isNaN(salaryToHourly('abc', 40, 52)));
  assert.ok(Number.isNaN(hourlyToSalary(20, 0, 52)));
  assert.ok(Number.isNaN(salaryToHourly(-100, 40, 52)));
});

console.log(`\n${pass} passing`);
