# PDF → Word

_Last updated: 2026-07-18 — added the PENDING-stage-2 R2 rework (dual-protocol server path, 25 MB cap once flipped); live behavior today is unchanged. See `AWS-ARCHITECTURE.md` for the full R2 surface + cost pools + flip runbook._

**In one paragraph:** The tool converts PDFs to `.docx` **in the browser by default** (free, unlimited, nothing uploaded — see `src/assets/pdf-to-word.js`). For higher-fidelity output there's an **optional "server conversion"** that runs `pdf2docx` on AWS Lambda. The server path is gated entirely at Cloudflare's free edge: a **Pages Function** (`functions/api/pdf-to-word.js`) verifies a Turnstile token, identifies the user with an HMAC-signed cookie (no login), enforces **2 conversions/user/day** plus a **global daily cap** that keeps total AWS usage inside the free tier, and only then **SigV4-signs** the request and forwards it to an **IAM-authed Lambda Function URL**. Because the URL requires AWS signature auth, an unsigned or forged hit — even a DDoS — is rejected by AWS **before any Lambda runs, at $0**. When the global cap is hit, the edge returns "daily limit reached" and never invokes Lambda. CloudWatch alarms + an AWS Budget kill-switch are backstops.

**PENDING (stage 2):** a second transfer mode moves the PDF through an R2 bucket instead of
inline bytes, raising the size cap 5 MB → 25 MB. It's built and will ship dark in stage 1
(bucket + binding + purge worker deployed, but the gate stays defaulted to inline mode, zero
behavior change) and only goes live after an Edmond-gated Lambda v2 deploy + a separate flip
commit. Until that flip, ignore any mention of R2/25 MB below as describing the *future* path,
not today's.

## Request path
```
Browser ──POST /api/pdf-to-word (same origin)──► Cloudflare Pages Function   [FREE edge]
   (Turnstile token + identity cookie + PDF)        1. verify Turnstile
                                                     2. HMAC identity cookie (anonymous)
                                                     3. KV quotas: global/day cap, uid<2/day, ip<6/day
                                                     4. dispatch on LAMBDA_PROTO (default "inline"):
                                                        inline (LIVE, 5 MB cap) — SigV4-sign,
                                                          PDF bytes in the call ──► Lambda Function
                                                          URL (AWS_IAM) ──► Lambda (pdf2docx)
                                                        r2 (PENDING stage 2, 25 MB cap) — PDF_BUCKET
                                                          .put(uploads/<uuid>.pdf), SigV4-signed call
                                                          carries only {key} ──► Lambda downloads via
                                                          boto3/S3 API, converts, uploads
                                                          results/<uuid>.docx ──► gate PDF_BUCKET.get,
                                                          deletes both objects
   ◄──────────────── .docx ──────────────────────   5. bump counters, return .docx
Unsigned/forged hit to the Function URL ──► AWS rejects (403) before any Lambda runs → $0
Backstops: CloudWatch alarms (spike 150/5min, GB-s 4000/15min → minutes) and AWS Budget $1 → kill-switch (concurrency 0)
```
The Function URL is **not** in any client code — it lives only in the Cloudflare secret `LAMBDA_URL`. Only the scoped IAM user `pdf-to-word-invoker` (whose key the gate holds) can invoke it.

## Components
- **Engine:** `pdf2docx` (PyMuPDF + python-docx), arm64 Lambda **container**, 2048 MB, 60 s, 1 GB ephemeral.
- **Front door:** an **IAM-authed Lambda Function URL** (anonymous Function URLs are blocked on this account; `AWS_IAM` ones are allowed — verified). No API Gateway → no per-request charge.
- **Edge gate:** `functions/api/pdf-to-word.js` + `functions/api/_sigv4.js` (SigV4 signer) + `RATE_KV` KV namespace + Turnstile.
- **Auth to Lambda:** scoped IAM user `pdf-to-word-invoker` with `lambda:InvokeFunctionUrl` on this one function; its access key lives only as Cloudflare secrets.
- **Cost guards:** edge global cap (proactive) + CloudWatch alarms (spike + GB-s, ~minutes) → kill-switch (concurrency 0) + AWS Budget $1 (slow backstop). Reserved concurrency 2 is *requested* but this account forbids reservations — see Known limitations.
- **R2 surface (PENDING stage 2, dark in stage 1):** bucket `pdf-to-word-files`, native binding
  `PDF_BUCKET` on the gate, boto3-over-S3-API from Lambda, hourly `r2-purge` worker
  (`workers/r2-purge/`) + 1-day bucket lifecycle as crash backstops. Full detail (endpoint, env
  vars, cost pools) in `AWS-ARCHITECTURE.md`.

