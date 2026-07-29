# Enhancement backlog (evidence-ordered from the iteration-0 baseline)

Scoreboard now: mean composite 0.9956 (weights_version 3 re-baseline of the iter-5 output; the 0.0021 drop is the new wrap metric exposing two_column, not a regression). SEASON 2 IN PROGRESS since 2026-07-30.

| # | Item | Evidence | Status |
|---|------|----------|--------|
| 1 | heading-styles: split heading runs fused into body paragraphs (run-size boundary), then map size clusters to real Heading 1/2/3 styles with outlineLvl | headings 0.15 avg; 0.00 on inline_styles/table_bordered/table_borderless (h1 fused into next paragraph); fused paras also drag mixed_report reflow to 0.611 | **DONE iter 1** |
| 2 | lists-numpr: replace frozen marker glyphs with real w:numPr numbering (bullet + decimal, nested ilvl) | lists 0.150 on lists + mixed_report | **DONE iter 2** |
| 7 | span-boundary space loss: pdf2docx drops the space where a styled/hyperlink span meets plain text inside list items ("with thedeployment checklist") | lists_hard text_recall 0.972 / order 0.979; links doc unaffected | **DONE iter 5** |
| 3 | header-footer-parts: detect page furniture repeated at the same band across pages, move it into real header/footer parts | header_footer 0.250; body precision 0.913 from 3x repeated furniture | **DONE iter 3** |
| 4 | paragraph-reflow + dehyphenation across page breaks | header_footer reflow 0.732 (page-break splits), two_column 0.800, prose recall 0.995 (hyphenation) | **DONE iter 4** |
| 8 | remove intra-paragraph w:br wrap artifacts (pdf2docx emits one per wrapped line, so Word never reflows text; also blocks the U+2010 healer since hyphens sit in their own runs) — same intra-block evidence framework as reflow | discovered in iter-4 review; invisible to current metrics (scorer ignores w:br) — needs a metric first | TODO |
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
- **iter 4 (2026-07-29, ACCEPT +0.0079 → 0.9948; metric v2):** `paragraph_reflow`
  — merges pdf2docx's paragraph fragments back and heals hyphenation, plus the
  reflow metric v2 (span-cover, weights_version 2; re-baselined 0.9869). Three
  adversarial rounds shaped it: round 1 (UNSAFE) killed blind intra-block
  joining (book layouts collapsed), Latin-only tokens (Cyrillic paragraphs
  deleted as "spacers"), the spacer sweep eating images/page breaks, and
  document-global dehyph (re-sign→resign); round 2 (UNSAFE) proved the
  remaining cross-block geometry gate could not tell a paragraph break from a
  line break (config-paragraph welds, page-boundary glue) and that ASCII-hyphen
  fusion is dictionary-hard (re-form→reform); round 3 (SAFE) validated the
  final shape: merges only inside one MuPDF block from blocks ≥140pt, guarded
  by fullness (70%/90pt), first-line-indent and terminal+capital segmentation
  (incl. CJK terminators), a forward-only locality cursor, XML-blank-only
  spacers (pPr whitelist, NBSP=content), and typographic-hyphen-only (U+2010/
  U+00AD) fusion gated by mid-line interior evidence. Round-3 audit: zero OOXML
  violations introduced (removes 2 pre-existing), zero token deltas across a
  27-doc sweep; corpus wins mixed_report 0.949→1.000, prose 0.964→1.000.
  two_column 0.833 is the honest ceiling (fragments straddle a pdf2docx column
  sectPr). Known lost-repair (not corruption): narrow (<140pt) columns and
  hanging-indent layouts stay fragmented; U+2010 healing inert on pdf2docx's
  isolated-hyphen runs (folds into #8). hostile_tests grew to R1-R22.
- **iter 5 (2026-07-29, ACCEPT +0.0029 → 0.9977):** `span_space_repair` —
  restores the inter-word space pdf2docx drops at styled/hyperlink span
  boundaries, under double PDF evidence (fused form absent from the word
  stream, halves adjacent as separate words). Three single-refuter rounds:
  round 1 UNSAFE (edge-punct stripping made the guard test "oncall" while the
  seam said "on-call"; content-stream bigram order; CJK seams; text-box
  descent) → fixed with ASCII letter-against-letter seams, sort=True words,
  drawing-subtree skip; round 2 UNSAFE (interior hyphen/accents truncate the
  fragment: X-Ray+scanner, Zürich+bank probed as substrings) → fixed with the
  whole-token equality rule; round 3 SAFE — every prior corruption dead, new
  attack classes (edge punct, digit mixes, homoglyphs/zero-width, forced
  seams) all declined, 60-point divergence sweep confirms pure-ASCII tokens
  cannot be solid-in-docx yet absent-from-PDF. lists_hard now 1.000 on every
  metric. Residuals: table cells out of scope (missed repair, not corruption);
  seams whose PDF token carries punctuation stay unrepaired by design; pass
  order is load-bearing (enhance() is single-shot). Suite grew to S1-S12.

- **season 2 kickoff (2026-07-30):** visual gate added per Edmond ("both methods
  in the loop"). visual_check.py composites (PDF page vs re-rendered DOCX) +
  mandatory operator Read of every image; renderer = QuickLook by default
  (Word AppleScript blocked repeatedly: python3 host denied Apple events,
  /private/tmp and container staging dialog-hang or silently no-op, and an
  `active document` reference once raced Edmond's live Word session and
  exported HIS open document — render_word.sh is now by-name + abort-on-
  conflict, Word render only via Terminal relay). FIRST FULL VISUAL PASS on
  the season-1 output: 11/11 OK — furniture in real header, tables cell-
  perfect, nesting/numbering correct, hyphenation healed, two_column at its
  known ceiling; zero corruption. QL blind spots catalogued in RUNBOOK 6b.
  Also added the `wrap` metric (weights v3, weight 0.75): share of long body
  paragraphs free of w:br wrap artifacts; scoreboard re-baselined 0.9956.
  EVIDENCE CORRECTION on #8: corpus audit shows pdf2docx already space-joins
  justified prose (0 w:br in prose/table docs); artifacts concentrate in
  narrow/ragged columns (two_column: 1), poem-style short lines (5 — but those
  breaks are INTENTIONAL, removal would corrupt), and hyphenated line-splits
  (dehyph fixtures: 2, the shapes that block the U+2010 healer). #8 rescoped:
  first grow the corpus with a wrap_hard doc class (narrow ragged column of
  flowing sentences + hyphenated splits), then a narrowly-gated br-healing
  pass reusing reflow's continues() evidence; poems must stay untouched.
