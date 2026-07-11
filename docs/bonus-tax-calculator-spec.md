# Bonus Tax Calculator by State — Sourced Spec

**Tool slugs (proposed):** hub `/bonus-tax-calculator/` + 51-page cluster `/{state}-bonus-tax-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA / Roth-catch-up calculators.
**Prepared:** 2026-07-11. Federal + CA/NY/MN/OR/VT numbers verified against primary or strong-secondary sources; the remaining state supplemental rates rest on one aggregator (Patriot) and carry an explicit per-state verification gate (§2, §7).
**Roadmap:** longtail-opportunities.md #2 (fable, 2026-07-09). Must publish before Nov–Feb bonus season.

---

## 0. Plain-language summary (read this first)

A bonus is **not taxed at a higher rate than the rest of your pay.** What people see on the check is *withholding* — a flat prepayment the employer sends to the IRS — not the *tax you actually owe*. The IRS default is to withhold a **flat 22%** of a bonus for federal income tax (plus your state's rate, plus FICA). Your real tax on that bonus is settled at year-end when your whole year's income runs through the ordinary brackets at your **marginal rate**. If 22% was more than your real rate, the excess comes back as a **refund**; if it was less (high earners), you'll **owe the difference**.

The calculator shows both numbers side by side for any of the 50 states + DC:
1. **What's withheld now** — flat 22% federal + the state's supplemental rate + FICA (7.65%). This is the "why is half my bonus gone?" number.
2. **What you'll actually owe** — the bonus taxed at the user's true marginal rate given their regular income. The gap is the expected refund (or extra owed).

**The differentiator nobody else runs:** withholding rate vs. what you actually keep. PaycheckCity and the bonus-calculator clones stop at the withholding number. We show the true-liability delta.

**Confidence:** HIGH on federal mechanics (IRS Pub 15 2026) and on CA, NY, MN, OR, VT. MEDIUM on the remaining ~17 states carrying their own flat supplemental rate — those come from Patriot's aggregator table and must be confirmed against each state's DOR withholding guide before that state page publishes (§7). The 9 no-income-tax states and the 20 regular-method states reuse data the repo already has sourced.

---

## 1. Federal supplemental wage withholding mechanics (all figures sourced, IRS Pub 15 2026)

### 1.1 What counts as a "supplemental wage"
Wages paid **in addition to** regular wages: **bonuses, commissions, overtime pay, back pay, severance, accumulated sick/vacation pay, awards, prizes, retroactive raises, and reported tips.** (IRS Pub 15 (2026), *Supplemental Wages*.)

### 1.2 The flat 22% method (the calculator's headline)
- Rate: **22%** flat on supplemental wages, for any employee who does **not** receive more than **$1,000,000** of supplemental wages during the calendar year.
- This is the **highest of the two optional methods** an employer can use, and it is **optional** — allowed only when **both** are true:
  1. the supplemental wages are **identified separately** from regular wages, **and**
  2. **income tax was withheld from the employee's regular wages** in the current or a preceding payroll period.
- 22% ties to the third federal bracket (the 22% marginal rate). It is a *default withholding convenience*, not a "bonus tax rate."
- **Status for 2026: unchanged.** P.L. 119-21 (the One Big Beautiful Bill Act) permanently extended the P.L. 115-97 (TCJA) individual rates, so 22% / 37% carry forward with no sunset. Verified against IRS Pub 15 (2026) and Pub 15-T (2026).

### 1.3 The mandatory 37% rate above $1,000,000
- On the portion of an employee's supplemental wages that **exceeds $1,000,000 in the calendar year**, the employer **must** withhold at **37%** (the highest income-tax rate). This is **mandatory**, not optional, and applies regardless of the W-4.
- It is cumulative across the year: once year-to-date supplemental wages cross $1M, every additional supplemental dollar is 37%.
- Worked edge case (fixture F9): a $1,500,000 bonus → first $1,000,000 × 22% = $220,000; next $500,000 × 37% = $185,000; **federal withholding = $405,000.**

### 1.4 The aggregate method (the alternative)
- The employer **combines** the bonus with the regular wages **for that payroll period**, computes withholding on the combined amount using the normal percentage-method/wage-bracket tables and the employee's W-4, then **subtracts** the tax already withheld on the regular-wage portion. The remainder is withheld from the bonus.
- **When it's used:** it is **mandatory** (the flat 22% is not available) when **no income tax was withheld from the employee's regular wages** (e.g., a low earner whose W-4 zeroes out regular withholding, or a bonus-only paycheck with no concurrent regular wages). Employers also *choose* aggregate when they don't segregate the bonus onto its own check.
- **Effect on the check:** aggregate can withhold **more or less** than 22% depending on the period. Lumping a big bonus into one period can push the annualized amount into a higher withholding tier, so aggregate frequently withholds *more* upfront than the flat 22% for a large one-time bonus — another reason "my bonus got crushed" is a withholding artifact, not a tax rate.

### 1.5 Withholding ≠ tax liability (the core teaching point)
Withholding is a **prepayment estimate**; liability is settled on the **Form 1040** against total annual income at the graduated brackets.
- **Low / mid earners routinely over-withhold** at 22% and get it back. Fixture F1: a single filer with $60,000 salary + a $10,000 bonus has 22% ($2,200) withheld federally, but the bonus's *true* federal tax is only **$1,550** (it straddles the 12% and 22% bands after the $16,100 standard deduction) → **~$650 comes back** as refund. Fixture F5/F10: a 12%-bracket earner has 22% withheld → nearly half the federal withholding returns.
- **High earners under-withhold** at 22% and owe more. Fixture F11: a $500,000 earner's $50,000 bonus has 22% ($11,000) withheld, but their marginal rate is 35% → true federal tax **$17,500**, so they'll **owe ~$6,500** at filing. Fixture F9: the whole $1.5M bonus for a $300k earner is taxed at 35–37% (~$547,866) — well above the $405,000 withheld.

FICA is **not** part of this refund story — Social Security (6.2% up to the $184,500 wage base) and Medicare (1.45%, +0.9% additional over $200k) are true taxes on the bonus, withheld and owed at the same rate. Only the **income-tax** piece (federal + state) is a prepayment that trues up.

---

## 2. State supplemental wage withholding — all 51 jurisdictions

Each jurisdiction falls into one of four buckets. Sources and per-state verification tier are in the table.

### 2.1 The four methods
- **`none`** — no state income tax on wages → **0% state withholding** on the bonus (9 states). Already in repo as `hasIncomeTax:false`.
- **`flat`** — state publishes its **own** flat supplemental rate, applied as `bonus × rate` when the bonus is paid separately (22 jurisdictions). **Net-new data.**
- **`regular`** — no separate supplemental rate; the state requires the **aggregate/regular method**, i.e. withhold as if the bonus were ordinary wages (20 jurisdictions). The calculator reuses the existing paycheck engine's state computation for these. For flat-income-tax states this effectively equals the flat income rate; for bracket states it's an aggregate estimate.
- **Specials:** CA (two flat rates by payment type), NY (state rate + NYC/Yonkers locals), VT (percent-of-federal, not percent-of-bonus), WI (graduated by annual gross).

### 2.2 Full table (2026)

| Jurisdiction | Method | Supplemental rate | Verify tier | Notes |
|---|---|---|---|---|
| Alabama | flat | 5.0% | Patriot → DOR | |
| Alaska | none | — | Repo | No income tax |
| Arizona | regular | ~2.5% (flat income rate) | Repo | Aggregate; repo flat 2.5% |
| Arkansas | flat | 3.9% | Patriot → DOR | |
| California | flat (2 rates) | **10.23% bonus & stock options / 6.6% other supplemental** | **EDD DE 44 (verified)** | + SDI 1.3% (no wage cap) also withheld; model as optional line |
| Colorado | regular | ~4.4% (flat income rate) | Repo | Aggregate; repo flat 4.4% |
| Connecticut | regular | aggregate (bracket) | Repo | No separate rate |
| Delaware | regular | aggregate (bracket) | Patriot/Repo | State recommends 5.0% for **deferred comp only** |
| District of Columbia | regular | aggregate (bracket) | Repo | No separate rate |
| Florida | none | — | Repo | No income tax |
| Georgia | regular | ~4.99% (flat income rate) | Repo — **FLAG** | Aggregate. Repo value 4.99% may lead the actual 2026 phase-down rate — verify (§7) |
| Hawaii | regular | aggregate (bracket) | Repo | No separate rate |
| Idaho | flat (optional) | 5.3% | Patriot → DOR | Optional; else aggregate. Matches repo income top 5.3% |
| Illinois | regular | ~4.95% (flat income rate) | Repo | Aggregate; repo flat 4.95% |
| Indiana | regular | ~2.95% (flat) + county | Repo | County income taxes not modeled |
| Iowa | flat | 3.8% | Patriot → DOR | When paid separately |
| Kansas | flat | 5.0% | Patriot → DOR | When paid separately |
| Kentucky | regular | ~3.5% (flat income rate) | Repo | Aggregate; repo flat 3.5% |
| Louisiana | regular | ~3.0% (flat income rate) | Repo | Aggregate; repo flat 3.0% |
| Maine | flat (optional) | 5.0% | Patriot → DOR | Optional if paid separately |
| Maryland | regular | aggregate (bracket) + county | Repo | County piggyback not modeled |
| Massachusetts | regular | ~5.0% (flat) + 4% surtax >$1M | Repo | Aggregate; 5% base, 4% millionaire surtax |
| Michigan | regular | ~4.25% (flat) + city | Repo | City income taxes not modeled |
| Minnesota | flat | **6.25%** | **EY (verified)** | |
| Mississippi | regular | ~4.0% (flat-ish) | Repo | Aggregate |
| Missouri | flat | 4.7% | Patriot → DOR | |
| Montana | flat | 5.0% | Patriot → DOR | |
| Nebraska | flat | 3.5% | Patriot → DOR | |
| Nevada | none | — | Repo | No income tax |
| New Hampshire | none | — (wages) | Repo | Taxes interest/dividends only, being phased out; 0% on wages |
| New Jersey | regular | aggregate (bracket) | Patriot/Repo | Aggregate, or withhold without exemptions |
| New Mexico | flat | 5.9% | Patriot → DOR | |
| New York | flat | **11.7% state** (+ NYC 4.25%, Yonkers 1.61135% resident / 0.5% non-resident) | **NYS-50-T (verified)** | Locals are separate optional lines |
| North Carolina | flat | **4.09%** | Patriot → DOR — **FLAG** | Distinct from the 3.99% income flat rate — do **not** reuse repo income rate |
| North Dakota | flat | 1.5% | Patriot → DOR | |
| Ohio | flat | 3.5% | Patriot/EY | |
| Oklahoma | flat | 4.5% | Patriot → DOR | |
| Oregon | flat | **8.0%** | **EY (verified)** | |
| Pennsylvania | regular | ~3.07% (flat) + local EIT | Repo | Local earned-income tax not modeled |
| Rhode Island | flat | 5.99% | Patriot → DOR | |
| South Carolina | regular | aggregate (bracket) | Patriot/Repo | No published rate; certain payments at max rate |
| South Dakota | none | — | Repo | No income tax |
| Tennessee | none | — | Repo | No income tax |
| Texas | none | — | Repo | No income tax |
| Utah | regular | ~4.5% (flat income rate) | Repo | Aggregate; repo flat 4.5% |
| Vermont | flat (of federal) | **30% of federal income tax withheld** (or 6% for nonqualified deferred comp) | **VT (verified 2ary)** | NOT a percent of the bonus — a percent of the federal withholding |
| Virginia | flat (optional) | 5.75% | Patriot → DOR | Optional flat, or aggregate if tax already withheld |
| Washington | none | — (wages) | Repo | Cap-gains tax only; 0% on wages |
| West Virginia | regular | aggregate (bracket) | Repo | No separate rate |
| Wisconsin | flat (graduated) | 3.54% / 4.65% / 5.30% / 7.65% by annual gross band | Patriot → DOR — **FLAG** | Bands: <$12,760 → 3.54%; $12,760–$25,520 → 4.65%; $25,520–$280,950 → 5.30%; >$280,950 → 7.65% |
| Wyoming | none | — | Repo | No income tax |

Bucket counts: **none = 9** (AK, FL, NV, NH, SD, TN, TX, WA, WY) · **flat = 22** · **regular = 20**. Total 51. ✓

### 2.3 Local wage taxes (out of scope for v1, note in UI)
NYC (4.25% supp), Yonkers, PA local EIT, MD county piggyback, OH/MI/IN/KY city & county taxes are **not** modeled in the paycheck engine today. Keep that consistent: show a one-line "local city/county taxes may also apply" note on affected state pages rather than half-modeling them. (NYC/Yonkers can be offered as an **optional** add-on line since their supplemental rates are cleanly published.)

---

## 3. Primary & secondary sources

**Federal (primary):**
- IRS Pub 15 (Circular E) 2026 — Supplemental Wages: https://www.irs.gov/publications/p15 · PDF https://www.irs.gov/pub/irs-pdf/p15.pdf
- IRS Pub 15-T (2026) Federal Income Tax Withholding Methods: https://www.irs.gov/publications/p15t
- IRS Pub 15-A (2026) Employer's Supplemental Tax Guide: https://www.irs.gov/publications/p15a
- OBBBA / P.L. 119-21 permanence of TCJA rates (confirms 22%/37% carry into 2026).

**State (verified directly this pass):**
- California EDD DE 44 (2026) + DE 231PS Supplemental Wage Payments: https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de44.pdf · https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de231ps.pdf
- New York NYS-50-T-NYS (1/26) + NYS-50-T-Y (Yonkers): https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf · https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_y.pdf
- Minnesota & Oregon (via EY 2026 chart): https://taxnews.ey.com/news/2026-0153-2026-state-supplemental-flat-tax-and-highest-income-tax-withholding-rates-with-hyperlinks-to-the-latest-withholding-tables-instructions
- Vermont 30%-of-federal (secondary confirm; verify against VT Dept of Taxes 2026 withholding guide before publish).

**State (aggregator — Patriot; per-state DOR confirmation required before publish):**
- Patriot Software 2026 Supplemental Tax Rates By State: https://www.patriotsoftware.com/blog/payroll/supplemental-tax-rates-by-state/

**Repo (already sourced — income-tax status/type/rates per state DOR):**
- `src/data/tax-data-2026.json` (federal brackets/std-ded/FICA + all 51 income-tax tables; `_meta.lastSourced` 2026-06-16, federal confirmed vs IRS Rev. Proc. 2025-32 & SSA COLA).
- `src/data/state-payroll-2026.json` (SDI/PFL, local-income-tax flags, min wage — reuse the SDI/local flags).

---

## 4. Calculator mechanics

### 4.1 Inputs
| Input | Type | Notes |
|---|---|---|
| Bonus amount | number (USD) | The supplemental payment |
| State | select (51) | Fixed per state page; a select on the hub page |
| Regular annual income | number (USD) | For the true-liability estimate + FICA wage-base logic; optional but drives the differentiator |
| Filing status | single / married / head_of_household | Affects true-liability marginal rate + additional-Medicare threshold |
| YTD supplemental wages (advanced) | number, default 0 | Only matters for the $1M / 37% edge; keep in an advanced block |
| Withholding method (advanced) | flat / aggregate | Default flat; aggregate reuses the paycheck engine on (regular + bonus) |

### 4.2 Outputs (two columns, side by side)
**Column A — "Withheld from your check now"**
- Federal supplemental withholding: `min(bonus, 1e6 − ytdSupp)×0.22 + max(0, bonus − that)×0.37`
- State supplemental withholding: per §2 method (`flat` → `bonus×rate`; `regular` → engine aggregate delta; VT → `0.30×federalWithheld`; CA → 10.23%/6.6% by type; WI → banded).
- FICA: SS `min(bonus, max(0, 184500 − regIncome))×0.062` + Medicare `bonus×0.0145` + additional Medicare `0.9%` on the portion of (reg+bonus) over the status threshold.
- **Take-home now** = bonus − (federal + state + FICA). Show as $ and % of bonus.

**Column B — "What it'll actually cost you at tax time"**
- True federal tax on bonus = `fedTax(regIncome + bonus) − fedTax(regIncome)` at the graduated brackets (reuse `federalIncomeTax` / `federalBracketBreakdown`).
- True state tax on bonus = `stateTax(regIncome + bonus) − stateTax(regIncome)` (reuse `stateIncomeTax`). FICA is identical to Column A (not a prepayment).
- **True total tax on bonus** and **true keep**.

**The headline delta:** `federal+state withheld (A) − true income tax (B)`.
- Positive → **"≈ $X of this is over-withholding you can expect back as a refund."**
- Negative → **"Heads up: withholding is $X short of what you'll owe — set it aside."**

### 4.3 Suggested engine surface (mirror the OBBBA/Roth engine style)
New file `src/engine/bonus-tax.js`, pure, importing nothing but the data:
```
supplementalStateWithholding(bonus, stateSupp, {regIncome, filingStatus, taxData}) -> number
federalSupplementalWithholding(bonus, ytdSupp=0) -> number      // 22%/37% split
bonusFicaWithholding(bonus, regIncome, filingStatus, fed) -> number
trueTaxOnBonus(bonus, regIncome, filingStatus, stateSlug, taxData) -> {federal, state, fica, total}
computeBonus({bonus, regIncome, filingStatus, stateSlug, ytdSupp, method}, taxData, suppData) -> {withheld, trueLiability, delta, ...}
```
`trueTaxOnBonus` and the aggregate path are **thin wrappers over the existing `paycheck-engine.js`** functions — no re-derivation of brackets.

---

## 5. Test fixtures (11; ≥8 required)

All computed against the repo's `paycheck-engine.js` + `tax-data-2026.json` (2026 single-filer federal brackets, std ded $16,100, SS base $184,500). Numbers are exact from `/tmp/bonus_fixtures.mjs`. `fedTrueMarg$` = true federal tax on the bonus alone.

| # | Scenario | Bonus | Reg income | State | Fed WH (22/37) | State WH | FICA | Total WH | Keep now | WH % | True fed tax | Delta (refund +/owe −) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | TX no-tax, mid earner | 10,000 | 60,000 | none | 2,200 | 0 | 765 | 2,965 | 7,035 | 29.65% | 1,550 | **+650 refund** (bonus straddles 12/22%) |
| F2 | CA bonus rate 10.23% | 10,000 | 60,000 | 10.23% | 2,200 | 1,023 | 765 | 3,988 | 6,012 | 39.88% | 1,550 | fed +650; CA over-withholds too |
| F3 | NY own-supp 11.7% | 10,000 | 90,000 | 11.7% | 2,200 | 1,170 | 765 | 4,135 | 5,865 | 41.35% | 2,200 | fed matches; NY over-withholds |
| F4 | IL flat 4.95% (regular-method proxy) | 10,000 | 60,000 | 4.95% | 2,200 | 495 | 765 | 3,460 | 6,540 | 34.60% | 1,550 | +650 fed |
| F5 | PA flat 3.07%, 12% bracket | 5,000 | 45,000 | 3.07% | 1,100 | 153.50 | 382.50 | 1,636 | 3,364 | 32.72% | 600 | **+500 refund** (22% WH vs 12% real) |
| F6 | NM own-supp 5.9% | 8,000 | 70,000 | 5.9% | 1,760 | 472 | 612 | 2,844 | 5,156 | 35.55% | 1,760 | fed matches |
| F7 | OH own-supp 3.5% | 3,000 | 55,000 | 3.5% | 660 | 105 | 229.50 | 994.50 | 2,005.50 | 33.15% | 360 | **+300 refund** |
| F8 | VT 30%-of-federal | 10,000 | 60,000 | 30%×fed | 2,200 | 660 | 765 | 3,625 | 6,375 | 36.25% | 1,550 | state = 0.30×2,200 = 660 |
| F9 | **$1.5M edge**, TX | 1,500,000 | 300,000 | none | 405,000 | 0 | 35,250 | 440,250 | 1,059,750 | 29.35% | 547,866 | **−142,866 owe** (37% real > 22/37 blend; SS capped) |
| F10 | low earner refund, TX | 5,000 | 30,000 | none | 1,100 | 0 | 382.50 | 1,482.50 | 3,517.50 | 29.65% | 600 | **+500 refund** |
| F11 | high earner owe-more, TX | 50,000 | 500,000 | none | 11,000 | 0 | 1,175 | 12,175 | 37,825 | 24.35% | 17,500 | **−6,500 owe** (35% real > 22% WH) |

Coverage: no-tax state (F1/F9/F10/F11), own-distinct-flat-rate (F2/F3/F6/F7), flat-tax-via-regular-method proxy (F4/F5), percent-of-federal special (F8), $1M/37% edge (F9), and the withholding-≠-liability delta in **both** directions (refund F1/F5/F7/F10; owe F9/F11). Add WI-banded and CA-6.6%-other fixtures when those rates are DOR-confirmed.

---

## 6. Reuse assessment (extend in place vs. new sibling)

**Verdict: extend in place. No new engine for the core math; one small new data file + one thin engine wrapper.**

| Piece | Reuse? | Detail |
|---|---|---|
| `paycheck-engine.js` (`applyBrackets`, `federalIncomeTax`, `federalBracketBreakdown`, `stateIncomeTax`, `ficaTax`) | **Reuse as-is** | Column B (true liability) and the `regular`/aggregate state path are literally `f(reg+bonus) − f(reg)` over these. No changes. |
| `tax-data-2026.json` | **Reuse** | Federal brackets, std ded, FICA, and all 51 income-tax tables already sourced & 2026-current. The `regular`-method states get their withholding straight from here. |
| `state-payroll-2026.json` | **Reuse partial** | SDI/PFL rate (CA 1.3% etc.) and `localIncomeTax.exists` flags feed the optional SDI/local lines. |
| `states.json` roster + `state-page.html` build loop | **Reuse pattern** | The 51-page cluster clones the paycheck-calculator generation loop in `build.js` (keyed on `taxData.states`), new template `bonus-tax-calculator.html`, slug `/{slug}-bonus-tax-calculator/`. |
| Supplemental **rate per state** | **NET-NEW** | The 22 `flat`-method rates + the CA/NY/VT/WI specials are **not** in the repo. Add `src/data/state-supplemental-2026.json` keyed by slug: `{method:"none"|"flat"|"regular", rate, special}`. Do **not** fold into tax-data-2026.json — supplemental rates change on a different cadence and some (NC 4.09% vs income 3.99%) deliberately differ from the income rate. |
| `bonus-tax.js` engine | **NET-NEW (thin)** | ~60 lines: the 22/37 federal split, the state-method dispatch, and wrappers over the paycheck engine for Column B. |

**Explicit reuse gotchas:**
- **Do not** assume `supplemental rate = income flat rate.** True for IL/PA/CO/UT/KY/LA/AZ (regular-method flat states) but **false** for NC (4.09% supp vs 3.99% income) and for the whole `flat` bucket.
- **Vermont** breaks the `bonus × rate` shape — it's `0.30 × federalWithheld`. The data schema needs a `special:"pct_of_federal"` flag.
- **California** needs two rates keyed by payment type (bonus/stock-option 10.23% vs other 6.6%) — schema `special:"ca_dual"`.
- **Wisconsin** needs the four-band lookup on annual gross — schema `special:"wi_banded"`.

