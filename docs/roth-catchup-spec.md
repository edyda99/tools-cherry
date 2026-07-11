# Mandatory Roth Catch-Up Calculator — Sourced Spec (SECURE 2.0 §603)

**Tool slug (proposed):** `/mandatory-roth-catch-up-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA calculators (SALT / car-loan / senior).
**Prepared:** 2026-07-11. All hard numbers verified against IRS primary sources (Notice 2025-67 and 26 CFR 1.414(v)-2).

---

## 0. Plain-language summary (read this first)

Starting with the **2026** tax year, if you are **50 or older** and earned **more than $150,000 in Social Security (FICA) wages in 2025 from the same employer whose 401(k) you're in**, your **catch-up** contributions can no longer go in pre-tax. They must go in as **Roth (after-tax)**. This is SECURE 2.0 Act §603, now written into law as IRC §414(v)(7) and the final regulations at 26 CFR 1.414(v)-2.

Three things people get wrong, and what's actually true:
- **You do NOT lose your catch-up.** You still get the full $8,000 (ages 50-59 and 64+) or $11,250 (ages 60-63). Only the *tax treatment* changes.
- **It is NOT a new tax.** It changes *when* you're taxed (now instead of at withdrawal). You lose the upfront deduction on the catch-up portion; the money then grows and comes out tax-free.
- **It touches ONLY the catch-up portion.** Your regular deferral (up to $24,500 in 2026) can still be pre-tax.

The calculator tells a 50+ earner: (a) whether the mandate hits them, (b) how much extra tax the forced-Roth treatment costs this year, and (c) the Roth-vs-pre-tax break-even so they know whether that cost is actually a loss.

**Confidence:** HIGH on every 2026 hard number (all traced to IRS Notice 2025-67 and the final reg). One item is flagged UNCERTAIN and one is flagged ANCILLARY in §6 — neither is load-bearing.

---

## 1. Exact rule mechanics (all figures sourced)

### 1.1 Who is subject (three gates, all must be true)

| Gate | Rule | Primary source |
|---|---|---|
| **Age** | Age 50 or older by the end of the tax year (i.e. otherwise eligible to make catch-up contributions under §414(v)). | IRC §414(v)(2)(B) |
| **Prior-year wages** | FICA (Social Security) wages from **the employer sponsoring the plan** for the **immediately preceding calendar year** **exceed** the Roth catch-up wage threshold. For 2026 contributions the test year is **2025** and the threshold is **$150,000**. | 26 CFR 1.414(v)-2(a)(2)-(3); IRS Notice 2025-67 |
| **Plan offers Roth** | The requirement bites only in a plan that *offers* designated Roth contributions. (See §1.6 for what happens when it doesn't.) | 26 CFR 1.414(v)-2 |

If all three are true, **every** catch-up dollar for that participant that year must be a designated **Roth** contribution. There is no pre-tax catch-up option once the threshold is hit.

### 1.2 The $150,000 threshold — the details that matter

- **Which year's wages?** The **immediately preceding calendar year** (2025 wages govern 2026 contributions), **not** two years prior and **not** the current year. The statute reads "for the preceding taxable year." *(This was an explicit verification target — resolved: preceding year, per 26 CFR 1.414(v)-2(a)(2) and the statutory text of §414(v)(7)(A).)*
- **From whom?** Only wages from **the employer maintaining the plan** ("the participant's common-law employer"). Wages from a *different* employer don't count. A **new employee** with no prior-year wages from that employer is **not** subject (nothing to test against). Employers *may* (not must) aggregate wages across affiliates / a common paymaster.
- **What counts as "wages"?** **FICA wages under IRC §3121(a)** — the wages subject to the Social Security (OASDI) tax under §§3101(a)/3111(a) — i.e. **Box 3 of the W-2** (Social Security wages), **not** Box 1 (federal taxable wages) and **not** Box 5 (Medicare wages). Note: pre-tax 401(k) elective deferrals *are* included in FICA wages, so making a bigger pre-tax deferral does **not** pull your Box 3 below the threshold.
- **Indexing.** The **statutory base is $145,000** (IRC §414(v)(7)(A)). It is adjusted for cost of living "at the same time and in the same manner as under §415(d), except that the base period is the calendar quarter beginning **July 1, 2023**, and any increase not a multiple of $5,000 is rounded **down** to the next lower multiple of $5,000." It stayed $145,000 for 2024-2025 and first moved to **$150,000 for 2026**. *(Verification target — resolved: base $145,000, base period Q3-2023, $5,000 rounding, first indexed bump to $150,000 for 2026, per 26 CFR 1.414(v)-2(a)(3) and IRS Notice 2025-67.)*
- **"Exceed," not "at or above."** The test is wages that **exceed** the threshold. Exactly $150,000 is **not** over → **not** subject. (Load-bearing for boundary fixtures.)

### 1.3 The catch-up amounts (2026, verified)

All four figures below are the **actual 2026** amounts, quoted from **IRS Notice 2025-67** (do not assume prior-year values):

| Item | 2026 amount | Statutory ref | 2025 (for context) |
|---|---|---|---|
| §402(g) elective-deferral limit (base) | **$24,500** | §402(g)(1) | $23,500 |
| Age-50+ standard catch-up | **$8,000** | §414(v)(2)(B)(i) | $7,500 |
| Age 60-63 "super" catch-up | **$11,250** (unchanged) | §414(v)(2)(E)(i) | $11,250 |

- The **super catch-up** ($11,250) applies **only** in the taxable year the participant **attains age 60, 61, 62, or 63**. It is the greater of $10,000 or 150% of the age-50 catch-up, indexed; for 2026 it "**remains $11,250**" (Notice 2025-67). At **age 64+** the participant **reverts to the $8,000** standard catch-up. (Load-bearing for the band-edge fixtures.)
- The mandate applies to the catch-up regardless of which band — an over-threshold 62-year-old must Roth the full $11,250; an over-threshold 64-year-old must Roth the $8,000.

### 1.4 Which plans this applies to (scope — confirmed)

- **Covered:** §401(k), §403(b), and **governmental §457(b)** plans (and the federal Thrift Savings Plan). Source: 26 CFR 1.414(v)-2; IRS Notice 2025-67.
- **Excluded:** **SEP** (§408(k)) and **SIMPLE IRA** (§408(p)) arrangements. IRS Notice 2025-67 states the threshold applies to catch-ups "to an applicable employer plan **(other than a plan described in section 408(k) or (p))**" — that parenthetical is the direct primary-source exclusion of SEP/SIMPLE.
- **Not subject at all:** an individual with **no §3121(a) FICA wages** from the plan sponsor — e.g. a **partner or sole proprietor** whose only earnings are self-employment income (SECA, not FICA), or certain state/local government workers outside Social Security. Source: 26 CFR 1.414(v)-2 (no wages to test → not subject).

### 1.5 What "Roth requirement" means in practice

- The catch-up is a **designated Roth contribution**: paid with **after-tax** dollars, **no** current-year deduction, but **qualified withdrawals (contributions + earnings) are tax-free** in retirement.
- **Deemed Roth election.** The final reg lets a plan treat an over-threshold participant's catch-ups as Roth **automatically** once their deferrals for the year exceed the §401(a)(30)/§402(g) limit — the participant must be given "an effective opportunity to make a different election" (e.g. to stop catch-ups), but they **cannot** elect pre-tax catch-ups. Source: 26 CFR 1.414(v)-2(c)(3)(i)(B).
- There is **no traditional/pre-tax catch-up option** for a subject participant. Their only choices are: contribute the catch-up as Roth, or not make a catch-up at all.

### 1.6 Plan with no Roth feature

If a plan **offers catch-ups but has no Roth option**, it may simply **bar high earners from making catch-up contributions at all** (and won't fail nondiscrimination testing for doing so). The rule does **not** force an employer to add Roth. Practical effect for a subject participant in a no-Roth plan: **catch-up capacity = $0** (not "pre-tax allowed"). Source: 26 CFR 1.414(v)-2; Trucker Huss, Groom Law.

### 1.7 Effective date & transition relief (verify current status — resolved)

This was an explicit verification target. Timeline, all sourced:

1. **Statutory effective date:** taxable years beginning after **Dec 31, 2023** (SECURE 2.0 §603).
2. **Administrative transition period — IRS Notice 2023-62 (Aug 25, 2023):** the mandate was treated as satisfied even if catch-ups stayed pre-tax, **through taxable years beginning on or before Dec 31, 2025**. So it was **not enforced in 2024-2025**.
3. **Final regulations — T.D. 10033**, published in the Federal Register **Sept 16, 2025** (doc 2025-17865); regulatory effective date **Nov 17, 2025**.
4. **In effect for 2026.** Because the Notice 2023-62 transition period ended Dec 31, 2025, the mandate **applies to 2026 contributions**. However, the detailed final regs are formally **applicable to taxable years beginning after Dec 31, 2026**; for years **before 2027** a **"reasonable, good-faith interpretation"** standard applies. So: **2026 = mandate in force under a good-faith standard; 2027 = strict compliance with the final regs.**
5. **Later dates for some plans:** **Collectively bargained** plans — later of Dec 31, 2026 or expiry of the last CBA in effect on Dec 31, 2025. **Governmental** plans — later of Dec 31, 2026 or the first taxable year after the close of the first regular legislative session (with amendment authority) beginning after Dec 31, 2025.

**Net for the calculator:** default to **2026** and state plainly that the mandate is in force for 2026 (good-faith standard), strict from 2027, and later still for many union/governmental plans. For a **2025** run, output **"not yet enforced (transition relief)."**

---

## 2. Primary sources

| # | Source | What it anchors | URL |
|---|---|---|---|
| P1 | **IRS Notice 2025-67** (2026 COLA amounts) | $150,000 threshold; $24,500 deferral; $8,000 catch-up; $11,250 super catch-up; SEP/SIMPLE exclusion parenthetical | https://www.irs.gov/pub/irs-drop/n-25-67.pdf |
| P2 | **IRS newsroom — "401(k) limit increases to $24,500 for 2026"** | Same 2026 figures, plain-language | https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500 |
| P3 | **26 CFR 1.414(v)-2** (final reg on mandatory Roth catch-up) | Threshold definition ($145k base, Q3-2023 base period, $5k round-down), §3121(a) preceding-year wages, employer-sponsor requirement, no-FICA-wages exemption, deemed Roth election, applicability after Dec 31, 2026 | https://www.law.cornell.edu/cfr/text/26/1.414(v)-2 |
| P4 | **T.D. 10033 — Federal Register "Catch-Up Contributions"** (Sept 16, 2025) | Final-reg preamble; applicability dates; good-faith relief; governmental/CBA dates | https://www.federalregister.gov/documents/2025/09/16/2025-17865/catch-up-contributions |
| P5 | **IRS newsroom — "Treasury, IRS issue final regulations on new Roth catch-up rule"** | Plain-language confirmation of the above; prior-year wage aggregation | https://www.irs.gov/newsroom/treasury-irs-issue-final-regulations-on-new-roth-catch-up-rule-other-secure-2point0-act-provisions |
| P6 | **IRS Notice 2023-62** | The 2-year administrative transition period ending Dec 31, 2025 | https://www.irs.gov/pub/irs-drop/n-23-62.pdf |
| P7 | **SECURE 2.0 Act §603 / IRC §414(v)(7)** (statute) | Statutory base $145,000, "preceding taxable year," covered-plan scope | https://www.law.cornell.edu/uscode/text/26/414 |

**Secondary corroboration** (plan-sponsor / law-firm; used only to cross-check, never as the number of record): Trucker Huss (https://www.truckerhuss.com/newsletter/roth-catchup-regulations/), Groom Law (https://www.groom.com/resources/irs-issues-final-regulations-on-catch-up-rule-changes/), Grant Thornton, Bank of America Workplace Insights. Every hard number above traces to P1-P3.

---

## 3. Calculator mechanics

### 3.1 Inputs

| Input | Type | Notes |
|---|---|---|
| `taxYear` | select | Default **2026**. Support 2025 (→ transition-relief output) and 2027+ (strict). Drives the constants table (§3.3). |
| `age` | number | Age attained by end of `taxYear`. Determines the catch-up band. |
| `priorYearFicaWages` | number | **Box 3 (Social Security) wages from THIS employer for the prior calendar year.** Label must say "last year's Social Security (Box 3) wages from this employer," with helper text (see myth-bust §7). |
| `catchUpAmount` | number | How much catch-up the user actually plans to contribute this year (0 → n/a path). Cap the field at the band max. |
| `currentMarginalRate` | select/number | Current federal marginal rate (10/12/22/24/32/35/37%). Used for the this-year tax-cost + break-even. |
| `retirementMarginalRate` | select/number | Expected marginal rate at withdrawal. Used for break-even / future-value. |
| `yearsToRetirement` | number | For the future-value comparison. |
| `growthRate` | number | Expected annual investment growth % (default e.g. 6%). |
| `planOffersRoth` | toggle | Default **yes**. "No" → the no-Roth-plan branch (§1.6). |

Filing status is **not** an input: the $150,000 threshold is a **flat per-person wage test** with **no** filing-status or MAGI phase-out (unlike the OBBBA deductions). Omit it — adding it would be a confusing, load-bearing-less input (violates the "one obvious way / human-friendly" rule).

### 3.2 Determination logic (pseudocode)

```
band, maxCatchUp =
    age < 50            -> ('none', 0)          # not eligible for any catch-up
    50 <= age <= 59     -> ('standard', C_STD)  # $8,000 (2026)
    60 <= age <= 63     -> ('super',   C_SUPER) # $11,250 (2026)
    age >= 64           -> ('standard', C_STD)  # reverts to $8,000

