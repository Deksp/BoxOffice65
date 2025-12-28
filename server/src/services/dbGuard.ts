import mongoose from "mongoose";

export function getDb() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected yet");
  return db;
}

