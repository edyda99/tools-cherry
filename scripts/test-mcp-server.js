// test-mcp-server.js — exercises the MCP server's JSON-RPC handler for all four
// tools and asserts every figure it returns is IDENTICAL to the site engine
// called directly. The point of the server is that it cannot drift from the
// pages; these assertions are what enforces that.
//
// The Worker transport is a thin wrapper over handleRpc(), so this runs the
// handler in plain Node — no miniflare, no network, no added test time.
import assert from 'node:assert/strict';
import { handleRpc, TOOLS } from '../backend/mcp-server/mcp.js';
import { computePaycheck } from '../src/engine/paycheck-engine.js';
import { computeBonus } from '../src/engine/bonus-tax.js';
import { deepLink, LADDER_SALARIES, ATTRIBUTION } from '../backend/mcp-server/tools.js';
import taxData from '../src/data/tax-data-2026.json' with { type: 'json' };
import suppData from '../src/data/state-supplemental-2026.json' with { type: 'json' };

let n = 0;
const t = (name, fn) => { fn(); n++; };
const call = (name, args) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const engineNet = (slug, salary, filingStatus = 'single') =>
  computePaycheck({ wage: { type: 'salary', amount: salary }, filingStatus, payFrequency: 'annual', stateSlug: slug }, taxData).annual;

// --- protocol --------------------------------------------------------------

t('initialize returns protocol version + serverInfo', () => {
  const r = handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(r.result.serverInfo.name, 'tools-berry');
  assert.match(r.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.result.capabilities.tools.listChanged, false);
  assert.ok(r.result.instructions.includes('tools-berry.com'));
});

