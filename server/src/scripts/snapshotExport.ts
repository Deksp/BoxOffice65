import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// .env is in server root. script is in server/src/scripts.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { mkdir, writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { EJSON } from "bson";
import { connectMongo } from "../db.js";

const SNAP_DIR = path.resolve(process.cwd(), "seed", "snapshot");

// ВАЖНО: названия коллекций должны совпадать с реальными в Mongo
const collections = ["films", "metrics", "years", "insights"];

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
  await connectMongo(uri);

  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connected, but db is undefined");

  await mkdir(SNAP_DIR, { recursive: true });

  for (const name of collections) {
    const docs = await db.collection(name).find({}).toArray();
    const out = EJSON.stringify(docs, { relaxed: false }); // сохраняет ObjectId/Date корректно
    await writeFile(path.join(SNAP_DIR, `${name}.ejson`), out, "utf8");
    console.log(`[snapshot] exported ${name}: ${docs.length}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
