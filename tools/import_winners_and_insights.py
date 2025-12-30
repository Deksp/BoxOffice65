#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
BoxOffice65: import curated winners table + TMDb enrichment + neutral "insights"

Collections used:
  - films
  - metrics
  - yearcards
  - insights

Run example:
  python tools/import_winners_and_insights.py --mongo "mongodb://127.0.0.1:27017" --db "boxoffice65" --reset
"""

import os
import re
import time
import argparse
from datetime import datetime, timezone
from difflib import SequenceMatcher
from urllib.parse import quote_plus

import requests
from pymongo import MongoClient, ReturnDocument, ASCENDING

# ========= TMDb key (as requested) =========
TMDB_API_KEY_HARDCODED = "3b47ed2b0801a9e3132811b9ae8ee391"

TMDB_API = "https://api.themoviedb.org/3"
TMDB_WEB_MOVIE = "https://www.themoviedb.org/movie/"

# ========= Winners table =========
WINNERS = [
    (1960, "Спартак", "Спартак"),
    (1961, "101 далматинец", "Эль Сид"),
    (1962, "Лоуренс Аравийский", "Мятеж на Баунти"),
    (1963, "Клеопатра", "Клеопатра"),
    (1964, "Моя прекрасная леди", "Падение Рим. имп."),
    (1965, "Звуки музыки", "Большие гонки"),
    (1966, "Библия", "Библия"),
    (1967, "Выпускник", "Доктор Дулиттл"),
    (1968, "Смешн. девчонка", "Смешн. девчонка"),
    (1969, "Буч К. и Сандэнс К.", "Битва на Неретве"),
    (1970, "История любви", "Паттон"),
    (1971, "Бриллианты навсегда", "Скрипач на крыше"),
    (1972, "Крёстный отец", "Крёстный отец"),
    (1973, "Изгоняющий дьявола", "Мотылек"),
    (1974, "Вздымающийся ад", "Вздымающийся ад"),
    (1975, "Челюсти", "Челюсти"),
    (1976, "Рокки", "Кинг-конг"),
    (1977, "ЗВ: IV", "Близкие контакты"),
    (1978, "Бриолин", "Супермен"),
    (1979, "Лунный гонщик", "Стар Трек"),
    (1980, "ЗВ: V", "Супермен 2"),
    (1981, "Индиана Джонс", "Красные"),
    (1982, "Инопланетянин", "Энни"),
    (1983, "ЗВ: VI", "Супермен 3"),
    (1984, "Индиана Джонс 2", "Бесконечная история"),
    (1985, "Назад в будущее", "Черный котел"),
    (1986, "Топ Ган", "Чужие"),
    (1987, "Роковое влечение", "Искры из глаз/Цел. обол."),
    (1988, "Человек дождя", "Кто подставил кр. Роджера"),
    (1989, "Индиана Джонс 3", "Индиана Джонс 3 / Бэтмен"),
    (1990, "Привидение", "Крепкий орешек 2"),
    (1991, "Терминатор 2", "Терминатор 2"),
    (1992, "Аладдин", "Бэтмен 2"),
    (1993, "Парк Юрского пер.", "Парк Юрского пер."),
    (1994, "Король Лев", "Правдивая ложь"),
    (1995, "Крепкий орешек 3", "Водный мир"),
    (1996, "День независим.", "Стиратель"),
    (1997, "Титаник", "Титаник"),
    (1998, "Армагеддон", "Армагеддон"),
    (1999, "ЗВ: I", "Дикий, дикий запад"),
    (2000, "Миссия невып. 2", "Динозавр"),
    (2001, "Гарри Поттер 1", "Перл-Харбор"),
    (2002, "ВК: 2", "Умри, но не сейчас"),
    (2003, "ВК: 3", "Терминатор 3"),
    (2004, "Шрек 2", "Человек-паук 2"),
    (2005, "Гарри Поттер 4", "Кинг-конг"),
    (2006, "ПКМ: 2", "Возвращение супер."),
    (2007, "ПКМ: 3", "ПКМ: 3"),
    (2008, "Темный рыцарь", "Хроники Нарнии 2"),
    (2009, "Аватар", "ГП: 6"),
    (2010, "История игрушек 3", "Рапунцель"),
    (2011, "Гарри Поттер 8", "Трансформер 3"),
    (2012, "Мстители", "Хоббит 1"),
    (2013, "Холодное сердце", "Хоббит 2"),
    (2014, "Трансформеры 4", "Хоббит 3"),
    (2015, "ЗВ: VII", "ЗВ: VII"),
    (2016, "Первый мстит. 3", "Первый мстит. 3 / БПС"),
    (2017, "ЗВ: VIII", "ЗВ: VIII"),
    (2018, "Мстители: ВБ", "Мир Юрского 2"),
    (2019, "Мстители: Финал", "ЗВ: IX"),
    (2020, "Истреб. демонов", "Довод"),
    (2021, "ЧП: Нет пути домой", "Не время умирать"),
    (2022, "Аватар 2", "Мир Юрского 3"),
    (2023, "Барби", "Форсаж 10"),
    (2024, "Головоломка 2", "Гладиатор 2"),
]

# ========= Aliases to improve TMDb matching =========
ALIASES = {
    "ЗВ: IV": "Звёздные войны: Эпизод IV — Новая надежда",
    "ЗВ: V": "Звёздные войны: Эпизод V — Империя наносит ответный удар",
    "ЗВ: VI": "Звёздные войны: Эпизод VI — Возвращение джедая",
    "ЗВ: I": "Звёздные войны: Эпизод I — Скрытая угроза",
    "ЗВ: VII": "Звёздные войны: Пробуждение силы",
    "ЗВ: VIII": "Звёздные войны: Последние джедаи",
    "ЗВ: IX": "Звёздные войны: Скайуокер. Восход",

    "ВК: 2": "Властелин колец: Две крепости",
    "ВК: 3": "Властелин колец: Возвращение короля",

    "ПКМ: 2": "Пираты Карибского моря: Сундук мертвеца",
    "ПКМ: 3": "Пираты Карибского моря: На краю света",

    "ГП: 6": "Гарри Поттер и Принц-полукровка",
    "Гарри Поттер 1": "Гарри Поттер и философский камень",
    "Гарри Поттер 4": "Гарри Поттер и Кубок огня",
    "Гарри Поттер 8": "Гарри Поттер и Дары смерти: Часть 2",

    "Миссия невып. 2": "Миссия невыполнима 2",
    "Парк Юрского пер.": "Парк Юрского периода",
    "День независим.": "День независимости",
    "Возвращение супер.": "Возвращение Супермена",
    "ЧП: Нет пути домой": "Человек-паук: Нет пути домой",
    "Первый мстит. 3": "Первый мститель: Противостояние",
    "Мстители: ВБ": "Мстители: Война бесконечности",
    "Темный рыцарь": "Тёмный рыцарь",
    "Истреб. демонов": "Истребитель демонов: Поезд «Бесконечный»",

    "Смешн. девчонка": "Смешная девчонка",
    "Буч К. и Сандэнс К.": "Буч Кэссиди и Сандэнс Кид",
    "Падение Рим. имп.": "Падение Римской империи",
}

# ========= Neutral insights (no timecodes, no author mentions) =========
# Stored as "notes/insights" to support analytics/UI.
INSIGHTS = [
    {
        "year": None,
        "filmRefs": [],
        "title": "Идея сравнения",
        "text": "Удобно сравнивать кассового победителя года с самым дорогим фильмом года: это помогает увидеть, совпадает ли коммерческий успех с масштабом затрат.",
        "tags": ["methodology"],
    },
    {
        "year": None,
        "filmRefs": [],
        "title": "Качество данных",
        "text": "Данные о кассовых сборах могут различаться между источниками из-за методик подсчёта и учёта перевыпусков. Для корректного анализа полезно хранить источник/метод получения цифр.",
        "tags": ["data-quality"],
    },
    {
        "year": 1984,
        "filmRefs": ["Индиана Джонс 2", "Полицейский из Беверли-Хиллз", "Охотники за привидениями"],
        "title": "Домашние сборы и мировые сборы",
        "text": "Иногда фильм может быть сильнее в одной зоне проката и слабее в другой; из-за этого лидеры по домашним сборам и по мировым сборам не всегда совпадают.",
        "tags": ["comparison", "domestic-vs-worldwide"],
    },
    {
        "year": 1984,
        "filmRefs": ["Бесконечная история"],
        "title": "Дорогой проект не гарантирует лидерство",
        "text": "Самые дорогие фильмы года не обязательно становятся кассовыми лидерами, поэтому бюджет удобно анализировать отдельно от сборов.",
        "tags": ["budget", "comparison"],
    },
    {
        "year": 1970,
        "filmRefs": ["История любви"],
        "title": "Окупаемость",
        "text": "Бывает, что фильм с относительно небольшим бюджетом собирает непропорционально много: это хороший пример высокой окупаемости (ROI).",
        "tags": ["roi"],
    },
    {
        "year": 2004,
        "filmRefs": ["Шрек 2", "Человек-паук 2"],
        "title": "Касса, бюджет и восприятие",
        "text": "У конкурентов одного года могут сильно различаться касса, бюджет и рейтинг; такие пары удобно показывать как сравнение внутри года.",
        "tags": ["comparison"],
    },
    {
        "year": 1993,
        "filmRefs": ["Парк Юрского периода", "Титаник"],
        "title": "Перевыпуски меняют картину",
        "text": "Перевыпуски и длительный прокат способны заметно увеличить итоговые сборы; это важно учитывать при сравнении фильмов разных эпох.",
        "tags": ["re-releases", "history"],
    },
    {
        "year": 2019,
        "filmRefs": ["Мстители: Финал", "Аватар"],
        "title": "Рекорды и пересчёт",
        "text": "Гонки за рекордами кассы чувствительны к методике подсчёта и перевыпускам. Полезно хранить альтернативные значения сборов и пометки.",
        "tags": ["records", "re-releases", "data-quality"],
    },
    {
        "year": 2020,
        "filmRefs": ["Истребитель демонов: Поезд «Бесконечный»"],
        "title": "Нестандартные условия проката",
        "text": "Периоды с нестандартными условиями проката (например, ограничения) влияют на сборы и сопоставимость данных между годами.",
        "tags": ["history", "data-quality"],
    },
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def kp_search_url(title_ru: str, year: int | None):
    q = f"{title_ru} {year}".strip() if year else title_ru.strip()
    return f"https://www.kinopoisk.ru/index.php?kp_query={quote_plus(q)}"


def tmdb_movie_url(tmdb_id: int):
    return f"{TMDB_WEB_MOVIE}{tmdb_id}"


def normalize_query(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    return ALIASES.get(s, s)


def split_variants(s: str):
    parts = [p.strip() for p in re.split(r"\s*/\s*", s or "") if p.strip()]
    return parts if len(parts) > 1 else [s.strip()]


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


class TMDb:
    def __init__(self, api_key: str, sleep_sec: float = 0.08):
        self.api_key = api_key
        self.sleep_sec = sleep_sec
        self.s = requests.Session()

    def get(self, path: str, params: dict):
        params = dict(params or {})
        params["api_key"] = self.api_key
        while True:
            # IMPORTANT: network issues must not crash the whole import.
            # Let callers decide how to fallback (e.g., use local DB).
            try:
                r = self.s.get(f"{TMDB_API}{path}", params=params, timeout=30)
            except requests.exceptions.RequestException as e:
                raise RuntimeError(f"TMDb request failed: {e}") from e
            if r.status_code == 429:
                time.sleep(1.0)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"TMDb {r.status_code}: {r.text[:500]}")
            time.sleep(self.sleep_sec)
            return r.json()

    def search_movie(self, query: str, year: int | None):
        params = {"query": query, "include_adult": "false", "language": "ru-RU", "page": 1}
        if year is not None:
            params["year"] = year
        return self.get("/search/movie", params)

    def movie_details(self, movie_id: int):
        return self.get(f"/movie/{movie_id}", {"language": "ru-RU"})


def pick_best_search_result(query: str, year: int | None, results: list[dict]) -> dict | None:
    if not results:
        return None

    best = None
    best_score = -1.0
    for item in results[:10]:
        title = item.get("title") or ""
        orig = item.get("original_title") or ""
        date = item.get("release_date") or ""
        y = int(date[:4]) if len(date) >= 4 and date[:4].isdigit() else None

        score = max(similarity(query, title), similarity(query, orig))
        if year is not None and y == year:
            score += 0.25
        if score > best_score:
            best, best_score = item, score

    return best


def resolve_one(tmdb: TMDb, query_raw: str, year: int | None) -> dict | None:
    q = normalize_query(query_raw)

    try:
        s = tmdb.search_movie(q, year)
        best = pick_best_search_result(q, year, s.get("results", []))
    except Exception:
        # Network / TMDb failures should not abort the whole import
        return None

    if best is None:
        try:
            s2 = tmdb.search_movie(q, None)
            best = pick_best_search_result(q, year, s2.get("results", []))
        except Exception:
            return None

    if best is None:
        return None

    try:
        return tmdb.movie_details(best["id"])
    except Exception:
        return None


def resolve_film_in_db(db, query_raw: str, year: int | None):
    """
    Offline-friendly resolver:
    tries to match an existing film document in MongoDB by title/titleRu and releaseYear.
    Returns film document or None.
    """
    films = db["films"]
    q = normalize_query(query_raw)
    q_low = (q or "").lower()

    # Prefer exact year, but allow +-1 year to handle edge cases
    year_candidates = []
    if year is not None:
        year_candidates = [year, year - 1, year + 1]

    candidates = []
    if year_candidates:
        candidates = list(films.find({"releaseYear": {"$in": year_candidates}}).limit(500))
    else:
        candidates = list(films.find({}).sort([("releaseYear", -1)]).limit(500))

    best = None
    best_score = -1.0
    for f in candidates:
        title_ru = (f.get("titleRu") or "")
        title = (f.get("title") or "")

        # quick substring win
        if q_low and (q_low in title_ru.lower() or q_low in title.lower()):
            score = 1.0
        else:
            score = max(similarity(q, title_ru), similarity(q, title))

        # slight bonus for exact year match
        if year is not None and f.get("releaseYear") == year:
            score += 0.1

        if score > best_score:
            best, best_score = f, score

    # conservative threshold to avoid wrong matches
    if best is None or best_score < 0.60:
        return None
    return best


def resolve_most_expensive_variant(tmdb: TMDb, query_raw: str, year: int):
    variants = split_variants(query_raw)
    found = []
    for v in variants:
        det = resolve_one(tmdb, v, year)
        if det:
            found.append(det)
    if not found:
        return None
    return max(found, key=lambda d: (d.get("budget") or 0))


def ensure_indexes(db):
    db["films"].create_index([("external.tmdbId", ASCENDING)], unique=True, sparse=True)
    db["metrics"].create_index([("filmId", ASCENDING), ("year", ASCENDING)], unique=True)
    db["yearcards"].create_index([("year", ASCENDING)], unique=True)

    db["insights"].create_index([("year", ASCENDING)])
    db["insights"].create_index([("filmIds", ASCENDING)])
    db["insights"].create_index([("year", ASCENDING), ("title", ASCENDING)], unique=True)


def upsert_film_from_tmdb(db, det: dict, fallback_year: int | None):
    films = db["films"]
    tmdb_id = det["id"]

    release_date = det.get("release_date") or ""
    release_year = int(release_date[:4]) if len(release_date) >= 4 and release_date[:4].isdigit() else None
    if release_year is None:
        release_year = fallback_year

    title_ru = det.get("title") or det.get("original_title") or f"tmdb:{tmdb_id}"
    title_orig = det.get("original_title") or title_ru
    poster_path = det.get("poster_path") or None

    update = {
        "$set": {
            "title": title_orig,
            "titleRu": title_ru,
            "releaseYear": release_year,
            "genres": [],
            "type": "movie",
            "poster": {"provider": "tmdb", "path": poster_path} if poster_path else None,
            "external": {
                "tmdbId": tmdb_id,
                "tmdbUrl": tmdb_movie_url(tmdb_id),
                "kinopoiskUrl": kp_search_url(title_ru, release_year),
            },
            "updatedAt": now_iso(),
        },
        "$setOnInsert": {"createdAt": now_iso()},
    }

    return films.find_one_and_update(
        {"external.tmdbId": tmdb_id},
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def upsert_metrics_from_tmdb(db, film_id, year: int, det: dict):
    metrics = db["metrics"]
    budget = det.get("budget") or None
    revenue = det.get("revenue") or None
    vote_avg = det.get("vote_average")
    tmdb_rating = float(vote_avg) if vote_avg is not None else None

    update = {
        "$set": {
            "filmId": film_id,
            "year": year,
            "money": {
                "budgetUsd": {"selected": budget} if budget else {},
                "grossWorldwideUsd": {"selected": revenue} if revenue else {},
                "grossDomesticUsd": {},
            },
            "ratings": {
                "tmdb": {"selected": tmdb_rating} if tmdb_rating is not None else {},
                "imdb": {},
                "metacritic": {},
            },
            "updatedAt": now_iso(),
        },
        "$setOnInsert": {"createdAt": now_iso()},
    }

    return metrics.find_one_and_update(
        {"filmId": film_id, "year": year},
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def upsert_yearcard(db, year: int, top_worldwide_film_id, most_expensive_film_id):
    yearcards = db["yearcards"]
    update = {
        "$set": {
            "winners.topWorldwideFilmId": top_worldwide_film_id,
            "winners.topDomesticFilmId": top_worldwide_film_id,  # placeholder
            "winners.mostExpensiveFilmId": most_expensive_film_id,
            "notes": "Imported from curated winners table + TMDb enrichment",
            "updatedAt": now_iso(),
        },
        "$setOnInsert": {"year": year, "createdAt": now_iso()},
    }
    return yearcards.find_one_and_update(
        {"year": year},
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def upsert_insight(db, year: int | None, film_ids: list, title: str, text: str, tags: list):
    insights = db["insights"]
    update = {
        "$set": {
            "year": year,
            "filmIds": film_ids,
            "title": title,
            "text": text,
            "tags": tags or [],
            "updatedAt": now_iso(),
        },
        "$setOnInsert": {"createdAt": now_iso()},
    }
    return insights.find_one_and_update(
        {"year": year, "title": title},
        update,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mongo", default="mongodb://127.0.0.1:27017")
    ap.add_argument("--db", default="boxoffice65")
    ap.add_argument("--reset", action="store_true", help="Clear films/metrics/yearcards/insights before import")
    ap.add_argument("--from-year", type=int, default=1960)
    ap.add_argument("--to-year", type=int, default=2024)
    ap.add_argument(
        "--resume",
        action="store_true",
        help="Skip years that already have a yearcard in DB (useful after partial runs/timeouts)",
    )
    ap.add_argument(
        "--offline",
        action="store_true",
        help="Do not use TMDb network calls. Build yearcards from existing films in DB and still import insight texts.",
    )
    args = ap.parse_args()

    client = MongoClient(args.mongo)
    db = client[args.db]
    ensure_indexes(db)

    if args.reset:
        db["insights"].delete_many({})
        db["yearcards"].delete_many({})
        db["metrics"].delete_many({})
        db["films"].delete_many({})
        print("DB reset: films, metrics, yearcards, insights")

    tmdb = None
    if not args.offline:
        api_key = os.environ.get("TMDB_API_KEY") or TMDB_API_KEY_HARDCODED
        if not api_key:
            raise SystemExit("TMDB_API_KEY is missing (or use --offline)")
        tmdb = TMDb(api_key)

    # 1) Import winners
    for (year, cash_raw, exp_raw) in WINNERS:
        if year < args.from_year or year > args.to_year:
            continue

        if args.resume:
            if db["yearcards"].find_one({"year": year}, {"_id": 1}):
                print(f"[{year}] SKIP (already exists)")
                continue

        if args.offline:
            cash_f = resolve_film_in_db(db, cash_raw, year)
            exp_f = resolve_film_in_db(db, exp_raw, year)
            if not cash_f or not exp_f:
                print(f"[{year}] UNRESOLVED (offline): cash={bool(cash_f)} exp={bool(exp_f)} :: {cash_raw} | {exp_raw}")
                continue
            upsert_yearcard(db, year, cash_f["_id"], exp_f["_id"])
            print(f"[{year}] OK (offline): cash='{cash_f.get('titleRu') or cash_f.get('title')}' exp='{exp_f.get('titleRu') or exp_f.get('title')}'")
            continue

        # online (TMDb) path with safe fallback to local DB on failures
        cash_det = resolve_one(tmdb, cash_raw, year) if tmdb else None
        exp_det = resolve_most_expensive_variant(tmdb, exp_raw, year) if tmdb else None

        if not cash_det or not exp_det:
            cash_f = resolve_film_in_db(db, cash_raw, year) if not cash_det else None
            exp_f = resolve_film_in_db(db, exp_raw, year) if not exp_det else None
            if cash_det and not exp_det and not exp_f:
                print(f"[{year}] UNRESOLVED: exp missing :: {cash_raw} | {exp_raw}")
                continue
            if exp_det and not cash_det and not cash_f:
                print(f"[{year}] UNRESOLVED: cash missing :: {cash_raw} | {exp_raw}")
                continue
            if (not cash_det and not cash_f) or (not exp_det and not exp_f):
                print(f"[{year}] UNRESOLVED: cash={bool(cash_det or cash_f)} exp={bool(exp_det or exp_f)} :: {cash_raw} | {exp_raw}")
                continue

            # We have enough to build yearcard at least
            if cash_f is None and cash_det is not None:
                cash_f = upsert_film_from_tmdb(db, cash_det, year)
                upsert_metrics_from_tmdb(db, cash_f["_id"], year, cash_det)
            if exp_f is None and exp_det is not None:
                exp_f = upsert_film_from_tmdb(db, exp_det, year)
                upsert_metrics_from_tmdb(db, exp_f["_id"], year, exp_det)

            upsert_yearcard(db, year, cash_f["_id"], exp_f["_id"])
            print(f"[{year}] OK (fallback): cash='{cash_f.get('titleRu')}' exp='{exp_f.get('titleRu')}'")
            continue

        cash_f = upsert_film_from_tmdb(db, cash_det, year)
        upsert_metrics_from_tmdb(db, cash_f["_id"], year, cash_det)

        exp_f = upsert_film_from_tmdb(db, exp_det, year)
        upsert_metrics_from_tmdb(db, exp_f["_id"], year, exp_det)

        upsert_yearcard(db, year, cash_f["_id"], exp_f["_id"])
        print(f"[{year}] OK: cash='{cash_f.get('titleRu')}' exp='{exp_f.get('titleRu')}'")

    # 2) Import neutral insights
    for item in INSIGHTS:
        year = item.get("year")
        film_refs = item.get("filmRefs") or []
        title = item.get("title") or "Insight"
        text = item.get("text") or ""
        tags = item.get("tags") or []

        film_ids = []
        if not args.offline and tmdb:
            for ref in film_refs:
                det = resolve_one(tmdb, ref, year) if year else resolve_one(tmdb, ref, None)
                if det:
                    fdoc = upsert_film_from_tmdb(db, det, year if year else None)
                    if year:
                        upsert_metrics_from_tmdb(db, fdoc["_id"], year, det)
                    film_ids.append(fdoc["_id"])

        upsert_insight(db, year=year, film_ids=film_ids, title=title, text=text, tags=tags)

    print("Done: winners + neutral insights imported.")


if __name__ == "__main__":
    main()
