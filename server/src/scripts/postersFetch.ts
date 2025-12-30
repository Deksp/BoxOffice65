import "dotenv/config";
import mongoose from "mongoose";
import fetch from "node-fetch";
import { connectMongo } from "../db.js";

type Args = {
  includeLibrary: boolean;
  limit: number;
  concurrency: number;
  sizeLimitBytes: number;
  timeoutMs: number;
  retries: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const includeLibrary = argv.includes("--include-library");

  const getNum = (name: string, def: number) => {
    const i = argv.indexOf(name);
    if (i === -1) return def;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) ? v : def;
  };

  return {
    includeLibrary,
    limit: getNum("--limit", 10_000),
    concurrency: Math.min(8, Math.max(1, getNum("--concurrency", 3))),
    sizeLimitBytes: getNum("--max-bytes", 2_000_000),
    timeoutMs: getNum("--timeout-ms", 20_000),
    retries: Math.min(5, Math.max(0, getNum("--retries", 2))),
  };
}

function errDetails(e: unknown) {
  const anyE = e as any;
  const parts: string[] = [];
  if (anyE?.name) parts.push(String(anyE.name));
  if (anyE?.code) parts.push(`code=${String(anyE.code)}`);
  if (anyE?.errno) parts.push(`errno=${String(anyE.errno)}`);
  if (anyE?.type) parts.push(`type=${String(anyE.type)}`);
  if (anyE?.message) parts.push(String(anyE.message));
  if (anyE?.cause?.code) parts.push(`cause.code=${String(anyE.cause.code)}`);
  if (anyE?.cause?.message) parts.push(`cause=${String(anyE.cause.message)}`);
  const s = parts.filter(Boolean).join(" | ");
  return s || String(e);
}

async function fetchPosterBytes(posterPath: string, timeoutMs: number) {
  const url = `https://image.tmdb.org/t/p/w342${posterPath}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const r = await fetch(url, {
    signal: ac.signal as any,
    headers: {
      // Some networks/proxies behave better with explicit UA
      "user-agent": "boxoffice65-posters-fetch/1.0",
      "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  clearTimeout(t);
  if (!r.ok) throw new Error(`HTTP ${r.status} while fetching ${url}`);
  const mime = r.headers.get("content-type") || "image/jpeg";
  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);
  return { mime, buf };
}

async function main() {
  const args = parseArgs();
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
  await connectMongo(uri);

  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connected, but db is undefined");

  const targets = args.includeLibrary ? ["films", "libraryfilms"] : ["films"];
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const colName of targets) {
    const col = db.collection(colName);

    const cursor = col
      .find(
        {
          "poster.path": { $type: "string" },
          $or: [{ posterStored: { $exists: false } }, { "posterStored.data": { $exists: false } }],
        },
        { projection: { _id: 1, poster: 1 } }
      )
      .limit(args.limit);

    const docs = await cursor.toArray();
    console.log(`[posters] ${colName}: candidates=${docs.length}`);

    let idx = 0;
    const worker = async () => {
      while (true) {
        const cur = idx++;
        if (cur >= docs.length) return;
        const d: any = docs[cur];
        const posterPath: string | undefined = d?.poster?.path;
        if (!posterPath) {
          totalSkipped++;
          continue;
        }

        try {
          let lastErr: unknown = null;
          for (let attempt = 0; attempt <= args.retries; attempt++) {
            try {
              const { mime, buf } = await fetchPosterBytes(posterPath, args.timeoutMs);
              if (buf.length > args.sizeLimitBytes) {
                totalSkipped++;
                return;
              }

              await col.updateOne(
                { _id: d._id },
                {
                  $set: {
                    poster: { provider: "stored", path: posterPath },
                    posterStored: { mime, data: buf },
                    updatedAt: new Date(),
                  },
                }
              );
              totalUpdated++;
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e;
              if (attempt < args.retries) {
                // small backoff
                await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
              }
            }
          }

          if (lastErr) throw lastErr;
        } catch (e) {
          totalFailed++;
          console.warn(`[posters] FAIL ${colName} ${String(d._id)}: ${errDetails(e)}`);
        }
      }
    };

    await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  }

  console.log(
    `[posters] done: updated=${totalUpdated} skipped=${totalSkipped} failed=${totalFailed} (targets=${targets.join(",")})`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


