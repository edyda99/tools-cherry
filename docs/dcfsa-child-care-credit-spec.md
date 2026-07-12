# Dependent Care FSA vs. Child & Dependent Care Tax Credit Calculator (2026) — Sourced Spec

**Tool slug (proposed):** `/dependent-care-fsa-vs-credit-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA calculators (tips / overtime / SALT / car-loan / senior / charitable).
**Prepared:** 2026-07-12. Fresh roadmap scout (2026-07-12) ranked this #1.
**Primary sources:** every load-bearing number verified against the codified IRC at law.cornell.edu (§21 applicable-percentage, §21(c) dollar limit + §129-coordination flush, §21(d) earned-income limit, §21(e)(2)/(4) joint-return rule; §129(a)(2) exclusion limit) plus the enrolled statute P.L. 119-21 §70404. Every dollar/percentage in §7 was re-derived against the site's own 2026 brackets/FICA (`tax-data-2026.json`) with a verification script (§8). Secondary tax-press used only for corroboration and worked examples.

---

## 0. Plain-language summary (read this first)

Starting in **tax year 2026**, the One Big Beautiful Bill Act (OBBBA, P.L. 119-21, §70404) changes **two** child-care tax benefits at once, and they interact:

1. **Dependent Care FSA (DCFSA / §129):** the pre-tax payroll set-aside limit rises from **$5,000 → $7,500** ($2,500 → **$3,750** for married-filing-separately). First increase since 1986. Permanent. FSA dollars are pre-tax salary reduction, so they save **income tax + FICA (Social Security + Medicare, ~7.65% below the wage base)**.
2. **Child & Dependent Care Tax Credit (CDCTC / §21):** the top credit rate rises from **35% → 50%**, phasing down through an AGI-tiered schedule to a **20%** floor. It is a **nonrefundable** income-tax credit on up to **$3,000** of care expenses (one child) / **$6,000** (two or more).
3. **The interaction (no double-dip):** every dollar excluded through the DCFSA **reduces the CDCTC expense cap dollar-for-dollar** (IRC §21(c) flush language). Because the new **$7,500 FSA cap now EXCEEDS even the $6,000 two-child credit cap**, **maxing the FSA zeroes out the CDCTC entirely** — for any family size. Under the old $5,000 FSA, a two-child family could do both ($5,000 FSA + $1,000 of credit-eligible expense). Not anymore.

**The roadmap's framing was directionally right, with FOUR real corrections (details in §2):**
- ✅ **CONFIRMED:** DCFSA **$7,500** ($3,750 MFS — the half ratio is preserved, NOT eliminated); CDCTC **50% → 20%** AGI-tiered; expense caps **$3,000 / $6,000 unchanged**; CDCTC **nonrefundable**; both effective **TY2026**, **permanent**, no phase-in.
- ⚠️ **CORRECTION 1 — "optimal split" is largely a MYTH.** Because §129 erodes the §21 cap **dollar-for-dollar**, the total-benefit function is linear in the FSA amount with **corner solutions** — the answer is almost always **all-or-nothing** (max the FSA, or skip it and take the full credit). A partial split only wins in narrow AGI-tier-boundary windows. The tool should recommend a **corner**, not sell a smooth "optimal split."
- ⚠️ **CORRECTION 2 — "low AGI favors the 50% credit" is HALF-RIGHT.** The credit is **nonrefundable**, so at **very low AGI (~<$40k)** where a family owes little/no federal income tax, the headline 50% rate is worth **little or nothing**, and the FSA's **FICA** savings (not liability-limited) can win. The credit genuinely wins at **moderate** AGI (~$50k–$170k for two kids), where the rate is still ~35% AND there's enough tax liability to absorb it.
- ⚠️ **CORRECTION 3 — MFS generally CANNOT take the CDCTC at all.** IRC §21(e)(2) requires a **joint return** (narrow §21(e)(4) separated-spouse exception). So for a married-filing-separately filer the DCFSA ($3,750) is usually the **only** lever. The roadmap's "MFS is $2,500/$3,750" is a DCFSA fact; it does not carry to the credit.
- ⚠️ **CORRECTION 4 — the CDCTC phase-down is TWO-stage and the first stage is NOT joint-doubled.** "20–50%" understates the structure: 50%→35% over AGI $15k–~$43k (**same $15k threshold and $2k steps for singles AND joint filers**), flat 35% to $75k (single) / $150k (joint), then 35%→20% over the next band ($2k steps single / **$4k steps joint**). Get the exact breakpoints from §1.2, not "20–50%."

**Dataset decision (roadmap question):** **create a NEW sibling data file `src/data/dependent-care-2026.json` + engine `src/engine/dependent-care.js`** — do NOT add a 7th `federal.*` entry to `obbba-deductions-2026.json`. Rationale in §3: §21 is a **tiered nonrefundable credit** and §129 is an **income + FICA exclusion**; neither is a MAGI-phased **above-the-line deduction**, which is the entire shape of `obbba-deductions-2026.json` (its `_meta` literally says "deduction parameters"). Reuse the **`paycheck-engine.js`** primitives (`applyBrackets`, `ficaTax`, `federalBracketBreakdown`) for the FSA side — that is where the marginal-rate + FICA logic the W-4 helper leans on already lives (§5).

**Confidence:** HIGH on all figures — the §21/§129 statutory text was read verbatim on Cornell, and every fixture dollar in §7 was regenerated against the site's own 2026 brackets/FICA. Three non-load-bearing items flagged UNCERTAIN in §6 (OBBBA subsection number for §21; whether §129's new $7,500 gets future inflation-indexing; state conformity).

---

## 1. The rules, verified against the codified IRC

### 1.1 Dependent Care FSA / DCAP exclusion — IRC §129(a)(2) (OBBBA §70404)

**Verbatim (Cornell, §129(a)(2)(A)):**
> "The amount which may be excluded under paragraph (1) for dependent care assistance with respect to dependent care services provided during a taxable year shall not exceed **$7,500 ($3,750 in the case of a separate return by a married individual)**."

- **$7,500** exclusion cap; **$3,750** for married-filing-separately (**exactly half — the historic 2:1 ratio is preserved**, NOT dropped and NOT set to some other figure). Prior law: $5,000 / $2,500 (unchanged since 1986).
- **Effective:** "taxable years beginning after December 31, 2025" → **TY2026**. For employer cafeteria plans, plan years beginning **Jan 1, 2026**. **Permanent** (no sunset). **No phase-in.**
- **Per TAX RETURN, not per employee or per employer.** The $7,500 is a household cap: two working spouses filing jointly **share one $7,500**, and an employee with two employers still gets one $7,500. Amounts a plan reimburses above the statutory cap become **taxable wages**. (This is a common myth — see §4 myth-bust. The Newfront secondary summary's guess that "$3,750 MFS suggests per-person" is **wrong**; §129(a)(2) is a per-return limitation on exclusion.)
- **Section 125 cafeteria benefit → pre-tax for BOTH income tax AND FICA.** DCFSA salary reduction reduces federal income-tax wages **and** Social Security + Medicare wages. This is the FSA's structural edge over the credit: it saves ~**7.65%** FICA (6.2% SS up to the $184,500 2026 wage base + 1.45% Medicare) that a nonrefundable income-tax credit never touches. (Above the SS wage base, only 1.45% Medicare, +0.9% additional Medicare over the §1411 threshold.)
- **Earned-income limited (§129(b)):** the exclusion cannot exceed the employee's earned income, or the **lesser** of the two spouses' earned incomes if married. A stay-at-home spouse (not a student/disabled) → $0 excludable. Requires the **employer to offer a DCAP**.
- **Indexing:** the codified statute shows a **fixed** $7,500/$3,750 with no COLA clause → treat as **NOT inflation-indexed** (see §6 — one secondary source claimed future indexing; not load-bearing for TY2026).

### 1.2 Child & Dependent Care Credit — IRC §21 (OBBBA §70404)

**Verbatim (Cornell, §21(a)(2), as amended for TY2026):**
> "The term 'applicable percentage' means **50 percent**— (A) reduced (**but not below 35 percent**) by 1 percentage point for each **$2,000** or fraction thereof by which the taxpayer's adjusted gross income for the taxable year exceeds **$15,000**, and (B) further reduced (**but not below 20 percent**) by 1 percentage point for each **$2,000 ($4,000 in the case of a joint return)** or fraction thereof by which the taxpayer's adjusted gross income for the taxable year exceeds **$75,000 ($150,000 in the case of a joint return)**."

**Verbatim (Cornell, §21(c)):**
> "The amount of the employment-related expenses incurred during any taxable year which may be taken into account under subsection (a) shall not exceed— (1) **$3,000** if there is 1 qualifying individual … or (2) **$6,000** if there are 2 or more qualifying individuals …"
> [flush] "The amount determined under paragraph (1) or (2) … shall be **reduced by the aggregate amount excludable from gross income under section 129** for the taxable year."

**Decoded (two-stage phase-down):**

| AGI (single / HoH) | AGI (joint) | Applicable % |
|---|---|---|
| ≤ $15,000 | ≤ $15,000 | **50%** |
| $15,001 → ~$43,000 | $15,001 → ~$43,000 | 50% → 35% (−1 pt per $2,000 over $15,000) |
| ~$43,001 → $75,000 | ~$43,001 → $150,000 | flat **35%** |
| $75,001 → ~$103,000 | $150,001 → ~$206,000 | 35% → 20% (−1 pt per **$2,000** / **$4,000 joint**) |
| > ~$103,000 | > ~$206,000 | **20%** floor (no upper cutoff — even millionaires get 20%) |

- **Stage-1 (50→35) is NOT joint-doubled:** the same **$15,000** threshold and **$2,000** steps apply to singles AND joint filers (the statute's joint parentheticals appear only in stage-2). A quirk, but that is the text. Stage-1 hits its 35% floor at **AGI > $43,000** for everyone (identical to the old-law 20%-floor breakpoint).
- **Expense caps $3,000 / $6,000 — UNCHANGED** by OBBBA. These are pre-earned-income, pre-§129 gross caps.
- **NONREFUNDABLE** (subpart A; §21 has no refundability except the one-year 2021 ARPA window in §21(g), which is expired). Benefit is limited to the taxpayer's income-tax liability. **This is the crux of Correction 2.**
- **Earned-income limited (§21(d)):** creditable expenses ≤ the taxpayer's earned income (lesser of the two spouses' if married); deemed $250/mo (1 dependent) or $500/mo (2+) for a student/disabled spouse.
- **MFS generally ineligible (§21(e)(2)):** "If the taxpayer is married at the close of the taxable year, the credit shall be allowed … only if the taxpayer and his spouse file a joint return." Exception §21(e)(4): a spouse living apart for the last 6 months who maintains the household is treated as unmarried.
- **Effective TY2026, permanent, no phase-in.**

### 1.3 The interaction mechanic (exact)

Two separate no-double-dip rules stack:
1. **Expenses paid by the FSA are not "employment-related expenses"** for the credit (can't claim the same dollar twice) → credit-eligible expenses ≤ (total expenses − FSA reimbursement).
2. **§21(c) flush:** the **$3,000/$6,000 dollar cap itself is reduced** by the aggregate §129 exclusion.

So, with `x` = DCFSA exclusion, `E` = total qualifying expenses, `cap` ∈ {$3,000, $6,000}:

```
creditableExpenses = min( E − x,  cap − x,  earnedIncomeLimit )     // never below 0
```

**Consequence (the headline interaction):** since the new max `x = $7,500 > $6,000 = two-child cap`, **maxing the FSA drives `cap − x` negative → creditable = $0 → CDCTC = $0**, regardless of number of children. Under old law (`x ≤ $5,000`), a two-child family kept `$6,000 − $5,000 = $1,000` of credit room; that room is now gone once you exceed $6,000 of FSA.

**AGI feedback (a real second-order effect):** the FSA is excluded from gross income, so **AGI is already net of the FSA**. Running `x` through the FSA **lowers AGI by `x`**, which can **raise** the credit's applicable percentage `p` (lower AGI = higher rate). The calculator must look up `p` at the **post-FSA AGI** in the max-FSA scenario and at the **no-FSA AGI** in the skip scenario — they differ. (Verified example: single $90k AGI, 2 kids → skip-FSA p=27%, but maxing a $6,000 FSA drops AGI to $84k → p=30%.)

---

## 2. Roadmap verdict (confirm / correct)

| Roadmap claim | Verdict | Note |
|---|---|---|
| DCFSA $5,000 → $7,500 for 2026 (first increase since 1986) | ✅ CONFIRMED | §129(a)(2); TY2026; permanent |
| MFS: historically $2,500 — did OBBBA change the ratio? | ✅ ANSWERED | MFS = **$3,750** (exactly half; ratio preserved). MFS gets the increase, at half. |
| CDCTC changed from flat 35%→20% to AGI-tiered 20–50% | ✅ CONFIRMED (imprecise) | Real structure is **two-stage** 50→35→20 with a flat-35% plateau; stage-1 not joint-doubled — see §1.2 |
| Expense cap $3,000 / $6,000 | ✅ CONFIRMED unchanged | §21(c) |
| Credit is nonrefundable | ✅ CONFIRMED | subpart A; §21(g) refundability expired after 2021 |
| §129 usage reduces the CDCTC-eligible expense base (no double-dip) | ✅ CONFIRMED | §21(c) flush **reduces the $3,000/$6,000 cap** by §129 exclusions, dollar-for-dollar |
| Maxing $7,500 FSA may zero out CDCTC | ✅ CONFIRMED (stronger) | $7,500 > $6,000 cap → **zeroes the credit for ANY family size**, not just "may" |
| Low-AGI 50% rate may beat the FSA | ⚠️ HALF-RIGHT | Credit is **nonrefundable** — worthless at very low AGI; wins at **moderate** AGI. Correction 2. |
| "Optimal split" between FSA and credit | ⚠️ MOSTLY A MYTH | §129 erodes the cap 1:1 → **corner solution** (all-or-nothing). Correction 1. |
| (Implied) MFS math applies to the credit too | ❌ WRONG | MFS generally **can't take the CDCTC** (§21(e)(2)). Correction 3. |
| Effective TY2026, no phase-in | ✅ CONFIRMED | §70404; taxable years beginning after 2025-12-31 |

Fifth straight spec to catch a roadmap/consensus error (Roth catch-up threshold, bonus Ohio rate, W-4 step, charitable "reduces AGI"/"temporary", now the "optimal split" + nonrefundability + MFS). The load-bearing corrections here are **Correction 1 (corner, not split)** and **Correction 2 (nonrefundable → low-AGI credit can be worthless)**.

---

## 3. Proposed NEW dataset file `src/data/dependent-care-2026.json`

**Why a new file, not a 7th `federal.*` in `obbba-deductions-2026.json`:** that file is a **deductions** dataset — its `_meta` says "deduction parameters," and every entry (tips/overtime/senior/SALT/car-loan/charitable) is an **above-the-line or Schedule-A deduction** with an `eligibleAmount` + MAGI phase-out shape driven by `obbba-deduction.js`'s `allowedDeduction`/`federalTaxSaved`. §21 is a **tiered nonrefundable credit** (applicable-% schedule, expense caps, liability limit) and §129 is an **income+FICA exclusion**. Neither fits the deduction schema; forcing them in pollutes it and misleads the state-conformity layer. Keep them in a sibling file, mirroring the citation rigor.

```jsonc
{
  "_meta": {
    "description": "IRC §129 Dependent Care Assistance (DCFSA) exclusion + IRC §21 Child & Dependent Care Credit (CDCTC), as amended by OBBBA (P.L. 119-21, §70404), effective TY2026. Drives /dependent-care-fsa-vs-credit-calculator. Figures are FIXED statutory amounts (not inflation-indexed on the codified text). Federal-only; state conformity out of scope.",
    "lastSourced": "2026-07-12",
    "confidence": "high — §21/§129 statutory text read verbatim (law.cornell.edu); every fixture dollar re-derived vs tax-data-2026.json 2026 brackets/FICA"
  },
  "dcfsa": {
    "statute": "IRC §129(a)(2) (OBBBA §70404)",
    "firstYear": 2026,
    "permanent": true,
    "notIndexed": true,
    "limit":       { "single": 7500, "married": 7500, "head_of_household": 7500, "married_separate": 3750 },
    "priorLimit":  { "single": 5000, "married": 5000, "head_of_household": 5000, "married_separate": 2500 },
    "perTaxReturn": true,
    "isSection125Cafeteria": true,
    "reducesIncomeTax": true,
    "reducesFica": true,
    "earnedIncomeLimited": true,
    "requiresEmployerPlan": true,
    "qualifies": "Pre-tax dependent-care exclusion capped at $7,500 per tax return ($3,750 MFS) for TY2026+. Per RETURN, not per employee/employer: two working spouses filing jointly share ONE $7,500; excess over the cap is taxable wages. Section 125 cafeteria benefit → reduces federal income-tax wages AND FICA wages (~7.65% below the SS wage base). Limited to the lesser spouse's earned income; requires an employer DCAP."
  },
  "cdctc": {
    "statute": "IRC §21 (OBBBA §70404; verify exact subsection vs enrolled bill)",
    "firstYear": 2026,
    "permanent": true,
    "refundable": false,
    "expenseCap": { "oneChild": 3000, "twoOrMore": 6000 },
    "applicablePercent": {
      "top": 0.50, "stage1Floor": 0.35, "stage2Floor": 0.20,
      "stage1": { "threshold": 15000, "increment": 2000, "jointDoubled": false },
      "stage2": { "thresholdSingle": 75000, "thresholdJoint": 150000, "incrementSingle": 2000, "incrementJoint": 4000 }
    },
    "earnedIncomeLimited": true,
    "mfsGenerallyIneligible": true,
    "mfsException": "IRC §21(e)(4) — spouse living apart last 6 months, maintains household → treated as unmarried",
    "reducedBySection129": true,
    "qualifies": "Nonrefundable credit = applicablePercent × min(qualifying expenses, cap, earned-income limit). applicablePercent starts at 50%, reduced 1 pt per $2,000 over $15,000 (floor 35%; NOT joint-doubled in stage 1), flat 35% to $75k single/$150k joint, then reduced 1 pt per $2,000 ($4,000 joint) over $75k/$150k (floor 20%). Expense cap $3,000 (1 dependent)/$6,000 (2+) is REDUCED dollar-for-dollar by the §129 exclusion (§21(c) flush). Married filers must file jointly to claim it (§21(e)(2)); MFS is generally ineligible."
  },
  "interaction": {
    "noDoubleDip": true,
    "capReductionRule": "creditableExpenses = min(totalExpenses − fsaExclusion, cap − fsaExclusion, earnedIncomeLimit), floored at 0",
    "maxFsaZeroesCreditNote": "Because max FSA $7,500 > $6,000 two-child cap, maxing the FSA drives creditable to $0 for any family size.",
    "agiFeedback": "FSA is excluded from gross income → AGI is net of the FSA → look up applicablePercent at POST-FSA AGI in the max-FSA scenario."
  },
  "sources": [
    { "claim": "IRC §129(a)(2): exclusion $7,500 ($3,750 MFS), effective TY2026, per-return limit.", "url": "https://www.law.cornell.edu/uscode/text/26/129" },
    { "claim": "IRC §21(a)(2) applicable percentage 50%→35%→20% two-stage schedule; §21(c) $3,000/$6,000 caps reduced by §129 exclusions; §21(d) earned-income limit; §21(e)(2)/(4) joint-return rule; nonrefundable.", "url": "https://www.law.cornell.edu/uscode/text/26/21" },
    { "claim": "OBBBA (P.L. 119-21) §70404 amended both §129 and §21, effective for taxable years beginning after 2025-12-31; permanent; first dependent-care update in decades.", "url": "https://www.congress.gov/119/plaws/publ21/PLAW-119publ21.pdf" },
    { "claim": "$7,500 DCFSA + 50% CDCTC, effective 2026, expense caps unchanged, credit nonrefundable, no-double-dip cap reduction.", "url": "https://www.mercer.com/en-us/insights/us-health-news/big-beautiful-bill-permanently-enhances-dependent-care-benefits/" },
    { "claim": "Nonrefundable credit gives little benefit to low-income families who owe little/no income tax.", "url": "https://taxpolicycenter.org/taxvox/2025-reconciliation-law-makes-some-modest-changes-child-care-tax-benefits-provides-little" },
    { "claim": "Maxing the $7,500 DCFSA can leave $0 of credit-eligible expenses (worked reduction example).", "url": "https://www.newfront.com/blog/the-obbb-dependent-care-fsa-increase-could-backfire" }
  ]
}
```

---

## 4. Calculator mechanics

The tool's job: given care expenses + AGI + filing status + number of qualifying dependents + the employer's max FSA election, tell the user **how much to route through the DCFSA vs. leave for the CDCTC, the dollar savings under each strategy, which wins, and the break-even intuition.**

### 4.1 Inputs

| Input | Type | Notes |
|---|---|---|
| `filingStatus` | select | `single` / `married` (MFJ) / `head_of_household` / `married_separate`. MFS → **credit disabled** (§21(e)(2)); FSA cap $3,750. |
| `agi` | number | AGI **before** any FSA (the tool derives post-FSA AGI itself). Drives the applicable-%, the bracket/marginal-rate lookup, and the FICA wage-base logic. Label "household income (roughly)." |
| `numDependents` | select/number | Qualifying individuals under 13 (or disabled). 1 → $3,000 cap; 2+ → $6,000 cap. |
| `careExpenses` | number | Annual eligible dependent-care spend (daycare, after-school, day camp, etc.). |
| `employerFsaMax` | number | Max the employer's DCAP allows, **capped at $7,500** ($3,750 MFS). If no employer plan → 0, and the tool recommends the credit outright. Default $7,500. |
| `lowerEarnerIncome` | number (optional) | Lower-earning spouse's earned income (MFJ) — caps BOTH the FSA and the credit (§129(b)/§21(d)). Default = AGI (non-binding). |
| `year` | fixed 2026+ | Provision starts 2026; no 2025 path, no sunset. |

Do **not** ask for a manual "marginal rate" — derive it from `agi` + the 2026 brackets (human-friendly rule). Do **not** ask the user to pre-split expenses — the tool computes the split.

### 4.2 Core computation (compute BOTH corners exactly, then compare)

```
cap        = (numDependents >= 2) ? 6000 : 3000
fsaCap     = min(employerFsaMax, dcfsa.limit[filingStatus])        // 7500 / 3750
eiLimit    = lowerEarnerIncome ?? agi
mfsNoCredit= (filingStatus == 'married_separate')                 // §21(e)(2)

