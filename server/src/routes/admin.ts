import { Router } from "express";
import { ObjectId } from "mongodb";
import fetch from "node-fetch";
import { tmdbMovieDetails } from "../services/tmdb.js";
import { recalcYear } from "../services/recalcYear.js";
import { getDb } from "../services/dbGuard.js";

const router = Router();

function kpSearchUrl(title: string, year?: number) {
  const q = encodeURIComponent(`${title}${year ? " " + year : ""}`);
  return `https://www.kinopoisk.ru/index.php?kp_query=${q}`;
}

function tmdbUrl(tmdbId: number) {
  return `https://www.themoviedb.org/movie/${tmdbId}`;
}

async function tryStorePosterToFilm(filmsCol: any, filmId: any, posterPath: string) {
  if (!posterPath) return;
  try {
    // w342 is enough for UI and keeps DB size reasonable
    const url = `https://image.tmdb.org/t/p/w342${posterPath}`;
    const r = await fetch(url);
    if (!r.ok) return;
    const mime = r.headers.get("content-type") || "image/jpeg";
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    // safety limit ~2MB
    if (buf.length > 2_000_000) return;
    await filmsCol.updateOne(
      { _id: filmId },
      {
        $set: {
          poster: { provider: "stored", path: posterPath },
          posterStored: { mime, data: buf },
          updatedAt: new Date(),
        },
      }
    );
  } catch {
    // ignore poster failures
  }
}

