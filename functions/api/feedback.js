// Cloudflare Pages Function — POST /api/feedback.
//
// The tiny rating widget (src/assets/feedback-widget.js) POSTs a JSON rating here
// (same origin). This is the site's first user-data endpoint (approved by Edmond
// 2026-07-17). It runs entirely on Cloudflare's free edge, makes NO external
// fetches, and stores a single row per rating in the FEEDBACK_DB D1 table.
//
// Privacy by design: we store the tool slug, the 1-5 rating, an optional short
// comment, and the request's country — never the IP and never an account. Abuse
// is throttled with a per-IP-HASH daily counter in KV (the raw IP is hashed with
// a static salt and only the first 16 hex chars are kept, so nothing reversible
// to an IP is ever written).
//
// Bindings (wrangler.toml):
//   FEEDBACK_DB (D1)  — table `feedback` (id, ts, tool, rating, comment, country)
//   RATE_KV     (KV)  — shared per-day counters (also used by pdf-to-word)
//
// Contract: 204 on success (no body — the comment is never echoed back), 400 on
// bad input, 403 on a foreign/absent Origin, 405 on a non-POST method, 413 on an
// oversized body, 429 when the per-IP daily cap is hit, 503 if D1 is unbound.

const IP_HASH_SALT = 'tb-feedback-widget:v1:0b7d2f'; // static salt; server-side only, never shipped to the browser.
const MAX_BODY_BYTES = 2048;   // ~2 KB request-body ceiling.
const MAX_COMMENT = 500;       // hard-truncate, never reject, on the comment.
const IP_DAILY_LIMIT = 10;     // ratings per IP-hash per day.
const KV_TTL = 86400;          // 24h.

const ALLOWED_ORIGIN = 'https://tools-berry.com';
const ALLOWED_PAGES_SUFFIX = '.tools-cherry.pages.dev'; // preview/prod Pages hosts.

// C0 control chars + DEL. Stripped from comments (incl. newlines/tabs) so a
// rating is a single clean line — no log/CSV injection, no stray bytes in D1.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

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

  if (!env.FEEDBACK_DB) return json(503, 'Feedback is not available right now.');

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

  // 3. Validate. tool: [a-z0-9-]{2,60}; rating: integer 1-5.
  const tool = data.tool;
  if (typeof tool !== 'string' || !/^[a-z0-9-]{2,60}$/.test(tool)) return json(400, 'Invalid request.');
  const rating = data.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json(400, 'Invalid request.');
  }

  // comment: optional. Strip control chars, trim, hard-truncate (never reject).
  let comment = '';
  if (typeof data.comment === 'string') {
    comment = data.comment.replace(CONTROL_CHARS, '').trim().slice(0, MAX_COMMENT);
  }

  // 4. Per-IP-hash daily throttle in KV (no raw IP stored). Skips only if the KV
  //    binding is absent (local dev) — never a reason to reject a valid rating.
  if (env.RATE_KV) {
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const key = 'fb:' + (await sha256hex(ip + '|' + IP_HASH_SALT)).slice(0, 16);
    const used = await count(env.RATE_KV, key);
    if (used >= IP_DAILY_LIMIT) return json(429, 'Daily feedback limit reached. Thanks for the feedback!');
    // Reserve the slot before writing to D1 so the cap holds even if the insert
    // is slow or fails (fails toward throttling, matching the house style).
    await env.RATE_KV.put(key, String(used + 1), { expirationTtl: KV_TTL });
  }

  // 5. Store one row. Country from Cloudflare's geo, '' when unknown/local.
  const ts = new Date().toISOString();
  const country = (request.cf && request.cf.country) || '';
  try {
    await env.FEEDBACK_DB
      .prepare('INSERT INTO feedback (ts, tool, rating, comment, country) VALUES (?, ?, ?, ?, ?)')
      .bind(ts, tool, rating, comment, country)
      .run();
  } catch (_) {
    return json(503, 'Could not save feedback right now.');
  }

  // 6. Success — no body, so the comment is never reflected back.
  return noContent();
}

// --- helpers -----------------------------------------------------------------

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
