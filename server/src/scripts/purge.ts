import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../db.js";

/**
 * Полная очистка БД проекта (без seed).
 * Удаляет все коллекции, которые использует приложение:
 *  - films
 *  - metrics
 *  - yearcards
 *  - insights
 *  - libraryfilms
 */

async function run() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
  await connectMongo(uri);

  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connected, but db is undefined");

  const targets = ["films", "metrics", "yearcards", "insights", "libraryfilms"] as const;

  let total = 0;
  for (const name of targets) {
    const r = await db.collection(name).deleteMany({});
    const n = r.deletedCount ?? 0;
    total += n;
    console.log(`Deleted ${n} docs from '${name}'`);
  }

  console.log(`Done. Total deleted: ${total}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});


