"""Score converted .docx files against the authored ground truth; gate loop iterations.

Stdlib only (zipfile + ElementTree + difflib) — no renderer, no fuzzy-match deps.

Usage:
  python3 score.py <outdir>                      score every truth/<name>.json with an
                                                 <outdir>/<name>.docx; writes
                                                 <outdir>/scores.json and prints a table
  python3 score.py --compare <old.json> <new.json>
                                                 per-doc deltas + ACCEPT/REJECT verdict
Gate: mean composite must rise >= +0.002 with no single doc falling more than 0.010.
"""
import difflib
import json
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter

BASE = pathlib.Path(__file__).resolve().parent
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
HYPERLINK_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"

WEIGHTS = {"text_recall": 2.0, "text_precision": 1.0, "order": 1.5, "headings": 1.0,
           "lists": 1.0, "tables": 1.5, "header_footer": 1.0, "links": 0.75,
           "styles": 0.75, "reflow": 1.0}
GATE_MEAN_MIN_GAIN = 0.002
GATE_DOC_MAX_DROP = 0.010


def tokens(s):
    s = (s or "").replace("­", "").replace("’", "'")
    s = s.replace("–", "-").replace("—", "-")
    return re.findall(r"[a-z0-9]+(?:[.,][0-9]+)*%?", s.lower())


def _flag_on(rpr, tag):
    if rpr is None:
        return False
    el = rpr.find(W + tag)
    if el is None:
        return False
    return el.get(W + "val", "1").lower() not in ("0", "false", "none")


def _para_info(p):
    text_parts, bold_toks, ital_toks, link_ids = [], [], [], []
    for node in p.iter():
        if node.tag == W + "hyperlink":
            rid = node.get(RNS + "id")
            if rid:
                link_ids.append(rid)
    for r in p.iter(W + "r"):
        rpr = r.find(W + "rPr")
        t = "".join((tnode.text or "") for tnode in r.findall(W + "t"))
        if not t:
            continue
        text_parts.append(t)
        if _flag_on(rpr, "b"):
            bold_toks.extend(tokens(t))
        if _flag_on(rpr, "i"):
            ital_toks.extend(tokens(t))
    ppr = p.find(W + "pPr")
    style = None
    numpr_ilvl = None
    if ppr is not None:
        st = ppr.find(W + "pStyle")
        if st is not None:
            style = (st.get(W + "val") or "").lower().replace(" ", "")
        np = ppr.find(W + "numPr")
        if np is not None:
            ilvl = np.find(W + "ilvl")
            numpr_ilvl = int(ilvl.get(W + "val", "0")) if ilvl is not None else 0
    return {"text": "".join(text_parts), "style": style, "numpr_ilvl": numpr_ilvl,
            "bold": bold_toks, "italic": ital_toks, "links": link_ids}


def load_docx(path):
    z = zipfile.ZipFile(path)
    doc = ET.fromstring(z.read("word/document.xml"))
    body = doc.find(W + "body")
    paras, tables, flow = [], [], []
    for child in body:
        if child.tag == W + "p":
            info = _para_info(child)
            paras.append(info)
            if info["text"].strip():
                flow.append(info["text"])
        elif child.tag == W + "tbl":
            rows = []
            for tr in child.findall(W + "tr"):
                row = []
                for tc in tr.findall(W + "tc"):
                    cell = " ".join(_para_info(p)["text"] for p in tc.iter(W + "p")).strip()
                    row.append(cell)
                rows.append(row)
            tables.append(rows)
            for row in rows:
                flow.extend(c for c in row if c)
    hf_tokens = []
    for name in z.namelist():
        if re.match(r"word/(header|footer)\d*\.xml$", name):
            root = ET.fromstring(z.read(name))
            for p in root.iter(W + "p"):
                hf_tokens.extend(tokens(_para_info(p)["text"]))
    rels = {}
    try:
        relroot = ET.fromstring(z.read("word/_rels/document.xml.rels"))
        for rel in relroot:
            rels[rel.get("Id")] = (rel.get("Type"), rel.get("Target"))
    except KeyError:
        pass
    return {"paras": paras, "tables": tables, "flow": flow, "hf_tokens": hf_tokens,
            "rels": rels}


def _find_para(paras, text):
    want = tuple(tokens(text))
    if not want:
        return None
    for p in paras:
        if tuple(tokens(p["text"])) == want:
            return p
    return None


