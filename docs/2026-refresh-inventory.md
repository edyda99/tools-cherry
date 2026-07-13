# 2026 figure inventory & Oct–Nov annual-numbers refresh map

Internal planning artifact for whoever runs the Oct–Nov 2026 annual-numbers refresh
sprint (fable blind spot #1: "the single biggest correctness risk on the board").
NOT a user-facing page. Source of the figures below: the `src/data/*.json` files and
a few hardcoded engine constants, audited 2026-07-13. Re-audit before the sprint.

---

## Plain-language summary (read this first)

- Roughly **21 tools / data files** carry a 2026-dated figure. But only about **9** of
  them actually go stale in the Oct–Nov federal refresh. The rest are either **fixed by
  statute** (OBBBA amounts locked for 2025–2028, do NOT "update" them) or move on a
  **different cadence** (states in Dec–Jan, CPI monthly).
- **The one distinction that matters:** *inflation-indexed* figures (brackets, standard
  deduction, SS wage base, QCD limit, Roth catch-up threshold, ABLE limits) get NEW
  numbers each fall and MUST be refreshed. *Fixed statutory* figures (the $12,500 /
  $25,000 / $6,000 / $10,000 / $40k-schedule OBBBA amounts, $7,500 DCFSA, the student-loan
  caps) are wrong to touch until the law changes. Refreshing a fixed figure is as harmful
  as missing an indexed one.
- **Three concrete edits that are easy to miss** (spelled out in "Gotchas" below):
  1. `obbba-deductions-2026.json` → `federal.qcd.annualLimitByYear` has **no 2027 key** —
     the QCD tool silently falls back to 2026's $111,000 when the year rolls.
  2. `src/engine/employment-tax.js` hardcodes `SS_WAGE_BASE = 184500` — a lone constant,
     not read from the data file, so a wage-base bump won't propagate to the 1099-vs-W2 tool.
  3. `src/data/tax-data-2026.json` wage base $184,500 also feeds the SS max-out tool — bump
     it the same day SSA announces the 2027 COLA.

---

## Refresh calendar (which document lands when)

| ~Date | Document | Sets |
|---|---|---|
| **Oct 15, 2026** | SSA 2027 COLA fact sheet | Social Security **wage base** (2026 = $184,500), COLA % |
| **Late Oct 2026** | IRS **Rev. Proc. 2026-xx** (annual inflation adjustments) | Federal **brackets**, **standard deduction**, **QCD limit**, **ABLE** base/gift limits, and (from 2027) the 1099-NEC threshold |
| **Early–mid Nov 2026** | IRS Notice (retirement plan COLA limits) | 401(k)/catch-up limits, **SECURE 2.0 Roth-catch-up wage threshold** ($150,000 for 2026) |
| **~Jan 2027** | HHS **2026 poverty guidelines** | ABLE-to-Work bonus (one-person FPL by state) |
| **Dec 2026 – Jan 2027** | Per-state revenue depts | 51-state paycheck brackets/rates + supplemental (bonus) rates |
| **~mid-Jan 2027** | BLS December CPI-U release | Inflation calculator's final 2026 annual index |

---

## Master inventory — INDEXED figures (must refresh in Oct–Nov)

These get brand-new numbers each fall. Refresh action required.

| Tool(s) | Where the figure lives | 2026 value | Refresh source | When |
|---|---|---|---|---|
| 51 state **Paycheck** calculators (+ hub) | `tax-data-2026.json` → `federal` (brackets, standard deduction) | 2026 brackets + std deduction | IRS Rev. Proc. | Late Oct |
| **SS Wage-Base Max-Out** | `tax-data-2026.json` wage base; consumed by `ss-maxout-engine.js` | $184,500 | SSA COLA fact sheet | Oct 15 |
| **1099 vs W-2** | `src/engine/employment-tax.js` → `SS_WAGE_BASE` **(hardcoded constant)** | 184500 | SSA COLA fact sheet | Oct 15 |
| **QCD vs Charitable Deduction** | `obbba-deductions-2026.json` → `federal.qcd.annualLimitByYear` (year-keyed; **2027 missing**) + 65+ std deduction | $111,000 | IRS Rev. Proc. (§408(d)(8) indexed) | Late Oct |
| **Charitable Deduction** | `obbba-deductions-2026.json` (65+ standard deduction path) | 2026 std deduction | IRS Rev. Proc. | Late Oct |
| **Mandatory Roth Catch-Up** | `secure2-catchup-2026.json` → `rothCatchUp` (year-keyed; 2027 deliberately absent) | $150,000 threshold | IRS retirement-COLA notice (Notice 2025-67 was the 2026 one) | Nov |
| **ABLE Account Contribution** | `able-limits-2026.json` → `baseLimit`, `giftTaxExclusion`, `ableToWork` FPL | $20,000 base / $19,000 gift / 2025 FPL | IRS Rev. Proc. §3.34 (base/gift) + HHS poverty guidelines (FPL) | Late Oct + Jan |
| **1099-K / 1099-NEC Threshold Checker** | `form-1099-thresholds.json` → `form1099NEC_MISC` | NEC $2,000 | IRS Rev. Proc. — NEC threshold **becomes inflation-indexed for TY2027** (2027 figure not yet published) | Late Oct |

---

## FIXED by statute (2026-dated but do NOT refresh in Oct–Nov)

These are OBBBA / statutory amounts locked through 2028 (or on their own schedule).
Leave them alone until the law sunsets or is amended. They are listed here so the refresh
runner does not "helpfully" change a number that is supposed to stay constant.

| Tool(s) | Figure location | 2026 value | Locked until / cadence |
|---|---|---|---|
| **No Tax on Overtime** | `obbba-deductions-2026.json` → `federal.overtime` | cap $12,500/$25,000; phase-out $150k/$300k | Fixed 2025–2028 (§225) |
| **No Tax on Tips** | `federal.tips` | cap $25,000; phase-out $150k/$300k | Fixed 2025–2028 (§224) |
| **Senior Bonus Deduction** | `federal.senior` | $6,000/person; phase-out $75k/$150k | Fixed 2025–2028 (§151(d)(5)) |
| **Car Loan Interest Deduction** | `federal.carLoan` | cap $10,000; phase-out $100k/$200k | Fixed 2025–2028 (§163(h)(4)) |
| **PMI / Mortgage Insurance Deduction** | `federal.mip` | $100k AGI phase-out ($109k "cliff") | Statutory, not inflation-indexed (§163(h)(3)(E)) |
| **SALT Cap** | `federal.salt.capByYear` / `thresholdByYear` | $40,400 (2026) | **Schedule already pre-populated 2025–2029** ($40,804 for 2027). Statutory formula, NOT a Rev. Proc. number. Low-priority: re-verify 2027 vs IRS guidance; `pendingGuidanceYears: [2028, 2029]` |
| **Charitable (non-itemizer amounts)** | `federal.charitable` | $1,000/$2,000; 0.5%-AGI floor | Permanent statutory (§170(p)) |
| **Dependent Care FSA vs Credit** | `dependent-care-2026.json` | DCFSA $7,500; CDCTC tiers | Fixed statutory per its own `_meta` (not indexed) |
| **Federal Student Loan Cap** | `student-loan-limits-2026.json` | grad/professional/lifetime/Parent-PLUS caps | Fixed statutory, **program-year cadence (July 1)**, not Oct–Nov. **Litigation watch:** professional-degree definition stayed June 2026 |
| **W-4 Overtime & Tips Withholding** | reuses `obbba-deductions-2026.json` overtime/tips (fixed) + `tax-data-2026.json` brackets (**indexed**) | — | Bracket dependency refreshes with Rev. Proc.; the OBBBA caps stay fixed |
| **W-2 Box 12 Decoder / TTOC** | `ttoc-occupations.json` + overtime/tips context | occupation code **list** (not a $ figure) | Refresh only on a regulatory change to the TTOC final rule, not annually |
| **Data: Which States Tax Overtime / Tips** | `obbba-deductions-2026.json` state-conformity blocks | per-state conformity flags | Refresh on state law change, not federal Oct–Nov |

---

## Other cadences (not the federal Oct–Nov sprint)

| Tool(s) | Figure location | Source | When |
|---|---|---|---|
| **Bonus Tax by State** (51 pages + hub) | `state-supplemental-2026.json` + `state-payroll-2026.json` + `tax-data-2026.json` | State revenue depts revise supplemental rates yearly; secondary sources conflict — re-verify each filing season | Dec–Jan |
| 51 state **Paycheck** (state portion) | `state-payroll-2026.json` | 51 states set 2027 brackets/rates on varied dates | Dec–Jan (many) |
| **US Inflation Calculator** | `cpi-us.json` | BLS CPI-U; annual figure finalizes with December CPI | ~mid-Jan |

---

## Gotchas / highest-priority manual edits

1. **QCD 2027 limit is missing, not wrong.** `obbba-deductions-2026.json` →
   `federal.qcd.annualLimitByYear` has keys `2024/2025/2026` only. `qcd-comparison.js`
   falls back to the 2026 value (`?? qcd.annualLimitByYear['2026']`), so once the site's
   active tax year advances the QCD tool will quietly report the stale $111,000. **Add the
   2027 key from the late-Oct Rev. Proc.**
2. **`employment-tax.js` has a lone hardcoded `SS_WAGE_BASE = 184500`.** It does NOT read
   `tax-data-2026.json`. Updating the JSON wage base alone will fix the SS max-out tool but
   leave the 1099-vs-W2 tool stale. **Bump both** on SSA COLA day.
3. **SS wage base appears in two places** (`tax-data-2026.json` + `employment-tax.js`) —
   grep `184500` across `src/` before declaring the wage base updated.
4. **Roth-catch-up and QCD JSONs deliberately omit 2027** (documented in their `_meta` as
   "do not fabricate"). Do not backfill a guessed figure; add the real one when the IRS
   notice / Rev. Proc. publishes.
5. **Consider tax-year toggles, not in-place replacement** (fable's note): filing season
   2027 is *about* tax year 2026, so a returning user may still need the 2026 numbers.
   Several datasets are already year-keyed (`salt.capByYear`, `qcd.annualLimitByYear`,
   `secure2 rothCatchUp`, ABLE `comparison2025`) — prefer adding a 2027 key over overwriting
   2026 where the tool exposes a year.
6. **The `taxYear` build gate.** `build.js` warns and `npm test` (`check-freshness.js`)
   **fails** when the calendar year exceeds `tax-data-2026.json`'s `taxYear`. When you roll
   to 2027 data, that gate updates automatically; if you defer the roll, expect the
   freshness test to start failing on Jan 1, 2027.

---

## Refresh-day checklist (fill in figures as documents land)

- [ ] **Oct 15** — SSA COLA: new SS wage base → update `tax-data-2026.json` wage base **and**
      `employment-tax.js` `SS_WAGE_BASE`. Verify SS max-out + 1099-vs-W2.
- [ ] **Late Oct** — Rev. Proc.: brackets + standard deduction (`tax-data`), QCD limit (add
      2027 key), ABLE base/gift (`able-limits`). Re-verify SALT schedule vs official 2027 figure.
- [ ] **Nov** — IRS retirement notice: 401(k)/catch-up limits + Roth-catch-up threshold
      (`secure2-catchup`, add 2027).
- [ ] **From 2027** — Rev. Proc.: 1099-NEC indexed threshold (`form-1099-thresholds`).
- [ ] **Jan** — HHS poverty guidelines: ABLE-to-Work FPL (`able-limits` `ableToWork`).
- [ ] **Dec–Jan** — state payroll + supplemental rates (separate 51-state pass).
- [ ] After any figure change: `npm run build` + `npm test` (freshness gate) + re-verify the
      affected tool's key number in the served dist, then IndexNow.
