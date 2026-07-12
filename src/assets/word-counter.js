// word-counter.js — client-side Word & Character Counter UI. Reads the textarea
// and reading-speed control, defers all analysis to the pure engine
// (text-stats.js), and updates the stat readout live as you type. It also shows
// keyword density and checks the text length against common platform limits
// (tweet, SMS, meta description, etc.). No network, no storage — everything runs
// in the browser.

import { analyze } from '/assets/text-stats.js';

import { showCalculatorLoadError } from '/assets/calc-error-banner.js';
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');

// Common platform character limits people write against (characters with spaces).
const LIMITS = [
  { label: 'Post on X / Twitter', max: 280 },
  { label: 'SMS (single message)', max: 160 },
  { label: 'Meta description', max: 160 },
  { label: 'Title tag (SEO)', max: 60 },
  { label: 'Instagram caption', max: 2200 },
  { label: 'LinkedIn post', max: 3000 }
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderStats(r) {
  $('statWords').textContent = nf.format(r.words);
  $('statChars').textContent = nf.format(r.characters);
  $('statCharsNoSpaces').textContent = nf.format(r.charactersNoSpaces);
  $('statSentences').textContent = nf.format(r.sentences);
  $('statParagraphs').textContent = nf.format(r.paragraphs);
  $('statLines').textContent = nf.format(r.lines);
  $('statReading').textContent = r.readingTime;
  $('statSpeaking').textContent = r.speakingTime;
  $('statAvg').textContent = r.avgWordsPerSentence ? String(r.avgWordsPerSentence) : '0';
}

// Keyword density table. analyze() returns keywords as {word, count, percent}.
function renderKeywords(keywords) {
  const body = $('densityBody');
  const note = $('densityNote');
  if (!keywords.length) {
    body.innerHTML = '';
    note.hidden = false;
    note.textContent = 'Type some text to see its most frequent words.';
    return;
  }
  note.hidden = true;
  body.innerHTML = keywords.map((k) =>
    `<tr><td>${escapeHtml(k.word)}</td><td class="num">${nf.format(k.count)}</td><td class="num">${k.percent}%</td></tr>`
  ).join('');
}

function renderLimits(chars) {
  $('limitBody').innerHTML = LIMITS.map((l) => {
    const remaining = l.max - chars;
    const over = remaining < 0;
    const state = over ? 'over' : remaining <= l.max * 0.1 ? 'near' : 'ok';
    const note = over ? `${nf.format(-remaining)} over` : `${nf.format(remaining)} left`;
    return `<tr>
      <td>${l.label}</td>
      <td class="num">${nf.format(l.max)}</td>
      <td class="num limit-${state}">${note}</td>
    </tr>`;
  }).join('');
}

function update() {
  const text = $('text').value;
  const wpm = Number($('wpm').value) || 200;
  const r = analyze(text, { wpm });
  renderStats(r);
  renderKeywords(r.keywords);
  renderLimits(r.characters);
}

function init() {
  $('text').addEventListener('input', update);
  $('wpm').addEventListener('input', update);

  const clear = $('clearBtn');
  if (clear) clear.addEventListener('click', () => { $('text').value = ''; $('text').focus(); update(); });

  const copy = $('copyBtn');
  if (copy) {
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('text').value);
        copy.classList.add('copied');
        const prev = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(() => { copy.classList.remove('copied'); copy.textContent = prev; }, 1400);
      } catch (_) { /* clipboard unavailable; ignore silently */ }
    });
  }

  update();
}

function __bootInit() {
  try {
    init();
  } catch (err) {
    showCalculatorLoadError(err);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', __bootInit);
} else {
  __bootInit();
}
