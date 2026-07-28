// what-applies-to-me.js — builds every HTML fragment for /what-applies-to-me/.
//
// WHY THIS FILE EXISTS
// The page is a six-question flow that ends in "here is what to look into", never
// a dollar figure and never a computed tax. All 51 jurisdictions ship inside the
// single static page (same pattern as /bonus-tax-calculator/), so nothing is
// generated in the browser: the client script only reveals nodes that are already
// in the HTML. That is why every string a reader can see is produced here, at
// build time, from the repo's own sourced data files.
//
// HARD RULES ENFORCED HERE
// 1. Six states print their `note` field VERBATIM and get NO generated sentence:
//    Georgia, Alabama (caps that exist only in prose), Colorado (direction reverses
//    in 2026 and is under legal challenge), Indiana (sunsets after 2026), New York
//    (its own capped exclusion), Michigan (a state subtraction, not conformity).
//    Every OTHER state also prints its note verbatim, under the generated sentence.
// 2. Reciprocity is modelled nowhere in this repo. Nothing here decides which state
//    taxes cross-state wages; the cross-state panels say so and stop.
// 3. Absence is never inferred from missing data. A researched negative
//    (localIncomeTax.exists === false) is stated; an empty array is not.
// 4. No em dashes in copy written here. Verbatim quoted data keeps its own
//    punctuation, because verbatim wins over house style.

const SIX_VERBATIM = new Set([
  'georgia', 'alabama', 'colorado', 'indiana', 'new-york', 'michigan',
]);

// States whose paycheck engine subtracts pre-tax retirement money the federal way
// even though the state taxes elective deferrals. A modelled inaccuracy, not a gap.
const PRETAX_RETIREMENT_STATES = new Set(['pennsylvania', 'new-jersey']);

const CHIP = {
  yes: { txt: 'Yes', cls: 'v-yes' },
  no: { txt: 'No', cls: 'v-no' },
  partial: { txt: 'Partly', cls: 'v-partial' },
  'n/a': { txt: 'No state income tax', cls: 'v-na' },
  unclear: { txt: 'Not settled', cls: 'v-unclear' },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function humanDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(iso || '');
}

