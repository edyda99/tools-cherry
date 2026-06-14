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
<p><em>Last updated: 2026.</em></p>

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
<p>We display advertising to keep our tools free. Third-party vendors, including Google, use cookies
to serve ads based on your prior visits to this and other websites.</p>
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
<p><em>Last updated: 2026.</em></p>

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

<h2>Our paycheck calculators</h2>
<p>Our state paycheck calculators estimate your take-home pay after federal income tax withholding,
Social Security and Medicare (FICA), and state income tax. Each state page uses the current-year
federal tax brackets and standard deduction, the FICA wage base and rates, and that state's own
income tax rules.</p>

<h2>Where our numbers come from</h2>
<p>Federal figures are drawn from IRS releases for the tax year; state figures come from each state's
department of revenue and published tax schedules. Tax rules change, and our calculators are
estimates — see our <a href="/terms/">Terms of Use</a>.</p>

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
  }
];
