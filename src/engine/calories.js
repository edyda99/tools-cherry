// calories.js — pure, dependency-free daily calorie (TDEE) calculations.
// Shared by the browser tool (calorie-calculator.js) and the unit tests.
//
// Uses the Mifflin–St Jeor equation for Basal Metabolic Rate (BMR), the most
// widely recommended estimate, then multiplies by an activity factor to get
// Total Daily Energy Expenditure (TDEE) — the calories needed to maintain
// weight. Goal targets adjust TDEE by a daily calorie deficit/surplus.
//
// Functions return a number, or NaN when an input is not a valid positive value
// (the UI is responsible for hiding NaN — keep these honest about bad input).

const pos = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

// Standard activity multipliers applied to BMR to get TDEE.
export const ACTIVITY = {
  sedentary: 1.2, // little or no exercise
  light: 1.375, // light exercise 1–3 days/week
  moderate: 1.55, // moderate exercise 3–5 days/week
  active: 1.725, // hard exercise 6–7 days/week
  veryActive: 1.9 // very hard exercise / physical job
};

// Mifflin–St Jeor BMR in kcal/day.
//   weightKg: body weight in kilograms
//   heightCm: height in centimetres
//   age:      age in years
//   sex:      'male' | 'female'
// Male:   10*kg + 6.25*cm − 5*age + 5
// Female: 10*kg + 6.25*cm − 5*age − 161
export function bmr({ weightKg, heightCm, age, sex } = {}) {
  const w = pos(weightKg), h = pos(heightCm), a = pos(age);
  if (Number.isNaN(w) || Number.isNaN(h) || Number.isNaN(a)) return NaN;
  const base = 10 * w + 6.25 * h - 5 * a;
  return sex === 'female' ? base - 161 : base + 5;
}

// Total Daily Energy Expenditure = BMR × activity multiplier.
// activity is a key of ACTIVITY (defaults to 'sedentary' if unknown).
export function tdee({ weightKg, heightCm, age, sex, activity } = {}) {
  const b = bmr({ weightKg, heightCm, age, sex });
  if (Number.isNaN(b)) return NaN;
  const mult = ACTIVITY[activity] || ACTIVITY.sedentary;
  return b * mult;
}

// A set of common daily calorie targets derived from a maintenance TDEE.
// Each goal is a fixed daily kcal offset (≈ 7,700 kcal per kg of body fat, so
// 500 kcal/day ≈ 0.45 kg / ~1 lb per week). Floors are not enforced here —
// the UI surfaces a safety note instead. Returns NaN fields for bad input.
//
//   goals(2000) -> { maintain:2000, mildLoss:1750, loss:1500, extremeLoss:1000,
//                    mildGain:2250, gain:2500 }
export function goals(maintainKcal) {
  const m = pos(maintainKcal);
  if (Number.isNaN(m)) {
    return {
      maintain: NaN, mildLoss: NaN, loss: NaN, extremeLoss: NaN,
      mildGain: NaN, gain: NaN
    };
  }
  return {
    maintain: m,
    mildLoss: m - 250, // ~0.25 kg / 0.5 lb per week
    loss: m - 500, // ~0.5 kg / 1 lb per week
    extremeLoss: m - 1000, // ~1 kg / 2 lb per week
    mildGain: m + 250,
    gain: m + 500
  };
}

// Convert pounds to kilograms.
export function lbToKg(lb) {
  const n = pos(lb);
  return Number.isNaN(n) ? NaN : n * 0.45359237;
}

// Convert feet + inches to centimetres. Either part may be 0 but not both blank.
export function ftInToCm(ft, inch) {
  const f = ft === '' || ft == null ? 0 : parseFloat(ft);
  const i = inch === '' || inch == null ? 0 : parseFloat(inch);
  const totalInches = (Number.isFinite(f) ? f : 0) * 12 + (Number.isFinite(i) ? i : 0);
  return totalInches > 0 ? totalInches * 2.54 : NaN;
}
