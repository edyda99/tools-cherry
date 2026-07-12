# Social Security Wage Base Max-Out Date Calculator — Sourced Spec

**Tool slug (proposed):** `/social-security-tax-stop-date-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA / Roth-catch-up specs.
**Prepared:** 2026-07-12 (7th item in the fable roadmap chain). Every hard number verified against SSA.gov and IRS primary sources with verbatim quotes (see §2). No blog/aggregator figure is used as the number of record.

---

## 0. Plain-language summary (read this first)

A W-2 employee pays **6.2% Social Security (OASDI) tax** on their wages **only up to an annual cap** — the "wage base." For **2026 that cap is $184,500**. The dollar you earn *above* $184,500 at a job has **no Social Security tax** on it. So once your year-to-date Social Security wages cross $184,500, your employer **stops withholding the 6.2%**, and your **take-home pay visibly jumps** (by 6.2% of your gross) for the rest of the calendar year. On **January 1 it resets** and withholding starts again.

This tool answers: **"Given my YTD wages and my pay, on what pay date does Social Security tax stop coming out — and how much bigger is that paycheck?"** No incumbent tool answers that (see §7); every existing "Social Security tax calculator" computes the *annual amount*, not the *stop date*.

Two things people get wrong, and what's true:
- **It's not "the rich dodging tax."** It's a statutory cap that applies to everyone; you just have to earn past it to see it. The framing is accurate, not a marketing hook.
- **Medicare never stops.** Only Social Security has a cap. The **1.45% Medicare** tax (plus 0.9% Additional Medicare above $200k / $250k MFJ) keeps coming out all year. So the paycheck bump is exactly the 6.2% SS piece, not all of FICA.

**Confidence:** HIGH on every hard figure (all traced to SSA `cbb.html` + IRS Topics 608/560). Three items flagged as open uncertainties in §5 — none load-bearing for the core date math.

---

## 1. Confirmed primary-source figures

| Item | 2026 value | 2025 (context) | Primary source (verbatim in §2) |
|---|---|---|---|
| **SS / OASDI wage base (taxable maximum)** | **$184,500** | $176,100 | SSA Contribution & Benefit Base (P1) |
| **Employee OASDI tax rate** | **6.2%** (flat, statutory) | 6.2% | SSA P1 / IRS Topic 751 (P5) |
| **Max employee SS tax at the cap** | **$11,439.00** | $10,918.20 | SSA P1 (states the $11,439.00 figure *verbatim*, not just derivable) |
| **Self-employment OASDI rate** | **12.4%** (SE max = $22,878.00) | 12.4% | SSA P1 |
| **Medicare (HI) rate** | **1.45%, no wage cap** | 1.45% | SSA P1 / IRS Topic 751 |
| **Additional Medicare Tax** | **0.9%** over $200,000 (single/HoH), **$250,000** MFJ, **$125,000** MFS | same | IRS Topic 560 (P4) |

**Key confirmations:**
- **`184,500 × 0.062 = $11,439.00`** — arithmetic checks, and SSA states it verbatim: *"an individual with wages equal to or larger than $184,500 would contribute $11,439.00 to the OASDI program in 2026."* This resolves the prior agent's triangulated lead to a **direct** primary-source anchor.
- **No "wrinkle for the max-out year."** The 6.2% is flat on *every* dollar up to $184,500, then 0% above. There is no phased rate, no different treatment in the crossing year. (The subtleties are per-employer independence and the year-end rollover — §3.4 / §3.5 — not the rate.)
- The repo's existing `src/data/tax-data-2026.json` **already carries** `federal.fica.socialSecurity = {rate: 0.062, wageBase: 184500}` and the Medicare / Additional-Medicare blocks, sourced 2026-06-16. **Reuse this data file directly** — do not re-key the numbers.

---

## 2. Primary sources (verbatim quotes)

| # | Source | URL | Verbatim anchor |
|---|---|---|---|
| **P1** | **SSA — Contribution and Benefit Base** | https://www.ssa.gov/oact/cola/cbb.html | *"For earnings in 2026, this base is $184,500. The OASDI tax rate for wages paid in 2026 is set by statute at 6.2 percent for employees and employers, each. Thus, an individual with wages equal to or larger than $184,500 would contribute **$11,439.00** to the OASDI program in 2026… The OASDI tax rate for self-employment income in 2026 is **12.4 percent**."* Table rows: *"2024 168,600  2025 176,100 … 2026 $184,500."* Medicare: *"After 1993, there has been **no limitation on HI-taxable earnings**. Tax rates under the HI program are **1.45 percent** for employees and employers, each, and 2.90 percent for self-employed."* |
| **P2** | **SSA — 2026 COLA Fact Sheet** | https://www.ssa.gov/news/en/cola/factsheets/2026.html | Corroborates $184,500 max taxable earnings for 2026 (the source already cited in `tax-data-2026.json`). |
| **P3** | **IRS — Topic 608, Excess Social Security and RRTA tax withheld** | https://www.irs.gov/taxtopics/tc608 | *"**Two or more employers** — If you had more than one employer during the taxable year and your total wages and compensation were over the wage base limit for the year, the total Social Security tax… withheld may have exceeded the maximum…"* → claim as credit. WRINKLE, verbatim: *"[If a single] employer withheld too much Social Security… **you can't claim the excess as a credit against your income tax. Your employer should adjust the excess for you.** If the employer doesn't adjust the overcollection, you can use **Form 843**…"* |
| **P4** | **IRS — Topic 560, Additional Medicare Tax** | https://www.irs.gov/taxtopics/tc560 | *"A **0.9% Additional Medicare tax** applies to Medicare wages… that exceed the following threshold amounts based on filing status: **$250,000** for married filing jointly; **$125,000** for married filing separately; and **$200,000** for all other taxpayers."* |
| **P5** | **IRS — Topic 751, SS & Medicare withholding rates** | https://www.irs.gov/taxtopics/tc751 | Corroborates 6.2% SS + 1.45% Medicare employee rates. |
| **P6** | **IRS — Schedule 3 (Form 1040), Part II** | https://www.irs.gov/pub/irs-pdf/f1040s3.pdf | Line for "Excess social security and tier 1 RRTA tax withheld" (Part II, line 11 on the 2025 form; the 2026 draft retains Part II — exact 2026 line # flagged §5). |

**Secondary (cross-check only, never the number of record):** Kiplinger, SmartAsset, OnPay, Paycor, CNBC, Forbes. Every hard figure above traces to P1/P3/P4. Note: a live competitor (`ustax.tools`) still shows the **stale 2025 $176,100** base in its own title — direct evidence for why secondary sources are not trusted here.

---

## 3. Calculator mechanics

### 3.1 The wage input is SS wages (Box 3), NOT gross — load-bearing

The projection must run on **Social Security wages** (W-2 Box 3), not total gross or Box 1. This matters:
- **401(k)/403(b) pre-tax deferrals do NOT reduce SS wages** — they are still fully SS-taxed. (Matches the existing `paycheck-engine.js` comment: *"401(k) is still FICA-taxed."*)
- **Section 125 cafeteria** amounts (HSA/FSA, pre-tax health premiums) **do** reduce SS wages.

If the tool asked for "gross" and the user has pre-tax health deductions or (wrongly assumed) 401(k) reductions, the projected stop date would be off. **Label the field "YTD Social Security wages (W-2 Box 3)"** with helper text: *"For most people this is your gross pay minus any pre-tax health/HSA/FSA — your 401(k) does NOT reduce it. If unsure, use gross; it'll be close."* Simple-mode may accept gross as an approximation with that caveat.

### 3.2 Inputs (v1)

| Input | Type | Notes |
|---|---|---|
| `taxYear` | select | Default **2026**. (2027 gated — §5.) Drives `wageBase`, `ssRate` from `tax-data-<year>.json`. |
| `ytdSSWages` | number | YTD Social Security wages **as of `asOfDate`** at THIS employer (§3.1 label). |
| `asOfDate` | date | The pay date the YTD figure is current through. |
| `payFrequency` | select | weekly / biweekly / semimonthly / monthly (reuse `PAY_PERIODS` keys). |
| `nextPayDate` | date | Date of the next paycheck after `asOfDate` (= "future period 1"). |
| `perPeriodSSWages` | number | Roughly-flat SS wages added each future pay period. |
| `payRaise` *(optional, advanced)* | `{effectiveOnPeriod:int, newPerPeriodSSWages:number}` | Two-phase support for the uneven-pay case (§3.6). Engine internally accepts a full per-period array; the UI exposes just this one raise for v1. |
| **Excess-FICA mode** *(secondary panel)* | — | `numEmployers` + a small list of `ssWithheldByEmployer[]` (or per-employer SS wages). Computes aggregate overpayment vs `$11,439.00`. See §3.7. |

**No filing status** for the max-out date (the SS cap is a flat per-person, per-employer wage test — no status/MAGI phase-out). Filing status appears **only** in the Additional-Medicare contrast callout (§3.8), if shown.

### 3.3 Core projection (flat pay)

```
wageBase = params[taxYear].wageBase        # 184,500 (2026)
ssRate   = params[taxYear].ssRate          # 0.062
maxSS    = wageBase * ssRate               # 11,439.00 (2026)

