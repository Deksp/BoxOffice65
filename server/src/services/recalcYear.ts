import mongoose from "mongoose";
import { getDb } from "./dbGuard.js";

/**
 * Определяет коллекцию года: yearcards или years (что найдёт в базе).
 * Это сделано специально, чтобы не зависеть от того, как у тебя назван Year-модель/коллекция.
 */
async function getYearCollection() {
  const db = getDb();
  const cols = await db.listCollections().toArray();
  const names = new Set(cols.map((c) => c.name));
  if (names.has("yearcards")) return db.collection("yearcards");
  if (names.has("years")) return db.collection("years");
  return db.collection("yearcards");
}

export async function recalcYear(year: number) {
  const db = getDb();
  const metricsCol = db.collection("metrics");
  const yearCol = await getYearCollection();

  // 0) самый кассовый (domestic) — если есть
  const topDomestic = await metricsCol
    .find({
      year,
      "money.grossDomesticUsd.selected": { $type: "number" },
    })
    .sort({ "money.grossDomesticUsd.selected": -1 })
    .limit(1)
    .toArray();

  // 1) самый кассовый (worldwide)
  const topRevenue = await metricsCol
    .find({
      year,
      "money.grossWorldwideUsd.selected": { $type: "number" },
    })
    .sort({ "money.grossWorldwideUsd.selected": -1 })
    .limit(1)
    .toArray();

  // 2) самый дорогой (budget)
  const topBudget = await metricsCol
    .find({
      year,
      "money.budgetUsd.selected": { $type: "number" },
    })
    .sort({ "money.budgetUsd.selected": -1 })
    .limit(1)
    .toArray();

  const cashFilmId = topRevenue[0]?.filmId;
  const domesticFilmId = topDomestic[0]?.filmId ?? cashFilmId;
  const expensiveFilmId = topBudget[0]?.filmId;

  if (!cashFilmId || !expensiveFilmId) {
    return { ok: false, year, reason: "Not enough metrics for recalc" };
  }

  // upsert year doc
  await yearCol.updateOne(
    { year },
    {
      $set: {
        year,
        "winners.topWorldwideFilmId": cashFilmId,
        "winners.topDomesticFilmId": domesticFilmId,
        "winners.mostExpensiveFilmId": expensiveFilmId,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  return { ok: true, year, cashFilmId, domesticFilmId, expensiveFilmId };
}
