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
//
// A hash-forced open lasts for THIS visit only and is never written to storage.
// Both handlers used to persist it, which meant one tap on a header nav pill
// pinned that section open on every future visit: the homepage a visitor met
// once as a short shop window came back three times taller forever, with no way
// to undo it short of finding and closing the section by hand. The pre-paint
// script in home.html already treats the hash the same way, opening the target
// without recording anything, so these two handlers now match it. Storage is
// written only when the visitor actually activates a section header.
(function () {
  'use strict';
  var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 0); };

  // "Most Popular Tools" is the only section open on a first visit, so it is the
  // homepage's entire shop window: with it closed the page is seven headings and
  // no tool cards. It is an ordinary <details>, so one stray tap on its header
  // used to store tb-cat:popular=0 and empty the homepage on every future visit.
  // It stays collapsible for the current visit, it is just never REMEMBERED as
  // closed. Any '0' left in storage by an earlier build is cleared here too,
  // otherwise visitors already carrying one would stay stuck forever.
  var KEEP_OPEN = 'popular';

  function persist(el, open) {
    if (!el || !el.id) return;
    try {
      if (!open && el.id === KEEP_OPEN) {
        localStorage.removeItem('tb-cat:' + el.id);
        return;
      }
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

  // Repair, in its own guard so a throwing localStorage (private mode on some
  // browsers) can never stop the listeners below from being attached. A visitor
  // who already tapped the "Most Popular Tools" header under the old build is
  // carrying tb-cat:popular=0 and gets an empty homepage on every visit, with
  // nothing on screen to suggest why. Dropping that key now restores the shop
  // window on their next visit without them having to work out the fix.
  try {
    if (localStorage.getItem('tb-cat:' + KEEP_OPEN) === '0') {
      localStorage.removeItem('tb-cat:' + KEEP_OPEN);
    }
  } catch (e) {}

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
    // Open for this visit only. Nothing is written: jumping to a section is a
    // way of looking at it once, not a preference.
    window.addEventListener('hashchange', function () {
      var target = document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains('cat') && !target.open) {
        target.open = true;
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
      }
    });
  } catch (err) {
    if (window.console && console.debug) console.debug('tb-category-toggle init failed', err);
  }
})();
