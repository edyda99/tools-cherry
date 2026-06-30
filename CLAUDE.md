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
  (pdf-to-word's optional server path is the sole, already-approved exception).
- **Workflow:** one branch per feature off `main` → merge to `main` → deploy. No more clone.
- **Deploy is pre-authorized — no need to ask Edmond.** From `main`: `npm run build`, then
  `npx wrangler pages deploy dist --project-name=tools-cherry` using the stored wrangler OAuth login.
  **NEVER set `CLOUDFLARE_API_TOKEN` for a deploy** — the Cloudflare token is **Analytics-only** and
  fails Pages deploy with auth 10000. It lives in `.env` as `CLOUDFLARE_ANALYTICS_API_TOKEN` (renamed
  so wrangler, which auto-loads `.env`, can't grab it — it falls through to OAuth). cf-metrics /
  tb-metrics read the renamed var. The ship pipeline for a feature (branch → merge to `main`
  → push `origin main` → deploy) is pre-authorized for this repo.
- **Never deploy the pdf-to-word AWS Lambda backend** without explicit approval (git-committing its
  source is fine; uploading to AWS is not).
- No `Co-Authored-By` lines; commit messages are title-only.
