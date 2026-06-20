# Tools Berry — New Tool Shortlist

Ranked from 3 parallel market-research passes (calculators / image-PDF / money-seasonal).
Scoring = estimated US monthly search volume × low build complexity × reuse of existing engines × fit for non-technical mainstream audience. Volume figures are **estimates**, not exact.

Existing engines to reuse: **canvas image editor** (load/zoom/pan/crop/export PNG·JPEG·WebP), **paycheck/tax engine**, **jsPDF** (vendored), **QR** (vendored). All tools must stay 100% client-side (no backend, no external API).

## Tier 1 — build first (lowest cost, highest volume, reuse existing engine)
| # | Tool | Est. US vol/mo | Reuses | Complexity | Spec (in → out) |
|---|------|----------------|--------|-----------|-----------------|
| 1 | Image resizer | 800k–1M | canvas | Low | image + WxH/percent → resized PNG/JPEG/WebP |
| 2 | Image format converter (PNG/JPG/WebP) | 400–600k | canvas | Low | image + target format → converted file |
| 3 | Compress image to target KB | 300–500k | canvas | Low | image + target KB → quality-tuned smaller file |
| 4 | Percentage / discount calculator | 250k+ | pure math | Low | price + % → final price + savings |
| 5 | Tip + bill split | 150–250k | pure math | Low | bill + tip% + people → per-person total |

## Tier 2 — high value, slightly more work or more SEO competition
| # | Tool | Est. US vol/mo | Reuses | Complexity | Notes |
|---|------|----------------|--------|-----------|-------|
| 6 | Mortgage calculator | ~165k | new amortization engine | Low | build engine once → reuse for #7 |
| 7 | Auto-loan calculator | ~65k | amortization engine (#6) | Low | near-zero extra cost after #6 |
| 8 | Holiday countdown | seasonal 1M+ spikes | date math | Low | target date → days/hrs left; holiday presets |
| 9 | Images → PDF merger | 200–350k | jsPDF + canvas | Medium | multi-image upload + reorder → PDF |
| 10 | Cooking unit converter | ~180k | pure math | Low–Med | cups/tbsp/tsp/ml/oz convert + recipe scaler |
| 11 | Inflation calculator | ~120k | bundled CPI table | Low | $ + year→year → today's value (annual data refresh) |
| 12 | Signature maker | 150–250k | canvas | Low | type/draw → transparent PNG |

## Notes & disagreements
- **Mortgage:** research split — agent A ranked #1 by volume; agent C said skip (Bankrate/NerdWallet own the SERP). Reality: huge volume but brutal competition for a new domain. Build it, but expect Tier-1 + low-competition tools (holiday countdown, percentage, cooking) to rank *faster* while domain authority builds.
- **Privacy is the differentiator** for all image/PDF tools: "files never leave your device." Use in copy (no jargon).
- **Avoid** (break the static/client-side model): AI background remover, AI upscaler (need WASM/ML), live currency converter (needs API), HEIC/RAW conversion (needs WASM).
- **Maintenance debt:** sales-tax (county data), inflation (annual CPI), fuel cost (gas price) need periodic data refresh — fine but track it.
  - **ANNUAL: inflation calculator** — each year after BLS publishes the prior year's full CPI-U annual average (~mid-January, series CUUR0000SA0 at bls.gov/cpi), append the new year to `src/data/cpi-us.json` and bump `throughYear`. Do NOT add a partial/estimated current-year value. Currently through 2024.

## Build protocol (per tool)
Each new tool = its own page dir, reuses an existing engine/template pattern, registered in `build.js`, with `.ad-slot`(s) + the AdSense loader present, light/dark theming, mobile-first, plain-English copy. Verify `npm run build` + `npm test` green and ad slots/loader intact before committing locally.
