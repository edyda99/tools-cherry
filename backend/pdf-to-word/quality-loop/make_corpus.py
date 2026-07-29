"""Author the quality-loop corpus: known documents -> HTML -> PDF (weasyprint) + ground-truth JSON.

Each document is defined once as data; the HTML and the truth file are derived from the
same structure, so they cannot drift apart. Deterministic: no dates, no randomness.

Usage:  python3 make_corpus.py            (writes corpus/<name>.{html,pdf} + truth/<name>.json)
"""
import json
import pathlib
import subprocess
import sys

BASE = pathlib.Path(__file__).resolve().parent
CORPUS = BASE / "corpus"
TRUTH = BASE / "truth"
WEASYPRINT = "/opt/homebrew/bin/weasyprint"

CSS = """
@page { size: A4; margin: 2cm; %(page_boxes)s }
html { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; }
h1 { font-size: 22pt; margin: 0 0 10pt; }
h2 { font-size: 16pt; margin: 14pt 0 6pt; }
h3 { font-size: 13pt; margin: 10pt 0 4pt; }
p  { margin: 0 0 8pt; line-height: 1.45; }
li { margin: 0 0 3pt; line-height: 1.4; }
table { border-collapse: collapse; margin: 8pt 0; }
td, th { padding: 4pt 8pt; font-size: 10.5pt; text-align: left; }
.bordered td, .bordered th { border: 1pt solid #444; }
.cols { column-count: 2; column-gap: 24px; }
.justify p { text-align: justify; hyphens: auto; }
.narrow { width: 190pt; }
.narrow p { text-align: left; hyphens: auto; }
a { color: #0645ad; text-decoration: underline; }
"""

# --- run helpers: a "rich" paragraph is a list of runs ---------------------------
# ("t", text) plain | ("b", text) bold | ("i", text) italic | ("bi", text)
# ("a", text, href) link | ("s", text, size_pt) sized run


def _run_html(run):
    kind = run[0]
    if kind == "t":
        return run[1]
    if kind == "b":
        return f"<strong>{run[1]}</strong>"
    if kind == "i":
        return f"<em>{run[1]}</em>"
    if kind == "bi":
        return f"<strong><em>{run[1]}</em></strong>"
    if kind == "a":
        return f'<a href="{run[2]}">{run[1]}</a>'
    if kind == "s":
        return f'<span style="font-size:{run[2]}pt">{run[1]}</span>'
    raise ValueError(kind)


def _rich_text(runs):
    return "".join(r[1] for r in runs)


P_LONG = [
    "Espresso extraction rewards patience and reproducibility more than any single piece "
    "of equipment. A consistent grind, a level bed, and an unhurried preinfusion remove "
    "most of the variability that beginners blame on the machine itself.",
    "When the shot runs fast, resist the counterintuitive urge to change everything at "
    "once. Tighten the grind one step, keep the dose identical, and taste again; a single "
    "controlled adjustment tells you more than five simultaneous ones ever could.",
    "Water chemistry matters less than forums suggest, but it is not negligible. Very hard "
    "water mutes acidity and scales the boiler, while distilled water tastes hollow and "
    "slowly corrodes brass components through mineral hunger.",
    "Milk texturing is choreography rather than force. Stretch briefly while the surface "
    "is still cool, then bury the tip and let the vortex fold the foam back into the "
    "liquid until the pitcher reads just short of uncomfortably warm.",
    "Finally, log everything for a fortnight. The notebook, not the tongue, reveals that "
    "Tuesday's remarkable shot followed a recalibration you had already forgotten by "
    "Thursday, and that repeatability was the ingredient you were actually missing.",
]

