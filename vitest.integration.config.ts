/// <reference types="vitest" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// See vitest.config.ts for why Astro's `getViteConfig` helper isn't used here.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Files share fixture state against one real local Supabase instance (tests/integration/fixtures/two-users.ts
    // seeds fixed emails); running files in parallel workers races two setupTwoUsers() calls against each other.
    fileParallelism: false,
  },
});
