// paycheck-engine.js — pure, framework-free paycheck math.
// Runs client-side (browser ESM) and in Node (build-time tests).
// All tax PARAMETERS live in tax-data-2026.json; this file is pure logic.

export const PAY_PERIODS = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  annual: 1
};

/**
 * Apply a progressive bracket table to an amount.
 * @param {number} taxable - annual taxable income (USD)
 * @param {Array<{rate:number, upTo:number|null}>} brackets - ascending, last upTo=null
 * @returns {number} annual tax
 */
export function applyBrackets(taxable, brackets) {
  if (taxable <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const band of brackets) {
    const upper = band.upTo == null ? Infinity : band.upTo;
    if (taxable > lower) {
      const slice = Math.min(taxable, upper) - lower;
      tax += slice * band.rate;
    }
    lower = upper;
    if (taxable <= upper) break;
  }
  return tax;
}

/**
 * Convert a wage input into annual gross.
 * @param {{type:'salary'|'hourly', amount:number, hoursPerWeek?:number}} wage
 */
export function annualizeGross(wage) {
  if (wage.type === 'hourly') {
    const hours = wage.hoursPerWeek > 0 ? wage.hoursPerWeek : 40;
    return Math.max(0, wage.amount) * hours * 52;
  }
  return Math.max(0, wage.amount); // salary already annual
}

/**
 * Federal income tax withholding estimate (annual).
 * @param {number} preTax - pre-tax amounts that reduce federal taxable income
 *                          (401(k)/403(b) + Section 125 cafeteria: HSA/FSA/premiums).
 */
export function federalIncomeTax(grossAnnual, filingStatus, fed, preTax = 0) {
  const stdDed = fed.standardDeduction[filingStatus] ?? fed.standardDeduction.single;
  const brackets = fed.brackets[filingStatus] ?? fed.brackets.single;
  const taxable = Math.max(0, grossAnnual - preTax - stdDed);
  return applyBrackets(taxable, brackets);
}

/**
 * Per-bracket breakdown of the federal income tax, for an educational panel:
 * how much income falls in each band, the tax from each, and the marginal rate
 * (the rate on the next dollar). Pure — reuses the brackets the engine already holds.
 * @returns {{taxable:number, stdDed:number, marginalRate:number, bands:Array<{rate,lower,upper,amount,tax}>}}
 */
export function federalBracketBreakdown(grossAnnual, filingStatus, fed, preTax = 0) {
  const stdDed = fed.standardDeduction[filingStatus] ?? fed.standardDeduction.single;
  const brackets = fed.brackets[filingStatus] ?? fed.brackets.single;
  const taxable = Math.max(0, grossAnnual - preTax - stdDed);
  const bands = [];
  let lower = 0;
  let marginalRate = brackets.length ? brackets[0].rate : 0;
  for (const b of brackets) {
    const upper = b.upTo == null ? Infinity : b.upTo;
    const amount = Math.max(0, Math.min(taxable, upper) - lower);
    if (taxable > lower) marginalRate = b.rate; // deepest band the income actually reaches
    bands.push({ rate: b.rate, lower, upper, amount, tax: amount * b.rate });
    if (taxable <= upper) break;
    lower = upper;
  }
  return { taxable, stdDed, marginalRate, bands };
}

/**
 * FICA: Social Security + Medicare + Additional Medicare (annual).
 * @param {number} preTaxFica - pre-tax amounts that ALSO reduce FICA wages
 *                              (Section 125 cafeteria only — 401(k) is still FICA-taxed).
 */
export function ficaTax(grossAnnual, filingStatus, fed, preTaxFica = 0) {
  const ficaWages = Math.max(0, grossAnnual - preTaxFica);
  const ss = Math.min(ficaWages, fed.fica.socialSecurity.wageBase) * fed.fica.socialSecurity.rate;
  const medicare = ficaWages * fed.fica.medicare.rate;
  const addlThreshold =
    fed.fica.additionalMedicare.threshold[filingStatus] ??
    fed.fica.additionalMedicare.threshold.single;
  const addlMedicare =
    Math.max(0, ficaWages - addlThreshold) * fed.fica.additionalMedicare.rate;
  return { socialSecurity: ss, medicare, additionalMedicare: addlMedicare, total: ss + medicare + addlMedicare };
}

