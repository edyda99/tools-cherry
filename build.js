#!/usr/bin/env node
// build.js — pSEO static generator. Reads templates + tax data, emits ./dist.
// Cloudflare Pages: build command `npm run build`, output dir `dist`.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_PAGES } from './src/content/static-pages.js';
import { computePaycheck } from './src/engine/paycheck-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'src');
const DIST = join(__dirname, 'dist');

// --- Site config (set the real values at first deploy) -----------------------
const SITE = {
  name: 'Tools Berry',
  url: 'https://tools-berry.com',
  contactEmail: 'hello@tools-berry.com', // set up Cloudflare Email Routing (free) so this inbox receives
  adsensePublisherId: 'pub-4961606095434424' // ca-pub form is derived; drives the <head> loader + ads.txt
};

// Cloudflare Turnstile site key for the PDF->Word server-fallback widget (public).
// Defaults to Cloudflare's "always passes" TEST key; set the real key via env for
// production builds:  TURNSTILE_SITEKEY=0x... npm run build
const TURNSTILE_SITEKEY = process.env.TURNSTILE_SITEKEY || '1x00000000000000000000AA';

// AdSense site-verification / auto-ads loader, injected into every page's <head>.
// Empty string when no publisher ID is set, so the build stays clean pre-AdSense.
const ADSENSE_HEAD = SITE.adsensePublisherId
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${SITE.adsensePublisherId}" crossorigin="anonymous"></script>\n`
  : '';

