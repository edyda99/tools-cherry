// state-flow.js — the four-question "which rules apply to me" block on each
// /{state}-paycheck-calculator/ page.
//
// SINCE THE CARD REWRITE (2026-08-01) the four questions are asked TWICE on the
// same page, on purpose, and this file is what keeps the two copies from
// disagreeing:
//   - as four Yes/No cards in the paycheck flow (radio groups qTips / qOt /
//     qBonus / qAge), which is where a visitor stepping through the calculator
//     meets them;
//   - as the four checkbox chips inside the applies panel on the answer card
//     (h-tips / h-ot / h-bonus / h-age), which is where the pointer lines they
//     filter actually are, and which stay usable with the flow collapsed.
// Answering either one moves the other. The chips are server-rendered by
// src/content/state-applies.js and are untouched by this change.
//
// SINCE 2026-08-01 A YES ALSO COMPUTES. The four cards now ask for the figures
// their rule needs (tips for the year, overtime hours and rate, the bonus) and
// app.js works out what each is worth, in a block that sits directly above these
// pointer lines on the same card. That does not change what this file does — it
// still only ever hides a line — but it does change what a tick MEANS: ticking a
// chip here is now answering a question that has an answer to recompute, so
// writeCard() below dispatches a real change event where it used to set the
// radio silently. The pointer lines stay exactly where they were, one deep link
// each, because the computed block is an ADDITION to them and never a
// replacement: the computed figures exist only for a visitor running JavaScript,
// and the lines are what a crawler and a no-JS reader get.
//
// HIDE-ON-DEMAND, NEVER SHOW-ON-DEMAND. All four pointer lines ship visible in
// the HTML. This script only ADDS data-hidden to the lines you did not tick, and
// only once something IS ticked. So JavaScript off, JavaScript broken, or every
// question left on No all leave every line readable, which is the only
// arrangement where per-state content can never be hidden from a crawler or a
// screen reader by default. Answering No to all four is therefore not the same
// instruction as ticking nothing: it hides nothing, because a page that hid all
// four of its own per-state pointers would be telling the visitor less than the
// page they arrived on. The CSS rule that acts on data-hidden is scoped to
// html.js, so it cannot bite before this file has run either.
//
// FOUR NOs AND THE QUESTIONS STOP BEING ASKED. The paragraph above is about the
// four pointer LINES, and it still holds: this file never hides one of those
// until something is ticked. It does now hide the four CHECKBOXES, and only
// them, once two things are both true: the visitor has stepped through the flow
// as far as the answer card (app.js says so with tb:paycheck-answered), and all
// four questions came back No. At that moment the panel was re-asking, as
// checkboxes, four questions the visitor had answered one card earlier — 42% of
// the answer card, measured, spent asking again — and the honest reading of that
// is that the page did not listen. The four per-state sentences and all five
// links stay exactly where they were: they are what a crawler and a no-JS reader
// get, and they are the per-state content, whereas the checkboxes are a second
// copy of a control the flow already owns. Ticking anything, or Start over,
// brings them straight back, and the answer chips under the result are a way
// back to each of the four cards in any case.
//
// It touches the DOM in five ways only: setAttribute/removeAttribute on
// data-hidden, one setAttribute('href') on the deep link, `checked` on the eight
// controls named above, focus(), and `style.display` on the two nodes named in
// the paragraph above. No innerHTML, no textContent, no createElement, no
// insertAdjacentHTML. Nothing is REMOVED from the document, so every byte the
// build served is still in it.

const IDS = [
  ['h-tips', 'tips', 'qTips'],
  ['h-ot', 'ot', 'qOt'],
  ['h-bonus', 'bonus', 'qBonus'],
  ['h-age', 'age', 'qAge']
];

