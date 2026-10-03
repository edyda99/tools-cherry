# Press pitch templates, October 2026

Two paste-ready pitches. Each is three sentences, number first. Fill the
`[brackets]` after running `npm run press-kit` with the official figure in the
data, then delete the brackets. Nothing here is sent automatically; sends gate
on Edmond. This file lives in docs/, which build.js never copies to dist/, so it
is not deployed.

## Variant A: COLA day (SSA announcement, expected 2026-10-14, about 08:30 ET)

Subject: [$X] to [$Y] more a month: what the 2027 Social Security raise means per check

```
[$X] to [$Y] more a month is what today's [N.N]% Social Security raise for 2027 means for checks of $1,200 to $2,600, and readers can work out their own new payment here: https://tools-berry.com/2027-social-security-cola/ . Free charts and the data behind them, including take-home pay in all 50 states and DC, are at https://tools-berry.com/press/2027/ and can be used with credit to Tools Berry. If your story needs a specific figure, such as a different check size or a couple's two checks combined, reply with the details and I will run it for you today.
```

Fill from (after regeneration):

| Bracket | Where to read it |
|---|---|
| `[N.N]` | `src/press-kit/2027/manifest.json` → `cola.percent` (must say `"status": "OFFICIAL"`) |
| `[$X]` | `cola.rows[0].monthlyIncrease` (the $1,200 check) |
| `[$Y]` | `cola.rows[2].monthlyIncrease` (the $2,600 check) |

At today's 3.5% estimate (TSCL's final) these would read $42 and $91. Do not send this variant
with the estimate: it says "today's raise", which is only true on the day.

## Variant B: IRS day (2027 inflation adjustments, any day Oct 9 to Nov 9)

Subject: [$X] to [$Y] less federal income tax in 2027 on the same pay

```
[$X] to [$Y] less federal income tax in 2027 on the same pay is what the new IRS tax brackets released today mean for single people and married couples earning $50,000 to $200,000, and the full brackets are here: https://tools-berry.com/2027-tax-brackets/ . Free charts and the data behind them, including take-home pay in all 50 states and DC, are at https://tools-berry.com/press/2027/ and can be used with credit to Tools Berry. If your story needs a specific figure, such as another salary, filing status or state, reply with the details and I will run it for you today.
```

Fill from (after regeneration):

| Bracket | Where to read it |
|---|---|
| `[$X]` | `manifest.json` → smallest `federal.groups[*].rows[*].change` (must say `"status2027": "OFFICIAL"`) |
| `[$Y]` | largest `federal.groups[*].rows[*].change` |

At today's third-party projections these would read $68 and $561. If any
`change` is negative (tax goes up somewhere), rewrite the opening as a range in
words instead of "less".

## Before either send

| Check | Why |
|---|---|
| The linked page shows the official figure | /2027-tax-brackets/ currently shows the three publishers' projections side by side; on IRS day it must be switched to the official figures before Variant B goes out |
| /press/2027/ is deployed | The page ships with every build but is unlisted (noindex, no sitemap); the link works only after a deploy |
| `hello@tools-berry.com` receives mail | The press page offers custom figures by email |
