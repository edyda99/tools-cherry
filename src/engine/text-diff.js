// text-diff.js — pure, dependency-free line-based text diff (LCS algorithm).
// Shared by the browser tool (diff-checker.js) and the unit tests.
//
// splitLines(text)            -> array of lines (handles \r\n, \r, \n; no trailing empty)
// diffLines(a, b, opts)       -> array of { type: 'equal'|'add'|'remove', line }
// diffStats(rows)             -> { added, removed, unchanged }
//
// A classic Longest-Common-Subsequence diff over lines: rows marked 'remove'
// only exist in A, 'add' only in B, 'equal' in both. Fully synchronous and
// deterministic — no randomness, no I/O.

// Split text into lines, normalizing all newline styles. A single trailing
// newline does not produce a phantom empty final line.
export function splitLines(text) {
  if (text == null) return [];
  const s = String(text).replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Normalize a line for comparison according to opts (the original text is kept
// for display; only the comparison key is normalized).
function key(line, opts) {
  let k = line;
  if (opts.ignoreWhitespace) k = k.replace(/\s+/g, ' ').trim();
  if (opts.ignoreCase) k = k.toLowerCase();
  return k;
}

// Compute the LCS length table for two key arrays.
function lcsTable(a, b) {
  const n = a.length;
  const m = b.length;
  // (n+1) x (m+1) table, row-major flat array.
  const dp = new Array((n + 1) * (m + 1)).fill(0);
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  return { dp, at };
}

// Diff two blocks of text line-by-line. Returns an ordered list of rows.
//   opts.ignoreWhitespace -> collapse runs of whitespace and trim before comparing
//   opts.ignoreCase       -> case-insensitive comparison
export function diffLines(a, b, opts = {}) {
  const aLines = splitLines(a);
  const bLines = splitLines(b);
  const aKeys = aLines.map((l) => key(l, opts));
  const bKeys = bLines.map((l) => key(l, opts));

  const { dp, at } = lcsTable(aKeys, bKeys);
  const rows = [];
  let i = 0;
  let j = 0;
  const n = aLines.length;
  const m = bLines.length;
  while (i < n && j < m) {
    if (aKeys[i] === bKeys[j]) {
      rows.push({ type: 'equal', line: aLines[i] });
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      rows.push({ type: 'remove', line: aLines[i] });
      i++;
    } else {
      rows.push({ type: 'add', line: bLines[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: 'remove', line: aLines[i++] });
  while (j < m) rows.push({ type: 'add', line: bLines[j++] });
  return rows;
}

// Tally the rows of a diff into counts.
export function diffStats(rows) {
  const out = { added: 0, removed: 0, unchanged: 0 };
  for (const r of rows) {
    if (r.type === 'add') out.added++;
    else if (r.type === 'remove') out.removed++;
    else out.unchanged++;
  }
  return out;
}
