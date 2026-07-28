# Employer Student Loan Repayment Tax Benefit Calculator (IRC §127) — Sourced Spec

**Tool slug (proposed):** `/employer-student-loan-repayment-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA calculators (tips / overtime / SALT / car-loan / senior / charitable).
**Prepared:** 2026-07-13.
**Primary sources:** every load-bearing rule verified verbatim against the codified IRC at law.cornell.edu (§127(a)(2), §127(b)(1)–(6), §127(c)(1)(B), §127(c)(7), §127(d), §3121(a)(18), §3306(b)(13), §3401(a)(18), §221(b)(1), §221(d)(1), §221(e)(1)), plus IRS FS-2026-10 (April 2026 FAQ update), IRS Pub 15-B (2026), and the SSA 2026 COLA announcement. Secondary advisory sources (BDO, Mercer, Crowell, EBEC) used only to corroborate the OBBBA section number. California non-conformity verified against the Assembly Rev & Tax analysis of AB 386 and its terminal bill status.

---

## 0. Plain-language summary (read this first)

An employer can pay up to **$5,250 per year** toward an employee's **student loans** (principal AND interest, paid to the lender OR reimbursed to the employee) completely **tax-free** — the employee pays **no federal income tax and no 7.65% FICA** on it, and the employer skips its **matching 7.65% FICA** too. This was a temporary pandemic-era perk scheduled to die 12/31/2025; **OBBBA (P.L. 119-21) made it permanent** and added inflation indexing starting in **2027**.

The two-sided math at the full cap (2026, employee under the SS wage base):

| Side | Saving on $5,250 vs. paying it as taxable wages |
|---|---|
| Employee, income tax | $5,250 × marginal rate (e.g. 22% → **$1,155.00**) |
| Employee, FICA | $5,250 × 7.65% = **$401.63** |
| Employer, FICA match | $5,250 × 7.65% = **$401.63** |

**Scout-note verdict: everything confirmed, with four precision upgrades** (details §2):
- ✅ $5,250, PERMANENT (OBBBA §70412, effective payments after 12/31/2025), indexed after 2026 — all CONFIRMED.
- ✅ Combined/shared cap with tuition-type assistance — CONFIRMED by statute structure and by the IRS FAQ verbatim.
- ✅ Employee dual exclusion (income tax + FICA) and employer ~$402 — CONFIRMED; exact figure **$401.63** ($5,250 × 7.65% = $401.625).
- ⚠️ Precision upgrades the SERP prose gets wrong: (1) indexing rounds the **increase** to the **NEAREST** $50 (not the usual "next lowest multiple" pattern — verified verbatim); (2) first indexed year is **2027**, not 2026; (3) the 7.65% collapses to **1.45–2.35%** for wages above the SS wage base ($184,500 in 2026) — the "~$402 employer saving" headline is wrong for high earners; (4) the loan must be for the **employee's own education** — a Parent PLUS loan the employee took out for a child does NOT qualify (§127(c)(1)(B) "for education of the employee"), even though §221's definition covers dependents.

**Confidence:** HIGH on all statutory mechanics (verbatim Cornell text). HIGH-minus on the OBBBA section number §70412 (corroborated by four independent professional-firm sources + the Cornell amendment note crediting P.L. 119-21, but the enrolled-statute PDF itself was not fetched — flagged in §6).

---

## 1. Verified rules, statute by statute

### 1.1 The exclusion and the $5,250 cap — IRC §127(a)

**Verbatim (§127(a)(2)):**
> "If, but for this paragraph, this section would exclude from gross income more than $5,250 of educational assistance furnished to an individual during a calendar year, this section shall apply only to the first $5,250 of such assistance so furnished."

- The cap is **per individual per CALENDAR year** — and it's phrased at the individual level ("furnished to an individual"), so two employers each paying $5,250 does **not** double the exclusion; the individual's total exclusion is $5,250 across all employers.
- Amounts over the cap (or paid outside a qualifying plan) are **taxable wages** — Pub 15-B (2026): "If you don't have an educational assistance plan, or you provide an employee with assistance exceeding $5,250, you must include the value of these benefits as wages…"

### 1.2 Student loans are "educational assistance" — IRC §127(c)(1)(B), made permanent by OBBBA §70412

**Verbatim (§127(c)(1)(B), as amended):**
> "the payment by an employer, whether paid to the employee or to a lender, of principal or interest on any qualified education loan (as defined in section 221(d)(1)) incurred by the employee for education of the employee"

- **Principal AND interest** both qualify. ✅
- **Direct-to-lender OR reimbursement to the employee** both qualify ("whether paid to the employee or to a lender"). ✅ Also confirmed in IRS FAQ language: employers may pay "directly to a third party such as an educational provider or loan servicer, or make payments directly to the employee."
- **Employee's own education only.** The clause "incurred by the employee for education of the employee" is NARROWER than §221(d)(1) (which covers expenses of the taxpayer, spouse, or dependent). IRS FAQ confirms: "qualified education loan incurred by the employee for the employee's own education." → A Parent PLUS loan the employee borrowed for a **child** does NOT qualify; a spouse's loan does not qualify. Good calculator eligibility note and a differentiator vs. sloppy SERP prose.
- **Permanence:** the pre-OBBBA text limited this clause to "payments made before January 1, 2026." **OBBBA §70412(a)** struck the sunset; the Cornell amendment note credits **P.L. 119-21, effective for payments made after December 31, 2025** — i.e., seamless continuity, no gap. (Section number 70412 corroborated by BDO, Mercer, Crowell, EBEC; see §6.)

### 1.3 The SHARED cap — one $5,250 for tuition-type assistance + loan repayment combined

- **Statutory structure:** §127(c)(1) defines a single term "educational assistance" whose subparagraph (A) is tuition/fees/books/supplies/equipment and whose subparagraph (B) is the loan-payment clause. §127(a)(2) caps the total of that single defined term. There is no separate loan-repayment cap.
- **IRS FAQ verbatim (FS-2024-22, carried into FS-2026-10):** "the total amount that an employee can exclude from gross income for payments of principal or interest on qualified education loans and other educational assistance combined is $5,250 per calendar year."
- → Calculator logic: `loanExclusionRoom = max(0, cap − tuitionAssistanceUsed)`. An employee CANNOT get $5,250 of tuition assistance AND another $5,250 of loan repayment in the same year. ✅ Scout note confirmed.

### 1.4 Inflation indexing — IRC §127(d), added by OBBBA

**Verbatim (§127(d), full text):**
> "(d) Inflation adjustment
> (1) In general — In the case of any taxable year beginning after 2026, both of the $5,250 amounts in subsection (a)(2) shall each be increased by an amount equal to —
> (A) such dollar amount, multiplied by
> (B) the cost-of-living adjustment determined under section 1(f)(3) for the calendar year in which the taxable year begins, determined by substituting 'calendar year 2025' for 'calendar year 2016' in subparagraph (A)(ii) thereof.
> (2) Rounding — If any increase under paragraph (1) is not a multiple of $50, such increase shall be rounded to the nearest multiple of $50."

- **First indexed year: 2027** ("taxable year beginning after 2026"). 2025 and 2026 stay at $5,250. IRS FS-2026-10 confirms with matching language: "$5,250 per calendar year (adjusted for increases in the cost of living for taxable years beginning after 2026)."
- **Base year: 2025** (substituted into §1(f)(3), i.e. chained-CPI mechanics).
- **Rounding: the INCREASE (not the total) rounds to the NEAREST multiple of $50** — this can round UP (e.g. a $131.25 increase → $150). Most IRC COLA provisions round DOWN to the next-lowest multiple; §127(d)(2) explicitly does not. Any engine must implement nearest-$50 on the increase.
- The indexing applies to the **whole §127 cap** (both occurrences of $5,250 in (a)(2)) — not just the student-loan leg.
- **The 2027 dollar figure does not exist yet** — IRS publishes it in the annual inflation-adjustment Rev. Proc. (expected fall 2026). Engine must parameterize, not guess (see fixture F10 and §6).

### 1.5 Employee-side dual exclusion: income tax AND FICA — verified

Three separate statutes each exclude §127 amounts from their respective "wages" definitions (this is the verification the task asked for — §127 is NOT one of the income-tax-only fringe benefits):

- **FICA (Social Security + Medicare), §3121(a)(18), verbatim:** wages do not include "any payment or benefit furnished to or for the benefit of an employee if at the time of such payment or such furnishing it is reasonable to believe that the employee will be able to exclude such payment or benefit from income under section 127, 129, 134(b)(4), or 134(b)(5)".
- **Income-tax withholding, §3401(a)(18):** identical "reasonable to believe … under section 127" formulation.
- **FUTA, §3306(b)(13):** identical formulation.
- Corroboration: Pub 15-B (2026) treats educational assistance as an excludable fringe benefit ("You can exclude up to $5,250 of educational assistance … from the employee's wages each year").

**Employee saving on the excluded amount = marginal federal income tax + FICA**, where FICA is:
- **6.2% OASDI** — only to the extent the employee's other wages are below the SS wage base (**$184,500 for 2026**, up from $176,100 in 2025; SSA announcement 2025-10-24), plus
- **1.45% Medicare** — always (no cap), plus
- **0.9% Additional Medicare** — only if wages exceed the employee's Additional Medicare threshold ($200,000 withholding trigger; liability thresholds $200k single / $250k MFJ / $125k MFS, not indexed).
- Simple mode: **7.65%** for the typical (under-wage-base) employee. ✅ Scout note confirmed.

### 1.6 Employer-side saving — the "~$402" verified, with its caveats

- The employer avoids its **matching FICA share** on the excluded amount (same §3121(a)(18) — the amount simply isn't "wages"): **6.2% + 1.45% = 7.65%**.
- **Exact arithmetic: $5,250 × 7.65% = $401.625 → $401.63.** The scout note's "~$402/employee" is the right frame. ✅
- **Correct framing (must be stated in the tool):** this is the saving **versus paying the same $5,250 as taxable wages/bonus**. The employer's income-tax deduction is a wash — the payment is deductible compensation expense either way — so payroll tax is the entire employer-side delta.
- **Caveats that change the number:**
  - Employer OASDI (6.2%) only saves to the extent the employee is under the **$184,500** wage base; for an above-base employee the employer saves only **1.45%** ($76.13 at full cap).
  - The employer does **NOT** match the 0.9% Additional Medicare (employee-only tax) — never include it on the employer side.
  - **FUTA (§3306(b)(13)) is also avoided, but is ≈$0 in practice**: FUTA applies only to the first **$7,000** of wages (§3306(b)(1)), which virtually every benefit-receiving employee has already exceeded — so the marginal FUTA saving is zero for typical employees. Do NOT add FUTA to the headline number (this is the "not something else like unemployment tax additions" check from the task — verified: the $401.63 frame is right, unemployment taxes add nothing for normal wage levels). State unemployment (SUTA) wage bases vary; out of scope, one-line note at most.

### 1.7 No double benefit — the excluded interest can't also be deducted

- **§127(c)(7), verbatim:** "No deduction or credit shall be allowed to the employee under any other section of this chapter for any amount excluded from income by reason of this section."
- **§221(e)(1), verbatim (student loan interest deduction side):** "No deduction shall be allowed under this section for any amount for which a deduction is allowable under any other provision of this chapter, or for which an exclusion is allowable under section 127 to the taxpayer by reason of the payment by the taxpayer's employer of any indebtedness on a qualified education loan of the taxpayer."
- → Interest paid by the employer and excluded under §127 does not count toward the employee's up-to-**$2,500** §221 student-loan-interest deduction (§221(b)(1)). Informational note in the tool; not core math (and only the interest portion would ever have been §221-eligible — principal never was).

### 1.8 Qualifying-plan requirements — IRC §127(b) (informational panel, not enforced by the calculator)

All verbatim from §127(b):
- **(b)(1) Written plan:** "a separate written plan of an employer for the exclusive benefit of his employees to provide such employees with educational assistance." ✅ Written plan required, confirmed.
- **(b)(2) Nondiscrimination:** benefits must go to "a classification … found by the Secretary not to be discriminatory in favor of employees who are highly compensated employees (within the meaning of section 414(q)) or their dependents." ✅ Confirmed, with the §414(q) HCE definition.
- **(b)(3) 5%-owner limit:** "Not more than 5 percent of the amounts paid or incurred by the employer for educational assistance during the year may be provided for the class of individuals who are shareholders or owners (or their spouses or dependents), each of whom (on any day of the year) owns more than 5 percent of the stock or of the capital or profits interest in the employer."
- **(b)(4) No cash-out choice:** "A program must not provide eligible employees with a choice between educational assistance and other remuneration includible in gross income." (I.e., it can't be an opt-in alternative to salary.)
- **(b)(5):** the program "is not required to be funded."
- **(b)(6) Notification:** "Reasonable notification of the availability and terms of the program must be provided to eligible employees."
- IRS provides a **sample written plan document** (PDF) linked from the FAQ fact sheet — good outbound citation for the tool's informational panel.

### 1.9 State income tax treatment — flows through in most states; CALIFORNIA does not conform

- Most states start from federal AGI with rolling or regularly-updated conformity → the exclusion flows through automatically (no state income tax on the benefit).
- **California — verified NON-conformer for the loan-repayment leg:** CA's static IRC conformity date predates the CARES Act's addition of §127(c)(1)(B), so while CA conforms to the traditional tuition-type §127 exclusion, **employer student loan repayment IS taxable wages for CA personal income tax**. Conformity bills have repeatedly failed: AB 1729 (2022, did not advance — per the Assembly Rev & Tax analysis of AB 386) and **AB 386 (2025-26 session, "Failed — filed with the Chief Clerk pursuant to Joint Rule 56," Feb 2, 2026)**. As of this spec's date the non-conformity stands.
- Tool treatment: informational caveat + optional state-marginal-rate input with a "does your state conform?" toggle. **Not** a 51-state build; a full state audit was not performed (flagged §6).

---

## 2. Scout-note verdict (confirm / correct)

| Scout-note claim | Verdict | Note |
|---|---|---|
| $5,250 exclusion made PERMANENT by OBBBA | ✅ CONFIRMED | OBBBA §70412(a) struck the 1/1/2026 sunset in §127(c)(1)(B); effective payments after 12/31/2025 |
| Indexed after 2026 | ✅ CONFIRMED, sharpened | First indexed year **2027**; increase rounds to **NEAREST** $50 (can round up — unusual); base year 2025; applies to the whole §127 cap |
| Covers loan principal + interest, to lender or as reimbursement | ✅ CONFIRMED | §127(c)(1)(B) verbatim "whether paid to the employee or to a lender, of principal or interest" |
| Cap SHARED with tuition assistance | ✅ CONFIRMED | Single "educational assistance" definition under one §127(a)(2) cap; IRS FAQ says "combined is $5,250 per calendar year" |
| Employee saves income tax + 7.65% FICA | ✅ CONFIRMED | §3121(a)(18) + §3401(a)(18); FICA leg drops to 1.45–2.35% above the $184,500 wage base |
| Employer saves ~$402/employee payroll tax | ✅ CONFIRMED | $5,250 × 7.65% = **$401.63**, vs.-taxable-wages framing; FUTA adds ≈$0 (first-$7,000 base already exhausted); only $76.13 for above-wage-base employees |
| (Unstated in scout note) loan must be for whose education? | ➕ NEW FINDING | Employee's **own** education only — Parent PLUS for a child does NOT qualify (§127(c)(1)(B) is narrower than §221(d)(1)) |
| (Unstated) excluded interest also deductible under §221? | ➕ NEW FINDING | No — §127(c)(7) + §221(e)(1) double-benefit denial |
| (Unstated) state treatment | ➕ NEW FINDING | Flows through in most states; **California taxes it** (static conformity; AB 386 failed 2/2/2026) |

---

## 3. Exact formulas

### 3.1 Cap and shared-cap logic

```
cap(year):
  year ∈ {2025, 2026}      → 5250
  year ≥ 2027              → 5250 + roundToNearest50(5250 × cola(year))
                             // cola per §1(f)(3), base CY2025 (chained CPI); the official
                             // dollar figure comes from the annual IRS Rev. Proc. —
                             // parameterize, never guess (see F10, §6)

