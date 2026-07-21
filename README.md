# Tools Berry

A collection of free, 100% client-side web utilities: calculators, converters,
image/file tools, and a cluster of 2025/2026 U.S. tax calculators built around
the One Big Beautiful Bill Act (OBBBA). Every tool runs entirely in the browser;
nothing you type or upload is sent to a server (the one exception is an optional,
opt-in server path for PDF to Word, described below). The site is a static build
generated from templates plus sourced data, hosted on Cloudflare Pages.

Live: **https://tools-berry.com**

## What's in it

The build produces **231 pages**. In broad strokes:

| Category | What it covers |
|----------|----------------|
| Photo & Image tools | Resize, convert, compress, crop-to-circle, passport/ID photos, images-to-PDF, PDF-to-Word, signature maker |
| Everyday calculators | Percentage, tip/bill-split, dates & age, unit/cooking converters, BMI/calories, GPA, timers, and more |
| Money & Finance | Mortgage, auto loan, debt payoff, compound interest, inflation, savings, plus the 2025/2026 OBBBA tax cluster (No Tax on Tips, No Tax on Overtime, car-loan interest, SALT cap, senior deduction, charitable/QCD, PMI, dependent-care, W-2 decoder, and others) |
| Make & Share | QR codes, passwords, invoices, word counter |
| Developer & Text | JSON formatter, base64, diff, UUID, color/base converters, Markdown to HTML, Morse |
| State paycheck calculators | One page per jurisdiction at `/{state}-paycheck-calculator/` — 51 pages covering all 50 states plus D.C. |
| State bonus-tax calculators | Supplemental-wage/bonus withholding, one page per jurisdiction at `/{state}-bonus-tax-calculator/` — 51 pages |
| Tax glossary & corrections log | `/tax-glossary/` explains terms; `/corrections/` is a public log of data fixes |
| Embeddable widgets | 20 pages under `/embed/` — iframe-friendly twins of the tax calculators plus a hub index |

The **PDF to Word** tool converts in-browser by default. It also offers an
optional, opt-in higher-fidelity conversion that uploads the PDF over HTTPS to a
server, converts it, and discards it immediately.

## Repo layout

```
build.js              generates dist/ from templates + data (single build script)
src/
  data/               sourced tax/limit tables (JSON) — the annual maintenance
  engine/             pure calculation modules, one per tool, unit-tested
  templates/          page templates; templates/embed/ are the iframe twins
  content/            legal, about, contact, glossary and corrections copy
  assets/             CSS, JS, and vendored libs (jsPDF, pdf.js, etc.) — no CDN
scripts/              engine/data test suite + data-freshness check
functions/            Cloudflare Pages Functions (feedback, report, PDF proxy)
backend/pdf-to-word/  optional server-side PDF→Word converter (AWS Lambda)
workers/              scheduled R2 cleanup worker for the server path
docs/                 per-tool build specs
dist/                 build output (gitignored) — the deploy target
```

## Build

```
npm install
npm run build    # runs node build.js → writes dist/
npm test         # runs the engine + tax-data test suite and a freshness check
npm run dev      # build, then serve dist/ locally
```

The output in `dist/` is a plain static site: deploy the folder to any static
host (this one runs on Cloudflare Pages).

## Data accuracy & sourcing

This is a tax/finance (YMYL) site, so numbers matter. All figures live in
`src/data/*.json`, each keyed to an official source — federal brackets, standard
deduction and FICA come from IRS Rev. Proc. releases, SSA, and the Tax Foundation
(see `_meta.sources` in `tax-data-2026.json`); per-state payroll tables carry
`_sourcedOn` / `_accuracyVerified` metadata. Calculations run client-side from
these tables, and any errors caught after publishing are recorded in the public
[corrections log](https://tools-berry.com/corrections/).

## License

Released under the [MIT License](LICENSE) — Copyright (c) 2026 Edmond Daher.
