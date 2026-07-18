# PDF→Word backend — AWS architecture, security & cost-control runbook

_Last updated: 2026-07-18. The R2 mode went LIVE same day (Lambda v2 deployed, `LAMBDA_PROTO` flipped to `"r2"` in production, 25 MB cap live, E2E verified with a 6 MB PDF through the real site). See "What changed 2026-07-18" below for the flip history. Companion to `README.md` (deploy runbook), `budget-guardrails.sh` (provisioning), `restore-service.sh` (recovery). Read this before touching the pdf-to-word AWS backend or its cost guards._

## TL;DR

The server-side PDF→Word converter is a single Lambda reachable **only** through an IAM-authed Function URL, fronted by a Cloudflare gate that does all abuse control. Cost is bounded by a 10-concurrency account ceiling plus a kill-switch driven by CloudWatch rate alarms **and** two budgets (a $1 cost budget and a 95%-of-free-tier GB-second usage budget). A real bill is structurally close to impossible.

A second, R2-backed transfer mode (raising the size cap 5 MB → 25 MB) is **LIVE** as of 2026-07-18, see "R2 surface". `LAMBDA_PROTO="r2"` is now the production default; the original inline mode remains supported as the legacy protocol the Lambda still accepts (dual-protocol path stays true, gate can dispatch either way).

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
          ├─ size check + %PDF- magic (cap depends on protocol, below)
          └─ dispatch on LAMBDA_PROTO (wrangler.toml [vars], default "r2"):
             ├─ "r2" (LIVE), 25 MB cap: PDF_BUCKET.put('uploads/<uuid>.pdf')
             │   → SigV4-signed call carries only JSON {key} → Lambda downloads via
             │   boto3/S3 API → converts → uploads results/<uuid>.docx → gate
             │   PDF_BUCKET.get, streams to browser, deletes both objects
             └─ "inline" (still-supported legacy protocol), 5 MB cap: PDF bytes
                 travel inside the SigV4-signed Function URL call itself → Lambda
                 legacy path
```

Both branches share every check above the dispatch line and are one file — the gate
mode-switches on `env.PDF_BUCKET && env.LAMBDA_PROTO === 'r2'` in `functions/api/pdf-to-word.js`;
there is no separate r2 gate to keep in sync. See "R2 surface" below for what the r2 branch
touches.

The Cloudflare gate is the **only** thing that talks to AWS. Unsigned/public hits to the Function URL are rejected by AWS at `$0`. Secrets (`TURNSTILE_SECRET`, `ID_HMAC_SECRET`, `LAMBDA_URL`, `LAMBDA_AWS_ACCESS_KEY_ID/SECRET`) live as Cloudflare secrets — **not** committed; `wrangler.toml` holds only non-secret caps.

## What changed 2026-06-22 (security hardening)

- **Deleted** the orphaned **open HTTP API Gateway `rla8s1dk10`** (`pdf-to-word-api`). It was a v1 entry point left live after the migration to the Function URL (last traffic 2026-06-19); auth was `NONE`, AWS_PROXY straight to the Lambda — a public backdoor that bypassed Cloudflare/Turnstile and was a trivial self-DoS lever (trip the kill-switch from outside). Backup of its definition: `/tmp/rla8s1dk10-backup.json` (ephemeral; recreate from this if ever needed).
- **Removed** Lambda resource-policy statements `apigw-invoke` (for the deleted API) and `FnUrlPublic` (dormant `Principal:*` / `AuthType:NONE` — one toggle from public). Policy is now **2 statements**, both `AWS_IAM`: `FunctionURLAllowIAM` (account root) + `InvokerUserDirect` (the invoker user).

## R2 surface (LIVE since 2026-07-18)

The bucket, the gate's R2 binding, and the purge worker are all deployed and on the live
request path. `LAMBDA_PROTO="r2"` is production default. See "What changed 2026-07-18"
below for the flip history.

| Thing | Value |
|---|---|
| Bucket | `pdf-to-word-files` (private, no public access) |
| Key layout | UUID keys, two prefixes: `uploads/<uuid>.pdf` (gate → Lambda), `results/<uuid>.docx` (Lambda → gate) |
| Gate access | Native R2 binding `PDF_BUCKET` on the Pages Function (`wrangler.toml`) — no credentials in gate code, Cloudflare-internal |
| Lambda access | boto3 S3 client over R2's S3-compatible API — env `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` |
| R2 endpoint | `https://42e1924f6e9903245ece8f5adb11d737.r2.cloudflarestorage.com` |
| Object lifetime, happy path | Seconds — the gate deletes both the uploaded PDF and the result docx in-request (`ctx.waitUntil(delete)`) right after streaming the result to the browser |
| Object lifetime, crash path | Hourly `r2-purge` worker (`workers/r2-purge/`, own `wrangler.toml`: cron trigger + the same `PDF_BUCKET` binding) deletes anything under `uploads/` or `results/` older than 2 h |
| Final backstop | 1-day bucket lifecycle rule, in case both the in-request delete and the hourly purge miss an object |

