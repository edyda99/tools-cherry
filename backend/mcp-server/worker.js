// worker.js — Streamable-HTTP transport for the Tools Berry MCP server.
// Standalone Cloudflare Worker (NOT part of the tools-cherry Pages project).
// Read-only, no auth, no storage, no bindings. See README.md.
import { handleRpc, rpcError, SERVER_INFO, INSTRUCTIONS, TOOLS, PROTOCOL_VERSION } from './mcp.js';

// Per-IP rate limit, in-isolate only (a Map that dies with the isolate). No
// Durable Object and no KV on purpose: the ceiling only has to stop a runaway
// loop, and every tool call is a few microseconds of pure arithmetic, so a
// generous per-isolate bucket is the whole requirement.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const buckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    if (buckets.size > 10_000) {           // cheap guard against unbounded growth
      for (const [k, v] of buckets) if (now - v.start >= WINDOW_MS) buckets.delete(k);
    }
    return false;
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id'
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra }
  });

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // A plain browser GET gets a human/agent-readable description rather than a 405.
    if (request.method === 'GET') {
      if (url.pathname === '/health') return json({ ok: true });
      // Smoke-test affordance, NOT part of MCP: GET ?rpc=<url-encoded JSON-RPC>
      // runs the same handler as POST. It exists because the deployed Worker has
      // to be checkable from a network that can only issue GETs (and through
      // GET-only proxies). Read-only and rate-limited exactly like POST.
      const probe = url.searchParams.get('rpc');
      if (probe) {
        const ipGet = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (rateLimited(ipGet)) return json(rpcError(null, -32000, 'Rate limited'), 429, { 'Retry-After': '60' });
        let parsed;
        try { parsed = JSON.parse(probe); } catch { return json(rpcError(null, -32700, 'Parse error in ?rpc'), 400); }
        return json(handleRpc(parsed) ?? { ok: true, note: 'notification, no response' });
      }
      return json({
        server: SERVER_INFO,
        protocolVersion: PROTOCOL_VERSION,
        transport: 'Streamable HTTP — POST JSON-RPC 2.0 to this URL',
        instructions: INSTRUCTIONS,
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        site: 'https://tools-berry.com'
      });
    }

    if (request.method !== 'POST') {
      return json(rpcError(null, -32600, 'Use POST with a JSON-RPC 2.0 body'), 405);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) {
      return json(rpcError(null, -32000, `Rate limit: max ${MAX_PER_WINDOW} requests per minute per IP`), 429, { 'Retry-After': '60' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(rpcError(null, -32700, 'Parse error: body is not valid JSON'), 400);
    }

    // Batches are legal JSON-RPC; notifications drop out of the response array.
    if (Array.isArray(body)) {
      if (body.length === 0) return json(rpcError(null, -32600, 'Empty batch'), 400);
      if (body.length > 50) return json(rpcError(null, -32600, 'Batch too large (max 50)'), 400);
      const out = body.map(handleRpc).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
    }

    const res = handleRpc(body);
    if (res === null) return new Response(null, { status: 202, headers: CORS });
    return json(res);
  }
};
