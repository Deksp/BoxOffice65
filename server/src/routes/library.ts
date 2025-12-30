import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../services/dbGuard.js";
import { recalcYear } from "../services/recalcYear.js";

const router = Router();

/**
 * GET /api/library/films?q=&year=&limit=
 * Returns items from `libraryfilms` collection.
 */
router.get("/films", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const year = req.query.year != null ? Number(req.query.year) : null;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
  const excludeMain = String(req.query.excludeMain ?? "1") !== "0";

  const db = getDb();
  const col = db.collection("libraryfilms");
  const filmsCol = db.collection("films");

  const filter: Record<string, unknown> = {};
  if (q) {
    filter.$or = [
      { titleRu: { $regex: q, $options: "i" } },
      { title: { $regex: q, $options: "i" } },
    ];
  }
  if (year != null && Number.isFinite(year)) {
    filter.releaseYear = year;
  }

  const items = await col
    .find(filter)
    .sort({ releaseYear: -1, title: 1 })
    .limit(limit)
    .toArray();

  if (!excludeMain) {
    res.json({ items });
    return;
  }

  // Filter out library films that already exist in main `films`.
  const mainTmdbIds = new Set<number>();
  try {
    const tmdbIds = (await filmsCol.distinct("external.tmdbId")) as unknown[];
    for (const v of tmdbIds) {
      if (typeof v === "number" && Number.isFinite(v)) mainTmdbIds.add(v);
    }
  } catch {
    // ignore
  }

  const mainTitleYear = new Set<string>();
  // bounded scan (project dataset is small; this keeps it safe)
  const mainFilms = await filmsCol
    .find({}, { projection: { title: 1, titleRu: 1, releaseYear: 1, "external.tmdbId": 1 } })
    .limit(20000)
    .toArray();
  for (const f of mainFilms) {
    if (typeof f?.releaseYear === "number" && Number.isFinite(f.releaseYear)) {
      if (typeof f?.title === "string" && f.title) mainTitleYear.add(`${f.title}|${f.releaseYear}`);
      if (typeof f?.titleRu === "string" && f.titleRu) mainTitleYear.add(`${f.titleRu}|${f.releaseYear}`);
    }
  }

  const filtered = items.filter((it: any) => {
    const tmdbId = it?.external?.tmdbId;
    if (typeof tmdbId === "number" && mainTmdbIds.has(tmdbId)) return false;
    const y = it?.releaseYear;
    if (typeof y === "number" && Number.isFinite(y)) {
      const t = typeof it?.title === "string" ? it.title : "";
      const tr = typeof it?.titleRu === "string" ? it.titleRu : "";
      if (t && mainTitleYear.has(`${t}|${y}`)) return false;
      if (tr && mainTitleYear.has(`${tr}|${y}`)) return false;
    }
    return true;
  });

  res.json({ items: filtered, filteredOut: items.length - filtered.length });
});

/**
 * POST /api/library/films/:id/import
 * Copies a LibraryFilm into main `films` collection (upsert).
 * No internet used.
 */
router.post("/films/:id/import", async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID" });

  const db = getDb();
  const libCol = db.collection("libraryfilms");
  const filmsCol = db.collection("films");
  const metricsCol = db.collection("metrics");

  const libFilm = await libCol.findOne({ _id: new ObjectId(id) });
  if (!libFilm) return res.status(404).json({ error: "Library film not found" });

  const tmdbId = libFilm?.external?.tmdbId;
  const filter =
    typeof tmdbId === "number" && Number.isFinite(tmdbId)
      ? { "external.tmdbId": tmdbId }
      : { title: libFilm.title, releaseYear: libFilm.releaseYear };

  const now = new Date();
  const filmDoc = await filmsCol.findOneAndUpdate(
    filter,
    {
      $set: {
        title: libFilm.title,
        titleRu: libFilm.titleRu,
        releaseYear: libFilm.releaseYear,
        type: libFilm.type ?? "movie",
        genres: Array.isArray(libFilm.genres) ? libFilm.genres : [],
        poster: libFilm.poster ?? null,
        external: libFilm.external ?? {},
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: "after" }
  );

  if (!filmDoc) return res.status(500).json({ error: "Failed to import film" });

  // Also upsert metrics from library data (offline) so "rebuild years" can include the film.
  const year = typeof filmDoc.releaseYear === "number" ? filmDoc.releaseYear : Number(filmDoc.releaseYear);
  if (Number.isFinite(year)) {
    const setObj: Record<string, unknown> = {
      filmId: filmDoc._id,
      year,
      updatedAt: new Date(),
    };

    const b = libFilm?.money?.budgetUsd?.selected;
    const ww = libFilm?.money?.grossWorldwideUsd?.selected;
    const dom = libFilm?.money?.grossDomesticUsd?.selected;
    const rt = libFilm?.ratings?.tmdb?.selected;

    if (typeof b === "number" && Number.isFinite(b)) setObj["money.budgetUsd.selected"] = b;
    if (typeof ww === "number" && Number.isFinite(ww)) setObj["money.grossWorldwideUsd.selected"] = ww;
    if (typeof dom === "number" && Number.isFinite(dom)) setObj["money.grossDomesticUsd.selected"] = dom;
    if (typeof rt === "number" && Number.isFinite(rt)) setObj["ratings.tmdb.selected"] = rt;

    await metricsCol.findOneAndUpdate(
      { filmId: filmDoc._id, year },
      { $set: setObj, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, returnDocument: "after" }
    );

    // Ensure yearcards updated immediately
    await recalcYear(year);
  }

  res.json({ ok: true, film: filmDoc, yearUpdated: Number.isFinite(year) ? year : null });
});

export default router;


