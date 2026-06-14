#!/usr/bin/env node
// build.js — pSEO static generator. Reads templates + tax data, emits ./dist.
// Cloudflare Pages: build command `npm run build`, output dir `dist`.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_PAGES } from './src/content/static-pages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'src');
const DIST = join(__dirname, 'dist');

// --- Site config (set the real values at first deploy) -----------------------
const SITE = {
  name: 'Tools Cherry',
  url: 'https://tools-cherry.com',
  contactEmail: 'hello@tools-cherry.com', // set up Cloudflare Email Routing (free) so this inbox receives
  adsensePublisherId: '' // TODO: paste "pub-XXXXXXXXXXXXXXXX" after AdSense approval -> writes ads.txt
};

const read = (p) => readFile(p, 'utf8');
const readJSON = async (p) => JSON.parse(await read(p));

function fill(tpl, map) {
  return tpl.replace(/{{(\w+)}}/g, (m, k) => (k in map ? map[k] : m));
}

// Prose body per state — branches on whether the state levies income tax.
function stateBody(state, year) {
  const noTax = !state.hasIncomeTax;
  if (noTax) {
    return `<p>${state.name} is one of the U.S. states with <strong>no state income tax</strong>. ` +
      `Your ${year} paycheck is reduced only by federal income tax withholding and FICA ` +
      `(Social Security and Medicare) — there is no ${state.name} income tax line.</p>` +
      `<p>Federal withholding is estimated from the ${year} IRS tax brackets and the standard ` +
      `deduction for your filing status. FICA is 6.2% Social Security (up to the annual wage base) ` +
      `plus 1.45% Medicare on all wages, with an extra 0.9% on high earnings. Change your filing ` +
      `status, pay frequency, or switch between salary and hourly above to see how your take-home ` +
      `pay changes.</p>`;
  }

  const t = state.tax;
  let how;
  if (t.type === 'flat') {
    how = `${state.name} levies a <strong>flat ${(t.rate * 100).toFixed(2).replace(/\.?0+$/, '')}% state income tax</strong> for ${year}`;
    how += t.standardDeduction
      ? `, applied after the state allowance/deduction for your filing status.`
      : ` on your wages, with no state standard deduction.`;
  } else {
    how = `${state.name} taxes income on a graduated state schedule for ${year}, applied after the state deduction for your filing status.`;
  }

  let body =
    `<p>${how} This calculator applies that on top of federal withholding and ` +
    `Social Security / Medicare to estimate your ${state.name} take-home pay.</p>` +
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
  const qrTpl = await read(join(SRC, 'templates', 'qr-generator.html'));
  const circleTpl = await read(join(SRC, 'templates', 'circle-crop.html'));
  const photoTpl = await read(join(SRC, 'templates', 'passport-photo-maker.html'));
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
  await cp(join(SRC, 'engine', 'paycheck-engine.js'), join(DIST, 'assets', 'paycheck-engine.js'));
  await cp(join(SRC, 'engine', 'canvas-math.js'), join(DIST, 'assets', 'canvas-math.js'));
  await cp(join(SRC, 'engine', 'canvas-editor.js'), join(DIST, 'assets', 'canvas-editor.js'));

  const urls = [`${SITE.url}/`];

  // one page per state present in tax-data
  for (const slug of builtSlugs) {
    const state = taxData.states[slug];
    // per-page payload: federal + only this state (keeps embedded JSON small)
    const payload = { taxYear: taxData.taxYear, federal: taxData.federal, states: { [slug]: state } };
    const html = fill(stateTpl, {
      STATE_NAME: state.name,
      STATE_SLUG: slug,
      STATE_TAX_PHRASE: state.hasIncomeTax ? `, and ${state.name} state income tax` : '',
      STATE_BODY: stateBody(state, year),
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

  // public machine-readable copy of the live tax data (for the drift monitor +
  // transparency). Always reflects the deployed figures — single source of truth.
  await mkdir(join(DIST, 'data'), { recursive: true });
  await cp(join(SRC, 'data', 'tax-data-2026.json'), join(DIST, 'data', 'tax-data-2026.json'));

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
