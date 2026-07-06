#!/usr/bin/env node
// build.js — pSEO static generator. Reads templates + tax data, emits ./dist.
// Cloudflare Pages: build command `npm run build`, output dir `dist`.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
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
  adsensePublisherId: 'pub-4961606095434424', // ca-pub form is derived; drives the <head> loader + ads.txt
  // IndexNow key — PUBLIC by design (hosted openly at /<key>.txt). Lets us push URL
  // updates straight into Bing + Yandex indexes. Used by scripts/indexnow-submit.py.
  indexNowKey: '9372e11bcbe34b0e993865299aae29dc'
};

// Cloudflare Turnstile site key for the PDF->Word server-fallback widget. The site
// key is PUBLIC, so it's safe to hardcode — and defaulting to the real one means a
// build that forgets the env var still works (a forgotten env var was baking in the
// "always passes" TEST key and breaking server-side verification). Override with the
// test key for local dev only:  TURNSTILE_SITEKEY=1x00000000000000000000AA npm run build
const TURNSTILE_SITEKEY = process.env.TURNSTILE_SITEKEY || '0x4AAAAAADn6GHCyPxsW8L3g';

// AdSense site-verification / auto-ads loader, injected into every page's <head>.
// Empty string when no publisher ID is set, so the build stays clean pre-AdSense.
const ADSENSE_HEAD = SITE.adsensePublisherId
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${SITE.adsensePublisherId}" crossorigin="anonymous"></script>\n`
  : '';

// Build date (YYYY-MM-DD) — used for the sitemap's per-URL lastmod default.
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// Content date — the last real site-content change, hand-bumped on deploys that
// actually change page content. Used as the dateModified freshness signal in the
// site-wide entity schema so AI/Google do NOT see every page "modified today" on
// every rebuild (the always-today anti-pattern). Bump only when content changes.
const CONTENT_DATE = '2026-06-28';

// Per-URL sitemap lastmod: use each page's REAL last-change date from git
// (`git log -1 --format=%cs`) instead of stamping every URL with today's build
// date — Google distrusts uniformly-fresh sitemaps (the always-today anti-pattern).
// Resolves a URL to its source file (home/tool template, or the state payroll data
// for the generated paycheck pages); a brand-new tool's freshly-committed template
// naturally returns its commit date. Non-template/static URLs fall back to
// CONTENT_DATE (the hand-bumped real content date) — never today-for-all.
function gitDate(relFile) {
  try {
    const d = execSync(`git log -1 --format=%cs -- "${relFile}"`, { cwd: __dirname })
      .toString()
      .trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  } catch {
    return '';
  }
}
function sitemapLastmod(u) {
  const seg = u.replace(SITE.url, '').replace(/^\/+|\/+$/g, '');
  if (!seg) return gitDate('src/templates/home.html') || CONTENT_DATE;
  if (/-paycheck-calculator$/.test(seg))
    return gitDate('src/data/state-payroll-2026.json') || CONTENT_DATE;
  const tpl = `src/templates/${seg}.html`;
  if (existsSync(join(__dirname, tpl))) return gitDate(tpl) || CONTENT_DATE;
  return CONTENT_DATE;
}

// One-line description of the publisher entity, reused in the Organization node.
const ORG_DESCRIPTION =
  'Free, fast, privacy-friendly online calculators and converters that run entirely in your browser — nothing is uploaded.';

