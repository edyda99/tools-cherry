# W-4 2026 Overtime & Tips Withholding Helper — Sourced Spec

**Tool slug (proposed):** `/w4-overtime-tips-withholding-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA calculators (tips / overtime / SALT / car-loan / senior).
**Prepared:** 2026-07-12. Every claim about the 2026 Form W-4 and the 2026 W-2 Box 12 codes verified against IRS primary sources (the final 2026 Form W-4 PDF, Pub 15-T, and the 2026 General Instructions for Forms W-2 and W-3).

---

## 0. Plain-language summary (read this first)

The OBBBA "no tax on tips" and "no tax on overtime" deductions are claimed **at filing** on your 2026 return (new Schedule 1-A). Your **paycheck** doesn't automatically know about them, so all year your employer withholds federal income tax as if that income were fully taxable. Result: you're **over-withheld**, and the money comes back as a bigger refund next spring instead of showing up in each paycheck now.

This tool solves exactly that timing gap. It estimates the tips/overtime deduction you'll actually get, then tells you **what to enter on your 2026 Form W-4 Step 4(b) Deductions Worksheet** so your employer withholds less **now** — turning a once-a-year refund into a little more take-home every payday.

**Three corrections to the common framing (all verified below):**
- It is **Step 4(b)** (deductions, which *lower* withholding), **not Step 4(c)**. Step 4(c) is *extra* withholding — it does the opposite. Any guide telling tipped/overtime workers to use 4(c) for this is wrong.
- You **add** your estimate to the Deductions Worksheet (it flows into a bigger Step 4(b) figure). You are not "reducing" a Step 4(b) number — you're increasing the deduction total, which is what cuts withholding.
- There is **no separate new "worksheet" or "step"** just for overtime/tips. The 2026 W-4 added **new lines 1a (tips) and 1b (overtime)** to the *pre-existing* Step 4(b) Deductions Worksheet.

**The W-2 Box 12 codes (TT / TP) are a separate thing** and are NOT a withholding tool. They are year-end reporting on your 2026 W-2 that tells you (and the IRS) how much qualified overtime/tips you were paid, so you can fill in Schedule 1-A when you file. They do not change your paycheck. This tool references them only so a worker knows where next year's real number will come from.

**Confidence:** HIGH on every load-bearing claim. Two items flagged UNCERTAIN in §7 (both non-load-bearing). Reuse of the existing engine is ~100% (§5).

---

## 1. What the 2026 W-4 actually changed (verified against the form itself)

Source of record: the **final 2026 Form W-4** (`https://www.irs.gov/pub/irs-pdf/fw4.pdf`, "Created 12/8/25"), extracted and read directly, plus **Pub 15-T (2026)**.

### 1.1 The mechanism is Step 4(b) + an expanded Deductions Worksheet

The 2026 Form W-4 face is nearly unchanged: Step 4(b) still reads *"Deductions. Use the Deductions Worksheet on page 4 to determine the amount of deductions you may claim, which will reduce your withholding … Enter the result here."* The change is on **page 4**, the **"Step 4(b) — Deductions Worksheet,"** which for 2026 was rebuilt to include OBBBA deductions. The relevant lines, **quoted verbatim**:

> **1** Deductions for qualified tips, overtime compensation, and passenger vehicle loan interest.
> **1a** Qualified tips. If your total income is less than $150,000 ($300,000 if married filing jointly), enter an estimate of your qualified tips up to **$25,000**.
> **1b** Qualified overtime compensation. If your total income is less than $150,000 ($300,000 if married filing jointly), enter an estimate of your qualified overtime compensation up to **$12,500 ($25,000 if married filing jointly)** of the **"and-a-half" portion of time-and-a-half compensation**.
> **1c** Qualified passenger vehicle loan interest … up to $10,000.
> **2** Add lines 1a, 1b, and 1c.
> …
> **15** Add lines 2, 4, 5, and 14. **Enter the result here and in Step 4(b) of Form W-4.**

