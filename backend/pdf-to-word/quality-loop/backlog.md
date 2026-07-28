# Enhancement backlog (evidence-ordered from the iteration-0 baseline)

Baseline: mean composite 0.8314 (out/baseline, scoreboard.json).

| # | Item | Evidence | Status |
|---|------|----------|--------|
| 1 | heading-styles: split heading runs fused into body paragraphs (run-size boundary), then map size clusters to real Heading 1/2/3 styles with outlineLvl | headings 0.15 avg; 0.00 on inline_styles/table_bordered/table_borderless (h1 fused into next paragraph); fused paras also drag mixed_report reflow to 0.611 | TODO |
| 2 | lists-numpr: replace frozen marker glyphs with real w:numPr numbering (bullet + decimal, nested ilvl) | lists 0.150 on lists + mixed_report | TODO |
| 3 | header-footer-parts: detect page furniture repeated at the same band across pages, move it into real header/footer parts | header_footer 0.250; body precision 0.913 from 3x repeated furniture | TODO |
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
