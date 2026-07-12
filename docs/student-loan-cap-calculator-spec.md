# Federal Student Loan Borrowing Cap / Funding Gap Calculator — Sourced Spec

**Tool slug (proposed):** `/student-loan-borrowing-cap-calculator/`
**Status:** RESEARCH-ONLY spec. No code written. Rigor target = the OBBBA cluster.
**Prepared:** 2026-07-12. **10th** item in the autonomous roadmap chain (fable scout → this spec → build → independent verify → deploy).
**Primary sources:** every load-bearing number verified against the **codified statute 20 U.S.C. §1087e(a)** (HEA §455(a), as amended by **P.L. 119-21 §81001**), the **verbatim regulatory text of ED's RISE final rule, 91 FR 23768 (May 1, 2026; FR Doc 2026-08556)** amending 34 CFR §§685.102, 685.200, 685.201, 685.203 (extracted locally from the govinfo PDF — federalregister.gov and ecfr.gov both bot-block), and two **FSA Electronic Announcements** (NSLDS eligibility processing, Apr 24 2026 updated May 7; professional-degree-programs list due to court order, Jun 29 2026 updated **Jul 10 2026**). CRS report R48727 used as government corroboration. This is student aid policy, so the primary stack is ED/FSA/Federal Register/US Code, not IRS.

---

## 0. Plain-language summary (read this first)

Starting **July 1, 2026**, federal law caps how much graduate students, professional students (medicine, law, etc.), and parents can borrow from the federal government for school — amounts that used to be effectively unlimited (you could borrow up to the full cost of attendance via PLUS loans). The Grad PLUS program is **gone** for new borrowers. The result: many students in expensive programs now face a **funding gap** — the slice of program cost that federal loans can no longer cover.

The caps, all confirmed against the statute and ED's final rule:

