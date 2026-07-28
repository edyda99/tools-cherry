// what-applies-to-me.js — the visibility-only controller for /what-applies-to-me/.
//
// THE ONE RULE THIS FILE OBEYS
// It never creates, writes or edits page content. Every sentence, every state
// block, every number and every count string already exists in the static HTML
// at build time; this file only decides which of them is visible. The only DOM
// mutations allowed anywhere below are:
//   el.setAttribute('data-shown','')  /  el.removeAttribute('data-shown')
//   el.focus()  /  el.disabled = true|false  /  history.replaceState(...)
// There is no innerHTML, no textContent write, no createElement, no insertAdjacent
// anywhere in this file, and there must never be. If a future change needs new
// words on the page, they belong in the template or in the build-time generator
// (src/content/what-applies-to-me.js), not here.
//
// The matching CSS lives in the page template: `html.js .g { display:none }` and
// `html.js .g[data-shown] { display:block }`. With JavaScript off, neither rule
// applies, so the page renders as a complete, readable reference for all 51
// jurisdictions with every question and every rule already on screen.
(function () {
  'use strict';
  try {
    var form = document.getElementById('wamFlow');
    var result = document.getElementById('wamResult');
    if (!form || !result) return;

    var liveState = document.getElementById('liveState');
    var workState = document.getElementById('workState');
    var movedState = document.getElementById('movedState');

    var W_BOXES = ['same', 'travel', 'remote', 'moved'];
    var H_BOXES = ['tips', 'ot', 'bonus', 'age', 'car', 'give', 'home', 'none'];
    var ORDER = ['1', '2', '3', '4', '4b', '5', '6'];

    // Every gate attribute a node can carry, mapped to the answer it reads.
    // `set` gates are satisfied when ANY listed token is in the answer set;
    // scalar gates are satisfied when the answer equals one of the listed tokens.
    var GATES = [
      ['data-st', 'st', false],
      ['data-cross', 'cross', false],
      ['data-mfrom', 'mfrom', false],
      ['data-has', 'has', true],
      ['data-w', 'w', true],
      ['data-married', 'married', false],
      ['data-band', 'band', false],
      ['data-year', 'year', false],
      ['data-who', 'who', false],
      ['data-cnt', 'cnt', false],
      ['data-gapcnt', 'gapcnt', false],
      ['data-morecnt', 'morecnt', false],
      ['data-step', 'step', false]
    ];

    var answers = {
      st: '', cross: '', mfrom: '',
      has: {}, w: {},
      married: '', band: '', who: '', year: '2026',
      cnt: '', gapcnt: '', morecnt: '', step: ''
    };

    var screens = form.querySelectorAll('.wam-screen');
    var gated = document.querySelectorAll('.g');

    // ── the only two mutators ────────────────────────────────────────────────
    function show(el) { el.setAttribute('data-shown', ''); }
    function hide(el) { el.removeAttribute('data-shown'); }

    function box(id) { return document.getElementById(id); }
    function checked(id) { var b = box(id); return !!(b && b.checked); }

    function readAnswers() {
      answers.st = liveState ? liveState.value : '';
      answers.cross = workState ? workState.value : '';
      answers.mfrom = movedState ? movedState.value : '';
      answers.w = {};
      for (var i = 0; i < W_BOXES.length; i++) {
        if (checked('w-' + W_BOXES[i])) answers.w[W_BOXES[i]] = true;
      }
      answers.has = {};
      for (var j = 0; j < H_BOXES.length; j++) {
        if (checked('h-' + H_BOXES[j])) answers.has[H_BOXES[j]] = true;
      }
      var m = form.querySelector('input[name="wamMarried"]:checked');
      answers.married = m ? m.value : '';
      var b = form.querySelector('input[name="wamBand"]:checked');
      answers.band = b ? b.value : '';
      var wh = form.querySelector('input[name="wamWho"]:checked');
      answers.who = answers.has.age ? (wh ? wh.value : 'skip') : '';
      var y = document.querySelector('input[name="wamYear"]:checked');
      answers.year = y ? y.value : '2026';
    }

    function satisfies(el) {
      for (var i = 0; i < GATES.length; i++) {
        var attr = GATES[i][0], key = GATES[i][1], isSet = GATES[i][2];
        var raw = el.getAttribute(attr);
        if (raw === null) continue;
        var tokens = raw.split(/\s+/);
        var ok = false;
        for (var t = 0; t < tokens.length; t++) {
          if (!tokens[t]) continue;
          if (isSet) { if (answers[key][tokens[t]]) { ok = true; break; } }
          else if (answers[key] === tokens[t]) { ok = true; break; }
        }
        if (!ok) return false;
      }
      return true;
    }

    // A node inside a hidden gated ancestor is not actually on screen, so the
    // counters must not count it. Read-only walk, no mutation.
    //
    // Count gates (data-cnt / data-gapcnt / data-morecnt) are DERIVED from this
    // very count, so an ancestor carrying one must be treated as transparent here
    // or the section that shows itself only when its count is above zero would
    // suppress the children it is counting, and its count would be stuck at zero.
    function isCountGated(n) {
      return n.hasAttribute
        && (n.hasAttribute('data-hide-if-empty')
          || n.hasAttribute('data-gapcnt') || n.hasAttribute('data-morecnt') || n.hasAttribute('data-cnt'));
    }
    function effectivelyVisible(el) {
      var n = el;
      while (n && n !== document.body) {
        if (n !== el && isCountGated(n)) { n = n.parentElement; continue; }
        if (n.classList && n.classList.contains('g') && !n.hasAttribute('data-shown')) return false;
        if (n.classList && n.classList.contains('wam-screen') && !n.hasAttribute('data-shown')) return false;
        n = n.parentElement;
      }
      return true;
    }

    function applyGates() {
      for (var i = 0; i < gated.length; i++) {
        if (satisfies(gated[i])) show(gated[i]); else hide(gated[i]);
      }
    }

    // Band A promises the reader it stops at five. Hiding the surplus is still a
    // visibility decision, so it stays inside this file's one rule.
    function capBandA() {
      var list = document.getElementById('bandA');
      if (!list) return;
      var items = list.children;
      var shownCount = 0;
      for (var i = 0; i < items.length; i++) {
        if (!items[i].hasAttribute('data-shown')) continue;
        shownCount++;
        if (shownCount > 5) hide(items[i]);
      }
    }

    function countVisible(selector) {
      var nodes = result.querySelectorAll(selector);
      var n = 0;
      for (var i = 0; i < nodes.length; i++) if (effectivelyVisible(nodes[i])) n++;
      return n;
    }

    function applyCounts() {
      var rules = countVisible('.rule');
      var gaps = countVisible('.gap');
      var more = 0;
      var details = result.querySelector('details.wam-more');
      if (details) {
        var mn = details.querySelectorAll('.gap');
        for (var i = 0; i < mn.length; i++) if (effectivelyVisible(mn[i])) more++;
      }
      answers.cnt = String(Math.min(rules, 40));
      answers.gapcnt = String(Math.min(gaps, 12));
      answers.morecnt = String(Math.min(more, 6));
      var spans = result.querySelectorAll('[data-cnt],[data-gapcnt],[data-morecnt]');
      for (var s = 0; s < spans.length; s++) {
        if (satisfies(spans[s])) show(spans[s]); else hide(spans[s]);
      }
    }

    // A section whose every card is gated away would otherwise leave a bare heading
    // and a caveat line with nothing under them, which reads as a broken page and,
    // worse, as us saying "nothing here applies to you". Showing the section only
    // when it still has a visible card is a visibility decision, not a content one.
    function applyEmptySections() {
      var secs = result.querySelectorAll('[data-hide-if-empty]');
      for (var i = 0; i < secs.length; i++) {
        var probes = secs[i].querySelectorAll('.rule, .gap, li[data-shown]');
        var any = false;
        for (var p = 0; p < probes.length; p++) {
          if (effectivelyVisible(probes[p])) { any = true; break; }
        }
        if (any) show(secs[i]); else hide(secs[i]);
      }
    }

    function refresh() {
      readAnswers();
      applyGates();
      capBandA();
      applyEmptySections();
      applyCounts();
    }

    // ── screen navigation ────────────────────────────────────────────────────
    var current = '1';

    function screenApplies(id) {
      if (id === '3') return !!(answers.w.travel || answers.w.remote || answers.w.moved);
      if (id === '4b') return !!answers.has.age;
      return true;
    }

    function showScreen(id, moveFocus) {
      current = id;
      for (var i = 0; i < screens.length; i++) {
        if (screens[i].getAttribute('data-screen') === id) show(screens[i]);
        else hide(screens[i]);
      }
      hide(result);
      answers.step = id === '1' ? '' : id;
      var statusSpans = form.querySelectorAll('[data-step]');
      for (var s = 0; s < statusSpans.length; s++) {
        if (satisfies(statusSpans[s])) show(statusSpans[s]); else hide(statusSpans[s]);
      }
      if (moveFocus) {
        var head = form.querySelector('.wam-screen[data-screen="' + id + '"] h2');
        if (head) head.focus();
      }
    }

    function step(dir) {
      readAnswers();
      var idx = ORDER.indexOf(current);
      var next = idx + dir;
      while (next > 0 && next < ORDER.length && !screenApplies(ORDER[next])) next += dir;
      if (next < 0) next = 0;
      if (next >= ORDER.length) { finish(); return; }
      showScreen(ORDER[next], true);
    }

    function finish() {
      refresh();
      for (var i = 0; i < screens.length; i++) hide(screens[i]);
      answers.step = 'result';
      var statusSpans = form.querySelectorAll('[data-step]');
      for (var s = 0; s < statusSpans.length; s++) {
        if (satisfies(statusSpans[s])) show(statusSpans[s]); else hide(statusSpans[s]);
      }
      show(result);
      writeQuery();
      var head = document.getElementById('wamResultH');
      if (head) head.focus();
    }

    // ── the query string, so a result is linkable and re-openable ────────────
    function keysOf(obj) {
      var out = [];
      for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(k);
      return out;
    }

    function writeQuery() {
      if (!window.history || !window.history.replaceState) return;
      var parts = [];
      if (answers.st) parts.push('state=' + encodeURIComponent(answers.st));
      var w = keysOf(answers.w);
      if (w.length) parts.push('w=' + w.join(','));
      if (answers.cross) parts.push('work=' + encodeURIComponent(answers.cross));
      if (answers.mfrom) parts.push('from=' + encodeURIComponent(answers.mfrom));
      var h = keysOf(answers.has);
      if (h.length) parts.push('has=' + h.join(','));
      if (answers.who) parts.push('who=' + answers.who);
      if (answers.married) parts.push('married=' + answers.married);
      if (answers.band) parts.push('band=' + answers.band);
      if (answers.year) parts.push('year=' + answers.year);
      var q = parts.length ? '?' + parts.join('&') : '';
      history.replaceState(null, '', location.pathname + q + location.hash);
    }

    function setRadio(name, value) {
      if (!value) return;
      var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
      if (r) r.checked = true;
    }

    function readQuery() {
      var q = location.search.replace(/^\?/, '');
      if (!q) return false;
      var map = {};
      var pairs = q.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var kv = pairs[i].split('=');
        if (kv[0]) map[kv[0]] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      }
      if (!map.state || !liveState) return false;
      var found = false;
      for (var o = 0; o < liveState.options.length; o++) {
        if (liveState.options[o].value === map.state) found = true;
      }
      if (!found) return false;
      liveState.value = map.state;
      var i2;
      if (map.w) {
        var ws = map.w.split(',');
        for (i2 = 0; i2 < ws.length; i2++) { var wb = box('w-' + ws[i2]); if (wb) wb.checked = true; }
      }
      if (map.has) {
        var hs = map.has.split(',');
        for (i2 = 0; i2 < hs.length; i2++) { var hb = box('h-' + hs[i2]); if (hb) hb.checked = true; }
      }
      if (map.work && workState) workState.value = map.work;
      if (map.from && movedState) movedState.value = map.from;
      setRadio('wamMarried', map.married);
      setRadio('wamBand', map.band);
      setRadio('wamWho', map.who);
      setRadio('wamYear', map.year === '2025' ? '2025' : '2026');
      syncExclusive();
      return true;
    }

    // ── exclusive checkboxes ────────────────────────────────────────────────
    function syncExclusive() {
      var same = box('w-same');
      var others = ['w-travel', 'w-remote', 'w-moved'];
      var i;
      if (same) {
        for (i = 0; i < others.length; i++) {
          var o = box(others[i]);
          if (!o) continue;
          if (same.checked) { o.checked = false; o.disabled = true; } else { o.disabled = false; }
        }
      }
      var none = box('h-none');
      if (none) {
        for (i = 0; i < H_BOXES.length - 1; i++) {
          var h = box('h-' + H_BOXES[i]);
          if (!h) continue;
          if (none.checked) { h.checked = false; h.disabled = true; } else { h.disabled = false; }
        }
      }
    }

    // ── wiring ──────────────────────────────────────────────────────────────
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t && (t.id === 'w-same' || t.id === 'h-none'
        || (t.type === 'checkbox' && /^(w|h)-/.test(t.id || '')))) syncExclusive();
      refresh();
    });

    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'wamYear') refresh();
    });

    form.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.hasAttribute('data-next')) {
        // The state is the master key: without it the result would be empty, so
        // the flow stays on screen 1 and puts the cursor back on the picker.
        if (current === '1' && liveState && !liveState.value) { liveState.focus(); return; }
        step(1);
      }
      else if (t.hasAttribute('data-back')) { step(-1); }
      else if (t.hasAttribute('data-finish')) { finish(); }
    });

    var copyBtn = document.getElementById('wamCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        // location.href is the browser's own string, not page content.
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(location.href);
        }
      });
    }
    var printBtn = document.getElementById('wamPrint');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
    var restartBtn = document.getElementById('wamRestart');
    if (restartBtn) {
      restartBtn.addEventListener('click', function () {
        showScreen('1', true);
        refresh();
      });
    }

    // ── start ───────────────────────────────────────────────────────────────
    var deepLinked = readQuery();
    refresh();
    if (deepLinked) finish(); else showScreen('1', false);
  } catch (err) {
    // A failure here must never leave a half-hidden page. Removing the js class
    // drops every display:none rule, so the full static page comes back.
    document.documentElement.className = document.documentElement.className.replace(/\bjs\b/, '');
  }
})();
