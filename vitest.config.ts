import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Defining `projects` turns this root config into a bundler only; it no
    // longer runs tests itself, so the node-side include/exclude has to live
    // inside the "node" project entry below.
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/**/*.test.ts"],
          // packages/web has its own project (happy-dom + React plugin chain)
          // referenced below. Keep this exclude even though *.test.ts never
          // matches *.tsx today: it stops a future plain .test.ts under
          // packages/web/src from being picked up by both projects and
          // running without happy-dom.
          exclude: ["**/node_modules/**", "**/dist/**", "packages/web/**"],
        },
      },
      "packages/web/vitest.config.ts",
    ],
    // "junit" emits ./junit.xml, consumed by Codecov's test_results upload
    // (report_type: test_results) in .github/workflows/ci.yaml.
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./junit.xml",
    },
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/dist/**", "packages/web/src/main.tsx"],
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
