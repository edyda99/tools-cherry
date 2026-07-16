// static-pages.js — content for the non-tool pages AdSense approval expects.
// Bodies use {{SITE_NAME}}, {{SITE_URL}}, {{CONTACT_EMAIL}} tokens, filled at build.
// `robots` controls indexing; legal pages are indexable, contact is too.

export const STATIC_PAGES = [
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    desc: 'How {{SITE_NAME}} handles data, cookies, and advertising.',
    robots: 'index, follow',
    body: `
<p><em>Last updated: July 5, 2026.</em></p>

<p>{{SITE_NAME}} ("we", "us") operates {{SITE_URL}}. This page explains what information
is collected when you use our free online tools, and how it is used.</p>

<h2>Calculators run in your browser</h2>
<p>Our calculators (including the paycheck calculators) run entirely in your browser. The salary,
wage, filing status, and other figures you enter are <strong>not sent to our servers and are not
stored by us</strong>. When you close or reload the page, those inputs are gone.</p>

<h2>Information collected automatically</h2>
<p>Like most websites, our hosting provider and analytics may automatically receive standard log
information (such as your IP address, browser type, referring page, and pages visited). This is
used to operate, secure, and improve the site.</p>

<h2>Cookies and advertising</h2>
<p>We display advertising served by <strong>Google AdSense</strong> to keep our tools free.
Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this
and other websites.</p>
<ul>
  <li>Google's use of advertising cookies enables it and its partners to serve ads to you based on
  your visits to this site and/or other sites on the Internet.</li>
  <li>You may opt out of personalized advertising by visiting
  <a href="https://www.google.com/settings/ads" rel="nofollow">Google Ads Settings</a>.</li>
  <li>You can also opt out of third-party vendors' use of cookies for personalized advertising at
  <a href="https://www.aboutads.info/choices/" rel="nofollow">aboutads.info/choices</a>.</li>
</ul>

<h2>Your choices</h2>
<p>You can set your browser to refuse cookies or to alert you when cookies are being sent. Some
parts of the site may not function as intended if you disable cookies.</p>

<h2>Children's privacy</h2>
<p>Our tools are general-purpose and are not directed at children under 13.</p>

<h2>Contact</h2>
<p>Questions about this policy? Email <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>
`
  },
  {
    slug: 'terms',
    title: 'Terms of Use',
    desc: 'Terms governing use of {{SITE_NAME}} and its tools.',
    robots: 'index, follow',
    body: `
<p><em>Last updated: July 5, 2026.</em></p>

<h2>Estimates only — not professional advice</h2>
<p>The tools on {{SITE_NAME}}, including all paycheck and tax calculators, provide
<strong>estimates for general informational purposes only</strong>. They are not tax, legal,
financial, or payroll advice. Tax law and withholding rules change, and individual circumstances
vary. Always verify results with the IRS, your state's department of revenue, your employer's
payroll department, or a qualified professional before relying on them.</p>

<h2>No warranty</h2>
<p>The site and its tools are provided "as is" without warranties of any kind, express or implied,
including accuracy, completeness, or fitness for a particular purpose. We do not guarantee that any
calculation is error-free or current.</p>

<h2>Limitation of liability</h2>
<p>To the fullest extent permitted by law, {{SITE_NAME}} is not liable for any loss or damage arising
from your use of, or reliance on, the site or its tools.</p>

<h2>Changes</h2>
<p>We may update these terms or the tools at any time without notice.</p>

<h2>Contact</h2>
<p>Email <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>
`
  },
  {
    slug: 'about',
    title: 'About',
    desc: 'About {{SITE_NAME}} — free, fast, browser-based calculators and tools.',
    robots: 'index, follow',
    body: `
<p>{{SITE_NAME}} builds free, fast online tools that run entirely in your browser — no signup, no
download, nothing to install. Type your numbers, get your answer.</p>

<h2>What you'll find here</h2>
<p>The site covers four families of tools. <strong>Money and tax:</strong> paycheck calculators for
all 50 states and D.C., the 2025 no-tax-on-overtime and no-tax-on-tips deduction calculators,
mortgage, loan, inflation and savings tools. <strong>Data studies:</strong> original, sourced
research such as our <a href="/data/overtime-tax-by-state/">51-jurisdiction overtime-tax
study</a> and its <a href="/data/tips-tax-by-state/">tips companion</a>. <strong>Everyday
calculators and converters:</strong> dates, units, cooking, fitness, grades. <strong>Text, developer
and image utilities:</strong> diff checker, QR codes, JSON formatting, image conversion and more.</p>

<p>Everything is client-side: your numbers, text and images are processed on your device and never
uploaded to a server. Several calculators are also available as free
<a href="/embed/">embeddable widgets</a>.</p>

<h2>Where our numbers come from</h2>
<p>Federal figures are drawn from IRS and Social Security Administration releases for the tax year;
state figures come from each state's department of revenue, published tax schedules, and — for new
laws — the enacted bill text itself. Money pages list their sources at the bottom of the page and
carry a visible "Updated" date. Tax rules change, and our calculators are estimates — see our
<a href="/terms/">Terms of Use</a>.</p>

<h2>How the data is verified</h2>
<p>Every published figure is traced to a primary source before it goes live, and high-stakes claims
(such as whether a state taxes overtime or tips in 2026) are re-verified independently before
publication. When a state issues new guidance, the affected pages are updated and the dateline
refreshed. If we can't source a claim, we say the position is unclear rather than guess. Found an
error? Email us — corrections ship within days.</p>

<h2 id="author">Who builds this</h2>
<p>{{SITE_NAME}} is built and maintained by <strong>Edmond Daher</strong>, a software engineer. He is
not a CPA or tax advisor, and nothing on this site is tax, legal or financial advice. Every figure is
checked against the primary source (statute, IRS notice, or form instructions) before it ships, and
errors caught along the way are published in the <a href="/corrections/">corrections log</a>.</p>

<h2>Contact</h2>
<p>Feedback or a correction? Email <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a>.</p>
`
  },
  {
    slug: 'contact',
    title: 'Contact',
    desc: 'Contact {{SITE_NAME}}.',
    robots: 'index, follow',
    body: `
<p>Questions, feedback, or a correction to one of our calculators? We'd like to hear it.</p>
<p>Email: <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a></p>
<p>If you're reporting a tax figure you think is wrong, please include the state, filing status, and
the source you're comparing against — it helps us verify and fix quickly.</p>
`
  },
  {
    slug: 'tax-glossary',
    title: 'Tax Glossary: Plain-English Definitions',
    desc: 'Plain-English definitions of common US tax terms — itemizing, standard deduction, MAGI, FICA, W-2, withholding, filing status, marginal rate, AGI, tax bracket, deduction vs. credit and more. No background assumed.',
    robots: 'index, follow',
    body: `
<p class="lede">Plain-English definitions of the tax terms our calculators use — <strong>no background assumed</strong>. If a word on one of our tax pages is unfamiliar, it's probably explained here. These are general explanations for US federal taxes, not tax advice; for your own situation, check the <a href="https://www.irs.gov/" rel="nofollow">IRS</a> or a tax professional.</p>

<h2 id="itemizing">Itemizing</h2>
<p>Itemizing means listing out specific deductible expenses — state and local taxes, mortgage interest, charitable gifts, some medical costs — on Schedule A of your federal return and deducting the total. You do it <em>instead of</em> taking the standard deduction, and only when your itemized total is larger. Most filers (roughly nine in ten) take the standard deduction and don't itemize.</p>

<h2 id="standard-deduction">Standard deduction</h2>
<p>The standard deduction is a flat amount the IRS lets you subtract from your income without listing any expenses. For 2025 it is $15,750 for single filers and $31,500 for married couples filing jointly. You take either the standard deduction or your <a href="#itemizing">itemized</a> deductions — whichever is larger, never both.</p>

<h2 id="magi">MAGI (modified adjusted gross income)</h2>
<p>MAGI is your <a href="#agi">adjusted gross income</a> with a few items added back — mainly foreign earned income and housing exclusions. For almost everyone, MAGI equals their AGI. Tax laws use MAGI to decide who qualifies for a deduction or credit and where it starts to phase out.</p>

<h2 id="fica">FICA (Social Security and Medicare tax)</h2>
<p>FICA is the payroll tax for Social Security (6.2%) and Medicare (1.45%) that your employer withholds from every paycheck, with the employer paying a matching share. It is separate from federal income tax. The 2025 "no tax on tips" and "no tax on overtime" deductions lower income tax only — FICA is still owed on that pay.</p>

<h2 id="w-2">W-2</h2>
<p>A W-2 is the year-end form your employer sends showing how much you were paid and how much tax was withheld. You use it to file your federal and state returns. From tax year 2026, qualified tips and overtime appear in their own boxes on the W-2 — Box 12 codes TP and TT, plus a new Box 14b occupation code. The <a href="/w2-box-decoder/">W-2 box decoder</a> explains each one.</p>

<h2 id="withholding">Withholding</h2>
<p>Withholding is the income tax your employer takes out of each paycheck and sends to the IRS for you, based on the W-4 form you filled out. It's a prepayment: when you file, you settle up — a refund if too much was withheld, a bill if too little. The new tips, overtime, senior and car-loan deductions do not change your withholding; you claim them when you file.</p>

<h2 id="filing-status">Filing status</h2>
<p>Your filing status is the category you file under — single, married filing jointly, married filing separately, head of household, or qualifying surviving spouse. It sets your standard deduction, your <a href="#tax-bracket">tax brackets</a>, and the income thresholds used throughout these calculators. Married couples usually must file jointly to claim the 2025 deductions.</p>

<h2 id="above-the-line-deduction">Above-the-line deduction</h2>
<p>An above-the-line deduction is subtracted before your <a href="#agi">AGI</a> is figured, so you can take it whether or not you itemize ("the line" is the AGI line on Form 1040). Educator expenses, health-savings-account (HSA) contributions, and deductible retirement-plan contributions work this way, which is why non-itemizers still benefit from them. (The OBBBA tips and overtime deductions are different: non-itemizers can take them too, but they are subtracted after AGI, so they do not reduce your AGI.)</p>

<h2 id="marginal-tax-rate">Marginal tax rate</h2>
<p>Your marginal tax rate is the rate applied to your last (highest) dollar of income — the <a href="#tax-bracket">bracket</a> you are "in." It is what a deduction actually saves you: a $1,000 deduction for someone in the 22% bracket cuts their tax by about $220, not $1,000. It is usually higher than your average (effective) rate.</p>

<h2 id="agi">Adjusted gross income (AGI)</h2>
<p>AGI is your total income minus above-the-line adjustments (such as retirement-plan contributions, health-savings-account contributions, and educator expenses). It's a key figure on Form 1040 (line 11), and many tax breaks phase out based on it. Your <a href="#magi">MAGI</a> is your AGI with a few items added back.</p>

<h2 id="tax-bracket">Tax bracket</h2>
<p>A tax bracket is an income range taxed at a set rate. The US uses a progressive system with brackets from 10% to 37%: only the income inside each range is taxed at that range's rate, so moving into a higher bracket never lowers your take-home on the income below it.</p>

<h2 id="deduction-vs-credit">Deduction vs. credit</h2>
<p>A deduction lowers the income you are taxed on; a credit lowers your tax bill directly, dollar for dollar. A $1,000 deduction saves you your <a href="#marginal-tax-rate">marginal rate</a> (say $220); a $1,000 credit saves the full $1,000. The 2025 breaks for tips, overtime, seniors, SALT and car-loan interest are all deductions, not credits.</p>

<h2 id="dependent">Dependent</h2>
<p>A dependent is a qualifying child or relative you support and claim on your return, which can unlock certain credits and the head-of-household filing status. Being 65 or older and claiming these 2025 deductions does not depend on having dependents.</p>

<h2 id="tax-year">Tax year</h2>
<p>A tax year is the 12-month period your return covers — for individuals, the calendar year. You file the return the following spring (the 2025 tax year is filed by April 2026). The tips, overtime, senior and car-loan deductions apply to tax years 2025 through 2028.</p>

<h2 id="irs">IRS (Internal Revenue Service)</h2>
<p>The IRS is the US federal agency that collects taxes and administers the tax code. It publishes the forms, instructions and official guidance these calculators are based on. State income taxes are handled separately by each state's own tax agency.</p>

<p class="note">This glossary covers US federal income tax terms in general and is not tax, legal or financial advice. Rules change; verify specifics with the <a href="https://www.irs.gov/" rel="nofollow">IRS</a> or a licensed professional.</p>
`
  },
  {
    slug: 'corrections',
    title: 'Corrections Log',
    desc: 'Every figure on {{SITE_NAME}} is checked against a primary source before it ships. This log records the errors we caught before publishing.',
    robots: 'index, follow',
    body: `
<p><em>Last updated: July 13, 2026.</em></p>

<p>Every figure on {{SITE_NAME}} is checked against the primary source (statute, IRS notice, or form instructions) before it ships. This page logs what we caught: cases where a draft figure, assumption, or framing didn't match what the primary source actually says, found and fixed during development.</p>

<p>Nothing below is a live bug. The corrected figure is what's on the page today; the table shows the draft version it replaced and the source that corrected it.</p>

<div class="table-scroll">
<table>
<thead>
<tr><th>Date</th><th>Tool</th><th>What the draft said</th><th>What the primary source says</th><th>Source</th></tr>
</thead>
<tbody>
<tr>
  <td>2026-07-13</td>
  <td><a href="/adoption-credit-calculator/">Adoption Credit Calculator</a></td>
  <td>The $5,120 refundable cap read as a per-return limit.</td>
  <td>The cap is per child. Form 8839 line 11b is a per-column figure &mdash; two adopted children can yield $10,240 refundable on one return, not $5,120.</td>
  <td><a href="https://www.irs.gov/pub/irs-pdf/i8839.pdf" rel="nofollow">2025 Instructions for Form 8839</a></td>
</tr>
<tr>
  <td>2026-07-13</td>
  <td><a href="/adoption-credit-calculator/">Adoption Credit Calculator</a></td>
  <td>Copy draft described the credit as "refundable for the first time ever."</td>
  <td>It was fully refundable once before, for 2010&ndash;2011 under the ACA, then reverted to nonrefundable through 2024. OBBBA is the first time it's <em>permanently</em> refundable &mdash; not the first time ever.</td>
  <td><a href="https://www.congress.gov/crs-product/R44745" rel="nofollow">CRS Report R44745</a></td>
</tr>
<tr>
  <td>2026-07-13</td>
  <td><a href="/employer-student-loan-repayment-calculator/">Employer Student Loan Repayment Calculator</a></td>
  <td>Mythbust headline credited the employee's full $1,557 total saving to income tax alone: "$1,155 saved."</td>
  <td>$1,155.00 is only the income-tax leg. Add the $401.63 employee FICA saving (7.65% of the $5,250 cap) and the true total is $1,556.63.</td>
  <td><a href="https://www.law.cornell.edu/uscode/text/26/3121" rel="nofollow">26 U.S.C. &sect;3121</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/pmi-deduction-calculator/">PMI Deduction Calculator</a></td>
  <td>Phaseout framed as a round "$100k to $110k" AGI band ($110,000 / $55,000 MFS).</td>
  <td>The deduction is eliminated above $109,000 ($54,500 MFS) &mdash; the statute reduces it 10% per $1,000-or-fraction over $100,000, and the 10th step lands at $109,001, not $110,000.</td>
  <td><a href="https://www.law.cornell.edu/uscode/text/26/163" rel="nofollow">IRC &sect;163(h)(3)(E)(ii)</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/qcd-vs-charitable-deduction-calculator/">QCD vs. Charitable Deduction Calculator</a></td>
  <td>First search pass returned $108,000 as the 2026 qualified charitable distribution limit.</td>
  <td>$108,000 is the 2025 figure. The 2026 annual QCD exclusion is $111,000.</td>
  <td><a href="https://www.irs.gov/pub/irs-drop/n-25-67.pdf" rel="nofollow">IRS Notice 2025-67</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/roth-catchup-calculator/">Roth Catch-Up Calculator</a></td>
  <td>Wage threshold cited as $145,000, the commonly-repeated figure.</td>
  <td>$145,000 is only the un-indexed statutory base. The actual 2026 threshold, after cost-of-living indexing, is $150,000.</td>
  <td><a href="https://www.irs.gov/pub/irs-drop/n-25-67.pdf" rel="nofollow">IRS Notice 2025-67</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/1099-threshold-checker/">1099 Threshold Checker</a></td>
  <td>Card processors (Stripe, Square) grouped with the $20,000-and-200-transaction payment-app rule.</td>
  <td>Payment-card transactions have no minimum at all &mdash; any amount, any count. The $20,000-and-200 test applies only to third-party network apps (PayPal, Venmo, marketplaces).</td>
  <td><a href="https://www.irs.gov/pub/irs-drop/n-25-62.pdf" rel="nofollow">IRS Notice 2025-62</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/1099-threshold-checker/">1099 Threshold Checker</a></td>
  <td>1099-NEC/MISC assumed to use the same year and inequality as the 1099-K rule.</td>
  <td>1099-K requires strictly exceeding both $20,000 and 200 transactions. 1099-NEC/MISC use "$2,000 or more," and that floor only starts in tax year 2026 &mdash; 2025 payments still use the old $600 floor.</td>
  <td><a href="https://www.irs.gov/pub/irs-drop/n-25-62.pdf" rel="nofollow">IRS Notice 2025-62</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/ss-wage-base-calculator/">Social Security Wage Base Max-Out Calculator</a></td>
  <td>Any Social Security over-withholding assumed claimable as a credit on the return.</td>
  <td>Only overpayment from two or more employers is a Schedule 3, Part II credit. A single employer's over-withholding isn't a 1040 credit at all &mdash; the employer must adjust it, or the employee files Form 843.</td>
  <td><a href="https://www.irs.gov/taxtopics/tc608" rel="nofollow">IRS Topic 608</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/w4-overtime-tips-withholding-calculator/">W-4 Overtime &amp; Tips Withholding Helper</a></td>
  <td>Draft guidance pointed workers to Form W-4 Step 4(c) to reduce withholding on tips and overtime.</td>
  <td>It's Step 4(b), Deductions, which lowers withholding. Step 4(c) is <em>extra</em> withholding &mdash; it does the opposite of what the tool is for.</td>
  <td><a href="https://www.irs.gov/pub/irs-pdf/fw4.pdf" rel="nofollow">Final 2026 Form W-4</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/w2-box-decoder/">W-2 Box Decoder</a></td>
  <td>Treated the Federal Register publish date (April 13, 2026) as the Treasury Tipped Occupation Code final rule's effective date.</td>
  <td>TD 10044 (91 FR 19026) was published April 13, 2026 but, per its own DATES section, took effect June 12, 2026.</td>
  <td><a href="https://www.ecfr.gov/current/title-26/section-1.224-1" rel="nofollow">26 CFR 1.224-1</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/dependent-care-fsa-vs-credit-calculator/">Dependent Care FSA vs. Credit Calculator</a></td>
  <td>Framed as finding an "optimal split" between the Dependent Care FSA and the Child &amp; Dependent Care Credit.</td>
  <td>The credit's expense cap is reduced dollar-for-dollar by the FSA exclusion, so the benefit is linear in the FSA amount. The answer is almost always a corner &mdash; max the FSA, or skip it &mdash; not a smooth split.</td>
  <td><a href="https://www.law.cornell.edu/uscode/text/26/21" rel="nofollow">IRC &sect;21(c)</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/dependent-care-fsa-vs-credit-calculator/">Dependent Care FSA vs. Credit Calculator</a></td>
  <td>Assumed the same married-filing-separately treatment applies to both the FSA and the credit.</td>
  <td>MFS filers generally cannot claim the Child &amp; Dependent Care Credit at all &mdash; it requires a joint return. MFS can still use the $3,750 DCFSA, just not the credit.</td>
  <td><a href="https://www.law.cornell.edu/uscode/text/26/21" rel="nofollow">IRC &sect;21(e)(2)</a></td>
</tr>
<tr>
  <td>2026-07-12</td>
  <td><a href="/able-account-calculator/">ABLE Account Contribution Calculator</a></td>
  <td>Eligibility framed around the beneficiary's current age being under 46.</td>
  <td>Eligibility turns on when the disability or blindness began, not the beneficiary's age now. Someone currently 58 whose disability began at 30 qualifies; someone currently 40 whose disability began at 47 does not.</td>
  <td><a href="https://www.law.cornell.edu/uscode/text/26/529A" rel="nofollow">26 U.S.C. &sect;529A(e)(1)</a></td>
</tr>
<tr>
  <td>2026-07-11</td>
  <td><a href="/ohio-bonus-tax-calculator/">Ohio Bonus Tax Calculator</a></td>
  <td>Ohio's 2025 supplemental withholding rate, 3.5%, carried forward unchanged into 2026.</td>
  <td>Ohio's supplemental rate dropped to 2.75% effective January 1, 2026, to align with the state's new flat income-tax rate.</td>
  <td><a href="https://codes.ohio.gov/ohio-administrative-code/rule-5703-7-10" rel="nofollow">Ohio Admin. Rule 5703-7-10</a></td>
</tr>
<tr>
  <td>2026-07-11</td>
  <td><a href="/north-carolina-bonus-tax-calculator/">North Carolina Bonus Tax Calculator</a></td>
  <td>Assumed North Carolina's supplemental rate equals its 3.99% flat income-tax rate, as it does in most flat-tax states.</td>
  <td>North Carolina's supplemental withholding rate is 4.09%, deliberately distinct from its 3.99% income-tax rate.</td>
  <td><a href="https://www.ncdor.gov/income-tax-withholding-tables-and-instructions-employers/open" rel="nofollow">North Carolina NC-30 (2026)</a></td>
</tr>
</tbody>
</table>
</div>

<p class="note">Found a figure that looks wrong? Email <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a> with the tool, the number, and what you're comparing it against &mdash; corrections ship within days.</p>
`
  }
];
