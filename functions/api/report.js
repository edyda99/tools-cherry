// Cloudflare Pages Function — POST /api/report.
//
// The "Report a wrong result" link (src/assets/report-widget.js) POSTs a JSON
// bug report here (same origin). Sibling to functions/api/feedback.js and built
// to the same rigor, but deliberately SELF-CONTAINED (no shared imports) so the
// two endpoints can never break each other. It runs entirely on Cloudflare's
// free edge, makes NO external fetches, and stores a single row per report in
// the FEEDBACK_DB D1 `report` table.
//
// Privacy by design: we store the tool slug, the visitor's comment, the result
// text + input values shown when they reported (so a bug is reproducible), and
// the request's country — never the IP and never an account. Abuse is throttled
// with a per-IP-HASH daily counter in KV (the raw IP is hashed with a static
// salt and only the first 16 hex chars are kept, so nothing reversible to an IP
// is ever written).
//
// Bindings (wrangler.toml):
//   FEEDBACK_DB (D1)  — table `report` (id, ts, tool, comment, result, inputs_json, country)
//   RATE_KV     (KV)  — shared per-day counters (also used by feedback + pdf-to-word)
//
// Contract: 204 on success (no body — nothing is echoed back), 400 on bad input
// (bad JSON, non-object, bad tool, or empty comment), 403 on a foreign/absent
// Origin, 405 on a non-POST method, 413 on an oversized body, 429 when the
// per-IP daily cap is hit, 503 if D1 is unbound or the insert fails.

// Public, non-secret per-IP abuse-throttle salt — same category as feedback.js's
// (server-side only, never shipped to the browser, nothing to `secret put`). A
// FRESH value, distinct from the feedback salt, so the two counters never collide.
const IP_HASH_SALT = 'tb-report-widget:v1:a1f93c';
const MAX_BODY_BYTES = 8192;   // ~8 KB request-body ceiling (carries comment+result+inputs).
const MAX_COMMENT = 1000;      // hard-truncate the comment (never reject for length).
const MAX_RESULT = 800;        // hard-truncate the auto-captured result text.
const MAX_INPUTS = 60;         // keep at most the first N input fields.
const MAX_INPUT_KEY = 60;      // per-field key length ceiling.
const MAX_INPUT_VAL = 200;     // per-field value length ceiling.
const MAX_INPUTS_JSON = 4000;  // byte ceiling for the re-serialized inputs object.
const IP_DAILY_LIMIT = 5;      // reports per IP-hash per day (stricter — a report is deliberate).
const KV_TTL = 86400;          // 24h.

const ALLOWED_ORIGIN = 'https://tools-berry.com';
const ALLOWED_PAGES_SUFFIX = '.tools-cherry.pages.dev'; // preview/prod Pages hosts.

// C0 control chars + DEL. Stripped from every stored string (incl. newlines/tabs)
// so a report is clean single-line text — no log/CSV injection, no stray bytes.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const INPUT_KEY_RE = /^[A-Za-z0-9_-]{1,60}$/;

const json = (status, error, extraHeaders) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', ...(extraHeaders || {}) },
  });

const noContent = (extraHeaders) =>
  new Response(null, { status: 204, headers: { ...(extraHeaders || {}) } });

// Single entry point so the method dispatch (and the explicit 405) is our own,
// testable code rather than the framework's implicit fallback.
export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return noContent(); // defensive preflight; same-origin needs no CORS.
  if (request.method !== 'POST') return json(405, 'Method not allowed.', { Allow: 'POST' });
  return handlePost(context);
}

