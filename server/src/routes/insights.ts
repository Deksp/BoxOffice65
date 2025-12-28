import { Router } from "express";
import { Insight } from "../models/Insight.js";

const router = Router();

/**
 * GET /api/years/:year/insights
 * Возвращает:
 * - общие insights (year=null)
 * - insights конкретного года
 */
router.get("/:year/insights", async (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isFinite(year)) return res.status(400).json({ error: "Invalid year" });

  const items = await Insight.find({
    $or: [{ year: null }, { year }],
  })
    .sort({ year: 1, title: 1 })
    .lean();

  res.json(items);
});

export default router;
