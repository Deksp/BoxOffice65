import { YearCardModel } from "../models/YearCard.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function ensureSeededFromSnapshot() {
  const yearsCount = await YearCardModel.estimatedDocumentCount();
  if (yearsCount > 0) return;

  // вызываем импорт как отдельный скрипт (чтобы не плодить циклы импортов)
  // передаем env, чтобы скрипт видел переменные окружения родителя (если они там есть)
  await execFileAsync("node", ["--no-warnings", "--loader", "tsx", "src/scripts/snapshotImport.ts"], {
    cwd: process.cwd(),
    env: process.env,
  });

  console.log("[seed] database was empty -> restored from snapshot");
}
