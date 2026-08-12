// embed-gallery.js — copy-to-clipboard for the embed snippets. Nothing uploaded.
function flash(btn, msg) {
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = label; }, 1500);
}

async function copy(btn) {
  const ta = document.getElementById(btn.dataset.copy);
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    flash(btn, 'Copied!');
  } catch {
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); flash(btn, 'Copied!'); }
    catch { flash(btn, 'Press Ctrl+C'); }
  }
}

document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b)));

// Paycheck card only: the optional state preselect rewrites that one snippet in
// place — ?state=<slug> on the iframe, and a deep link to that state's own page in
// the credit line. Derived from the snippet the build wrote rather than from
// constants here, so the iframe height and the site URL stay whatever the template
// says. Guarded on both elements, so every other page and card is untouched.
const paySel = document.getElementById('embed-pay-state');
const paySnip = document.getElementById('snip-pay');
if (paySel && paySnip) {
  const DEFAULT_SNIP = paySnip.value;
  const forState = (slug, name) => DEFAULT_SNIP
    .replace('/embed/paycheck-calculator/', `/embed/paycheck-calculator/?state=${slug}`)
    .replace('/data/take-home-pay-by-state/">Take-Home Paycheck Calculator<',
      `/${slug}-paycheck-calculator/">${name} Paycheck Calculator<`);
  const sync = () => {
    const name = (paySel.selectedOptions[0]?.textContent || '').trim();
    paySnip.value = paySel.value ? forState(paySel.value, name) : DEFAULT_SNIP;
  };
  paySel.addEventListener('change', sync);

  // Arriving from a state page's "Embed this calculator" link (/embed/?state=ohio):
  // preselect that state and run the SAME rewrite the change handler runs, so what
  // the visitor lands on is exactly what the dropdown would have produced. Matched
  // against the actual <option> values via a Set — like the widget's hasOwnProperty
  // guard, this cannot be fooled by an inherited key such as ?state=constructor,
  // which a plain-object lookup would wave through and leave the select on ''.
  const pre = new URLSearchParams(location.search).get('state');
  const known = new Set([...paySel.options].map((o) => o.value));
  if (pre && known.has(pre)) {
    paySel.value = pre;
    sync();
  }
}
