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
    // Every integration test file seeds/tears down the same two hardcoded identities via
    // tests/integration/fixtures/two-users.ts (setupTwoUsers/teardownTwoUsers) against one shared
    // local Supabase instance. Running files in parallel workers races two independent
    // create-user/sign-in/delete-user sequences against the same auth.users rows, surfacing as
    // spurious "Database error creating/granting user" failures unrelated to the code under test.
    fileParallelism: false,
  },
});
