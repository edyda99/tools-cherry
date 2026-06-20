// discount-calculator.js — sale price / percent-off calculator UI.
// Pure logic via the shared discount module. No deps, nothing uploaded.
import { discountBreakdown, percentOffFromPrices } from '/assets/discount.js';

const $ = (id) => document.getElementById(id);
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// --- Main: percent off an original price ------------------------------------
function update() {
  const price = $('price').value.trim();
  const percentOff = $('percentOff').value.trim();
  const taxPercent = $('taxPercent').value.trim();
  const quantity = $('quantity').value.trim() || '1';

  const big = $('resultBig');
  const sub = $('resultSub');
  const lineSaved = $('lineSaved');
  const lineTax = $('lineTax');
  const lineTotal = $('lineTotal');

  if (!price || !percentOff) {
    big.textContent = '—';
    sub.textContent = '';
    lineSaved.hidden = lineTax.hidden = lineTotal.hidden = true;
    return;
  }

  const r = discountBreakdown({
    price: Number(price),
    percentOff: Number(percentOff),
    taxPercent: taxPercent ? Number(taxPercent) : 0,
    quantity: Number(quantity)
  });

  if (Number.isNaN(r.finalTotal)) {
    big.textContent = '—';
    sub.textContent = 'Check your numbers.';
    lineSaved.hidden = lineTax.hidden = lineTotal.hidden = true;
    return;
  }

  const hasTax = Number(taxPercent) > 0;
  const qty = r.quantity;

  // The headline is the price you pay (after tax), per item if quantity is 1.
  big.textContent = money(r.finalEach);
  sub.textContent = qty > 1 ? `each — ${money(r.finalTotal)} for ${qty}` : 'final price';

  $('lineSavedV').textContent = money(r.saved);
  lineSaved.hidden = false;

  if (hasTax) {
    $('lineTaxV').textContent = money(r.taxAmount);
    lineTax.hidden = false;
  } else {
    lineTax.hidden = true;
  }

  $('lineTotalV').textContent = money(r.finalTotal);
  lineTotal.hidden = false;
}

// --- Reverse: figure out the percent off from two prices --------------------
function updateReverse() {
  const original = $('rOriginal').value.trim();
  const sale = $('rSale').value.trim();
  const out = $('reverseOut');

  if (!original || !sale) {
    out.textContent = '—';
    return;
  }
  const pct = percentOffFromPrices(Number(original), Number(sale));
  if (Number.isNaN(pct)) {
    out.textContent = '—';
    return;
  }
  const rounded = Math.round(pct * 100) / 100;
  out.textContent = rounded + '% off';
}

function init() {
  ['price', 'percentOff', 'taxPercent', 'quantity'].forEach((id) =>
    $(id).addEventListener('input', update)
  );
  $('percentOff').closest('section').querySelectorAll('[data-off]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('percentOff').value = btn.dataset.off;
      update();
    });
  });
  ['rOriginal', 'rSale'].forEach((id) => $(id).addEventListener('input', updateReverse));
  update();
  updateReverse();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
