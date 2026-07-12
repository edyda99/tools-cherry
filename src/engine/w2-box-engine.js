// w2-box-decoder.js — pure, framework-free logic for the 2026 W-2 Box 12
// TA/TP/TT decoder + the Treasury Tipped Occupation Code (TTOC) lookup. Runs
// client-side (browser ESM) and in Node (build-time tests). All occupation
// DATA lives in ttoc-occupations.json; this file is pure logic.
//
// Sources (docs/w2-decoder-spec.md, all fetched from primary sources):
//   S1: 2026 General Instructions for Forms W-2 and W-3 (IRS) — the verbatim
//       TA/TP/TT definitions, the Box 1 inclusion rules, the Box 14a/14b split.
//   S2: Federal Register Doc. 2026-07104 (TD 10044), 91 FR 19026, PUBLISHED
//       April 13, 2026, EFFECTIVE June 12, 2026 (per the document's own DATES
//       line — the publication date is NOT the effective date), applicable to
//       taxable years beginning after December 31, 2024.
//   S3: 26 CFR 1.224-1, Table 1 to paragraph (h) (eCFR codified text — the
//       source of record for the 71-occupation table itself).
//
// THE ONE ASYMMETRY THAT MATTERS (spec §2.4 — the most commonly mis-stated
// fact this decoder exists to get right):
//   - Code TA (Trump account employer contributions) is EXCLUDED from Box 1.
//     The instructions say "excluded from the gross income of the employee",
//     twice.
//   - Codes TP (reported cash tips) and TT (qualified overtime premium) are
//     NOT excluded — Box 1 already includes those amounts in full, withheld
//     and taxed as ordinary wages ("still generally subject to federal income
//     tax withholding"). They are FLAGS identifying the slice of Box 1 the
//     worker can deduct later on Schedule 1-A — never a subtraction from it.
//   A decoder that tells someone "your wages are lower because of TP/TT"
//   would be wrong. This engine must never subtract TP or TT from anything.

// --- Box 12: the three new-for-2026 codes -----------------------------------

export const BOX12_INFO = {
  TA: {
    code: 'TA',
    name: 'Trump account employer contributions',
    plain: 'Money your employer put into a "Trump account" (a new tax-advantaged account for a child under 18) for you or your dependent.',
    excludedFromBox1: true,
    box1Note: 'Excluded from Box 1 — this amount was never taxed as wages. Your Box 1 wages are already lower by this amount.',
    purpose: 'Beginning July 4, 2026, employers may contribute up to $2,500 a year (toward the $5,000 total contribution limit) to the Trump account of an employee or of a dependent of an employee, and the amount is excluded from the employee’s gross income. Informational — confirm the account exists; no deduction to claim.',
    ficaNote: null,
    schedule1A: false
  },
  TP: {
    code: 'TP',
    name: 'Total cash tips reported to the employer',
    plain: 'The total cash tips you reported to your employer this year.',
    excludedFromBox1: false,
    box1Note: 'Fully included in Box 1 — your wages were withheld and taxed on this amount as usual. TP does not lower your Box 1; it flags how much of your Box 1 you may deduct later.',
    purpose: 'Flags the dollar amount eligible for the "no tax on tips" deduction (up to $25,000, IRC §224), claimed separately on Schedule 1-A when you file. If TP is present, your employer must also list an occupation code in Box 14b.',
    ficaNote: 'Social Security and Medicare (FICA) still apply to every tip dollar — the deduction is federal income tax only.',
    schedule1A: true,
    requiresBox14b: true
  },
  TT: {
    code: 'TT',
    name: 'Total qualified overtime compensation',
    plain: 'Your overtime premium for the year — only the extra "half" of time-and-a-half, not your whole overtime paycheck.',
    excludedFromBox1: false,
    box1Note: 'Fully included in Box 1 — your wages were withheld and taxed on this amount as usual. TT does not lower your Box 1; it flags how much of your Box 1 you may deduct later.',
    purpose: 'Flags the dollar amount eligible for the "no tax on overtime" deduction (IRC §225), claimed separately on Schedule 1-A when you file. Only the FLSA premium portion is reported — e.g. only the "half" of time-and-a-half.',
    ficaNote: 'Social Security and Medicare (FICA) still apply to every overtime dollar — the deduction is federal income tax only.',
    schedule1A: true
  }
};

const NEW_CODES = ['TA', 'TP', 'TT'];

/**
 * Decode a set of Box 12 {code, amount} entries. Only the three new 2026
 * codes (TA/TP/TT) are decoded in depth; anything else is returned as
 * known:false with a graceful pointer (this tool never invents definitions
 * for the legacy A-HH codes).
 * @param {Array<{code: string, amount?: number}>} entries
 */
