import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GithubMcpConnectionError } from "../tools/github-mcp.js";
import type { PRInfoCollectorConfig } from "./pr-info-collector.js";

const { mockAgentCtor, mockAgentInvoke, mockCreateGithubMcpClient, mockCreateModelProvider } =
  vi.hoisted(() => {
    const mockAgentInvoke = vi.fn();
    const mockAgentCtor = vi.fn().mockImplementation((config: unknown) => ({
      __config: config,
      invoke: mockAgentInvoke,
    }));
    const mockCreateGithubMcpClient = vi.fn();
    const mockCreateModelProvider = vi.fn().mockReturnValue({ __model: true });
    return { mockAgentCtor, mockAgentInvoke, mockCreateGithubMcpClient, mockCreateModelProvider };
  });

vi.mock("@strands-agents/sdk", async () => {
  const actual = await vi.importActual<typeof import("@strands-agents/sdk")>("@strands-agents/sdk");
  return { ...actual, Agent: mockAgentCtor };
});

vi.mock("../tools/github-mcp.js", async () => {
  const actual =
    await vi.importActual<typeof import("../tools/github-mcp.js")>("../tools/github-mcp.js");
  return { ...actual, createGithubMcpClient: mockCreateGithubMcpClient };
});

vi.mock("./model-provider-factory.js", async () => {
  const actual = await vi.importActual<typeof import("./model-provider-factory.js")>(
    "./model-provider-factory.js",
  );
  return { ...actual, createModelProvider: mockCreateModelProvider };
});

const { PRInfoCollector, isTargetFile, isDependencyFile } = await import("./pr-info-collector.js");

const PR_DETAILS = {
  title: "Add feature",
  number: 42,
  body: "Does the thing",
  labels: ["scope: progress"],
  head: { sha: "abc123sha", ref: "feature-branch" },
};

function mcpTextResult(text: string, isError = false) {
  return { content: [{ text }], isError };
}
function mcpJsonResult(data: unknown, isError = false) {
  return { content: [{ text: JSON.stringify(data) }], isError };
}
function mcpErrorResult(message: string) {
  return { content: [{ text: message }], isError: true };
}

interface DispatchConfig {
  prDetails?: unknown;
  filesPages?: Record<string, unknown>[][];
  directoryListings?: Record<string, Record<string, unknown>[]>;
  fileTexts?: Record<string, string>;
  onCall?: (toolName: string, args: Record<string, unknown>) => unknown | undefined;
}

function createDispatch(config: DispatchConfig = {}) {
  const prDetails = config.prDetails ?? PR_DETAILS;
  const filesPages = config.filesPages ?? [[]];
  const directoryListings = config.directoryListings ?? {};
  const fileTexts = config.fileTexts ?? {};

  return vi.fn((toolName: string, args: Record<string, unknown>) => {
    const override = config.onCall?.(toolName, args);
    if (override !== undefined) {
      return override;
    }
    if (toolName === "pull_request_read" && args.method === "get") {
      return mcpJsonResult(prDetails);
    }
    if (toolName === "pull_request_read" && args.method === "get_files") {
      const pageIndex = Number(args.page) - 1;
      return mcpJsonResult(filesPages[pageIndex] ?? []);
    }
    if (toolName === "get_file_contents") {
      const path = String(args.path);
      if (path in directoryListings) {
        return mcpJsonResult(directoryListings[path]);
      }
      const text = fileTexts[path];
      if (text !== undefined) {
        return mcpTextResult(text);
      }
      return mcpErrorResult(`Not Found: ${path}`);
    }
    throw new Error(`Unexpected tool call in test: ${toolName} ${JSON.stringify(args)}`);
  });
}

function makeMcpClient(dispatch: ReturnType<typeof createDispatch>) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listTools: vi
      .fn()
      .mockResolvedValue([{ name: "pull_request_read" }, { name: "get_file_contents" }]),
    callTool: vi.fn((tool: { name: string }, args: Record<string, unknown>) =>
      dispatch(tool.name, args),
    ),
  };
}

const BASE_CONFIG: PRInfoCollectorConfig = { githubToken: "test-token" };

beforeEach(() => {
  mockAgentCtor.mockClear();
  mockAgentInvoke.mockReset().mockResolvedValue({ toString: () => "A concise summary." });
  mockCreateGithubMcpClient.mockClear();
  mockCreateModelProvider.mockClear();
});