/**
 * State income tax (annual). Data-driven so adding a state = adding JSON.
 * Supported tax.type: "none" | "flat" | "bracket".
 * @param {number} preTax - pre-tax amounts that reduce state taxable income
 *                          (most states conform to 401(k) + cafeteria pre-tax treatment).
 */
/**
 * Optional income-tested reduction of a state's standard deduction. Opt-in: a state
 * without `tax.standardDeductionPhaseout` is untouched.
 *
 * Two users: South Carolina and (since 2026-08-02) Wisconsin.
 *
 * WISCONSIN. Wis. Stat. 71.05(22)(dp), printed as the "2026 Standard Deduction" schedules in
 * WI DOR Form 1-ES instructions (D-101A, R. 1-26): the deduction starts at a maximum and slides
 * to zero — single $13,960 less 12% of income over $20,120 (gone at $136,453), married jointly
 * $25,840 less 19.778% over $29,040 (gone at $159,690). Wisconsin sets no
 * `roundReductionDownTo`, so `step` below falls back to 1 and the reduction floors to whole
 * dollars. Do NOT give Wisconsin South Carolina's $10 step: that is a South Carolina statute,
 * and applying it here would move every Wisconsin answer. Head of household points at the single
 * row on purpose — Wisconsin's HoH schedule bends twice ($18,030 less 22.515% to $58,827, then it
 * joins the single line) and this function draws one straight line, so it models the second,
 * longer segment and Wisconsin's disclaimer tells the reader it is approximate below $58,827.
 *
 * SOUTH CAROLINA. Act 110 of 2026 replaced the federal standard
 * deduction with the SC Income Adjusted Deduction (SCIAD) and phases it down to zero,
 * S.C. Code 12-6-1140(15)(b)-(c). Two details in that text are easy to get backwards
 * and both change the answer:
 *
 * 1. THE ROUNDING IS ON THE REDUCTION, NOT THE DEDUCTION, and it floors.
 *    "Any reduction amount which is not a multiplier of ten dollars must be rounded to
 *    the next lowest ten dollars." Flooring the reduction makes the reduction smaller,
 *    so the deduction LARGER and the tax LOWER. Flooring the resulting deduction
 *    instead moves it the other way: at single AGI 40,100 the statute gives a
 *    reduction of 20 and a deduction of 14,980, whereas rounding the deduction gives
 *    14,970, a $10 error in the wrong direction.
 * 2. THE INPUT IS FEDERAL AGI, not South Carolina taxable income. Each of
 *    (b)(i)-(iii) says "the taxpayer's federal adjusted gross income". Feeding
 *    post-deduction income in would be circular and would understate the phase-down
 *    for every filer above the threshold.
 *    What we actually pass is `grossAnnual - preTax`, which is this engine's WAGES-ONLY
 *    PROXY for federal AGI, not federal AGI itself: the engine models no non-wage income
 *    and no above-the-line adjustments. So this APPROXIMATES the 12-6-1140(15)(b) test
 *    rather than implementing it, and the state's disclaimer says so. It is the same
 *    quantity federalIncomeTax() uses before its own standard deduction, so the state and
 *    federal sides are at least consistent with each other.
 *
 * (b)(iv) makes the two clamps explicit: a fraction of zero means no reduction, and a
 * fraction "equal to or exceeds one" means the deduction "is not allowed", so the
 * phase-out completes exactly at over + denominator (95,000 / 142,500 / 190,000).
 *
 * EXPORTED for build.js: the salary-ladder pages print the state's taxable income and
 * the amount subtracted to reach it. Those must be the engine's own figures, so the
 * generator calls this rather than keeping a second copy of the statute's arithmetic.
 */