export function decodeBox12(entries) {
  return (entries || []).map((e) => {
    const code = String(e.code || '').trim().toUpperCase();
    const amount = Math.max(0, Number(e.amount) || 0);
    const info = BOX12_INFO[code];
    if (!info) {
      return {
        code, amount, known: false,
        note: 'Not one of the new 2026 codes (TA, TP, TT). This decoder covers the three codes added for tax year 2026; see the IRS General Instructions for Forms W-2 and W-3 for the full legacy code list.'
      };
    }
    return { ...info, amount, known: true };
  });
}

/**
 * Look up a single 3-digit TTOC code in the occupation table.
 * Returns { code, title, description, examples, soc, category,
 * addedInFinalRule } or null when not present ("000" is NOT in the table —
 * it is the nonqualifying flag handled by decodeBox14b).
 * @param {string} code
 * @param {object} data parsed ttoc-occupations.json
 */
export function lookupTtoc(code, data) {
  const c = String(code || '').trim();
  for (const cat of data.categories) {
    for (const occ of cat.occupations) {
      if (occ.code === c) return { ...occ, category: cat.name };
    }
  }
  return null;
}

/** Flat list of all occupations with their category attached. */
export function flattenOccupations(data) {
  const out = [];
  for (const cat of data.categories) {
    for (const occ of cat.occupations) out.push({ ...occ, category: cat.name });
  }
  return out;
}

/**
 * Decode Box 14b (Treasury Tipped Occupation Codes).
 *
 * Per the 2026 W-2 instructions (S1, verbatim-load-bearing): Box 14b is used
 * "if cash tips are reported in box 12 with code TP" — so its ABSENCE when
 * there is no TP is correct, not an error (fixture F3). Up to TWO codes; a
 * worker with 3+ tipped occupations sees only two of them (no stated
 * tie-break — the instructions say "any two", so we never imply a selection
 * rule). "000" means some tips came from a NONQUALIFYING occupation — a
 * partial-ineligibility flag, not an error and not a lookup miss.
 *
 * @param {string[]} codes    the code(s) printed in Box 14b (0-2 expected)
 * @param {object}   opts     { hasTP: boolean, data: parsed ttoc-occupations.json }
 */
export function decodeBox14b(codes, { hasTP, data }) {
  const list = (codes || []).map((c) => String(c || '').trim()).filter(Boolean);
  const result = {
    applicable: !!hasTP,
    // F3: no TP -> an empty Box 14b is the CORRECT state, not missing data.
    absenceIsCorrect: !hasTP && list.length === 0,
    entries: [],
    notes: []
  };

  if (!hasTP) {
    if (list.length === 0) {
      result.notes.push('Box 14b is empty and that is correct: it is only filled in when cash tips are reported in Box 12 with code TP, and this W-2 has no TP.');
    } else {
      result.notes.push('Box 14b has a code but Box 12 has no code TP — the instructions only call for Box 14b when TP is present. Check the W-2 with your employer.');
    }
  } else if (list.length === 0) {
    result.notes.push('Box 12 has code TP but Box 14b is empty. The instructions require an occupation code when TP is present — ask your employer which code applies (or look your job up below).');
  }

  for (const code of list) {
    if (code === '000') {
      result.entries.push({
        code: '000',
        status: 'nonqualifying',
        explanation: 'Code 000 means at least some of your reported tips came from a job that is NOT on the Treasury’s qualifying-occupation list — so not all of your Box 12 TP amount is eligible for the tips deduction. It is a partial-ineligibility flag, not an error.'
      });
      continue;
    }
    const occ = lookupTtoc(code, data);
    if (occ) {
      result.entries.push({ code, status: 'match', occupation: occ });
    } else {
      result.entries.push({
        code,
        status: 'unknown',
        explanation: `Code ${code} is not in the Treasury’s occupation table. Check your W-2 for a typo, or ask your employer — this is different from code 000 (nonqualifying occupation).`
      });
    }
  }

  if (list.length >= 2) {
    result.notes.push('Box 14b holds at most two codes. If you earned tips in three or more occupations, only two of them appear here — the list is not necessarily exhaustive.');
  }

  return result;
}

/**
 * Full W-2 decode: Box 12 entries + Box 14b codes in one pass (fixtures
 * F1-F4). Never subtracts TP/TT from anything; only TA is reported as
 * excluded from Box 1.
 * @param {object} a
 * @param {Array<{code: string, amount?: number}>} a.box12
 * @param {string[]} [a.box14b]
 * @param {object} a.data parsed ttoc-occupations.json
 */
