import { defineConfig } from "vitest/config";

const workspaceTests = ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        // Fast, no database or network. `pnpm test`
        extends: true,
        test: {
          name: "unit",
          include: workspaceTests,
          exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
        },
      },
      {
        // Against the local Supabase database (`pnpm db:start`). `pnpm test:integration`
        extends: true,
        test: {
          name: "integration",
          include: [
            "packages/*/test/**/*.integration.test.ts",
            "apps/*/test/**/*.integration.test.ts",
          ],
          exclude: ["**/node_modules/**"],
          fileParallelism: false,
        },
      },
    ],
  },
});
