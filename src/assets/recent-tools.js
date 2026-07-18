// recent-tools.js — records this page's path into a "recently viewed" list in
// localStorage, so the site-wide Cmd/Ctrl+K search palette (search.js) can show
// a short recents list instead of an empty state when first opened.
//
// Progressive enhancement: wrapped in try/catch so a failure here can never
// break the tool page it rides on. Dependency-free (plain non-module
// <script defer>), no external hosts, never runs inside an iframe (embeds).
// Rides on the same injectToolScript gates as feedback-widget.js /
// report-widget.js (build.js), so it only loads on real tool pages.
(function () {
  'use strict';
  try {
    // Never inside an embed/iframe.
    if (window.top !== window.self) return;

    var KEY = 'tb-recent';
    var MAX = 8;

    var path = location.pathname;

    var list;
    try {
      var raw = localStorage.getItem(KEY);
      list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
    } catch (e) {
      list = [];
    }

    // De-dupe: drop any existing occurrence of this path, then put it first.
    var next = [path];
    for (var i = 0; i < list.length && next.length < MAX; i++) {
      if (list[i] !== path) next.push(list[i]);
    }

    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
      // private browsing / quota exceeded / storage disabled — nothing more to do.
    }
  } catch (err) {
    if (window.console && console.debug) console.debug('recent-tools init failed', err);
  }
})();