export function decodeW2({ box12, box14b, data }) {
  const codes = decodeBox12(box12);
  const byCode = {};
  for (const c of codes) if (c.known) byCode[c.code] = c;

  const flags = { hasTA: 'TA' in byCode, hasTP: 'TP' in byCode, hasTT: 'TT' in byCode };
  const totals = {
    taExcluded: flags.hasTA ? byCode.TA.amount : 0,
    tpTips: flags.hasTP ? byCode.TP.amount : 0,
    ttOvertime: flags.hasTT ? byCode.TT.amount : 0
  };

  return {
    box12: codes,
    flags,
    totals,
    box14b: decodeBox14b(box14b, { hasTP: flags.hasTP, data }),
    // The load-bearing asymmetry, machine-checkable (fixture F1):
    asymmetry: {
      excludedFromBox1: codes.filter((c) => c.known && c.excludedFromBox1).map((c) => c.code),
      includedInBox1: codes.filter((c) => c.known && !c.excludedFromBox1).map((c) => c.code)
    }
  };
}

// --- Occupation search (the TTOC lookup half) --------------------------------

// Brand names people actually type, mapped to the regulation's own vocabulary
// (spec §6.3: everyday job titles live in the `examples` field — "uber
// driver" must resolve via "platform/app-based rideshare driver").
const QUERY_ALIASES = {
  uber: 'rideshare',
  lyft: 'rideshare',
  doordash: 'delivery',
  ubereats: 'delivery',
  grubhub: 'delivery',
  instacart: 'delivery',
  postmates: 'delivery'
};

const tokenize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/[\s/-]+/)
    .filter((t) => t.length > 1);

// Light stem: fold plurals so "bartender" matches "Bartenders".
const stem = (t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

const tokensMatch = (a, b) => {
  const sa = stem(a), sb = stem(b);
  if (sa === sb) return true;
  // Prefix match for clipped queries ("tech" -> "technicians"), min 3 chars.
  if (sa.length >= 3 && sb.startsWith(sa)) return true;
  return false;
};

/**
 * Check the query against the sourced rejected-occupations list (occupations
 * the final rule's preamble explicitly considered and did NOT include —
 * fixtures F10/F11). Matches when every query token is in the entry's token
 * set, so "retail cashier" hits the cashier entry but "casino cashier" falls
 * through to the real fuzzy search (and finds code 203).
 */
function matchRejected(queryTokens, data) {
  for (const rej of data.rejectedOccupations || []) {
    const rejTokens = rej.tokens.map(stem);
    const allIn = queryTokens.every((qt) => rejTokens.some((rt) => tokensMatch(qt, rt)));
    if (allIn && queryTokens.length) return rej;
  }
  return null;
}

/**
 * Free-text occupation search over the TTOC table. Scores title (3),
 * examples (2), category (1), and description (1) per matched query token
 * (a token counts once, at its best field). Returns:
 *   { matches: [{code, title, category, ..., score}], notFound: null }
 * or, when nothing (or only a rejected occupation) matches:
 *   { matches: [], notFound: { reason, explanation, didYouMean: [occ...] } }
 * Never a silent empty state (spec §6.3).
 * @param {string} query
 * @param {object} data parsed ttoc-occupations.json
 * @param {number} [limit]
 */
export function searchOccupations(query, data, limit = 8) {
  const rawTokens = tokenize(query).map((t) => QUERY_ALIASES[t] || t);
  if (!rawTokens.length) return { matches: [], notFound: null };

  // Sourced rejected-occupation gate FIRST (F10/F11) — these must return the
  // documented "considered and excluded" answer, not a fuzzy near-miss.
  const rejected = matchRejected(rawTokens, data);
  if (rejected) {
    return {
      matches: [],
      notFound: {
        reason: 'rejected',
        label: rejected.label,
        explanation: rejected.explanation,
        didYouMean: (rejected.didYouMean || []).map((c) => lookupTtoc(c, data)).filter(Boolean)
      }
    };
  }

  const scored = [];
  for (const occ of flattenOccupations(data)) {
    const fields = [
      { tokens: tokenize(occ.title), weight: 3 },
      { tokens: tokenize(occ.examples), weight: 2 },
      { tokens: tokenize(occ.category), weight: 1 },
      { tokens: tokenize(occ.description), weight: 1 }
    ];
    let score = 0;
    let strong = false;
    let matched = 0;
    for (const qt of rawTokens) {
      let best = 0;
      for (const f of fields) {
        if (f.weight <= best) continue;
        if (f.tokens.some((ft) => tokensMatch(qt, ft))) {
          best = f.weight;
          if (f.weight >= 2) strong = true;
        }
      }
      if (best > 0) matched++;
      score += best;
    }
    // Require at least one strong (title/examples) hit AND at least half the
    // query's tokens matching somewhere — keeps single-shared-word noise out.
    if (strong && matched >= Math.ceil(rawTokens.length / 2)) {
      scored.push({ ...occ, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  const matches = scored.slice(0, limit);

  if (!matches.length) {
    return {
      matches: [],
      notFound: {
        reason: 'not_listed',
        explanation: 'This job is not on the Treasury’s list of 71 qualifying occupations, so tips from it do not qualify for the federal tips deduction. Nothing else changes — tips from a non-listed job are taxed exactly as before.',
        didYouMean: []
      }
    };
  }
  return { matches, notFound: null };
}
