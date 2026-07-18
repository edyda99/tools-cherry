// category-toggle.js — persists each homepage category section's open/closed
// state across visits. Progressive enhancement: the <details class="cat"> markup
// defaults to `open` in the HTML (so first-visit appearance is unchanged and the
// content is always in the DOM without JS), and a synchronous inline script in
// home.html reads localStorage before paint to collapse any section the visitor
// previously closed. This file is the write side: it listens for the native
// `toggle` event on each .cat element and saves the new state, keyed by the
// section's id, so the next visit (and the inline script above) picks it up.
(function () {
  'use strict';
  try {
    var cats = document.querySelectorAll('.cat');
    for (var i = 0; i < cats.length; i++) {
      (function (el) {
        el.addEventListener('toggle', function () {
          try {
            localStorage.setItem('tb-cat:' + el.id, el.open ? '1' : '0');
          } catch (e) {}
        });
      })(cats[i]);
    }
  } catch (err) {
    if (window.console && console.debug) console.debug('tb-category-toggle init failed', err);
  }
})();