// ---------- Strategy A: SKIP FSA, take the credit ----------
agiA        = agi
pA          = applicablePercent(agiA, filingStatus)               // §1.2 schedule
creditableA = mfsNoCredit ? 0 : min(careExpenses, cap, eiLimit)
taxA        = incomeTax(agiA − stdDed[status])                    // reuse applyBrackets
creditA     = min(pA * creditableA, taxA)                         // NONREFUNDABLE clamp
benefitA    = creditA                                             // income-tax reduction only

// ---------- Strategy B: MAX the FSA ----------
x           = min(careExpenses, fsaCap, eiLimit)
agiB        = agi − x                                             // FSA excluded from gross income
pB          = applicablePercent(agiB, filingStatus)
creditableB = mfsNoCredit ? 0 : max(0, min(careExpenses − x, cap − x, eiLimit − x))
taxB        = incomeTax(agiB − stdDed[status])
creditB     = min(pB * creditableB, taxB)
fsaIncomeTaxSaved = taxA − taxB                                   // exact bracket-diff
fsaFicaSaved      = fica(agi) − fica(agi − x)                     // reuse ficaTax; SS wage-base aware
benefitB    = fsaIncomeTaxSaved + fsaFicaSaved + creditB

// ---------- (optional) Strategy C: interior split, only near AGI-tier boundaries ----------
// Scan x in steps (e.g. $250) ONLY if agi is within ~$8k of a stage boundary; else skip.
// In the vast majority of cases the optimum is corner A or B (Correction 1).

