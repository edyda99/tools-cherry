// word-counter.js — client-side Word & Character Counter UI. Reads the textarea
// and reading-speed control, defers all analysis to the pure engine
// (text-stats.js), and updates the stat readout live as you type. It also checks
// the text length against common platform limits (tweet, SMS, meta description,
// etc.). No network, no storage — everything runs in the browser.

import { analyze } from '/assets/text-stats.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');

// Common platform character limits people write against. `count` picks which
// metric the limit applies to: characters (with spaces) unless noted.
const LIMITS = [
  { label: 'Post on X / Twitter', max: 280 },
  { label: 'SMS (single message)', max: 160 },
  { label: 'Meta description', max: 160 },
  { label: 'Title tag (SEO)', max: 60 },
  { label: 'Instagram caption', max: 2200 },
  { label: 'LinkedIn post', max: 3000 }
];

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

function renderLimits(chars) {
  const rows = LIMITS.map((l) => {
    const remaining = l.max - chars;
    const over = remaining < 0;
    const state = over ? 'over' : remaining <= l.max * 0.1 ? 'near' : 'ok';
    const note = over
      ? `${nf.format(-remaining)} over`
      : `${nf.format(remaining)} left`;
    return `<tr>
      <td>${l.label}</td>
      <td class="num">${nf.format(l.max)}</td>
      <td class="num limit-${state}">${note}</td>
    </tr>`;
  }).join('');
  $('limitBody').innerHTML = rows;
}

function renderKeywords(keywords) {
  const wrap = $('keywords');
  if (!keywords.length) {
    wrap.innerHTML = '<p class="muted-small">Type some text to see its most frequent keywords.</p>';
    return;
  }
  wrap.innerHTML = '<ol class="kw-list">' + keywords.map((k) =>
    `<li><span class="kw-word">${escapeHtml(k.word)}</span><span class="kw-meta">${nf.format(k.count)} · ${k.percent}%</span></li>`
  ).join('') + '</ol>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function update() {
  const text = $('text').value;
  const wpm = Number($('wpm').value) || 200;
  const r = analyze(text, { wpm });
  renderStats(r);
  renderLimits(r.characters);
  renderKeywords(r.keywords);
}

function init() {
  $('limit-rows-skeleton')?.remove();
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
