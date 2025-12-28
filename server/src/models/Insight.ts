import mongoose, { Schema } from "mongoose";

export interface InsightDoc {
  year?: number | null;
  filmIds: mongoose.Types.ObjectId[];
  title: string;
  text: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const InsightSchema = new Schema<InsightDoc>(
  {
    year: { type: Number, required: false, default: null },
    filmIds: [{ type: Schema.Types.ObjectId, ref: "Film", required: true }],
    title: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    tags: [{ type: String, required: true }],
  },
  { timestamps: true, collection: "insights" }
);

export const Insight =
  mongoose.models.Insight || mongoose.model<InsightDoc>("Insight", InsightSchema);