## Deploy runbook
The Lambda currently sits **disabled** (reserved concurrency 0). `deploy.sh` re-enables it (attempts reserved concurrency 2 — skipped with a loud warning if the account forbids reservations), creates the Function URL + invoker user, and prints the URL and a one-time access key. Do AWS first, then Cloudflare, then build + deploy.

### 1. AWS — rebuild + Function URL + invoker user (needs podman + `tools-berry` profile)
```bash
cd backend/pdf-to-word
./deploy.sh
```
It prints (a) the **Function URL** and (b) the invoker user's **AccessKeyId / SecretAccessKey** (shown once). Save both. Then refresh the cost guards (kill-switch + CloudWatch alarms):
```bash
./budget-guardrails.sh
```

### 2. Cloudflare — provision the gate
1. **Turnstile** (dashboard → Turnstile → add widget, domain `tools-berry.com`): note the **sitekey** + **secret**.
2. **KV namespace**, then paste the printed `id` into `wrangler.toml` (`[[kv_namespaces]] id = "…"`):
   ```bash
   npx wrangler kv namespace create ptw_rate
   ```
3. **Pages secrets** (project `tools-cherry`):
   ```bash
   printf '%s' "<turnstile-secret>"            | npx wrangler pages secret put TURNSTILE_SECRET             --project-name tools-cherry
   printf '%s' "$(openssl rand -hex 32)"       | npx wrangler pages secret put ID_HMAC_SECRET               --project-name tools-cherry
   printf '%s' "<Function URL from step 1>"    | npx wrangler pages secret put LAMBDA_URL                   --project-name tools-cherry
   printf '%s' "<AccessKeyId from step 1>"     | npx wrangler pages secret put LAMBDA_AWS_ACCESS_KEY_ID     --project-name tools-cherry
   printf '%s' "<SecretAccessKey from step 1>" | npx wrangler pages secret put LAMBDA_AWS_SECRET_ACCESS_KEY --project-name tools-cherry
   ```

### 3. Build (with the real sitekey) + deploy
```bash
TURNSTILE_SITEKEY="<turnstile-sitekey>" npm run build
npx wrangler pages deploy dist --project-name tools-cherry
```

### 4. Verify
- **Client path:** convert a text PDF — works with **no** network request (DevTools → Network).
- **Server path:** "Convert on server" → solve Turnstile → `.docx` downloads. 3rd attempt same browser/day → "2 free server conversions" 429. Set `GLOBAL_DAILY_CAP=1` to confirm the global toggle-off returns "daily limit reached" with **no** Lambda invocation in CloudWatch.
- **Origin is fail-closed:** an **unsigned** `curl -i -X POST <Function URL> --data-binary @some.pdf` → **403 Forbidden** (rejected by AWS, no Lambda). That's the DDoS-proof property.
- **Kill-switch works (test it once):** `aws sns publish --profile tools-berry --region us-east-1 --topic-arn <pdf-to-word-budget-alerts ARN> --message test` → confirm reserved concurrency went to 0 (`aws lambda get-function-concurrency --function-name pdf-to-word --profile tools-berry --region us-east-1`), then `./restore-service.sh`. An untested kill-switch is a hope, not a control.
- **Confirm the SNS email** AWS sent to edydaherz@gmail.com — until you click it the human alert is inert (the Lambda kill path still fires).

