# QCD vs. Charitable Deduction Calculator (2026) — Sourced Spec

**Tool slug (proposed):** `/qcd-vs-charitable-deduction-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA cluster (tips / overtime / SALT / car-loan / senior / charitable).
**Prepared:** 2026-07-12. This is the **8th** item in the autonomous roadmap chain (fable scout → this spec → build → fable verify → deploy). It **reuses** the already-shipped Charitable Deduction Calculator engine (`charitableComparison` in `src/engine/obbba-deduction.js`, data `federal.charitable`) for the "take the distribution and deduct it" side — it does **not** reimplement charitable-deduction math.
**Primary sources:** every load-bearing number verified against **IRS Notice 2025-67** (2026 retirement-plan/IRA amounts), **IRS Pub 590-B (2025)** (QCD mechanics), and the **codified IRC §408(d)(8)** at law.cornell.edu. Secondary sources used only for corroboration.

---

## 0. Plain-language summary (read this first)

If you are **70½ or older** and you want to give money to charity from a **traditional IRA**, you have two ways to do it, and they are taxed very differently:

- **Path A — QCD (Qualified Charitable Distribution):** you tell your IRA custodian to send the money **straight to the charity**. That money is **never counted as income at all** — it never shows up in your AGI. You get **no** separate charitable deduction (you can't double-dip), but you didn't need one, because the money was never taxed in the first place.
- **Path B — Take it as income, then deduct it:** you pull the money out of the IRA (it's **taxable income**, so your AGI goes **up**), then you try to write off the gift as a charitable deduction. But that deduction only helps **if you itemize**, and post-2026 it's shrunk by a **new 0.5%-of-AGI floor**, capped by the **60%-of-AGI ceiling**, and (top bracket) haircut by the **§68 2/37 rule**. If you take the standard deduction — like most retirees — Path B gives you almost nothing: only the small **§170(p) $1,000 / $2,000** non-itemizer deduction.

**The whole point of the tool:** for the *same dollars given to the same charity*, show the actual federal-tax and AGI difference between these two paths.

**What the initial framing got right, and the corrections primary sources forced (details in §2):**
- ✅ **Age 70½, RMD-satisfaction, direct-transfer, DAF/foundation/supporting-org exclusion, traditional-IRA-not-401(k), the "excluded from gross income / never hits AGI" mechanism** — all **CONFIRMED** against §408(d)(8) and Pub 590-B.
- ⚠️ **CORRECTION 1 — the 2026 limit is $111,000, NOT $108,000 (and definitely not the stale $100,000/$105,000).** The roadmap flagged this risk explicitly, and it was right to: my very first web search returned "$108,000 for 2026," which is **wrong — that's the 2025 figure.** IRS Notice 2025-67 states verbatim the 2026 annual QCD exclusion is **increased from $108,000 to $111,000**; the one-time split-interest QCD is **$54,000 → $55,000**. The IRS's own newsroom QCD article still shows **$100,000** (never updated). Trust N-25-67 / Pub 590-B, not the article.
- ⚠️ **CORRECTION 2 — "QCD is ALWAYS strictly better on tax" is FALSE at/below the §170(p) cap.** For a gift **≤ $1,000 (single) / $2,000 (MFJ)**, the take-and-deduct path removes the exact same dollars from taxable income (via §170(p)) as the QCD excludes, so the two paths **tie on federal income tax** (worked case Q5). QCD still wins, but *only through the AGI cascade* (IRMAA / SS taxability / phase-outs), not through income tax. The tool must not claim a federal-income-tax win in that band.
- ⚠️ **CORRECTION 3 — the competitor gap is narrower than "no tools exist."** There are several QCD calculators (SuperCalc, Calk-USA, Schwab/Fidelity content, plus advisor lead-gen pages). The real gap: **almost none model the 2026 OBBBA charitable-deduction changes** (the 0.5% floor, the §170(p) $1k/$2k cap, the §68 haircut) on the take-and-deduct side, and most compare "QCD vs. RMD," not "QCD vs. deduct." Our differentiator is plugging the **already-built, OBBBA-2026-accurate** deduction engine into the Path-B side.
- ⚠️ **CORRECTION 4 — the deduction side must use the 65+ standard deduction.** Every user of this tool is 70½+, so the correct standard deduction on Path B is the base 2026 amount **plus the age-65+ additional standard deduction** (~$2,050 single/HoH, ~$1,650 per qualifying spouse MFJ). The shipped `charitableComparison` reads `fed.standardDeduction`, which carries **only the base amount** — passing it unadjusted understates the standard deduction and overstates how often Path B itemizes. New requirement (§5.3).

**Confidence:** HIGH on all figures (§408(d)(8) statute + N-25-67 + Pub 590-B, all quoted). The one-time split-interest QCD ($55,000 to a CRT/CGA) is confirmed but **out of scope for v1** (rare; flagged §7).

---

## 1. Primary-source facts (verified, quoted)

### 1.1 The 2026 dollar limit — IRS Notice 2025-67 (verbatim)

> "The aggregate amount of qualified charitable distributions that are not includible in gross income under section 408(d)(8)(A) is increased from **$108,000 to $111,000**. The amount of qualified charitable distributions made directly to a split-interest entity that are not includible in gross income under section 408(d)(8)(F)(i)(II) pursuant to a one-time election is increased **from $54,000 to $55,000**."

- **2026 annual QCD limit = $111,000 per individual.** History: **$100,000** through 2023 (fixed by statute), then indexed under §1(f)(3) "for any taxable year beginning after 2023" (§408(d)(8)(A) flush language): **$105,000 (2024) → $108,000 (2025) → $111,000 (2026)**. Pub 590-B (2025) corroborates: its current-year worksheet caps at **$108,000**, its *subsequent-year* worksheet at **$111,000**.
- **Per person, not per return.** On a joint return, **each spouse** can QCD up to **$111,000 from their own IRA** (a spouse can't use the other's limit).
- **One-time split-interest QCD = $55,000 (2026)** — a single lifetime election funding a CRAT / CRUT / charitable gift annuity (§408(d)(8)(F)). Real but rare; **v1 does not model it** (§7).

### 1.2 Age 70½ vs. RMD age 73 — the confusion the tool must clear up

- **QCD eligibility: "attained age 70½."** §408(d)(8)(B): the distribution must be "made **on or after the date** that the individual … has **attained age 70½**." Pub 590-B: "You must be **at least age 70½ when the distribution is made**." This is the **actual day** you turn 70½, not merely the calendar year — a distribution before that exact date is **not** a QCD.
- **RMD age: 73.** Pub 590-B: "**Age 73 for tax years 2023 and later.**" SECURE 2.0 raised the required-beginning-date age from 72 to **73** (and to 75 in 2033).
- **The headline clarification:** you can start doing QCDs at **70½**, roughly **2½ years before RMDs even begin at 73**. The two ages are unrelated; the tool should state this plainly, because it is the single most common QCD misconception.

### 1.3 How a QCD counts toward the RMD

- Pub 590-B: "**A QCD will count towards your required minimum distribution.**" A QCD made in an RMD year offsets the RMD dollar-for-dollar (up to the QCD amount and the $111,000 cap).
- **Ordering ("first dollars out"):** the *first* distributions you take in a year are what count toward the RMD. So to make a QCD satisfy the RMD, **do the QCD before** taking any other IRA withdrawal that year — otherwise the earlier taxable withdrawal eats the RMD and the QCD becomes "extra."
- A QCD can be made **at 70½–72 even though no RMD is due yet** — it still excludes income; it just isn't "satisfying" an RMD that doesn't exist yet.

### 1.4 The core tax mechanism (why QCD ≠ deduct)

- **QCD is excluded from gross income entirely.** §408(d)(8)(A): the QCD amount "**shall not be includible in gross income.**" It never enters AGI. Pub 590-B: "You **can't** claim a charitable contribution deduction for any QCD not included in your income" — no double-dip, and none is needed.
- **Take-and-deduct raises AGI first, then offsets.** The distribution is ordinary income (AGI ↑), and the deduction only claws it back **if you itemize**, now net of the **0.5%-of-AGI floor** (§170(b)(1)(I)), under the **60%-of-AGI cash ceiling** (§170(b)(1)(G), made permanent), and (top bracket) after the **§68 2/37 haircut**. Non-itemizers get only the **§170(p) $1,000/$2,000** cash deduction.
- **Why QCD's "never hits AGI" is worth more than an equal-sized deduction:** a lower AGI cascades into **Medicare IRMAA** part-B/D surcharge tiers, the **taxability of Social Security benefits** (the §86 provisional-income thresholds), the **3.8% NIIT** threshold, and any AGI-phased deduction/credit — **none** of which an itemized deduction (taken *after* AGI) can help. And QCD works **even for the ~90% of retirees who take the standard deduction**, where a charitable deduction is nearly worthless.

### 1.5 Withholding wrinkle (verified — a genuine point in QCD's favor)

- A normal IRA distribution defaults to **10% federal withholding** (§3405(b); waivable to 0–100% via **Form W-4R** for a payee in the U.S.).
- A **QCD is deemed to have elected out of withholding under §3405(a)(2)** — so **no federal tax is withheld** and the **full amount reaches the charity**. (There's nothing to withhold against anyway, since a QCD isn't includible in income.) State withholding rules can differ.

### 1.6 Eligibility restrictions (verified against §408(d)(8)(B)/(C) + Pub 590-B)

- **Direct trustee-to-charity only.** §408(d)(8)(B): "made **directly by the trustee**." A check paid to *you* that you forward is **not** a QCD (a custodian check payable to the charity, mailed to you to deliver, is OK).
- **Recipient must be a §170(b)(1)(A) public charity — with three carve-outs.** §408(d)(8)(B)(i): the donee is an org described in §170(b)(1)(A) "**(other than any organization described in section 509(a)(3)** [supporting organizations] **or any fund or account described in section 4966(d)(2)** [donor-advised funds])." **Private non-operating foundations** are excluded too (they aren't §170(b)(1)(A) orgs). So: **no DAFs, no supporting organizations, no private foundations.**
- **Entire gift must otherwise be 100% deductible.** §408(d)(8)(C): a distribution counts "only if **a deduction for the entire distribution would be allowable under section 170**" (determined without the percentage limits). Practical effect: if you get anything back (gala dinner, raffle, member perks), it's **not** a QCD; you need the same written acknowledgment you'd need to claim a §170 deduction.
- **Account type: an IRA — and not an *ongoing* SEP/SIMPLE.** Pub 590-B: "made directly by the trustee of your IRA **(other than an ongoing SEP or SIMPLE IRA)**." **401(k)/403(b)/457 plans do NOT qualify** — you'd have to roll to an IRA first. **Traditional IRAs** are the standard vehicle. **Roth IRAs** technically qualify but are almost never worth using (qualified Roth distributions are already tax-free, so a Roth QCD wastes the exclusion) — the tool should steer to traditional and flag Roth as "usually not worth it."
- **Only the otherwise-taxable portion is a QCD.** If the IRA holds **nondeductible-contribution basis**, the QCD is deemed to come out of the **taxable** money **first** (Pub 590-B example) — favorable, and the opposite of the normal pro-rata rule. Basis can't be QCD'd (it wasn't taxable), but it can be deducted on Schedule A if you itemize.
- **Post-70½ deductible-contribution offset (anti-abuse).** §408(d)(8)(A) flush language + Pub 590-B "QCD Adjustment Worksheet": if you're still working and **deduct IRA contributions after age 70½**, your **excludable QCD is reduced dollar-for-dollar** by the cumulative post-70½ deducted contributions (net of amounts already used to reduce prior QCDs). Rare for retirees, but real; v1 handles it as an optional advanced input (§5).

---

## 2. Roadmap verdict (confirm / correct)

| Roadmap claim / question | Verdict | Note |
|---|---|---|
| 2026 QCD limit (warned against stale $100k/$105k) | ⚠️ **CORRECTED to $111,000** | N-25-67 verbatim; $108k is the **2025** figure my first search wrongly returned for 2026 |
| Age 70½ (exact) vs RMD age 73 | ✅ CONFIRMED | "attained age 70½" on the distribution date; RMD age 73 (SECURE 2.0) |
| QCD counts toward the RMD | ✅ CONFIRMED | + the "first-dollars-out" ordering nuance |
| QCD excluded from gross income / never hits AGI | ✅ CONFIRMED | §408(d)(8)(A) "shall not be includible in gross income" |
| Take-and-deduct raises AGI then offsets (itemize + floor + §68) | ✅ CONFIRMED | reuse the shipped `charitableComparison` for exactly this |
| Withholding: does a QCD get withheld? | ✅ CONFIRMED — **no** | deemed elected-out under §3405(a)(2); full amount reaches charity |
| Direct custodian→501(c)(3); no DAF/foundation/supporting org | ✅ CONFIRMED | §408(d)(8)(B)(i) statutory exclusions |
| From a traditional IRA, not a 401(k) | ✅ CONFIRMED | IRA only; not an *ongoing* SEP/SIMPLE; Roth qualifies but rarely useful |
| "QCD is strictly better than take-and-deduct" | ⚠️ **NUANCED** | **Ties on income tax at/below the §170(p) cap** (Q5); wins via AGI. Under 70½ or over $111k, take-and-deduct is the *applicable* path, not a "better" one |
| Competitor gap is real | ⚠️ **NARROWER** | Tools exist; few model the 2026 OBBBA deduction rules — that's our edge |

This is the **8th straight spec to catch a real error** in the initial framing: the load-bearing one here is the **$111,000** figure (a live, current-year number the first search got wrong), plus the **"tie at/below the §170(p) cap"** correction to the always-QCD myth.

---

## 3. Proposed `federal.qcd` dataset entry

New entry in `src/data/obbba-deductions-2026.json` under `federal` (siblings the existing `charitable`). QCD is **not** an OBBBA provision — it predates OBBBA and is permanent — but co-locating it keeps the tax-parameter store in one place; the `_meta` note should say so.

```jsonc
"qcd": {
  "statute": "IRC §408(d)(8) 'Distributions for charitable purposes' (qualified charitable distributions). Annual limit inflation-indexed under §408(d)(8)(A) flush language + §1(f)(3) since 2024. NOT an OBBBA provision; permanent.",
  "permanent": true,
  "indexed": true,
  "annualLimitBaseYear2023": 100000,
  "annualLimitByYear": { "2024": 105000, "2025": 108000, "2026": 111000 },
  "splitInterestOneTimeByYear": { "2024": 53000, "2025": 54000, "2026": 55000 },
  "ageEligible": 70.5,
  "rmdAge2023plus": 73,
  "perPersonNotPerReturn": true,
  "excludedFromGrossIncome": true,
  "reducesAgi": true,
  "noSeparateDeduction": true,
  "notSubjectToWithholding": true,
  "withholdingCite": "deemed elected out under §3405(a)(2)",
  "eligibleAccounts": ["traditional_ira", "roth_ira_rarely_useful", "inactive_sep_ira", "inactive_simple_ira"],
  "ineligibleAccounts": ["401k", "403b", "457", "ongoing_sep_ira", "ongoing_simple_ira"],
  "eligibleOrgs": "section 170(b)(1)(A) public charities",
  "excludedOrgs": ["donor_advised_funds", "private_non_operating_foundations", "section_509(a)(3)_supporting_orgs"],
  "directTrusteeToCharityRequired": true,
  "entireGiftMustBe100pctDeductible": true,
  "taxablePortionFirst": true,
  "post70HalfDeductibleContributionOffset": true,
  "qualifies": "A QCD lets an IRA owner age 70½+ send up to $111,000 (2026; indexed, per person) directly from the IRA trustee to a §170(b)(1)(A) public charity. The amount is EXCLUDED from gross income (§408(d)(8)(A) 'shall not be includible in gross income') — it never enters AGI, and no separate charitable deduction is allowed (no double-dip). It counts toward that year's RMD (RMD age is 73 under SECURE 2.0, so QCDs are available ~2.5 years before RMDs begin). Must go DIRECTLY from the trustee to the charity — NOT a donor-advised fund, private foundation, or §509(a)(3) supporting organization — and the entire gift must otherwise be 100% deductible under §170 (no return benefit). From an IRA only (not a 401(k); not an ongoing SEP/SIMPLE). Not subject to federal withholding (deemed elected out under §3405(a)(2)). The excludable amount is reduced by post-70½ deducted IRA contributions.",
  "sources": [
    { "claim": "2026 annual QCD limit $108,000 → $111,000; one-time split-interest $54,000 → $55,000.", "url": "https://www.irs.gov/pub/irs-drop/n-25-67.pdf" },
    { "claim": "§408(d)(8): 'shall not be includible in gross income'; age 70½ 'attained'; direct-by-trustee to §170(b)(1)(A) org OTHER THAN a §509(a)(3) supporting org or §4966(d)(2) DAF; entire distribution must be allowable as a §170 deduction; $100,000/$50,000 base amounts indexed after 2023.", "url": "https://www.law.cornell.edu/uscode/text/26/408" },
    { "claim": "Pub 590-B QCD mechanics: 'at least age 70½ when the distribution is made'; 'made directly by the trustee of your IRA (other than an ongoing SEP or SIMPLE IRA)'; 'A QCD will count towards your required minimum distribution'; maximum annual exclusion $108,000 (2025) / $111,000 (subsequent-year worksheet); taxable-portion-first; post-70½ deductible-contribution offset; RMD 'Age 73 for tax years 2023 and later'.", "url": "https://www.irs.gov/pub/irs-pdf/p590b.pdf" },
    { "claim": "A QCD is not subject to federal withholding — deemed to have elected out under §3405(a)(2); normal IRA distributions default to 10% (waivable via Form W-4R).", "url": "https://www.northerntrust.com/united-states/institute/articles/withholding-from-ira-qualified-plan-distributions" }
  ]
}
```

Load `annualLimitByYear[year]` (default 2026 = **$111,000**); the tool is 2026-forward like the shipped charitable engine.

---

## 4. Calculator mechanics (the side-by-side)

Given the **same donation amount** going to the **same charity**, compute both paths and show the difference.

**Inputs → derived:** `donation` (amount to charity), `baseAgi` (AGI **excluding** any IRA distribution for this gift), `filingStatus`, `age`, `otherItemized` (non-charitable Schedule A: SALT-after-cap, mortgage interest, medical over floor), optional `rmdAmount`, optional advanced `post70DeductibleContribs`.

```
qcdLimit   = qcd.annualLimitByYear[year]            // 111000 (2026)
qcdEligible = age >= 70.5
sd65       = fed.standardDeduction[status] + additionalStdDeduction65(status)  // CORRECTION 4

