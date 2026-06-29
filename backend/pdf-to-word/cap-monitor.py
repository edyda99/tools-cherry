#!/usr/bin/env python3
"""PDF->Word server-path size-cap monitor.

Queries CloudWatch Logs Insights for the structured `m=conv` lines the Lambda
emits (one per server conversion: input/output/b64 sizes, page count, over-cap
flag, duration). Computes the over-cap rate + size distribution and renders a
self-contained HTML dashboard. No PII is logged or read — sizes only.

Usage:  python3 cap-monitor.py [--days 30]
Outputs (next to this script): cap-dashboard.html, cap-metrics.json
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import time

PROFILE = os.environ.get("AWS_PROFILE", "tools-berry")
REGION = os.environ.get("AWS_REGION", "us-east-1")
LOG_GROUP = "/aws/lambda/pdf-to-word"
HERE = os.path.dirname(os.path.abspath(__file__))
HTML_OUT = os.path.join(HERE, "cap-dashboard.html")
JSON_OUT = os.path.join(HERE, "cap-metrics.json")

QUERY = r"""
fields @timestamp
| filter @message like /"m": "conv"/
| parse @message '"in": *,' as in_sz
| parse @message '"out": *,' as out_sz
| parse @message '"b64": *,' as b64_sz
| parse @message '"pages": *,' as pages
| parse @message '"over": *,' as over_raw
| sort @timestamp desc
| limit 10000
"""


def aws(*args):
    out = subprocess.run(
        ["aws", *args, "--profile", PROFILE, "--region", REGION, "--output", "json"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return json.loads(out.stdout) if out.stdout.strip() else {}


def run_query(days):
    end = int(time.time())
    start = end - days * 86400
    qid = aws("logs", "start-query", "--log-group-name", LOG_GROUP,
              "--start-time", str(start), "--end-time", str(end),
              "--query-string", QUERY)["queryId"]
    for _ in range(30):
        res = aws("logs", "get-query-results", "--query-id", qid)
        if res.get("status") == "Complete":
            return res.get("results", [])
        time.sleep(2)
    raise RuntimeError("Logs Insights query timed out")


def to_rows(results):
    rows = []
    for r in results:
        d = {f["field"]: f["value"] for f in r}
        try:
            rows.append({
                "ts": d.get("@timestamp"),
                "in": int(d.get("in_sz", 0)),
                "out": int(d.get("out_sz", 0)),
                "b64": int(d.get("b64_sz", 0)),
                "pages": int(d.get("pages", 0)),
                "over": d.get("over_raw", "false").strip() == "true",
            })
        except (ValueError, TypeError):
            continue
    return rows


def pct(values, p):
    if not values:
        return 0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((p / 100) * (len(s) - 1)))))
    return s[k]


def mb(n):
    return round(n / 1_048_576, 2)


def summarize(rows, days):
    total = len(rows)
    over = sum(1 for r in rows if r["over"])
    outs = [r["out"] for r in rows]
    by_day = {}
    for r in rows:
        day = (r["ts"] or "")[:10]
        b = by_day.setdefault(day, {"total": 0, "over": 0})
        b["total"] += 1
        b["over"] += 1 if r["over"] else 0
    return {
        "generated_utc": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "window_days": days,
        "total_conversions": total,
        "over_cap": over,
        "over_cap_rate_pct": round(100 * over / total, 1) if total else 0.0,
        "out_p50_mb": mb(pct(outs, 50)),
        "out_p90_mb": mb(pct(outs, 90)),
        "out_max_mb": mb(max(outs)) if outs else 0.0,
        "by_day": dict(sorted(by_day.items())),
    }


def render_html(s):
    rate = s["over_cap_rate_pct"]
    color = "#16a34a" if rate < 5 else ("#d97706" if rate < 15 else "#dc2626")
    rows_html = "".join(
        f"<tr><td>{day}</td><td>{v['total']}</td><td>{v['over']}</td>"
        f"<td>{round(100*v['over']/v['total'],1) if v['total'] else 0}%</td></tr>"
        for day, v in s["by_day"].items()
    ) or '<tr><td colspan="4" class="empty">No server conversions in this window yet.</td></tr>'
    empty_note = ""
    if s["total_conversions"] == 0:
        empty_note = ('<p class="note">No data yet — the in-browser converter is the default and is '
                      'never measured here (no size limit there). This tracks only the optional '
                      '<b>server</b> path, from the instrumentation deployed 2026-06-20 onward.</p>')
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PDF→Word size-cap monitor</title><style>
:root{{color-scheme:light dark}}body{{font:15px/1.5 system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#1a1a1a;background:#fafafa}}
@media(prefers-color-scheme:dark){{body{{color:#e8e8e8;background:#111}}.card,table{{background:#1b1b1b!important}}}}
h1{{font-size:20px;margin:0 0 4px}}.sub{{color:#888;font-size:13px;margin:0 0 20px}}
.cards{{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}}
.card{{flex:1;min-width:150px;background:#fff;border:1px solid #ddd3;border-radius:10px;padding:14px 16px}}
.card .v{{font-size:26px;font-weight:700}}.card .l{{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.04em}}
table{{width:100%;border-collapse:collapse;background:#fff;border:1px solid #ddd3;border-radius:10px;overflow:hidden}}
th,td{{padding:8px 12px;text-align:left;border-bottom:1px solid #ddd3;font-size:14px}}th{{font-size:12px;color:#888;text-transform:uppercase}}
.empty,.note{{color:#888}}.note{{font-size:13px;margin-top:16px}}
</style></head><body>
<h1>PDF→Word — server size-cap monitor</h1>
<p class="sub">Window: last {s['window_days']} days · generated {s['generated_utc']} UTC · 6 MB response cap</p>
<div class="cards">
  <div class="card"><div class="v" style="color:{color}">{rate}%</div><div class="l">Over-cap rate</div></div>
  <div class="card"><div class="v">{s['total_conversions']}</div><div class="l">Server conversions</div></div>
  <div class="card"><div class="v">{s['over_cap']}</div><div class="l">Hit the cap</div></div>
  <div class="card"><div class="v">{s['out_p90_mb']}<span style="font-size:14px"> MB</span></div><div class="l">Output p90</div></div>
  <div class="card"><div class="v">{s['out_max_mb']}<span style="font-size:14px"> MB</span></div><div class="l">Output max</div></div>
</div>
<table><thead><tr><th>Day (UTC)</th><th>Conversions</th><th>Over cap</th><th>Rate</th></tr></thead>
<tbody>{rows_html}</tbody></table>
{empty_note}
</body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    rows = to_rows(run_query(args.days))
    s = summarize(rows, args.days)
    with open(JSON_OUT, "w") as f:
        json.dump(s, f, indent=2)
    with open(HTML_OUT, "w") as f:
        f.write(render_html(s))
    print(f"{s['total_conversions']} conversions, {s['over_cap']} over cap "
          f"({s['over_cap_rate_pct']}%) → {HTML_OUT}")


if __name__ == "__main__":
    main()