roundToNearest50(x) = 50 × round(x / 50)          // NEAREST, not floor — §127(d)(2)

loanExclusionRoom = max(0, cap − tuitionAssistanceUsed)
excludedLoan      = min(loanRepaymentBenefit, loanExclusionRoom)
excessTaxable     = max(0, loanRepaymentBenefit − loanExclusionRoom)
                    + max(0, tuitionAssistanceUsed − cap)
```

Cap is per **individual per calendar year**, aggregated across all employers.

### 3.2 Employee savings (on `excludedLoan`, vs. receiving it as taxable wages)

```
// OASDI applies only to the slice of the hypothetical extra wages under the SS wage base
oasdiBase   = clamp(ssWageBase − otherWages, 0, excludedLoan)     // ssWageBase 2026 = 184500
addlMedBase = excludedLoan if (otherWages + excludedLoan) > addlMedThreshold, prorate the straddle
              // addlMedThreshold: 200000 single / 250000 MFJ / 125000 MFS (not indexed)

empIncomeTaxSaved = excludedLoan × marginalFedRate
empFicaSaved      = oasdiBase × 0.062  +  excludedLoan × 0.0145  +  addlMedBase × 0.009
empStateSaved     = stateConforms ? excludedLoan × stateMarginalRate : 0
empTotalSaved     = empIncomeTaxSaved + empFicaSaved + empStateSaved
```

Simple mode (default, wages under the base): `empFicaSaved = excludedLoan × 0.0765`.

### 3.3 Employer savings (on `excludedLoan`, vs. paying it as taxable wages)

```
erFicaSaved = oasdiBase × 0.062 + excludedLoan × 0.0145
              // NO 0.9% Additional Medicare match (employee-only tax)
              // NO FUTA term: §3306(b)(13) excludes it too, but the $7,000 FUTA base
              //   is already exhausted for essentially every benefit-receiving employee
              // Income-tax deduction is a wash (deductible compensation either way)
