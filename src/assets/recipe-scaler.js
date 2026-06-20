// recipe-scaler.js — recipe / ingredient scaler UI.
// Pure logic via the shared recipe-scale module. No deps, nothing uploaded.
import { scaleRecipe, scaleFactor } from '/assets/recipe-scale.js';

const $ = (id) => document.getElementById(id);

function currentFactor() {
  const from = $('fromServings').value.trim();
  const to = $('toServings').value.trim();
  return scaleFactor(from, to);
}

function update() {
  const factor = currentFactor();
  const ingredients = $('ingredients').value;
  const out = $('output');
  const factorLabel = $('factorLabel');

  if (!Number.isFinite(factor)) {
    out.value = '';
    factorLabel.textContent = 'Enter servings to scale.';
    return;
  }

  out.value = scaleRecipe(ingredients, factor);

  // Friendly multiplier label, e.g. "×2", "×0.5", "×1.5".
  const rounded = Math.round(factor * 1000) / 1000;
  factorLabel.textContent = `Scaling ×${rounded}`;
}

// Quick presets multiply the *target* servings relative to the original.
function applyPreset(mult) {
  const from = Number($('fromServings').value.trim());
  if (!Number.isFinite(from) || from <= 0) return;
  const target = from * mult;
  // Keep whole servings when it divides cleanly; otherwise show one decimal.
  $('toServings').value = Number.isInteger(target) ? String(target) : target.toFixed(1);
  update();
}

async function copyOutput() {
  const text = $('output').value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $('copyBtn');
    const prev = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  } catch {
    // Clipboard blocked (no HTTPS / permission) — select the text as a fallback.
    $('output').select();
  }
}

function init() {
  ['fromServings', 'toServings', 'ingredients'].forEach((id) =>
    $(id).addEventListener('input', update)
  );
  document.querySelectorAll('[data-mult]').forEach((btn) =>
    btn.addEventListener('click', () => applyPreset(Number(btn.dataset.mult)))
  );
  $('copyBtn').addEventListener('click', copyOutput);
  update();
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