const usd0 = (n) => '$' + Math.round(n).toLocaleString('en-US');
// Keeps cents when the figure genuinely has them (a $411.91 annual cap must not
// be rounded into a different number than the state published).
const usd = (n) => (Number.isInteger(Number(n))
  ? usd0(n)
  : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (r) => (r * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%';

function firstUrl(text) {
  const m = /(https?:\/\/[^\s)"']+)/.exec(String(text || ''));
  return m ? m[1].replace(/[.,;]+$/, '') : '';
}

export function buildWamParts(deps) {
  const { states, obbba, taxData, payroll, supplemental, esc } = deps;

  const OB_DATE = humanDay((obbba._meta && obbba._meta.lastSourced) || '2026-07-07');
  const PAY_DATE = humanDay(payroll._sourcedOn || '2026-06-26');
  const TAX_DATE = humanDay(
    (taxData._meta && (taxData._meta.lastSourced || taxData._meta.stateConfirmed)) || '2026-06-26'
  );
  const TAX_YEAR = String(taxData.taxYear || 2026);

  // Every source URL used anywhere on the page, so the closing block can list the
  // federal authorities without any hand-maintained list.
  const federalSources = [];
  const seenSource = new Set();
  const noteSource = (url, label) => {
    const u = String(url || '').trim();
    if (!u || seenSource.has(u)) return;
    seenSource.add(u);
    federalSources.push({ url: u, label });
  };

  const src = (url, label) => {
    const u = String(url || '').trim();
    if (!u) return '';
    let host = u;
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (_) { /* keep raw */ }
    return `<p class="wam-src"><a href="${esc(u)}" rel="nofollow noopener" target="_blank">`
      + `${esc(label || 'Source')}: ${esc(host)}</a></p>`;
  };

  // Two lines, never merged: what tax year the rule is for, and when we last looked.
  const asOf = (checkedOn) =>
    `<p class="wam-asof">Applies to tax year ${TAX_YEAR}.</p>`
    + `<p class="wam-asof">We last checked this on ${esc(checkedOn)}.</p>`;

  const btn = (href, label) =>
    `<p class="wam-cta"><a class="btn-primary" href="${esc(href)}">${esc(label)}</a></p>`;

  // ── screen 1 pickers ──────────────────────────────────────────────────────
  const stateOptions = states
    .map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}</option>`).join('\n');
  const stateIndexLinks = states
    .map((s) => `<li><a href="#state-${esc(s.slug)}">${esc(s.name)}</a></li>`).join('\n');

  // ── the employeePrograms vs payrollContributions diff, computed, not listed ──
  // A program the state documents as employee-paid but that our paycheck estimate
  // does not subtract has to be surfaced, or the page contradicts its own calculator.
  //
  // The word match below is deliberately strict, because a FALSE match is the
  // dangerous one: it would silently drop a genuinely unmodelled program from the
  // page. Two real labels cannot be matched by any safe rule, so they opt in by
  // name instead of by loosening the rule for all 51 states:
  //   "WA Cares" -> the only distinctive word is "Cares", a short ordinary word
  //                 the generic-phrase guard rejects on purpose.
  //   "PA UC"    -> "UC" is a two-letter acronym, under the acronym length floor,
  //                 and the payroll file spells it out as "Unemployment Compensation".
  // A program carrying `_matches` names the payrollContributions rows it already
  // covers. Comparison is on the normalized form, so punctuation and dash style on
  // either side are irrelevant.
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function unmatchedContributions(slug) {
    const td = taxData.states[slug] || {};
    const pd = payroll.states[slug] || {};
    const eps = td.employeePrograms || [];
    const pcs = pd.payrollContributions || [];
    if (!pcs.length) return [];
    const keys = [];
    const explicit = new Set();
    for (const ep of eps) {
      for (const m of ep._matches || []) explicit.add(normalize(m));
      const label = String(ep.label || '');
      // Drop a leading state abbreviation ("WA PFML" -> "PFML") so the phrase match
      // works against the payroll file's longer, differently-worded names.
      const stripped = label.replace(/^[A-Z]{2}\s+/, '');
      for (const tok of stripped.split(/[^A-Za-z]+/)) {
        if (tok.length >= 3 && tok === tok.toUpperCase()) keys.push(normalize(tok));
      }
      const phrase = normalize(stripped);
      if (phrase && !/^[a-z]{3,6}$/.test(phrase.replace(/\s/g, ''))) keys.push(phrase);
    }
    return pcs.filter((pc) => {
      const n = normalize(pc.name);
      if (explicit.has(n)) return false;
      const words = new Set(n.split(' '));
      return !keys.some((k) => (k.includes(' ') ? n.includes(k) : words.has(k)));
    });
  }

  // ── per-state fragment builders ───────────────────────────────────────────
  const bandA = { i1: [], i2: [], i3: [], i9: [], i10: [] };
  const crossNodes = [];
  const movedNodes = [];
  const echoState = [];
  const echoCross = [];
  const echoMoved = [];
  const stateBlocks = [];
  const verdictBlocks = [];
  const sec3Inline = [];
  const sec3More = [];

  for (const s of states) {
    const slug = s.slug;
    const name = s.name;
    const td = taxData.states[slug] || {};
    const pd = payroll.states[slug] || {};
    const ob = obbba.states[slug] || {};
    const sp = (supplemental.states || {})[slug] || {};
    const local = pd.localIncomeTax || {};
    const obNote = ob.note ? String(ob.note) : '';
    const obSrc = ob.source || '';

    echoState.push(`<span class="g" data-st="${esc(slug)}">You live in ${esc(name)}.</span>`);
    echoCross.push(`<span class="g" data-cross="${esc(slug)}">${esc(name)}</span>`);
    echoMoved.push(`<span class="g" data-mfrom="${esc(slug)}">${esc(name)}</span>`);
    const nodeBody = `${esc(name)}: <a href="#state-${esc(slug)}">what we hold on ${esc(name)}</a>`
      + (obSrc ? ` and <a href="${esc(obSrc)}" rel="nofollow noopener" target="_blank">our source for ${esc(name)}</a>` : '')
      + `.`;
    crossNodes.push(`<li class="g" data-cross="${esc(slug)}">${nodeBody}</li>`);
    movedNodes.push(`<li class="g" data-mfrom="${esc(slug)}">${nodeBody}</li>`);

    // ── SECTION 1 ───────────────────────────────────────────────────────────
    const cards1 = [];

    // 1.1 the shape of the state income tax
    const t = td.tax || {};
    let shape;
    if (!td.hasIncomeTax || t.type === 'none') {
      shape = `${name} has no state income tax on wages.`;
    } else if (t.type === 'flat') {
      shape = `${name} has one flat rate of ${pct(t.rate)} on income.`;
    } else {
      shape = `${name} uses brackets, so the rate rises as income rises.`;
    }
    cards1.push(
      `<article class="wam-card rule">`
      + `<h4>State income tax in ${esc(name)}</h4>`
      + `<p>${esc(shape)}</p>`
      + `<p class="wam-note">These assume you pay tax in one state only.</p>`
      + asOf(TAX_DATE)
      + src(firstUrl(td._source), 'Source')
      + btn(`/${slug}-paycheck-calculator/`, 'Do the math')
      + `</article>`
    );

    // 1.2 what actually leaves the paycheck, including rows our estimate leaves out
    const eps = td.employeePrograms || [];
    const unmatched = unmatchedContributions(slug);
    if (eps.length || unmatched.length) {
      const rows = [];
      for (const ep of eps) {
        // Only state a cap when the data carries one. An absent cap field is
        // unknown, not "no cap", and this page never infers absence from missing data.
        const cap = ep.wageBase
          ? `, up to ${usd(ep.wageBase)} of wages`
          : (ep.annualMax ? `, capped at ${usd(ep.annualMax)} a year`
            : (ep.weeklyMax ? `, capped at ${usd(ep.weeklyMax)} a week` : ''));
        rows.push(
          `<li><strong>${esc(ep.label)}</strong>: ${esc(pct(ep.rate))} of pay${esc(cap)}.`
          + (ep._fullName ? ` <span class="wam-sub">${esc(ep._fullName)}</span>` : '')
          + (ep._source ? ` <a href="${esc(ep._source)}" rel="nofollow noopener" target="_blank">source</a>` : '')
          + `</li>`
        );
      }
      for (const pc of unmatched) {
        rows.push(
          `<li><strong>${esc(pc.name)}</strong>: ${esc(pc.employeeRate2026)}`
          + (pc.wageBaseOrCap ? `, ${esc(pc.wageBaseOrCap)}` : '') + `. `
          + `<em>Not in our take-home estimate.</em>`
          + (pc.source ? ` <a href="${esc(pc.source)}" rel="nofollow noopener" target="_blank">source</a>` : '')
          + `</li>`
        );
      }
      cards1.push(
        `<article class="wam-card rule">`
        + `<h4>Programs paid out of pay in ${esc(name)}</h4>`
        + `<ul class="wam-list">${rows.join('')}</ul>`
        + `<p class="wam-note">Whether any of these reach your own pay depends on the work being covered ${esc(name)} employment.</p>`
        + asOf(PAY_DATE)
        + btn(`/${slug}-paycheck-calculator/`, 'Do the math')
        + `</article>`
      );
    }

    // 1.3 local income tax, both branches always printed, notes verbatim
    if (local.notes) {
      const head = local.exists
        ? `Some places in ${name} levy their own income tax`
        : `No city or county income tax anywhere in ${name}`;
      cards1.push(
        `<article class="wam-card rule">`
        + `<h4>${esc(head)}</h4>`
        + `<p class="wam-verbatim">${esc(local.notes)}</p>`
        + asOf(PAY_DATE)
        + src(local.source, 'Source')
        + `</article>`
      );
    }

    // 1.5 how a bonus is withheld (only when the reader said they get one)
    const suppLines = [];
    if (sp.method === 'flat') {
      suppLines.push(`${name} withholds a flat ${pct(sp.rate)} on bonuses.`);
    } else if (sp.method === 'regular') {
      suppLines.push(`${name} has no separate bonus rate. It withholds the same way as your regular pay.`);
    } else if (sp.method === 'none') {
      suppLines.push(`${name} has no state income tax, so nothing is withheld for state income tax on a bonus.`);
    } else if (sp.special === 'ca_dual') {
      suppLines.push('10.23% on bonuses and stock options, and 6.6% on other supplemental pay.');
    } else if (sp.special === 'pct_of_federal') {
      suppLines.push('Vermont works out the tax on your bonus as 30% of the federal tax already taken off it, not 30% of the bonus itself. So if $220 of federal tax comes off a $1,000 bonus, Vermont\'s share is worked out from that $220.');
    } else if (sp.special === 'wi_banded') {
      suppLines.push('Wisconsin uses four bands, set by your annual gross wages: 3.54%, 4.65%, 5.30% and 7.65%.');
    }
    if (suppLines.length) {
      cards1.push(
        `<article class="wam-card rule g" data-has="bonus">`
        + `<h4>How a bonus is withheld in ${esc(name)}</h4>`
        + `<p>Federal: a flat 22% on bonuses up to $1,000,000 for the year, and 37% on anything above that.</p>`
        + suppLines.map((l) => `<p>${esc(l)}</p>`).join('')
        + `<p class="wam-note">Withholding is what comes off on the day. It is not the tax you end up owing.</p>`
        + asOf(TAX_DATE)
        + src(sp._sourceUrl || firstUrl(sp.source), 'Source')
        + btn(`/${slug}-bonus-tax-calculator/`, 'Do the math')
        + `</article>`
      );
    }

    // 1.6 one already-written, already-sourced fact about the state, verbatim
    const facts = pd.distinctiveFacts || [];
    const fact = facts[1] || facts[0];
    if (fact && fact.fact) {
      cards1.push(
        `<article class="wam-card">`
        + `<h4>About ${esc(name)}</h4>`
        + `<p class="wam-verbatim">${esc(fact.fact)}</p>`
        + asOf(PAY_DATE)
        + src(fact.source, 'Source')
        + `</article>`
      );
    }

    stateBlocks.push(
      `<section class="st-block g" data-st="${esc(slug)}" id="state-${esc(slug)}">`
      + `<h3>${esc(name)}</h3>${cards1.join('')}</section>`
    );

    // ── SECTION 2: the two conformity verdicts ──────────────────────────────
    const verdictCard = (axis, axisLabel, breakLabel) => {
      const data = ob[axis] || {};
      // A state with no wage income tax gets the generated "no state return for this
      // deduction to appear on" sentence, which already carries everything the raw
      // note says. Printing the note under it as well would repeat the claim in the
      // stronger wording a safety review ruled out for this page. The note itself is
      // untouched in the data file, so the two data study pages still print it.
      const noteSuppressed = data.y2025 === 'n/a' && data.y2026 === 'n/a';
      const verbatimOnly = SIX_VERBATIM.has(slug)
        || data.y2025 !== data.y2026
        || data.y2026 === 'partial' || data.y2025 === 'partial';
      const yearHalf = (yr, val) => {
        const c = CHIP[val] || CHIP.unclear;
        const suffix = slug === 'indiana' ? ' <span class="wam-chip-note">for tax year 2026 only</span>' : '';
        const sentence = verbatimOnly ? '' : verdictSentence(val, name, breakLabel);
        return `<div class="g" data-year="${yr}">`
          + `<p class="wam-chipline">For tax year ${yr}: <span class="chip ${c.cls}">${esc(c.txt)}</span>`
          + (yr === '2026' ? suffix : '') + `</p>`
          + (sentence ? `<p>${esc(sentence)}</p>` : '')
          + `</div>`;
      };
      return `<article class="wam-card rule g" data-has="${axis === 'tips' ? 'tips' : 'ot'}">`
        + `<h4>The new federal break on ${esc(axisLabel)} in ${esc(name)}</h4>`
        + yearHalf('2025', data.y2025)
        + yearHalf('2026', data.y2026)
        + (obNote && !noteSuppressed
          ? `<p class="wam-detail-h">The detail on this one</p><p class="wam-verbatim">${esc(obNote)}</p>`
          : '')
        + asOf(OB_DATE)
        + src(obSrc, 'Source')
        + btn(axis === 'tips' ? '/tips-tax-calculator/' : '/overtime-tax-calculator/', 'Do the math')
        + `<p class="wam-note"><a href="${axis === 'tips' ? '/data/tips-tax-by-state/' : '/data/overtime-tax-by-state/'}">See every state side by side</a>.</p>`
        + `</article>`;
    };

    verdictBlocks.push(
      `<div class="g" data-st="${esc(slug)}">`
      + `<h3>${esc(name)}</h3>`
      + verdictCard('tips', 'tips', 'tips')
      + verdictCard('overtime', 'overtime', 'overtime')
      + `</div>`
    );

    // ── SECTION 3: what we do not work out, per state ───────────────────────
    const inline = [];
    const more = [];

    if (local.exists && local.notes) {
      const n = String(local.notes);
      let consequence;
      if (/employer-paid|employer paid/i.test(n)) {
        consequence = `${name}'s only local wage levy is paid by the employer, not taken out of your pay.`;
      } else if (/fixed dollar fee|per-worker|not a tax on income/i.test(n)) {
        consequence = `The local charge ${name} documents is a flat fee, not a percentage, and we do not include it.`;
      } else {
        consequence = 'Our calculators do not include local income tax. If the place you live or work levies one, the take-home pay our calculators show you is bigger than the amount that will actually land in your account.';
      }
      inline.push(
        `<article class="wam-gap gap">`
        + `<h4>Local income tax in ${esc(name)}</h4>`
        + `<p class="wam-verbatim">${esc(n)}</p>`
        + `<p>${esc(consequence)}</p>`
        + `<p>We cannot resolve this without knowing your city or county.</p>`
        + asOf(PAY_DATE)
        + src(local.source, 'Source')
        + `</article>`
      );
    }

    if (unmatched.length) {
      inline.push(
        `<article class="wam-gap gap">`
        + `<h4>Programs ${esc(name)} documents as employee-paid that our estimate does not subtract</h4>`
        + `<ul class="wam-list">`
        + unmatched.map((pc) =>
          `<li><strong>${esc(pc.name)}</strong>: ${esc(pc.employeeRate2026)}`
          + (pc.wageBaseOrCap ? `, ${esc(pc.wageBaseOrCap)}` : '') + `.`
          + (pc.source ? ` <a href="${esc(pc.source)}" rel="nofollow noopener" target="_blank">source</a>` : '')
          + `</li>`).join('')
        + `</ul>`
        + `<p>Our paycheck calculator does not subtract these, so the take-home pay it shows you is bigger than the amount that will actually land in your account.</p>`
        + asOf(PAY_DATE)
        + `</article>`
      );
    }

    if ((td.tax || {}).type === 'bracket' && !(td.tax || {}).standardDeduction) {
      inline.push(
        `<article class="wam-gap gap">`
        + `<h4>${esc(name)} has no state standard deduction in our data</h4>`
        + `<p>We hold no state standard deduction for ${esc(name)}, so the state tax we show is smaller than what you will actually pay.</p>`
        + asOf(TAX_DATE)
        + `</article>`
      );
    }

    if (PRETAX_RETIREMENT_STATES.has(slug)) {
      inline.push(
        `<article class="wam-gap gap">`
        + `<h4>Money you put into a retirement plan in ${esc(name)}</h4>`
        + `<p>${esc(name)} taxes money you put into a retirement plan, and our estimate treats it the federal way, so the state tax we show is smaller than what you will actually pay.</p>`
        + asOf(TAX_DATE)
        + `</article>`
      );
    }

    if (slug === 'new-york' && sp.localNote) {
      more.push(
        `<article class="wam-gap gap g" data-has="bonus">`
        + `<h4>Bonuses inside New York City and Yonkers</h4>`
        + `<p class="wam-verbatim">${esc(sp.localNote)}</p>`
        + asOf(TAX_DATE)
        + `</article>`
      );
    }

    const fy = Number(td.figureYear);
    if (fy && fy !== Number(TAX_YEAR)) {
      more.push(
        `<article class="wam-gap gap">`
        + `<h4>${esc(name)} figures are on ${fy} tables</h4>`
        + `<p>We show ${esc(name)}'s official ${fy} tax figures because ${TAX_YEAR} figures were not published when we checked.</p>`
        + (slug === 'california'
          ? `<p>California's extra 1% on income over $1,000,000 is not included.</p>` : '')
        + asOf(TAX_DATE)
        + `</article>`
      );
    }

    if (inline.length) sec3Inline.push(`<div class="g" data-st="${esc(slug)}">${inline.join('')}</div>`);
    if (more.length) sec3More.push(`<div class="g" data-st="${esc(slug)}">${more.join('')}</div>`);

    // ── Band A, the per-state halves ────────────────────────────────────────
    if (slug === 'washington') {
      bandA.i1.push(`<li class="g" data-st="washington">Washington has no state income tax, and Paid Family and Medical Leave premiums are still withheld from covered Washington wages.</li>`);
    }
    if (local.exists && local.notes) {
      bandA.i2.push(
        `<li class="g" data-st="${esc(slug)}"><span class="wam-verbatim">${esc(local.notes)}</span>`
        + (local.source ? ` <a href="${esc(local.source)}" rel="nofollow noopener" target="_blank">source</a>` : '')
        + `</li>`
      );
    }
    for (const [axis, axisLabel, has] of [['tips', 'tips', 'tips'], ['overtime', 'overtime', 'ot']]) {
      const d = ob[axis] || {};
      for (const yr of ['2025', '2026']) {
        if (d['y' + yr] === 'no') {
          bandA.i3.push(
            `<li class="g" data-st="${esc(slug)}" data-has="${has}" data-year="${yr}">`
            + `${esc(name)} has not adopted the new federal break on ${esc(axisLabel)}.</li>`
          );
        }
      }
    }
    const tipsChanged = (ob.tips || {}).y2025 !== (ob.tips || {}).y2026;
    const otChanged = (ob.overtime || {}).y2025 !== (ob.overtime || {}).y2026;
    if (tipsChanged || otChanged) {
      bandA.i9.push(`<li class="g" data-st="${esc(slug)}">${esc(name)}'s answer is different for 2025 and 2026.</li>`);
    }
    if (slug === 'colorado') {
      bandA.i10.push(`<li class="g" data-st="colorado">Colorado's 2026 change is under a legal challenge.</li>`);
    }
  }

  function verdictSentence(value, name, breakLabel) {
    if (value === 'yes') {
      return `${name} follows the new federal break on ${breakLabel}. Where the federal deduction applies, `
        + `it also reduces the income ${name} taxes, not just federal income.`;
    }
    if (value === 'no') {
      return `As of mid-2026, ${name} has not adopted the new federal break on ${breakLabel}. On what we `
        + `checked, the deduction lowers your federal tax only and ${name} still counts that pay as taxable `
        + `income on the state return. States change this, so check the source below before you file.`;
    }
    if (value === 'n/a') {
      return `${name} has no state income tax on wages, so there is no state return for this deduction to `
        + `appear on. It only affects federal income tax.`;
    }
    return '';
  }

  // ── Band A, assembled in the plan's numeric order ──────────────────────────
  const bandAItems = [
    bandA.i1.join('\n'),
    bandA.i2.join('\n'),
    bandA.i3.join('\n'),
    `<li class="g" data-married="yes" data-has="tips ot age">If you are married, two of these breaks only exist on a joint return.</li>`,
    `<li class="g" data-has="tips ot">Social Security and Medicare still come out of tips and overtime.</li>`,
    `<li class="g" data-has="tips">The tips deduction only covers occupations on a published Treasury list.</li>`,
    `<li class="g" data-has="give">From 2026 there is a deduction for cash gifts to charity for people who take the standard deduction.</li>`,
    `<li class="g" data-has="home">If you add up your deductions, mortgage insurance is deductible again from 2026.</li>`,
    bandA.i9.join('\n'),
    bandA.i10.join('\n'),
  ].filter(Boolean).join('\n');

  // ── the federal cards, emitted once ───────────────────────────────────────
  const F = obbba.federal;
  noteSource(F.tips.sources[0].url, 'IRS: deductions for working Americans and seniors');
  noteSource(F.tips.sources[2] ? F.tips.sources[2].url : '', 'Treasury and IRS: final regulations on tipped occupations');
  noteSource(F.overtime.sources[0].url, 'IRS: questions and answers on the overtime deduction');
  noteSource(F.senior.sources[0].url, 'Public Law 119-21, the statute itself');
  noteSource(F.salt.sources[0].url, 'Public Law 119-21 as enrolled, SALT');
  noteSource(F.carLoan.sources && F.carLoan.sources[0] ? F.carLoan.sources[0].url : '', 'Car loan interest deduction');
  noteSource(F.charitable.sources && F.charitable.sources[0] ? F.charitable.sources[0].url : '', 'Charitable deduction changes');
  noteSource(F.mip.sources && F.mip.sources[0] ? F.mip.sources[0].url : '', 'Mortgage insurance premium deduction');
  noteSource(F.qcd.sources && F.qcd.sources[0] ? F.qcd.sources[0].url : '', 'Qualified charitable distributions');

  const tipsCap = F.tips.cap.single;
  const tipsPo = F.tips.phaseoutStartMagi;
  const tipsGone = F.tips.fullPhaseoutMagi;
  const otCap = F.overtime.cap;
  const otPo = F.overtime.phaseoutStartMagi;
  const otGone = F.overtime.fullPhaseoutMagi;
  const sen = F.senior;
  const car = F.carLoan;
  const ch = F.charitable;
  const mip = F.mip;
  const qcd = F.qcd;
  const salt = F.salt;
  const asdY = qcd.ageStandardDeductionAddition.byYear[TAX_YEAR]
    || qcd.ageStandardDeductionAddition.byYear['2026'];

  // Income band annotations. The band never removes a card, and every line ends by
  // saying income is only one condition, because the band knows one number only.
  const bandLine = (thresholdSingle, thresholdJoint, goneSingle, goneJoint) => {
    const rows = [];
    const mk = (bandKey, married, text) =>
      `<p class="wam-band g" data-band="${bandKey}" data-married="${married}">Where you are: ${esc(text)}</p>`;
    const forStatus = (married, start, gone) => {
      const bands = [
        ['a', 0, 75000], ['b', 75000, 100000], ['c', 100000, 150000],
        ['d', 150000, 300000], ['e', 300000, Infinity],
      ];
      const tail = " Income is only one of this rule's conditions.";
      for (const [key, lo, hi] of bands) {
        const holdsStart = lo <= start && start < hi;
        const holdsGone = lo < gone && gone < hi;
        let text;
        if (hi <= start) {
          text = `The income band you picked sits below where this limit starts to shrink (${usd0(start)}).`;
        } else if (lo >= gone) {
          text = `This limit is fully phased out above ${usd0(gone)}, which is below the band you picked, so it may not reach you. The calculator will tell you either way.`;
        } else if (holdsStart && holdsGone) {
          text = `The band you picked spans both the point where this limit starts to shrink (${usd0(start)}) and the point where it is gone (${usd0(gone)}). The calculator will tell you either way.`;
        } else if (holdsStart) {
          text = `The band you picked crosses the point where this limit starts to shrink (${usd0(start)}).`;
        } else if (holdsGone) {
          text = `This limit is already shrinking across the band you picked, and it is gone above ${usd0(gone)}. The calculator will tell you either way.`;
        } else {
          text = `This limit is already shrinking across the whole band you picked. The calculator will tell you either way.`;
        }
        rows.push(mk(key, married, text + tail));
      }
    };
    forStatus('no', thresholdSingle, goneSingle);
    forStatus('unsure', thresholdSingle, goneSingle);
    forStatus('yes', thresholdJoint, goneJoint);
    return rows.join('');
  };

  const federalCards = [
    // TIPS
    `<article class="wam-card rule g" data-has="tips">`
    + `<h4>The federal deduction for tips</h4>`
    + `<p>The 2025 law created a federal deduction for tips for tax years 2025 through 2028. You can claim it even if you do not add up your deductions one by one.</p>`
    + `<ul class="wam-list">`
    + `<li>Most you can deduct: ${usd0(tipsCap)}. <strong>This is one limit per tax return. It is not doubled if you are married and file together.</strong></li>`
    + `<li>You get the full amount if you make up to: ${usd0(tipsPo.single)} on your own, or ${usd0(tipsPo.married)} if you are married and file together.</li>`
    + `<li>Above that it shrinks: you lose $${F.tips.phaseoutReductionPer1000} of the break for every $1,000 you make over the line.</li>`
    + `<li>It is gone completely at: ${usd0(tipsGone.single)} on your own, or ${usd0(tipsGone.married)} married filing together.</li>`
    + `<li>You need a Social Security number on the return.</li>`
    + `</ul>`
    + `<p>Not every job that gets tips counts. The government publishes a list of jobs that do, and yours has to be on it. <a href="/data/treasury-tipped-occupation-codes/">See the published list</a>.</p>`
    + `<p>If you work for yourself, this break cannot be bigger than the profit your business made. Some kinds of business cannot claim it at all, including health, law, accounting, consulting and financial services.</p>`
    + bandLine(tipsPo.single, tipsPo.married, tipsGone.single, tipsGone.married)
    + asOf(OB_DATE) + src(F.tips.sources[0].url, 'Source')
    + btn('/tips-tax-calculator/', 'Do the math')
    + `</article>`,

    // OVERTIME
    `<article class="wam-card rule g" data-has="ot">`
    + `<h4>The federal deduction for overtime</h4>`
    + `<p>Only the extra part counts, not the whole overtime payment. If you normally get $20 an hour and overtime pays $30, only the extra $10 an hour counts here.</p>`
    + `<p>Overtime you are owed only because of a contract, a union agreement or a state law does not count. It has to be overtime the federal wage law requires.</p>`
    + `<ul class="wam-list">`
    + `<li>Most you can deduct: ${usd0(otCap.single)} on your own, ${usd0(otCap.married)} married filing together.</li>`
    + `<li>You get the full amount if you make up to: ${usd0(otPo.single)} on your own, or ${usd0(otPo.married)} married filing together.</li>`
    + `<li>Above that it shrinks by $${F.overtime.phaseoutReductionPer1000} for every $1,000 you make over the line.</li>`
    + `<li>It is gone completely at ${usd0(otGone.single)} on your own, or ${usd0(otGone.married)} married filing together.</li>`
    + `<li>You need a Social Security number on the return.</li>`
    + `</ul>`
    + bandLine(otPo.single, otPo.married, otGone.single, otGone.married)
    + asOf(OB_DATE) + src(F.overtime.sources[0].url, 'Source')
    + btn('/overtime-tax-calculator/', 'Do the math')
    + `</article>`,

    // JOINT RETURN
    `<article class="wam-card g" data-married="yes" data-has="tips ot age">`
    + `<h4>If you are married</h4>`
    + `<p>If you are married, you only get these two breaks, and the ${usd0(sen.amountPerPerson)} senior deduction, when you and your husband or wife put your income on one joint tax return together. If you each file your own separate return, neither of you gets them. This is not us telling you how to file, it is just how these two breaks work. Car loan interest is the exception: it still works on a separate return.</p>`
    + asOf(OB_DATE) + src(F.senior.sources[0].url, 'Source')
    + `</article>`,

    // SENIOR
    `<article class="wam-card rule g" data-has="age">`
    + `<h4>The federal deduction for people 65 and older</h4>`
    + `<p>${usd0(sen.amountPerPerson)} for each person who is 65 or older, for tax years ${sen.firstYear} through ${sen.lastYear}. It shrinks by ${(sen.phaseoutRate * 100).toFixed(0)}% of everything you make over ${usd0(sen.phaseoutStartMagi.single)} on your own, or ${usd0(sen.phaseoutStartMagi.married)} married filing together.</p>`
    + `<p>Gone at ${usd0(sen.fullPhaseoutMagi.single)} on your own, or ${usd0(sen.fullPhaseoutMagi.married)} married filing together.</p>`
    + `<p>This comes off after your income total is worked out, so it does not change that total, and it does not change how much of your Social Security gets taxed. It does not rise with inflation.</p>`
    + bandLine(sen.phaseoutStartMagi.single, sen.phaseoutStartMagi.married, sen.fullPhaseoutMagi.single, sen.fullPhaseoutMagi.married)
    + asOf(OB_DATE) + src(F.senior.sources[0].url, 'Source')
    + btn('/senior-deduction-calculator/', 'Do the math')
    + `</article>`,

    // AGE 65 STANDARD DEDUCTION ADDITION
    `<article class="wam-card rule g" data-has="age">`
    + `<h4>The extra standard deduction at 65</h4>`
    + `<p>Separate from the ${usd0(sen.amountPerPerson)} above, and not the same thing. For ${TAX_YEAR} it adds ${usd0(asdY.single)} if you file on your own, as head of household, separately, or as a qualifying surviving spouse, and ${usd0(asdY.marriedPerSpouse)} for each qualifying spouse on a joint return. Do not count it twice with the ${usd0(sen.amountPerPerson)}.</p>`
    + asOf(OB_DATE) + src(firstUrl(qcd.ageStandardDeductionAddition._source), 'Source')
    + `</article>`,

    // QCD
    `<article class="wam-card rule g" data-has="age give">`
    + `<h4>Giving straight from an IRA</h4>`
    + `<p>This one starts at 70 and a half, not 65, and it only works from certain accounts.</p>`
    + `<p>You have to have reached 70 and a half. It works from a traditional IRA, and from a SEP or SIMPLE IRA that is no longer being paid into. It does <strong>not</strong> work from a 401(k), a 403(b) or a 457.</p>`
    + `<p>The money has to go straight from the account to the charity, and the whole gift has to be one you could have deducted in full. Donor-advised funds and private foundations do not count.</p>`
    + `<p>Limit for ${TAX_YEAR}: ${usd0(qcd.annualLimitByYear[TAX_YEAR] || qcd.annualLimitByYear['2026'])} per person. It is left out of your income, so it does lower your income total.</p>`
    + asOf(OB_DATE) + src(qcd.sources && qcd.sources[0] ? qcd.sources[0].url : '', 'Source')
    + btn('/qcd-vs-charitable-deduction-calculator/', 'Do the math')
    + `</article>`,

    // CAR LOAN
    `<article class="wam-card rule g" data-has="car">`
    + `<h4>Interest on a new car loan</h4>`
    + `<p>New vehicle, first owner. Final assembly in the United States. Loan taken after 31 December 2024, secured by a first lien on the vehicle, not a lease, not from a relative. Personal use, under 14,000 lbs. The VIN goes on the return.</p>`
    + `<p>${usd0(car.interestCap)} of interest per tax return, not per vehicle. Full amount up to ${usd0(car.phaseoutStartMagi.single)} on your own, or ${usd0(car.phaseoutStartMagi.married)} married filing together. It shrinks by $${car.phaseoutReductionPer1000} for every $1,000 over that, and is gone at ${usd0(car.fullPhaseoutMagi.single)} or ${usd0(car.fullPhaseoutMagi.married)}. It works on a separate return.</p>`
    + `<p>This comes off after your income total is worked out, so it does not change that total.</p>`
    + bandLine(car.phaseoutStartMagi.single, car.phaseoutStartMagi.married, car.fullPhaseoutMagi.single, car.fullPhaseoutMagi.married)
    + asOf(OB_DATE) + src(car.sources && car.sources[0] ? car.sources[0].url : '', 'Source')
    + btn('/car-loan-interest-calculator/', 'Do the math')
    + `</article>`,

    // CHARITY, NON-ITEMIZER
    `<article class="wam-card rule g" data-has="give">`
    + `<h4>Giving to charity when you take the standard deduction</h4>`
    + `<p>From ${ch.firstYear} there is a deduction for cash gifts to charity for people who take the standard deduction. Up to ${usd0(ch.nonItemizer.cap.single)}, or ${usd0(ch.nonItemizer.cap.married)} if you are married and file together.</p>`
    + `<p>Cash only, and only to a public charity. Donor-advised funds, private foundations and supporting organisations do not count. Nothing left over carries into next year. This one is permanent and does not rise with inflation.</p>`
    + asOf(OB_DATE) + src(ch.sources && ch.sources[0] ? ch.sources[0].url : '', 'Source')
    + btn('/charitable-deduction-calculator/', 'Do the math')
    + `</article>`,

    // CHARITY, ITEMIZER FLOOR
    `<article class="wam-card rule g" data-has="give">`
    + `<h4>Giving to charity when you add up your deductions</h4>`
    + `<p>If you do add up your deductions, from ${ch.firstYear} the first half a percent of your income worth of giving does not count.</p>`
    + asOf(OB_DATE) + src(ch.sources && ch.sources[0] ? ch.sources[0].url : '', 'Source')
    + btn('/charitable-deduction-calculator/', 'Do the math')
    + `</article>`,

    // SALT
    `<article class="wam-card rule g" data-has="home">`
    + `<h4>State and local taxes you paid <span class="wam-label">only if you add up your deductions</span></h4>`
    + `<p>Cap for ${TAX_YEAR}: ${usd0(salt.capByYear[TAX_YEAR] || salt.capByYear['2026'])}. It comes down by ${(salt.phaseDownRate * 100).toFixed(0)}% of everything you make over ${usd0(salt.thresholdByYear[TAX_YEAR] || salt.thresholdByYear['2026'])}, but never below ${usd0(salt.floor)}. Half of that if you are married and file separately.</p>`
    + asOf(OB_DATE) + src(salt.sources[0].url, 'Source')
    + btn('/salt-cap-calculator/', 'Do the math')
    + `</article>`,

    // MIP
    `<article class="wam-card rule g" data-has="home">`
    + `<h4>Mortgage insurance <span class="wam-label">only if you add up your deductions and you pay PMI, FHA MIP, a VA funding fee or a USDA fee</span></h4>`
    + `<p>Back from ${mip.firstYear} and permanent. It comes down ${(mip.phaseout.reductionPerStep * 100).toFixed(0)}% for each $1,000 you make over ${usd0(mip.phaseout.threshold.single)}, and is gone above ${usd0(mip.phaseout.eliminatedAboveAgi.single)}. If you paid a lump sum up front, it is spread over the shorter of the loan term or ${mip.prepaid.amortizationMonthsMax} months.</p>`
    + `<p>If you are married and file separately, those figures halve: it comes down for each ${usd0(mip.phaseout.stepSize.married_separate)} you make over ${usd0(mip.phaseout.threshold.married_separate)}, and is gone above ${usd0(mip.phaseout.eliminatedAboveAgi.married_separate)}.</p>`
    + asOf(OB_DATE) + src(mip.sources && mip.sources[0] ? mip.sources[0].url : '', 'Source')
    + btn('/pmi-deduction-calculator/', 'Do the math')
    + `</article>`,
  ].join('\n');

  // 1.4 Social Security and Medicare, federal, shown when tips or overtime is checked
  const fica = taxData.federal.fica || {};
  const ficaCard =
    `<article class="wam-card rule g" data-has="tips ot">`
    + `<h4>Social Security and Medicare</h4>`
    + `<p>Social Security: ${pct(fica.socialSecurity.rate)} of your pay up to ${usd0(fica.socialSecurity.wageBase)} for the year.</p>`
    + `<p>Medicare: ${pct(fica.medicare.rate)} of every dollar you earn, with no upper limit. On top of that, an extra ${pct(fica.additionalMedicare.rate)} on anything you earn above ${usd0(fica.additionalMedicare.threshold.single)} on your own, or ${usd0(fica.additionalMedicare.threshold.married)} if you are married and file together.</p>`
    + `<p>The new deductions on tips and overtime do not remove any of this.</p>`
    + asOf(TAX_DATE)
    + btn('/w4-overtime-tips-withholding-calculator/', 'Do the math')
    + `</article>`;

  // ── prebuilt count spans, so nothing is generated in the browser ──────────
  const counterSpans = (attr, max) => {
    const out = [];
    for (let i = 0; i <= max; i++) out.push(`<span class="g" data-${attr}="${i}">${i}</span>`);
    return out.join('');
  };

  const statusSpans = ['2', '3', '4', '4b', '5', '6', 'result']
    .map((k) => `<span class="g" data-step="${k}">${k === 'result' ? 'Your list is ready.' : 'Question ' + k + ' of 6.'}</span>`)
    .join('');

  const echoTriggers = [
    ['tips', 'You get tips.'],
    ['ot', 'You get paid extra for working extra hours.'],
    ['bonus', 'You get a bonus or commission.'],
    ['age', 'Someone in your household turns 65 this year.'],
    ['car', 'You bought a new car with a loan.'],
    ['give', 'You give money to charity.'],
    ['home', 'You own the home you live in.'],
  ].map(([k, txt]) => `<span class="g" data-has="${k}">${txt}</span>`).join('\n');

  const echoMarried = ['yes', 'no'].map((v) =>
    `<span class="g" data-married="${v}">${v === 'yes' ? 'You are married.' : 'You are not married.'}</span>`).join('\n');

  const sourceList = federalSources
    .map((s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.label)}</a></li>`)
    .join('\n');

  return {
    STATE_OPTIONS: stateOptions,
    STATE_INDEX_LINKS: stateIndexLinks,
    STATE_BLOCKS: stateBlocks.join('\n'),
    VERDICT_BLOCKS: verdictBlocks.join('\n'),
    SEC3_INLINE: sec3Inline.join('\n'),
    SEC3_MORE: sec3More.join('\n'),
    BAND_A_ITEMS: bandAItems,
    CROSS_NODES: crossNodes.join('\n'),
    MOVED_NODES: movedNodes.join('\n'),
    ECHO_MOVED: echoMoved.join('\n'),
    FEDERAL_CARDS: federalCards,
    FICA_CARD: ficaCard,
    ECHO_STATE: echoState.join('\n'),
    ECHO_CROSS: echoCross.join('\n'),
    ECHO_TRIGGERS: echoTriggers,
    ECHO_MARRIED: echoMarried,
    STATUS_SPANS: statusSpans,
    RULE_COUNTS: counterSpans('cnt', 40),
    GAP_COUNTS: counterSpans('gapcnt', 12),
    MORE_COUNTS: counterSpans('morecnt', 6),
    SOURCE_LIST: sourceList,
    PAY_DATE: PAY_DATE,
    OB_DATE: OB_DATE,
    TAX_YEAR: TAX_YEAR,
  };
}
