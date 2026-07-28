# Live in one state, work in another: decision document

**Status:** RESEARCH + DECISION. No code written. Nothing in the repo was modified to produce this.
**Prepared:** 2026-07-28. **Target tax year:** 2026.
**Scope:** the 51 `/{state}-paycheck-calculator/` pages and the shared `paycheck-engine.js`.
**Verdict up front:** BUILD IT, but only the narrow version in section 5, and only after the
one verification gate in section 4.2 clears. Do not build day-count apportionment. Do not
build local taxes. Both are traps that produce confident wrong numbers.

---

## 1. The answer in five sentences

If you live in one state and work in another, two states can look at the same paycheck, and
which one actually gets the money depends on a handful of rules that have nothing to do with
your tax rates. Sixteen jurisdictions have signed reciprocity deals with their neighbours: if
yours is one of them, the state where you work agrees not to tax your wages at all, and you
just pay your home state. Everywhere else, the state where you work taxes you first, then your
home state taxes the same income and hands back a credit for what you already paid, which
means in practice you end up paying whichever of the two states has the higher tax and never
literally pay twice. The nasty case is New York, which taxes the days you work at home in New
Jersey or Connecticut as if you had been sitting in the office, so working remotely does not
get you out of it. And none of this touches city or county taxes, which follow their own rules
and are usually owed anyway.

---

## 2. What the site gets wrong today

All 51 paycheck pages assume one state. `computePaycheck()` takes a single `stateSlug`,
computes one state's income tax, and attaches that same state's paid-leave programs. There is
no second state anywhere in the engine or the data.

The error direction depends on which page the user lands on. Most people search for the state
they *live* in, so the resident-state page is the realistic case. Figures below are single
filer, no pre-tax deductions, run through the repo's own engine against
`src/data/tax-data-2026.json`.

### 2.1 The catastrophic class: no-income-tax state, taxing job

Nine states have no wage income tax. Their pages show **$0 state income tax** to everyone,
including the roughly-large population who cross a border to work. The truth is the full
nonresident tax of the work state, with no offset of any kind, because the home state's tax is
zero so there is nothing to credit. None of these nine is in any reciprocity agreement, so
there is no escape hatch either.

| Lives / works | Salary | Site shows | Truth | Site overstates take-home by |
|---|---|---|---|---|
| WA → OR (Vancouver to Portland) | $85,000 | $0 | $6,865 | **$6,865** |
| WA → OR | $175,000 | $0 | $15,281 | **$15,281** |
| NH → MA (Nashua to Boston) | $95,000 | $0 | $4,530 | **$4,530** |
| NV → CA | $120,000 | $0 | $7,068 | **$7,068** |
| FL → GA | $95,000 | $0 | $3,992 | **$3,992** |
| TN → GA | $85,000 | $0 | $3,493 | **$3,493** |
| TX → LA | $85,000 | $0 | $2,164 | **$2,164** |

This is the argument for doing the work. A $15,281 error on a $175,000 salary is not a rounding
difference, it is the site telling someone their take-home is 9% higher than it is.

The paid-leave programs are wrong here too and in the same direction. The WA page charges a WA
resident $686 of WA PFML at $85,000. A WA resident on an Oregon payroll does not pay WA PFML,
they pay Paid Leave Oregon, $510. Employee paid-leave contributions follow the employer's
state, not the employee's.

### 2.2 The moderate class: two taxing states, no reciprocity

| Lives / works | Salary | Site shows (home page) | Truth | Overstates take-home by |
|---|---|---|---|---|
| NJ → NY | $120,000 | $5,518 | $6,040 | $461 (net, after program swap) |
| NJ → NY | $65,000 | $1,823 | $2,643 | ~$820 |
| PA → NY | $120,000 | $3,684 | $6,040 | **$2,356** |
| CT → NY | $120,000 | $5,950 | $6,040 | $90 |
| AZ → CA | $110,000 | $2,541 | $6,138 | **$3,597** |
| IN → IL | $85,000 | $2,478 | $4,063 | $1,585 |
| MO → KS | $85,000 | $3,058 | $4,454 | $1,397 |
| MD → DC | $110,000 | $5,030 | $5,030 | $0 (DC cannot tax nonresidents) |

**Answering the direct question in the brief:** a New Jersey resident working in New York at
$120,000 is being shown $87,228 annual take-home when the true figure is **$86,767**. The site
overstates by **$461 a year**, which is $17.73 a fortnight. That specific pair is one of the
*least* wrong on the board, because NJ and NY tax rates happen to be close at that income. The
same person at $65,000 is shown a figure about $820 too high, and a Pennsylvania resident in
the same New York job is shown one $2,356 too high.

### 2.3 The class the site already gets right, by accident

For all 58 ordered reciprocity pairs, the truth is "your home state only". A user who lands on
their home state's page and never mentions the second state gets the correct state income tax.
Landing on the *work* state's page gets it wrong, by up to $3,858 (live ND, work MN, $85,000).

This matters for the build: any naive "combine the two states" logic that does not encode
reciprocity would break 58 pairs that currently work.

### 2.4 What is missing entirely, in both directions

Local income taxes are not modelled anywhere in `tax-data-2026.json`. That is a same-state bug
as much as a cross-state one (Maryland county tax, NYC resident tax, Ohio municipal and school
district tax, PA EIT, Indiana county LIT all missing today). Cross-border it gets worse,
because reciprocity explicitly does *not* reach local tax. See section 3.4 and section 4.3.

---

## 3. The four mechanisms

### 3.1 Reciprocity: the work state does not tax you at all

Sixteen jurisdictions. Read as "this work state exempts residents of". Every pair is symmetric;
the conditions are not.