So: the worker estimates tips on **1a** and the overtime **premium** on **1b**; those roll up through line 2 into the line-15 total, which they copy to **Step 4(b)** on the W-4 face. (Lines 3a/3b are the senior deduction; line 5 is other above-the-line adjustments; lines 6–14 are the itemize-vs-standard machinery — all pre-existing.)

**Verdict on the roadmap's framing:** directionally correct — there genuinely *is* a formal 2026 W-4 mechanism for overtime/tips withholding, and it's not just informal Step 4(b) guesswork. But it is **new lines on the existing Deductions Worksheet feeding Step 4(b)**, not a standalone new worksheet or a new "Step." The tool's copy must describe it precisely (line 1a / line 1b → Step 4(b)), or it will send users looking for a page that doesn't exist.

### 1.2 Two precision points the tool must get right

1. **Overtime = the "and-a-half" (premium/half) portion only.** Line 1b says so explicitly ("the 'and-a-half' portion of time-and-a-half compensation"). This is the same 0.5× premium the existing engine already computes — NOT the full time-and-a-half. (Cross-verified against the IRS Q&A on qualified overtime: *"the 'half' portion of the 'one and one-half times' … is qualified overtime compensation."*)
2. **The worksheet uses a simple income CLIFF, not the gradual phase-out.** Lines 1a/1b say "*if* your total income is less than $150,000 ($300,000 MFJ)" then enter up to the cap — with no instruction above that line, i.e. the form implies you enter $0 once you're over the cliff. The *actual filing-time deduction* phases out **gradually** at $100 per $1,000 of MAGI over the threshold (single fully gone at $275k OT / $400k tips; MFJ $550k). **The tool should compute the real gradual-phase-out deduction** (via the existing engine) and let the user put that more-accurate figure straight on Step 4(b) — that is legitimate (the employer only sees the Step 4(b) number; the worksheet is "keep for your records") and prevents a worker between $150k and full phase-out from needlessly entering $0 and staying over-withheld. Flag this divergence in the UI (§7).

### 1.3 Other 2026 W-4 changes (context, not used by this tool)
Step 3 split into 3(a)/3(b) with the child credit raised to **$2,200**; new line 1c (car-loan interest) and lines 3a/3b (senior) on the same worksheet; 2026 standard-deduction figures on line 11 ($16,100 single / $32,200 MFJ / $24,150 HoH — matches this repo's `tax-data-2026.json`).

---

## 2. How Step 4(b) turns into less withholding (the load-bearing math)

Verified against **Pub 15-T (2026), Worksheet 1A (Percentage Method)**. The employer's per-period computation, in order:

1. Annualize this period's wages (× pay periods).
2. **Add** Step 4(a) other income → *line 1e*.
3. **Subtract** Step 4(b) (*line 1f*) **and** a built-in standard-deduction proxy (*line 1g*: $0 if the Step 2 box is checked, otherwise a fixed status amount) → *line 1i, the **Adjusted Annual Wage Amount***.
4. Look up tentative annual withholding on the percentage brackets.
5. Divide by pay periods; subtract Step 3 credits per period; **add** Step 4(c) extra withholding.

The key fact: **Step 4(b) is subtracted dollar-for-dollar from the annualized wage before the brackets are applied** (Pub 15-T line 1i). So adding a deduction `D` to Step 4(b) lowers annual withholding by approximately `marginal withholding rate × D` — evaluated exactly across any bracket boundaries the deduction spans.

### 2.1 The exact translation the calculator uses

Let `D_total` = (allowed tips deduction) + (allowed overtime-premium deduction), each after its own cap and MAGI phase-out.

```
annualWithholdingReduction ≈ federalTaxSaved(income, filingStatus, D_total)
                           = tax(income − stdDed) − tax(income − stdDed − D_total)   // exact bracket-diff
perPaycheckTakeHomeIncrease ≈ annualWithholdingReduction / payPeriods
```

- **Compute ONE combined `federalTaxSaved` on `D_total`, not the sum of two separate calls.** Two deductions stack on the same income; summing independent single-deduction results mis-handles the marginal rate where they span a bracket edge. (Fixture **F9** proves this: at $280k MFJ a $42k combined deduction crosses the 24%→22% boundary — $9,968 actual vs a naïve flat 24% × 42,000 = $10,080.)
- This is the **same** exact-bracket-diff machinery the existing tips/overtime tools already use, applied to the same 2026 brackets + standard deduction. Because Pub 15-T subtracts Step 4(b) dollar-for-dollar and applies essentially those same brackets, the filing-time tax saved and the annual withholding reduction converge to the same number — which is the whole point (match withholding to the real tax, so no big refund and no big bill).

### 2.2 Honest caveats to surface (not hide)
- Withholding is an **approximation**: Pub 15-T's built-in standard-deduction proxy and the Step 2 checkbox shift which bracket the adjusted wage lands in, so the per-paycheck figure is an estimate, not a guarantee. Label it "approximately."
- **FICA is unaffected.** Social Security (6.2%) + Medicare (1.45%) are still withheld on every tip and overtime dollar. This deduction touches **federal income-tax withholding only**.
- **State withholding is unaffected** unless the worker's state conforms (most decouple — see this repo's per-state conformity data). The tool is federal-only; link to the state pages.
- **Mid-year adjustment nuance:** if the worker files a new W-4 partway through the year, the full annual reduction is spread over the *remaining* paychecks, so each remaining check rises by more than the full-year figure. The default calculation assumes a full-year adjustment; optionally offer a "months left in the year" refinement (§3.3).

