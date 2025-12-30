import mongoose from "mongoose";

/**
 * LibraryFilm = "вторичная база" фильмов, которую пользователь наполняет вручную.
 * НЕ влияет на основную логику, пока фильм не импортирован в основную коллекцию `films`.
 */
const LibraryFilmSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    releaseYear: { type: Number, required: true },
    type: { type: String, enum: ["movie", "series"], default: "movie" },

    titleRu: { type: String },
    genres: { type: [String], default: [] },
    // Optional metrics-like fields to support offline import into main DB
    money: {
      budgetUsd: {
        selected: { type: Number, required: false },
      },
      grossWorldwideUsd: {
        selected: { type: Number, required: false },
      },
      grossDomesticUsd: {
        selected: { type: Number, required: false },
      },
    },
    ratings: {
      tmdb: {
        selected: { type: Number, required: false },
      },
      imdb: {
        selected: { type: Number, required: false },
      },
      metacritic: {
        selected: { type: Number, required: false },
      },
    },
    poster: {
      provider: { type: String, enum: ["tmdb", "stored"], required: false },
      path: { type: String, required: false },
    },
    // Offline poster storage (binary). IMPORTANT: exclude this field from JSON API responses.
    posterStored: {
      mime: { type: String, required: false },
      data: { type: Buffer, required: false },
    },
    external: {
      tmdbId: { type: Number, required: false },
      kinopoiskId: { type: Number, required: false },
      kinopoiskUrl: { type: String, required: false },
      tmdbUrl: { type: String, required: false },
    },
  },
  { timestamps: true, collection: "libraryfilms" }
);

// В библиотеке тоже полезно избегать дублей
LibraryFilmSchema.index({ releaseYear: 1, title: 1 }, { unique: true });
LibraryFilmSchema.index({ "external.tmdbId": 1 }, { unique: true, sparse: true });
LibraryFilmSchema.index({ title: "text", titleRu: "text" });

export const LibraryFilmModel = mongoose.model("LibraryFilm", LibraryFilmSchema);