remaining = wageBase - ytdSSWages
if remaining <= 0:  ->  alreadyMaxed = true; withholding already $0; no future date
if perPeriodSSWages <= 0: -> guard/error (cannot project)

# capReachedPeriod k* = smallest k with ytd + k*perPeriod >= wageBase
k_star            = ceil(remaining / perPeriodSSWages)     # LAST paycheck with any SS withheld
firstZeroSSPeriod = k_star + 1                             # first paycheck with ZERO SS -> the visible bump

# withholding on the crossing paycheck (may be partial)
taxedOnCrossing   = min(perPeriodSSWages, wageBase - (ytdSSWages + (k_star-1)*perPeriodSSWages))
ssOnCrossing      = taxedOnCrossing * ssRate               # <= perPeriodSSWages * ssRate
bumpAmount        = perPeriodSSWages * ssRate              # take-home increase once SS stops
```

- **`capReachedDate`** = calendar date of future period `k_star` (last paycheck with SS withheld, possibly partial).
- **`firstZeroSSDate`** = calendar date of future period `k_star + 1` (**headline**: "your paycheck goes up ~$X on this date").
- The bump is the **full per-period SS** (`perPeriodSSWages × 6.2%`), because from that paycheck on, 0% SS is withheld.

### 3.4 Per-employer independence (correctness, not gold-plating)

The cap is **per employer**, not per person. Each employer withholds 6.2% up to $184,500 **independently, ignoring what any other employer withheld**. Consequences the tool must respect:
- **Mid-year job start** → YTD-at-this-employer **resets to $0**; the new employer withholds from $0 again even if you already earned $150k elsewhere this year. So the stop-date projection is always **per-employer**.
- Someone with two jobs can have **more than $11,439 withheld in aggregate** and none of it "stopped" — that's the **excess-FICA** case (§3.7), the flip side of this same rule.

### 3.5 Year-end rollover edge

If `firstZeroSSDate` (or even `capReachedDate`) lands in the **next calendar year**, there is **no visible bump**: Jan 1 resets the base and 6.2% resumes. Output must say *"You reach the cap on your last paycheck(s) of {year}; withholding simply ends with the year and resets on Jan 1 — no separate 'bigger paycheck' before year-end."* (See fixtures F4-relevant / F7.) A naive "your paycheck jumps on {date}" is wrong when {date} is in January.

### 3.6 Uneven pay (raise, bonus)

Flat per-period is the default. For a **mid-year raise** (or a one-off bonus period), the engine walks a **per-period schedule** cumulatively rather than dividing once:

```
ytd = ytdSSWages
for k in 1..N:
    w = scheduleForPeriod(k)              # perPeriodSSWages, or newPerPeriodSSWages after the raise, or +bonus
    prev = ytd; ytd += w
    if ytd >= wageBase:
        k_star = k; taxedOnCrossing = wageBase - prev; break
