# Adoption Tax Credit Calculator 2025/2026 — Sourced Spec

**Tool slug (proposed):** `/adoption-credit-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA cluster (ABLE spec format).
**Prepared:** 2026-07-13.
**Time-sensitivity:** fable's 2026-07-13 SERP check found `financial-advisors-for-families.com/adoption-financial-planning/` already ranking with correct 2026 figures ($17,670 / $5,120 / $265,080–$305,080) and a calculator **mockup** (labeled inputs, no working JS as of 2026-07-13, re-verified during this research). First working, correctly-modeled calculator takes the slot. Build fast, but the model below is where we win — their static "$5,120 refundable + $12,550 nonrefundable" framing is wrong for most real inputs (see §6).
**Primary sources:** every load-bearing number verified against **P.L. 119-21 (OBBBA) §§70402–70403** (govinfo HTML of the enrolled law, verbatim), **26 U.S.C. §23** and **§137** (current text, Cornell LII), **Rev. Proc. 2025-32 §§4.04, 4.18** (read directly from the irs.gov PDF via pdftotext), and the **2025 Form 8839 + 2025 Instructions for Form 8839** (both PDFs read directly from irs.gov). Secondary sources used only for the 2010–2011 refundability history (CRS R44745, Tax Policy Center, IRS Notice 2010-66).

---

## 0. Plain-language summary (read this first)

OBBBA (P.L. 119-21, July 4, 2025) §70402 made part of the federal adoption credit (IRC §23) **refundable starting TY2025** — the first **permanent** refundable component in the credit's history. The mechanism is a recharacterization, not a new credit: new **§23(a)(4)** treats the first dollars of each year's allowed credit (up to **$5,000 in 2025, $5,120 in 2026**, indexed) as a subpart C refundable credit; the remainder stays nonrefundable with the existing 5-year carryforward.

The five facts most SERP pages (and probably the competitor's eventual JS) will fumble:

1. **The refundable amount is NOT a fixed $5,120.** It is `min(allowed credit, $5,120)` computed **per child**, after the expense cap and MAGI phaseout. A family with $4,000 of expenses gets a $4,000 fully refundable credit — even with $0 tax liability.
2. **The refundable cap is per child, per year.** Two children can yield $10,240 of refundable credit on one return (2025 Instructions: "The refundable credit amount is determined per eligible child"). And a second year of expenses for the same child gets a fresh refundable slice.
3. **"Refundable for the first time ever" is false.** The ACA (P.L. 111-148 §10909) made the credit **fully** refundable for 2010–2011 only (temporarily redesignated §36C); it reverted to nonrefundable for 2012–2024. OBBBA is the first *partial* and first *permanent* refundability. Precise copy: "refundable for the first time since 2011 — and permanently for the first time."
4. **Only the nonrefundable remainder carries forward** (up to 5 years, FIFO). OBBBA §70402(c) amended §23(c)(1) specifically to exclude the refundable portion from the carryforward, and pre-2025 carryforwards stay nonrefundable forever ("Unused nonrefundable credit can't be turned into a refundable credit in a future year").
5. **Special-needs adoptions get the full $17,670 with zero expenses** (state **or, new under OBBBA §70403, Indian tribal government** determination) — deemed-expense rule, §23(a)(3), in the year the adoption becomes final.

TY2026 parameters (Rev. Proc. 2025-32, read from the PDF): cap **$17,670** per child (credit and the separate §137 employer exclusion), refundable portion **$5,120**, MAGI phaseout **> $265,080**, fully gone at **$305,080** (fixed $40,000 range). OBBBA did **not** change the phaseout structure — prior law + normal inflation indexing.

**Confidence:** HIGH on all dollar figures (read directly from Rev. Proc. 2025-32 and the 2025 Form 8839), the §23(a)(4) mechanism, the per-child refundable computation, the carryforward exclusion, and the special-needs rule. Open items are annual-figure freshness and 2026-form line placement (§7), not mechanics.

---

## 1. Primary-source facts (verified, quoted)

### 1.1 The OBBBA amendment — P.L. 119-21 §70402 (139 Stat. 213–214), verbatim from govinfo

- **§70402(a)** adds §23(a)(4): *"Portion of credit refundable.—So much of the credit allowed under paragraph (1) as does not exceed $5,000 shall be treated as a credit allowed under subpart C and not as a credit allowed under this subpart."*
  - Subpart C = refundable credits. This is a **recharacterization of the first dollars of the allowed §23 credit**, not a separate credit and not a slice of the first $5,000 of *expenses*. It applies after the dollar cap and MAGI phaseout.
- **§70402(b)** rewrites §23(h) (inflation): amounts in §23(a)(3), (a)(4), (b)(1) and (b)(2)(A)(i) are indexed; *"Rounding.—If any amount as increased under paragraph (1) is not a multiple of $10, such amount shall be rounded to the nearest multiple of $10."* Special rule §23(h)(3) for the (a)(4) amount: indexing applies to taxable years beginning after **December 31, 2025**, with **calendar year 2024** as the COLA base year → **$5,000 flat for TY2025** (no indexing), **$5,120 for TY2026** (first indexed year, confirmed in Rev. Proc. 2025-32).
- **§70402(c)** amends §23(c)(1) *"by striking 'credit allowable under subsection (a)' and inserting 'portion of the credit allowable under subsection (a) which is allowed under this subpart'"* — i.e., the carryforward is computed only on the **nonrefundable** portion. The refundable portion is paid out regardless of liability, so nothing of it can carry.
- **§70402(d)** effective date: *"taxable years beginning after December 31, 2024"* (TY2025).
- **§70403** (same effective date): amends §23(d)(3)(A)/(B) to insert **"or Indian tribal government"** after "a State" — tribal special-needs determinations now count. Flows through to §137 as well, because §137(d) defines qualified adoption expenses by cross-reference to §23(d).

### 1.2 TY2026 dollar figures — Rev. Proc. 2025-32 §4.04 and §4.18 (read directly from `irs.gov/pub/irs-drop/rp-25-32.pdf`)

- **§4.04(1)** (special needs): *"For taxable years beginning in 2026, under § 23(a)(3), the credit allowed for an adoption of a child with special needs is **$17,670**."*
- **§4.04(2)** (limit + phaseout): *"under § 23(b)(1), the maximum credit allowed for other adoptions is the amount of qualified adoption expenses up to **$17,670**. The available adoption credit begins to phase out under § 23(b)(2)(A) for taxpayers with modified adjusted gross income in excess of **$265,080** and is completely phased out for taxpayers with modified adjusted gross income of **$305,080** or more."*
- **§4.04(3)** (refundable): *"the amount used in § 23(a)(4) to determine the amount of the credit under § 23 that may be refundable is **$5,120**."*
- **§4.18** (§137 employer exclusion): special-needs exclusion **$17,670**; maximum exclusion **$17,670**; phaseout **> $265,080** to **$305,080** — identical thresholds to the credit.
- Scout note's figures ($17,670 / $5,120) **confirmed** against the primary source, not just carried forward.

### 1.3 TY2025 dollar figures — 2025 Form 8839 + Instructions (read directly from irs.gov PDFs)

- Cap **$17,280** per child (form line 2); refundable **$5,000** (form line 11b: *"Enter the smaller of the amount on line 11a or $5,000"*); phaseout **> $259,190**, gone at **$299,190** (form lines 8–9: subtract $259,190, divide by $40,000); §137 exclusion **$17,280** (line 19). Consistent with Rev. Proc. 2024-40.

### 1.4 Statutory mechanics — 26 U.S.C. §23 (current text, Cornell LII)

- **(a)(1)** allowance: credit = qualified adoption expenses (QAE) paid or incurred.
- **(a)(2)** timing: expenses paid *before* the year the adoption becomes final are allowed *"for the taxable year following the taxable year during which such expense is paid or incurred."*
- **(a)(3)** special needs: in the year a special-needs adoption becomes final, taxpayer is *"treated as having paid"* QAE equal to the excess of the cap ($17,670 in 2026) over aggregate QAE actually paid in that year and all prior years → full cap regardless of actual expenses.
- **(b)(1)** dollar limitation: *"aggregate … for all taxable years with respect to the adoption of a child"* — a **per-child cumulative cap across years**, not per-year (implemented as Form 8839 line 3, prior-year claims reduce the current cap).
- **(b)(2)(A)** phaseout: credit reduced by `credit × (MAGI − threshold) / $40,000`. The $40,000 denominator is **not indexed** (only the threshold, §23(h)(1) covers (b)(2)(A)(i)); verified: $305,080 − $265,080 = $40,000.
- **(b)(2)(B)** MAGI: AGI *"determined without regard to sections 911, 931, and 933"* (foreign earned income / possessions exclusions added back). 2025 Instructions operationalize: Form 1040 AGI + Puerto Rico exclusion + Form 2555 lines 45 & 50 + Form 4563 line 15.
- **(b)(3)** denial of double benefit: no credit for expenses for which any other deduction/credit is allowed, or *"to the extent that funds for such expense are received under any Federal, State, or local program."*
- **(c)(1)** carryforward (as amended): *"If the portion of the credit allowable under subsection (a) **which is allowed under this subpart** for any taxable year exceeds the limitation imposed by section 26(a) … such excess shall be carried to the succeeding taxable year …"*
- **(c)(2)**: *"No credit may be carried forward under this subsection to any taxable year following the **fifth taxable year** after the taxable year in which the credit arose"* — FIFO ordering.
- **(d)(1)** QAE: *"reasonable and necessary adoption fees, court costs, attorney fees, and other expenses"* directly related to the legal adoption of an eligible child; **excluding** expenses (i) in violation of state/federal law, (ii) for carrying out a **surrogate parenting arrangement**, (iii) for adopting **the child of the taxpayer's spouse**, and (iv) **reimbursed** under an employer program or otherwise.
- **(d)(2)** eligible child: under 18, or physically/mentally incapable of self-care.
- **(d)(3)** special needs: state **or Indian tribal government** determines the child cannot/should not return to parents' home and has a specific factor/condition making placement without assistance unreasonable; child must be a US citizen or resident.
- **(e)** foreign adoptions: no credit unless the adoption **becomes final**; pre-finality expenses are treated as paid in the year of finality.
- **(f)** filing: rules similar to §21(e)(2)–(4) → **married must file jointly**, with the lived-apart exception (2025 Instructions: lived apart from spouse the last 6 months of the year + child lived in your home more than half the year + you paid more than half the cost of keeping up the home). Also §23(f)(2): child's name, age, TIN required on the return. MFS carryforward exception: a person filing separately may claim a **carryforward** if a joint return was filed in the year the expenses first became allowable.

### 1.5 Form 8839 (2025) computation flow — the engine's blueprint

Per child (columns): line 2 = $17,280 cap → line 3 = prior-year QAE claimed for same child (lines 3+6 of last filed 8839) → line 4 = 2−3 → line 5 = QAE (or, special needs final this year: **cap − line 3, "even if you didn't have any qualified adoption expenses"**) → line 6 = min(4,5) → line 7 = MAGI → lines 8–9 = phaseout ratio (excess over threshold ÷ $40,000, *"rounded to at least three places,"* max 1.000) → line 10 = 6 × ratio → **line 11a = 6 − 10** (allowed credit per child) → **line 11b = min(11a, $5,000)** (refundable, per child) → line 11c = Σ11b → **line 13 = refundable adoption credit → Form 1040 line 30**. Then line 12 = Σ11a → **line 14 = 12 − 13** (nonrefundable current-year) → line 15 = prior-year carryforward → line 16 = 14+15 → line 17 = Credit Limit Worksheet (tax-liability limit) → **line 18 = min(16,17) → Schedule 3 line 6c**; excess of 16 over 17 → Carryforward Worksheet (tracks vintages 2020–2025; 5-year FIFO expiry).

**IRS worked example (2025 Instructions, line 18), verbatim in substance:** $20,000 QAE paid, adoption final 2025, cap $17,280. Result: *"You claim a $5,000 refundable adoption credit … You claim a $10,000 nonrefundable adoption credit … The remaining $2,280 … ($17,280 − $10,000 − $5,000) can be carried forward as a nonrefundable adoption credit to the next five years or until used … You can't claim any of the $2,280 carryforward as a refundable adoption credit … The remaining $2,720 of qualified adoption expenses ($20,000 − $17,280) may never be claimed as a credit."* → Fixture F3.

**Timing tables (2025 Instructions):**

| When paid | Domestic — claim in | Foreign — claim in |
|---|---|---|
| Any year before finality | the year **after** payment | the year the adoption becomes **final** |
| Year of finality | that year | that year |
| After finality | year of payment | year of payment |

Unsuccessful **domestic** attempts still qualify (treated as not-final-by-year-end → claim the following year); unsuccessful foreign adoptions never qualify (finality required).

### 1.6 Employer-provided adoption assistance — IRC §137 + Form 8839 Part III

- **§137(a)(1)**: employer payments for QAE under a written **adoption assistance program** are excluded from the employee's gross income; **(a)(2)** special-needs deeming mirrors §23(a)(3) (full exclusion in the finality year regardless of actual expenses — but Form 8839 line 24 requires that *"your employer has a qualified adoption assistance program … whether or not you received any employer-provided adoption benefits"*).
- **(b)(1)** aggregate per-child limit ($17,670 in 2026); **(b)(2)** same phaseout; **(b)(3)** MAGI for the exclusion is computed *"without regard to this section"* → the excluded benefits themselves are **added back** (plus §§911/931/933 etc.) — the exclusion's MAGI ≠ the credit's MAGI.
- **(c)**: must be a *"separate written plan"* meeting §127(b)-style requirements. S-corp >2% shareholders can't exclude (2025 Instructions caution).
- **(d)**: QAE *"has the meaning given such term by section 23(d)"* — so all §23 exclusions (surrogacy, spouse's child, etc.) and the §70403 tribal change apply.
- **Coordination (no double-dip):** 2025 Instructions, verbatim: *"you can't claim both a credit and exclusion for the same expenses"*; *"Expenses reimbursed by your employer under a written qualified adoption assistance program aren't qualified adoption expenses and must not be entered on line 5."* Part III must be completed **before** Part II. The two $17,670 caps are **separate** — a family with enough expenses can max both.
- Two unmarried adopters of the same child must **split** each cap between them in any agreed proportion (lines 2/19 instructions).

---

## 2. Parameter table (engine constants, by tax year)

| Parameter | TY2025 | TY2026 | Source |
|---|---|---|---|
| Max credit / per-child cumulative expense cap (§23(b)(1)) | $17,280 | $17,670 | 2025 Form 8839 line 2; RP 2025-32 §4.04(2) |
| Special-needs deemed amount (§23(a)(3)) | $17,280 | $17,670 | 2025 Instr. line 5; RP 2025-32 §4.04(1) |
| Refundable portion cap, **per child** (§23(a)(4)) | $5,000 (flat, unindexed) | $5,120 (first indexed year, 2024 base) | P.L. 119-21 §70402(a),(b); 2025 form line 11b; RP 2025-32 §4.04(3) |
| MAGI phaseout start (exceeds) (§23(b)(2)(A)) | $259,190 | $265,080 | 2025 form line 8; RP 2025-32 §4.04(2) |
| MAGI full phaseout (at or above) | $299,190 | $305,080 | 2025 Instr. income-limit table; RP 2025-32 §4.04(2) |
| Phaseout range (fixed, not indexed) | $40,000 | $40,000 | §23(b)(2)(A); 2025 form line 9 |
| §137 employer exclusion cap (same phaseout) | $17,280 | $17,670 | 2025 form line 19; RP 2025-32 §4.18 |
| Carryforward | nonrefundable portion only, 5 years, FIFO | same | §23(c) as amended by §70402(c) |

---

## 3. Formula (engine spec)

Inputs: `taxYear` (2025|2026), per child: `{ qae, specialNeedsFinalThisYear, priorYearClaimed }`, plus `magi`, `taxLiabilityForNonrefundableCredits`, `carryforwardIn` (array of `{yearArose, amount}`), optional employer-benefit inputs for the §137 panel.

```
P = params[taxYear]

