// ideal-weight.js — pure, dependency-free ideal body-weight + macro math.
// Shared by the browser tool (ideal-weight-calculator.js) and the unit tests.
// No deps, nothing uploaded.
//
// Two independent pieces:
//
// 1) IDEAL BODY WEIGHT (IBW) — four classic clinical formulas, all expressed in
//    kilograms as a function of sex and height. Three of them (Devine, Robinson,
//    Miller) are linear in "inches over 5 feet (60 in)"; Hamwi is the imperial
//    pounds-based rule converted to kg. Heights below 5 ft fall back to the
//    formula base (the formulas were derived for adults at/above 5 ft).
//
//      Devine (1974):   male 50.0  + 2.3 kg per inch over 5 ft
//                       female 45.5 + 2.3 kg per inch over 5 ft
//      Robinson (1983): male 52.0  + 1.9 kg per inch over 5 ft
//                       female 49.0 + 1.7 kg per inch over 5 ft
//      Miller (1983):   male 56.2  + 1.41 kg per inch over 5 ft
//                       female 53.1 + 1.36 kg per inch over 5 ft
//      Hamwi (1964):    male 48.0 kg + 2.7 kg per inch over 5 ft
//                       female 45.5 kg + 2.2 kg per inch over 5 ft
//                       (classic imperial form: 106 lb + 6 lb/in (M),
//                        100 lb + 5 lb/in (F); the kg constants above are the
//                        widely cited metric equivalents)
//
// 2) MACRONUTRIENT SPLIT — given a daily calorie target, split it into protein /
//    carbohydrate / fat grams using a ratio of the day's calories, then convert
//    calories to grams with the Atwater factors: protein 4 kcal/g, carb 4 kcal/g,
//    fat 9 kcal/g. Default split is 30% protein / 40% carb / 30% fat.
//
// Functions return NaN (or NaN-filled objects) for invalid input so the UI can
// stay quiet — mirrors the bmi/calories engines.

const pos = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

const FIVE_FEET_IN = 60; // inches in 5 feet

// Atwater energy factors (kcal per gram).
export const KCAL_PER_GRAM = { protein: 4, carb: 4, fat: 9 };

// IBW formula coefficients: base kg at exactly 5 ft, plus kg added per inch over 5 ft.
const IBW = {
  devine: { male: { base: 50.0, per: 2.3 }, female: { base: 45.5, per: 2.3 } },
  robinson: { male: { base: 52.0, per: 1.9 }, female: { base: 49.0, per: 1.7 } },
  miller: { male: { base: 56.2, per: 1.41 }, female: { base: 53.1, per: 1.36 } },
  hamwi: { male: { base: 48.0, per: 2.7 }, female: { base: 45.5, per: 2.2 } }
};

// Ideal body weight in kg for one named formula.
//   formula: 'devine' | 'robinson' | 'miller' | 'hamwi'
//   sex:     'male' | 'female'  (anything not 'female' is treated as male)
//   heightCm: height in centimetres
// Returns NaN for unknown formula or invalid height.
export function idealWeightKg(formula, sex, heightCm) {
  const coeff = IBW[formula];
  if (!coeff) return NaN;
  const h = pos(heightCm);
  if (Number.isNaN(h)) return NaN;
  const c = sex === 'female' ? coeff.female : coeff.male;
  const inches = h / 2.54;
  const over = Math.max(0, inches - FIVE_FEET_IN); // formulas defined at/above 5 ft
  return c.base + c.per * over;
}

// All four formulas at once, plus a low/high/average summary across them.
//   idealWeights('male', 177.8) ->
//     { devine, robinson, miller, hamwi, low, high, average }  (all kg)
// Bad input yields a NaN-filled object.
export function idealWeights(sex, heightCm) {
  const devine = idealWeightKg('devine', sex, heightCm);
  const robinson = idealWeightKg('robinson', sex, heightCm);
  const miller = idealWeightKg('miller', sex, heightCm);
  const hamwi = idealWeightKg('hamwi', sex, heightCm);
  const all = [devine, robinson, miller, hamwi];
  const valid = all.every(Number.isFinite);
  return {
    devine,
    robinson,
    miller,
    hamwi,
    low: valid ? Math.min(...all) : NaN,
    high: valid ? Math.max(...all) : NaN,
    average: valid ? all.reduce((a, b) => a + b, 0) / all.length : NaN
  };
}

