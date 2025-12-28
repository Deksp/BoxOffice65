import { Router } from "express";
import { ObjectId } from "mongodb";
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

export default router;
