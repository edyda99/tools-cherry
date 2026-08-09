// days-from-today-blocks.js — turns each entry in DFT_PAGES into the HTML a
// fixed-interval date page is made of: title, description, lede, the ordered
// prose sections, the FAQ and the sibling links.
//
// THE ANSWER IS NOT IN HERE. "30 days from today" is a different date every
// morning, so nothing on these pages may be computed at build time; the date is
// worked out in the reader's browser by /assets/days-from-today.js through the
// shared date engine. What this file writes is the part that stays true — what
// the interval means, how the count is defined, and what it is used for.
//
// Twenty-nine pages built from one shape is exactly how a template farm is
// made, so three things vary deliberately: the per-page use-case copy (written
// once each, in days-from-today.js), the wording of the shared explanations
// (rotated through variants), and the ORDER the sections appear in. The gate on
// that is a digit-masked 5-gram similarity measurement across the built pages —
// digit-masked because "30 days" and "60 days" are the same sentence otherwise.
import { DFT_PAGES } from './days-from-today.js';

// FNV-1a + the MurmurHash3 finalizer, so similar short slugs ("30-days-ago" vs
// "60-days-ago") decorrelate across salts instead of picking the same variant in
// every section at once. Same construction build.js uses for the salary ladder,
// kept local because build.js does not export it.
function slugHash(slug) {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mixIndex(h, n) {
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 2246822507) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 3266489909) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % n;
}
const frame = (slug, salt, arr) => arr[mixIndex(slugHash(slug + salt), arr.length)];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// FAQ answers are plain prose that goes into both HTML and JSON-LD; escape for
// HTML but keep the JSON-LD copy raw (JSON.stringify handles its own quoting).
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

export const dftPath = (p) => `/${p.slug}/`;
const SLUGS = new Set(DFT_PAGES.map((p) => p.slug));

// The interval as it reads in a sentence: "30 days", "12 weeks", "10 business days".
export function dftUnitPhrase(p) {
  const n = p.amount;
  if (p.unit === 'week') return `${n} week${n === 1 ? '' : 's'}`;
  if (p.unit === 'business') return `${n} business day${n === 1 ? '' : 's'}`;
  return `${n} day${n === 1 ? '' : 's'}`;
}

const crossLabel = (p) => (p.unit === 'business' ? 'On the calendar' : 'Weekdays vs weekend days');

function title(p) {
  const iv = dftUnitPhrase(p);
  if (p.dir === 'back') {
    return frame(p.slug, 'title', [
      `What Date Was ${iv} Ago?`,
      `${iv} Ago From Today — The Exact Date`,
      `What Was the Date ${iv} Ago?`,
    ]);
  }
  return frame(p.slug, 'title', [
    `What Date Is ${iv} From Today?`,
    `${iv} From Today — What Date Is That?`,
    `${iv} From Today: Exact Date and Weekday`,
    `When Is ${iv} From Today?`,
  ]);
}

function desc(p) {
  const iv = dftUnitPhrase(p);
  const skips = p.unit === 'business' ? 'skipping Saturdays and Sundays' : 'counting every calendar day';
  if (p.dir === 'back') {
    return frame(p.slug, 'desc', [
      `The exact date ${iv} before today, with its weekday, worked out in your browser from today's date so it is right whenever you open it.`,
      `See what date fell ${iv} ago, ${skips}, plus the weekday and how much of the span was working days. Free and private.`,
      `Count back ${iv} from today for the date, the day of the week and the weekday split — calculated on your own device.`,
    ]);
  }
  return frame(p.slug, 'desc', [
    `The exact date ${iv} from today, with the weekday and the working-day split, ${skips}. Recalculated in your browser each visit.`,
    `Find out what date falls ${iv} from today — day of the week included, ${skips}, and nothing to fill in.`,
    `${iv} from today, worked out on your device from today's date: the full date, its weekday, and how the span divides into working days.`,
    `See the date ${iv} ahead of today, ${skips}, with the weekday and calendar span beside it. Free, private, no sign-up.`,
  ]);
}

function h1(p) {
  const iv = dftUnitPhrase(p);
  return p.dir === 'back'
    ? frame(p.slug, 'h1', [`What date was ${iv} ago?`, `${iv} ago from today`])
    : frame(p.slug, 'h1', [
      `What date is ${iv} from today?`,
      `${iv} from today`,
      `When is ${iv} from today?`,
    ]);
}

