import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Match Next.js's automatic JSX runtime so .tsx component files (which do
  // not import React explicitly) can be server-rendered in tests.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/server-only.ts"),
    },
  },
});
