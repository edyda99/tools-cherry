// bmi.js — pure, dependency-free Body Mass Index calculations.
// Shared by the browser tool (bmi-calculator.js) and the unit tests.
// Uses the standard adult BMI formula and CDC category cutoffs:
//   Underweight < 18.5, Normal 18.5–24.9, Overweight 25–29.9, Obese >= 30.
// Functions return a number, or NaN when an input is not a valid positive value
// (the UI is responsible for hiding NaN — keep these honest about bad input).

const pos = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

// Metric BMI: weight in kilograms, height in centimetres.
// BMI = kg / (metres^2).  e.g. bmiMetric(70, 175) ≈ 22.857
export function bmiMetric(kg, cm) {
  const w = pos(kg), h = pos(cm);
  if (Number.isNaN(w) || Number.isNaN(h)) return NaN;
  const m = h / 100;
  return w / (m * m);
}

// Imperial BMI: weight in pounds, height in total inches.
// BMI = 703 * lb / (inches^2).  e.g. bmiImperial(180, 70) ≈ 25.83
export function bmiImperial(lb, totalInches) {
  const w = pos(lb), h = pos(totalInches);
  if (Number.isNaN(w) || Number.isNaN(h)) return NaN;
  return (703 * w) / (h * h);
}

// CDC adult weight-status category for a BMI value.
// Returns one of: 'Underweight' | 'Normal' | 'Overweight' | 'Obese' | ''.
export function category(bmi) {
  const b = pos(bmi);
  if (Number.isNaN(b)) return '';
  if (b < 18.5) return 'Underweight';
  if (b < 25) return 'Normal';
  if (b < 30) return 'Overweight';
  return 'Obese';
}

// Healthy-weight range (BMI 18.5–24.9... using <25 as the upper bound) for a
// given height. Provide EITHER cm (metric) OR inches (imperial) — exactly one.
// Returns { minKg, maxKg } for metric or { minLb, maxLb } for imperial,
// or NaN bounds when the height is invalid.
//
//   healthyWeightRange({ cm: 175 })     -> { minKg: ~56.66, maxKg: ~76.27 }
//   healthyWeightRange({ inches: 70 })  -> { minLb: ~128.9, maxLb: ~173.6 }
export function healthyWeightRange({ cm, inches } = {}) {
  const LOW = 18.5;
  const HIGH = 24.9; // CDC "normal" upper bound for the range display
  if (cm != null) {
    const h = pos(cm);
    if (Number.isNaN(h)) return { minKg: NaN, maxKg: NaN };
    const m = h / 100;
    return { minKg: LOW * m * m, maxKg: HIGH * m * m };
  }
  if (inches != null) {
    const h = pos(inches);
    if (Number.isNaN(h)) return { minLb: NaN, maxLb: NaN };
    const factor = (h * h) / 703;
    return { minLb: LOW * factor, maxLb: HIGH * factor };
  }
  return {};
}