function lede(p) {
  const iv = dftUnitPhrase(p);
  const dirWord = p.dir === 'back' ? 'back' : 'forward';
  return frame(p.slug, 'lede', [
    `The date below is ${iv} ${dirWord} from whatever today is on your device, worked out when the page loaded. Nothing to type in, nothing sent anywhere.`,
    `Counting ${dirWord} ${iv} from today gives the date below. Your own device does the arithmetic each time the page opens, so the answer is never stale.`,
    `Here is the date that falls ${iv} ${dirWord} of today, with its weekday beside it. The calculation runs in your browser, from your clock.`,
  ]);
}

// The shared "how the count works" explanation — rotated, and genuinely
// different per unit, because the three units count different things.
function methodBlock(p) {
  const iv = dftUnitPhrase(p);
  if (p.unit === 'business') {
    const h2 = frame(p.slug, 'mh2', [
      'How the working days are counted',
      `What counts as one of the ${p.amount}`,
      'The counting rule behind this date',
    ]);
    return `<section class="prose"><h2>${h2}</h2>` +
      `<p>The count starts from today and steps forward one day at a time, skipping every Saturday and Sunday. A step onto a weekend does not count, so all ${p.amount} of the days are Mondays to Fridays and the answer can never itself land on a weekend. If today is a weekend day, the first working day counted is the following Monday.</p>` +
      `<p><strong>Public holidays are not removed.</strong> They differ by country, by state or region and by employer, so a page that guessed at them would be confidently wrong for most readers. Deduct one working day for each holiday your own calendar observes inside the span, and the true date moves that many days later.</p>` +
      `<p>All of this runs in your browser, on your device&rsquo;s date and time zone. Open the page tomorrow and the answer has moved with the calendar.</p>` +
      `</section>`;
  }
  const h2 = frame(p.slug, 'mh2', [
    'How this date is worked out',
    `What ${iv} means here`,
    'The arithmetic behind the answer',
    'How the count is defined',
  ]);
  const unitLine = p.unit === 'week'
    ? `<p>Weeks convert to days at exactly seven each, so ${iv} is ${p.amount * 7} calendar days. That is a whole number of weeks, which is why the answer always lands on the same day of the week as today.</p>`
    : `<p>Every calendar day counts, weekends and public holidays included. Today is treated as day zero, so the result is the ${p.amount}${p.dir === 'back' ? 'th day before today' : 'th day after today'} rather than counting today itself as the first day. If your contract counts the starting day as day one, shift the result by a day.</p>`;
  return `<section class="prose"><h2>${h2}</h2>` +
    `<p>Your browser reads today&rsquo;s date from your device and ${p.dir === 'back' ? 'subtracts' : 'adds'} ${iv}, which gives the date above. The same date engine drives the <a href="/date-calculator/">date calculator</a>, so the two pages cannot disagree with each other.</p>` +
    unitLine +
    `<p>Because the answer depends on today, it is not written into the page. It is recalculated every time the page opens, in your own time zone, and never leaves the device.</p>` +
    `</section>`;
}

function weekendBlock(p) {
  if (p.unit === 'business') {
    const h2 = frame(p.slug, 'wh2', [
      'Reading a business-day deadline correctly',
      'Why the word &ldquo;business&rdquo; changes the date',
    ]);
    const plainLink = SLUGS.has(`${p.amount}-days-from-today`)
      ? ` If it says plain days, <a href="/${p.amount}-days-from-today/">${p.amount} days from today</a> answers that version instead.`
      : '';
    return `<section class="prose"><h2>${h2}</h2>` +
      `<p>A deadline written in business days always falls later on the calendar than the same number of plain days, and the gap widens by two days for every weekend crossed. Before assuming a deadline has passed, check which wording the document actually used.${plainLink}</p>` +
      `<p>To count the working days between two dates you already have, <a href="/days-between-dates/">days between dates</a> gives the weekday total alongside the calendar total.</p>` +
      `</section>`;
  }
  const h2 = frame(p.slug, 'wh2', [
    'Weekends, holidays and working days',
    'What the count does not skip',
    'Where the working days fall',
  ]);
  const bizLink = p.dir === 'fwd' && SLUGS.has(`${p.amount}-business-days-from-today`)
    ? ` If your deadline is written in working days instead, <a href="/${p.amount}-business-days-from-today/">${p.amount} business days from today</a> skips the weekends and lands later.`
    : '';
  return `<section class="prose"><h2>${h2}</h2>` +
    `<p>Nothing is skipped here: weekends and public holidays sit inside the count, which is what a plain day count means in almost every contract, notice and policy.${bizLink}</p>` +
    `<p>The result box still shows how the span divides — how many of the days are Mondays to Fridays and how many are weekend days — because that is usually the real question behind &ldquo;will this be dealt with in time&rdquo;. Public holidays are not deducted from that weekday figure.</p>` +
    `</section>`;
}

