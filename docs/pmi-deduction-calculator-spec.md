# PMI / Mortgage Insurance Premium Deduction Calculator 2026 — Sourced Spec

**Tool slug (proposed):** `/pmi-deduction-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA calculators (tips / overtime / senior / SALT / car-loan / charitable / QCD).
**Prepared:** 2026-07-12. Ninth item in the autonomous roadmap chain; fable's top pick from the 3rd scout run (2026-07-12).
**Primary sources:** the enrolled statute **P.L. 119-21 §70108** (verbatim text extracted locally from govinfo `PLAW-119publ21`), the codified **IRC §163(h)(3)(E)/(F)** and **§163(h)(4)(E)/(F)** (law.cornell.edu), **Treas. Reg. §1.163-11** (law.cornell.edu CFR), **IRS Instructions for Form 1098 (Rev. Dec. 2026)** (irs.gov/instructions/i1098), **IRS Pub 936** ($109,000/$54,500 elimination figures, 84-month allocation, Schedule A line 8d), and **Rev. Proc. 2025-32** (2026 standard deduction, already sourced in `src/data/tax-data-2026.json`). Secondary sources used only for corroboration and the SERP check.

---

## 0. Plain-language summary (read this first)

Starting with **tax year 2026**, homeowners who pay **mortgage insurance** — monthly PMI on a conventional loan, FHA mortgage insurance (annual MIP and upfront UFMIP), a **VA funding fee**, or a **USDA (Rural Housing Service) guarantee fee** — can once again deduct those premiums as **home mortgage interest on Schedule A**, permanently. The deduction had been dead since the end of 2021. Three catches:

1. **You must itemize.** The premiums join mortgage interest in the "Interest You Paid" section of Schedule A. If your total itemized deductions don't beat the 2026 standard deduction ($16,100 single/MFS, $32,200 MFJ, $24,150 HoH), the deduction is worth $0.
2. **It phases out fast on income.** The deductible amount shrinks by **10% for each $1,000 (or fraction) of AGI over $100,000** and is **completely gone once AGI exceeds $109,000** ($54,500 for married filing separately, $500 steps over $50,000). Not indexed — these are the same dollar figures as 2006.
3. **Lump-sum upfront premiums are spread out.** A prepaid premium (e.g. FHA UFMIP, single-premium PMI) must be amortized over the **shorter of the mortgage term or 84 months** — *except* VA funding fees and USDA guarantee fees, which are **fully deductible in the year paid**.

**The scout's framing needed five real corrections (details in §2):**
- ⚠️ **CORRECTION 1 — the phaseout ceiling is $109,000, not $110,000.** The scout wrote "$100k→$110k". Because the statute reduces 10% per $1,000 **"or fraction thereof"**, the tenth step lands at any AGI **above $109,000** — IRS Pub 936's own words: no deduction if AGI is more than **$109,000 ($54,500 MFS)**. Same for MFS: gone above **$54,500**, not $55,000.
- ⚠️ **CORRECTION 2 — no separate MFJ threshold.** MFJ shares the **$100,000** threshold with single/HoH. Only MFS differs ($50,000, $500 steps). A married couple hits the phaseout at the same income as a single filer — a marriage penalty worth surfacing in the tool.
- ⚠️ **CORRECTION 3 — the revival mechanism is a switch, not a rewrite.** OBBBA §70108 did **not** re-enact §163(h)(3)(E). It left (E) fully intact — phaseout clause (ii), pre-2007-contract limitation (iii), termination clause (iv) all still printed in the code — and instead inserted **§163(h)(3)(F)(i)(III)**: *"Mortgage insurance premiums treated as interest.—Clause (iv) of subparagraph (E) shall not apply."*, while making (F) permanent. So the **old phaseout is re-live VERBATIM** (resolving the scout's flagged research trap), and the **pre-2007-contract exclusion is also still live**.
- ⚠️ **CORRECTION 4 — VA and USDA fees are deductible AND treated better, not worse.** The statutory definition of "qualified mortgage insurance" (§163(h)(4)(E)) explicitly includes VA, FHA, and Rural Housing Service insurance plus private MI. The 84-month amortization rule (§163(h)(4)(F) + Reg. §1.163-11) **exempts VA/RHS** — their lump-sum fees deduct in full in the year paid. Only FHA UFMIP and single-premium PMI get amortized.
- ⚠️ **CORRECTION 5 — the phaseout reduces the AMOUNT by a percentage, and keys off AGI, not MAGI.** It's 10%-of-the-premium per step (a percentage haircut), structurally different from every phaseout already in `obbba-deduction.js` (tips/overtime reduce a dollar *cap*; senior is continuous 6%; car-loan is $200/step off capped interest). And the statute says plain **"adjusted gross income"** — no §911/931/933 add-back, unlike the MAGI-based siblings. Input label must say AGI.

**Confidence:** HIGH on every load-bearing figure — all are verbatim statute/regulation/IRS-instruction text, not summaries. Four minor open items flagged in §8 (2026 Schedule A line number; pre-2026-paid prepaid premiums; >$750k-loan proration; no-2028-sunset restated).

**Reuse verdict (roadmap question):** **extend `src/engine/obbba-deduction.js` + `src/data/obbba-deductions-2026.json` (new `federal.mip` entry)** — reuse `federalTaxSaved`/`federalIncomeTax` and the `saltComparison`/`charitableComparison` itemize-vs-standard pattern verbatim, but the phaseout itself needs a **new small function** (percentage-of-amount, not reusable from `allowedDeduction`). Rationale in §5.

---

## 1. What the law actually says (verified verbatim)

### 1.1 The revival — P.L. 119-21 (OBBBA) §70108, enrolled text

Extracted verbatim from the govinfo enrolled law (`PLAW-119publ21.htm`, downloaded and grepped locally 2026-07-12):

> **SEC. 70108. EXTENSION AND MODIFICATION OF LIMITATION ON DEDUCTION FOR QUALIFIED RESIDENCE INTEREST.**
> (a) In General.—Section 163(h)(3)(F) is amended—
> (1) in clause (i)—
> (A) by striking ", and before January 1, 2026",
> (B) by redesignating subclauses (III) and (IV) as subclauses (IV) and (V), respectively, …
> (D) by inserting after subclause (II) the following new subclause:
> **"(III) Mortgage insurance premiums treated as interest.—Clause (iv) of subparagraph (E) shall not apply."**,
> (2) by striking clause (ii) [the old post-2025 reversion to the $1M limit] …
> (3) by striking "2018 Through 2025" in the heading and inserting "Beginning After 2017".
> (b) Effective Date.—The amendments made by this section shall apply to **taxable years beginning after December 31, 2025**.

Consequences:
- **Permanent.** (F)(i)'s "and before January 1, 2026" sunset is struck, so the special rules — including the new (III) switch that disables the MIP termination clause — run indefinitely. No 2028 sunset (unlike tips/overtime/senior/car-loan). Also locks in the **$750,000 acquisition-debt cap** and the home-equity-interest suspension permanently (same section).
- **Effective date:** statutory language is "taxable years beginning after December 31, 2025" (§70108(b)) — for calendar-year individuals, **TY2026**, i.e. premiums paid/accrued during 2026 and later. The scout's "premiums paid on/after January 1, 2026" is the correct consumer translation, but the spec-level wording matters for the prepaid edge case in §8.
- Because only clause (iv) is switched off, clauses (ii) and (iii) of (E) remain **operative**, which resolves the two structural questions below.

### 1.2 The deduction itself — IRC §163(h)(3)(E) (codified, unchanged, verified at law.cornell.edu)

> **(i) In general** — "Premiums paid or accrued for qualified mortgage insurance by a taxpayer during the taxable year in connection with **acquisition indebtedness** with respect to a **qualified residence** of the taxpayer shall be treated for purposes of this section as interest which is qualified residence interest."
> **(ii) Phaseout** — "The amount otherwise treated as interest under clause (i) shall be **reduced (but not below zero) by 10 percent of such amount for each $1,000 ($500 in the case of a married individual filing a separate return) (or fraction thereof) that the taxpayer's adjusted gross income for the taxable year exceeds $100,000 ($50,000 in the case of a married individual filing a separate return)**."
> **(iii) Limitation** — "Clause (i) shall not apply with respect to any mortgage insurance contracts **issued before January 1, 2007**."
> **(iv) Termination** — [still printed, but disabled by (F)(i)(III) for taxable years beginning after 2017 → permanently inoperative from TY2026].

Phaseout resolution (the scout's flagged trap): **re-enacted verbatim** — in fact never repealed, just un-terminated. $100,000 threshold (single/MFJ/HoH alike), $1,000 steps, 10% of the premium per step, **fully eliminated above $109,000**; MFS $50,000 / $500 steps / gone above **$54,500**. Confirmed against IRS Pub 936's published elimination figures ("cannot deduct… AGI more than $109,000; $54,500 MFS"). **Not indexed** — §70108 touches only (F); (E)(ii)'s dollars are fixed.

### 1.3 What counts as "qualified mortgage insurance" — IRC §163(h)(4)(E)

> "(i) mortgage insurance provided by the **Department of Veterans Affairs**, the **Federal Housing Administration**, or the **Rural Housing Service**, and (ii) **private mortgage insurance** (as defined by section 2 of the Homeowners Protection Act of 1998)."

Plus the still-live (E)(iii) restriction: the insurance **contract must have been issued after December 31, 2006** (corroborated verbatim by the IRS Form 1098 instructions: "Qualified mortgage insurance is mortgage insurance under a contract issued after December 31, 2006…"). So conventional PMI, FHA MIP/UFMIP, VA funding fee, USDA guarantee fee **all qualify** — for contracts issued 2007+ (which is essentially every active loan in 2026, but pre-2007 vintages must be gated out).

### 1.4 Upfront / prepaid premiums — IRC §163(h)(4)(F) + Treas. Reg. §1.163-11

Statute (§163(h)(4)(F)): prepaid amounts allocable to periods after the payment year are "chargeable to capital account" and "treated as paid in such periods to which so allocated"; "**No deduction shall be allowed for the unamortized balance** of such account if such mortgage is satisfied before the end of its term"; and the whole rule "**shall not apply to amounts paid for qualified mortgage insurance provided by the Department of Veterans Affairs or the Rural Housing Service**."

Regulation (§1.163-11, verified at law.cornell.edu): allocate the prepaid premium "**ratably over the shorter of** the stated term of the mortgage or **a period of 84 months, beginning with the month in which the insurance was obtained**"; the rule "does not apply to mortgage insurance provided by the Department of Veterans Affairs or the Rural Housing Service"; if the mortgage is satisfied early, "no deduction… for any amount of the premium that is allocable to periods after the mortgage is satisfied." The reg's applicability clause is self-reactivating: it applies to prepaid premiums "paid or accrued on or after January 1, 2011, **and during periods to which section 163(h)(3)(E) is applicable**" — (E) is applicable again from TY2026, so the 84-month rule is live without new rulemaking.

Practical matrix for the tool:

| Premium type | 2026 treatment |
|---|---|
| Monthly PMI (conventional) | Deduct as paid in 2026 |
| FHA annual MIP (paid monthly) | Deduct as paid in 2026 |
| FHA **UFMIP** (lump sum at closing) | Amortize: deduct `UFMIP × months-in-2026 ÷ min(84, term-months)` starting the month insurance was obtained |
| Single-premium / split-premium PMI (prepaid portion) | Same 84-month amortization as UFMIP |
| **VA funding fee** (lump sum) | **Fully deductible in year paid** (exempt from amortization) |
| **USDA guarantee fee** (upfront, lump sum) | **Fully deductible in year paid** (exempt — RHS) |
| USDA annual fee (paid monthly) | Deduct as paid |
| Any contract issued before 2007-01-01 | **Not deductible** ((E)(iii)) |
| Refinance/payoff before amortization ends | Remaining unamortized balance **lost** (no deduction) |

### 1.5 Reporting mechanics — Form 1098 Box 5 → Schedule A line 8d

- **Form 1098 Box 5 "Mortgage Insurance Premiums"** — confirmed live again from the IRS Instructions for Form 1098 (Rev. Dec. 2026): "Enter the total premiums of **$600 or more** paid (received) for the tax year being reported, **including prepaid premiums**, for qualified mortgage insurance." The $600 threshold is **per mortgage**, not aggregated. (Box 5 was blank/unused for TY2022–2025 while the deduction was dead.)
- **Schedule A, "Interest You Paid" section, line 8d "Mortgage insurance premiums"** — the line used the last time the deduction was in effect (2021 Schedule A; Pub 936 flow). ⚠️ The **2026 Schedule A is not final yet**; assume 8d and re-verify the line number at form release (open item §8).
- Taxpayer-side flow: 1098 Box 5 amount (+ any qualifying premiums not on a 1098, e.g. VA funding fee financed at closing — verify against closing disclosure) → apply amortization if prepaid → apply AGI phaseout (the old Pub 936 "Mortgage Insurance Premiums Deduction Worksheet") → Schedule A line 8d → included in total itemized deductions.

### 1.6 The itemization gate — 2026 standard deduction (already sourced site-wide)

From `src/data/tax-data-2026.json` (sourced to **Rev. Proc. 2025-32**, confirmed in-repo 2026-06-16): **$16,100 single / $32,200 MFJ / $24,150 HoH**; MFS = $16,100 (= single; the engine's MFS→single mapping is dollar-correct). Scout's "~$16,100/~$32,200" ✅ confirmed — reuse the existing data, no new figures needed.

Interaction notes:
- The new **§68 "2/37" top-bracket haircut** on itemized deductions can never touch this deduction: it starts at the 37% bracket ($640,600/$768,700), where the MIP deduction has been $0 since AGI $109,001. Don't model it; document why.
- MFS wrinkle: if one MFS spouse itemizes, the other's standard deduction is $0 — worth one info line on the MFS path, not a modeled input.

---

## 2. Scout-claim verdict table

| Scout claim | Verdict | Correction / citation |
|---|---|---|
| "OBBBA revives §163(h)(3)(E) permanently for premiums paid on/after Jan 1 2026" | ✅ substance / ⚠️ mechanism | Permanent ✅. Mechanism: §70108 adds **(F)(i)(III)** disabling (E)(iv) — (E) itself untouched. Effective date verbatim: "taxable years beginning after December 31, 2025" (§70108(b)). |
| "$100k→$110k AGI phaseout (10% per $1k over)" — flagged as unverified assumption | ⚠️ RESOLVED, partly wrong | Phaseout **re-live verbatim** ((E)(ii) never repealed). But it's a % -of-amount haircut, fully eliminated **above $109,000** (10th step via "or fraction thereof"), not at $110k — matches IRS Pub 936. **No separate MFJ threshold** ($100k for single/MFJ/HoH alike). Keys off **AGI**, not MAGI. |
| "MFS $50k/$55k per $500" | ⚠️ partly wrong | $50,000 threshold / $500 steps ✅; eliminated above **$54,500**, not $55k (Pub 936). |
| "Itemizer gate vs $16,100/$32,200 std deduction" | ✅ CONFIRMED | Rev. Proc. 2025-32, already in `tax-data-2026.json`. HoH $24,150; MFS $16,100. |
| "84-month amortization of upfront FHA UFMIP" | ✅ CONFIRMED | Reg. §1.163-11: shorter of stated term or 84 months, from month obtained; reg self-reactivates (applicability tied to "periods to which §163(h)(3)(E) is applicable"). Unamortized balance lost on early payoff. |
| "vs VA funding fee / USDA fee treatment" (distinct treatment suspected) | ✅ CONFIRMED, direction pinned | VA/USDA (RHS) fees **are** qualified mortgage insurance (§163(h)(4)(E)) → deductible under this provision, and **exempt from amortization** → fully deductible in the year paid (§163(h)(4)(F) last sentence). |
| "1098 Box 5 → Sch A line 8d" | ✅ CONFIRMED (8d pending form) | Box 5 live for 2026, $600/mortgage threshold, prepaid included (i1098 Rev. 12/2026). Line 8d = 2021-vintage line; 2026 form not final → open item. |
| "SERP = 100% prose + PMI cost calcs, zero deduction calculators" | ✅ CONFIRMED 2026-07-12 | Fresh SERP pass: Bankrate/H&R Block/Rocket/hsh/TS-CPA prose + PMI *cost* calcs (homeguide, themortgagemath, ultimatefinancecalculator, HUD). `taxcalculatorusa.com`'s "2025 PMI deduction" page = prose, no calculator, no dollar figures, stale. **ustax.tools has no PMI deduction calc** — its mortgage-interest calculator's copy still says PMI is "currently NOT deductible… no bill enacted" (stale post-OBBBA), a direct differentiation hook. nationaltaxtools.com: nothing found. |

Chain note: this is the **9th consecutive spec** to catch real errors in the initial framing ($109,000/$54,500 ceilings, shared MFJ threshold, AGI-not-MAGI, %-of-amount structure, VA/USDA year-paid treatment).

---

## 3. Proposed `federal.mip` dataset entry

Drop into `src/data/obbba-deductions-2026.json` under `federal` (shape mirrors `salt`/`carLoan`):

```jsonc
"mip": {
  "statute": "IRC §163(h)(3)(E) mortgage insurance premiums treated as qualified residence interest — termination clause (E)(iv) permanently disabled by §163(h)(3)(F)(i)(III) as added by OBBBA §70108(a)(1)(D); phaseout (E)(ii) and pre-2007-contract limitation (E)(iii) remain operative verbatim. Definition §163(h)(4)(E); prepaid rules §163(h)(4)(F) + Treas. Reg. §1.163-11.",
  "firstYear": 2026,                    // §70108(b): taxable years beginning after 2025-12-31
  "permanent": true,                    // no sunset — (F)(i) heading now "Beginning After 2017"
  "indexed": false,                     // fixed 2006-era dollars
  "agiBasis": "AGI",                    // statute says adjusted gross income — NOT MAGI
  "phaseout": {
    "threshold":      { "single": 100000, "married": 100000, "head_of_household": 100000, "married_separate": 50000 },
    "stepSize":       { "single": 1000,   "married": 1000,   "head_of_household": 1000,   "married_separate": 500 },
    "reductionPerStep": 0.10,           // 10% OF THE PREMIUM per step, "or fraction thereof"
    "eliminatedAboveAgi": { "single": 109000, "married": 109000, "head_of_household": 109000, "married_separate": 54500 }
  },
  "contractIssuedAfter": "2006-12-31",  // (E)(iii) still live
  "prepaid": {
    "amortizationMonthsMax": 84,        // Reg. §1.163-11: shorter of stated term or 84, from month obtained
    "exemptProviders": ["VA", "RHS"],   // VA funding fee + USDA/RHS guarantee fee: fully deductible year paid
    "unamortizedLostOnPayoff": true
  },
  "reporting": { "form1098Box": 5, "form1098PerMortgageThreshold": 600, "scheduleALine": "8d (2021-vintage; confirm on final 2026 Schedule A)" }
}
```

---

## 4. Calculation logic (exact)

Inputs → outputs, all client-side, TY2026.

**Step 1 — qualifying premium for 2026 (`P`):**
- `P = premiumsPaidAsYouGo` (monthly PMI / FHA annual MIP / USDA annual fee paid during 2026)
- `+ (VA funding fee or USDA upfront fee paid in 2026, in full)`
- `+ prepaidSlice` for FHA UFMIP / single-premium PMI paid in 2026: `prepaidSlice = upfrontPremium × monthsIn2026 ÷ min(84, termMonths)`, where `monthsIn2026 = 13 − closingMonth` (month insurance obtained through December).
- Gate: contract issued after 2006-12-31 (checkbox/assumption; pre-2007 → $0, `ineligible_pre2007`).
- Gate: premiums must relate to **acquisition debt on a first/second home** (buy/build/substantially improve). Rental-property MI is Schedule E, out of scope — info note.

**Step 2 — AGI phaseout:**
```
excess = max(0, AGI − threshold[status])          // threshold: 100,000 (50,000 MFS)
steps  = excess > 0 ? ceil(excess / stepSize) : 0 // stepSize: 1,000 (500 MFS); "or fraction thereof"
allowedFraction = max(0, 1 − 0.10 × steps)
deductibleMip   = P × allowedFraction
```
Fully phased out ⇔ `steps ≥ 10` ⇔ AGI > $109,000 ($54,500 MFS). NOTE: this is a **new function** (`mipDeduction`) — do NOT reuse `allowedDeduction` (it reduces a dollar cap, not a percentage of the amount).

**Step 3 — itemization gate + tax saved (reuse existing machinery):**
Same pattern as `saltComparison`/`charitableComparison`: `otherItemized` input (mortgage interest, SALT after its cap, charitable after its floor, …), `standardDeduction` from `tax-data-2026.json` (MFS→single mapping), then:
```
itemizedTotal = otherItemized + deductibleMip
bestWith    = max(itemizedTotal, standardDeduction)
bestWithout = max(otherItemized, standardDeduction)
itemize     = itemizedTotal > standardDeduction
taxSaved    = federalIncomeTax(AGI, status, fed, bestWithout − fedSd)
            − federalIncomeTax(AGI, status, fed, bestWith − fedSd)     // exact bracket-diff