```

Headline at full cap, typical employee: **$5,250 × 7.65% = $401.63**.

### 3.4 Over-cap excess (if `excessTaxable > 0`)

The excess is ordinary taxable wages, BOTH sides:

```
empExcessCost = excessTaxable × (marginalFedRate + empFicaRate + stateRate)
erExcessCost  = excessTaxable × erFicaRate
```

### 3.5 Explicitly NOT in the model

- §68 "2/37" itemized-deduction haircut — irrelevant: §127 is an **exclusion**, not an itemized deduction; a 37%-bracket employee gets the full 37¢/dollar.
- The exclusion reduces **AGI/wages at the source** (Box 1/3/5 never include it) — so unlike the OBBBA below-the-line deductions, it DOES help downstream AGI-driven items (IRMAA, ACA, §221 phaseout, etc.). Worth one line of copy since our charitable/car-loan tools say the opposite about their deductions.
- §132(d) working-condition fringe can shelter tuition-type amounts over $5,250 for job-related education (Pub 15-B), but does NOT apply to loan payments. Footnote only.

---

## 4. Test fixtures

Constants: TY2026; SS wage base $184,500; FICA 6.2% + 1.45%; Additional Medicare 0.9% over $200,000 (single); cap $5,250. Rounding half-up to cents. `wages` = wages excluding the benefit.

| # | Scenario | Inputs | Expected |
|---|---|---|---|
| F1 | Full cap, all loan repayment, typical earner | wages 60,000; loan 5,250; tuition 0; fed 22% | excluded 5,250; excess 0; empIT 1,155.00; empFICA 401.63; empTotal 1,556.63; erSaved 401.63 |
| F2 | Combined use, split | wages 80,000; tuition 3,000; loan 3,000; fed 22% | room 2,250; excludedLoan 2,250; excess 750; savings on loan leg: IT 495.00 + FICA 172.13 = 667.13; excess costs emp 165.00 IT + 57.38 FICA; erSaved 401.63 (on 5,250 total excluded), erExcessCost 57.38 |
| F3 | Low bracket | wages 35,000; loan 5,250; fed 12% | empIT 630.00; empFICA 401.63; empTotal 1,031.63; erSaved 401.63 |
| F4 | 24% bracket | wages 150,000; loan 5,250; fed 24% | empIT 1,260.00; empFICA 401.63; empTotal 1,661.63; erSaved 401.63 |
| F5 | Above SS wage base, below $200k | wages 190,000; loan 5,250; fed 32% | oasdiBase 0; empFICA = 5,250 × 1.45% = 76.13; empIT 1,680.00; empTotal 1,756.13; erSaved 76.13 (headline "$402" must NOT show) |
| F6 | Top bracket + Additional Medicare | wages 700,000; loan 5,250; fed 37% | empFICA = 5,250 × (1.45% + 0.9%) = 123.38; empIT 1,942.50; empTotal 2,065.88; erSaved 76.13 (no 0.9% match) |
| F7 | Over-cap, loan only | wages 90,000; loan 8,000; fed 24% | excluded 5,250; excess 2,750; savings 1,260.00 + 401.63 = 1,661.63; empExcessCost 660.00 IT + 210.38 FICA; erSaved 401.63, erExcessCost 210.38 |
| F8 | Partial benefit under cap | wages 55,000; loan 2,000; fed 22% | excluded 2,000; empIT 440.00; empFICA 153.00; empTotal 593.00; erSaved 153.00; remaining room shown: 3,250 |
| F9 | Shared-cap edge: tuition already maxed | wages 70,000; tuition 5,250; loan 1,200; fed 22% | room 0; excludedLoan 0; entire 1,200 taxable (emp 264.00 IT + 91.80 FICA; er 91.80) — "one cap, not two" |
| F10 | Indexed future year (parameterized — no official figure yet) | TY2027; hypothetical COLA 2.5% | increase = 5,250 × 0.025 = 131.25 → nearest $50 = **150** (rounds UP) → cap **5,400**. Sub-case COLA 2.0%: 105.00 → **100** → cap 5,350. Engine must fail closed to 5,250 + "official 2027 figure pending Rev. Proc." until published |
| F11 | Two employers (aggregation note) | employer A loan 3,000 + employer B loan 3,000; fed 22% | individual-level exclusion capped at 5,250 → 750 taxable at filing even though each employer reasonably excluded its own payment (§3121(a)(18) "reasonable to believe" standard); show income-tax math on 750 (165.00) + reconciliation caveat, don't model withholding mechanics |
| F12 | California resident | wages 90,000; loan 5,250; fed 22%; CA marginal 9.3% | federal savings 1,556.63 as F1-style; **CA does NOT conform** → state income tax still due on 5,250 = 488.25; net shown = 1,556.63 federal − 488.25 state cost vs. the naive "fully tax-free" claim |

Boundary sub-case for the engine (no separate fixture row): wages 182,000 + loan 5,250 straddles the wage base → `oasdiBase = 184,500 − 182,000 = 2,500`; empFICA = 2,500 × 6.2% + 5,250 × 1.45% = 155.00 + 76.13 = 231.13.

---

## 5. Tool-shape recommendations (for the eventual build spec, not binding)

- **Inputs (simple mode):** annual employer loan-repayment benefit; tuition-type assistance already used this year (default 0); marginal federal rate (select, 10–37%); optional state rate + conformity toggle (default "conforms," CA preset flips it).
- **Advanced toggle:** wages (for the wage-base/Additional-Medicare FICA logic), filing status (Additional Medicare threshold).
- **Outputs:** employee saving (income tax + FICA, itemized), employer saving ($401.63 headline with the vs.-taxable-wages framing), shared-cap meter (used / remaining of $5,250), over-cap warning with both-sides excess cost.
- **Informational panel (no math):** §127(b) plan requirements (written plan, §414(q) nondiscrimination, 5%-owner limit, no cash-out choice, notification) + IRS sample-plan-document link; employee's-own-education-only rule; §221 no-double-dip; CA caveat.
- **Cross-links:** student-loan-cap calculator, W-4 withholding helper, the OBBBA cluster. HR/B2B CPM angle per scout note.
- Reuses no existing engine directly (this is an exclusion, not an OBBBA deduction) — but the `window.__OBBBA__` scaffold naming cleanup flagged in the 4th scout run applies if it's wired into that scaffold.

---

## 6. Open uncertainties (flagged, not guessed)

1. **OBBBA section number §70412 — corroborated, not verbatim-verified.** Four independent professional sources (BDO, Mercer, Crowell & Moring, EBEC law) plus the search synthesis all say §70412(a) amended §127(c)(1)(B) and §70412 added §127(d); the Cornell amendment note confirms P.L. 119-21 and the payments-after-12/31/2025 effective date. The enrolled statute PDF (govinfo PLAW-119publ21) was not itself fetched (≈900 pp). Before the tool's citation block ships, one verify pass against the statute PDF page for §70412 is warranted.
2. **2027 indexed cap unknown.** §127(d) mechanics fully verified, but the official 2027 dollar amount awaits the fall-2026 IRS inflation-adjustment Rev. Proc. F10 is parameterized; the engine must not hardcode a guessed 2027 figure.
3. **Full 51-state conformity audit not performed.** California non-conformity is verified (and load-bearing for F12). Other static-conformity states may also tax the benefit; the tool should say "most states" + CA callout + "check your state," not enumerate. If a state build is ever wanted, that's a separate research pass.
4. **Refinanced / consolidated loans.** §221(d)(1) generally treats refinancing of a qualified education loan as still qualified, but this was not verbatim-verified in this pass. The tool shouldn't address refis without that check.
5. **Multi-employer excess mechanics (F11).** The exclusion cap is individual-level, but how the excess gets collected (W-2c vs. return-time reconciliation) wasn't researched — the fixture deliberately models only the income-tax delta and flags the rest as a caveat.
6. **§414(q) HCE dollar threshold for 2026** not verified (informational panel only — cite the section, omit the dollar figure).
7. **FS-2026-10 rounding silence.** The April 2026 IRS FAQ repeats the "adjusted for increases in the cost of living for taxable years beginning after 2026" language but does not restate the nearest-$50 rounding; the rounding rule rests on the Cornell statutory text alone (verbatim, so HIGH confidence — noted only because it diverges from the usual round-down pattern and a reviewer may reflexively "correct" it).

---

## Sources

**Primary (statute, verbatim via law.cornell.edu):**
- [26 USC §127](https://www.law.cornell.edu/uscode/text/26/127) — (a)(2) cap; (b)(1)–(6) plan requirements; (c)(1)(B) loan-payment clause; (c)(7) double-benefit denial; (d) inflation adjustment; P.L. 119-21 amendment note (payments after 12/31/2025)
- [26 USC §3121](https://www.law.cornell.edu/uscode/text/26/3121) — (a)(18) FICA wage exclusion
- [26 USC §3306](https://www.law.cornell.edu/uscode/text/26/3306) — (b)(13) FUTA wage exclusion; (b)(1) $7,000 FUTA base
- [26 USC §3401](https://www.law.cornell.edu/uscode/text/26/3401) — (a)(18) withholding wage exclusion
- [26 USC §221](https://www.law.cornell.edu/uscode/text/26/221) — (b)(1) $2,500 SLI cap; (d)(1) qualified education loan; (e)(1) double-benefit denial

**Primary (IRS / SSA):**
- [IRS FAQ: educational assistance programs](https://www.irs.gov/newsroom/frequently-asked-questions-about-educational-assistance-programs) — FS-2024-22 (June 2024), combined-cap and payment-method language
- [IRS FAQ update](https://www.irs.gov/newsroom/updates-to-frequently-asked-questions-about-educational-assistance-programs) — **FS-2026-10 (April 2026)**, post-OBBBA revision with the "adjusted for increases in the cost of living for taxable years beginning after 2026" language + sample plan document link
- [IRS Publication 15-B (2026)](https://www.irs.gov/publications/p15b) — fringe-benefit exclusion; over-$5,250 amounts are wages
- [SSA press release 2025-10-24](https://www.ssa.gov/news/en/press/releases/2025-10-24.html) — 2026 wage base $184,500 (2025: $176,100), 2.8% COLA

**California non-conformity:**
- [Assembly Rev & Tax analysis, AB 386 (Mar 2025)](https://arev.assembly.ca.gov/system/files/2025-03/ab-386.pdf) — existing CA law taxes employer loan repayment; AB 1729 did not advance
- [CalMatters Digital Democracy, AB 386 status](https://calmatters.digitaldemocracy.org/bills/ca_202520260ab386) — FAILED, filed with Chief Clerk per Joint Rule 56, 2026-02-02

**Secondary corroboration (OBBBA §70412 only):**
- [BDO — IRS Updates FAQ on Section 127](https://www.bdo.com/insights/tax/irs-updates-faq-on-section-127-educational-assistance-programs-key-changes-employers-should-note)
- [Mercer — OBBBA makes tax-free student loan reimbursements permanent](https://www.mercer.com/en-us/insights/law-and-policy/obbba-makes-tax-free-student-loan-reimbursements-permanent/)
- [Crowell & Moring — OBBBA impact on employee benefits](https://www.crowell.com/en/insights/client-alerts/one-big-beautiful-bill-act-impact-on-employee-benefits)
- [EBEC law — Employee benefit provisions in OBBBA](https://ebeclaw.com/the-one-big-beautiful-bill-act/)
