#!/usr/bin/env python3
"""Tools Berry — referring-domain report, via the Cloudflare Web Analytics (RUM) GraphQL API.

Who links/sends visitors to tools-berry.com. Groups pageloads by the RUM
`refererHost` dimension (verified live on this account, 2026-07-06), excludes
self-referrals, and separates search engines from other domains — the "other
domains" section is the AdSense external-signals input.

Auth: reads CLOUDFLARE_ANALYTICS_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from the environment
(source ~/Documents/utility-portfolio/.env first). Never hardcodes the token.

Usage:
    set -a; source ~/Documents/utility-portfolio/.env; set +a
    python3 scripts/tb-referrers.py              # last 7 days (default)
    python3 scripts/tb-referrers.py --days 2     # custom window
    python3 scripts/tb-referrers.py --json       # machine-readable
"""
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

GQL = "https://api.cloudflare.com/client/v4/graphql"
HOST = "tools-berry.com"
# Self-referral hosts to exclude (own domain + Cloudflare Pages previews of it).
SELF_HOSTS = (HOST, "tools-cherry.pages.dev")
# A referrer host is a search engine if any dot-separated label matches one of these.
SEARCH_ENGINES = {"google", "bing", "yandex", "duckduckgo", "yahoo", "ecosia",
                  "baidu", "brave", "startpage", "qwant", "presearch", "mojeek"}

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
    by_tag = {}
    for r in rows:
        t = r["dimensions"]["siteTag"]
        by_tag[t] = by_tag.get(t, 0) + r["count"]
    return max(by_tag, key=by_tag.get)


def referrers(tag, start, end):
    f = f'{{siteTag: "{tag}", datetime_geq: "{iso(start)}", datetime_lt: "{iso(end)}"}}'
    q = f"""query {{ viewer {{ accounts(filter: {{accountTag: "{ACCT}"}}) {{
      rumPageloadEventsAdaptiveGroups(limit: 100, orderBy: [count_DESC], filter: {f}) {{
        count sum {{ visits }} dimensions {{ refererHost }} }} }} }} }}"""
    rows = gql(q)["rumPageloadEventsAdaptiveGroups"]
    return [(r["dimensions"]["refererHost"], r["sum"]["visits"], r["count"]) for r in rows]


def is_self(host):
    return any(host == s or host.endswith("." + s) for s in SELF_HOSTS)


def is_search_engine(host):
    return bool(SEARCH_ENGINES & set(host.split(".")))


def parse_days():
    if "--days" not in sys.argv:
        return 7
    try:
        n = int(sys.argv[sys.argv.index("--days") + 1])
        if n < 1:
            raise ValueError
        return n
    except (IndexError, ValueError):
        die("--days requires a positive integer (e.g. --days 7)")


def main():
    if not TOKEN or not ACCT:
        die("CLOUDFLARE_ANALYTICS_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set "
            "(set -a; source ~/Documents/utility-portfolio/.env; set +a)")
    days = parse_days()
    now = datetime.now(timezone.utc)
    tag = find_site_tag()

    direct = {"visits": 0, "pageviews": 0}
    self_ref = {"visits": 0, "pageviews": 0}
    search, other = [], []
    for host, visits, pv in referrers(tag, now - timedelta(days=days), now):
        if not host:
            direct["visits"] += visits
            direct["pageviews"] += pv
        elif is_self(host):
            self_ref["visits"] += visits
            self_ref["pageviews"] += pv
        elif is_search_engine(host):
            search.append((host, visits, pv))
        else:
            other.append((host, visits, pv))

    out = {
        "site": HOST, "site_tag": tag, "as_of": iso(now), "days": days,
        "direct": direct,
        "search_engines": [{"host": h, "visits": v, "pageviews": p} for h, v, p in search],
        "other_domains": [{"host": h, "visits": v, "pageviews": p} for h, v, p in other],
        "self_referrals_excluded": self_ref,
    }

    if "--json" in sys.argv:
        print(json.dumps(out, indent=2))
        return

    print(f"Cloudflare Web Analytics — {HOST} referrers, last {days}d  (as of {out['as_of']})")
    print(f"  Direct / no referrer:  {direct['visits']:>5} visits ({direct['pageviews']} pv)")
    print("  Search engines:")
    for host, v, p in search or []:
        print(f"    {v:>5} visits ({p} pv)  {host}")
    if not search:
        print("    (none)")
    print("  Other domains (AdSense external-signals input):")
    for host, v, p in other or []:
        print(f"    {v:>5} visits ({p} pv)  {host}")
    if not other:
        print("    (none)")
    print(f"  Self-referrals excluded: {self_ref['visits']} visits ({self_ref['pageviews']} pv)")


if __name__ == "__main__":
    main()
