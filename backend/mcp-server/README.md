# Tools Berry MCP server

A remote [MCP](https://modelcontextprotocol.io) server that exposes the site's own 2026
US payroll-tax engine to AI clients. Standalone Cloudflare Worker — **not** part of the
`tools-cherry` Pages project, and it changes no page on the site.

Endpoint: `https://mcp.tools-berry.com` (POST JSON-RPC 2.0, Streamable HTTP); alias
`https://tools-berry-mcp.<account>.workers.dev`. A `GET` on the same URL returns a plain-JSON
description of the server; `GET /health` returns `{ok:true}`; `GET /?rpc=<url-encoded JSON-RPC>`
executes one read-only request (smoke probe for networks that block POST or `*.workers.dev`).
Public mirror of this directory (engine + data included): https://github.com/edyda99/tools-berry-mcp
— listed in the MCP registry as `com.tools-berry/paycheck`.

## Why it exists

The engine already answers "what is my take-home pay in Ohio" better than a language model can
guess it. This lets a model call the real engine instead of guessing, and every answer carries an
attribution line plus a deep link back to the matching page.

## Tools

| Tool | Answers |
|---|---|
| `compute_take_home` | full paycheck breakdown for a salary in one state |
| `compute_bonus_withholding` | federal 22%/37% supplemental + the state's bonus treatment |
| `compare_states` | net pay on the same salary across several states, ranked |
| `get_state_rates` | one state's 2026 schedule, programs, and statutory source |

## Design

- **No forked math.** `tools.js` imports `src/engine/paycheck-engine.js`, `src/engine/bonus-tax.js`,
  `src/data/tax-data-2026.json` and `src/data/state-supplemental-2026.json` directly. If an answer
  here ever disagrees with a page, that is a bug, and `scripts/test-mcp-server.js` asserts equality
  against the engine to the cent for all 51 jurisdictions.
- **No dependencies.** The protocol surface needed here is `initialize`, `tools/list`, `tools/call`
  (+ `ping` and the empty `resources/list`/`prompts/list` probes), so it is implemented in `mcp.js`
  by hand rather than pulling `@modelcontextprotocol/sdk` into a Worker.
- **Stateless and read-only.** No auth, no session, no bindings, no storage, no writes.
- **Rate limit:** 120 requests/minute/IP, counted in-isolate. Deliberately crude: every call is a
  few microseconds of arithmetic, so the ceiling only has to stop a runaway loop.

## Deploy

```sh
cd backend/mcp-server && npx wrangler deploy
```

Uses the stored wrangler OAuth login. **Never set `CLOUDFLARE_API_TOKEN`** — the account token is
Analytics-only and fails deploys with auth 10000.

## Keep in sync

`tools.js` mirrors two lists from `build.js` so the deep links point at pages that exist:
`LADDER_STATES` (25 states with a `/<slug>-take-home-pay/` hub) and `LADDER_SALARIES`
(the 9 rungs). If `build.js` gains a ladder state or rung, update `tools.js` too.
