# utility-portfolio

Portfolio of free, client-side web utilities monetized by display ads. One umbrella domain, many tools, all static.

**Tool #1 — State paycheck calculators.** pSEO: one engine, one page per state at `/{state}-paycheck-calculator/`. All math runs in the browser; no backend. 24 states built (9 no-tax + 15 flat/simple); indexed-bracket states (CA, NY, …) deferred until their 2026 tables publish.

**Tool #2 — Invoice generator.** `/invoice-generator/` — fill a form, get a downloadable PDF (jsPDF, vendored locally in `src/assets/`). No signup, nothing uploaded.

## Structure

```
src/
  data/
    tax-data-2026.json    # federal brackets/std deduction/FICA + per-state tax tables (the ONLY annual maintenance)
    states.json           # 50-state roster (names/slugs) for the nav grid
  engine/
    paycheck-engine.js     # pure calc: federal withholding + FICA + state tax (data-driven)
  content/
    static-pages.js        # privacy / terms / about / contact bodies (AdSense-required)
  templates/
    state-page.html        # pSEO template — fills from tax-data
    home.html              # portfolio home + tools + state grid
    page.html              # generic content-page template (legal/404)
    invoice-generator.html # tool #2 page
  assets/
    styles.css
    app.js                 # paycheck: wires form -> engine -> live results
    invoice.js             # invoice: form -> live preview -> PDF
    jspdf.umd.min.js       # vendored PDF lib (no CDN, keeps data local)
build.js                   # generates ./dist from templates + data
scripts/test-engine.js     # smoke tests for the federal+FICA core
```

## Develop

```
npm test         # validate the engine math
npm run build    # generate ./dist
npm run dev      # build + serve dist locally
```

## Deploy (Cloudflare Pages)

- Framework preset: **None**
- Build command: `npm run build`
- Build output directory: `dist`
- Before first deploy, set `SITE.name` and `SITE.url` in `build.js`.

## Adding a state (states 2–50)

1. Add an entry under `states` in `tax-data-2026.json`:
   - No-income-tax state: `"tax": { "type": "none" }`, `"hasIncomeTax": false`.
   - Flat tax: `"type": "flat"`, `"rate": 0.0xx`, optional `standardDeduction`.
   - Bracketed: `"type": "bracket"`, `"brackets": { "single": [...], ... }`.
2. `npm run build`. The page, sitemap entry, and nav link generate automatically.

No template or engine changes needed — states are pure data.

## ⚠️ Tax-data accuracy (do not skip before launch)

All `tax-data-2026.json` figures are sourced (Oct 2025 IRS Rev. Proc. 2025-32 + Tax Foundation, see `_meta.sources`) but **must be re-verified against IRS.gov / each state DOR before launch** — a wrong paycheck calculator is worthless and AdSense-risky. Federal brackets, standard deduction, and FICA wage base are populated for 2026; only Texas has a state entry so far.

## Monetization

Ad slots are placeholder `<div class="ad-slot">` markers. Apply to AdSense once ~15–20 real content pages exist; swap placeholders for ad units then. Ezoic at ~10k sessions/mo, Mediavine at 50k.
