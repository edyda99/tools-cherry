#!/usr/bin/env python3
"""Tools Berry — Cloudflare Web Analytics (RUM) daily metrics, via the GraphQL API.

Replaces the flaky Chrome-dashboard read (splash-hangs). Pulls real visits +
pageviews for the last 24h and 7d, plus top pages and top countries for 7d.

Auth: reads CLOUDFLARE_ANALYTICS_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from the environment
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

# Analytics token is named CLOUDFLARE_ANALYTICS_API_TOKEN (NOT CLOUDFLARE_API_TOKEN)
# so wrangler can't auto-load it during a Pages deploy and fail with auth 10000.
# Fall back to the old name for safety on un-migrated envs.
TOKEN = (os.environ.get("CLOUDFLARE_ANALYTICS_API_TOKEN")
         or os.environ.get("CLOUDFLARE_API_TOKEN", "")).strip()
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


# --- Human-only breakdown ----------------------------------------------------
# Raw RUM visits count anything that executes the beacon JS: JS-rendering
# crawlers, Edmond's own checks from SA, and localhost dev. The advisor's
# headline number must be one that can only be real, so we classify:
#   search   — refererHost is a search engine (the number that bends first
#              when Google starts trusting the site)
#   referral — any other external site (Quora, HN, uneed, ...)
#   direct   — no referrer, non-SA, minus flagged bot-burst hours
# Excluded entirely: SA direct (self), tools-berry.com internal navigation,
# localhost/pages.dev dev traffic, and bot-burst hours. Burst signature
# (established 2026-08-17): many direct referrer-less ~1-pageview visits in
# one hour spread one-each across unrelated paths.

SEARCH_HOST_PAT = ("google.", "bing.", "duckduckgo.", "yahoo.", "yandex.",
                   "ecosia.", "brave.", "startpage.", "baidu.", "qwant.")
INTERNAL_HOSTS = {"tools-berry.com", "www.tools-berry.com"}
SELF_COUNTRIES = {"SA", "Saudi Arabia"}  # countryName returns ISO codes
BOT_HOUR_MIN_VISITS = 8      # direct non-SA visits in one hour
BOT_HOUR_MIN_PATHS = 5       # spread across at least this many distinct paths
BOT_HOUR_MAX_PV_RATIO = 1.5  # ~1 pageview per visit (crawlers don't browse)


def _host_class(host):
    h = (host or "").lower()
    if not h:
        return "direct"
    if h in INTERNAL_HOSTS:
        return "internal"
    if h in ("localhost", "127.0.0.1") or h.endswith(".pages.dev"):
        return "dev"
    if any(p in h for p in SEARCH_HOST_PAT):
        return "search"
    return "referral"


def human(tag, start, end):
    f = _filter(tag, start, end)
    # direct-only filter: same window, refererHost pinned to empty
    fd = f[:-1] + ', refererHost: ""}'
    q = f"""query {{ viewer {{ accounts(filter: {{accountTag: "{ACCT}"}}) {{
      hosts: rumPageloadEventsAdaptiveGroups(limit: 100, orderBy: [count_DESC], filter: {f}) {{
        count sum {{ visits }} dimensions {{ refererHost }} }}
      direct: rumPageloadEventsAdaptiveGroups(limit: 2000, filter: {fd}) {{
        count sum {{ visits }} dimensions {{ datetimeHour countryName requestPath }} }}
    }} }} }}"""
    g = gql(q)

    search = referral = internal = dev = 0
    by_search = {}
    for r in g["hosts"]:
        host = r["dimensions"]["refererHost"]
        v = r["sum"]["visits"]
        cls = _host_class(host)
        if cls == "search":
            search += v
            by_search[host] = by_search.get(host, 0) + v
        elif cls == "referral":
            referral += v
        elif cls == "internal":
            internal += v
        elif cls == "dev":
            dev += v

    sa_direct = 0
    hours = {}  # hour -> {"visits": n, "pv": n, "paths": set}
    for r in g["direct"]:
        d = r["dimensions"]
        v, pv = r["sum"]["visits"], r["count"]
        if d["countryName"] in SELF_COUNTRIES:
            sa_direct += v
            continue
        h = hours.setdefault(d["datetimeHour"], {"visits": 0, "pv": 0, "paths": set()})
        h["visits"] += v
        h["pv"] += pv
        h["paths"].add(d["requestPath"])

    direct_total = sum(h["visits"] for h in hours.values())
    bot_hours, bot_visits = [], 0
    for hr, h in sorted(hours.items()):
        if (h["visits"] >= BOT_HOUR_MIN_VISITS
                and len(h["paths"]) >= BOT_HOUR_MIN_PATHS
                and h["pv"] <= h["visits"] * BOT_HOUR_MAX_PV_RATIO):
            bot_hours.append(hr)
            bot_visits += h["visits"]
    direct = max(direct_total - bot_visits, 0)

    return {
        "total": search + referral + direct,
        "search": search, "referral": referral, "direct": direct,
        "by_search_host": sorted(by_search.items(), key=lambda kv: -kv[1]),
        "excluded": {"sa_direct": sa_direct, "bot_visits": bot_visits,
                     "bot_hours": bot_hours, "internal": internal, "dev": dev},
    }


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
        die("CLOUDFLARE_ANALYTICS_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set (source devops/.env)")
    now = datetime.now(timezone.utc)
    tag = find_site_tag()
    host = "tools-berry.com"

    d1 = agg(tag, now - timedelta(hours=24), now)
    d7 = agg(tag, now - timedelta(days=7), now)
    h1 = human(tag, now - timedelta(hours=24), now)
    h7 = human(tag, now - timedelta(days=7), now)

    g = top(tag, now - timedelta(days=7), now)
    top_pages = [(r["dimensions"]["metric"], r["count"]) for r in g["pages"]]
    top_countries = [(r["dimensions"]["metric"], r["count"], r["sum"]["visits"]) for r in g["countries"]]

    out = {
        "site": host, "site_tag": tag, "as_of": iso(now),
        "last_24h": d1, "last_7d": d7,
        "human_24h": h1, "human_7d": h7,
        "top_pages_7d": top_pages, "top_countries_7d": top_countries,
    }

    if "--json" in sys.argv:
        print(json.dumps(out, indent=2))
        return

    print(f"Cloudflare Web Analytics — {host}  (as of {out['as_of']})")
    print(f"  Last 24h:  {d1['visits']:>6} visits   {d1['pageviews']:>6} pageviews")
    print(f"  Last 7d:   {d7['visits']:>6} visits   {d7['pageviews']:>6} pageviews"
          f"   (~{round(d7['visits']/7)}/day)")
    print("  Human only (bots, SA self, internal excluded):")
    for label, h in (("24h", h1), ("7d ", h7)):
        ex = h["excluded"]
        print(f"    {label}: {h['total']:>4} visits = {h['search']} search"
              f" + {h['referral']} referral + {h['direct']} direct"
              f"   (excluded: {ex['sa_direct']} SA, {ex['bot_visits']} bot"
              f" in {len(ex['bot_hours'])}h, {ex['internal']} internal, {ex['dev']} dev)")
    if h7["by_search_host"]:
        hosts = ", ".join(f"{k} {v}" for k, v in h7["by_search_host"][:6])
        print(f"    Search hosts 7d: {hosts}")
    print("  Top pages (7d, by pageviews):")
    for path, c in top_pages[:10]:
        print(f"    {c:>5}  {path}")
    print("  Top countries (7d, visits):")
    for name, c, v in top_countries[:8]:
        print(f"    {v:>5} visits ({c} pv)  {name}")


if __name__ == "__main__":
    main()
