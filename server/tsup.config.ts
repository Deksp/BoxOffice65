import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  // ВАЖНО: Не бандлить node_modules, иначе Mongoose/MongoDB упадут с ошибкой Dynamic Require
  skipNodeModulesBundle: true,
  target: "node18",
  shims: true, // Добавляет __dirname и __filename для ESM
});