// phaseout ratio — shared by all children (and by the §137 exclusion, with its own MAGI)
excess = max(0, magi - P.phaseoutStart)          // "in excess of" ⇒ strictly greater
ratio  = min(1, excess / 40000)                   // engine uses exact ratio; form allows ≥3 decimals

per child i:
  capRemaining_i = max(0, P.cap - priorYearClaimed_i)                    // lines 2-4
  qae_i          = specialNeedsFinalThisYear_i ? capRemaining_i          // line 5 deeming
                                               : min(qae_i_input, ∞)     // net of employer reimbursements, timing-eligible
  base_i         = min(capRemaining_i, qae_i)                            // line 6
  allowed_i      = base_i - base_i * ratio                               // lines 10-11a
  refundable_i   = min(allowed_i, P.refundableCap)                       // line 11b — PER CHILD

refundableTotal      = Σ refundable_i                                    // lines 11c/13 → paid regardless of liability
nonrefundableCurrent = Σ allowed_i - refundableTotal                     // lines 12/14
pool                 = nonrefundableCurrent + Σ carryforwardIn           // lines 15-16
nonrefundableUsed    = min(pool, taxLiabilityForNonrefundableCredits)    // lines 17-18
carryforwardOut      = pool - nonrefundableUsed
  // consume FIFO: oldest carryforward vintages first, then current year;
  // each vintage expires after the 5th taxable year following the year it arose (§23(c)(2))

