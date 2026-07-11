# Charitable Deduction Calculator (OBBBA 2026) — Sourced Spec

**Tool slug (proposed):** `/charitable-deduction-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA calculators (tips / overtime / SALT / car-loan / senior).
**Prepared:** 2026-07-12. This is the **sixth** OBBBA provision, completing the cluster. It extends the existing `src/engine/obbba-deduction.js` and `src/data/obbba-deductions-2026.json` (new `federal.charitable` entry) — it does **not** create a parallel system.
**Primary sources:** every load-bearing number verified against the codified IRC at law.cornell.edu (§170, §170(b)(1)(I), §68, §62, §63) plus the enrolled statute P.L. 119-21. Secondary advisory sources used only for corroboration and worked examples.

---

## 0. Plain-language summary (read this first)

Starting in **tax year 2026**, the One Big Beautiful Bill Act changes charitable deductions in **three** ways at once, and they pull in opposite directions depending on whether you itemize:

1. **If you take the standard deduction (a non-itemizer):** you get a **new permanent deduction of up to $1,000 (single) / $2,000 (married filing jointly)** for **cash** gifts to public charities — on top of the standard deduction. Most Americans take the standard deduction, so this is the headline "you get something for donating now even if you don't itemize" change.
2. **If you itemize:** a **new 0.5%-of-AGI floor** kicks in — the **first 0.5% of your AGI** in charitable giving is **not deductible** at all; only the excess counts on Schedule A.
3. **If you itemize AND you're in the top (37%) bracket:** a **new limit caps the tax benefit of every itemized deduction at 35 cents per dollar** instead of 37 — via the "2/37 rule" in the resurrected IRC §68.

**The roadmap's framing was mostly right, with two real corrections (details in §2):**
- ✅ Amounts **$1,000 / $2,000**, the **0.5% floor**, the **35% cap**, and the **TY2026 effective date** are all **CONFIRMED**.
- ⚠️ **CORRECTION 1 — permanence.** Unlike tips/overtime/senior/car-loan (which sunset after 2028), all three charitable changes are **PERMANENT** (no sunset). The tool must NOT show a "2025–2028" window.
- ⚠️ **CORRECTION 2 — "above the line" is half-wrong.** The roadmap called the non-itemizer deduction "above-the-line," and most of the tax press says it "reduces AGI." **It does not reduce AGI.** Verified: IRC **§63(b)(4)** subtracts §170(p) *after* AGI (to compute a non-itemizer's taxable income); §170(p) is **not** in the §62(a) above-the-line list. It lowers **federal income tax** but **not AGI** — so it does **not** help with IRMAA, ACA subsidies, or Social-Security taxability. This matches how the existing `federal.carLoan` entry is already encoded (`reducesAgi: false`). The one true sense of "above the line" — *you don't have to itemize to get it* — holds.
- ⚠️ **CORRECTION 3 — the 35% cap is not charitable-specific.** It is a general limit on **all** itemized deductions for 37%-bracket filers (§68's "2/37 rule"), which happens to hit charitable too. Framing it as "a 35% cap on charitable" is imprecise.

**Confidence:** HIGH on all four verified figures and on the §63(b)(4) "does-not-reduce-AGI" finding (decided by the codified statute, not opinion). Two minor items flagged UNCERTAIN in §7 (OBBBA sub-section numbers; whether the 0.5% floor touches the §170(p) non-itemizer amount) — neither is load-bearing for the calculator's dollar outputs.

**Answer to "standalone or extension of the SALT tool?" (roadmap question 5):** **Standalone calculator, but it MUST reuse the SALT tool's itemize-vs-standard machinery.** Rationale in §5. Charitable and SALT are the two big Schedule A line items and both hinge on the same standard-vs-itemize decision — the charitable tool is essentially "the itemize-vs-standard engine, driven by a charitable-gift input, with a §170(p) branch for the standard-deduction side."

---

## 1. The three provisions, verified against the codified IRC

### 1.1 Non-itemizer deduction — IRC §170(p) (OBBBA §70424)

**Verbatim structural facts:**
- **Amount:** up to **$1,000** for single / HoH / MFS / qualifying surviving spouse; **$2,000** for MFJ. A hard dollar cap, **not indexed** to inflation.
- **Who:** only taxpayers who **do NOT elect to itemize** (§170(p) applies "in the case of an individual who does not elect to itemize"). Itemizers cannot use it (they deduct on Schedule A instead).
- **Cash only.** Cash/check/card gifts. **Non-cash** (appreciated securities, clothing, household goods, vehicles) does **NOT** qualify for §170(p).
- **Eligible donees:** §170(b)(1)(A) public charities ("50%-limit organizations"). **Excluded:** donor-advised funds, §509(a)(3) supporting organizations, and private non-operating foundations.
- **No carryforward.** Unused amounts (gift < cap, or cap exceeded) do not carry to future years.
- **Does NOT reduce AGI.** Codified at **§63(b)(4)** — "the deduction provided in section 170(p)" — which is subtracted from AGI to reach the *taxable income of a non-itemizer*, alongside §224 (tips), §225 (overtime), and §163(h)(4)(A) (car-loan interest). It is **not** in §62(a). Practical effect: same federal-income-tax reduction as an AGI-reducer, but **no** downstream AGI-cascade benefit (IRMAA / ACA / SS taxability / other AGI phase-outs).
- **Permanent**, effective for **taxable years beginning after December 31, 2025** (TY2026). OBBBA amended the *existing* §170(p) — it struck the old CARES-era $300/$600 figures, inserted $1,000/$2,000, and removed the sunset.

> **The §62 vs §63(b) test (this is why "reduces AGI" is wrong).** Cornell's §63(b) enumerates the subtractions a non-itemizer takes *after AGI* to reach taxable income, and paragraph (4) is literally "the deduction provided in section 170(p)." Cornell's §62(a) — the list of deductions that reduce gross income *to* AGI — contains **no** reference to §170 or §170(p). A deduction that reduces AGI must appear in §62(a). §170(p) does not. Therefore it does not reduce AGI. (The IRS/press "above-the-line" shorthand means "no itemizing required," which is true; it does not mean "reduces AGI," which is false.)

### 1.2 The 0.5%-of-AGI floor for itemizers — IRC §170(b)(1)(I) (OBBBA §70425)

**Verbatim (Cornell, §170(b)(1)(I)):**
> "Any charitable contribution otherwise allowable (without regard to this subparagraph) as a deduction under this section shall be allowed only to the extent that the aggregate of such contributions exceeds 0.5 percent of the taxpayer's contribution base for the taxable year."

- **Floor = 0.5% × contribution base.** "Contribution base" = **AGI** (technically AGI computed without any net operating loss carryback; = AGI for essentially every individual filer).
- **Mechanic:** the **first 0.5% of AGI** of charitable giving is **disallowed**; only the **excess** is deductible on Schedule A. Applies to the **aggregate** of contributions (cash and non-cash together), not per-gift.
- **Effective TY2026**, permanent.
- **Interaction with the AGI ceilings:** the pre-existing percentage ceilings (60% of AGI for cash to public charities — made permanent by OBBBA; 30%/20% for certain non-cash and appreciated property) still cap the *top*; the new 0.5% floor cuts the *bottom*. For ordinary donors the ceiling is non-binding; the floor is the new bite.
- **Carryover nuance (flag, likely out of calculator scope):** an amount disallowed *only* by the 0.5% floor generally does **not** carry forward — it is lost — **unless** the taxpayer also exceeds an AGI ceiling that year (then carryforward rules apply, with the floored amount added back to avoid "double-flooring"). Carryovers from **pre-2026** contributions are **not** subject to the floor when used in later years.

**Worked examples verified against primary/authoritative sources:**
| AGI | Gift (cash) | Floor (0.5%×AGI) | Deductible | Source |
|---|---|---|---|---|
| $175,000 | $2,500 | $875 | $1,625 | Bipartisan Policy Center, Example 2 |
| $200,000 | (any) | $1,000 | gift − $1,000 | Multiple (Instead / deductable.ai) |
| $500,000 | $20,000 | $2,500 | $17,500 | Holland & Knight worked example |
| $120,000 | $8,000 | $600 | $7,400 | National Tax Tools guide |

### 1.3 The 35% cap (2/37 rule) for top-bracket itemizers — IRC §68 (OBBBA §70111, reported)

**Verbatim (Cornell, §68):**
> "…the amount of the itemized deductions otherwise allowable for the taxable year (determined without regard to this section) shall be reduced by 2⁄37 of the lesser of— (1) such amount of itemized deductions, or (2) so much of the taxable income of the taxpayer for the taxable year (determined without regard to this section and increased by such amount of itemized deductions) as exceeds the dollar amount at which the 37 percent rate bracket under section 1 begins with respect to the taxpayer."
> Effective: "taxable years beginning after December 31, 2025."

- **Not charitable-specific.** §68 reduces **total itemized deductions** (charitable, SALT, mortgage interest, etc.) by **2/37 ≈ 5.4054%** of the **lesser of** (a) total itemized deductions or (b) taxable income above the 37%-bracket threshold.
- **Net effect at the top:** a dollar of itemized deduction that would have saved 37¢ now saves 37% × (1 − 2/37) = 37% × 35/37 = **35¢**. Hence "35% cap." Only bites in the **37% bracket** (2026 thresholds: **$640,600** single/HoH, **$768,700** MFJ — per `tax-data-2026.json`).
- **No carryforward** of amounts disallowed by §68.
- This is the resurrected/repurposed §68 (the section that once held the TCJA-repealed "Pease" limitation) — worth noting for anyone who remembers Pease; the mechanic is different (a flat 2/37 haircut, not 3% of AGI over a threshold).

---

## 2. Roadmap verdict (confirm / correct)

| Roadmap claim | Verdict | Note |
|---|---|---|
| $1,000 single / $2,000 MFJ non-itemizer deduction | ✅ CONFIRMED | §170(p); not indexed |
| "Above the line" (available to standard-deduction takers) | ⚠️ HALF-RIGHT | True: no itemizing needed. **False: it does NOT reduce AGI** (§63(b)(4), not §62). Fix the copy. |
| 0.5% of AGI floor before charitable counts (itemizers) | ✅ CONFIRMED | §170(b)(1)(I); floor = 0.5% × AGI; only excess deductible |
| 35% cap on the benefit at the top bracket | ✅ CONFIRMED (with nuance) | §68 "2/37 rule" — a **general** itemized-deduction limit, not charitable-only; 35¢/dollar in the 37% bracket |
| Effective TY2026 | ✅ CONFIRMED | All three; taxable years beginning after 2025-12-31 |
| (Implied) temporary like the other OBBBA deductions | ❌ WRONG | All three are **PERMANENT** — no 2028 sunset |

This is the fourth straight spec to catch a roadmap/consensus error: Roth catch-up (wrong threshold), bonus calc (stale Ohio rate), W-4 (Step 4c vs 4b), and now charitable ("reduces AGI" + "temporary"). The load-bearing correction here is the **AGI** one — state it plainly in the tool.

---

## 3. Proposed `federal.charitable` dataset entry

Match the rigor/shape of `federal.salt` / `federal.carLoan`. Drop this into `src/data/obbba-deductions-2026.json` under `federal`:

```jsonc
"charitable": {
  "statute": "IRC §170(p) non-itemizer deduction (OBBBA §70424); IRC §170(b)(1)(I) 0.5%-of-contribution-base floor for itemizers (OBBBA §70425); IRC §68 itemized-deduction limitation, the '2/37 rule' (OBBBA §70111, reported)",
  "firstYear": 2026,
  "permanent": true,
  "notIndexed": true,
  "nonItemizer": {
    "cap": { "single": 1000, "married": 2000, "head_of_household": 1000, "married_separate": 1000, "qss": 1000 },
    "cashOnly": true,
    "reducesAgi": false,
    "belowTheLine": true,
    "availableToNonItemizersOnly": true,
    "noCarryforward": true,
    "eligibleOrgs": "section 170(b)(1)(A) public charities (50%-limit orgs)",
    "excludedOrgs": ["donor_advised_funds", "private_non_operating_foundations", "section_509(a)(3)_supporting_orgs"]
  },
  "itemizerFloor": {
    "rate": 0.005,
    "base": "contribution_base_AGI",
    "appliesToCashAndNonCash": true,
    "preFloorCarryoversExempt": true,
    "floorDisallowedGenerallyNotCarriedForward": true
  },
  "topBracketCap": {
    "fractionNumerator": 2,
    "fractionDenominator": 37,
    "reductionRate": 0.0540540540540541,
    "effectiveBenefitRate": 0.35,
    "topMarginalRate": 0.37,
    "lesserOf": ["total_itemized_deductions", "taxable_income_over_37pct_threshold"],
    "topBracketThreshold2026": { "single": 640600, "married": 768700, "head_of_household": 640600 },
    "noCarryforward": true,
    "appliesToAllItemizedNotJustCharitable": true
  },
  "cashCeilingAgiPct": 0.60,
  "qualifies": "Three OBBBA charitable changes, all effective for tax years beginning after 2025-12-31 and all PERMANENT (no 2028 sunset). (1) Non-itemizers: a §170(p) deduction of up to $1,000 (single/HoH/MFS/QSS) or $2,000 (MFJ) for CASH gifts to §170(b)(1)(A) public charities — NOT donor-advised funds, §509(a)(3) supporting orgs, or private non-operating foundations; non-cash gifts do NOT qualify; no carryforward. Claimed via §63(b)(4), i.e. subtracted AFTER AGI to reach taxable income — it lowers federal income tax but does NOT reduce AGI (so no IRMAA/ACA/SS-taxability effect), same structure as tips/overtime/car-loan. (2) Itemizers: only charitable contributions exceeding 0.5% of the contribution base (AGI) are deductible on Schedule A (§170(b)(1)(I)); the first 0.5% of AGI is lost. (3) 37%-bracket itemizers: §68 reduces TOTAL itemized deductions (all of them, not just charitable) by 2/37 of the lesser of (total itemized) or (taxable income over the 37% threshold), capping the benefit at 35 cents per dollar. The pre-existing 60%-of-AGI ceiling on cash gifts to public charities was made permanent.",
  "sources": [
    {
      "claim": "IRC §170(p) as amended: $1,000/$2,000 non-itemizer deduction, cash only, §170(b)(1)(A) donees, excludes DAFs/509(a)(3)/private foundations, no carryforward; §170(b)(1)(I): only contributions exceeding 0.5% of contribution base are deductible.",
      "url": "https://www.law.cornell.edu/uscode/text/26/170"
    },
    {
      "claim": "IRC §63(b): taxable income of a non-itemizer = AGI minus the standard deduction, §199A, and the deductions provided in §170(p), §224, §225, and §163(h)(4)(A) — i.e. §170(p) is subtracted AFTER AGI and does NOT reduce AGI.",
      "url": "https://www.law.cornell.edu/uscode/text/26/63"
    },
    {
      "claim": "IRC §62(a) above-the-line list contains NO reference to §170 or §170(p) — confirming the non-itemizer charitable deduction is not an AGI-reducing adjustment.",
      "url": "https://www.law.cornell.edu/uscode/text/26/62"
    },
    {
      "claim": "IRC §68: itemized deductions reduced by 2/37 of the lesser of (itemized deductions) or (taxable income, determined without §68 and increased by itemized deductions, exceeding the 37% bracket start); effective for tax years beginning after 2025-12-31.",
      "url": "https://www.law.cornell.edu/uscode/text/26/68"
    },
    {
      "claim": "Enrolled statute of record: OBBBA §70424 (non-itemizer §170(p)), §70425 (0.5% floor §170(b)(1)(I)), §70111 (§68 limitation). Permanence and 2026 effective dates.",
      "url": "https://www.congress.gov/119/plaws/publ21/PLAW-119publ21.pdf"
    },
    {
      "claim": "0.5% floor mechanic + worked examples ($500k AGI/$20k gift → first $2,500 disallowed); floor-disallowed amounts generally not carried forward; 35% (2/37) cap not carried forward; 60% cash ceiling made permanent.",
      "url": "https://www.hklaw.com/en/insights/publications/2025/11/year-end-charitable-planning-big-changes-coming-for-2026"
    },
    {
      "claim": "Non-itemizer deduction is CASH ONLY to public charities, excludes DAFs and private foundations, no carryforward; above-the-line 'in addition to the standard deduction' (i.e. no itemizing required).",
      "url": "https://www.taftlaw.com/news-events/law-bulletins/charitable-giving-after-the-obbba-the-2026-outlook/"
    },
    {
      "claim": "0.5% floor worked example ($175k AGI/$2,500 gift → deduct $1,625) and how the two floors work; both provisions effective 2026.",
      "url": "https://bipartisanpolicy.org/issue-brief/how-the-new-charitable-deduction-floors-work/"
    },
    {
      "claim": "2/37 = 5.4054% reduction; effective 35 cents/dollar for 37%-bracket filers; worked numeric example.",
      "url": "https://www.gunster.com/newsroom/publications/the-new-2-37-rule-and-how-it-will-affect-your-taxes"
    }
  ]
}
```

**Note for the state-conformity layer (out of scope for v1):** the existing `states` block tracks tips/overtime conformity only. State treatment of the federal charitable changes is a separate, later question — do not fabricate per-state charitable rows now.

---

## 4. Calculator mechanics

The calculator's job: given a charitable gift + AGI + filing status (+ optional other itemized deductions), tell the user **how much of the gift is deductible, how much federal tax it saves, and whether they should take the standard deduction (with the §170(p) bonus) or itemize (subject to the 0.5% floor and, at the top, the 35% cap).**

### 4.1 Inputs

| Input | Type | Notes |
|---|---|---|
| `filingStatus` | select | `single` / `married` (MFJ) / `head_of_household`. MFS gets the **$1,000** non-itemizer cap and its own floor/cap — offer it or note "MFS = same as single here." |
| `agi` | number | Adjusted gross income. Drives the 0.5% floor, the 60% ceiling, and the bracket/marginal-rate lookup. Label "your AGI (roughly your total income)." |
| `cashGift` | number | Cash gifts to **public charities** (the main input). Only this counts for the §170(p) non-itemizer deduction. |
| `nonCashGift` | number (optional/advanced) | Appreciated stock, goods, etc. Counts toward the itemized total (subject to the floor and 30%/20% ceilings) but **never** toward §170(p). Default 0. |
| `otherItemized` | number (optional) | Non-charitable Schedule A items (SALT **after its own cap**, mortgage interest, medical over the floor). Needed for the itemize-vs-standard verdict. Default 0. Offer a "pull from the SALT calculator" hand-off. |
| `year` | fixed 2026+ | Provision starts 2026; no 2025 path, no sunset. Default 2026. |

Do **not** ask for a manual "marginal rate" — derive it from `agi` + the 2026 brackets (human-friendly rule; one obvious way to enter each value).

### 4.2 Core computation

```
// --- Non-itemizer branch (standard-deduction world) ---
p170Cap        = charitable.nonItemizer.cap[filingStatus]        // 1000 / 2000
nonItemizerDed = min(cashGift, p170Cap)                          // cash only; non-cash & DAF excluded
stdWorldDeduction = standardDeduction[year][filingStatus] + nonItemizerDed

