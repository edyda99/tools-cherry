// embed-gallery.js — copy-to-clipboard for the embed snippets. Nothing uploaded.
function flash(btn, msg) {
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = label; }, 1500);
}

async function copy(btn) {
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

document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b)));
