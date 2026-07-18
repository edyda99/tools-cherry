// search.js — global tool search / command palette (Cmd+K / Ctrl+K).
// Progressive enhancement: a classic deferred script wrapped in a try/catch so a
// failure here can never break the page it rides on. The tool index is provided
// by a separate content-hashed /assets/search-index.<hash>.js that assigns
// window.__TB_SEARCH_INDEX; we read it lazily the first time the palette opens,
// so the two scripts' load order never matters. Matching is a tiny in-house
// fuzzy scorer (substring + subsequence, multi-token) — no library needed for a
// few hundred tools. Accessibility: combobox + listbox with aria-activedescendant,
// role="dialog"/aria-modal panel, focus trapped on the input while open, and
// focus restored to the trigger on close.
(function () {
  'use strict';
  try {
    var overlay = document.getElementById('tb-search-overlay');
    var trigger = document.querySelector('.tb-search-trigger');
    if (!overlay || !trigger) return;
    var panel = overlay.querySelector('.tb-search-panel');
    var input = document.getElementById('tb-search-input');
    var list = document.getElementById('tb-search-list');
    var emptyMsg = document.getElementById('tb-search-empty');
    var recentLabel = document.getElementById('tb-search-recent-label');
    if (!panel || !input || !list || !emptyMsg) return;

    var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
    var kbdHint = trigger.querySelector('.tb-search-trigger-kbd');
    if (kbdHint) kbdHint.textContent = isMac ? '⌘K' : 'Ctrl K';

    var index = null;      // lazily normalized from window.__TB_SEARCH_INDEX
    var results = [];      // current [{ t, score }]
    var active = -1;       // active result index
    var lastFocused = null;
    var isOpen = false;

    function getIndex() {
      if (index) return index;
      var raw = window.__TB_SEARCH_INDEX || [];
      index = raw.map(function (t) {
        return {
          name: t.n || '', path: t.p || '', cat: t.c || '', desc: t.d || '',
          lname: (t.n || '').toLowerCase(),
          ldesc: (t.d || '').toLowerCase(),
          lcat: (t.c || '').toLowerCase(),
          lpath: (t.p || '').toLowerCase()
        };
      });
      return index;
    }

    // "Recently viewed" list for the empty state: paths recorded by
    // recent-tools.js, resolved against the index and capped at 6. Same
    // {t, score} shape render() expects; score is unused for recents.
    function getRecent() {
      var paths;
      try {
        var raw = localStorage.getItem('tb-recent');
        paths = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(paths)) paths = [];
      } catch (e) {
        paths = [];
      }
      var data = getIndex();
      var out = [];
      for (var i = 0; i < paths.length && out.length < 6; i++) {
        for (var k = 0; k < data.length; k++) {
          if (data[k].path === paths[i]) { out.push({ t: data[k], score: 0 }); break; }
        }
      }
      return out;
    }

    // All chars of q appear in s in order? Return the span (tighter = smaller),
    // or -1 for no subsequence match.
    function subseqSpan(q, s) {
      var si = 0, qi = 0, first = -1, last = -1;
      for (; si < s.length && qi < q.length; si++) {
        if (s.charCodeAt(si) === q.charCodeAt(qi)) {
          if (first < 0) first = si;
          last = si; qi++;
        }
      }
      if (qi < q.length) return -1;
      return last - first;
    }

    // Score a single query token against one tool. Higher = better; -1 = miss.
    function scoreToken(tok, t) {
      var i = t.lname.indexOf(tok);
      if (i === 0) return 100;                         // name prefix
      if (i > 0) {
        var wb = t.lname.charCodeAt(i - 1) === 32 ? 20 : 0; // word-boundary bonus
        return 70 + wb - Math.min(i, 20);
      }
      var span = subseqSpan(tok, t.lname);
      if (span >= 0) return 45 - Math.min(span, 30);
      if (t.ldesc.indexOf(tok) >= 0) return 25;
      if (t.lcat.indexOf(tok) >= 0) return 20;
      if (t.lpath.indexOf(tok) >= 0) return 15;
      return -1;
    }

    function search(qraw) {
      var q = (qraw || '').trim().toLowerCase();
      if (!q) return [];
      var toks = q.split(/\s+/);
      var data = getIndex();
      var out = [];
      for (var k = 0; k < data.length; k++) {
        var t = data[k], total = 0, ok = true;
        for (var j = 0; j < toks.length; j++) {
          var sc = scoreToken(toks[j], t);
          if (sc < 0) { ok = false; break; }
          total += sc;
        }
        if (!ok) continue;
        if (t.lname.indexOf(q) >= 0) total += 40; // whole-query-in-name bonus
        out.push({ t: t, score: total });
      }
      out.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.t.name.length - b.t.name.length;
      });
      return out.slice(0, 8);
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function render(items, isRecents) {
      results = items;
      if (recentLabel) recentLabel.hidden = !(isRecents && items.length);
      if (!items.length) {
        list.innerHTML = '';
        active = -1;
        emptyMsg.hidden = (input.value.trim() === '');
        input.setAttribute('aria-expanded', input.value.trim() ? 'true' : 'false');
        input.removeAttribute('aria-activedescendant');
        return;
      }
      emptyMsg.hidden = true;
      var html = '';
      for (var i = 0; i < items.length; i++) {
        var t = items[i].t;
        html += '<li class="tb-search-opt" id="tb-search-opt-' + i + '" role="option" data-path="' + esc(t.path) + '">' +
          '<span class="tb-search-opt-main">' +
          '<span class="tb-search-opt-name">' + esc(t.name) + '</span>' +
          (t.cat ? '<span class="tb-search-opt-cat">' + esc(t.cat) + '</span>' : '') +
          '</span>' +
          (t.desc ? '<span class="tb-search-opt-desc">' + esc(t.desc) + '</span>' : '') +
          '</li>';
      }
      list.innerHTML = html;
      input.setAttribute('aria-expanded', 'true');
      setActive(0);
    }

    function setActive(i) {
      var opts = list.children;
      if (!opts.length) { active = -1; return; }
      if (i < 0) i = opts.length - 1;
      else if (i >= opts.length) i = 0;
      for (var k = 0; k < opts.length; k++) opts[k].removeAttribute('aria-selected');
      active = i;
      var el = opts[active];
      el.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', el.id);
      var top = el.offsetTop, bottom = top + el.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }

    function go(i) {
      if (i < 0 || i >= results.length) return;
      window.location.href = results[i].t.path;
    }

    function openPalette() {
      if (isOpen) return;
      lastFocused = document.activeElement;
      overlay.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      isOpen = true;
      trigger.setAttribute('aria-expanded', 'true');
      input.value = '';
      render(getRecent(), true);
      input.focus();
    }

    function closePalette() {
      if (!isOpen) return;
      overlay.hidden = true;
      document.documentElement.style.overflow = '';
      isOpen = false;
      trigger.setAttribute('aria-expanded', 'false');
      input.value = '';
      list.innerHTML = '';
      emptyMsg.hidden = true;
      if (recentLabel) recentLabel.hidden = true;
      active = -1;
      results = [];
      // Return focus to where it was before opening; fall back to the trigger if
      // that element is gone, non-focusable, or was just the <body>.
      var restore = trigger;
      if (lastFocused && lastFocused !== document.body &&
          typeof lastFocused.focus === 'function' && document.contains(lastFocused)) {
        restore = lastFocused;
      }
      restore.focus();
    }

    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', openPalette);

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (!q) { render(getRecent(), true); return; }
      render(search(input.value));
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(active); }
      else if (e.key === 'Home') { if (results.length) { e.preventDefault(); setActive(0); } }
      else if (e.key === 'End') { if (results.length) { e.preventDefault(); setActive(results.length - 1); } }
      else if (e.key === 'Tab') { e.preventDefault(); } // focus trap: sole control
    });

    list.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.tb-search-opt') : null;
      if (!li) return;
      var i = Array.prototype.indexOf.call(list.children, li);
      if (i >= 0) go(i);
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest ? e.target.closest('.tb-search-opt') : null;
      if (!li) return;
      var i = Array.prototype.indexOf.call(list.children, li);
      if (i >= 0 && i !== active) setActive(i);
    });

    overlay.addEventListener('mousedown', function (e) {
      if (!panel.contains(e.target)) closePalette();
    });

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        isOpen ? closePalette() : openPalette();
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        closePalette();
      }
    });
  } catch (err) {
    if (window.console && console.warn) console.warn('tb-search init failed', err);
  }
})();
