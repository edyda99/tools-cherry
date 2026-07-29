# Bing and AI-answer-engine surface audit

Date: 2026-07-28. Read-only audit, no site code changed.
Method: read `scripts/indexnow-submit.py`, `build.js`, `src/templates/state-page.html`, then ran
`npm run build` once and inspected the produced `dist/`.

Caveat on timing: at build time another session had uncommitted edits to `build.js` and
`src/templates/state-page.html` in this worktree. Their diff touches neither `urls.push`, nor the
`$0.00` result lines, nor anything named `take-home-pay-by-state`, so none of the findings below
depend on it.

## Plain-language summary

The Bing plumbing is built but nobody pulls the lever. The IndexNow key file ships on every build
and the submit script works, but no deploy path, cron, or CI job ever calls it, so Bing only hears
about a new page if a human remembers to run one command by hand.

The bigger surprise is good news: the state paycheck pages already answer the question in plain
HTML, before any JavaScript runs. All 51 of them carry a prerendered sentence like "Earning $75,000
in Ohio? Your estimated 2026 take-home is about $60,246". An AI engine that never runs JavaScript
still gets a real number.

The problem is that the same page also ships a results table where every line, including the one
labelled "Net pay", reads `$0.00` until JavaScript fills it in. So a non-JavaScript reader sees the
right answer near the top and a zeroed-out "Net pay" total halfway down. That total row is exactly
the shape an extractor reaches for.

And the one number these pages exist to produce never appears in structured data at all. The
JSON-LD is valid on all 51 pages, but zero of them put the take-home figure in it.

---

## 1. IndexNow: built, verified, and entirely manual

File: `scripts/indexnow-submit.py`.

| Question | Answer | Proof |
|---|---|---|
| What does it submit? | Every `<loc>` URL in `dist/sitemap.xml`, all 205 of them, unless URLs are passed as argv | line 35 sets `SITEMAP = .../dist/sitemap.xml`; line 42 `return re.findall(r"<loc>(.*?)</loc>", xml)`; line 87 `url_list = args if args else urls_from_sitemap()` |
| Where does the key live? | Hardcoded `9372e11bcbe34b0e993865299aae29dc` in the script, and mirrored from `build.js` | script line 32 `KEY = "9372e11..."`; `build.js` line 30 `indexNowKey: '9372e11...'` |
| Where is the key file served? | `https://tools-berry.com/9372e11bcbe34b0e993865299aae29dc.txt` | script line 33 `KEY_LOCATION`; emitted by `build.js` lines 5975 to 5977 |
| Is the key file actually produced? | Yes, confirmed on disk after build | `dist/9372e11bcbe34b0e993865299aae29dc.txt` exists |
| Endpoint | `https://api.indexnow.org/indexnow` | script line 34 |
| Automatic on deploy? | **No. Manual only.** | `package.json` line 12: `"deploy": "npm run build && npx --yes wrangler pages deploy dist --project-name=tools-cherry"`. No IndexNow step. |

Corroborating evidence for "manual only":

- A repo-wide grep for `indexnow` outside `dist/` returns four hits and no caller:
  `build.js:28-30` (key constant), `build.js:5973-5976` (writes the key file), and
  `docs/2026-refresh-inventory.md:148` (prose). Nothing invokes the script.
- `.github/workflows/` contains exactly one file, `tax-monitor.yml`, a weekly tax-data freshness
  check. It does not deploy and does not touch IndexNow.
- The script's own header says "Run it AFTER a deploy", which is correct advice and also confirms
  there is no automation carrying it out.

Secondary issue in the same script: with no arguments it submits the entire 205-URL set every time.
IndexNow expects changed URLs. Repeated full-set blasts are what earns a 429, which the script
already anticipates at line 77. Shipping one new page should push one URL, not 205.

## 2. Sitemap membership for the new page, and robots.txt

**Nothing is auto-discovered.** The sitemap is written from an explicit in-memory `urls` array,
not from a filesystem walk:

- `build.js:3729` initialises it, `const urls = [`${SITE.url}/`];`
- roughly 200 individual `urls.push(...)` calls populate it
- `build.js:5965` filters noindex pages out, `const sitemapUrls = urls.filter(...)`
- `build.js:5966-5971` writes `dist/sitemap.xml` from that filtered array

Consequence for the other agents: a new page at `/take-home-pay-by-state/` will build fine, be
reachable, and be **absent from the sitemap** unless whoever adds it also adds an explicit
`urls.push(\`${SITE.url}/take-home-pay-by-state/\`)` alongside the `writeFile` that creates it.
There is no safety net and no build error for forgetting.

