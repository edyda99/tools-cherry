// 8-word shingle overlap between two built state pages' visible text.
// Case-insensitive, digit-insensitive (all digit runs → '#'), and the state
// name (+ abbreviation) is stripped from each page before shingling — so the
// number measures TEMPLATE overlap, not shared facts about different states.
// Usage: node scripts/shingle-overlap.js texas nevada [california colorado ...]
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function visibleText(slug) {
  const html = await readFile(join(ROOT, 'dist', `${slug}-paycheck-calculator`, 'index.html'), 'utf8');
  const roster = JSON.parse(await readFile(join(ROOT, 'src', 'data', 'states.json'), 'utf8'));
  const me = roster.find((s) => s.slug === slug);
  let t = html
    .replace(/<head>[\s\S]*?<\/head>/i, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .toLowerCase();
  if (me) {
    t = t.replaceAll(me.name.toLowerCase(), ' ').replaceAll(` ${me.abbr.toLowerCase()} `, ' ');
  }
  return t.replace(/\d+(?:[.,]\d+)*/g, '#').replace(/[^a-z#$%]+/g, ' ').trim();
}

function shingles(text, k = 8) {
  const words = text.split(' ').filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= words.length; i++) set.add(words.slice(i, i + k).join(' '));
  return set;
}

async function comparePair(a, b) {
  const [ta, tb] = await Promise.all([visibleText(a), visibleText(b)]);
  const sa = shingles(ta), sb = shingles(tb);
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  const union = sa.size + sb.size - inter;
  const min = Math.min(sa.size, sb.size);
  console.log(
    `${a} ↔ ${b}: containment ${(inter / min * 100).toFixed(1)}% (shared ${inter} / min ${min}), ` +
    `jaccard ${(inter / union * 100).toFixed(1)}% [${a}: ${sa.size} shingles, ${b}: ${sb.size}]`
  );
  return inter / min;
}

const args = process.argv.slice(2);
const pairs = args.length ? args : ['texas', 'nevada', 'california', 'colorado'];
for (let i = 0; i + 1 < pairs.length; i += 2) await comparePair(pairs[i], pairs[i + 1]);
