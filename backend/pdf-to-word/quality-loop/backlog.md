# Enhancement backlog (evidence-ordered from the iteration-0 baseline)

Scoreboard now: mean composite 0.9538 (after iter 1).

| # | Item | Evidence | Status |
|---|------|----------|--------|
| 1 | heading-styles: split heading runs fused into body paragraphs (run-size boundary), then map size clusters to real Heading 1/2/3 styles with outlineLvl | headings 0.15 avg; 0.00 on inline_styles/table_bordered/table_borderless (h1 fused into next paragraph); fused paras also drag mixed_report reflow to 0.611 | **DONE iter 1** |
| 2 | lists-numpr: replace frozen marker glyphs with real w:numPr numbering (bullet + decimal, nested ilvl) | lists 0.150 on lists + mixed_report | **DONE iter 2** |
| 7 | span-boundary space loss: pdf2docx drops the space where a styled/hyperlink span meets plain text inside list items ("with thedeployment checklist") | lists_hard text_recall 0.972 / order 0.979; links doc unaffected | TODO |
| 3 | header-footer-parts: detect page furniture repeated at the same band across pages, move it into real header/footer parts | header_footer 0.250; body precision 0.913 from 3x repeated furniture | **DONE iter 3** |
| 4 | paragraph-reflow + dehyphenation across page breaks | header_footer reflow 0.732 (page-break splits), two_column 0.800, prose recall 0.995 (hyphenation) | TODO |
| 5 | harder corpus: ragged borderless table, merged cells, deeper nesting, longer docs | current borderless case already scores 1.0 — need a real target before converter work | TODO |
| 6 | borderless/ragged table detection | blocked on #5 producing a failing case | TODO |

Dropped: hyperlink preservation — pdf2docx already keeps links live (links 1.000).

## Iteration log

- **iter 0 (2026-07-28):** harness built (corpus 10 docs, prod-mirror converter,
  structural scorer), metrics hardened (stray-Heading penalty, reflow structural
  exclusion), baseline frozen at 0.8314. Findings: pdf2docx fuses headings into the
  following paragraph on 3 of 10 docs; links and inline bold/italic already survive;
  simple aligned borderless tables already parse.
- **iter 1 (2026-07-28, ACCEPT +0.1224 → 0.9538):** `heading_styles` pass in
  docx_enhance.py — body size by text-weighted mode, heading = ≥1.15x body AND
  (bold or ≥1.5x), ≤14 words; fused headings split at the run-size boundary; sizes
  clustered to Heading 1-3 (template already defines them, outlineLvl works).
  Guards: bail if styled share >60% or >40 paras; spurious-style penalty stayed 0.
  Verified: nav outline exact on `headings`, fused split intact on `table_bordered`,
  text recall 1.000 everywhere, worst per-doc delta 0.000. Commit 181a0dc.
- **iter 2 (2026-07-29, ACCEPT +0.0208 → 0.9741 on the grown corpus):**
  `list_numbering` pass — frozen markers → real w:numPr; per-block indent
  clustering for ilvl; ordered stretches convert only when printed numbers read
  1..n. A 2-agent adversarial fan-out (opus) returned UNSAFE with reproduced
  corruption: the empty-run purge deleted hyperlink-wrapper/drawing/footnote
  runs, the run.text setter cleared non-text children, para.text-vs-para.runs
  stream misalignment ate body characters, and nested/jittered ordered lists
  renumbered "1. 2. 3." as "a. b. c."; plus numPr/w:num schema-order breaks.
  Fixes: one shared character stream (_stream_text/_consume_prefix over direct
  text-like elements only, no run.text setter, remove only self-emptied
  elements), first-content-is-run + marker-only guards, one ilvl per ordered
  stretch with all-decimal lvlText, printed bullet glyph reused as lvlText,
  CT_PPr-ordered numPr, numIdMacAtCleanup-aware insertion, @w:start fallback,
  heading pass no longer sweeps content-only runs into a split. Permanent
  hostile_tests.py (A-P) now runs every iteration. Corpus grew to 11 docs
  (lists_hard: link-in-bullet, ordered-under-bullet, dash markers) and exposed
  backlog #7 (span-boundary space loss, pdf2docx's own defect).
- **iter 3 (2026-07-29, ACCEPT +0.0142 → 0.9883):** `header_footer_parts` —
  band-repeated furniture out of the body, one exemplar into real header/footer
  parts; header_footer doc hit 1.000 on every metric. The 2-agent fan-out again
  returned UNSAFE on v1 (34 findings): cover-title deletion via the off-by-N
  match guard, half-removal when pdf2docx merged/table-wrapped one occurrence,
  per-chapter headers stacked document-wide, existing-header clobber, titlePg /
  multi-section content loss, r:link + footnote/bookmark leakage into parts,
  header sweep stealing footer occurrences, and two cross-pass regressions
  (furniture removal merging restarting ordered lists past the 1..n gate;
  share-bail flip dropping headings on tiny docs). Redesign: all-pages + exact
  page-count matching, both-bands decline, plain-text-paragraph requirement,
  decline any doc already carrying header/footer machinery (also gives
  idempotence); list pass now segments ordered stretches at each printed "1";
  heading share-bail exempts docs under 8 paragraphs. hostile_tests grew to
  HF1-HF16. Confirmed-safe by review: NBSP/whitespace matching, dash-mismatch
  no-ops, table preservation, cross-tree exemplar moves, enhance() idempotence.
  Commit 6813c73.
