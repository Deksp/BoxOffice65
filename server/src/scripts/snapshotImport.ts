import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { EJSON } from "bson";
import { connectMongo } from "../db.js";

const SNAP_DIR = path.resolve(process.cwd(), "seed", "snapshot");

// Порядок важен из-за ссылок: сначала films, потом metrics, потом years, потом insights
// Маппинг: файл (.ejson) -> коллекция в БД
const mapping = [
  { file: "films", col: "films" },
  { file: "metrics", col: "metrics" },
  { file: "years", col: "yearcards" }, // years.ejson -> yearcards
  { file: "insights", col: "insights" },
  { file: "library_films", col: "libraryfilms" },
];

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
  await connectMongo(uri);

  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connected, but db is undefined");

  for (const { file: fileName, col: colName } of mapping) {
    const filePath = path.join(SNAP_DIR, `${fileName}.ejson`);
    try {
      const raw = await readFile(filePath, "utf8");
      const docs = EJSON.parse(raw) as unknown[];

      await db.collection(colName).deleteMany({});
      if (docs.length) {
        await db.collection(colName).insertMany(docs as never[], { ordered: false });
      }
      console.log(`[snapshot] restored ${fileName}.ejson -> ${colName}: ${docs.length}`);
    } catch (e) {
      console.warn(`[snapshot] skipped ${fileName}: ${(e as Error).message}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