recommended = argmax(benefitA, benefitB [, benefitC])
```

**`applicablePercent(agi, status)` (exact, ceil = "or fraction thereof"):**
```
joint = (status == 'married')
p = 50
if agi > 15000:  p = max(35, 50 − ceil((agi − 15000) / 2000))
thr2 = joint ? 150000 : 75000 ;  inc2 = joint ? 4000 : 2000
if agi > thr2:   p = max(20, p − ceil((agi − thr2) / inc2))
return p / 100
```

**Precision points:**
- The FSA benefit is **income tax + FICA**; the credit is **income tax only** and **nonrefundable** (clamped to `taxA`). This asymmetry is the whole game — do not model the FSA as income-tax-only.
- Use the **exact bracket-diff** (`taxA − taxB` via `applyBrackets`) for the FSA's income-tax saving, not a flat marginal multiply, so bracket crossings and the standard deduction are exact.
- FICA saving must respect the **$184,500 SS wage base** (reuse `ficaTax`): a high earner's FSA dollars save only 1.45% Medicare, not 7.65%.
- Look up `p` at the **post-FSA AGI** in Strategy B (`agiB`), not the raw AGI.
- **Corner rule (Correction 1):** on `[0, cap]` the benefit is linear in `x`, so the optimum is an endpoint; on `[cap, fsaCap]` it only rises (credit already $0). Interior scan (Strategy C) is worth running only when `agi` sits within a stage-boundary band, otherwise it's wasted compute.

### 4.3 Outputs

1. **Recommendation:** "Max your DCFSA at $X" **or** "Skip the FSA, claim the credit" (a corner), with the runner-up shown for transparency.
2. **Side-by-side savings:** Strategy A (credit $) vs Strategy B (FSA income-tax + FICA + residual credit $), with the **delta**.
3. **Break-even framing:** "Your FSA saves about **{marginal income-tax % + FICA %}** per dollar; your credit rate is **{p}%**. Whichever is higher (accounting for the $7,500 vs $6,000 cap gap and that the credit can't exceed your tax bill) wins."
4. **Interaction callout:** if the recommended FSA ≥ cap, state "this zeroes your Child & Dependent Care Credit — you can't use both on the same dollars."
5. **Caveats row:** credit is **nonrefundable** (worth $0 if you owe no federal income tax); MFS can't claim the credit; both benefits need both parents to have earned income; state treatment separate; employer must offer the DCAP; per-return $7,500 cap (not per spouse).

### 4.4 Constants

None new beyond `dependent-care-2026.json` (§3) + the 2026 standard-deduction, bracket, and FICA tables **already in `tax-data-2026.json`** (single $16,100 / MFJ $32,200 / HoH $24,150; SS wage base $184,500 @ 6.2%; Medicare 1.45%; +0.9% additional).

---

## 5. Reuse assessment (roadmap question 5)

**Verdict: build a STANDALONE `/dependent-care-fsa-vs-credit-calculator/` in a new `src/engine/dependent-care.js` that REUSES `paycheck-engine.js` for the FSA side.** The FSA's benefit is a **pre-tax payroll** calculation (income tax + FICA), which is exactly what `paycheck-engine.js` already does — **not** the MAGI-phased-deduction shape of `obbba-deduction.js`.

**Where the marginal-rate/tax logic lives (roadmap item 5):**
- `src/engine/paycheck-engine.js` → **`applyBrackets(taxable, brackets)`** (progressive tax), **`federalIncomeTax(gross, status, fed, preTax)`** (bracket tax net of a pre-tax amount), **`ficaTax(gross, status, fed, preTaxFica)`** (SS + Medicare + additional, **wage-base aware**, and it already models §125 cafeteria pre-tax reducing FICA — a DCFSA **is** a §125 benefit), and **`federalBracketBreakdown(...)`** which returns **`marginalRate`** directly.
- `src/engine/obbba-deduction.js` → **`federalTaxSaved(gross, status, deduction, fed)`** returns `{taxBefore, taxAfter, taxSaved, marginalRate}` via bracket-diff; **`estimateW4Adjustment(...)`** (the W-4 helper the roadmap points at) uses exactly this for its marginal rate. Reuse the **pattern** (bracket-diff) for the FSA income-tax saving; but note `federalTaxSaved` is **income-tax only** — the DCFSA additionally needs the **`ficaTax` diff**, which `paycheck-engine.js` supplies.

**Reused (~70%):** `applyBrackets`, `ficaTax`, `federalIncomeTax`/`federalBracketBreakdown`, the standard-deduction + bracket + FICA constants in `tax-data-2026.json`.
**New logic (small, in `dependent-care.js`):**
- `applicablePercent(agi, filingStatus)` — the §1.2 two-stage schedule.
- `creditableExpenses({expenses, fsa, cap, earnedIncomeLimit})` — the §21(c) min() with the §129 cap reduction.
- `dependentCareComparison({filingStatus, agi, numDependents, careExpenses, employerFsaMax, lowerEarnerIncome, dc, fed})` → returns `{cap, fsaCap, strategyA, strategyB, [strategyC], recommended, delta, breakEven, notes}` — orchestrator mirroring `saltComparison`'s return shape.

Pure client-side, no backend, no new constants beyond the sibling JSON — consistent with the repo hard rules. **Cross-link** the paycheck/W-4 tools and the OBBBA family tools (Child Tax Credit context), and add the "related tools" overrides like the prior additions.

---

## 6. Flagged uncertainties (none load-bearing for the dollar outputs)

- **UNCERTAIN — OBBBA subsection number for §21.** §129's change is firmly **§70404**. Secondary sources split on whether the §21 change is the same §70404 or an adjacent subsection (one implied "§70405"). IRC **§21 / §129** are verbatim-verified and are the primary citation; verify the exact OBBBA §-label against the enrolled P.L. 119-21 before printing it. **Does not affect any computation.**
- **UNCERTAIN — future inflation-indexing of the $7,500.** The codified §129(a)(2) shows a fixed $7,500/$3,750 with no COLA clause → the spec treats it as **not indexed** (`notIndexed: true`). One secondary source (PrepToPay) claimed the new cap "will be indexed going forward." **Not load-bearing for TY2026** (the figure is $7,500 either way); revisit if IRS guidance adds indexing for 2027+.
- **NOT MODELED (v1) — state conformity.** Some states cap the DCFSA differently or don't conform to the higher §129 exclusion, and state child-care credits vary. Federal-only, like the sibling tools; do not fabricate per-state rows. (Optionally surface "your state may not conform — this is the federal picture.")
- **NOT MODELED (v1) — interaction with the Child Tax Credit / other nonrefundable credits competing for the same liability.** The nonrefundable clamp uses income-tax liability as the ceiling; in reality the CTC and other credits also draw on it (ordering matters). For a single-purpose tool this is an acceptable simplification — flag it in copy ("assumes the credit isn't crowded out by your other credits").
- **NOT MODELED (v1) — the $250/$500-per-month deemed earned income** for a student/disabled spouse (§21(d)/§129(b)). Edge case; note it rather than compute it.

---

## 7. Test fixtures (10 cases) — every dollar re-derived vs `tax-data-2026.json`

`benefit` figures below were computed by the §8 verification script against the site's own 2026 brackets, standard deductions, and FICA (SS wage base $184,500). **At build time, regenerate every figure with the real engine and lock the values**, exactly as the W-4 / SALT / charitable specs did. Coverage: very-low-AGI nonrefundable-choke (F1, F2), moderate-AGI credit-wins (F3), high-AGI FSA-wins (F4, F10), one-child $3k cap (F5, F6, F8), two+ $6k cap (F1–F4, F7, F9), the max-FSA-zeroes-credit interaction (F4, F7, F9), MFS credit-disabled (F8), near break-even (F7, F9), expenses-below-cap (F6).

| # | Scenario | Status | AGI (pre-FSA) | Kids | Expenses | Cap | Credit rate p | **Strategy A: credit only** | **Strategy B: max FSA** (inc-tax + FICA + residual credit) | **Winner** | Teaches |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | Very low AGI, credit choked | MFJ | 35,000 | 2 | 6,000 | 6,000 | 40% | credit capped to **$280** by tax liability (40%×6k=$2,400 potential) | $280 inc-tax + **$459** FICA = **$739** | **MAX FSA** | nonrefundable credit choked by tiny liability |
| F2 | Zero-liability, "50% credit worth $0" | MFJ | 30,000 | 2 | 6,000 | 6,000 | 42% | taxable≈$0 → **credit $0** | $0 inc-tax + **$459** FICA = **$459** | **MAX FSA** | the 50%-headline myth-bust |
| F3 | Moderate AGI, credit wins | MFJ | 85,000 | 2 | 6,000 | 6,000 | 35% | **$2,100** (35%×6k, full liability) | $720 inc-tax (12% br) + $459 FICA = **$1,179** | **SKIP FSA** | the genuine "credit wins" band |
| F4 | High AGI, FSA wins | MFJ | 250,000 | 2 | 7,500 | 6,000 | 20% | **$1,200** (20%×6k) | $1,778 inc-tax (24% br) + **$109** FICA (above wage base) = **$1,887**; credit→$0 | **MAX FSA** | high bracket + FICA cap; $7.5k zeroes credit |
| F5 | Upper-mid single, 1 kid, FSA wins | single | 120,000 | 1 | 5,000 | 3,000 | 20% | **$600** (20%×3k) | $1,100 inc-tax + $382 FICA = **$1,482** | **MAX FSA** | one-child $3k cap; FSA absorbs $5k |
| F6 | Moderate single, 1 kid, credit wins | single | 60,000 | 1 | 4,000 | 3,000 | 35% | **$1,050** (35%×3k) | $480 inc-tax (12% br) + $306 FICA = **$786** | **SKIP FSA** | one-child cap; credit beats FSA |
| F7 | Near break-even, AGI feedback | single | 90,000 | 2 | 6,000 | 6,000 | 27%→**30%** | **$1,620** (27%×6k) | $1,320 inc-tax (22% br) + $459 FICA = **$1,779**; FSA drops AGI 90k→84k so residual p would be 30% | **MAX FSA** (+$159) | break-even; post-FSA AGI raises p |
| F8 | MFS — credit unavailable | MFS | 80,000 | 1 | 3,000 | 3,000 | n/a | **$0** (credit disallowed, §21(e)(2)) | $660 inc-tax + $230 FICA = **$890**; FSA cap **$3,750** | **MAX FSA** (only option) | MFS can't take the credit; FSA $3,750 |
| F9 | Two+, max FSA zeroes credit, edges out | MFJ | 140,000 | 2 | 7,500 | 6,000 | 35% | **$2,100** (35%×6k) | $1,600 inc-tax (22% br) + $574 FICA = **$2,174**; credit→$0 | **MAX FSA** (+$74) | $7,500 FSA cap > $6,000 credit cap tips it |
| F10 | Expenses below the cap | MFJ | 60,000 | 1 | 2,000 | 3,000 | 35% | **$700** (35%×$2,000, expenses<cap) | $240 inc-tax (12% br) + $153 FICA = **$393** | **SKIP FSA** | expenses < cap; credit wins |

**Load-bearing notes / crossovers (verified in §8):**
- **F1/F2 (nonrefundable choke):** at AGI $30–35k MFJ the standard deduction ($32,200) wipes out most/all taxable income, so the 40–42% credit is capped to ≈$0–$280 by liability, while the FSA's **$459 FICA** saving is liability-independent → FSA wins. **Corrects "low AGI favors the credit."**
- **F3 → F9 crossover (MFJ, 2 kids):** with expenses = $6,000, the **credit wins up to ~$170k AGI** and MAX FSA takes over ~$172k (the credit's stage-2 drop below $150k + the eventual 24% bracket). With **$7,500** of expenses available (F9), MAX FSA wins **earlier (~$140k)** because the FSA absorbs $7,500 vs the credit's $6,000 cap. The crossover depends on both AGI **and** whether expenses exceed $6,000.
- **F5 → F6 crossover (single, 1 kid, $3,000):** credit wins up to ~$84k AGI; MAX FSA wins from ~$86k (p falls to 29% while bracket+FICA ≈ 29.65%).
- **F4 (FICA wage base):** at $250k, FSA dollars sit above the $184,500 SS wage base → only 1.45% Medicare (F4 FICA $109), yet the 24% bracket still beats the 20% credit floor.
- **F8 (MFS):** the calculator must **zero the credit** for `married_separate` (§21(e)(2)); the FSA cap is **$3,750**, not $7,500. This is the one case the naive "compare p vs FSA rate" logic gets wrong if it forgets the joint-return requirement.

Add unit tests for: `applicablePercent` at every breakpoint in §1.2 (50/49/35/34/20 at $15k/$15,001/$43,001/$75,001/$103,001 single and $43,001/$150,001/$206,001 joint); the §21(c) cap reduction (`min(E−x, cap−x)` never below 0); the nonrefundable clamp (credit ≤ tax liability); the FICA wage-base kink at $184,500; and the SKIP↔MAX crossover flips above.

---

## 8. Verification script (adversarial — reproduce before build)

Re-derives every §7 figure and the crossovers from `src/data/tax-data-2026.json` (2026 brackets, standard deductions, FICA). Kept here so build-time regeneration is a copy-paste. Key methods: `applicablePercent(agi, status)` (ceil-based two-stage schedule), `income_tax(taxable, status)` (bracket walk), `fica_marginal_saved(wages, x, status)` (wage-base-aware FICA diff), and `scenario(...)` (Strategy A vs B, with the nonrefundable clamp and the §21(c) cap reduction). Adversarial results that **corrected** the initial framing: (a) F1/F2 flipped from "credit wins" to "FSA wins" once the nonrefundable clamp was applied; (b) the initial MFS run wrongly granted a credit — fixed by disallowing the credit for `married_separate`; (c) the "optimal split" collapsed to a corner solution under linearity. All 10 fixtures and the three crossovers reproduce.

*(Script lives at `/tmp/dcfsa_verify.py` during this research pass; port it into `test/` as `dependent-care.spec.mjs` fixtures at build time.)*

---

## 9. Myth-bust / framing block (site style)

- **"Maxing your Dependent Care FSA isn't automatically the smart move anymore."** The bigger $7,500 FSA is great for higher earners, but at moderate income the **35% credit** can beat the FSA's ~30% (bracket + FICA) rate. Run your numbers.
- **"You can't use both on the same dollars — and now the FSA can wipe out the credit entirely."** Every FSA dollar cuts your credit's expense cap. Since the new **$7,500** FSA exceeds even the **$6,000** two-child credit cap, **maxing the FSA leaves $0 for the credit**. Under the old $5,000 limit you could do both; not now.
- **"The 50% credit rate is a headline, not a check."** The credit is **nonrefundable** — if you owe little or no federal income tax (common at low income), that 50% is worth **little or nothing**. The FSA's Social Security + Medicare savings show up **regardless** of your tax bill.
- **"$7,500 is per household, not per spouse."** Two working spouses filing jointly **share one $7,500** — not $7,500 each. Anything your employer reimburses above the cap becomes taxable.
- **"Married filing separately? The credit is off the table."** MFS filers generally **can't claim** the Child & Dependent Care Credit (you'd have to file jointly), but you can still use a DCFSA up to **$3,750**.
- **"Both parents have to be working (or a student/disabled)."** Both the FSA exclusion and the credit are capped by the **lower-earning** spouse's income. A stay-at-home spouse (not a student/disabled) → neither benefit.
- **"These are permanent."** Unlike no-tax-on-tips/overtime (which sunset after 2028), the dependent-care changes have **no expiration**.

---

## 10. Build notes / guardrails

- Client-side only; no backend; **new** `dependent-care.js` + `dependent-care-2026.json`, reusing `paycheck-engine.js` primitives — do **not** shoehorn into `obbba-deduction.js`/`obbba-deductions-2026.json`. Consistent with the repo hard rules.
- **Compute both corners exactly** (Strategy A / B) rather than trusting a single break-even rate — the nonrefundable clamp, the $7,500-vs-$6,000 cap gap, and the post-FSA AGI feedback all bend the naive "p vs FSA rate" rule.
- **Disable the credit for MFS** and cap the FSA at $3,750; gate both benefits on the lower-earner income and on `employerFsaMax > 0`.
- Cross-link the paycheck / W-4 tools and the OBBBA family cluster; add the "related tools" overrides like the prior additions.
- Peaks at **open-enrollment (Oct–Dec)** — when people actually elect next year's FSA — and Jan–Apr tax season. Worth an evergreen "should I elect the FSA for next year?" explainer.
- Do not ship until a verify pass regenerates the §7 figures against the real engine, confirms the crossovers, and the OBBBA §-number in §6 is checked against the enrolled bill.
