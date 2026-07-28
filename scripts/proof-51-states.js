// proof-51-states.js — one-off proof harness for the authority-moves data pass.
// Computes annual take-home for all 51 jurisdictions at $100,000, single,
// biweekly, and writes a JSON snapshot. Run once on the clean baseline and once
// after the data edit, then diff, so an unapproved state moving by a cent is
// impossible to miss.
//
// Usage: node scripts/proof-51-states.js <out.json> [taxDataPath] [enginePath]
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const outPath = resolve(process.argv[2] || join(root, 'proof.json'));
const taxPath = resolve(process.argv[3] || join(root, 'src', 'data', 'tax-data-2026.json'));
const enginePath = resolve(process.argv[4] || join(root, 'src', 'engine', 'paycheck-engine.js'));

const { computePaycheck } = await import(pathToFileURL(enginePath).href);
const tax = JSON.parse(await readFile(taxPath, 'utf8'));

const slugs = Object.keys(tax.states).sort();
const rows = {};
for (const slug of slugs) {
  const r = computePaycheck({
    wage: { type: 'salary', amount: 100000 },
    filingStatus: 'single',
    payFrequency: 'biweekly',
    stateSlug: slug
  }, tax);
  rows[slug] = {
    net: r.annual.net,
    federal: r.annual.federal,
    socialSecurity: r.annual.socialSecurity,
    medicare: r.annual.medicare,
    state: r.annual.state,
    statePrograms: r.annual.statePrograms,
    totalTax: r.annual.totalTax,
    programs: r.annual.programs.map((p) => ({ label: p.label, rate: p.rate, amount: p.amount }))
  };
}

await writeFile(outPath, JSON.stringify({ count: slugs.length, rows }, null, 2));
console.log(`wrote ${outPath} (${slugs.length} jurisdictions)`);