---

## 7. Myth-bust framing (matches the senior-deduction / OBBBA voice)

**Core myth:** *"Bonuses are taxed at a higher rate."*
**Truth:** They're not taxed differently at all — they're **withheld** differently. The 22% federal flat rate is a prepayment default, not a tax bracket for bonuses. Your bonus is ordinary income taxed at your normal marginal rate when you file. If your real rate is under 22% (most people, most bonuses), the extra withholding comes back as a **refund**. If it's over 22% (high earners), you'll **owe the rest** — the 22% didn't save you anything.

Secondary myths to bust on-page:
- *"They took 40% of my bonus!"* — That's 22% federal + your state supp + 7.65% FICA **withholding**. Only the income-tax slice trues up; FICA is real. (Fixtures F2/F3 show the 40%+ withholding that mostly isn't final tax.)
- *"Getting a bonus pushes all my income into a higher bracket."* — No. Brackets are marginal; only the dollars above each threshold are taxed higher (Fixture F1: the bonus itself splits across 12% and 22%).
- *"Aggregate vs. flat changes my tax."* — It only changes the **timing/amount withheld**, never the tax owed. Same year-end number either way.

---

## 8. Build notes / open flags

**Must-fix before publishing a given state page (verification gate):**
1. **~17 `flat`-bucket rates rest on Patriot alone** (AL, AR, IA, KS, ME, MO, MT, NE, ND, OK, RI, VA, ID, and the AZ/CO/… income proxies). Confirm each against the state DOR's 2026 withholding guide (or the EY 2026 chart PDF) before that page ships. CA, NY, MN, OR, VT are already verified.
2. **North Carolina 4.09%** — FLAG: differs from the 3.99% income rate; confirm vs NC-30 (2026). Get this right or the page is wrong.
3. **Wisconsin banded rates** — FLAG: confirm the four bands + thresholds vs WI DOR Pub W-166 (2026).
4. **Vermont 30%-of-federal** — confirm vs VT Dept of Taxes 2026 withholding guide (currently secondary-sourced).
5. **Georgia income rate 4.99%** in repo — FLAG: GA is mid phase-down; verify the actual 2026 flat rate. Low impact (GA is regular-method anyway) but the paycheck pages share this value.

**Scope decisions locked in:**
- Local wage taxes (NYC/Yonkers excepted as optional lines) stay **out** of v1, consistent with the paycheck engine.
- SS wage-base interaction is modeled (fixture F9 correctly zeroes SS on the bonus once regular wages exceed $184,500).
- Client-side only, no backend — same as every other tool. All data ships in the page as injected JSON (strip internal `_source` keys via the existing `stripInternal`).

**Confidence:** Federal HIGH (IRS Pub 15/15-T 2026, direct). State supplemental: HIGH for CA/NY/MN/OR/VT, MEDIUM for the Patriot-sourced `flat` bucket (gated per §8.1), HIGH for the `none`/`regular` buckets (repo-sourced). No hard number in this spec is a guess; every uncertain one is flagged above.
