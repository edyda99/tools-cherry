// question-flow.js — the generic "answer a plain question, then see the field
// that question needs" controller. Any page opts in with markup alone: ship a
// yes/no radio group named qFoo, and wrap the input it controls in
// <div class="adv-reveal" data-reveal="qFoo">. Nothing in this file knows the
// name of a single question; the names are read off the DOM at run time, so
// adding a question to a page is a template change and never a script change.
//
// HIDE-ON-DEMAND, NEVER SHOW-ON-DEMAND. Every [data-reveal] wrapper ships
// VISIBLE in the built HTML, and this file only ever ADDS `hidden` to the ones
// whose question is answered No. So JavaScript off, JavaScript broken, or a page
// that forgot to ship the radios all leave the field on screen and in the DOM.
// Show-on-demand would invert that: the default state would be "field missing",
// and every failure mode would quietly hand a visitor, a screen reader or a
// crawler an incomplete form. It touches the DOM in two ways only: the `hidden`
// property on a wrapper, and focus(). No innerHTML, no createElement.
//
// NOT a duplicate to be folded into app.js. The 51 /{state}-paycheck-calculator/
// pages keep their own copy (syncAdvancedQuestions in app.js) because there the
// answer is read by the engine itself. Never load both on one page, they would
// double-bind the listeners and fight over focus.
//
// ANSWERING NO MUST ALSO ZERO THE FIELD, not merely hide it. Hiding alone is a
// silent-wrong-answer bug, and a real one: charitable-deduction ships #other
// pre-filled at 20000, so a visitor who answers "no, I have nothing else to
// write off" would watch the box disappear while 20000 kept feeding the
// comparison and flipped the headline verdict to "itemising wins". Every page
// here reads its inputs by id, unconditionally, exactly as that one does, so the
// fix belongs in one place: when a wrapper is hidden its fields are parked at a
// neutral value, and when it is shown again whatever the visitor typed comes
// back. app.js solves the same problem the other way, by zeroing at the point of
// read; both are correct, and a page must use one or the other, never neither.

try {
  // What "this does not apply to me" looks like for a given control. A template
  // can override per field with data-qf-off when zero is not the neutral answer.
  const neutralOf = (el) => {
    if (el.hasAttribute('data-qf-off')) return el.getAttribute('data-qf-off');
    if (el.type === 'checkbox' || el.type === 'radio') return false;
    if (el.tagName === 'SELECT') {
      const def = Array.prototype.filter.call(el.options, (o) => o.defaultSelected)[0];
      return def ? def.value : (el.options[0] ? el.options[0].value : '');
    }
    // Money and count fields read as 0; free text reads as empty. Anything the
    // page marked data-money or gave a numeric keyboard is a number field.
    const numeric = el.type === 'number' ||
      el.hasAttribute('data-money') ||
      el.getAttribute('inputmode') === 'decimal' ||
      el.getAttribute('inputmode') === 'numeric';
    return numeric ? '0' : '';
  };

  const readOf = (el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);

  const writeOf = (el, v) => {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!v;
    else el.value = v;
    // The calculators recompute on input/change. A programmatic value assignment
    // fires neither, so without this the number on screen would disagree with
    // the number in the box until the visitor touched something else.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Fields belonging to THIS wrapper, not to a wrapper nested inside it, which
  // manages its own and would otherwise be stashed twice.
  const fieldsOf = (host) => Array.prototype.filter.call(
    host.querySelectorAll('input, select, textarea'),
    (el) => el.closest('[data-reveal]') === host && el.type !== 'hidden'
  );

  const stash = new WeakMap();

  const park = (host) => {
    for (const el of fieldsOf(host)) {
      if (stash.has(el)) continue;            // already parked, leave it be
      stash.set(el, readOf(el));
      const off = neutralOf(el);
      if (readOf(el) !== off) writeOf(el, off);
    }
  };

  const restore = (host) => {
    for (const el of fieldsOf(host)) {
      if (!stash.has(el)) continue;
      const was = stash.get(el);
      stash.delete(el);
      if (readOf(el) !== was) writeOf(el, was);
    }
  };

  const hosts = Array.prototype.slice
    .call(document.querySelectorAll('[data-reveal]'))
    .map((host) => ({ host, name: host.getAttribute('data-reveal') || '' }))
    .filter((e) => e.name);

  const radiosFor = (name) => document.querySelectorAll('input[name="' + name + '"]');

  // True when the question is answered Yes. A page that carries the wrapper but
  // no radio group by that name falls back to true, so the field stays usable on
  // its own rather than vanishing behind a question nobody can answer.
  const answeredYes = (name) => {
    const group = radiosFor(name);
    if (!group.length) return true;
    return Array.prototype.some.call(group, (el) => el.checked && el.value === 'yes');
  };

  if (hosts.length) {
    const sync = () => {
      for (const e of hosts) {
        const show = answeredYes(e.name);
        // Never strand the keyboard inside a wrapper that is about to
        // disappear: hand focus back to the radio the visitor just answered
        // with, which is the nearest thing still on screen.
        if (!show && e.host.contains(document.activeElement)) {
          const picked = document.querySelector('input[name="' + e.name + '"]:checked');
          if (picked) picked.focus();
        }
        // Park before hiding and restore before showing, so the engine never
        // reads a value from a field the visitor has said does not apply.
        if (show) restore(e.host); else park(e.host);
        e.host.hidden = !show;
      }
    };

    // One listener per radio, but only one pass per unique question name, so a
    // page that reveals two wrappers from the same answer binds each radio once.
    const bound = new Set();
    for (const e of hosts) {
      if (bound.has(e.name)) continue;
      bound.add(e.name);
      radiosFor(e.name).forEach((radio) => radio.addEventListener('change', sync));
    }
    sync();
  }
} catch (err) {
  // Any failure puts every field back on screen: a broken script must never be
  // the reason a person or a crawler cannot see part of the form. Values are
  // deliberately NOT un-parked here. A half-run script may have parked some
  // fields and not others, and re-showing a field still holding its neutral 0 is
  // recoverable by typing; silently restoring a number under a question whose
  // answer we can no longer trust is not.
  try {
    document.querySelectorAll('[data-reveal]').forEach((el) => { el.hidden = false; });
  } catch (_) { /* nothing further we can safely do */ }
}