// ---- eligibility gate ----
if !qcdEligible:
    // QCD not available at all. Show Path B only, with a clear "you're not 70½ yet" banner.
    return { eligible:false, pathBOnly: charitableComparison(agi=baseAgi+donation, cashGift=donation, ...) }

// ---- QCD amount (partial if over the limit) ----
qcdAmount  = min(donation, qcdLimit)
qcdAmount  = max(0, qcdAmount - post70DeductibleContribs)   // anti-abuse offset (optional input)
overLimit  = max(0, donation - qcdAmount)                    // remainder handled like Path B

// =================== PATH A — QCD ===================
agiA       = baseAgi + overLimit          // only the non-QCD remainder is taxable income
// the QCD gift is NOT deductible; deduct only OTHER items (+ the overLimit remainder if it beats the floor)
dedA       = REUSE charitableComparison(agi=agiA, cashGift=overLimit, otherItemized=otherItemized, sd=sd65).bestDeduction
taxA       = federalIncomeTax(agiA, status, fed, dedA - sd65)   // exact bracket-diff, engine convention
rmdSatisfiedByQcd = min(qcdAmount, rmdAmount)

// =================== PATH B — take + deduct ===================
agiB       = baseAgi + donation           // FULL distribution is taxable income
resB       = REUSE charitableComparison(agi=agiB, cashGift=donation, otherItemized=otherItemized, sd=sd65)
taxB       = federalIncomeTax(agiB, status, fed, resB.bestDeduction - sd65)

