import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Явно указываем путь к .env (на уровень выше src)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import "./models/Film.js";
import "./models/YearCard.js";
import "./models/Metrics.js";
import "./models/LibraryFilm.js";

import filmsRouter from "./routes/films.js";
import insightsRouter from "./routes/insights.js";
import adminRouter from "./routes/admin.js";
import libraryRouter from "./routes/library.js";
import postersRouter from "./routes/posters.js";

// чтобы модель Insight зарегистрировалась
import "./models/Insight.js";

import express from "express";
import cors from "cors";

import { connectMongo } from "./db.js";
import { yearsRouter } from "./routes/years.js";
import { ensureSeededFromSnapshot } from "./services/ensureSeed.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
const PORT = Number(process.env.PORT || 3001);

async function main() {
  await connectMongo(MONGO_URI);
  await ensureSeededFromSnapshot();
  console.log("[seed] database was restored from snapshot");
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/films", filmsRouter);
  app.use("/api/years", yearsRouter);
  app.use("/api/years", insightsRouter); // добавляет /:year/insights
  app.use("/api/admin", adminRouter);
  app.use("/api/library", libraryRouter);
  app.use("/api/posters", postersRouter);

  // Production: раздаём собранный фронт
  const webDist = path.resolve(__dirname, "../../web/dist");

  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`Web: http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/health`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
