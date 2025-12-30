#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fill BoxOffice65 "library" collection (libraryfilms) from TMDb movie URLs.

Goals:
- Easy to extend list of URLs
- Upsert by external.tmdbId (no duplicates)
- Continue on broken URLs / network errors (do not crash)

Usage examples:
  python tools/fill_library_from_tmdb.py --mongo "mongodb://127.0.0.1:27017" --db "boxoffice65"
  python tools/fill_library_from_tmdb.py --urls https://www.themoviedb.org/movie/562-die-hard
  python tools/fill_library_from_tmdb.py --file tools/library_urls.txt

Dependencies:
  pip install requests pymongo
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Iterable

import requests
from bson.binary import Binary
from pymongo import MongoClient, ASCENDING, ReturnDocument


TMDB_API = "https://api.themoviedb.org/3"
TMDB_WEB_MOVIE = "https://www.themoviedb.org/movie/"

# Fallback key (as requested in the project)
TMDB_API_KEY_HARDCODED = "3b47ed2b0801a9e3132811b9ae8ee391"


DEFAULT_URLS = [
    "https://www.themoviedb.org/movie/562-die-hard",
    "https://www.themoviedb.org/movie/129",
    "https://www.themoviedb.org/movie/83533-avatar-fire-and-ash",
    "https://www.themoviedb.org/movie/438631",
    "https://www.themoviedb.org/movie/361743",
    "https://www.themoviedb.org/movie/872585",
    "https://www.themoviedb.org/movie/346698",
    "https://www.themoviedb.org/movie/414906",
    "https://www.themoviedb.org/movie/447365",
    "https://www.themoviedb.org/movie/603692",
    "https://www.themoviedb.org/movie/545611",
    "https://www.themoviedb.org/movie/575264",
    "https://www.themoviedb.org/movie/569094",
    "https://www.themoviedb.org/movie/502356",
    "https://www.themoviedb.org/movie/453395",
    "https://www.themoviedb.org/movie/370172",
    "https://www.themoviedb.org/movie/787699",
    "https://www.themoviedb.org/movie/1022789",
    "https://www.themoviedb.org/movie/577922",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def extract_tmdb_id(url: str) -> int | None:
    """
    Supports:
      - https://www.themoviedb.org/movie/562-die-hard
      - https://www.themoviedb.org/movie/129
      - /movie/562
      - 562
    """
    s = (url or "").strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)

    m = re.search(r"/movie/(\d+)", s)
    if m:
        return int(m.group(1))

    # last attempt: any number
    m2 = re.search(r"\b(\d{2,})\b", s)
    if m2:
        return int(m2.group(1))
    return None


class TMDb:
    def __init__(self, api_key: str, sleep_sec: float = 0.05, timeout_sec: int = 20):
        self.api_key = api_key
        self.sleep_sec = sleep_sec
        self.timeout_sec = timeout_sec
        self.s = requests.Session()

    def get(self, path: str, params: dict | None = None) -> dict:
        p = dict(params or {})
        p["api_key"] = self.api_key
        r = self.s.get(f"{TMDB_API}{path}", params=p, timeout=self.timeout_sec)
        if r.status_code == 429:
            # TMDb rate-limit: backoff and retry once
            time.sleep(1.0)
            r = self.s.get(f"{TMDB_API}{path}", params=p, timeout=self.timeout_sec)
        if r.status_code >= 400:
            raise RuntimeError(f"TMDb {r.status_code}: {r.text[:400]}")
        time.sleep(self.sleep_sec)
        return r.json()

    def movie_details(self, movie_id: int) -> dict:
        return self.get(f"/movie/{movie_id}", {"language": "ru-RU"})


def ensure_indexes(db):
    # keep unique by tmdbId where present
    db["libraryfilms"].create_index([("external.tmdbId", ASCENDING)], unique=True, sparse=True)
    db["libraryfilms"].create_index([("releaseYear", ASCENDING), ("title", ASCENDING)], unique=True)