// =================== the answer ===================
qcdSavesFederalTax = taxB - taxA          // > 0 means QCD wins on income tax
agiKeptLowerBy     = agiB - agiA          // = qcdAmount ; drives IRMAA / SS / phase-out callouts
```

**Precision points:**
- **Reuse `charitableComparison` verbatim** for the Path-B deduction math (it already applies §170(p) $1k/$2k, the 0.5% floor, the 60% ceiling logic, §68, and the itemize-vs-standard verdict via exact bracket-diff). Path A reuses the **same** function with `cashGift = overLimit` (0 in the common case) so the two paths are computed by one code path — no parallel engine.
- **Pass the 65+ standard deduction** (`sd65`) into the comparison, not the base `fed.standardDeduction` (CORRECTION 4). New helper `additionalStdDeduction65(status, year)`.
- **The federal-tax difference can be $0** when `donation ≤ §170(p) cap` (both paths remove the same dollars from taxable income) — the tool must then say "same federal income tax; QCD still wins by keeping your AGI $X lower" (CORRECTION 2). Never assert a tax win that isn't there.
- **AGI cascade (IRMAA / SS taxability / NIIT) is an educational callout in v1**, keyed off `agiKeptLowerBy` — do **not** silently compute IRMAA tiers or taxable-SS as hard dollars in v1 (they need more inputs and their own sourced tables); surface "your AGI stays $X lower, which can matter for Medicare IRMAA, how much of your Social Security is taxed, and the 3.8% NIIT." (A v2 could add a sourced IRMAA table.)

### Outputs
1. **Two-column card:** AGI, taxable income, charitable deduction taken, federal income tax — QCD vs. take-and-deduct.
2. **Headline:** "QCD saves you **$X** in federal income tax **and** keeps your AGI **$Y** lower." (If tax delta = 0: "Same federal income tax, but QCD keeps your AGI $Y lower — which can still save you money on Medicare and Social Security taxation.")
3. **RMD line** (if `rmdAmount` given): "This QCD satisfies **$Z** of your $RMD required minimum distribution."
4. **Eligibility banner** if under 70½: "You can't do a QCD until you're 70½ (RMDs don't start until 73). Until then, taking the distribution and deducting it is your only option."
5. **Over-limit note** if `donation > $111,000`: "Only $111,000 can be a QCD this year; the remaining $X was taken as a taxable distribution (and deducted if you itemize)."
6. **Caveats:** cash from a traditional IRA only (not a 401(k)); no DAF/private-foundation/supporting-org; direct trustee-to-charity; no double-dip; state treatment separate.

---

## 5. Reuse assessment (roadmap item 7) — what's reused vs. new

**Reused from `src/engine/obbba-deduction.js` + `federal.charitable` (the whole Path-B engine):**
- **`charitableComparison({ filingStatus, agi, cashGift, otherCharitable, otherItemized, params, fed })`** — the entire take-and-deduct side. Called **twice**: once with `agi = baseAgi + donation, cashGift = donation` (Path B), once with `agi = baseAgi + overLimit, cashGift = overLimit` (Path A's non-QCD remainder, usually 0). This gives §170(p), the 0.5% floor, §68, the 60% ceiling, and the itemize verdict for free.
- **`charitableFloor`, `charitableNonItemizer`, `section68Reduction`** — indirectly, via `charitableComparison`.
- **`federalTaxSaved` / `federalIncomeTax`** (paycheck-engine) — exact bracket-diff for each path's tax.
- **`federal.charitable` data** ($170(p) caps, 0.5% rate, §68 2/37 + 37% thresholds, 60% ceiling) and **`tax-data-2026.json`** brackets + base standard deduction.

**New logic (small, additive — no fork):**
1. **`federal.qcd` data block** (§3): the $111,000 annual limit by year, age 70½, RMD age 73, account/org eligibility, withholding, offset.
2. **QCD-limit lookup + partial-QCD split:** `qcdAmount = min(donation, limit)`, `overLimit` remainder.
3. **AGI-exclusion path (Path A):** run the base-AGI-unchanged scenario — the genuinely new idea, since the shipped charitable tool only ever *adds* a deduction, never *removes income from AGI*.
4. **`additionalStdDeduction65(status, year)`** helper (CORRECTION 4) — the 65+ extra standard deduction, passed into both paths.
5. **RMD-satisfaction logic:** `min(qcdAmount, rmdAmount)`, with the first-dollars-out explainer.
6. **Post-70½ deductible-contribution offset** (optional advanced input): subtract from `qcdAmount`.
7. **Eligibility gate** (under 70½) and **IRMAA/SS educational callouts** (copy, not hard dollars in v1).
8. **A `qcdComparison({...})` orchestrator** returning `{ eligible, qcdAmount, overLimit, agiA, taxA, agiB, taxB, resB, qcdSavesFederalTax, agiKeptLowerBy, rmdSatisfiedByQcd, notes }` — mirrors the shape of `charitableComparison`.

Client-side only; no backend; extends the existing engine — consistent with the repo hard rules. **Cross-link tightly with `/charitable-deduction-calculator/`** (its natural sibling — same deduction engine, opposite question) and the RMD/retirement tools.

---

## 6. Myth-bust / framing block (site style)

- **"You have to be 73 (RMD age) to do a QCD."** No. You can QCD at **70½** — about **2½ years before** RMDs start at 73. Two different ages; people constantly conflate them.
- **"A QCD and 'donate my RMD and write it off' are the same thing."** They're not. A QCD is **never taxed** (excluded from income); taking the money and deducting it makes it **taxable first**, and the deduction only helps if you **itemize** — and even then it's shrunk by the new **0.5%-of-AGI floor**.
- **"I take the standard deduction, so charitable giving does nothing for me."** With a QCD it does — because a QCD isn't a deduction at all, it's an **income exclusion**. Non-itemizers get the **full** benefit (the take-and-deduct path would give them only the **$1,000/$2,000** §170(p) crumb).
- **"QCD always beats take-and-deduct on my taxes."** Almost always — but for a **small gift (≤ $1,000 single / $2,000 MFJ)** the two are a **tie on federal income tax**. QCD still wins, but through a **lower AGI** (Medicare IRMAA, Social Security taxability), not a bigger refund.
- **"Lowering AGI is the real prize."** A QCD keeps the gifted dollars **out of AGI entirely** — which an itemized deduction (taken *after* AGI) can never do. Lower AGI can drop your **Medicare Part B/D surcharge (IRMAA)**, cut how much of your **Social Security** is taxed, and keep you under the **3.8% NIIT** line.
- **"Any charity works."** No **donor-advised funds**, **private foundations**, or **supporting organizations** — and it must go **directly** from your IRA custodian to the charity. And **not from a 401(k)** — it has to be an **IRA**.
- **"The full amount reaches the charity."** Yes — a QCD isn't subject to withholding, unlike a normal IRA withdrawal (which defaults to 10%).

---

## 7. Flagged uncertainties / out-of-scope (none load-bearing for v1 dollar outputs)

- **NOT MODELED (v1) — the one-time $55,000 split-interest QCD** (CRAT/CRUT/CGA, §408(d)(8)(F)). Confirmed figure, but a niche lifetime election; note it exists, don't compute it.
- **NOT MODELED (v1, hard-dollar) — IRMAA and Social-Security-taxability effects.** These are QCD's biggest real-world edge but need their own inputs + sourced tables (IRMAA tiers, the §86 provisional-income formula). v1 surfaces them as **"your AGI stays $X lower, which can matter for…"** callouts; a **v2** can add a sourced IRMAA/SS module. Flag, don't fake.
- **UNCERTAIN — exact 2026 age-65+ additional standard deduction.** ~$2,050 single/HoH and ~$1,650 per qualifying spouse MFJ (2025 was $2,000 / $1,600, indexed). **Verify the 2026 figures from Rev. Proc. 2025-32 before locking** the `additionalStdDeduction65` constant. Affects only the itemize-vs-standard flip on Path B (a higher standard deduction makes Path B itemize *less*, which only *widens* QCD's lead) — so an off-by-$50 error can't flip the QCD-wins conclusion, but get it right for the displayed tax figures. **Do not also stack the OBBBA $6,000 senior bonus into the itemize comparison** — it's below-the-line and applies **equally to both paths**, so it **cancels out of the difference**; modeling it changes each path's absolute tax but **not** `qcdSavesFederalTax`.
- **NOT MODELED (v1) — state conformity.** A few states don't allow the QCD exclusion (they tax the IRA distribution regardless); federally QCD still wins. Federal-only tool, like its siblings — don't invent per-state QCD rows.
- **NOT MODELED (v1) — the taxable-portion-first basis interaction** for IRAs with nondeductible basis. Assume no basis (the norm); if a `hasBasis` flag is ever added, remember the QCD comes from the **taxable** money first (favorable).

---

## 8. Test fixtures (12 cases)

Load-bearing outputs = **AGI on each path, `qcdAmount`, `overLimit`, RMD-satisfied, eligibility, the itemize verdict, and the SIGN of `qcdSavesFederalTax`**. The **dollar** `taxA` / `taxB` / `qcdSavesFederalTax` below are **illustrative** (computed against 2026 brackets with the **65+** standard deduction, single base $16,100+$2,050 = **$18,150**; MFJ base $32,200+$1,650 = **$33,850** for one qualifying spouse) — **regenerate every dollar at build time with the real engine** and lock, exactly as the charitable/SALT/W-4 specs did. `sd65` and the age-65+ constant must be finalized first (§7).

| # | Scenario | Status | Age | baseAGI | Donation | Other item. | QCD amount | Over limit | AGI (QCD) | AGI (deduct) | Path B verdict | **QCD saves fed tax (est.)** | AGI kept lower |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Q1 | Non-itemizer, clear win | single | 75 | 60,000 | 10,000 | 0 | 10,000 | 0 | 60,000 | 70,000 | Standard (+$1,000 §170p) | **≈ $1,125** | 10,000 |
| Q2 | Non-itemizer, MFJ | married | 74 | 90,000 | 20,000 | 0 | 20,000 | 0 | 90,000 | 110,000 | Standard (+$2,000 §170p) | **≈ $2,160** | 20,000 |
| Q3 | Itemizer near the floor | single | 72 | 150,000 | 40,000 | 25,000 | 40,000 | 0 | 150,000 | 190,000 | **Itemize**; floor $950 lost | **≈ $228** (= floor×rate) | 40,000 |
| Q4 | Over the $111k limit (hybrid) | single | 78 | 200,000 | 150,000 | 0 | 111,000 | 39,000 | 239,000 | 350,000 | Itemize (remainder+gift) | **≈ $130** tax, huge AGI gap | 111,000 |
| Q5 | Gift ≤ §170(p) cap — **TIE on tax** | single | 71 | 55,000 | 900 | 0 | 900 | 0 | 55,000 | 55,900 | Standard (+$900 §170p) | **$0** (ties; wins on AGI only) | 900 |
| Q6 | High-AGI itemizer, floor bites | married | 76 | 500,000 | 60,000 | 45,000 | 60,000 | 0 | 500,000 | 560,000 | **Itemize**; floor $2,800 lost | **≈ $896** | 60,000 |
| Q7 | **Under 70½ — not eligible** | single | 68 | 80,000 | 5,000 | 0 | **0 (blocked)** | n/a | n/a | 85,000 | Path B only (informed) | **n/a — QCD unavailable** | 0 |
| Q8 | RMD-satisfying QCD | single | 75 | 70,000 | 8,000 | 0 | 8,000 | 0 | 70,000 | 78,000 | Standard | (QCD wins) | 8,000 |
| Q9 | QCD exactly at the limit | married | 80 | 300,000 | 111,000 | 20,000 | 111,000 | 0 | 300,000 | 411,000 | Itemize | (QCD wins; AGI −111k) | 111,000 |
| Q10 | Post-70½ deductible-contrib offset | single | 73 | 120,000 | 15,000 | 0 | **10,000** (15,000 − 5,000 offset) | 5,000 taxable | 125,000 | 135,000 | Standard | (reduced QCD; still wins) | 10,000 |
| Q11 | §68 top-bracket itemizer | married | 77 | 900,000 | 100,000 | 60,000 | 100,000 | 0 | 900,000 | 1,000,000 | Itemize; **§68 haircut on Path B** | (QCD wins bigger — avoids §68 + floor) | 100,000 |
| Q12 | Roth IRA / 401(k) source | single | 74 | 65,000 | 10,000 | 0 | (steer: use traditional IRA) | — | — | — | informational | **n/a — flag account type** | — |

**Load-bearing notes:**
- **Q1/Q2 (non-itemizer, flagship):** Path B recovers only the §170(p) $1,000/$2,000; the rest of the distribution is fully taxed. QCD excludes the whole gift. This is the "why the tool exists" case — verify the **sign and rough magnitude** (QCD saves ≈ donation-above-cap × marginal rate).
- **Q3/Q6 (itemizer):** QCD's federal-tax edge ≈ **(0.5% × Path-B AGI) × marginal rate** — precisely the **0.5%-of-AGI floor** that Path B loses and QCD avoids. Q3: floor 0.5%×190k = $950 × 24% ≈ $228. Verifies the floor is the itemizer-case driver.
- **Q4 (over limit):** only **$111,000** is a QCD; the **$39,000** remainder is a taxable distribution (deducted on Path A too if it beats the floor). Federal-tax delta is small (itemizer deducts most of it) but **AGI is $111k lower** → the IRMAA/SS callout is the real story. Verifies the partial-QCD split.
- **Q5 (the tie — CORRECTION 2):** $900 ≤ $1,000 §170(p) cap, so Path B removes the same $900 from taxable income as the QCD excludes → **identical federal income tax**. The tool must show **$0 tax difference** and pivot to the AGI message. Guards against over-claiming.
- **Q7 (under 70½ — CORRECTION eligibility):** `qcdEligible = false`. The tool must **not** show a QCD column with numbers; show Path B only + the "not until 70½; RMDs at 73" banner. Verifies the gate **informs**, not silently computes a QCD the user can't legally make.
- **Q8 (RMD):** `rmdSatisfiedByQcd = min(8,000, rmdAmount)`; the QCD both excludes income **and** knocks out (part of) the RMD. Verifies the RMD line + first-dollars-out copy.
- **Q9 (at the limit):** `qcdAmount = 111,000` exactly, `overLimit = 0`. Boundary check for `min(donation, limit)`.
- **Q10 (offset):** post-70½ deducted contributions $5,000 → excludable QCD reduced to $10,000; the $5,000 is taxable. Verifies the anti-abuse offset input.
- **Q11 (§68):** Path B's itemized deduction gets the 2/37 haircut in the 37% bracket **and** loses the 0.5% floor; Path A avoids both. QCD's lead is **widest** here. Verifies §68 flows through `charitableComparison` on Path B and that Path A dodges it.
- **Q12 (account type):** input says Roth IRA or 401(k) → the tool must **flag** it (401(k) ineligible; Roth qualifies but wastes the exclusion) rather than compute a misleading comparison. Verifies the account-eligibility guard.

Add unit tests for: `min(donation, 111000)` at/over the limit; the under-70½ gate; the §170(p)-cap tie (Path A tax == Path B tax when donation ≤ cap); the itemizer floor-delta (`qcdSavesFederalTax ≈ 0.005×agiB×marginalRate` when both paths itemize and no §68); the post-70½ offset subtraction; and that `agiKeptLowerBy == qcdAmount`.

---

## 9. Build notes / guardrails

- **Client-side only; no backend.** Extend `obbba-deduction.js` (+ new `federal.qcd` data) and **reuse `charitableComparison` for the Path-B side** — do **not** fork the charitable engine. Consistent with the repo hard rules.
- **Finalize before build:** (1) the 2026 **age-65+ additional standard deduction** from Rev. Proc. 2025-32 (§7); (2) regenerate all §8 dollar figures against the real engine and lock; (3) confirm the eligibility gate blocks (not silently zeroes) the under-70½ case.
- **Fix the prose to match CORRECTION 2:** at/below the §170(p) cap the tool must say "same federal income tax, QCD wins on AGI," never "QCD saves you tax."
- **Cross-link `/charitable-deduction-calculator/`** (same deduction engine, opposite question) and the RMD/retirement tools; add the "related tools" overrides like the prior tax additions.
- **Seasonality:** peaks Nov–Dec (giving + RMD deadline Dec 31) and Jan–Apr (tax season). Worth an evergreen "70½ vs 73" explainer.
- **Do not ship** until a fable verify pass regenerates §8 dollars, confirms the tie case (Q5), the under-70½ gate (Q7), and the $111,000 boundary (Q9), and re-confirms the 2026 limit against N-25-67 (it re-indexes every year — next year it changes again).
