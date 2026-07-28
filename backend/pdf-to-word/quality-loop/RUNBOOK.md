# PDF→Word quality loop

A self-paced improvement loop for the server-side converter (pdf2docx + stencil OCR).
One enhancement per iteration; every iteration is measured against an authored corpus
with known ground truth and is accepted only if the scoreboard improves without any
document regressing. Goal: close the structural-quality gap to Solid-Framework
converters (real Heading styles, real lists, real headers/footers, clean reflow).

## Hard rails

- **Local only.** No deploy, no Lambda invocation, no AWS CLI. Shipping to prod is a
  separate, human-approved step after the loop ends (CLAUDE.md hard rule).
- All work on branch `pdf-quality-loop`, in its own worktree. Never the shared
  `~/Documents/utility-portfolio` checkout, never `main`.
- Commits are durable even though the worktree lives under /private/tmp: the object
  store is `~/Documents/utility-portfolio/.git`. If the worktree vanishes (reboot),
  recreate it: `git -C ~/Documents/utility-portfolio worktree add <dir> pdf-quality-loop`.
- No pushes unless Edmond asks.
- Loop turns may use ultracode (Workflow) when necessary — small fan-outs (≤4 agents)
  to adversarially verify risky passes, not for routine mechanics.

## Layout

```
quality-loop/
  make_corpus.py     authors corpus/*.{html,pdf} + truth/*.json from one data structure
  convert_corpus.py  local mirror of lambda_function._convert() (venv/bin/python)
  score.py           structural scorer + accept/revert gate (stdlib only)
  scoreboard.json    the standing baseline the gate compares against
  backlog.md         evidence-ordered enhancement queue + iteration log
  corpus/ truth/     committed; out/ and venv/ are not
../docx_enhance.py   the enhancement seam: enhance(docx_bytes, pdf_doc) — every
                     accepted pass lives here; convert_corpus.py already calls it
```

venv: `quality-loop/venv` (python3.13, pdf2docx==0.5.8, PyMuPDF==1.25.5 — the prod
pins). Rebuild if missing: `/opt/homebrew/bin/python3.13 -m venv venv && venv/bin/pip
install pdf2docx==0.5.8 PyMuPDF==1.25.5 Pillow numpy python-docx`.

## One iteration

1. Read `backlog.md` + `scoreboard.json`. Take the top unblocked item.
2. Implement it as a pass in `docx_enhance.py` (or a pdf2docx patch if XML-level
   repair cannot reach). A pass must be a no-op on documents where its precondition
   does not hold.
3. `venv/bin/python convert_corpus.py out/iterN && venv/bin/python score.py out/iterN`
4. `venv/bin/python score.py --compare scoreboard.json out/iterN/scores.json`
   - Gate: mean composite +0.002 or better AND no doc drops more than 0.010.
5. **ACCEPT** → `cp out/iterN/scores.json scoreboard.json`, log the iteration in
   backlog.md, commit everything (title-only message). **REJECT** → revert the pass,
   log what failed and the next angle; after 2 dead ends mark the item blocked.
6. Risky passes (reflow, anything deleting/moving text): before accepting, run an
   adversarial check — try to construct a document class the pass corrupts; add that
   document to the corpus if it finds one.
7. Schedule the next wakeup (3600s after a clean iteration, 1800s mid-task). Stop
   when the backlog is done or two consecutive items are blocked → final report,
   sample docx files to Edmond, deploy decision his.

## Prod wiring (when the loop ends, before any deploy)

`lambda_function._convert()` does NOT call `docx_enhance.enhance()` yet — only the
local harness does. Shipping = add the call after `postprocess_docx`, confirm the
Dockerfile copies `docx_enhance.py`, and get Edmond's explicit deploy approval.

## Metric notes

- Scores come from authored ground truth (make_corpus.py derives HTML and truth from
  the same structure, so they cannot drift).
- `headings` penalises spurious Heading styles (0.5 × stray share) — an over-eager
  pass scores worse than doing nothing.
- `reflow` excludes ground-truth headings/list items from the docx side; min(m, 1/m)
  punishes over-merging as much as fragmentation.
- Known blind spots: no visual render gate (LibreOffice hangs on this host; Word.app
  automation available but disruptive — reserved for the final manual check), no
  merged-cell/colspan case yet, no generic-scan class (scanned PDFs never reach the
  OCR path in prod either — `is_stencil_pdf` only detects chip stencils; product gap
  noted for Edmond, out of loop scope).
- Changing score.py weights/metrics invalidates scoreboard.json — re-run the baseline
  scoring in the same iteration and bump `weights_version`.

## Corpus growth

Every enhancement that survives on a corpus class earns a harder variant of that
class in a later iteration (e.g. ragged borderless table, deeper list nesting).
Edmond can drop real PDFs into `quality-loop/corpus-inbox/`; they get converted and
tracked for text recall/order only (no authored truth).