def upsert_library_film(db, det: dict) -> dict:
    col = db["libraryfilms"]
    tmdb_id = det.get("id")
    if not isinstance(tmdb_id, int):
        raise RuntimeError("TMDb details missing numeric 'id'")

    release_date = det.get("release_date") or ""
    release_year = int(release_date[:4]) if len(release_date) >= 4 and release_date[:4].isdigit() else None
    if release_year is None:
        raise RuntimeError(f"TMDb movie {tmdb_id} has no release_date/year")

    title_ru = det.get("title") or det.get("original_title") or f"tmdb:{tmdb_id}"
    title_orig = det.get("original_title") or title_ru
    poster_path = det.get("poster_path") or None
    budget = det.get("budget")
    revenue = det.get("revenue")
    vote_avg = det.get("vote_average")
    poster_stored = None
    poster_mime = None

    if poster_path:
        try:
            img_url = f"https://image.tmdb.org/t/p/w342{poster_path}"
            ir = requests.get(img_url, timeout=20)
            if ir.ok and ir.content:
                if len(ir.content) <= 2_000_000:
                    poster_mime = ir.headers.get("content-type") or "image/jpeg"
                    poster_stored = Binary(ir.content)
        except Exception:
            # ignore poster download failures
            poster_stored = None
            poster_mime = None

    now = now_iso()
    update = {
        "$set": {
            "title": title_orig,
            "titleRu": title_ru,
            "releaseYear": release_year,
            "type": "movie",
            "genres": [],
            "poster": ({"provider": ("stored" if poster_stored else "tmdb"), "path": poster_path} if poster_path else None),
            "posterStored": ({"mime": poster_mime, "data": poster_stored} if poster_stored else None),
            "money": {
                "budgetUsd": ({"selected": int(budget)} if isinstance(budget, (int, float)) and budget else {}),
                "grossWorldwideUsd": ({"selected": int(revenue)} if isinstance(revenue, (int, float)) and revenue else {}),
                "grossDomesticUsd": {},
            },
            "ratings": {
                "tmdb": ({"selected": float(vote_avg)} if isinstance(vote_avg, (int, float)) else {}),
                "imdb": {},
                "metacritic": {},
            },
            "external": {
                "tmdbId": tmdb_id,
                "tmdbUrl": f"{TMDB_WEB_MOVIE}{tmdb_id}",
            },
            "updatedAt": now,
        },
        "$setOnInsert": {"createdAt": now},
    }

    doc = col.find_one_and_update(
        {"external.tmdbId": tmdb_id},
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if not doc:
        raise RuntimeError("Mongo upsert failed")
    return doc


def iter_urls(args) -> list[str]:
    urls: list[str] = []

    if args.urls:
        urls.extend([u.strip() for u in args.urls if u and u.strip()])

    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                urls.append(s)

    if not urls:
        urls = list(DEFAULT_URLS)

    # de-dup preserving order
    seen = set()
    out = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mongo", default="mongodb://127.0.0.1:27017")
    ap.add_argument("--db", default="boxoffice65")
    ap.add_argument("--urls", nargs="*", help="TMDb movie URLs (or numeric IDs). If empty, uses defaults.")
    ap.add_argument("--file", help="Text file with one URL/ID per line (# comments allowed)")
    ap.add_argument("--tmdb-key", default=None, help="TMDb API key (overrides env/hardcoded)")
    ap.add_argument("--dry-run", action="store_true", help="Fetch TMDb details but do not write to MongoDB")
    args = ap.parse_args()

    api_key = args.tmdb_key or os.environ.get("TMDB_API_KEY") or TMDB_API_KEY_HARDCODED
    if not api_key:
        print("ERROR: TMDB_API_KEY is missing", file=sys.stderr)
        return 2

    urls = iter_urls(args)
    print(f"Input items: {len(urls)}")

    tmdb = TMDb(api_key)

    client = MongoClient(args.mongo)
    db = client[args.db]
    ensure_indexes(db)

    ok = 0
    failed = 0
    skipped = 0

    for raw in urls:
        tmdb_id = extract_tmdb_id(raw)
        if not tmdb_id:
            skipped += 1
            print(f"[SKIP] bad input: {raw}")
            continue

        try:
            det = tmdb.movie_details(tmdb_id)
            title = det.get("title") or det.get("original_title") or f"tmdb:{tmdb_id}"
            year = (det.get("release_date") or "")[:4]

            if args.dry_run:
                print(f"[DRY] {tmdb_id} {year} {title}")
                ok += 1
                continue

            doc = upsert_library_film(db, det)
            print(f"[OK] {tmdb_id} {doc.get('releaseYear')} {doc.get('titleRu') or doc.get('title')}")
            ok += 1
        except Exception as e:
            failed += 1
            # continue on any error (broken link, timeouts, TMDb errors, etc.)
            print(f"[FAIL] {raw} -> {e}")
            continue

    print(f"Done. ok={ok} failed={failed} skipped={skipped}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())