const useBlocks = (p) => p.uses.map((u) =>
  `<section class="prose"><h2>${u.h2}</h2><p>${u.p.replace(/\s+/g, ' ').trim()}</p></section>`);

// Section ORDER rotates as well as section wording, so two pages in the same
// family never present the same shapes in the same sequence.
function sections(p) {
  const uses = useBlocks(p);
  const method = methodBlock(p);
  const weekend = weekendBlock(p);
  const order = mixIndex(slugHash(p.slug + 'order'), 3);
  let out;
  if (order === 0) out = [method, ...uses, weekend];
  else if (order === 1) out = [uses[0], method, ...uses.slice(1), weekend];
  else out = [...uses, weekend, method];
  return out.map((s) => '    ' + s).join('\n\n');
}

// Siblings: the rest of this page's own family, then a rotated handful from the
// other families. Genuine navigation between near-miss queries.
function siblings(p) {
  const family = DFT_PAGES.filter((q) => q.unit === p.unit && q.dir === p.dir && q.slug !== p.slug);
  const others = DFT_PAGES
    .filter((q) => q.unit !== p.unit || q.dir !== p.dir)
    .map((q) => ({ q, k: slugHash(q.slug + p.slug) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 4)
    .map((x) => x.q);
  return [...family, ...others]
    .map((q) => `        <a href="${dftPath(q)}">${esc(q.label)}</a>`)
    .join('\n') + '\n        <a href="/days-from-today/">All intervals &rarr;</a>';
}

function sibIntro(p) {
  const fam = p.unit === 'business' ? 'working-day' : p.unit === 'week' ? 'week' : 'day';
  return frame(p.slug, 'sib', [
    `Other ${fam} intervals, each with its own page and its own answer for today.`,
    `Near-miss counts people look up alongside this one — every one of them is worked out the same way.`,
    `If this was not quite the interval you needed, one of these will be.`,
  ]);
}

/**
 * Everything one fixed-interval page needs, as template tokens.
 * Pure: no clocks, no files, no network. Called once per page by build.js.
 */
export function dftPageParts(p) {
  const iv = dftUnitPhrase(p);
  const t = title(p);
  const d = desc(p);
  const faqHtml = p.faq
    .map((e) => `      <p><strong>${esc(e.q)}</strong> ${esc(e.a)}</p>`)
    .join('\n');
  return {
    PATH: dftPath(p),
    TITLE: esc(t),
    DESC: escAttr(d),
    OG_TITLE: escAttr(p.dir === 'back' ? `${iv} ago` : `${iv} from today`),
    OG_DESC: escAttr(d),
    H1: esc(h1(p)),
    LEDE: esc(lede(p)),
    AMOUNT: String(p.amount),
    UNIT: p.unit,
    DIR: p.dir === 'back' ? 'back' : 'fwd',
    ARIA: escAttr(p.dir === 'back' ? `The date ${iv} ago` : `The date ${iv} from today`),
    CROSS_LABEL: crossLabel(p),
    SECTIONS: sections(p),
    FAQ_HTML: faqHtml,
    SIB_H2: frame(p.slug, 'sibh2', ['Other intervals', 'Nearby counts', 'The rest of the family']),
    SIB_INTRO: esc(sibIntro(p)),
    SIBLINGS: siblings(p),
    APP_LD: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: p.dir === 'back' ? `${iv} ago` : `${iv} from today`,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      description: d,
    }),
    FAQ_LD: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: p.faq.map((e) => ({
        '@type': 'Question',
        name: e.q,
        acceptedAnswer: { '@type': 'Answer', text: e.a },
      })),
    }),
  };
}

/** The hub's grouped link lists. */
export function dftHubGroups(groups) {
  return groups.map((g) => {
    const links = DFT_PAGES.filter(g.match)
      .map((p) => `        <a href="${dftPath(p)}">${esc(p.label)}</a>`)
      .join('\n');
    return `    <section class="prose">\n      <h2>${esc(g.title)}</h2>\n` +
      `      <div class="more-tools-grid">\n${links}\n      </div>\n    </section>`;
  }).join('\n\n');
}
