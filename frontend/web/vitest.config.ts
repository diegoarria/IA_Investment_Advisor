import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Nuvos Plus Fase 4C-2: Diego's explicit requirement — "No limitar la
// verificación a TypeScript y build" — real component interaction tests
// (render, click, type, assert DOM), not just type-checking. Every prior
// .test.ts file in this project exercises plain lib/ functions (no JSX,
// no DOM) under vitest's default node environment; this config adds the
// jsdom environment + React plugin only .test.tsx files actually need,
// without changing how any existing .test.ts file runs.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
