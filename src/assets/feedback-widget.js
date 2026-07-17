// feedback-widget.js — a tiny, easily-dismissed "Was this tool helpful?" rating
// toast, injected on tool pages only (build.js → injectFeedback).
//
// UX discipline is the whole point: it must NEVER feel naggy.
//   • Shows ONLY after the visitor has actually used the tool (first input/change
//     inside the tool area), then waits 20s, then appears once — if the tab is
//     visible, else on the next visibilitychange.
//   • At most once per tool per browser, and at most one toast per day site-wide.
//   • No backdrop: the page stays fully interactive. X / Escape / click-outside
//     all dismiss silently (no POST). Any network error is swallowed.
//   • Never runs inside an iframe (embeds), and never runs without localStorage.
//
// Progressive enhancement: the whole thing is wrapped in try/catch so a failure
// here can never break the tool it rides on. Dependency-free, no external hosts.
(function () {
  'use strict';
  try {
    // Never inside an embed/iframe.
    if (window.top !== window.self) return;

    // localStorage is required for the frequency caps; without it, never show.
    var ls;
    try {
      ls = window.localStorage;
      var probe = '__fbw__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
    } catch (_) { return; }

    // Tool slug = first path segment, sanitized to the server's /^[a-z0-9-]{2,60}$/.
    var seg = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    var slug = seg.slice(0, 60);
    if (slug.length < 2) return;

    var TOOL_KEY = 'fbw:' + slug; // "done" | "dismissed" — either means never again for this tool.
    var LAST_KEY = 'fbw:last';    // YYYY-MM-DD of the last toast shown, site-wide.
    var DELAY_MS = 20000;         // arm-to-show delay after first interaction.

    function today() { return new Date().toISOString().slice(0, 10); }

    // May we still show for this tool, right now? (Re-checked at fire time too.)
    function canShow() {
      try {
        if (ls.getItem(TOOL_KEY)) return false;      // done or dismissed already.
        if (ls.getItem(LAST_KEY) === today()) return false; // one toast per day, site-wide.
      } catch (_) { return false; }
      return true;
    }

    var shown = false;
    var toast = null;
    var rating = 0;
    var lastFocused = null;

    function post(withComment) {
      // Fire-and-forget; keepalive lets it survive the toast being removed.
      // Any failure is silent by design — never disturb the user.
      var payload = { tool: slug, rating: rating };
      if (withComment) payload.comment = withComment;
      try {
        fetch('/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
          credentials: 'same-origin',
        }).catch(function (e) { dbg(e); });
      } catch (e) { dbg(e); }
    }

    function dbg(e) { if (window.console && console.debug) console.debug('fbw', e); }

    function mark(state) { try { ls.setItem(TOOL_KEY, state); } catch (_) {} }

    function remove() {
      if (!toast) return;
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('mousedown', onOutside, true);
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      toast = null;
      // Restore focus to wherever it was before the toast grabbed it.
      try {
        if (lastFocused && document.contains(lastFocused) && typeof lastFocused.focus === 'function') {
          lastFocused.focus();
        }
      } catch (_) {}
    }

    function dismiss() { mark('dismissed'); remove(); } // no POST.

    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
    }
    function onOutside(e) {
      if (toast && !toast.contains(e.target)) dismiss();
    }

    function el(tag, cls, attrs) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
      return n;
    }

    function build() {
      toast = el('div', 'fbw-toast', { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'fbw-q' });

      var close = el('button', 'fbw-x', { type: 'button', 'aria-label': 'Dismiss feedback' });
      close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      close.addEventListener('click', dismiss);
      toast.appendChild(close);

      var q = el('p', 'fbw-q', { id: 'fbw-q' });
      q.textContent = 'Was this tool helpful?';
      toast.appendChild(q);

      var group = el('div', 'fbw-stars', { role: 'radiogroup', 'aria-labelledby': 'fbw-q' });
      var stars = [];
      for (var i = 1; i <= 5; i++) {
        var b = el('button', 'fbw-star', {
          type: 'button', role: 'radio', 'aria-checked': 'false',
          'aria-label': i + (i === 1 ? ' star' : ' stars'),
          tabindex: i === 1 ? '0' : '-1',
        });
        b.dataset.val = String(i);
        b.innerHTML = starSvg();
        (function (btn, val) {
          btn.addEventListener('click', function () { choose(val); });
          // Hover preview: entering star N lights 1..N, matching how star
          // ratings are read everywhere else (not just the one under the cursor).
          btn.addEventListener('mouseenter', function () {
            if (!rating) previewStars(stars, val);
          });
        })(b, i);
        group.appendChild(b);
        stars.push(b);
      }
      // Leaving the whole group (not just moving between stars) clears the preview.
      group.addEventListener('mouseleave', function () {
        if (!rating) previewStars(stars, 0);
      });
      // Same cumulative preview for keyboard users as the arrow keys move focus.
      group.addEventListener('focusin', function (e) {
        if (rating) return;
        var btn = e.target.closest('.fbw-star');
        if (btn) previewStars(stars, parseInt(btn.dataset.val, 10));
      });
      group.addEventListener('focusout', function (e) {
        if (!rating && !group.contains(e.relatedTarget)) previewStars(stars, 0);
      });
      group.addEventListener('keydown', function (e) {
        var cur = stars.indexOf(document.activeElement);
        if (cur < 0) cur = 0;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault(); focusStar(stars, Math.min(cur + 1, 4));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault(); focusStar(stars, Math.max(cur - 1, 0));
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault(); choose(cur + 1);
        }
      });
      toast.stars = stars;
      toast.appendChild(group);

      document.body.appendChild(toast);
      document.addEventListener('keydown', onKeydown, true);
      document.addEventListener('mousedown', onOutside, true);
    }

    function focusStar(stars, idx) {
      for (var i = 0; i < stars.length; i++) stars[i].setAttribute('tabindex', i === idx ? '0' : '-1');
      stars[idx].focus();
    }

    function paint(stars, val) {
      for (var i = 0; i < stars.length; i++) {
        var on = i < val;
        stars[i].setAttribute('aria-checked', i === val - 1 ? 'true' : 'false');
        stars[i].classList.toggle('is-on', on);
      }
    }

    // Cumulative hover/keyboard-focus preview (star 4 hovered -> stars 1-4 lit).
    // Purely visual — no aria-checked change, since nothing is selected yet.
    function previewStars(stars, val) {
      for (var i = 0; i < stars.length; i++) stars[i].classList.toggle('is-hover', i < val);
    }

    // A star was chosen: lock the rating in, reveal the optional comment step.
    function choose(val) {
      if (!toast || rating) return; // locked after first choice.
      rating = val;
      var stars = toast.stars;
      previewStars(stars, 0); // clear any leftover hover preview before locking the real state.
      paint(stars, val);
      for (var i = 0; i < stars.length; i++) stars[i].disabled = true;

      var step = el('div', 'fbw-step');
      var ta = el('textarea', 'fbw-comment', {
        maxlength: '500', rows: '2',
        placeholder: 'Any suggestion? (optional)', 'aria-label': 'Optional suggestion',
      });
      var row = el('div', 'fbw-row');
      var send = el('button', 'fbw-send', { type: 'button' });
      send.textContent = 'Send';
      var skip = el('button', 'fbw-skip', { type: 'button' });
      skip.textContent = 'Skip';
      send.addEventListener('click', function () {
        var c = (ta.value || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 500);
        submit(c || null);
      });
      skip.addEventListener('click', function () { submit(null); });
      row.appendChild(send);
      row.appendChild(skip);
      step.appendChild(ta);
      step.appendChild(row);
      toast.appendChild(step);
      try { ta.focus(); } catch (_) {}
    }

    function submit(comment) {
      post(comment);        // Skip posts the rating without a comment.
      mark('done');
      // Brief "Thanks!" acknowledgement, then remove.
      if (toast) {
        toast.innerHTML = '';
        var t = el('p', 'fbw-thanks');
        t.textContent = 'Thanks!';
        toast.appendChild(t);
      }
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('mousedown', onOutside, true);
      setTimeout(remove, 2000);
    }

    function starSvg() {
      return '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.9l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.94z"' +
        ' fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';
    }

    function show() {
      if (shown || toast) return;
      if (!canShow()) return;
      shown = true;
      try { ls.setItem(LAST_KEY, today()); } catch (_) {}
      lastFocused = document.activeElement;
      rating = 0;
      build();
    }

    // Fire after the delay: show now if visible, else defer to next visible.
    function fire() {
      if (document.visibilityState === 'visible') { show(); return; }
      var onVis = function () {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', onVis);
          show();
        }
      };
      document.addEventListener('visibilitychange', onVis);
    }

    // Arm once, on the visitor's first real interaction with the tool area.
    var armed = false;
    function arm() {
      if (armed) return;
      armed = true;
      area.removeEventListener('input', arm, true);
      area.removeEventListener('change', arm, true);
      setTimeout(fire, DELAY_MS);
    }

    // The tool's form/calc area — guaranteed present since injection is gated on
    // exactly these markers (build.js). Falls back to <main> defensively.
    var area = document.querySelector('.calc, form') || document.getElementById('main') || document.body;

    // Test hooks (ONLY on #fbwtest): __fbwShowNow force-shows immediately
    // (bypassing the caps) so headless/manual checks can screenshot the toast
    // without waiting 20s; __fbwCanShow exposes the real suppression gate so a
    // reload-after-dismiss can be asserted deterministically.
    if (location.hash === '#fbwtest') {
      window.__fbwShowNow = function () {
        shown = false; if (toast) remove();
        shown = true;
        try { ls.setItem(LAST_KEY, today()); } catch (_) {}
        lastFocused = document.activeElement; rating = 0; build();
      };
      window.__fbwCanShow = canShow;
    }

    if (!canShow()) return; // nothing to arm — already done/dismissed/shown-today.
    area.addEventListener('input', arm, true);
    area.addEventListener('change', arm, true);
  } catch (err) {
    if (window.console && console.debug) console.debug('fbw init failed', err);
  }
})();