**Why two cleanup paths:** the in-request delete clears the overwhelming majority of objects
within seconds; the hourly purge + 1-day lifecycle only matter if a request dies mid-flight
(gate or Lambda crashes after `put` but before the matching `delete`).

### Cost pools (live)

| Pool | Budget | Worst case at the 100/day gate cap | Notes |
|---|---|---|---|
| R2 storage + ops | **Perpetual** free tier: 10 GB storage, 1M Class A ops/mo, 10M Class B ops/mo, **zero egress** | 100/day × ~25 MB × 2 short-lived objects (upload + result) — **100x+ under** every one of those lines | The only Cloudflare-side pool this rework touches; not a real constraint |
| AWS data-transfer-out | Always-free **100 GB/mo** (AWS "data transfer out to internet" — R2 is external to AWS, so Lambda's PUT of the converted docx to R2 counts as AWS-side egress) | 100/day × 25 MB × 30 days ≈ **75 GB/mo** — under the 100 GB line, but with far less margin than any pool above | Now applies, live. Watch this one; it's the tightest pool the R2 rework introduced |

**R2 is the only Cloudflare product on this site that bills past quota instead of stopping**
(KV, D1, and Pages Functions all fail closed at their free-tier ceiling). Mitigations, stacked:

- Gate-only access — the bucket has no public access; only the Pages Function binding and the
  Lambda's scoped token can reach it.
- KV quotas (100/day global, 2/user/day, 6/IP/day) still gate every request **before** an R2
  object is ever written — same reservation-before-invoke pattern as today.
- Bucket-scoped R2 S3 token for Lambda (Account API token `pdf-to-word-lambda`, Object R&W),
  scoped to `pdf-to-word-files` only, never account-wide.
- Billing-notification tripwires, **two live**: `r2-usage-tripwire` (R2 Storage > 5 GiB) and
  `r2-class-a-ops-tripwire` (Class A ops > 500k). A third tripwire for Class B reads was **not**
  created; it remains an optional manual step if Class B usage ever needs its own watch.

## What changed 2026-07-18 (R2 mode flipped live)

The R2 rework (bucket, gate binding, purge worker, all provisioned dark since stage 1) went
live: Lambda v2 deployed, `LAMBDA_PROTO` flipped to `"r2"` in production, 25 MB cap live, E2E
verified with a 6 MB PDF through the real site. Also done as part of this flip: bucket
`pdf-to-word-files` created with a 1-day lifecycle rule (`backstop-expire-1d`), the
`r2-purge` worker deployed (hourly cron, live at `r2-purge.edydaherz.workers.dev`, fetch-less),
the R2 Account API token `pdf-to-word-lambda` (Object R&W, bucket-scoped) created and wired
into the Lambda env, and the two billing tripwires above saved. The flip ran as:

1. Created a bucket-scoped R2 S3 token (Cloudflare dashboard → R2 → Manage API tokens),
   scoped to `pdf-to-word-files` only — not account-wide.
2. Exported the R2 creds for the Lambda build/deploy: `R2_ENDPOINT`, `R2_BUCKET`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
3. Ran `deploy.sh` (Edmond-approved) to ship Lambda v2 with those env vars.
4. Committed the flip: `wrangler.toml` `LAMBDA_PROTO="r2"` + the template copy change
   (server-option text now says "up to 25 MB") in one commit, held back on purpose so the live
   copy never overstated the cap before the backend could honor it.
5. Pages-deployed the flip commit.
6. E2E-tested a real PDF **>5 MB** through prod, confirming the r2 branch end to end
   (upload → Lambda → result → cleanup).

## Cost / abuse controls (defense in depth)

1. **Account concurrency ceiling = 10** (AWS new-account throttle; default would be 1000). This is the *hard* burst cap — worst-case 6-min flood before any guard ≈ **$0.12**. Quota `L-B99A9384`, `Adjustable: True`, **no increase request on file**.
   - **Reserved concurrency is currently UNSETTABLE**: the account's min-unreserved floor (10) == ceiling (10), so any positive reservation is rejected. Only `0` (the kill-switch) is allowed.
   - **TRIGGER:** when the ceiling later rises above ~20 (AWS auto-raises new accounts gradually, or you request it), **set `reserved=10`** to preserve this blast radius — and update `restore-service.sh` to restore to 10 instead of removing the cap.
2. **Kill-switch** (`pdf-to-word-budget-killswitch`): `put_function_concurrency(Reserved=0)` → stops the converter cold for any entry path. Recover with `restore-service.sh`.
3. **CloudWatch rate alarms → SNS** (fast, minutes; catch bursts/leaked-key floods the gate can't see):
   - `pdf-to-word-invocation-spike`: Invocations Sum > 150 / 5 min.
   - `pdf-to-word-gbsec-15min`: metric-math GB-sec (`Duration_sum/1000*2`) > 4000 / 15 min.
   - These are **rate tripwires with no monthly memory** — they reset every window.
4. **$1 cost budget** (`pdf-to-word-freetier-guard`) → SNS at ACTUAL > 100% (`$1`). Slow (~hours refresh). Account-wide cost (no Lambda cost filter) — the account also runs the `pdf-to-word` ECR repo (container-image Lambda deploy, `deploy.sh`), which accrues a small legitimate storage cost independent of converter usage.
   - **2026-07-18:** originally had a second trip at ACTUAL > 1% (`$0.01`). That trip false-positived on ECR image storage cost alone (not converter abuse) and killed the service. Removed the 1% notification; the $1 trip is the only cost guard now. If ECR storage cost trends up on its own, consider a lifecycle policy to prune old image tags rather than re-adding a low-cost trip.
5. **95% free-tier USAGE budget** (`pdf-to-word-freetier-gbsec-guard`, added 2026-06-22) → SNS at ACTUAL > 95% of 400,000 GB-sec = **380,000 GB-sec**. Tracks gross `USE1-Lambda-GB-Second`; resets monthly. Stops the converter **before any charge at all** ($0 bill). **A 95% trip is a HARD MONTHLY STOP** — cumulative usage stays ≥95% until month rollover, so `restore-service.sh` gets re-killed at the next budget eval; to bring the path back early you must accept paid use (then the $1 budget guards) or temporarily raise/remove this budget.

All five route through the one SNS topic → email (`edydaherz@gmail.com`) + kill-switch. SNS topic policy already allows `budgets.amazonaws.com` to publish.

## Lambda free-tier facts

- Always-free (perpetual): **1,000,000 requests/mo** + **400,000 GB-seconds/mo**.
- At 2 GB memory: 400k GB-sec = **200,000 s of execution/mo**. **GB-seconds is the binding pool**, not requests.
- Realistic usage under the 100/day gate cap ≈ **7.5%** of free tier (3k req, ~30k GB-sec). Even the pathological case (every job hits the 60 s timeout) ≈ 90% — still under the 95% kill line, so 95% false-trips only under gate-bypass abuse.
- The R2 mode adds a second AWS pool to watch, live since 2026-07-18: data-transfer-out to R2, worst case ≈75 GB/mo against the always-free 100 GB/mo line. See "R2 surface → Cost pools" above.

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
