import { Router } from "express";
import { getDb } from "../services/dbGuard.js";

const router = Router();

/**
 * GET /api/films?q=&year=&sort=&dir=&limit=&withMetrics=1
 * sort: year|revenue|budget|rating|title
 * dir: asc|desc
 */
router.get("/", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const year = req.query.year != null ? Number(req.query.year) : null;
  const sort = String(req.query.sort ?? "year");
  const dir = String(req.query.dir ?? "desc") === "asc" ? 1 : -1;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
  const withMetrics = String(req.query.withMetrics ?? "1") !== "0";

  const db = getDb();
  const filmsCol = db.collection("films");
  const metricsCol = db.collection("metrics");

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

  const sortObj: Record<string, 1 | -1> = {};
  if (sort === "title") sortObj.titleRu = dir;
  else if (sort === "year") sortObj.releaseYear = dir;
  else sortObj.releaseYear = -1;

  const films = await filmsCol.find(filter).sort(sortObj as Record<string, 1 | -1>).limit(limit).toArray();

  if (!withMetrics) {
    res.json({ items: films });
    return;
  }

  // metrics are stored per (filmId, year). We use film.releaseYear as the default year row.
  const filmIds = films.map((f) => f._id);
  const yearPairs = films
    .filter((f) => Number.isFinite(f.releaseYear))
    .map((f) => ({ filmId: f._id, year: f.releaseYear }));

  // Fetch all metrics for these films (small dataset => ok)
  const metrics = await metricsCol
    .find({
      filmId: { $in: filmIds },
    })
    .toArray();

  // Map: filmId-year => metric
  const metricMap = new Map<string, unknown>();
  for (const m of metrics) {
    metricMap.set(`${String(m.filmId)}:${m.year}`, m);
  }

  const items = films.map((f) => {
    const key = `${String(f._id)}:${f.releaseYear}`;
    return { film: f, metric: metricMap.get(key) ?? null };
  });

  res.json({ items });
});

export default router;
