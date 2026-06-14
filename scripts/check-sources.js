// check-sources.js — best-effort watcher for "next year's tax figures are out".
// Runs in CI (GitHub Actions). Exits NON-ZERO when it detects that authoritative
// next-year figures appear published, so GitHub's failed-workflow email reaches you.
//
// Design choices for low noise:
//  - Network/parse errors are NON-fatal (exit 0). We never cry wolf on a transient
//    fetch failure or a site redesign — a false "all clear" is recoverable (the
//    year-rollover check in check-freshness.js is the hard backstop); a false alarm
//    every week would train you to ignore the emails.
//  - We watch a STABLE, machine-checkable signal: does the authoritative next-year
//    federal bracket page exist yet? It 404s until the figures are published.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'tax-data-2026.json'), 'utf8'));
const next = data.taxYear + 1;

// Stable URL pattern; appears only once the next tax year's figures are published.
const PROBES = [
  `https://taxfoundation.org/data/all/federal/${next}-tax-brackets/`,
  `https://taxfoundation.org/data/all/state/state-income-tax-rates-${next}/`
];

async function exists(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    // Treat a 200 that actually mentions the next year as "published".
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes(String(next));
  } catch (e) {
    console.log(`(probe skipped — ${url}: ${e.message})`);
    return null; // unknown; do not treat as a signal
  }
}

const hits = [];
for (const url of PROBES) {
  const ok = await exists(url);
  if (ok) hits.push(url);
}

if (hits.length) {
  console.error(
    `\n✖ NEW FIGURES LIKELY PUBLISHED for tax year ${next}:\n` +
    hits.map((u) => '   ' + u).join('\n') +
    `\n→ Time to source the ${next} federal + state figures, add tax-data-${next}.json, ` +
    `re-verify, and redeploy. (This failure is your notification.)\n`
  );
  process.exit(1);
}

console.log(`ok  - no ${next} figures detected yet (current dataset: ${data.taxYear}).`);
