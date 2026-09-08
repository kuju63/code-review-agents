import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Registered manually via @happy-dom/global-registrator in test/setup.ts
      // instead of Vitest's own happy-dom pool: that pool's copy of the window
      // onto globalThis skips localStorage because Node's own (inert, opt-in)
      // global shadows it first. The registrator handles that conflict itself.
      environment: "node",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/main.tsx", "src/i18next.ts"],
        reporter: ["text", "html", "lcov"],
      },
    },
  }),
);
