// state-applies.js — builds the "which rules apply to me" section that sits
// directly under the calculator on each /{state}-paycheck-calculator/ page.
//
// WHY THIS FILE EXISTS
// A state page already knows the answer to the hardest question a rule-finder can
// ask (which state), so this emits FOUR questions, the four the state page carries
// real per-state data for, answered inline from that page's own data.
//
// NO DEEP LINK. This block used to end with "See every 2026 rule that matches your
// answers in <State>", pointing at /what-applies-to-me/?state=<slug>. That page is
// not wired into build.js and is absent from dist, so the link was 51 internal
// links to a 404 on the site's highest-value cluster. It comes back the day the
// destination is built and shipped, not before. src/assets/state-flow.js already
// guards on `if (deep)`, so it is unaffected by the anchor's absence.
//
// HARD RULES ENFORCED HERE
// 1. Every pointer line is rendered visible in the HTML at build time. The client
//    controller only HIDES lines once a box is ticked, so with JavaScript off,
//    broken, or simply untouched, a crawler and a screen reader see all four.
// 2. Nothing is invented. Tips and overtime verdicts come from the OBBBA
//    conformity data, the bonus line from the state supplemental data, and the
//    turning-65 line from the state's own income-tax structure.
// 3. Exactly FOUR anchors per page, on every state, so the site-wide anchor count
//    moves by a known constant rather than by something that varies per state.
// 4. No em dashes in copy written here, and no more than seven consecutive
//    state-invariant words before a data-keyed token (near-duplicate budget).

const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const pct = (r) => (r * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

// Bracket counts read as words in every other heading on these pages, so they
// read as words here too.
const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numWord = (n) => NUM_WORD[n] || String(n);

// The four questions, with the SAME ids and values the full flow uses
// (/what-applies-to-me/ template, the h-tips / h-ot / h-bonus / h-age boxes) and
// the same plain-language labels, so the deep link's has= values line up and the
// two pages never describe the same question in two different ways.
const CHIPS = [
  { id: 'h-tips', value: 'tips', label: 'Customers tip me' },
  { id: 'h-ot', value: 'ot', label: 'I get paid extra for working extra hours' },
  { id: 'h-bonus', value: 'bonus', label: 'I get a bonus or commission' },
  { id: 'h-age', value: 'age', label: 'I turn 65 at any point this year, or my husband or wife does' }
];

// Tips / overtime: one sentence keyed to this state's researched 2026 verdict.
// The nine no-wage-tax states all get verdict 'n/a', so their sentences are keyed
// to that state's own revenue model instead, otherwise those nine pages would
// share one long identical run (they are already the closest raw pairs on the site).
function conformityLine(name, verdict, what, angle) {
  if (verdict === 'n/a') {
    return angle
      ? `federally deductible, and ${name} runs on ${angle} rather than a wage tax, so nothing more is claimed at state level`
      : `federally deductible, and ${name} has no wage tax to tax ${what} anyway`;
  }
  if (verdict === 'yes') return `federally deductible, and deductible on your ${name} return too`;
  if (verdict === 'no') return `federally deductible, but ${name} still taxes ${what} in full`;
  if (verdict === 'partial') return `federally deductible, with a smaller capped ${name} break on top`;
  if (verdict === 'unclear') return `federally deductible; ${name} has not confirmed its own treatment yet`;
  return `federally deductible; ${name} treatment varies`;
}

// Bonuses: keyed to how this state actually withholds supplemental wages.
function bonusLine(name, supp, slug, pickFrame) {
  const m = supp && supp.method;
  if (!m || m === 'none') {
    return pickFrame(slug, 'appliesbonus', [
      `there is no ${name} supplemental rate to apply, so only federal withholding touches the extra pay`,
      `${name} publishes no supplemental rate, which leaves federal withholding as the only bite out of a bonus`,
      `a bonus meets federal withholding and nothing else, because ${name} has no supplemental rate`
    ]);
  }
  if (m === 'flat' && typeof supp.rate === 'number') {
    return `${name} withholds a flat ${pct(supp.rate)} on supplemental pay, separately from your regular wages`;
  }
  if (m === 'special' && supp.special === 'ca_dual') {
    return `${name} withholds ${pct(supp.rate)} on bonuses and ${pct(supp.rateOther)} on other supplemental pay`;
  }
  if (m === 'special' && supp.special === 'pct_of_federal') {
    return `${name} withholds ${pct(supp.rate)} of your federal supplemental withholding on the extra pay`;
  }
  if (m === 'special') {
    return `${name} runs its own graduated supplemental scale rather than one flat rate`;
  }
  // 'regular' is the largest group (20 states), so it is frame-varied too.
  return pickFrame(slug, 'appliesbonusreg', [
    `${name} has no separate supplemental rate, so a bonus is withheld on the ordinary ${name} tables`,
    `a bonus is withheld on the ordinary ${name} tables, because ${name} sets no separate supplemental rate`,
    `${name} sets no supplemental rate of its own, so a bonus goes through the normal ${name} withholding tables`
  ]);
}

// Turning 65: the federal deduction is the same everywhere, so this line is keyed
// to what the state does to the same wages.
function seniorLine(state, pickFrame) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t) {
    return pickFrame(state.slug, 'appliessenior', [
      `the $6,000 federal senior deduction is the whole story here, because ${state.name} does not tax wages`,
      `only the $6,000 federal senior deduction is in play, since there is no ${state.name} wage tax to reduce`,
      `the $6,000 federal senior deduction is all there is to claim, as ${state.name} taxes no wages to begin with`
    ]);
  }
  if (t.type === 'flat') {
    return `the $6,000 federal senior deduction comes off your federal return; ${state.name} still applies its flat ${pct(t.rate)} to the same wages`;
  }
  const b = (t.brackets && t.brackets.single) || [];
  return b.length
    ? `the $6,000 federal senior deduction comes off your federal return; ${state.name}'s ${numWord(b.length)} brackets still apply to the same wages`
    : `the $6,000 federal senior deduction comes off your federal return; ${state.name} still taxes the same wages`;
}

