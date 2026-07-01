#!/usr/bin/env python3
"""
indexnow-submit.py — push the site's URLs to IndexNow (Bing, Yandex, Seznam…).

IndexNow lets a site notify participating search engines the moment pages are
added/updated, instead of waiting for a crawl. Bing consumes it directly, so this
is how Tools Berry gets into Bing's index without a Bing Webmaster account.

How it works:
  1. The build emits a public key file at  https://tools-berry.com/<key>.txt
     (see SITE.indexNowKey in build.js). Bing fetches it to verify we own the host.
  2. This script reads the built dist/sitemap.xml and POSTs the URL list to the
     IndexNow endpoint with that key.

Usage:
  python3 scripts/indexnow-submit.py            # submit every URL in dist/sitemap.xml
  python3 scripts/indexnow-submit.py --dry-run  # print what would be sent, send nothing
  python3 scripts/indexnow-submit.py https://tools-berry.com/bionic-reading-converter/ ...
                                                # submit only the URLs passed as args

Run it AFTER a deploy (the URLs must already be live for Bing to verify them).
No secrets required — the IndexNow key is public by design.
"""
import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

HOST = "tools-berry.com"
KEY = "9372e11bcbe34b0e993865299aae29dc"
KEY_LOCATION = f"https://{HOST}/{KEY}.txt"
ENDPOINT = "https://api.indexnow.org/indexnow"
SITEMAP = Path(__file__).resolve().parent.parent / "dist" / "sitemap.xml"


def urls_from_sitemap() -> list[str]:
    if not SITEMAP.exists():
        sys.exit(f"ERROR: {SITEMAP} not found — run `npm run build` first.")
    xml = SITEMAP.read_text(encoding="utf-8")
    return re.findall(r"<loc>(.*?)</loc>", xml)


def submit(url_list: list[str], dry_run: bool = False) -> int:
    payload = {
        "host": HOST,
        "key": KEY,
        "keyLocation": KEY_LOCATION,
        "urlList": url_list,
    }
    print(f"IndexNow → {ENDPOINT}")
    print(f"  host={HOST}  key={KEY[:8]}…  urls={len(url_list)}")
    for u in url_list[:5]:
        print(f"    {u}")
    if len(url_list) > 5:
        print(f"    …and {len(url_list) - 5} more")
    if dry_run:
        print("DRY RUN — nothing sent.")
        return 0
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"HTTP {resp.status} — {resp.reason}")
            # 200 = accepted, 202 = accepted pending key verification.
            return 0 if resp.status in (200, 202) else 1
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        print(f"HTTP {e.code} — {e.reason}\n{detail}")
        # Common: 403 key-file not reachable yet (deploy first), 422 URL/host mismatch,
        # 429 too many requests.
        return 1
    except urllib.error.URLError as e:
        print(f"NETWORK ERROR — {e.reason}")
        return 1


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    url_list = args if args else urls_from_sitemap()
    if not url_list:
        sys.exit("No URLs to submit.")
    sys.exit(submit(url_list, dry_run=dry))


if __name__ == "__main__":
    main()
