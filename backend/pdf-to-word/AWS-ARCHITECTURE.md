# PDF→Word backend — AWS architecture, security & cost-control runbook

_Last updated: 2026-06-22. Companion to `README.md` (deploy runbook), `budget-guardrails.sh` (provisioning), `restore-service.sh` (recovery). Read this before touching the pdf-to-word AWS backend or its cost guards._

## TL;DR

The server-side PDF→Word converter is a single Lambda reachable **only** through an IAM-authed Function URL, fronted by a Cloudflare gate that does all abuse control. Cost is bounded by a 10-concurrency account ceiling plus a kill-switch driven by CloudWatch rate alarms **and** two budgets (a $1 cost budget and a 95%-of-free-tier GB-second usage budget). A real bill is structurally close to impossible.

## Identity / config

| Thing | Value |
|---|---|
| AWS account | `560904638428` |
| CLI profile | `tools-berry` (NOT `default`, NOT `investigation`) |
| Region | `us-east-1` |
| Converter fn | `pdf-to-word` — 2048 MB, 60 s timeout |
| Function URL | `https://vic66rvzf3llucynt3iefqj7ky0oolgs.lambda-url.us-east-1.on.aws/` (AuthType `AWS_IAM`) |
| Invoker IAM user | `pdf-to-word-invoker` (Cloudflare gate signs as this; creds are Cloudflare secrets) |
| Kill-switch fn | `pdf-to-word-budget-killswitch` (python3.12) — zeroes reserved concurrency |
| SNS topic | `arn:aws:sns:us-east-1:560904638428:pdf-to-word-budget-alerts` → email + kill-switch |
| Cost budget | `pdf-to-word-freetier-guard` ($1/mo) |
| Usage budget | `pdf-to-word-freetier-gbsec-guard` (95% of 400k GB-sec/mo) |

## Request path (the only way AWS is reached)

```
browser → Cloudflare Pages Function functions/api/pdf-to-word.js
          ├─ Turnstile verify (bot gate)
          ├─ HMAC-signed anonymous identity cookie
          ├─ KV quotas: 100/day GLOBAL · 2/user/day · 6/IP/day (reserved BEFORE invoke)
          ├─ size ≤5 MB + %PDF- magic check
          └─ SigV4-sign (invoker creds) → IAM-authed Function URL → Lambda
```

The Cloudflare gate is the **only** thing that talks to AWS. Unsigned/public hits to the Function URL are rejected by AWS at `$0`. Secrets (`TURNSTILE_SECRET`, `ID_HMAC_SECRET`, `LAMBDA_URL`, `LAMBDA_AWS_ACCESS_KEY_ID/SECRET`) live as Cloudflare secrets — **not** committed; `wrangler.toml` holds only non-secret caps.

## What changed 2026-06-22 (security hardening)

- **Deleted** the orphaned **open HTTP API Gateway `rla8s1dk10`** (`pdf-to-word-api`). It was a v1 entry point left live after the migration to the Function URL (last traffic 2026-06-19); auth was `NONE`, AWS_PROXY straight to the Lambda — a public backdoor that bypassed Cloudflare/Turnstile and was a trivial self-DoS lever (trip the kill-switch from outside). Backup of its definition: `/tmp/rla8s1dk10-backup.json` (ephemeral; recreate from this if ever needed).
- **Removed** Lambda resource-policy statements `apigw-invoke` (for the deleted API) and `FnUrlPublic` (dormant `Principal:*` / `AuthType:NONE` — one toggle from public). Policy is now **2 statements**, both `AWS_IAM`: `FunctionURLAllowIAM` (account root) + `InvokerUserDirect` (the invoker user).

## Cost / abuse controls (defense in depth)

1. **Account concurrency ceiling = 10** (AWS new-account throttle; default would be 1000). This is the *hard* burst cap — worst-case 6-min flood before any guard ≈ **$0.12**. Quota `L-B99A9384`, `Adjustable: True`, **no increase request on file**.
   - **Reserved concurrency is currently UNSETTABLE**: the account's min-unreserved floor (10) == ceiling (10), so any positive reservation is rejected. Only `0` (the kill-switch) is allowed.
   - **TRIGGER:** when the ceiling later rises above ~20 (AWS auto-raises new accounts gradually, or you request it), **set `reserved=10`** to preserve this blast radius — and update `restore-service.sh` to restore to 10 instead of removing the cap.
