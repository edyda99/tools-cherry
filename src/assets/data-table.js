// data-table.js — shared client behaviour for the /data/ reference tables:
// a live text filter (search box) + click-to-sort columns. The pure helpers
// (rowMatchesQuery, compareValues) are exported so they can be unit-tested in
// Node; the DOM wiring only runs in a browser (guarded on `document`), so
// importing this module in a test never touches the DOM.

// True when every whitespace-separated term in `query` appears somewhere in
// `rowText` (case-insensitive). An empty/blank query matches everything.
export function rowMatchesQuery(rowText, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  const hay = String(rowText == null ? '' : rowText).toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

// Comparator for two cell values. mode 'num' strips non-numeric characters and
// compares numerically (so "$40,000" and "10.23%" sort by magnitude); anything
// else compares as locale-aware text. `dir` is 1 (asc) or -1 (desc).
export function compareValues(a, b, mode, dir) {
  const d = dir < 0 ? -1 : 1;
  if (mode === 'num') {
    const x = parseFloat(String(a).replace(/[^0-9.\-]/g, ''));
    const y = parseFloat(String(b).replace(/[^0-9.\-]/g, ''));
    const nx = Number.isFinite(x) ? x : -Infinity;
    const ny = Number.isFinite(y) ? y : -Infinity;
    if (nx === ny) return 0;
    return (nx < ny ? -1 : 1) * d;
  }
  return String(a).trim().localeCompare(String(b).trim()) * d;
}

// Read a cell's sort key: prefer an explicit data-val, else its text content.
function cellValue(cell) {
  if (!cell) return '';
  const dv = cell.getAttribute && cell.getAttribute('data-val');
  return dv != null ? dv : cell.textContent;
}

function wireTable(table) {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = () => Array.prototype.slice.call(tbody.querySelectorAll('tr'));

  // Click-to-sort on any thead cell that declares a data-sort mode.
  const headers = table.querySelectorAll('thead th');
  headers.forEach((th, col) => {
    const mode = th.getAttribute('data-sort');
    if (!mode) return;
    let dir = -1;
    th.setAttribute('role', 'button');
    th.setAttribute('tabindex', '0');
    const doSort = () => {
      dir = -dir;
      const sorted = rows().sort((ra, rb) =>
        compareValues(cellValue(ra.children[col]), cellValue(rb.children[col]), mode, dir));
      sorted.forEach((r) => tbody.appendChild(r));
      headers.forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
    };
    th.addEventListener('click', doSort);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doSort(); }
    });
  });

  // Live filter box, linked by data-filter-for="<table id>".
  const input = document.querySelector('[data-filter-for="' + table.id + '"]');
  const counter = document.querySelector('[data-filter-count="' + table.id + '"]');
  if (input) {
    const apply = () => {
      const q = input.value;
      let shown = 0;
      rows().forEach((r) => {
        const match = rowMatchesQuery(r.textContent, q);
        r.hidden = !match;
        if (match) shown++;
      });
      if (counter) counter.textContent = String(shown);
    };
    input.addEventListener('input', apply);
    apply();
  }
}

// Copy-to-clipboard for the "Embed this table" snippet (button[data-copy] ->
// textarea#<id>). Mirrors embed-gallery.js so the data pages don't need it too.
function flash(btn, msg) {
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = label; }, 1500);
}
async function copySnippet(btn) {
  const ta = document.getElementById(btn.dataset.copy);
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    flash(btn, 'Copied!');
  } catch {
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); flash(btn, 'Copied!'); }
    catch { flash(btn, 'Press Ctrl+C'); }
  }
}

if (typeof document !== 'undefined') {
  const boot = () => {
    document.querySelectorAll('table[data-datatable]').forEach(wireTable);
    document.querySelectorAll('[data-copy]').forEach((b) =>
      b.addEventListener('click', () => copySnippet(b)));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
