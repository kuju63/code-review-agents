import { describe, expect, it } from "vitest";
import {
  FileChangeSchema,
  PRInfoResultSchema,
  PRInfoSchema,
  RepositoryInfoSchema,
} from "./pr-info.js";

describe("RepositoryInfoSchema", () => {
  it("accepts a valid repository info", () => {
    const info = RepositoryInfoSchema.parse({ owner: "octocat", repository: "hello-world" });
    expect(info).toEqual({ owner: "octocat", repository: "hello-world" });
  });

  it("rejects a missing owner", () => {
    expect(() => RepositoryInfoSchema.parse({ repository: "hello-world" })).toThrow();
  });

  it("rejects a missing repository", () => {
    expect(() => RepositoryInfoSchema.parse({ owner: "octocat" })).toThrow();
  });
});

describe("FileChangeSchema", () => {
  it("accepts a file change with a patch", () => {
    const fc = FileChangeSchema.parse({
      filePath: "src/index.ts",
      patch: "@@ -1,1 +1,2 @@\n+import x",
    });
    expect(fc.filePath).toBe("src/index.ts");
    expect(fc.patch).toContain("@@ -1,1");
  });

  it("defaults patch to null when omitted", () => {
    const fc = FileChangeSchema.parse({ filePath: "image.png" });
    expect(fc.patch).toBeNull();
  });

  it("rejects a missing filePath", () => {
    expect(() => FileChangeSchema.parse({})).toThrow();
  });
});

describe("PRInfoSchema", () => {
  it("accepts a PR with defaults for optional fields", () => {
    const pr = PRInfoSchema.parse({ title: "Fix bug", prNumber: 42, body: "Fixes #41" });
    expect(pr.title).toBe("Fix bug");
    expect(pr.prNumber).toBe(42);
    expect(pr.body).toBe("Fixes #41");
    expect(pr.labels).toEqual([]);
    expect(pr.fileChanges).toEqual([]);
  });

  it("defaults body to null when omitted", () => {
    const pr = PRInfoSchema.parse({ title: "No desc", prNumber: 1 });
    expect(pr.body).toBeNull();
  });

  it("accepts labels and file changes", () => {
    const fc = { filePath: "src/App.tsx", patch: "@@ -1 +1 @@\n-old\n+new" };
    const pr = PRInfoSchema.parse({
      title: "Feature",
      prNumber: 1,
      body: "",
      labels: ["enhancement"],
      fileChanges: [fc],
    });
    expect(pr.labels).toEqual(["enhancement"]);
    expect(pr.fileChanges).toHaveLength(1);
    expect(pr.fileChanges[0]?.filePath).toBe("src/App.tsx");
  });

  it("rejects a non-numeric prNumber", () => {
    expect(() => PRInfoSchema.parse({ title: "T", prNumber: "not-an-int", body: "" })).toThrow();
  });
});

describe("PRInfoResultSchema", () => {
  const makeResult = () =>
    PRInfoResultSchema.parse({
      repositoryInfo: { owner: "owner", repository: "repo" },
      projectSummary: "A sample project.",
      prInfo: {
        title: "PR",
        prNumber: 10,
        body: "body",
        labels: [],
        fileChanges: [{ filePath: "src/main.ts", patch: "@@ -1 +1 @@\n-a\n+b" }],
      },
      dependencyFiles: ["package.json"],
    });

  it("accepts a full result", () => {
    const result = makeResult();
    expect(result.repositoryInfo.owner).toBe("owner");
    expect(result.projectSummary).toBe("A sample project.");
    expect(result.prInfo.prNumber).toBe(10);
    expect(result.dependencyFiles).toEqual(["package.json"]);
  });

  it("defaults dependencyFiles to an empty array", () => {
    const result = PRInfoResultSchema.parse({
      repositoryInfo: { owner: "o", repository: "r" },
      projectSummary: "Summary.",
      prInfo: { title: "T", prNumber: 1 },
    });
    expect(result.dependencyFiles).toEqual([]);
  });

  it("defaults manifestContents to an empty object", () => {
    const result = PRInfoResultSchema.parse({
      repositoryInfo: { owner: "o", repository: "r" },
      projectSummary: "Summary.",
      prInfo: { title: "T", prNumber: 1 },
    });
    expect(result.manifestContents).toEqual({});
  });

  it("round-trips manifestContents through JSON", () => {
    const result = PRInfoResultSchema.parse({
      repositoryInfo: { owner: "o", repository: "r" },
      projectSummary: "Summary.",
      prInfo: { title: "T", prNumber: 1 },
      manifestContents: { "package.json": '{"dependencies": {"vue": "^3"}}' },
    });
    const restored = PRInfoResultSchema.parse(JSON.parse(JSON.stringify(result)));
    expect(restored).toEqual(result);
  });

  it("round-trips through JSON", () => {
    const result = makeResult();
    const restored = PRInfoResultSchema.parse(JSON.parse(JSON.stringify(result)));
    expect(restored).toEqual(result);
  });

  it("rejects a missing projectSummary", () => {
    expect(() =>
      PRInfoResultSchema.parse({
        repositoryInfo: { owner: "o", repository: "r" },
        prInfo: { title: "T", prNumber: 1 },
      }),
    ).toThrow();
  });
});
