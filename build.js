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

// AdSense site-verification / auto-ads loader, injected into every page's <head>.
// Empty string when no publisher ID is set, so the build stays clean pre-AdSense.
const ADSENSE_HEAD = SITE.adsensePublisherId
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${SITE.adsensePublisherId}" crossorigin="anonymous"></script>\n`
  : '';

const read = (p) => readFile(p, 'utf8');
const readJSON = async (p) => JSON.parse(await read(p));

function fill(tpl, map) {
  let out = tpl.replace(/{{(\w+)}}/g, (m, k) => (k in map ? map[k] : m));
  // Inject the AdSense loader into every full page (anything with a </head>).
  // Fragment fills (page bodies/descriptions) have no </head>, so they're untouched.
  if (ADSENSE_HEAD && out.includes('</head>')) out = out.replace('</head>', `${ADSENSE_HEAD}</head>`);
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

// State-only structured data: a WebApplication describing the calculator plus a
// BreadcrumbList (Home › <State> Paycheck Calculator). Decoupled from any tool
// infrastructure — derives entirely from the state name/slug/year and SITE.
function appJsonLd(state, slug, year) {
  const url = `${SITE.url}/${slug}-paycheck-calculator/`;
  return JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: `${state.name} Paycheck Calculator ${year}`,
      url,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      description: `Estimate your ${year} ${state.name} take-home pay after federal tax, Social Security, Medicare${state.hasIncomeTax ? `, and ${state.name} state income tax` : ' (no state income tax)'}.`
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE.name, item: `${SITE.url}/` },
        { '@type': 'ListItem', position: 2, name: `${state.name} Paycheck Calculator`, item: url }
      ]
    }
  ]);
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
  const qrTpl = await read(join(SRC, 'templates', 'qr-generator.html'));
  const circleTpl = await read(join(SRC, 'templates', 'circle-crop.html'));
  const photoTpl = await read(join(SRC, 'templates', 'passport-photo-maker.html'));
  const ageTpl = await read(join(SRC, 'templates', 'age-calculator.html'));
  const tipTpl = await read(join(SRC, 'templates', 'tip-calculator.html'));
  const wordCounterTpl = await read(join(SRC, 'templates', 'word-counter.html'));
  const passwordTpl = await read(join(SRC, 'templates', 'password-generator.html'));
  const photoSpecs = await readJSON(join(SRC, 'data', 'photo-specs.json'));
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
  await cp(join(SRC, 'assets', 'jspdf.umd.min.js'), join(DIST, 'assets', 'jspdf.umd.min.js'));
  await cp(join(SRC, 'assets', 'qr.js'), join(DIST, 'assets', 'qr.js'));
  await cp(join(SRC, 'assets', 'qrcode.min.js'), join(DIST, 'assets', 'qrcode.min.js'));
  await cp(join(SRC, 'assets', 'circle-crop.js'), join(DIST, 'assets', 'circle-crop.js'));
  await cp(join(SRC, 'assets', 'photo-maker.js'), join(DIST, 'assets', 'photo-maker.js'));
  await cp(join(SRC, 'assets', 'age.js'), join(DIST, 'assets', 'age.js'));
  await cp(join(SRC, 'assets', 'tip.js'), join(DIST, 'assets', 'tip.js'));
  await cp(join(SRC, 'assets', 'word-counter.js'), join(DIST, 'assets', 'word-counter.js'));
  await cp(join(SRC, 'assets', 'password.js'), join(DIST, 'assets', 'password.js'));
  await cp(join(SRC, 'engine', 'paycheck-engine.js'), join(DIST, 'assets', 'paycheck-engine.js'));
  await cp(join(SRC, 'engine', 'age-math.js'), join(DIST, 'assets', 'age-math.js'));
  await cp(join(SRC, 'engine', 'tip-math.js'), join(DIST, 'assets', 'tip-math.js'));
  await cp(join(SRC, 'engine', 'text-stats.js'), join(DIST, 'assets', 'text-stats.js'));
  await cp(join(SRC, 'engine', 'password-gen.js'), join(DIST, 'assets', 'password-gen.js'));
  await cp(join(SRC, 'engine', 'canvas-math.js'), join(DIST, 'assets', 'canvas-math.js'));
  await cp(join(SRC, 'engine', 'canvas-editor.js'), join(DIST, 'assets', 'canvas-editor.js'));

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
      APP_JSONLD: appJsonLd(state, slug, year),
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
    fill(invoiceTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );
  urls.push(`${SITE.url}/invoice-generator/`);

  // qr code generator (standalone tool page)
  await mkdir(join(DIST, 'qr-code-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'qr-code-generator', 'index.html'),
    fill(qrTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );
  urls.push(`${SITE.url}/qr-code-generator/`);

  // circle crop (image tool, built on CanvasEditor)
  await mkdir(join(DIST, 'crop-image-into-circle'), { recursive: true });
  await writeFile(
    join(DIST, 'crop-image-into-circle', 'index.html'),
    fill(circleTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );
  urls.push(`${SITE.url}/crop-image-into-circle/`);

  // passport photo maker (CanvasEditor + sourced photo specs)
  await mkdir(join(DIST, 'passport-photo-maker'), { recursive: true });
  await writeFile(
    join(DIST, 'passport-photo-maker', 'index.html'),
    fill(photoTpl, {
      SITE_NAME: SITE.name,
      SITE_URL: SITE.url,
      PHOTO_SPECS_JSON: JSON.stringify({ specs: photoSpecs.specs, printSheet: photoSpecs.printSheet })
    })
  );
  urls.push(`${SITE.url}/passport-photo-maker/`);

  // age calculator (date math via the pure age-math engine)
  await mkdir(join(DIST, 'age-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'age-calculator', 'index.html'),
    fill(ageTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );
  urls.push(`${SITE.url}/age-calculator/`);

  // tip calculator (bill/tip/split math via the pure tip-math engine)
  await mkdir(join(DIST, 'tip-calculator'), { recursive: true });
  await writeFile(
    join(DIST, 'tip-calculator', 'index.html'),
    fill(tipTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );
  urls.push(`${SITE.url}/tip-calculator/`);

  // word & character counter (live text analysis via the pure text-stats engine)
  await mkdir(join(DIST, 'word-counter'), { recursive: true });
  await writeFile(
    join(DIST, 'word-counter', 'index.html'),
    fill(wordCounterTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );
  urls.push(`${SITE.url}/word-counter/`);

  // password generator (CSPRNG-backed, via the pure password-gen engine)
  await mkdir(join(DIST, 'password-generator'), { recursive: true });
  await writeFile(
    join(DIST, 'password-generator', 'index.html'),
    fill(passwordTpl, { SITE_NAME: SITE.name, SITE_URL: SITE.url })
  );
  urls.push(`${SITE.url}/password-generator/`);

  // public machine-readable copy of the live tax data (for the drift monitor +
  // transparency). Always reflects the deployed figures — single source of truth.
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
