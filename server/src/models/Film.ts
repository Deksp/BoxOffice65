import mongoose from "mongoose";

const FilmSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    releaseYear: { type: Number, required: true },
    type: { type: String, enum: ["movie", "series"], default: "movie" },

    titleRu: { type: String },
    genres: { type: [String], default: [] },
    poster: {
      provider: { type: String, enum: ["tmdb"], required: false },
      path: { type: String, required: false }
    },
    external: {
      tmdbId: { type: Number, required: false },
      kinopoiskId: { type: Number, required: false },
      kinopoiskUrl: { type: String, required: false }
    }
  },
  { timestamps: true }
);

FilmSchema.index({ releaseYear: 1, title: 1 }, { unique: true });
FilmSchema.index({ "external.tmdbId": 1 }, { unique: true, sparse: true });
FilmSchema.index({ "external.kinopoiskId": 1 }, { unique: true, sparse: true });
FilmSchema.index({ title: "text", titleRu: "text" });

export const FilmModel = mongoose.model("Film", FilmSchema);
