import mongoose from "mongoose";

const YearCardSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, unique: true },
    winners: {
      topDomesticFilmId: { type: mongoose.Schema.Types.ObjectId, ref: "Film" },
      topWorldwideFilmId: { type: mongoose.Schema.Types.ObjectId, ref: "Film" },
      mostExpensiveFilmId: { type: mongoose.Schema.Types.ObjectId, ref: "Film" }
    },
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

export const YearCardModel = mongoose.model("YearCard", YearCardSchema);
