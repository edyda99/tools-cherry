// proof-diff.js — diffs two proof-51-states.js snapshots and prints a table.
// Fails loudly (exit 1) if any state outside the approved list moves at all.
import { readFile } from 'node:fs/promises';

const APPROVED = new Set(['washington', 'alaska', 'pennsylvania', 'new-jersey', 'delaware', 'minnesota']);

const before = JSON.parse(await readFile(process.argv[2], 'utf8')).rows;
const after = JSON.parse(await readFile(process.argv[3], 'utf8')).rows;

const slugs = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
const moved = [];
const unapprovedMoved = [];

for (const s of slugs) {
  const b = before[s];
  const a = after[s];
  const bn = b ? b.net : null;
  const an = a ? a.net : null;
  const delta = (an ?? 0) - (bn ?? 0);
  // exact comparison: anything other than a true zero counts as movement
  if (delta !== 0 || JSON.stringify(b) !== JSON.stringify(a)) {
    moved.push({ slug: s, before: bn, after: an, delta, progB: b.programs, progA: a.programs });
    if (!APPROVED.has(s)) unapprovedMoved.push(s);
  }
}

const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log('Annual take-home, $100,000 salary, single, biweekly, 51 jurisdictions\n');
console.log('| State | Net BEFORE | Net AFTER | Delta | Programs after |');
console.log('|---|---|---|---|---|');
for (const m of moved) {
  const progs = m.progA.map((p) => `${p.label} ${money(p.amount)}`).join('; ') || 'none';
  console.log(`| ${m.slug} | ${money(m.before)} | ${money(m.after)} | ${money(m.delta)} | ${progs} |`);
}
console.log(`\nstates that moved: ${moved.length}`);
console.log(`states that did NOT move: ${slugs.length - moved.length} of ${slugs.length}`);
console.log(`unapproved states that moved: ${unapprovedMoved.length}${unapprovedMoved.length ? ' -> ' + unapprovedMoved.join(', ') : ''}`);

if (unapprovedMoved.length) {
  console.error('\nFAIL: an unapproved state changed.');
  process.exit(1);
}
console.log('\nPASS: only approved states moved.');