export function phaseOutStandardDeduction(base, agi, filingStatus, cfg) {
  const row = cfg[filingStatus] ?? cfg.single;
  if (!row || !row.denominator) return base;
  const excess = Math.max(0, agi - row.over);
  if (excess >= row.denominator) return 0;
  const step = cfg.roundReductionDownTo || 1;
  // Divide ONCE, at the end. Computing the fraction first and then multiplying
  // rounds twice, and the second rounding lands just under a $10 boundary often
  // enough to matter: at head-of-household AGI 62,970 the exact reduction is 810,
  // but 22500 * (2970/82500) evaluates to 809.9999999999999 in IEEE-754, so the
  // floor drops a whole $10 step and hands the filer $10 too much deduction.
  // 45 head-of-household AGIs between 62,970 and 118,080 hit that edge; single
  // and married never do. Multiplying first keeps the numerator an exact integer
  // (well under 2^53 for every SCIAD base and denominator), so the single divide
  // is the only place rounding can happen and it rounds the way the statute says.
  const reduction = Math.floor((base * excess) / (row.denominator * step)) * step;
  return Math.max(0, base - reduction);
}

/**
 * Optional deduction for the FICA the employee actually paid, capped in dollars.
 * Opt-in: a state without `tax.ficaPaidDeduction` is untouched.
 *
 * One user: MASSACHUSETTS. M.G.L. c.62 s.3(B)(a)(3) lets a filer deduct from Part B
 * adjusted gross income "Taxes paid to the United States under the provisions of the
 * Federal Insurance Contributions Act or the Federal Railroad Retirement Act", and then
 * caps it: "In no event shall the aggregate of the otherwise allowable deductions of this
 * subparagraph and of all sums deducted from wages as contributions to an annuity, pension,
 * endowment or retirement fund of the United States government, the commonwealth or any
 * political subdivision thereof, attributable to any one taxpayer exceed two thousand
 * dollars." MA DOR prints the same rule as Form 1 Line 11: "you may deduct those
 * contributions, up to a maximum of $2,000 ... Enter in lines 11a and 11b the amount you,
 * and your spouse if filing jointly, paid to Social Security (FICA), Medicare or Railroad
 * Retirement ... but not more than $2,000 each. Payment amounts may not be combined or
 * transferred from one spouse to the other."
 *
 * Three things that matter for how this is wired:
 *
 * 1. IT IS THE FICA THE EMPLOYEE PAID, NOT A FIXED $2,000. Below about $26,144 of wages
 *    the 7.65% employee share is under the cap, so the deduction is the smaller FICA
 *    figure. Hard-coding $2,000 would over-deduct for every part-time worker. The engine
 *    passes the employee-side FICA it already computed for these exact wages, so the two
 *    lines of the paycheck can never disagree.
 * 2. THE CAP IS PER TAXPAYER, AND THIS ENGINE MODELS ONE EARNER. On a joint return the
 *    statute gives each spouse their own up-to-$2,000 and forbids pooling, so a two-earner
 *    couple can deduct up to $4,000 between them. We model one wage, so we return one
 *    person's deduction, and Massachusetts' disclaimer tells joint filers that the second
 *    earner's own deduction is not in the number.
 * 3. MEDICARE COUNTS. DOR: "Be sure to add any amount of Medicare tax withheld as shown on
 *    Form W-2". So the input is the whole employee FICA line, not the Social Security part.
 *    Above the cap this is moot, and the cap binds at every income where Medicare is large.
 *
 * EXPORTED for the same reason as phaseOutStandardDeduction above: a page that prints
 * Massachusetts taxable income has to name every subtraction that produced it, and this
 * is one of them.
 *
 * @param {number} ficaPaid - employee-side FICA for these wages (annual USD)
 * @param {{cap:number}} cfg
 */
export function ficaPaidDeduction(ficaPaid, cfg) {
  if (!cfg || !(cfg.cap > 0)) return 0;
  return Math.min(cfg.cap, Math.max(0, ficaPaid));
}