```
Non-itemizer answer to the roadmap's question: **inform, don't block** — show deduction = allowed but benefit = $0, plus the gap to itemizing ("you'd need $X more in itemized deductions before this is worth anything"), same UX convention as the SALT tool. §68 2/37 haircut deliberately NOT modeled (impossible overlap — see §1.6).

---

## 5. Reuse assessment (roadmap question, answered)

**Extend `obbba-deduction.js` / `obbba-deductions-2026.json` — do not build standalone.**

| Piece | Verdict |
|---|---|
| Phaseout math | **New small function** `mipDeduction()` — %-of-amount haircut is structurally unlike all four existing phaseouts (tips/overtime: $/step off a *cap*; senior: continuous 6%; car-loan: $200/step off capped interest). ~15 lines. |
| Itemize-vs-standard + exact bracket-diff | **Reuse verbatim** — `federalIncomeTax`/`federalTaxSaved` + the `saltComparison` best-with/best-without counterfactual pattern (`mipComparison()` mirrors it). |
| Standard deduction + brackets | **Reuse** `tax-data-2026.json` (Rev. Proc. 2025-32 already sourced); MFS→single mapping as in SALT. |
| UFMIP amortization | New trivial helper (`prepaidMipSlice()`): one division + month count. `carLoanFirstYearInterest` is NOT a fit (loan amortization ≠ ratable premium allocation). |
| Data | New `federal.mip` entry (§3); no new data file. |
| Cross-links | Related-tools mesh: SALT calc, charitable calc, amortization/mortgage tools; the `otherItemized` input naturally cross-sells the SALT tool. |

---

## 6. v1 field/input list

| Field | Type | Notes |
|---|---|---|
| Filing status | select: single / MFJ / MFS / HoH | MFS fully supported (own thresholds) — unlike tips/overtime |
| AGI (2026) | $ | Label **AGI**, help text "line 11 of your 1040 — not MAGI" |
| Mortgage insurance type | select: monthly PMI / FHA (MIP + optional UFMIP) / VA funding fee / USDA fee | drives amortization branch |
| Premiums paid during 2026 (recurring) | $ | "Box 5 of your Form 1098" hint |
| Upfront premium paid at closing in 2026 (optional) | $ | UFMIP / single-premium PMI; VA & USDA branch skips amortization |
| Closing month (if upfront premium) | month select | starts the 84-month clock |
| Loan term | select 15/30-yr (or months) | only matters if term < 84 months (rare) |
| Contract issued 2007 or later? | checkbox, default yes | (E)(iii) gate; pre-2007 → ineligible banner |
| Other itemized deductions | $ | mortgage interest, SALT (capped), charitable, medical… |
| Outputs | — | qualifying premium; phaseout reduction (% and $); deductible amount (Sch A line 8d); itemize-vs-standard verdict; federal tax saved (exact bracket-diff); phaseout-band flag; full amortization schedule note for upfront premiums |

---

## 7. Test fixtures (deterministic; deduction-level expectations exact, taxSaved via engine bracket-diff)

| # | Case | Status | AGI | Premiums | Other itemized | Expected |
|---|---|---|---|---|---|---|
| F1 | Clear full deduction below floor | single | $85,000 | $2,400 paid monthly | $18,000 | steps 0 → deductible **$2,400**; itemize ($20,400 > $16,100); taxSaved = bracket-diff on $2,400 |
| F2 | Exactly at threshold | single | $100,000 | $1,800 | $17,000 | excess 0 → **$1,800** full, `phasedOut=false` |
| F3 | Mid-phaseout | single | $104,500 | $2,400 | $18,000 | excess $4,500 → 5 steps → 50% → **$1,200** |
| F4 | Top edge, still alive | single | $109,000 | $2,400 | $18,000 | 9 steps → 90% off → **$240** (nonzero AT $109,000 exactly) |
| F5 | Fully phased out (corrects "$110k") | single | $109,001 | $2,400 | $18,000 | ceil(9,001/1,000)=10 steps → **$0**, `fullyPhasedOut` |
| F6 | Fraction-thereof step | single | $100,001 | $2,000 | $17,000 | excess $1 → 1 step → 10% off → **$1,800** |
| F7 | MFS mid-phaseout | MFS | $52,250 | $2,000 | $17,000 | excess $2,250 / $500 → 5 steps → 50% → **$1,000**; note: spouse-itemizes rule |
| F8 | MFS fully out | MFS | $54,501 | $2,000 | $17,000 | ceil(4,501/500)=10 → **$0** (not $55k) |
| F9 | Non-itemizer — inform, don't block | MFJ | $95,000 | $3,000 | $20,000 | deductible $3,000 but $23,000 < $32,200 std → benefit **$0**; show "need $9,200 more itemized" |
| F10 | Itemization tipping + phaseout combined | MFJ | $105,000 | $4,000 | $31,000 | 5 steps → allowed $2,000; total $33,000 > $32,200 → itemize; incremental deduction over standard = **$800** only (bracket-diff on that) |
| F11 | FHA UFMIP amortization | single | $90,000 | UFMIP $6,125 ($350k × 1.75%), closed June 2026, 30-yr; + $1,600 annual MIP paid | $19,000 | slice = 6,125 × 7 ÷ 84 = **$510.42**; qualifying P = $2,110.42, no phaseout → deductible $2,110.42 |
| F12 | VA funding fee — year-paid in full | MFJ | $98,000 | $8,000 VA fee paid 2026, no monthly MI | $26,000 | **$8,000** deductible (no amortization); $34,000 > $32,200 → itemize |
| F13 | Upfront premium + fully phased out | single | $115,000 | UFMIP slice $510.42 | $20,000 | phaseout 10 steps → **$0** regardless of amortization |
| F14 | Pre-2007 contract | MFJ | $80,000 | $2,500, contract issued 2006 | $35,000 | **$0**, `ineligible_pre2007` banner ((E)(iii) still operative) |

Plus a messaging (non-numeric) fixture: early payoff/refi before month 84 → tool must state the unamortized UFMIP balance is **lost**, not deducted at payoff (§163(h)(4)(F); Reg. §1.163-11).

---

## 8. Open uncertainties (explicit — not guessed)

1. **2026 Schedule A line number.** "Line 8d" is the 2021-vintage line (last year in effect) and the flow Pub 936 used; the **2026 Schedule A draft is not yet published**. Copy should say "mortgage insurance premiums line of Schedule A (line 8d on the last in-effect form)" until the 2026 form drops; re-verify at build or at form release.
2. **Premiums prepaid before 2026 with periods allocable to 2026+.** Reg. §1.163-11 treats allocated slices as "paid" in the allocable period, and (E)(iv) is inoperative from TY2026 — a literal reading revives 2026-allocable slices of e.g. a 2021-paid UFMIP. No IRS confirmation yet (2026 Pub 936 not out). **v1 scope: premiums paid in 2026 only**; note the edge case in the FAQ as unresolved.
3. **Loans above the $750,000 acquisition-debt cap.** Secondary sources assert the deduction requires a mortgage ≤ $750k; the statute only says premiums "in connection with acquisition indebtedness" and spells out no MIP-specific proration for over-cap debt (the old Pub 936 worksheet only handled the AGI phaseout). Don't model; one info note ("premiums must relate to acquisition debt; treatment above the $750k cap awaits IRS guidance").
4. **IRS 2026 withholding/Pub 936 refresh.** The dollar figures need no guidance (fixed statute), but the 2026 Pub 936 will restate the worksheet — re-check at publication for anything unexpected (esp. items 2–3).

---

## 9. Competitive/SERP snapshot (2026-07-12)

- Page 1 for deduction-intent queries: **prose only** — Bankrate, H&R Block, Rocket Mortgage, hsh.com, TS CPA, taxaudit.com, newamericanfunding (several still describing 2026 rules loosely, e.g. "$100k–$110k").
- Calculators in SERP are all PMI **cost** calculators (homeguide, themortgagemath, ultimatefinancecalculator, HUD's MIP tables) — none compute the deduction/phaseout/tax-saved.
- **ustax.tools** (the fast competitor that killed 4 scout candidates): its mortgage-interest calculator's PMI copy is **stale** — still says PMI is "currently NOT deductible… no bill enacted through 2026." **nationaltaxtools.com**: no PMI deduction tool found.
- Differentiators to build in: the **$109,000/$54,500 exact cliff** (most prose says $110k/$55k), the **VA/USDA year-paid vs FHA-amortized** split, the shared-MFJ-threshold marriage penalty, and the itemization-gate reality check with 2026 standard deductions.