P_WRAP = [
    "The overnight maintenance window exposed a reproducibility problem in the "
    "calibration bench: identical measurement sequences returned inconsistent "
    "phosphorescence readings whenever the humidity compensation module restarted "
    "between runs.",
    "Responsibility for the recalibration procedure now sits with the instrumentation "
    "group, whose documentation emphasises uninterruptible power and a demagnetised "
    "workbench before any characterisation begins.",
    "Interdepartmental communication remains the uncomfortable bottleneck. The "
    "questionnaire circulated after the incident demonstrated that administrators "
    "misunderstood the notification thresholds and postponed acknowledgement until "
    "the following morning.",
    "A representative subcommittee will standardise the troubleshooting terminology, "
    "publish an authoritative checklist, and schedule quarterly demonstrations so the "
    "accumulated understanding survives personnel rotation.",
]

P_COLUMN = [
    "Trail navigation begins long before the trailhead. Reading the contour lines at the "
    "kitchen table builds the mental model that a phone screen cannot replace once fog "
    "settles into the valley.",
    "A bearing taken carefully is a promise to your future self. Walk the line in short "
    "legs, picking intermediate landmarks, and the forest stops feeling like a maze.",
    "Rivers are honest obstacles. They tell you exactly how fast they run and how cold "
    "they are; the only dishonest element is the hiker's optimism about both.",
    "Turning back is a navigation skill too. The summit is a bonus objective, while the "
    "car park is the mandatory one, and the good navigator never confuses the two.",
]

P_PAGES = [
    "The quarter closed ahead of the revised forecast, driven by renewals rather than new "
    "logos. Retention owes more to the support rota changes than to any pricing move.",
    "Hiring stayed deliberately slow. Two backend roles remain open, and the design "
    "contractor engagement was extended by eight weeks to cover the referral programme.",
    "Infrastructure spend fell for the third consecutive quarter after the storage "
    "migration, and the finance review flagged no new vendor risk this cycle.",
    "The mobile release slipped by two weeks to absorb the payment provider's API "
    "deprecation. No customer-facing regression was reported after rollout.",
    "Churn analysis shows the cancellations concentrate in accounts that never completed "
    "onboarding. The lifecycle email experiment targets exactly that cohort next quarter.",
    "Legal completed the data-processing addendum refresh, and the security questionnaire "
    "backlog is now empty for the first time since the enterprise push began.",
    "The partnerships pipeline added three integrators, one of which brings a regulated "
    "market we could not previously serve directly.",
    "Documentation rewrites reduced ticket volume in the two categories they targeted, "
    "confirming the hypothesis from the spring support audit.",
    "Internally, the platform team shipped the queue consolidation, retiring two services "
    "and simplifying the on-call rotation from five pagers to three.",
    "Next quarter's plan concentrates investment on the self-serve funnel, holding "
    "enterprise features steady while the new pricing page is tested.",
    "The board asked for a deeper view of expansion revenue; the data team will split "
    "expansion from renewal in the next reporting cycle.",
    "Overall, the company enters the next quarter with a longer runway than planned and "
    "a narrower focus than last year, which is precisely the combination we wanted.",
]

TABLE_ROWS = [
    ["Region", "Revenue", "Growth", "Accounts"],
    ["North America", "1,240", "8.5%", "312"],
    ["Europe", "980", "6.1%", "247"],
    ["Middle East", "415", "12.3%", "88"],
    ["Asia Pacific", "660", "9.9%", "154"],
]

