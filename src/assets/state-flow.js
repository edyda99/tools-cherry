// state-flow.js — the four-question "which rules apply to me" block on each
// /{state}-paycheck-calculator/ page.
//
// HIDE-ON-DEMAND, NEVER SHOW-ON-DEMAND. All four pointer lines ship visible in
// the HTML. This script only ADDS data-hidden to the lines you did not tick, and
// only after you tick something. So JavaScript off, JavaScript broken, or simply
// nothing ticked all leave every line readable, which is the only arrangement
// where per-state content can never be hidden from a crawler or a screen reader
// by default. The CSS rule that acts on data-hidden is scoped to html.js, so it
// cannot bite before this file has run either.
//
// It touches the DOM in three ways only: setAttribute/removeAttribute on
// data-hidden, one setAttribute('href') on the deep link, and focus(). No
// innerHTML, no textContent, no createElement, no insertAdjacentHTML.

const IDS = [
  ['h-tips', 'tips'],
  ['h-ot', 'ot'],
  ['h-bonus', 'bonus'],
  ['h-age', 'age']
];

try {
  const root = document.getElementById('appliesLines');
  const deep = document.getElementById('appliesDeep');
  const boxes = IDS
    .map(([id, key]) => ({ box: document.getElementById(id), key }))
    .filter((e) => e.box);

  if (root && boxes.length) {
    // Only claim the js class once every node this file needs is actually present.
    document.documentElement.classList.add('js');

    const lineFor = (key) => root.querySelector('[data-line="' + key + '"]');
    const baseHref = deep ? deep.getAttribute('href') : '';

    const sync = (changed) => {
      const picked = boxes.filter((e) => e.box.checked).map((e) => e.key);
      // Never strand the keyboard: if focus sits on a link inside a line that is
      // about to be hidden, put it back on the checkbox the visitor just used.
      const active = document.activeElement;
      if (changed && active && active !== changed && root.contains(active)) changed.focus();
      for (const e of boxes) {
        const line = lineFor(e.key);
        if (!line) continue;
        // Nothing ticked means nothing hidden: the untouched page shows all four.
        if (!picked.length || e.box.checked) line.removeAttribute('data-hidden');
        else line.setAttribute('data-hidden', '');
      }
      if (deep) {
        deep.setAttribute('href', picked.length ? baseHref + '&has=' + picked.join(',') : baseHref);
      }
    };

    for (const e of boxes) e.box.addEventListener('change', () => sync(e.box));
    sync(null);
  }
} catch (err) {
  // Any failure leaves every line visible: strip the js class so the CSS that
  // hides data-hidden lines stops applying, and undo anything already set.
  try {
    document.documentElement.classList.remove('js');
    document.querySelectorAll('.applies-line[data-hidden]')
      .forEach((el) => el.removeAttribute('data-hidden'));
  } catch (_) { /* nothing further we can safely do */ }
}
