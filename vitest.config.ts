import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // "junit" emits ./junit.xml, consumed by Codecov's test_results upload
    // (report_type: test_results) in .github/workflows/ci.yaml.
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./junit.xml",
    },
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**"],
      // "lcov" emits ./coverage/lcov.info, consumed by Codecov's coverage
      // upload (report_type: coverage) in .github/workflows/ci.yaml.
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
  },
});
