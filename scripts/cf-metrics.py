#!/usr/bin/env python3
"""Tools Berry — Cloudflare Web Analytics (RUM) daily metrics, via the GraphQL API.

Replaces the flaky Chrome-dashboard read (splash-hangs). Pulls real visits +
pageviews for the last 24h and 7d, plus top pages and top countries for 7d.

Auth: reads CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from the environment
(source ~/Documents/utility-portfolio/.env first). Never hardcodes the token.

Usage:
    set -a; source ~/Documents/utility-portfolio/.env; set +a
    python3 scripts/cf-metrics.py            # human summary
    python3 scripts/cf-metrics.py --json     # machine-readable (for the advisor digest)
"""
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

API = "https://api.cloudflare.com/client/v4"
GQL = "https://api.cloudflare.com/client/v4/graphql"
HOST_MATCH = "tools-berry"  # pick the RUM site whose hostname contains this

TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
ACCT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()


def _req(url, data=None, method="GET"):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode()[:500]}
    except Exception as e:
        return {"_error": str(e)}


def die(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def find_site_tag():
    """Return the busiest RUM site_tag, discovered via GraphQL (last 30d).

    Uses GraphQL (not the REST /rum/site_info endpoint) so only one permission is
    needed: Account Analytics: Read. CLOUDFLARE_RUM_SITE_TAG in the env overrides.
    """
    override = os.environ.get("CLOUDFLARE_RUM_SITE_TAG", "").strip()
    if override:
        return override
    now = datetime.now(timezone.utc)
    f = f'{{datetime_geq: "{iso(now - timedelta(days=30))}", datetime_lt: "{iso(now)}"}}'
    q = f"""query {{ viewer {{ accounts(filter: {{accountTag: "{ACCT}"}}) {{
      rumPageloadEventsAdaptiveGroups(limit: 50, orderBy: [count_DESC], filter: {f}) {{
        count dimensions {{ siteTag }} }} }} }} }}"""
    rows = gql(q)["rumPageloadEventsAdaptiveGroups"]
    if not rows:
        die("no RUM data in the last 30d (Web Analytics enabled? token scope?)")
    # sum pageviews per tag, pick the busiest
    by_tag = {}
    for r in rows:
        t = r["dimensions"]["siteTag"]
        by_tag[t] = by_tag.get(t, 0) + r["count"]
    return max(by_tag, key=by_tag.get)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def gql(query):
    # Values are interpolated into the query (we control them — no untrusted input),
    # which sidesteps any mismatch on Cloudflare's GraphQL scalar type names.
    res = _req(GQL, {"query": query}, method="POST")
    if res.get("_http_error") or res.get("_error"):
        die(f"graphql request failed: {res}")
    if res.get("errors"):
        die(f"graphql errors: {res['errors']}")
    return res["data"]["viewer"]["accounts"][0]


def _filter(tag, start, end):
    return f'{{siteTag: "{tag}", datetime_geq: "{iso(start)}", datetime_lt: "{iso(end)}"}}'


def agg(tag, start, end):
    q = f"""query {{ viewer {{ accounts(filter: {{accountTag: "{ACCT}"}}) {{
      rumPageloadEventsAdaptiveGroups(limit: 1, filter: {_filter(tag, start, end)}) {{
        count sum {{ visits }} }} }} }} }}"""
    rows = gql(q)["rumPageloadEventsAdaptiveGroups"]
    if not rows:
        return {"pageviews": 0, "visits": 0}
    return {"pageviews": rows[0]["count"], "visits": rows[0]["sum"]["visits"]}


def top(tag, start, end):
    f = _filter(tag, start, end)
    q = f"""query {{ viewer {{ accounts(filter: {{accountTag: "{ACCT}"}}) {{
      pages: rumPageloadEventsAdaptiveGroups(limit: 10, orderBy: [count_DESC], filter: {f}) {{
        count dimensions {{ metric: requestPath }} }}
      countries: rumPageloadEventsAdaptiveGroups(limit: 8, orderBy: [count_DESC], filter: {f}) {{
        count sum {{ visits }} dimensions {{ metric: countryName }} }}
    }} }} }}"""
    return gql(q)


def main():
    if not TOKEN or not ACCT:
        die("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set (source devops/.env)")
    now = datetime.now(timezone.utc)
    tag = find_site_tag()
    host = "tools-berry.com"

    d1 = agg(tag, now - timedelta(hours=24), now)
    d7 = agg(tag, now - timedelta(days=7), now)

    g = top(tag, now - timedelta(days=7), now)
    top_pages = [(r["dimensions"]["metric"], r["count"]) for r in g["pages"]]
    top_countries = [(r["dimensions"]["metric"], r["count"], r["sum"]["visits"]) for r in g["countries"]]

    out = {
        "site": host, "site_tag": tag, "as_of": iso(now),
        "last_24h": d1, "last_7d": d7,
        "top_pages_7d": top_pages, "top_countries_7d": top_countries,
    }

    if "--json" in sys.argv:
        print(json.dumps(out, indent=2))
        return

    print(f"Cloudflare Web Analytics — {host}  (as of {out['as_of']})")
    print(f"  Last 24h:  {d1['visits']:>6} visits   {d1['pageviews']:>6} pageviews")
    print(f"  Last 7d:   {d7['visits']:>6} visits   {d7['pageviews']:>6} pageviews"
          f"   (~{round(d7['visits']/7)}/day)")
    print("  Top pages (7d, by pageviews):")
    for path, c in top_pages[:10]:
        print(f"    {c:>5}  {path}")
    print("  Top countries (7d, visits):")
    for name, c, v in top_countries[:8]:
        print(f"    {v:>5} visits ({c} pv)  {name}")


if __name__ == "__main__":
    main()