Second point the other agents need: a page on this exact topic already exists at
**`/data/take-home-pay-by-state/`** and is already in the sitemap (`build.js:5461` pushes it;
`dist/sitemap.xml` line 202 carries it with `lastmod 2026-06-28`). It is fully server-rendered,
54 KB, with all 51 state rows in raw HTML and four valid JSON-LD blocks (`Article`, `Dataset`,
`FAQPage`, plus the site `@graph`). A new root-level `/take-home-pay-by-state/` would be a second
URL covering the same query. That is a duplication and cannibalisation risk, not a reason to
block, but it needs a deliberate canonical decision rather than an accident.

**robots.txt does reference the sitemap.** `build.js:5960` appends
`` `\nSitemap: ${SITE.url}/sitemap.xml\n` ``, and the built `dist/robots.txt` ends with
`Sitemap: https://tools-berry.com/sitemap.xml`. The file also carries explicit
`Allow: /` stanzas for GPTBot, OAI-SearchBot, ClaudeBot, Claude-Web, PerplexityBot,
Google-Extended, CCBot, Bingbot and Applebot-Extended, on top of the `User-agent: *` catch-all
(`build.js:5952-5955`). Nothing is blocked at the robots layer.

## 3. Sitemap size and hygiene

**205 URLs**, all unique, zero duplicates.

The build produces 241 `index.html` pages. The 36 not in the sitemap are all excluded on purpose
and correctly:

| Excluded group | Count | Status |
|---|---|---|
| `/embed/*` iframe pages | 20 | `noindex, follow`, never intended for the index |
| `NOINDEX_TOOLS` thin utilities (base-converter, json-formatter, uuid-generator, stopwatch, sleep-calculator, text-case-converter, and 10 more) | 16 | `noindex, follow` per the deliberate index-pruning at `build.js:1286` |

Two integrity checks both pass:

- **0** sitemap URLs point at a page carrying `noindex`. No leakage.
- **0** sitemap URLs lack a built `index.html`. No dead entries.

Per-URL `lastmod` is derived from each page's real git change date (`sitemapLastmod`,
`build.js:314`), not a uniform today, which is the right call.

## 4. Can Bing and a non-JavaScript AI engine read our answer? Mostly yes, with one contradiction

Test page: `dist/ohio-paycheck-calculator/index.html`, 35,226 bytes.

### Present in raw HTML, no JavaScript required

The headline take-home figure **is** in the served HTML, and early in the document:

- Immediately after the `<h1>`, at 23 percent into the file:
  `<p class="answer-lead"><strong>Earning $75,000 in Ohio? Your estimated 2026 take-home is about
  $60,246 after federal tax and FICA, and Ohio state income tax.</strong></p>`
- The big number is prefilled, not a placeholder:
  `<p class="net-big" id="netBig">$2,317.17</p>` with
  `<p class="net-sub" id="netSub">take-home per 2 weeks · $60,246/yr</p>`
- A static 51-state comparison table with hard dollar figures (`$60,246` for Ohio, `$59,290`
  Pennsylvania, and so on), all server-rendered.
- Meta description states the purpose in plain words.

Verified across the whole cluster: **51 of 51** state paycheck pages have a prerendered
`answer-lead` containing a dollar figure, and **51 of 51** have a prefilled `netBig`. Spot-checked
California ($57,690), Texas ($61,593) and New York ($57,784). This part is uniform and healthy.

The data study at `/data/take-home-pay-by-state/` is likewise fully server-rendered, 51 rows in raw
HTML, no JavaScript needed.

### The contradiction: a zeroed "Net pay" total ships in the same HTML

Inside `<div class="results" data-tb-result>`, at 51 percent into the document, every itemised line
is a hardcoded placeholder that only JavaScript replaces:

```
<div class="line"><span class="lbl">Gross</span><span id="rGross">$0.00</span></div>
<div class="line"><span class="lbl">Federal income tax</span><span id="rFederal">$0.00</span></div>
<div class="line"><span class="lbl">Social Security</span><span id="rSS">$0.00</span></div>
<div class="line"><span class="lbl">Medicare</span><span id="rMedicare">$0.00</span></div>
<div class="line" id="stateLine"><span class="lbl">Ohio income tax</span><span id="rState">$0.00</span></div>
<div class="line total"><span class="lbl">Net pay</span><span id="rNet">$0.00</span></div>
```

Source: `src/templates/state-page.html` lines 243 to 251, hardcoded, on all 51 pages.

Why this matters rather than being cosmetic:

- The wrapper `<div class="results">` is **not** hidden. Checked the built stylesheet: the
  `.results` rule contains no `display:none`, and there is no `hidden` attribute on the container.
  A crawler that does not execute JavaScript renders the literal text "Net pay $0.00".
- The row is `class="line total"` and labelled "Net pay". That is precisely the label and the
  visual weight an answer extractor keys on. The correct `$60,246` is in a prose sentence; the
  wrong `$0.00` is in a total row.