t('notifications/initialized is a notification (no reply)', () => {
  assert.equal(handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

t('tools/list advertises exactly the four tools with schemas', () => {
  const r = handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = r.result.tools.map((x) => x.name).sort();
  assert.deepEqual(names, ['compare_states', 'compute_bonus_withholding', 'compute_take_home', 'get_state_rates']);
  for (const tool of r.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(Array.isArray(tool.inputSchema.required) && tool.inputSchema.required.length);
    assert.ok(tool.description.length > 40);
  }
  assert.equal(r.result.tools.length, TOOLS.length);
});

t('unknown method / bad request produce JSON-RPC errors', () => {
  assert.equal(handleRpc({ jsonrpc: '2.0', id: 3, method: 'nope' }).error.code, -32601);
  assert.equal(handleRpc({ method: 'tools/list' }).error.code, -32600);
  assert.equal(handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ghost' } }).error.code, -32602);
});

// --- compute_take_home matches the engine ----------------------------------

t('compute_take_home matches computePaycheck to the cent', () => {
  const cases = [
    ['ohio', 80000, 'single'], ['california', 200000, 'married'], ['texas', 55000, 'single'],
    ['new-york', 120000, 'head_of_household'], ['washington', 30000, 'single'], ['massachusetts', 25000, 'single'],
    ['district-of-columbia', 90000, 'single'], ['wisconsin', 150000, 'married']
  ];
  for (const [slug, salary, fs] of cases) {
    const want = engineNet(slug, salary, fs);
    const got = call('compute_take_home', { state: slug, salary, filingStatus: fs }).result.structuredContent;
    assert.equal(got.netAnnual, want.net, `${slug} ${salary} net`);
    assert.equal(got.federalIncomeTax, want.federal, `${slug} federal`);
    assert.equal(got.stateIncomeTax, want.state, `${slug} state`);
    assert.equal(got.socialSecurity, want.socialSecurity);
    assert.equal(got.medicare, want.medicare);
    assert.equal(got.statePayrollPrograms, want.statePrograms);
    assert.equal(got.totalTax, want.totalTax);
    assert.equal(got.effectiveTaxRate, want.effectiveRate);
    assert.equal(got.netMonthly, want.net / 12);
  }
});

t('every state and DC answers, and the printed net equals the structured net', () => {
  const slugs = Object.keys(taxData.states);
  assert.equal(slugs.length, 51);
  for (const slug of slugs) {
    const res = call('compute_take_home', { state: slug, salary: 80000 }).result;
    assert.equal(res.isError, false, slug);
    assert.equal(res.structuredContent.netAnnual, engineNet(slug, 80000).net, slug);
    const printed = /Net \(annual\):\s+\$([\d,]+\.\d\d)/.exec(res.content[0].text);
    assert.ok(printed, `${slug} prints a net line`);
    // toLocaleString and toFixed can disagree by one cent on an exact half
    // (…725), so the printed line is checked to the cent, not to the bit.
    assert.ok(Math.abs(Number(printed[1].replace(/,/g, '')) - res.structuredContent.netAnnual) <= 0.006, slug);
  }
});

t('state names, abbreviations and slugs all resolve to the same answer', () => {
  const a = call('compute_take_home', { state: 'Ohio', salary: 80000 }).result.structuredContent.netAnnual;
  const b = call('compute_take_home', { state: 'OH', salary: 80000 }).result.structuredContent.netAnnual;
  const c = call('compute_take_home', { state: 'ohio', salary: '$80,000' }).result.structuredContent.netAnnual;
  const d = call('compute_take_home', { state: 'new york', salary: 80000 }).result.structuredContent.netAnnual;
  assert.equal(a, b); assert.equal(a, c);
  assert.equal(d, engineNet('new-york', 80000).net);
});

t('filingStatus defaults to single and accepts aliases', () => {
  const base = call('compute_take_home', { state: 'ohio', salary: 80000 }).result.structuredContent.netAnnual;
  assert.equal(base, engineNet('ohio', 80000, 'single').net);
  const mfj = call('compute_take_home', { state: 'ohio', salary: 80000, filingStatus: 'mfj' }).result.structuredContent.netAnnual;
  assert.equal(mfj, engineNet('ohio', 80000, 'married').net);
});

// --- compute_bonus_withholding matches the bonus engine --------------------

t('compute_bonus_withholding matches computeBonus to the cent', () => {
  const cases = [
    ['ohio', 10000, 0], ['california', 50000, 150000], ['texas', 5000, 60000],
    ['new-york', 1200000, 0], ['vermont', 20000, 90000], ['wisconsin', 15000, 80000]
  ];
  for (const [slug, bonus, salary] of cases) {
    const want = computeBonus({ bonus, regIncome: salary, filingStatus: 'single', stateSlug: slug }, taxData, suppData);
    const got = call('compute_bonus_withholding', { state: slug, bonusAmount: bonus, salary }).result.structuredContent;
    assert.equal(got.federalSupplementalWithholding, want.withheld.federal, `${slug} federal`);
    assert.equal(got.stateWithholding, want.withheld.state, `${slug} state`);
    assert.equal(got.fica, want.withheld.fica, `${slug} fica`);
    assert.equal(got.totalWithheld, want.withheld.total);
    assert.equal(got.takeHome, want.withheld.keep);
  }
});

t('the federal 22%/37% split is what the tool reports', () => {
  const small = call('compute_bonus_withholding', { state: 'texas', bonusAmount: 10000 }).result.structuredContent;
  assert.equal(small.federalSupplementalWithholding, 2200);
  const big = call('compute_bonus_withholding', { state: 'texas', bonusAmount: 1500000 }).result.structuredContent;
  assert.equal(big.federalSupplementalWithholding, 1000000 * 0.22 + 500000 * 0.37);
  assert.match(big.federalRuleApplied, /37%/);
});

// --- compare_states --------------------------------------------------------

t('compare_states ranks by net and matches the engine per row', () => {
  const r = call('compare_states', { states: ['ohio', 'texas', 'california', 'NY'], salary: 100000 }).result;
  const rows = r.structuredContent.rows;
  assert.equal(rows.length, 4);
  for (const row of rows) assert.equal(row.netAnnual, engineNet(row.stateSlug, 100000).net, row.stateSlug);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].netAnnual >= rows[i].netAnnual, 'sorted best-first');
  assert.equal(rows[0].vsBest, 0);
  assert.ok(rows[rows.length - 1].vsBest < 0);
  assert.equal(r.structuredContent.spread, rows[0].netAnnual - rows[rows.length - 1].netAnnual);
  assert.equal(r.structuredContent.best, rows[0].state);
});

t('compare_states rejects a one-state list', () => {
  const r = call('compare_states', { states: ['ohio'], salary: 100000 }).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /at least 2/);
});

// --- get_state_rates -------------------------------------------------------

t('get_state_rates reports the data file verbatim', () => {
  const oh = call('get_state_rates', { state: 'ohio' }).result.structuredContent;
  assert.equal(oh.hasIncomeTax, true);
  assert.deepEqual(oh.brackets, taxData.states.ohio.tax.brackets.single.map((b) => ({ rate: b.rate, upTo: b.upTo })));
  assert.equal(oh.supplementalWithholding.rate, suppData.states.ohio.rate);
  assert.ok(oh.source.includes('5747.02'));

  const tx = call('get_state_rates', { state: 'texas' }).result.structuredContent;
  assert.equal(tx.hasIncomeTax, false);
  assert.match(call('get_state_rates', { state: 'texas' }).result.content[0].text, /none on wages/);

  const ca = call('get_state_rates', { state: 'california' }).result.structuredContent;
  assert.ok(ca.employeePrograms.length >= 1, 'CA has an SDI program');
  assert.equal(ca.employeePrograms[0].rate, taxData.states.california.employeePrograms[0].rate);
});

// --- attribution + deep links ---------------------------------------------

t('every tool response ends with the attribution line and a link', () => {
  const responses = [
    call('compute_take_home', { state: 'ohio', salary: 80000 }),
    call('compute_bonus_withholding', { state: 'ohio', bonusAmount: 10000 }),
    call('compare_states', { states: ['ohio', 'texas'], salary: 80000 }),
    call('get_state_rates', { state: 'ohio' })
  ];
  for (const r of responses) {
    const text = r.result.content[0].text;
    assert.ok(text.includes(ATTRIBUTION), 'attribution present');
    assert.match(text, /See it on the site: https:\/\/tools-berry\.com\/\S+$/);
  }
});

t('deep links follow the live URL patterns', () => {
  // rung page when the salary is one of the nine ladder rungs in a ladder state
  assert.equal(deepLink('ohio', 80000), 'https://tools-berry.com/ohio-take-home-pay-80000/');
  // ladder-state hub when the salary is off-rung
  assert.equal(deepLink('ohio', 83500), 'https://tools-berry.com/ohio-take-home-pay/');
  assert.equal(deepLink('ohio', null), 'https://tools-berry.com/ohio-take-home-pay/');
  // non-ladder state falls back to the data study
  assert.equal(deepLink('vermont', 80000), 'https://tools-berry.com/data/take-home-pay-by-state/');
  for (const s of LADDER_SALARIES) {
    assert.equal(deepLink('california', s), `https://tools-berry.com/california-take-home-pay-${s}/`);
  }
  assert.equal(call('compute_take_home', { state: 'OH', salary: 80000 }).result.structuredContent.link,
    'https://tools-berry.com/ohio-take-home-pay-80000/');
});

// --- bad input -------------------------------------------------------------

t('bad input is a tool error with a usable message, never a crash', () => {
  const bad = [
    ['compute_take_home', { state: 'Atlantis', salary: 80000 }, /unknown state/],
    ['compute_take_home', { state: 'ohio', salary: -5 }, /negative/],
    ['compute_take_home', { state: 'ohio' }, /salary must be a number/],
    ['compute_take_home', {}, /state is required/],
    ['compute_take_home', { state: 'ohio', salary: 80000, filingStatus: 'widow' }, /filingStatus must be/],
    ['compute_bonus_withholding', { state: 'ohio', bonusAmount: 'lots' }, /must be a number/],
    ['get_state_rates', { state: '' }, /state is required/]
  ];
  for (const [tool, args, re] of bad) {
    const r = call(tool, args).result;
    assert.equal(r.isError, true, `${tool} ${JSON.stringify(args)}`);
    assert.match(r.content[0].text, re);
  }
});

console.log(`test-mcp-server: ${n} groups passed`);