```

The UI exposes one optional raise (`effectiveOnPeriod`, `newPerPeriodSSWages`) for v1; the engine's array form covers bonuses/lumps for a fast-follow. A large one-off **bonus** can cross the cap in a single period — the engine handles it because it's just a large `w` in the walk.

### 3.7 Excess-FICA (multi-employer) — IN v1 SCOPE, as a secondary mode

Arithmetically clean and high-value, so **include it** — but **only** with the single-employer wrinkle enforced (else the tool gives wrong tax advice):

```
totalSSWithheld = sum(ssWithheldByEmployer)          # or sum(min(wages_i, wageBase) * ssRate)
excess          = max(0, totalSSWithheld - maxSS)    # maxSS = 11,439.00 (2026)

claimableOn1040 = (numEmployers >= 2)   # >1 employer -> Schedule 3, Part II credit -> refundable
                                        # exactly 1 employer -> NOT a 1040 credit:
                                        #   employer must adjust; if not, file Form 843
```

- **Multi-employer** overpayment → **claim on Schedule 3 (Form 1040), Part II** (P6); it flows into the refund. (Per-employer, each withheld correctly up to its own cap; the *aggregate* is what overshoots.)
- **Single-employer** overpayment → **NOT** claimable on the 1040. IRS Topic 608 (P3, verbatim): *"you can't claim the excess as a credit… Your employer should adjust the excess for you… [else] use Form 843."* The tool must branch on `numEmployers` and show the right remedy. **This is the material correction to the naive "you overpaid → claim it on your return" framing.**

### 3.8 Medicare contrast callout — YES, one short line (accuracy, not scope creep)

Show a single sentence, not a Medicare calculator: *"Social Security tax stops at the cap. **Medicare (1.45%) never stops** — it comes out of every paycheck all year, and an extra **0.9%** kicks in above $200,000 ($250,000 married filing jointly). So your paycheck bump is the 6.2% SS piece only."* This prevents the common error of expecting *all* payroll tax to stop. Sourced to P1/P4. Do **not** build Medicare projection into v1.

### 3.9 Suggested engine surface

Pure, dependency-free `ss-maxout-engine.js` returning `{ ...result, notes: [] }`:
- `projectMaxOut({ taxYear, ytdSSWages, asOfDate, payFrequency, nextPayDate, perPeriodSSWages, schedule?, params }) -> { alreadyMaxed, willNotMaxOutThisYear, capReachedPeriod, capReachedDate, firstZeroSSDate, ssOnCrossing, bumpAmount, totalSSForYear, rolledIntoNextYear, notes }`
- `nextPayDates(nextPayDate, payFrequency, count) -> Date[]` — **new** calendar scheduler (fixed +7/+14 days for weekly/biweekly; calendar 15th & last-day for semimonthly; same day-of-month for monthly; all dates user-overridable).
- `excessFica({ ssWithheldByEmployer[], numEmployers, maxSS }) -> { totalSSWithheld, excess, claimableOn1040, remedy }`

### 3.10 Reuse assessment (task item 7) — **standalone engine; reuse data only**

**Build a new `ss-maxout-engine.js`. Do NOT extend `paycheck-engine.js`.** Reasoning:
- `paycheck-engine.js` has **no pay-date scheduling at all** — only `PAY_PERIODS` (period *counts* 52/26/24/12) and an annual `ficaTax()` that caps SS at the wage base. Zero calendar-date logic, which is the entire point of this tool.
- **Reuse from the existing code:** (a) the constants `federal.fica.socialSecurity.{rate,wageBase}` straight out of `src/data/tax-data-2026.json` (already confirmed $184,500 / 6.2%); (b) the `PAY_PERIODS` keys/labels for the frequency dropdown; (c) optionally `ficaTax()` to display the annual capped SS total ($11,439.00) as a sanity figure. The **new** work is the pay-date scheduler + cumulative forward-walk + excess-FICA — none of which belong in the general paycheck engine.

---

## 4. Test fixtures (10)

Constants (2026): `wageBase = 184,500`, `ssRate = 0.062`, `maxSS = $11,439.00`. All currency to the cent. Dates assume Friday biweekly/weekly anchors, 15th & last-day semimonthly, last-day monthly (all user-overridable — dates illustrate the scheduler, not a fact claim).

| # | Scenario (coverage) | Inputs | Expected |
|---|---|---|---|
| **F1** | **Exact boundary** — remaining is an exact multiple (biweekly) | ytd=174,900; perPeriod=9,600; nextPay=2026-11-06 | remaining=9,600=1×perPeriod → `k_star=1`. Crossing paycheck **2026-11-06**: full SS **$595.20** (9,600×.062), ytd hits **184,500 exactly**. `firstZeroSSDate=`**2026-11-20**, take-home **+$595.20**. `totalSSForYear=$11,439.00`. |
| **F2** | **Crossing mid-period** — partial last withholding (biweekly) | ytd=160,000; perPeriod=7,000; nextPay=2026-08-07 | remaining=24,500; 24,500/7,000=3.5 → `k_star=4`. Period-4 date **2026-09-18**: partial SS on (184,500−181,000)=3,500 → **$217.00** (vs full $434.00). `firstZeroSSDate=`**2026-10-02**, bump **+$434.00**. Annual SS capped **$11,439.00**. |
| **F3** | **Mid-year job start — does NOT max out** (per-employer reset; monthly) | new job Aug; ytd@thisEmployer=0; perPeriod=18,000/mo; nextPay=2026-08-31 | Only 5 checks left (Aug–Dec)=90,000 < 184,500; would need ceil(184,500/18,000)=11. `willNotMaxOutThisYear=true` at this employer. Note: prior-employer wages this year don't reduce this cap; if aggregate > 184,500 see excess-FICA (F8). |
| **F4** | **Uneven pay — raise mid-year** (two-phase; biweekly) | ytd=150,000; first 2 checks @6,000 then raise @9,000; nextPay=2026-08-28 | 2×6,000→ytd 162,000; then @9,000: after 2 more →180,000, 3rd @9,000 crosses. `k_star=5`, period-5 **2026-10-23**: partial SS on (184,500−180,000)=4,500 → **$279.00**. `firstZeroSSDate=`**2026-11-06**, bump **+$558.00** (9,000×.062). |
| **F5** | **Should never max out — low income** (weekly) | perPeriod=1,200 all year (annual SS wages 62,400) | 62,400 ≪ 184,500 → `willNotMaxOutThisYear=true`; SS never stops; `totalSSForYear=`**$3,868.80** (62,400×.062). |
| **F6** | **Already maxed out** (as-of already past base) | ytd=190,000 | remaining=−5,500 → `alreadyMaxed=true`; SS withholding already **$0**; no future cap date; `totalSSForYear` capped **$11,439.00**. |
| **F7** | **Exact boundary on the last pay date of the year → rollover** (semimonthly) | ytd=178,300; perPeriod=3,100; nextPay=2026-12-15 (then 12-31) | remaining=6,200=2×3,100 → `k_star=2`. Period-1 12-15 (full SS $192.20 → ytd 181,400); period-2 **2026-12-31** (full SS $192.20 → ytd **184,500 exactly**, last SS check). `firstZeroSSDate` would be **2027-01-15** → `rolledIntoNextYear=true`, **no in-year bump** (base resets Jan 1). |
| **F8** | **Excess-FICA — multi-employer** (IN scope) | 2 employers: A SS wages 120,000 (withheld $7,440.00), B 110,000 ($6,820.00) | Each under its own cap (neither stopped). `totalSSWithheld=$14,260.00`; `excess = 14,260.00 − 11,439.00 =`**$2,821.00**; `claimableOn1040=true` (≥2 employers) → **Schedule 3, Part II** credit → refund. |
| **F9** | **Single-employer over-withholding — NOT claimable** (the wrinkle) | 1 employer erroneously withheld SS on 190,000 = **$11,780.00** | `excess = 11,780.00 − 11,439.00 =`**$341.00** exists, but `claimableOn1040=false` → remedy: **employer must adjust/refund; if not, Form 843.** (Directly tests IRS Topic 608 wrinkle — a tool that told this user to "claim it on your return" would be wrong.) |
| **F10** | **Mid-year crossing, clean in-year bump** (monthly) | ytd=100,000; perPeriod=20,000/mo; nextPay=2026-07-31 | remaining=84,500; 84,500/20,000=4.225 → `k_star=5`. Period-5 **2026-11-30**: partial SS on (184,500−180,000)=4,500 → **$279.00**. `firstZeroSSDate=`**2026-12-31**, bump **+$1,240.00** (20,000×.062). |

**Coverage:** exact boundary (F1, F7); mid-period partial (F2, F4, F10); per-employer reset / no-max job start (F3); uneven raise (F4); never-max low income (F5); already maxed (F6); year-end rollover / no-bump (F7); excess-FICA multi-employer (F8); single-employer wrinkle (F9); weekly/biweekly/semimonthly/monthly all exercised.

---

## 5. Adversarial verification (tried to break each figure)

| Claim under attack | Failure mode tested | Resolution |
|---|---|---|
| **Wage base = $184,500 for 2026** | Blogs/aggregators may be stale ($176,100 / $168,600). | **Confirmed** by SSA `cbb.html` (P1) table + prose, and already in the repo's `tax-data-2026.json`. A live competitor still shows $176,100 → exactly the stale-secondary trap the chain warns about. |
| **Max SS tax = $11,439.00** | Prior agent only *triangulated* this. | **Upgraded to direct source.** SSA P1 states "$11,439.00" verbatim in the same sentence as the base. Arithmetic 184,500×.062=11,439.00 confirms. |
| **A rate wrinkle in the crossing year?** | Maybe a blended/phased rate at the cap. | **Refuted.** Flat 6.2% on every dollar to $184,500, then 0%. No wrinkle. The real subtleties are per-employer independence + rollover, not the rate. |
| **Excess-FICA is always "claim on Schedule 3"** | Task framing (item 4) implied any overpay is claimable. | **Corrected.** Topic 608 (P3): only **multi-employer** aggregate excess is a 1040 credit; **single-employer** over-withholding is **NOT** — employer fixes it, or Form 843. Enforced in engine (`claimableOn1040 = numEmployers>=2`), fixtures F8/F9. |
| **"YTD gross" is the right input** | Task item 6 said "gross." | **Corrected to SS wages (Box 3).** 401(k) does NOT reduce SS wages; cafeteria-125 does. Using gross over-/mis-projects the stop date for anyone with pre-tax health deductions. §3.1 label is load-bearing. |
| **Self-employment belongs in v1** | SECA "doubles the rate," parallel logic. | **Deferred.** SECA (12.4% to the same $184,500 base = $22,878.00 max) has **no paycheck to stop** — it's paid via estimated tax / Schedule SE. The entire utility hook (a stop date + bigger paycheck) evaporates. Wage-base lookup is parallel but the tool's value isn't. FYI note only in v1. |
| **Paycheck "bump" framing is marketing spin** | Might overstate. | **Confirmed accurate.** Multiple sources incl. SSA-adjacent: once YTD > cap, employer must stop withholding SS for the rest of the year and net pay rises by the 6.2%. Real and correct. |
| **Additional Medicare thresholds** | Which status → which threshold. | **Confirmed** Topic 560 (P4): $200,000 single/HoH, $250,000 MFJ, $125,000 MFS, 0.9%. Used only for the contrast callout. |
| **A date lands in the wrong period** | Off-by-one on "last SS check" vs "first zero check." | **Resolved.** `k_star = ceil(remaining/perPeriod)` = last paycheck with any SS; `k_star+1` = first zero-SS (the bump). Fixtures F1 (exact), F2 (partial) pin both. |

**Open uncertainties (flagged, not guessed):**
1. **2027 wage base** — not published until ~Oct 2026. **Gate the year selector to 2026** (optionally show 2025 = $176,100 for context). Do NOT fabricate 2027. (Same posture as the SALT/Roth specs.)
2. **Exact 2026 Schedule 3 line number** — Part II is confirmed; it's **line 11 on the 2025 form** and the 2026 draft retains Part II, but the precise 2026 line # isn't pinned here. **Not load-bearing** (the tool computes the excess $ and names the form/part, not a line number). Cite "Schedule 3, Part II."
3. **Semimonthly/monthly default pay dates** (15th & last-day; last-day) are an **assumption for illustration**, not a fact about the user's employer. Pay dates must be **user-overridable**; don't present the default schedule as authoritative.

---

## 6. Myth-bust framing (matches the senior-deduction / Roth voice)

**Headline (proposed):** *"When does Social Security tax stop coming out of my paycheck?"*

> **What people don't realize:** Social Security tax (6.2%) has an **annual cap** — for 2026 it's **$184,500** of wages. Once your year-to-date pay at a job crosses that, your employer **stops** withholding the 6.2% for the rest of the year, and your **take-home pay goes up**. On Jan 1 it resets.

Supporting mini-myths (all sourced §2):
- *"All my payroll tax stops."* → **No.** Only Social Security stops. **Medicare (1.45%) never stops**, plus 0.9% more above $200k/$250k. The bump is the 6.2% piece only.
- *"I switched jobs, so my new job knows I already hit the cap."* → **No.** Each employer withholds from **$0 again**, independently. You can overpay in total — and if you had **two or more employers**, you claim the excess back on your tax return (Schedule 3). With **one** employer that over-withheld, the **employer** must fix it (not your return).
- *"$11,439 is a lot of extra tax on high earners."* → It's the **max any employee pays** to Social Security in 2026 — the same 6.2% everyone pays, just capped. Earn past $184,500 and the rate on those extra dollars is **0%**.
- *"Only rich people ever see this."* → You see it the year your wages cross $184,500 **at one job** — the tool tells you the exact paycheck.

---

## 7. Competitor gap + build notes

- **Genuine SERP gap (task item 8).** First-page results split into (a) explainer articles (Kiplinger, OnPay, Paycor, SmartAsset, CNBC, Forbes) and (b) calculators that compute the **annual SS tax amount** (tax47, ustax.tools, ultimatefinancecalculator FICA/SS calcs). **None compute the max-out *date* or the paycheck-bump date.** The date + "your paycheck goes up $X on {date}" output is the differentiator and reuses the site's existing pay-frequency/tax-data machinery.
- **YMYL posture:** footnote every figure to P1/P3/P4; "estimate, not tax advice; confirm with your employer / pay stub" line; the SS-wages-vs-gross caveat visible near the input.
- **Load-bearing label:** the wage input MUST read "YTD **Social Security wages (W-2 Box 3)**," not "gross" (§3.1) — else the stop date is wrong for anyone with pre-tax health deductions.
- **Do NOT** add filing status to the date projection (flat per-person, per-employer cap; no phase-out). It appears only in the optional Medicare callout.
- **Year gate:** default 2026; 2027 blocked until the SSA Oct-2026 announcement; 2025 optional for context.

---

## 8. Scope decisions (summary)

| Feature | Decision | Why |
|---|---|---|
| Max-out **date** projection (all 4 frequencies) | **v1 core** | The reason the tool exists; no incumbent does it. |
| Uneven pay — **mid-year raise / bonus** | **v1** (one raise in UI; engine takes a full array) | Common, arithmetically clean (cumulative walk). |
| **Excess-FICA** multi-employer credit | **v1** (secondary panel) | Common, clean, high-value — but ONLY with the single-employer wrinkle enforced (§3.7). |
| **Medicare / Add'l-Medicare** contrast | **v1** (one-line callout, no calc) | Prevents the "all payroll tax stops" error; sourced. |
| **Self-employment (SECA)** projection | **Deferred (fast-follow)** | No paycheck to stop; SECA is estimated-tax/Schedule SE. FYI note only ($22,878.00 SE max). |
| **2027** tax year | **Deferred** | Wage base unpublished until ~Oct 2026; do not fabricate. |