def _score_headings(truth, dx):
    if not truth["headings"]:
        return None
    total = 0.0
    for h in truth["headings"]:
        p = _find_para(dx["paras"], h["text"])
        if p is None:
            continue
        if p["style"] in (f"heading{h['level']}",):
            total += 1.0
        elif p["style"] and p["style"].startswith("heading"):
            total += 0.6
        else:
            total += 0.15
    score = total / len(truth["headings"])
    # spurious Heading styles are worse than missing ones: penalise styled
    # paragraphs that are not ground-truth headings
    gt_keys = {tuple(tokens(h["text"])) for h in truth["headings"]}
    styled = [p for p in dx["paras"] if p["style"] and p["style"].startswith("heading")]
    if styled:
        stray = sum(1 for p in styled if tuple(tokens(p["text"])) not in gt_keys)
        score = max(0.0, score - 0.5 * stray / len(styled))
    return score


def _score_lists(truth, dx):
    if not truth["list_items"]:
        return None
    total = 0.0
    for it in truth["list_items"]:
        p = _find_para(dx["paras"], it["text"])
        if p is None:
            # pdf2docx keeps the marker glyph in the paragraph text; retry with it stripped
            for cand in dx["paras"]:
                stripped = re.sub(r"^\s*(?:[•●▪·oe•·\-\*]|\(?\d{1,2}[.)])\s+",
                                  "", cand["text"])
                if tuple(tokens(stripped)) == tuple(tokens(it["text"])):
                    p = cand
                    break
        if p is None:
            continue
        if p["numpr_ilvl"] is not None:
            total += 1.0 if p["numpr_ilvl"] == it["level"] else 0.8
        else:
            total += 0.15
    return total / len(truth["list_items"])


def _score_tables(truth, dx):
    if not truth["tables"]:
        return None
    doc_scores = []
    for gt in truth["tables"]:
        best = 0.0
        for cand in dx["tables"]:
            cand_all = Counter(t for row in cand for c in row for t in tokens(c))
            got = 0.0
            n = 0
            for ri, row in enumerate(gt["rows"]):
                for ci, cell in enumerate(row):
                    want = tokens(cell)
                    if not want:
                        continue
                    n += 1
                    if ri < len(cand) and ci < len(cand[ri]) and tokens(cand[ri][ci]) == want:
                        got += 1.0
                    elif all(cand_all[t] > 0 for t in want):
                        got += 0.4
            if n:
                best = max(best, got / n)
        doc_scores.append(best)
    return sum(doc_scores) / len(doc_scores)


def _score_header_footer(truth, dx, body_counter):
    wants = [truth.get("header"), truth.get("footer")]
    wants = [w for w in wants if w]
    if not wants:
        return None
    hf = Counter(dx["hf_tokens"])
    total = 0.0
    for want in wants:
        tk = tokens(want)
        if tk and all(hf[t] > 0 for t in tk):
            total += 1.0
        elif tk and all(body_counter[t] > 0 for t in tk):
            total += 0.25
    return total / len(wants)


def _score_links(truth, dx):
    if not truth["links"]:
        return None
    live_ids = {rid for p in dx["paras"] for rid in p["links"]}
    total = 0.0
    for ln in truth["links"]:
        want = ln["href"].rstrip("/")
        hit = [rid for rid, (typ, tgt) in dx["rels"].items()
               if typ == HYPERLINK_TYPE and (tgt or "").rstrip("/") == want]
        if any(rid in live_ids for rid in hit):
            total += 1.0
        elif hit:
            total += 0.5
    return total / len(truth["links"])


def _score_styles(truth, dx):
    if not truth["bold"] and not truth["italic"]:
        return None
    heading_toks = set(t for h in truth["headings"] for t in tokens(h["text"]))
    parts = []
    for key, attr in (("bold", "bold"), ("italic", "italic")):
        if not truth[key]:
            continue
        have = Counter(t for p in dx["paras"] for t in p[attr])
        rec = sum(1.0 for phrase in truth[key]
                  if all(have[t] > 0 for t in tokens(phrase))) / len(truth[key])
        want_toks = Counter(t for phrase in truth[key] for t in tokens(phrase))
        stray = [t for t in have.elements() if t not in want_toks and t not in heading_toks]
        prec = 1.0 if not have else max(0.0, 1.0 - len(stray) / max(1, sum(have.values())))
        parts.append(0.7 * rec + 0.3 * prec)
    return sum(parts) / len(parts)