router.post("/films/import-tmdb", async (req, res) => {
  const tmdbId = Number(req.body?.tmdbId);
  const yearOverride = req.body?.year != null ? Number(req.body.year) : null;

  if (!Number.isFinite(tmdbId)) return res.status(400).json({ error: "tmdbId is required" });

  let det: any;
  try {
    det = await tmdbMovieDetails(tmdbId);
  } catch (e: any) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }

  const releaseYear =
    (det.release_date && /^\d{4}/.test(det.release_date) ? Number(det.release_date.slice(0, 4)) : null) ??
    (Number.isFinite(yearOverride) ? yearOverride : null);

  if (!releaseYear) {
    return res.status(400).json({ error: "TMDB movie has no release_date yet" });
  }

  // Разрешаем будущие года (база расширяемая)

  const titleRu = det.title || det.original_title || `tmdb:${det.id}`;
  const titleOrig = det.original_title || titleRu;

  const db = getDb();
  const filmsCol = db.collection("films");
  const metricsCol = db.collection("metrics");

  // Upsert film by external.tmdbId
  const film = await filmsCol.findOneAndUpdate(
    { "external.tmdbId": det.id },
    {
      $set: {
        title: titleOrig,
        titleRu,
        releaseYear: releaseYear ?? undefined,
        type: "movie",
        genres: [],
        poster: det.poster_path ? { provider: "tmdb", path: det.poster_path } : null,
        external: {
          tmdbId: det.id,
          tmdbUrl: tmdbUrl(det.id),
          kinopoiskUrl: kpSearchUrl(titleRu, releaseYear ?? undefined),
        },
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" }
  );

  const filmDoc = film;
  if (!filmDoc) return res.status(500).json({ error: "Failed to upsert film" });

  // Upsert metrics row for year (only if we have year)
  if (releaseYear != null) {
    await metricsCol.findOneAndUpdate(
      { filmId: filmDoc._id, year: releaseYear },
      {
        $set: {
          filmId: filmDoc._id,
          year: releaseYear,
          money: {
            budgetUsd: det.budget ? { selected: det.budget } : {},
            grossWorldwideUsd: det.revenue ? { selected: det.revenue } : {},
            grossDomesticUsd: {},
          },
          ratings: {
            tmdb: det.vote_average != null ? { selected: Number(det.vote_average) } : {},
            imdb: {},
            metacritic: {},
          },
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, returnDocument: "after" }
    );

    // Recalc year winners
    await recalcYear(releaseYear);
  }

  // Store poster bytes for offline mode (best-effort)
  if (det.poster_path) {
    void tryStorePosterToFilm(filmsCol, filmDoc._id, String(det.poster_path));
  }

  res.json({
    ok: true,
    film: filmDoc,
    yearUpdated: releaseYear,
  });
});

router.delete("/films/:id", async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID" });

  const db = getDb();
  const filmsCol = db.collection("films");
  const metricsCol = db.collection("metrics");

  const film = await filmsCol.findOne({ _id: new ObjectId(id) });
  if (!film) return res.status(404).json({ error: "Film not found" });

  await filmsCol.deleteOne({ _id: new ObjectId(id) });
  await metricsCol.deleteMany({ filmId: new ObjectId(id) });

  // Если у фильма был год, пересчитываем победителей (на случай если удаленный был победителем)
  if (film.releaseYear && typeof film.releaseYear === "number") {
    await recalcYear(film.releaseYear);
  }

  res.json({ ok: true, id });
});

// Offline-safe: rebuild yearcards from existing metrics (no TMDb calls)
router.post("/years/rebuild", async (_req, res) => {
  const db = getDb();
  const metricsCol = db.collection("metrics");
  const filmsCol = db.collection("films");
  const libraryCol = db.collection("libraryfilms");

  // 0) Offline backfill: if some films exist in main DB but have no usable metrics,
  // try to populate their metrics from libraryfilms (by external.tmdbId).
  // This makes "rebuild years" reflect the latest library enrichment without internet.
  const libDocs = await libraryCol
    .find(
      { "external.tmdbId": { $type: "number" } },
      {
        projection: {
          "external.tmdbId": 1,
          releaseYear: 1,
          money: 1,
          ratings: 1,
        },
      }
    )
    .toArray();

  const libByTmdbId = new Map<number, any>();
  for (const d of libDocs) {
    const id = d?.external?.tmdbId;
    if (typeof id === "number" && Number.isFinite(id)) libByTmdbId.set(id, d);
  }

  const mainFilms = await filmsCol
    .find(
      { "external.tmdbId": { $type: "number" } },
      { projection: { _id: 1, releaseYear: 1, "external.tmdbId": 1 } }
    )
    .toArray();

  let metricsBackfilled = 0;
  for (const f of mainFilms) {
    const tmdbId = f?.external?.tmdbId;
    const year = typeof f?.releaseYear === "number" ? f.releaseYear : Number(f?.releaseYear);
    if (typeof tmdbId !== "number" || !Number.isFinite(tmdbId) || !Number.isFinite(year)) continue;

    const lib = libByTmdbId.get(tmdbId);
    if (!lib) continue;

    const b = lib?.money?.budgetUsd?.selected;
    const ww = lib?.money?.grossWorldwideUsd?.selected;
    const dom = lib?.money?.grossDomesticUsd?.selected;
    const rt = lib?.ratings?.tmdb?.selected;

    // if library has no numeric data, nothing to backfill
    if (
      !(typeof b === "number" && Number.isFinite(b)) &&
      !(typeof ww === "number" && Number.isFinite(ww)) &&
      !(typeof dom === "number" && Number.isFinite(dom)) &&
      !(typeof rt === "number" && Number.isFinite(rt))
    ) {
      continue;
    }

    const setObj: Record<string, unknown> = {
      filmId: f._id,
      year,
      updatedAt: new Date(),
    };
    if (typeof b === "number" && Number.isFinite(b)) setObj["money.budgetUsd.selected"] = b;
    if (typeof ww === "number" && Number.isFinite(ww)) setObj["money.grossWorldwideUsd.selected"] = ww;
    if (typeof dom === "number" && Number.isFinite(dom)) setObj["money.grossDomesticUsd.selected"] = dom;
    if (typeof rt === "number" && Number.isFinite(rt)) setObj["ratings.tmdb.selected"] = rt;

    await metricsCol.updateOne(
      { filmId: f._id, year },
      { $set: setObj, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    metricsBackfilled++;
  }

  const years = (await metricsCol.distinct("year")) as unknown[];
  const yearsNum = years
    .map((y) => (typeof y === "number" ? y : Number(y)))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);

  if (yearsNum.length === 0) {
    return res.status(400).json({ error: "No metrics found. Cannot rebuild years." });
  }

  // Full rebuild semantics:
  // - remove yearcards that are no longer present in metrics
  // - recalc winners for every year from current metrics
  const cols = await db.listCollections().toArray();
  const names = new Set(cols.map((c) => c.name));
  const yearColName = names.has("yearcards") ? "yearcards" : names.has("years") ? "years" : "yearcards";
  const yearCol = db.collection(yearColName);
  const deletedObsolete = (await yearCol.deleteMany({ year: { $nin: yearsNum } })).deletedCount ?? 0;

  const results: { year: number; ok: boolean; reason?: string }[] = [];
  for (const y of yearsNum) {
    try {
      const r = await recalcYear(y);
      results.push({ year: y, ok: Boolean((r as any).ok), reason: (r as any).reason });
    } catch (e: any) {
      results.push({ year: y, ok: false, reason: e?.message ?? String(e) });
    }
  }

  res.json({
    ok: true,
    years: yearsNum,
    results,
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    deletedObsolete,
    yearCollection: yearColName,
    metricsBackfilled,
  });
});

export default router;
