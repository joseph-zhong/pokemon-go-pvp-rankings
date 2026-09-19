import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        ranks: resolve(import.meta.dirname, "ranks/index.html"),
        pvp: resolve(import.meta.dirname, "pvp/index.html"),
      },
    },
  },
  test: {
    environment: "node",
  },
});
