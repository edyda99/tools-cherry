// wizard-core.js — the generic card-by-card flow controller.
//
// WHAT THIS IS. /overtime-tax-calculator/ was rewritten on 2026-08-01 from one
// long form into a stack of cards that asks ONE question at a time and ends with
// the answer written out as a story. That shape was approved, and it is being
// rolled out across the tax-calculator family. This file is the PATTERN of
// overtime-wizard.js extracted so the other tools do not each re-derive it, and
// each re-derive it slightly differently.
//
// It deliberately does NOT drive /overtime-tax-calculator/. That page keeps its
// bespoke overtime-wizard.js for now: it is the reference implementation, the
// thing every conversion is checked against, and rewriting it onto this core in
// the same pass would leave nothing stable to compare against. Consolidating the
// two is a FOLLOW-UP, tracked as such, and the moment it happens the overtime
// page's own tests are the gate.
//
// WHAT A TOOL SUPPLIES. Everything below is "how a card flow behaves". A tool
// module supplies only what makes it that tool:
//   cards        the ordered card list, with a path predicate per card
//   read()       read the DOM into a plain state object
//   compute()    call the tool's existing engine module, unchanged
//   renderResult() return the answer card's HTML as a string
// plus the optional hooks named in the spec table below.
//
// PROGRESSIVE ENHANCEMENT IS THE CONTRACT, NOT A NICETY. Every card ships
// VISIBLE in the built HTML. This file sets data-js="on" on the stage element
// ONLY after its first successful render, and only then does styles.css collapse
// the stack to one card at a time. A tool whose engine throws on load therefore
// leaves a plain, complete, usable stacked form on screen underneath the error
// banner, rather than an invisible one. Hide-on-demand, never show-on-demand.
//
// EVERY DOM READ IS NULL-GUARDED. This core runs on ~14 different pages whose
// markup is written by different hands; a missing optional element must degrade,
// never throw, because a throw here takes the whole calculator down with it.
//
// IT ALSO EXPORTS THE SMALL THINGS, on purpose. $ / moneyOf / numOf / radioOf /
// selectOf and usd / usdRate / count / pct are here rather than in each tool
// because fourteen private copies of "how we quote a number back" is fourteen
// chances to round an hourly rate to the dollar or to read a comma-formatted
// money field with parseFloat. Import them; do not re-derive them.

import { initMoneyInputs, moneyValue } from '/assets/money-input.js';
import { showCalculatorLoadError } from '/assets/calc-error-banner.js';

const byId = (id) => (id ? document.getElementById(id) : null);
const isFn = (f) => typeof f === 'function';

// ---- Reading the DOM ---------------------------------------------------------
// Exported because every tool's read() needs exactly these four, and a tool that
// re-derives them writes `parseFloat(el.value)` on a comma-formatted money field
// sooner or later. All four answer with a usable value for a missing element:
// the core runs on pages whose markup is written by different hands and a null
// here must degrade, never throw.
export const $ = byId;
export const moneyOf = (id) => { const el = byId(id); return el ? moneyValue(el) : 0; };
export function numOf(id) {
  const el = byId(id);
  const v = el ? parseFloat(el.value) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 0;
}
export function radioOf(name, fallback = '') {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : fallback;
}
export const selectOf = (id) => { const el = byId(id); return el ? el.value : ''; };

