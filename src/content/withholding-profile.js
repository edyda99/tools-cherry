// withholding-profile.js, the ONE answer to "what does this state take out of a
// paycheck besides federal income tax and FICA".
//
// WHY THIS FILE EXISTS
// That claim used to be generated in seven independent places (state meta
// descriptions, the lede, the answer-lead sentence, the no-income-tax
// disclaimer, the body opener, the bonus lede and FAQ, and the four-question
// block in state-applies.js), each with its own conditional and its own
// phrasing. Fixing the ones that happened to be in build.js left the others
// asserting the opposite on the SAME page: Alaska's page said its unemployment
// premium was already subtracted from the take-home figure at the top and, two
// sections later, told the reader to go hunting for it on their pay stub, while
// the bonus line said a bonus "meets federal withholding and nothing else".
//
// HARD RULES FOR CALLERS
// 1. No copy slot may decide what leaves a paycheck by branching on
//    state.hasIncomeTax alone, on a supplemental method alone, or on a state
//    name. Call withholdingProfile(state) and branch on the profile.
// 2. `federalOnly` is the ONLY licence to write "only federal tax and FICA",
//    "nothing else", or any other exclusivity claim about deductions.
// 3. `appliesToBonus` is true only when the DATA says a program is charged on
//    supplemental pay (an explicit `appliesToSupplemental: true` on the program
//    record, carrying the same source as the rest of that record). Silence in
//    the data is `bonusEvidence: 'unknown'`, never "no": copy on an unknown
//    states what is certain about the income-tax side and stops, rather than
//    claiming the program does, or does not, come out of a bonus.

// Plain-language category for a program label. Order of declaration is display
// order, so a state's programs read in the same sequence everywhere they are
// named, on the state page, on the bonus page and in the study table.
const PROGRAM_KIND_RULES = [
  [/\bSDI\b|\bTDI\b|\bDBL\b|disabilit/i, 'disability insurance'],
  [/PFML|\bPFL\b|\bFLI\b|FAMLI|\bTCI\b|paid leave|paid family/i, 'paid family leave'],
  [/\bcares\b|long[- ]term care/i, 'long-term care'],
  [/\bUI\b|\bUC\b|\bSUI\b|unemploy/i, 'unemployment insurance'],
  [/WF\/SWF|workforce/i, 'workforce development'],
];

const programKindIndex = (k) => {
  const i = PROGRAM_KIND_RULES.findIndex(([, name]) => name === k);
  return i < 0 ? PROGRAM_KIND_RULES.length : i;
};

// Every rule is tested against every label, not just the first that matches,
// because one label can cover two things (RI TDI/TCI). An unrecognised label
// falls back to a true-but-vague phrase rather than being dropped or mislabelled.
export function programKindsOf(progs) {
  const out = [];
  for (const p of progs || []) {
    const label = String(p.label || '');
    const hits = PROGRAM_KIND_RULES.filter(([re]) => re.test(label)).map(([, name]) => name);
    for (const name of (hits.length ? hits : ['state payroll programs'])) {
      if (!out.includes(name)) out.push(name);
    }
  }
  return out.sort((a, b) => programKindIndex(a) - programKindIndex(b));
}

export function listAndWords(arr) {
  return arr.length <= 1
    ? (arr[0] || '')
    : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

/**
 * What a state withholds from an employee, from that state's own data.
 *
 * @param {object} state tax-data-2026.json entry (hasIncomeTax, tax, employeePrograms)
 * @returns {{
 *   hasIncomeTax: boolean,     // levies a tax on wage income
 *   programs: object[],        // the raw employeePrograms records
 *   programLabels: string[],   // their short labels, e.g. "AK SUI (employee)"
 *   programKinds: string[],    // plain-language categories, in display order
 *   programPhrase: string,     // those categories as one phrase, '' when none
 *   federalOnly: boolean,      // no income tax AND no employee-paid programs
 *   appliesToBonus: boolean,   // the data confirms a program is charged on supplemental pay
 *   bonusPrograms: object[],   // the confirmed ones
 *   bonusPhrase: string,       // their categories as one phrase, '' when none
 *   bonusEvidence: 'none'|'confirmed'|'excluded'|'unknown'
 * }}
 */
export function withholdingProfile(state) {
  const tax = (state && state.tax) || null;
  const hasIncomeTax = !!(state && state.hasIncomeTax && tax && tax.type !== 'none');
  const programs = (state && Array.isArray(state.employeePrograms)) ? state.employeePrograms : [];
  const programKinds = programKindsOf(programs);

  // Tri-state on purpose. `undefined` means the sourced record does not address
  // supplemental pay, which is not the same as saying the premium is not charged
  // on it, and the difference decides whether any copy may speak at all.
  const confirmed = programs.filter((p) => p.appliesToSupplemental === true);
  const silent = programs.filter((p) => typeof p.appliesToSupplemental !== 'boolean');
  const bonusEvidence = !programs.length ? 'none'
    : confirmed.length ? 'confirmed'
      : silent.length ? 'unknown' : 'excluded';

  return {
    hasIncomeTax,
    programs,
    programLabels: programs.map((p) => String(p.label || '')).filter(Boolean),
    programKinds,
    programPhrase: programKinds.length ? listAndWords(programKinds) : '',
    federalOnly: !hasIncomeTax && programs.length === 0,
    appliesToBonus: bonusEvidence === 'confirmed',
    bonusPrograms: confirmed,
    bonusPhrase: confirmed.length ? listAndWords(programKindsOf(confirmed)) : '',
    bonusEvidence,
  };
}