try {
  const root = document.getElementById('appliesLines');
  const deep = document.getElementById('appliesDeep');
  const boxes = IDS
    .map(([id, key, group]) => ({
      box: document.getElementById(id),
      key,
      // Empty on any page that ships the panel without the flow, which is the
      // shape every state page had before the card rewrite. The chips then work
      // exactly as they did then.
      radios: [...document.querySelectorAll(`input[name="${group}"]`)]
    }))
    .filter((e) => e.box);

  if (root && boxes.length) {
    // Only claim the js class once every node this file needs is actually present.
    document.documentElement.classList.add('js');

    const lineFor = (key) => root.querySelector('[data-line="' + key + '"]');
    const baseHref = deep ? deep.getAttribute('href') : '';

    // The duplicate ask: the checkbox fieldset and the one sentence above it
    // that tells the visitor to use it. Both are optional — a page that ships
    // the panel without them still works — and both are only ever hidden, never
    // detached. `section > p` is the intro: the emitter
    // (src/content/state-applies.js) puts exactly one <p> directly under
    // #applies, and the "see every rule" link lives inside .applies-panel.
    const section = document.getElementById('applies');
    const chipBox = section ? section.querySelector('.applies-chips') : null;
    const chipIntro = section ? [...section.children].find((el) => el.tagName === 'P') : null;
    // Flipped by app.js when the flow reaches the answer card, and back on Start
    // over. Until then nothing is hidden, so a visitor who has not walked the
    // flow, a crawler, and a reader with JavaScript off all see the same panel.
    let flowAnswered = false;
    const showAsk = (on) => {
      for (const el of [chipBox, chipIntro]) {
        if (el) el.style.display = on ? '' : 'none';
      }
    };

    // Card answer -> chip. A card that is not on the page leaves its chip alone.
    const readCards = () => {
      for (const e of boxes) {
        if (!e.radios.length) continue;
        const on = e.radios.find((r) => r.checked);
        e.box.checked = !!on && on.value === 'yes';
      }
    };

    // Chip -> card answer, and ONE change event on the radio that ended up
    // checked. It used to be set silently, on the reasoning that these four
    // questions changed no figure; they do now — a Yes reveals the figure its
    // rule needs on the card and prints what the rule is worth on the answer —
    // so a silent tick left the chip ticked, the pointer line showing and the
    // computed block still saying nothing.
    //
    // It cannot loop. The event runs app.js's re-render and this file's own
    // radio listener, which calls readCards(): that sets `box.checked` by
    // ASSIGNMENT, which fires nothing, so the second pass converges on the same
    // values and stops. wizard-core's auto-advance ignores it too, because the
    // visitor is standing on the answer card, not on the card that owns the
    // radio.
    const writeCard = (e) => {
      for (const r of e.radios) r.checked = (r.value === 'yes') === e.box.checked;
      const on = e.radios.find((r) => r.checked);
      if (on) {
        try { on.dispatchEvent(new Event('change', { bubbles: true })); }
        catch (_) { /* older browsers: the pointer lines still follow the tick */ }
      }
    };

    const sync = (changed) => {
      const picked = boxes.filter((e) => e.box.checked).map((e) => e.key);
      // Never strand the keyboard: if focus sits on a link inside a line that is
      // about to be hidden, put it back on the control the visitor just used.
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
      // Answered, and answered No four times: the ask has nothing left to ask.
      // Never on a change that came FROM the panel (`changed` is the checkbox
      // the visitor just clicked): unticking the last box would then delete the
      // control under their finger and strand the keyboard inside a node that is
      // no longer displayed. A card answer arrives with changed === null, and
      // the visitor is a screen away from these boxes by then.
      showAsk(!(flowAnswered && !picked.length && !changed));
    };

    for (const e of boxes) {
      e.box.addEventListener('change', () => { writeCard(e); sync(e.box); });
      // Nothing is passed as `changed` from this side: the visitor is standing on
      // a card several screens away from the lines, so moving focus into them
      // would drag them out of the flow.
      for (const r of e.radios) r.addEventListener('change', () => { readCards(); sync(null); });
    }

    // Start over restores every radio by assignment, which fires no change event,
    // so without this the chips would still show the answers the visitor just
    // discarded. app.js dispatches it from the wizard's onReset hook. It also
    // puts the flow back at question one, so the four questions are live again
    // and the ask comes back with them.
    document.addEventListener('tb:paycheck-reset', () => {
      flowAnswered = false;
      readCards();
      sync(null);
    });

    // app.js dispatches this the first time the flow reaches the answer card.
    // Before it, the visitor may simply not have got to those four questions yet,
    // and hiding the only other copy of them would take the answer away from
    // somebody who never gave one.
    document.addEventListener('tb:paycheck-answered', () => {
      flowAnswered = true;
      sync(null);
    });

    // The cards are the source of truth on load: they carry the shipped default
    // (No on all four), and reading them first means a browser that restored a
    // radio from a back/forward navigation is reflected in the chips too.
    readCards();
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