/**
 * Optional stepped add-back / recapture: a flat dollar amount charged ON TOP of the
 * bracket tax, climbing one rung at a time as income crosses fixed thresholds and then
 * stopping at a ceiling. Opt-in and data-driven: a state without `tax.steppedRecapture`
 * is untouched, and the field is an ARRAY so a state with several such ladders (Connecticut
 * has two, and other states could add one) does not need a second mechanism.
 *
 * Ladder shape, per filing status: {over, step, amountPerStep, max}
 *   over          income above which the ladder starts; at or below it the charge is 0
 *   step          the rung width in dollars
 *   amountPerStep dollars added per rung
 *   max           ceiling in dollars, after which more income adds nothing
 *
 * One user: CONNECTICUT's 2% tax-rate phase-out add-back, Conn. Gen. Stat. 12-700(a)(10),
 * printed as Table C, "2% Tax Rate Phase-Out Add-Back", in DRS IP 2026(7).
 *
 * WHY IT CANNOT BE A BRACKET. The statute does not add a rate band. For an unmarried filer,
 * 12-700(a)(10)(A)(ii) says that once Connecticut AGI passes $56,500 "the amount of the
 * taxpayer's Connecticut taxable income to which the two-per-cent tax rate applies shall be
 * reduced by one thousand dollars for each five thousand dollars, or fraction thereof",
 * and that the displaced income "shall be an amount to which the four-and-one-half-per-cent
 * tax rate shall apply". Moving $1,000 from 2% to 4.5% costs exactly $25, so the effect is a
 * $25 step every $5,000. applyBrackets sums slice times rate and is continuous by
 * construction, so it can never produce a step. Same reason Ohio's baseAmount exists.
 *
 * TRAP 1, "OR FRACTION THEREOF" MEANS ROUND UP, NOT DOWN. A single filer $1 over $56,500
 * already owes the first full $25. So the rung count is a ceiling, not a floor, and the
 * threshold test is strictly greater than: at exactly $56,500 the charge is $0.
 *
 * TRAP 2, THE CEILING IS THE SIZE OF THE 2% BAND, NOT A NUMBER IN THE STATUTE. The band can
 * only be emptied once. For a single filer it is $10,000 wide, so after ten rungs ($10,000
 * of income moved) the charge stops at $250; head of household empties $16,000 in ten rungs
 * of $1,600 for $400; married filing jointly empties $20,000 in ten rungs of $2,000 for
 * $500. Table C prints those same ceilings as its "and up" rows, which is the cross-check.
 *
 * TRAP 3, THE WITHHOLDING CODES ARE NOT IN FILING-STATUS ORDER. Table C has four columns and
 * it is easy to grab the wrong one. Table A settles it by personal exemption: Code F carries
 * $15,000, which 12-702 gives an unmarried individual, so CODE F IS SINGLE. Code A carries
 * $12,000, the married-filing-separately amount. Code B is head of household ($19,000) and
 * Code C is married filing jointly ($24,000). Reading Code A as "single" would start the
 * ladder at $50,250 on $2,500 rungs and overcharge a $75,000 single filer by $150.
 *
 * WHAT WE PASS AS THE INCOME TEST. The statute keys on CONNECTICUT ADJUSTED GROSS INCOME.
 * We pass `grossAnnual - preTax`, the same wages-only proxy for AGI that the South Carolina
 * phase-down above uses and that federalIncomeTax() uses before its own standard deduction.
 * It is a proxy, not the real figure: this engine models no non-wage income and no
 * above-the-line adjustments, so a filer with interest, dividends or a side business is
 * further up the ladder than we can see. Connecticut's disclaimer says so.
 *
 * KNOWN SIMPLIFICATION. We do not clip the add-back to the 2% income actually present. The
 * statute can only move income that is there, so a filer with a huge AGI but almost no
 * taxable income could in principle owe less than the ladder says. Connecticut cannot reach
 * that state through this engine, because it has no standard deduction here and so its
 * taxable income equals the AGI the ladder is reading. The `taxable > 0` guard below is what
 * keeps that honest for any future state that does have a deduction.
 *
 * EXPORTED so the salary-ladder generator can print the same charge in its own band table.
 * The ladder asserts that its decomposition reproduces stateIncomeTax() to the cent, and a
 * second, drifting copy of this arithmetic in build.js is exactly what that assertion exists
 * to prevent.
 *
 * @param {number} agi - the state's AGI proxy (grossAnnual - preTax)
 */