// --- Canonical tool list (single source of truth) ----------------------------
// Drives the "Related tools" cross-link block injected on every tool page.
// `cat` mirrors the homepage grid sections (image / calc / money / make /
// devtext) and is what relatedToolsBlock() uses to pick genuinely related
// tools — money relates to money, text to text, etc.
const TOOLS = [
  { name: 'Image Resizer', path: '/resize-image/', cat: 'image' },
  { name: 'Image Format Converter', path: '/convert-image/', cat: 'image' },
  { name: 'Compress Image', path: '/compress-image/', cat: 'image' },
  { name: 'Crop Image Into Circle', path: '/crop-image-into-circle/', cat: 'image' },
  { name: 'Passport & ID Photo', path: '/passport-photo-maker/', cat: 'image' },
  { name: 'Images to PDF', path: '/images-to-pdf/', cat: 'image' },
  { name: 'PDF to Word', path: '/pdf-to-word/', cat: 'image' },
  { name: 'Signature Maker', path: '/signature-maker/', cat: 'make' },
  { name: 'Percentage Calculator', path: '/percentage-calculator/', cat: 'calc' },
  { name: 'Tip & Bill Split', path: '/tip-calculator/', cat: 'calc' },
  { name: 'Discount Calculator', path: '/discount-calculator/', cat: 'calc' },
  { name: 'Paint Calculator', path: '/paint-calculator/', cat: 'calc' },
  { name: 'Tile Calculator', path: '/tile-calculator/', cat: 'calc' },
  { name: 'Sleep Calculator', path: '/sleep-calculator/', cat: 'calc' },
  { name: 'Cooking Converter', path: '/cooking-converter/', cat: 'calc' },
  { name: 'Recipe Scaler', path: '/recipe-scaler/', cat: 'calc' },
  { name: 'Unit Converter', path: '/unit-converter/', cat: 'calc' },
  { name: 'BMI Calculator', path: '/bmi-calculator/', cat: 'calc' },
  { name: 'Calorie Calculator', path: '/calorie-calculator/', cat: 'calc' },
  { name: 'Ideal Weight & Macro Calculator', path: '/ideal-weight-calculator/', cat: 'calc' },
  { name: 'Running Pace Calculator', path: '/pace-calculator/', cat: 'calc' },
  { name: 'Pregnancy Due Date Calculator', path: '/due-date-calculator/', cat: 'calc' },
  { name: 'Ovulation Calculator', path: '/ovulation-calculator/', cat: 'calc' },
  { name: 'GPA Calculator', path: '/gpa-calculator/', cat: 'calc' },
  { name: 'Age Calculator', path: '/age-calculator/', cat: 'calc' },
  { name: 'Days Between Dates', path: '/days-between-dates/', cat: 'calc' },
  { name: 'Date Calculator (Add or Subtract)', path: '/date-calculator/', cat: 'calc' },
  { name: 'Time Zone Converter', path: '/time-zone-converter/', cat: 'calc' },
  { name: 'Holiday Countdown', path: '/holiday-countdown/', cat: 'calc' },
  { name: 'Countdown Timer', path: '/countdown-timer/', cat: 'calc' },
  { name: 'Stopwatch', path: '/stopwatch/', cat: 'calc' },
  { name: 'Pomodoro Timer', path: '/pomodoro-timer/', cat: 'calc' },
  { name: 'Mortgage Calculator', path: '/mortgage-calculator/', cat: 'money' },
  { name: 'Biweekly Mortgage Calculator', path: '/biweekly-mortgage-calculator/', cat: 'money' },
  { name: 'Auto Loan Calculator', path: '/auto-loan-calculator/', cat: 'money' },
  { name: 'Debt Payoff Calculator', path: '/debt-payoff-calculator/', cat: 'money' },
  { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/', cat: 'money' },
  { name: 'CAGR Calculator', path: '/cagr-calculator/', cat: 'money' },
  { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/', cat: 'money' },
  { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/', cat: 'money' },
  { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/', cat: 'money' },
  { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/', cat: 'money' },
  { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/', cat: 'money' },
  { name: '401(k) Retirement Calculator', path: '/401k-calculator/', cat: 'money' },
  { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/', cat: 'money' },
  { name: 'Inflation Calculator', path: '/inflation-calculator/', cat: 'money' },
  { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/', cat: 'money' },
  { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/', cat: 'money' },
  { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/', cat: 'money' },
  { name: 'Gas Cost Calculator', path: '/gas-cost-calculator/', cat: 'money' },
  { name: 'Fuel Economy Calculator (MPG, L/100km)', path: '/fuel-economy-calculator/', cat: 'money' },
  { name: 'QR Code Generator', path: '/qr-code-generator/', cat: 'make' },
  { name: 'Password Generator', path: '/password-generator/', cat: 'make' },
  { name: 'Invoice Generator', path: '/invoice-generator/', cat: 'make' },
  { name: 'Word & Character Counter', path: '/word-counter/', cat: 'make' },
  { name: 'Lorem Ipsum Generator', path: '/lorem-ipsum-generator/', cat: 'devtext' },
  { name: 'Text Case Converter', path: '/text-case-converter/', cat: 'devtext' },
  { name: 'Bionic Reading Converter', path: '/bionic-reading-converter/', cat: 'devtext' },
  { name: 'Roman Numeral Converter', path: '/roman-numeral-converter/', cat: 'calc' },
  { name: 'Binary, Hex & Decimal Converter', path: '/base-converter/', cat: 'devtext' },
  { name: 'Color Converter (HEX, RGB, HSL)', path: '/color-converter/', cat: 'devtext' },
  { name: 'JSON Formatter & Validator', path: '/json-formatter/', cat: 'devtext' },
  { name: 'Markdown to HTML Converter', path: '/markdown-to-html/', cat: 'devtext' },
  { name: 'UUID Generator', path: '/uuid-generator/', cat: 'devtext' },
  { name: 'Random Number Generator', path: '/random-number-generator/', cat: 'calc' },
  { name: 'Text Diff Checker', path: '/diff-checker/', cat: 'devtext' },
  { name: 'Base64 Encode & Decode', path: '/base64-encode-decode/', cat: 'devtext' },
  { name: 'Aspect Ratio Calculator', path: '/aspect-ratio-calculator/', cat: 'calc' },
  { name: 'Fraction Calculator', path: '/fraction-calculator/', cat: 'calc' },
  { name: 'Average Calculator (Mean, Median, Mode)', path: '/average-calculator/', cat: 'calc' },
  { name: 'Morse Code Translator', path: '/morse-code-translator/', cat: 'devtext' },
  { name: 'EZ Grader (Test Score Calculator)', path: '/ez-grader/', cat: 'calc' },
  { name: 'Chronological Age Calculator', path: '/chronological-age-calculator/', cat: 'calc' },
  { name: 'Debt Avalanche Calculator', path: '/debt-avalanche-calculator/', cat: 'money' },
  { name: 'Words to Minutes (Speech Time Calculator)', path: '/words-to-minutes/', cat: 'make' },
  { name: 'Double Time Pay Calculator', path: '/double-time-pay-calculator/', cat: 'money' },
  { name: 'Biweekly vs Semimonthly Paycheck Calculator', path: '/biweekly-vs-semimonthly/', cat: 'money' },
  { name: 'Half Birthday Calculator', path: '/half-birthday-calculator/', cat: 'calc' },
  { name: 'Rule of 72 Calculator', path: '/rule-of-72-calculator/', cat: 'money' }
];

// One-line, plain-language descriptions per tool path, used to generate
// /llms.txt (the llms.txt convention). Keyed by the same path as TOOLS, so
// adding a tool above + a line here keeps llms.txt in sync. Any tool missing a
// line falls back to its name, so the build never breaks on an omission.
const TOOL_DESCRIPTIONS = {
  '/resize-image/': 'Resize images to exact pixel dimensions or a percentage, in your browser.',
  '/convert-image/': 'Convert images between PNG, JPG, and WebP without uploading them.',
  '/compress-image/': 'Shrink image file size while controlling quality, fully client-side.',
  '/crop-image-into-circle/': 'Crop any photo into a circle and export a transparent PNG.',
  '/passport-photo-maker/': 'Create compliant passport and ID photos for many countries from one image.',
  '/images-to-pdf/': 'Combine multiple images into a single PDF in your browser.',
  '/pdf-to-word/': 'Convert a PDF into an editable Word (.docx) document.',
  '/signature-maker/': 'Draw or type a signature and download it as a transparent PNG.',
  '/percentage-calculator/': 'Work out percentages, percentage change, and percentage of a number.',
  '/tip-calculator/': 'Calculate tips and split a bill evenly across any number of people.',
  '/discount-calculator/': 'Find the sale price and amount saved for any percentage discount.',
  '/paint-calculator/': 'Estimate how much paint you need for a room based on wall area and coats.',
  '/tile-calculator/': 'Estimate the number of tiles and boxes needed to cover a floor or wall.',
  '/sleep-calculator/': 'Find the best bedtimes or wake times based on 90-minute sleep cycles.',
  '/cooking-converter/': 'Convert between cups, grams, ounces, and other cooking measurements.',
  '/recipe-scaler/': 'Scale a recipe up or down and recalculate every ingredient amount.',
  '/unit-converter/': 'Convert length, weight, temperature, volume, and more between units.',
  '/bmi-calculator/': 'Calculate your Body Mass Index and see its weight category.',
  '/calorie-calculator/': 'Estimate daily calorie needs from your age, sex, weight, and activity.',
  '/ideal-weight-calculator/': 'Estimate a healthy weight range and macro targets for your height.',
  '/pace-calculator/': 'Calculate running pace, time, or distance for any race or workout.',
  '/due-date-calculator/': 'Estimate a pregnancy due date from the last period or conception date.',
  '/ovulation-calculator/': 'Estimate your fertile window and ovulation date from your cycle.',
  '/gpa-calculator/': 'Calculate weighted or unweighted GPA from your course grades and credits.',
  '/age-calculator/': 'Find an exact age in years, months, and days from a birth date.',
  '/days-between-dates/': 'Count the number of days, weeks, or months between two dates.',
  '/date-calculator/': 'Add or subtract days, weeks, months, or years from any date.',
  '/time-zone-converter/': 'Convert a time across multiple time zones at once.',
  '/holiday-countdown/': 'See a live countdown to upcoming holidays and events.',
  '/countdown-timer/': 'Set a custom countdown timer to any date and time.',
  '/stopwatch/': 'Time anything with a precise stopwatch and unlimited lap splits, in your browser.',
  '/pomodoro-timer/': 'Run 25-minute focus sessions with short and long breaks using the Pomodoro technique.',
  '/mortgage-calculator/': 'Estimate monthly mortgage payments, total interest, and amortization.',
  '/biweekly-mortgage-calculator/': 'Compare biweekly versus monthly mortgage payments and payoff time.',
  '/auto-loan-calculator/': 'Calculate a car loan payment, total interest, and amount financed.',
  '/debt-payoff-calculator/': 'Plan a debt payoff using the snowball or avalanche method.',
  '/compound-interest-calculator/': 'Project savings growth with compound interest and regular contributions.',
  '/cagr-calculator/': 'Calculate the compound annual growth rate between two values.',
  '/half-birthday-calculator/': 'Find your exact half birthday — the date six months from your birthday — plus a countdown.',
  '/rule-of-72-calculator/': 'Estimate how long it takes an investment to double using the Rule of 72.',
  '/words-to-minutes/': 'Convert a word count into speaking time at slow, average, or fast pace.',
  '/double-time-pay-calculator/': 'Calculate double time pay, total earnings, and effective hourly rate.',
  '/biweekly-vs-semimonthly/': 'Compare biweekly versus semimonthly paychecks for the same annual salary.',
  '/ez-grader/': 'Grade tests fast — enter the number of questions to get a percentage and letter grade for every wrong-answer count.',
  '/chronological-age-calculator/': 'Find an exact chronological age in years, months, and days between any two dates.',
  '/debt-avalanche-calculator/': 'Plan a debt avalanche payoff that targets the highest-interest balance first to minimize total interest.',
  '/1099-vs-w2-calculator/': 'Compare 1099 contractor versus W-2 employee take-home pay.',
  '/overtime-tax-calculator/': 'See how much of your overtime is deductible under the 2025 "no tax on overtime" law and what it saves you.',
  '/tips-tax-calculator/': 'See how much of your tips are deductible under the 2025 "no tax on tips" law (up to $25,000) and what it saves you.',
  '/senior-deduction-calculator/': 'Calculate the 2025 law\'s $6,000 senior bonus deduction for people 65+ — the "no tax on Social Security" break — and what it saves you.',
  '/salt-cap-calculator/': 'See your allowed SALT deduction under the 2025 law\'s $40,000 cap — with the high-income phase-down, the itemize-vs-standard check, and your saving vs the old $10,000 cap.',
  '/401k-calculator/': 'Project 401(k) retirement balance from contributions, match, and growth.',
  '/savings-goal-calculator/': 'Find how much to save each month to reach a savings goal.',
  '/inflation-calculator/': 'See how the buying power of a US dollar changes over time.',
  '/hours-calculator/': 'Add up worked hours from a time card, including breaks and overtime.',
  '/salary-to-hourly/': 'Convert an annual salary to an hourly, weekly, or monthly rate.',
  '/sales-tax-calculator/': 'Add or remove sales tax and find the pre-tax or after-tax price.',
  '/gas-cost-calculator/': 'Estimate the fuel cost of a trip from distance, MPG, and gas price.',
  '/fuel-economy-calculator/': 'Calculate fuel economy in MPG or L/100km and compare vehicles.',
  '/qr-code-generator/': 'Create QR codes for links, WiFi, or contacts and download as PNG or SVG.',
  '/password-generator/': 'Generate strong, random passwords with custom length and character sets.',
  '/invoice-generator/': 'Create and download a professional PDF invoice in your browser.',
  '/word-counter/': 'Count words, characters, sentences, and reading time in any text.',
  '/lorem-ipsum-generator/': 'Generate placeholder Lorem Ipsum text by words, sentences, or paragraphs.',
  '/text-case-converter/': 'Convert text between upper, lower, title, sentence, and other cases.',
  '/bionic-reading-converter/': 'Bold the leading letters of each word to help you read and skim faster (bionic-style).',
  '/roman-numeral-converter/': 'Convert numbers to Roman numerals and back.',
  '/base-converter/': 'Convert numbers between binary, hexadecimal, decimal, and octal.',
  '/color-converter/': 'Convert colors between HEX, RGB, and HSL formats.',
  '/json-formatter/': 'Format, validate, and minify JSON in your browser.',
  '/markdown-to-html/': 'Convert Markdown to clean HTML with a live preview.',
  '/uuid-generator/': 'Generate random UUIDs (v4) one at a time or in bulk.',
  '/random-number-generator/': 'Generate random numbers within a range, with or without repeats.',
  '/diff-checker/': 'Compare two blocks of text and highlight the differences.',
  '/base64-encode-decode/': 'Encode text to Base64 or decode Base64 back to text.',
  '/aspect-ratio-calculator/': 'Solve for a missing width or height that keeps an aspect ratio.',
  '/fraction-calculator/': 'Add, subtract, multiply, and divide fractions with simplified results.',
  '/average-calculator/': 'Calculate the mean, median, and mode of a set of numbers.',
  '/morse-code-translator/': 'Translate text to Morse code and Morse code back to text.'
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Hand-picked related links for pages that aren't in TOOLS (data studies, the
// embed gallery). Keyed by currentPath.
const RELATED_OVERRIDES = {
  '/salt-cap-calculator/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'Mortgage Calculator', path: '/mortgage-calculator/' },
    { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: 'Inflation Calculator', path: '/inflation-calculator/' }
  ],
  '/senior-deduction-calculator/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'Inflation Calculator', path: '/inflation-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Age Calculator', path: '/age-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' }
  ],
  '/data/overtime-tax-by-state/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Double Time Pay Calculator', path: '/double-time-pay-calculator/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' }
  ],
  '/data/tips-tax-by-state/': [
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Tip & Bill Split', path: '/tip-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: 'Biweekly vs Semimonthly Paycheck Calculator', path: '/biweekly-vs-semimonthly/' }
  ],
  '/embed/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
    { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' }
  ]
};

// Same-category fallback when a category is too small to fill the block.
const CAT_FALLBACK = { image: 'make', make: 'devtext', devtext: 'make', calc: 'money', money: 'calc' };

// Shared renderer: a compact "Related tools" section (6-8 genuinely related
// links + one "All tools" link to the homepage directory). Replaces the old
// full ~80-link "More free tools" directory, which now lives ONLY on the
// homepage grid — inner pages no longer carry a sitewide link block.
function relatedLinksHtml(picks) {
  const links = picks
    .map((t) => `      <a href="${t.path}">${esc(t.name)}</a>`)
    .join('\n');
  return (
    `<section class="more-tools" aria-label="Related tools">\n` +
    `  <div class="wrap">\n` +
    `    <h2>Related tools</h2>\n` +
    `    <div class="more-tools-grid">\n${links}\n      <a href="/">All tools &rarr;</a>\n    </div>\n` +
    `  </div>\n` +
    `</section>\n`
  );
}

// Pick 6-8 related tools for a tool page: same homepage category as the current
// tool, deterministically shuffled per page (slugHash) so different pages don't
// all show the identical subset; padded from a sibling category when small.
function relatedToolsBlock(currentPath) {
  if (RELATED_OVERRIDES[currentPath]) return relatedLinksHtml(RELATED_OVERRIDES[currentPath]);
  const cur = TOOLS.find((t) => t.path === currentPath);
  const cat = cur ? cur.cat : 'calc';
  const shuffled = (arr) =>
    arr
      .map((t) => ({ t, k: slugHash(t.path + currentPath) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.t);
  let picks = shuffled(TOOLS.filter((t) => t.cat === cat && t.path !== currentPath)).slice(0, 7);
  if (picks.length < 6) {
    picks = picks.concat(
      shuffled(TOOLS.filter((t) => t.cat === CAT_FALLBACK[cat] && t.path !== currentPath)).slice(0, 7 - picks.length)
    );
  }
  return relatedLinksHtml(picks);
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

// Site-wide entity schema. Injects ONE JSON-LD @graph (Organization + WebSite +
// WebPage + BreadcrumbList) into every full page's <head>. This gives AI-search
// engines (AI Overviews / Perplexity / ChatGPT) a citable publisher *entity* and a
// breadcrumb trail — the gap that let pages rank without anything to cite. It
// COMPLEMENTS, never replaces, the per-tool WebApplication + FAQPage blocks the
// templates already carry (multiple JSON-LD blocks are valid; crawlers merge by @id).
//
// Derives everything from the page's own canonical URL + <title> (same source
// injectSeo already trusts), so no per-page wiring is needed. Idempotent (skips if
// already injected) and a no-op on fragments (no </head>).
//
// Includes a shared-@id author Person (Edmond Daher) on the WebPage node so the
// site-wide entity graph, the per-state pages, and the overtime/tips studies all
// resolve to ONE author entity (E-E-A-T entity merge; crawlers merge by @id).
// Still deliberately NOT included:
//  - sameAs: omitted until real owned profile URLs (X/GitHub/Reddit) are supplied —
//    inventing links would mislead entity resolution.
function injectEntitySchema(html) {
  if (!html.includes('</head>')) return html;
  const orgId = `${SITE.url}/#organization`;
  if (html.includes(`"@id":"${orgId}"`)) return html; // already injected

  const canonMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']\s*\/?>/i);
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const url = canonMatch ? canonMatch[1].trim() : `${SITE.url}/`;
  // Titles are HTML-escaped (e.g. "Paycheck &amp; Payroll"); JSON-LD script text is
  // NOT HTML-parsed, so decode the common entities back to literals before they
  // enter the schema, or a consumer reads "&amp;" verbatim in the name.
  const decodeHtml = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  const rawTitle = decodeHtml(titleMatch ? titleMatch[1].trim() : SITE.name);
  // Clean breadcrumb leaf label: drop any " — tagline" / " | brand" suffix.
  const pageName = rawTitle.split(/\s[—|]\s/)[0].trim();
  const isHome = url === `${SITE.url}/` || url === SITE.url;
  const siteId = `${SITE.url}/#website`;

  const graph = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: SITE.name,
      url: `${SITE.url}/`,
      logo: { '@type': 'ImageObject', url: `${SITE.url}/favicon.svg` },
      description: ORG_DESCRIPTION
    },
    {
      '@type': 'WebSite',
      '@id': siteId,
      url: `${SITE.url}/`,
      name: SITE.name,
      publisher: { '@id': orgId }
    },
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: rawTitle,
      isPartOf: { '@id': siteId },
      author: {
        '@type': 'Person',
        '@id': `${SITE.url}/#edmond-daher`,
        name: 'Edmond Daher',
        url: `${SITE.url}/data/overtime-tax-by-state/#author`,
        jobTitle: 'Software Engineer'
      },
      dateModified: CONTENT_DATE
    }
  ];

  if (!isHome) {
    const crumbId = `${url}#breadcrumb`;
    graph[2].breadcrumb = { '@id': crumbId };
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': crumbId,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.url}/` },
        { '@type': 'ListItem', position: 2, name: pageName, item: url }
      ]
    });
  }

  const block = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>\n`;
  return html.replace('</head>', `${block}</head>`);
}

function fill(tpl, map) {
  let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in map ? map[k] : m));
  // Inject the AdSense loader into every full page (anything with a </head>).
  // Fragment fills (page bodies/descriptions) have no </head>, so they're untouched.
  if (ADSENSE_HEAD && out.includes('</head>')) out = out.replace('</head>', `${ADSENSE_HEAD}</head>`);
  // Normalize/complete per-page SEO social tags (no-op on fragments).
  out = injectSeo(out);
  // Inject the site-wide entity @graph (Organization/WebSite/WebPage/Breadcrumb).
  out = injectEntitySchema(out);
  return out;
}

// fill() for tool pages: same as fill(), then injects the centralized
// "Related tools" block just before the site footer. Only tool-page writes
// call this, so the homepage and legal/static pages stay untouched.
// Weakest commodity tool pages: kept live and linked for users, but excluded from
// Google's index + the sitemap so quality reviews sample a smaller, stronger site.
// Criteria (2026-07-05): me-too utility, thin prose, and ZERO recorded search traction
// in marketing-insights.md. Anything with impressions/clicks, the finance/tax cluster,
// and the alternativeto trio (diff/qr/color) must never be added here.
const NOINDEX_TOOLS = new Set([
  '/morse-code-translator/',
  '/json-formatter/',
  '/base-converter/',
  '/stopwatch/',
  '/uuid-generator/',
  '/pomodoro-timer/',
  '/sleep-calculator/',
  '/random-number-generator/',
  '/lorem-ipsum-generator/',
  '/text-case-converter/',
  '/base64-encode-decode/',
  '/time-zone-converter/',
]);

function fillTool(tpl, map, currentPath) {
  let out = fill(tpl, map);
  out = out.replace('<footer class="site">', `${relatedToolsBlock(currentPath)}\n<footer class="site">`);
  if (NOINDEX_TOOLS.has(currentPath)) {
    out = out.replace('</head>', '  <meta name="robots" content="noindex, follow">\n</head>');
  }
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

// Near-page-1 target states (06-28): the 5 with at least one query inside SERP
// pos 30. Scoped on-page lifts (extractable tax-rate sentence, H1 vocab, a neutral
// free-alternative line) land ONLY here — the rest of the catalog sits at pos 40+
// where on-page tweaks yield nothing (the page-1-or-zero cliff).
const TARGET_STATES = new Set(['pennsylvania', 'california', 'colorado', 'massachusetts', 'new-mexico']);

// One extractable sentence stating the state's 2026 income-tax rate, derived from
// the already-sourced tax data (never hardcoded). Serves the informational
// "{state} income tax rate" query (PA ranks ~pos 9 for it) and the AI-answer format.
function stateRateSentence(state, year) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t) return '';
  if (t.type === 'flat') return `${state.name}'s ${year} state income tax is a flat ${pctStr(t.rate)}.`;
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return '';
  return `${state.name}'s ${year} state income tax is graduated, ranging from ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)}.`;
}

// Compact "answer figure" for a state's income tax — the state's flat rate or its
// low→top graduated range, derived from the same sourced data (never hardcoded).
// Feeds the query-led <title>/meta for the NEAR_PAGE_1 target states only.
function stateRateFigure(state) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t) return null;
  if (t.type === 'flat') return { title: `Flat ${pctStr(t.rate)}`, desc: `a flat ${pctStr(t.rate)}` };
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return null;
  const lo = pctStr(b[0].rate), hi = pctStr(b[b.length - 1].rate);
  return { title: `${lo}–${hi}`, desc: `graduated from ${lo} to ${hi}` };
}

// <title> per state. For NEAR_PAGE_1 target states, lead with the exact
// "{State} income tax rate {year}" query and surface the rate figure up front;
// every other state keeps the original paycheck-calculator title verbatim.
function stateTitle(state, year) {
  if (TARGET_STATES.has(state.slug)) {
    const fig = stateRateFigure(state);
    if (fig) return `${state.name} Income Tax Rate ${year}: ${fig.title} — Paycheck &amp; Take-Home Pay Calculator (${state.abbr})`;
  }
  return `${state.name} Paycheck &amp; Payroll Calculator ${year} (${state.abbr}) — Take-Home Pay After Taxes`;
}

// Meta description per state. Target states lead with the query + the rate answer
// in the first ~150 chars; all others keep the original description verbatim.
function stateMetaDesc(state, year) {
  if (TARGET_STATES.has(state.slug)) {
    const fig = stateRateFigure(state);
    if (fig) return `${state.name} income tax rate ${year}: ${fig.desc}. Free ${state.name} paycheck and take-home pay calculator — enter your salary or hourly wage to see your ${year} take-home after federal tax, FICA and ${state.name} state income tax.`;
  }
  const taxPhrase = state.hasIncomeTax ? `, and ${state.name} state income tax` : '';
  const metaTaxNote = state.hasIncomeTax
    ? ` — also works as a ${state.name} income tax calculator`
    : `. ${state.name} has no state income tax, so it doubles as a federal income tax calculator`;
  return `Free ${year} ${state.name} (${state.abbr}) paycheck and payroll calculator. Enter your salary or hourly wage to see your take-home pay after federal tax, Social Security, Medicare${taxPhrase}${metaTaxNote}. Supports weekly, biweekly, monthly and more.`;
}

// Spell small counts out as words ("nine-bracket ladder") — headings and ledes
// keyed on structural facts must differ in LETTERS, not just digits, so pages
// with different structures stop sharing a template skeleton.
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numWord = (n) => NUM_WORDS[n] || String(n);

// Data-keyed lede: the opening sentence embeds the state's actual tax structure
// (flat rate / bracket count + range / no tax) instead of a shared template
// sentence, so the 51 ledes differ because the FACTS differ.
function stateLede(state, year) {
  const kw = state.hasIncomeTax
    ? 'paycheck, payroll and income tax calculator'
    : 'paycheck and payroll calculator';
  const open = `Use this free ${state.name} (${state.abbr}) ${kw} to estimate your ${year} take-home pay`;
  const t = state.tax;
  if (!state.hasIncomeTax || !t) {
    const angle = NOTAX_ANGLE[state.slug];
    return `${open} — ${state.name} runs on ${angle || 'other taxes'}, not a wage tax, so just federal tax and FICA come out.`;
  }
  if (t.type === 'flat') {
    return `${open} after federal income tax, Social Security, Medicare, and ${state.name}'s flat ${pctStr(t.rate)} state income tax.`;
  }
  const b = (t.brackets && t.brackets.single) || [];
  const range = b.length ? ` (${numWord(b.length)} brackets, ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)})` : '';
  return `${open} after federal income tax, Social Security, Medicare, and ${state.name}'s graduated state income tax${range}.`;
}

// Data-keyed H2 for the main explainer section: the heading itself states the
// structure of the state's tax (flat rate, bracket-ladder count, or none), so
// no two structurally-different states share it.
function stateBodyH2(state, year) {
  const t = state.tax;
  if (!state.hasIncomeTax || !t) {
    return `No state income tax in ${state.name} — so what still shrinks your ${year} paycheck?`;
  }
  if (t.type === 'flat') {
    return `How ${state.name}'s flat ${pctStr(t.rate)} income tax hits your ${year} paycheck`;
  }
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return `How ${state.name} paychecks are taxed in ${year}`;
  return `${state.name}'s ${numWord(b.length)}-bracket ladder (${pctStr(b[0].rate)}–${pctStr(b[b.length - 1].rate)}): what comes out of each ${year} check`;
}

// Scoped vocab + one neutral positioning line for the target states only. Carries
// the "salary after taxes" / "income tax calculator" query vocab and a single
// neutral free-alternative sentence (competitor-brand queries surfaced for these).
function targetIntro(state, year) {
  if (!TARGET_STATES.has(state.slug)) return '';
  return `<p class="note">Free ${state.name} salary-after-taxes and income tax calculator — a no-signup, in-browser alternative to paid tools like SmartAsset and ADP. Estimate your ${year} take-home pay for any salary, hourly rate, or pay frequency.</p>`;
}

// Extractable, plain-language direct-answer block for each state paycheck page.
// Uses the real computed take-home for a representative $75,000 single-filer
// salary, and omits the state-tax clause for no-income-tax states (mirrors the
// existing hasIncomeTax handling). Highest-priority AI-SEO block: it answers the
// page's core question in one sentence near the top.
function stateAnswerBlock(state, year, taxData) {
  let net = null;
  try {
    net = computePaycheck(
      { wage: { type: 'salary', amount: 75000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: state.slug },
      taxData
    ).annual.net;
  } catch (_) { return ''; }
  if (!Number.isFinite(net)) return '';
  const stateClause = state.hasIncomeTax ? `, and ${state.name} state income tax` : '';
  const lead = pickFrame(state.slug, 'answer', [
    `In ${state.name} for ${year}, a $75,000 salary takes home about ${usd0(net)} per year after federal income tax and FICA (Social Security and Medicare)${stateClause}.`,
    `A $75,000 salary in ${state.name} nets roughly ${usd0(net)} a year in ${year}, once federal income tax, Social Security and Medicare${state.hasIncomeTax ? ` and ${state.name} state tax` : ''} are withheld.`,
    `Earning $75,000 in ${state.name}? Your estimated ${year} take-home is about ${usd0(net)} after federal tax and FICA${stateClause}.`
  ]);
  const tail = pickFrame(state.slug, 'answertail', [
    `Enter your own pay below to estimate your ${state.name} take-home pay for any salary or hourly wage.`,
    `Use the calculator below for your own salary or hourly rate.`,
    `Adjust the inputs below to see the breakdown for your own ${state.name} paycheck.`
  ]);
  const rateSentence = TARGET_STATES.has(state.slug) ? stateRateSentence(state, year) : '';
  if (rateSentence) {
    // NEAR_PAGE_1 target states: surface the exact search query as an <h2>
    // directly above the extractable rate sentence.
    const h2 = `<h2>${state.name} income tax rate ${year}</h2>`;
    return `${h2}<p class="note"><strong>${rateSentence} ${lead}</strong> ${tail}</p>`;
  }
  return `<p class="note"><strong>${lead}</strong> ${tail}</p>`;
}

// Each no-income-tax state's revenue model in a short phrase — condensed from
// that state's NOTAX_FACTS / sales- & property-tax data below (same sources),
// so ledes and FAQ answers differ in words because the funding models differ.
const NOTAX_ANGLE = {
  alaska: 'oil revenues and the Permanent Fund',
  florida: 'sales tax and tourism revenue',
  nevada: 'gaming, tourism and sales taxes',
  'new-hampshire': 'some of the nation\'s highest property taxes',
  'south-dakota': 'sales and property taxes, with no corporate income tax either',
  tennessee: 'sales taxes',
  texas: 'unusually high property taxes plus sales tax',
  washington: 'sales tax plus a capital-gains excise on high earners',
  wyoming: 'mineral severance taxes and federal mineral royalties'
};

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
    const opener = pickFrame(state.slug, 'notax', [
      `${state.name} is one of the U.S. states with <strong>no state income tax</strong>. Your ${year} paycheck is reduced only by federal income tax withholding and FICA (Social Security and Medicare) — there is no ${state.name} income tax line, so your take-home pay is higher than in an otherwise-identical job in a state that taxes wages.`,
      `Because <strong>${state.name} levies no state income tax</strong>, the only deductions on your ${year} paycheck are federal withholding and FICA — no state line at all, which leaves more in your pocket than the same job in a taxing state.`,
      `${state.name} workers pay <strong>no state income tax</strong> in ${year}. That means your paycheck loses only federal income tax and FICA (Social Security and Medicare), so take-home pay beats an equivalent salary in a wage-taxing state.`
    ]);
    // No federal-mechanics paragraph here: the calculator's bracket-by-bracket
    // panel above covers it interactively (was verbatim across all 9 pages).
    return `<p>${opener}${fact}</p>`;
  }

  const t = state.tax;
  let how;
  if (t.type === 'flat') {
    how = `${state.name} levies a <strong>flat ${pctStr(t.rate)} state income tax</strong> for ${year}`;
    how += t.standardDeduction
      ? `, applied after the state allowance/deduction for your filing status.`
      : ` on your wages, with no state standard deduction.`;
  } else {
    how = pickFrame(state.slug, 'gradhow', [
      `${state.name} taxes income on a graduated state schedule for ${year}, applied after the state deduction for your filing status.`,
      `${state.name} uses graduated ${year} state income-tax brackets, so higher pay is taxed at higher marginal rates after the state deduction.`,
      `Your ${state.name} state income tax for ${year} is figured on a graduated bracket schedule, layered on after the state deduction.`
    ]);
  }

  let body =
    `<p>${how} This calculator applies that on top of federal withholding and ` +
    `Social Security / Medicare to estimate your ${state.name} take-home pay.</p>` +
    stateTaxFacts(state, year, taxData);

  const disclaimers = state.disclaimer || [];
  if (disclaimers.length) {
    body += `<p class="note"><strong>What this estimate doesn't include:</strong> ` +
      disclaimers.join(' ') + `</p>`;
  }
  return body;
}

