import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        ranks: resolve(__dirname, "ranks/index.html"),
        pvp: resolve(__dirname, "pvp/index.html"),
      },
    },
  },
  test: {
    environment: "node",
  },
});