export function steppedRecapture(agi, filingStatus, ladder) {
  const row = ladder && (ladder[filingStatus] ?? ladder.single);
  if (!row || !(row.step > 0)) return 0;
  const excess = agi - row.over;
  if (excess <= 0) return 0;
  // Ceiling, per "or fraction thereof". Every threshold and rung in the statute is a whole
  // number of dollars, and a whole-dollar income divides exactly in IEEE-754, so a filer
  // sitting exactly on a rung gets that rung and not the next one. Only fractional incomes
  // (an hourly rate that annualises to cents) can land off a rung, and those are never
  // exactly on one, so there is no boundary for rounding error to fall off.
  const rungs = Math.ceil(excess / row.step);
  const amount = rungs * row.amountPerStep;
  return row.max != null ? Math.min(amount, row.max) : amount;
}

/**
 * @param {number} ficaPaid - employee-side FICA already computed for these wages. Only
 *   states carrying `tax.ficaPaidDeduction` (Massachusetts) read it; every other state
 *   ignores it entirely.
 *
 *   IT DOES NOT CANCEL OUT OF A MARGINAL DIFFERENCE, so a caller asking "how much more tax
 *   does this extra income cost" must pass a figure to BOTH of its terms. The deduction is
 *   min(FICA paid, $2,000): it only stops moving once the cap binds, which takes about
 *   $26,144 of wages at the 7.65% employee rate. Below that the two ends of the difference
 *   carry different deductions and the FICA term does not vanish. An earlier version of this
 *   note claimed it cancelled and used that to justify leaving the argument at 0 in
 *   bonus-tax.js; on Massachusetts wages of $20,000 with a $10,000 bonus that overstated the
 *   state tax on the bonus by $23.50 ($500.00 against the correct $476.50).
 *
 *   WHO PASSES WHAT. computePaycheck() passes `fica.total` for the same wages it just
 *   computed, so the FICA line and the state line of one paycheck always agree.
 *   bonus-tax.js's trueTaxOnBonus() passes two figures, the employee FICA on the modelled
 *   earner's own wages before the bonus and after it, one to each term. Both callers use
 *   ONE person's wages: the statutory cap is per taxpayer and may not be pooled between
 *   spouses, so a joint filer's household figure must never be the input here.
 *
 *   It still defaults to 0, which is the right default for a state that has no such
 *   deduction and the honest "not known" for any caller that has no FICA figure to give.
 */
export function stateIncomeTax(grossAnnual, filingStatus, stateData, preTax = 0, ficaPaid = 0) {
  if (!stateData || !stateData.hasIncomeTax || !stateData.tax) return 0;
  const t = stateData.tax;
  if (t.type === 'none') return 0;

  let stdDed = (t.standardDeduction && (t.standardDeduction[filingStatus] ?? t.standardDeduction.single)) || 0;
  // grossAnnual - preTax is this engine's federal AGI: federalIncomeTax() above derives
  // federal TAXABLE income as exactly that minus the federal standard deduction, so the
  // quantity before the deduction is AGI. That is the input SCIAD's phase-down needs,
  // and the input Connecticut's 2% ladder needs.
  const agi = Math.max(0, grossAnnual - preTax);
  if (t.standardDeductionPhaseout) {
    stdDed = phaseOutStandardDeduction(stdDed, agi, filingStatus, t.standardDeductionPhaseout);
  }
  let taxable = Math.max(0, grossAnnual - preTax - stdDed);
  if (t.ficaPaidDeduction) {
    taxable = Math.max(0, taxable - ficaPaidDeduction(ficaPaid, t.ficaPaidDeduction));
  }

  let tax;
  if (t.type === 'flat') {
    tax = taxable * t.rate;
  } else if (t.type === 'bracket') {
    const brackets = t.brackets[filingStatus] ?? t.brackets.single;
    tax = applyBrackets(taxable, brackets);
    // Opt-in flat amount added once taxable income passes a threshold. Ohio is
    // the only user: ORC 5747.02(A)(3)(c) reads "$332.00 plus 2.75% of the
    // amount in excess of $26,050". applyBrackets is continuous by
    // construction, it sums slice times rate, so it can never produce that
    // step. The comparison is strictly greater than: at exactly the threshold
    // the statute charges nothing, and using >= would bill $332 to a filer
    // Ohio exempts.
    if (t.baseAmount && taxable > t.baseAmount.over) tax += t.baseAmount.amount;
  } else {
    return 0;
  }

  // Stepped add-backs sit on top of the bracket tax and are keyed on AGI, not on taxable
  // income, so they run last and read `agi`. A filer with no taxable income owes none of it.
  if (taxable > 0 && Array.isArray(t.steppedRecapture)) {
    for (const ladder of t.steppedRecapture) tax += steppedRecapture(agi, filingStatus, ladder);
  }
  return tax;
}

