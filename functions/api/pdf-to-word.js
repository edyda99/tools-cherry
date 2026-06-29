// Cloudflare Pages Function — the abuse gate in front of the PDF->Word Lambda.
//
// The browser POSTs a PDF here (same origin: /api/pdf-to-word). This runs on
// Cloudflare's free edge and is the ONLY thing that ever talks to AWS. It:
//   1. verifies a Cloudflare Turnstile token            (blocks bots/scripts)
//   2. resolves an HMAC-signed anonymous identity cookie (per-user identity, no login)
//   3. enforces daily quotas in KV:
//        - a GLOBAL cap that keeps total AWS usage inside the free tier,
//          and when reached, toggles the server path OFF for the day;
//        - 2 / user / day and a small per-IP cap (fairness + NAT headroom).
//   4. forwards the PDF to the hidden Lambda with a shared secret, returns the .docx.
//
// Enforcement is entirely server-side; the page is never trusted for the limits.
// Bindings/secrets (set in wrangler.toml [vars] + `wrangler pages secret put`):
//   RATE_KV (KV)  TURNSTILE_SECRET  ID_HMAC_SECRET  LAMBDA_URL
//   LAMBDA_AWS_ACCESS_KEY_ID  LAMBDA_AWS_SECRET_ACCESS_KEY  [LAMBDA_AWS_REGION]
//   GLOBAL_DAILY_CAP  UID_DAILY_LIMIT  IP_DAILY_LIMIT
import { signedFetch } from './_sigv4.js';

const MAX_BYTES = 5 * 1024 * 1024; // Lambda Function URL payload ceiling (~6 MB); leave headroom.

const json = (status, error, extraHeaders) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', ...(extraHeaders || {}) },
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RATE_KV || !env.ID_HMAC_SECRET || !env.LAMBDA_URL ||
      !env.LAMBDA_AWS_ACCESS_KEY_ID || !env.LAMBDA_AWS_SECRET_ACCESS_KEY) {
    return json(503, 'The server converter is not configured. Please use the in-browser converter.');
  }

  const GLOBAL_CAP = int(env.GLOBAL_DAILY_CAP, 150);
  const UID_LIMIT = int(env.UID_DAILY_LIMIT, 2);
  const IP_LIMIT = int(env.IP_DAILY_LIMIT, 6);
  const kv = env.RATE_KV;
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // 1. Turnstile (skipped only if no secret configured, e.g. local dev).
  if (env.TURNSTILE_SECRET) {
    const token = request.headers.get('cf-turnstile-token') || '';
    if (!(await verifyTurnstile(env.TURNSTILE_SECRET, token, ip))) {
      return json(403, 'Verification failed. Please complete the check and try again.');
    }
  }

  // 2. Anonymous identity: HMAC-signed cookie, re-issued if missing/forged.
  const key = await hmacKey(env.ID_HMAC_SECRET);
  const uid = await resolveUid(request, key);
  const ipHash = (await signB64(key, 'ip:' + ip)).slice(0, 20);
  const cookie = `ptw_id=${encodeURIComponent(uid + '.' + (await signB64(key, uid)))}` +
    '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=15552000';
  const setCookie = { 'Set-Cookie': cookie };

  // 3. Daily quota keys (reset at UTC midnight via KV TTL).
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ttl = secondsToUtcMidnight(now);
  const gKey = `g:${day}`, uKey = `u:${uid}:${day}`, iKey = `i:${ipHash}:${day}`;

  const [g, u, ipc] = await Promise.all([count(kv, gKey), count(kv, uKey), count(kv, iKey)]);
  if (g >= GLOBAL_CAP) {
    return json(429, 'Our free daily limit for high-quality server conversions has been reached. The in-browser converter is always free — or try the server again tomorrow.', setCookie);
  }
  if (u >= UID_LIMIT) {
    return json(429, `You've used your ${UID_LIMIT} free server conversions for today. The in-browser converter is always free and unlimited.`, setCookie);
  }
  if (ipc >= IP_LIMIT) {
    return json(429, "This network has reached today's free server-conversion limit. The in-browser converter is always free and unlimited.", setCookie);
  }

  // 4. Validate the upload before spending an AWS invocation.
  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return json(400, 'No PDF received.', setCookie);
  if (buf.byteLength > MAX_BYTES) {
    return json(413, 'That PDF is larger than the 5 MB server limit. The in-browser converter has no upload limit — try that instead.', setCookie);
  }
  const h = new Uint8Array(buf.slice(0, 5));
  if (!(h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d)) {
    return json(415, 'That file is not a PDF.', setCookie);
  }

  // Reserve ALL THREE counters up front: reaching Lambda consumes a slot for this
  // user, this IP, and the global budget regardless of whether the conversion
  // itself succeeds. This stops an attacker from draining the global budget (and
  // real Lambda GB-seconds) with valid-header-but-unconvertible PDFs while never
  // charging their own 2/day. Failures fail toward not-paying.
  await Promise.all([bump(kv, gKey, ttl), bump(kv, uKey, ttl), bump(kv, iKey, ttl)]);

  // 5. Forward to the hidden Lambda, SigV4-signed for its IAM-authed Function URL.
  //    Only signed requests from our scoped IAM user reach Lambda; unsigned/forged
  //    hits to that URL are rejected by AWS before invocation, at $0.
  let resp;
  try {
    resp = await signedFetch(env.LAMBDA_URL, buf, env);
  } catch (_) {
    return json(502, 'The server converter is unavailable right now. Please use the in-browser converter.', setCookie);
  }
  if (!resp.ok) {
    // Surface the Lambda's own message (page-count limit, too-large-after-recompress,
    // not-a-PDF, etc.) rather than a generic guess; fall back if it isn't JSON.
    let msg = 'The server converter could not handle that file. Try the in-browser converter.';
    try { const j = await resp.json(); if (j && j.error) msg = j.error; } catch (_) {}
    return json(resp.status === 413 ? 413 : 502, msg, setCookie);
  }

  // 6. Success — return the .docx (all quotas already charged above).
  const docx = await resp.arrayBuffer();
  return new Response(docx, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': 'attachment; filename="converted.docx"',
      ...setCookie,
    },
  });
}

// Same-origin requests don't need CORS, but answer preflights defensively.
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

// --- helpers -----------------------------------------------------------------

function int(v, d) {
  const n = parseInt(v, 10);
  // Require >= 1: a misconfigured "0" must fall back to the default, not silently
  // 429 every request (which would disable the server path with no signal).
  return Number.isFinite(n) && n >= 1 ? n : d;
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const j = await r.json();
    return !!(j && j.success);
  } catch (_) {
    return false;
  }
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signB64(key, msg) {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  let s = '';
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function resolveUid(request, key) {
  const cookies = request.headers.get('Cookie') || '';
  const m = cookies.match(/(?:^|; )ptw_id=([^;]+)/);
  if (m) {
    const raw = decodeURIComponent(m[1]);
    const dot = raw.lastIndexOf('.');
    if (dot > 0) {
      const uid = raw.slice(0, dot);
      const sig = raw.slice(dot + 1);
      if (timingSafeEqual(sig, await signB64(key, uid))) return uid;
    }
  }
  return crypto.randomUUID();
}

function secondsToUtcMidnight(now) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  return Math.max(60, Math.floor((next - now.getTime()) / 1000) + 30);
}

async function count(kv, k) {
  const v = await kv.get(k);
  return v ? parseInt(v, 10) || 0 : 0;
}

async function bump(kv, k, ttl) {
  const n = (await count(kv, k)) + 1;
  await kv.put(k, String(n), { expirationTtl: ttl });
  return n;
}
