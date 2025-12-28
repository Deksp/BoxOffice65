import { Router } from "express";
import mongoose from "mongoose";
import { YearCardModel } from "../models/YearCard.js";
import { MetricsModel } from "../models/Metrics.js";

export const yearsRouter = Router();

yearsRouter.get("/", async (_req, res) => {
  const years = await YearCardModel.find({})
    .sort({ year: -1 })
    .select({ year: 1 })
    .lean();

  res.json(years.map((y) => y.year));
});

yearsRouter.get("/:year", async (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isFinite(year)) return res.status(400).json({ error: "Invalid year" });

  const card = await YearCardModel.findOne({ year })
    .populate("winners.topDomesticFilmId")
    .populate("winners.topWorldwideFilmId")
    .populate("winners.mostExpensiveFilmId")
    .lean();

  if (!card) return res.status(404).json({ error: "Year not found" });

  res.json(card);
});

yearsRouter.get("/:year/details", async (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isFinite(year)) return res.status(400).json({ error: "Invalid year" });

  const card = await YearCardModel.findOne({ year })
    .populate("winners.topDomesticFilmId")
    .populate("winners.topWorldwideFilmId")
    .populate("winners.mostExpensiveFilmId")
    .lean();

  if (!card) return res.status(404).json({ error: "Year not found" });

  // Собираем filmIds из winners
  const filmIds: string[] = [];
  if (card.winners?.topDomesticFilmId && typeof card.winners.topDomesticFilmId === "object" && "_id" in card.winners.topDomesticFilmId) {
    filmIds.push(String(card.winners.topDomesticFilmId._id));
  }
  if (card.winners?.topWorldwideFilmId && typeof card.winners.topWorldwideFilmId === "object" && "_id" in card.winners.topWorldwideFilmId) {
    filmIds.push(String(card.winners.topWorldwideFilmId._id));
  }
  if (card.winners?.mostExpensiveFilmId && typeof card.winners.mostExpensiveFilmId === "object" && "_id" in card.winners.mostExpensiveFilmId) {
    filmIds.push(String(card.winners.mostExpensiveFilmId._id));
  }

  // Находим Metrics для этих filmIds + year
  const metricsMap = new Map<string, any>();
  if (filmIds.length > 0) {
    const objectIds = filmIds.map(id => new mongoose.Types.ObjectId(id));
    const metrics = await MetricsModel.find({
      filmId: { $in: objectIds },
      year
    }).lean();

    for (const m of metrics) {
      metricsMap.set(String(m.filmId), m);
    }
  }

  // Формируем ответ
  const getFilmAndMetrics = (filmId: any) => {
    if (!filmId) return { film: null, metrics: null };
    const film = typeof filmId === "object" && "_id" in filmId ? filmId : null;
    const metrics = film ? metricsMap.get(String(film._id)) || null : null;
    return { film, metrics };
  };

  res.json({
    yearCard: card,
    winners: {
      topDomestic: getFilmAndMetrics(card.winners?.topDomesticFilmId),
      topWorldwide: getFilmAndMetrics(card.winners?.topWorldwideFilmId),
      mostExpensive: getFilmAndMetrics(card.winners?.mostExpensiveFilmId)
    }
  });
});