DOCS = {
    "headings": {
        "blocks": [
            {"h": 1, "text": "Field Guide to Alpine Weather"},
            {"p": "Mountain weather is a system of fast promises and slow apologies. "
                  "This guide explains the signals that matter and the ones that merely decorate the sky."},
            {"h": 2, "text": "Reading the Morning Sky"},
            {"p": "A hard blue dawn after a windless night usually buys you six safe hours. "
                  "Lenticular caps over the ridge, by contrast, are the range clearing its throat."},
            {"h": 3, "text": "Cloud Sequences"},
            {"p": "Cirrus thickening into a milky sheet, then lowering, is the classic warm front "
                  "arriving on schedule. Count the hours, not the clouds."},
            {"h": 2, "text": "Afternoon Convection"},
            {"p": "Cumulus that towers before noon will not politely wait for your descent. "
                  "Turn around while the anvil is still a rumour."},
        ],
    },
    "lists": {
        "blocks": [
            {"h": 1, "text": "Expedition Packing Checklist"},
            {"p": "Two lists govern every trip: what keeps you alive, and what keeps you pleasant to travel with."},
            {"h": 2, "text": "Safety Essentials"},
            {"ul": ["Map and compass, carried where rain cannot reach them",
                    "Headlamp with a spare battery taped to its strap",
                    "First aid kit restocked after every single outing",
                    "Emergency bivvy weighing less than a sandwich"]},
            {"h": 2, "text": "Camp Routine"},
            {"ol": ["Pitch the shelter before admiring the view",
                    "Filter water while daylight makes the source visible",
                    "Cook away from the sleeping area",
                    "Pack tomorrow's breakfast at tonight's dinner"]},
            {"h": 2, "text": "Group Kit"},
            {"ul": [{"text": "Shared shelter components", "sub": ["Poles and pegs split by weight", "Repair sleeve in the lid pocket"]},
                    {"text": "Shared cooking system", "sub": ["One stove per three people", "Fuel counted in breakfasts, not grams"]}]},
        ],
    },
    "table_bordered": {
        "blocks": [
            {"h": 1, "text": "Regional Performance Summary"},
            {"p": "Figures are quarterly, in thousands, before intercompany elimination."},
            {"table": TABLE_ROWS, "borders": True},
            {"p": "Middle East growth reflects the two distributor agreements signed in the spring."},
        ],
    },
    "table_borderless": {
        "blocks": [
            {"h": 1, "text": "Regional Performance Summary"},
            {"p": "The same figures, set without rules, as the design team prefers for the annual report."},
            {"table": TABLE_ROWS, "borders": False},
            {"p": "Whitespace carries the structure here; the numbers have not changed."},
        ],
    },
    "wrap_hard": {
        "wrap_class": "narrow",
        "blocks": [{"h": 1, "text": "Maintenance Bulletin"}] + [{"p": t} for t in P_WRAP],
    },
    "two_column": {
        "wrap_class": "cols",
        "blocks": [{"h": 1, "text": "Notes on Navigation"}] + [{"p": t} for t in P_COLUMN],
    },
    "header_footer": {
        "header": "ACME Quarterly Review — Internal",
        "footer": "Confidential draft, do not distribute",
        "blocks": ([{"h": 1, "text": "Quarterly Operating Review"}]
                   + [{"p": t} for t in P_PAGES[:4]]
                   + [{"brk": True}, {"h": 2, "text": "Delivery and Platform"}]
                   + [{"p": t} for t in P_PAGES[4:8]]
                   + [{"brk": True}, {"h": 2, "text": "Outlook"}]
                   + [{"p": t} for t in P_PAGES[8:]]),
    },
    "prose": {
        "wrap_class": "justify",
        "blocks": [{"h": 1, "text": "Five Habits of Consistent Espresso"}] + [{"p": t} for t in P_LONG],
    },
    "mixed_report": {
        "blocks": [
            {"h": 1, "text": "Harbour Bridge Inspection Report"},
            {"p_rich": [("t", "Prepared by the "), ("b", "structures team"),
                        ("t", " following the winter storm cycle. Severity uses the "),
                        ("i", "national bridge index"), ("t", " conventions.")]},
            {"h": 2, "text": "Findings"},
            {"ul": ["Expansion joints show normal seasonal movement",
                    "Two bearing plates require regreasing within ninety days",
                    "Deck drainage cleared and functioning at all test points"]},
            {"h": 2, "text": "Load Ratings"},
            {"table": [["Span", "Rating", "Status"],
                       ["Main", "94%", "Pass"],
                       ["North approach", "88%", "Pass"],
                       ["South approach", "71%", "Monitor"]], "borders": True},
            {"p_rich": [("t", "The south approach remains "), ("b", "serviceable"),
                        ("t", " but moves to a six-month inspection interval until the "
                              "bearing work is complete.")]},
        ],
    },
    "lists_hard": {
        "blocks": [
            {"h": 1, "text": "Deployment Notes"},
            {"p": "Collected from the last three rollouts; every item cost someone an evening."},
            {"ul": [{"rich": [("t", "Start with the "),
                              ("a", "deployment checklist", "https://tools-berry.com/"),
                              ("t", " before touching production.")]},
                    "Review the changelog with the on-call engineer",
                    {"text": "Before you begin", "sub_ol": ["Install the vendor driver",
                                                            "Reboot the machine",
                                                            "Run the self-test"]}]},
            {"p": "Two habits that survived every retrospective:"},
            {"dashlist": ["Keep the cable ties with the spares, not the toolbox",
                          "Label both ends of every run before it leaves the bench"]},
        ],
    },
    "links": {
        "blocks": [
            {"h": 1, "text": "Further Reading"},
            {"p_rich": [("t", "The converter's homepage at "),
                        ("a", "tools-berry.com", "https://tools-berry.com/"),
                        ("t", " lists every utility, while the "),
                        ("a", "PDF to Word tool", "https://tools-berry.com/pdf-to-word/"),
                        ("t", " documents the in-browser path in detail.")]},
            {"p_rich": [("t", "Standards references live at the "),
                        ("a", "OOXML specification", "https://www.ecma-international.org/publications-and-standards/standards/ecma-376/"),
                        ("t", ", which defines every element a .docx file may contain.")]},
        ],
    },
    "inline_styles": {
        "blocks": [
            {"h": 1, "text": "Typography Fidelity Sample"},
            {"p_rich": [("t", "Regular text with a "), ("b", "bold phrase"),
                        ("t", " and an "), ("i", "italic aside"),
                        ("t", " and a "), ("bi", "bold italic warning"),
                        ("t", " in one sentence.")]},
            {"p_rich": [("s", "This sentence is set larger at fourteen points. ", 14),
                        ("t", "This one returns to the body size. "),
                        ("s", "This one is smaller at nine points.", 9)]},
            {"p_rich": [("t", "Numbers keep their weight: totals of "), ("b", "1,240"),
                        ("t", " and "), ("b", "415"), ("t", " stay bold, the rest stays regular.")]},
        ],
    },
}


