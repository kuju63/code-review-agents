import { describe, expect, it } from "vitest";
import {
  isDependencyFile,
  isTargetFile,
  TARGET_EXTENSIONS,
  TARGET_FILENAMES,
} from "./target-file.js";

describe("target file classification", () => {
  it.each([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".svelte", ".vue"])(
    "exports and accepts %s",
    (extension) => {
      expect(TARGET_EXTENSIONS.has(extension)).toBe(true);
      expect(isTargetFile(`src/file${extension.toUpperCase()}`)).toBe(true);
    },
  );

  it.each([
    "package.json",
    "angular.json",
    "svelte.config.js",
    "svelte.config.ts",
    "vue.config.js",
    "vue.config.ts",
  ])("exports and accepts special filename %s", (filename) => {
    expect(TARGET_FILENAMES.has(filename)).toBe(true);
    expect(isTargetFile(`nested/${filename}`)).toBe(true);
  });

  it.each(["README.md", "src/main.py", "package.json.bak", "src/angular.json.bak"])(
    "rejects non-target %s",
    (path) => {
      expect(isTargetFile(path)).toBe(false);
    },
  );
});

describe("dependency file classification", () => {
  it.each([
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "pyproject.toml",
    "requirements.txt",
    "poetry.lock",
    "Pipfile",
    "Pipfile.lock",
  ])("accepts dependency basename %s", (filename) => {
    expect(isDependencyFile(`nested/${filename}`)).toBe(true);
  });

  it.each(["src/index.ts", "package.json.bak", "requirements.txt.old"])(
    "rejects non-dependency %s",
    (path) => {
      expect(isDependencyFile(path)).toBe(false);
    },
  );
});
