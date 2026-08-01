# Final clearance report, branch feat/authority-moves, HEAD 08177d8

## 1. Verdict

DO NOT SHIP.

## 2. Checks

| Check | Verdict | itemsMeasured | Denominator quality | Key number |
|---|---|---|---|---|
| exhaustive-prose | fail | 51 states | Sound. 51 of 51 states, 102 state pages plus 2 hub pages, 31,144 sentences, 3,599 selected, 619 distinct templates judged | 3 major, 2 minor. 7 no-tax states keep false stub advice; 9 bonus pages assert a state supplemental rate that does not exist; 12 of 14 program states disclose nothing on the bonus page |
| garbled | fail | 242 HTML files | Sound. All 242 dist pages, two passes, every hit triaged against raw HTML, baseline diffed against wt-main | 1 major, 4 minor. Reported bug fixed (0 occurrences of `exempt., $184,500`), but the fix left a run-on clause and 3 latent period-comma joins |
| yearclaim | fail | 242 HTML files plus 2 data exports plus tax-data-2026.json | Sound. 51 of 51 state entries checked for figureYear; marker audit across all 242 | 1 blocker, 1 major, 4 minor. 2 of 51 states on 2025 figures (CA, OK); qualifier present on 51 of 51 paycheck pages, absent on 4 bonus-family pages, both data exports, homepage, study meta and JSON-LD |
| numbers | pass | 168 | FLAG, INFLATED. 153 of the 168 are HEAD vs HEAD~1 comparisons of byte-identical files (paycheck-engine.js md5 identical, tax-data-2026.json md5 identical), so they carry near-zero information. Real independent evidence is 15 recomputations across 5 states, plus 5 supplementary at $75,000 | 0 numeric differences; 15 of 15 hand-rewritten computations match the engine to under half a cent; $100,000 matches the shipped CSV, JSON and HTML on 5 of 5 states |
| invariants | pass | 242 HTML files | Sound for what it covers. FLAG, one sub-metric has denominator 0: added styles.css selectors = 0 and modified = 0, so the "prove against an untouched page" scoring had nothing to score. That is because src/assets/styles.css is byte-identical to main (md5 d2432b05, same built hash styles.81ca39ca81.css on all 242 pages), which is the correct reason for a 0, not a skipped check | AdSense loader on 218 of 242 pages in both trees, byte-identical; 0 `<ins>` tags; 1 publisher id; external hosts 260 main to 259 branch, 0 added, 1 removed (www.ebglaw.com); 124 of 124 study links carry the /data/ prefix; 205 of 205 sitemap URLs resolve |
| attack (adversarial read) | fail | 13 pages read end to end | FLAG, SMALL. 13 of 242 pages, 6 of 51 states, chosen by the attack agent. Its 3 highest findings were each confirmed by a whole-corpus grep, so the small denominator did not hide them, but the sample cannot support any claim of coverage over the other 45 states | 2 blockers, 4 major, 4 minor. 0 em dashes and 0 emoji on added lines and in all 7 commit subjects; npm test passes |

Zero-item checks reporting pass: none. The one inflated denominator is `numbers` (153 no-op comparisons). The one zero sub-metric is the styles.css selector count, benign and explained.

## 3. Remaining failures

### Blockers

**B1. Nine paycheck pages tell the reader the estimate is "State tax only" on the same page that says the state's premiums are already subtracted from it.**
Independently verified by me, not taken on the attack agent's word: california, connecticut, hawaii, maine, minnesota, new-jersey, new-york, oregon, rhode-island each contain both the string `State tax only` and the string `subtracted from the take-home estimate`. Only alaska and washington received the corrective sentence. colorado, massachusetts and pennsylvania subtract programs and happen not to carry the "State tax only" phrase, so 9 of the 14 program states are contradictory. New Jersey example, same page: "the NJ UI, NJ WF/SWF, NJ TDI, NJ FLI contributions are subtracted from the take-home estimate at the top of this page" against "What this estimate doesn't include: State tax only." The estimate subtracts $505 of non-tax premiums on $75,000. This is the exact defect class the branch was opened to fix.

**B2. The new helper's HARD RULE 1 is violated by its own caller, so 12 of the 14 program states disclose nothing on their bonus page.**
`build.js:2674`: `const progNote = withholdingProfile(state).hasIncomeTax ? '' : bonusProgramNote(state);` against `src/content/withholding-profile.js:16`, "No copy slot may decide what leaves a paycheck by branching on state.hasIncomeTax alone." Verified by me: `this estimate does not model` appears in exactly 2 of the bonus pages (alaska, washington). California's bonus page never names CA SDI, an uncapped 1.3% premium that the sibling paycheck page subtracts as $975 on $75,000, about $130 on a $10,000 bonus. Alaska, whose premium caps at $271 a year, gets the disclosure; California, uncapped, does not.

