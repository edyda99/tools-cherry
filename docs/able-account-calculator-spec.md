# ABLE Account Contribution Limit Calculator 2026 — Sourced Spec

**Tool slug (proposed):** `/able-account-contribution-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA cluster.
**Prepared:** 2026-07-12.
**Framing:** arithmetic-first contribution calculator (model: our 401k/HSA-style tools), NOT a disability-eligibility or benefits tool. Eligibility appears only as an informational gate with primary-source links; the tool never renders a medical or benefits determination.
**Primary sources:** every load-bearing number verified against **26 U.S.C. §529A** (as amended by SECURE 2.0 §124 and P.L. 119-21 §70115), **Rev. Proc. 2025-32** (read directly from the IRS PDF), **Treas. Reg. §1.529A-2 (T.D. 9923)**, **IRS Pub 907 (2024 PDF read directly; 2025 HTML verbatim)**, the **final (Rev. Apr 2025) and DRAFT (Rev. Dec 2026) Instructions for Forms 1099-QA/5498-QA** (draft PDF read directly), and the **HHS poverty guidelines (90 FR 5917; 91 FR 1797)**. ABLE NRC used only as industry corroboration.

---

## 0. Plain-language summary (read this first)

Three things change at once for ABLE accounts in 2026, and no mainstream SERP page gets all three right:

1. **The eligibility window triples.** Starting with tax years beginning after Dec 31, 2025, an "eligible individual" is someone whose blindness or disability **began (onset) before age 46** — up from 26 (SECURE 2.0 §124). **Onset-based, not current-age-based**: a 58-year-old whose disability began at 30 is eligible; a 40-year-old whose disability began at 47 is not. An estimated ~6M more people qualify, most of whom have never seen an ABLE calculator that models their numbers.
2. **The base limit is $20,000 — and it is NO LONGER the gift-tax exclusion.** OBBBA (P.L. 119-21 §70115) changed §529A's inflation-indexing base year ('1996' instead of '1997'), so for the first time the ABLE limit (**$20,000**, Rev. Proc. 2025-32 §3.34) diverges from the gift-tax annual exclusion (**$19,000**, §3.42(1)). Nearly every secondary source still says "ABLE limit = gift-tax exclusion" — now wrong.
3. **ABLE-to-Work is permanent** (OBBBA §70115 struck the Jan 1, 2026 sunset). An employed beneficiary with no employer-plan contributions that year can add, on top of the $20,000, the **lesser of their compensation or the one-person federal poverty line for their state of residence** — and the FPL differs for **Alaska and Hawaii**, a wrinkle omitted by essentially all SERP prose.

Combined 2026 maximums (base + full ABLE-to-Work, using the poverty-line figures defended in §1.4):

| Residence | Base | ABLE-to-Work max | Combined max |
|---|---|---|---|
| 48 contiguous states + DC | $20,000 | $15,650 | **$35,650** |
| Alaska | $20,000 | $19,550 | **$39,550** |
| Hawaii | $20,000 | $17,990 | **$37,990** |

The cap is **per beneficiary, per year, all contributors combined** (family, friends, the beneficiary, 529 rollovers all draw from the same pool). Excess contributions not returned by the return due date incur a **6% excise tax** (§4973(a)(6), Form 5329 Part VIII).

**One genuine ambiguity, flagged not guessed (§7.1):** which year's HHS poverty guidelines apply to tax year 2026. The statute says the poverty line "as determined for the calendar year preceding the calendar year in which the taxable year begins." IRS documents conflict with each other for TY 2025. The defensible, conservative, industry-matching answer for TY 2026 is the **2025 guidelines ($15,650 / $19,550 AK / $17,990 HI)**; the alternative reading gives the 2026 guidelines ($15,960 / $19,950 / $18,360). We default to the lower set so the tool can never advise an over-contribution, and disclose the ambiguity on-page.

**Confidence:** HIGH on the $20,000 base, the age-46 onset rule, the ABLE-to-Work mechanics, per-beneficiary aggregation, and the AK/HI split. MEDIUM-HIGH on the exact 2026 ABLE-to-Work dollar set (the §7.1 ambiguity — bounded to two known candidate sets, default chosen conservatively).

---

## 1. Primary-source facts (verified, quoted)

### 1.1 Eligibility age — 26 U.S.C. §529A(e)(1), as amended by SECURE 2.0 §124

- **§529A(e)(1)(A) (current text):** an individual is an eligible individual for a taxable year if "the individual is entitled to benefits based on blindness or disability under title II or XVI of the Social Security Act, and such blindness or disability occurred **before the date on which the individual attained age 46**."
- **§529A(e)(1)(B) (second path):** alternatively, "a disability certification with respect to such individual is filed with the Secretary for such taxable year" (medically determinable impairment with marked and severe functional limitations lasting/expected ≥12 months, or blindness) — with the same **onset-before-46** condition.
- **Amendment + effective date:** SECURE 2.0 Act of 2022, **P.L. 117-328, Div. T, §124**, struck "age 26" and inserted "age 46" in §529A(e)(1)(A) and (e)(2)(A)(i)(II). Effective-date note: "The amendments made by this section shall apply to **taxable years beginning after December 31, 2025**." → live now, first year = 2026.
- **IRS operational confirmation (2026 filing products):** DRAFT Instructions for Forms 1099-QA and 5498-QA (Rev. December 2026; draft posted Mar 17, 2026; "these instructions to file and furnish **2026 information** in early 2027"), What's New, verbatim: "**Eligible individual.** For tax year beginning after December 31, 2025, the age limit for determining eligibility based on blindness or disability under title II or XVI of the Social Security Act has increased from 26 to 46. An individual is an eligible individual if they are entitled to benefits due to blindness or disability and such blindness or disability **occurred before the date the individual attained age 46**."
- **The SERP misconception to correct explicitly on-page:** eligibility turns on **age at disability onset**, not the beneficiary's current age. Onset at 30 + currently 58 → eligible. Onset at 47 → not eligible at any current age. Edge: onset **on** the 46th birthday fails ("before the date on which the individual attained age 46"); onset the day before passes.

### 1.2 Base annual limit — §529A(b)(2)(B)(i) + Rev. Proc. 2025-32

- **Statute (current text):** the limit is "the amount in effect under section 2503(b) **(determined by substituting '1996' for '1997' in paragraph (2)(B) thereof)** for the calendar year in which the taxable year begins." The parenthetical was added by **P.L. 119-21 (OBBBA, July 4, 2025) §70115**, effective (per the amendment notes) for **contributions made after December 31, 2025** / taxable years beginning after December 31, 2025.
- **Consequence:** the ABLE limit is now indexed from an earlier base year than the gift-tax exclusion, so the two amounts diverge starting 2026.
- **Rev. Proc. 2025-32 §3.34 (read directly from irs.gov/pub/irs-drop/rp-25-32.pdf), verbatim:** "**Aggregate Limitation on Contributions to ABLE Accounts.** For taxable years beginning in 2026, **$20,000** (instead of instead of the amount under provided in section 4.42(1) of this revenue procedure) is included in the aggregate limitation on contributions to ABLE accounts under § 529A(b)(2)(B)(i)." *(sic — the doubled "instead of" and the "4.42(1)" cross-reference are typos in the official PDF; the gift-exclusion item is §3.42(1).)*
- **Rev. Proc. 2025-32 §3.42(1), verbatim:** "For calendar year 2026, the first **$19,000** of gifts to any person … are not included in the total amount of taxable gifts under § 2503 made during that year." → **2026 ABLE limit $20,000 ≠ 2026 gift-tax exclusion $19,000.** Site copy must not say "equal to the gift-tax exclusion."
- **IRS pointer chain confirming §3.34 is THE number:** the draft 2026 1099-QA/5498-QA instructions tell filers to find the annual limit by going to IRS.gov/InflationAdjustment → the applicable year's revenue procedure → "Search for **Aggregate Limitation on Contributions to ABLE Accounts**."

### 1.3 ABLE-to-Work — §529A(b)(2)(B)(ii) and (b)(7), Treas. Reg. §1.529A-2(g)(2)

- **Statute (b)(2)(B)(ii), current text:** "in the case of any contribution by a designated beneficiary described in paragraph (7), the **lesser of — (I) compensation (as defined by section 219(f)(1)) includible in the designated beneficiary's gross income for the taxable year, or (II) an amount equal to the poverty line for a one-person household, as determined for the calendar year preceding the calendar year in which the taxable year begins**." The former sunset "before January 1, 2026" was **struck by P.L. 119-21 §70115(a)(2)** → ABLE-to-Work is now **permanent**.
- **Who qualifies — §529A(b)(7)(A):** an employee for whom, for the taxable year: "(i) **no contribution is made** … to a defined contribution plan (within the meaning of section 414(i)) with respect to which the requirements of section 401(a) or 403(a) are met, (ii) no contribution is made … to an annuity contract described in section 403(b), and (iii) no contribution is made … to an eligible deferred compensation plan described in section 457(b)."
  - **Stricter than the common summary:** it is "no contribution is made" — an **employer-only** contribution (e.g., a 401(k) match or nonelective) blocks the bonus even if the employee defers nothing. Draft 2026 1099-QA instructions, verbatim: "An employed designated beneficiary is not eligible for the increased contribution limit for the tax year **if any contribution is made on behalf of the employee** to a defined contribution plan (within the meaning of section 414(i)), a section 403(b) plan, or a section 457(b) plan."
  - Only those three categories block. A defined-benefit-plan accrual is not on the statutory list.
- **State of residence — Treas. Reg. §1.529A-2(g)(2) (T.D. 9923), verbatim:** the poverty line is the amount "in the poverty guidelines updated periodically in the Federal Register by the U.S. Department of Health and Human Services under the authority of 42 U.S.C. 9902(2) **for the State of residence of the employed designated beneficiary**" — this is what makes the **Alaska/Hawaii split** load-bearing. Multi-state tie-break, verbatim: "If the designated beneficiary lives in more than one State during the taxable year, the applicable poverty line is the poverty line for the State in which the designated beneficiary **resided longer than in any other State** during that year." (Same rule verbatim in the draft 2026 instructions: "the state or geographic area in which the designated beneficiary resided for the longest period of time during the year.")
- **Compliance burden — §1.529A-2(g)(2), verbatim:** "The employed designated beneficiary, or the person acting on his or her behalf, is **solely responsible** for ensuring that the requirements in section 529A(b)(2)(B)(ii) … are met." Pub 907 mirrors this. → The programs do NOT police the bonus; a calculator has real utility here, and the page should say so.

### 1.4 The poverty-line dollar amounts (the messy part — read carefully)

**HHS guidelines, one-person household (primary: Federal Register / ASPE):**

| Guideline year (publication) | 48 states + DC | Alaska | Hawaii | Citation |
|---|---|---|---|---|
| 2024 (Jan 2024) | $15,060 | $18,810 | $17,310 | quoted in final Rev. Apr 2025 1099-QA/5498-QA instructions |
| **2025 (Jan 17, 2025)** | **$15,650** | **$19,550** | **$17,990** | **90 FR 5917** (doc 2025-01377); ASPE prior-guidelines table ($15,650); AK/HI figures corroborated verbatim by Pub 907 (2025) and ABLE NRC |
| 2026 (Jan 15, 2026) | $15,960 | $19,950 | $18,360 | **91 FR 1797** (doc 2026-00755); ASPE current-guidelines page |

**Which set applies to tax year 2026?** The statute/reg say "the calendar year **preceding** the calendar year in which the taxable year begins" → for TY 2026, the poverty line "determined for" calendar year 2025. IRS practice observed directly:

| IRS document | Tax year | Figures printed | Implied rule |
|---|---|---|---|
| Pub 907 (2024) — PDF read directly | 2024 | $14,580 / $18,210 AK / $16,770 HI (= Jan-2023 set) | TY N → guidelines published Jan (N−1) |
| Instr. 1099-QA/5498-QA (Rev. Apr 2025, final), verbatim: "For 2025, the allowable amount is: $15,060 in the continental United States, $18,810 in Alaska, and $17,310 in Hawaii." | 2025 | Jan-2024 set | TY N → Jan (N−1) |
| Pub 907 (2025) — HTML, verbatim quote | 2025 | $15,650 / $19,550 AK / $17,990 HI (= Jan-2025 set) | **outlier: TY N → Jan N** |
| DRAFT Instr. (Rev. Dec 2026, for 2026 information) | 2026 | **none** — "We removed the threshold amounts for the poverty line amounts throughout these instructions"; points filers to the ASPE guidelines table | ambiguous |
| ABLE NRC (industry, corroboration only) | 2026 | $15,650 / $19,550 / $17,990 (= Jan-2025 set) | TY N → Jan (N−1) |

**Decision for the tool: use the Jan-2025-published set for TY 2026 — $15,650 / $19,550 AK / $17,990 HI.** Rationale: (a) it is the natural statutory reading (guidelines in effect during the preceding calendar year); (b) it matches 2 of the 3 year-consistent IRS data points and the final (not draft) instructions pattern; (c) it matches what ABLE programs/industry actually publish for 2026, so users cross-checking won't see us contradicted; (d) it is the **lower** set, so the tool can never induce an over-contribution. The Pub 907 (2025) outlier and the alternative $15,960/$19,950/$18,360 reading are disclosed in §7.1 and in an on-page methodology note.

### 1.5 Per-beneficiary aggregation, rollovers, and what counts

- **§529A(b)(2)(B) lead-in, current text:** "except in the case of contributions under subsection (c)(1)(C) **or received in a qualified ABLE rollover contribution described in section 530A(d)(4)(B)**, if such contribution to an ABLE account would result in **aggregate contributions from all contributors** to the ABLE account for the taxable year exceeding the sum of—" (i) + (ii). → One pool per beneficiary per year; family, friends, trusts, and the beneficiary all draw from it.
- **Counts against the pool:** cash contributions from anyone, **and 529→ABLE rollovers**. Pub 907 (2024), verbatim: "The total annual contributions to an ABLE account (**including amounts rolled over from a section 529 account**, but not other amounts received in rollovers and/or program-to-program transfers between ABLE accounts) are limited to…". §529(c)(3)(C)(i) flush text, verbatim: "Subclause (III) shall not apply to so much of a distribution which, when added to all other contributions made to the ABLE account for the taxable year, **exceeds the limitation under section 529A(b)(2)(B)(i)**" — note the rollover counts against the **base (i)** limit specifically; it cannot ride in the ABLE-to-Work bonus space.
  - 529→ABLE rollovers were themselves scheduled to die Jan 1, 2026; **P.L. 119-21 §70117(a)** "struck out 'before January 1, 2026,'" — **permanent**, effective TY beginning after Dec 31, 2025.
- **Excluded from the pool:** ABLE→ABLE rollovers and program-to-program transfers (§529A(c)(1)(C); reg §1.529A-2(g)(3)), and the new **Trump-account→ABLE "qualified ABLE rollover contribution"** (§530A(d)(4)(B), reported in new Form 5498-QA box 8; per the draft 2026 instructions it is "only permitted when the full balance of the beneficiary's Trump account is transferred directly (trustee-to-trustee) into an ABLE account in the calendar year the beneficiary turns 17"). Out of scope for v1 (§6) but the exclusion must be stated on-page so we don't imply it eats the cap.
- **Only cash:** "All contributions must be in cash" (draft 2026 instructions; §529A(b)(2)(A)).
- **One account per beneficiary** (§529A(b)(1)(B); Pub 907).
- **Cumulative (lifetime-balance) cap:** contributions stop once the account hits the **state's §529 QTP limit** (§529A(b)(6); varies by state, roughly $235k–$600k). Not modeled in v1 (§6); one-line note on-page.

### 1.6 What happens if you exceed the limit

- **§4973(a)(6):** ABLE accounts are subject to the excise tax; rate = "**6 percent** of the amount of the excess contributions" (capped at 6% of account value at year-end).
- **§4973(h):** excess = contributions beyond the §529A(b)(2)(B) limit (excluding §529A(c)(1)(C) amounts and §530A(d)(4)(B) qualified ABLE rollover contributions); excess **returned on or before the return due date (including extensions)** is "treated as an amount not contributed."
- **Pub 907 (2024), verbatim:** "You're subject to a 6% excise tax on the excess contributions and earnings that aren't returned by the ABLE program to the contributors by the due date (including any extensions) of your income tax return. You figure this tax on **Form 5329, Part VIII**." Programs must return excess + attributable earnings and notify (reg §1.529A-2(g)(4); draft 2026 instructions "Return of excess contributions…").

---

## 2. Task-framing verdict (confirm / correct)

- ✅ **Age-46 onset (not current age) — CONFIRMED**, and the misconception correction is exactly right: statute + draft 2026 IRS instructions both hinge on when the disability "occurred," with no ceiling on current age. Effective for tax years beginning after Dec 31, 2025 — CONFIRMED.
- ✅ **$20,000 base for 2026 — CONFIRMED** (Rev. Proc. 2025-32 §3.34), but ⚠️ **CORRECTION 1:** it is **not** "tied to the gift-tax annual exclusion" anymore. OBBBA §70115 decoupled the indexing; the 2026 gift exclusion is $19,000. Any copy equating them is wrong as of 2026 — this is a differentiator, since most SERP pages will republish the old equation.
- ✅ **ABLE-to-Work = lesser of compensation or one-person FPL by state of residence — CONFIRMED**, plus two refinements: ⚠️ **CORRECTION 2:** the blocker is "**any contribution made on behalf of the employee**" to a 414(i) DC plan / 403(b) / 457(b) — employer-only contributions block it too, not just the beneficiary "contributing." ⚠️ **CORRECTION 3:** the bonus space can only be occupied by the **beneficiary's own** contributions (statute: "contribution by a designated beneficiary described in paragraph (7)"); family money can never use it.
- ⚠️ **CORRECTION 4 — the task asked for the 2026 FPL figures, but the statute points to the *preceding* calendar year's poverty line.** For TY 2026 the defensible figures are the **2025** guidelines ($15,650/$19,550/$17,990), with a documented intra-IRS inconsistency (§1.4, §7.1). The 2026 guidelines ($15,960/$19,950/$18,360, 91 FR 1797) are captured too — under the default reading they apply to TY **2027**.
- ✅ **Per-beneficiary, all-sources pool — CONFIRMED** (§529A(b)(2)(B) "aggregate contributions from all contributors").
- ✅ **529→ABLE rollovers interact — CONFIRMED and now permanent** (OBBBA §70117): they consume base-limit room. Trump-account→ABLE rollovers (new, 2026) are explicitly **excluded** from the cap. Both documented; only the 529 rollover is modeled in v1 (as an optional input), the Trump-account rollover is a stated exclusion (§6).

---

## 3. Calculator design

### 3.1 Inputs

1. **Tax year:** fixed 2026 for v1 (2025 comparison values shown as static content, §3.5).
2. **Eligibility gate (informational):** "How old was the beneficiary when the disability or blindness began?" → numeric or simple `<46` / `46 or older` choice. If ≥46: stop with a plain-language explainer (2026 expansion covers onset before 46; cite SECURE 2.0 §124) + link to ssa.gov and the state ABLE program. No medical questions, no benefit questions beyond the statutory onset age.
3. **State of residence:** 51-state dropdown mapped internally to 3 buckets (48+DC / AK / HI) — friendlier than asking users to know the bucket. Note the longest-residence rule for movers.
4. **Employed with W-2 or self-employment income?** (yes/no)
   - If yes: **compensation for 2026** ($, §219(f)(1) compensation includible in gross income — plain-language helper: "wages, salary, tips, net self-employment earnings").
   - If yes: **"Will any money go into a workplace retirement plan for you in 2026 — including employer matching or automatic contributions — such as a 401(k), 403(b), or 457(b)?"** (yes/no). Copy must say *any* contribution, *including employer-only*.
5. **Contributions this year:**
   - From family/friends/trusts/others ($) — `others`
   - From the beneficiary themself ($) — `own`
   - Optional (collapsed): 529→ABLE rollover ($) — `rollover529`

### 3.2 Constants (TY 2026)

```
BASE_LIMIT_2026        = 20000                       // Rev. Proc. 2025-32 §3.34
FPL_ONE_PERSON_2026TY  = { contiguousDC: 15650, AK: 19550, HI: 17990 }
                                                     // 2025 HHS guidelines, 90 FR 5917 (see §7.1)
