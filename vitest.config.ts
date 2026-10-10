import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000,
    hookTimeout: 30000,
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "coverage"
    }
  }
});
