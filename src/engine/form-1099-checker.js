// form-1099-checker.js — pure, framework-free lookup/comparison logic for the
// 1099-K / 1099-NEC / 1099-MISC threshold checker. Runs client-side (browser
// ESM) and in Node (build-time tests). All hard PARAMETERS (thresholds,
// inequalities, year gating, state overrides) live in
// form-1099-thresholds.json; this file is pure logic.
//
// STANDALONE by design (per the sourced spec): this is a reporting-TRIGGER
// lookup, not a deduction or a marginal-rate computation, so it has NO
// dependency on paycheck-engine.js, tax-data-2026.json, or
// obbba-deductions-2026.json. It is not part of the OBBBA deductions cluster.
//
// THE THREE RULES (IRS Notice 2025-62, pp.2-6):
//   1. Form 1099-K, THIRD-PARTY NETWORK transactions (PayPal, Venmo, Cash App
//      for Business, marketplace payouts) — issued by the TPSO ONLY if gross
//      payments STRICTLY EXCEED $20,000 AND the transaction count STRICTLY
//      EXCEEDS 200. Both conditions, both strict `>`. Applies to 2025 AND
//      2026 (statutorily retroactive to 2022 — OBBBA §70432 erased the ARPA
//      phase-in that would otherwise have reached $600 by 2026).
//   2. Form 1099-K, PAYMENT CARD transactions (credit/debit/gift card via a
//      processor — Stripe, Square, Toast) — issued by the processor with NO
//      de minimis at all: any amount, any count. This is the correction the
//      spec flags as the tool's real differentiator: card processors are NOT
//      on the $20k/200 rule.
//   3. Form 1099-NEC (services) / 1099-MISC (rent/other), a business paying
//      you DIRECTLY (check/ACH/cash) — issued by the payer if the payment is
//      $2,000 OR MORE (`>=`, "or more" statutory phrasing) for tax year 2026+,
//      or $600 or more for tax year 2025 (OBBBA §70433 raised the floor only
//      for payments made after Dec 31, 2025). Paying via card or a TPSO
//      instead shifts the filing duty to the processor (1099-K) — a payee
//      never gets both forms for the same dollars.
//
// THE MYTH-BUST (the reason this tool exists, per the spec): a 1099 is a
// REPORTING trigger, not a TAX trigger. Crossing or not crossing any of the
// above thresholds changes only whether a form is mailed and copied to the
// IRS — never whether the underlying income was taxable. No form does not
// mean no tax owed.

/**
 * Check the third-party NETWORK branch (PayPal/Venmo/marketplace G&S payments).
 * Both conditions must be STRICTLY exceeded — "and", not "or".
 * @param {object} a
 * @param {number} a.amount        gross goods-and-services payments this platform, this year
 * @param {number} a.transactions  transaction count this platform, this year
 * @param {object} a.data          parsed form-1099-thresholds.json
 */
export function checkNetworkForm({ amount, transactions, data }) {
  const net = data.form1099K.network;
  const amt = Math.max(0, amount || 0);
  const txns = Math.max(0, transactions || 0);
  const dollarsExceeded = amt > net.grossThreshold;
  const txnsExceeded = txns > net.txnThreshold;
  const willIssue = dollarsExceeded && txnsExceeded;
  return {
    form: willIssue ? '1099-K' : null,
    issuer: net.issuer,
    willIssue,
    dollarsExceeded,
    txnsExceeded,
    headroom: {
      dollarsToGo: Math.max(0, (net.grossThreshold + 1) - amt),
      txnsToGo: Math.max(0, (net.txnThreshold + 1) - txns)
    }
  };
}

/**
 * Check the PAYMENT CARD branch (Stripe/Square/Toast/merchant card acquiring).
 * No de minimis — any amount over $0 triggers a 1099-K from the processor.
 * @param {object} a
 * @param {number} a.amount  gross card payments this processor, this year
 * @param {object} a.data    parsed form-1099-thresholds.json
 */
export function checkCardForm({ amount, data }) {
  const card = data.form1099K.card;
  const amt = Math.max(0, amount || 0);
  const willIssue = amt > 0;
  return { form: willIssue ? '1099-K' : null, issuer: card.issuer, willIssue };
}

/**
 * Resolve the direct-payment (1099-NEC/1099-MISC) dollar floor for a tax year.
 * Returns a plain number for years with a published figure (2025: $600, 2026:
 * $2,000), or an { approx, indexed, baseYear, note } object for years whose
 * inflation-adjusted figure the IRS has not yet published (2027+) — callers
 * must not treat that as an exact number. Years before the earliest known key
 * fall back to the earliest known figure; years after the latest known key
 * fall back to the latest known figure (never fabricates a new number).
 * @param {number} taxYear
 * @param {object} data  parsed form-1099-thresholds.json
 */
export function necMiscThreshold(taxYear, data) {
  const byYear = data.form1099NEC_MISC.byYear;
  const key = String(taxYear);
  if (key in byYear) return byYear[key];
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const past = years.filter((y) => y <= taxYear);
  const nearestYear = past.length ? Math.max(...past) : years[0];
  return byYear[String(nearestYear)];
}