| Work state | Exempts residents of | Employee form | Conditions |
|---|---|---|---|
| Illinois | IA, KY, MI, WI | IL-W-5-NR | none |
| Indiana | KY, MI, OH, PA, WI | WH-47 | County tax still owed |
| Iowa | IL | 44-016 | Cannot be terminated without legislative approval |
| Kentucky | IL, IN, MI, WV, WI | 42A809 | VA only if commuting daily; OH excludes 20%+ S corp shareholder-employees; void if 183-day abode |
| Maryland | PA, VA, WV, DC | MW507 | Lapses on 183-day abode, **except WV, which has no time limit** |
| Michigan | IL, IN, KY, MN, OH, WI | none issued | Treasury furnishes no certificate; employer letter |
| Minnesota | MI, ND | MWR | Must return to permanent residence at least monthly |
| Montana | ND | MW-4 (not MT-R) | none |
| New Jersey | PA | NJ-165 | PA municipal wage tax still owed |
| North Dakota | MN, MT | NDW-R | none |
| Ohio | IN, KY, MI, PA, WV | IT 4NR | none |
| Pennsylvania | IN, MD, NJ, OH, VA, WV | REV-419 | none |
| Virginia | DC, KY, MD, PA, WV | VA-4 | MD/PA/WV: 183 days or less, no abode, wage income only |
| West Virginia | KY, MD, OH, PA, VA | WV/IT-104NR | none |
| Wisconsin | IL, IN, KY, MI | W-220 | Compensation only, never self-employment |
| DC | **everyone** | D-4A | Not reciprocity, see below |

**DC is not reciprocity.** The federal Home Rule Act forbids the District from taxing any
nonresident's personal income at all. Every state's residents are exempt automatically. Form
D-4A only stops the withholding. Only DC *residents* working in MD or VA use a real agreement.

**Commonly believed and false, all confirmed:**

| Belief | Reality |
|---|---|
| Illinois-Indiana have reciprocity | No. Illinois Pub-130 calls Indiana "a non-reciprocal state" |
| Minnesota-Wisconsin have reciprocity | Ended January 1, 2010, never returned |
| Arizona has reciprocity | No. Form WEC rests on a reverse-credit statute, A.R.S. 43-1096 |
| Maryland-Delaware have reciprocity | Maryland's own guide names a "Delaware/Nonreciprocal state rate" |
| New York has reciprocity with NJ or CT | None with any state, ever |
| A Michigan reciprocal-state resident "files an MI-W4" | Michigan Treasury issues no nonresidency certificate |
| Indiana's list is six states (per 45 IAC 3.1-1-115) | That rule is from 1979 and lists Illinois. It is stale. Five states |

### 3.2 Convenience of the employer: your remote days count as work-state days