/**
 * State employee-side disability / paid-leave contributions (SDI / TDI / PFML /
 * FLI / FAMLI). These are POST-TAX payroll deductions withheld on GROSS wages:
 * they do NOT reduce federal or state taxable income and are independent of
 * income-tax withholding. Purely data-driven — a state opts in by carrying an
 * `employeePrograms` array in tax-data-2026.json.
 *
 * Program shape: {label, rate, wageBase?, annualMax?, weeklyMax?}
 *   rate       decimal employee rate (e.g. 0.013 = 1.3%)
 *   wageBase   annual taxable-wage ceiling in USD; rate stops applying above it
 *   annualMax  hard annual contribution cap in USD (e.g. NY PFL $411.91)
 *   weeklyMax  per-WEEK contribution cap in USD (e.g. HI TDI $7.50, NY DBL $0.60)
 *
 * Cap math, honest across pay frequencies: the annual contribution is
 * rate × min(gross, wageBase), then clamped to an annual dollar ceiling.
 * A weekly dollar cap is converted to its annual equivalent (weeklyMax × 52).
 * Because this calculator assumes even wages across the year (it annualises a
 * single wage input), capping each week at weeklyMax is EXACTLY weeklyMax × 52
 * annually, which then divides cleanly into any pay frequency — no rounding
 * approximation is introduced.
 * @param {number} grossAnnual
 * @param {object} stateData - the single-state entry from tax-data
 * @returns {Array<{label:string, rate:number, annual:number}>}
 */
export function stateEmployeePrograms(grossAnnual, stateData) {
  const list = stateData && Array.isArray(stateData.employeePrograms) ? stateData.employeePrograms : [];
  const g = Math.max(0, grossAnnual);
  return list.map((pr) => {
    const base = pr.wageBase != null ? Math.min(g, pr.wageBase) : g;
    let annual = base * (pr.rate || 0);
    const annualCap = pr.annualMax != null
      ? pr.annualMax
      : (pr.weeklyMax != null ? pr.weeklyMax * 52 : null);
    if (annualCap != null) annual = Math.min(annual, annualCap);
    return { label: pr.label, rate: pr.rate || 0, annual };
  });
}

/**
 * Optional advanced inputs (W-4 + deductions). All annual USD, all default 0
 * so omitting `adv` reproduces the simple-mode result exactly.
 * @typedef {object} AdvancedInputs
 * @property {number} retirement401k  Traditional 401(k)/403(b): cuts income tax, NOT FICA.
 * @property {number} cafeteria125    HSA/FSA + health premiums (Section 125): cuts income tax AND FICA.
 * @property {number} dependentsCredit W-4 step 3 tax credits ($2,000/child etc.): cuts federal tax.
 * @property {number} extraWithholding W-4 step 4(c): flat extra federal withholding.
 * @property {number} postTax         After-tax deductions (Roth, garnishments…): cut net only.
 */
const ZERO_ADV = { retirement401k: 0, cafeteria125: 0, dependentsCredit: 0, extraWithholding: 0, postTax: 0 };