```

### 3.3 Formula

```
bonusEligible = employed
                && !anyWorkplacePlanContribution        // 414(i) DC / 403(b) / 457(b), incl. employer-only
bonusCap      = bonusEligible ? min(compensation, FPL[stateBucket]) : 0

// Only the beneficiary's own contributions may occupy bonus space:
totalLimit    = BASE_LIMIT + min(own, bonusCap)

totalContrib  = others + rollover529 + own
excess        = max(0, totalContrib - totalLimit)

// Room displays:
ownAllowed    = max(0, BASE_LIMIT - (others + rollover529)) + bonusCap
roomOwn       = max(0, ownAllowed - own)
roomOthers    = max(0, BASE_LIMIT - (others + rollover529) - max(0, own - bonusCap))
combinedMax   = BASE_LIMIT + bonusCap
```

Equivalence note (proof obligation for fixtures): `excess` from the compact form equals the decomposed form `max(0, others + rollover529 − BASE_LIMIT) + max(0, own − (max(0, BASE_LIMIT − others − rollover529) + bonusCap))` whenever the base is not overfilled by others alone; fixture 11 exercises the branch where beneficiary money spills from bonus into base.

### 3.4 Outputs

- Headline: **combined maximum** for this user (base + their personal ABLE-to-Work cap), remaining room, and — if over — the **excess amount** with the 6%-excise / return-by-due-date explainer (Form 5329 Part VIII; the program must return excess + earnings if asked by the due date).
- Breakdown bar: base $20,000 pool usage (others + rollover + beneficiary spillover) vs bonus pool usage (beneficiary only).
- Static callouts: per-beneficiary all-sources rule; beneficiary is *solely responsible* for ABLE-to-Work compliance (reg quote); AK/HI difference; "limit ≠ gift-tax exclusion as of 2026"; methodology note on the FPL-year ambiguity (§7.1).

### 3.5 "What changed for 2026" content block (static, high-value)

| | 2025 | 2026 |
|---|---|---|
| Onset-age eligibility | before 26 | **before 46** (SECURE 2.0 §124) |
| Base limit | $19,000 (= gift exclusion) | **$20,000** (decoupled; gift exclusion is $19,000) |
| ABLE-to-Work (48+DC / AK / HI) | $15,060 / $18,810 / $17,310 (final Rev. Apr 2025 instr.) | **$15,650 / $19,550 / $17,990** (see §7.1) |
| ABLE-to-Work + 529→ABLE status | scheduled to expire 1/1/2026 | **permanent** (OBBBA §§70115, 70117) |

---

## 4. Test fixtures (TY 2026; FPL set per §1.4 decision)

All fixtures assume onset-eligible unless stated. `others` includes family/friends/trusts; `own` = beneficiary's own contributions; blank rollover = 0.

| # | Scenario | State | Employed / comp / plan? | others | own | roll529 | bonusCap | totalLimit | excess | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Under base, no work | 48+DC | no | 10,000 | 0 | — | 0 | 20,000 | 0 | room = 10,000 |
| 2 | Exactly at base | 48+DC | no | 12,000 | 8,000 | — | 0 | 20,000 | 0 | room = 0; no-bonus beneficiary money counts against base |
| 3 | Over base, no work | 48+DC | no | 25,000 | 0 | — | 0 | 20,000 | **5,000** | show 6% excise / return-by-due-date messaging |
| 4 | Full ABLE-to-Work | 48+DC | yes / 30,000 / no | 20,000 | 15,650 | — | 15,650 | 35,650 | 0 | headline combined max case |
| 5 | Comp-limited bonus | 48+DC | yes / 6,000 / no | 16,000 | 10,000 | — | 6,000 | 26,000 | 0 | bonus = comp (6,000) < FPL; own 10,000 = 6,000 bonus + 4,000 base; base usage 20,000 exactly |
| 6 | Bonus blocked by employer match | 48+DC | yes / 30,000 / **yes (employer-only match)** | 18,000 | 5,000 | — | **0** | 20,000 | **3,000** | employer-only contribution blocks — Correction 2 |
| 7 | Alaska, full bonus | AK | yes / 50,000 / no | 20,000 | 19,550 | — | 19,550 | **39,550** | 0 | AK FPL ≠ 48-state FPL |
| 8 | Hawaii, full bonus | HI | yes / 50,000 / no | 20,000 | 17,990 | — | 17,990 | **37,990** | 0 | HI FPL third distinct value |
| 9 | Onset 30, now 58 | 48+DC | no | 20,000 | 0 | — | 0 | 20,000 | 0 | must proceed normally — onset, not current age |
| 10 | Onset 47, now 40 | — | — | — | — | — | — | — | — | gate stops before math: not an eligible individual; explain SECURE 2.0 §124; no contribution limit exists |
| 11 | Beneficiary-heavy overflow | 48+DC | yes / 40,000 / no | 18,000 | 20,000 | — | 15,650 | 35,650 | **2,350** | own fills bonus 15,650 + base 2,000; 2,350 spills over |
| 12 | 529 rollover eats base | 48+DC | no | 16,000 | 0 | 5,000 | 0 | 20,000 | **1,000** | rollover counts against base (i) only; message: excess of a 529→ABLE rollover loses rollover treatment (§529(c)(3)(C)(i) flush text) |

Cross-checks: #4/#7/#8 headline values must equal §0's combined-max table. #5 exercises `min(own, bonusCap)` binding at comp. #11 exercises the spill branch in §3.3's equivalence note. If §7.1 resolves to the 2026-guideline reading, fixtures 4, 5(unchanged), 7, 8, 11 change to bonusCap 15,960 / 19,950 / 18,360 with totals 35,960 / 39,950 / 38,360 and #11 excess 2,040 — keep these as commented alternate expectations in the fixture file.

---

## 5. Page copy requirements (differentiators, all sourced above)

1. Onset-before-46 explainer with the "not your current age" correction, front and center (biggest 2026 search intent, most-botched fact).
2. "$20,000 is not the gift-tax exclusion anymore" note (unique vs. SERP).
3. AK/HI-aware ABLE-to-Work (universally omitted); state dropdown handles it silently.
4. Employer-only match blocks the bonus (universally oversimplified).
5. "You, not your ABLE program, are responsible for the ABLE-to-Work limit" (reg §1.529A-2(g)(2) quote) — the reason a calculator is genuinely useful.
6. FPL-year methodology note (honest, cited, conservative default).
7. Standard site disclaimer: educational tool, not tax/legal/benefits advice; no eligibility determination performed.

---

## 6. Explicitly out of scope for v1 (stated, not silently omitted)

- **Trump-account→ABLE rollovers** (§530A(d)(4)(B), new Form 5498-QA box 8): excluded from the annual cap by statute; narrow (full balance, trustee-to-trustee, calendar year beneficiary turns 17); guidance still draft-stage. One-line on-page note that it does NOT consume the cap; no input field.
- **State cumulative balance caps** (§529A(b)(6), = each state's 529 QTP limit) and the SSI $100,000 resource-count threshold / Medicaid payback: benefits-interaction territory (YMYL) — link out (SSA, ABLE NRC), never compute.
- **ABLE saver's credit** (Form 8880): contributions may qualify; OBBBA reportedly made the treatment permanent but that section was NOT verified in this pass — do not state permanence on-page without verifying (flagged §7.4).
- **Tax year 2025 mode:** shown only as the static comparison table (§3.5), not a computable mode (avoids also importing the 2025 FPL conflict, §7.2).
- **Prorated/short taxable years, deceased-beneficiary rules, loss-of-eligibility mid-year** (§529A(b)(2) nuances beyond scope for an annual planning tool).

---

## 7. Open uncertainties / could not verify with confidence

1. **Which HHS guideline year applies to TY 2026 ABLE-to-Work (the §1.4 decision).** Statutory text says preceding-calendar-year; IRS's own products conflict for TY 2025 (final 1099-QA instructions: $15,060 set vs Pub 907 (2025): $15,650 set — a $590 intra-IRS discrepancy), and the 2026-information draft instructions removed printed figures entirely, pointing to the (current-year) ASPE table. Default = 2025 guidelines ($15,650/$19,550/$17,990): statute-natural, majority-pattern, industry-matching, conservative. **Revisit when the final Rev. Dec 2026 instructions and/or Pub 907 (2026) publish** — if IRS prints the $15,960 set, flip the constant and the commented fixture alternates.
2. **The Pub 907 (2025) outlier itself** — could not determine whether it is an IRS drafting error or a deliberate reinterpretation ("determined for calendar year N−1" = the guidelines *computed from* year-N−1 price data, i.e., published Jan of year N). Both readings are defensible from the HHS notice language ("reflect price changes through calendar year [N−1]"). Not load-bearing for our default (we chose the lower set), but it is why confidence on the exact bonus dollars is MEDIUM-HIGH not HIGH.
3. **Rev. Proc. 2025-32 §3.34 typos** ("instead of instead of", "the amount under provided", cross-ref "4.42(1)"): the $20,000 figure and §529A(b)(2)(B)(i) reference are unambiguous, but if IRS issues a correcting bulletin the wording may change — cite the Rev. Proc. generally, not the typo'd sentence, on-page.
4. **OBBBA and the ABLE saver's credit:** not verified in this pass (only §§70115 and 70117 were verified against the US Code amendment notes). Do not claim saver's-credit permanence on-page without checking P.L. 119-21's text first.
5. **SECURE 2.0 §124 conforming amendments** were verified via the US Code compilation and its notes (Cornell LII mirror of uscode.house.gov; uscode.house.gov itself refused connections today) — not against the enrolled-bill PDF on congress.gov. The compilation + the IRS draft instructions agreeing on age 46/effective-date makes residual risk negligible, but a build-time double-check against congress.gov costs one fetch.
6. **"~6M newly eligible" estimate** (used in §0 for marketing framing) is a commonly cited advocacy figure (ABLE NRC/NDI), not primary-verified — keep it off the tool page or attribute it explicitly.

---

## 8. Source register

| # | Source | What it verified |
|---|---|---|
| 1 | 26 U.S.C. §529A (current through P.L. 119-21), via Cornell LII mirror of the US Code | (b)(2)(B) lead-in + (i) + (ii); (b)(7)(A); (e)(1)(A)–(B); amendment notes for P.L. 117-328 §124 and P.L. 119-21 §70115 |
| 2 | SECURE 2.0 Act of 2022, P.L. 117-328, Div. T, §124 (via US Code notes) | age 26→46; effective TY beginning after Dec 31, 2025 |
| 3 | OBBBA, P.L. 119-21 (Jul 4, 2025), §70115 and §70117 (via US Code notes to §§529A, 529) | '1996'-for-'1997' indexing change; ABLE-to-Work sunset struck; 529→ABLE rollover sunset struck; effective dates |
| 4 | Rev. Proc. 2025-32 (IRS PDF, irs.gov/pub/irs-drop/rp-25-32.pdf, read directly pp. 15–28) | §3.34: **$20,000** ABLE aggregate limitation TY2026; §3.42(1): $19,000 gift exclusion CY2026 |
| 5 | Treas. Reg. §1.529A-2(g)(2)–(g)(4) (T.D. 9923) | state-of-residence FPL; longest-residence tie-break; beneficiary solely responsible; rollover/transfer exclusions; return of excess |
| 6 | IRS Pub 907 (2024) — PDF read directly, pp. 7–9 | verbatim contribution-limitation paragraph; $14,580/$18,210/$16,770 for TY2024; 6% excise / Form 5329 Part VIII; 529-rollover-counts language; cumulative state limit |
| 7 | IRS Pub 907 (2025) — HTML, verbatim-transcribed | $19,000 base TY2025; the $15,650/$19,550/$17,990 outlier print (§7.2); AK/HI 2025-guideline corroboration |
| 8 | Instructions for Forms 1099-QA & 5498-QA, Rev. Apr 2025 (final, HTML, verbatim-transcribed) | "$19,000 … in 2025"; "For 2025, the allowable amount is: $15,060 … $18,810 in Alaska, and $17,310 in Hawaii" |
| 9 | DRAFT Instructions for Forms 1099-QA & 5498-QA, Rev. Dec 2026 (IRS draft PDF read directly; posted Mar 17, 2026) | age-46 What's New for 2026 information; "any contribution … on behalf of the employee" blocker; all-contributors aggregate; Trump-account rollover (box 8) mechanics; removal of printed FPL amounts; Rev.-Proc. pointer chain |
| 10 | HHS Poverty Guidelines: 90 FR 5917 (Jan 17, 2025) and 91 FR 1797 (Jan 15, 2026); ASPE guidelines pages | one-person figures: 2025 = $15,650/$19,550/$17,990; 2026 = $15,960/$19,950/$18,360; FR citations via federalregister.gov API |
| 11 | 26 U.S.C. §4973(a)(6), (h) | 6% excise; excess definition; return-by-due-date escape |
| 12 | 26 U.S.C. §529(c)(3)(C)(i) | 529→ABLE rollover counts against §529A(b)(2)(B)(i); permanence (§70117) |
| 13 | ABLE NRC (ablenrc.org) — secondary, corroboration only | 2026: $20,000 + $15,650/$19,550/$17,990; per-beneficiary all-sources framing |