**B3. The bonus-calculator family publishes California and Oklahoma state figures computed from 2025 brackets, under a 2026 label, with no visible marker.**
Verified by me: `"figureYear":2025` is present in 6 dist files, including `dist/bonus-tax-calculator/index.html`, `dist/embed/bonus-tax-calculator/index.html`, `dist/california-bonus-tax-calculator/index.html`, `dist/oklahoma-bonus-tax-calculator/index.html`. Stripping script and style from those 4 leaves zero occurrences of "2025" in visible text. Titles read "California Bonus Tax Calculator 2026" and "Oklahoma Bonus Tax Calculator 2026"; the footer reads "Tax year 2026 figures (IRS / state DOR)". No script on those pages reads figureYear, so the qualifier inside the data blob never renders. The Oklahoma page publishes a derived figure from those brackets in prose: "leaving about $404 to owe at filing".

### Major

**M1. Seven no-income-tax, no-program states tell readers to look for deductions that do not exist.** FL, NV, NH, SD, TN, TX, WY all have `employeePrograms = []` and all 7 carry "No state income tax does not mean no state payroll deductions. Check your stub for state-run leave or disability contributions", while the same pages say "the only deductions on your 2026 paycheck are federal withholding and FICA, no state line at all". 2 of 9 no-tax states were fixed, 7 were left.

**M2. Nine bonus pages assert a state supplemental rate that the same page says does not exist.** The boilerplate "The 22% federal and the state supplemental rate are withholding defaults" appears on 15 bonus pages. False on NV, TN, WA (no state income tax) and contradicted by the adjacent FAQ on CT, DC, KY, LA, MA, PA. Tennessee, adjacent sentences: "Tennessee has no state income tax, so $0 is withheld for state tax" then "The 22% federal and the state supplemental rate are withholding defaults".

**M3. Washington's two pages disagree on whether WA Cares applies to a bonus.** Paycheck page: "NO Social Security wage cap ... high earners keep paying it on every dollar", table row "No wage cap (applies to all wages)". Bonus page: "The published rates do not say whether a separately paid bonus carries them." A bonus is wages. The bonus page then prints a definite total, "$5,280 federal (22%) + $0 state + $1,836 FICA = $7,116", on a $24,000 bonus, omitting roughly $333 of WA premiums.

**M4. Two opposite rules applied to the same class of uncertainty, and it moves a published rank.** Minnesota ("employer may deduct up to half of the 0.88% total premium") and Hawaii ("employer may withhold one-half of the premium cost") are subtracted with certainty; Delaware, identically conditional, is excluded and labelled "Not in the estimate". Consequence: the study ranks Minnesota 48 of 51 at $57,686 on the strength of a $330 deduction the employer is permitted to pay in full.

**M5. New Jersey local income tax, two pages contradict.** Study page: "14 states allow city, county or school-district income taxes ... New Jersey ...". New Jersey page: "New Jersey has no local wage income tax for residents (Newark payroll tax is employer-side)".

**M6. Connecticut personal exemption amounts are missing from rendered text.** Verified by me: `dist/connecticut-paycheck-calculator/index.html` renders "(,000 single / ,000 MFJ / ,000 HoH" twice in a visible paragraph. Source `src/data/tax-data-2026.json:1782`. Pre-existing, identical in the wt-main baseline, not introduced by this branch.

**M7. The published CC BY data exports declare 2026 for all 51 with no CA or OK marker.** `dist/data/take-home-pay-by-state-2026.json` has `"taxYear":"2026"`, zero occurrences of "figureYear" and zero of "2025"; the CSV header has no year column. The HTML invites republication ("Free to use and republish with attribution"), so the files travel without the on-page qualifier.

**M8. Worst reader-facing sentence added by this diff.** `src/data/state-payroll-2026.json`, rendered verbatim on `dist/delaware-paycheck-calculator`: a 79-word, three-tier, semicolon-chained rate rule inside a table cell, ending "all of which are exempt". That trailing clause is also the source of the run-on flagged by the garbled check on `what-applies-to-me`: "all of which are exempt, charged on wages up to $184,500", which reads as though the cap applies to the exempt employers.

### Minor