totalBenefitThisYear = refundableTotal + nonrefundableUsed
neverClaimable       = Σ max(0, qae_paid_i - base_i)                     // over-cap expenses (informational)
phaseoutLost         = Σ (base_i * ratio)                                // informational
```

Ordering is load-bearing and verified: **cap → phaseout → refundable split → liability limit → carryforward**. The phaseout hits the total credit before the split (it does not preferentially protect either portion); the refundable slice is the *first* dollars of each child's allowed credit.

§137 panel (optional v1): `exclusionAllowed = min(benefitsReceived or deemed cap if special-needs+program, capRemaining_137) × (1 − ratio_137)` where `ratio_137` uses exclusion-MAGI (AGI + the benefits themselves + foreign add-backs). Benefits reduce credit-side QAE dollar-for-dollar on the same expenses.

Input gates: MFS without the lived-apart exception → not eligible (carryforward-only exception surfaced); foreign adoption not yet final → $0 this year (timing helper explains); surrogacy / spouse's-child expenses → excluded from QAE (checklist copy).

---

## 4. Test fixtures

All TY2026 unless noted. `L` = tax liability available for nonrefundable credits. Expected values are exact (ratio kept exact; see §7.4 on the form's 3-decimal rounding).

| # | Scenario | Inputs | Expected |
|---|---|---|---|
| F1 | Expenses under refundable cap, zero liability — refundable-first proof | 1 child, QAE $4,000, MAGI $90,000, L $0 | allowed $4,000; **refundable $4,000**; nonrefundable $0; carryforward $0. Refund arrives despite $0 liability. (Kills the fixed "$5,120/$12,550" framing.) |
| F2 | Expenses exceed total cap | 1 child, QAE $25,000, MAGI $100,000, L $20,000 | base $17,670; refundable $5,120; nonrefundable $12,550 fully used; carryforward $0; **$7,330 never claimable** |
| F3 | **IRS's own example (TY2025)** — authoritative regression anchor | 1 child, QAE $20,000, final 2025, MAGI below $259,190, L $10,000 | refundable $5,000; nonrefundable used $10,000; **carryforward $2,280** (expires after TY2030); $2,720 never claimable. Matches 2025 Instructions line-18 example verbatim |
| F4 | MAGI mid-phaseout | 1 child, QAE $18,000, MAGI $285,080, L $15,000 | excess $20,000; ratio 0.500; allowed $8,835; refundable $5,120; nonrefundable $3,715 used; carryforward $0 |
| F5 | MAGI at full phaseout | 1 child, QAE $17,670, MAGI $305,080 | ratio 1.000; credit $0 (both portions $0); §137 exclusion also $0 |
| F6 | MAGI exactly at threshold (boundary: "in excess of") | 1 child, QAE $10,000, MAGI $265,080, L $10,000 | ratio 0 (not "in excess"); allowed $10,000; refundable $5,120; nonrefundable $4,880 |
| F7 | Special needs, near-zero actual expenses | 1 child, special-needs (state or tribal determination), final 2026, actual QAE $1,000 entered, no prior claims, MAGI $150,000, L $6,000 | deemed QAE $17,670 (input overridden by deeming); refundable $5,120; nonrefundable used $6,000; **carryforward $6,550** |
| F8 | Multi-year carryforward with expiry | F7 family but L $1,500 every year 2026–2031 | 2026: refundable $5,120 paid, nonrefundable used $1,500, cf $11,050 (vintage 2026); 2027–2031: $1,500 used each year ($7,500); **$3,550 expires unused after TY2031** (5th year after 2026); lifetime realized $14,120 of $17,670 |
| F9 | Employer-assistance coordination | 1 child, total costs $20,000, employer written program pays $17,670 (excluded), MAGI $120,000 (both definitions below thresholds), L $5,000 | credit-side QAE = $2,330 ($20,000 − $17,670); allowed $2,330; **refundable $2,330**; nonrefundable $0; plus $17,670 excluded from wages. No double-dip; both provisions' caps are separate |
| F10 | Two children — per-child refundable cap | children A & B, QAE $6,000 each, MAGI $200,000, L $1,000 | allowed $6,000 per child; refundable = min($6,000, $5,120) **per child** → **$10,240 refundable total**; nonrefundable current $1,760, used $1,000, cf $760. Total refundable on one return correctly exceeds $5,120 (a per-return implementation of the cap would wrongly output $5,120 + $6,880 nonrefundable — this fixture must fail such an engine) |
| F11 | Same child, second year of expenses (cap grows with indexing; fresh refundable slice) | prior 8839 (TY2025) lines 3+6 total $10,000; TY2026 new post-finality QAE $10,000; MAGI $100,000, L $0 | capRemaining $7,670 ($17,670 − $10,000); base $7,670; **refundable $5,120** (per-year slice, not consumed by 2025's claim); nonrefundable $2,550 → all carried forward (L $0) |
| F12 | MFS gate | married filing separately, lived with spouse in Nov–Dec 2026 | not eligible for credit or exclusion this year (input gate + explainer); carryforward-only MFS exception surfaced |

Cross-check identities every fixture must satisfy: `refundableTotal + nonrefundableCurrent = Σ allowed_i`; `allowed_i ≤ base_i ≤ capRemaining_i`; `refundable_i ≤ min(allowed_i, P.refundableCap)`; carryforward never contains any refundable dollars; no vintage survives past `yearArose + 5`.

---

## 5. Scope & UX notes (v1)

- Default year **2026** with a 2025 toggle (extension filers through Oct 15, 2026, and amended returns still live on 2025).
- Up to 3 children (mirrors the form's columns; "more than three" → note, per line-13 instructions).
- QAE input framed as "expenses claimable in the selected tax year," with a collapsible **timing helper** rendering the §1.5 domestic/foreign tables — the engine stays pure; the helper educates.
- Tax-liability input labeled plainly ("federal income tax before this credit, after your other credits") with a tooltip pointing at the Credit Limit Worksheet — a deliberate simplification (§7.8).
- Content differentiators to write up: the 2010–2011 history correction (§0.3), per-child refundable math, the carryforward-expiry table, the special-needs tribal parity (new, OBBBA §70403), unsuccessful-adoption rule, the two-caps-no-double-dip employer section, and the "$2,720 may never be claimed" over-cap concept.
- Cross-links: OBBBA cluster tools, DCFSA vs Child Care Credit, tax glossary.

## 6. Competitive notes

- `financial-advisors-for-families.com/adoption-financial-planning/` (re-fetched 2026-07-13): still a **static mockup** — labeled inputs ("Qualified adoption expenses," "Household MAGI," "Federal income tax liability"), no calculation engine. Figures are correct, but it presents **"Refundable portion: $5,120 / Nonrefundable portion: $12,550"** as fixed amounts — that split only holds when the full $17,670 is allowed. Our fixtures F1/F4/F9/F10 are exactly the cases a naive implementation of their own copy would get wrong.
- No other interactive calculator in the SERP (TurboTax/H&R Block/CPA prose; ustax.tools and nationaltaxtools not present for this term as of the 07-12 scout).

## 7. Open uncertainties — flagged, not guessed

1. **2026 Form 8839 does not exist yet.** All line numbers (11a/b/c, 13, 18; Form 1040 line 30; Schedule 3 line 6c) are from the **2025** form and may move. The per-child refundable computation for 2026 is the 2025 form's structure with $5,120 substituted — near-certain but unconfirmable until the 2026 form drops (~Dec 2026). Don't hard-code line numbers in user copy without a year label.
2. **TY2027 figures unknown** until the fall-2026 Rev. Proc. Engine must be year-parameterized; page copy dates every figure. (Same freshness rule that caught the QCD $111,000 correction.)
3. **Per-child vs per-return refundable cap:** §23(a)(4)'s text ("so much of the credit … as does not exceed $5,000") reads per-return on its face; the IRS resolved it **per child** on the 2025 form (line 11b per column) and in the instructions ("determined separately for each eligible child"). Follow the form — it's the filing reality — but keep the statutory note in case of later technical corrections.
4. **Phaseout rounding:** the form says the ratio is "rounded to at least three places," max 1.000. Engine uses the exact ratio; worst-case divergence from a 3-decimal filer is ≤ ~$9 per child. Fixtures use ratio-exact values with clean inputs so both conventions agree.
5. **2025 Instructions cite "Form 1040 … line 11b" for MAGI** — likely a 2025 Form 1040 renumbering (AGI was line 11). Verify against the actual 2025 Form 1040 at build time before writing MAGI helper copy.
6. **§137 payroll-tax note:** adoption assistance is exempt from income tax withholding but (per prior-law Pub 15-B treatment) **subject to FICA/FUTA**. Verify against the current Pub 15-B at build before stating it on-page.
7. **Complex sequences out of scope for v1:** unsuccessful-attempt-then-successful-adoption aggregation across children, splitting caps between unmarried co-adopters, foreign pre-finality employer benefits (include-then-adjust rule), readoption expenses. Form-column model per child only; note limitations on-page.
8. **Credit Limit Worksheet simplification:** line 17 is §26(a) liability minus other subpart-A credits (other than §23/§25D) — v1 collapses this to one user input. Document on-page; do not attempt to recompute other credits.
9. **Special-needs §137 deeming** requires the employer to *have* a written program even if it paid nothing (line 24). If the v1 employer panel ships, gate the deeming on a "does your employer have a written adoption assistance program?" toggle.

## 8. Sources

- **P.L. 119-21 (OBBBA), §§70402–70403**, 139 Stat. 213–214 — govinfo.gov enrolled-law HTML, quoted verbatim: `https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm`
- **Rev. Proc. 2025-32**, §§4.04 (Adoption Credit), 4.18 (Adoption Assistance Programs) — PDF read directly: `https://www.irs.gov/pub/irs-drop/rp-25-32.pdf`
- **26 U.S.C. §23** (current text incl. OBBBA amendments) — `https://www.law.cornell.edu/uscode/text/26/23`
- **26 U.S.C. §137** — `https://www.law.cornell.edu/uscode/text/26/137`
- **2025 Form 8839** — PDF read directly: `https://www.irs.gov/pub/irs-pdf/f8839.pdf`
- **2025 Instructions for Form 8839** — PDF read directly: `https://www.irs.gov/pub/irs-pdf/i8839.pdf`
- IRS newsroom, TY2026 inflation adjustments (corroboration): `https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill`
- 2010–2011 refundability history: CRS R44745 (`https://www.congress.gov/crs-product/R44745`), Tax Policy Center briefing book, IRS Notice 2010-66 (`https://www.irs.gov/pub/irs-drop/n-10-66.pdf`) — ACA P.L. 111-148 §10909
- Competitor snapshot 2026-07-13: `https://financial-advisors-for-families.com/adoption-financial-planning/`