def _block_html(b):
    if "brk" in b:
        return '<div style="page-break-before: always"></div>'
    if "h" in b:
        return f"<h{b['h']}>{b['text']}</h{b['h']}>"
    if "p" in b:
        return f"<p>{b['p']}</p>"
    if "p_rich" in b:
        return "<p>" + "".join(_run_html(r) for r in b["p_rich"]) + "</p>"
    if "dashlist" in b:
        return "".join(f"<p>- {t}</p>" for t in b["dashlist"])
    if "ul" in b or "ol" in b:
        tag = "ul" if "ul" in b else "ol"
        out = [f"<{tag}>"]
        for it in b.get("ul", b.get("ol")):
            if isinstance(it, dict) and "rich" in it:
                out.append("<li>" + "".join(_run_html(r) for r in it["rich"]) + "</li>")
            elif isinstance(it, dict):
                sub_tag = "ol" if "sub_ol" in it else "ul"
                subs = it.get("sub", it.get("sub_ol"))
                out.append(f"<li>{it['text']}<{sub_tag}>")
                out.extend(f"<li>{s}</li>" for s in subs)
                out.append(f"</{sub_tag}></li>")
            else:
                out.append(f"<li>{it}</li>")
        out.append(f"</{tag}>")
        return "".join(out)
    if "table" in b:
        cls = ' class="bordered"' if b.get("borders") else ""
        out = [f"<table{cls}>"]
        for i, row in enumerate(b["table"]):
            cell = "th" if i == 0 else "td"
            out.append("<tr>" + "".join(f"<{cell}>{c}</{cell}>" for c in row) + "</tr>")
        out.append("</table>")
        return "".join(out)
    raise ValueError(b)