// --- Itemizer branch (Schedule A world) ---
floor           = 0.005 * agi                                    // §170(b)(1)(I)
totalGift       = cashGift + nonCashGift
// (optional refinement: apply 60%/30% AGI ceilings before the floor; usually non-binding)
charDeductible  = max(0, totalGift - floor)                      // only the excess counts
itemizedTotal   = charDeductible + otherItemized

// --- §68 top-bracket 2/37 haircut (only if 37% bracket) ---
topThreshold    = topBracketThreshold2026[filingStatus]          // 640600 / 768700
taxableNoS68    = max(0, agi - itemizedTotal)
if (taxableNoS68 + itemizedTotal) > topThreshold:               // "increased by itemized deductions"
    excess    = (taxableNoS68 + itemizedTotal) - topThreshold
    s68cut    = (2/37) * min(itemizedTotal, excess)
    itemizedAllowed = itemizedTotal - s68cut                     // benefit effectively ≤35¢/$
else:
    itemizedAllowed = itemizedTotal

// --- itemize vs standard verdict (REUSE the SALT tool's comparison) ---
itemize   = itemizedAllowed > stdWorldDeduction
bestDed   = max(itemizedAllowed, stdWorldDeduction)

// --- tax saved: exact bracket-diff (reuse federalTaxSaved / saltComparison machinery) ---
taxWithNoCharity = tax(agi - baselineDeduction)                  // baseline = std ded, no charity
taxWithCharity   = tax(agi - bestDed)
taxSaved         = taxWithNoCharity - taxWithCharity
```

**Precision points:**
- The **§170(p) deduction and the resulting federal income tax saved are identical whether or not it reduces AGI** — both remove the same dollars from taxable income. So the "does not reduce AGI" correction does **not** change the tool's headline dollar output; it only forbids the tool from *claiming* IRMAA/ACA/SS-taxability benefits. Keep the math; fix the prose.
- The **§68 haircut applies to the whole itemized total, not just charitable.** The tool can honestly present it as "in the 37% bracket, each deductible dollar (charitable included) is worth 35¢, not 37¢." If `otherItemized` is unknown, still model it on the charitable portion and label the top-bracket result "approximate — the 2/37 reduction depends on your full Schedule A."
- Use the **exact bracket-diff** method already in `federalTaxSaved` / `saltComparison`, not a flat marginal-rate multiply, so bracket crossings are exact.

### 4.3 Outputs

1. **Deductible amount** — non-itemizer `nonItemizerDed` (if taking standard) **or** `charDeductible` after the floor (if itemizing), whichever world wins.
2. **Amount lost to the floor** (itemizer) = `min(totalGift, floor)`, with plain copy: "the first $X of your giving isn't deductible."
3. **Federal tax saved** = exact bracket-diff, plus the effective rate (flag "capped at 35%" when §68 bites).
4. **Verdict: standard vs itemize** — which is better and by how much (reuse the SALT tool's `itemize` / `bestNew` verdict).
5. **Caveats row:** does NOT reduce AGI (no IRMAA/ACA effect); state treatment separate; cash-only for the non-itemizer deduction; DAF/private-foundation cash excluded from §170(p).

### 4.4 Constants

None new beyond the `federal.charitable` entry (§3) and the 2026 standard-deduction + bracket tables already in `tax-data-2026.json` / `federal.salt.standardDeductionByYear`. The 37%-bracket thresholds are already derivable from the existing brackets.

---

## 5. Reuse assessment + standalone-vs-extension answer (roadmap question 5)

**Verdict: build a STANDALONE `/charitable-deduction-calculator/` that reuses the SALT tool's itemize-vs-standard engine.** Not folded into the SALT page; not a wholly separate framework.

Why standalone (matches the cluster): each OBBBA provision already gets its own calculator + slug + embed; charitable is the sixth and users search "charitable deduction calculator," not "SALT." Why it must reuse the SALT engine: the charitable decision **is** an itemize-vs-standard decision, and `saltComparison()` already encodes exactly that (standard-deduction table by year/status, itemized total, `itemize` verdict, exact bracket-diff tax saved). Charitable is simply another input into the same comparison — plus a §170(p) branch on the standard-deduction side that SALT doesn't have.

**Reused from `src/engine/obbba-deduction.js` + data (≈80%):**
- `federalTaxSaved(grossAnnual, filingStatus, deduction, fed)` — exact bracket-diff, unchanged.
- The `saltComparison()` standard-vs-itemized skeleton (standard deduction by year/status; `itemize`/`bestNew`; the `SALT_BRACKET_STATUS` MFS→single mapping) — pattern reused; charitable adds the floor, the §170(p) branch, and the §68 haircut.
- `pick(map, filingStatus)` and `saltStatusAmount` helpers for status-keyed lookups.

**New logic (small):**
- `charitableFloor(agi) = 0.005 * agi` and `charDeductible = max(0, gift − floor)`.
- `nonItemizerCharitable(cashGift, filingStatus) = min(cashGift, cap)`.
- `section68Haircut({agi, itemizedTotal, filingStatus, params})` — the 2/37 reduction (37%-bracket only).
- A `charitableComparison({year, filingStatus, agi, cashGift, nonCashGift, otherItemized, params, fed})` orchestrator returning `{nonItemizerDed, floor, charDeductible, itemizedTotal, itemizedAllowed, s68cut, itemize, bestDed, taxSaved, effectiveRate, notes}` — mirrors `saltComparison`'s return shape.

No new tax constants beyond `federal.charitable`, no backend, pure client-side — consistent with the repo hard rules. **Cross-link tightly with `/salt-cap-calculator/`** (they share Schedule A; a user itemizing for SALT is exactly who the floor and 35% cap hit) and with the other four OBBBA tools.

---

## 6. Myth-bust / framing block (site style)

- **"You don't have to itemize to get a tax break for donating anymore."** The headline: standard-deduction takers get up to **$1,000 ($2,000 MFJ)** for **cash** gifts, on top of the standard deduction. True, verified, and the reason the tool exists.
- **"But it's cash only — dropping off clothes doesn't count."** The $1,000/$2,000 non-itemizer deduction is **cash to a public charity**. Non-cash gifts (goods, stock) and gifts to **donor-advised funds** or **private foundations** do **not** qualify.
- **"'Above the line' does NOT mean it lowers your AGI."** This is the big one, and most articles get it wrong. §170(p) is subtracted **after** AGI (IRC §63(b)(4)), so it cuts your **federal income tax** but **not your AGI** — it will **not** lower your Medicare IRMAA, your ACA premium subsidy, or how much of your Social Security is taxed. "No itemizing required" ≠ "reduces AGI."
- **"If you itemize, your first 0.5% of AGI in giving is now worth nothing."** New 2026 floor: on a $200,000 AGI, the first **$1,000** of charitable giving is not deductible; only the excess counts. Small itemized gifts can now yield **$0**.
- **"The 35% 'cap' isn't a cap on your donation — it's a haircut on every itemized deduction if you're in the top bracket."** A 37%-bracket donor's deduction is worth **35¢**, not 37¢, per dollar (the §68 "2/37 rule"). It applies to SALT and mortgage interest too, not just charity.
- **"These changes are permanent."** Unlike no-tax-on-tips/overtime (which end after 2028), the charitable changes have **no sunset** — plan accordingly.
- **Planning nudge (optional):** because of the floor and the loss of the deduction below it, **bunching** two years of giving into one (to clear the floor and beat the standard deduction) is now more valuable. Mention, don't over-engineer.

---

## 7. Flagged uncertainties (none load-bearing for the dollar outputs)

- **UNCERTAIN — OBBBA sub-section numbers.** IRC sections are verbatim-verified (§170(p), §170(b)(1)(I), §68, §63(b)(4), §62(a)). The **OBBBA** section labels — §70424 (non-itemizer), §70425 (floor), §70111 (§68 cap) — come from secondary sources and one rendered the cap as "10111" (likely a typo). Cite the **IRC** sections as primary; verify the OBBBA §-numbers against the enrolled P.L. 119-21 before printing them. Does not affect any computation.
- **UNCERTAIN — does the 0.5% floor also clip the §170(p) non-itemizer amount?** The prevailing reading: **no** — the floor (§170(b)(1)(I)) governs the *itemized* charitable deduction; the non-itemizer §170(p) allowance is a separate flat cap with no floor. The calculator assumes the full $1,000/$2,000 for non-itemizers. Flag as a minor open item pending the IRS 2026 Form 1040 / Schedule A instructions; if the final forms apply the floor to §170(p), add `floorAppliesToNonItemizer: true` and subtract `0.005*agi` from `nonItemizerDed`.
- **NOT MODELED (v1) — AGI ceilings (60%/30%/20%) and floor↔ceiling carryforward interaction.** Non-binding for typical gifts; the floor is the new bite. If `cashGift > 0.60*agi` (very large gifts), surface a "your gift exceeds the 60%-of-AGI cash ceiling; the excess carries forward" note rather than silently over-deducting.
- **NOT MODELED (v1) — state conformity.** Federal-only, like the sibling tools; do not invent per-state charitable rows.

---

## 8. Test fixtures (10 cases)

Amounts below are the **statutory deduction outputs** (load-bearing, hand-computed against the verified rules). `taxSaved` is a marginal-rate estimate for orientation; **at build time, regenerate every `taxSaved` with the exact bracket-diff engine** (`federalTaxSaved` / `charitableComparison`) against 2026 brackets + standard deductions (single $16,100 / MFJ $32,200 / HoH $24,150) and lock the values, exactly as the W-4 and SALT specs did. Coverage: non-itemizer under/at/over cap (C1–C3), itemize-wins with floor (C4), floor fully binding (C5), floor partially binding — BPC example (C6), 35% cap in the 37% bracket (C7), $0 edge (C8), non-cash ineligible (C9), DAF excluded (C10).

| # | Scenario | Status | AGI | Cash gift | Other itemized | Floor (0.5%×AGI) | §170(p) non-itemizer | Itemized charitable (after floor) | Verdict | Charitable federal tax saved (est.) |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Non-itemizer, under cap | single | 60,000 | 600 | 0 | 300 | **600** | 300 | **Standard** (16,100+600) | ≈ 12% × 600 = **$72** |
| C2 | Non-itemizer, cap binds | single | 80,000 | 3,000 | 0 | 400 | **1,000** (cap) | 2,600 | **Standard** (16,100+1,000) | ≈ 22% × 1,000 = **$220** |
| C3 | Non-itemizer, cap binds (MFJ) | married | 120,000 | 2,500 | 0 | 600 | **2,000** (cap) | 1,900 | **Standard** (32,200+2,000) | ≈ 12% × 2,000 = **$240** |
| C4 | Itemizer wins (SALT+mortgage) | married | 250,000 | 20,000 | 30,000 | 1,250 | (n/a — itemizes) | **18,750** | **Itemize** (48,750 > 34,200) | ≈ 22% × 18,750 = **$4,125** |
| C5 | Floor fully binds | single | 200,000 | 1,000 | 18,000 | 1,000 | 1,000 if standard | **0** (1,000−1,000) | **Itemize** (18,000 > 17,100); gift adds **$0** | **$0** marginal (floor eats it) |
| C6 | Floor partially binds (BPC) | single | 175,000 | 2,500 | 20,000 | 875 | (n/a — itemizes) | **1,625** | **Itemize** (21,625 > 16,100) | ≈ 24% × 1,625 = **$390** |
| C7 | 35% cap binds (top bracket) | married | 2,000,000 | 500,000 | 50,000 | 10,000 | (n/a) | **490,000** | **Itemize**; §68 haircut applies | 37%→**35%**: 490,000 × 35% = **$171,500** (vs $181,300; **−$9,800** from cap) |
| C8 | $0 contribution edge | single | 50,000 | 0 | 0 | 250 | **0** | 0 | **Standard**; no charity effect | **$0** |
| C9 | Non-cash gift, not §170(p) eligible | married | 90,000 | 0 (non-cash 2,000) | 0 | 450 | **0** (non-cash) | 1,550 | **Standard** (32,200 > 1,550); gift yields **$0** | **$0** |
| C10 | Cash to a DAF (excluded) | single | 70,000 | 1,000 (to DAF) | 0 | 350 | **0** (DAF excluded) | 650 | **Standard**; gift yields **$0** for §170(p) | **$0** |

**Load-bearing notes:**
- **C2/C3 (cap):** the §170(p) cap ($1,000 / $2,000) binds; cash above the cap gives no extra non-itemizer benefit. Verifies `min(cashGift, cap)`.
- **C5 (floor fully binds):** floor ($1,000) ≥ gift ($1,000) → itemized charitable = **$0**. The filer itemizes anyway on SALT+mortgage ($18,000 > standard $16,100 and > standard+$170(p) $17,100), so the $1,000 gift produces **$0** marginal benefit in either world. The sharpest floor demonstration.
- **C6 (floor partially binds):** reproduces the Bipartisan Policy Center example exactly — $175k AGI, $2,500 gift, floor $875 → **$1,625** deductible. This fixture double-checks the floor formula against a published primary example.
- **C7 (§68 / 35% cap):** taxable income far exceeds the MFJ 37% threshold ($768,700). §68 reduction = 2/37 × min(itemized $540,000, excess) = 2/37 × 540,000 = **$29,189**; benefit rate = 37% × 35/37 = **35%**. Charitable slice: $490,000 × 35% = **$171,500** vs $181,300 uncapped → **−$9,800**. Verifies the 2/37 haircut and the 35¢/dollar result. (60%-AGI cash ceiling = $1.2M ≥ $490k → not binding.)
- **C8 ($0):** no gift → `nonItemizerDed = 0`, `charDeductible = 0`, no error, floor shown but not applied to a negative. Guards the empty/edge path.
- **C9 (non-cash):** a $2,000 clothing/goods gift → **$0** for §170(p) (cash only). Itemizing: after floor, $1,550 < standard $32,200 → standard wins, and §170(p) is $0 because non-cash. Net **$0** federal benefit. (Verify the verdict arithmetic at build: standard $32,200 vs itemized $1,550 → standard; §170(p) $0.) Teaches "non-cash ≠ the new $2,000 deduction."
- **C10 (DAF):** cash to a donor-advised fund is **excluded** from §170(p) → **$0** non-itemizer deduction. Teaches the DAF/private-foundation exclusion.

Add unit tests for: the floor at several AGIs (0.5% exact); the §170(p) cap by status; the §68 haircut only firing in the 37% bracket (a $700k-taxable single just under $640,600 → no haircut; just over → 2/37 fires); and the itemize-vs-standard flip point.

---

## 9. Build notes / guardrails

- Client-side only; no backend; extend `obbba-deduction.js` + `obbba-deductions-2026.json` (new `federal.charitable`) — do **not** fork a parallel engine. Consistent with the repo hard rules.
- **Fix the prose, keep the math:** the tool's dollar outputs are correct regardless of the AGI debate, but the copy must say "reduces your federal income tax" and must **not** claim it lowers AGI / IRMAA / ACA / Social-Security taxability.
- Cross-link `/salt-cap-calculator/` (shared Schedule A + the same itemize-vs-standard decision), and the other OBBBA tools; add the "related tools" overrides like the prior OBBBA additions.
- Peaks at Nov–Dec giving season and Jan–Apr tax season — worth an evergreen "bunching" explainer.
- Do not ship until a verify pass regenerates the §8 `taxSaved` figures against the real engine and confirms the itemize-vs-standard verdicts, and until the OBBBA §-numbers in §7 are checked against the enrolled bill.
```