### 5. Stage 2 (PENDING, Edmond-gated) — flip to R2 mode
**Do NOT start without Edmond's explicit approval.** Stage 1 (steps 1-4 above, plus the R2
bucket, gate binding, and purge worker) ships dark with zero behavior change. This step is
what actually turns the R2 path on. Full detail in `AWS-ARCHITECTURE.md` → "Stage-2 flip
runbook"; short version:
1. Create a bucket-scoped R2 S3 token (dashboard → R2 → Manage API tokens), scoped to
   `pdf-to-word-files` only.
2. Export `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.
3. Run `./deploy.sh` (Edmond-gated) to ship Lambda v2 with those env vars.
4. Commit the flip: `wrangler.toml` `LAMBDA_PROTO="r2"` + the template copy update
   ("up to 25 MB"), held as one commit until this point.
5. Pages deploy the flip commit.
6. E2E test with a real PDF **>5 MB** through prod.
7. Update `AWS-ARCHITECTURE.md`'s PENDING markers to live.

## Tunables (`wrangler.toml [vars]`)
`GLOBAL_DAILY_CAP=100` (worst case 100 × 2 GB × 60 s × 30 = 360k GB-s/mo, under the 400k free line, with margin for KV-race overshoot. Raise only after measuring real p99 duration in CloudWatch), `UID_DAILY_LIMIT=2`, `IP_DAILY_LIMIT=6`, `LAMBDA_PROTO=inline` (**PENDING flip to `r2`** — see step 5 above; `inline` = today's 5 MB in-request transfer, `r2` = R2-relayed 25 MB transfer once stage 2 ships).

## Cost guardrails (backstops)
`budget-guardrails.sh` creates: an SNS topic + email sub; the **kill-switch Lambda** (sets converter reserved concurrency to 0); **CloudWatch alarms** → SNS (a *spike* alarm: >150 invocations/5 min; a *GB-seconds* alarm: >4000 GB-s/15 min — both trip in minutes); and an AWS **Budget** $1 with ACTUAL notifications at >1% ($0.01) and >100%. The budget is the *slow* backstop (it lags spend by up to ~8–24 h); the CloudWatch alarms are the fast ones. **Confirm the SNS email** (AWS sends a link) so alerts reach you. Restore after a trip with `./restore-service.sh`.

## Known limitations (honest)
- **Reserved concurrency can't be set on this account.** New AWS accounts cap total concurrency (~10) and forbid reservations, so the converter runs at up to the account limit. The global cap bounds the *normal* path; a *leaked invoker key* (which bypasses the gate) is bounded only by that ~10 concurrency + the CloudWatch GB-s alarm (~15 min) + budget. To tighten, request a concurrency-limit increase from AWS Support, then re-run `deploy.sh` to reserve 2.
- **The global cap is advisory, not atomic.** KV counters are read-modify-write; a concurrent burst can overshoot by the in-flight count (~10). The cap (100) has enough margin to stay under 400k even then. For a hard ceiling, move the *global* counter to a Durable Object (free, strongly consistent).
- **One determined user can exhaust the daily global cap** (Turnstile is solvable by CAPTCHA farms), denying the *server* path to others that day. Cost stays bounded — it's a feature-availability limit, not a cost hole. The client path is always available.
- **SigV4 is hand-rolled** (`_sigv4.js`, validated against an independent impl). For less code to own, swap to the vetted `aws4fetch` (vendor the single UMD file).

> Only non-$0 item: ECR image storage (~$0.10/mo after the 12-month ECR free tier for a ~1 GB image). Slim the image to approach $0. Note: on a post-July-2025 AWS account the "free tier" is a 6-month credit pool — Lambda's always-free 400k GB-s still applies, but confirm your plan in Billing → Free Tier.

## API (origin, private)
The Lambda Function URL requires **AWS SigV4** (`AWS_IAM`). It accepts `POST` raw PDF bytes (`Content-Type: application/pdf`) and returns the `.docx` binary, or JSON `{"error": "..."}`. Reachable only from the Cloudflare Pages Function, which signs with the `pdf-to-word-invoker` key.
