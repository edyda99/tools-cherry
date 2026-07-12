# 1099-K / 1099-NEC Threshold Checker (2026) — Sourced Spec

**Tool slug (proposed):** `/1099-threshold-checker/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA calculators (tips / overtime / SALT / car-loan / senior / charitable / dependent-care).
**Prepared:** 2026-07-12. Fresh roadmap scout (2026-07-12) ranked this as the next build.
**Primary sources:** every load-bearing number verified against IRS primary material — **IRS Notice 2025-62** (irs.gov/pub/irs-drop/n-25-62.pdf, read verbatim pp. 2–6), the IRS 1099-K OBBBA FAQ newsroom page, the IRS "Understanding your Form 1099-K" business page, and the Treasury/IRS proposed-regs newsroom release on §3406 backup-withholding. Statutory sections (IRC §6050W, §6041, §6041A; OBBBA §70432, §70433) confirmed against the Notice's own quotations. Secondary tax-press (RSM, Anchin, Thomson Reuters, KPMG, Sovos) used only for corroboration, the ARPA phase-in history, and state thresholds.

---

## 0. Plain-language summary (read this first)

Two separate OBBBA (P.L. 119-21, July 4 2025) changes killed the "$600 will get you a 1099" panic — but they work differently and the roadmap's one-line framing is **directionally right with five real corrections**:

1. **Form 1099-K (payment apps / marketplaces):** the reporting threshold for **third-party NETWORK transactions** reverted from the ARPA-era **$600 (no transaction minimum)** back to the pre-2021 rule: a platform reports only if your gross payments **exceed $20,000 AND you have more than 200 transactions** — **both** conditions, strictly. (IRC §6050W(e), restored by OBBBA §70432.)
2. **Form 1099-NEC / 1099-MISC (a business paying you directly):** the threshold rose from **$600 to $2,000**, effective for **payments made after Dec 31, 2025 (TY2026)**, and is **inflation-indexed from 2027** (base year 2025). (IRC §6041(a)/§6041A, OBBBA §70433.)

**The five corrections to the roadmap's framing (details in §2):**

- ⚠️ **CORRECTION 1 — the 1099-K reversion is NOT "for TY2026." It applies to 2025 AND 2026, and is statutorily retroactive** ("take effect as if included in section 9674 of the American Rescue Plan Act," i.e. back to 2022). The $600 ARPA rule **never actually reached taxpayers** — IRS transition relief (Notice 2024-85) had already stair-stepped it to **$5,000 for 2024** and **$2,500 for 2025** before OBBBA erased the whole phase-in and locked in $20,000/200. So "reverted for 2026" undersells it and mis-dates it.
- ⚠️ **CORRECTION 2 — Stripe/Square card processing is NOT on the $20k/200 rule; it has NO threshold at all.** §6050W covers **two** transaction types: **payment card** and **third-party network**. The $20,000/200 de-minimis rule applies ONLY to third-party **network** transactions (TPSOs: PayPal, Venmo, Cash App for Business, marketplace payouts). **Payment card** transactions (credit/debit/gift card run through a processor — Stripe, Square, Toast, a merchant acquirer) have **no minimum**: $0.01 generates a 1099-K. The roadmap lumped "Stripe" in with "$20k." Wrong — card processing is no-threshold. The checker must split "payment app (network)" from "card processor."
- ⚠️ **CORRECTION 3 — the two thresholds use DIFFERENT inequalities, and the NEC change has a year-boundary.** 1099-K = **strictly exceeds** $20,000 **and strictly exceeds** 200 txns ( `>` , `>` ). 1099-NEC/MISC = **$2,000 or more** ( `≥` , §6041(a)'s "or more" language). And the $2,000 NEC/MISC floor only starts with **TY2026** — for **TY2025 the contractor-payment threshold was still $600**. A user asking about 2025 vs 2026 gets different NEC answers.
- ⚠️ **CORRECTION 4 — "Venmo/marketplace = 1099-K, contractor = 1099-NEC" over-simplifies WHO issues what.** If a business pays a contractor **through** a card or a TPSO, the client is **relieved of 1099-NEC filing** (§6041(a) excludes payments reportable under §6050W) and the **processor** issues the 1099-K instead. So *how you were paid* (direct check/ACH/cash vs. card vs. app) decides which issuer is on the hook — you don't get both.
- ⚠️ **CORRECTION 5 (the actual myth-bust, CONFIRMED and central) — a 1099 is a REPORTING trigger, not a TAX trigger.** Crossing or not crossing a threshold changes only whether a *form* is mailed and copied to the IRS. All the income was **always taxable**; not getting a form does not make it tax-free, and getting one does not create new tax. IRS: "you must still report any income on your tax return."

**Reuse / build decision (roadmap question):** this is **genuinely simpler** than the bracket-engine tools — it is a threshold/eligibility **lookup**, not a marginal-rate computation. It needs **no** reuse of `paycheck-engine.js`, the tax brackets, or FICA logic, and it must **not** touch `obbba-deductions-2026.json` (this isn't a deduction). Build a small standalone data file `src/data/form-1099-thresholds.json` + a pure-comparison engine `src/engine/form-1099-checker.js`. **Real value beyond a yes/no** (three genuine adds, §5): (a) **which form** you'll get (1099-K vs 1099-NEC vs 1099-MISC vs none) resolved from payer-type + payment-method — the disambiguation IS the product; (b) **headroom** — "how much more you can receive / how many more transactions before a form is triggered"; (c) an **optional state selector** for the ~8 non-conforming states with lower 1099-K thresholds (informational, with a volatility caveat — see §2 Correction-adjacent note and §6).

**Confidence:** HIGH on the federal figures (Notice 2025-62 read verbatim). MEDIUM on the state-threshold table (states change these yearly and secondary sources conflict on a few — treat as informational, timestamp it, §6). One genuinely UNCERTAIN edge flagged: the exact-`$2,000` NEC boundary phrasing (§6, minor).

---

## 1. The rules, verified against IRS primary sources

### 1.1 Form 1099-K — IRC §6050W(e), restored by OBBBA §70432

**Verbatim (IRS Notice 2025-62, p.4, .02):**
> "Before amendment by section 70432 of the OB[B]BA, the de minimis reporting threshold in section 6050W(e) was $600 as enacted by section 9674(a) of the American Rescue Plan Act of 2021 … Section 70432(a) of the OBBBA **retroactively amended** the de minimis reporting threshold rules of section 6050W(e) by specifying that the amendment '**take effect as if included in section 9674 of the American Rescue Plan Act.**' After amendment by the OBBBA, section 6050W(e) provides that payments made by a TPSO in settlement of third party network transactions must be reported **only if the gross amount of payments to a payee exceeds $20,000 and the number of transactions exceed 200** with respect to the payee."

**Verbatim (Notice 2025-62, p.3) — the two-transaction-type split:**
> "Section 6050W applies to two types of transactions: (1) payment card transactions and (2) third party network transactions. **All payments made in settlement of payment card transactions must be reported** in the manner described above. Section 6050W(e) provides that payments made by a third party settlement organization (TPSO) in settlement of third party network transactions must be reported **only if** the gross amount of payments to a payee exceeds the de minimis reporting threshold rules."

**Verbatim (IRS "Understanding your Form 1099-K"):**
> "If your customers or clients pay you directly by credit, debit or gift card, you'll get a Form 1099-K from your payment card processor **no matter how many payments you got or how much they were for.**"
> "Third party settlement organizations (TPSOs) (payment apps and online marketplaces) are required to report payments on Form 1099-K when the total amount of payments you receive for goods or services through the platform **exceeds $20,000 in more than 200 transactions.**"

**Decoded:**

| Transaction type | Who issues | Threshold (2025 & 2026) | Inequality |
|---|---|---|---|
| **Third-party NETWORK** (PayPal, Venmo, Cash App for Business, Etsy/eBay/Airbnb payouts, marketplace) | The TPSO | gross **> $20,000** **AND** **> 200** transactions | both strict `>` |
| **Payment CARD** (credit/debit/gift card via Stripe, Square, Toast, a merchant acquirer) | The payment card processor | **none** — any amount, any count | n/a ($0.01 triggers) |

- **Both** network conditions must be exceeded. 200 transactions totaling $30,000 → **no** 1099-K (count not > 200). 250 transactions totaling $18,000 → **no** 1099-K (dollars not > $20,000). This is the "transaction-count-matters" edge the roadmap flagged — it's real and it cuts **both** ways.
- This is a **full reversion to the pre-ARPA rule** (identical "$20,000 and 200" language), not a new/different number. Not a partial or a new phase-in.
- **Effective years:** statutorily retroactive to 2022 (see verbatim above); **for a user today, 2025 and 2026 both use $20,000/200.** The intervening ARPA phase-in ($5,000 for 2024, $2,500 for 2025, $600 for 2026 — IRS Notice 2024-85) is **void**; OBBBA eliminated it.
- **Gross, not net:** 1099-K reports gross goods-and-services payments before fees, refunds, chargebacks, or shipping. It should exclude personal transfers (splitting rent, gifts), though platforms sometimes misclassify — a reconciliation point, not a threshold point.
- **Per platform:** each TPSO/processor tests its own total independently. $15,000 on PayPal + $15,000 on Venmo = no 1099-K from either (neither platform alone exceeds $20,000).

### 1.2 Forms 1099-NEC and 1099-MISC — IRC §6041(a) / §6041A, OBBBA §70433

**Verbatim (IRS Notice 2025-62, p.4, .02):**
> "Before amendment by section 70433 of the OBBBA, the applicable reporting threshold in each of section 6041 and 6041A was $600. **Section 70433(a) of the OBBBA increased the reporting threshold under section 6041(a) from $600 to $2,000 with respect to payments made after December 31, 2025, and before January 1, 2027.** For payments made after December 31, 2026, **section 6041(h), as added by section 70433(b) of the OBBBA, provides for an annual inflation adjustment** to the reporting threshold under section 6041(a). **Section 70433(c) of the OBBBA amended the reporting threshold under section 6041A from $600 or more to an amount that equals or exceeds the dollar amount in effect for such taxable year under section 6041(a).**"

**Verbatim (Notice 2025-62, p.2) — what each section covers:**
> "Section 6041(a) requires a person engaged in a trade or business generally to file an information return … if the person made payments … to another person of fixed or determinable income such as **rent, salaries, wages, premiums, annuities, or compensation** in amounts above the applicable reporting threshold." [→ **Form 1099-MISC**]
> "Section 6041A imposes similar filing and furnishing requirements … with respect to persons engaged in a trade or business and who pay … **remuneration to any person for services performed**." [→ **Form 1099-NEC**]

**Decoded:**

| | Old (through TY2025) | New (TY2026) | TY2027+ |
|---|---|---|---|
| **1099-NEC** (§6041A, nonemployee comp for services) | $600 or more | **$2,000 or more** | inflation-indexed, pegged to §6041(a) |
| **1099-MISC** (§6041(a), rent/prizes/other income) | $600 or more | **$2,000 or more** | inflation-indexed (§6041(h)) |

- **Both** forms move to $2,000, together — §6041A is **pegged** to "the dollar amount in effect … under section 6041(a)," so 1099-NEC and 1099-MISC never diverge. The roadmap's "presumably 1099-MISC too" is **confirmed**.
- **Inequality = "$2,000 or more" ( `≥` ).** §6041(a)'s statutory phrase is "$600 or more"; OBBBA swapped the dollar figure, keeping "or more." So a contractor paid **exactly $2,000** in 2026 **does** get a 1099-NEC. (Contrast the 1099-K's strict `>`.) Flagged as a minor UNCERTAIN edge in §6 because secondary sources phrase it inconsistently ("exceeds $2,000" vs "$2,000 or more").
- **Year boundary:** the $2,000 floor is for "payments made after December 31, 2025." **TY2025 payments still use the old $600 floor.** The checker must key the NEC/MISC threshold to the tax year.
- **Calendar-year measured**, per payer per payee.
- **Inflation:** §6041(h), for payments after Dec 31, 2026 → first adjustment **TY2027**, **base year 2025**, rounded to the nearest **$100** (rounding per corroborating secondary sources; the Notice states only "annual inflation adjustment"). The exact 2027 figure is not yet published — the checker should show "≈ $2,000, adjusted for inflation" for 2027+, not a hard number.

### 1.3 Who issues what — the disambiguation that IS the myth-bust (Correction 4)

Payments made **through** a card or a TPSO are **excluded** from the payer's §6041/§6041A duty (the §6041(a) regs carve out amounts reportable under §6050W). Consequence:

| How you were paid by a business | Form you might get | Issued by | Threshold that applies |
|---|---|---|---|
| Direct **check / ACH / cash / bank transfer** | **1099-NEC** (services) or **1099-MISC** (rent/other) | the paying business | **≥ $2,000** (TY2026) |
| Business paid you via **credit/debit card** or a **card processor** | **1099-K** | the card processor | **no threshold** |
| Business paid you via **PayPal/Venmo/app (goods & services)** | **1099-K** | the TPSO | **> $20,000 AND > 200 txns** |

You do **not** get both a 1099-NEC and a 1099-K for the same dollars — the payment rail decides the issuer. This single table dissolves most of the user confusion the roadmap identified.

### 1.4 The taxability myth (Correction 5, CONFIRMED)

- **IRS ("Understanding your Form 1099-K"):** "you must still report any income on your tax return" — whether or not a 1099-K arrives.
- A 1099 is an **information return** (a copy to you + a copy to the IRS). It changes **paperwork and IRS visibility**, not **what you owe**. Business/self-employment income, taxable sales gains, and rent were taxable at $1 regardless of any form.
- **Corollary myths to bust explicitly:** (a) "Under the threshold ⇒ tax-free" — false. (b) "Got a 1099-K for reselling my used couch at a loss ⇒ I owe tax" — false; personal-item **losses** aren't deductible but aren't taxable either (report and zero out on Schedule 1 / Form 8949). (c) "A 1099-K for splitting dinner on Venmo ⇒ taxable" — false; personal reimbursements aren't income (flag the platform miscategorization).

---

## 2. Roadmap verdict (confirm / correct)

| Roadmap claim | Verdict | Note |
|---|---|---|
| 1099-K reverted from $600 to $20,000 / 200 transactions | ✅ CONFIRMED | §6050W(e) restored verbatim to pre-ARPA text |
| Both $20,000 AND 200 (not either); historically "and" | ✅ CONFIRMED | "exceeds $20,000 **and** the number of transactions exceed 200" — full reversion to the pre-2021 "and" rule |
| Effective TY2026 | ⚠️ CORRECTION 1 | Applies to **2025 AND 2026**; statutorily **retroactive to 2022**. The $600 rule never hit taxpayers (phase-in relief); OBBBA erased the $5k/2024, $2.5k/2025, $600/2026 schedule |
| Was there a phase-in? What did OBBBA do to it? | ✅ ANSWERED | Yes — IRS Notice 2024-85 set $5,000 (2024) / $2,500 (2025) / $600 (2026+). OBBBA **eliminated all of it**, locked $20k/200 |
| 1099-NEC (and 1099-MISC) $600 → $2,000, TY2026 | ✅ CONFIRMED | §6041(a)/§6041A via §70433; "payments made after December 31, 2025" |
| $2,000 indexed for inflation in future years | ✅ CONFIRMED (precise) | §6041(h): first adjustment **TY2027**, **base year 2025**, ~nearest $100. 1099-NEC pegged to the 1099-MISC figure |
| Payment settlement entities (PayPal/Venmo/Stripe/marketplaces) issue 1099-K at $20k | ⚠️ CORRECTION 2 | True for **network** platforms (PayPal/Venmo/marketplaces). **Card processors (Stripe/Square) have NO threshold** — $0.01 triggers. Two transaction types under §6050W |
| Contractor-payer issues 1099-NEC; users confuse the two | ⚠️ CORRECTION 4 | True, but paying a contractor **via** card/app shifts the duty to the processor (1099-K), relieving the payer of 1099-NEC — you don't get both |
| Getting a 1099 doesn't create new tax, just reporting | ✅ CONFIRMED — central | The load-bearing myth-bust. Report all income regardless of any form |
| Simple checker; maybe state thresholds vary $600–$1,000 | ✅ MOSTLY — with an inequality nuance and a volatility caveat | 1099-K = strict `>`; NEC/MISC = `≥` (Correction 3). State table real but volatile (§6) |

**Sixth straight spec to catch a roadmap/consensus error.** The load-bearing corrections here are **Correction 1 (wrong effective years / the erased phase-in)** and **Correction 2 (card processors have no threshold — Stripe ≠ Venmo)**.

---

## 3. Proposed dataset file `src/data/form-1099-thresholds.json`

**Why a new standalone file, not `obbba-deductions-2026.json`:** that file is a **deductions** dataset (MAGI-phased above-the-line / Schedule-A amounts driven by `obbba-deduction.js`). A 1099 threshold is neither a deduction nor a dollar you compute against brackets — it's a filing-trigger lookup. Forcing it in pollutes the schema. Keep it in a sibling file with the same citation rigor.

```jsonc
{
  "_meta": {
    "description": "Form 1099-K (IRC §6050W, OBBBA §70432) and Form 1099-NEC/1099-MISC (IRC §6041/§6041A, OBBBA §70433) reporting thresholds. Drives /1099-threshold-checker. Federal figures verbatim from IRS Notice 2025-62. State 1099-K thresholds are informational and volatile — re-verify each filing season.",
    "lastSourced": "2026-07-12",
    "confidence": "high on federal (Notice 2025-62 read verbatim); medium on state table (states revise yearly; sources conflict on a few)"
  },
  "form1099K": {
    "network": {                    // third-party NETWORK transactions (TPSO)
      "grossThreshold": 20000,
      "grossInequality": "exceeds", // strict >  (must be OVER 20000)
      "txnThreshold": 200,
      "txnInequality": "exceeds",   // strict >  (must be OVER 200)
      "logic": "AND",               // BOTH must be exceeded
      "appliesToYears": [2025, 2026],
      "retroactive": "as if included in ARPA §9674 (2022+)",
      "issuer": "third-party settlement organization (TPSO)",
      "examples": ["PayPal (goods & services)", "Venmo (business/G&S)", "Cash App for Business", "Etsy", "eBay", "Airbnb", "Uber/Lyft payouts"]
    },
    "card": {                       // PAYMENT CARD transactions
      "grossThreshold": 0,
      "txnThreshold": 0,
      "logic": "NONE",              // no de-minimis: any amount, any count
      "issuer": "payment card processor / merchant acquirer",
      "examples": ["Stripe (card)", "Square", "Toast", "Clover", "direct merchant card acquiring"]
    }
  },
  "form1099NEC_MISC": {
    "section6041A_NEC": "nonemployee compensation for services",
    "section6041_MISC": "rent, prizes, other income",
    "inequality": "atOrAbove",      // >=  ("$X or more")
    "byYear": {
      "2025": 600,
      "2026": 2000,
      "2027": { "approx": 2000, "indexed": true, "baseYear": 2025, "note": "inflation-adjusted, ~nearest $100; exact figure TBD by IRS" }
    },
    "pegged": "1099-NEC threshold equals the 1099-MISC (§6041(a)) amount in effect for the year",
    "carveOut": "payments made via card or TPSO are reportable under §6050W (1099-K) instead — payer is relieved of 1099-NEC/MISC filing"
  },
  "stateOverrides1099K": {          // informational; lower than federal; re-verify yearly (§6)
    "_caveat": "State 1099-K thresholds change annually and sources conflict. Show as 'your state may also require reporting at a lower threshold' with a last-verified date, not as gospel.",
    "MA": 600, "MD": 600, "VA": 600, "VT": 600, "DC": 600, "MT": 600, "NC": 600,
    "NJ": 1000, "IL": { "amount": 1000, "txns": 4, "logic": "AND" },
    "MO": 1200, "AR": { "amount": 2500, "condition": "when no state tax withheld" }
  }
}
```

Engine `src/engine/form-1099-checker.js`: **pure comparison, no bracket/FICA imports.** One function, `check1099(inputs) → result`. Deterministic; ~40 lines. No dependency on `paycheck-engine.js`, `tax-data-2026.json`, or `obbba-deductions-2026.json`.

---

## 4. Checker mechanics (inputs → output)

### 4.1 Inputs

| Input | Type | Options / range | Notes |
|---|---|---|---|
| `taxYear` | select | 2025 · 2026 (default) · 2027 | Keys the NEC/MISC threshold; 2027 shows "indexed" |
| `payerType` | select | "Payment app / marketplace (PayPal, Venmo, Etsy…)" · "Card payments (Stripe, Square, in-person card)" · "A business paying me directly (check, ACH, cash)" | THE primary branch — decides which form/threshold |
| `amount` | number ($) | ≥ 0 | Gross received (1099-K) or paid to you (NEC/MISC), this platform/payer, this year |
| `transactions` | number | ≥ 0 integer | **Only shown when** `payerType = payment app` (the sole case where count matters) |
| `paymentNature` | select (only for app/card) | "Goods & services / business" · "Personal (splitting bills, gifts, reimbursements)" | Personal → not income; warn about platform miscategorization |
| `state` | select (optional) | 50 + DC | Surfaces a state-override note only for non-conforming states |

Human-friendly rule (per the site's "one obvious way to enter each value" memory): **`transactions` appears only for the payment-app branch** — card and direct-pay never need it, so don't render a dead field.

### 4.2 Output logic (pseudocode)

```
if payerType == "payment app (network)":
    if paymentNature == "personal":
        form = none; note = "Personal transfers aren't income. If the platform tags them
               goods & services you could get a 1099-K by mistake — fix the tag or reconcile on your return."
    else:
        willIssue = (amount > 20000) AND (transactions > 200)      // BOTH strict
        form = willIssue ? "1099-K" : none
        headroom = { dollarsToGo: max(0, 20001 - amount),
                     txnsToGo:   max(0, 201 - transactions) }       // "you'd need BOTH"

