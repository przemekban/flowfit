/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Not using Astro's `getViteConfig` helper here: it pulls in the
// @astrojs/cloudflare adapter's Vite plugin, which rejects Vitest's "ssr"
// test environment (validateWorkerEnvironmentOptions throws on
// resolve.external). The project only has one path alias, so it's
// replicated directly instead of pulling in the full app Vite config.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