subjectByAge   = age >= 50
subjectByWages = priorYearFicaWages > THRESHOLD          # strict > ("exceed")
inEffectYear   = taxYear >= 2026                          # 2025 -> transition relief

mandate =
    not subjectByAge                 -> {applies:false, reason:'under_50_no_catchup'}
    not inEffectYear                 -> {applies:false, reason:'transition_relief_<year>'}
    priorYearFicaWages == 0          -> {applies:false, reason:'no_prior_year_fica_wages'}
    not subjectByWages               -> {applies:false, reason:'wages_at_or_below_threshold'}
    not planOffersRoth               -> {applies:true,  effect:'plan_no_roth_cannot_catchup', maxAllowedCatchUp:0}
    else                             -> {applies:true,  effect:'must_be_roth'}

effectiveCatchUp = min(catchUpAmount, maxCatchUp)
mandateBites = mandate.applies AND effect=='must_be_roth' AND effectiveCatchUp > 0
```

### 3.3 Constants table (keyed by year)

```
2025: { deferral: 23500, cStd: 7500,  cSuper: 11250, threshold: 145000, enforced: false }  # transition relief
2026: { deferral: 24500, cStd: 8000,  cSuper: 11250, threshold: 150000, enforced: true  }
2027: { deferral: null,  cStd: null,  cSuper: null,  threshold: null,   enforced: true, note: 'await Notice for 2027 COLA' }
```
2027 figures are **not yet published** (IRS COLA notice ~Oct 2026) — do **not** fabricate them; gate the year selector to 2025/2026 until then, mirroring how the SALT calc flags `pending_irs_guidance`.

### 3.4 Outputs

1. **Subject to the mandate?** yes / no + the reason string, in plain English.
2. **Your catch-up band & max** for the year ($8,000 or $11,250).
3. **Extra federal tax this year from forced-Roth** = `effectiveCatchUp × currentMarginalRate`. This is the upfront deduction you forgo. (If not subject → $0; the catch-up could be pre-tax.)
4. **Roth-vs-pre-tax break-even.** Headline rule: *forced-Roth leaves you better off if your retirement marginal rate is at least your current marginal rate; worse off if it's lower; a wash if they're equal.* Break-even retirement rate = current marginal rate.
5. **Future-value comparison** (see §3.5): the after-tax retirement value under forced-Roth minus what pre-tax would have given, for the same catch-up dollars.
6. **n/a path:** if `catchUpAmount == 0` for a would-be-subject person → "You're over the threshold, but with no catch-up contribution there's nothing to convert — the mandate doesn't affect you this year." (Output, not an error.)

### 3.5 Future-value math (state assumptions explicitly)

Let `C` = catch-up amount, `n` = years to retirement, `g` = growth rate, `tc` = current marginal rate, `tr` = retirement marginal rate. Using the standard Roth-vs-traditional equivalence (assumes the pre-tax route reinvests its upfront deduction `C·tc` at the same growth `g` in a tax-advantaged bucket — **state this assumption in the UI**):

```
rothAdvantageAtRetirement = C × (1+g)^n × (tr − tc)
```

- `> 0` → forced-Roth wins (retirement rate higher than current).
- `< 0` → forced-Roth costs you (retirement rate lower).
- `= 0` at `tr = tc` (the break-even), consistent with output #4.

Also display `extraTaxThisYear = C × tc` (output #3) as the concrete, assumption-free number.

**Deliberately NOT modeled** (keep honest and simple): taxable-side-account drag, RMD differences, IRMAA/ACA interactions, state tax, the tax-diversification value of holding both buckets. Add a one-line "this is an estimate; a Roth also gives you tax-rate diversification and no RMDs" caveat rather than half-modeling those.

### 3.6 Suggested engine surface (to match the existing OBBBA engine style)

Pure, dependency-free functions returning `{ ...flags, notes: [] }`, mirroring `obbba-deduction.js`:
- `rothCatchUpStatus({ taxYear, age, priorYearFicaWages, planOffersRoth, params }) -> { subject, band, maxCatchUp, reason, notes }`
- `rothCatchUpCost({ effectiveCatchUp, currentMarginalRate }) -> { extraTaxThisYear }`
- `rothVsPretax({ catchUp, years, growth, currentRate, retirementRate }) -> { rothAdvantage, breakEvenRate }`
- `estimateRothCatchUp({...}) -> full result object` (end-to-end, like `estimateSenior` / `estimateCarLoan`)
- Data lives in a new `rothCatchUp` block in `src/data/obbba-deductions-2026.json` (or a sibling `secure2-catchup-2026.json`), with `_meta.lastSourced`, `sources[]`, and a `qualifies` prose string, exactly like the existing blocks.

---

## 4. Test fixtures (14; ≥12 required)

Constants used: 2026 → `cStd=8000, cSuper=11250, threshold=150000, enforced=true`; 2025 → `threshold=145000, enforced=false`. `(1.06)^5 = 1.3382255776`, `(1.06)^10 = 1.7908476965`. Currency rounded to the cent.

| # | Scenario | Inputs | Expected output |
|---|---|---|---|
| **R1** | Under 50 — not applicable at all | 2026, age 45, wages 200000, catchUp any | `subject=false`, `band='none'`, `maxCatchUp=0`, reason `under_50_no_catchup`, extraTax = **n/a** |
| **R2** | Threshold just UNDER | 2026, age 50, wages 149999, catchUp 8000, tc .24 | `subject=false`, reason `wages_at_or_below_threshold`, `band='standard'`, `maxCatchUp=8000`, extraTax **$0** (pre-tax still allowed) |
| **R3** | Threshold just OVER | 2026, age 50, wages 150001, catchUp 8000, tc .24 | `subject=true`, effect `must_be_roth`, `maxCatchUp=8000`, extraTaxThisYear **$1,920.00** (8000×.24) |
| **R4** | Threshold EXACTLY $150,000 ("exceed") | 2026, age 52, wages 150000, catchUp 8000 | `subject=false` (150000 does not exceed 150000), reason `wages_at_or_below_threshold` |
| **R5** | 59 — still standard band | 2026, age 59, wages 300000, catchUp 8000, tc .32 | `subject=true`, `band='standard'`, `maxCatchUp=8000`, extraTax **$2,560.00** |
| **R6** | 60 — super band lower edge | 2026, age 60, wages 300000, catchUp 11250, tc .35 | `subject=true`, `band='super'`, `maxCatchUp=11250`, extraTax **$3,937.50** |
| **R7** | 63 — super band upper edge | 2026, age 63, wages 300000, catchUp 11250, tc .35 | `subject=true`, `band='super'`, `maxCatchUp=11250`, extraTax **$3,937.50** |
| **R8** | 64 — reverts to standard | 2026, age 64, wages 300000, catchUp 11250 req'd, tc .35 | `subject=true`, `band='standard'`, `maxCatchUp=8000`, `effectiveCatchUp=8000` (capped down), extraTax **$2,800.00** |
| **R9** | Over threshold but does NO catch-up → n/a | 2026, age 62, wages 155000, catchUp **0** | `subject=true` by age+wages BUT `mandateBites=false`, effect note `no_catchup_elected`, extraTax **$0**, rothAdvantage **n/a** (not an error) |
| **R10** | Self-employed / no FICA wages | 2026, age 55, wages **0** (partner, SECA only), catchUp 8000 | `subject=false`, reason `no_prior_year_fica_wages`, `band='standard'`, pre-tax still allowed |
| **R11** | Over threshold, plan has NO Roth | 2026, age 58, wages 500000, planOffersRoth=**false**, catchUp 8000 desired | `subject=true`, effect `plan_no_roth_cannot_catchup`, `maxAllowedCatchUp=0`, extraTax **$0** (no catch-up possible) |
| **R12** | 2025 — transition relief, not enforced | 2025, age 60, wages 200000, catchUp 11250 | `subject=false`, reason `transition_relief_2025`; pre-tax catch-up allowed for 2025 |
| **R13** | Future value — retirement rate LOWER → Roth costs you | 2026, age 60, wages 300000, catchUp 11250, tc .35, tr .24, n 5, g .06 | extraTaxThisYear **$3,937.50**; rothAdvantage = 11250×1.3382255776×(.24−.35) = **−$1,656.05** (worse off) |
| **R14** | Future value — retirement rate HIGHER → Roth wins | 2026, age 55, wages 300000, catchUp 8000, tc .24, tr .32, n 10, g .06 | extraTaxThisYear **$1,920.00**; rothAdvantage = 8000×1.7908476965×(.32−.24) = **+$1,146.14** (better off) |

Boundary coverage: just-under / just-over / exact threshold (R2/R3/R4); super-band edges 60 & 63 (R6/R7); pre-super 59 & revert 64 (R5/R8); under-50 not-applicable (R1); over-threshold-no-catch-up n/a (R9); no-FICA-wages exemption (R10); no-Roth-plan (R11); transition year (R12); both break-even directions (R13/R14).

---

## 5. Adversarial verification (tried to break each hard number)

| Claim under attack | Failure mode I tested | Resolution |
|---|---|---|
| **Threshold = $150,000 for 2026** | Maybe still $145,000 (many 2023-2025 articles say $145k). | **Refuted.** IRS Notice 2025-67 (P1) states the §414(v)(7)(A) threshold "is increased **from $145,000 to $150,000**" for 2026. $145k is the statutory *base*; $150k is the 2026 indexed value. |
| **Wage test = PRIOR year** | Could be current-year or 2-years-prior wages. | **Confirmed prior year.** 26 CFR 1.414(v)-2(a)(2): §3121(a) wages for **"the preceding calendar year."** Not current, not 2-back. |
| **Indexing base** | Which base year drives the COLA? | **Resolved.** Base amount $145,000; base period = **calendar quarter beginning July 1, 2023**; round **down** to nearest $5,000 (26 CFR 1.414(v)-2(a)(3)). This is why the first bump is exactly +$5,000 to $150,000. |
| **Base catch-up = $8,000 (not assumed $7,500)** | Prompt warned not to assume. | **Confirmed $8,000.** Notice 2025-67 §414(v)(2)(B)(i): "increased from $7,500 to **$8,000**." |
| **Super catch-up = $11,250** | Could have been re-indexed for 2026. | **Confirmed, unchanged.** Notice 2025-67 §414(v)(2)(E)(i): for those attaining 60-63 in 2026 it "**remains $11,250**." |
| **Wage type = FICA/Box 3 (not Box 1/Box 5)** | Box 5 Medicare wages are uncapped; picking the wrong box changes who's in. | **Resolved to Box 3.** Reg references §3121(a) wages "for purposes of the taxes imposed by §§3101(a)/3111(a)" = OASDI = **Box 3 Social Security wages**, not Medicare (Box 5) or federal taxable (Box 1). |
| **Plan scope — does it creep to SEP/SIMPLE?** | Scope-creep risk. | **Refuted.** Notice 2025-67 excludes "a plan described in **§408(k) or (p)**" (SEP/SIMPLE). Covered = 401(k)/403(b)/governmental 457(b)/TSP. |
| **Effective date for 2026** | Final regs say "after Dec 31, **2026**" — is the mandate even on for 2026? | **Resolved: on for 2026 under good-faith.** Notice 2023-62 transition ended Dec 31, 2025, so the mandate applies to 2026; the *detailed regs* are strictly applicable from 2027, with a "reasonable good-faith" standard for 2026 (T.D. 10033). Governmental/CBA plans get later dates. The tool must surface this nuance, not claim blanket strict enforcement. |
| **"Exceed" vs "at or above" $150k** | Off-by-one at the boundary. | **Resolved: strict "exceed."** Statute/reg use "exceed"; exactly $150,000 is **not** subject (fixture R4). |
| **Self-employed treatment** | Do partners with high K-1 income get caught? | **Refuted.** No §3121(a) FICA wages from the plan sponsor → **not subject** (self-employment income is SECA, not FICA). Fixture R10. |

Two non-load-bearing items flagged for honesty:
- **ANCILLARY — Social Security wage base.** Box 3 is capped at the OASDI wage base (2025 ≈ **$176,100**; 2026 base — *verify against SSA's Oct-2025 announcement before using*). Since the cap (~$176k) exceeds the $150k threshold, it **never** pulls an over-$150k earner below the line, so it does not change any determination. Mention only as an FYI; do not compute with the 2026 base until confirmed.
- **UNCERTAIN — 2027 constants.** The 2027 deferral/catch-up/threshold COLA figures are **not yet published** (expected ~Oct 2026). Gate the year selector to 2025/2026; flag 2027 as `pending_irs_guidance` (same posture as the SALT calc's 2028-2029 handling). Do not fabricate.

---

## 6. Myth-bust framing (matches the senior-deduction "no tax on Social Security" voice)

**Headline (proposed):** *"Do I lose my catch-up? No — the 2026 Roth rule only changes how it's taxed."*

The single most valuable misconception to bust, exactly parallel to how the senior calc corrects "no tax on Social Security":

> **What people fear:** "I make over $150k, so in 2026 I can't do my 401(k) catch-up anymore" — or "this is a new tax on high earners."
>
> **What's actually true:** You keep **every dollar** of catch-up room — the full **$8,000** (or **$11,250** at ages 60-63). Nothing about the *amount* changes. The only change is that the catch-up now goes in as **Roth (after-tax)** instead of pre-tax: you don't get the upfront deduction on it, but the money then grows and comes out **completely tax-free** in retirement. It's a change in *timing of tax*, not a new tax and not a lost benefit.

Supporting mini-myths (FAQ / prose, all sourced above):
- *"It applies to my whole 401(k)."* → **No.** Only the **catch-up** portion. Your regular deferral (up to **$24,500** in 2026) can still be pre-tax.
- *"It's based on this year's salary."* → **No.** It's **last year's** Social Security (Box 3) wages from **that same employer** — not this year's, not your total/household income, not investment or self-employment income.
- *"The number is $145,000."* → That's the **statutory base**; the **2026** threshold is **$150,000** (indexed).
- *"Forced Roth always costs me."* → **Not necessarily.** If your tax rate in retirement is **at least** your current rate, the Roth treatment leaves you **even or ahead**. You only "lose" if you expect a **lower** rate later. (This is the calculator's break-even output — a genuine reason for the tool to exist beyond the yes/no.)
- *"If my plan has no Roth option I'm forced to open one."* → **No** — but that plan can then **bar** you from catch-ups entirely until it adds Roth (most large plans are adding it).

---

## 7. Build notes / open flags

- **Why this tool wins the SERP (per the 07-09 fable scout):** the first-page results are all advisory articles (Fidelity/Schwab/Vanguard/law firms) — **no interactive calculator exists**. A clean yes/no + tax-cost + break-even tool is a genuine gap and reuses the OBBBA marginal-rate machinery.
- **Reuse:** the `federalTaxSaved` / bracket-diff helpers in `src/engine/obbba-deduction.js` can back the marginal-rate picker if you'd rather derive `tc` from income than ask for it; but asking for the marginal rate directly is simpler and avoids a filing-status input.
- **YMYL / accuracy posture:** treat like the tax pages — every figure footnoted to P1-P3, a "verify with your plan administrator / this is not tax advice" line, and the good-faith-2026 / strict-2027 caveat visible near the result.
- **Input label wording is load-bearing** (see §3.1 / §6): the wages field must say **"last year's Social Security (Box 3) wages from this employer"** or users will enter this year's salary or total household income and get a wrong answer.
- **Do NOT** add a filing-status or MAGI input — there is no phase-out here; it's a flat per-person wage test.
- **Year gate:** default 2026; allow 2025 (transition-relief output); block 2027+ until the COLA notice publishes.