---

## 3. Calculator mechanics

### 3.1 Inputs

| Input | Type | Notes |
|---|---|---|
| `filingStatus` | select | `single` / `married` (MFJ) / `head_of_household`. MFS is ineligible for both deductions — omit or hard-block with a note. |
| `annualIncome` | number | Total expected 2026 income (≈ MAGI). Drives brackets, the phase-out, and the marginal rate. Label "your total expected 2026 income (all sources)." |
| `payFrequency` | select | weekly (52) / biweekly (26) / semimonthly (24) / monthly (12). Sole driver of the per-paycheck divisor. |
| `annualTips` | number | Expected qualified **cash/charged** tips for the year. Cap messaging at $25,000. 0 → tips path off. |
| overtime entry | see 3.2 | Give **one** obvious way to enter it (human-friendly rule). |
| `monthsRemaining` | number (optional) | Default 12 → full-year. If < 12, per-paycheck uses remaining periods (§3.3). Keep it optional/advanced. |

**Do NOT** add a Step 4(c) input — 4(c) increases withholding and is irrelevant here; offering it invites the exact mistake this tool corrects.

### 3.2 Overtime entry — one obvious way
Mirror the existing overtime tool: accept **regular hourly rate + annual overtime hours**, and compute the premium internally as `overtimePremium(rate, hours) = 0.5 × rate × hours`. Provide an **optional** "I already know my overtime premium (the 'half' portion)" direct-entry field for workers reading it off a pay stub / anticipated W-2 Box 12 TT. Do not show both a "full overtime pay" and a "premium" field competing — that was the CAGR-style redundant-input mistake called out in memory.

### 3.3 Outputs
1. **Estimated 2026 deduction** — broken out: tips `D_tips`, overtime `D_ot`, total `D_total`; show when a cap or phase-out bound it.
2. **What to put on your W-4** — a copy-ready block:
   - "Step 4(b) Deductions Worksheet, **line 1a (Qualified tips): $D_tips**"
   - "line **1b (Qualified overtime): $D_ot**"
   - "These add **$D_total** to your Step 4(b) total (line 15)."
   (If income is over the cliff but under full phase-out, show the gradual-phase-out figure and the §1.2 note that you can enter it directly on Step 4(b).)
3. **Annual federal withholding reduction** ≈ `federalTaxSaved(income, status, D_total)`.
4. **Extra take-home per paycheck** ≈ annual reduction ÷ pay periods (÷ remaining periods if `monthsRemaining` < 12).
5. **Caveats row**: FICA still withheld; state unaffected unless conforming; estimate not a guarantee.