def _score_reflow(truth, dx):
    gt_long = [len(tokens(p)) for p in truth["paragraphs"] if len(tokens(p)) >= 15]
    if not gt_long:
        return None
    # exclude structural paragraphs (headings, list items) from the docx side —
    # they are legitimately short and would read as false fragmentation
    structural = {tuple(tokens(h["text"])) for h in truth["headings"]}
    structural |= {tuple(tokens(it["text"])) for it in truth["list_items"]}
    dx_lens = []
    for p in dx["paras"]:
        tk = tokens(p["text"])
        if len(tk) < 4 or tuple(tk) in structural:
            continue
        stripped = re.sub(r"^\s*(?:[•●▪·o\-\*]|\(?\d{1,2}[.)])\s+", "", p["text"])
        if tuple(tokens(stripped)) in structural:
            continue
        dx_lens.append(len(tk))
    if not dx_lens:
        return 0.0
    m = (sum(dx_lens) / len(dx_lens)) / (sum(gt_long) / len(gt_long))
    return round(min(m, 1.0 / m), 4) if m > 0 else 0.0


def score_doc(truth, docx_path):
    dx = load_docx(docx_path)
    gt_seq = [t for text in truth["flow"] for t in tokens(text)]
    dx_seq = [t for text in dx["flow"] for t in tokens(text)]
    gt_counter, dx_counter = Counter(gt_seq), Counter(dx_seq)
    overlap = sum((gt_counter & dx_counter).values())
    m = {
        "text_recall": overlap / max(1, len(gt_seq)),
        "text_precision": overlap / max(1, len(dx_seq)),
        "order": difflib.SequenceMatcher(None, gt_seq, dx_seq).ratio(),
        "headings": _score_headings(truth, dx),
        "lists": _score_lists(truth, dx),
        "tables": _score_tables(truth, dx),
        "header_footer": _score_header_footer(truth, dx, dx_counter),
        "links": _score_links(truth, dx),
        "styles": _score_styles(truth, dx),
        "reflow": _score_reflow(truth, dx),
    }
    m = {k: (round(v, 4) if v is not None else None) for k, v in m.items()}
    num = sum(WEIGHTS[k] * v for k, v in m.items() if v is not None)
    den = sum(WEIGHTS[k] for k, v in m.items() if v is not None)
    m["composite"] = round(num / den, 4)
    return m


def run_scores(outdir):
    outdir = pathlib.Path(outdir)
    docs = {}
    for tf in sorted((BASE / "truth").glob("*.json")):
        name = tf.stem
        dpath = outdir / f"{name}.docx"
        if not dpath.exists():
            docs[name] = {"error": "no docx"}
            continue
        truth = json.loads(tf.read_text())
        try:
            docs[name] = score_doc(truth, dpath)
        except Exception as e:
            docs[name] = {"error": f"{type(e).__name__}: {e}"}
    comps = [d["composite"] for d in docs.values() if "composite" in d]
    result = {"docs": docs,
              "mean_composite": round(sum(comps) / len(comps), 4) if comps else 0.0,
              "weights_version": 1}
    (outdir / "scores.json").write_text(json.dumps(result, indent=1))

    cols = ["text_recall", "text_precision", "order", "headings", "lists", "tables",
            "header_footer", "links", "styles", "reflow", "composite"]
    print(f"{'doc':<17}" + "".join(f"{c[:7]:>9}" for c in cols))
    for name, d in docs.items():
        if "error" in d:
            print(f"{name:<17} ERROR {d['error']}")
            continue
        row = "".join(f"{d[c]:>9.3f}" if d.get(c) is not None else f"{'-':>9}" for c in cols)
        print(f"{name:<17}{row}")
    print(f"\nmean composite: {result['mean_composite']}")
    return result


def compare(old_path, new_path):
    old = json.loads(pathlib.Path(old_path).read_text())
    new = json.loads(pathlib.Path(new_path).read_text())
    worst = 0.0
    print(f"{'doc':<17}{'old':>9}{'new':>9}{'delta':>9}")
    for name, nd in new["docs"].items():
        od = old["docs"].get(name, {})
        if "composite" not in nd or "composite" not in od:
            print(f"{name:<17} (unscored in one run)")
            continue
        delta = nd["composite"] - od["composite"]
        worst = min(worst, delta)
        print(f"{name:<17}{od['composite']:>9.3f}{nd['composite']:>9.3f}{delta:>+9.3f}")
    gain = new["mean_composite"] - old["mean_composite"]
    print(f"\nmean: {old['mean_composite']:.4f} -> {new['mean_composite']:.4f} "
          f"({gain:+.4f}); worst per-doc delta {worst:+.4f}")
    ok = gain >= GATE_MEAN_MIN_GAIN and worst >= -GATE_DOC_MAX_DROP
    print("VERDICT: ACCEPT" if ok else "VERDICT: REJECT")
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--compare":
        sys.exit(compare(sys.argv[2], sys.argv[3]))
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    run_scores(sys.argv[1])