// ───────────────────────────────────────────────────────────────────────────
// AdSense Path-B differentiation (2026-06-26): genuinely-unique, REAL-sourced
// per-state blocks rendered below the calculator. Data: src/data/state-payroll-2026.json
// (keyed by slug under .states); every value carries a source URL. Helpers return
// '' when data is absent — no fabrication, no empty sections. Sentence frames are
// chosen by a stable per-slug hash so no two pages share a paragraph.
const escHtml = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slugHash(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const pickFrame = (slug, salt, arr) => arr[slugHash(slug + salt) % arr.length];

// Full income-tax bracket ladder (single filers) — paycheck-relevant structure,
// distinct per state. Honors figureYear so prior-year-fallback states (e.g. CA
// 2025) show an honest year label rather than a bare 2026.
function bracketTableBlock(state, year) {
  if (!state.hasIncomeTax || !state.tax) return '';
  const dispYear = state.figureYear || year;
  const t = state.tax;
  if (t.type === 'flat') {
    return `<section class="prose"><h2>One rate on every taxable dollar: ${state.name}'s ${pctStr(t.rate)} flat tax (${dispYear})</h2>` +
      `<p>${state.name} applies a single flat rate to taxable wages for ${dispYear}.</p>` +
      `<table class="data-table"><thead><tr><th>Filing</th><th>Rate</th></tr></thead><tbody>` +
      `<tr><td>All taxable income</td><td>${pctStr(t.rate)}</td></tr></tbody></table></section>`;
  }
  const b = (t.brackets && t.brackets.single) || [];
  if (!b.length) return '';
  const rows = b.map((br, i) => {
    const prev = i === 0 ? 0 : b[i - 1].upTo;
    const open = (br.upTo == null || !Number.isFinite(br.upTo));
    const range = open ? `${usd0(prev)} and above` : `${usd0(prev)} – ${usd0(br.upTo)}`;
    return `<tr><td>${range}</td><td>${pctStr(br.rate)}</td></tr>`;
  }).join('');
  return `<section class="prose"><h2>${state.name}'s ${numWord(b.length)} ${dispYear} brackets, from ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)} (single filers)</h2>` +
    `<p>${state.name}'s graduated single-filer schedule for ${dispYear}, applied after the state deduction:</p>` +
    `<table class="data-table"><thead><tr><th>Taxable income</th><th>Marginal rate</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function payrollDeductionsBlock(state, p) {
  const items = (p && p.payrollContributions) || [];
  if (!items.length) return '';
  const rows = items.map((it) =>
    `<tr><td>${escHtml(it.name)}</td><td>${escHtml(it.employeeRate2026 || '—')}</td><td>${escHtml(it.wageBaseOrCap || '—')}</td></tr>`
  ).join('');
  const intro = pickFrame(state.slug, 'payroll', [
    `Beyond income tax, ${state.name} withholds these state payroll programs directly from employee wages:`,
    `${state.name} runs employee-funded payroll programs that come off your check on top of income tax and FICA:`,
    `On a ${state.name} paycheck, these state programs are deducted in addition to income tax and Social Security / Medicare:`
  ]);
  // Heading names the actual program(s) — e.g. "State Disability Insurance" —
  // so each state's heading carries its own facts.
  const shortName = (n) => String(n).replace(/\s*\(.*$/, '');
  const names = items.slice(0, 2).map((it) => shortName(it.name)).join(' and ');
  return `<section class="prose"><h2>${names}: what else ${state.name} takes from your check</h2>` +
    `<p>${intro}</p>` +
    `<table class="data-table"><thead><tr><th>Program</th><th>Employee rate (2026)</th><th>Wage base / cap</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function localTaxBlock(state, p) {
  const lt = p && p.localIncomeTax;
  if (!lt || !lt.notes) return '';
  // Data-keyed heading: whether any city/county wage tax exists is itself the
  // state's answer. The sourced notes are unique per state either way.
  const h2 = lt.exists
    ? `Local income taxes in ${state.name}`
    : `No city or county income tax anywhere in ${state.name}`;
  return `<section class="prose"><h2>${h2}</h2>` +
    `<p>${escHtml(lt.notes)}</p></section>`;
}

function minWageBlock(state, p, year) {
  const mw = p && p.minWage2026;
  if (!mw || typeof mw.amountUsd !== 'number') return '';
  const annual = usd0(mw.amountUsd * 2080);
  const intro = `<strong>$${mw.amountUsd.toFixed(2)}/hour</strong> (≈${annual}/year full-time).`;
  const note = mw.notes ? ` ${escHtml(mw.notes)}` : '';
  // Data-keyed heading: states at the federal $7.25 floor get a structurally
  // different heading than states with their own higher minimum.
  const h2 = mw.amountUsd > 7.25
    ? `${state.name}'s own $${mw.amountUsd.toFixed(2)} minimum wage — above the federal floor (${year})`
    : `${state.name} stays on the federal $7.25 minimum wage in ${year}`;
  return `<section class="prose"><h2>${h2}</h2><p>${intro}${note}</p></section>`;
}

// Ancillary context (sales + property) — one compact paragraph so the page stays
// paycheck-focused (relevance cap: ancillary stays a minority of net-new prose).
function otherTaxesBlock(state, p) {
  if (!p) return '';
  const st = p.salesTax, pt = p.propertyTax;
  const parts = [];
  if (st && typeof st.stateBaseRatePct === 'number') {
    const combined = (typeof st.combinedAvgRatePct === 'number') ? ` (≈${st.combinedAvgRatePct}% with local)` : '';
    parts.push(`<tr><td>Sales tax</td><td>${st.stateBaseRatePct}%${combined}</td></tr>`);
  }
  if (pt && typeof pt.effectiveRatePct === 'number') {
    parts.push(`<tr><td>Property tax</td><td>≈${pt.effectiveRatePct}%${pt.rankNote ? ` — ${escHtml(pt.rankNote)}` : ''}</td></tr>`);
  }
  if (!parts.length) return '';
  // Data-keyed heading: embed the sales-tax rate and (for no-income-tax states)
  // the fact that these taxes stand in for a wage tax. Table body, not prose —
  // the numbers ARE the content.
  const ratePart = (st && typeof st.stateBaseRatePct === 'number') ? `${st.stateBaseRatePct}% sales tax` : 'sales tax';
  const h2 = state.hasIncomeTax
    ? `Beyond the paycheck: ${state.name}'s ${ratePart} and property tax`
    : `What ${state.name} levies instead: ${ratePart} and property tax`;
  return `<section class="prose"><h2>${h2}</h2>` +
    `<table class="data-table"><tbody>${parts.join('')}</tbody></table></section>`;
}

function incomeContextBlock(state, p, taxData) {
  const mi = p && p.medianHouseholdIncome;
  if (!mi || typeof mi.amountUsd !== 'number') return '';
  let net = null;
  try {
    net = computePaycheck({ wage: { type: 'salary', amount: mi.amountUsd }, filingStatus: 'single', payFrequency: 'annual', stateSlug: state.slug }, taxData).annual.net;
  } catch (_) { /* leave take-home out if compute fails */ }
  // Table body, not prose — the two figures are the whole point.
  const yr = mi.year ? ` (${escHtml(String(mi.year))})` : '';
  const rows = [`<tr><td>Median household income${yr}</td><td>${usd0(mi.amountUsd)}</td></tr>`];
  if (net && Number.isFinite(net)) {
    rows.push(`<tr><td>Take-home (single filer)</td><td>≈${usd0(net)}</td></tr>`);
  }
  return `<section class="prose"><h2>Your paycheck vs the ${usd0(mi.amountUsd)} ${state.name} median</h2>` +
    `<table class="data-table"><tbody>${rows.join('')}</tbody></table></section>`;
}

function distinctiveFactsBlock(state, p, faqEntries) {
  // NOTAX_FACTS already appear in the body opener, and a fact used as the
  // page's unique FAQ answer shouldn't repeat here — no duplicated sentences.
  const usedInFaq = new Set((faqEntries || []).map((e) => e.a));
  const facts = [];
  const df = (p && p.distinctiveFacts) || [];
  for (const f of df) { if (f && f.fact && !usedInFaq.has(String(f.fact))) facts.push(escHtml(f.fact)); }
  if (!facts.length) return '';
  const lis = facts.map((f) => `<li>${f}</li>`).join('');
  // Count word is real data (fact count differs by state).
  const h2 = facts.length === 1
    ? `One ${state.name} payroll quirk worth knowing`
    : `${numWord(facts.length).replace(/^./, (c) => c.toUpperCase())} ${state.name} payroll quirks worth knowing`;
  return `<section class="prose"><h2>${h2}</h2><ul class="facts">${lis}</ul></section>`;
}

// Per-state OBBBA "no tax on tips / overtime" conformity block. Genuinely unique
// per-state content (the state return differs by state and year), so it both
// serves the fresh-query search demand and deepens each page's differentiation.
function obbbaConformityBlock(state, obbba, year) {
  const e = obbba && obbba.states && obbba.states[state.slug];
  if (!e) return '';
  // Boilerplate cut (was repeated near-verbatim on all 51 pages): one linked
  // sentence for the federal rule, one compact sentence for the four links.
  const calcLinks = 'Related: ' + orderAncillary(state.slug, [
    `<a href="/overtime-tax-calculator/">overtime calculator</a>`,
    `<a href="/tips-tax-calculator/">tips calculator</a>`,
    `<a href="/data/overtime-tax-by-state/#state-${state.slug}">overtime by state</a>`,
    `<a href="/data/tips-tax-by-state/#state-${state.slug}">tips by state</a>`
  ]).join(' · ') + '.';
  const fed =
    `<p>Qualified <strong>overtime premium pay</strong> and <strong>tips</strong> are federally deductible for 2025–2028 ` +
    `(<a href="/data/overtime-tax-by-state/">OBBBA caps &amp; rules</a>); FICA still applies.</p>`;
  // Verdict-keyed heading: the query stays, and the state's actual 2026
  // treatment (from the sourced conformity data) is answered in the heading.
  const otV = e.overtime && e.overtime.y2026, tipV = e.tips && e.tips.y2026;
  let verdictTail;
  if (!e.hasWageTax) verdictTail = `Federally yes — no ${state.name} wage tax anyway`;
  else if (otV === 'yes' && tipV === 'yes') verdictTail = `Federally yes — and on the ${state.name} return too`;
  else if (otV === 'no' && tipV === 'no') verdictTail = `Federally yes, but ${state.name} still taxes both`;
  else if (otV === 'partial' && tipV === 'partial') verdictTail = `Federally yes; ${state.name} allows a smaller capped break`;
  else if (otV === 'unclear' && tipV === 'unclear') verdictTail = `Federally yes; ${state.name}'s rules aren't confirmed yet`;
  else verdictTail = `Federally yes; ${state.name}'s state treatment is mixed`;
  const h2 = `Is overtime and tips tax-free in ${state.name}? ${verdictTail}`;

  if (!e.hasWageTax) {
    // The data note for no-wage-tax states restates what the heading already
    // answers (identical sentence across all nine) — link out instead.
    return `<section class="prose"><h2>${h2}</h2>${fed}<p>${calcLinks}</p></section>`;
  }

  const verdict = (v) => ({
    yes: `deductible on your ${state.name} return too`,
    no: `not deductible on your ${state.name} return (still state-taxed)`,
    unclear: `not yet confirmed for ${state.name}`,
    partial: `a smaller capped ${state.name} break`
  }[v] || v);
  const row = (label, d) =>
    `<li><strong>${label}:</strong> 2025 — ${verdict(d.y2025)}; 2026–2028 — ${verdict(d.y2026)}.</li>`;
  const srcHost = (() => { try { return new URL(e.source).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
  const srcLink = e.source && srcHost
    ? ` <span class="muted-small">(source: <a href="${escHtml(e.source)}" rel="nofollow noopener" target="_blank">${escHtml(srcHost)}</a>)</span>`
    : '';

  return `<section class="prose"><h2>${h2}</h2>${fed}` +
    `<p><strong>${state.name} state income tax:</strong> ${escHtml(e.note)}${srcLink}</p>` +
    `<ul class="facts">${row('Overtime', e.overtime)}${row('Tips', e.tips)}</ul>` +
    `<p>${calcLinks}</p></section>`;
}

function sourcesBlock(state, p, meta) {
  const urls = new Set();
  const add = (u) => { if (u && /^https?:\/\//.test(u)) urls.add(u); };
  if (p) {
    add(p.localIncomeTax && p.localIncomeTax.source);
    add(p.salesTax && p.salesTax.source);
    add(p.minWage2026 && p.minWage2026.source);
    add(p.medianHouseholdIncome && p.medianHouseholdIncome.source);
    add(p.propertyTax && p.propertyTax.source);
    (p.payrollContributions || []).forEach((it) => add(it.source));
    (p.distinctiveFacts || []).forEach((f) => add(f.source));
  }
  // Federal primary sources (IRS 2026 brackets / standard deduction, SSA wage base)
  // apply to every paycheck page — cite them alongside the per-state sources.
  if (meta && meta.sources) Object.values(meta.sources).forEach(add);
  if (!urls.size) return '';
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } };
  // One entry per host (the list shows hostnames, so duplicate hosts read as
  // repeated identical entries) — keep the first URL seen for each.
  const byHost = new Map();
  for (const u of urls) { const h = hostOf(u); if (!byHost.has(h)) byHost.set(h, u); }
  const lis = [...byHost.entries()].map(([h, u]) => `<li><a href="${escHtml(u)}" rel="nofollow noopener" target="_blank">${escHtml(h)}</a></li>`).join('');
  return `<section class="sources"><h2>Sources</h2><ul>${lis}</ul></section>`;
}

// One state-UNIQUE FAQ entry, generated from that state's own sourced data.
// The pick is keyed on data SALIENCE, not a hash: a real local wage tax is the
// question a resident actually asks; failing that, the state's own payroll
// programs; failing that, an above-federal minimum wage; else the state's most
// distinctive payroll fact. Each answer carries that state's numbers.
function stateUniqueFaq(state, p, year) {
  const lt = p && p.localIncomeTax;
  if (lt && lt.exists && lt.notes) {
    return {
      q: `Do cities or counties in ${state.name} take a local income tax out of paychecks?`,
      a: String(lt.notes)
    };
  }
  const pc = (p && p.payrollContributions) || [];
  if (pc.length) {
    const list = pc.map((it) => `${it.name} at ${it.employeeRate2026 || 'a state-set rate'}`).join('; ');
    return {
      q: `Besides income tax, what does ${state.name} deduct from paychecks?`,
      a: `On top of federal tax and FICA, ${state.name} withholds ${list}. The full rates and wage caps are in the payroll-deductions table on this page.`
    };
  }
  const mw = p && p.minWage2026;
  if (mw && typeof mw.amountUsd === 'number' && mw.amountUsd > 7.25) {
    return {
      q: `What does a full-time minimum-wage job in ${state.name} pay in ${year}?`,
      a: `${state.name}'s ${year} minimum wage is $${mw.amountUsd.toFixed(2)}/hour — about ${usd0(mw.amountUsd * 2080)} a year at 40 hours a week before taxes. Details and exceptions are in the minimum-wage section above.`
    };
  }
  const df = (p && p.distinctiveFacts) || [];
  if (df.length && df[0].fact) {
    return {
      q: `What is unusual about how ${state.name} handles payroll taxes?`,
      a: String(df[0].fact)
    };
  }
  return null;
}

// FAQ entries shared by the JSON-LD block and the visible FAQ section (Google
// requires FAQ markup to reflect on-page content).
function stateFaqEntries(state, p, year) {
  // Data-keyed answer: states the structure (flat rate / bracket range / the
  // state's actual funding model) rather than a shared yes/no template.
  let a1;
  const t = state.tax;
  if (!state.hasIncomeTax || !t) {
    const angle = NOTAX_ANGLE[state.slug];
    a1 = `No — ${state.name} runs on ${angle || 'other taxes'}, not a wage tax.`;
  } else if (t.type === 'flat') {
    a1 = `Yes — a flat ${pctStr(t.rate)} on taxable wages in ${year}, on top of federal tax and FICA.`;
  } else {
    const b = (t.brackets && t.brackets.single) || [];
    a1 = b.length
      ? `Yes — ${numWord(b.length)} graduated brackets from ${pctStr(b[0].rate)} to ${pctStr(b[b.length - 1].rate)} in ${year}, on top of federal tax and FICA.`
      : `Yes. ${state.name} levies a state income tax in ${year}, applied on top of federal tax and FICA.`;
  }
  const entries = [{ q: `Does ${state.name} have a state income tax in ${year}?`, a: a1 }];
  const unique = stateUniqueFaq(state, p, year);
  if (unique) entries.push(unique);
  // Slug-stable order (JSON-LD and visible section share it via the caller).
  return orderAncillary(state.slug, entries);
}

function faqJsonLd(entries) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: { '@type': 'Answer', text: e.a }
    }))
  });
}