// --- Canonical tool list (single source of truth) ----------------------------
// Drives the "More free tools" cross-link block injected on every tool page.
// Add a tool here once and it appears in every other tool page's footer block.
const TOOLS = [
  { name: 'Image Resizer', path: '/resize-image/' },
  { name: 'Image Format Converter', path: '/convert-image/' },
  { name: 'Compress Image', path: '/compress-image/' },
  { name: 'Crop Image Into Circle', path: '/crop-image-into-circle/' },
  { name: 'Passport & ID Photo', path: '/passport-photo-maker/' },
  { name: 'Images to PDF', path: '/images-to-pdf/' },
  { name: 'PDF to Word', path: '/pdf-to-word/' },
  { name: 'Signature Maker', path: '/signature-maker/' },
  { name: 'Percentage Calculator', path: '/percentage-calculator/' },
  { name: 'Tip & Bill Split', path: '/tip-calculator/' },
  { name: 'Discount Calculator', path: '/discount-calculator/' },
  { name: 'Paint Calculator', path: '/paint-calculator/' },
  { name: 'Tile Calculator', path: '/tile-calculator/' },
  { name: 'Sleep Calculator', path: '/sleep-calculator/' },
  { name: 'Cooking Converter', path: '/cooking-converter/' },
  { name: 'Recipe Scaler', path: '/recipe-scaler/' },
  { name: 'Unit Converter', path: '/unit-converter/' },
  { name: 'BMI Calculator', path: '/bmi-calculator/' },
  { name: 'Calorie Calculator', path: '/calorie-calculator/' },
  { name: 'Ideal Weight & Macro Calculator', path: '/ideal-weight-calculator/' },
  { name: 'Running Pace Calculator', path: '/pace-calculator/' },
  { name: 'Pregnancy Due Date Calculator', path: '/due-date-calculator/' },
  { name: 'Ovulation Calculator', path: '/ovulation-calculator/' },
  { name: 'GPA Calculator', path: '/gpa-calculator/' },
  { name: 'Age Calculator', path: '/age-calculator/' },
  { name: 'Days Between Dates', path: '/days-between-dates/' },
  { name: 'Date Calculator (Add or Subtract)', path: '/date-calculator/' },
  { name: 'Time Zone Converter', path: '/time-zone-converter/' },
  { name: 'Holiday Countdown', path: '/holiday-countdown/' },
  { name: 'Countdown Timer', path: '/countdown-timer/' },
  { name: 'Mortgage Calculator', path: '/mortgage-calculator/' },
  { name: 'Auto Loan Calculator', path: '/auto-loan-calculator/' },
  { name: 'Debt Payoff Calculator', path: '/debt-payoff-calculator/' },
  { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
  { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
  { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
  { name: 'Inflation Calculator', path: '/inflation-calculator/' },
  { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
  { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
  { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
  { name: 'Gas Cost Calculator', path: '/gas-cost-calculator/' },
  { name: 'Fuel Economy Calculator (MPG, L/100km)', path: '/fuel-economy-calculator/' },
  { name: 'QR Code Generator', path: '/qr-code-generator/' },
  { name: 'Password Generator', path: '/password-generator/' },
  { name: 'Invoice Generator', path: '/invoice-generator/' },
  { name: 'Word & Character Counter', path: '/word-counter/' },
  { name: 'Lorem Ipsum Generator', path: '/lorem-ipsum-generator/' },
  { name: 'Text Case Converter', path: '/text-case-converter/' },
  { name: 'Roman Numeral Converter', path: '/roman-numeral-converter/' },
  { name: 'Binary, Hex & Decimal Converter', path: '/base-converter/' },
  { name: 'Color Converter (HEX, RGB, HSL)', path: '/color-converter/' },
  { name: 'JSON Formatter & Validator', path: '/json-formatter/' },
  { name: 'UUID Generator', path: '/uuid-generator/' },
  { name: 'Random Number Generator', path: '/random-number-generator/' },
  { name: 'Text Diff Checker', path: '/diff-checker/' },
  { name: 'Base64 Encode & Decode', path: '/base64-encode-decode/' },
  { name: 'Aspect Ratio Calculator', path: '/aspect-ratio-calculator/' },
  { name: 'Fraction Calculator', path: '/fraction-calculator/' },
  { name: 'Average Calculator (Mean, Median, Mode)', path: '/average-calculator/' },
  { name: 'Morse Code Translator', path: '/morse-code-translator/' },
  { name: 'Paycheck Calculators', path: '/#paycheck' }
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Build the "More free tools" cross-link block, excluding the current page's
// own path so a tool never links to itself.
function moreToolsBlock(currentPath) {
  const links = TOOLS.filter((t) => t.path !== currentPath)
    .map((t) => `      <a href="${t.path}">${esc(t.name)}</a>`)
    .join('\n');
  return (
    `<section class="more-tools" aria-label="More free tools">\n` +
    `  <div class="wrap">\n` +
    `    <h2>More free tools</h2>\n` +
    `    <div class="more-tools-grid">\n${links}\n    </div>\n` +
    `  </div>\n` +
    `</section>\n`
  );
}

const read = (p) => readFile(p, 'utf8');
const readJSON = async (p) => JSON.parse(await read(p));

// Centralized per-page SEO normalization. Every template already ships a unique,
// hand-written <title>, <meta name="description"> and <link rel="canonical">; this
// fills in the *missing*, mechanical social/discovery tags (og:url, og:type,
// og:site_name, the og:title/og:description fallback, and the Twitter card) so
// they don't have to be repeated across 16+ templates. Derives values from the
// page's own title/description/canonical, so it stays DRY and self-consistent.
//
// Idempotent: each tag is only inserted when absent, so building twice never
// doubles a tag. Only runs on full pages (those with a </head>).
function injectSeo(html) {
  if (!html.includes('</head>')) return html;

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  const canonMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']\s*\/?>/i);

  const title = titleMatch ? titleMatch[1].trim() : SITE.name;
  const desc = descMatch ? descMatch[1].trim() : '';
  const url = canonMatch ? canonMatch[1].trim() : SITE.url + '/';

  // og:title / twitter:title fall back to the page <title>, but if the template
  // already declares its own (shorter, social-tuned) og:title we keep it and
  // reuse it for the Twitter card too.
  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  const socialTitle = ogTitleMatch ? ogTitleMatch[1].trim() : title;
  const socialDesc = ogDescMatch ? ogDescMatch[1].trim() : desc;

  // [regex to test presence, html to insert] — only inserted when not already there.
  const tags = [
    [/<meta\s+property=["']og:title["']/i, `<meta property="og:title" content="${socialTitle}">`],
    [/<meta\s+property=["']og:description["']/i, `<meta property="og:description" content="${socialDesc}">`],
    [/<meta\s+property=["']og:type["']/i, `<meta property="og:type" content="website">`],
    [/<meta\s+property=["']og:url["']/i, `<meta property="og:url" content="${url}">`],
    [/<meta\s+property=["']og:site_name["']/i, `<meta property="og:site_name" content="${esc(SITE.name)}">`],
    [/<meta\s+name=["']twitter:card["']/i, `<meta name="twitter:card" content="summary">`],
    [/<meta\s+name=["']twitter:title["']/i, `<meta name="twitter:title" content="${socialTitle}">`],
    [/<meta\s+name=["']twitter:description["']/i, `<meta name="twitter:description" content="${socialDesc}">`]
  ];

  const toInsert = tags.filter(([re]) => !re.test(html)).map(([, tag]) => tag);
  if (!toInsert.length) return html;
  return html.replace('</head>', `${toInsert.join('\n')}\n</head>`);
}

function fill(tpl, map) {
  let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in map ? map[k] : m));
  // Inject the AdSense loader into every full page (anything with a </head>).
  // Fragment fills (page bodies/descriptions) have no </head>, so they're untouched.
  if (ADSENSE_HEAD && out.includes('</head>')) out = out.replace('</head>', `${ADSENSE_HEAD}</head>`);
  // Normalize/complete per-page SEO social tags (no-op on fragments).
  out = injectSeo(out);
  return out;
}

// fill() for tool pages: same as fill(), then injects the centralized
// "More free tools" block just before the site footer. Only tool-page writes
// call this, so the homepage and legal/static pages stay untouched.
function fillTool(tpl, map, currentPath) {
  let out = fill(tpl, map);
  out = out.replace('<footer class="site">', `${moreToolsBlock(currentPath)}\n<footer class="site">`);
  return out;
}

// Deep-clone a value omitting internal-only keys ("_"-prefixed like _meta/_source/_note,
// plus any stray "verification") so build provenance never ships in page source or the
// published data JSON. The source data file keeps them; only embedded/published copies are stripped.
function stripInternal(value) {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_') || k === 'verification') continue;
      out[k] = stripInternal(v);
    }
    return out;
  }
  return value;
}

// A prominent, user-visible banner when a state's figures are from a prior year
// (prior-year fallback policy) — e.g. California shows 2025 rates while 2026 is pending.
// Returns '' when figureYear matches the site tax year.
function figureYearBanner(state, year) {
  const fy = Number(state.figureYear);
  const yr = Number(year);
  if (!fy || fy === yr) return '';
  return `<p class="year-fallback" role="note">` +
    `<strong>${fy} rates (${yr} pending).</strong> ` +
    `Showing ${state.name}'s official ${fy} tax figures — ${fy < yr ? 'the state has not published ' + yr + ' brackets yet' : 'figures are from ' + fy} and this page will update when ${yr} figures are released.` +
    `</p>`;
}

const pctStr = (r) => (r * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
const usd0 = (n) => '$' + Math.round(n).toLocaleString('en-US');

// Genuinely state-specific tax facts derived from the (already-sourced) data:
// bracket count, rate range, top rate + threshold, standard deduction, and a
// worked $60k example. Distinct per state — clears scaled/duplicate-content risk.
function stateTaxFacts(state, year, taxData) {
  const t = state.tax;
  const sd = t.standardDeduction;
  const sdText = sd
    ? `For ${year}, ${state.name}'s state standard deduction is ${usd0(sd.single)} for single filers and ${usd0(sd.married)} for married couples filing jointly`
    : `${state.name} does not provide a state standard deduction`;
  let example = '';
  try {
    const ann = computePaycheck({ wage: { type: 'salary', amount: 60000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: state.slug }, taxData).annual;
    if (Number.isFinite(ann.state) && ann.state > 0) {
      example = ` As a worked example, a single filer earning $60,000 pays about ${usd0(ann.state)} in ${state.name} income tax (roughly ${(ann.state / 60000 * 100).toFixed(1)}% of gross) before federal tax and FICA.`;
    } else if (ann.state === 0) {
      example = ` A single filer earning $60,000 owes essentially no ${state.name} income tax once the deduction is applied.`;
    }
  } catch (_) { /* leave example empty if compute fails */ }

  if (t.type === 'flat') {
    return `<p>${sdText}; after that, all remaining taxable income is taxed at the single ` +
      `flat rate of <strong>${pctStr(t.rate)}</strong> — ${state.name} does not use graduated brackets for ${year}.${example}</p>`;
  }
  const b = t.brackets.single || [];
  const n = b.length;
  const low = pctStr(b[0].rate);
  const top = pctStr(b[n - 1].rate);
  const topThresh = n >= 2 ? b[n - 2].upTo : null;
  return `<p>${state.name} uses a <strong>graduated income tax with ${n} bracket${n > 1 ? 's' : ''}</strong> for ${year}, ` +
    `with marginal rates ranging from ${low} to a top rate of <strong>${top}</strong>` +
    (topThresh ? ` (which applies to single-filer taxable income above ${usd0(topThresh)})` : '') + `. ` +
    `${sdText}.${example}</p>`;
}

// Genuinely state-specific facts for the no-income-tax states, so those pages
// aren't a name-swapped template (scaled-content risk). Each is true for that
// state and different from the others.
const NOTAX_FACTS = {
  alaska: 'Alaska levies neither a state income tax nor a statewide sales tax, and it pays eligible residents an annual Permanent Fund Dividend from oil revenues.',
  florida: "Florida's constitution prohibits a personal income tax, and the state funds itself largely through sales tax and tourism-related revenue.",
  nevada: 'Nevada has no individual income tax and leans heavily on sales tax and gaming/tourism revenue instead.',
  'new-hampshire': "New Hampshire does not tax earned wages; its former 5% tax on interest and dividends was fully phased out and repealed effective January 1, 2025, so investment income is now untaxed too.",
  'south-dakota': 'South Dakota has no individual income tax and no corporate income tax, funding services mainly through sales and property taxes.',
  tennessee: "Tennessee has no tax on wages; its 'Hall tax' on interest and dividend income was fully repealed in 2021, making the state completely income-tax-free.",
  texas: 'Texas has no personal income tax, and a 2019 constitutional amendment bars the state from enacting one without a statewide voter referendum.',
  washington: 'Washington has no tax on wage income, though since 2022 it applies a 7% excise tax on annual long-term capital gains above an inflation-adjusted threshold (around $270,000) — which does not touch ordinary paychecks.',
  wyoming: 'Wyoming has no individual or corporate income tax, relying on mineral severance taxes and federal mineral royalties to fund state government.'
};

// Prose body per state — branches on whether the state levies income tax.
function stateBody(state, year, taxData) {
  const noTax = !state.hasIncomeTax;
  if (noTax) {
    const fact = NOTAX_FACTS[state.slug] ? ` ${NOTAX_FACTS[state.slug]}` : '';
    return `<p>${state.name} is one of the U.S. states with <strong>no state income tax</strong>. ` +
      `Your ${year} paycheck is reduced only by federal income tax withholding and FICA ` +
      `(Social Security and Medicare) — there is no ${state.name} income tax line, so your take-home ` +
      `pay is higher than in an otherwise-identical job in a state that taxes wages.${fact}</p>` +
      `<p>Federal withholding is estimated from the ${year} IRS tax brackets and the standard ` +
      `deduction for your filing status. FICA is 6.2% Social Security (up to the ${usd0(taxData.federal.fica.socialSecurity.wageBase)} ${year} wage base) ` +
      `plus 1.45% Medicare on all wages, with an extra 0.9% on high earnings. Change your filing ` +
      `status, pay frequency, or switch between salary and hourly above to see how your take-home ` +
      `pay changes.</p>`;
  }

  const t = state.tax;
  let how;
  if (t.type === 'flat') {
    how = `${state.name} levies a <strong>flat ${pctStr(t.rate)} state income tax</strong> for ${year}`;
    how += t.standardDeduction
      ? `, applied after the state allowance/deduction for your filing status.`
      : ` on your wages, with no state standard deduction.`;
  } else {
    how = `${state.name} taxes income on a graduated state schedule for ${year}, applied after the state deduction for your filing status.`;
  }

  let body =
    `<p>${how} This calculator applies that on top of federal withholding and ` +
    `Social Security / Medicare to estimate your ${state.name} take-home pay.</p>` +
    stateTaxFacts(state, year, taxData) +
    `<p>Adjust your filing status, pay frequency, and gross wage above to update the breakdown.</p>`;

  const disclaimers = state.disclaimer || [];
  if (disclaimers.length) {
    body += `<p class="note"><strong>What this estimate doesn't include:</strong> ` +
      disclaimers.join(' ') + `</p>`;
  }
  return body;
}

function faqJsonLd(state, year) {
  const taxLine = state.hasIncomeTax
    ? `federal income tax, Social Security, Medicare, and ${state.name} state income tax`
    : `federal income tax, Social Security, and Medicare (${state.name} has no state income tax)`;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Does ${state.name} have a state income tax in ${year}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: state.hasIncomeTax
            ? `Yes. ${state.name} levies a state income tax in ${year}, applied on top of federal tax and FICA.`
            : `No. ${state.name} has no state income tax, so paychecks are reduced only by federal income tax and FICA (Social Security and Medicare).`
        }
      },
      {
        '@type': 'Question',
        name: `How is take-home pay calculated in ${state.name}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Take-home pay is your gross wage minus ${taxLine}. Enter your salary or hourly rate, filing status, and pay frequency to see the estimate.`
        }
      }
    ]
  });
}

function stateLinks(roster, builtSlugs, year) {
  return roster
    .map((s) => {
      const href = `/${s.slug}-paycheck-calculator/`;
      return builtSlugs.has(s.slug)
        ? `<a href="${href}">${s.name}</a>`
        : `<span title="Coming soon">${s.name}</span>`;
    })
    .join('\n');
}

async function main() {
  const taxData = await readJSON(join(SRC, 'data', 'tax-data-2026.json'));
  const roster = await readJSON(join(SRC, 'data', 'states.json'));
  const stateTpl = await read(join(SRC, 'templates', 'state-page.html'));
  const homeTpl = await read(join(SRC, 'templates', 'home.html'));
  const pageTpl = await read(join(SRC, 'templates', 'page.html'));
  const invoiceTpl = await read(join(SRC, 'templates', 'invoice-generator.html'));
  const imagesToPdfTpl = await read(join(SRC, 'templates', 'images-to-pdf.html'));
  const pdfToWordTpl = await read(join(SRC, 'templates', 'pdf-to-word.html'));
  const qrTpl = await read(join(SRC, 'templates', 'qr-generator.html'));
  const circleTpl = await read(join(SRC, 'templates', 'circle-crop.html'));
  const photoTpl = await read(join(SRC, 'templates', 'passport-photo-maker.html'));
  const resizeTpl = await read(join(SRC, 'templates', 'image-resizer.html'));
  const convertTpl = await read(join(SRC, 'templates', 'image-converter.html'));
  const compressTpl = await read(join(SRC, 'templates', 'image-compressor.html'));
  const percentTpl = await read(join(SRC, 'templates', 'percentage-calculator.html'));
  const tipTpl = await read(join(SRC, 'templates', 'tip-calculator.html'));
  const mortgageTpl = await read(join(SRC, 'templates', 'mortgage-calculator.html'));
  const autoLoanTpl = await read(join(SRC, 'templates', 'auto-loan-calculator.html'));
  const debtPayoffTpl = await read(join(SRC, 'templates', 'debt-payoff-calculator.html'));
  const countdownTpl = await read(join(SRC, 'templates', 'holiday-countdown.html'));
  const timerTpl = await read(join(SRC, 'templates', 'countdown-timer.html'));
  const ageTpl = await read(join(SRC, 'templates', 'age-calculator.html'));
  const daysBetweenTpl = await read(join(SRC, 'templates', 'days-between-dates.html'));
  const timeZoneTpl = await read(join(SRC, 'templates', 'time-zone-converter.html'));
  const dateCalcTpl = await read(join(SRC, 'templates', 'date-calculator.html'));
  const cookingTpl = await read(join(SRC, 'templates', 'cooking-converter.html'));
  const recipeScalerTpl = await read(join(SRC, 'templates', 'recipe-scaler.html'));
  const unitConverterTpl = await read(join(SRC, 'templates', 'unit-converter.html'));
  const bmiTpl = await read(join(SRC, 'templates', 'bmi-calculator.html'));
  const dueDateTpl = await read(join(SRC, 'templates', 'due-date-calculator.html'));
  const ovulationTpl = await read(join(SRC, 'templates', 'ovulation-calculator.html'));
  const calorieTpl = await read(join(SRC, 'templates', 'calorie-calculator.html'));
  const idealWeightTpl = await read(join(SRC, 'templates', 'ideal-weight-calculator.html'));
  const gpaTpl = await read(join(SRC, 'templates', 'gpa-calculator.html'));
  const compoundTpl = await read(join(SRC, 'templates', 'compound-interest-calculator.html'));
  const retire401kTpl = await read(join(SRC, 'templates', '401k-calculator.html'));
  const savingsGoalTpl = await read(join(SRC, 'templates', 'savings-goal-calculator.html'));
  const inflationTpl = await read(join(SRC, 'templates', 'inflation-calculator.html'));
  const salaryHourlyTpl = await read(join(SRC, 'templates', 'salary-to-hourly.html'));
  const salesTaxTpl = await read(join(SRC, 'templates', 'sales-tax-calculator.html'));
  const gasCostTpl = await read(join(SRC, 'templates', 'gas-cost-calculator.html'));
  const signatureTpl = await read(join(SRC, 'templates', 'signature-maker.html'));
  const passwordTpl = await read(join(SRC, 'templates', 'password-generator.html'));
  const wordCounterTpl = await read(join(SRC, 'templates', 'word-counter.html'));
  const hoursCalcTpl = await read(join(SRC, 'templates', 'hours-calculator.html'));
  const textCaseTpl = await read(join(SRC, 'templates', 'text-case-converter.html'));
  const romanTpl = await read(join(SRC, 'templates', 'roman-numeral-converter.html'));
  const baseConverterTpl = await read(join(SRC, 'templates', 'base-converter.html'));
  const colorConverterTpl = await read(join(SRC, 'templates', 'color-converter.html'));
  const jsonFormatterTpl = await read(join(SRC, 'templates', 'json-formatter.html'));
  const uuidTpl = await read(join(SRC, 'templates', 'uuid-generator.html'));
  const diffCheckerTpl = await read(join(SRC, 'templates', 'diff-checker.html'));
  const base64Tpl = await read(join(SRC, 'templates', 'base64-converter.html'));
  const aspectRatioTpl = await read(join(SRC, 'templates', 'aspect-ratio-calculator.html'));
  const discountTpl = await read(join(SRC, 'templates', 'discount-calculator.html'));
  const fuelEconomyTpl = await read(join(SRC, 'templates', 'fuel-economy-calculator.html'));
  const randomNumberTpl = await read(join(SRC, 'templates', 'random-number-generator.html'));
  const paintTpl = await read(join(SRC, 'templates', 'paint-calculator.html'));
  const tileTpl = await read(join(SRC, 'templates', 'tile-calculator.html'));
  const sleepTpl = await read(join(SRC, 'templates', 'sleep-calculator.html'));
  const paceTpl = await read(join(SRC, 'templates', 'pace-calculator.html'));
  const fractionTpl = await read(join(SRC, 'templates', 'fraction-calculator.html'));
  const loremTpl = await read(join(SRC, 'templates', 'lorem-ipsum-generator.html'));
  const averageTpl = await read(join(SRC, 'templates', 'average-calculator.html'));
  const morseTpl = await read(join(SRC, 'templates', 'morse-code-translator.html'));
  const photoSpecs = await readJSON(join(SRC, 'data', 'photo-specs.json'));
  const cpiUs = await readJSON(join(SRC, 'data', 'cpi-us.json'));
  const year = String(taxData.taxYear);
  const verified = (taxData._meta && taxData._meta.lastSourced) || '';

  // Warn-only freshness check at build (the hard fail lives in `npm test`).
  const nowYear = new Date().getFullYear();
  if (nowYear > taxData.taxYear) {
    console.warn(`\n⚠  STALE TAX DATA: figures are for ${taxData.taxYear} but it is ${nowYear}. ` +
      `Update to ${nowYear} before relying on this deploy. (npm test will fail on this.)\n`);
  }

  const builtSlugs = new Set(Object.keys(taxData.states));
  const links = stateLinks(roster, builtSlugs, year);

  // fresh dist
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // assets (engine + app + styles served from /assets)
  await mkdir(join(DIST, 'assets'), { recursive: true });
  await cp(join(SRC, 'assets', 'styles.css'), join(DIST, 'assets', 'styles.css'));
  await cp(join(SRC, 'assets', 'app.js'), join(DIST, 'assets', 'app.js'));
  await cp(join(SRC, 'assets', 'invoice.js'), join(DIST, 'assets', 'invoice.js'));
  await cp(join(SRC, 'assets', 'images-to-pdf.js'), join(DIST, 'assets', 'images-to-pdf.js'));
  await cp(join(SRC, 'assets', 'pdf-to-word.js'), join(DIST, 'assets', 'pdf-to-word.js'));
  await cp(join(SRC, 'assets', 'jspdf.umd.min.js'), join(DIST, 'assets', 'jspdf.umd.min.js'));
  await cp(join(SRC, 'assets', 'pdf.min.js'), join(DIST, 'assets', 'pdf.min.js'));
  await cp(join(SRC, 'assets', 'pdf.worker.min.js'), join(DIST, 'assets', 'pdf.worker.min.js'));
  await cp(join(SRC, 'assets', 'docx.umd.js'), join(DIST, 'assets', 'docx.umd.js'));
  await cp(join(SRC, 'assets', 'qr.js'), join(DIST, 'assets', 'qr.js'));
  await cp(join(SRC, 'assets', 'qrcode.min.js'), join(DIST, 'assets', 'qrcode.min.js'));
  await cp(join(SRC, 'assets', 'circle-crop.js'), join(DIST, 'assets', 'circle-crop.js'));
  await cp(join(SRC, 'assets', 'photo-maker.js'), join(DIST, 'assets', 'photo-maker.js'));
  await cp(join(SRC, 'assets', 'image-resizer.js'), join(DIST, 'assets', 'image-resizer.js'));
  await cp(join(SRC, 'assets', 'image-converter.js'), join(DIST, 'assets', 'image-converter.js'));
  await cp(join(SRC, 'assets', 'image-compressor.js'), join(DIST, 'assets', 'image-compressor.js'));
  await cp(join(SRC, 'assets', 'percentage-calculator.js'), join(DIST, 'assets', 'percentage-calculator.js'));
  await cp(join(SRC, 'assets', 'tip-calculator.js'), join(DIST, 'assets', 'tip-calculator.js'));
  await cp(join(SRC, 'assets', 'mortgage-calculator.js'), join(DIST, 'assets', 'mortgage-calculator.js'));
  await cp(join(SRC, 'assets', 'auto-loan-calculator.js'), join(DIST, 'assets', 'auto-loan-calculator.js'));
  await cp(join(SRC, 'assets', 'debt-payoff-calculator.js'), join(DIST, 'assets', 'debt-payoff-calculator.js'));
  await cp(join(SRC, 'assets', 'holiday-countdown.js'), join(DIST, 'assets', 'holiday-countdown.js'));
  await cp(join(SRC, 'assets', 'countdown-timer.js'), join(DIST, 'assets', 'countdown-timer.js'));
  await cp(join(SRC, 'engine', 'duration.js'), join(DIST, 'assets', 'duration.js'));
  await cp(join(SRC, 'assets', 'age-calculator.js'), join(DIST, 'assets', 'age-calculator.js'));
  await cp(join(SRC, 'assets', 'days-between-dates.js'), join(DIST, 'assets', 'days-between-dates.js'));
  await cp(join(SRC, 'assets', 'time-zone-converter.js'), join(DIST, 'assets', 'time-zone-converter.js'));
  await cp(join(SRC, 'engine', 'timezone.js'), join(DIST, 'assets', 'timezone.js'));
  await cp(join(SRC, 'assets', 'date-calculator.js'), join(DIST, 'assets', 'date-calculator.js'));
  await cp(join(SRC, 'engine', 'date-add.js'), join(DIST, 'assets', 'date-add.js'));
  await cp(join(SRC, 'assets', 'cooking-converter.js'), join(DIST, 'assets', 'cooking-converter.js'));
  await cp(join(SRC, 'engine', 'percentage-math.js'), join(DIST, 'assets', 'percentage-math.js'));
  await cp(join(SRC, 'engine', 'tip-math.js'), join(DIST, 'assets', 'tip-math.js'));
  await cp(join(SRC, 'engine', 'date-math.js'), join(DIST, 'assets', 'date-math.js'));
  await cp(join(SRC, 'engine', 'cooking-units.js'), join(DIST, 'assets', 'cooking-units.js'));
  await cp(join(SRC, 'assets', 'recipe-scaler.js'), join(DIST, 'assets', 'recipe-scaler.js'));
  await cp(join(SRC, 'engine', 'recipe-scale.js'), join(DIST, 'assets', 'recipe-scale.js'));
  await cp(join(SRC, 'assets', 'unit-converter.js'), join(DIST, 'assets', 'unit-converter.js'));
  await cp(join(SRC, 'engine', 'units.js'), join(DIST, 'assets', 'units.js'));
  await cp(join(SRC, 'assets', 'bmi-calculator.js'), join(DIST, 'assets', 'bmi-calculator.js'));
  await cp(join(SRC, 'engine', 'bmi.js'), join(DIST, 'assets', 'bmi.js'));
  await cp(join(SRC, 'assets', 'due-date-calculator.js'), join(DIST, 'assets', 'due-date-calculator.js'));
  await cp(join(SRC, 'engine', 'due-date.js'), join(DIST, 'assets', 'due-date.js'));
  await cp(join(SRC, 'assets', 'ovulation-calculator.js'), join(DIST, 'assets', 'ovulation-calculator.js'));
  await cp(join(SRC, 'engine', 'ovulation.js'), join(DIST, 'assets', 'ovulation.js'));
  await cp(join(SRC, 'assets', 'calorie-calculator.js'), join(DIST, 'assets', 'calorie-calculator.js'));
  await cp(join(SRC, 'engine', 'calories.js'), join(DIST, 'assets', 'calories.js'));
  await cp(join(SRC, 'assets', 'ideal-weight-calculator.js'), join(DIST, 'assets', 'ideal-weight-calculator.js'));
  await cp(join(SRC, 'engine', 'ideal-weight.js'), join(DIST, 'assets', 'ideal-weight.js'));
  await cp(join(SRC, 'assets', 'gpa-calculator.js'), join(DIST, 'assets', 'gpa-calculator.js'));
  await cp(join(SRC, 'engine', 'gpa.js'), join(DIST, 'assets', 'gpa.js'));
  await cp(join(SRC, 'assets', 'inflation-calculator.js'), join(DIST, 'assets', 'inflation-calculator.js'));
  await cp(join(SRC, 'engine', 'inflation.js'), join(DIST, 'assets', 'inflation.js'));
  await cp(join(SRC, 'engine', 'amortization.js'), join(DIST, 'assets', 'amortization.js'));
  await cp(join(SRC, 'assets', 'compound-interest-calculator.js'), join(DIST, 'assets', 'compound-interest-calculator.js'));
  await cp(join(SRC, 'engine', 'compound-interest.js'), join(DIST, 'assets', 'compound-interest.js'));
  await cp(join(SRC, 'assets', '401k-calculator.js'), join(DIST, 'assets', '401k-calculator.js'));
  await cp(join(SRC, 'engine', 'retirement-401k.js'), join(DIST, 'assets', 'retirement-401k.js'));
  await cp(join(SRC, 'assets', 'savings-goal-calculator.js'), join(DIST, 'assets', 'savings-goal-calculator.js'));
  await cp(join(SRC, 'engine', 'savings-goal.js'), join(DIST, 'assets', 'savings-goal.js'));
  await cp(join(SRC, 'engine', 'paycheck-engine.js'), join(DIST, 'assets', 'paycheck-engine.js'));
  await cp(join(SRC, 'engine', 'canvas-math.js'), join(DIST, 'assets', 'canvas-math.js'));
  await cp(join(SRC, 'engine', 'canvas-editor.js'), join(DIST, 'assets', 'canvas-editor.js'));
  await cp(join(SRC, 'assets', 'signature-maker.js'), join(DIST, 'assets', 'signature-maker.js'));
  await cp(join(SRC, 'assets', 'salary-to-hourly.js'), join(DIST, 'assets', 'salary-to-hourly.js'));
  await cp(join(SRC, 'engine', 'wage.js'), join(DIST, 'assets', 'wage.js'));
  await cp(join(SRC, 'assets', 'sales-tax-calculator.js'), join(DIST, 'assets', 'sales-tax-calculator.js'));
  await cp(join(SRC, 'engine', 'sales-tax.js'), join(DIST, 'assets', 'sales-tax.js'));
  await cp(join(SRC, 'assets', 'gas-cost-calculator.js'), join(DIST, 'assets', 'gas-cost-calculator.js'));
  await cp(join(SRC, 'engine', 'fuel-cost.js'), join(DIST, 'assets', 'fuel-cost.js'));
  await cp(join(SRC, 'assets', 'password-generator.js'), join(DIST, 'assets', 'password-generator.js'));
  await cp(join(SRC, 'engine', 'password.js'), join(DIST, 'assets', 'password.js'));
  await cp(join(SRC, 'assets', 'word-counter.js'), join(DIST, 'assets', 'word-counter.js'));
  await cp(join(SRC, 'engine', 'text-stats.js'), join(DIST, 'assets', 'text-stats.js'));
  await cp(join(SRC, 'assets', 'hours-calculator.js'), join(DIST, 'assets', 'hours-calculator.js'));
  await cp(join(SRC, 'engine', 'timecard.js'), join(DIST, 'assets', 'timecard.js'));
  await cp(join(SRC, 'assets', 'text-case-converter.js'), join(DIST, 'assets', 'text-case-converter.js'));
  await cp(join(SRC, 'assets', 'roman-numeral-converter.js'), join(DIST, 'assets', 'roman-numeral-converter.js'));
  await cp(join(SRC, 'engine', 'roman.js'), join(DIST, 'assets', 'roman.js'));
  await cp(join(SRC, 'assets', 'base-converter.js'), join(DIST, 'assets', 'base-converter.js'));
  await cp(join(SRC, 'engine', 'number-base.js'), join(DIST, 'assets', 'number-base.js'));
  await cp(join(SRC, 'assets', 'color-converter.js'), join(DIST, 'assets', 'color-converter.js'));
  await cp(join(SRC, 'engine', 'color.js'), join(DIST, 'assets', 'color.js'));
  await cp(join(SRC, 'assets', 'json-formatter.js'), join(DIST, 'assets', 'json-formatter.js'));
  await cp(join(SRC, 'engine', 'json-format.js'), join(DIST, 'assets', 'json-format.js'));
  await cp(join(SRC, 'assets', 'uuid-generator.js'), join(DIST, 'assets', 'uuid-generator.js'));
  await cp(join(SRC, 'engine', 'uuid.js'), join(DIST, 'assets', 'uuid.js'));
  await cp(join(SRC, 'assets', 'diff-checker.js'), join(DIST, 'assets', 'diff-checker.js'));
  await cp(join(SRC, 'engine', 'text-diff.js'), join(DIST, 'assets', 'text-diff.js'));
  await cp(join(SRC, 'assets', 'base64-converter.js'), join(DIST, 'assets', 'base64-converter.js'));
  await cp(join(SRC, 'engine', 'base64.js'), join(DIST, 'assets', 'base64.js'));
  await cp(join(SRC, 'assets', 'aspect-ratio-calculator.js'), join(DIST, 'assets', 'aspect-ratio-calculator.js'));
  await cp(join(SRC, 'engine', 'aspect-ratio.js'), join(DIST, 'assets', 'aspect-ratio.js'));
  await cp(join(SRC, 'assets', 'discount-calculator.js'), join(DIST, 'assets', 'discount-calculator.js'));
  await cp(join(SRC, 'engine', 'discount.js'), join(DIST, 'assets', 'discount.js'));
  await cp(join(SRC, 'assets', 'fuel-economy-calculator.js'), join(DIST, 'assets', 'fuel-economy-calculator.js'));
  await cp(join(SRC, 'engine', 'fuel-economy.js'), join(DIST, 'assets', 'fuel-economy.js'));
  await cp(join(SRC, 'assets', 'random-number-generator.js'), join(DIST, 'assets', 'random-number-generator.js'));
  await cp(join(SRC, 'engine', 'random-number.js'), join(DIST, 'assets', 'random-number.js'));
  await cp(join(SRC, 'assets', 'paint-calculator.js'), join(DIST, 'assets', 'paint-calculator.js'));
  await cp(join(SRC, 'engine', 'paint.js'), join(DIST, 'assets', 'paint.js'));
  await cp(join(SRC, 'assets', 'tile-calculator.js'), join(DIST, 'assets', 'tile-calculator.js'));
  await cp(join(SRC, 'engine', 'tile.js'), join(DIST, 'assets', 'tile.js'));
  await cp(join(SRC, 'assets', 'sleep-calculator.js'), join(DIST, 'assets', 'sleep-calculator.js'));
  await cp(join(SRC, 'engine', 'sleep.js'), join(DIST, 'assets', 'sleep.js'));
  await cp(join(SRC, 'assets', 'pace-calculator.js'), join(DIST, 'assets', 'pace-calculator.js'));
  await cp(join(SRC, 'engine', 'pace.js'), join(DIST, 'assets', 'pace.js'));
  await cp(join(SRC, 'assets', 'fraction-calculator.js'), join(DIST, 'assets', 'fraction-calculator.js'));
  await cp(join(SRC, 'engine', 'fraction.js'), join(DIST, 'assets', 'fraction.js'));
  await cp(join(SRC, 'assets', 'lorem-ipsum-generator.js'), join(DIST, 'assets', 'lorem-ipsum-generator.js'));
  await cp(join(SRC, 'engine', 'lorem.js'), join(DIST, 'assets', 'lorem.js'));
  await cp(join(SRC, 'assets', 'average-calculator.js'), join(DIST, 'assets', 'average-calculator.js'));
  await cp(join(SRC, 'engine', 'average.js'), join(DIST, 'assets', 'average.js'));
  await cp(join(SRC, 'assets', 'morse-code-translator.js'), join(DIST, 'assets', 'morse-code-translator.js'));
  await cp(join(SRC, 'engine', 'morse.js'), join(DIST, 'assets', 'morse.js'));

  const urls = [`${SITE.url}/`];

  // one page per state present in tax-data
  for (const slug of builtSlugs) {
    const state = taxData.states[slug];
    // per-page payload: federal + only this state (keeps embedded JSON small)
    const payload = stripInternal({ taxYear: taxData.taxYear, federal: taxData.federal, states: { [slug]: state } });
    const html = fill(stateTpl, {
      STATE_NAME: state.name,
      STATE_SLUG: slug,
      STATE_TAX_PHRASE: state.hasIncomeTax ? `, and ${state.name} state income tax` : '',
      FIGURE_BANNER: figureYearBanner(state, year),
      STATE_BODY: stateBody(state, year, taxData),
      STATE_LINKS: links,
      FAQ_JSONLD: faqJsonLd(state, year),
      TAX_DATA_JSON: JSON.stringify(payload),
      YEAR: year,
      VERIFIED: verified,
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url
    });
    const dir = join(DIST, `${slug}-paycheck-calculator`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), html);
    urls.push(`${SITE.url}/${slug}-paycheck-calculator/`);
  }

  // home
  await writeFile(
    join(DIST, 'index.html'),
    fill(homeTpl, { STATE_LINKS: links, YEAR: year, SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );

  // static content pages (privacy / terms / about / contact) — two-pass fill so
  // tokens inside each page body are also resolved.
  const siteMap = { SITE_NAME: SITE.name, SITE_URL: SITE.url, CONTACT_EMAIL: SITE.contactEmail };
  for (const p of STATIC_PAGES) {
    const body = fill(p.body, siteMap);
    const html = fill(pageTpl, {
      ...siteMap,
      PAGE_TITLE: p.title,
      PAGE_DESC: fill(p.desc, siteMap),
      PAGE_SLUG: p.slug,
      ROBOTS: p.robots || 'index, follow',
      PAGE_BODY: body
    });
    const dir = join(DIST, p.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), html);
    urls.push(`${SITE.url}/${p.slug}/`);
  }

  // invoice generator (standalone tool page)
  await mkdir(join(DIST, 'invoice-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'invoice-generator', 'index.html'),
    fillTool(invoiceTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/invoice-generator/')
  );
  urls.push(`${SITE.url}/invoice-generator/`);

  // images to PDF converter (standalone tool page, reuses jsPDF + canvas-math)
  await mkdir(join(DIST, 'images-to-pdf'), { recursive: true });
  await writeFile(
    join(DIST, 'images-to-pdf', 'index.html'),
    fillTool(imagesToPdfTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/images-to-pdf/')
  );
  urls.push(`${SITE.url}/images-to-pdf/`);

  // PDF to Word converter (client-side by default; optional server fallback via the Cloudflare gate)
  await mkdir(join(DIST, 'pdf-to-word'), { recursive: true });
  await writeFile(
    join(DIST, 'pdf-to-word', 'index.html'),
    fillTool(pdfToWordTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, TURNSTILE_SITEKEY }, '/pdf-to-word/')
  );
  urls.push(`${SITE.url}/pdf-to-word/`);

  // qr code generator (standalone tool page)
  await mkdir(join(DIST, 'qr-code-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'qr-code-generator', 'index.html'),
    fillTool(qrTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/qr-code-generator/')
  );
  urls.push(`${SITE.url}/qr-code-generator/`);

  // circle crop (image tool, built on CanvasEditor)
  await mkdir(join(DIST, 'crop-image-into-circle'), { recursive: true });
  await writeFile(
    join(DIST, 'crop-image-into-circle', 'index.html'),
    fillTool(circleTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/crop-image-into-circle/')
  );
  urls.push(`${SITE.url}/crop-image-into-circle/`);

  // passport photo maker (CanvasEditor + sourced photo specs)
  await mkdir(join(DIST, 'passport-photo-maker'), { recursive: true });
  await writeFile(
    join(DIST, 'passport-photo-maker', 'index.html'),
    fillTool(photoTpl, {
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url,
      PHOTO_SPECS_JSON: JSON.stringify({ specs: photoSpecs.specs, printSheet: photoSpecs.printSheet })
    }, '/passport-photo-maker/')
  );
  urls.push(`${SITE.url}/passport-photo-maker/`);

  // image resizer (resize by pixels/percent, reuses canvas-math helpers)
  await mkdir(join(DIST, 'resize-image'), { recursive: true });
  await writeFile(
    join(DIST, 'resize-image', 'index.html'),
    fillTool(resizeTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/resize-image/')
  );
  urls.push(`${SITE.url}/resize-image/`);

  // image format converter (PNG/JPG/WebP, reuses canvas-math helpers)
  await mkdir(join(DIST, 'convert-image'), { recursive: true });
  await writeFile(
    join(DIST, 'convert-image', 'index.html'),
    fillTool(convertTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/convert-image/')
  );
  urls.push(`${SITE.url}/convert-image/`);

  // image compressor (compress to a target file size, reuses qualityForTargetBytes)
  await mkdir(join(DIST, 'compress-image'), { recursive: true });
  await writeFile(
    join(DIST, 'compress-image', 'index.html'),
    fillTool(compressTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/compress-image/')
  );
  urls.push(`${SITE.url}/compress-image/`);

  // percentage calculator (pure-math tool page)
  await mkdir(join(DIST, 'percentage-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'percentage-calculator', 'index.html'),
    fillTool(percentTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/percentage-calculator/')
  );
  urls.push(`${SITE.url}/percentage-calculator/`);

  // tip calculator & bill splitter (pure-math tool page)
  await mkdir(join(DIST, 'tip-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'tip-calculator', 'index.html'),
    fillTool(tipTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/tip-calculator/')
  );
  urls.push(`${SITE.url}/tip-calculator/`);

  // mortgage calculator (pure-math tool page, built on the amortization engine)
  await mkdir(join(DIST, 'mortgage-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'mortgage-calculator', 'index.html'),
    fillTool(mortgageTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/mortgage-calculator/')
  );
  urls.push(`${SITE.url}/mortgage-calculator/`);

  // auto loan / car payment calculator (pure-math tool page, built on the amortization engine)
  await mkdir(join(DIST, 'auto-loan-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'auto-loan-calculator', 'index.html'),
    fillTool(autoLoanTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/auto-loan-calculator/')
  );
  urls.push(`${SITE.url}/auto-loan-calculator/`);

  // debt payoff / credit card payoff calculator (pure-math, built on the amortization engine)
  await mkdir(join(DIST, 'debt-payoff-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'debt-payoff-calculator', 'index.html'),
    fillTool(debtPayoffTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/debt-payoff-calculator/')
  );
  urls.push(`${SITE.url}/debt-payoff-calculator/`);

  // compound interest / savings growth calculator (pure-math, built on the compound-interest engine)
  await mkdir(join(DIST, 'compound-interest-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'compound-interest-calculator', 'index.html'),
    fillTool(compoundTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/compound-interest-calculator/')
  );
  urls.push(`${SITE.url}/compound-interest-calculator/`);

  // 401(k) retirement calculator (pure-math, built on the retirement-401k engine)
  await mkdir(join(DIST, '401k-calculator'), { recursive: true });
  await writeFile(
    join(DIST, '401k-calculator', 'index.html'),
    fillTool(retire401kTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/401k-calculator/')
  );
  urls.push(`${SITE.url}/401k-calculator/`);

  // savings goal calculator (how much to save / how long, built on the savings-goal engine)
  await mkdir(join(DIST, 'savings-goal-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'savings-goal-calculator', 'index.html'),
    fillTool(savingsGoalTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/savings-goal-calculator/')
  );
  urls.push(`${SITE.url}/savings-goal-calculator/`);

  // holiday countdown / days-until calculator (pure date-math tool page)
  await mkdir(join(DIST, 'holiday-countdown'), { recursive: true });
  await writeFile(
    join(DIST, 'holiday-countdown', 'index.html'),
    fillTool(countdownTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/holiday-countdown/')
  );
  urls.push(`${SITE.url}/holiday-countdown/`);

  // countdown timer (set-a-duration timer, built on the pure duration module)
  await mkdir(join(DIST, 'countdown-timer'), { recursive: true });
  await writeFile(
    join(DIST, 'countdown-timer', 'index.html'),
    fillTool(timerTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/countdown-timer/')
  );
  urls.push(`${SITE.url}/countdown-timer/`);

  // age calculator (pure date-math tool page, reuses ageBreakdown + nextBirthday)
  await mkdir(join(DIST, 'age-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'age-calculator', 'index.html'),
    fillTool(ageTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/age-calculator/')
  );
  urls.push(`${SITE.url}/age-calculator/`);

  // days between dates / date duration calculator (pure date-math tool page,
  // reuses daysBetween + ageBreakdown + businessDaysBetween)
  await mkdir(join(DIST, 'days-between-dates'), { recursive: true });
  await writeFile(
    join(DIST, 'days-between-dates', 'index.html'),
    fillTool(daysBetweenTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/days-between-dates/')
  );
  urls.push(`${SITE.url}/days-between-dates/`);

  // time zone converter (pure Intl-based zone math, built on the timezone engine)
  await mkdir(join(DIST, 'time-zone-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'time-zone-converter', 'index.html'),
    fillTool(timeZoneTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/time-zone-converter/')
  );
  urls.push(`${SITE.url}/time-zone-converter/`);

  // date calculator (add/subtract days, weeks, months, years — built on date-add.js)
  await mkdir(join(DIST, 'date-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'date-calculator', 'index.html'),
    fillTool(dateCalcTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/date-calculator/')
  );
  urls.push(`${SITE.url}/date-calculator/`);

  // cooking measurement converter (pure-math tool page, built on cooking-units)
  await mkdir(join(DIST, 'cooking-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'cooking-converter', 'index.html'),
    fillTool(cookingTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/cooking-converter/')
  );
  urls.push(`${SITE.url}/cooking-converter/`);

  // recipe scaler (halve/double/resize ingredient amounts, built on recipe-scale)
  await mkdir(join(DIST, 'recipe-scaler'), { recursive: true });
  await writeFile(
    join(DIST, 'recipe-scaler', 'index.html'),
    fillTool(recipeScalerTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/recipe-scaler/')
  );
  urls.push(`${SITE.url}/recipe-scaler/`);

  // general-purpose unit converter (pure-math tool page, built on units.js)
  await mkdir(join(DIST, 'unit-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'unit-converter', 'index.html'),
    fillTool(unitConverterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/unit-converter/')
  );
  urls.push(`${SITE.url}/unit-converter/`);

  // BMI calculator (pure-math health tool page, built on the bmi engine)
  await mkdir(join(DIST, 'bmi-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'bmi-calculator', 'index.html'),
    fillTool(bmiTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/bmi-calculator/')
  );
  urls.push(`${SITE.url}/bmi-calculator/`);

  // pregnancy due date calculator (pure date-math tool page, built on the due-date engine)
  await mkdir(join(DIST, 'due-date-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'due-date-calculator', 'index.html'),
    fillTool(dueDateTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/due-date-calculator/')
  );
  urls.push(`${SITE.url}/due-date-calculator/`);

  // ovulation & fertile-window calculator (pure date-math tool page, built on the ovulation engine)
  await mkdir(join(DIST, 'ovulation-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'ovulation-calculator', 'index.html'),
    fillTool(ovulationTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/ovulation-calculator/')
  );
  urls.push(`${SITE.url}/ovulation-calculator/`);

  // calorie calculator / TDEE (pure-math health tool page, built on the calories engine)
  await mkdir(join(DIST, 'calorie-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'calorie-calculator', 'index.html'),
    fillTool(calorieTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/calorie-calculator/')
  );
  urls.push(`${SITE.url}/calorie-calculator/`);

  // ideal weight & macro calculator (pure-math health tool page, built on the
  // ideal-weight engine + the shared calories/TDEE engine)
  await mkdir(join(DIST, 'ideal-weight-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'ideal-weight-calculator', 'index.html'),
    fillTool(idealWeightTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/ideal-weight-calculator/')
  );
  urls.push(`${SITE.url}/ideal-weight-calculator/`);

  // GPA calculator (pure-math tool page, built on the gpa engine)
  await mkdir(join(DIST, 'gpa-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'gpa-calculator', 'index.html'),
    fillTool(gpaTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/gpa-calculator/')
  );
  urls.push(`${SITE.url}/gpa-calculator/`);

  // US inflation calculator (CPI-U). Embeds the BLS CPI-U annual-average table
  // into the page (window.__CPI_US__) so results are fully client-side.
  await mkdir(join(DIST, 'inflation-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'inflation-calculator', 'index.html'),
    fillTool(inflationTpl, {
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url,
      CPI_US_JSON: JSON.stringify({ source: cpiUs.source, throughYear: cpiUs.throughYear, data: cpiUs.data })
    }, '/inflation-calculator/')
  );
  urls.push(`${SITE.url}/inflation-calculator/`);

  // salary to hourly calculator (pure-math tool page, built on the wage engine)
  await mkdir(join(DIST, 'salary-to-hourly'), { recursive: true });
  await writeFile(
    join(DIST, 'salary-to-hourly', 'index.html'),
    fillTool(salaryHourlyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/salary-to-hourly/')
  );
  urls.push(`${SITE.url}/salary-to-hourly/`);

  // sales tax calculator (pure-math tool page, built on the sales-tax engine)
  await mkdir(join(DIST, 'sales-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'sales-tax-calculator', 'index.html'),
    fillTool(salesTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/sales-tax-calculator/')
  );
  urls.push(`${SITE.url}/sales-tax-calculator/`);

  // gas / fuel cost calculator (pure-math tool page, built on the fuel-cost engine)
  await mkdir(join(DIST, 'gas-cost-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'gas-cost-calculator', 'index.html'),
    fillTool(gasCostTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/gas-cost-calculator/')
  );
  urls.push(`${SITE.url}/gas-cost-calculator/`);

  // signature maker (draw/type → trimmed transparent PNG, reuses alphaBounds)
  await mkdir(join(DIST, 'signature-maker'), { recursive: true });
  await writeFile(
    join(DIST, 'signature-maker', 'index.html'),
    fillTool(signatureTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/signature-maker/')
  );
  urls.push(`${SITE.url}/signature-maker/`);

  // password generator (strong random passwords, crypto.getRandomValues, on-device)
  await mkdir(join(DIST, 'password-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'password-generator', 'index.html'),
    fillTool(passwordTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/password-generator/')
  );
  urls.push(`${SITE.url}/password-generator/`);

  // word & character counter (live text stats, built on text-stats engine)
  await mkdir(join(DIST, 'word-counter'), { recursive: true });
  await writeFile(
    join(DIST, 'word-counter', 'index.html'),
    fillTool(wordCounterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/word-counter/')
  );
  urls.push(`${SITE.url}/word-counter/`);

  // hours calculator / time card (pure-math tool page, built on the timecard engine)
  await mkdir(join(DIST, 'hours-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'hours-calculator', 'index.html'),
    fillTool(hoursCalcTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/hours-calculator/')
  );
  urls.push(`${SITE.url}/hours-calculator/`);

  // text case converter (UPPER/lower/Title/Sentence/camel/snake/kebab, on-device)
  await mkdir(join(DIST, 'text-case-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'text-case-converter', 'index.html'),
    fillTool(textCaseTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/text-case-converter/')
  );
  urls.push(`${SITE.url}/text-case-converter/`);

  // roman numeral converter (two-way, pure-logic tool page, built on roman.js)
  await mkdir(join(DIST, 'roman-numeral-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'roman-numeral-converter', 'index.html'),
    fillTool(romanTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/roman-numeral-converter/')
  );
  urls.push(`${SITE.url}/roman-numeral-converter/`);

  // number base converter (binary/octal/decimal/hex, pure-logic, built on number-base.js)
  await mkdir(join(DIST, 'base-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'base-converter', 'index.html'),
    fillTool(baseConverterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/base-converter/')
  );
  urls.push(`${SITE.url}/base-converter/`);

  // color converter (HEX/RGB/HSL two-way, pure-logic, built on color.js)
  await mkdir(join(DIST, 'color-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'color-converter', 'index.html'),
    fillTool(colorConverterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/color-converter/')
  );
  urls.push(`${SITE.url}/color-converter/`);

  // JSON formatter / validator / minifier (pure-logic, built on json-format.js)
  await mkdir(join(DIST, 'json-formatter'), { recursive: true });
  await writeFile(
    join(DIST, 'json-formatter', 'index.html'),
    fillTool(jsonFormatterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/json-formatter/')
  );
  urls.push(`${SITE.url}/json-formatter/`);

  // UUID (v4) generator (random GUIDs, crypto.getRandomValues, built on uuid.js)
  await mkdir(join(DIST, 'uuid-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'uuid-generator', 'index.html'),
    fillTool(uuidTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/uuid-generator/')
  );
  urls.push(`${SITE.url}/uuid-generator/`);

  // text diff checker (line-based LCS diff, pure-logic, built on text-diff.js)
  await mkdir(join(DIST, 'diff-checker'), { recursive: true });
  await writeFile(
    join(DIST, 'diff-checker', 'index.html'),
    fillTool(diffCheckerTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/diff-checker/')
  );
  urls.push(`${SITE.url}/diff-checker/`);

  // Base64 encoder / decoder (UTF-8 + URL-safe, pure-logic, built on base64.js)
  await mkdir(join(DIST, 'base64-encode-decode'), { recursive: true });
  await writeFile(
    join(DIST, 'base64-encode-decode', 'index.html'),
    fillTool(base64Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/base64-encode-decode/')
  );
  urls.push(`${SITE.url}/base64-encode-decode/`);

  // aspect ratio calculator (simplify + ratio-locked resize, built on aspect-ratio.js)
  await mkdir(join(DIST, 'aspect-ratio-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'aspect-ratio-calculator', 'index.html'),
    fillTool(aspectRatioTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/aspect-ratio-calculator/')
  );
  urls.push(`${SITE.url}/aspect-ratio-calculator/`);

  // discount calculator (sale price / percent off, pure-math, built on discount.js)
  await mkdir(join(DIST, 'discount-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'discount-calculator', 'index.html'),
    fillTool(discountTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/discount-calculator/')
  );
  urls.push(`${SITE.url}/discount-calculator/`);

  // fuel economy calculator (MPG / L/100km / km/L, pure-math, built on fuel-economy.js)
  await mkdir(join(DIST, 'fuel-economy-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'fuel-economy-calculator', 'index.html'),
    fillTool(fuelEconomyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/fuel-economy-calculator/')
  );
  urls.push(`${SITE.url}/fuel-economy-calculator/`);

  // random number generator (crypto.getRandomValues, on-device, built on random-number.js)
  await mkdir(join(DIST, 'random-number-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'random-number-generator', 'index.html'),
    fillTool(randomNumberTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/random-number-generator/')
  );
  urls.push(`${SITE.url}/random-number-generator/`);

  // paint calculator (how much paint for a room, pure-math, built on paint.js)
  await mkdir(join(DIST, 'paint-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'paint-calculator', 'index.html'),
    fillTool(paintTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/paint-calculator/')
  );
  urls.push(`${SITE.url}/paint-calculator/`);

  // tile calculator (how many tiles/boxes for a floor or wall, pure-math, built on tile.js)
  await mkdir(join(DIST, 'tile-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'tile-calculator', 'index.html'),
    fillTool(tileTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/tile-calculator/')
  );
  urls.push(`${SITE.url}/tile-calculator/`);

  // sleep calculator (bedtime/wake-time from 90-min cycles, pure-math, built on sleep.js)
  await mkdir(join(DIST, 'sleep-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'sleep-calculator', 'index.html'),
    fillTool(sleepTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/sleep-calculator/')
  );
  urls.push(`${SITE.url}/sleep-calculator/`);

  // running / walking pace calculator (pure-math, built on the pace engine)
  await mkdir(join(DIST, 'pace-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'pace-calculator', 'index.html'),
    fillTool(paceTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/pace-calculator/')
  );
  urls.push(`${SITE.url}/pace-calculator/`);

  // fraction calculator (add/subtract/multiply/divide fractions & mixed numbers, built on fraction.js)
  await mkdir(join(DIST, 'fraction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'fraction-calculator', 'index.html'),
    fillTool(fractionTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/fraction-calculator/')
  );
  urls.push(`${SITE.url}/fraction-calculator/`);

  // lorem ipsum generator (placeholder text by words/sentences/paragraphs, built on lorem.js)
  await mkdir(join(DIST, 'lorem-ipsum-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'lorem-ipsum-generator', 'index.html'),
    fillTool(loremTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/lorem-ipsum-generator/')
  );
  urls.push(`${SITE.url}/lorem-ipsum-generator/`);

  // average calculator (mean/median/mode/range/std-dev, pure-logic, built on average.js)
  await mkdir(join(DIST, 'average-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'average-calculator', 'index.html'),
    fillTool(averageTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/average-calculator/')
  );
  urls.push(`${SITE.url}/average-calculator/`);

  // morse code translator (text<->morse, pure-logic, built on morse.js)
  await mkdir(join(DIST, 'morse-code-translator'), { recursive: true });
  await writeFile(
    join(DIST, 'morse-code-translator', 'index.html'),
    fillTool(morseTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/morse-code-translator/')
  );
  urls.push(`${SITE.url}/morse-code-translator/`);

  // public machine-readable copy of the live tax data (for the drift monitor +
  // transparency). Always reflects the deployed figures — single source of truth.
  await mkdir(join(DIST, 'data'), { recursive: true });
  await mkdir(join(DIST, 'data'), { recursive: true });
  await writeFile(join(DIST, 'data', 'tax-data-2026.json'), JSON.stringify(stripInternal(taxData), null, 2) + '\n');

  // 404 (Cloudflare Pages serves /404.html on miss)
  await writeFile(
    join(DIST, '404.html'),
    fill(pageTpl, {
      ...siteMap,
      PAGE_TITLE: 'Page not found',
      PAGE_DESC: 'The page you were looking for could not be found.',
      PAGE_SLUG: '404',
      ROBOTS: 'noindex, follow',
      PAGE_BODY: '<p>Sorry — that page does not exist. Try a <a href="/#paycheck">paycheck calculator</a> or head <a href="/">home</a>.</p>'
    })
  );

  // favicon (inline SVG — no binary asset needed)
  await writeFile(
    join(DIST, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0f1419"/><text x="32" y="44" font-family="Arial,sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="#2ea043">$</text></svg>\n`
  );

  // ads.txt — only meaningful once a publisher ID is set; written either way
  if (SITE.adsensePublisherId) {
    await writeFile(
      join(DIST, 'ads.txt'),
      `google.com, ${SITE.adsensePublisherId}, DIRECT, f08c47fec0942fa0\n`
    );
  }

  // _headers (Cloudflare Pages) — security + long cache on hashed-ish assets
  await writeFile(
    join(DIST, '_headers'),
    `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n\n/assets/*\n  Cache-Control: public, max-age=86400\n`
  );

  // robots + sitemap
  await writeFile(
    join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`
  );
  await writeFile(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
      `\n</urlset>\n`
  );

  console.log(`Built ${builtSlugs.size} state page(s) + home + ${STATIC_PAGES.length} content pages → dist/`);
  console.log(`States: ${[...builtSlugs].join(', ')}`);
  if (!SITE.adsensePublisherId) console.log('Note: ads.txt skipped (set SITE.adsensePublisherId after AdSense approval).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