elif payerType == "card":
    form = (amount > 0) ? "1099-K" : none                          // no threshold
    note = "Card processors report every dollar — there is no minimum."

elif payerType == "direct business payment":
    floor = threshold(taxYear)          // 600 (2025) | 2000 (2026) | indexed (2027)
    willIssue = amount >= floor                                    // >= ("or more")
    form = willIssue ? "1099-NEC (services) or 1099-MISC (rent/other)" : none
    headroom = { dollarsToGo: max(0, floor - amount) }

// State overlay (1099-K branches only)
if state in stateOverrides1099K and amount >= stateThreshold(state):
    stateNote = "Even without a federal 1099-K, <state> requires platforms to report at $<X>."

// Always append (Correction 5):
mythBust = "A 1099 is paperwork, not a new tax. Whether or not you get one, taxable income
            is still taxable and must be reported. No form ≠ no tax."
```

### 4.3 Output card (what the user sees)

- **Verdict badge:** "✅ No 1099 expected" / "📄 Expect a 1099-K" / "📄 Expect a 1099-NEC/1099-MISC" (+ issuer).
- **Why:** the exact test that decided it, with the user's numbers plugged in ("$18,000 ≤ $20,000 — under the dollar limit, so no 1099-K even though you had 240 transactions").
- **Headroom:** "You can receive **$X more** and have **N more transactions** before a 1099-K is triggered — you'd need to cross **both**." / "**$Y more** before a 1099-NEC."
- **State note** (if applicable).
- **Myth-bust box** (always): the paperwork-not-tax line + the two corollary myths.

---

## 5. Real value beyond a yes/no (reuse assessment answer)

The roadmap asked whether this is "genuinely simple or has real calculator value." Verdict: **simple engine, real product value — in disambiguation, not arithmetic.**

1. **Form disambiguation (the core value):** most people can't tell 1099-K from 1099-NEC or why paying a contractor by Venmo changes the answer. Resolving `payerType × paymentMethod × year → {form, issuer, threshold}` is the thing worth shipping. A bare "$20k? yes/no" tool would miss it.
2. **Headroom tracking:** "how much / how many more before a form triggers" — asked constantly by sellers and gig workers mid-year. Cheap to compute, high utility.
3. **State overlay:** ~8 states set lower 1099-K thresholds; a resident of MA/MD/VA/VT/DC can be under the federal bar but still get a state 1099-K. Genuine, matches the site's state-cluster pattern — **but** these figures are volatile (states revise yearly, sources conflict). Ship it **informational** with a "last verified 2026-07" stamp; do **not** build 51 differentiated state pages off it (unlike the tax-bracket state cluster, the data doesn't justify per-state pages and would age badly).

**No reuse of the bracket/FICA engines is needed or appropriate.** This is the first tax tool in the set that legitimately stands alone.

---

## 6. Uncertainties (flagged, non-load-bearing)

1. **Exact-`$2,000` NEC boundary (`≥` vs `>`):** §6041(a)'s "or more" phrasing supports **≥** (exactly $2,000 triggers). Secondary sources split between "$2,000 or more" and "exceeds $2,000." Treated as **≥** in the engine; the practical effect at the boundary is one edge case. Low stakes; note "at exactly $2,000, expect a form."
2. **State 1099-K table:** MEDIUM confidence. Thomson Reuters + 1099FIRE give MA/MD/VA/VT/DC/MT/NC $600; NJ $1,000; IL $1,000 + 4 txns; MO $1,200; AR $2,500 (no-withholding). One IRS-FAQ-adjacent source shows NC/CA *conforming* to federal, and CA keeps a $600 rule only for app-based-driver payments. States revise annually. **Do not hard-assert; timestamp and caveat.**
3. **2027 indexed figure:** §6041(h) mechanics are known (base 2025, nearest $100) but the IRS hasn't published the 2027 dollar amount. Show "≈ $2,000 (inflation-adjusted)" for 2027+, not a fabricated number.
4. **Personal-transfer miscategorization:** whether a given app tags a payment "goods & services" is a platform behavior, not a legal threshold — the tool warns but can't predict it.

None affect the four headline federal numbers ($20,000 / 200 / $2,000 / TY2026), which are HIGH-confidence (Notice 2025-62 verbatim).

---

## 7. Test fixtures (10)

All amounts per single platform/payer, per calendar year. Expected outputs are what the engine must return.

| # | Scenario | Inputs | Expected form | Why (the deciding test) |
|---|---|---|---|---|
| 1 | **Casual seller, under both K limits** | app · G&S · $8,000 · 60 txns · TY2026 | **None** | $8,000 ≤ $20,000 **and** 60 ≤ 200 — neither exceeded. (Still taxable if it's business income.) |
| 2 | **Over 1099-K, both limits** | app · G&S · $25,000 · 300 txns · TY2026 | **1099-K** (TPSO) | $25,000 > $20,000 **and** 300 > 200 — both exceeded. |
| 3 | **Count fails (dollars alone don't trigger)** | app · G&S · $30,000 · 150 txns · TY2026 | **None** | $30,000 > $20,000 but 150 ≤ 200 → **AND** fails. The transaction-count edge. |
| 4 | **Dollars fail (count alone doesn't trigger)** | app · G&S · $18,000 · 250 txns · TY2026 | **None** | 250 > 200 but $18,000 ≤ $20,000 → **AND** fails. Mirror edge. |
| 5 | **Card processor — no threshold** | card · G&S · $500 · 5 txns · TY2026 | **1099-K** (card processor) | Payment-card transactions have **no** de-minimis; $0.01 triggers. Correction 2. |
| 6 | **Direct contractor, over $2,000** | direct · $2,500 · TY2026 | **1099-NEC** (payer) | $2,500 ≥ $2,000 (2026 floor). |
| 7 | **Direct contractor, under $2,000 in 2026 — but SAME amount in 2025 differs** | direct · $1,500 · TY2026 → then TY2025 | **None (2026)** / **1099-NEC (2025)** | $1,500 < $2,000 (no form 2026); but $1,500 ≥ $600 (2025 floor) → form in 2025. Year-boundary (Correction 3). |
| 8 | **The "$600–$2,000 gap" (used to trigger, now doesn't)** | direct · $1,800 · TY2026 | **None** | $1,800 < $2,000 → no 1099-NEC. **Myth-bust must fire:** still taxable self-employment income — no form ≠ no tax. |
| 9 | **State lower threshold beats federal** | app · G&S · $700 · 10 txns · MA · TY2026 | **None (federal)** + **state 1099-K note** | Under federal $20k/200, but MA state threshold $600 → platform must report to MA. State-cluster value. |
| 10 | **Exact-$2,000 NEC boundary (rent, 1099-MISC)** | direct · rent · $2,000 · TY2026 | **1099-MISC** (payer) | $2,000 ≥ $2,000 → "or more" boundary triggers (§6041(a)). Contrast the K's strict `>` (exactly $20,000 / exactly 200 would NOT trigger). |

Bonus assertion (not a numbered fixture, worth a unit test): **1099-K exactly at the line** — app · G&S · $20,000 · 200 txns · TY2026 → **None** (needs to *exceed* both; equal is not enough). This is the `>` vs `≥` contrast against fixture 10 and is the single most common misread of the rule.

---

## 8. Myth-bust framing (for the tool's copy)

Lead with these; they're the reason the tool exists.

- **"Venmo/PayPal will 1099 you at $600."** ❌ Gone. Payment **apps** now report only if you clear **both** $20,000 **and** 200 goods-and-services transactions in a year (2025 and 2026). The $600 rule was law on paper but never actually applied to your forms — the IRS kept delaying it, and OBBBA repealed it.
- **"A business will 1099 me for any $600 gig."** ❌ The direct-payment (1099-NEC/1099-MISC) floor rose to **$2,000** for 2026 (was $600), and rises with inflation after.
- **"No 1099 means it's tax-free."** ❌ The single biggest error. A 1099 is **paperwork the IRS gets a copy of** — not a tax and not the definition of income. Freelance pay, resale profits, and rent are taxable whether or not any form shows up. Report it regardless.
- **"I got a 1099-K, so now I owe tax I didn't before."** ❌ The form created no new liability. If those dollars were already taxable, they were taxable before the form; if they weren't (you resold personal items at a loss, or a friend repaid you on Venmo), a 1099-K doesn't make them taxable — you reconcile it to zero on your return.
- **"Stripe/Square won't send anything under $20k."** ❌ Card processors have **no** minimum — they report every dollar. The $20k/200 rule is only for **app/marketplace** (network) payments, not card processing.

---

## 9. Adversarial verification of every hard number

| Number | Claim | Verified against | Result |
|---|---|---|---|
| **$20,000** | 1099-K network gross threshold | Notice 2025-62 p.4 verbatim ("exceeds $20,000"); IRS 1099-K page; IRS OBBBA FAQ | ✅ exact |
| **200** | 1099-K network transaction count | Notice 2025-62 p.4 ("number of transactions exceed 200") | ✅ exact |
| **AND (both), strict `>`** | Both conditions, each exceeded | Notice 2025-62 ("exceeds … and … exceed"); pre-ARPA §6050W(e) text | ✅ full pre-2021 reversion, "and" |
| **$0 / no threshold (card)** | Payment-card transactions have no minimum | Notice 2025-62 p.3 ("All payments … of payment card transactions must be reported"); IRS 1099-K page ("no matter how many … or how much") | ✅ exact — Correction 2 |
| **2025 & 2026 / retroactive to 2022** | 1099-K effective years | Notice 2025-62 ("take effect as if included in §9674 of ARPA"); RSM/Anchin ("retroactively to 2022") | ✅ — Correction 1 (roadmap said "TY2026 only") |
| **$5,000 / $2,500 / $600 phase-in, now void** | The erased ARPA phase-in | IRS Notice 2024-85; KPMG/Sovos/Grant Thornton corroboration; OBBBA repeal | ✅ history confirmed and nullified |
| **$600 → $2,000** | 1099-NEC/MISC threshold | Notice 2025-62 p.4 verbatim ("from $600 to $2,000") | ✅ exact |
| **≥ ("or more")** | NEC/MISC inequality | §6041(a) "or more" statutory phrasing (via Notice quotation) | ✅ (minor edge flagged §6) |
| **Payments after Dec 31, 2025 (TY2026); TY2025 = $600** | NEC/MISC effective boundary | Notice 2025-62 p.4 ("payments made after December 31, 2025, and before January 1, 2027") | ✅ — Correction 3 (year boundary) |
| **§6041A pegged to §6041(a)** | NEC tracks MISC figure | Notice 2025-62 p.4 ("equals or exceeds the dollar amount in effect … under section 6041(a)") | ✅ exact |
| **Inflation: §6041(h), base 2025, first TY2027, nearest $100** | Indexing mechanism | Notice 2025-62 p.4 (§6041(h), "payments made after December 31, 2026"); secondary for base/rounding | ✅ (2027 dollar TBD, §6) |
| **§70432 / §70433** | OBBBA section numbers | Notice 2025-62 p.4 verbatim | ✅ exact |
| **§6050W / §6041 / §6041A** | Governing IRC sections | Notice 2025-62 pp.2–4 verbatim | ✅ exact |
| **State table (MA/MD/VA/VT/DC/MT/NC $600; NJ/IL $1,000; MO $1,200; AR $2,500)** | State 1099-K overrides | Thomson Reuters + 1099FIRE (conflicts on NC/CA) | ⚠️ MEDIUM — volatile, informational (§6) |

**Primary sources**
- [IRS Notice 2025-62 (n-25-62.pdf)](https://www.irs.gov/pub/irs-drop/n-25-62.pdf) — verbatim §6050W/§6041/§6041A, OBBBA §70432/§70433, thresholds, effective dates, inflation.
- [IRS — FAQs on Form 1099-K threshold under OBBBA (dollar limit reverts to $20,000)](https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000)
- [IRS — Understanding your Form 1099-K](https://www.irs.gov/businesses/understanding-your-form-1099-k) — card vs. network, "still report any income."
- [IRS — Treasury/IRS proposed regs, §3406 backup withholding through third parties](https://www.irs.gov/newsroom/treasury-irs-issue-proposed-regulations-reflecting-changes-from-the-one-big-beautiful-bill-to-the-threshold-for-backup-withholding-on-certain-payments-made-through-third-parties)
- [IRS Notice 2024-85 (the now-void phase-in)](https://www.irs.gov/pub/irs-drop/n-24-85.pdf)

**Corroborating secondary** (history, state, phrasing): RSM ([FAQ summary](https://rsmus.com/insights/services/business-tax/irs-updates-obbba-new-reporting-thresholds.html)), Anchin ([NEC/MISC FAQ](https://www.anchin.com/articles/faqs-new-1099-nec-and-1099-misc-rules-beginning-in-2026/)), Thomson Reuters ([state thresholds](https://tax.thomsonreuters.com/blog/state-tax-information-reporting-what-changed-in-2025-and-what-to-expect-for-2026/)), KPMG/Sovos/Grant Thornton (Notice 2024-85 phase-in).