function stateFaqBlock(state, entries) {
  const items = entries
    .map((e) => `<h3>${escHtml(e.q)}</h3><p>${escHtml(e.a)}</p>`)
    .join('');
  return `<section class="prose"><h2>${state.name} paycheck FAQ</h2>${items}</section>`;
}

// Per-page state grid. When currentSlug is given, EXCLUDE that state and order
// the rest by a stable per-page shuffle (seeded by currentSlug) so the anchor
// block is no longer byte-identical across the 51 pages. currentSlug null (home)
// keeps the full roster in natural order.
// Geographic neighbors per state (first 3 are used on that state's page).
// AK/HI have no land borders — nearest/most-relevant states are listed instead.
const STATE_NEIGHBORS = {
  alabama: ['georgia', 'tennessee', 'mississippi', 'florida'],
  alaska: ['washington', 'oregon', 'hawaii'],
  arizona: ['california', 'nevada', 'new-mexico', 'utah'],
  arkansas: ['texas', 'tennessee', 'missouri', 'oklahoma'],
  california: ['nevada', 'oregon', 'arizona'],
  colorado: ['utah', 'kansas', 'wyoming', 'new-mexico'],
  connecticut: ['new-york', 'massachusetts', 'rhode-island'],
  delaware: ['maryland', 'pennsylvania', 'new-jersey'],
  'district-of-columbia': ['maryland', 'virginia', 'pennsylvania'],
  florida: ['georgia', 'alabama', 'south-carolina'],
  georgia: ['florida', 'south-carolina', 'tennessee', 'alabama'],
  hawaii: ['california', 'washington', 'alaska'],
  idaho: ['washington', 'utah', 'montana', 'oregon'],
  illinois: ['indiana', 'wisconsin', 'missouri', 'iowa'],
  indiana: ['illinois', 'ohio', 'michigan', 'kentucky'],
  iowa: ['illinois', 'minnesota', 'nebraska', 'missouri'],
  kansas: ['missouri', 'oklahoma', 'colorado', 'nebraska'],
  kentucky: ['tennessee', 'ohio', 'indiana', 'west-virginia'],
  louisiana: ['texas', 'mississippi', 'arkansas'],
  maine: ['new-hampshire', 'massachusetts', 'vermont'],
  maryland: ['virginia', 'district-of-columbia', 'pennsylvania', 'delaware'],
  massachusetts: ['new-hampshire', 'connecticut', 'rhode-island', 'new-york'],
  michigan: ['ohio', 'indiana', 'wisconsin', 'illinois'],
  minnesota: ['wisconsin', 'iowa', 'north-dakota', 'south-dakota'],
  mississippi: ['louisiana', 'alabama', 'tennessee', 'arkansas'],
  missouri: ['kansas', 'illinois', 'arkansas', 'tennessee'],
  montana: ['idaho', 'wyoming', 'north-dakota', 'south-dakota'],
  nebraska: ['iowa', 'kansas', 'colorado', 'south-dakota'],
  nevada: ['california', 'arizona', 'utah', 'oregon'],
  'new-hampshire': ['massachusetts', 'maine', 'vermont'],
  'new-jersey': ['new-york', 'pennsylvania', 'delaware'],
  'new-mexico': ['texas', 'arizona', 'colorado', 'oklahoma'],
  'new-york': ['new-jersey', 'pennsylvania', 'connecticut', 'massachusetts'],
  'north-carolina': ['south-carolina', 'virginia', 'tennessee', 'georgia'],
  'north-dakota': ['minnesota', 'south-dakota', 'montana'],
  ohio: ['pennsylvania', 'michigan', 'indiana', 'kentucky'],
  oklahoma: ['texas', 'kansas', 'arkansas', 'new-mexico'],
  oregon: ['washington', 'california', 'idaho', 'nevada'],
  pennsylvania: ['new-york', 'new-jersey', 'ohio', 'maryland'],
  'rhode-island': ['massachusetts', 'connecticut', 'new-york'],
  'south-carolina': ['north-carolina', 'georgia', 'tennessee'],
  'south-dakota': ['north-dakota', 'nebraska', 'minnesota', 'iowa'],
  tennessee: ['georgia', 'kentucky', 'north-carolina', 'alabama'],
  texas: ['oklahoma', 'louisiana', 'new-mexico', 'arkansas'],
  utah: ['colorado', 'nevada', 'arizona', 'idaho'],
  vermont: ['new-hampshire', 'new-york', 'massachusetts'],
  virginia: ['maryland', 'north-carolina', 'district-of-columbia', 'west-virginia'],
  washington: ['oregon', 'idaho', 'california'],
  'west-virginia': ['virginia', 'ohio', 'pennsylvania', 'kentucky'],
  wisconsin: ['minnesota', 'illinois', 'michigan', 'iowa'],
  wyoming: ['colorado', 'montana', 'utah', 'idaho', 'south-dakota', 'nebraska']
};