// Macro split from a daily calorie target.
//   calories: total daily kcal (e.g. a TDEE or goal target)
//   ratios:   { protein, carb, fat } fractions of calories that should sum to 1
//             (defaults to 0.30 / 0.40 / 0.30)
// Returns grams per macro plus the calories each contributes:
//   { protein:{grams,kcal}, carb:{grams,kcal}, fat:{grams,kcal}, calories }
// The kcal fields sum back to `calories`; grams = kcal / (kcal per gram).
// Bad input yields NaN-filled fields.
export function macros(calories, ratios = {}) {
  const cal = pos(calories);
  const rp = Number.isFinite(ratios.protein) ? ratios.protein : 0.3;
  const rc = Number.isFinite(ratios.carb) ? ratios.carb : 0.4;
  const rf = Number.isFinite(ratios.fat) ? ratios.fat : 0.3;
  const bad = {
    protein: { grams: NaN, kcal: NaN },
    carb: { grams: NaN, kcal: NaN },
    fat: { grams: NaN, kcal: NaN },
    calories: NaN
  };
  if (Number.isNaN(cal)) return bad;
  if (rp < 0 || rc < 0 || rf < 0) return bad;

  const pKcal = cal * rp;
  const cKcal = cal * rc;
  const fKcal = cal * rf;
  return {
    protein: { grams: pKcal / KCAL_PER_GRAM.protein, kcal: pKcal },
    carb: { grams: cKcal / KCAL_PER_GRAM.carb, kcal: cKcal },
    fat: { grams: fKcal / KCAL_PER_GRAM.fat, kcal: fKcal },
    calories: cal
  };
}

// ---------------------------------------------------------------------------
// 3) BODYWEIGHT-ANCHORED NUTRITION PLAN
//
// The flat %-of-calories macro split above is kept for back-compat, but it is
// physiologically backwards for protein: at a fixed 30% the protein target
// scales with *calories*, so it spikes on a bulk and craters on a cut — the
// opposite of what's correct (protein should be HIGHEST on a cut to spare lean
// mass). The functions below anchor protein to grams per kg of bodyweight, set
// fat with a hormonal-health floor, and let carbs take the remainder — the
// pattern every credible calculator (calculator.net, RippedBody, Legion,
// Examine) converges on.
//
// Numbers are sourced from the ISSN 2017 position stand on protein & exercise
// and the Morton 2018 hypertrophy meta-analysis:
//   - maintenance plateau ≈ 1.6 g/kg; sedentary adults need less (~1.2)
//   - fat loss raises protein (up to ~2.4 g/kg when training hard) to hold LBM
//   - muscle gain ≈ 1.6–2.0 g/kg (no added hypertrophy above the plateau)
// ---------------------------------------------------------------------------

// Hormonal-health fat floor, in grams per kg of bodyweight (≈ the 20%-of-kcal
// AMDR lower bound for most people). Fat is never set below this.
export const FAT_FLOOR_G_PER_KG = 0.8;

// Dietary fiber Adequate Intake: 14 g per 1000 kcal (DRI / Academy of Nutrition).
export const FIBER_G_PER_1000_KCAL = 14;

// Total daily water target: 35 ml per kg of bodyweight (cross-checked vs EFSA AIs).
export const WATER_ML_PER_KG = 35;

// Protein target as a [low, high] band in grams per kg of bodyweight, by
// goal × activity. The tool's five activity levels collapse onto low / moderate
// / high training status. A biological recommendation is a range, not a point —
// the single "recommended" value is just the midpoint of each band.
const PROTEIN_BAND = {
  maintain: {
    sedentary: [1.0, 1.4], light: [1.4, 1.8], moderate: [1.4, 1.8], active: [1.6, 2.0], veryActive: [1.6, 2.0]
  },
  lose: {
    sedentary: [1.4, 1.8], light: [1.8, 2.2], moderate: [1.8, 2.2], active: [2.2, 2.6], veryActive: [2.2, 2.6]
  },
  gain: {
    sedentary: [1.4, 1.8], light: [1.6, 2.0], moderate: [1.6, 2.0], active: [1.8, 2.2], veryActive: [1.8, 2.2]
  }
};

// Hard upper bound on protein — no documented benefit above ~3.1 g/kg.
export const PROTEIN_MAX_G_PER_KG = 3.1;

// Protein [low, high] g/kg band for a goal/activity pair. Unknown goal falls
// back to maintenance; unknown activity to the moderate column.
export function proteinBand(goal, activity) {
  const row = PROTEIN_BAND[goal] || PROTEIN_BAND.maintain;
  return row[activity] || row.moderate;
}

// Recommended protein grams-per-kg — the midpoint of the band.
export function proteinPerKg(goal, activity) {
  const [lo, hi] = proteinBand(goal, activity);
  return (lo + hi) / 2;
}

// Lean body mass (kg) from bodyweight and body-fat percentage (0–100).
// Returns NaN if the body-fat figure is missing or out of range.
export function leanMassKg(weightKg, bodyFatPct) {
  const w = pos(weightKg);
  const bf = typeof bodyFatPct === 'number' ? bodyFatPct : parseFloat(bodyFatPct);
  if (Number.isNaN(w) || !Number.isFinite(bf) || bf <= 0 || bf >= 100) return NaN;
  return w * (1 - bf / 100);
}

// Katch-McArdle BMR (kcal/day) from lean body mass — more accurate than
// Mifflin–St Jeor when body-fat% is known. BMR = 370 + 21.6 × LBM(kg).
export function bmrKatch(weightKg, bodyFatPct) {
  const lbm = leanMassKg(weightKg, bodyFatPct);
  return Number.isNaN(lbm) ? NaN : 370 + 21.6 * lbm;
}

