# Tools Berry — Autonomous Build Log

Record of the continuous design+tools loop run on the isolated clone (`utility-portfolio-clone`).
All work local-commit only; the real repo (`utility-portfolio`) was never touched; no deploy/push ran.

## Summary
- **30 standalone tools** + the 24-state paycheck calculator suite. Sitemap: 58 URLs.
- Build green; **18 test suites** passing (pure-logic engines unit-tested).
- Every tool page: AdSense loader + ≥1 ad-slot + unique title/description/canonical + OpenGraph/Twitter + JSON-LD + light/dark + "More free tools" cross-links.
- Validated by a full QA pass (JSON-LD parses everywhere, no leftover tokens, no broken homepage links, no duplicate titles, mobile breakpoints OK).

## Tools built this run (chronological)
**Phase 1 — global design + shortlist**
- Modernized global design system + homepage (`e494437`)
- New-tool shortlist from 3-pass market research → `docs/tool-ideas.md` (`a88f90b`)

**Phase 2 — Tier-1 shortlist tools**
- Image resizer (`f22284b`), Image format converter (`5fc83cb`), Compress image to size (`1d77418`)
- Percentage calculator (`368a03a`), Tip & bill split (`c523c05`)

**Phase 3 — Tier-2 shortlist tools**
- Mortgage calculator + reusable `amortization.js` (`0185497`), Auto-loan (reuses it) (`43a00db`)
- Holiday countdown (`2daec33`), Images→PDF (`b40f8df`), Cooking converter (`4fa89fe`)
- US inflation calculator / CPI-U (`c97f4b4`), Signature maker (`ba2a0b6`)

**Phase 4 — polish**
- Homepage category grouping (`71ccf6c`), shared "More free tools" cross-links (`8741190`)
- Accessibility pass (`8373858`), per-page SEO meta/OG/canonical (`29edc65`), consistency audit (`7db1dca`)

**Phase 5 — extra high-value tools**
- BMI (`f3cd5f3`), Salary↔hourly (`fd8462e`), Sales tax (`2cb319b`), Gas cost (`9bc976c`)
- Age (`b61ca4d`), Debt payoff (`ca22a39`), Unit converter (`3874950`), Password generator (`fe977c5`)
- Word & character counter (`b437b52`), Countdown timer (`a51a238`), Days between dates (`20c99c7`)
- GPA (`4acdd4f`), Hours / time-card (`feac27c`)

## Shared engines (pure, unit-tested) added/reused
`amortization.js` (mortgage, auto-loan, debt-payoff) · `date-math.js` (holiday, age, days-between) · `canvas-math.js` (resize, convert, compress, crop, passport, images→PDF, signature) · `percentage-math.js` · `cooking-units.js` · `units.js` · `inflation.js` + `cpi-us.json` · `bmi.js` · `gpa.js` · `wage.js` · `sales-tax.js` · `fuel-cost.js` · `password.js` · `text-stats.js` · `duration.js` · `timecard.js` · `paycheck-engine.js`

## Maintenance notes
- Inflation: append the prior year's BLS CPI-U annual average to `cpi-us.json` each ~mid-January and bump `throughYear` (currently 2024). Do NOT add partial-year values. (See `docs/tool-ideas.md`.)
- Tax data: existing annual refresh rule (Nov–Dec) still applies to the paycheck calculator.

## Not done (intentionally)
- No deploy. This is an isolated clone for review; merging/deploying to the real site is a separate, user-gated step.