- **Graduate students:** $20,500/year, $100,000 program-level aggregate (undergrad loans do NOT count against it).
- **Professional students** (M.D., J.D., D.D.S., …): $50,000/year, $200,000 aggregate. Grad + professional borrowing share one $200,000 pool.
- **Parent PLUS:** NEW caps of $20,000/year and $65,000 total **per dependent student, across all parents combined** (this was the scout's biggest miss — Parent PLUS is not "uncapped", it just sits outside the $257,500).
- **Everyone:** a $257,500 **lifetime** cap on all federal student loans you borrow for your own education (undergrad + grad + professional, Direct + FFEL, including old Grad PLUS) — and this one is a true odometer: **repaying doesn't reset it**.
- **Undergrads:** their own Stafford limits are **unchanged** ($5,500–$7,500/yr dependent, $31,000 aggregate). Only the parent side changed.
- **Grandfather ("interim exception"):** if you were enrolled in your program **as of June 30, 2026** AND any Direct Loan was made for that program before July 1, 2026, the old rules (including Grad PLUS up to cost of attendance) keep applying for the **lesser of 3 academic years or your remaining program length** — and you lose it if you withdraw.

**What the scout framing got right vs. what primary sources corrected (details in §2):**
- ✅ Grad $20,500/$100,000, professional $50,000/$200,000, $257,500 lifetime, Grad PLUS ended, effective July 1, 2026 — all CONFIRMED.
- ⚠️ **CORRECTION 1 — Parent PLUS is NOT simply "excluded from the new caps."** It's excluded from the **$257,500** lifetime cap, but got its **own brand-new caps**: $20,000/year and $65,000 aggregate per dependent student, shared across **all** parents, and non-restorable ("without regard to any amounts repaid"). A Parent PLUS mode is therefore a first-class part of the tool, not a footnote.
- ⚠️ **CORRECTION 2 — the $100k/$200k are NOT "lifetime caps."** They are program-level aggregates that (a) **exclude undergrad borrowing**, (b) **exclude old Grad PLUS balances** (those count only against the $257,500), and (c) are **restorable by repayment** — ED's preamble says a borrower at the aggregate "may not receive additional Unsubsidized loans **until they are repaid, whether in full or in part**." Only the $257,500 and the $65,000 Parent PLUS caps are true "ever-borrowed" odometers. Two different counting regimes = the core engine subtlety.
- ⚠️ **CORRECTION 3 — the "3-year grandfather" is more precise:** lesser of **3 academic years (clock runs from July 1, 2026)** or remaining program length; requires **enrollment as of June 30, 2026 + any Direct Loan made for that program before July 1, 2026** (not specifically a Grad PLUS loan; for the parent exception, a loan to the parent OR to the student qualifies); terminates on withdrawal; and while it lasts it switches off **all** the new limits — annual, aggregate, Parent PLUS, and the $257,500.
- ⚠️ **CORRECTION 4 — a load-bearing fact the scout missed entirely: "professional vs. graduate" is in active litigation.** ED's narrow RISE definition of "professional degree" (34 CFR 685.102: doctoral level, ≥6 academic years, licensure, 11 listed fields) was **preliminarily stayed by a federal court on June 24, 2026** (Judge Beryl Howell, D.D.C.; consolidated AANP v. McMahon / nursing-coalition + 25-state suits). ED's interim guidance (FSA EA, updated **July 10, 2026**) recognizes **29 programs** as professional — including MSN/DNP nursing, PT, OT, PA, audiology, SLP — far broader than the stayed rule. Whether a student gets $50k/$200k or $20.5k/$100k turns on this, and it can change while the case proceeds. The tool must let users self-select, link the current ED list, and date-stamp the litigation caveat.
- ⚠️ **CORRECTION 5 — the competitive gap is narrower than "ZERO calculators."** Ascent Funding (a private student lender) runs a "Grad School Funding Calculator" and a "Grad PLUS Impact Calculator"; gradschoolgap.com is a "coming soon" placeholder; College Aid Pro has a lead-gen funding-gap page. The real gap: **no neutral, no-lead-gen, statute-cited calculator** models the actual cap mechanics (shared $200k pool, odometer vs. restorable aggregates, legacy exception, Parent PLUS per-student cap). That's the differentiator — same pattern as the QCD spec's competitor correction.
- ℹ️ **Naming note:** ED's final rule now refers to P.L. 119-21 as the **"Working Families Tax Cuts Act"** and says the Department "previously referred to [it] as the 'One Big Beautiful Bill Act.'" Same law the site's OBBBA cluster covers; cite P.L. 119-21 and keep "OBBBA" for site consistency with a one-line naming note on the page.

**Confidence:** HIGH on every dollar figure (statute + verbatim final-rule text quoted below). The open uncertainties (§7) are the litigation outcome and two operational NSLDS details — none change v1 arithmetic.

---

## 1. Primary-source facts (verified, quoted)

### 1.1 The statute — 20 U.S.C. §1087e(a), as amended by P.L. 119-21 §81001 (enacted July 4, 2025)

- **Grad PLUS termination — §1087e(a)(3):** "for any period of instruction beginning on or after July 1, 2026, a graduate or professional student shall not be eligible to receive a Federal Direct PLUS Loan under this part."
- **Annual limits — §1087e(a)(4)(A):** graduate students **$20,500**; professional students **$50,000** per academic year (Direct Unsubsidized only — subsidized loans for grad students ended in 2012 and were not revived).
- **Aggregate limits — §1087e(a)(4)(B) (verbatim):** "the maximum aggregate amount of Federal Direct Unsubsidized Stafford loans, **in addition to the amount borrowed for undergraduate education**, that — (i) a graduate student — (I) who is not (and has not been) a professional student … shall be **$100,000**; or (II) who is (or has been) a professional student … shall be an amount equal to — (aa) **$200,000**; minus (bb) the amount such student borrowed for [professional] programs …; and (ii) a professional student — (I) who is not (and has not been) a graduate student … shall be **$200,000**; or (II) who is (or has been) a graduate student … shall be … **$200,000** minus … the amount such student borrowed for [graduate] programs." → **One shared $200,000 grad+professional pool; $100,000 ceiling for never-professional grads; undergrad excluded.** No "without regard to amounts repaid" language here (contrast (a)(5)/(a)(6)).
- **Parent PLUS — §1087e(a)(5) (verbatim):** "for each dependent student, the total maximum annual amount of Federal Direct PLUS loans that may be borrowed on behalf of that dependent student **by all parents** of that dependent student shall be **$20,000**" and the aggregate "shall be **$65,000, without regard to any amounts repaid, forgiven, canceled, or otherwise discharged**."
- **Lifetime cap — §1087e(a)(6) (verbatim):** "the maximum aggregate amount of loans made, insured, or guaranteed under this subchapter that a student may borrow (**other than** a Federal Direct PLUS loan, or loan under section 1078-2 …, **made to the student as a parent borrower on behalf of a dependent student**) shall be **$257,500, without regard to any amounts repaid, forgiven, canceled, or otherwise discharged**."
- **Proration — §1087e(a)(7):** annual amounts for less-than-full-time students "reduced in direct proportion to the degree to which that student is not so enrolled on a full-time basis, rounded to the nearest whole percentage point."
- **Interim exception — §1087e(a)(8) (verbatim):** "Paragraphs (3)(C), (4), (5), and (6) shall not apply … during the expected time to credential …, with respect to an individual who, as of June 30, 2026 — (i) is enrolled in a program of study …; and (ii) **has received a loan (or on whose behalf a loan was made) under this part for such program of study**." Expected time to credential = "the lesser of — (i) **three academic years**; or (ii) … the difference between … the program length … and … the period of such program of study that such individual has completed."
- **Professional student — §1087e(a)(4)(C)(ii):** "a student enrolled in a program of study that awards a professional degree, **as defined under section 668.2 of title 34, Code of Federal Regulations (as in effect on July 4, 2025)**" — the statutory hook the litigation turns on.

### 1.2 The final rule — 91 FR 23768 (May 1, 2026), verbatim regulatory text

- **§685.203(b)(2)(iv)(A):** grad "$20,500 for any academic year"; professional "$50,000 for any academic year" — "for a period of enrollment beginning on or after July 1, 2026." Exception mirror at (b)(2)(iv)(B): annual limits "shall not be applicable … during the period of the student's expected time to credential if — (1) the student is enrolled in a program of study at an institution as of June 30, 2026; and (2) a Direct Loan was made prior to July 1, 2026, for such a program of study." (C): withdrawal/ceasing enrollment kills the exception.
- **§685.203(e)(4)–(5):** grad aggregate **$100,000** / professional **$200,000 minus grad amounts** — each "includes any Direct Subsidized Loan, Subsidized Federal Stafford Loan, and Federal SLS Program loan, if applicable" (i.e., legacy *graduate-level* sub/SLS borrowing counts; Grad PLUS does not). **(e)(3):** exception borrowers keep the pre-OBBBA **$138,500** grad aggregate "including any loans for undergraduate study" ($224,000 for eligible health-profession programs per the NSLDS EA).
- **Preamble (counting method, verbatim):** "all graduate students who have never been professional students … are limited to $100,000 in aggregate for any new loans disbursed, **including all previously borrowed Unsubsidized loans for previous graduate programs** … **Unlike the lifetime maximum aggregate loan limit and the Parent PLUS aggregate loan limit, where these aggregate limits are without regard to amounts repaid** …, the aggregate limits for graduate students or professional students will be $100,000 and $200,000 … A borrower who has reached the aggregate borrowing limit **may not receive additional Unsubsidized loans until they are repaid, whether in full or in part**." → the $100k/$200k pool is **restorable**; the $257,500 and $65,000 are **not**.
- **Preamble (undergrad exclusion, verbatim):** "undergraduate loans are included in the lifetime maximum aggregate limit, **not** the aggregate limits at the granular graduate or professional level."
- **§685.203(f)(1):** pre-July-2026 PLUS annual limit (and the limit legacy borrowers keep) = "the cost of attendance minus other financial assistance." **(f)(2):** Parent PLUS **$20,000**/academic year for all parents combined per dependent student. **(g)(2):** aggregate **$65,000** "without regard to any amounts repaid …. Any amount of loan funds that have been returned by the institution, or the borrower will not count." **(f)(2)(ii)/(g)(3):** parent exception if the student was enrolled as of June 30, 2026 and "a Direct Loan was made **to the parent borrower** for such program of study on behalf of the dependent student, **or** a Direct Loan was made **to the dependent student** for such program of study." Changing majors within the same degree = same program ((f)(2)(iv), (g)(5)).
- **§685.203(j)(1):** no loan may exceed **cost of attendance minus other financial assistance** (minus EFC for subsidized) — the per-period ceiling under all caps. **(j)(2):** the **$257,500** lifetime rule ("Effective July 1, 2026 … excluding Federal Direct PLUS or Federal PLUS loans made to that student as a parent … without regard to any amounts repaid, forgiven, canceled, or otherwise discharged"; returned funds don't count). **(j)(3):** exception borrowers exempt from it too.
- **§685.203(l):** mixed grad/professional program → professional if **>50% of credit hours** count toward the professional degree.
- **§685.203(m)(1):** part-time proration formula (institution-applied, rounded to nearest whole percentage point). **(m)(2):** "an institution **may limit** the total amount of Direct … loans … for a program of study … as long as any such limit is applied consistently" — schools can cap below the federal ceilings.
- **§685.102(b):** "Expected time to credential: **From July 1, 2026**, … the lesser of — (i) Three academic years, as defined in 34 CFR 668.3; or (ii) [program length minus portion completed]." → the exception can never run past ~June 30, 2029. "Graduate student: … above the baccalaureate level and awards a graduate credential (**other than a professional degree**)."
- **§685.102(b) "Professional student" (the STAYED definition):** professional degree = beginning-practice credential, "generally at the doctoral level … at least six academic years of postsecondary education … Generally requires professional licensure," CIP-code match to: "Pharmacy (Pharm.D.), Dentistry (D.D.S. or D.M.D.), Veterinary Medicine (D.V.M.), Chiropractic (DC or DCM.), Law (L.L.B. or J.D.), Medicine (M.D.), Optometry (O.D.), Osteopathic Medicine (D.O.), Podiatry (D.P.M., D.P., or Pod.D.), Theology (M.Div., or M.H.L.), and Clinical Psychology (Psy.D. or Ph.D.)."

### 1.3 NSLDS processing (FSA EA, Apr 24 2026, updated May 7 2026)

- $257,500 "includes loans received as an undergraduate, graduate, or professional student and includes both Direct Loans and Federal Family Education Loan (FFEL) Program loans"; "PLUS loans for graduate or professional students (both Direct and FFEL) will be included." Excludes "PLUS loans for parent borrowers, consolidation loans (underlying loans are included), or Health Education Assistance Loan (HEAL) Program/health profession program loans." "Once a borrower reaches the $257,500 … no longer … eligible …, **even if the borrower's loans have been repaid, forgiven, or discharged**."
- "Undergraduate subsidized and unsubsidized loans will **not** be included in the calculation of the new graduate or professional aggregate limits."
- Parent PLUS aggregate applies "**per dependent student, not per parent borrower**," beginning with the 2026-27 award year.
- Exception borrowers keep pre-OBBBA aggregates ($138,500 / $224,000 health professions) via a COD "Loan Limit Exception" flag.

### 1.4 The professional-degree litigation (current operative state, July 10, 2026)

- **June 24, 2026:** Judge Beryl Howell (D.D.C.) **preliminarily stayed** the RISE professional-degree definition days before its July 1 effective date (consolidated challenges incl. a 10-org nursing coalition and a 25-state + D.C. suit).
- **FSA EA (Jun 29, updated Jul 10, 2026):** during the stay ED recognizes **29 programs** as professional-degree-granting — the 11 stayed-rule fields **plus** seven more Psy.D. specializations, Audiology (AuD), SLP, Anesthesiologist Assistant, Physician Assistant (MSPA/PA), Athletic Training (MSAT/MAT), OT (incl. MSOT/OTD), PT (DPT), **Registered Nursing (MSN), Nurse Anesthetist (DNAP), Nursing Practice (DNP)**. July 10 update: nursing entries cover any program in the same four-digit CIP code awarding the same credential; Ph.D. added to Clinical Psychology (42.2801). ED even suggests schools "may wish to consider … limiting loan amounts to the graduate-level caps" during litigation — i.e., ED itself flags classification volatility.

### 1.5 Undergraduate limits (unchanged — confirmed, not assumed)

CRS R48727: P.L. 119-21 "does not amend annual and aggregate borrowing limits for loans to undergraduate students." Standing limits (34 CFR 685.203(a)–(d), untouched): dependent undergrads $5,500 / $6,500 / $7,500 per year (max subsidized $3,500/$4,500/$5,500), aggregate **$31,000** (max $23,000 subsidized); independent undergrads $9,500 / $10,500 / $12,500, aggregate **$57,500**. Undergrads never had Grad PLUS; their parents are the ones hit (Correction 1).

---

## 2. Scout-framing verdict (confirm / correct)

| Scout claim | Verdict | Primary-source finding |
|---|---|---|
| Grad $20,500/yr, $100,000 cap | ✅ CONFIRMED (refined) | §1087e(a)(4); but it's a **restorable program-level aggregate excluding undergrad + old Grad PLUS**, not a "lifetime cap" |
| Professional $50,000/yr, $200,000 cap | ✅ CONFIRMED (refined) | Same; grad+professional share one $200,000 pool |
| $257,500 aggregate across all federal loans | ✅ CONFIRMED | §1087e(a)(6); true odometer ("without regard to any amounts repaid"), Direct+FFEL, excl. Parent PLUS/consolidation shell/HEAL |
| "Parent PLUS excluded from these new caps" | ⚠️ **CORRECTED** | Excluded from $257,500 only; NEW caps $20,000/yr + $65,000 aggregate per dependent student across all parents (§1087e(a)(5)) |
| Grad PLUS ended entirely | ✅ CONFIRMED | §1087e(a)(3); legacy borrowers keep COA-based PLUS during the exception |
| Grandfather = "3 years" for borrowers already in a program | ⚠️ **REFINED** | Lesser of 3 academic years (clock from Jul 1, 2026) OR remaining program length; needs enrollment as of Jun 30, 2026 + any Direct Loan for that program before Jul 1, 2026; voided by withdrawal; suspends ALL new limits incl. $257,500 |
| Effective July 1, 2026 | ✅ CONFIRMED | "Periods of enrollment/instruction beginning on or after July 1, 2026"; existing loans keep their terms; existing balances count per the rules above |
| Applies via OBBBA | ✅ CONFIRMED (naming) | P.L. 119-21 §81001; ED now calls the law the "Working Families Tax Cuts Act" |
| Undergrad caps | ✅ CONFIRMED unchanged | CRS explicit; only the parent side changed |
| (unflagged) professional-vs-grad classification | ⚠️ **NEW MATERIAL FACT** | Definition stayed in court Jun 24, 2026; ED interim list = 29 programs (Jul 10 2026); can change mid-litigation |
| "SERP … ZERO calculators" | ⚠️ **NARROWER** | Ascent (lender) has 2 calculators; gradschoolgap.com placeholder; College Aid Pro lead-gen. Neutral statute-cited mechanics still unbuilt |

**10th straight spec to catch real errors in the initial framing** — the load-bearing ones here are the Parent PLUS caps ($20k/$65k), the odometer-vs-restorable split, and the litigation-dependent professional classification.

---

## 3. Proposed dataset — `src/data/student-loan-limits-2026.json` (new file)

Standalone dataset (this is student aid, not tax — do not co-locate in `obbba-deductions-2026.json`).

```jsonc
{
  "_meta": {
    "law": "P.L. 119-21 §81001 (enacted Jul 4, 2025; ED now styles the law 'Working Families Tax Cuts Act', previously 'One Big Beautiful Bill Act'), amending HEA §455(a) / 20 U.S.C. §1087e(a). Implemented by 34 CFR 685.102/685.200/685.203 (RISE final rule, 91 FR 23768, May 1, 2026). Effective for periods of enrollment beginning on or after July 1, 2026.",
    "asOf": "2026-07-12",
    "litigationFlag": "Professional-degree definition (34 CFR 685.102) preliminarily stayed Jun 24, 2026 (D.D.C.). ED interim list of 29 professional programs per FSA EA updated Jul 10, 2026. Re-check before every deploy."
  },
  "graduate":     { "annual": 20500, "aggregate": 100000, "aggregateRestorable": true,
                    "aggregateExcludes": ["undergraduate loans", "Grad PLUS balances"] },
  "professional": { "annual": 50000, "aggregate": 200000, "sharedPoolWithGraduate": true,
                    "aggregateRestorable": true },
  "lifetime":     { "cap": 257500, "odometer": true,
                    "includes": ["Direct + FFEL sub/unsub (undergrad+grad+professional)", "Grad PLUS (Direct + FFEL)"],
                    "excludes": ["Parent PLUS borrowed on behalf of a dependent", "consolidation shell (underlying loans count)", "HEAL/health-professions loans"] },
  "parentPlus":   { "annual": 20000, "aggregate": 65000, "odometer": true,
                    "perDependentStudentAllParentsCombined": true },
  "undergraduate": { "unchanged": true,
    "dependent":   { "annualByYear": [5500, 6500, 7500], "aggregate": 31000 },
    "independent": { "annualByYear": [9500, 10500, 12500], "aggregate": 57500 } },
  "legacyException": {
    "conditions": "Enrolled in the program as of Jun 30, 2026 AND a Direct Loan made for that program before Jul 1, 2026 (for the parent exception: a loan to the parent OR to the student). Voided if the student withdraws/ceases enrollment; same-degree major changes preserve it.",
    "durationYears": "min(3 academic years from Jul 1, 2026, remaining program length)",
    "effect": "New annual/aggregate/Parent-PLUS/$257,500 limits do NOT apply; Grad PLUS + Parent PLUS available up to COA minus other aid; pre-OBBBA unsub aggregate $138,500 (incl. undergrad) / $224,000 health professions applies",
    "preObbbaGradAggregate": 138500, "preObbbaHealthAggregate": 224000
  },
  "coaRule": "Any Direct Loan <= cost of attendance minus other financial assistance (34 CFR 685.203(j)(1)); schools may also set lower consistent program-wide limits (685.203(m)(2)); part-time annual amounts prorated by enrollment intensity (685.203(m)(1))",
  "sources": [
    { "claim": "All caps + exception, statutory text", "url": "https://www.law.cornell.edu/uscode/text/20/1087e" },
    { "claim": "P.L. 119-21 §81001", "url": "https://www.congress.gov/119/plaws/publ21/PLAW-119publ21.pdf" },
    { "claim": "RISE final rule reg text + counting-method preamble", "url": "https://www.govinfo.gov/content/pkg/FR-2026-05-01/pdf/2026-08556.pdf" },
    { "claim": "NSLDS aggregate processing (lifetime-cap composition, per-student Parent PLUS)", "url": "https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-04-24/one-big-beautiful-bill-act-nslds-eligibility-processing-updates-updated-may-7-2026" },
    { "claim": "29-program professional list during court stay (updated Jul 10, 2026)", "url": "https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-06-29/update-list-professional-degree-programs-due-court-order" },
    { "claim": "Undergrad limits unchanged (corroboration)", "url": "https://www.everycrsreport.com/reports/R48727.html" }
  ]
}
```

---

## 4. Calculator mechanics

**Modes:** `graduate` | `professional` | `parentPlus` | `undergradInfo` (informational — limits unchanged).

**Inputs (student modes):**
- `yearsRemaining` (1–6), `annualCoa` (cost of attendance per year), `annualOtherAid` (grants/scholarships/assistantships per year)
- `priorGradUnsubOutstanding` (counts against the $100k/$200k pool — outstanding, since repayment restores)
- `priorProfessionalBorrowed` / `priorGraduateBorrowed` (for the shared-pool subtraction when statuses mix)
- `lifetimeEverBorrowed` (ALL federal student loans ever borrowed for own education, incl. old Grad PLUS and undergrad, **ignoring repayment** — for the $257,500 odometer)
- `legacyEligible` (checkbox: "enrolled in this program on June 30, 2026 AND had a Direct Loan for it before July 1, 2026") + `yearsCompleted` (for expected-time-to-credential)

**Inputs (parentPlus mode):** `yearsRemaining`, `annualCoa`, `annualOtherAid`, `parentPlusAlreadyBorrowedForThisStudent` (all parents combined, ever, ignoring repayment), `legacyEligible`.

**Core loop (student modes):**
```
pool     = (mode == graduate && neverProfessional) ? 100000 : 200000
poolUsed = priorGradUnsubOutstanding + (mixed-status ? priorOtherStatusBorrowed : 0)
odometerRemaining = max(0, 257500 - lifetimeEverBorrowed)
etcYears = legacyEligible ? min(3, programLength - yearsCompleted) : 0

for each remaining year y:
  need = annualCoa - annualOtherAid                       // COA rule (j)(1)
  if y <= etcYears:                                       // legacy exception: old rules
      fed[y] = need                                       // unsub $20,500 + Grad PLUS top-up to COA
      // pre-OBBBA $138,500/$224,000 unsub aggregate rarely binds; surface as note
  else:
      fed[y] = min(annualCap, need, poolRemaining, odometerRemaining)
      poolRemaining     -= fed[y]                          // restorable pool
      odometerRemaining -= fed[y]                          // odometer
  gap[y] = max(0, need - fed[y])
  bindingConstraint[y] = whichever min() argument bound    // "annual cap" | "COA" | "$100k/$200k pool" | "$257,500 lifetime"

totalFederal = Σ fed ; totalGap = Σ gap
```

**Parent PLUS loop:** identical shape with `annualCap = 20000`, `poolRemaining = 65000 - parentPlusAlreadyBorrowed` (odometer — never restored), no $257,500 interaction (excluded), legacy path = COA-based.

**Outputs:**
1. **Year-by-year table:** federal capacity, gap, and the named binding constraint per year.
2. **Headline:** "Under the caps in effect since July 1, 2026, federal loans can cover **$X** of your remaining **$Y** program cost — a funding gap of **$Z**."
3. **Legacy banner** when `legacyEligible`: which years the exception covers, the June 30, 2029 outer bound, and the withdrawal-voids-it warning.
4. **Litigation caveat** (professional mode, date-stamped): classification list is interim, links the FSA EA, "confirm with your financial aid office."
5. **Informational alternatives block** (neutral, no advice/no lender links): remaining gap is typically covered by institutional aid, scholarships/assistantships, employer benefits, savings, or private loans — "this tool doesn't recommend any of them; it only computes the federal arithmetic."
6. **Caveats:** schools may set lower program limits (§685.203(m)(2)); part-time amounts are prorated; loans can never exceed COA minus other aid; figures are statutory, not indexed.

---

## 5. Reuse assessment — standalone engine confirmed

Surveyed `src/engine/`: nothing student-aid related exists. `paycheck-engine.js`, `obbba-deduction.js`, `bonus-tax.js`, etc. are income-tax/payroll math — zero overlap with Title IV cap arithmetic (no brackets, no AGI, no deductions). `amortization.js` / `debt-avalanche.js` are repayment math, not borrowing-cap math. **Recommendation: new standalone `src/engine/student-loan-cap.js` + `src/data/student-loan-limits-2026.json`**, following the repo's engine+data+asset+template pattern. Client-side only; no backend. Cross-link candidates: `/amortization/`-style loan tools, `/debt-avalanche-calculator/`, and the tax-side education pages; do NOT wire it into the OBBBA tax cluster's related-tools mesh as a "tax tool" (different domain, same law).

---

## 6. Myth-bust / framing block (site style, neutral)

- **"The $100,000 graduate cap is a lifetime limit."** No — it's a graduate-level aggregate. Your undergrad loans don't count against it, old Grad PLUS balances don't count against it, and paying it down frees up room. The only true lifetime number is **$257,500** — and that one never resets, even after repayment or forgiveness.
- **"Parent PLUS escaped the new caps."** It escaped the $257,500, but got its own: **$20,000/year and $65,000 total per child — combined across both parents** — and repaying doesn't restore it.
- **"I'm already in grad school, so nothing changes for me."** Only if you were enrolled in your program on June 30, 2026 **and** a Direct Loan was already made for that program. Then the old rules follow you for up to 3 more academic years (or until your program ends, if sooner) — but withdrawing cancels the protection.
- **"Med/law students can still borrow whatever school costs."** Not anymore (unless grandfathered): **$50,000/year, $200,000 total** — while ED's own data puts many four-year professional programs well above that. The difference is the funding gap this tool computes.
- **"My master's program counts as 'professional,' right?"** That exact question is in federal court. ED's interim list (July 10, 2026) recognizes 29 programs — including MSN/DNP nursing, PT, OT, and PA — but the list can change while the litigation runs. Check with your aid office.
- **"Grad students and professional students each get their own pool."** They share one **$200,000** pool; borrowing in one status shrinks the other.

---

## 7. Flagged uncertainties (explicit, none blocking v1)

1. **LITIGATION — professional-degree classification.** The stayed definition vs. ED's 29-program interim list could shift any week (appeal, final judgment, or a revised rule). v1 handles it by user self-selection + a date-stamped caveat + link to the FSA EA. **Re-verify the EA before every deploy of this tool.**
2. **UNVERIFIED DETAIL — $224,000 health-professions aggregate for exception borrowers.** The $138,500 pre-OBBBA aggregate is in the reg text I extracted ((e)(3)); the $224,000 companion figure comes from the NSLDS EA summary and CRS, not from text I quoted verbatim. It only affects the legacy-path note (rarely binding). Confirm the exact EA wording at build time.
3. **OPERATIONAL DETAIL — pool counting.** ED's preamble confirms repayment restores $100k/$200k eligibility, but the NSLDS operational formula (e.g., treatment of capitalized interest — historically aggregates count principal borrowed, not accrued interest) isn't quoted here. v1 asks for "outstanding principal" and says so in help text.
4. **DERIVED, NOT QUOTED — post-exception interaction.** After a grandfathered borrower's exception ends, their exception-period unsub borrowing counts against the new pool and everything (incl. Grad PLUS taken during the exception) counts against the $257,500 odometer. This follows directly from the counting rules but isn't stated in one quotable sentence; fixture F7 encodes it.
5. **OUT OF SCOPE (v1):** interest rates and repayment (RAP/Tiered Standard — separate OBBBA provisions), Pell/work-study, enrollment-intensity proration math (surfaced as a caveat, not an input), subscription-based programs, the >50%-credit-hour mixed-program rule (caveat only), FFEL-era edge cases beyond their inclusion in the $257,500.

---

## 8. Test fixtures (12 cases)

Load-bearing outputs = per-year federal capacity, total gap, **named binding constraint per year**, legacy-exception handling. Dollar outputs below are hand-computed from the loop in §4 — regenerate against the real engine at build time and lock, per chain convention.

| # | Mode | Scenario | Key inputs | Expected result |
|---|---|---|---|---|
| F1 | grad | Under the annual cap | 2 yrs, COA $22,000/yr, aid $6,000/yr, no prior | fed $16,000/yr (**COA rule** binds, not the cap); gap **$0** |
| F2 | grad | Exceeds the annual cap | 2 yrs, COA $45,000/yr, aid $5,000/yr, no prior | fed $20,500/yr (**annual cap**); gap $19,500/yr → **$39,000** |
| F3 | grad | Hits the $100k pool | 2 yrs, COA $30,000/yr, aid 0, prior grad unsub outstanding $85,000 | yr1 $15,000 (**pool**), yr2 $0 (**pool**); gap **$45,000** |
| F4 | professional | Flagship: 4-yr M.D. | 4 yrs, COA $85,000/yr, aid 0, no prior | $50,000×4 (**annual cap**, pool exhausts exactly at yr 4); fed $200,000, gap **$140,000** |
| F5 | professional | Was previously a grad student (shared pool) | 3-yr J.D., COA $75,000/yr, aid $10,000/yr, prior grad borrowing $60,000 | pool = $140,000; yrs 1–2 $50,000 (**annual cap**), yr3 $40,000 (**$200k shared pool**); gap **$55,000** |
| F6 | grad | Grandfathered, fits inside 3 years | 3-yr program, 1 yr done, enrolled + unsub loan made 2025–26; COA $60,000/yr, aid 0 | ETC = min(3, 2) = 2 → both years old rules: fed = full $60,000/yr (unsub + Grad PLUS top-up); gap **$0**; banner shown |
| F7 | grad | Grandfather expires mid-program | 5-yr program, 1 yr done, legacy-eligible; COA $40,000/yr, aid 0 | Yrs 1–3 old rules ($40,000/yr); yr 4 new rules → $20,500 (**annual cap**; pool has $38,500 left after $61,500 exception-era unsub); gap **$19,500** in yr 4 only |
| F8 | parentPlus | New Parent PLUS caps bind | 4 yrs, COA $45,000/yr, aid $5,000/yr, none borrowed yet | Yrs 1–3 $20,000 (**annual cap**), yr 4 $5,000 (**$65,000 aggregate**); parent capacity $65,000 vs need $160,000 → parent-side gap **$95,000** (student's own Stafford shown separately) |
| F9 | parentPlus | Legacy parent | Student enrolled as of Jun 30 2026 (2 yrs left), parent borrowed PLUS in 2025–26; COA $45,000/yr, aid $5,000/yr | ETC covers both years → COA-based: $40,000/yr, caps not applied; gap **$0**; withdrawal warning shown |
| F10 | undergradInfo | Undergrad out-of-scope handling | Dependent sophomore | Tool states undergrad limits **unchanged** ($6,500 yr-2 annual, $31,000 aggregate), no OBBBA math applied to the student's own loans; points parent to parentPlus mode |
| F11 | professional | $257,500 odometer binds below the pool | New professional program; lifetime ever borrowed $240,000 (incl. repaid old Grad PLUS); grad unsub outstanding $20,000 | pool remaining $180,000 but odometer remaining **$17,500** → yr1 $17,500 (**$257,500 lifetime**), then $0. Repayment did NOT restore the odometer |
| F12 | grad | Repayment restores the pool (but not the odometer) | Borrowed $100,000 grad unsub ever, repaid $35,000 (outstanding $65,000); lifetime ever borrowed $120,000; 2 yrs, COA $25,000/yr, aid 0 | pool remaining $35,000; yr1 $20,500 (**annual cap**), yr2 $14,500 (**pool**); gap $4,500+$10,500 = **$15,000**; odometer not binding ($137,500 left) |

**Unit-test additions:** binding-constraint labeling picks the true argmin; F4 boundary (pool hits exactly 0 at final disbursement); legacy checkbox with `yearsCompleted` ≥ program length → ETC 0 (no exception); parentPlus never touches the $257,500; `lifetimeEverBorrowed` input ignores repayment while `priorGradUnsubOutstanding` reflects it (F11 vs F12 asymmetry); COA rule caps even inside the exception path.

---

## 9. Build notes / guardrails

- **Client-side only, standalone engine** (§5). No backend, no lookups of school-specific COA — user enters costs.
- **Tone (AdSense/trust):** pure arithmetic + ED/statute citations, exactly like the OBBBA tax cluster. **No borrowing advice** — never "you should borrow X" or private-lender recommendations/links; the alternatives block is a neutral factual list. No lead-gen. Cite 20 U.S.C. §1087e(a), 91 FR 23768, and the FSA EAs on-page.
- **Date-stamp the litigation caveat** and re-check the FSA professional-programs EA before deploy (§7.1) — it changed as recently as **July 10, 2026**.
- **Do not ship** until an independent verify pass: regenerates §8 dollars from the engine; re-confirms $20,500/$50,000/$100,000/$200,000/$257,500/$20,000/$65,000 against 20 U.S.C. §1087e(a) and the FR text; confirms the odometer-vs-restorable asymmetry (F11/F12); and re-reads the July-10 EA for classification drift.
- **Seasonality:** peaks with award-year events (spring financial-aid letters, July 1 rule anniversaries) and the ongoing news wave — evergreen H2s on "grandfather rules" and "professional vs. graduate" will carry long-tail queries.