const badPlan = {
  protein: { grams: NaN, gramsLow: NaN, gramsHigh: NaN, kcal: NaN, gPerKg: NaN, gPerKgLow: NaN, gPerKgHigh: NaN },
  carb: { grams: NaN, gramsLow: NaN, gramsHigh: NaN, kcal: NaN },
  fat: { grams: NaN, kcal: NaN },
  fiberGrams: NaN,
  waterMl: NaN,
  calories: NaN,
  note: null
};

// Build a full daily nutrition plan from a goal-adjusted calorie target.
//   calories: goal-adjusted daily kcal target
//   weightKg: bodyweight (used for protein g/kg, fat floor, water)
//   goal/activity: select the protein g/kg from the table
//   leanKg:  optional lean mass — when supplied, protein is set per kg of LEAN
//            mass instead of total bodyweight (better for lean/muscular users)
//   fatPct:  fraction of calories from fat (diet-style preset; default 0.30)
//   ketoCarbG: when set, carbs are pinned to this gram cap and fat fills the
//            remainder (keto preset); fatPct is ignored
// Protein is set first (g/kg), fat next (fatPct of kcal, floored at 0.8 g/kg),
// carbs take whatever calories remain. Returns grams + kcal per macro plus a
// fiber target (14 g/1000 kcal) and water target (35 ml/kg). `note` flags when
// the split had to be clamped (protein+fat exceeded the target → carbs hit 0).
export function macroPlan({
  calories,
  weightKg,
  goal = 'maintain',
  activity = 'moderate',
  leanKg,
  fatPct = 0.3,
  ketoCarbG = null
} = {}) {
  const cal = pos(calories);
  const w = pos(weightKg);
  if (Number.isNaN(cal) || Number.isNaN(w)) return badPlan;

  const basisKg = Number.isFinite(leanKg) && leanKg > 0 ? leanKg : w;
  const gPerKg = proteinPerKg(goal, activity);
  const [gPerKgLow, gPerKgHigh] = proteinBand(goal, activity);
  const proteinGrams = gPerKg * basisKg;
  const proteinLow = gPerKgLow * basisKg;
  const proteinHigh = gPerKgHigh * basisKg;
  const proteinKcal = proteinGrams * KCAL_PER_GRAM.protein;

  const fatFloorGrams = FAT_FLOOR_G_PER_KG * w;
  let fatGrams;
  let carbGrams; // at the recommended (midpoint) protein
  let carbLow; // when protein is at the top of its band
  let carbHigh; // when protein is at the bottom of its band
  let note = null;

  if (Number.isFinite(ketoCarbG) && ketoCarbG >= 0) {
    // Keto: pin carbs to the cap, fat fills the remaining calories (floored).
    carbGrams = carbLow = carbHigh = ketoCarbG;
    const remainKcal = cal - proteinKcal - ketoCarbG * KCAL_PER_GRAM.carb;
    fatGrams = Math.max(remainKcal / KCAL_PER_GRAM.fat, fatFloorGrams);
  } else {
    const pct = Number.isFinite(fatPct) && fatPct > 0 ? fatPct : 0.3;
    fatGrams = Math.max((cal * pct) / KCAL_PER_GRAM.fat, fatFloorGrams);
    const fatKcalForCarb = fatGrams * KCAL_PER_GRAM.fat;
    // Carbs are whatever's left after protein + fat. More protein -> fewer carbs,
    // so the carb band is the inverse of the protein band.
    const carbAt = (pKcal) => Math.max(0, (cal - pKcal - fatKcalForCarb) / KCAL_PER_GRAM.carb);
    carbGrams = carbAt(proteinKcal);
    carbLow = carbAt(proteinHigh * KCAL_PER_GRAM.protein);
    carbHigh = carbAt(proteinLow * KCAL_PER_GRAM.protein);
    if (carbGrams <= 0) {
      // Protein + floored fat already meet/exceed the target (very low calories
      // / very high protein). Carbs bottom out — flag it.
      note = 'protein and fat alone meet the calorie target';
    }
  }

  const fatKcal = fatGrams * KCAL_PER_GRAM.fat;
  const carbKcal = carbGrams * KCAL_PER_GRAM.carb;

  return {
    protein: {
      grams: proteinGrams,
      gramsLow: proteinLow,
      gramsHigh: proteinHigh,
      kcal: proteinKcal,
      gPerKg,
      gPerKgLow,
      gPerKgHigh
    },
    carb: { grams: carbGrams, gramsLow: carbLow, gramsHigh: carbHigh, kcal: carbKcal },
    fat: { grams: fatGrams, kcal: fatKcal },
    fiberGrams: (cal / 1000) * FIBER_G_PER_1000_KCAL,
    waterMl: w * WATER_ML_PER_KG,
    calories: cal,
    note
  };
}
