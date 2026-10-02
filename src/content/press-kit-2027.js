// press-kit-2027.js: the dynamic parts of /press/2027/, the 2027 COLA and tax
// press kit page, built from src/press-kit/2027/manifest.json.
//
// The manifest is written by scripts/press-kit/build-press-kit.js in the same
// run that draws the charts and the CSV, so every number and every
// OFFICIAL / ESTIMATE / PROJECTED word on this page comes from the exact data
// the images were drawn from. Nothing here computes a figure; it only words
// what the manifest says. Returns a plain placeholder map for build.js.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const humanDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
};
const listAnd = (a) => (a.length <= 1 ? (a[0] || '') : a.length === 2 ? `${a[0]} and ${a[1]}`
  : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const link = (url, label) => `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)}</a>`;
const tag = (s) => `<strong class="pk-tag">${esc(s)}</strong>`;

/**
 * @param {object} m parsed manifest.json
 * @param {{contactEmail:string}} opts
 * @returns {Record<string,string>} placeholder map for src/templates/press-kit-2027.html
 */
export function pressKitParts(m, { contactEmail }) {
  const { cola, federal: fed, takeHome: th } = m;
  const yr = m.taxYear;
  const fedOfficial = fed.status2027 === 'OFFICIAL';
  const pubs = (fed.source2027 && fed.source2027.publishers) || [];
  const tpItems = (!fedOfficial && fed.source2027.items) || [];
  // "published September 11 to September 18, 2026": the span of the publishers' own dates.
  const tpDays = [...new Set(tpItems.map((i) => i.date))].sort();
  const tpPublished = !tpDays.length ? ''
    : tpDays.length === 1 ? `published ${humanDate(tpDays[0])}`
      : `published ${humanDate(tpDays[0]).replace(/, \d{4}$/, tpDays[0].slice(0, 4) === tpDays[tpDays.length - 1].slice(0, 4) ? '' : '$&')} ` +
        `to ${humanDate(tpDays[tpDays.length - 1])}`;
  const hi = th.spreads[th.spreads.length - 1];
  const priorRows = th.rows.filter((r) => r.priorYear);

  // ---- status table
  const colaStatusText = {
    ESTIMATE: `${esc(cola.publisher)}'s ${esc(cola.percent)}% forecast, published ${esc(humanDate(cola.date))}. ` +
      (cola.expectedAnnouncement
        ? `The Social Security Administration is expected to announce the official figure on ${esc(humanDate(cola.expectedAnnouncement))}.`
        : 'The Social Security Administration has not announced the official figure yet.'),
    CALCULATED: `${esc(cola.percent)}%, calculated from the official September inflation data with the formula ` +
      'Social Security uses. The Social Security Administration\'s own announcement is the final word.',
    OFFICIAL: `${esc(cola.percent)}%, announced by the Social Security Administration on ${esc(humanDate(cola.date))}.`,
  }[cola.status];
  const fedStatusText = fedOfficial
    ? `Official IRS figures, ${esc(fed.source2027.name)}, published ${esc(humanDate(fed.source2027.date))}.`
    : `Projections by ${esc(listAnd(pubs))}, ${esc(tpPublished)}. The IRS has not published ` +
      'official 2027 figures yet; it usually does between early October and early November.';
  const statusRows = [
    ['2027 Social Security cost-of-living increase (COLA)', cola.status, colaStatusText],
    [`${yr + 1} federal income tax brackets and standard deduction`, fed.status2027, fedStatusText],
    [`${yr} federal income tax brackets and standard deduction`, 'OFFICIAL',
      `IRS ${esc(fed.source2026.name)}, published ${esc(humanDate(fed.source2026.date))}.`],
    [`Take-home pay in each state`, `${yr} RULES`,
      `Our paycheck calculator, using each state's published ${yr} income tax and payroll rules` +
      (priorRows.length ? `; ${priorRows.length} jurisdictions still use one ${yr - 1} amount (marked on the chart).` : '.')],
  ].map(([what, st, basis]) => `<tr><th scope="row">${esc(what)}</th><td>${tag(st)}</td><td>${basis}</td></tr>`).join('');

  // ---- one-sentence answer under the H1
  const colaMin = Math.min(...cola.rows.map((r) => r.monthlyIncrease));
  const colaMax = Math.max(...cola.rows.map((r) => r.monthlyIncrease));
  const answer = `${cola.status === 'OFFICIAL' ? 'The' : 'A'} ${esc(cola.percent)}% cost-of-living increase ` +
    `${cola.status === 'ESTIMATE' ? 'would add' : 'adds'} ${usd(colaMin)} to ${usd(colaMax)} a month to Social Security ` +
    `checks of ${usd(cola.rows[0].benefit)} to ${usd(cola.rows[cola.rows.length - 1].benefit)}` +
    `${cola.status === 'ESTIMATE' ? ' (an estimate until the official figure is announced)' : ''}, and on a ` +
    `${usd(hi.salary)} salary, take-home pay differs by up to ${usd(hi.spread)} a year depending on the state.`;

  // ---- the chart blocks, each with its table twin
  // Absolute paths, so the assets resolve whether or not the page URL carries
  // its trailing slash.
  const at = (file) => `${m.pagePath}${file}`;
  const files = m.files.charts;
  const figure = (key, heading, alt, table) => {
    const f = { ...files[key], png: at(files[key].png), svg: at(files[key].svg) };
    return `<section class="pk-chart" id="chart-${esc(key)}">` +
      `<h3>${esc(heading)}</h3>` +
      `<figure><a href="${esc(f.png)}"><img src="${esc(f.svg)}" width="${f.width}" height="${f.height}" ` +
      `alt="${esc(alt)}" loading="lazy" decoding="async"></a></figure>` +
      `<p class="pk-dl">Download: <a href="${esc(f.png)}" download>PNG, ${f.pngWidth} x ${f.pngHeight} pixels</a> · ` +
      `<a href="${esc(f.svg)}" download>SVG (scales to any size)</a></p>` +
      `<details><summary>The numbers behind this chart</summary><div class="pk-wrap">${table}</div></details>` +
      '</section>';
  };
  const colaTable = '<table class="pk-table"><thead><tr><th scope="col">Monthly payment now</th>' +
    '<th scope="col">New monthly payment</th><th scope="col">More each month</th><th scope="col">More each year</th>' +
    '</tr></thead><tbody>' + cola.rows.map((r) => `<tr><th scope="row">${usd(r.benefit)}</th>` +
      `<td class="num">${usd(r.newMonthly)}</td><td class="num">${usd(r.monthlyIncrease)}</td>` +
      `<td class="num">${usd(r.annualIncrease)}</td></tr>`).join('') + '</tbody></table>';
  const fedTable = '<table class="pk-table"><thead><tr><th scope="col">Filing status and wages</th>' +
    `<th scope="col">Federal income tax, ${yr}</th><th scope="col">Federal income tax, ${yr + 1}` +
    `${fedOfficial ? '' : ' (projected)'}</th><th scope="col">Difference</th></tr></thead><tbody>` +
    fed.groups.flatMap((g) => g.rows.map((r) => `<tr><th scope="row">${esc(g.label)}, ${usd(r.wages)}</th>` +
      `<td class="num">${usd(r.tax2026)}</td><td class="num">${usd(r.tax2027)}</td>` +
      `<td class="num">${usd(Math.abs(r.change))} ${r.change >= 0 ? 'less' : 'more'}</td></tr>`)).join('') +
    '</tbody></table>';
  const thTable = '<table class="pk-table"><thead><tr><th scope="col">State</th>' +
    th.salaries.map((s) => `<th scope="col">Take-home on ${usd(s)}</th>`).join('') + '</tr></thead><tbody>' +
    th.rows.map((r) => `<tr><th scope="row">${esc(r.name)}${r.priorYear ? '*' : ''}${r.underReview ? '†' : ''}</th>` +
      r.takeHome.map((v) => `<td class="num">${usd(v)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>' + (th.notes.length ? `<p class="pk-note">${th.notes.map(esc).join(' ')}</p>` : '');

  const charts =
    figure('cola', `Chart 1: what the COLA does to a monthly payment (${cola.status})`,
      `${cola.title}. ${cola.subtitle}`, colaTable) +
    figure('federal', `Chart 2: federal income tax in ${yr + 1} compared with ${yr} (${fed.status2027})`,
      `${fed.title}. ${fed.subtitle}`, fedTable) +
    figure('takeHome', `Chart 3: take-home pay in all 50 states and DC (${yr} rules)`,
      `${th.title}. ${th.subtitle}`, thTable);

  // ---- where each number comes from
  const colaSource = {
    ESTIMATE: `<p><strong>The COLA percentage is an estimate.</strong> We use ${esc(cola.publisher)}'s ` +
      `${esc(cola.percent)}% forecast (${link(cola.sourceUrl, 'their article')}, ${esc(humanDate(cola.date))}). ` +
      'It is their forecast, not ours and not the government\'s. When the Social Security Administration announces ' +
      'the real figure, we replace it and redraw the chart.</p>',
    CALCULATED: `<p><strong>The COLA percentage is calculated from official data.</strong> The ${esc(cola.percent)}% ` +
      'comes from the Bureau of Labor Statistics price index Social Security uses (CPI-W): the July to September ' +
      `2026 average divided by the July to September 2025 average, rounded to one decimal place (${link(cola.sourceUrl, 'BLS data')}). ` +
      'The Social Security Administration\'s announcement is the final word.</p>',
    OFFICIAL: `<p><strong>The COLA percentage is official.</strong> ${esc(cola.percent)}%, announced by the Social ` +
      `Security Administration on ${esc(humanDate(cola.date))} (${link(cola.sourceUrl, 'announcement')}).</p>`,
  }[cola.status] +
    '<p><strong>The dollar amounts are our arithmetic.</strong> We apply that percentage to three example monthly ' +
    'payments and round the new payment down to the whole dollar, as Social Security does. The amounts are gross, ' +
    'before Medicare premiums or tax withholding, which come out of many checks. Try any payment in our ' +
    '<a href="/2027-social-security-cola/">2027 COLA calculator</a>.</p>';

  // How the publishers handled the price month that was never published, read
  // from the data rather than asserted.
  const skippedSig = (i) => `${i.monthsUsed}|${(i.skipped || []).join(',')}`;
  const monthName = (k) => { const [y, m] = String(k).split('-'); return `${MONTHS[+m - 1]} ${y}`; };
  const gapMethod = !tpItems.length ? ''
    : tpItems.every((i) => skippedSig(i) === skippedSig(tpItems[0]))
      ? (tpItems[0].skipped.length
        ? `${tpItems.length > 1 ? 'Each' : 'It'} averaged the ${esc(tpItems[0].monthsUsed)} published months of the price ` +
          `index and left out ${esc(listAnd(tpItems[0].skipped.map(monthName)))} (see the missing month, below). `
        : `${tpItems.length > 1 ? 'Each' : 'It'} used all ${esc(tpItems[0].monthsUsed)} months of the price index. `)
      : 'They handled the missing price month differently (see the missing month, below). ';
  const fedSource = fedOfficial
    ? `<p><strong>Both years are official IRS figures.</strong> ${esc(yr + 1)}: ${link(fed.source2027.sourceUrl, fed.source2027.name)}, ` +
      `published ${esc(humanDate(fed.source2027.date))}. ${esc(yr)}: ${link(fed.source2026.sourceUrl, fed.source2026.name)}.</p>`
    : `<p><strong>The ${esc(yr + 1)} figures are projections, not IRS figures.</strong> The brackets and standard ` +
      `deduction come from projections published by ${listAnd(tpItems.map((i) =>
        `${link(i.sourceUrl, i.publisher)} (${esc(humanDate(i.date))})`))}` +
      `${tpItems.length > 1 ? ', which agree on every figure used here' : ''}. ${gapMethod}` +
      `The ${esc(yr)} figures are official: ${link(fed.source2026.sourceUrl, `IRS ${fed.source2026.name}`)}, published ` +
      `${esc(humanDate(fed.source2026.date))}.</p>`;
  const sd = fed.standardDeduction;
  const fedSource2 = `<p><strong>The tax amounts are our arithmetic.</strong> For each wage level we subtract the ` +
    `standard deduction (${usd(sd[yr].single)} single and ${usd(sd[yr].married)} married filing jointly in ${esc(yr)}; ` +
    `${usd(sd[yr + 1].single)} and ${usd(sd[yr + 1].married)} in ${esc(yr + 1)}${fedOfficial ? '' : ', projected'}) and run the ` +
    'rest through the brackets, using the same calculation as our paycheck calculators. Wages are the only income, ' +
    'there are no credits, and the newer deductions for tips, overtime, seniors and car-loan interest are left out. ' +
    'Pay is held at the same dollar amount in both years, so the difference is what inflation adjustments to the tax ' +
    'brackets alone are worth.</p>' +
    (fedOfficial
      ? '<p>The full brackets for every filing status are on our <a href="/2027-tax-brackets/">2027 tax brackets page</a>.</p>'
      : '<p>Our <a href="/2027-tax-brackets/#others">2027 tax brackets page</a> shows each publisher\'s projected brackets ' +
        'and standard deduction side by side, with a link to each publisher\'s own release.</p>');

  const priorText = priorRows.length
    ? `<p>${esc(priorRows.length)} jurisdictions had not published a ${esc(yr)} amount when these figures were made, ` +
      `so one input comes from ${esc(yr - 1)}: ${esc(th.notes[0].replace(/^\* /, ''))}</p>`
    : '';
  const reviewText = th.underReview.length
    ? `<p><strong>Under review:</strong> ${esc(th.notes[th.notes.length - 1].replace(/^† Under review: /, ''))}</p>`
    : '';
  const thSource = '<p><strong>Take-home pay is our model, run on official rules.</strong> Each figure is a single ' +
    `filer on a salary of ${esc(listAnd(th.salaries.map(usd)))}, taking the standard deduction with no other deductions ` +
    `or credits, under the ${esc(yr)} federal brackets, the ${esc(yr)} Social Security and Medicare rates, and each ` +
    'state\'s published income tax and employee payroll rules (state disability and paid-leave premiums included ' +
    'where employees pay them). City and county income taxes are not included. Every state is on our ' +
    '<a href="/data/take-home-pay-by-state/">take-home pay by state study</a>, which uses the same calculation.</p>' +
    priorText + reviewText;

  return {
    STATUS_ROWS: statusRows,
    ANSWER: answer,
    CHARTS: charts,
    CSV_FILE: esc(at(m.files.csv)),
    SOURCES_COLA: colaSource,
    SOURCES_FED: fedSource + fedSource2,
    SOURCES_TAKE_HOME: thSource,
    CITATION: esc(m.citation),
    DATA_AS_OF: esc(humanDate(m.dataAsOf)),
    CONTACT_EMAIL: esc(contactEmail),
  };
}