### 3.4 Constants
None new. Reuse `obbba-deductions-2026.json` (`federal.tips`, `federal.overtime`) and `tax-data-2026.json` (`federal` brackets + standard deduction). Pay-period map `{weekly:52, biweekly:26, semimonthly:24, monthly:12}` is the only new literal.

---

## 4. Primary sources

| # | Source | What it anchors | URL |
|---|---|---|---|
| P1 | **Final 2026 Form W-4** (PDF, "Created 12/8/25") | Step 4(b) text; the page-4 Deductions Worksheet lines 1a (tips ≤$25k), 1b (overtime premium ≤$12.5k/$25k), line 15 → Step 4(b); $150k/$300k cliff; 2026 std-deduction on line 11 | https://www.irs.gov/pub/irs-pdf/fw4.pdf |
| P2 | **Pub 15-T (2026), Worksheet 1A** | Step 4(b) subtracted dollar-for-dollar (line 1f→1i); 4(a) added; std-ded proxy (line 1g); 4(c) added per period | https://www.irs.gov/publications/p15t |
| P3 | **2026 General Instructions for Forms W-2 and W-3** | New Box 12 codes TT / TP / TA; new Box 14b; year-end cumulative totals | https://www.irs.gov/instructions/iw2w3 |
| P4 | **IRS Q&A — new deduction for qualified overtime** | "half" portion only is qualified overtime; premium = amount exceeding the regular rate | https://www.irs.gov/newsroom/questions-and-answers-about-the-new-deduction-for-qualified-overtime-compensation |
| P5 | **IRS — OBBBA deductions for working Americans and seniors** | $12,500/$25,000 OT cap, $25,000 tips cap, $150k/$300k phase-out start, above-the-line, 2025–2028 | https://www.irs.gov/newsroom/one-big-beautiful-bill-act-tax-deductions-for-working-americans-and-seniors |
| P6 | **IRS Notice 2025-69** | Reasonable methods to compute the 2025 qualified overtime/tips amounts | https://www.irs.gov/pub/irs-drop/n-25-69.pdf |

**Secondary corroboration** (cross-check only, never the number of record): Experian Employer Services (final 2026 W-4 / W-2 write-ups), NATP (draft W-2 codes), payroll.org/APA. Every hard number above traces to P1–P6.

---

## 5. Reuse assessment (≈100% of the deduction engine)

**Reused unchanged** from `src/engine/obbba-deduction.js` + the two data files:
- `overtimePremium(rate, hours)` — the 0.5× premium = exactly line 1b's "and-a-half portion."
- `allowedDeduction({eligibleAmount, filingStatus, magi, params})` — caps + gradual MAGI phase-out for tips and for overtime, from `obbba-deductions-2026.json`.
- `federalTaxSaved(grossAnnual, filingStatus, deduction, fed)` — exact bracket-diff on the 2026 table in `tax-data-2026.json`.

**New logic (small, ~one function + view):**
- A combined `estimateW4Adjustment({income, filingStatus, tips, overtimePremium, payFrequency, monthsRemaining})` that: computes `D_tips` and `D_ot` via `allowedDeduction`, sums to `D_total`, calls `federalTaxSaved` **once** on `D_total`, then divides by pay periods. That single combined `federalTaxSaved` call is the only real departure from calling the existing `estimate()` twice (§2.1 explains why summing two `estimate()` results is wrong at bracket edges).
- Pay-period map + optional remaining-periods proration.
- W-4 field-mapping copy (line 1a / 1b → Step 4(b)).

No new tax constants, no new engine file, no backend. Pure client-side, consistent with the site's hard rules.

---

## 6. W-2 Box 12 codes TT / TP — verified, and what they're actually for

Source: **2026 General Instructions for Forms W-2 and W-3** (P3), cross-checked against Experian/NATP/CBIZ write-ups of the final instructions.