/**
 * Full paycheck computation.
 * @param {object} input
 * @param {{type:'salary'|'hourly', amount:number, hoursPerWeek?:number}} input.wage
 * @param {string} input.filingStatus - one of tax-data filingStatuses ids
 * @param {keyof PAY_PERIODS} input.payFrequency
 * @param {string} input.stateSlug
 * @param {AdvancedInputs} [input.adv] - optional advanced-mode inputs (default all 0)
 * @param {object} taxData - parsed tax-data-2026.json
 * @returns {object} annual + per-period breakdown
 */
export function computePaycheck({ wage, filingStatus, payFrequency, stateSlug, adv }, taxData) {
  const fed = taxData.federal;
  const grossAnnual = annualizeGross(wage);
  const stateData = taxData.states ? taxData.states[stateSlug] : null;

  const a = { ...ZERO_ADV, ...(adv || {}) };
  // clamp negatives; pre-tax can't exceed gross
  const retirement401k = Math.min(Math.max(0, a.retirement401k), grossAnnual);
  const cafeteria125 = Math.min(Math.max(0, a.cafeteria125), grossAnnual);
  const dependentsCredit = Math.max(0, a.dependentsCredit);
  const extraWithholding = Math.max(0, a.extraWithholding);
  const postTax = Math.max(0, a.postTax);

  const preTaxIncome = retirement401k + cafeteria125;   // reduces income-tax base (fed + state)
  const preTaxFica = cafeteria125;                       // only cafeteria reduces FICA wages

  // federal: bracket tax on adjusted income, then credits, then extra withholding
  const fedBracket = federalIncomeTax(grossAnnual, filingStatus, fed, preTaxIncome);
  const federal = Math.max(0, fedBracket - dependentsCredit) + extraWithholding;

  const fica = ficaTax(grossAnnual, filingStatus, fed, preTaxFica);
  // fica.total is handed to the state side because Massachusetts lets a filer deduct the
  // FICA they paid (capped at $2,000). Passing the figure the engine just computed keeps
  // the two lines of the same paycheck consistent; every other state ignores it.
  const state = stateIncomeTax(grossAnnual, filingStatus, stateData, preTaxIncome, fica.total);

  // State disability / paid-leave employee contributions: post-tax, on gross
  // wages, kept OUT of totalTax and out of annual.state (so tax-only rates and
  // the pinned state-tax regression tests are unaffected).
  const programs = stateEmployeePrograms(grossAnnual, stateData);
  const statePrograms = programs.reduce((s, p) => s + p.annual, 0);

  const totalTax = federal + fica.total + state;
  const preTaxDeductions = preTaxIncome;                 // 401k + cafeteria leave the paycheck too
  const netAnnual = Math.max(0, grossAnnual - totalTax - preTaxDeductions - postTax - statePrograms);

  const periods = PAY_PERIODS[payFrequency] ?? 1;
  const perPeriod = (v) => v / periods;

  const annual = {
    gross: grossAnnual,
    federal,
    socialSecurity: fica.socialSecurity,
    medicare: fica.medicare + fica.additionalMedicare,
    state,
    statePrograms,
    programs: programs.map((p) => ({ label: p.label, rate: p.rate, amount: p.annual })),
    preTax: preTaxDeductions,
    postTax,
    totalTax,
    net: netAnnual,
    effectiveRate: grossAnnual > 0 ? totalTax / grossAnnual : 0,
    takeHomeRate: grossAnnual > 0 ? netAnnual / grossAnnual : 0
  };

  const perPaycheck = {
    gross: perPeriod(annual.gross),
    federal: perPeriod(annual.federal),
    socialSecurity: perPeriod(annual.socialSecurity),
    medicare: perPeriod(annual.medicare),
    state: perPeriod(annual.state),
    statePrograms: perPeriod(statePrograms),
    programs: programs.map((p) => ({ label: p.label, rate: p.rate, amount: perPeriod(p.annual) })),
    preTax: perPeriod(annual.preTax),
    postTax: perPeriod(annual.postTax),
    totalTax: perPeriod(annual.totalTax),
    net: perPeriod(annual.net)
  };

  return { annual, perPaycheck, periods, payFrequency, filingStatus, stateSlug };
}
