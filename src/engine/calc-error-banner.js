// calc-error-banner.js — shared "visible failure" fallback for every calculator's
// init(). Defense-in-depth: if init() throws for ANY reason (a stale cached shared
// engine missing an export, a future bug, a runtime error) the form must not just
// sit there silently doing nothing — the visitor needs to be told something broke.
// Imported by every tool bootstrap file that uses the standard init()/DOMContentLoaded
// pattern (see build.js's asset-hashing pipeline — this file is itself content-hashed
// like any other shared engine).
export function showCalculatorLoadError(err) {
  if (err) console.error('Calculator failed to initialize:', err);
  if (document.getElementById('calc-load-error')) return; // already shown
  const main = document.querySelector('main') || document.body;
  if (!main) return;
  const banner = document.createElement('div');
  banner.id = 'calc-load-error';
  banner.className = 'calc-load-error';
  banner.setAttribute('role', 'alert');
  banner.textContent = 'Something went wrong loading this calculator — please refresh the page.';
  main.insertBefore(banner, main.firstChild);
}
