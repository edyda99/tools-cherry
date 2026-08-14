# Tools Berry — project instructions

Ad-monetized, 100% client-side static utility site (tools-berry.com) on Cloudflare Pages.
This repo (`utility-portfolio`) is **main = prod** (GitHub remote `edyda99/tools-cherry`) and is
the single working repo: build each feature on its own branch off `main`, merge to `main`, then
deploy. The old `~/Documents/utility-portfolio-clone` staging copy is **retired** (final sync
2026-06-29) — do not use it. Durable strategic state and the daily advisor loop live in the
memory dir (`MEMORY.md` index loads each session).

## Reference Files (on-demand — read when the work matches)

- [backend/pdf-to-word/AWS-ARCHITECTURE.md](backend/pdf-to-word/AWS-ARCHITECTURE.md) — AWS security
  & cost-control runbook for the PDF→Word Lambda backend. **Read before touching anything AWS:**
  the Lambda / Function URL / IAM auth, the Cloudflare abuse gate, the kill-switch, the
  concurrency ceiling, or the cost/usage budgets. Has the account ID, profile (`tools-berry`),
  resource names, free-tier math, the `reserved=10` trigger, and the recovery runbook.

## Hard rules

- **Never deploy the pdf-to-word backend** without explicit approval from Edmond. The in-browser
  converter is the default and is unrelated to the backend.
- Client-side only: no new backend / external server fetch / scaled-thin content for tools
  (pdf-to-word's optional server path, the /api/feedback rating widget, and the /api/report
  "Report a wrong result" link (both D1, both approved by Edmond, 2026-07-17/18) are the only
  exceptions).
- **Workflow:** one branch per feature off `main` → merge to `main` → deploy. No more clone.
- **Deploy is pre-authorized — no need to ask Edmond.** From `main`: `npm run build`, then
  `npx wrangler pages deploy dist --project-name=tools-cherry --branch=main` using the stored wrangler
  OAuth login. **Keep `--branch=main`:** without it wrangler infers the Pages branch from the current
  git branch and silently ships a Preview deployment when run from any non-`main` worktree.
  **NEVER set `CLOUDFLARE_API_TOKEN` for a deploy** — the Cloudflare token is **Analytics-only** and
  fails Pages deploy with auth 10000. It lives in `.env` as `CLOUDFLARE_ANALYTICS_API_TOKEN` (renamed
  so wrangler, which auto-loads `.env`, can't grab it — it falls through to OAuth). cf-metrics /
  tb-metrics read the renamed var. The ship pipeline for a feature (branch → merge to `main`
  → push `origin main` → deploy) is pre-authorized for this repo.
- **Indexing is part of shipping, owned by the orchestrator — no standing cron for it.** Whenever a
  new tool/page ships, the orchestrator (whoever runs the deploy) submits it to Google Search
  Console (URL Inspection → Request Indexing if not already indexed) as the last step of that same
  ship pass, right after deploy — not queued for a separate daily agent. (Retired 2026-07-18: the
  `gsc-indexing` cron + `gsc-indexing-queue.md` backlog mechanism. See
  `memory/feedback_url_inspection_async_queue.md` for why.)
- **Never deploy the pdf-to-word AWS Lambda backend** without explicit approval (git-committing its
  source is fine; uploading to AWS is not).
- No `Co-Authored-By` lines; commit messages are title-only.