async function handlePost(context) {
  const { request, env } = context;

  // 1. Same-origin only. A same-origin fetch POST still sends Origin, so an
  //    absent or foreign Origin is a cross-site / scripted call → reject.
  if (!originOk(request.headers.get('Origin'))) return json(403, 'Forbidden.');

  if (!env.FEEDBACK_DB) return json(503, 'Reporting is not available right now.');

  // 2. Read the body with a hard size ceiling BEFORE parsing (cheap DoS guard).
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) return json(413, 'Request too large.');
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(buf));
  } catch (_) {
    return json(400, 'Invalid request.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json(400, 'Invalid request.');

  // 3. Validate. tool: [a-z0-9-]{2,60}.
  const tool = data.tool;
  if (typeof tool !== 'string' || !/^[a-z0-9-]{2,60}$/.test(tool)) return json(400, 'Invalid request.');

  // comment: REQUIRED. Strip control chars, trim; reject only if empty. Truncate
  // (never reject) for length.
  let comment = '';
  if (typeof data.comment === 'string') {
    comment = data.comment.replace(CONTROL_CHARS, '').trim();
  }
  if (!comment) return json(400, 'A comment is required.');
  comment = comment.slice(0, MAX_COMMENT);

  // result: optional, auto-captured. Never reject the whole request over it —
  // coerce a non-string to '' and clean/truncate a string.
  let result = '';
  if (typeof data.result === 'string') {
    result = data.result.replace(CONTROL_CHARS, '').trim().slice(0, MAX_RESULT);
  }

  // inputs: sanitize into a null-prototype accumulator — a deliberate
  // prototype-pollution guard, so a key literally named "__proto__" in the
  // parsed JSON becomes an inert own property instead of walking the chain.
  const inputsJson = sanitizeInputs(data.inputs);

  // 4. Per-IP-hash daily throttle in KV (no raw IP stored). Skips only if the KV
  //    binding is absent (local dev) — never a reason to reject a valid report.
  if (env.RATE_KV) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const key = 'rpt:' + (await sha256hex(ip + '|' + IP_HASH_SALT)).slice(0, 16);
    const used = await count(env.RATE_KV, key);
    if (used >= IP_DAILY_LIMIT) return json(429, "You've reached today's report limit. Thanks for your patience.");
    // Reserve the slot before writing to D1 so the cap holds even if the insert
    // is slow or fails (fails toward throttling, matching the house style).
    await env.RATE_KV.put(key, String(used + 1), { expirationTtl: KV_TTL });
  }

  // 5. Store one row. Country from Cloudflare's geo, '' when unknown/local.
  const ts = new Date().toISOString();
  const country = (request.cf && request.cf.country) || '';
  try {
    await env.FEEDBACK_DB
      .prepare('INSERT INTO report (ts, tool, comment, result, inputs_json, country) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(ts, tool, comment, result, inputsJson, country)
      .run();
  } catch (_) {
    return json(503, 'Could not save your report right now.');
  }

  // 6. Success — no body, so nothing the visitor sent is reflected back.
  return noContent();
}

// --- helpers -----------------------------------------------------------------

// Sanitize the raw `inputs` object into a JSON string safe to store. Non-object
// (or array) → '{}'. Keeps at most the first MAX_INPUTS keys; drops any key that
// fails the name regex or whose value isn't a string / finite number / boolean;
// cleans + truncates each value. Then re-serializes, dropping trailing keys (in
// insertion order) until the byte length fits MAX_INPUTS_JSON.
function sanitizeInputs(raw) {
  const acc = Object.create(null); // prototype-pollution guard (see call site).
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const keys = Object.keys(raw).slice(0, MAX_INPUTS);
    for (const k of keys) {
      if (!INPUT_KEY_RE.test(k)) continue;
      const v = raw[k];
      let s;
      if (typeof v === 'string') s = v;
      else if (typeof v === 'number') { if (!Number.isFinite(v)) continue; s = String(v); }
      else if (typeof v === 'boolean') s = String(v);
      else continue;
      acc[k] = s.replace(CONTROL_CHARS, '').slice(0, MAX_INPUT_VAL);
    }
  }
  let out = JSON.stringify(acc);
  if (byteLen(out) > MAX_INPUTS_JSON) {
    const order = Object.keys(acc);
    while (order.length && byteLen(out) > MAX_INPUTS_JSON) {
      delete acc[order.pop()];
      out = JSON.stringify(acc);
    }
  }
  return out;
}

function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

function originOk(origin) {
  if (!origin) return false;
  if (origin === ALLOWED_ORIGIN) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && u.hostname.endsWith(ALLOWED_PAGES_SUFFIX);
  } catch (_) {
    return false;
  }
}

async function sha256hex(msg) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function count(kv, k) {
  const v = await kv.get(k);
  return v ? parseInt(v, 10) || 0 : 0;
}
