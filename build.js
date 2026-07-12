#!/usr/bin/env node
// build.js — pSEO static generator. Reads templates + tax data, emits ./dist.
// Cloudflare Pages: build command `npm run build`, output dir `dist`.
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_PAGES } from './src/content/static-pages.js';
import { computePaycheck } from './src/engine/paycheck-engine.js';
import { computeBonus } from './src/engine/bonus-tax.js';

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

// Page-level defense-in-depth for the P0 fixed by the content-hash pipeline
// above: each calculator's own init() is now try/catch-wrapped (see
// calc-error-banner.js + the src/assets/*.js bootstrap files), which covers
// "module loaded fine but a call inside it threw." This listener covers the
// other half: a module that fails to even START executing — a 404, a CSP
// block, or (the historically-realistic version of THIS exact bug) a stale
// browser-cached shared engine that no longer has an export the newer
// bootstrap file expects. That last case is a *static* ES-module link error,
// thrown before any of that module's own code (including its try/catch) ever
// runs — verified empirically by breaking an export in a built dist/ copy and
// loading it: Chrome fires a plain `window.error` event whose `e.target` is
// `window` (NOT the failing <script> element — a first assumption here that
// turned out to be wrong) but whose `e.filename` points at the failing
// /assets/ file. So this listener checks BOTH: `e.filename` naming one of our
// own /assets/*.js files (covers the link-error case above), OR `e.target`
// being a failed `<script type="module" src="/assets/...">` element (covers a
// plain 404/network failure, whose `error` event target usually IS the
// script tag). Either check requires an /assets/ path, so it can never
// false-positive on an ad-blocked AdSense script (different origin) or a
// blocked vendor UMD bundle (classic script, no type="module", different
// filename pattern in the stack). Injected on every full page via fill(), and
// on /embed/* pages via fillEmbed()/fillDcEmbed() (embed templates bypass
// fill() entirely to skip ads/site-schema, but still need this same
// page-level defense-in-depth); harmless no-op on pages with no matching
// module script (content pages). Falls back to document.body when there's no
// <main> (every /embed/* template wraps its content in a plain
// `<div class="embed-wrap">`, not `<main>`) — same fallback calc-error-banner.js
// already uses for the tool-level try/catch banner.
const MODULE_ERROR_LISTENER =
  `<script>window.addEventListener('error',function(e){` +
  `if(document.getElementById('calc-load-error'))return;` +
  `var t=e&&e.target;` +
  `var fromOurAssets=(e&&e.filename&&e.filename.indexOf('/assets/')!==-1)||` +
  `(t&&t.tagName==='SCRIPT'&&t.type==='module'&&t.src&&t.src.indexOf('/assets/')!==-1);` +
  `if(!fromOurAssets)return;` +
  `var m=document.querySelector('main')||document.body;` +
  `if(!m)return;` +
  `var b=document.createElement('div');b.id='calc-load-error';b.className='calc-load-error';b.setAttribute('role','alert');` +
  `b.textContent='Something went wrong loading this calculator — please refresh the page.';` +
  `m.insertBefore(b,m.firstChild);` +
  `},true);</script>\n`;

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
  { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/', cat: 'money' },
  { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/', cat: 'money' },
  { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/', cat: 'money' },
  { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/', cat: 'money' },
  { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/', cat: 'money' },
  { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/', cat: 'money' },
  { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/', cat: 'money' },
  { name: 'QCD vs. Charitable Deduction Calculator', path: '/qcd-vs-charitable-deduction-calculator/', cat: 'money' },
  { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/', cat: 'money' },
  { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/', cat: 'money' },
  { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/', cat: 'money' },
  { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/', cat: 'money' },
  { name: 'Social Security Wage Base Max-Out Date Calculator', path: '/ss-wage-base-calculator/', cat: 'money' },
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
  '/1099-threshold-checker/': 'See whether you\'ll get a 1099-K, 1099-NEC, or 1099-MISC under the 2025/2026 rules: payment apps at $20,000 and 200 transactions, card processors like Stripe/Square with no minimum at all, or a business paying you directly at $2,000 (2026) / $600 (2025) — plus the myth-bust that a 1099 is paperwork, not a tax.',
  '/overtime-tax-calculator/': 'See how much of your overtime is deductible under the 2025 "no tax on overtime" law and what it saves you.',
  '/tips-tax-calculator/': 'See how much of your tips are deductible under the 2025 "no tax on tips" law (up to $25,000) and what it saves you.',
  '/senior-deduction-calculator/': 'Calculate the 2025 law\'s $6,000 senior bonus deduction for people 65+ — the "no tax on Social Security" break — and what it saves you.',
  '/salt-cap-calculator/': 'See your allowed SALT deduction under the 2025 law\'s $40,000 cap — with the high-income phase-down, the itemize-vs-standard check, and your saving vs the old $10,000 cap.',
  '/car-loan-interest-calculator/': 'See how much of your new-car loan interest is deductible under the 2025 law (up to $10,000/yr, 2025–2028) — with the income phase-out and what it really saves you.',
  '/charitable-deduction-calculator/': 'See your charitable deduction under the 2026 law: the permanent $1,000/$2,000 non-itemizer deduction, the 0.5%-of-AGI floor for itemizers, the 35%-cap in the top bracket, and what it saves — without claiming it lowers your AGI (it does not).',
  '/qcd-vs-charitable-deduction-calculator/': "70½+? Compare a Qualified Charitable Distribution (excluded from income entirely, up to $111,000 in 2026) against taking the IRA distribution and claiming a charitable deduction instead. See the real AGI and federal-tax difference — including the case where they tie.",
  '/dependent-care-fsa-vs-credit-calculator/': 'Max the 2026 $7,500 Dependent Care FSA or take the Child & Dependent Care Credit? It\'s one or the other — maxing the FSA zeroes the credit. See both scenarios side by side, the dollar difference, and which wins for your income (MFS-aware; the credit is nonrefundable).',
  '/w4-overtime-tips-withholding-calculator/': 'Turn the no-tax-on-tips / no-tax-on-overtime deduction into bigger paychecks now: see what to enter on your 2026 Form W-4 Step 4(b) (lines 1a/1b) and the extra take-home per paycheck, instead of waiting for a refund.',
  '/roth-catchup-calculator/': 'Earn over $150,000? See if the 2026 SECURE 2.0 rule forces your 401(k) catch-up into Roth (after-tax), what that costs this year, and the Roth-vs-pre-tax break-even.',
  '/bonus-tax-calculator/': 'See what\'s withheld from your bonus now (flat 22% federal + your state\'s supplemental rate + FICA) versus what it will really cost at tax time — with the refund or amount owed, for all 50 states + DC.',
  '/ss-wage-base-calculator/': 'Find the exact 2026 paycheck your 6.2% Social Security tax stops for the year once you cross the $184,500 wage base, and how much your take-home pay jumps — plus a multi-employer excess-FICA check and a Medicare contrast note.',
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
  '/overtime-tax-calculator/': [
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
  ],
  '/tips-tax-calculator/': [
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Tip & Bill Split', path: '/tip-calculator/' }
  ],
  '/w4-overtime-tips-withholding-calculator/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
  ],
  '/car-loan-interest-calculator/': [
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Auto Loan Calculator', path: '/auto-loan-calculator/' },
    { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' }
  ],
  '/charitable-deduction-calculator/': [
    { name: 'QCD vs. Charitable Deduction Calculator', path: '/qcd-vs-charitable-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' }
  ],
  '/qcd-vs-charitable-deduction-calculator/': [
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' }
  ],
  '/dependent-care-fsa-vs-credit-calculator/': [
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' }
  ],
  '/salt-cap-calculator/': [
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Mortgage Calculator', path: '/mortgage-calculator/' },
    { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' }
  ],
  '/senior-deduction-calculator/': [
    { name: 'QCD vs. Charitable Deduction Calculator', path: '/qcd-vs-charitable-deduction-calculator/' },
    { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' }
  ],
  '/roth-catchup-calculator/': [
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Compound Interest Calculator', path: '/compound-interest-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' }
  ],
  '/1099-threshold-checker/': [
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Sales Tax Calculator', path: '/sales-tax-calculator/' },
    { name: 'Savings Goal Calculator', path: '/savings-goal-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' }
  ],
  '/ss-wage-base-calculator/': [
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/' },
    { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' },
    { name: 'Hours Calculator (Time Card)', path: '/hours-calculator/' },
    { name: 'Biweekly vs Semimonthly Paycheck Calculator', path: '/biweekly-vs-semimonthly/' },
    { name: '401(k) Retirement Calculator', path: '/401k-calculator/' }
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
    { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
    { name: 'W-4 Overtime & Tips Withholding Calculator', path: '/w4-overtime-tips-withholding-calculator/' },
    { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
    { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
    { name: 'Senior Bonus Deduction Calculator', path: '/senior-deduction-calculator/' },
    { name: 'SALT Cap Calculator', path: '/salt-cap-calculator/' },
    { name: 'Car Loan Interest Deduction Calculator', path: '/car-loan-interest-calculator/' },
    { name: 'Charitable Deduction Calculator', path: '/charitable-deduction-calculator/' },
    { name: 'Dependent Care FSA vs. Child Care Credit Calculator', path: '/dependent-care-fsa-vs-credit-calculator/' },
    { name: 'Mandatory Roth Catch-Up Calculator', path: '/roth-catchup-calculator/' },
    { name: 'Overtime Tax by State (Data Study)', path: '/data/overtime-tax-by-state/' },
    { name: '1099 vs W-2 Calculator', path: '/1099-vs-w2-calculator/' },
    { name: '1099-K / 1099-NEC Threshold Checker', path: '/1099-threshold-checker/' },
    { name: 'Social Security Wage Base Max-Out Date Calculator', path: '/ss-wage-base-calculator/' }
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
  // Page-level module-load-failure listener — same full-page-only guard as above.
  if (out.includes('</head>')) out = out.replace('</head>', `${MODULE_ERROR_LISTENER}</head>`);
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
// FNV-1a has weak avalanche in its LOW bits, and `% n` reads exactly those bits,
// so similar short slugs (e.g. "maine"/"montana") correlate across many salts and
// end up picking the same variant in several sections at once — a large shared
// run between two same-bucket pages. Run the hash through the MurmurHash3 fmix
// finalizer first so every output bit depends on all input bits; similar slugs
// then decorrelate across salts, spreading variant picks evenly.
function mixIndex(h, n) {
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489909) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % n;
}
const pickFrame = (slug, salt, arr) => arr[mixIndex(slugHash(slug + salt), arr.length)];

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

// ===========================================================================
// Bonus (supplemental-wage) tax calculator — per-state content generators.
// The 51-page cluster mirrors the paycheck cluster: one template + a per-state
// loop, with every page's prose keyed to that state's supplemental METHOD +
// RATE (and slug-varied worked-example inputs) so no two pages are near-dupes.
// ===========================================================================

function bonusTitle(state, supp, year) {
  const a = state.abbr;
  if (supp.method === 'none') return `${state.name} Bonus Tax Calculator ${year} (${a}) — No State Tax on Your Bonus`;
  if (supp.method === 'flat') return `${state.name} Bonus Tax Calculator ${year}: ${pctStr(supp.rate)} Supplemental Rate (${a})`;
  if (supp.special === 'ca_dual') return `${state.name} Bonus Tax Calculator ${year}: 10.23% Supplemental Rate (${a})`;
  if (supp.special === 'pct_of_federal') return `${state.name} Bonus Tax Calculator ${year} (${a}) — 30% of Federal Withholding`;
  if (supp.special === 'wi_banded') return `${state.name} Bonus Tax Calculator ${year} (${a}) — Graduated Supplemental Rate`;
  return `${state.name} Bonus Tax Calculator ${year} (${a}) — Withholding vs. Real Tax`;
}

function bonusMetaDesc(state, supp, year) {
  let mid;
  if (supp.method === 'none') mid = `flat 22% federal + $0 ${state.name} state tax + FICA`;
  else if (supp.method === 'flat') mid = `flat 22% federal + ${state.name}'s ${pctStr(supp.rate)} supplemental rate + FICA`;
  else if (supp.special === 'ca_dual') mid = `flat 22% federal + California's 10.23% bonus rate + FICA`;
  else if (supp.special === 'pct_of_federal') mid = `flat 22% federal + Vermont's 30%-of-federal state rate + FICA`;
  else if (supp.special === 'wi_banded') mid = `flat 22% federal + Wisconsin's graduated state rate + FICA`;
  else mid = `flat 22% federal + ${state.name} state withholding + FICA`;
  return `Free ${year} ${state.name} bonus tax calculator. See what's withheld from your bonus now (${mid}) versus what it will really cost at tax time, with the refund or amount owed. Runs in your browser.`;
}

// Short data phrase describing a state's bonus method — used in headings/tables.
function bonusRateWord(supp) {
  if (supp.method === 'none') return 'no state tax';
  if (supp.method === 'flat') return `a flat ${pctStr(supp.rate)}`;
  if (supp.special === 'ca_dual') return '10.23% / 6.6%';
  if (supp.special === 'pct_of_federal') return '30% of the federal amount';
  if (supp.special === 'wi_banded') return 'a graduated 3.54%–7.65%';
  return supp.incomeRate ? `the aggregate method (~${pctStr(supp.incomeRate)})` : 'the aggregate method';
}

// The source agency for a state's supplemental rate, in words (differs per state,
// so weaving it into prose adds genuine per-state vocabulary, not reworded filler).
function bonusSourceName(state, supp) {
  if (supp && supp.source && supp.source !== 'repoTaxData') {
    return String(supp.source).split(':')[0].split(' (')[0].split(';')[0].trim();
  }
  return `the ${state.name} Department of Revenue`;
}

function bonusLede(state, supp, year) {
  let stateBit;
  if (supp.method === 'none') {
    const angle = NOTAX_ANGLE[state.slug];
    const angleBit = angle ? ` (it runs on ${angle})` : '';
    stateBit = pickFrame(state.slug, 'btledeNo', [
      `${state.name} takes <strong>no state income tax</strong>${angleBit}, so only the flat <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a> come out.`,
      `With <strong>no ${state.name} income tax</strong>${angleBit}, the only bites are the flat <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`,
      `Because ${state.name} levies <strong>no income tax</strong>${angleBit}, nothing goes to the state — just the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`
    ]);
  } else if (supp.method === 'flat') stateBit = `${state.name} adds a flat <strong>${pctStr(supp.rate)}</strong> on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else if (supp.special === 'ca_dual') stateBit = `California adds <strong>10.23%</strong> on bonuses (6.6% on other supplemental pay) on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else if (supp.special === 'pct_of_federal') stateBit = `Vermont adds <strong>30% of the federal amount</strong> (not of the bonus) on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else if (supp.special === 'wi_banded') stateBit = `Wisconsin uses a <strong>graduated</strong> state rate (3.54%–7.65% by income) on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  else stateBit = `${state.name} has no separate bonus rate, so it withholds using the <strong>aggregate method</strong>${supp.incomeRate ? ` (about ${pctStr(supp.incomeRate)})` : ''} on top of the <strong>22%</strong> federal prepayment and <a href="/tax-glossary/#fica">FICA</a>.`;
  const open = pickFrame(state.slug, 'btlede', [
    `In ${state.name}, a bonus is ordinary income — the slice that vanishes on payday is <a href="/tax-glossary/#withholding">withholding</a>, not a higher tax rate.`,
    `Got a bonus in ${state.name}? It isn't taxed at a special rate — what shrinks it is <a href="/tax-glossary/#withholding">withholding</a>.`,
    `A ${state.name} bonus feels heavily taxed, but the missing chunk is <a href="/tax-glossary/#withholding">withholding</a>, not a bonus tax.`,
    `Your ${state.name} bonus is ordinary income; the payday deduction is a flat <a href="/tax-glossary/#withholding">withholding</a> prepayment, not a higher rate.`,
    `That big bite out of a ${state.name} bonus is <a href="/tax-glossary/#withholding">withholding</a> at work — a prepayment, not a special bonus tax.`,
    `A bonus in ${state.name} is taxed like any wages; the chunk missing on payday is up-front <a href="/tax-glossary/#withholding">withholding</a>, nothing more.`,
    `Wondering why your ${state.name} bonus shrank so much? It's <a href="/tax-glossary/#withholding">withholding</a>, a flat prepayment, not a higher rate on bonuses.`
  ]);
  const close = pickFrame(state.slug, 'btledeC', [
    `Enter your numbers to see what's held back now beside what the bonus will really cost when you file, and your refund or amount owed.`,
    `Put in your figures below to compare what's withheld now with your real tax at filing — and the refund or shortfall.`,
    `Run your numbers to see the "now" withholding next to the "at tax time" total, and how much comes back or is still owed.`,
    `Type in your salary and bonus below and the tool lines up today's withholding against your true tax, with the refund or balance due.`,
    `Drop your figures in to watch the payday deduction sit next to the real filing cost, plus whatever you get back or owe.`
  ]);
  return `${open} ${stateBit} ${close} Everything runs in your browser.`;
}

function bonusAnswerBlock(state, supp) {
  let stateClause;
  if (supp.method === 'none') stateClause = pickFrame(state.slug, 'btansState', [
    `<strong>0%</strong> for state tax (${state.name} has no income tax)`,
    `nothing for the state — ${state.name} levies no income tax`,
    `<strong>$0</strong> in ${state.name} tax, since the state has no income tax`
  ]);
  else if (supp.method === 'flat') stateClause = `<strong>${pctStr(supp.rate)}</strong> for ${state.name}`;
  else if (supp.special === 'ca_dual') stateClause = `<strong>10.23%</strong> for California (6.6% on non-bonus supplemental pay)`;
  else if (supp.special === 'pct_of_federal') stateClause = `<strong>30% of that federal amount</strong> for Vermont`;
  else if (supp.special === 'wi_banded') stateClause = `a <strong>graduated Wisconsin rate (3.54%–7.65%)</strong> by income`;
  else stateClause = `no separate ${state.name} rate — it's withheld as ordinary wages${supp.incomeRate ? ` (about <strong>${pctStr(supp.incomeRate)}</strong>)` : ''}`;
  const tail = pickFrame(state.slug, 'btans', [
    `That's a prepayment, not your final tax — the bonus is really taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when you file, and the calculator below shows the refund or amount you'll owe.`,
    `Those are <a href="/tax-glossary/#withholding">withholding</a> rates, not the tax itself; your bonus settles at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> on your return — the tool below shows by how much.`,
    `But that's only <a href="/tax-glossary/#withholding">withholding</a>. Your real bill is your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> at filing; run the calculator to see the refund or shortfall.`,
    `None of that is the final number — a bonus is taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> once you file, so the calculator below estimates what comes back or is still due.`,
    `Treat it as money on account. The real tax is your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, reconciled on your return; the tool below shows the gap either way.`
  ]);
  const lead = pickFrame(state.slug, 'btansLead', [
    `<strong>Quick answer:</strong> a separately paid bonus in ${state.name} is <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> for federal income tax plus ${stateClause}, plus <strong>7.65%</strong> FICA.`,
    `<strong>Short version:</strong> in ${state.name}, a bonus paid on its own is <a href="/tax-glossary/#withholding">withheld</a> at the flat federal <strong>22%</strong>, ${stateClause}, and <strong>7.65%</strong> FICA.`,
    `<strong>The quick take:</strong> a stand-alone ${state.name} bonus has a flat <strong>22%</strong> federal tax <a href="/tax-glossary/#withholding">withheld</a>, ${stateClause}, plus <strong>7.65%</strong> FICA.`
  ]);
  return `<section class="prose"><p>${lead} ${tail}</p></section>`;
}

function bonusMythBust(state, supp, ex) {
  const heading = pickFrame(state.slug, 'btmythH', supp.method === 'none' ? [
    `${state.name} has no bonus tax — so why is 22%+ still withheld?`,
    `No ${state.name} bonus tax: where does the missing money go?`,
    `Why a ${state.name} bonus shrinks even with no state tax`
  ] : [
    `Is ${state.name}'s ${bonusRateWord(supp)} bonus rate a "bonus tax"? No`,
    `Why your ${state.name} bonus looks over-taxed — and mostly isn't`,
    `The "${state.name} bonus tax" myth, and what's really withheld`
  ]);
  let exLine = '';
  if (ex && Math.abs(ex.delta) >= 1) {
    exLine = ex.refund
      ? pickFrame(state.slug, 'btmythExR', [
          ` In this page's ${usd0(ex.bonus)} example, about <strong>${usd0(ex.delta)}</strong> of what's withheld is really over-payment you'd get back.`,
          ` On the ${usd0(ex.bonus)} example below, roughly <strong>${usd0(ex.delta)}</strong> is over-withheld and comes back to you at filing.`,
          ` Worked out for the ${usd0(ex.bonus)} bonus here, about <strong>${usd0(ex.delta)}</strong> returns as a refund.`
        ])
      : pickFrame(state.slug, 'btmythExO', [
          ` In this page's ${usd0(ex.bonus)} example, withholding falls about <strong>${usd0(-ex.delta)}</strong> short of the real tax, so you'd owe the rest.`,
          ` For the ${usd0(ex.bonus)} bonus below, the flat withholding runs roughly <strong>${usd0(-ex.delta)}</strong> light, leaving that to owe.`,
          ` Worked out here on a ${usd0(ex.bonus)} bonus, you'd still owe about <strong>${usd0(-ex.delta)}</strong> when you file.`
        ]);
  }
  const body = pickFrame(state.slug, 'btmythB', [
    `The flat 22% federal figure (and your state's rate) is a <a href="/tax-glossary/#withholding">withholding</a> default — not a tax that applies only to bonuses. A bonus is ordinary income, taxed at your true <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when the year runs through the <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `There is no special bonus tax rate. The 22% is a <a href="/tax-glossary/#withholding">withholding</a> convenience; at filing the bonus is taxed like the rest of your income, at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> across the <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `Bonuses aren't taxed differently — only <a href="/tax-glossary/#withholding">withheld</a> differently. The real tax is your ordinary <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, settled on your return, not the flat 22% on the check.`,
    `"Bonus tax" is a nickname for over-<a href="/tax-glossary/#withholding">withholding</a>. The 22% is a flat prepayment; your bonus is ordinary income taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> once the year's <a href="/tax-glossary/#tax-bracket">brackets</a> are applied.`,
    `Nothing about a bonus changes the tax rate — it changes the <a href="/tax-glossary/#withholding">withholding</a>. The bonus is stacked onto your other income and taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, not at a bonus-only rate.`,
    `A bonus doesn't trigger a different tax — just a flat <a href="/tax-glossary/#withholding">withholding</a> up front. When you file, it's folded into your income and taxed at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> through the normal <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `The 22% you see isn't a bonus levy; it's a <a href="/tax-glossary/#withholding">withholding</a> placeholder. Your bonus is ordinary income, and its real tax is whatever your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> works out to across the <a href="/tax-glossary/#tax-bracket">brackets</a>.`,
    `Think of the flat rate as a deposit, not a bill. A bonus is taxed like any wages — at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when the year's income runs through the <a href="/tax-glossary/#tax-bracket">brackets</a> — and the 22% is only how it's <a href="/tax-glossary/#withholding">withheld</a>.`
  ]);
  const rule = pickFrame(state.slug, 'btmythRule', [
    `Under 22% (most people) the extra comes back as a refund; over 22% you owe the difference.`,
    `If your real rate sits under 22%, the surplus refunds; if it runs above, you cover the shortfall.`,
    `Below a 22% real rate you get money back; above it, you settle the gap at filing.`,
    `Most people's real rate is under 22%, so the extra returns; higher earners above 22% owe more.`,
    `When 22% overshoots your rate you're refunded; when it undershoots, the balance is due.`
  ]);
  const ficaTail = pickFrame(state.slug, 'btmythFica', [
    `Only <a href="/tax-glossary/#fica">FICA</a> (7.65%) is a true tax that never returns.`,
    `The one piece that never refunds is <a href="/tax-glossary/#fica">FICA</a> (7.65%) — a genuine tax, not a prepayment.`,
    `Just the 7.65% <a href="/tax-glossary/#fica">FICA</a> slice is a real tax you won't get back.`,
    `Set aside the 7.65% <a href="/tax-glossary/#fica">FICA</a> — that part is owed for good and never refunds.`,
    `The lone exception is <a href="/tax-glossary/#fica">FICA</a> (7.65%), which is a real tax rather than a prepayment.`
  ]);
  return `<section class="prose mythbust"><h2>${heading}</h2>` +
    `<p>${body} ${rule}${exLine} ${ficaTail}</p></section>`;
}

// btfed / btfica are on EVERY page, so a full-paragraph frame collision between
// any two pages shares a large block. Each is assembled from two INDEPENDENTLY
// picked sentences, so a full collision needs both halves to match (~1/30, not
// 1/6) — collapsing the biggest cross-page shingle-overlap contributor.
function bonusFederalPara(state) {
  const s1 = pickFrame(state.slug, 'btfed1', [
    `<strong>Federal: a flat 22% prepayment.</strong> Paid on its own check, a bonus has federal income tax <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> (IRS Publication 15).`,
    `<strong>The 22% isn't a bonus tax.</strong> It's the flat rate an employer may use to <a href="/tax-glossary/#withholding">withhold</a> federal income tax from a separately paid bonus (IRS Pub 15).`,
    `<strong>How the federal 22% works.</strong> A bonus identified separately from regular wages is <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> federally (IRS Publication 15).`,
    `<strong>Federal withholding on a bonus.</strong> The IRS default holds back a flat <strong>22%</strong> for federal income tax when the bonus is separate from your regular pay (IRS Pub 15).`,
    `<strong>Where the 22% comes from.</strong> Employers may <a href="/tax-glossary/#withholding">withhold</a> a flat <strong>22%</strong> of a separately identified bonus for federal income tax (IRS Publication 15).`,
    `<strong>The federal side is a flat prepayment.</strong> A bonus on its own check has <strong>22%</strong> <a href="/tax-glossary/#withholding">withheld</a> for federal income tax (IRS Pub 15).`
  ]);
  const s2 = pickFrame(state.slug, 'btfed2', [
    ` It rises to a mandatory <strong>37%</strong> on any bonus dollars past <strong>$1,000,000</strong> in a year — the third <a href="/tax-glossary/#tax-bracket">bracket's</a> rate as a default, not a bonus tax.`,
    ` Only the part of your yearly bonuses above <strong>$1,000,000</strong> is withheld at <strong>37%</strong>; everything under that stays a flat <strong>22%</strong> — a shortcut, not a rate reserved for bonuses.`,
    ` A mandatory <strong>37%</strong> hits supplemental pay beyond <strong>$1,000,000</strong> a year; neither figure is a special "bonus" rate, both are <a href="/tax-glossary/#withholding">withholding</a> defaults.`,
    ` Once your year's supplemental pay tops <strong>$1,000,000</strong>, the rate jumps to <strong>37%</strong>. It borrows the third <a href="/tax-glossary/#tax-bracket">bracket's</a> rate — it is not a levy on bonuses.`,
    ` Bonus dollars over <strong>$1,000,000</strong> in the year switch to a mandatory <strong>37%</strong>; below that it's a flat <strong>22%</strong> prepayment tied to the third <a href="/tax-glossary/#tax-bracket">bracket</a>.`
  ]);
  return `<p>${s1}${s2}</p>`;
}

function bonusFicaPara(state) {
  const s1 = pickFrame(state.slug, 'btfica1', [
    `<strong>FICA is the real tax.</strong> Social Security (6.2% to the wage base) and Medicare (1.45%, +0.9% above $200,000) are owed at the same rate they're withheld.`,
    `<strong>The 7.65% FICA slice doesn't true up.</strong> Social Security and Medicare are genuine taxes on a bonus, not a prepayment.`,
    `<strong>Don't expect FICA back.</strong> Of the total held back, <strong>7.65%</strong> is <a href="/tax-glossary/#fica">FICA</a> — Social Security to the wage base, plus Medicare — owed at that rate.`,
    `<strong>FICA: withheld and owed.</strong> Social Security and Medicare take <strong>7.65%</strong> of the bonus — a true tax, not a prepayment.`,
    `<strong>The 7.65% is real.</strong> <a href="/tax-glossary/#fica">FICA</a> — Social Security up to the wage base, plus 1.45% Medicare (and 0.9% more above $200,000) — is owed at exactly the rate it's withheld.`,
    `<strong>Set FICA aside as final.</strong> The <strong>7.65%</strong> <a href="/tax-glossary/#fica">FICA</a> bite is the tax itself — Social Security stops at the annual wage base, Medicare doesn't.`
  ]);
  const s2 = pickFrame(state.slug, 'btfica2', [
    ` That's why the calculator shows the same <a href="/tax-glossary/#fica">FICA</a> under "withheld now" and "what it really costs" — there's nothing to refund; only the income-tax portion trues up.`,
    ` So <a href="/tax-glossary/#fica">FICA</a> reads identically in both columns of the calculator; only the income-tax withholding settles up at filing.`,
    ` It reads the same in the "now" and "at tax time" columns because none of it comes back — just the income-tax slice is a prepayment that reconciles.`,
    ` Neither piece refunds at filing, so both columns of the tool show it unchanged; the income-tax withholding is the only part that trues up.`,
    ` The income-tax withholding is the only part that can come back — the <a href="/tax-glossary/#fica">FICA</a> share is settled the moment it's taken.`
  ]);
  return `<p>${s1}${s2}</p>`;
}

function bonusHowItWorks(state, supp, year) {
  const src = bonusSourceName(state, supp);
  let st;
  if (supp.method === 'none') {
    const fact = NOTAX_FACTS[state.slug] ? ` ${NOTAX_FACTS[state.slug]}` : '';
    st = pickFrame(state.slug, 'btst_n', [
      `<p><strong>${state.name}: $0 state.</strong> ${state.name} levies no state income tax on wages, so nothing is withheld for state tax on your bonus — only the federal 22% and FICA.${fact}</p>`,
      `<p><strong>${state.name}: nothing at the state level.</strong> With no ${state.name} wage income tax, your bonus loses <strong>$0</strong> to state withholding; just the federal 22% and FICA apply.${fact}</p>`,
      `<p><strong>${state.name} takes no cut.</strong> Because ${state.name} has no state income tax, there's no state line on your bonus at all — the only withholding is the flat 22% federal and FICA.${fact}</p>`,
      `<p><strong>No state line in ${state.name}.</strong> ${state.name} doesn't tax wage income, so your bonus keeps every state dollar — the withholding you see is purely federal 22% plus FICA.${fact}</p>`,
      `<p><strong>${state.name}: state withholding is zero.</strong> Since ${state.name} imposes no income tax on wages, a bonus has nothing deducted for the state; only the 22% federal prepayment and FICA come off.${fact}</p>`,
      `<p><strong>${state.name} skips the state tax.</strong> A ${state.name} bonus faces no state income-tax withholding whatsoever — the flat 22% federal and FICA are the entire bite.${fact}</p>`
    ]);
  } else if (supp.method === 'flat') {
    const extra = `${state.slug === 'north-carolina' ? ' This 4.09% is deliberately distinct from the 3.99% flat income-tax rate.' : ''}${state.slug === 'new-york' ? ' New York City (4.25%) and Yonkers add local supplemental rates on top for residents there.' : ''}`;
    st = pickFrame(state.slug, 'btst_f', [
      `<p><strong>${state.name}: flat ${pctStr(supp.rate)}.</strong> ${state.name} withholds a flat <strong>${pctStr(supp.rate)}</strong> of a separately paid bonus for state income tax, per ${src}.${extra}</p>`,
      `<p><strong>${state.name}'s ${pctStr(supp.rate)} supplemental rate.</strong> When a bonus is paid on its own, ${src} sets a flat <strong>${pctStr(supp.rate)}</strong> of it for ${state.name} withholding.${extra}</p>`,
      `<p><strong>${state.name}: a set ${pctStr(supp.rate)}.</strong> ${state.name} applies one flat supplemental rate — <strong>${pctStr(supp.rate)}</strong> of the bonus — for state withholding (${src}).${extra}</p>`,
      `<p><strong>${state.name} withholds ${pctStr(supp.rate)} flat.</strong> On a stand-alone bonus, ${state.name} takes a straight <strong>${pctStr(supp.rate)}</strong> for state income tax (${src}).${extra}</p>`,
      `<p><strong>The ${state.name} rate: ${pctStr(supp.rate)}.</strong> ${src} has ${state.name} employers hold back a flat <strong>${pctStr(supp.rate)}</strong> on a separately paid bonus.${extra}</p>`,
      `<p><strong>${state.name} keeps it simple: ${pctStr(supp.rate)}.</strong> A separately paid bonus is subject to one flat state rate in ${state.name}, <strong>${pctStr(supp.rate)}</strong> (${src}).${extra}</p>`
    ]);
  } else if (supp.special === 'ca_dual') {
    st = `<p><strong>California: two rates.</strong> California withholds <strong>10.23%</strong> on bonuses and stock options, and <strong>6.6%</strong> on other supplemental wages (${src}). SDI is also withheld but is not an income tax.</p>`;
  } else if (supp.special === 'pct_of_federal') {
    st = `<p><strong>Vermont: 30% of the federal amount.</strong> Vermont's supplemental withholding is <strong>30% of the federal income tax withheld</strong> on the bonus, not a percent of the bonus — about 6.6% of the bonus on the flat 22% federal (6% for nonqualified deferred comp), per ${src}.</p>`;
  } else if (supp.special === 'wi_banded') {
    st = `<p><strong>Wisconsin: a graduated rate.</strong> Wisconsin sets the supplemental rate by annual gross wages — <strong>3.54%</strong> under $12,760, <strong>4.65%</strong> to $25,520, <strong>5.30%</strong> to $280,950, and <strong>7.65%</strong> above that (${src}).</p>`;
  } else {
    st = pickFrame(state.slug, 'btst_r', [
      `<p><strong>${state.name}: the aggregate method.</strong> ${state.name} publishes no separate bonus rate, so a bonus is withheld as if it were ordinary wages.${supp.incomeRate ? ` Because ${state.name} taxes income at a flat ${pctStr(supp.incomeRate)}, a separately paid bonus is effectively withheld near ${pctStr(supp.incomeRate)}.` : ''}</p>`,
      `<p><strong>${state.name}: no separate bonus rate.</strong> With no published supplemental rate, ${state.name} withholds a bonus using the aggregate method — combined with your regular pay.${supp.incomeRate ? ` Its flat ${pctStr(supp.incomeRate)} income tax means a separately paid bonus is withheld close to ${pctStr(supp.incomeRate)}.` : ''}</p>`,
      `<p><strong>${state.name} folds the bonus into regular pay.</strong> Lacking a flat supplemental rate, ${state.name} uses the aggregate method: withholding is figured on your wages plus the bonus.${supp.incomeRate ? ` At its ${pctStr(supp.incomeRate)} flat rate, that lands a bonus near ${pctStr(supp.incomeRate)}.` : ''}</p>`
    ]);
    // Bracket-income regular states carry no incomeRate — describe the actual
    // graduated schedule (bracket COUNT + top rate) so these pages differ in
    // words, not just masked digits.
    if (!supp.incomeRate && state.tax && state.tax.type === 'bracket' && state.tax.brackets && state.tax.brackets.single) {
      const b = state.tax.brackets.single;
      const topRate = b[b.length - 1].rate;
      st = st.replace('</p>', ` ${state.name}'s income tax is graduated across ${numWord(b.length)} ${state.name} brackets topping out at ${pctStr(topRate)}, so an aggregated bonus is withheld somewhere along that schedule.</p>`);
    }
  }
  const heading = pickFrame(state.slug, 'bthowH', [
    `How a ${state.name} bonus is withheld: 22% federal + ${bonusRateWord(supp)}`,
    `What comes out of a ${state.name} bonus in ${year}`,
    `${state.name} bonus withholding, piece by piece`,
    `Breaking down the withholding on a ${state.name} bonus`,
    `The three cuts on a ${state.name} bonus: federal, state, and FICA`
  ]);
  const close = pickFrame(state.slug, 'bthowC', [
    `<p>For your regular salary rather than a bonus, use the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a>.</p>`,
    `<p>The <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a> covers take-home pay on a normal ${state.name} paycheck.</p>`,
    `<p>Working out a whole paycheck? See the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a>.</p>`,
    `<p>For everyday pay instead of a bonus, the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a> is the tool to use.</p>`,
    `<p>Need your normal take-home instead? Try the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a>.</p>`
  ]);
  return `<section class="prose"><h2>${heading}</h2>${bonusFederalPara(state)}${st}${bonusFicaPara(state)}${close}</section>`;
}

function bonusNeighborTable(state, supp, roster, builtSlugs, taxData, suppData) {
  const neigh = (STATE_NEIGHBORS[state.slug] || []).filter((s) => builtSlugs.has(s)).slice(0, 3);
  const slugs = [state.slug, ...neigh];
  const methodPhrase = (sp) => {
    if (sp.method === 'none') return 'no state income tax';
    if (sp.method === 'flat') return `flat ${pctStr(sp.rate)}`;
    if (sp.special === 'ca_dual') return '10.23% / 6.6%';
    if (sp.special === 'pct_of_federal') return '30% of federal';
    if (sp.special === 'wi_banded') return 'graduated 3.54–7.65%';
    return sp.incomeRate ? `aggregate (~${pctStr(sp.incomeRate)})` : 'aggregate method';
  };
  const rows = slugs.map((sl) => {
    const sp = suppData.states[sl];
    const r = computeBonus({ bonus: 10000, regIncome: 70000, filingStatus: 'single', stateSlug: sl }, taxData, suppData);
    const nameCell = sl === state.slug ? `<strong>${sp.name}</strong>` : `<a href="/${sl}-bonus-tax-calculator/">${sp.name}</a>`;
    return `<tr><td>${nameCell}</td><td>${methodPhrase(sp)}</td><td>${usd0(r.withheld.state)}</td><td>${usd0(r.withheld.total)}</td></tr>`;
  }).join('');
  const nbrNames = neigh.map((s) => suppData.states[s].name);
  const nbrList = nbrNames.length ? nbrNames.slice(0, -1).join(', ') + (nbrNames.length > 1 ? ' and ' : '') + nbrNames[nbrNames.length - 1] : 'nearby states';
  const heading = pickFrame(state.slug, 'btnbrH', [
    `${state.name} vs. ${nbrList}: bonus withholding compared`,
    `How ${state.name} bonus withholding stacks up against ${nbrList}`,
    `${state.name} and ${nbrList}: a bonus-withholding comparison`,
    `Bonus withholding in ${state.name} next to ${nbrList}`,
    `Cross-border check: ${state.name} vs. ${nbrList} on a bonus`
  ]);
  const intro = pickFrame(state.slug, 'btnbrI', [
    `A single filer earning $70,000 who gets a $10,000 bonus, in ${state.name} and neighboring ${nbrList}:`,
    `Here's a $10,000 bonus on a $70,000 salary compared across ${state.name} and nearby ${nbrList}:`,
    `Side by side, a $70,000 earner's $10,000 bonus in ${state.name} versus ${nbrList}:`,
    `Take a $10,000 bonus for someone on $70,000 and compare ${state.name} with bordering ${nbrList}:`,
    `The same $10,000 bonus and $70,000 salary, in ${state.name} and its neighbors ${nbrList}:`
  ]);
  const foot = pickFrame(state.slug, 'btnbrF', [
    `Total = federal 22% + state + FICA. Illustrative single-filer figures; the income tax you actually owe trues up at filing.`,
    `Total combines the 22% federal, the state line, and FICA. Single-filer estimates — your real income tax settles when you file.`,
    `Figures are the 22% federal plus state plus FICA for a single filer; the income tax you owe reconciles on your return.`,
    `Each total adds the flat federal 22%, the state amount, and FICA; single-filer estimates that true up at filing time.`,
    `Totals stack federal 22%, state, and FICA for a single filer — the actual income tax lands when the return is filed.`
  ]);
  return `<section class="prose"><h2>${heading}</h2>` +
    `<p>${intro}</p>` +
    `<table class="data-table"><thead><tr><th>State</th><th>Bonus method</th><th>State withheld</th><th>Total withheld</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="muted-small">${foot}</p></section>`;
}

function bonusSizeTable(state, supp, taxData, suppData) {
  if (supp.method === 'none') return '';
  const sizes = [5000, 25000, 100000];
  const rows = sizes.map((b) => {
    const r = computeBonus({ bonus: b, regIncome: 70000, filingStatus: 'single', stateSlug: state.slug }, taxData, suppData);
    return `<tr><td>${usd0(b)}</td><td>${usd0(r.withheld.federal)}</td><td>${usd0(r.withheld.state)}</td><td>${usd0(r.withheld.fica)}</td><td>${usd0(r.withheld.total)}</td><td>${(r.withheld.pctOfBonus * 100).toFixed(1)}%</td></tr>`;
  }).join('');
  const heading = pickFrame(state.slug, 'btsizeH', [
    `${state.name} bonus withholding at $5,000, $25,000 and $100,000`,
    `What ${state.name} holds back on a $5,000, $25,000, or $100,000 bonus`,
    `${state.name} bonus withholding across three bonus sizes`,
    `Three bonus sizes in ${state.name}: $5,000, $25,000 and $100,000 withheld`,
    `How ${state.name} withholding scales from a $5,000 to a $100,000 bonus`
  ]);
  const intro = pickFrame(state.slug, 'btsizeI', [
    `What's held back from three bonus sizes in ${state.name} (single filer, $70,000 salary):`,
    `Withholding on a $5,000, $25,000, and $100,000 bonus in ${state.name} for a single filer earning $70,000:`,
    `For a single filer on a $70,000 salary, here's the ${state.name} withholding at three bonus amounts:`,
    `Here's the ${state.name} bite on a $5,000, $25,000, and $100,000 bonus (single filer, $70,000 salary):`,
    `Three bonuses — $5,000, $25,000, $100,000 — and what ${state.name} withholds from each on a $70,000 salary:`
  ]);
  const foot = pickFrame(state.slug, 'btsizeF', [
    `The % shifts as Social Security stops at the wage base; the income-tax portion still trues up when you file.`,
    `That percentage moves once Social Security caps out at the wage base, and the income-tax slice still settles at filing.`,
    `The share changes because Social Security ends at the wage base; the income tax reconciles on your return either way.`,
    `The rate drifts as Social Security hits its annual cap, but the income-tax part still reconciles at filing.`,
    `Watch the percentage fall once Social Security maxes out; the income-tax slice trues up when you file regardless.`
  ]);
  return `<section class="prose"><h2>${heading}</h2>` +
    `<p>${intro}</p>` +
    `<table class="data-table"><thead><tr><th>Bonus</th><th>Federal</th><th>${state.name}</th><th>FICA</th><th>Total</th><th>% of bonus</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="muted-small">${foot}</p></section>`;
}

function bonusSections(sections, slug) {
  const ordered = orderAncillary(slug, sections).filter(Boolean);
  const half = Math.ceil(ordered.length / 2);
  return { a: ordered.slice(0, half).join('\n'), b: ordered.slice(half).join('\n') };
}

// Pick worked-example inputs that (a) vary per state and (b) ALWAYS land on a
// genuine refund or amount-owed (never a zero-delta wash), so the example
// illustrates the tool's whole point. Deterministic per slug: the candidate
// (bonus, salary) grid is shuffled by a slug hash and the first pair clearing a
// real delta threshold wins, so same-bucket states get different figures.
function bonusExampleInputs(slug, taxData, suppData) {
  const bonuses = [4500, 6500, 9000, 11000, 14000, 18000, 24000];
  const salaries = [28000, 36000, 47000, 61000, 115000, 158000, 215000];
  const combos = [];
  for (const b of bonuses) for (const s of salaries) combos.push([b, s]);
  combos.sort((x, y) => slugHash(slug + x.join('_')) - slugHash(slug + y.join('_')));
  let best = null;
  for (const [bonus, salary] of combos) {
    const r = computeBonus({ bonus, regIncome: salary, filingStatus: 'single', stateSlug: slug }, taxData, suppData);
    const d = Math.abs(r.delta);
    if (d >= 300) return { bonus, salary, r };            // clear, non-trivial delta
    if (!best || d > best.d) best = { bonus, salary, r, d };
  }
  return best;                                            // fallback: largest delta found
}

// Multiple phrasings per delta branch so same-bucket pages don't share a verdict
// sentence (the old single-string verdict was a top shingle-overlap contributor).
function bonusVerdict(slug, r, deltaAbs) {
  if (Math.abs(r.delta) < 1) return pickFrame(slug, 'btverdZ', [
    `your withholding lands almost exactly on your real income tax — little to refund or owe`,
    `the amount held back and the tax actually due come out nearly even, so there's barely a refund or a balance`,
    `withholding and real tax roughly cancel out — not much to get back, not much to make up`
  ]);
  if (r.refund) return pickFrame(slug, 'btverdR', [
    `about <strong>${deltaAbs}</strong> of income-tax over-withholding comes back as a <strong>refund</strong> when you file`,
    `you over-paid income tax by roughly <strong>${deltaAbs}</strong>, and that returns as a <strong>refund</strong> at filing`,
    `the flat 22% over-shoots your real rate by about <strong>${deltaAbs}</strong>, so that much is a <strong>refund</strong> later`
  ]);
  return pickFrame(slug, 'btverdO', [
    `you'll <strong>owe</strong> about <strong>${deltaAbs}</strong> more at filing, because your real rate beats the 22% withheld`,
    `expect to <strong>owe</strong> roughly <strong>${deltaAbs}</strong> more when you file — your marginal rate runs above the 22% held back`,
    `the 22% withheld falls short of your real rate, leaving about <strong>${deltaAbs}</strong> to <strong>owe</strong> at filing`
  ]);
}

function bonusWorkedExample(state, supp, r, salary) {
  const bonus = r.bonus;
  const w = r.withheld, t = r.trueLiability;
  const deltaAbs = usd0(Math.abs(r.delta));
  const bite = (w.pctOfBonus * 100).toFixed(1);
  const verdict = bonusVerdict(state.slug, r, deltaAbs);
  const stateWLine = supp.method === 'none' ? `$0 state` : `${usd0(w.state)} ${state.name}`;
  const trueStatePart = supp.method === 'none' ? '' : ` + ${state.name} ${usd0(t.state)}`;
  const heading = pickFrame(state.slug, 'btexH', [
    `A ${usd0(bonus)} bonus on a ${usd0(salary)} ${state.name} salary: withheld vs. actually owed`,
    `Worked example: a ${usd0(bonus)} ${state.name} bonus at a ${usd0(salary)} salary`,
    `What a ${usd0(bonus)} bonus really costs on a ${usd0(salary)} ${state.name} income`,
    `${usd0(salary)} salary, ${usd0(bonus)} bonus: the ${state.name} withholding-vs.-tax breakdown`,
    `Run the numbers on a ${usd0(bonus)} bonus for a ${usd0(salary)} earner in ${state.name}`
  ]);
  const intro = pickFrame(state.slug, 'btexI', [
    `Take a single filer in ${state.name} earning ${usd0(salary)} who gets a ${usd0(bonus)} bonus on its own check:`,
    `Say you earn ${usd0(salary)} in ${state.name} and your employer cuts a separate ${usd0(bonus)} bonus check:`,
    `Picture a ${state.name} worker on a ${usd0(salary)} salary handed a ${usd0(bonus)} bonus, paid on its own:`,
    `Here's how a ${usd0(bonus)} bonus plays out for a single filer making ${usd0(salary)} in ${state.name}:`
  ]);
  const b1 = pickFrame(state.slug, 'btexB1', [
    `<li><strong>Withheld now:</strong> ${usd0(w.federal)} federal (22%) + ${stateWLine} + ${usd0(w.fica)} FICA = <strong>${usd0(w.total)}</strong> held back, leaving about ${usd0(w.keep)} in hand — a ${bite}% bite.</li>`,
    `<li><strong>Off the top:</strong> ${usd0(w.total)} disappears at payday — ${usd0(w.federal)} federal, ${stateWLine}, and ${usd0(w.fica)} FICA — so roughly ${usd0(w.keep)} actually reaches you, a ${bite}% cut.</li>`,
    `<li><strong>On the check:</strong> the employer holds back ${usd0(w.federal)} for federal, ${stateWLine}, and ${usd0(w.fica)} for FICA — ${usd0(w.total)} in all (${bite}% of the bonus), leaving about ${usd0(w.keep)}.</li>`
  ]);
  const b2 = pickFrame(state.slug, 'btexB2', [
    `<li><strong>What it actually costs:</strong> the true income tax on the bonus is about ${usd0(t.incomeTax)} (federal ${usd0(t.federal)}${trueStatePart}), plus the same ${usd0(t.fica)} FICA.</li>`,
    `<li><strong>The real bill:</strong> at filing the bonus is taxed roughly ${usd0(t.incomeTax)} in income tax (federal ${usd0(t.federal)}${trueStatePart}), with the identical ${usd0(t.fica)} FICA on top.</li>`,
    `<li><strong>At tax time:</strong> the bonus's actual income tax works out near ${usd0(t.incomeTax)} (federal ${usd0(t.federal)}${trueStatePart}) — and FICA is the same ${usd0(t.fica)} as before.</li>`
  ]);
  const ficaNote = pickFrame(state.slug, 'btexFica', [
    `FICA (${usd0(w.fica)}) stays either way — it's a real tax.`,
    `The ${usd0(w.fica)} FICA doesn't move — that part is owed no matter what.`,
    `Either way, the ${usd0(w.fica)} FICA is final and won't come back.`
  ]);
  const b3 = `<li><strong>The gap:</strong> ${verdict}. ${ficaNote}</li>`;
  const close = pickFrame(state.slug, 'btexC', [
    `<p class="muted-small">Illustrative single-filer figures from this page's engine; your result depends on your total income and filing status.</p>`,
    `<p class="muted-small">Example single-filer numbers from the calculator above; your own refund or bill shifts with your total income and filing status.</p>`,
    `<p class="muted-small">A single-filer illustration only — drop your real salary, bonus, and filing status into the tool above for your figure.</p>`
  ]);
  return `<section class="prose"><h2>${heading}</h2><p>${intro}</p><ul>${b1}${b2}${b3}</ul>${close}</section>`;
}

function bonusFaqEntries(state, supp, year) {
  const rateStrPlain = supp.method === 'none' ? '0%'
    : supp.method === 'flat' ? pctStr(supp.rate)
    : supp.special === 'ca_dual' ? '10.23% (6.6% on other supplemental pay)'
    : supp.special === 'pct_of_federal' ? '30% of the federal withholding'
    : supp.special === 'wi_banded' ? '3.54%–7.65% by income band'
    : supp.incomeRate ? `about ${pctStr(supp.incomeRate)} (aggregate method)` : 'the aggregate method';
  const e = [];
  if (supp.method === 'none') {
    e.push(pickFrame(state.slug, 'btfaq1n', [
      { q: `How much is withheld from a bonus in ${state.name}?`,
        a: `${state.name} has no state income tax, so $0 is withheld for state tax. Federally, a separately paid bonus is withheld at a flat 22% (37% above $1,000,000/yr), plus 7.65% FICA — a prepayment, not your final tax.`,
        html: `${state.name} has no state income tax, so <strong>$0</strong> is withheld for state tax. Federally, a separately paid bonus is <a href="/tax-glossary/#withholding">withheld</a> at a flat <strong>22%</strong> (37% above $1,000,000/yr), plus 7.65% <a href="/tax-glossary/#fica">FICA</a> — a prepayment, not your final tax.` },
      { q: `How much tax comes out of a bonus in ${state.name}?`,
        a: `Nothing goes to ${state.name}, which has no income tax. Federal withholding is a flat 22% on a separately paid bonus (37% past $1,000,000 a year) and FICA is 7.65% — the 22% is a prepayment that trues up at filing.`,
        html: `Nothing goes to ${state.name}, which has no income tax. Federal <a href="/tax-glossary/#withholding">withholding</a> is a flat <strong>22%</strong> on a separately paid bonus (37% past $1,000,000 a year) and <a href="/tax-glossary/#fica">FICA</a> is 7.65% — the 22% is a prepayment that trues up at filing.` },
      { q: `What's the bonus withholding in ${state.name}?`,
        a: `State withholding is zero because ${state.name} taxes no wage income. The only deductions are the flat 22% federal (37% on bonus dollars above $1,000,000/yr) and 7.65% FICA, and the 22% is refundable if your real rate is lower.`,
        html: `State <a href="/tax-glossary/#withholding">withholding</a> is zero because ${state.name} taxes no wage income. The only deductions are the flat <strong>22%</strong> federal (37% on bonus dollars above $1,000,000/yr) and 7.65% <a href="/tax-glossary/#fica">FICA</a>, and the 22% is refundable if your real rate is lower.` }
    ]));
  } else {
    e.push(pickFrame(state.slug, 'btfaq1s', [
      { q: `What is the ${state.name} bonus tax rate in ${year}?`,
        a: `${state.name} withholds ${rateStrPlain} on a separately paid bonus, on top of the flat 22% federal rate (37% above $1,000,000/yr) and 7.65% FICA. That is withholding, not your final tax.`,
        html: `${state.name} withholds <strong>${rateStrPlain}</strong> on a separately paid bonus, on top of the flat <strong>22%</strong> federal rate (37% above $1,000,000/yr) and 7.65% <a href="/tax-glossary/#fica">FICA</a>. That's <a href="/tax-glossary/#withholding">withholding</a>, not your final tax.` },
      { q: `How much is withheld from a bonus in ${state.name} for ${year}?`,
        a: `On a separately paid bonus, ${state.name} takes ${rateStrPlain}, the federal side takes a flat 22% (37% beyond $1,000,000/yr), and FICA takes 7.65%. Those are withholding rates that settle up when you file — not a final tax.`,
        html: `On a separately paid bonus, ${state.name} takes <strong>${rateStrPlain}</strong>, the federal side takes a flat <strong>22%</strong> (37% beyond $1,000,000/yr), and <a href="/tax-glossary/#fica">FICA</a> takes 7.65%. Those are <a href="/tax-glossary/#withholding">withholding</a> rates that settle up when you file — not a final tax.` },
      { q: `What rate does ${state.name} withhold on a bonus in ${year}?`,
        a: `${state.name}'s supplemental withholding is ${rateStrPlain}, added to the flat 22% federal prepayment (37% on bonus pay over $1,000,000/yr) and 7.65% FICA. Only the income-tax portion is a prepayment; it trues up at your real rate.`,
        html: `${state.name}'s supplemental <a href="/tax-glossary/#withholding">withholding</a> is <strong>${rateStrPlain}</strong>, added to the flat <strong>22%</strong> federal prepayment (37% on bonus pay over $1,000,000/yr) and 7.65% <a href="/tax-glossary/#fica">FICA</a>. Only the income-tax portion is a prepayment; it trues up at your real rate.` }
    ]));
  }
  e.push(pickFrame(state.slug, 'btfaq2', [
    { q: `Are bonuses taxed at a higher rate in ${state.name}?`, a: `No. A bonus is ordinary income taxed at your normal marginal rate when you file; the flat 22% withheld is a prepayment, not a tax rate.`,
      html: `No. A bonus is ordinary income taxed at your normal <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> when you file; the flat 22% <a href="/tax-glossary/#withholding">withheld</a> is a prepayment, not a tax rate.` },
    { q: `Does ${state.name} tax bonuses more than regular pay?`, a: `No. There's no separate, higher tax on bonuses — a bonus is just withheld at a flat rate up front, then taxed like any income at your marginal rate.`,
      html: `No. There's no separate, higher tax on bonuses — a bonus is just <a href="/tax-glossary/#withholding">withheld</a> at a flat rate up front, then taxed like any income at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>.` },
    { q: `Is there a special bonus tax rate in ${state.name}?`, a: `No. The 22% federal and the state supplemental rate are withholding defaults, not rates that apply only to bonuses. Your real tax is your ordinary marginal rate.`,
      html: `No. The 22% federal and the state supplemental rate are <a href="/tax-glossary/#withholding">withholding</a> defaults, not rates that apply only to bonuses. Your real tax is your ordinary <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>.` },
    { q: `Is a ${state.name} bonus taxed differently from my salary?`, a: `Not in the end. It may be withheld differently (a flat rate up front), but at filing a bonus is taxed exactly like the rest of your income, at your marginal rate.`,
      html: `Not in the end. It may be <a href="/tax-glossary/#withholding">withheld</a> differently (a flat rate up front), but at filing a bonus is taxed exactly like the rest of your income, at your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>.` }
  ]));
  e.push(pickFrame(state.slug, 'btfaq3', [
    { q: `Will I get some of my ${state.name} bonus withholding back?`, a: `Often, yes — if your true marginal rate is below the 22% withheld, the difference refunds at filing; above 22%, you owe it. FICA is a true tax and never refunds.`,
      html: `Often, yes — if your true <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> is below the 22% withheld, the difference refunds at filing; above 22%, you owe it. <a href="/tax-glossary/#fica">FICA</a> is a true tax and never refunds.` },
    { q: `Do I get a refund on my ${state.name} bonus?`, a: `If 22% was more than your real rate, yes — the over-withheld income tax returns at filing. If your marginal rate tops 22%, you owe the shortfall. FICA doesn't come back either way.`,
      html: `If 22% was more than your real rate, yes — the over-withheld income tax returns at filing. If your <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> tops 22%, you owe the shortfall. <a href="/tax-glossary/#fica">FICA</a> doesn't come back either way.` },
    { q: `Why might I owe tax on my ${state.name} bonus at filing?`, a: `Because 22% is only a prepayment. If your true marginal rate is above 22% (high earners), the flat withholding falls short and you owe the rest; below 22%, you're over-withheld and get money back.`,
      html: `Because 22% is only a prepayment. If your true <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a> is above 22% (high earners), the flat <a href="/tax-glossary/#withholding">withholding</a> falls short and you owe the rest; below 22%, you're over-withheld and get money back.` },
    { q: `Does my ${state.name} bonus ever come back at tax time?`, a: `The income-tax part can. If the flat 22% over-withheld relative to your real marginal rate, the excess is refunded; if you're a high earner above 22%, you pay more. FICA is never refunded.`,
      html: `The income-tax part can. If the flat 22% over-<a href="/tax-glossary/#withholding">withheld</a> relative to your real <a href="/tax-glossary/#marginal-tax-rate">marginal rate</a>, the excess is refunded; if you're a high earner above 22%, you pay more. <a href="/tax-glossary/#fica">FICA</a> is never refunded.` }
  ]));
  if (supp.special === 'pct_of_federal') e.push({ q: `Why is Vermont's bonus withholding based on the federal amount?`, a: `Vermont sets it at 30% of the federal income tax withheld on the bonus, rather than a percent of the bonus. On the flat 22% federal, that's about 6.6% of the bonus.` });
  else if (supp.special === 'wi_banded') e.push({ q: `How does Wisconsin's graduated bonus rate work?`, a: `Wisconsin picks the rate from your annual gross wages: 3.54% under $12,760, 4.65% to $25,520, 5.30% to $280,950, and 7.65% above that.` });
  else if (supp.special === 'ca_dual') e.push({ q: `Does California withhold a different rate on stock options?`, a: `California uses 10.23% for bonuses and stock options, and 6.6% for other supplemental wages. Pick the payment type in the calculator to switch.` });
  else if (state.slug === 'north-carolina') e.push({ q: `Is North Carolina's 4.09% bonus rate the same as its income tax rate?`, a: `No. The flat income tax is 3.99%, but the supplemental withholding rate is a distinct 4.09% (NC-30, 2026).` });
  else if (supp.method === 'regular') e.push({ q: `Does ${state.name} have a separate bonus withholding rate?`, a: `No. ${state.name} has no separate supplemental rate, so a bonus is withheld with the aggregate method — as if it were part of your regular wages${supp.incomeRate ? `, effectively near ${pctStr(supp.incomeRate)}` : ''}.` });
  else if (supp.method === 'none') e.push({ q: `Does ${state.name} tax my bonus at all?`, a: `${state.name} charges no state income tax on it. You still owe federal income tax (a flat 22% is withheld, trued up at filing) and FICA on the bonus.` });
  else e.push({ q: `Does a bonus push my ${state.name} income into a higher bracket?`, a: `No. Brackets are marginal — only the dollars above each threshold are taxed higher. A bonus never re-taxes income you already earned.` });
  return orderAncillary(state.slug, e);
}

function bonusFaqBlock(state, entries) {
  const items = entries.map((en) => `<h3>${escHtml(en.q)}</h3><p>${en.html || escHtml(en.a)}</p>`).join('');
  return `<section class="prose"><h2>${state.name} bonus tax FAQ</h2>${items}</section>`;
}

function bonusSourcesBlock(state, supp) {
  const lis = [];
  lis.push(`<li><a href="https://www.irs.gov/publications/p15" rel="nofollow noopener" target="_blank">IRS Publication 15 (2026) — Supplemental Wages</a> (flat 22% / 37% above $1M)</li>`);
  if (supp._sourceUrl) {
    lis.push(`<li>${state.name} supplemental rate: <a href="${escHtml(supp._sourceUrl)}" rel="nofollow noopener" target="_blank">${escHtml(supp.source || 'state source')}</a></li>`);
  } else if (supp.method === 'regular' || supp.method === 'none') {
    lis.push(`<li>${state.name} income-tax status &amp; rate: see the <a href="/${state.slug}-paycheck-calculator/">${state.name} paycheck calculator</a> sources (state DOR, verified 2026-06-16).</li>`);
  }
  if (supp.singleSourced) {
    lis.push(`<li><em>${state.name}'s supplemental rate is sourced from a payroll-industry reference; verify with the ${state.name} Department of Revenue for the current year.</em></li>`);
  }
  return `<section class="sources"><h2>Sources</h2><ul>${lis.join('')}</ul></section>`;
}

function bonusStateLinks(roster, builtSlugs, currentSlug) {
  return neighborStates(roster, builtSlugs, currentSlug)
    .map((s) => builtSlugs.has(s.slug)
      ? `<a href="/${s.slug}-bonus-tax-calculator/">${s.name}</a>`
      : `<span title="Coming soon">${s.name}</span>`)
    .join('\n');
}

// Full 51-state grid for the hub page.
function bonusHubLinks(roster, builtSlugs) {
  return roster
    .filter((s) => builtSlugs.has(s.slug))
    .map((s) => `<a href="/${s.slug}-bonus-tax-calculator/">${s.name}</a>`)
    .join('\n');
}

// --- Content-hashed /assets/*.js pipeline -----------------------------------
// FIXES A LIVE P0: every asset file used to ship as a flat, unhashed name on a
// blind `Cache-Control: max-age=86400` (see the old _headers block). A shared
// engine like obbba-deduction.js is imported by 8+ tool bootstrap files
// (car-loan-interest-calculator.js, charitable-deduction-calculator.js,
// overtime-tax-calculator.js, tips-tax-calculator.js, salt-cap-calculator.js,
// senior-deduction-calculator.js, w4-overtime-tips-withholding-calculator.js,
// qcd-comparison.js) — when it gains a new export, any visitor whose browser
// already cached yesterday's copy keeps using it for up to 24h: the new page's
// `import { X } from '/assets/obbba-deduction.js'` resolves to the STALE file,
// X is undefined, and the calculator silently does nothing. Reproduced live on
// the QCD and Charitable Deduction pages (2026-07-11 audit).
//
// Fix: every /assets/*.js file (leaf engines, engines-that-import-engines, and
// the per-tool bootstrap files themselves — see the site-wide-vs-scoped-down
// note below) gets its dist filename suffixed with a content hash, e.g.
// `obbba-deduction.a3f9c1e2b7.js`. A deploy that changes a shared file's bytes
// produces a brand-new URL no browser has ever cached — the staleness class is
// gone by construction, not by tuning cache headers.
//
// Dependency order: some engines import other engines (qcd-comparison.js ->
// obbba-deduction.js -> paycheck-engine.js is the deepest chain found, depth 2).
// A file's own hash depends on its FINAL (reference-rewritten) bytes, so leaves
// must be hashed first, then rewritten into their importers, whose own hash is
// then computed from the rewritten content. registerAsset() queues every file
// build.js used to plain-`cp()` into dist/assets/; hashAssets() below resolves
// the dependency graph by regex rather than assuming a fixed depth.
//
// Scope: ALL first-party /assets/*.js files are hashed (not just the 7 engines
// imported by 2+ tools) — once the hash-rewrite machinery exists, a single-
// consumer file (e.g. bonus-tax.js) costs no extra code to also hash, and it
// closes the same staleness risk for its one tool. The vendor UMD bundles
// (jsPDF, pdf.js + its worker, docx, qrcode, marked) are ALSO hashed: they have
// no internal `import` statements (self-contained bundles), so they are
// trivial leaves under the exact same "quoted-path-in/-quotes" rewrite rule —
// including the one non-import reference (pdf-to-word.js's runtime
// `workerSrc = '/assets/pdf.worker.min.js'` string assignment), which the
// generalized quote-anchored regex catches identically to an `import`
// specifier. Only styles.css is left unhashed (CSS, out of this fix's declared
// `/assets/*.js` scope) — it moves to a short-lived revalidate-friendly cache
// instead of the old blind 24h (see the _headers rewrite below).
const ASSET_QUEUE = []; // { dir: 'assets' | 'engine', name: 'x.js' }, in registration order
function registerAsset(dir, name) {
  ASSET_QUEUE.push({ dir, name });
}

// Matches a fully quote-delimited reference to `basename` — `import ... from
// '/assets/x.js'`, `from './x.js'` (engine-to-engine relative imports), or a
// plain runtime string like `workerSrc = '/assets/pdf.worker.min.js'`. Anchored
// on a matching quote immediately before AND after the path, so it can never
// touch an unquoted, unrelated substring (e.g. a `//# sourceMappingURL=x.js.map`
// comment in a vendor bundle is not quote-delimited and never matches).
function assetRefRegex(basename) {
  const esc = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(["'\`])(\\./|/assets/)${esc}\\1`, 'g');
}

// Resolves ASSET_QUEUE in dependency order (leaves first), rewrites each
// file's internal references to already-hashed dependency names, hashes the
// resulting bytes, and writes `<base>.<hash>.<ext>` into dist/assets/. Returns
// a Map of original basename -> hashed basename for the HTML rewrite pass.
async function hashAssets(queue) {
  const raw = new Map();
  for (const { dir, name } of queue) raw.set(name, await read(join(SRC, dir, name)));

  const deps = new Map();
  for (const { name } of queue) {
    const refs = new Set();
    for (const other of queue) {
      if (other.name === name) continue;
      if (assetRefRegex(other.name).test(raw.get(name))) refs.add(other.name);
    }
    deps.set(name, refs);
  }

  const hashMap = new Map();
  const pending = new Map(queue.map((q) => [q.name, q]));
  const maxIterations = pending.size + 5;
  for (let iteration = 0; pending.size; iteration++) {
    if (iteration > maxIterations) {
      throw new Error(`Asset dependency cycle detected among: ${[...pending.keys()].join(', ')}`);
    }
    let advanced = false;
    for (const [name] of [...pending]) {
      const unresolved = [...deps.get(name)].filter((d) => !hashMap.has(d));
      if (unresolved.length) continue; // wait for its dependencies to be hashed first
      let content = raw.get(name);
      for (const dep of deps.get(name)) {
        content = content.replace(assetRefRegex(dep), (_m, quote, prefix) => `${quote}${prefix}${hashMap.get(dep)}${quote}`);
      }
      const hash = createHash('sha256').update(content).digest('hex').slice(0, 10);
      const dot = name.lastIndexOf('.');
      const hashedName = `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
      hashMap.set(name, hashedName);
      await writeFile(join(DIST, 'assets', hashedName), content);
      pending.delete(name);
      advanced = true;
    }
    if (!advanced) throw new Error(`Asset dependency cycle detected among: ${[...pending.keys()].join(', ')}`);
  }
  return hashMap;
}

// Final pass: walk the whole dist/ tree and rewrite every `src="/assets/X.js"`
// (or similarly-quoted) reference to its hashed name. Run once at the very end
// of the build instead of touching each of the ~110 template writeFile() call
// sites individually — every HTML file (main tool pages, /embed/ pages, state
// pages, home, static content pages) goes through this single choke point, so
// nothing can slip through by having been written via a path this pass doesn't
// know about.
async function rewriteHtmlAssetRefs(dir, hashMap) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await rewriteHtmlAssetRefs(full, hashMap);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    let html = await read(full);
    let changed = false;
    for (const [orig, hashed] of hashMap) {
      const re = new RegExp(`(["'])/assets/${orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`, 'g');
      if (re.test(html)) {
        html = html.replace(re, (_m, quote) => `${quote}/assets/${hashed}${quote}`);
        changed = true;
      }
    }
    if (changed) await writeFile(full, html);
  }
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
  const carLoanTpl = await read(join(SRC, 'templates', 'car-loan-interest-calculator.html'));
  const embedCarLoanTpl = await read(join(SRC, 'templates', 'embed', 'car-loan-interest-calculator.html'));
  const charitableTpl = await read(join(SRC, 'templates', 'charitable-deduction-calculator.html'));
  const embedCharitableTpl = await read(join(SRC, 'templates', 'embed', 'charitable-deduction-calculator.html'));
  const qcdTpl = await read(join(SRC, 'templates', 'qcd-vs-charitable-deduction-calculator.html'));
  const embedQcdTpl = await read(join(SRC, 'templates', 'embed', 'qcd-vs-charitable-deduction-calculator.html'));
  const depCareTpl = await read(join(SRC, 'templates', 'dependent-care-fsa-vs-credit-calculator.html'));
  const embedDepCareTpl = await read(join(SRC, 'templates', 'embed', 'dependent-care-fsa-vs-credit-calculator.html'));
  const w4OtTipsTpl = await read(join(SRC, 'templates', 'w4-overtime-tips-withholding-calculator.html'));
  const embedW4OtTipsTpl = await read(join(SRC, 'templates', 'embed', 'w4-overtime-tips-withholding-calculator.html'));
  const rothCatchupTpl = await read(join(SRC, 'templates', 'roth-catchup-calculator.html'));
  const embedRothCatchupTpl = await read(join(SRC, 'templates', 'embed', 'roth-catchup-calculator.html'));
  const bonusTaxTpl = await read(join(SRC, 'templates', 'bonus-tax-calculator.html'));
  const bonusTaxStateTpl = await read(join(SRC, 'templates', 'bonus-tax-calculator-state.html'));
  const embedBonusTaxTpl = await read(join(SRC, 'templates', 'embed', 'bonus-tax-calculator.html'));
  const form1099Tpl = await read(join(SRC, 'templates', '1099-threshold-checker.html'));
  const embedForm1099Tpl = await read(join(SRC, 'templates', 'embed', '1099-threshold-checker.html'));
  const ssMaxoutTpl = await read(join(SRC, 'templates', 'ss-wage-base-calculator.html'));
  const embedSsMaxoutTpl = await read(join(SRC, 'templates', 'embed', 'ss-wage-base-calculator.html'));
  const embedGalleryTpl = await read(join(SRC, 'templates', 'embed-gallery.html'));
  const overtimeStudyTpl = await read(join(SRC, 'templates', 'data-overtime-tax-by-state.html'));
  const tipsStudyTpl = await read(join(SRC, 'templates', 'data-tips-tax-by-state.html'));
  const obbba = await readJSON(join(SRC, 'data', 'obbba-deductions-2026.json'));
  // Client-injected JSON for the OBBBA tools (internal _keys stripped).
  const OBBBA_FED_JSON = JSON.stringify(stripInternal(obbba.federal));
  const OBBBA_STATES_JSON = JSON.stringify(stripInternal(obbba.states));
  const OBBBA_FED_TAX_JSON = JSON.stringify(stripInternal({ standardDeduction: taxData.federal.standardDeduction, brackets: taxData.federal.brackets }));
  // OBBBA §70404 dependent-care system: §129 DCFSA exclusion + §21 CDCTC. Its own
  // sibling dataset (a nonrefundable CREDIT + an income+FICA EXCLUSION — not the
  // deduction shape of obbba-deductions). The DCFSA's FICA side needs the fica
  // table too, so DC_FED_JSON carries standardDeduction + brackets + fica.
  const depCare = await readJSON(join(SRC, 'data', 'dependent-care-2026.json'));
  const DC_JSON = JSON.stringify(stripInternal({ dcfsa: depCare.dcfsa, cdctc: depCare.cdctc, interaction: depCare.interaction }));
  const DC_FED_JSON = JSON.stringify(stripInternal({ standardDeduction: taxData.federal.standardDeduction, brackets: taxData.federal.brackets, fica: taxData.federal.fica }));
  // SECURE 2.0 §603 mandatory Roth catch-up params (separate rule, its own dataset).
  const secure2 = await readJSON(join(SRC, 'data', 'secure2-catchup-2026.json'));
  const ROTHCATCHUP_JSON = JSON.stringify(stripInternal(secure2.rothCatchUp));
  // 1099-K (IRC §6050W, OBBBA §70432) / 1099-NEC-MISC (IRC §6041/§6041A, OBBBA
  // §70433) threshold checker — a STANDALONE reporting-trigger lookup, not a
  // deduction, so it deliberately does NOT read obbba-deductions-2026.json or
  // taxData.federal (no bracket/FICA reuse). Reuses the plain state name/abbr
  // roster (states.json, already loaded above as `roster`) just to populate the
  // optional state-overlay dropdown — not the OBBBA conformity dataset.
  const form1099 = await readJSON(join(SRC, 'data', 'form-1099-thresholds.json'));
  const FORM1099_JSON = JSON.stringify(stripInternal(form1099));
  const FORM1099_STATES_JSON = JSON.stringify(roster.map((s) => ({ name: s.name, abbr: s.abbr })));
  // Social Security wage-base max-out date calculator — a STANDALONE calendar
  // forward-walk (new ss-maxout-engine.js; paycheck-engine.js has annual FICA
  // math but no pay-date scheduling at all). Reuses ONLY the existing
  // federal.fica.socialSecurity {rate, wageBase} straight out of
  // tax-data-2026.json — no duplicate data file. Keyed by taxYear per the
  // engine's params[taxYear] contract; fixed to 2026 (2027's wage base isn't
  // published until ~Oct 2026, and a forward pay-date projection has no
  // meaningful use for a closed past year like 2025).
  const SSMAXOUT_PARAMS_JSON = JSON.stringify({
    2026: { wageBase: taxData.federal.fica.socialSecurity.wageBase, ssRate: taxData.federal.fica.socialSecurity.rate }
  });
  // State supplemental (bonus) withholding rates — its own dataset (§ bonus-tax).
  const suppData = await readJSON(join(SRC, 'data', 'state-supplemental-2026.json'));
  // Lean client payload for a supp entry: ONLY the fields the browser engine
  // needs. Keeps build-time provenance (source/verified/singleSourced/notes) out
  // of the shipped page JSON.
  const leanSupp = (s) => {
    const o = { name: s.name, method: s.method };
    if (s.rate != null) o.rate = s.rate;
    if (s.rateOther != null) o.rateOther = s.rateOther;
    if (s.special) o.special = s.special;
    if (s.bands) o.bands = s.bands;
    return o;
  };
  const leanSuppStates = (states) => {
    const out = {};
    for (const [k, v] of Object.entries(states)) out[k] = leanSupp(v);
    return out;
  };
  const suppFederalLean = { flatRate: suppData.federal.flatRate, highRate: suppData.federal.highRate, highThreshold: suppData.federal.highThreshold };
  // All-states payload for the bonus hub + embed (per-state cluster pages inject
  // only their own state, below).
  const BONUS_TAX_ALL_JSON = JSON.stringify({
    taxData: stripInternal({ taxYear: taxData.taxYear, federal: taxData.federal, states: taxData.states }),
    supp: { federal: suppFederalLean, states: leanSuppStates(suppData.states) }
  });
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
  registerAsset('assets', 'app.js');
  registerAsset('assets', 'invoice.js');
  registerAsset('assets', 'images-to-pdf.js');
  registerAsset('assets', 'pdf-to-word.js');
  registerAsset('assets', 'jspdf.umd.min.js');
  registerAsset('assets', 'pdf.min.js');
  registerAsset('assets', 'pdf.worker.min.js');
  registerAsset('assets', 'docx.umd.js');
  registerAsset('assets', 'qr.js');
  registerAsset('assets', 'qrcode.min.js');
  registerAsset('assets', 'circle-crop.js');
  registerAsset('assets', 'photo-maker.js');
  registerAsset('assets', 'image-resizer.js');
  registerAsset('assets', 'image-converter.js');
  registerAsset('assets', 'image-compressor.js');
  registerAsset('assets', 'percentage-calculator.js');
  registerAsset('assets', 'tip-calculator.js');
  registerAsset('assets', 'mortgage-calculator.js');
  registerAsset('assets', 'auto-loan-calculator.js');
  registerAsset('assets', 'debt-payoff-calculator.js');
  registerAsset('assets', 'holiday-countdown.js');
  registerAsset('assets', 'countdown-timer.js');
  registerAsset('assets', 'stopwatch.js');
  registerAsset('assets', 'pomodoro-timer.js');
  registerAsset('engine', 'duration.js');
  registerAsset('assets', 'age-calculator.js');
  registerAsset('assets', 'days-between-dates.js');
  registerAsset('assets', 'time-zone-converter.js');
  registerAsset('engine', 'timezone.js');
  registerAsset('assets', 'date-calculator.js');
  registerAsset('engine', 'date-add.js');
  registerAsset('assets', 'cooking-converter.js');
  registerAsset('engine', 'percentage-math.js');
  registerAsset('engine', 'tip-math.js');
  registerAsset('engine', 'date-math.js');
  registerAsset('engine', 'cooking-units.js');
  registerAsset('assets', 'recipe-scaler.js');
  registerAsset('engine', 'recipe-scale.js');
  registerAsset('assets', 'unit-converter.js');
  registerAsset('engine', 'units.js');
  registerAsset('assets', 'bmi-calculator.js');
  registerAsset('engine', 'bmi.js');
  registerAsset('assets', 'due-date-calculator.js');
  registerAsset('engine', 'due-date.js');
  registerAsset('assets', 'ovulation-calculator.js');
  registerAsset('engine', 'ovulation.js');
  registerAsset('assets', 'calorie-calculator.js');
  registerAsset('engine', 'calories.js');
  registerAsset('assets', 'ideal-weight-calculator.js');
  registerAsset('engine', 'ideal-weight.js');
  registerAsset('assets', 'gpa-calculator.js');
  registerAsset('engine', 'gpa.js');
  registerAsset('assets', 'inflation-calculator.js');
  registerAsset('engine', 'inflation.js');
  registerAsset('engine', 'amortization.js');
  registerAsset('assets', 'compound-interest-calculator.js');
  registerAsset('engine', 'compound-interest.js');
  registerAsset('assets', '401k-calculator.js');
  registerAsset('engine', 'retirement-401k.js');
  registerAsset('assets', 'savings-goal-calculator.js');
  registerAsset('engine', 'savings-goal.js');
  registerAsset('engine', 'paycheck-engine.js');
  registerAsset('engine', 'canvas-math.js');
  registerAsset('engine', 'canvas-editor.js');
  registerAsset('assets', 'signature-maker.js');
  registerAsset('assets', 'salary-to-hourly.js');
  registerAsset('engine', 'wage.js');
  registerAsset('assets', 'sales-tax-calculator.js');
  registerAsset('engine', 'sales-tax.js');
  registerAsset('assets', 'gas-cost-calculator.js');
  registerAsset('engine', 'fuel-cost.js');
  registerAsset('assets', 'password-generator.js');
  registerAsset('engine', 'password.js');
  registerAsset('assets', 'word-counter.js');
  registerAsset('engine', 'text-stats.js');
  registerAsset('assets', 'hours-calculator.js');
  registerAsset('engine', 'timecard.js');
  registerAsset('assets', 'text-case-converter.js');
  registerAsset('assets', 'bionic-reading-converter.js');
  registerAsset('assets', 'roman-numeral-converter.js');
  registerAsset('engine', 'roman.js');
  registerAsset('assets', 'base-converter.js');
  registerAsset('engine', 'number-base.js');
  registerAsset('assets', 'color-converter.js');
  registerAsset('engine', 'color.js');
  registerAsset('assets', 'json-formatter.js');
  registerAsset('engine', 'json-format.js');
  registerAsset('assets', 'uuid-generator.js');
  registerAsset('engine', 'uuid.js');
  registerAsset('assets', 'diff-checker.js');
  registerAsset('engine', 'text-diff.js');
  registerAsset('assets', 'base64-converter.js');
  registerAsset('engine', 'base64.js');
  registerAsset('assets', 'aspect-ratio-calculator.js');
  registerAsset('engine', 'aspect-ratio.js');
  registerAsset('assets', 'discount-calculator.js');
  registerAsset('engine', 'discount.js');
  registerAsset('assets', 'fuel-economy-calculator.js');
  registerAsset('engine', 'fuel-economy.js');
  registerAsset('assets', 'random-number-generator.js');
  registerAsset('engine', 'random-number.js');
  registerAsset('assets', 'paint-calculator.js');
  registerAsset('engine', 'paint.js');
  registerAsset('assets', 'tile-calculator.js');
  registerAsset('engine', 'tile.js');
  registerAsset('assets', 'sleep-calculator.js');
  registerAsset('engine', 'sleep.js');
  registerAsset('assets', 'pace-calculator.js');
  registerAsset('engine', 'pace.js');
  registerAsset('assets', 'fraction-calculator.js');
  registerAsset('engine', 'fraction.js');
  registerAsset('assets', 'lorem-ipsum-generator.js');
  registerAsset('engine', 'lorem.js');
  registerAsset('assets', 'average-calculator.js');
  registerAsset('engine', 'average.js');
  registerAsset('assets', 'morse-code-translator.js');
  registerAsset('engine', 'morse.js');
  registerAsset('assets', 'cagr-calculator.js');
  registerAsset('engine', 'cagr.js');
  registerAsset('assets', 'half-birthday-calculator.js');
  registerAsset('engine', 'half-birthday.js');
  registerAsset('assets', 'rule-of-72-calculator.js');
  registerAsset('engine', 'rule-of-72.js');
  registerAsset('assets', 'words-to-minutes.js');
  registerAsset('engine', 'words-to-time.js');
  registerAsset('assets', 'double-time-pay-calculator.js');
  registerAsset('engine', 'double-time-pay.js');
  registerAsset('assets', 'biweekly-vs-semimonthly.js');
  registerAsset('engine', 'pay-frequency.js');
  registerAsset('assets', 'ez-grader.js');
  registerAsset('engine', 'grading.js');
  registerAsset('assets', 'chronological-age-calculator.js');
  registerAsset('engine', 'chronological-age.js');
  registerAsset('assets', 'debt-avalanche-calculator.js');
  registerAsset('engine', 'debt-avalanche.js');
  registerAsset('assets', 'markdown-to-html.js');
  registerAsset('assets', 'marked.min.js');
  registerAsset('assets', '1099-vs-w2-calculator.js');
  registerAsset('engine', 'obbba-deduction.js');
  registerAsset('engine', 'roth-catchup.js');
  registerAsset('assets', 'overtime-tax-calculator.js');
  registerAsset('assets', 'tips-tax-calculator.js');
  registerAsset('assets', 'senior-deduction-calculator.js');
  registerAsset('assets', 'salt-cap-calculator.js');
  registerAsset('assets', 'car-loan-interest-calculator.js');
  registerAsset('assets', 'charitable-deduction-calculator.js');
  registerAsset('engine', 'qcd-comparison.js');
  registerAsset('assets', 'qcd-vs-charitable-deduction-calculator.js');
  registerAsset('engine', 'dependent-care.js');
  registerAsset('assets', 'dependent-care-fsa-vs-credit-calculator.js');
  registerAsset('assets', 'w4-overtime-tips-withholding-calculator.js');
  registerAsset('assets', 'roth-catchup-calculator.js');
  registerAsset('engine', 'form-1099-checker.js');
  registerAsset('assets', '1099-threshold-checker.js');
  registerAsset('engine', 'ss-maxout-engine.js');
  registerAsset('assets', 'ss-wage-base-calculator.js');
  registerAsset('engine', 'bonus-tax.js');
  registerAsset('assets', 'bonus-tax-calculator.js');
  registerAsset('assets', 'embed-gallery.js');
  registerAsset('engine', 'employment-tax.js');
  registerAsset('assets', 'biweekly-mortgage-calculator.js');
  // (biweekly reuses amortization.js, already copied above)
  // Shared "visible failure" banner — imported by all 88 tool bootstrap files'
  // try/catch-wrapped init() (see the calc-error-banner.js file for details).
  registerAsset('engine', 'calc-error-banner.js');

  // Content-hash every queued /assets/*.js file (dependency-ordered rewrite of
  // internal import paths + runtime string references), writing the hashed
  // files straight into dist/assets/. assetHashMap feeds the end-of-build HTML
  // rewrite pass (rewriteHtmlAssetRefs) so every <script src="/assets/X.js">
  // ends up pointing at X's real, hashed dist filename.
  const assetHashMap = await hashAssets(ASSET_QUEUE);

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
      { name: `${state.name} Bonus Tax Calculator`, path: `/${slug}-bonus-tax-calculator/` },
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

  // Bonus (supplemental-wage) tax calculator — 51-page state cluster. One
  // template + per-state loop, mirroring the paycheck cluster; each page injects
  // ONLY its own state's tax + supplemental data (small payload) and is keyed to
  // that state's method/rate + slug-varied worked example.
  for (const slug of builtSlugs) {
    const state = taxData.states[slug];
    const suppEntry = suppData.states[slug];
    if (!suppEntry) { console.warn(`⚠  no supplemental entry for ${slug} — skipping bonus page`); continue; }
    const bonusPayload = {
      taxData: stripInternal({ taxYear: taxData.taxYear, federal: taxData.federal, states: { [slug]: state } }),
      supp: { federal: suppFederalLean, states: { [slug]: leanSupp(suppEntry) } }
    };
    const faqEntries = bonusFaqEntries(state, suppEntry, year);
    // Worked-example inputs vary by slug AND are chosen so the example always
    // lands on a genuine refund/owe delta (never a zero-delta wash) — the whole
    // point of the tool. Distinct (bonus, salary) per state means same-bucket
    // pages don't share one canonical set of computed figures.
    const exPick = bonusExampleInputs(slug, taxData, suppData);
    const exSalary = exPick.salary;
    const ex = exPick.r;
    const secs = bonusSections([
      bonusMythBust(state, suppEntry, ex),
      bonusHowItWorks(state, suppEntry, year),
      bonusWorkedExample(state, suppEntry, ex, exSalary),
      bonusSizeTable(state, suppEntry, taxData, suppData),
      bonusNeighborTable(state, suppEntry, roster, builtSlugs, taxData, suppData)
    ], slug);
    const html = fill(bonusTaxStateTpl, {
      STATE_NAME: state.name,
      STATE_ABBR: state.abbr,
      STATE_SLUG: slug,
      STATE_TITLE: bonusTitle(state, suppEntry, year),
      STATE_META_DESC: bonusMetaDesc(state, suppEntry, year),
      STATE_H1: `${state.name} Bonus Tax Calculator`,
      STATE_LEDE: bonusLede(state, suppEntry, year),
      BONUS_INTRO: bonusAnswerBlock(state, suppEntry),
      SECTIONS_A: secs.a,
      SECTIONS_B: secs.b,
      STATE_FAQ: bonusFaqBlock(state, faqEntries),
      FAQ_JSONLD: faqJsonLd(faqEntries),
      SOURCES: bonusSourcesBlock(state, suppEntry),
      STATE_LINKS: bonusStateLinks(roster, builtSlugs, slug),
      BONUS_TAX_JSON: JSON.stringify(bonusPayload),
      YEAR: year,
      VERIFIED: verified,
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url
    });
    const bonusRelated = relatedLinksHtml(orderAncillary(slug, [
      { name: 'Bonus Tax Calculator by State', path: '/bonus-tax-calculator/' },
      { name: `${state.name} Paycheck Calculator`, path: `/${slug}-paycheck-calculator/` },
      { name: 'No Tax on Overtime Calculator', path: '/overtime-tax-calculator/' },
      { name: 'No Tax on Tips Calculator', path: '/tips-tax-calculator/' },
      { name: 'Salary to Hourly Calculator', path: '/salary-to-hourly/' }
    ]));
    const dir = join(DIST, `${slug}-bonus-tax-calculator`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'index.html'),
      html.replace('<footer class="site">', `${bonusRelated}\n<footer class="site">`)
    );
    urls.push(`${SITE.url}/${slug}-bonus-tax-calculator/`);
  }

  // Bonus tax calculator HUB (/bonus-tax-calculator/) — state selector + full
  // prose; injects all 51 states so the picker works. In TOOLS (money), so
  // fillTool adds the related-tools block + AdSense.
  await mkdir(join(DIST, 'bonus-tax-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'bonus-tax-calculator', 'index.html'),
    fillTool(bonusTaxTpl, {
      SITE_NAME: SITE.name, SITE_URL: SITE.url, YEAR: year, VERIFIED: verified,
      BONUS_TAX_JSON: BONUS_TAX_ALL_JSON,
      STATE_LINKS: bonusHubLinks(roster, builtSlugs)
    }, '/bonus-tax-calculator/')
  );
  urls.push(`${SITE.url}/bonus-tax-calculator/`);

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

  // OBBBA car-loan interest deduction (IRC §163(h)(4) "qualified passenger
  // vehicle loan interest", added by §70203) calculator — up to $10,000/yr of
  // interest on a new, US-assembled, personal-use vehicle loan for 2025–2028,
  // with the $100,000/$200,000 MAGI phase-out and an eligibility checklist. No
  // state selector: it's a federal deduction; MFS IS eligible (unlike tips/OT).
  await mkdir(join(DIST, 'car-loan-interest-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'car-loan-interest-calculator', 'index.html'),
    fillTool(carLoanTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/car-loan-interest-calculator/')
  );
  urls.push(`${SITE.url}/car-loan-interest-calculator/`);

  // OBBBA charitable-deduction calculator (IRC §170(p) non-itemizer deduction
  // §70424; §170(b)(1)(I) 0.5%-of-AGI floor §70425; §68 "2/37 rule" §70111) —
  // the three 2026 charitable changes, all PERMANENT (no 2028 sunset). Reuses the
  // SALT tool's itemize-vs-standard machinery. Correctly encodes reducesAgi=false
  // (the §170(p) deduction is taken via §63(b)(4) AFTER AGI — it does NOT reduce AGI).
  await mkdir(join(DIST, 'charitable-deduction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'charitable-deduction-calculator', 'index.html'),
    fillTool(charitableTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/charitable-deduction-calculator/')
  );
  urls.push(`${SITE.url}/charitable-deduction-calculator/`);

  // OBBBA §70404 Dependent Care FSA (§129, $7,500 / $3,750 MFS) vs. Child &
  // Dependent Care Credit (§21, nonrefundable, 50%→20% AGI-tiered, $3,000/$6,000
  // caps) — a NEW sibling system (not the deduction cluster). The §21(c) cap
  // reduction makes it a CORNER decision (max the FSA or take the credit; maxing
  // the FSA zeroes the credit). Reuses paycheck-engine.js for the FSA's income-tax
  // + FICA saving. MFS gets $0 credit (§21(e)(2)). Injects fica-inclusive fed JSON.
  await mkdir(join(DIST, 'dependent-care-fsa-vs-credit-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'dependent-care-fsa-vs-credit-calculator', 'index.html'),
    fillTool(depCareTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, DC_JSON, FED_JSON: DC_FED_JSON }, '/dependent-care-fsa-vs-credit-calculator/')
  );
  urls.push(`${SITE.url}/dependent-care-fsa-vs-credit-calculator/`);

  // 2026 Form W-4 Step 4(b) overtime & tips WITHHOLDING helper — the paycheck-now
  // companion to the filing-time tips/overtime tools. Reuses the same OBBBA engine
  // (allowedDeduction + a single combined federalTaxSaved on tips+overtime) to
  // translate the deduction into a Step 4(b) Deductions Worksheet entry (line 1a
  // tips / line 1b overtime premium) and an extra-take-home-per-paycheck figure.
  // Step 4(b) DEDUCTIONS (lowers withholding), NOT Step 4(c). No state selector.
  await mkdir(join(DIST, 'w4-overtime-tips-withholding-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'w4-overtime-tips-withholding-calculator', 'index.html'),
    fillTool(w4OtTipsTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/w4-overtime-tips-withholding-calculator/')
  );
  urls.push(`${SITE.url}/w4-overtime-tips-withholding-calculator/`);

  // SECURE 2.0 §603 mandatory Roth catch-up (IRC §414(v)(7)) calculator — a
  // SEPARATE retirement-plan rule (NOT OBBBA): high earners (prior-year FICA/Box 3
  // wages over $150k) must make their 401(k)/403(b)/457(b) catch-up as Roth. Its
  // own engine + dataset; injects only the SECURE 2.0 constants (asks for the
  // marginal rate directly, so no federal-bracket JSON needed).
  await mkdir(join(DIST, 'roth-catchup-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'roth-catchup-calculator', 'index.html'),
    fillTool(rothCatchupTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, ROTHCATCHUP_JSON }, '/roth-catchup-calculator/')
  );
  urls.push(`${SITE.url}/roth-catchup-calculator/`);

  // 1099-K (IRC §6050W, restored by OBBBA §70432) / 1099-NEC-MISC (IRC
  // §6041/§6041A, amended by OBBBA §70433) threshold checker — a STANDALONE
  // reporting-trigger lookup (NOT the deductions cluster, NOT the bracket/FICA
  // engine). Disambiguates which form applies from payment method + amount +
  // count + year: network apps ($20,000/200 txns, both strict >), card
  // processors (no minimum at all), or a direct payer ($2,000 TY2026 / $600
  // TY2025, "or more"). Plus an optional, informational state 1099-K overlay.
  await mkdir(join(DIST, '1099-threshold-checker'), { recursive: true });
  await writeFile(
    join(DIST, '1099-threshold-checker', 'index.html'),
    fillTool(form1099Tpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, FORM1099_JSON, FORM1099_STATES_JSON }, '/1099-threshold-checker/')
  );
  urls.push(`${SITE.url}/1099-threshold-checker/`);

  // Social Security wage-base max-out date calculator (SSA cbb.html $184,500 /
  // 6.2% for 2026) — projects the exact paycheck date SS withholding stops for
  // the year and the resulting take-home bump, plus a secondary excess-FICA
  // (multiple employers) check.
  await mkdir(join(DIST, 'ss-wage-base-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'ss-wage-base-calculator', 'index.html'),
    fillTool(ssMaxoutTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, SSMAXOUT_PARAMS_JSON }, '/ss-wage-base-calculator/')
  );
  urls.push(`${SITE.url}/ss-wage-base-calculator/`);

  // QCD (Qualified Charitable Distribution, IRC §408(d)(8)) vs. take-the-
  // distribution-and-deduct-it calculator. NOT an OBBBA provision (predates the
  // 2025 law; permanent) but shares the tax-parameter store (federal.qcd, sibling
  // of federal.charitable) and REUSES charitableComparison for the entire
  // take-and-deduct side via the new qcd-comparison.js orchestrator — it does not
  // reimplement the §170(p)/floor/§68 math. Genuinely new: the QCD annual-limit
  // lookup + partial-QCD split, the age-70½ gate (distinct from RMD age 73), the
  // account-type guard, and the age-65+ standard-deduction addition (the shipped
  // charitable engine only ever reads the BASE standard deduction).
  await mkdir(join(DIST, 'qcd-vs-charitable-deduction-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'qcd-vs-charitable-deduction-calculator', 'index.html'),
    fillTool(qcdTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON }, '/qcd-vs-charitable-deduction-calculator/')
  );
  urls.push(`${SITE.url}/qcd-vs-charitable-deduction-calculator/`);

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
  // Still gets MODULE_ERROR_LISTENER injected below (same page-level module-load-
  // failure banner every full page gets via fill()) — bypassing fill() shouldn't
  // mean losing that defense-in-depth too.
  const embedMap = { SITE_NAME: SITE.name, SITE_URL: SITE.url, OBBBA_JSON: OBBBA_FED_JSON, FED_JSON: OBBBA_FED_TAX_JSON, STATES_JSON: OBBBA_STATES_JSON, ROTHCATCHUP_JSON, BONUS_TAX_JSON: BONUS_TAX_ALL_JSON, FORM1099_JSON, FORM1099_STATES_JSON, SSMAXOUT_PARAMS_JSON };
  const fillEmbed = (tpl) => {
    let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in embedMap ? embedMap[k] : m));
    if (out.includes('</head>')) out = out.replace('</head>', `${MODULE_ERROR_LISTENER}</head>`);
    return out;
  };
  await mkdir(join(DIST, 'embed', 'overtime-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'overtime-tax-calculator', 'index.html'), fillEmbed(embedOvertimeTpl));
  await mkdir(join(DIST, 'embed', 'tips-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'tips-tax-calculator', 'index.html'), fillEmbed(embedTipsTpl));
  await mkdir(join(DIST, 'embed', 'senior-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'senior-deduction-calculator', 'index.html'), fillEmbed(embedSeniorTpl));
  await mkdir(join(DIST, 'embed', 'salt-cap-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'salt-cap-calculator', 'index.html'), fillEmbed(embedSaltTpl));
  await mkdir(join(DIST, 'embed', 'car-loan-interest-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'car-loan-interest-calculator', 'index.html'), fillEmbed(embedCarLoanTpl));
  await mkdir(join(DIST, 'embed', 'charitable-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'charitable-deduction-calculator', 'index.html'), fillEmbed(embedCharitableTpl));
  await mkdir(join(DIST, 'embed', 'qcd-vs-charitable-deduction-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'qcd-vs-charitable-deduction-calculator', 'index.html'), fillEmbed(embedQcdTpl));
  // Dependent-care embed needs the fica-inclusive fed JSON (DC_FED_JSON) + DC_JSON,
  // which the shared embedMap doesn't carry — use a dedicated map. Function-form
  // replace keeps '$'/'§' in the injected JSON literal intact.
  {
    const dcEmbedMap = { SITE_NAME: SITE.name, SITE_URL: SITE.url, DC_JSON, FED_JSON: DC_FED_JSON };
    const fillDcEmbed = (tpl) => {
      let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in dcEmbedMap ? dcEmbedMap[k] : m));
      if (out.includes('</head>')) out = out.replace('</head>', `${MODULE_ERROR_LISTENER}</head>`);
      return out;
    };
    await mkdir(join(DIST, 'embed', 'dependent-care-fsa-vs-credit-calculator'), { recursive: true });
    await writeFile(join(DIST, 'embed', 'dependent-care-fsa-vs-credit-calculator', 'index.html'), fillDcEmbed(embedDepCareTpl));
  }
  await mkdir(join(DIST, 'embed', 'w4-overtime-tips-withholding-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'w4-overtime-tips-withholding-calculator', 'index.html'), fillEmbed(embedW4OtTipsTpl));
  await mkdir(join(DIST, 'embed', 'roth-catchup-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'roth-catchup-calculator', 'index.html'), fillEmbed(embedRothCatchupTpl));
  await mkdir(join(DIST, 'embed', '1099-threshold-checker'), { recursive: true });
  await writeFile(join(DIST, 'embed', '1099-threshold-checker', 'index.html'), fillEmbed(embedForm1099Tpl));
  await mkdir(join(DIST, 'embed', 'ss-wage-base-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'ss-wage-base-calculator', 'index.html'), fillEmbed(embedSsMaxoutTpl));
  await mkdir(join(DIST, 'embed', 'bonus-tax-calculator'), { recursive: true });
  await writeFile(join(DIST, 'embed', 'bonus-tax-calculator', 'index.html'), fillEmbed(embedBonusTaxTpl));
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
  await writeFile(join(DIST, 'data', 'secure2-catchup-2026.json'), JSON.stringify(stripInternal(secure2), null, 2) + '\n');

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

  // _headers (Cloudflare Pages) — security headers + real content-hash caching.
  // Ordering matters: Cloudflare applies EVERY matching block for a request,
  // not just the last one — and when more than one matching block sets the
  // same header (e.g. Cache-Control), Cloudflare does NOT do last-match-wins;
  // it JOINS the values with a comma, producing a garbled, self-contradictory
  // header. So each more-specific block that needs its OWN Cache-Control value
  // must first `! Cache-Control` (Cloudflare's header-unset syntax) to detach
  // whatever a broader, earlier block already set, before setting its real
  // value. `/*` sets a safe short-lived default (HTML pages, sitemap.xml,
  // data/*.json, etc. — nothing here is content-hashed, so it must revalidate
  // instead of going stale silently). `/assets/*` covers the one remaining
  // un-hashed asset (styles.css) with its own short-lived default — unset
  // first since it also matches `/*`. `/assets/*.js` is the most specific
  // match: every /assets/*.js file is now content-hashed (see hashAssets()
  // above), so a fresh URL is minted on every byte change — safe to cache for
  // a full year, immutable. It matches both `/*` and `/assets/*`, so it also
  // unsets before setting. Only Cache-Control is unset/reset per block — the
  // security headers set on `/*` are left alone and simply carry through.
  await writeFile(
    join(DIST, '_headers'),
    `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Cache-Control: public, max-age=0, must-revalidate\n\n/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=300, must-revalidate\n\n/assets/*.js\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n`
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

  // Final pass: rewrite every dist HTML file's /assets/X.js references to the
  // hashed filenames computed by hashAssets() above. Must run last — after
  // every page has been written — so it can't miss a page written earlier.
  await rewriteHtmlAssetRefs(DIST, assetHashMap);

  console.log(`Built ${builtSlugs.size} state page(s) + home + ${STATIC_PAGES.length} content pages → dist/`);
  console.log(`States: ${[...builtSlugs].join(', ')}`);
  if (!SITE.adsensePublisherId) console.log('Note: ads.txt skipped (set SITE.adsensePublisherId after AdSense approval).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
