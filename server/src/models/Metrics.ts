import mongoose from "mongoose";

const MetricsSchema = new mongoose.Schema(
  {
    filmId: { type: mongoose.Schema.Types.ObjectId, ref: "Film", required: true },
    year: { type: Number, required: true },
    money: {
      budgetUsd: {
        selected: { type: Number, required: false }
      },
      grossWorldwideUsd: {
        selected: { type: Number, required: false }
      },
      grossDomesticUsd: {
        selected: { type: Number, required: false }
      }
    },
    ratings: {
      imdb: {
        selected: { type: Number, required: false }
      },
      metacritic: {
        selected: { type: Number, required: false }
      },
      tmdb: {
        selected: { type: Number, required: false }
      }
    }
  },
  { timestamps: true }
);

MetricsSchema.index({ filmId: 1, year: 1 }, { unique: true });

// Триггер: при обновлении метрик пересчитываем победителей года
MetricsSchema.post("findOneAndUpdate", async function (doc) {
  if (doc && doc.year) {
    try {
      const { recalcYear } = await import("../services/recalcYear.js");
      await recalcYear(doc.year);
      console.log(`[Trigger] Auto-recalculated year ${doc.year} after metrics update`);
    } catch (e) {
      console.error("[Trigger Error]", e);
    }
  }
});

MetricsSchema.post("save", async function (doc) {
  if (doc && doc.year) {
    try {
      const { recalcYear } = await import("../services/recalcYear.js");
      await recalcYear(doc.year);
      console.log(`[Trigger] Auto-recalculated year ${doc.year} after metrics save`);
    } catch (e) {
      console.error("[Trigger Error]", e);
    }
  }
});

export const MetricsModel = mongoose.model("Metrics", MetricsSchema);

