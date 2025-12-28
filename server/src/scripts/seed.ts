import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { connectMongo } from "../db.js";
import { FilmModel } from "../models/Film.js";
import { YearCardModel } from "../models/YearCard.js";
import { MetricsModel } from "../models/Metrics.js";

type Row = {
  year: string;
  topDomesticTitle: string;
  topDomesticTitleRu?: string;
  topDomesticYear: string;
  topDomesticKinopoiskUrl?: string;
  topWorldwideTitle: string;
  topWorldwideTitleRu?: string;
  topWorldwideYear: string;
  topWorldwideKinopoiskUrl?: string;
  budgetUsd?: string;
  grossWorldwideUsd?: string;
  grossDomesticUsd?: string;
  imdb?: string;
  metacritic?: string;
};

function parseCsv(filePath: string): Row[] {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  const [headerLine, ...lines] = raw.split(/\r?\n/);
  const headers = headerLine.split(",").map((s) => s.trim());

  return lines.map((line) => {
    const parts = line.split(",").map((s) => s.trim());
    const row: any = {};
    headers.forEach((h, i) => (row[h] = parts[i]));
    return row as Row;
  });
}

async function upsertFilm(
  title: string,
  releaseYear: number,
  titleRu?: string,
  kinopoiskUrl?: string
) {
  const update: any = {
    $setOnInsert: { title, releaseYear, type: "movie" },
    $set: {}
  };

  // Обновляем titleRu и kinopoiskUrl если они заданы
  if (titleRu) {
    update.$set.titleRu = titleRu;
  }
  if (kinopoiskUrl) {
    update.$set["external.kinopoiskUrl"] = kinopoiskUrl;
  }

  return FilmModel.findOneAndUpdate(
    { title, releaseYear },
    update,
    { upsert: true, new: true }
  );
}

function parseNumber(str: string | undefined): number | undefined {
  if (!str || str.trim() === "") return undefined;
  const num = Number(str.trim());
  return Number.isFinite(num) ? num : undefined;
}

async function upsertMetrics(
  filmId: any,
  year: number,
  budgetUsd?: number,
  grossWorldwideUsd?: number,
  grossDomesticUsd?: number,
  imdb?: number,
  metacritic?: number
) {
  const update: any = {
    filmId,
    year
  };

  if (budgetUsd !== undefined) {
    update["money.budgetUsd.selected"] = budgetUsd;
  }
  if (grossWorldwideUsd !== undefined) {
    update["money.grossWorldwideUsd.selected"] = grossWorldwideUsd;
  }
  if (grossDomesticUsd !== undefined) {
    update["money.grossDomesticUsd.selected"] = grossDomesticUsd;
  }
  if (imdb !== undefined) {
    update["ratings.imdb.selected"] = imdb;
  }
  if (metacritic !== undefined) {
    update["ratings.metacritic.selected"] = metacritic;
  }

  await MetricsModel.findOneAndUpdate(
    { filmId, year },
    { $set: update },
    { upsert: true }
  );
}

async function run() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
  await connectMongo(uri);

  const csvPath = path.resolve("data/year_winners_mvp.csv");
  const rows = parseCsv(csvPath);

  for (const r of rows) {
    const year = Number(r.year);

    const domFilm = await upsertFilm(
      r.topDomesticTitle,
      Number(r.topDomesticYear),
      r.topDomesticTitleRu,
      r.topDomesticKinopoiskUrl
    );
    const wwFilm = await upsertFilm(
      r.topWorldwideTitle,
      Number(r.topWorldwideYear),
      r.topWorldwideTitleRu,
      r.topWorldwideKinopoiskUrl
    );

    // Используем topWorldwide как mostExpensive по умолчанию (можно расширить CSV позже)
    const expensiveFilm = wwFilm;

    await YearCardModel.findOneAndUpdate(
      { year },
      {
        $set: {
          year,
          "winners.topDomesticFilmId": domFilm._id,
          "winners.topWorldwideFilmId": wwFilm._id,
          "winners.mostExpensiveFilmId": expensiveFilm._id,
          notes: ""
        }
      },
      { upsert: true }
    );

    // Создаем/обновляем Metrics для каждого фильма-победителя
    // Для topDomestic используем grossDomesticUsd
    await upsertMetrics(
      domFilm._id,
      year,
      parseNumber(r.budgetUsd),
      parseNumber(r.grossWorldwideUsd),
      parseNumber(r.grossDomesticUsd),
      parseNumber(r.imdb),
      parseNumber(r.metacritic)
    );

    // Для topWorldwide используем grossWorldwideUsd (те же метрики, но приоритет на worldwide)
    // Если это тот же фильм, то метрики уже созданы, но можно обновить приоритет
    if (String(wwFilm._id) !== String(domFilm._id)) {
      await upsertMetrics(
        wwFilm._id,
        year,
        parseNumber(r.budgetUsd),
        parseNumber(r.grossWorldwideUsd),
        parseNumber(r.grossDomesticUsd),
        parseNumber(r.imdb),
        parseNumber(r.metacritic)
      );
    }

    // Для mostExpensive (если отличается)
    if (String(expensiveFilm._id) !== String(domFilm._id) && String(expensiveFilm._id) !== String(wwFilm._id)) {
      await upsertMetrics(
        expensiveFilm._id,
        year,
        parseNumber(r.budgetUsd),
        parseNumber(r.grossWorldwideUsd),
        parseNumber(r.grossDomesticUsd),
        parseNumber(r.imdb),
        parseNumber(r.metacritic)
      );
    }
  }

  console.log(`Seed done: ${rows.length} years`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