- Delaware is shown with an employee-paid program on 2 pages while the data file and the study say it has none; the study headline says 14 jurisdictions, what-applies-to-me lists 15.
- The "Use this free X calculator" intro on 12 income-taxing program states enumerates federal, SS, Medicare and state income tax, omitting the program the same page says is subtracted.
- Doubled period on maine and rhode-island paycheck pages, in both visible text and the FAQPage JSON-LD, from `build.js:2269` appending a period to a value that already ends in one. Pre-existing in wt-main.
- Latent: the same join at `src/content/what-applies-to-me.js:227` and `:384` would produce period-comma output for Maine, Rhode Island and Hawaii. Not currently reachable in any of the 242 dist files.
- Homepage anchor "California income tax rate 2026" links to a page that says 2026 is pending. Homepage study promo asserts 2026 across all 51 with no exception. Study meta description, JSON-LD description and table caption all say 2026 for all 51 without the exception. CA and OK page titles and meta descriptions say 2026 while their bodies say pending.
- `bonusEvidence` has 4 values but every caller collapses `excluded` into `unknown`; the `confirmed` branches at `state-applies.js:93` and `build.js:2616` are unreachable, since no record in tax-data-2026.json carries `appliesToSupplemental`.
- Dead branch: "Other programs in this table ... are not subtracted" at `build.js:2059` renders on 0 of 51 pages.
- Program ordering is inconsistent: New Jersey's four funds appear in 3 different orders on one page, against the helper header's stated invariant at `withholding-profile.js:29`.
- `docs/authority-moves-report.md` cites `dist/take-home-pay-by-state/index.html` three times; the real path is `dist/data/take-home-pay-by-state/index.html`. Untracked, not shipped.
- Two U+2192 arrows added in `scripts/test-sdi.js` test names. Not emoji, not shipped copy, not a rule violation. Recorded only because a symbol sweep was requested.

## 4. Not checked, and why

- **No build was run by any verifier.** By workflow rule only the fix agent builds. All five checks and the attack pass read the existing `dist` (242 HTML files). Provenance was confirmed three ways: the HEAD-only Delaware string "the most an employer may pass on" is in dist, the HEAD~1 string is gone, no src file is newer than dist/index.html, and 0 unreplaced `{{TOKEN}}` mustaches remain. If dist were stale, every finding below the source level would be void; it is not stale.
- **Numeric correctness of 46 of 51 states was not independently derived.** Only AK, MN, NJ, PA, WA were recomputed from hand-transcribed brackets. All at single filer, biweekly, no pretax deductions. Married, head of household, other pay frequencies, 401k and HSA paths: not exercised. The 153-item regression sweep proves only that the engine and tax data did not change on this branch, which is true and uninformative.
- **$50,000 and $250,000 have no published counterpart.** `STUDY_SALARIES` is `[75000, 100000]`, so 10 of the 15 independent recomputations could be validated only against the engine, not against shipped output.
- **No rendering, no browser, no visual or mobile layout pass, no Lighthouse, no accessibility audit.** Everything was read as source text.
- **No external validation of citations or source URLs.** The only host-level check was a byte comparison of the external-host set against main.
- **No structured-data validator run** against Google Rich Results. JSON-LD was read as text only.
- **No AdSense policy judgement.** The invariants check compared the loader tag, slot count and publisher id against main byte for byte and found them unchanged. It did not assess policy compliance of the content.
- **No deploy, no push, no indexing submission.** Forbidden by the worktree brief.
- **Ohio, Delaware and Connecticut were examined by me only for the specific defects named**, not exhaustively.

## 5. Deferred and still wrong

**Ohio's missing statutory base amount.** ORC 5747.02(A)(3) as amended by HB 96 sets the 2026 tax at **$332.00 plus 2.75% of the amount over $26,050**. The engine models 0% to $26,050 then 2.75% marginal, dropping the $332.00. Verified against shipped output: `dist/data/take-home-pay-by-state-2026.csv` gives Ohio state income tax 1346 at $75,000 and 2034 at $100,000, which is exactly 0.0275 times the excess. The statutory figures are 1678 and 2366. **Every Ohio filer with taxable income above $26,050 is understated by $332**, on the Ohio paycheck page, the study table, the CSV and the JSON export. The source comment in `src/data/tax-data-2026.json:1398` calls this "Ohio's small base-amount rounding offset". It is not a rounding offset, it is a flat $332 addition to the tax. Unfixed on this branch.

**California and Oklahoma on 2025 figures.** 2 of 51 states carry `figureYear: 2025`. The qualifier "except California and Oklahoma, still on their 2025 tables" is present on 51 of 51 paycheck pages and in the study body, and per-row `.fy-flag` markers render on the CA and OK rows of the study table. It is absent from: the 4 bonus-family pages that publish those same brackets (blocker B3), both published data exports, the homepage anchor and study promo, the study meta description and JSON-LD, and the CA and OK titles and meta descriptions. Oklahoma is the sharper case, its own page states that HB2764 cuts the 2026 top rate to 4.50% while the page computes on the 2025 4.75% schedule. Unfixed on this branch.

**Connecticut's missing exemption amounts.** Pre-existing, present in wt-main, carried forward unchanged: visible text on the Connecticut paycheck page reads "(,000 single / ,000 MFJ / ,000 HoH". Not introduced here, not fixed here.
