// report-widget.js — an always-visible "Report a wrong result" link, injected on
// tool pages only (build.js → injectReport, same gates as the rating widget).
//
// Unlike the rating toast (feedback-widget.js) this is USER-INITIATED, so there
// is no popup choreography, no arm-delay, and no frequency cap — the link is
// simply there, as a sibling right after the tool's result, from the moment the
// script runs. Clicking it expands an inline form that captures a REQUIRED
// comment plus a frozen snapshot of the tool's current inputs and displayed
// result (auto-captured, so a report is self-contained enough to reproduce the
// bug). It POSTs to /api/report and shows a real success/failure outcome.
//
// Progressive enhancement: the whole thing is wrapped in try/catch so a failure
// here can never break the tool it rides on. Dependency-free (plain non-module
// <script defer>), no external hosts, never runs inside an iframe (embeds).
(function () {
  'use strict';
  try {
    // Never inside an embed/iframe.
    if (window.top !== window.self) return;

    // C0 control chars + DEL — stripped from the comment before sending so the
    // server sees a single clean line (it strips them too; belt-and-braces).
    var CONTROL = /[\x00-\x1F\x7F]/g;

    // Tool slug = first path segment, sanitized to the server's /^[a-z0-9-]{2,60}$/.
    var seg = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    var slug = seg.slice(0, 60);
    if (slug.length < 2) return;

    function dbg(e) { if (window.console && console.debug) console.debug('rpt', e); }

    function el(tag, cls, attrs) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
      return n;
    }

    function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

    // Comma-safe raw numeric read for money fields, replicated inline from
    // money-input.js's moneyValue() (this is a non-module script and can't import
    // it) — so a grouped "28,000" is captured as 28000, never truncated to 28.
    function moneyNum(node) {
      var v = parseFloat(String(node.value).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(v) ? v : 0;
    }

    // --- anchor: the single result element the link attaches after ------------
    var mainEl = document.getElementById('main') || document.body;

    function looksLikeResult(node) {
      return node.id === 'out' || /(^|[\s-])results?([\s-]|$)/.test(node.className) || /-out(\s|$)/.test(node.className);
    }

    function findAnchor() {
      var candidates = Array.prototype.slice.call(mainEl.querySelectorAll('[aria-live="polite"]'));
      if (candidates.length > 1) {
        var narrowed = candidates.filter(looksLikeResult);
        if (narrowed.length) candidates = narrowed;
      }
      if (candidates.length !== 1) return null; // ambiguous or none — skip silently, no fallback guess.
      return candidates[0];
    }

    // --- snapshot: frozen at click time, not submit time ----------------------
    function snapshot(anchor) {
      var result = (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 800);
      var scope = document.querySelector('.calc, form') || mainEl;
      var fields = scope.querySelectorAll('input, select, textarea');
      var inputs = {};
      var n = 0;
      for (var i = 0; i < fields.length && n < 60; i++) {
        var f = fields[i];
        if (f.disabled) continue;
        var type = (f.type || '').toLowerCase();
        if (type === 'hidden' || type === 'button' || type === 'submit' ||
            type === 'reset' || type === 'image' || type === 'file') continue;
        var key = f.id || f.name;
        if (!key) continue;
        if (type === 'checkbox') { inputs[key] = !!f.checked; n++; continue; }
        if (type === 'radio') { if (!f.checked) continue; inputs[key] = f.value; n++; continue; }
        if (f.hasAttribute('data-money')) { inputs[key] = moneyNum(f); n++; continue; }
        inputs[key] = f.value;
        n++;
      }
      return { result: result, inputs: inputs };
    }

    // --- POST: resolves to the HTTP status (0 on a network failure) -----------
    function post(comment, snap) {
      return fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: slug, comment: comment, result: snap.result, inputs: snap.inputs }),
        credentials: 'same-origin',
      }).then(function (r) { return r.status; }).catch(function (e) { dbg(e); return 0; });
    }

    // --- copy button: a small, permanent control right after the anchor -------
    // Reads the anchor's LIVE textContent at click time (never a frozen
    // snapshot), unlike the report form's snapshot() which is deliberately
    // frozen. Feature-detected: on browsers/contexts without
    // navigator.clipboard.writeText, no button is rendered at all rather than
    // one that would silently fail.
    function createCopyButton(anchorNode) {
      if (!window.navigator || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return null;
      var IDLE = 'Copy result';
      var b = el('button', 'rpt-copy', { type: 'button' });
      b.textContent = IDLE;
      var resetTimer = null;
      b.addEventListener('click', function () {
        var text = (anchorNode.textContent || '').replace(/\s+/g, ' ').trim();
        navigator.clipboard.writeText(text).then(function () {
          if (resetTimer) clearTimeout(resetTimer);
          b.textContent = 'Copied';
          resetTimer = setTimeout(function () { b.textContent = IDLE; resetTimer = null; }, 1500);
        }).catch(function (e) { dbg(e); });
      });
      return b;
    }

    // --- view state: exactly one of link / form / thanks after the anchor -----
    var anchor = null;
    var current = null; // the node currently mounted immediately after the anchor.

    // mount() always inserts immediately after mountAfter, which init() sets to
    // the Copy button when one exists (so Copy stays permanently between the
    // anchor and whatever state mount() is currently showing), or to the
    // anchor itself otherwise — this preserves the original behavior.
    var mountAfter = null;

    function mount(node) {
      if (current && current.parentNode) current.parentNode.removeChild(current);
      mountAfter.insertAdjacentElement('afterend', node);
      current = node;
    }

    function showLink() {
      var b = el('button', 'rpt-link', { type: 'button' });
      b.textContent = 'Report a wrong result';
      b.addEventListener('click', function () { showForm(snapshot(anchor)); });
      mount(b);
    }

    function showThanks() {
      var t = el('p', 'rpt-thanks', { role: 'status' });
      t.textContent = "Thanks — we'll look into it.";
      mount(t);
      // Stay permanently available: revert to the idle link after a few seconds,
      // but only if nothing else has replaced this thanks node meanwhile.
      setTimeout(function () { if (current === t) showLink(); }, 4000);
    }

    function showForm(snap) {
      var form = el('div', 'rpt-form');

      var recap = el('p', 'rpt-recap');
      recap.textContent = snap.result
        ? 'Reporting this result: “' + truncate(snap.result, 120) + '”'
        : 'Reporting this tool result.';
      form.appendChild(recap);

      var ta = el('textarea', 'rpt-comment', {
        maxlength: '1000', rows: '3',
        placeholder: "What's wrong? (required)", 'aria-label': 'Describe what is wrong',
      });
      form.appendChild(ta);

      var row = el('div', 'rpt-row');
      var send = el('button', 'rpt-send', { type: 'button' });
      send.textContent = 'Send report';
      send.disabled = true;
      var cancel = el('button', 'rpt-cancel', { type: 'button' });
      cancel.textContent = 'Cancel';
      row.appendChild(send);
      row.appendChild(cancel);
      form.appendChild(row);

      var errBox = null;
      function setError(msg) {
        if (!errBox) { errBox = el('p', 'rpt-error', { role: 'alert' }); form.appendChild(errBox); }
        errBox.textContent = msg;
      }
      function clearError() {
        if (errBox && errBox.parentNode) errBox.parentNode.removeChild(errBox);
        errBox = null;
      }

      var sending = false;
      var closed = false; // guards a resolving POST from mounting over a cancelled form.
      function syncSend() { if (!sending) send.disabled = !ta.value.trim(); }

      function collapse() {
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        showLink();
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); collapse(); } }

      ta.addEventListener('input', syncSend);
      cancel.addEventListener('click', collapse);

      send.addEventListener('click', function () {
        if (sending) return;
        var comment = (ta.value || '').replace(CONTROL, '').trim().slice(0, 1000);
        if (!comment) { send.disabled = true; return; }
        sending = true;
        send.disabled = true;
        clearError();
        post(comment, snap).then(function (status) {
          sending = false;
          if (closed) return; // user cancelled while the request was in flight.
          if (status === 204) {
            document.removeEventListener('keydown', onKey, true);
            showThanks();
          } else if (status === 429) {
            setError("You've reached today's report limit. Thanks for your patience.");
            syncSend();
          } else {
            setError("Couldn't send — please try again.");
            syncSend();
          }
        });
      });

      document.addEventListener('keydown', onKey, true);
      mount(form);
      try { ta.focus(); } catch (_) {}
    }

    // --- fallback: no single result anchor found — offer a plain contact link -
    // Runs only when findAnchor() returned null. Scoped to the same .calc/form
    // container snapshot() already uses; if that isn't found either, do
    // nothing, matching this file's "skip silently rather than guess" rule.
    // /contact/ is a plain static mailto page (src/content/static-pages.js) —
    // it does not read or prefill from any query parameter, so no slug is
    // threaded onto the link.
    function showContactFallback() {
      var scope = document.querySelector('.calc, form');
      if (!scope) return;
      var p = el('p', 'rpt-contact-fallback');
      p.appendChild(document.createTextNode('Spotted a wrong result? '));
      var a = el('a', null, { href: '/contact/' });
      a.textContent = 'Contact us';
      p.appendChild(a);
      p.appendChild(document.createTextNode('.'));
      scope.insertAdjacentElement('afterend', p);
    }

    function init() {
      anchor = findAnchor();
      if (!anchor) { showContactFallback(); return; }
      mountAfter = anchor;
      var copyBtn = createCopyButton(anchor);
      if (copyBtn) {
        anchor.insertAdjacentElement('afterend', copyBtn);
        mountAfter = copyBtn;
      }
      showLink();
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
  } catch (err) {
    if (window.console && console.debug) console.debug('rpt init failed', err);
  }
})();
