import { basename, extname } from "node:path/posix";

export const TARGET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".scss",
  ".html",
  ".svelte",
  ".vue",
]);

export const TARGET_FILENAMES: ReadonlySet<string> = new Set([
  "package.json",
  "angular.json",
  "svelte.config.js",
  "svelte.config.ts",
  "vue.config.js",
  "vue.config.ts",
]);

const DEPENDENCY_FILENAMES = new Set([
  ...TARGET_FILENAMES,
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "requirements.txt",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
]);

export function isTargetFile(filePath: string): boolean {
  return (
    TARGET_EXTENSIONS.has(extname(filePath).toLowerCase()) ||
    TARGET_FILENAMES.has(basename(filePath))
  );
}

export function isDependencyFile(filePath: string): boolean {
  return DEPENDENCY_FILENAMES.has(basename(filePath));
}