/**
 * @param {object}   o
 * @param {object}   o.state       tax-data entry (name, slug, hasIncomeTax, tax)
 * @param {object}   o.obbbaEntry  obbba-deductions-2026.json .states[slug]
 * @param {object}   o.suppEntry   state-supplemental-2026.json .states[slug]
 * @param {string}   o.notaxAngle  build.js's NOTAX_ANGLE phrase, no-wage-tax states only
 * @param {Function} o.pickFrame   build.js's slug-stable frame picker
 * @returns {string} one <section> of HTML, or '' when the data is missing
 */
export function buildStateApplies({ state, obbbaEntry, suppEntry, notaxAngle, pickFrame }) {
  if (!state) return '';
  const name = esc(state.name);
  const otV = obbbaEntry && obbbaEntry.overtime && obbbaEntry.overtime.y2026;
  const tipV = obbbaEntry && obbbaEntry.tips && obbbaEntry.tips.y2026;

  const h2 = pickFrame(state.slug, 'appliesh2', [
    `Which 2026 rules apply to your ${name} paycheck?`,
    `Tips, overtime, bonuses, turning 65: what ${name} workers should check`,
    `Your pay in ${name}: which 2026 breaks are yours to claim?`
  ]);
  const intro = pickFrame(state.slug, 'appliesintro', [
    `Tick what is true for you and these ${name} notes narrow to your situation.`,
    `Choose anything that matches how you are paid in ${name} and the list trims itself.`,
    `Tick the boxes that describe your pay. The ${name} pointers then show only those.`
  ]);

  const chips = CHIPS.map((c) =>
    `<label class="applies-opt"><input type="checkbox" id="${c.id}" value="${c.value}"> <span>${c.label}</span></label>`
  ).join('\n        ');

  // The revenue-model phrase is used on the tips line only: repeating it on the
  // overtime line would put the same words back on all nine no-tax pages.
  const angle = esc(notaxAngle || '');
  const lines = [
    `<p class="applies-line" data-line="tips"><strong>Tips:</strong> ${conformityLine(name, tipV, 'tips', angle)}. ` +
      `<a href="/tips-tax-calculator/">Work out the tip deduction</a></p>`,
    `<p class="applies-line" data-line="ot"><strong>Overtime:</strong> ${conformityLine(name, otV, 'overtime premium pay', '')}. ` +
      `<a href="/overtime-tax-calculator/">Work out the overtime deduction</a></p>`,
    `<p class="applies-line" data-line="bonus"><strong>Bonuses:</strong> ${bonusLine(name, suppEntry, state.slug, pickFrame)}. ` +
      `<a href="/${state.slug}-bonus-tax-calculator/">Estimate the tax on a bonus in ${name}</a></p>`,
    `<p class="applies-line" data-line="age"><strong>Turning 65:</strong> ${seniorLine(state, pickFrame)}. ` +
      `<a href="/senior-deduction-calculator/">Check the senior deduction</a></p>`
  ].join('\n        ');

  return `<section class="prose applies" id="applies" aria-labelledby="appliesH">
      <h2 id="appliesH">${h2}</h2>
      <p>${intro}</p>
      <fieldset class="applies-chips">
        <legend>Tick anything that is true for you.</legend>
        ${chips}
      </fieldset>
      <div class="applies-lines" id="appliesLines">
        ${lines}
      </div>
    </section>`;
}