/**
 * Check the DIRECT business-payment branch (check/ACH/cash/bank transfer).
 * Inequality is "$X or more" (`>=`) — unlike the 1099-K's strict `>`.
 *
 * `paymentPurpose` disambiguates the form name (1099-NEC for services vs.
 * 1099-MISC for rent/other) — both use the IDENTICAL threshold and
 * inequality (§6041A is pegged to §6041(a)), so this only changes which form
 * name is shown, never a number. Defaults to 'services' (1099-NEC), the more
 * common gig/contractor case.
 * @param {object} a
 * @param {number} a.amount           gross direct payments this payer, this year
 * @param {number} a.taxYear
 * @param {string} [a.paymentPurpose] 'services' (default, -> 1099-NEC) | 'rent_other' (-> 1099-MISC)
 * @param {object} a.data             parsed form-1099-thresholds.json
 */
export function checkDirectPaymentForm({ amount, taxYear, paymentPurpose = 'services', data }) {
  const amt = Math.max(0, amount || 0);
  const thresholdEntry = necMiscThreshold(taxYear, data);
  const indexed = thresholdEntry != null && typeof thresholdEntry === 'object';
  const floor = indexed ? thresholdEntry.approx : thresholdEntry;
  const willIssue = amt >= floor;
  const formName = paymentPurpose === 'rent_other' ? '1099-MISC' : '1099-NEC';
  return {
    form: willIssue ? formName : null,
    issuer: 'the paying business',
    floor,
    indexed,
    willIssue,
    headroom: { dollarsToGo: Math.max(0, floor - amt) }
  };
}

/**
 * State 1099-K overlay note (network/card branches only — states do not layer
 * their own 1099-NEC/MISC thresholds in this dataset). Returns null when the
 * state isn't tracked; otherwise always returns the comparison so the caller
 * can decide whether to surface it (only when `triggered`).
 * @param {object} a
 * @param {number} a.amount
 * @param {number} [a.transactions]
 * @param {string} [a.state]  two-letter USPS code
 * @param {object} a.data     parsed form-1099-thresholds.json
 */
export function stateOverlayNote({ amount, transactions, state, data }) {
  const overrides = data.stateOverrides1099K;
  if (!state || !(state in overrides)) return null;
  const entry = overrides[state];
  const amt = Math.max(0, amount || 0);
  const isObj = entry != null && typeof entry === 'object';
  const stateAmount = isObj ? entry.amount : entry;
  const stateTxns = isObj && entry.txns != null ? entry.txns : null;
  let triggered = amt >= stateAmount;
  if (stateTxns != null) {
    const txns = Math.max(0, transactions || 0);
    triggered = triggered && txns >= stateTxns; // AND logic (e.g. Illinois)
  }
  return {
    state,
    threshold: stateAmount,
    txnThreshold: stateTxns,
    condition: isObj && entry.condition ? entry.condition : null,
    triggered
  };
}

// Always-appended myth-bust line (Correction 5, the central load-bearing point
// of the whole tool): a 1099 is paperwork, not a tax event.
const MYTH_BUST =
  'A 1099 is paperwork, not a new tax. Whether or not you get one, taxable income is still taxable and must be reported. No form does not mean no tax.';

/**
 * Full end-to-end check: resolves which form (if any) a payee should expect,
 * from the payment method + amount + count + year, plus headroom-to-threshold
 * and an optional state 1099-K overlay note. This disambiguation — WHICH form,
 * from payerType + payment method + year — is the tool's real product value,
 * not the arithmetic (which is simple threshold comparison).
 *
 * @param {object} a
 * @param {number} a.taxYear
 * @param {'network'|'card'|'direct'} a.payerType
 * @param {number} a.amount
 * @param {number} [a.transactions]     only meaningful for payerType 'network'
 * @param {'business'|'personal'} [a.paymentNature]  only meaningful for payerType 'network'
 * @param {string} [a.paymentPurpose]   only meaningful for payerType 'direct' ('services' | 'rent_other')
 * @param {string} [a.state]
 * @param {object} a.data               parsed form-1099-thresholds.json
 */
export function check1099({
  taxYear, payerType, amount, transactions, paymentNature = 'business',
  paymentPurpose = 'services', state, data
}) {
  let result;

  if (payerType === 'network') {
    if (paymentNature === 'personal') {
      result = {
        form: null,
        issuer: null,
        willIssue: false,
        reason: 'personal_transfer',
        note: "Personal transfers aren't income. If the platform tags them goods & services you could get a 1099-K by mistake — fix the tag with the platform or reconcile it on your return."
      };
    } else {
      const net = checkNetworkForm({ amount, transactions, data });
      result = { ...net, reason: net.willIssue ? 'network_both_exceeded' : 'network_under_threshold' };
    }
  } else if (payerType === 'card') {
    const card = checkCardForm({ amount, data });
    result = {
      ...card,
      reason: card.willIssue ? 'card_any_amount' : 'card_zero_amount',
      note: 'Card processors report every dollar — there is no minimum.'
    };
  } else if (payerType === 'direct') {
    const direct = checkDirectPaymentForm({ amount, taxYear, paymentPurpose, data });
    result = { ...direct, reason: direct.willIssue ? 'direct_at_or_over_floor' : 'direct_under_floor' };
  } else {
    throw new Error(`Unknown payerType: ${payerType}`);
  }

  // State 1099-K overlay only makes sense on the two 1099-K branches, and only
  // when the payment is actually business income (a personal transfer has no
  // reporting trigger to layer a state note onto).
  let stateOverlay = null;
  if ((payerType === 'network' || payerType === 'card') && paymentNature !== 'personal') {
    const overlay = stateOverlayNote({ amount, transactions, state, data });
    if (overlay && overlay.triggered) stateOverlay = overlay;
  }

  return { ...result, taxYear, payerType, amount, transactions, state, stateOverlay, mythBust: MYTH_BUST };
}