- Eight `$0.00` strings and several `0%` strings ship on every state page.

So the honest answer to "is the headline result in the raw HTML" is: **yes for the lead sentence
and the big number, no for the breakdown**, and the two disagree. Today an engine that reads the
page top-down gets a real figure first, which is why this has not visibly hurt. It is still a
loaded gun pointed at the only pages that matter.

## 5. JSON-LD on the state pages: valid everywhere, but missing the number

Swept all 51 built state paycheck pages:

| Check | Result |
|---|---|
| Pages with JSON-LD | 51 of 51 |
| Blocks per page | 2 |
| Blocks that fail `json.loads` | **0** |
| Pages with a `FAQPage` block | 51 of 51 |
| Pages with the site `@graph` (`Organization`, `WebSite`, `WebPage`, `BreadcrumbList`) | 51 of 51 |
| Pages whose structured data contains the take-home dollar figure | **0 of 51** |
| Pages with a `WebApplication` or `SoftwareApplication` node | **0 of 51** |

Two concrete gaps, both on the highest-value cluster on the site:

1. **The answer is not in the structured data.** Ohio's two FAQ entries are "Do cities or counties
   in Ohio take a local income tax out of paychecks?" and "Does Ohio have a state income tax in
   2026?". Both are good content. Neither is "How much do I take home on $75,000 in Ohio?". The
   number the page exists to produce lives only in prose. An AI engine that prefers structured data
   over prose, which is the direction the whole field is moving, finds nothing to quote.
2. **No calculator node.** Ordinary tool pages do carry one: `dist/tip-calculator/index.html` and
   `dist/mortgage-calculator/index.html` both emit `['WebApplication', 'FAQPage', graph]`. The state
   paycheck pages emit only `['FAQPage', graph]`. The 51 pages that are actually calculators are the
   ones not declaring themselves as calculators.

The data study page is the counter-example done right: `Article` plus `Dataset` plus `FAQPage` plus
the `@graph`, four valid blocks, with `DataDownload` entries pointing at the CSV and JSON exports
(`build.js:5421-5422`). That is the shape the state pages should aspire to.

---

## Recommendations, ranked. Not implemented.

### 1. Prerender the breakdown numbers instead of shipping `$0.00`
**File: `src/templates/state-page.html` lines 243 to 251, filled from `build.js`.**

Replace the six hardcoded `$0.00` placeholders with tokens (`{{R_GROSS}}`, `{{R_FEDERAL}}`,
`{{R_SS}}`, `{{R_MEDICARE}}`, `{{R_STATE}}`, `{{R_NET}}`) filled server-side from the same
$75,000 single-filer default that already produces `{{ANSWER_LEAD}}` (`build.js:1708`) and
`{{NET_BIG}}` (template line 43). The values already exist in the build; nothing new has to be
computed. JavaScript overwrites these nodes on first calculation exactly as it does now, so live
users see no change at all, while the non-JavaScript view stops contradicting its own headline.
This is the single highest-leverage change here: it is small, it is localised to one template, and
it removes a `$0.00` labelled "Net pay" from 51 pages.

### 2. Put the take-home figure into the FAQ JSON-LD
**File: `build.js`, the state-page FAQ builder around line 2225 and its Q&A array.**

Add one leading `Question` per state, "How much is take-home pay on a $75,000 salary in
<State>?", whose `acceptedAnswer.text` is the sentence already generated for `answer-lead` at
`build.js:1708`. Note that `build.js:5353` and the comment at `build.js:2199` establish the house
rule that the visible Q&A and the FAQPage schema are generated from one array so they can never
drift; follow that, do not hand-write a second copy. This adds zero new prose and zero new claims,
it just makes the number machine-readable. Optionally add a `WebApplication` node to match what
tip-calculator and mortgage-calculator already emit.

### 3. Wire IndexNow into the ship step, and submit only what changed
**Files: `package.json` line 12, and `scripts/indexnow-submit.py`.**

Append `&& python3 scripts/indexnow-submit.py <changed urls>` to the `deploy` script so the ping
happens after wrangler has made the URLs live, which is the ordering the script requires. Pass the
shipped URLs explicitly, since the script already accepts them as argv (line 87), rather than
re-blasting all 205 every deploy. Bing is currently the 10x traffic channel and today it learns
about a new page only if a human remembers a command that nothing prompts them to run.

---

## Flagged separately, not part of the three above

`dist/_headers` sets `X-Frame-Options: DENY` on `/*` (`build.js:5942`). That wildcard also covers
the 20 `/embed/*` pages, which exist specifically so third parties can iframe them, and for which
embed pitches have already been sent. Any partner who accepts will find the embed blocked by their
browser. This is not a Bing or AI-crawler issue, which is why it is not in the ranked list, but it
silently defeats the embed strategy and someone should look at it.
