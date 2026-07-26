// category-toggle.js — persists each homepage category section's open/closed
// state across visits. Progressive enhancement: the <details class="cat"> markup
// defaults to `open` in the HTML (so first-visit appearance is unchanged and the
// content is always in the DOM without JS), and a synchronous inline script in
// home.html reads localStorage before paint to collapse any section the visitor
// previously closed. This file is the write side: it listens for the native
// `toggle` event on each .cat element and saves the new state, keyed by the
// section's id, so the next visit (and the inline script above) picks it up.
//
// Also force-opens a section when the URL hash points at it (e.g. a nav link
// from any tool page to "/#tools") — otherwise a visitor who once collapsed
// that section would land on a header with no visible content. The inline
// script in home.html covers a fresh page load with the hash already present;
// this hashchange listener covers clicking the same-page nav link without a
// reload. Setting .open triggers the toggle listener below, which persists it.
//
// A delegated click handler covers the one case `hashchange` cannot: tapping a
// nav link whose hash is already the current fragment fires no hashchange at
// all, so a collapsed target would leave the visitor on a bare heading. The
// click runs before the browser scrolls, so the section is open on arrival.
(function () {
  'use strict';
  try {
    var cats = document.querySelectorAll('.cat');
    for (var i = 0; i < cats.length; i++) {
      (function (el) {
        el.addEventListener('toggle', function () {
          // A collapse applied by the pre-paint script in home.html is the
          // site default (every section except "popular" starts collapsed on a
          // first visit), not a choice the visitor made, so it must not be
          // stored. It marks those elements with data-tb-auto; the flag is
          // cleared here so any later real toggle persists normally.
          var auto = el.dataset && el.dataset.tbAuto === '1';
          if (el.dataset) delete el.dataset.tbAuto;
          if (auto && !el.open) return;
          try {
            localStorage.setItem('tb-cat:' + el.id, el.open ? '1' : '0');
          } catch (e) {}
        });
      })(cats[i]);
    }
    window.addEventListener('hashchange', function () {
      var target = document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains('cat') && !target.open) target.open = true;
    });
    document.addEventListener('click', function (e) {
      if (!e.target || !e.target.closest) return;
      var a = e.target.closest('a[href^="#"], a[href^="/#"]');
      if (!a) return;
      var id = a.getAttribute('href').replace(/^\/?#/, '');
      if (!id) return;
      var t = document.getElementById(id);
      if (t && t.classList.contains('cat') && !t.open) t.open = true;
    });
  } catch (err) {
    if (window.console && console.debug) console.debug('tb-category-toggle init failed', err);
  }
})();
