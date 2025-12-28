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
const order = ["films", "metrics", "years", "insights"];

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
  await connectMongo(uri);

  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connected, but db is undefined");

  for (const name of order) {
    const file = path.join(SNAP_DIR, `${name}.ejson`);
    const raw = await readFile(file, "utf8");
    const docs = EJSON.parse(raw) as unknown[];

    await db.collection(name).deleteMany({});
    if (docs.length) {
      await db.collection(name).insertMany(docs as never[], { ordered: false });
    }
    console.log(`[snapshot] restored ${name}: ${docs.length}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