describe("isTargetFile", () => {
  it.each([
    ["src/App.tsx", true],
    ["src/App.TSX", true],
    ["styles/main.scss", true],
    ["package.json", true],
    ["angular.json", true],
    ["README.md", false],
    ["src/App.py", false],
  ])("%s -> %s", (path, expected) => {
    expect(isTargetFile(path)).toBe(expected);
  });
});

describe("isDependencyFile", () => {
  it.each([
    ["package.json", true],
    ["package-lock.json", true],
    ["pnpm-lock.yaml", true],
    ["pyproject.toml", true],
    ["src/index.ts", false],
  ])("%s -> %s", (path, expected) => {
    expect(isDependencyFile(path)).toBe(expected);
  });
});

describe("PRInfoCollector.collect", () => {
  it("collects PR metadata, filtered file changes, and dependency/manifest data deterministically", async () => {
    const dispatch = createDispatch({
      filesPages: [
        [
          { filename: "src/App.tsx", patch: "+added line" },
          { filename: "README.md", patch: "+doc change" },
          { filename: "src/App.py", patch: "+ignored" },
        ],
      ],
      directoryListings: {
        "/": [
          { type: "file", path: "package.json" },
          { type: "file", path: "yarn.lock" },
          { type: "dir", path: "packages" },
        ],
      },
      fileTexts: {
        "README.md": "# Demo\nA demo project.",
        "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      },
    });
    const client = makeMcpClient(dispatch);
    mockCreateGithubMcpClient.mockReturnValue(client);

    const collector = new PRInfoCollector(BASE_CONFIG);
    const result = await collector.collect("octocat", "hello-world", 42);

    expect(result.repositoryInfo).toEqual({ owner: "octocat", repository: "hello-world" });
    expect(result.prInfo.title).toBe("Add feature");
    expect(result.prInfo.prNumber).toBe(42);
    expect(result.prInfo.body).toBe("Does the thing");
    expect(result.prInfo.labels).toEqual(["scope: progress"]);
    // Only target files survive filtering; README.md and src/App.py are dropped.
    expect(result.prInfo.fileChanges).toEqual([{ filePath: "src/App.tsx", patch: "+added line" }]);
    // dependencyFiles comes from the repo-root listing (yarn.lock included,
    // "packages" dir excluded), not from the changed-file list.
    expect(result.dependencyFiles).toEqual(["package.json", "yarn.lock"]);
    // yarn.lock is never fetched for content even though it is a dependency file.
    expect(result.manifestContents).toEqual({
      "package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    });
    expect(result.projectSummary).toBe("A concise summary.");

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("pins repo-content reads to the PR head SHA", async () => {
    const dispatch = createDispatch({ directoryListings: { "/": [] } });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    const readmeCall = dispatch.mock.calls.find(
      ([toolName, args]) => toolName === "get_file_contents" && args.path === "README.md",
    );
    expect(readmeCall?.[1]).toMatchObject({ ref: "abc123sha" });
  });

  it("falls back to the head ref when no SHA is present", async () => {
    const dispatch = createDispatch({
      prDetails: { ...PR_DETAILS, head: { ref: "feature-branch" } },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    const readmeCall = dispatch.mock.calls.find(
      ([toolName, args]) => toolName === "get_file_contents" && args.path === "README.md",
    );
    expect(readmeCall?.[1]).toMatchObject({ ref: "feature-branch" });
  });

  it("omits the ref argument when no head ref is available", async () => {
    const dispatch = createDispatch({
      prDetails: { ...PR_DETAILS, head: {} },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    const readmeCall = dispatch.mock.calls.find(
      ([toolName, args]) => toolName === "get_file_contents" && args.path === "README.md",
    );
    expect(readmeCall?.[1]).not.toHaveProperty("ref");
  });

  it("omits the ref argument when head is not an object", async () => {
    const dispatch = createDispatch({
      prDetails: { ...PR_DETAILS, head: "not-an-object" },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    const readmeCall = dispatch.mock.calls.find(
      ([toolName, args]) => toolName === "get_file_contents" && args.path === "README.md",
    );
    expect(readmeCall?.[1]).not.toHaveProperty("ref");
  });

  it("extracts label names from both string and {name} object shapes", async () => {
    const dispatch = createDispatch({
      prDetails: {
        ...PR_DETAILS,
        labels: ["scope: progress", { name: "bug" }, { color: "red" }],
      },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.prInfo.labels).toEqual(["scope: progress", "bug"]);
  });

  it("treats a non-array labels field as no labels", async () => {
    const dispatch = createDispatch({
      prDetails: { ...PR_DETAILS, labels: "not-an-array" },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.prInfo.labels).toEqual([]);
  });

  it("defaults PR metadata when the pull_request_read tool returns no text content", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [] },
      onCall: (toolName, args) => {
        if (toolName === "pull_request_read" && args.method === "get") {
          return { content: [], isError: false };
        }
        return undefined;
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 99);

    expect(result.prInfo).toMatchObject({ title: "", prNumber: 99, body: null, labels: [] });
  });

  it("falls back to patch: null for a changed file with no patch field", async () => {
    const dispatch = createDispatch({
      filesPages: [[{ filename: "src/Icon.tsx" }]],
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.prInfo.fileChanges).toEqual([{ filePath: "src/Icon.tsx", patch: null }]);
  });

  it("treats a malformed (non-object) MCP tool result as producing no text blocks", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [] },
      onCall: (toolName, args) => {
        if (toolName === "get_file_contents" && args.path === "README.md") {
          return "not-an-object";
        }
        return undefined;
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.projectSummary).toBe("");
    expect(mockAgentCtor).not.toHaveBeenCalled();
  });

  it("ignores content blocks without a text field", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [] },
      onCall: (toolName, args) => {
        if (toolName === "get_file_contents" && args.path === "README.md") {
          return { content: [{ notText: true }], isError: false };
        }
        return undefined;
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.projectSummary).toBe("");
    expect(mockAgentCtor).not.toHaveBeenCalled();
  });

  it("returns an empty dependency-file list when the repo-root listing is unavailable", async () => {
    const dispatch = createDispatch();
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.dependencyFiles).toEqual([]);
  });

  it("returns an empty listing when the directory-listing tool returns no text content", async () => {
    const dispatch = createDispatch({
      onCall: (toolName, args) => {
        if (toolName === "get_file_contents" && args.path === "/") {
          return { content: [], isError: false };
        }
        return undefined;
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.dependencyFiles).toEqual([]);
  });

  it("returns an empty listing when the directory-listing text is not valid JSON", async () => {
    const dispatch = createDispatch({
      onCall: (toolName, args) => {
        if (toolName === "get_file_contents" && args.path === "/") {
          return mcpTextResult("not json");
        }
        return undefined;
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.dependencyFiles).toEqual([]);
  });

  it("skips workspace resolution when the root package.json is not valid JSON", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "package.json" }] },
      fileTexts: { "package.json": "not valid json {" },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.manifestContents).toEqual({ "package.json": "not valid json {" });
  });

  it("skips workspace resolution when the root package.json does not parse to an object", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "package.json" }] },
      fileTexts: { "package.json": JSON.stringify(["not", "an", "object"]) },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(Object.keys(result.manifestContents)).toEqual(["package.json"]);
  });

  it("pages through get_files until a short page signals the end", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `src/file-${i}.ts`,
      patch: "+x",
    }));
    const page2 = [{ filename: "src/file-100.ts", patch: "+y" }];
    const dispatch = createDispatch({
      filesPages: [page1, page2],
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.prInfo.fileChanges).toHaveLength(101);
    const pageArgs = dispatch.mock.calls
      .filter(([toolName, args]) => toolName === "pull_request_read" && args.method === "get_files")
      .map(([, args]) => args.page);
    expect(pageArgs).toEqual([1, 2]);
  });

  it("resolves workspace package.json paths via a trailing /* glob and merges their dependency names", async () => {
    const dispatch = createDispatch({
      directoryListings: {
        "/": [{ type: "file", path: "package.json" }],
        packages: [
          { type: "dir", path: "packages/app" },
          { type: "file", path: "packages/README.md" },
        ],
      },
      fileTexts: {
        "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "packages/app/package.json": JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.manifestContents).toEqual({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/app/package.json": JSON.stringify({ dependencies: { vue: "^3.0.0" } }),
    });
  });

  it("resolves yarn's {packages: [...]} workspace object form", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "package.json" }] },
      fileTexts: {
        "package.json": JSON.stringify({ workspaces: { packages: ["apps/web"] } }),
        "apps/web/package.json": JSON.stringify({ dependencies: { react: "^18.0.0" } }),
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.manifestContents["apps/web/package.json"]).toBe(
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    );
  });

  it("rejects path-traversal-looking or absolute workspace patterns", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "package.json" }] },
      fileTexts: {
        "package.json": JSON.stringify({ workspaces: ["../evil", "/abs/path", "packages/core"] }),
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    // Only the exact, non-traversal pattern resolves; "../evil" and
    // "/abs/path" never reach get_file_contents as a path argument.
    expect(result.manifestContents).toEqual({
      "package.json": JSON.stringify({ workspaces: ["../evil", "/abs/path", "packages/core"] }),
    });
    expect(dispatch.mock.calls.some(([, args]) => args.path === "../evil")).toBe(false);
    expect(dispatch.mock.calls.some(([, args]) => args.path === "/abs/path")).toBe(false);
  });

  it("caps workspace glob patterns and resolved packages", async () => {
    const manyGlobs = Array.from({ length: 15 }, (_, i) => `group-${i}/*`);
    const listings: Record<string, Record<string, unknown>[]> = {
      "/": [{ type: "file", path: "package.json" }],
    };
    // Only the first MAX_WORKSPACE_GLOBS (10) prefixes are ever listed; each
    // yields 3 packages so the resolved count (30) exceeds
    // MAX_WORKSPACE_PACKAGES (20) and must be capped.
    for (let i = 0; i < 10; i += 1) {
      listings[`group-${i}`] = [
        { type: "dir", path: `group-${i}/pkg-a` },
        { type: "dir", path: `group-${i}/pkg-b` },
        { type: "dir", path: `group-${i}/pkg-c` },
      ];
    }
    const dispatch = createDispatch({
      directoryListings: listings,
      fileTexts: { "package.json": JSON.stringify({ workspaces: manyGlobs }) },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(dispatch.mock.calls.some(([, args]) => args.path === "group-10")).toBe(false);
    const workspacePackageJsonReads = dispatch.mock.calls.filter(
      ([toolName, args]) =>
        toolName === "get_file_contents" &&
        typeof args.path === "string" &&
        args.path.endsWith("/package.json") &&
        args.path !== "package.json",
    );
    expect(workspacePackageJsonReads).toHaveLength(20);
  });

  it("skips nested or multi-wildcard workspace globs", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "package.json" }] },
      fileTexts: { "package.json": JSON.stringify({ workspaces: ["packages/**", "a/*/b"] }) },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(Object.keys(result.manifestContents)).toEqual(["package.json"]);
  });

  it("falls back to lock file content only when no package.json yielded dependency names", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "package-lock.json" }] },
      fileTexts: {
        "package-lock.json": JSON.stringify({
          packages: { "": { dependencies: { lodash: "^4" } } },
        }),
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.manifestContents).toEqual({
      "package-lock.json": JSON.stringify({
        packages: { "": { dependencies: { lodash: "^4" } } },
      }),
    });
  });

  it("does not fall back to lock file content when package.json yielded dependency names", async () => {
    const dispatch = createDispatch({
      directoryListings: {
        "/": [
          { type: "file", path: "package.json" },
          { type: "file", path: "package-lock.json" },
        ],
      },
      fileTexts: {
        "package.json": JSON.stringify({ dependencies: { react: "^18" } }),
        "package-lock.json": JSON.stringify({
          packages: { "": { dependencies: { react: "^18" } } },
        }),
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(Object.keys(result.manifestContents)).toEqual(["package.json"]);
  });

  it("never fetches yarn.lock content even as a fallback", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "yarn.lock" }] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.manifestContents).toEqual({});
    expect(dispatch.mock.calls.some(([, args]) => args.path === "yarn.lock")).toBe(false);
  });

  it("re-throws when the repo-root directory listing hits an infra error", async () => {
    const dispatch = createDispatch({
      onCall: (toolName, args) => {
        if (toolName === "get_file_contents" && args.path === "/") {
          throw new GithubMcpConnectionError("connection lost");
        }
        return undefined;
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await expect(
      new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42),
    ).rejects.toThrow("connection lost");
  });

  it("re-throws when the root package.json read hits an infra error, without fetching workspaces", async () => {
    const dispatch = createDispatch({
      directoryListings: { "/": [{ type: "file", path: "package.json" }] },
      onCall: (toolName, args) => {
        if (toolName === "get_file_contents" && args.path === "package.json") {
          throw new GithubMcpConnectionError("connection lost");
        }
        return undefined;
      },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await expect(
      new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42),
    ).rejects.toThrow("connection lost");
  });

  it("falls back to patch: null when the total patch size exceeds the character limit", async () => {
    const dispatch = createDispatch({
      filesPages: [[{ filename: "src/App.tsx", patch: "x".repeat(50) }]],
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const collector = new PRInfoCollector({ ...BASE_CONFIG, patchTotalCharLimit: 10 });
    const result = await collector.collect("octocat", "hello-world", 42);

    expect(result.prInfo.fileChanges).toEqual([{ filePath: "src/App.tsx", patch: null }]);
  });

  it("falls back to patch: null when the target file count exceeds patchMaxFiles", async () => {
    const files = Array.from({ length: 3 }, (_, i) => ({
      filename: `src/file-${i}.tsx`,
      patch: "+x",
    }));
    const dispatch = createDispatch({
      filesPages: [files],
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const collector = new PRInfoCollector({ ...BASE_CONFIG, patchMaxFiles: 2 });
    const result = await collector.collect("octocat", "hello-world", 42);

    expect(result.prInfo.fileChanges.every((f) => f.patch === null)).toBe(true);
  });

  it("does not call the summarization Agent when the README is unavailable", async () => {
    const dispatch = createDispatch({ directoryListings: { "/": [] } });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.projectSummary).toBe("");
    expect(mockAgentCtor).not.toHaveBeenCalled();
  });

  it("falls back to an empty summary when the README summary call fails non-infra", async () => {
    const dispatch = createDispatch({
      fileTexts: { "README.md": "# Demo" },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));
    mockAgentInvoke.mockRejectedValue(new Error("model refused"));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.projectSummary).toBe("");
  });

  it("re-throws when the README summary call fails with an infra error", async () => {
    const dispatch = createDispatch({
      fileTexts: { "README.md": "# Demo" },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));
    mockAgentInvoke.mockRejectedValue(new GithubMcpConnectionError("connection lost"));

    await expect(
      new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42),
    ).rejects.toThrow("connection lost");
  });

  it("truncates the README to README_MAX_CHARS before summarizing", async () => {
    const longReadme = "x".repeat(7000);
    const dispatch = createDispatch({
      fileTexts: { "README.md": longReadme },
      directoryListings: { "/": [] },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    const [promptArg] = mockAgentInvoke.mock.calls[0] as [string, unknown];
    expect(promptArg).toHaveLength(6000);
  });

  it("disconnects even when connect() fails", async () => {
    const dispatch = createDispatch();
    const client = makeMcpClient(dispatch);
    client.connect.mockRejectedValue(new Error("connect failed"));
    mockCreateGithubMcpClient.mockReturnValue(client);

    await expect(
      new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42),
    ).rejects.toThrow("connect failed");
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("throws when the MCP server does not advertise a required tool", async () => {
    const dispatch = createDispatch();
    const client = makeMcpClient(dispatch);
    client.listTools.mockResolvedValue([]);
    mockCreateGithubMcpClient.mockReturnValue(client);

    await expect(
      new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42),
    ).rejects.toThrow("GitHub MCP tool not found: pull_request_read");
  });

  it("keeps all file paths verbatim from the MCP payload (no hallucination)", async () => {
    const distinctivePath = "src/weird-XYZ_987.component.tsx";
    const dispatch = createDispatch({
      filesPages: [[{ filename: distinctivePath, patch: "+z" }]],
      directoryListings: { "/": [{ type: "file", path: "package.json" }] },
      fileTexts: { "package.json": "{}" },
    });
    mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

    const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

    expect(result.prInfo.fileChanges[0]?.filePath).toBe(distinctivePath);
    expect(Object.keys(result.manifestContents)).toEqual(["package.json"]);
  });

  describe("PR_INFO_COLLECTOR_RESPONSE_FILE", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "pr-info-collector-test-"));
    });

    afterEach(() => {
      delete process.env.PR_INFO_COLLECTOR_RESPONSE_FILE;
      rmSync(dir, { recursive: true, force: true });
    });

    it("writes the collected result to the configured path", async () => {
      const outputPath = join(dir, "nested", "response.json");
      process.env.PR_INFO_COLLECTOR_RESPONSE_FILE = outputPath;
      const dispatch = createDispatch({ directoryListings: { "/": [] } });
      mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));

      const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

      expect(existsSync(outputPath)).toBe(true);
      expect(JSON.parse(readFileSync(outputPath, "utf-8"))).toEqual(result);
    });

    it("warns but does not fail collection when the write fails", async () => {
      process.env.PR_INFO_COLLECTOR_RESPONSE_FILE = join(
        dir,
        "does",
        "not",
        "exist",
        "..",
        "\0bad",
      );
      const dispatch = createDispatch({ directoryListings: { "/": [] } });
      mockCreateGithubMcpClient.mockReturnValue(makeMcpClient(dispatch));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const result = await new PRInfoCollector(BASE_CONFIG).collect("octocat", "hello-world", 42);

      expect(result.prInfo.title).toBe("Add feature");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write PR collector response to"),
      );
      warnSpy.mockRestore();
    });
  });
});
