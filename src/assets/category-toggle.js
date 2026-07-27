// category-toggle.js — persists each homepage category section's open/closed
// state across visits. Progressive enhancement: the <details class="cat"> markup
// defaults to `open` in the HTML (so first-visit appearance is unchanged and the
// content is always in the DOM without JS), and a synchronous inline script in
// home.html reads localStorage before paint to collapse any section the visitor
// previously closed. This file is the write side.
//
// It deliberately does NOT listen for the native `toggle` event. `toggle` fires
// asynchronously, so a programmatic collapse from the pre-paint script in
// home.html could land after this file had run and be stored as if the visitor
// had chosen it — a section the visitor never touched would then be pinned open
// or closed forever, and a plain reload with no interaction would write a
// tb-cat key on its own. Persistence is therefore sourced only from a real
// activation of the section header: a pointer click, or Enter/Space on the
// focused <summary>. The new state is read inside requestAnimationFrame, after
// the browser has applied the toggle.
//
// Also force-opens a section when the URL hash points at it (e.g. a nav link
// from any tool page to "/#tools") — otherwise a visitor who once collapsed
// that section would land on a header with no visible content. The inline
// script in home.html covers a fresh page load with the hash already present;
// this hashchange listener covers clicking the same-page nav link without a
// reload.
//
// A delegated click handler covers the one case `hashchange` cannot: tapping a
// nav link whose hash is already the current fragment fires no hashchange at
// all, so a collapsed target would leave the visitor on a bare heading. The
// click runs before the browser scrolls, so the section is open on arrival.
// Both of those are visitor-initiated navigations, so they persist the forced
// open state, exactly as the old toggle listener used to.
(function () {
  'use strict';
  var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 0); };

  function persist(el, open) {
    if (!el || !el.id) return;
    try {
      localStorage.setItem('tb-cat:' + el.id, open ? '1' : '0');
    } catch (e) {}
  }

  // The read is deferred because the activation handlers run BEFORE the browser
  // applies the toggle, so `el.open` is still the old value inside them.
  // requestAnimationFrame was the deferral, but it is suspended in a
  // non-rendering tab — a background tab, or an occluded window — so opening a
  // section by keyboard there left the callback queued forever and the visitor's
  // choice was never written. A timer is not tied to painting and still runs, so
  // it is scheduled alongside as the deferral of last resort.
  //
  // Both callbacks are allowed to run rather than the first one winning: each
  // re-reads `el.open` at the moment it fires, so whichever runs later simply
  // rewrites the same value under the same key. Guarding on "already written"
  // would instead let an early timer pin a stale value that the later frame
  // could no longer correct.
  function persistAfterPaint(el) {
    raf(function () { persist(el, el.open); });
    setTimeout(function () { persist(el, el.open); }, 100);
  }

  try {
    var cats = document.querySelectorAll('.cat');
    for (var i = 0; i < cats.length; i++) {
      (function (el) {
        var summary = el.querySelector('.cat-summary');
        if (!summary) return;
        summary.addEventListener('click', function () {
          persistAfterPaint(el);
        });
        summary.addEventListener('keydown', function (e) {
          var k = e.key;
          if (k === 'Enter' || k === ' ' || k === 'Spacebar') persistAfterPaint(el);
        });
      })(cats[i]);
    }
    window.addEventListener('hashchange', function () {
      var target = document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains('cat') && !target.open) {
        target.open = true;
        persist(target, true);
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var a = e.target.closest('a[href^="#"], a[href^="/#"]');
      if (!a) return;
      var id = a.getAttribute('href').replace(/^\/?#/, '');
      if (!id) return;
      var t = document.getElementById(id);
      if (t && t.classList.contains('cat') && !t.open) {
        t.open = true;
        persist(t, true);
      }
    });
  } catch (err) {
    if (window.console && console.debug) console.debug('tb-category-toggle init failed', err);
  }
})();