| State | Status for 2026 | What it does |
|---|---|---|
| **New York** | Live, and the one that matters | 20 NYCRR 132.18(a). Home days count as NY days unless *necessity*, not convenience. Escape only via the bona fide employer office test: primary factor, OR 4 of 6 secondary AND 3 of 10 other factors. No de minimis day threshold. Also drives the Yonkers nonresident earnings tax |
| **Nebraska** | Live but heavily narrowed | LB 1023 (2024): from tax years beginning 2025-01-01 it bites only if the nonresident works physically in Nebraska **more than seven days** in the year, and then only in-Nebraska compensation is sourced there. Nearly every third-party list still describes the old version |
| **Pennsylvania** | Live but weak | 61 Pa. Code 109.8. Reciprocity with IN, MD, NJ, OH, VA, WV removes most cross-border cases, and PA telework guidance says a nonresident *required* to telework full time has non-PA source income |
| **Delaware** | Probably live, weakly sourced | Exists only in the Schedule W (PIT-SCW) apportionment worksheet. No statute or regulation located. Newest document is tax year 2025 |
| **Connecticut** | Retaliatory only | Conn. Gen. Stat. 12-711(b)(2)(C) applies it only if the nonresident's domicile state uses a similar test |
| **New Jersey** | Retaliatory only | P.L.2023 c.125. NJ states outright it has no rule of its own; triggers on DE, NE, NY residents. Excludes CT residents (CT's own rule is reciprocal) and PA residents (reciprocity) |
| ~~Arkansas~~ | **REFUTED** | Act 1019 of 2021 replaced it with a physical-presence test, April 29, 2021 |
| ~~Massachusetts~~ | **REFUTED** | 830 CMR 62.5A.3 was a COVID emergency reg that self-terminated September 13, 2021 |
| Alabama | **UNRESOLVED, do not list** | Rests on one Tax Tribunal decision (Bollinger, INC. 22-390-LP), not a statute. Act 2025-334 effective 2026-01-01 adds a 30-day safe harbor that may or may not disturb it |

The retaliatory rules are irrelevant to a resident-side paycheck calculator. CT's and NJ's
rules reach *nonresidents working for CT or NJ employers*, never their own residents.

**Design consequence, and it is a helpful one:** for a New York (or DE, or PA) work state, the
"all wages sourced to the work state" assumption is *correct by law* regardless of how many
days the person works from home. The convenience rule removes the need to ask about days for
exactly the state where the stakes are highest.

### 3.3 Credit for taxes paid to another state

| Element | Rule |
|---|---|
| Who grants it | The **resident** state, because it taxes worldwide income and yields |
| Constitutional floor | *Comptroller v. Wynne* (2015): a state taxing residents on out-of-state income must give a full credit, including its **local** tax. This is why Maryland credits county tax |
| The cap | Every state uses the same shape: lesser of (tax actually paid to the other state) or (own tax × the share of income that other state taxed). NY IT-112-R line 24 vs 27, NJ Schedule NJ-COJ line 8 vs box 9a, PA Schedule G-L line 4e vs 5 |
| **Net arithmetic** | For a wage-only filer with 100% of wages sourced to the work state, total state tax = **max(resident tax, work-state tax)**. Neither state's tax is avoided, but nothing is paid twice |
| Exception: reverse credit | The **source** state grants the credit instead. VA ↔ AZ/CA/OR; CA ↔ AZ/GU/OR/VA; IN ↔ AZ/OR/DC; OR ↔ AZ/CA/IN/VA. **The `max()` arithmetic is unchanged**, it just moves which return the credit appears on |
| Exception: reciprocity | No credit granted or needed, the work state simply does not tax. Total = resident tax |
| Exception: dual residency | NY denies the credit where the taxpayer is resident of both states and the other state credits the full NY resident tax |
| Convenience-rule interaction | NJ's GIT-3W: use "the income actually taxed by New York" in the credit calculation, which for a convenience-rule filer includes the days worked at home in NJ. The credit is real but capped, so the taxpayer pays at NY's higher rate and NJ loses the revenue |
| The bounty that expired | NJ's refundable 50% credit for winning a challenge in another state's tax court covers **tax years 2020-2023 only**. Not available for 2026 |

### 3.4 Local taxes: the layer reciprocity never reaches

| Jurisdiction family | Cross-border behaviour |
|---|---|
| **Indiana county LIT** | Survives reciprocity outright. A KY/MI/OH/PA/WI resident with Indiana wages still owes county tax and files IT-40RNR. Liability is fixed by **January 1** status, so a KY resident who starts an Indianapolis job in March 2026 owes no Marion County tax for 2026. Separate 30-day nonresident safe harbor at IC 6-3-2-27.5 can zero both state and county tax |
| **PA municipal wage tax** | Survives NJ/PA reciprocity. NJ-WT: the agreement "does not excuse a Pennsylvania employer from withholding local wage taxes imposed by cities" |
| **NYC resident tax** | Residents only. A NJ resident working in Manhattan owes **nothing** to NYC. An NYC resident working in NJ owes it in full |
| **Yonkers** | Nonresident earnings tax, and TSB-M-06(5)I applies the convenience rule to it |
| **Maryland county tax** | Owed by Maryland residents wherever they work, and *Wynne* forces Maryland to credit other states' local tax against it |
| **Ohio municipal + school district** | Roughly 600 municipalities and a separate school-district income tax, each with its own resident and nonresident treatment |

None of these are in the repo today, for any state, cross-border or not.

---

## 4. What is implementable, honestly

### 4.1 Tier 1: with data the repo already has

`tax-data-2026.json` already carries the full 2026 bracket table, standard deduction and
paid-leave programs for all 51 jurisdictions. That is enough to compute, with **zero new
data**:

- `stateIncomeTax(gross, status, workState)`, the nonresident tax of any work state
- `max(residentTax, workTax)`, the correct combined figure for every non-reciprocity pair
- swapping `employeePrograms` from the resident state to the work state

**But tier 1 alone is not shippable.** Applying `max()` blindly breaks all 58 reciprocity
pairs, overstating by up to $3,858 (live ND, work MN, $85,000) and by $1,000 to $1,700 on
eight other common Midwest and Mid-Atlantic pairs. You cannot ship the arithmetic without the
table. The one genuinely standalone slice is the nine no-income-tax resident states, where
`residentTax` is zero, so the answer is exactly `stateTax(workState)` with no credit, no cap,
no reciprocity (none of the nine is in any agreement) and no heuristic. That slice is exact.

### 4.2 Tier 2: new per-state data, and exactly how much

| Data | Count | Status |
|---|---|---|
| Reciprocity table, work state → exempted resident states | 16 rows / 58 ordered pairs | **Already researched.** Section 3.1 |
| DC blanket nonresident exemption | 1 rule | Already researched |
| Condition flags (KY daily commute for VA, KY 20% S corp, KY 183-day, MD 183-day + WV carve-out, MN monthly return, VA 183/no-abode/wage-only, WI self-employment exclusion, IN county tax survives) | 8 flags | Already researched. **Used for prose warnings only, never for math** |
| Convenience-rule work states (NY, NE, PA, DE) | 4 flags | Already researched |
| Reverse-credit pairs | ~14 ordered pairs | Already researched. **Wording only**, `max()` already handles the arithmetic |
| **GATE: does each taxing state grant a nonresident the same standard deduction / exemption when 100% of income is source income?** | **41 states** | **NOT RESEARCHED.** See below |

Total roughly **120 data points**, of which about 100 already exist in the research and 41 are
a verification pass that has not been done.

**The gate.** `max(R, W)` is exact only if the work state's nonresident tax on 100%-sourced
wages equals its resident tax on the same wages. That holds under both common methods (the
"tax as if resident × source ratio" method, and the direct method with deductions prorated by
the same ratio), because at a ratio of 1.0 they converge. It fails for any state that flatly
denies nonresidents the standard deduction or personal exemption. I have no primary source
either way for any of the 41 taxing states. **Do not ship a number for a work state until that
state has been checked.** Ship the nine no-tax resident states first if you want value before
the gate clears; that slice does not depend on it either, but it depends on the same
nonresident-deduction question for the *work* state, so check the ~12 states that actually
border a no-tax state first (OR, CA, ID, MT, UT, AZ, GA, NC, VA, KY, MO, AR, LA, MS, AL, MN,
NE, CO, MA, VT, ME) as a first wave.

### 4.3 Tier 3: cannot be done accurately, answer with words not numbers

| Case | Why the tool must not produce a number |
|---|---|
| **Local income taxes** | Thousands of jurisdictions (PA EIT ~2,500 rates, Ohio ~600 municipalities plus school districts, Indiana 92 counties, Maryland 24, Michigan 24 cities, Kentucky ~200 occupational taxes), each with distinct resident and nonresident rates, and residency rules keyed to addresses the tool never asks for. **No local rate in this document was verified against a primary source; that research was not done.** A client-side calculator cannot get this right |
| **Day-count apportionment** | Requires the user to know their in-state day count for the year, in advance, and requires per-state rules on what counts as a day. It also silently *inverts* for convenience-rule states, where home days do not reduce anything |
| **The bona fide employer office test** | 1 primary factor, 6 secondary, 10 other, needing at least 4 secondary and 3 other. It is a judgment call about specialized facilities and employer intent, not arithmetic |
| **Nebraska 7-day / Indiana 30-day / Alabama 30-day thresholds** | Each needs a day count the tool cannot know, and Alabama's own convenience-rule status is unresolved |
| **183-day abode tests (MD, KY, VA)** | Turn on where the person sleeps, not where they work |
| **Kentucky's 20%+ S corp shareholder-employee carve-out** | Requires ownership data a paycheck tool has no business asking for |
| **Part-year residency and mid-year moves** | Whole different return type, and Indiana's county rule keys off January 1 status |
| **Married filing jointly with two work states** | The engine takes one wage. Two-earner cross-border households break the credit-ratio assumption entirely |
| **Self-employment** | Wisconsin states it explicitly: reciprocity "does not apply to income from self-employment." Most agreements are compensation-only |
| **Credit cap with non-wage income** | The cap is resident tax × (source income / total income). With a spouse's income or investment income the ratio drops below 1 and `max()` drifts high |

**The line:** the tool may compute a number when the user has one W-2 wage, one work state, and
100% of that wage sourced there. Everything else gets a sentence, not a figure.

---

## 5. The recommended build

Ship one question on all 51 state pages, as the **first** `adv-q` inside the existing
`#advancedFields` block. Default No reproduces today's result exactly, so there is no
regression risk on the 51 pages and no change to any pinned test.

### 5.1 The question, exact shipping markup

```html
<fieldset class="adv-q" aria-describedby="qWorkStateNote">
  <legend>Do you work in a different state from the one you live in?</legend>
  <p class="adv-q-note" id="qWorkStateNote">Answer Yes if your job is across a state line, even if you do some of the work from home. This page assumes you live in {{STATE_NAME}}.</p>
  <div class="yn">
    <label class="seg"><input type="radio" name="qWorkState" value="no" checked><span>No</span></label>
    <label class="seg"><input type="radio" name="qWorkState" value="yes"><span>Yes</span></label>
  </div>
  <div class="adv-reveal" data-reveal="qWorkState">
    <div class="field">
      <label for="workState">Which state do you work in?</label>
      <select id="workState"><option value="">Choose a state…</option></select>
    </div>
    <p class="adv-q-note" id="workStateResult"></p>
  </div>
</fieldset>
```

One yes/no, one select. Nothing else is asked. No day count, no city, no ownership question.

### 5.2 What the engine does

`computePaycheck()` gains an optional `workStateSlug`. When absent, behaviour is byte-identical
to today.

```
combinedStateTax(residentSlug, workSlug, gross, status):
  if !workSlug or workSlug === residentSlug:        return stateTax(residentSlug)
  if workSlug === 'district-of-columbia':           return stateTax(residentSlug)   // federal bar
  if RECIPROCITY[workSlug].includes(residentAbbr):  return stateTax(residentSlug)   // work state does not tax
  return max(stateTax(residentSlug), stateTax(workSlug))   // credit, or reverse credit; same result
```

Paid-leave programs switch to `workSlug` unconditionally, because employee contributions follow
the employer's state.

Ten lines of logic, one 16-row constant, one DC special case. That is the whole build.

### 5.3 What the page says back, four cases, exact wording

**Reciprocity pair** (e.g. Pennsylvania resident, New Jersey job):

> New Jersey and Pennsylvania have a reciprocity agreement, so New Jersey does not tax your
> wages at all. You pay Pennsylvania only, which is what the figures above already show. Give
> your employer Form NJ-165 so New Jersey tax stops coming out of your pay. This does not cover
> local taxes, and it does not cover self-employment income.

**Work state is DC:**

> Washington DC is barred by federal law from taxing anyone who does not live there, so your DC
> job costs you no DC income tax. You pay {{STATE_NAME}} only. File Form D-4A with your employer
> to stop DC withholding.

**Two taxing states, no agreement** (e.g. New Jersey resident, New York job):

> New York taxes the wages you earn there, and New Jersey taxes them too but gives you a credit
> for the New York tax. In practice you end up paying the higher of the two, not both. We have
> used $6,040 above, which is the New York figure. **New York counts days you work from home in
> New Jersey as New York days** under its convenience-of-the-employer rule, so working remotely
> does not lower this. Your New Jersey return will show the credit; the total does not change.

**Two taxing states, work state has no convenience rule, resident state tax is lower**
(e.g. New Hampshire resident, Massachusetts job):

> Massachusetts taxes the wages you earn in Massachusetts, and New Hampshire has no wage income
> tax, so this is all you pay. The figure above assumes you are physically at work in
> Massachusetts every working day. Massachusetts does not have a convenience-of-the-employer
> rule, so any full day you work from home in New Hampshire is not Massachusetts income. If you
> are hybrid, your real Massachusetts tax is somewhere between $0 and $4,530 depending on your
> day count, and only your own records can settle it.

That last pattern is the honest general answer for every non-convenience work state: show the
all-on-site figure as the headline, name the all-remote bookend, and refuse to interpolate.

### 5.4 The standing caveat, shown whenever Yes is selected

> This covers state income tax only. City and county taxes follow their own rules and are
> usually still owed even when a reciprocity agreement applies, and this calculator does not
> compute any of them. Notable ones: Indiana county tax, Pennsylvania local wage tax including
> Philadelphia, Ohio municipal and school district tax, Maryland county tax, and New York City
> tax (which only city residents pay, so a commuter into Manhattan owes none of it).

### 5.5 Phasing

| Phase | Scope | Blocked on |
|---|---|---|
| 1 | The nine no-income-tax resident states (AK, FL, NV, NH, SD, TN, TX, WA, WY). Exact math, no reciprocity, no credit cap | Nonresident-deduction check on ~21 bordering work states |
| 2 | The 16 reciprocity jurisdictions + DC. Mostly a table lookup, and it protects the 58 pairs the site currently gets right | Nothing, data is in section 3.1 |
| 3 | Everything else, via `max()` | The full 41-state gate in 4.2 |

---

## 6. What not to build

| Do not build | Why |
|---|---|
| **A "days worked from home" input** | The highest-traffic case (NY) ignores it entirely by law, so the field would suggest a saving that does not exist. For non-convenience states it demands a number the user does not have. It converts a defensible range into an indefensible point estimate |
| **Local tax computation** | Thousands of jurisdictions, address-keyed, resident vs nonresident splits, and none of it verified here. This is the single most likely source of a confidently wrong number |
| **A "which state should I claim residency in" answer** | Domicile is a facts-and-circumstances legal test. Getting it wrong is an audit, not a rounding error |
| **A `max()` shortcut without the reciprocity table** | Breaks 58 pairs that work today, by up to $3,858 |
| **Anything sourced from Indiana 45 IAC 3.1-1-115** | 1979 regulation, lists six states including Illinois. Bulletin #28 puts Illinois in the no-agreement list. Five states |
| **Any list naming Arkansas or Massachusetts as convenience-rule states** | Both refuted. Arkansas replaced its rule in 2021, Massachusetts' expired September 13, 2021 |
| **Alabama as a convenience-rule state** | Rests on one tribunal decision, not a statute, and Act 2025-334 may have overridden it. Unresolved |
| **The old Nebraska convenience rule** | LB 1023 narrowed it to a more-than-seven-days trigger from 2025. Nearly every secondary list is stale |
| **Montana Form MT-R** | Montana DOR now specifies Form MW-4 |
| **"File an MI-W4 for Michigan reciprocity"** | Michigan Treasury issues no nonresidency certificate. Employer letter or employer-developed form |
| **Illinois-Indiana or Minnesota-Wisconsin reciprocity** | Neither exists. MN-WI ended 2010-01-01 |
| **A claim that reciprocity means "no tax in the work state"** | It means no *income* tax. Indiana county tax and PA municipal wage tax both survive |
| **Citing Zelinsky II as settled law** | 2026 NY Slip Op 04251, decided 2026-07-02, 26 days old, "uncorrected and subject to revision", Court of Appeals review still possible |
| **Anything relying on NJ's 50% challenge credit** | Tax years 2020-2023 only. Not available for 2026 |

---

## 7. Sources

Confirmation column: **2026** = the document itself carries a 2026 stamp or is a statute
verified in force for 2026. **Not contradicted** = current published guidance with no 2026
stamp, and no evidence of change found. Never present a "not contradicted" row as settled.

### 7.1 Reciprocity

| Claim | Primary URL | Quote | Year stated | 2026? |
|---|---|---|---|---|
| IL exempts IA, KY, MI, WI | tax.illinois.gov/…/pub-130.pdf | "compensation paid to residents of Iowa, Kentucky, Michigan, and Wisconsin (due to reciprocal agreements" | Pub-130, Feb 2026 | **2026** |
| IL exemption form is IL-W-5-NR | same | "you must complete Form IL-W-5-NR" | Feb 2026 | **2026** |
| Illinois-Indiana have NO agreement | same | "Tom is an Illinois resident who works only in Indiana (a non-reciprocal state)" | Feb 2026 | **2026** |
| WI has exactly four: IL, IN, KY, MI | revenue.wi.gov/DOR Publications/pb121.pdf | "Wisconsin has reciprocity agreements with four states: Illinois, Indiana, Kentucky, and Michigan." | Pub 121 rev. 01/26 | **2026** (re-verified verbatim 2026-07-28) |
| WI form is W-220 | same | "Form W-220, Nonresident Employee's Withholding Reciprocity Declaration" | rev. 01/26 | **2026** |
| Reciprocity never covers self-employment | same | "It does not apply to income from self-employment." | rev. 01/26 | **2026** |
| Indiana county tax survives reciprocity (WI side) | same | "may still be subject to an Indiana county income tax on that income" | rev. 01/26 | **2026** |
| MI exempts IL, IN, KY, MN, OH, WI | michigan.gov/…/446_Withholding-Guide_2026.pdf | "reciprocal agreements with the states of Illinois, Indiana, Kentucky, Minnesota, Ohio, and Wisconsin" | Form 446 rev. 02-26 | **2026** |
| MI issues no nonresidency certificate | same | "Treasury does not furnish nonresidency certificates." | rev. 02-26 | **2026** |
| MN reciprocity is MI and ND only | revenue.state.mn.us/…/mwr.pdf | "For Michigan and North Dakota residents who work in Minnesota." | Form MWR for TY2026 | **2026** |
| MN requires monthly return home | same | "Do you return to your permanent residence at least once a month?" | TY2026 | **2026** |
| NJ/PA agreement still operative | nj.gov/treasury/taxation/njit14.shtml | "compensation paid to New Jersey residents employed in Pennsylvania is not subject to Pennsylvania income tax" | updated 03/19/26 | **2026** |
| IN has exactly five: KY, MI, OH, PA, WI | in.gov/dor/files/ib28.pdf (canonical: dor.in.gov/files/reference/ib28.pdf) | "They are Kentucky, Michigan, Ohio, Pennsylvania, and Wisconsin." | IB #28, Dec 2024 | **2026 by adversarial verify**: no superseding bulletin, absent from 2026 Legislative Synopsis, corroborated by WI Pub 121 (01/26) and OH guidelines (rev. 11/25) |
| IN reciprocity does not cover county tax | in.gov/dor/files/ib32.pdf | "Reciprocal agreements between the state of Indiana and other states do not apply to the taxpayer's liability for county tax." | IB #32, Dec 2024 | **2026 by adversarial verify**, plus Departmental Notice #1 "Effective Jan. 1, 2026" |
| IN county liability is fixed on January 1 | in.gov/dor/files/ib32.pdf | "county of principal business or employment is also determined as of January 1 each year" | IB #32 | Not contradicted |
| IN 30-day nonresident safe harbor | same, IC 6-3-2-27.5 | "nonresident of Indiana and works 30 days or fewer during a calendar year" | 2024 forward | Not contradicted |
| IN AZ/OR/DC are reverse credit, not reciprocity | in.gov/dor/files/ib28.pdf + in.gov/dor/i-am-a/individual/tax-credits/ | "Included are Arizona, Oregon, and Washington, D.C." | Dec 2024 + live page | **2026 by adversarial verify**, corroborated by Oregon Pub OR-17 rev. 01-29-26 |
| IN form is WH-47 | forms.in.gov/download.aspx?id=2419 | "Certificate of Residence (Form WH-47)" | Undated; **URL returns 403 to automated fetch** | Confirmed via a second primary source in adversarial pass |
| IA's only agreement is with IL | revenue.iowa.gov/…/iowa-illinois-reciprocal-agreement | "At this time, Iowa's only income tax reciprocal agreement is with Illinois." | Undated current | Not contradicted |
| IA agreement needs legislation to end | legis.iowa.gov/docs/iac/rule/701.300.13.pdf | "cannot be terminated by the Iowa department of revenue unless the termination is authorized" | IAC 701-300.13 | Not contradicted |
| KY exempts IL, IN, MI, WV, WI | revenue.ky.gov/Forms/42A809.pdf | "I work in Kentucky and reside in: Illinois, Indiana, Michigan, West Virginia, Wisconsin" | Form rev. 3-07 | Not contradicted |
| KY-VA needs daily commuting | 103 KAR 17:140 | "Virginia residents commuting daily to work in Kentucky shall be exempt from income tax" | eff. 12-7-2018 | Not contradicted |
| KY-OH excludes 20%+ S corp shareholder-employees | same | "if the shareholder-employee is a \"twenty (20) percent or greater\" direct or indirect equity investor" | eff. 2007 forward | Not contradicted |
| KY reciprocity void at 183-day abode | same | "spends more than 183 days in Kentucky during the year, reciprocity shall not apply" | eff. 12-7-2018 | Not contradicted |
| MD has PA, VA, WV, DC | marylandtaxes.gov/…/ar_it3.pdf | "written reciprocal agreements with Pennsylvania, Virginia, West Virginia and the District of Columbia" | **Document states form refs are to TY2011** | Not contradicted |
| MD agreements lapse at 183-day abode, except WV | same | "Except for West Virginia, the reciprocal agreements do not apply to individuals who" | TY2011 refs | Not contradicted |
| MD form is MW507 | marylandtaxes.gov/forms/24-forms/Withholding-Guide.pdf | "Maryland Withholding Exemption Certificate, be filed with the employer" | **2024 edition; no 2025/2026 edition retrievable** | Not contradicted |
| MD treats DE as nonreciprocal | same | "use the Delaware/Nonreciprocal state rate, which includes local tax" | 2024 edition | Not contradicted |
| MT-ND, form MW-4 not MT-R | revenue.mt.gov/taxes/withholding-tax/north-dakota-reciprocity | "Montana Employee Withholding Allowance and Exemption Certificate (Form MW-4)" | Undated | Not contradicted |
| ND has MN and MT, form NDW-R | tax.nd.gov/…/ndwrfillable.pdf | "Reciprocity Exemption From Withholding For Qualifying Minnesota and Montana Residents Working in North Dakota" | SFN 28729 (12-2023) | Not contradicted |
| NJ/PA does not excuse PA local wage tax | nj.gov/treasury/taxation/pdf/current/njwt.pdf | "does not excuse a Pennsylvania employer from withholding local wage taxes imposed by cities" | NJ-WT, Sept 2025 | Not contradicted |
| PA residents in NJ file NJ-165 | nj.gov/treasury/taxation/pdf/current/nj165.pdf | "Employee's Certificate of Nonresidence In New Jersey" | rev. 9-19 | Not contradicted |
| OH has IN, KY, MI, PA, WV | tax.ohio.gov/static/forms/employer_withholding/generic/wth_it4nr.pdf | "each employee who is a resident of Indiana, Kentucky, West Virginia, Michigan or Pennsylvania" | Form IT 4NR **rev. 5/07** | Not contradicted; corroborated by 2026 OH withholding guidelines (rev. 11/25) |
| PA has IN, MD, NJ, OH, VA, WV | pa.gov/…/rev-419.pdf | "as a resident of the reciprocal state of Indiana, Maryland, New Jersey, Ohio, Virginia" | rev. 03-24 | Not contradicted |
| VA has DC, KY, MD, PA, WV | tax.virginia.gov/reciprocity | "reciprocity with Virginia are: District of Columbia, Kentucky, Maryland, Pennsylvania, West Virginia" | Undated current | Not contradicted |
| VA MD/PA/WV need 183 days or less | same | "present in the other state for 183 days or less during the year" | Undated current | Not contradicted |
| WV has KY, MD, OH, PA, VA | tax.wv.gov/Documents/TSD/tsd381.pdf | "bona-fide resident of Kentucky, Maryland, Ohio, Pennsylvania, or Virginia" | TSD-381 rev. Sept 2025 | Not contradicted |
| WV form is WV/IT-104NR | tax.wv.gov/Documents/Withholding/it104.pdf | "WEST VIRGINIA CERTIFICATE OF NONRESIDENCE" | rev. 03/2023 | Not contradicted |
| DC cannot tax nonresidents (federal bar) | code.dccouncil.gov/us/dc/council/code/sections/1-206.02 | "Impose any tax on the whole or any portion of the personal income" | Home Rule Act 1-206.02(a)(5) | Not contradicted (standing federal statute) |
| DC nonresidents file D-4A | otr.cfo.dc.gov/…/2018 D-4A.pdf | "If you are not a resident of DC you must file a Form D-4A" | rev. 12/2016 | Not contradicted |
| MN-WI reciprocity dead since 2010-01-01 | revenue.wi.gov/Pages/FAQS/ise-mnrecipro.aspx | "Wisconsin and Minnesota have not had a tax reciprocity agreement since January 1, 2010." | Current FAQ | Not contradicted |
| AZ has NO reciprocity, reverse credit only | azleg.gov/ars/43/01096.htm | "Nonresidents shall be allowed a credit against taxes imposed by this title" | A.R.S. 43-1096, current | Not contradicted. **azdor.gov returned 403 to every fetch; Form WEC never read directly** |
| NY has no reciprocity with any state | tax.ny.gov/pit/file/nonresident-faqs.htm | "As a nonresident, you only pay tax on New York source income" | Page dated 2025-10-24 | Not contradicted |
| CT has none, withholds on nonresident wages | portal.ct.gov/drs/withholding-taxes/nonresidents-who-work-in-connecticut | "Wages of a nonresident employee are subject to Connecticut income tax withholding" | Undated current | Not contradicted |
| CA has none, reverse credit AZ/GU/OR/VA | ftb.ca.gov/forms/2025/2025-540-s-instructions.html | "Arizona (AZ), Guam (GU), Oregon (OR), and Virginia (VA)" | TY2025 | Not contradicted |

### 7.2 Convenience of the employer

| Claim | Primary URL | Quote | Year stated | 2026? |
|---|---|---|---|---|
| NY rule: necessity, not convenience | tax.ny.gov/pdf/memos/income/m06_5i.pdf | "which of necessity, as distinguished from convenience, obligate the employee to out-of-state duties" | TSB-M-06(5)I; reg unrepealed | **2026** (reg in force) |
| Bona fide office test: primary, or 4 of 6 + 3 of 10 | same | "at least 4 of the secondary factors and 3 of the other factors" | TY2006 forward | **2026** |
| Primary factor is specialized facilities | same | "The home office contains or is near specialized facilities." | TY2006 forward | **2026** |
| Convenience rule drives Yonkers nonresident tax | same | "apply to Yonkers nonresidents and part-year residents in determining whether the convenience of the" | TY2006 forward | **2026** |
| NY states it as live guidance | tax.ny.gov/pit/file/nonresident-faqs.htm | "your days telecommuting are considered days worked in the state unless your employer has established a bona fide employer office at your telecommuting location" | Updated 2025-10-24 | **2026** (re-verified verbatim 2026-07-28) |
| Restated in IT-203 instructions | tax.ny.gov/pdf/current_forms/it/it203i.pdf | "normal work days spent at home are considered days worked in New York State" | **TY2025; no TY2026 form exists yet** | Not contradicted |
| Zelinsky II upheld the rule 2026-07-02 | nycourts.gov/reporter/current/3dseries/2026/2026_04251.shtml | "ADJUDGED that the determination is confirmed, without costs, and petition dismissed." | Decided 2026-07-02 | **2026, but see next row.** URL returned 403 on my re-verification attempt; this rests on the research pass, not on my own read |
| Zelinsky II is not final | same | "This decision is uncorrected and subject to revision before publication in the Official Reports." | 2026-07-02 | **Do not cite as settled** |
| 132.18 applies only when working both in and out of NY | same, footnote 2 | "Zelinsky was not entitled to be taxed pursuant to 20 NYCRR 132.4." | 2026-07-02 | Boundary condition, treat as unsettled |
| CT rule is purely retaliatory | cga.ct.gov/current/pub/chap_229.htm | "for such person's convenience if such person's state of domicile uses a similar test" | Gen. Stat. rev. to 2026-01-01 | **2026** |
| CT 12-711 unamended for 2026 | cga.ct.gov/2026/sup/chap_229.htm | Section absent from the 2026 Supplement's changed-section list | 2026 Supplement | **2026** |
| CT gives a resident credit | cga.ct.gov/current/pub/chap_229.htm | "Any resident or part-year resident of this state shall be allowed a credit" | rev. to 2026-01-01 | **2026** |
| NJ has no rule of its own | nj.gov/treasury/taxation/conveniencerulefaq.shtml | "New Jersey does not have its own Convenience of the Employer Rule." | Updated 2025-10-30 | **2026** (re-verified verbatim 2026-07-28) |
| NJ triggers on DE, NE, NY | same | "states that also impose a similar test, such as Delaware, Nebraska, and New York" | Updated 2025-10-30 | **2026** (re-verified) |
| NJ excludes CT and PA residents | same | "Based on the reciprocal nature of Connecticut's law" | Updated 2025-10-30 | **2026** (re-verified) |
| NJ concedes a zero-services floor | same | "if an employee performs no services in New Jersey, even if employed by a" | Updated 2025-10-30 | **2026** |
| **NE: more than seven days trigger** | revenue.nebraska.gov/…/2026cir_en_whole.pdf | "performs services in Nebraska for more than seven days during the taxable year" | 2026 Circular EN, rev. 11-2025 | **2026** |
| NE sources only in-state compensation | same | "only the compensation paid for services performed within Nebraska constitutes Nebraska sourced income" | TY2025 forward | **2026** |
| PA rule exists in regulation | pacodeandbulletin.gov/…/s109.8.html | "which, of necessity, obligate the employe or casual employe to perform out-of-State duties" | 61 Pa. Code 109.8, amended 1999 | **2026** (in force) |
| PA names the doctrine | pa.gov/…/pitguide_grosscompensation.pdf | "Pennsylvania, like many other states, follows the \"convenience-of-the-employer\" doctrine." | PA PIT Guide rev. 08-2025 | Not contradicted |
| PA telework carve-out | pa.gov/agencies/revenue/…/telework-guidance | "should treat his compensation as non-Pennsylvania source income even if his employer is located" | **Undated, no tax year stated** | Not contradicted |
| DE rule exists only on Schedule W | revenuefiles.delaware.gov/2025/…/PIT-SCW_2025-01…pdf | "as opposed to solely for the convenience of the employee" | **TY2025; no statute or reg located** | Not contradicted |
| **REFUTED: Arkansas** | arkleg.state.ar.us/…/ACT1019.pdf | "performs work in Arkansas when that individual is physically located in Arkansas" | Effective 2021-04-29 | **2026** |
| **REFUTED: Massachusetts** | law.cornell.edu/regulations/massachusetts/830-CMR-62-5A-3 | "90 days after the date on which the Governor of the Commonwealth gives notice" | Expired 2021-09-13 | **2026.** Read via Cornell LII; **mass.gov returns 403** |
| **UNRESOLVED: Alabama** | cga.ct.gov/2025/rpt/pdf/2025-R-0067.pdf | "At least seven states (Alabama, Connecticut, Delaware, Nebraska, New Jersey, New York, and Pennsylvania)" | As of 2025-05-02 | **Do not publish.** Source is a legislative research report, not law; underlying tribunal opinion unreachable |

### 7.3 Credit for taxes paid to another state

| Claim | Primary URL | Quote | Year stated | 2026? |
|---|---|---|---|---|
| Resident state grants the credit | tax.virginia.gov/credit-for-taxes-paid-to-another-state | "all of your income is subject to Virginia individual income tax" | Undated current | Not contradicted |
| Credit reaches political subdivisions | nysenate.gov/legislation/laws/TAX/620 | "by another state of the United States, a political subdivision of such state" | Statute, last amended 2021 | **2026** |
| Wynne: full credit constitutionally required | law.cornell.edu/supremecourt/text/13-485 | "does not offer its residents a full credit against the income taxes" | Decided 2015 | **2026** (standing rule) |
| VA residents cannot credit AZ/CA/OR | tax.virginia.gov/credit-for-taxes-paid-to-another-state | "you can't claim a credit for taxes paid to those states" | Undated current | Not contradicted |
| VA grants it to AZ/CA/DC/OR nonresidents | same | "except for income taxes you paid as a resident of: Arizona, California" | Undated current | Not contradicted |
| CA denies its residents the credit where reverse-credited | ftb.ca.gov/forms/2025/2025-540-s-instructions.html | "No credit is allowed if the other state allows California residents a credit" | TY2025 | Not contradicted |
| Reciprocity means no credit is needed | pa.gov/…/pa-personal-income-tax-guide/deductions-and-credits | "These states do not impose tax on compensation of Pennsylvania residents." | Undated current | Not contradicted |
| NY dual-residency denial | tax.ny.gov/pdf/current_forms/it/it112ri.pdf | "the other state allows a credit against its tax for the total resident tax" | TY2025 | Not contradicted |
| NY cap: lesser of line 24 or 27 | tax.ny.gov/pdf/current_forms/it/it112r_fill_in.pdf | "Enter amount from line 24 or line 27, whichever is less" | TY2025 | Not contradicted |
| NJ cap: lesser of line 8 or box 9a | nj.gov/treasury/taxation/pdf/current/schedulenjcoj.pdf | "Credit Allowed. Enter the lesser of line 8 or box 9a." | TY2025 | Not contradicted |
| PA cap: lesser of 4e or 5 | pa.gov/…/pa-40_pa-41g-l.pdf | "PA Resident Credit. Enter the lesser of Line 4e or Line 5" | rev. 03-24, no TY on face | Not contradicted |
| NJ credit uses income actually taxed by NY | nj.gov/treasury/taxation/pdf/pubs/tgi-ee/git3w.pdf | "you should only use the income actually taxed by New York in the calculation" | TY2025 (GIT-3W, Jan 2026) | Not contradicted |
| NJ credit is capped | nj.gov/treasury/taxation/njit14.shtml | "You may qualify for a credit if you paid income or wage tax" | Updated 2026-03-19 | **2026** |
| NJ 50% challenge credit is TY2020-2023 only | nj.gov/treasury/taxation/individuals/refundablegitcredit.shtml | "Obtain a final judgment in their favor from that tax court or tribunal" | TY2020-2023 only | **Not available for 2026** |
| Oregon reverse-credit partners include IN | oregon.gov/dor/forms/FormsPubs/publication-or-17_101-431_2025.pdf | "The other four states are Arizona, California, Indiana, and Virginia." | Pub OR-17 rev. 01-29-26 | **2026** |
| AZ denies credit where reverse-credited | azleg.gov/ars/43/01071.htm | "The credit is not allowed if the other state or country allows residents of this state a credit" | A.R.S. 43-1071(A)(2) | Not contradicted |

### 7.4 Known gaps in this research

1. **No state has published a tax-year-2026 return form.** For NY, DE, PA and NJ the newest
   tax-year form evidence is TY2025. Statutes and regulations were checked as in force.
2. **2026 currency is not affirmatively confirmed for 11 of the 16 reciprocity jurisdictions.**
   Only IL, WI, MI, MN and NJ carry a 2026 stamp on their own face. IN was upgraded to
   confirmed-2026 by an adversarial pass (no superseding bulletin, absent from the 2026
   Legislative Synopsis, corroborated by two 2026-stamped counterparty documents). The rest is
   "not contradicted for 2026", not "confirmed for 2026".
3. **Blocked sources.** azdor.gov, michigan.gov (MI-W4 PDF), forms.in.gov, mass.gov and
   congress.gov all returned 403 to automated fetch. Maryland's post-2024 withholding materials
   were not retrievable at all. Ohio's reciprocity FAQ 404s and its withholding FAQ serves a
   JavaScript shell.
4. **No local tax rate in this document was verified against a primary source.** Local tax was
   scoped qualitatively only. Do not build from section 3.4 without a dedicated research pass.
5. **Nonresident standard-deduction treatment was not researched for any of the 41 taxing
   states.** This is the gate in section 4.2 and it blocks shipping a number.
6. **2026 legislative sessions were not scanned** in the 16 reciprocity jurisdictions, beyond
   Indiana's synopsis and Connecticut's 2026 Supplement.
7. **Virginia source conflict, reported not resolved.** tax.virginia.gov/reciprocity says only
   DC and KY require daily commuting, MD/PA/WV use a 183-day/no-abode/wage-only test, and names
   Form VA-4. 23VAC10-140-230, derived from a 1985 regulation, says KY, MD, WV *and* DC all
   require commuting each workday and names Form VA-3. Follow the DOR page and flag the
   regulation as stale.
8. **Indiana source conflict, reported not resolved.** IB #28 (Dec 2024) says five states.
   45 IAC 3.1-1-115 (filed 1979) says six, adding Illinois. Follow the bulletin.
9. Federal preemption bills (S.1443 Mobile Workforce Act, 119th Congress) could not be verified
   as unenacted; congress.gov returned 403. Note that the Mobile Workforce Act targets days
   worked *in* a state and would not by itself end convenience rules.
