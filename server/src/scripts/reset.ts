import "dotenv/config";
import { connectMongo } from "../db.js";
import { FilmModel } from "../models/Film.js";
import { YearCardModel } from "../models/YearCard.js";
import { MetricsModel } from "../models/Metrics.js";

async function run() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/boxoffice65";
  await connectMongo(uri);

  const filmResult = await FilmModel.deleteMany({});
  const yearCardResult = await YearCardModel.deleteMany({});
  const metricsResult = await MetricsModel.deleteMany({});

  console.log(`Deleted: ${filmResult.deletedCount} films, ${yearCardResult.deletedCount} yearCards, ${metricsResult.deletedCount} metrics`);

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