// The (up to 3) neighbor states linked on a state page — shared by the link
// grid and the section heading, so the heading can name the actual neighbors.
function neighborStates(roster, builtSlugs, currentSlug) {
  const bySlug = new Map(roster.map((s) => [s.slug, s]));
  return (STATE_NEIGHBORS[currentSlug] || [])
    .map((slug) => bySlug.get(slug))
    .filter((s) => s && s.slug !== currentSlug && builtSlugs.has(s.slug))
    .slice(0, 3);
}

// Data-keyed heading for the neighbor-links section: names the actual states.
function neighborHeading(roster, builtSlugs, currentSlug) {
  const names = neighborStates(roster, builtSlugs, currentSlug).map((s) => s.name);
  if (!names.length) return 'More state paycheck calculators';
  const last = names.pop();
  return names.length
    ? `Compare a paycheck next door: ${names.join(', ')} &amp; ${last}`
    : `Compare a paycheck next door in ${last}`;
}

// Slug-stable ordering for the ancillary sections (min wage, distinctive facts,
// other taxes, income context): the order differs page to page but is
// deterministic per slug, so rebuilds are byte-stable. The core sequence
// (answer block → calculator → explainer → brackets → payroll) never moves.
function orderAncillary(slug, blocks) {
  // NOTE: the varying index goes FIRST in the hashed string — FNV-1a only
  // diffuses a character through the multiplications that FOLLOW it, so a
  // trailing index yields near-identical keys and the same order everywhere.
  return blocks
    .map((v, i) => ({ v, k: slugHash(`anc${i}#${slug}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

// Neighbor take-home comparison: real numbers from the same engine + data, so
// every page's table differs because the neighboring tax systems differ. The
// structure column is in WORDS (flat / bracket-count / none), keeping the 51
// pages genuinely distinct, not digit-swapped.
function neighborCompareTable(roster, builtSlugs, currentSlug, taxData, year) {
  const structPhrase = (st) => {
    if (!st.hasIncomeTax || !st.tax) return 'no state income tax';
    if (st.tax.type === 'flat') return `flat ${pctStr(st.tax.rate)}`;
    const b = (st.tax.brackets && st.tax.brackets.single) || [];
    return b.length ? `${numWord(b.length)} brackets, ${pctStr(b[0].rate)}–${pctStr(b[b.length - 1].rate)}` : 'graduated';
  };
  const net75 = (slug) => {
    try {
      const n = computePaycheck({ wage: { type: 'salary', amount: 75000 }, filingStatus: 'single', payFrequency: 'annual', stateSlug: slug }, taxData).annual.net;
      return Number.isFinite(n) ? usd0(n) : null;
    } catch (_) { return null; }
  };
  const cur = taxData.states[currentSlug];
  const rows = [];
  const pushRow = (st, slug, link) => {
    const net = net75(slug);
    if (!net) return;
    const name = link ? `<a href="/${slug}-paycheck-calculator/">${esc(st.name)}</a>` : esc(st.name);
    rows.push(`<tr><td>${name}</td><td>${structPhrase(st)}</td><td>${net}</td></tr>`);
  };
  if (cur) pushRow(cur, currentSlug, false);
  const bySlug = new Map(roster.map((s) => [s.slug, s]));
  for (const nslug of (STATE_NEIGHBORS[currentSlug] || [])) {
    const n = bySlug.get(nslug);
    if (!n || !builtSlugs.has(nslug)) continue;
    const st = taxData.states[nslug];
    if (st) pushRow(st, nslug, true);
  }
  if (rows.length < 2) return '';
  return `<table class="data-table"><thead><tr><th>State</th><th>State income tax (${year})</th><th>Take-home on $75,000 (single)</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table>`;
}

function stateLinks(roster, builtSlugs, currentSlug) {
  let items = roster.filter((s) => s.slug !== currentSlug);
  if (currentSlug) {
    // On a state page, link only 3 genuinely neighboring states (the full
    // 51-state directory lives on the homepage only — see relatedToolsBlock's
    // rationale: no sitewide link blocks on inner pages).
    items = neighborStates(roster, builtSlugs, currentSlug);
  }
  return items
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
  const payrollData = await readJSON(join(SRC, 'data', 'state-payroll-2026.json'));
  const payroll = (payrollData && payrollData.states) || {};
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
  const stopwatchTpl = await read(join(SRC, 'templates', 'stopwatch.html'));
  const pomodoroTpl = await read(join(SRC, 'templates', 'pomodoro-timer.html'));
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
  const bionicTpl = await read(join(SRC, 'templates', 'bionic-reading-converter.html'));
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
  const cagrTpl = await read(join(SRC, 'templates', 'cagr-calculator.html'));
  const halfBirthdayTpl = await read(join(SRC, 'templates', 'half-birthday-calculator.html'));
  const ruleOf72Tpl = await read(join(SRC, 'templates', 'rule-of-72-calculator.html'));
  const wordsToMinutesTpl = await read(join(SRC, 'templates', 'words-to-minutes.html'));
  const doubleTimePayTpl = await read(join(SRC, 'templates', 'double-time-pay-calculator.html'));
  const biweeklyVsSemimonthlyTpl = await read(join(SRC, 'templates', 'biweekly-vs-semimonthly.html'));
  const ezGraderTpl = await read(join(SRC, 'templates', 'ez-grader.html'));
  const chronoAgeTpl = await read(join(SRC, 'templates', 'chronological-age-calculator.html'));
  const debtAvalancheTpl = await read(join(SRC, 'templates', 'debt-avalanche-calculator.html'));
  const markdownTpl = await read(join(SRC, 'templates', 'markdown-to-html.html'));
  const w2Tpl = await read(join(SRC, 'templates', '1099-vs-w2-calculator.html'));
  const overtimeTaxTpl = await read(join(SRC, 'templates', 'overtime-tax-calculator.html'));
  const tipsTaxTpl = await read(join(SRC, 'templates', 'tips-tax-calculator.html'));
  const embedOvertimeTpl = await read(join(SRC, 'templates', 'embed', 'overtime-tax-calculator.html'));
  const embedTipsTpl = await read(join(SRC, 'templates', 'embed', 'tips-tax-calculator.html'));
  const seniorTaxTpl = await read(join(SRC, 'templates', 'senior-deduction-calculator.html'));
  const embedSeniorTpl = await read(join(SRC, 'templates', 'embed', 'senior-deduction-calculator.html'));
  const saltCapTpl = await read(join(SRC, 'templates', 'salt-cap-calculator.html'));
  const embedSaltTpl = await read(join(SRC, 'templates', 'embed', 'salt-cap-calculator.html'));
  const embedGalleryTpl = await read(join(SRC, 'templates', 'embed-gallery.html'));
  const overtimeStudyTpl = await read(join(SRC, 'templates', 'data-overtime-tax-by-state.html'));
  const tipsStudyTpl = await read(join(SRC, 'templates', 'data-tips-tax-by-state.html'));
  const obbba = await readJSON(join(SRC, 'data', 'obbba-deductions-2026.json'));
  // Client-injected JSON for the OBBBA tools (internal _keys stripped).
  const OBBBA_FED_JSON = JSON.stringify(stripInternal(obbba.federal));
  const OBBBA_STATES_JSON = JSON.stringify(stripInternal(obbba.states));
  const OBBBA_FED_TAX_JSON = JSON.stringify(stripInternal({ standardDeduction: taxData.federal.standardDeduction, brackets: taxData.federal.brackets }));
  const biweeklyTpl = await read(join(SRC, 'templates', 'biweekly-mortgage-calculator.html'));
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
  const homeLinks = stateLinks(roster, builtSlugs, null);

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
  await cp(join(SRC, 'assets', 'stopwatch.js'), join(DIST, 'assets', 'stopwatch.js'));
  await cp(join(SRC, 'assets', 'pomodoro-timer.js'), join(DIST, 'assets', 'pomodoro-timer.js'));
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
  await cp(join(SRC, 'assets', 'bionic-reading-converter.js'), join(DIST, 'assets', 'bionic-reading-converter.js'));
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
  await cp(join(SRC, 'assets', 'cagr-calculator.js'), join(DIST, 'assets', 'cagr-calculator.js'));
  await cp(join(SRC, 'engine', 'cagr.js'), join(DIST, 'assets', 'cagr.js'));
  await cp(join(SRC, 'assets', 'half-birthday-calculator.js'), join(DIST, 'assets', 'half-birthday-calculator.js'));
  await cp(join(SRC, 'engine', 'half-birthday.js'), join(DIST, 'assets', 'half-birthday.js'));
  await cp(join(SRC, 'assets', 'rule-of-72-calculator.js'), join(DIST, 'assets', 'rule-of-72-calculator.js'));
  await cp(join(SRC, 'engine', 'rule-of-72.js'), join(DIST, 'assets', 'rule-of-72.js'));
  await cp(join(SRC, 'assets', 'words-to-minutes.js'), join(DIST, 'assets', 'words-to-minutes.js'));
  await cp(join(SRC, 'engine', 'words-to-time.js'), join(DIST, 'assets', 'words-to-time.js'));
  await cp(join(SRC, 'assets', 'double-time-pay-calculator.js'), join(DIST, 'assets', 'double-time-pay-calculator.js'));
  await cp(join(SRC, 'engine', 'double-time-pay.js'), join(DIST, 'assets', 'double-time-pay.js'));
  await cp(join(SRC, 'assets', 'biweekly-vs-semimonthly.js'), join(DIST, 'assets', 'biweekly-vs-semimonthly.js'));
  await cp(join(SRC, 'engine', 'pay-frequency.js'), join(DIST, 'assets', 'pay-frequency.js'));
  await cp(join(SRC, 'assets', 'ez-grader.js'), join(DIST, 'assets', 'ez-grader.js'));
  await cp(join(SRC, 'engine', 'grading.js'), join(DIST, 'assets', 'grading.js'));
  await cp(join(SRC, 'assets', 'chronological-age-calculator.js'), join(DIST, 'assets', 'chronological-age-calculator.js'));
  await cp(join(SRC, 'engine', 'chronological-age.js'), join(DIST, 'assets', 'chronological-age.js'));
  await cp(join(SRC, 'assets', 'debt-avalanche-calculator.js'), join(DIST, 'assets', 'debt-avalanche-calculator.js'));
  await cp(join(SRC, 'engine', 'debt-avalanche.js'), join(DIST, 'assets', 'debt-avalanche.js'));
  await cp(join(SRC, 'assets', 'markdown-to-html.js'), join(DIST, 'assets', 'markdown-to-html.js'));
  await cp(join(SRC, 'assets', 'marked.min.js'), join(DIST, 'assets', 'marked.min.js'));
  await cp(join(SRC, 'assets', '1099-vs-w2-calculator.js'), join(DIST, 'assets', '1099-vs-w2-calculator.js'));
  await cp(join(SRC, 'engine', 'obbba-deduction.js'), join(DIST, 'assets', 'obbba-deduction.js'));
  await cp(join(SRC, 'assets', 'overtime-tax-calculator.js'), join(DIST, 'assets', 'overtime-tax-calculator.js'));
  await cp(join(SRC, 'assets', 'tips-tax-calculator.js'), join(DIST, 'assets', 'tips-tax-calculator.js'));
  await cp(join(SRC, 'assets', 'senior-deduction-calculator.js'), join(DIST, 'assets', 'senior-deduction-calculator.js'));
  await cp(join(SRC, 'assets', 'salt-cap-calculator.js'), join(DIST, 'assets', 'salt-cap-calculator.js'));
  await cp(join(SRC, 'assets', 'embed-gallery.js'), join(DIST, 'assets', 'embed-gallery.js'));
  await cp(join(SRC, 'engine', 'employment-tax.js'), join(DIST, 'assets', 'employment-tax.js'));
  await cp(join(SRC, 'assets', 'biweekly-mortgage-calculator.js'), join(DIST, 'assets', 'biweekly-mortgage-calculator.js'));
  // (biweekly reuses amortization.js, already copied above)

  const urls = [`${SITE.url}/`];

  // one page per state present in tax-data
  for (const slug of builtSlugs) {
    const state = taxData.states[slug];
    const p = payroll[slug];
    // per-page payload: federal + only this state (keeps embedded JSON small)
    const payload = stripInternal({ taxYear: taxData.taxYear, federal: taxData.federal, states: { [slug]: state } });
    // State pages relate to the paycheck/OBBBA cluster, not the full tool
    // directory: the 2 OBBBA calculators, the 2 data studies, salary-to-hourly.
    const stateRelated = relatedLinksHtml(orderAncillary(slug, [
      { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
      { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
      { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
      { name: 'Tip Income Tax by State (Data Study)', path: '/data/tips-tax-by-state/' },
      { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
    ]));
    // Ancillary sections in a slug-stable per-state order (split around the
    // in-content ad slot) — same content, page-specific skeleton. FAQ entries
    // come first so the facts they consume aren't repeated in the quirks list.
    const faqEntries = stateFaqEntries(state, p, year);
    const ancillary = orderAncillary(slug, [
      localTaxBlock(state, p),
      minWageBlock(state, p, year),
      distinctiveFactsBlock(state, p, faqEntries),
      otherTaxesBlock(state, p),
      incomeContextBlock(state, p, taxData)
    ]).filter(Boolean);
    const ancSplit = Math.ceil(ancillary.length / 2);
    const html = fill(stateTpl, {
      STATE_NAME: state.name,
      STATE_TITLE: stateTitle(state, year),
      STATE_META_DESC: stateMetaDesc(state, year),
      STATE_H1: TARGET_STATES.has(slug)
        ? `${state.name} Paycheck, Payroll &amp; Income Tax Calculator`
        : `${state.name} Paycheck &amp; Payroll Calculator`,
      STATE_SLUG: slug,
      STATE_ABBR: state.abbr,
      STATE_TAX_PHRASE: state.hasIncomeTax ? `, and ${state.name} state income tax` : '',
      STATE_KEYWORD_PHRASE: state.hasIncomeTax
        ? 'paycheck, payroll and income tax calculator'
        : 'paycheck and payroll calculator',
      STATE_NOTAX_NOTE: state.hasIncomeTax
        ? ''
        : ` ${state.name} has no state income tax, so this tool shows your federal income tax and take-home pay.`,
      STATE_META_TAX_NOTE: state.hasIncomeTax
        ? ` — also works as a ${state.name} income tax calculator`
        : `. ${state.name} has no state income tax, so it doubles as a federal income tax calculator`,
      FIGURE_BANNER: figureYearBanner(state, year),
      ANSWER_BLOCK: stateAnswerBlock(state, year, taxData),
      TARGET_INTRO: targetIntro(state, year),
      STATE_LEDE: stateLede(state, year),
      STATE_BODY_H2: stateBodyH2(state, year),
      STATE_BODY: stateBody(state, year, taxData),
      BRACKET_TABLE: bracketTableBlock(state, year),
      STATE_PAYROLL: payrollDeductionsBlock(state, p),
      ANCILLARY_A: ancillary.slice(0, ancSplit).join('\n'),
      ANCILLARY_B: ancillary.slice(ancSplit).join('\n'),
      STATE_FAQ: stateFaqBlock(state, faqEntries),
      OBBBA_CONFORMITY: obbbaConformityBlock(state, obbba, year),
      SOURCES: sourcesBlock(state, p, taxData._meta),
      STATE_LINKS: stateLinks(roster, builtSlugs, slug),
      NEIGHBOR_H2: neighborHeading(roster, builtSlugs, slug),
      NEIGHBOR_COMPARE: neighborCompareTable(roster, builtSlugs, slug, taxData, year),
      FAQ_JSONLD: faqJsonLd(faqEntries),
      TAX_DATA_JSON: JSON.stringify(payload),
      YEAR: year,
      VERIFIED: verified,
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url
    });
    const dir = join(DIST, `${slug}-paycheck-calculator`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'index.html'),
      html.replace('<footer class="site">', `${stateRelated}\n<footer class="site">`)
    );
    urls.push(`${SITE.url}/${slug}-paycheck-calculator/`);
  }

  // home
  await writeFile(
    join(DIST, 'index.html'),
    fill(homeTpl, { STATE_LINKS: homeLinks, YEAR: year, SITE_NAME: SITE.name, SITE_URL: SITE.url })
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

  // stopwatch (count-up timer with unlimited lap splits; pure client-side)
  await mkdir(join(DIST, 'stopwatch'), { recursive: true });
  await writeFile(
    join(DIST, 'stopwatch', 'index.html'),
    fillTool(stopwatchTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/stopwatch/')
  );
  urls.push(`${SITE.url}/stopwatch/`);

  // pomodoro timer (focus/break phase machine; pure client-side)
  await mkdir(join(DIST, 'pomodoro-timer'), { recursive: true });
  await writeFile(
    join(DIST, 'pomodoro-timer', 'index.html'),
    fillTool(pomodoroTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/pomodoro-timer/')
  );
  urls.push(`${SITE.url}/pomodoro-timer/`);

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

  // bionic reading converter (bold word-prefixes for faster skimming, on-device)
  await mkdir(join(DIST, 'bionic-reading-converter'), { recursive: true });
  await writeFile(
    join(DIST, 'bionic-reading-converter', 'index.html'),
    fillTool(bionicTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/bionic-reading-converter/')
  );
  urls.push(`${SITE.url}/bionic-reading-converter/`);

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

  // CAGR (compound annual growth rate) calculator (pure-math, built on the cagr engine)
  await mkdir(join(DIST, 'cagr-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'cagr-calculator', 'index.html'),
    fillTool(cagrTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/cagr-calculator/')
  );
  urls.push(`${SITE.url}/cagr-calculator/`);

  // Half Birthday calculator (pure-date math, built on the half-birthday engine)
  await mkdir(join(DIST, 'half-birthday-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'half-birthday-calculator', 'index.html'),
    fillTool(halfBirthdayTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/half-birthday-calculator/')
  );
  urls.push(`${SITE.url}/half-birthday-calculator/`);

  // Rule of 72 calculator (pure-math, built on the rule-of-72 engine)
  await mkdir(join(DIST, 'rule-of-72-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'rule-of-72-calculator', 'index.html'),
    fillTool(ruleOf72Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/rule-of-72-calculator/')
  );
  urls.push(`${SITE.url}/rule-of-72-calculator/`);

  // Words to Minutes / speaking time calculator (pure-math, built on the words-to-time engine)
  await mkdir(join(DIST, 'words-to-minutes'), { recursive: true });
  await writeFile(
    join(DIST, 'words-to-minutes', 'index.html'),
    fillTool(wordsToMinutesTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/words-to-minutes/')
  );
  urls.push(`${SITE.url}/words-to-minutes/`);

  // Double Time Pay calculator (pure-math, built on the double-time-pay engine)
  await mkdir(join(DIST, 'double-time-pay-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'double-time-pay-calculator', 'index.html'),
    fillTool(doubleTimePayTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/double-time-pay-calculator/')
  );
  urls.push(`${SITE.url}/double-time-pay-calculator/`);

  // Biweekly vs Semimonthly paycheck calculator (pure-math, built on the pay-frequency engine)
  await mkdir(join(DIST, 'biweekly-vs-semimonthly'), { recursive: true });
  await writeFile(
    join(DIST, 'biweekly-vs-semimonthly', 'index.html'),
    fillTool(biweeklyVsSemimonthlyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/biweekly-vs-semimonthly/')
  );
  urls.push(`${SITE.url}/biweekly-vs-semimonthly/`);

  // EZ Grader / test score calculator (pure-math, built on the grading engine)
  await mkdir(join(DIST, 'ez-grader'), { recursive: true });
  await writeFile(
    join(DIST, 'ez-grader', 'index.html'),
    fillTool(ezGraderTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/ez-grader/')
  );
  urls.push(`${SITE.url}/ez-grader/`);

  // Chronological age calculator (pure-date math, built on the chronological-age engine)
  await mkdir(join(DIST, 'chronological-age-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'chronological-age-calculator', 'index.html'),
    fillTool(chronoAgeTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/chronological-age-calculator/')
  );
  urls.push(`${SITE.url}/chronological-age-calculator/`);

  // Debt avalanche calculator (pure-math, built on the debt-avalanche engine)
  await mkdir(join(DIST, 'debt-avalanche-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'debt-avalanche-calculator', 'index.html'),
    fillTool(debtAvalancheTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/debt-avalanche-calculator/')
  );
  urls.push(`${SITE.url}/debt-avalanche-calculator/`);

  // Markdown to HTML converter (client-side, uses the vendored `marked` library)
  await mkdir(join(DIST, 'markdown-to-html'), { recursive: true });
  await writeFile(
    join(DIST, 'markdown-to-html', 'index.html'),
    fillTool(markdownTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/markdown-to-html/')
  );
  urls.push(`${SITE.url}/markdown-to-html/`);

  // 1099 vs W-2 take-home calculator (pure-math federal estimate, built on the employment-tax engine)
  await mkdir(join(DIST, '1099-vs-w2-calculator'), { recursive: true });
  await writeFile(
    join(DIST, '1099-vs-w2-calculator', 'index.html'),
    fillTool(w2Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/1099-vs-w2-calculator/')
  );
  urls.push(`${SITE.url}/1099-vs-w2-calculator/`);

  // OBBBA "no tax on overtime" (IRC §225) deduction calculator — fresh-query wedge,
  // reuses the paycheck engine's federal bracket math + the sourced obbba data.
  await mkdir(join(DIST, 'overtime-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'overtime-tax-calculator', 'index.html'),
    fillTool(overtimeTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON, STATES_JSON: OBBBA_STATES_JSON }, '/overtime-tax-calculator/')
  );
  urls.push(`${SITE.url}/overtime-tax-calculator/`);

  // OBBBA "no tax on tips" (IRC §224) deduction calculator
  await mkdir(join(DIST, 'tips-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'tips-tax-calculator', 'index.html'),
    fillTool(tipsTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON, STATES_JSON: OBBBA_STATES_JSON }, '/tips-tax-calculator/')
  );
  urls.push(`${SITE.url}/tips-tax-calculator/`);

  // OBBBA senior bonus deduction (IRC §151(d)(5)(C)) calculator — the $6,000
  // deduction for 65+ marketed as "no tax on Social Security". No state-conformity
  // selector: it flows to states only via federal taxable income (static note in-page).
  await mkdir(join(DIST, 'senior-deduction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'senior-deduction-calculator', 'index.html'),
    fillTool(seniorTaxTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/senior-deduction-calculator/')
  );
  urls.push(`${SITE.url}/senior-deduction-calculator/`);

  // OBBBA SALT deduction cap (IRC §164(b)(6) as amended by §70120) calculator —
  // the $10,000 → $40,000 cap raise with the 30% high-income phase-down. No
  // state selector: SALT is a federal itemized deduction; the itemize-vs-standard
  // comparison and the old-cap counterfactual are the page's edge.
  await mkdir(join(DIST, 'salt-cap-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'salt-cap-calculator', 'index.html'),
    fillTool(saltCapTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/salt-cap-calculator/')
  );
  urls.push(`${SITE.url}/salt-cap-calculator/`);

  // OBBBA "which states still tax overtime in 2026" DATA STUDY (/data/overtime-tax-by-state/).
  // A citable, author-bylined data asset for the journalist link sprint. The table is
  // rendered server-side from the SAME sourced obbba dataset the calculators use, so the
  // study can never drift from the tools. Counts + movers are derived, not hardcoded.
  {
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const STUDY_PUBLISHED_ISO = '2026-07-02';
    const STUDY_UPDATED_ISO = '2026-07-07';
    const STUDY_DATE_HUMAN = 'July 7, 2026';
    const OT_LABEL = {
      no: { txt: 'Still taxed', cls: 'v-no', rank: 1 },
      partial: { txt: 'Partial', cls: 'v-partial', rank: 2 },
      unclear: { txt: 'Unclear', cls: 'v-unclear', rank: 3 },
      yes: { txt: 'Tax-free', cls: 'v-yes', rank: 4 },
      'n/a': { txt: 'No state wage tax', cls: 'v-na', rank: 5 },
    };
    const chip = (v) => {
      const m = OT_LABEL[v] || OT_LABEL.unclear;
      return { html: `<span class="chip ${m.cls}">${m.txt}</span>`, rank: m.rank };
    };
    const entries = Object.entries(obbba.states)
      .filter(([, s]) => s && typeof s === 'object' && s.overtime)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    const cnt = { no: 0, yes: 0, partial: 0, unclear: 0, nowage: 0 };
    const newlyFree = [], newlyTaxed = [], partialList = [], unclearList = [];
    const rows = entries.map(([slug, s]) => {
      const ot = s.overtime || {}, tp = s.tips || {};
      const ot26 = ot.y2026, tp26 = tp.y2026;
      if (ot26 === 'no') cnt.no++;
      else if (ot26 === 'yes') cnt.yes++;
      else if (ot26 === 'partial') cnt.partial++;
      else if (ot26 === 'unclear') cnt.unclear++;
      if (s.hasWageTax === false) cnt.nowage++;
      if (ot.y2025 === 'no' && ot26 === 'yes') newlyFree.push(s.name);
      if (ot.y2025 === 'yes' && ot26 === 'no') newlyTaxed.push(s.name);
      if (ot26 === 'partial') partialList.push(s.name);
      if (ot26 === 'unclear') unclearList.push(s.name);
      const otC = chip(ot26), tpC = chip(tp26);
      const changed = (ot.y2025 && ot26 && ot.y2025 !== ot26)
        ? ' <span class="changed">changed from 2025</span>' : '';
      const src = s.source
        ? `<a href="${esc(s.source)}" rel="nofollow noopener" target="_blank">source</a>` : '';
      const note = [s.note ? esc(s.note) : '', src].filter(Boolean).join(' ');
      return `<tr id="state-${slug}"><td><a href="/${slug}-paycheck-calculator/">${esc(s.name)}</a></td>` +
        `<td data-rank="${otC.rank}">${otC.html}${changed}</td>` +
        `<td data-rank="${tpC.rank}">${tpC.html}</td>` +
        `<td class="note">${note}</td></tr>`;
    }).join('\n');

    const cntOther = cnt.partial + cnt.unclear;
    const jn = (arr) => arr.join(', ');
    const movers = [];
    if (newlyFree.length) movers.push(`${jn(newlyFree)} — overtime newly tax-free for 2026`);
    if (newlyTaxed.length) movers.push(`${jn(newlyTaxed)} — overtime taxed again in 2026 (subject to change)`);
    if (partialList.length) movers.push(`${jn(partialList)} — only a partial state exclusion`);
    if (unclearList.length) movers.push(`${jn(unclearList)} — still unsettled for 2026`);
    const calloutMovers = movers.length ? movers.join('; ') + '.' : '';

    const articleLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: 'Which States Still Tax Overtime in 2026?',
      description: `A state-by-state analysis of which US states still tax overtime pay in 2026 after the federal One Big Beautiful Bill Act deduction. ${cnt.no} jurisdictions still tax it; ${cnt.yes} make it effectively tax-free; ${cnt.nowage} have no wage income tax.`,
      datePublished: STUDY_PUBLISHED_ISO, dateModified: STUDY_UPDATED_ISO,
      author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      mainEntityOfPage: `${SITE.url}/data/overtime-tax-by-state/`,
      isAccessibleForFree: true,
    });
    const datasetLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: 'OBBBA overtime & tips state conformity, tax year 2026',
      description: 'Per-jurisdiction conformity of all 50 US states and DC to the 2025 One Big Beautiful Bill Act federal deductions for overtime (IRC §225) and tips (IRC §224), for tax year 2026.',
      creator: { '@type': 'Person', name: 'Edmond Daher' },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      license: 'https://creativecommons.org/licenses/by/4.0/',
      temporalCoverage: '2026',
      distribution: { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/obbba-deductions-2026.json` },
      isAccessibleForFree: true,
    });

    await mkdir(join(DIST, 'data', 'overtime-tax-by-state'), { recursive: true });
    await writeFile(
      join(DIST, 'data', 'overtime-tax-by-state', 'index.html'),
      fillTool(overtimeStudyTpl, {
        SITE_NAME: SITE.name, SITE_URL: SITE.url,
        STUDY_ROWS: rows,
        CNT_TAX: String(cnt.no), CNT_FREE: String(cnt.yes),
        CNT_NOWAGE: String(cnt.nowage), CNT_OTHER: String(cntOther),
        CALLOUT_MOVERS: calloutMovers, PUB_DATE: STUDY_DATE_HUMAN,
        ARTICLE_LD: articleLd, DATASET_LD: datasetLd,
      }, '/data/overtime-tax-by-state/')
    );
    urls.push(`${SITE.url}/data/overtime-tax-by-state/`);

    // Flat CSV of the dataset — journalist-liftable citation kit (same source JSON).
    const csvEsc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csvLines = [['State', 'Has state wage tax', 'Overtime 2025', 'Overtime 2026',
                       'Tips 2025', 'Tips 2026', 'Note', 'Source']];
    for (const [, s] of entries) {
      const ot = s.overtime || {}, tp = s.tips || {};
      csvLines.push([s.name, s.hasWageTax ? 'yes' : 'no', ot.y2025 || '', ot.y2026 || '',
                     tp.y2025 || '', tp.y2026 || '', s.note || '', s.source || '']);
    }
    await writeFile(join(DIST, 'data', 'overtime-tax-by-state-2026.csv'),
      csvLines.map(r => r.map(csvEsc).join(',')).join('\n') + '\n');
  }

  // OBBBA "which states still tax tips in 2026" DATA STUDY (/data/tips-tax-by-state/).
  // Companion to the overtime study: same sourced obbba dataset, but keyed on the TIPS
  // field so the two studies can never drift from each other or from the calculators.
  // Counts + movers are derived from the data, not hardcoded.
  {
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const STUDY_PUBLISHED_ISO = '2026-07-02';
    const STUDY_UPDATED_ISO = '2026-07-07';
    const STUDY_DATE_HUMAN = 'July 7, 2026';
    const TP_LABEL = {
      no: { txt: 'Still taxed', cls: 'v-no', rank: 1 },
      partial: { txt: 'Partial', cls: 'v-partial', rank: 2 },
      unclear: { txt: 'Unclear', cls: 'v-unclear', rank: 3 },
      yes: { txt: 'Tax-free', cls: 'v-yes', rank: 4 },
      'n/a': { txt: 'No state wage tax', cls: 'v-na', rank: 5 },
    };
    const chip = (v) => {
      const m = TP_LABEL[v] || TP_LABEL.unclear;
      return { html: `<span class="chip ${m.cls}">${m.txt}</span>`, rank: m.rank };
    };
    const entries = Object.entries(obbba.states)
      .filter(([, s]) => s && typeof s === 'object' && s.tips)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    const cnt = { no: 0, yes: 0, partial: 0, unclear: 0, nowage: 0 };
    const newlyFree = [], newlyTaxed = [], partialList = [], unclearList = [];
    const rows = entries.map(([slug, s]) => {
      const ot = s.overtime || {}, tp = s.tips || {};
      const tp26 = tp.y2026, ot26 = ot.y2026;
      if (tp26 === 'no') cnt.no++;
      else if (tp26 === 'yes') cnt.yes++;
      else if (tp26 === 'partial') cnt.partial++;
      else if (tp26 === 'unclear') cnt.unclear++;
      if (s.hasWageTax === false) cnt.nowage++;
      if (tp.y2025 === 'no' && tp26 === 'yes') newlyFree.push(s.name);
      if (tp.y2025 === 'yes' && tp26 === 'no') newlyTaxed.push(s.name);
      if (tp26 === 'partial') partialList.push(s.name);
      if (tp26 === 'unclear') unclearList.push(s.name);
      const tpC = chip(tp26), otC = chip(ot26);
      const changed = (tp.y2025 && tp26 && tp.y2025 !== tp26)
        ? ' <span class="changed">changed from 2025</span>' : '';
      const src = s.source
        ? `<a href="${esc(s.source)}" rel="nofollow noopener" target="_blank">source</a>` : '';
      const note = [s.note ? esc(s.note) : '', src].filter(Boolean).join(' ');
      return `<tr id="state-${slug}"><td><a href="/${slug}-paycheck-calculator/">${esc(s.name)}</a></td>` +
        `<td data-rank="${tpC.rank}">${tpC.html}${changed}</td>` +
        `<td data-rank="${otC.rank}">${otC.html}</td>` +
        `<td class="note">${note}</td></tr>`;
    }).join('\n');

    const cntOther = cnt.partial + cnt.unclear;
    const jn = (arr) => arr.join(', ');
    const movers = [];
    if (newlyFree.length) movers.push(`${jn(newlyFree)} — tips newly tax-free for 2026`);
    if (newlyTaxed.length) movers.push(`${jn(newlyTaxed)} — tips taxed again in 2026 (subject to change)`);
    if (partialList.length) movers.push(`${jn(partialList)} — only a partial state exclusion`);
    if (unclearList.length) movers.push(`${jn(unclearList)} — still unsettled for 2026`);
    const calloutMovers = movers.length ? movers.join('; ') + '.' : '';

    const articleLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Article',
      headline: 'Which States Still Tax Tips in 2026?',
      description: `A state-by-state analysis of which US states still tax tip income in 2026 after the federal One Big Beautiful Bill Act deduction. ${cnt.no} jurisdictions still tax it; ${cnt.yes} make it effectively tax-free; ${cnt.nowage} have no wage income tax.`,
      datePublished: STUDY_PUBLISHED_ISO, dateModified: STUDY_UPDATED_ISO,
      author: { '@type': 'Person', '@id': `${SITE.url}/#edmond-daher`, name: 'Edmond Daher', url: `${SITE.url}/about/` },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      mainEntityOfPage: `${SITE.url}/data/tips-tax-by-state/`,
      isAccessibleForFree: true,
    });
    const datasetLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: 'OBBBA tips & overtime state conformity, tax year 2026',
      description: 'Per-jurisdiction conformity of all 50 US states and DC to the 2025 One Big Beautiful Bill Act federal deductions for tips (IRC §224) and overtime (IRC §225), for tax year 2026.',
      creator: { '@type': 'Person', name: 'Edmond Daher' },
      publisher: { '@type': 'Organization', name: SITE.name, url: SITE.url },
      license: 'https://creativecommons.org/licenses/by/4.0/',
      temporalCoverage: '2026',
      distribution: { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE.url}/data/obbba-deductions-2026.json` },
      isAccessibleForFree: true,
    });

    await mkdir(join(DIST, 'data', 'tips-tax-by-state'), { recursive: true });
    await writeFile(
      join(DIST, 'data', 'tips-tax-by-state', 'index.html'),
      fillTool(tipsStudyTpl, {
        SITE_NAME: SITE.name, SITE_URL: SITE.url,
        STUDY_ROWS: rows,
        CNT_TAX: String(cnt.no), CNT_FREE: String(cnt.yes),
        CNT_NOWAGE: String(cnt.nowage), CNT_OTHER: String(cntOther),
        CALLOUT_MOVERS: calloutMovers, PUB_DATE: STUDY_DATE_HUMAN,
        ARTICLE_LD: articleLd, DATASET_LD: datasetLd,
      }, '/data/tips-tax-by-state/')
    );
    urls.push(`${SITE.url}/data/tips-tax-by-state/`);

    // Flat CSV of the dataset — journalist-liftable citation kit (same source JSON).
    const csvEsc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csvLines = [['State', 'Has state wage tax', 'Tips 2025', 'Tips 2026',
                       'Overtime 2025', 'Overtime 2026', 'Note', 'Source']];
    for (const [, s] of entries) {
      const ot = s.overtime || {}, tp = s.tips || {};
      csvLines.push([s.name, s.hasWageTax ? 'yes' : 'no', tp.y2025 || '', tp.y2026 || '',
                     ot.y2025 || '', ot.y2026 || '', s.note || '', s.source || '']);
    }
    await writeFile(join(DIST, 'data', 'tips-tax-by-state-2026.csv'),
      csvLines.map(r => r.map(csvEsc).join(',')).join('\n') + '\n');
  }

  // Embeddable calculator pages (iframe targets for the /embed/ link engine).
  // Deliberately bypass fill(): NO ad loader (ads inside a third-party iframe would
  // violate AdSense policy) and NO site schema. They are noindex + canonical to the
  // real tool (set in-template) and are NOT added to the sitemap. Function-form
  // replace keeps '$' in the injected JSON literal (same reason fill() uses one).
  const embedMap = { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON, STATES_JSON: OBBBA_STATES_JSON };
  const fillEmbed = (tpl) => tpl.replace(/{{(\w+)}}/g, (m, k) => (k in embedMap ? embedMap[k] : m));
  await mkdir(join(DIST, 'embed', 'overtime-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'overtime-tax-calculator', 'index.html'), fillEmbed(embedOvertimeTpl));
  await mkdir(join(DIST, 'embed', 'tips-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'tips-tax-calculator', 'index.html'), fillEmbed(embedTipsTpl));
  await mkdir(join(DIST, 'embed', 'senior-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'senior-deduction-calculator', 'index.html'), fillEmbed(embedSeniorTpl));
  await mkdir(join(DIST, 'embed', 'salt-cap-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'salt-cap-calculator', 'index.html'), fillEmbed(embedSaltTpl));
  // Indexable embed gallery (fillTool is fine here — real page, benefits from schema
  // + the More-tools cross-links). This one IS in the sitemap.
  await writeFile(join(DIST, 'embed', 'index.html'), fillTool(embedGalleryTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/embed/'));
  urls.push(`${SITE.url}/embed/`);

  // biweekly mortgage payment calculator (pure-math, reuses the amortization engine)
  await mkdir(join(DIST, 'biweekly-mortgage-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'biweekly-mortgage-calculator', 'index.html'),
    fillTool(biweeklyTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url }, '/biweekly-mortgage-calculator/')
  );
  urls.push(`${SITE.url}/biweekly-mortgage-calculator/`);

  // public machine-readable copy of the live tax data (for the drift monitor +
  // transparency). Always reflects the deployed figures — single source of truth.
  await mkdir(join(DIST, 'data'), { recursive: true });
  await mkdir(join(DIST, 'data'), { recursive: true });
  await writeFile(join(DIST, 'data', 'tax-data-2026.json'), JSON.stringify(stripInternal(taxData), null, 2) + '\n');
  await writeFile(join(DIST, 'data', 'obbba-deductions-2026.json'), JSON.stringify(stripInternal(obbba), null, 2) + '\n');

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
  // Per-URL lastmod = each page's real git change-date (see sitemapLastmod) so the
  // sitemap carries honest, varied freshness signals instead of today-for-all.
  // Noindexed tools are dropped — a sitemap must never list noindex pages.
  const sitemapUrls = urls.filter((u) => !NOINDEX_TOOLS.has(u.replace(SITE.url, '')));
  await writeFile(
    join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      sitemapUrls.map((u) => `  <url><loc>${u}</loc><lastmod>${sitemapLastmod(u)}</lastmod></url>`).join('\n') +
      `\n</urlset>\n`
  );

  // IndexNow key file — hosted at the site root so Bing/Yandex can verify ownership
  // before accepting our URL submissions (scripts/indexnow-submit.py posts the list).
  if (SITE.indexNowKey) {
    await writeFile(join(DIST, `${SITE.indexNowKey}.txt`), `${SITE.indexNowKey}\n`);
  }

  // llms.txt — AI/LLM discovery file (llms.txt markdown convention). Regenerated
  // every build from TOOLS + the built state list; NOT added to the sitemap.
  const llmsTools = TOOLS
    .filter((t) => t.path.startsWith('/')) // skip the in-page "/#paycheck" anchor
    .map((t) => {
      const d = TOOL_DESCRIPTIONS[t.path] || t.name;
      return `- [${t.name}](${SITE.url}${t.path}): ${d}`;
    })
    .join('\n');
  const builtStateLines = roster
    .filter((s) => builtSlugs.has(s.slug))
    .map((s) => `- [${s.name} Paycheck Calculator](${SITE.url}/${s.slug}-paycheck-calculator/)`)
    .join('\n');
  const llmsTxt =
    `# ${SITE.name}\n\n` +
    `${SITE.name} is a collection of free, fast, privacy-friendly online tools and calculators. ` +
    `Every tool runs entirely in the browser — nothing you enter or upload is sent to a server.\n\n` +
    `## Tools\n\n${llmsTools}\n\n` +
    `## State paycheck calculators\n\n` +
    `Take-home pay (paycheck) calculators for all ${builtSlugs.size} US states and Washington, D.C. ` +
    `Each estimates ${year} take-home pay after federal income tax, Social Security, Medicare, and (where applicable) state income tax. ` +
    `Start at the [paycheck calculator hub](${SITE.url}/#paycheck).\n\n` +
    `${builtStateLines}\n`;
  await writeFile(join(DIST, 'llms.txt'), llmsTxt);

  console.log(`Built ${builtSlugs.size} state page(s) + home + ${STATIC_PAGES.length} content pages → dist/`);
  console.log(`States: ${[...builtSlugs].join(', ')}`);
  if (!SITE.adsensePublisherId) console.log('Note: ads.txt skipped (set SITE.adsensePublisherId after AdSense approval).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