2. **Kill-switch** (`pdf-to-word-budget-killswitch`): `put_function_concurrency(Reserved=0)` → stops the converter cold for any entry path. Recover with `restore-service.sh`.
3. **CloudWatch rate alarms → SNS** (fast, minutes; catch bursts/leaked-key floods the gate can't see):
   - `pdf-to-word-invocation-spike`: Invocations Sum > 150 / 5 min.
   - `pdf-to-word-gbsec-15min`: metric-math GB-sec (`Duration_sum/1000*2`) > 4000 / 15 min.
   - These are **rate tripwires with no monthly memory** — they reset every window.
4. **$1 cost budget** (`pdf-to-word-freetier-guard`) → SNS at ACTUAL > 1% (`$0.01`) and > 100% (`$1`). Effectively auto-kills **a penny into paid** usage. Slow (~hours refresh). Account-wide cost (no Lambda cost filter), but the account runs ~nothing else.
5. **95% free-tier USAGE budget** (`pdf-to-word-freetier-gbsec-guard`, added 2026-06-22) → SNS at ACTUAL > 95% of 400,000 GB-sec = **380,000 GB-sec**. Tracks gross `USE1-Lambda-GB-Second`; resets monthly. Stops the converter **before any charge at all** ($0 bill). **A 95% trip is a HARD MONTHLY STOP** — cumulative usage stays ≥95% until month rollover, so `restore-service.sh` gets re-killed at the next budget eval; to bring the path back early you must accept paid use (then the $1 budget guards) or temporarily raise/remove this budget.

All five route through the one SNS topic → email (`edydaherz@gmail.com`) + kill-switch. SNS topic policy already allows `budgets.amazonaws.com` to publish.

## Lambda free-tier facts

- Always-free (perpetual): **1,000,000 requests/mo** + **400,000 GB-seconds/mo**.
- At 2 GB memory: 400k GB-sec = **200,000 s of execution/mo**. **GB-seconds is the binding pool**, not requests.
- Realistic usage under the 100/day gate cap ≈ **7.5%** of free tier (3k req, ~30k GB-sec). Even the pathological case (every job hits the 60 s timeout) ≈ 90% — still under the 95% kill line, so 95% false-trips only under gate-bypass abuse.

## Key gotchas / mental-model corrections

- **Free tier is not a cutoff.** It stops *discounting*, not *serving* — past it you're billed. The cutoff is the kill-switch + budgets above, not "free tier ran out."
- **Rate alarms ≠ cumulative.** `invocation-spike` / `gbsec-15min` only see rolling windows; the *monthly* guard is the usage budget.
- **Reserved vs Provisioned concurrency.** Reserved = a **hard ceiling** (throttles excess) AND a reservation — this is the cost knob. Provisioned = a pre-warmed **floor** (latency, costs to idle) and does NOT cap. The account ceiling (10) currently *is* the hard cap.
- **USAGE budget tracks gross usage in unit `seconds`** (the GB-second usage type's reported unit), and depends on the billing/usage data pipeline — on a brand-new account it ingests with a lag (~24–48 h), so `ActualSpend` reads `0.0` until then even with real invocations.

## Runbook

```bash
P="--profile tools-berry --region us-east-1"
# Re-provision ALL guards (idempotent, safe to re-run):
./budget-guardrails.sh
# Recover after a kill-switch trip (re-enables converter):
./restore-service.sh
# Watch the concurrency ceiling (the reserved=10 trigger):
aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384 $P
# Confirm the usage budget is actually tracking (once data ingests):
aws budgets describe-budget --account-id 560904638428 \
  --budget-name pdf-to-word-freetier-gbsec-guard $P   # CalculatedSpend should go non-zero
# Resource policy should show exactly 2 AWS_IAM statements:
aws lambda get-policy --function-name pdf-to-word $P
```

**Never** deploy the pdf-to-word backend without explicit approval. The in-browser converter (default, client-side, no upload) is unrelated to all of the above and has no size/cost limit.
