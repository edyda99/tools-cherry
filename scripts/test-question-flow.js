// test-question-flow.js — covers src/assets/question-flow.js, the controller behind
// the plain-question flow on the 71 tax calculator pages.
//
// Why this one needs a browser when every other test in this repo is pure node: the
// behaviour under test IS the DOM. The script reads a radio group's checked state,
// parks the field it controls at a neutral value, dispatches the input event the
// calculators listen to, and gives the typed value back when the answer flips to Yes.
// A hand-rolled DOM shim would be testing the shim.
//
// The failure this exists to prevent is silent and expensive: charitable-deduction
// ships #other pre-filled at 20000, so if parking ever regresses to hide-only, a
// visitor who says they have nothing else to write off keeps feeding 20000 to the
// comparison and the page prints the wrong verdict with no error anywhere.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src/assets/question-flow.js');

if (!fs.existsSync(CHROME)) {
  // Loudly skipped, never silently passed. A missing browser is a gap in coverage
  // and should read as one.
  console.log('test-question-flow: SKIPPED, Chrome not found at ' + CHROME);
  console.log('  This leaves question-flow.js untested on this machine.');
  process.exit(0);
}

const PAGE = `<meta charset="utf-8">
<div class="yn">
  <label><input type="radio" name="qOther" value="no" checked><span>No</span></label>
  <label><input type="radio" name="qOther" value="yes"><span>Yes</span></label>
</div>
<div class="adv-reveal" data-reveal="qOther">
  <input id="other" type="text" inputmode="decimal" data-money value="20000">
</div>
<div class="yn">
  <label><input type="radio" name="qOn" value="no"><span>No</span></label>
  <label><input type="radio" name="qOn" value="yes" checked><span>Yes</span></label>
</div>
<div class="adv-reveal" data-reveal="qOn"><input id="onField" type="number" value="1234"></div>
<div class="yn">
  <label><input type="radio" name="qMix" value="no" checked><span>No</span></label>
  <label><input type="radio" name="qMix" value="yes"><span>Yes</span></label>
</div>
<div class="adv-reveal" data-reveal="qMix">
  <select id="sel"><option value="a">a</option><option value="b" selected>b</option></select>
  <input id="chk" type="checkbox" checked>
  <input id="ovr" type="number" value="99" data-qf-off="7">
  <input id="txt" type="text" value="hello">
</div>
<div class="adv-reveal" data-reveal="qMissing"><input id="orphan" type="number" value="55"></div>
<div id="out"></div>
<script src="file://${SRC}"></script>
<script>
const heard = {};
for (const id of ['other','onField','orphan']) {
  heard[id] = 0;
  document.getElementById(id).addEventListener('input', () => { heard[id]++; });
}
const R = [];
const is = (name, got, want) => R.push({ name, got: String(got), want: String(want), pass: String(got) === String(want) });
const v = (id) => document.getElementById(id).value;
const ck = (id) => document.getElementById(id).checked;
const hid = (n) => document.querySelector('[data-reveal="' + n + '"]').hidden;
const answer = (name, val) => {
  const r = document.querySelector('input[name="' + name + '"][value="' + val + '"]');
  r.checked = true;
  r.dispatchEvent(new Event('change', { bubbles: true }));
};

is('No-answered question is hidden on load', hid('qOther'), 'true');
is('No-answered field is PARKED at 0, not just hidden', v('other'), '0');
is('Yes-answered question stays visible', hid('qOn'), 'false');
is('Yes-answered field keeps its value', v('onField'), '1234');
is('select parks to its defaultSelected option', v('sel'), 'b');
is('checkbox parks to unchecked', ck('chk'), 'false');
is('data-qf-off overrides the neutral value', v('ovr'), '7');
is('free text parks to empty, not 0', v('txt'), '');
is('wrapper with no radio group stays visible', hid('qMissing'), 'false');
is('wrapper with no radio group is never parked', v('orphan'), '55');

answer('qOther', 'yes');
is('answering Yes shows the field', hid('qOther'), 'false');
is('answering Yes restores the parked value', v('other'), '20000');

document.getElementById('other').value = '500';
answer('qOther', 'no');
is('parks again after a visitor edit', v('other'), '0');
answer('qOther', 'yes');
is('restores the EDITED value, not the shipped default', v('other'), '500');

answer('qMix', 'yes');
is('select restores', v('sel'), 'b');
is('checkbox restores', ck('chk'), 'true');
is('override field restores', v('ovr'), '99');
is('text restores', v('txt'), 'hello');

is('parking fires input so the engine recomputes', heard.other > 0, 'true');
is('untouched orphan fires nothing', heard.orphan, '0');
is('Yes-by-default field fires nothing', heard.onField, '0');

document.getElementById('out').textContent = 'RESULTS' + JSON.stringify(R);
</script>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-test-'));
const page = path.join(tmp, 'page.html');
fs.writeFileSync(page, PAGE);

// Chrome on this machine reliably produces the DOM dump but does not always exit,
// hanging in a profile helper rather than in rendering. So read stdout as it arrives
// and kill the process once the result marker is present, rather than waiting on exit.
const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--user-data-dir=' + path.join(tmp, 'profile'),
  '--virtual-time-budget=3000', '--dump-dom', 'file://' + page,
], { stdio: ['ignore', 'pipe', 'ignore'] });

let out = '';
let settled = false;

const finish = (code) => {
  if (settled) return;
  settled = true;
  try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best effort */ }

  const m = out.match(/RESULTS(\[.*?\])<\/div>/s);
  if (!m) {
    console.log('test-question-flow: FAILED, the test page did not produce a result');
    process.exit(1);
  }
  const R = JSON.parse(m[1]);
  const failed = R.filter((r) => !r.pass);
  for (const r of failed) console.log('  FAIL  ' + r.name + '   got=' + r.got + ' want=' + r.want);
  console.log('test-question-flow: ' + (R.length - failed.length) + '/' + R.length + ' passed');
  process.exit(failed.length ? 1 : (code === undefined ? 0 : 0));
};

child.stdout.on('data', (d) => {
  out += d;
  if (out.includes('RESULTS[') && out.includes('</div>')) finish();
});
child.on('exit', () => finish());
setTimeout(() => finish(), 30000).unref();