// ---- Writing numbers back ----------------------------------------------------
// Shared so fourteen tools quote a figure back the same way, and so nobody
// re-picks the rounding. usd() rounds to the dollar because the answer is an
// estimate and cents are noise in it; usdRate() KEEPS cents because a typed
// hourly rate of 22.50 must not be read back as "$23"; count() keeps fractions
// because the math runs on 500.5 hours and quoting "501" names a number nobody
// typed.
export const usd = (n) => '$' + Math.round(Math.max(0, n || 0)).toLocaleString('en-US');
export const usdRate = (n) => {
  const v = Math.max(0, n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
export const count = (n) => Math.max(0, n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const pct = (n) => (Math.max(0, n || 0) * 100).toFixed(1) + '%';

// Debounces, both copied from the overtime wizard rather than re-picked:
// FLAG_SETTLE_MS is how long a number has to stop changing before an inline flag
// under it may appear or disappear, and STATUS_MS is how long the answer has to
// stop changing before one polite sentence goes to a screen reader.
const FLAG_SETTLE_MS = 350;
const STATUS_MS = 500;

const DEFAULTS = {
  out: 'out',
  status: 'outStatus',
  dots: 'otwDots',
  stepLabel: 'otwStepnum',
  answers: 'otwAnswers',
  restart: 'otwRestart',
  example: '.calc-example'
};

/**
 * createWizard(spec) -> controller
 *
 * spec.stage        (required) id of the <section class="otw"> that holds the cards.
 * spec.cards        (required) ordered array of card descriptors, see below.
 * spec.read()       (required) -> state object. Called on every render; must
 *                   tolerate any field being missing from the DOM.
 * spec.compute(s)   (required) -> result object, by calling the tool's engine.
 * spec.renderResult({ state, result, out }) (required) -> HTML string for the
 *                   answer card's result box. The core writes it and preserves
 *                   the open/closed state of any <details> inside it.
 *
 * spec.chips(state, result)          -> [{ step, label, field? }] answer chips.
 * spec.exampleMissing(state, touched) -> [phrase] figures still coming from us.
 *                   Empty array retires the example note for good.
 * spec.exampleText(list)             -> override the note's sentence.
 * spec.announce(state, result)       -> the one polite sentence, or ''.
 * spec.stateNote                     -> optional { box, select, render(slug) }
 *                   for the "what about my state?" helper, see renderStateNote.
 * spec.onReset(ctx)                  -> extra work on Start over.
 * spec.onRender(ctx)                 -> extra work after every render.
 * spec.onBeforeSnapshot(ctx)         -> runs after initMoneyInputs() and BEFORE
 *                   the defaults are snapshotted. Where a tool fills a <select>
 *                   from data (the state pickers) so that Start over restores
 *                   the option that shipped, not the one chosen since.
 * spec.onReady(ctx)                  -> runs once, after data-js="on".
 * spec.ids                           -> override any of the DEFAULTS ids above.
 *
 * A CARD DESCRIPTOR:
 *   step        (required) the number in the card's data-step attribute.
 *   fields      ids of the inputs this card owns. Drives recompute, the example
 *               note's touched-set, flag flushing on blur, and Start over.
 *   when(state) path predicate. False means this visitor never sees the card:
 *               it is skipped when stepping, and it is left out of the dots and
 *               the "Step 2 of 5" label immediately, not on the next Next.
 *               Omitted means always on the path. The result card is always on
 *               the path whatever it says.
 *   result      true on the answer card. Exactly one card must set it.
 *   flags       [{ id, text(state) }] inline warnings that live on this card.
 *   radios      name of a radio group on this card that a POINTER choice should
 *               advance from. Keyboard never auto-advances, see the wiring.
 *   skipClears  ids the Skip button on this card should blank before jumping to
 *               the answer.
 *   focus(card) override for which control the card focuses on arrival.
 */
export function createWizard(spec) {
  if (!spec || !spec.stage) throw new Error('wizard-core: spec.stage is required');
  const ids = Object.assign({}, DEFAULTS, spec.ids || {});
  const cards = (spec.cards || []).slice().sort((a, b) => a.step - b.step);
  if (!cards.length) throw new Error('wizard-core: spec.cards is empty');

  const resultCard = cards.find((c) => c.result) || cards[cards.length - 1];
  const RESULT = resultCard.step;
  const FIRST = cards[0].step;

  let stage = null;
  let cardEls = [];
  let step = FIRST;
  let booted = false;

  // ---- state ---------------------------------------------------------------
  const read = () => (isFn(spec.read) ? spec.read() : {});

  // ---- the path ------------------------------------------------------------
  // Recomputed from the live state every time it is needed rather than cached,
  // because a single keystroke can change it: a premium typed into an escape
  // hatch on card one can drop two later cards, and the dots have to follow on
  // that keystroke, not on the next Next.
  function pathOf(state) {
    const p = [];
    for (const c of cards) {
      if (c === resultCard) { p.push(c.step); continue; }
      // A predicate that throws leaves its card ON the path. The failure mode of
      // the other choice is stranding a visitor on a question they can no longer
      // reach; the failure mode of this one is one extra question.
      let on = true;
      if (isFn(c.when)) { try { on = !!c.when(state); } catch (_) { on = true; } }
      if (on) p.push(c.step);
    }
    if (!p.includes(RESULT)) p.push(RESULT);
    return p;
  }
  function nextOf(s, path) {
    const at = path.indexOf(s);
    if (at === -1) return RESULT;
    return path[Math.min(at + 1, path.length - 1)];
  }
  function prevOf(s, path) {
    const at = path.indexOf(s);
    if (at === -1) return path[0];
    return path[Math.max(at - 1, 0)];
  }
  // A step that has just left the path (the visitor typed something that skips
  // it while standing on it) hands off FORWARD to the next step that is still
  // on the path, never backwards, so an edit can never bounce someone to a
  // question they already answered.
  function normalise(target, path) {
    if (path.includes(target)) return target;
    for (const s of path) if (s > target) return s;
    return RESULT;
  }

  // ---- the one polite live region -----------------------------------------
  // The result box rewrites its whole innerHTML on every keystroke, so it is NOT
  // a live region. One debounced sentence goes to the status paragraph instead,
  // never for the load render, and never from a card other than the answer: a
  // screen-reader user typing on card one was otherwise read a result panel five
  // cards away that they could neither see nor reach.
  let statusTimer = null;
  let announceReady = false;
  function announce(text) {
    if (!announceReady || !text) return;
    const el = byId(ids.status);
    if (!el) return;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = text; }, STATUS_MS);
  }

  // ---- the example note ----------------------------------------------------
  // The page loads with numbers nobody typed, so the answer is labelled an
  // example until the visitor has supplied EVERY figure it is built from. It is
  // NOT cleared on the first edit to any one field: that presented an answer
  // still made of our invented numbers as the visitor's own. The surviving label
  // names exactly which figures are still ours, because our defaults are
  // ordinary enough to be somebody's real pay.
  //
  // isTrusted only. A value this file writes (a quick chip, a prefill that
  // follows another field) is OUR number until a person types over it, so a
  // synthetic event must never retire the label. Chips are the one exception and
  // they mark their own field touched explicitly, because a tap on a chip IS the
  // visitor supplying that figure.
  const touched = new Set();
  let exampleNote = null;
  let exampleHome = null;
  let exampleNext = null;

  function captureExampleNote() {
    exampleNote = document.querySelector(ids.example);
    if (!exampleNote) return;
    exampleHome = exampleNote.parentNode;
    exampleNext = exampleNote.nextSibling;
  }
  function restoreExampleNote() {
    if (exampleNote && !exampleNote.isConnected && exampleHome) {
      exampleHome.insertBefore(exampleNote, exampleNext);
    }
  }
  function defaultExampleText(list) {
    const words = list.length === 1
      ? list[0]
      : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    return `Still using our example figures for ${words}. Type your own to see your answer.`;
  }
  // The note is TAKEN OFF and PUT BACK, never retired for good. A branching flow
  // can empty the missing list on one path and re-introduce one of our invented
  // figures on the next — a visitor who switches branches was otherwise shown a
  // number we made up with no label on it, because the only thing that ever
  // restored the note was Start over. So the list is re-read on every render and
  // the note follows it in both directions.
  function syncExampleNote(state) {
    const missing = isFn(spec.exampleMissing) ? (spec.exampleMissing(state, touched) || []) : [];
    if (!missing.length) {
      const on = document.querySelector(ids.example);
      if (on) on.remove();
      return;
    }
    restoreExampleNote();
    const el = document.querySelector(ids.example);
    if (!el) return;
    el.textContent = isFn(spec.exampleText) ? spec.exampleText(missing) : defaultExampleText(missing);
  }
  function noteFieldTouched(id) {
    touched.add(id);
    syncExampleNote(read());
  }

  // ---- inline flags --------------------------------------------------------
  // A flag sits between an input and the nav row, so showing or hiding one moves
  // the Next button. Rendering per keystroke moved it mid-word: money-input.js
  // selects the whole field on entry, so retyping 80,000 passes through 8, 80,
  // 800 and 8,000, and every one of those flips a threshold flag on and off.
  // They are therefore DEBOUNCED to the settled value rather than suppressed
  // while the field has focus, which was the earlier fix and was worse: a
  // visitor who edited a number last never saw its flag at all, because the blur
  // that lifted the suppression arrived after the card had already been hidden.
  const allFlags = cards.flatMap((c) => c.flags || []);
  let flagTimer = null;
  function paintFlags(state) {
    for (const f of allFlags) {
      const el = byId(f.id);
      if (!el) continue;
      let text = '';
      try { text = isFn(f.text) ? (f.text(state) || '') : ''; } catch (_) { text = ''; }
      el.hidden = !text;
      el.textContent = text;
    }
  }
  function scheduleFlags() {
    if (!allFlags.length) return;
    clearTimeout(flagTimer);
    flagTimer = setTimeout(() => paintFlags(read()), FLAG_SETTLE_MS);
  }
  function flushFlags() {
    if (!allFlags.length) return;
    clearTimeout(flagTimer);
    paintFlags(read());
  }

  // ---- the optional state helper ------------------------------------------
  // Several tools in this family end with "and what about my state?". The helper
  // OPENS ITSELF the first time each state is rendered, because the visitor just
  // asked that question out loud by choosing a state on the card before it; left
  // closed, it hid the yes/no behind a click. It re-opens only when the chosen
  // value CHANGES, so a visitor who closes it is not reopened under by the next
  // keystroke.
  let stateNoteShown = null;
  function renderStateNote() {
    const cfg = spec.stateNote;
    if (!cfg) return;
    const box = byId(cfg.box);
    const sel = byId(cfg.select);
    if (!box || !sel) return;
    let parts = null;
    try { parts = cfg.render(sel.value); } catch (_) { parts = null; }
    if (!sel.value || !parts) { box.hidden = true; box.open = false; stateNoteShown = null; return; }
    box.hidden = false;
    if (stateNoteShown !== sel.value) { box.open = true; stateNoteShown = sel.value; }
    const sum = box.querySelector('summary');
    const body = box.querySelector('[data-otw-body]') || box.querySelector('div');
    if (sum) sum.textContent = parts.summary || '';
    if (body) body.innerHTML = parts.body || '';
  }

  // ---- the answer ----------------------------------------------------------
  // Written with the open/closed state of every <details> inside the box carried
  // across, because the box is rewritten wholesale on every keystroke and
  // without this a visitor who opened "see how this was calculated" had it
  // silently re-collapse under the next character they typed.
  function writeResult(html) {
    const out = byId(ids.out);
    if (!out) return;
    const open = new Map();
    [...out.querySelectorAll('details')].forEach((d, i) => open.set(d.id || '#' + i, d.open));
    out.innerHTML = html;
    [...out.querySelectorAll('details')].forEach((d, i) => {
      const k = d.id || '#' + i;
      if (open.has(k)) d.open = open.get(k);
    });
  }

  function renderChips(state, result) {
    const box = byId(ids.answers);
    if (!box) return;
    let items = [];
    try { items = isFn(spec.chips) ? (spec.chips(state, result) || []) : []; } catch (_) { items = []; }
    box.innerHTML = items
      .filter((it) => it && it.label != null)
      .map((it) =>
        `<button type="button" data-otw-goto="${it.step}"` +
        (it.field ? ` data-otw-field="${it.field}"` : '') +
        `>${it.label} ✎</button>`)
      .join('');
  }

  function render() {
    const state = read();
    const result = spec.compute(state);
    const out = byId(ids.out);
    if (out) writeResult(spec.renderResult({ state, result, out }));
    syncExampleNote(state);
    renderStateNote();
    renderChips(state, result);
    if (isFn(spec.onRender)) spec.onRender({ state, result, step, wizard: controller });
    // Only from the answer card, see the note on announce() above.
    if (step === RESULT && isFn(spec.announce)) announce(spec.announce(state, result));
    return { state, result };
  }

  // ---- stepping ------------------------------------------------------------
  function renderProgress(path) {
    const dots = byId(ids.dots);
    const label = byId(ids.stepLabel);
    const at = path.indexOf(step);
    if (at === -1) return; // mid-edit and off-path; show() normalises a moment later
    if (dots) dots.innerHTML = path.map((_, i) => `<span${i <= at ? ' class="otw-on"' : ''}></span>`).join('');
    // The answer is not a question, so it is not counted: "Step 3 of 3" over a
    // result reads as one more thing to fill in.
    if (label) label.textContent = step === RESULT ? 'Your answer' : `Step ${at + 1} of ${path.length - 1}`;
  }

  function focusCard(el) {
    if (!el) return;
    const card = cards.find((c) => c.step === Number(el.dataset.step));
    let target = null;
    if (card && isFn(card.focus)) { try { target = card.focus(el); } catch (_) { target = null; } }
    if (!target && card && card.radios) {
      target = el.querySelector(`input[name="${card.radios}"]:checked`) || el.querySelector(`input[name="${card.radios}"]`);
    }
    if (!target && !(card && card.result)) {
      // Only a control that is actually on screen: a field parked inside a
      // closed <details> must not steal focus from the question in front of it.
      target = [...el.querySelectorAll('.otw-in')].find((n) => n.offsetParent !== null) || null;
    }
    if (!target) target = el.querySelector('.otw-q');
    if (!target) return;
    try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
  }

  // ---- coming back from the answer ----------------------------------------
  // Tapping an answer chip drops the visitor onto the card that asked for that
  // figure, and until this existed the only way back to the answer was Next
  // through every remaining card: on a nine-card flow, editing the first chip
  // cost seven more taps to see the number again. So while the visitor is on a
  // detour that STARTED at the answer, the card they are standing on grows one
  // extra control that goes straight back. It is created here rather than
  // written into fourteen templates because it exists only during the detour,
  // and it reuses .otw-skip so it needs no new CSS. Unlike Skip it clears
  // nothing: they came here to change a number, not to abandon one.
  let cameFromResult = false;
  function syncReturnButton() {
    if (!stage) return;
    stage.querySelectorAll('[data-otw-return]').forEach((b) => b.remove());
    if (!cameFromResult || step === RESULT) return;
    const card = cardEls.find((c) => Number(c.dataset.step) === step);
    const next = card && card.querySelector('.otw-next');
    if (!next || !next.parentNode) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'otw-skip';
    b.setAttribute('data-otw-return', '');
    b.textContent = 'Back to my answer';
    next.parentNode.insertBefore(b, next);
  }

  function show(n, withFocus = true) {
    // Settle any pending flag before the card it belongs to leaves the screen.
    flushFlags();
    const path = pathOf(read());
    step = normalise(n, path);
    let active = null;
    cardEls.forEach((c) => {
      const on = Number(c.dataset.step) === step;
      c.classList.toggle('otw-on', on);
      if (on) active = c;
    });
    if (step === RESULT) cameFromResult = false;
    syncReturnButton();
    renderProgress(path);
    if (step === RESULT) render();
    if (withFocus) focusCard(active);
  }

  // ---- Start over ----------------------------------------------------------
  // Start over means start over. Without the snapshot it moved the visitor to
  // card one and left every number they had entered in place, which is the
  // opposite of what the words promise. The defaults are snapshotted AFTER
  // initMoneyInputs() has formatted them, so a restart restores "60,000" rather
  // than the raw "60000" in the markup.
  const fieldIds = [...new Set(cards.flatMap((c) => c.fields || []))];
  const radioNames = [...new Set(cards.map((c) => c.radios).filter(Boolean))];
  const defaults = new Map();
  const radioDefaults = new Map();
  function snapshotDefaults() {
    fieldIds.forEach((id) => { const el = byId(id); if (el) defaults.set(id, el.value); });
    radioNames.forEach((name) => {
      const root = stage || document;
      const on = root.querySelector(`input[name="${name}"]:checked`) || root.querySelector(`input[name="${name}"]`);
      if (on) radioDefaults.set(name, on.value);
    });
  }
  function restart() {
    defaults.forEach((v, id) => { const el = byId(id); if (el) el.value = v; });
    radioDefaults.forEach((v, name) => {
      const el = (stage || document).querySelector(`input[name="${name}"][value="${v}"]`);
      if (el) el.checked = true;
    });
    if (stage) stage.querySelectorAll('.otw-esc[open]').forEach((d) => { d.open = false; });
    touched.clear();
    cameFromResult = false;
    stateNoteShown = null;
    restoreExampleNote();
    if (isFn(spec.onReset)) spec.onReset({ wizard: controller });
    // Card first, THEN the answer: render() announces only from the answer card,
    // and a restart must not read the example figures out to a screen reader on
    // its way back to question one.
    show(FIRST);
    render();
  }

  // ---- boot ----------------------------------------------------------------
  function start() {
    stage = byId(spec.stage);
    if (!stage) return;
    cardEls = [...stage.querySelectorAll('.otw-card')].sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));
    initMoneyInputs();
    if (isFn(spec.onBeforeSnapshot)) spec.onBeforeSnapshot({ wizard: controller });
    snapshotDefaults();
    captureExampleNote();

    stage.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t || !stage.contains(t)) return;
      const path = pathOf(read());
      // Checked before Skip: the return button borrows .otw-skip for its looks,
      // and Skip would blank the very field the visitor came back to change.
      if (t.dataset.otwReturn !== undefined) { show(RESULT); return; }
      if (t.classList.contains('otw-next')) { show(nextOf(step, path)); return; }
      if (t.classList.contains('otw-back')) { show(prevOf(step, path)); return; }
      if (t.classList.contains('otw-skip')) {
        // Keyed on the card the button is IN, not on the card the flow happens to
        // be standing on. They are the same for anybody clicking a Skip they can
        // see, and keying it on the current step meant a skip triggered any other
        // way cleared the wrong card's fields, or none.
        const host = t.closest('.otw-card');
        const at = host ? Number(host.dataset.step) : step;
        const card = cards.find((c) => c.step === at) || cards.find((c) => c.step === step);
        (card && card.skipClears ? card.skipClears : []).forEach((id) => { const el = byId(id); if (el) el.value = ''; });
        show(RESULT);
        return;
      }
      // A quick chip fills one field with one value. The synthetic input event
      // is what lets money-input.js reformat it; the touch is recorded here by
      // hand because that event is not trusted, and a tap on a chip really is
      // the visitor supplying that figure.
      if (t.dataset.otwFill) {
        const el = byId(t.dataset.otwFill);
        if (el) {
          el.value = t.dataset.otwValue != null ? t.dataset.otwValue : '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          noteFieldTouched(t.dataset.otwFill);
          flushFlags();
          render();
        }
        return;
      }
      if (t.dataset.otwGoto !== undefined) {
        const field = t.dataset.otwField;
        // Only a chip tapped FROM the answer starts a detour; a goto from
        // anywhere else is ordinary navigation and grows no return button.
        if (step === RESULT) cameFromResult = true;
        // A chip pointing at a field inside a collapsed helper has to open the
        // helper and land in the field itself: focusCard would otherwise pick
        // the first visible input on that card, which is a different question.
        const el = field ? byId(field) : null;
        if (el) { const d = el.closest('details'); if (d) d.open = true; }
        show(Number(t.dataset.otwGoto), !field);
        if (el) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
        return;
      }
      if (t.id === ids.restart) restart();
    });

    // Enter advances, except on a <summary> (where it opens the helper), on a
    // button (where it is that button's own activation) and on the answer card
    // (where there is nothing to advance to).
    stage.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.tagName === 'SUMMARY' || e.target.tagName === 'BUTTON') return;
      if (step === RESULT) return;
      e.preventDefault();
      show(nextOf(step, pathOf(read())));
    });

    // The progress line is recomputed on every keystroke, not just on Next: an
    // answer that shortens the path must shorten the dots on the keystroke that
    // shortened it, or the flow describes itself wrongly until the visitor moves.
    const recompute = () => { scheduleFlags(); renderProgress(pathOf(read())); render(); };

    for (const card of cards) {
      for (const id of card.fields || []) {
        const el = byId(id);
        if (!el) continue;
        el.addEventListener('input', recompute);
        el.addEventListener('change', recompute);
        el.addEventListener('blur', () => { flushFlags(); render(); });
        // isTrusted filters our own writes: only a person typing their own
        // number retires the example label.
        ['input', 'change'].forEach((evt) =>
          el.addEventListener(evt, (e) => { if (e.isTrusted) noteFieldTouched(id); }));
      }
      if (!card.radios) continue;
      // Choosing an option IS the answer to this card, so a POINTER choice moves
      // on by itself. Only a pointer: arrow keys move the selection inside a
      // radiogroup in every browser and fire `change` doing it, so advancing on
      // `change` alone swept a keyboard or screen-reader user off the card on
      // their first Down press, silently locking in the second option and
      // leaving the third unreachable in one pass. Keyboard users advance with
      // Enter or the Next button, which is what the rest of the flow does.
      let pointerAt = 0;
      const group = cardEls.find((c) => Number(c.dataset.step) === card.step);
      group?.addEventListener('pointerdown', () => { pointerAt = Date.now(); });
      // A card whose options REVEAL a field is not answered by the option alone.
      // Several tools put a money input behind a Yes ("how much comes out?"), and
      // the reveal and the auto-advance fired on the same tap: the field appeared
      // and the card left the screen in one gesture, so the number could never be
      // typed. On the last such card there was no way back at all, because the
      // answer card ships no nav row. So: if answering has put a usable control on
      // this card, the pointer lands IN it instead of moving on.
      const revealedField = () => {
        if (!group) return null;
        return [...group.querySelectorAll('.otw-in')].find((n) => n.offsetParent !== null) || null;
      };
      // Scoped to the stage: an /embed/ twin's own radios never share a page with
      // these, but a page that later grows a second radio group of the same name
      // outside the wizard must not be double-bound from here.
      stage.querySelectorAll(`input[name="${card.radios}"]`).forEach((el) => {
        el.addEventListener('change', (e) => {
          if (e.isTrusted) noteFieldTouched(card.radios);
          render();
          // The dots and the "Step 2 of 5" line are repainted here as well as on
          // every field event. A radio answer can shorten or lengthen the path
          // (filing status adds the spouse card, an account type short-circuits
          // three), and a KEYBOARD answer never reaches show(), so without this
          // the progress line described the old path until the next Next — a
          // wrong step count in front of exactly the visitors least able to
          // ignore it.
          renderProgress(pathOf(read()));
          if (step !== card.step || Date.now() - pointerAt >= 800) return;
          const field = revealedField();
          if (field) {
            try { field.focus({ preventScroll: true }); } catch (_) { field.focus(); }
            return;
          }
          show(nextOf(card.step, pathOf(read())));
        });
      });
    }

    flushFlags();
    // Render the answer once up front rather than only on arrival at the last
    // card: the result box is the page's [data-tb-result] anchor, and an empty
    // one leaves report-widget.js with nothing to attach its "Report a wrong
    // result" link to.
    render();

    // ONLY NOW does the stack become a stepped wizard, and the order is the
    // whole point: data-js="on" is what tells styles.css to hide every card, and
    // only the .otw-on class the show() below adds brings one back. Setting it
    // before the first render meant a throw in render() left the error banner
    // sitting above an entirely invisible form.
    stage.dataset.js = 'on';
    show(FIRST, false); // never steal focus on load
    booted = true;
    announceReady = true;
    if (isFn(spec.onReady)) spec.onReady({ wizard: controller });
  }

  const controller = {
    start,
    render,
    show,
    restart,
    flushFlags,
    scheduleFlags,
    touched,
    // For a tool-specific control the core cannot know about (a chip that fills
    // two fields at once, say). A tap on it IS the visitor supplying that
    // figure, and the synthetic event it fires is not trusted, so the touch has
    // to be recorded by hand exactly as the built-in chip handler does.
    noteTouched: noteFieldTouched,
    path: () => pathOf(read()),
    get step() { return step; },
    get booted() { return booted; },
    RESULT,
    FIRST
  };
  return controller;
}

/**
 * mountWizard(spec) — createWizard + the boot handshake every tool repeats:
 * wait for the DOM, run start(), and put the shared "this calculator failed to
 * load" banner on screen if anything throws. The banner is why start() sets
 * data-js LAST: a failure leaves the plain form visible beneath it.
 */
export function mountWizard(spec) {
  const boot = () => {
    try {
      createWizard(spec).start();
    } catch (err) {
      showCalculatorLoadError(err);
    }
  };
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
}