| Code | Reports | Notes |
|---|---|---|
| **TT** | **Total qualified overtime compensation** for the year | **Premium ("half") portion only** — the amount paid *in excess of the regular rate* under FLSA §7, NOT the full time-and-a-half. (Example: reg rate $20 → OT rate $30 → only the **$10** premium is in TT.) Already included in Box 1 wages; TT just flags the deductible slice. Cumulative year-end total. |
| **TP** | **Total cash tips reported to the employer** | Cumulative year-end total; feeds the tips deduction on Schedule 1-A. |
| **TA** | Employer contributions to a §128 "Trump account" | **Third new 2026 code** the roadmap didn't mention — not used by this tool, but confirms the code set. |

Also new for 2026: **Box 14 split into 14a (Other) and 14b**, where **14b carries the Treasury tipped-occupation code** (verifies the worker is in a customarily-tipped occupation). Not a withholding input.

**Contradiction resolved (adversarial check):** one automated read of the instructions claimed code TT reports the "full overtime payment." That is **wrong** — it misread "compensation that exceeds the regular rate." The instructions, the FLSA definition, the IRS overtime Q&A (P4), and multiple payroll write-ups all agree: **TT = premium/half portion only.** This matches `overtimePremium` and is load-bearing, so it's stated explicitly.

**Why these codes matter to the tool (the honest framing):** TT/TP are **not** a paycheck mechanism and don't belong in the input flow. They are how the worker will get the *real* number to file with next year. The tool's job is the opposite direction in time: *estimate* the deduction **now** (before any W-2 exists) so withholding can be adjusted mid-2026 — then next January the W-2's TT/TP boxes confirm the actual figures for the return. A short "where next year's real number comes from" explainer linking TT/TP is the right treatment; wiring them as inputs is not.

---

## 7. Myth-bust / framing block (site style)

Lead with the differentiator vs the site's existing filing-time tips/overtime calculators:

- **"You don't have to wait until you file to benefit."** The existing tools answer "how much will this deduction save me on my return?" This one answers "how do I get that money in my paychecks **now** instead of as a refund?" That contrast is the whole reason the tool exists and should be the H1 hook.
- **"A big refund isn't a bonus — it's your money the IRS held interest-free."** Over-withholding on tips/overtime all year = an interest-free loan to the government. Adjusting Step 4(b) fixes it.
- **"Use Step 4(b), never Step 4(c)."** 4(c) is *extra* withholding (smaller paycheck). To *raise* take-home you increase the 4(b) deduction. (Directly corrects the common mix-up and the roadmap's "(or 4(c))" aside.)
- **"It's a deduction, not a paycheck exemption."** Employers still withhold on tips/overtime by default; nothing is automatic. The W-4 is the only lever, and it's optional — doing nothing just means a bigger refund, not a lost deduction.
- **"FICA still applies."** Social Security + Medicare come out regardless; this only reduces federal income-tax withholding.
- **"Your W-2's new TT/TP boxes are for next April, not for your paycheck."** Explain the timing so workers don't think the codes change withholding.

**Flagged for the build (non-load-bearing):**
- **UNCERTAIN:** the exact per-status built-in standard-deduction proxy on Pub 15-T line 1g for 2026 (the historical $8,600/$12,900 values are inflation-updated each year). It does **not** affect the tool's math — it only shifts which bracket the adjusted wage sits in, and the tool already uses the real 2026 brackets/standard deduction via `federalTaxSaved`. Note as "withholding is approximate," don't hard-code line 1g.
- **UNCERTAIN/ANCILLARY:** 1099-NEC/1099-MISC also gain overtime/tips reporting for non-employees; out of scope for a W-4 (employee-withholding) tool. Mention only if a self-employed audience is targeted later.

---

## 8. Test fixtures (11 cases, values computed against the real engine)

All expected values were generated by running the **actual** `obbba-deduction.js` against `obbba-deductions-2026.json` + `tax-data-2026.json` (2026 brackets, std ded $16,100/$32,200/$24,150). `D_total` = allowed tips + allowed overtime-premium (each after cap + gradual phase-out); `annualReduction` = `federalTaxSaved(income, status, D_total)`; `perPaycheck` = annualReduction / payPeriods. Coverage: OT-only, tips-only, both; all 4 frequencies; both caps binding; gradual phase-out; full phase-out to $0; a bracket-boundary crossing; low bracket.

| # | Scenario | Status | Income | Freq (PP) | Tips in | OT premium in | D_tips | D_ot | D_total | Annual reduction | **Per paycheck** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | OT-only, 12% band | single | 52,000 | weekly (52) | 0 | 3,000 (=½·$20·300h) | 0 | 3,000 | 3,000 | 360.00 | **6.92** |
| F2 | Tips-only | single | 38,000 | biweekly (26) | 18,000 | 0 | 18,000 | 0 | 18,000 | 1,990.00 | **76.54** |
| F3 | Both | married | 96,000 | semimonthly (24) | 12,000 | 2,500 (=½·$25·200h) | 12,000 | 2,500 | 14,500 | 1,740.00 | **72.50** |
| F4 | Both | HoH | 70,000 | monthly (12) | 9,000 | 1,760 (=½·$22·160h) | 9,000 | 1,760 | 10,760 | 1,291.20 | **107.60** |
| F5 | OT **cap** binds ($12.5k) | single | 90,000 | weekly (52) | 0 | 15,000 | 0 | 12,500 | 12,500 | 2,750.00 | **52.88** |
| F6 | Tips **cap** binds ($25k) | single | 120,000 | monthly (12) | 30,000 | 0 | 25,000 | 0 | 25,000 | 5,500.00 | **458.33** |
| F7 | OT **gradual phase-out** | single | 200,000 | biweekly (26) | 0 | 12,500 | 0 | 7,500 | 7,500 | 1,800.00 | **69.23** |
| F8 | Tips **fully phased out** | single | 420,000 | biweekly (26) | 25,000 | 0 | 0 | 0 | 0 | 0.00 | **0.00** |
| F9 | Both, **bracket crossing** | married | 280,000 | biweekly (26) | 20,000 | 22,000 | 20,000 | 22,000 | 42,000 | 9,968.00 | **383.38** |
| F10 | Low income, 12% | single | 34,000 | weekly (52) | 6,000 | 1,350 (=½·$18·150h) | 6,000 | 1,350 | 7,350 | 845.00 | **16.25** |
| F11 | OT, phase-out reduces cap but premium below it | married | 340,000 | monthly (12) | 0 | 20,000 | 0 | 20,000 | 20,000 | 4,800.00 | **400.00** |

Notes on the load-bearing cases:
- **F8** (boundary): single, $420k — tips phase-out reduction (270 × $100 = $27,000) exceeds the $25,000 cap → deduction $0, per-paycheck $0. Confirms full phase-out.
- **F9** (why combined, not summed): $42,000 combined deduction drops taxable from $247,800 to $205,800, crossing the MFJ 24%→22% edge at $211,400 → exact $9,968 (36,400 @ 24% + 5,600 @ 22%), vs a naïve flat 24% = $10,080. The tool must reproduce $9,968.
- **F11**: at $340k MFJ the overtime *cap* is phased down to $21,000, but the actual premium ($20,000) is below that, so the full $20,000 deducts — verifies the phase-out reduces the cap, not the entered amount.
- **F7**: at $200k single the $12,500 cap is phased down by 50 × $100 = $5,000 → $7,500 allowed. Verifies the gradual $100-per-$1,000 mechanism the W-4 cliff omits (§1.2).

Add per-frequency divisor unit tests (annualReduction ÷ {52,26,24,12}) and a `monthsRemaining < 12` proration test (e.g. F3 with 6 months left → 12 remaining semimonthly periods → higher per-check).

---

## 9. Build notes / guardrails
- Client-side only; no backend; reuse the existing engine + data (no new tax constants). Consistent with the repo hard rules.
- Cross-link both directions with `/tips-tax-calculator/` and `/overtime-tax-calculator/` (filing-time siblings) and the state pages for conformity.
- Do not ship until a verify pass re-runs the §8 fixtures against the engine and confirms every `perPaycheck` value.
