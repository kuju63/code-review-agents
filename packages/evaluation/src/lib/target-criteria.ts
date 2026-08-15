export const ALLOWED_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".html",
] as const;

export const SPECIAL_FILES = new Set([
  "package.json",
  "angular.json",
  "svelte.config.js",
  "svelte.config.ts",
  "vue.config.js",
  "vue.config.ts",
]);

const TEST_PATH_PATTERNS = [
  "/__tests__/",
  "/__test__/",
  "/test_",
  "_test.",
  "/tests/",
  "/test/",
  "/e2e/",
  "/cypress/",
  "/__mocks__/",
] as const;

const DOC_SUFFIXES = [".md", ".mdx", ".rst", ".txt"] as const;
const DOC_PATH_PATTERNS = ["/docs/", "/documentation/"] as const;

function normalizedPath(path: string): string {
  return `/${path.replaceAll("\\", "/").replace(/^\/+/, "")}`;
}

export function isTestFile(path: string): boolean {
  const normalized = normalizedPath(path).toLowerCase();
  if (TEST_PATH_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const parts = filename.split(".");
  return parts.length > 1 && parts.slice(0, -1).some((part) => part === "test" || part === "spec");
}

export function isDocFile(path: string): boolean {
  const normalized = normalizedPath(path).toLowerCase();
  return (
    DOC_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
    DOC_PATH_PATTERNS.some((pattern) => normalized.includes(pattern))
  );
}

export function isProductionCodeFile(path: string): boolean {
  if (!path || isTestFile(path) || isDocFile(path)) {
    return false;
  }
  const normalized = normalizedPath(path);
  const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    SPECIAL_FILES.has(filename) || ALLOWED_EXTENSIONS.some((extension) => path.endsWith(extension))
  );
}

export function hasProductionCodeChange(files: readonly Record<string, unknown>[]): boolean {
  return files.some(
    (file) =>
      Boolean(file.patch) &&
      typeof file.filename === "string" &&
      isProductionCodeFile(file.filename),
  );
}

export function isQualifyingInlineComment(comment: Record<string, unknown>): boolean {
  return (
    typeof comment.body === "string" &&
    comment.body.trim().length > 0 &&
    typeof comment.path === "string" &&
    isProductionCodeFile(comment.path)
  );
}

export function hasInlineReviewComments(comments: readonly Record<string, unknown>[]): boolean {
  return comments.some(isQualifyingInlineComment);
}