def _truth(doc):
    t = {"headings": [], "paragraphs": [], "list_items": [], "tables": [],
         "links": [], "bold": [], "italic": [], "flow": [],
         "header": doc.get("header"), "footer": doc.get("footer")}
    for b in doc["blocks"]:
        if "h" in b:
            t["headings"].append({"level": b["h"], "text": b["text"]})
            t["flow"].append(b["text"])
        elif "p" in b:
            t["paragraphs"].append(b["p"])
            t["flow"].append(b["p"])
        elif "p_rich" in b:
            text = _rich_text(b["p_rich"])
            t["paragraphs"].append(text)
            t["flow"].append(text)
            for r in b["p_rich"]:
                if r[0] in ("b", "bi"):
                    t["bold"].append(r[1])
                if r[0] in ("i", "bi"):
                    t["italic"].append(r[1])
                if r[0] == "a":
                    t["links"].append({"text": r[1], "href": r[2]})
        elif "dashlist" in b:
            for s in b["dashlist"]:
                t["list_items"].append({"text": s, "ordered": False, "level": 0})
                t["flow"].append(s)
        elif "ul" in b or "ol" in b:
            ordered = "ol" in b
            for it in b.get("ul", b.get("ol")):
                if isinstance(it, dict) and "rich" in it:
                    text = _rich_text(it["rich"])
                    t["list_items"].append({"text": text, "ordered": ordered, "level": 0})
                    t["flow"].append(text)
                    for run in it["rich"]:
                        if run[0] == "a":
                            t["links"].append({"text": run[1], "href": run[2]})
                        if run[0] in ("b", "bi"):
                            t["bold"].append(run[1])
                elif isinstance(it, dict):
                    t["list_items"].append({"text": it["text"], "ordered": ordered, "level": 0})
                    t["flow"].append(it["text"])
                    sub_ordered = "sub_ol" in it
                    for s in it.get("sub", it.get("sub_ol")):
                        t["list_items"].append({"text": s, "ordered": sub_ordered, "level": 1})
                        t["flow"].append(s)
                else:
                    t["list_items"].append({"text": it, "ordered": ordered, "level": 0})
                    t["flow"].append(it)
        elif "table" in b:
            t["tables"].append({"rows": b["table"], "borders": bool(b.get("borders"))})
            for row in b["table"]:
                t["flow"].extend(row)
    return t


def main():
    CORPUS.mkdir(exist_ok=True)
    TRUTH.mkdir(exist_ok=True)
    for name, doc in DOCS.items():
        boxes = ""
        if doc.get("header"):
            boxes += '@top-center { content: "%s"; font-size: 9pt; color: #333; } ' % doc["header"]
        if doc.get("footer"):
            boxes += '@bottom-center { content: "%s"; font-size: 9pt; color: #333; } ' % doc["footer"]
        body = "".join(_block_html(b) for b in doc["blocks"])
        if doc.get("wrap_class"):
            body = f'<div class="{doc["wrap_class"]}">{body}</div>'
        html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
                f"<style>{CSS % {'page_boxes': boxes}}</style></head>"
                f"<body>{body}</body></html>")
        (CORPUS / f"{name}.html").write_text(html)
        r = subprocess.run([WEASYPRINT, str(CORPUS / f"{name}.html"), str(CORPUS / f"{name}.pdf")],
                           capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"weasyprint failed on {name}: {r.stderr[-500:]}")
        (TRUTH / f"{name}.json").write_text(json.dumps(_truth(doc), indent=1))
        print(f"{name}: pdf + truth written")


if __name__ == "__main__":
    main()
