import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../services/dbGuard.js";

const router = Router();

/**
 * GET /api/posters/:id
 * Returns binary poster stored in MongoDB (offline-safe).
 *
 * Looks up by _id in:
 *  - films
 *  - libraryfilms
 *
 * IMPORTANT: we store poster bytes in posterStored.data.
 */
router.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");

  const db = getDb();
  const oid = new ObjectId(id);

  const projection = { projection: { posterStored: 1 } } as const;
  const film =
    (await db.collection("films").findOne({ _id: oid }, projection as any)) ??
    (await db.collection("libraryfilms").findOne({ _id: oid }, projection as any));

  const ps = (film as any)?.posterStored;
  const data: Buffer | undefined = ps?.data;
  const mime: string | undefined = ps?.mime;

  if (!data || !Buffer.isBuffer(data) || data.length === 0) return res.status(404).send("Poster not found");

  res.setHeader("Content-Type", mime || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(data);
});

export default router;


